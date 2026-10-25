// Подключение к комнате по WebSocket и состояние комнаты.
(function () {
  const C = window.Corsa;

  // Принимает код (abcdef-ghijk), «адрес:порт» или просто адрес (порт 7777).
  C.parseAddress = function parseAddress(input) {
    const s = String(input || '').trim().replace(/^wss?:\/\//, '');
    if (!s) return null;
    const fromCode = window.CorsaCode.decode(s);
    if (fromCode) return fromCode;
    const m = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(s);
    if (!m) return null;
    const port = m[2] ? Number(m[2]) : 7777;
    if (port < 1 || port > 65535) return null;
    return { host: m[1], port };
  };

  // Ответ на вызов сервера: пароль по сети не передаётся, только подтверждение, что он известен.
  async function makeProof(password, ch) {
    if (!(ch.iterations >= 1000 && ch.iterations <= 1000000)) throw new Error('Сервер просит подозрительные параметры защиты');
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(ch.salt), iterations: ch.iterations, hash: 'SHA-256' }, base, 256);
    const key = await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ch.nonce)));
    return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  C.RoomClient = class RoomClient {
    constructor({ host, port, hello, password = '' }) {
      this.host = host;
      this.port = port;
      this.hello = hello;
      this.password = password;
      this.handlers = {};
      this.sid = null;
      this.room = null;
      this.members = new Map();
      this.history = new Map();
      this.voice = {};
      this.open = false;
    }

    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return this; }
    emit(type, ...args) { for (const fn of this.handlers[type] || []) fn(...args); }

    async connect() {
      // Главному процессу нужен порт: сертификат закрепляется по хост:порт (через общий relay на одном адресе много комнат).
      try { await window.corsaNative.tlsTarget(this.host, this.port); } catch (e) { /* без порта закрепление идёт по хосту */ }
      return new Promise((resolve, reject) => {
        let settled = false;
        let ws;
        // Всегда шифрованное соединение (wss). Сертификат сервера закрепляется в главном процессе
        // (Electron) или в нативном Android-плагине (CorsaWebSocket, см. app-android/android-src).
        try { ws = new (window.CorsaWebSocket || WebSocket)(`wss://${this.host}:${this.port}`); } catch (e) { reject(e); return; }
        this.ws = ws;
        const fail = (err) => { if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch (e) { /* ignore */ } reject(err); } };
        const coded = (code, text) => Object.assign(new Error(text), { code });
        const timer = setTimeout(() => fail(new Error('Нет ответа от сервера')), 8000);
        ws.onmessage = async (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'challenge') {
            try {
              const hello = { t: 'hello', ...this.hello };
              if (m.needPassword) {
                if (!this.password) { fail(coded('need-password', 'Нужен пароль')); return; }
                hello.proof = await makeProof(this.password, m);
              }
              ws.send(JSON.stringify(hello));
            } catch (e) { fail(e); }
            return;
          }
          if (m.t === 'error' && !settled) { fail(coded(m.code, m.text)); return; }
          this.handle(m);
          if (m.t === 'welcome' && !settled) { settled = true; clearTimeout(timer); this.open = true; resolve(this); }
        };
        ws.onerror = () => fail(new Error('Не удалось подключиться. Если это сервер, который вы уже знали, возможно, его сертификат изменился'));
        ws.onclose = () => {
          clearTimeout(timer);
          const was = this.open;
          this.open = false;
          if (!settled) { settled = true; reject(new Error('Соединение закрыто')); }
          if (was) this.emit('close');
        };
      });
    }

    handle(m) {
      switch (m.t) {
        case 'welcome':
          this.sid = m.sid;
          this.meId = m.me;
          this.owner = !!m.owner;
          this.mod = !!m.mod; // модератор (владелец тоже)
          this.fileToken = m.fileToken || null;
          this.room = m.room;
          this.members = new Map(m.members.map((x) => [x.sid, x]));
          this.history = new Map(Object.entries(m.history));
          this.pins = new Map(Object.entries(m.pins || {}));
          this.voice = m.voice;
          this.emit('welcome');
          break;
        case 'member': {
          const prev = this.members.get(m.member.sid) || null;
          this.members.set(m.member.sid, m.member);
          this.emit('member', m.member, prev);
          break;
        }
        case 'left': {
          const who = this.members.get(m.sid);
          this.members.delete(m.sid);
          this.emit('left', who);
          break;
        }
        case 'msg': {
          const list = this.history.get(m.channel) || [];
          list.push(m.msg);
          if (list.length > 200) list.shift();
          this.history.set(m.channel, list);
          this.emit('msg', m.channel, m.msg);
          break;
        }
        case 'edit': {
          const list = this.history.get(m.channel) || [];
          const i = list.findIndex((x) => x.id === m.msg.id);
          const before = i >= 0 ? list[i] : null;
          if (i >= 0) list[i] = m.msg;
          this.emit('edit', m.channel, m.msg, before);
          break;
        }
        case 'delete': {
          const list = this.history.get(m.channel) || [];
          const i = list.findIndex((x) => x.id === m.id);
          const gone = i >= 0 ? list.splice(i, 1)[0] : null;
          this.emit('delete', m.channel, m.id, gone, m.by);
          break;
        }
        case 'react': {
          const msg = (this.history.get(m.channel) || []).find((x) => x.id === m.id);
          if (msg) { msg.reactions = m.reactions; msg.remoji = m.remoji; }
          this.emit('react', m.channel, m.id, m.reactions, m.remoji);
          break;
        }
        case 'typing':
          this.emit('typing', m.channel, m.sid);
          break;
        case 'role':
          // Владелец назначил или снял вас модератором.
          this.mod = this.owner || !!m.mod;
          this.emit('role', this.mod);
          break;
        case 'pins': {
          this.pins.set(m.channel, m.pins || []);
          const msg = (this.history.get(m.channel) || []).find((x) => x.id === m.id);
          if (msg) msg.pinned = m.pinned;
          this.emit('pins', m.channel, m.id);
          break;
        }
        case 'dm':
          this.emit('dm', m.msg);
          break;
        case 'pong':
          if (Number.isFinite(m.ts)) { this.ping = Math.max(0, Math.round(performance.now() - m.ts)); this.emit('ping', this.ping); }
          break;
        case 'room':
          this.room = { ...this.room, ...m.room };
          // Удалённых каналов больше нет и в истории.
          if (m.room.channels) for (const c of m.room.channels) if (c.type === 'text' && !this.history.has(c.id)) this.history.set(c.id, []);
          this.emit('room');
          break;
        case 'voice':
          this.voice = m.voice;
          this.emit('voice');
          break;
        case 'rtc':
          this.emit('rtc', m.from, m.data);
          break;
        case 'error':
          // Исключение, бан и вход с другого места: после такого переподключаться не нужно.
          if (m.code === 'kicked' || m.code === 'banned' || /другого места/.test(m.text || '')) this.noReconnect = true;
          this.emit('error', m.text);
          break;
        default:
      }
    }

    send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
    close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
    me() { return this.members.get(this.sid); }
  };
})();
