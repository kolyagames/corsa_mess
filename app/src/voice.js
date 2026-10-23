// Голос и демонстрация экрана: WebRTC между участниками одного голосового канала.
// Сигналы идут через сервер комнаты. Сетка «каждый с каждым» подходит для небольших комнат.
(function () {
  const C = window.Corsa;

  // Делает Opus стерео и с высоким битрейтом: максимум качества звука.
  function tuneOpus(sdp, bitrate) {
    const m = /a=rtpmap:(\d+) opus\/48000\/2/.exec(sdp);
    if (!m) return sdp;
    const pt = m[1];
    const extra = `stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate};maxplaybackrate=48000;useinbandfec=1;usedtx=0;cbr=0`;
    const re = new RegExp(`a=fmtp:${pt} (.*)`);
    if (re.test(sdp)) {
      return sdp.replace(re, (all, params) => {
        const kept = params.split(';').filter((p) => p && !/^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|useinbandfec|usedtx|cbr)=/.test(p));
        return `a=fmtp:${pt} ${kept.concat(extra).join(';')}`;
      });
    }
    return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000/2\\r?\\n)`), `$1a=fmtp:${pt} ${extra}\r\n`);
  }

  C.VoiceManager = class VoiceManager {
    constructor({ client, getSettings, onChange }) {
      this.client = client;
      this.getSettings = getSettings;
      this.onChange = onChange;
      this.channel = null;
      this.peers = new Map(); // sid -> {pc, polite, makingOffer, ignoreOffer, senders:Map, streams:Map}
      this.micStream = null;
      this.screenStream = null;
      this.muted = false;
      this.deafened = false;
      this.speaking = new Set();
      this.volumes = new Map();
      this.audioEls = new Map(); // streamId -> <audio>
      this.analysers = new Map(); // key -> {analyser, data}
      this.ctx = null;
      this.timer = null;
      client.on('rtc', (from, data) => this.onSignal(from, data).catch(() => {}));
      client.on('voice', () => this.sync());
    }

    get inChannel() { return this.channel !== null; }

    async join(channel) {
      if (this.channel === channel) return;
      if (this.channel) await this.leave();
      const s = this.getSettings();
      const profile = s.voiceProfile;
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.micId && s.micId !== 'default' ? { exact: s.micId } : undefined,
          channelCount: 2,
          sampleRate: 48000,
          echoCancellation: profile === 'isolation' ? true : profile === 'custom' ? s.echo : false,
          noiseSuppression: profile === 'isolation' ? true : profile === 'custom' ? s.noise : false,
          autoGainControl: profile === 'isolation' ? true : profile === 'custom' ? s.agc : false,
        },
      });
      this.channel = channel;
      this.applyMute();
      this.watch('me', this.micStream);
      if (!this.timer) this.timer = setInterval(() => this.poll(), 100);
      if (!this.statsTimer) this.statsTimer = setInterval(() => this.collectStats(), 2000);
      this.joinedAt = Date.now();
      this.client.send({ t: 'voice', channel, muted: this.muted, deaf: this.deafened });
      this.onChange();
    }

    // Задержка до каждого участника и признак прямого соединения по локальной сети (оба адреса — адреса компьютеров).
    async collectStats() {
      for (const peer of this.peers.values()) {
        if (peer.pc.connectionState !== 'connected') continue;
        try {
          const report = await peer.pc.getStats();
          let pair = null;
          report.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId); });
          if (!pair) report.forEach((r) => { if (!pair && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
          if (!pair) continue;
          const local = report.get(pair.localCandidateId);
          const remote = report.get(pair.remoteCandidateId);
          const lan = !!(local && remote && local.candidateType === 'host' && remote.candidateType === 'host');
          const rtt = Number.isFinite(pair.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null;
          const was = peer.stats && peer.stats.lan;
          peer.stats = { lan, rtt };
          if (was !== lan) this.tuneSenders(peer);
        } catch (e) { /* соединение закрылось */ }
      }
      if (this.peers.size) this.onChange(true);
    }

    sendFlags(extra) { this.client.send({ t: 'voice-flags', muted: this.muted, deaf: this.deafened, ...extra }); }

    async leave() {
      if (!this.channel) return;
      this.stopScreen(false);
      for (const sid of [...this.peers.keys()]) this.closePeer(sid);
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      this.analysers.clear();
      this.speaking.clear();
      clearInterval(this.timer);
      this.timer = null;
      clearInterval(this.statsTimer);
      this.statsTimer = null;
      this.joinedAt = null;
      this.channel = null;
      this.client.send({ t: 'voice', channel: null });
      this.onChange();
    }

    applyMute() {
      if (this.micStream) this.micStream.getAudioTracks().forEach((t) => { t.enabled = !this.muted && !this.deafened; });
    }

    setMuted(v) { this.muted = v; this.applyMute(); if (this.channel) this.sendFlags(); this.onChange(); }
    setDeafened(v) {
      this.deafened = v;
      this.applyMute();
      for (const el of this.audioEls.values()) el.muted = v;
      if (this.channel) this.sendFlags();
      this.onChange();
    }

    sync() {
      if (!this.channel) return;
      const want = new Set((this.client.voice[this.channel] || []).filter((sid) => sid !== this.client.sid));
      for (const sid of want) if (!this.peers.has(sid)) this.openPeer(sid);
      for (const sid of [...this.peers.keys()]) if (!want.has(sid)) this.closePeer(sid);
      this.onChange();
    }

    iceServers() {
      const stun = (this.getSettings().stun || '').trim();
      return stun ? [{ urls: stun }] : [];
    }

    openPeer(sid, retries = 0) {
      if (!this.client.sid || sid === this.client.sid) return null;
      const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
      // Роли заданы заранее: первое предложение соединения всегда шлёт участник с меньшим идентификатором.
      // Так при входе в канал не бывает встречных предложений, на которых соединение могло зависнуть.
      const peer = {
        pc, polite: this.client.sid > sid, initiator: this.client.sid < sid, makingOffer: false, ignoreOffer: false, senders: new Map(), streams: new Map(),
      };
      peer.retries = retries;
      this.peers.set(sid, peer);
      // Сторожевой таймер: если за 15 секунд соединение не поднялось (потерянное предложение, зависший сбор адресов),
      // соединение пересоздаётся, до трёх попыток.
      peer.watchdog = setTimeout(() => {
        if (this.peers.get(sid) === peer && pc.connectionState !== 'connected') this.recover(sid, peer.retries);
      }, 15000);
      if (this.micStream) for (const t of this.micStream.getTracks()) peer.senders.set(t.id, pc.addTrack(t, this.micStream));
      if (this.screenStream) for (const t of this.screenStream.getTracks()) peer.senders.set(t.id, pc.addTrack(t, this.screenStream));

      pc.onicecandidate = (e) => { if (e.candidate) this.client.send({ t: 'rtc', to: sid, data: { candidate: e.candidate } }); };
      pc.onnegotiationneeded = async () => {
        // Тот, кто не инициатор, дожидается первого предложения: его дорожки попадут в ответ.
        if (!peer.initiator && !pc.remoteDescription) return;
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          const desc = { type: pc.localDescription.type, sdp: tuneOpus(pc.localDescription.sdp, this.audioBitrate()) };
          this.client.send({ t: 'rtc', to: sid, data: { description: desc } });
        } catch (e) { /* пир мог уйти */ } finally { peer.makingOffer = false; }
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        peer.streams.set(stream.id, stream);
        if (e.track.kind === 'audio') this.attachAudio(sid, stream);
        stream.onremovetrack = () => { if (!stream.getTracks().length) { peer.streams.delete(stream.id); this.onChange(); } };
        e.track.onended = () => this.onChange();
        this.onChange();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && this.peers.get(sid) === peer) this.recover(sid, peer.retries);
        this.onChange();
      };
      return peer;
    }

    // Пересоздаёт соединение с участником, если он всё ещё в нашем канале и попыток не больше трёх.
    recover(sid, retries) {
      this.closePeer(sid);
      if (retries >= 3 || !this.channel || !(this.client.voice[this.channel] || []).includes(sid)) { this.onChange(); return; }
      this.openPeer(sid, retries + 1);
      this.onChange();
    }

    closePeer(sid) {
      const peer = this.peers.get(sid);
      if (!peer) return;
      clearTimeout(peer.watchdog);
      for (const id of peer.streams.keys()) {
        const el = this.audioEls.get(id);
        if (el) { el.srcObject = null; el.remove(); this.audioEls.delete(id); }
        this.analysers.delete(id);
      }
      peer.pc.close();
      this.peers.delete(sid);
      this.speaking.delete(sid);
    }

    async onSignal(from, data) {
      if (!this.channel || !data || typeof data !== 'object') return;
      let peer = this.peers.get(from);
      if (!peer) {
        // Соединение создаётся только по настоящему предложению: одиночные «кандидаты» от неизвестного не создают записей.
        if (!data.description) return;
        peer = this.openPeer(from);
        if (!peer) return;
      } else if (data.description && data.description.type === 'offer' && !peer.initiator && peer.pc.remoteDescription && peer.pc.connectionState !== 'connected') {
        // Инициатор начал заново, а наше прежнее соединение так и не поднялось: начинаем с чистого листа.
        this.closePeer(from);
        peer = this.openPeer(from, peer.retries);
        if (!peer) return;
      }
      const pc = peer.pc;
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          const desc = { type: pc.localDescription.type, sdp: tuneOpus(pc.localDescription.sdp, this.audioBitrate()) };
          this.client.send({ t: 'rtc', to: from, data: { description: desc } });
        }
        this.tuneSenders(peer);
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    }

    audioBitrate() { return Math.min(510, Math.max(32, this.getSettings().audioKbps || 128)) * 1000; }

    tuneSenders(peer) {
      const s = this.getSettings();
      for (const sender of peer.pc.getSenders()) {
        if (!sender.track) continue;
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        if (sender.track.kind === 'audio') {
          p.encodings[0].maxBitrate = this.audioBitrate();
          p.encodings[0].priority = 'high';
        } else if (this.screenStream && this.screenStream.getVideoTracks().includes(sender.track)) {
          // Зрителю в той же локальной сети отдаём больше: сеть это выдержит.
          const lan = s.lanBoost && peer.stats && peer.stats.lan;
          p.encodings[0].maxBitrate = Math.max(s.screenMbps || 8, lan ? s.lanScreenMbps || 40 : 0) * 1e6;
          p.encodings[0].maxFramerate = s.screenFps || 60;
          p.degradationPreference = s.screenPrefer === 'fps' ? 'maintain-framerate' : 'maintain-resolution';
        }
        sender.setParameters(p).catch(() => {});
      }
    }

    attachAudio(sid, stream) {
      if (this.audioEls.has(stream.id)) return;
      const el = new Audio();
      el.autoplay = true;
      el.srcObject = stream;
      el.muted = this.deafened;
      el.volume = this.volumes.has(sid) ? this.volumes.get(sid) : 1;
      el.dataset.sid = sid;
      const out = this.getSettings().speakerId;
      if (out && out !== 'default' && el.setSinkId) el.setSinkId(out).catch(() => {});
      this.audioEls.set(stream.id, el);
      this.watch(stream.id, stream, sid);
    }

    setVolume(sid, v) {
      this.volumes.set(sid, v);
      for (const el of this.audioEls.values()) if (el.dataset.sid === sid) el.volume = Math.min(1, v);
    }

    // Определение «говорит»: уровень звука в потоке.
    watch(key, stream, sid) {
      if (!stream.getAudioTracks().length) return;
      if (!this.ctx) this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.analysers.set(key, { analyser, data: new Uint8Array(analyser.fftSize), sid: sid || this.client.sid, mine: key === 'me' });
    }

    poll() {
      const next = new Set();
      for (const a of this.analysers.values()) {
        a.analyser.getByteTimeDomainData(a.data);
        let peak = 0;
        for (const v of a.data) peak = Math.max(peak, Math.abs(v - 128));
        if (peak > 6 && !(a.mine && (this.muted || this.deafened))) next.add(a.sid);
      }
      const changed = next.size !== this.speaking.size || [...next].some((x) => !this.speaking.has(x));
      this.speaking = next;
      if (changed) this.onChange(true);
    }

    async startScreen() {
      const s = this.getSettings();
      const [w, h] = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] }[s.screenRes || 1080];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: s.screenFps || 60 } },
        audio: !!s.screenAudio,
      });
      this.screenStream = stream;
      for (const t of stream.getVideoTracks()) t.contentHint = s.screenPrefer === 'fps' ? 'motion' : 'detail';
      stream.getVideoTracks()[0].onended = () => this.stopScreen();
      for (const peer of this.peers.values()) {
        for (const t of stream.getTracks()) peer.senders.set(t.id, peer.pc.addTrack(t, stream));
        this.tuneSenders(peer);
      }
      this.sendFlags({ screen: true });
      this.onChange();
    }

    stopScreen(notify = true) {
      if (!this.screenStream) return;
      for (const t of this.screenStream.getTracks()) {
        t.stop();
        for (const peer of this.peers.values()) {
          const sender = peer.senders.get(t.id);
          if (sender) { try { peer.pc.removeTrack(sender); } catch (e) { /* ignore */ } peer.senders.delete(t.id); }
        }
      }
      this.screenStream = null;
      if (this.channel) this.sendFlags({ screen: false });
      if (notify) this.onChange();
    }

    // Все видеопотоки для сетки: [{sid, stream, mine}]
    videoTiles() {
      const tiles = [];
      if (this.screenStream) tiles.push({ sid: this.client.sid, stream: this.screenStream, mine: true });
      for (const [sid, peer] of this.peers) {
        for (const stream of peer.streams.values()) {
          if (stream.getVideoTracks().some((t) => t.readyState === 'live')) tiles.push({ sid, stream, mine: false });
        }
      }
      return tiles;
    }
  };
})();
