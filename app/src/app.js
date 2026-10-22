(function () {
  const C = window.Corsa;
  const { h, store } = C;
  const native = window.corsaNative;
  const Allow = window.CorsaAllowlist;

  const DEFAULTS = {
    accent: '#ff2a44', voiceProfile: 'isolation', echo: true, noise: true, agc: true, micId: 'default', speakerId: 'default',
    audioKbps: 128, screenRes: 1080, screenFps: 60, screenMbps: 8, screenPrefer: 'detail', screenAudio: true, stun: '', resolveNames: true, cursorGlow: true, glowPower: 55, animations: true,
    notifyPlaying: true, notifyOnline: true, notifySound: true,
  };
  const FRAMES = [['none', 'Нет'], ['neon', 'Неон'], ['gradient', 'Градиент'], ['rainbow', 'Радуга'], ['pulse', 'Пульс']];
  const NAME_FX = [['none', 'Обычное'], ['glow', 'Свечение'], ['gradient', 'Градиент'], ['rainbow', 'Радуга']];
  const PROFILE_DEFAULTS = {
    name: 'Игрок', bio: '', avatar: '', banner: '', bg: '', color: '', frame: 'none', nameFx: 'none', tag: '', custom: '', pronouns: '',
    frameUrl: '', cardFrame: '',
  };
  const ACCENTS = ['#ff2a44', '#ff7a1a', '#ffc21a', '#2adf7a', '#2ab8ff', '#8a5cff', '#ff3ad1'];

  let uid = store.get('uid');
  if (!uid) { uid = C.uuid(); store.set('uid', uid); }

  const S = {
    uid,
    profile: { ...PROFILE_DEFAULTS, ...store.get('profile', {}) },
    status: store.get('status', 'online'),
    settings: { ...DEFAULTS, ...store.get('settings', {}) },
    rooms: store.get('rooms', []),
    pickerTab: 'sticker', pickerCat: null, mgrCat: null,
    conn: null, voice: null, view: { type: 'home' }, hosting: null, activity: null, unread: {}, friendsTab: 'online',
  };

  const saveProfile = () => store.set('profile', S.profile);
  const saveSettings = () => store.set('settings', S.settings);

  // ---------- Вспомогательное ----------
  // Поля профиля, которые уходят на сервер и видны остальным.
  function profileFields(p) {
    return {
      name: p.name, bio: p.bio, avatar: C.safeUrl(p.avatar), banner: C.safeUrl(p.banner), bg: C.safeUrl(p.bg),
      color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : null, frame: p.frame, nameFx: p.nameFx, tag: p.tag, custom: p.custom, pronouns: p.pronouns,
      frameUrl: C.safeUrl(p.frameUrl), cardFrame: C.safeUrl(p.cardFrame),
    };
  }

  // Имя с эффектом, цветом и тегом. В узких местах теги можно не показывать.
  function nameEl(u, { tag = true, cls = '' } = {}) {
    const fx = u.nameFx && u.nameFx !== 'none' ? ' fx-' + u.nameFx : '';
    const style = !fx && /^#[0-9a-f]{6}$/i.test(u.color || '') ? { color: u.color } : {};
    return h('span', { class: cls }, h('span', { class: 'who-name' + fx, style }, u.name),
      tag && u.tag ? h('span', { class: 'tag' }, u.tag) : null);
  }

  function avatarEl(u, { status, cls } = {}) {
    const frame = u.frame && u.frame !== 'none' ? ' frame-' + u.frame : '';
    const el = h('div', { class: 'avatar ' + (cls || '') + frame, dataset: { sid: u.sid || '' } });
    // Буква нужна всегда: если картинка не загрузилась (удалена, сайт недоступен), остаётся она.
    const letter = h('span', { class: 'letter' }, (u.name || '?').trim().charAt(0).toUpperCase());
    el.append(letter);
    const media = C.media(u.avatar, '');
    if (media) {
      media.addEventListener('error', () => media.remove());
      media.addEventListener('load', () => { letter.style.visibility = 'hidden'; });
      media.addEventListener('loadeddata', () => { letter.style.visibility = 'hidden'; });
      el.append(media);
    }
    // Своя рамка: картинка с прозрачностью (PNG, GIF, WebP) поверх аватара, чуть больше его.
    const overlay = u.frameUrl ? C.media(u.frameUrl, 'frame-img') : null;
    if (overlay) { overlay.addEventListener('error', () => overlay.remove()); el.append(overlay); }
    if (status) el.append(h('span', { class: 'dot ' + (status === 'online' ? 'online' : '') }));
    return el;
  }

  function bgStyle(url) {
    const safe = C.safeUrl(url);
    return safe && !/\.(mp4|webm)(\?|$)/i.test(safe) ? { backgroundImage: `url("${safe}")` } : {};
  }

  function activityLine(a) {
    if (!a) return null;
    const parts = [a.details, a.state].filter(Boolean).join(' · ');
    const since = a.startedAt ? ' — ' + C.fmtElapsed(a.startedAt) : '';
    return h('span', null, h('b', null, a.name), parts ? ' · ' + parts : '', since);
  }

  const statusLabel = (m) => (m.status === 'online' ? 'В сети' : 'Не в сети');

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); C.toast('Скопировано'); } catch (e) { C.toast('Не удалось скопировать'); }
  }

  const el = {};
  function modal(content, { wide = false, onClose } = {}) {
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('button', { class: 'icon-btn close', title: 'Закрыть', onclick: () => close() }, '✕'), content);
    overlay.append(box);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    function close() { document.removeEventListener('keydown', onKey); overlay.remove(); if (onClose) onClose(); }
    document.body.append(overlay);
    return { close, box, overlay };
  }

  // ---------- Подключение ----------
  function helloPayload() {
    return { uid: S.uid, status: S.status, activity: S.activity, ...profileFields(S.profile) };
  }

  function roomCode(host, port) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? window.CorsaCode.encode(host, port) : `${host}:${port}`;
  }

  // Окно ввода пароля сети. Пароль по сети не отправляется: сервер проверяет ответ на случайный вызов.
  function askPassword(addr, wrong) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', type: 'password', placeholder: 'Пароль сети', maxLength: 128 });
      const remember = h('input', { type: 'checkbox', class: 'switch' });
      let dlg = null;
      const done = (val) => { resolve(val); if (dlg) dlg.close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done({ password: input.value, remember: remember.checked }); });
      dlg = modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, '🔒 Закрытая сеть'),
        h('div', { class: 'hint' }, `Комната ${addr.host}:${addr.port} защищена паролем.`),
        wrong ? h('div', { class: 'hint bad' }, 'Неверный пароль, попробуйте ещё раз.') : null,
        h('label', { class: 'lbl' }, 'Пароль'), input,
        h('div', { class: 'row', style: { margin: '12px 0' } }, h('div', { class: 'grow' }, 'Запомнить на этом компьютере'), remember),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: () => done(null) }, 'Отмена'),
          h('button', { class: 'btn primary', onclick: () => done({ password: input.value, remember: remember.checked }) }, 'Войти'))),
      { onClose: () => resolve(null) });
      setTimeout(() => input.focus(), 50);
    });
  }

  async function connectTo(addr, opts = {}, attempt = 0) {
    if (S.conn) await disconnect();
    const known = S.rooms.find((r) => r.host === addr.host && r.port === addr.port);
    const password = opts.password || (known && known.pw) || '';
    const client = new C.RoomClient({ host: addr.host, port: addr.port, hello: helloPayload(), password });
    try { await client.connect(); } catch (e) {
      if ((e.code === 'need-password' || e.code === 'bad-password') && attempt < 4) {
        const res = await askPassword(addr, e.code === 'bad-password');
        if (!res || !res.password) return false;
        return connectTo(addr, res, attempt + 1);
      }
      C.toast('Не удалось подключиться: ' + e.message);
      return false;
    }
    S.conn = client;
    S.unread = {};
    S.voice = new C.VoiceManager({ client, getSettings: () => S.settings, onChange: onVoiceChange });
    // Уведомления считаем по изменению состояния: первое состояние участников запоминаем молча.
    S.seen = new Map([...client.members.values()].map((m) => [m.sid, { status: m.status, game: m.activity ? m.activity.name : null }]));
    client.on('member', (m) => { checkPresence(m); renderSide(); renderRight(); if (S.view.type === 'friends') renderMain(); if (S.view.type === 'voice') renderMain(); });
    client.on('left', (who) => { if (who) S.seen.delete(who.sid); renderSide(); renderRight(); if (S.view.type === 'friends') renderMain(); });
    client.on('voice', () => { renderSide(); renderRight(); });
    client.on('msg', onMessage);
    client.on('room', () => renderSide());
    client.on('error', (t) => C.toast(t));
    client.on('close', () => {
      C.toast('Соединение с комнатой потеряно');
      if (S.voice) S.voice.leave().catch(() => {});
      S.conn = null; S.voice = null; S.view = { type: 'home' };
      renderAll();
    });
    const code = roomCode(addr.host, addr.port);
    const keepPw = opts.remember || (known && known.pw && known.pw === password) ? password : '';
    S.rooms = [{ name: client.room.name, host: addr.host, port: addr.port, code, locked: !!password, pw: keepPw }, ...S.rooms.filter((r) => r.code !== code)].slice(0, 12);
    store.set('rooms', S.rooms);
    const first = client.room.channels.find((c) => c.type === 'text');
    S.view = { type: 'text', channel: first.id };
    renderAll();
    return true;
  }

  // ---------- Уведомления как в Steam ----------
  let audioCtx = null;
  function chime() {
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime;
      [660, 880].forEach((f, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t0 + i * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.11 + 0.22);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + i * 0.11); osc.stop(t0 + i * 0.11 + 0.25);
      });
    } catch (e) { /* звук недоступен */ }
  }

  function showPresenceNote(user, kind) {
    let box = document.getElementById('steam-toasts');
    if (!box) { box = h('div', { id: 'steam-toasts' }); document.body.append(box); }
    while (box.children.length >= 4) box.firstChild.remove();
    const note = h('div', { class: 'snote', onclick: () => { note.remove(); openProfileCard(user); } },
      avatarEl(user), h('div', { class: 'stext' },
        h('div', { class: 'sname' }, nameEl(user, { tag: false })),
        h('div', { class: 'sline' }, kind === 'playing' ? 'играет в' : 'в сети'),
        kind === 'playing' ? h('div', { class: 'sgame' }, user.activity ? user.activity.name : '') : null));
    box.append(note);
    if (S.settings.notifySound) chime();
    setTimeout(() => { note.classList.add('out'); setTimeout(() => note.remove(), 260); }, 6000);
  }

  function checkPresence(m) {
    if (!S.conn || m.sid === S.conn.sid) return;
    const prev = S.seen.get(m.sid);
    const game = m.activity ? m.activity.name : null;
    S.seen.set(m.sid, { status: m.status, game });
    if (m.status !== 'online') return;
    const startedGame = game && (!prev || prev.game !== game);
    const becameOnline = !prev || prev.status !== 'online';
    if (startedGame && S.settings.notifyPlaying) showPresenceNote(m, 'playing');
    else if (becameOnline && S.settings.notifyOnline) showPresenceNote(m, 'online');
  }

  async function disconnect() {
    if (S.voice) { try { await S.voice.leave(); } catch (e) { /* ignore */ } }
    if (S.conn) { const c = S.conn; S.conn = null; c.handlers = {}; c.close(); }
    S.voice = null;
    S.view = { type: 'home' };
    renderAll();
  }

  function onMessage(channel, msg) {
    const viewing = S.view.type === 'text' && S.view.channel === channel;
    if (viewing) appendMessage(msg, true);
    else if (msg.sid !== S.conn.sid) { S.unread[channel] = (S.unread[channel] || 0) + 1; renderSide(); }
  }

  function onVoiceChange(light) {
    if (light) { updateSpeaking(); return; }
    renderSide(); renderRight();
    if (S.view.type === 'voice') renderMain();
    renderUserbar();
  }

  function updateSpeaking() {
    const sp = S.voice ? S.voice.speaking : new Set();
    document.querySelectorAll('[data-sid]').forEach((n) => {
      if (n.dataset.sid) n.classList.toggle('speaking', sp.has(n.dataset.sid));
    });
  }

  // ---------- Отправка ----------
  function sendText(text, channel) {
    const t = text.trim();
    if (!t) return;
    if (t.startsWith('/')) {
      const [name, ...rest] = t.slice(1).split(/\s+/);
      const cmd = C.plugins.commands.get(name.toLowerCase());
      if (name.toLowerCase() === 'help') {
        const list = [...C.plugins.commands.entries()].map(([n, c]) => `/${n}${c.description ? ' — ' + c.description : ''}`);
        C.toast(list.length ? list.join('\n') : 'Команд от плагинов пока нет');
        return;
      }
      if (cmd) {
        try {
          cmd.fn({ args: rest, channel, send: (x) => S.conn.send({ t: 'msg', channel, text: String(x) }), reply: (x) => C.toast(String(x)) });
        } catch (e) { C.toast('Ошибка команды: ' + e.message); }
        return;
      }
    }
    S.conn.send({ t: 'msg', channel, text: t, emojis: C.stickerLib.usedEmojis(t) });
  }

  // Текст сообщения: :имя: заменяется на кастомный эмодзи, если ссылка пришла вместе с сообщением.
  function richText(text, emojis) {
    const box = h('div', { class: 'text' });
    const re = /:([A-Za-z0-9_]{2,32}):/g;
    let last = 0;
    let count = 0;
    let m;
    while ((m = re.exec(text))) {
      const url = emojis && emojis[m[1]] ? C.safeUrl(emojis[m[1]]) : null;
      if (!url) continue;
      if (m.index > last) box.append(text.slice(last, m.index));
      const img = C.media(url, 'emoji');
      img.title = `:${m[1]}:`;
      box.append(img);
      last = re.lastIndex;
      count++;
    }
    if (last < text.length) box.append(text.slice(last));
    if (count && count <= 8 && !text.replace(re, '').trim()) box.classList.add('jumbo');
    return box;
  }

  C.plugins.appApi = {
    getState: () => ({ user: { ...S.profile }, room: S.conn ? S.conn.room : null, channel: S.view.channel || null }),
    sendMessage: (channel, text) => { if (S.conn) S.conn.send({ t: 'msg', channel, text: String(text) }); },
  };

  // ---------- Рендер: рельса ----------
  function renderRail() {
    const r = el.rail;
    r.replaceChildren(
      h('button', { class: 'rail-btn logo' + (S.view.type === 'home' ? ' on' : ''), title: 'Главная', onclick: () => { S.view = { type: 'home' }; renderAll(); } },
        h('img', { src: 'logo.png', alt: '' })),
      h('div', { class: 'rail-sep' }),
      ...S.rooms.map((room) => {
        const active = S.conn && S.conn.host === room.host && S.conn.port === room.port;
        return h('button', {
          class: 'rail-btn' + (active ? ' on' : ''), title: `${room.name} (${room.code})`,
          onclick: () => { if (!active) connectTo({ host: room.host, port: room.port }); },
        }, (room.name || '?').charAt(0).toUpperCase());
      }),
      h('button', { class: 'rail-btn', title: 'Подключиться или создать', onclick: () => { S.view = { type: 'home' }; renderAll(); } }, '+'),
    );
  }

  // ---------- Рендер: боковая панель ----------
  function renderSide() {
    const s = el.side;
    const scroll = h('div', { class: 'side-scroll' });
    const nav = (icon, label, view, extra) => h('div', {
      class: 'nav' + (S.view.type === view.type && S.view.channel === view.channel ? ' on' : ''),
      onclick: () => { S.view = view; if (view.channel) S.unread[view.channel] = 0; renderAll(); },
    }, h('span', null, icon), h('span', null, label), extra);

    scroll.append(nav('🏠', 'Главная', { type: 'home' }));
    if (S.conn) {
      scroll.append(nav('👥', 'Друзья', { type: 'friends' }));
      // Каналы по категориям; категорию можно свернуть, выбор запоминается.
      const groups = new Map();
      for (const ch of S.conn.room.channels) {
        const key = ch.category || (ch.type === 'voice' ? 'Голосовые каналы' : 'Текстовые каналы');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ch);
      }
      const collapsed = new Set(store.get('collapsed', []));
      for (const [category, list] of groups) {
        const closed = collapsed.has(category);
        const unread = list.reduce((n, c) => n + (S.unread[c.id] || 0), 0);
        scroll.append(h('div', { class: 'group-label cat' + (closed ? ' closed' : ''), onclick: () => {
          if (closed) collapsed.delete(category); else collapsed.add(category);
          store.set('collapsed', [...collapsed]);
          renderSide();
        } }, h('span', { class: 'arrow' }, '▾'), h('span', null, category), closed && unread ? h('span', { class: 'badge' }, unread) : null));
        if (closed) continue;
        for (const ch of list) {
          if (ch.type === 'text') {
            const n = S.unread[ch.id];
            scroll.append(nav('#', ch.name, { type: 'text', channel: ch.id }, n ? h('span', { class: 'badge' }, n) : null));
          } else {
            scroll.append(nav('🔊', ch.name, { type: 'voice', channel: ch.id }));
            const inside = (S.conn.voice[ch.id] || []).map((sid) => S.conn.members.get(sid)).filter(Boolean);
            if (inside.length) {
              scroll.append(h('div', { class: 'voice-members' }, inside.map((m) =>
                h('div', { class: 'voice-member', dataset: { sid: m.sid } }, avatarEl(m), nameEl(m, { tag: false })))));
            }
          }
        }
      }
    }
    // Шапка комнаты: баннер (если задан) с названием поверх. Владелец открывает настройки комнаты по клику.
    const room = S.conn ? S.conn.room : null;
    const banner = room && C.safeUrl(room.banner);
    const header = h('div', {
      class: 'side-title room-header' + (banner ? ' has-banner' : '') + (S.conn && S.conn.owner ? ' owner' : ''),
      style: banner && !/\.(mp4|webm)(\?|$)/i.test(banner) ? { backgroundImage: `url("${banner}")` } : {},
      title: S.conn && S.conn.owner ? 'Настройки комнаты' : '',
      onclick: () => { if (S.conn && S.conn.owner) openSettings('room'); },
    }, h('span', { class: 'room-name' }, room ? room.name : 'corsa-mess'));
    s.replaceChildren(header, scroll, h('div', { class: 'userbar', id: 'userbar' }));
    renderUserbar();
    updateSpeaking();
  }

  function renderUserbar() {
    const bar = document.getElementById('userbar');
    if (!bar) return;
    const v = S.voice;
    const sub = S.status === 'invisible' ? 'Невидимка' : S.activity ? S.activity.name : 'В сети';
    bar.replaceChildren(...[
      h('div', { class: 'who', onclick: (e) => openSelfMenu(e.currentTarget), title: 'Профиль' },
        avatarEl({ ...S.profile }, { status: S.status === 'invisible' ? 'offline' : 'online' }),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'name' }, nameEl(S.profile, { tag: false })), h('div', { class: 'sub' }, sub))),
      v && v.inChannel ? h('button', { class: 'icon-btn' + (v.muted ? ' off' : ''), title: 'Микрофон', onclick: () => v.setMuted(!v.muted) }, v.muted ? '🔇' : '🎙') : null,
      v && v.inChannel ? h('button', { class: 'icon-btn' + (v.deafened ? ' off' : ''), title: 'Звук', onclick: () => v.setDeafened(!v.deafened) }, v.deafened ? '🙉' : '🎧') : null,
      h('button', { class: 'icon-btn', title: 'Настройки', onclick: () => openSettings() }, '⚙'),
    ].filter(Boolean));
  }

  // ---------- Рендер: правая панель ----------
  function renderRight() {
    const r = el.right;
    const show = S.conn && ['text', 'voice', 'friends'].includes(S.view.type);
    r.style.display = show ? '' : 'none';
    if (!show) return;
    const members = [...S.conn.members.values()];
    if (S.view.type === 'friends') {
      const playing = members.filter((m) => m.activity);
      r.replaceChildren(h('h4', null, 'Активные контакты'), ...(playing.length ? playing.map((m) =>
        h('div', { class: 'contact-card', onclick: () => openProfileCard(m) },
          h('div', { class: 'row' }, avatarEl(m, { status: m.status }), h('div', null, h('b', null, nameEl(m)), h('div', { class: 'game' }, activityLine(m.activity)))))) :
        [h('div', { class: 'hint', style: { padding: '0 6px' } }, 'Сейчас никто ничего не играет.')]));
      return;
    }
    const on = members.filter((m) => m.status === 'online');
    const off = members.filter((m) => m.status !== 'online');
    const row = (m) => h('div', { class: 'member' + (m.status === 'online' ? '' : ' offline'), onclick: () => openProfileCard(m) },
      avatarEl(m, { status: m.status }),
      h('div', { class: 'meta' }, h('div', { class: 'nm' }, nameEl(m)),
        m.activity ? h('div', { class: 'act' }, activityLine(m.activity)) : m.custom ? h('div', { class: 'act' }, m.custom) : null));
    const playing = members.filter((m) => m.activity);
    const card = (m) => h('div', { class: 'contact-card', onclick: () => openProfileCard(m) },
      h('div', { class: 'row' }, avatarEl(m, { status: m.status }), h('div', { class: 'meta' }, h('b', null, nameEl(m)), h('div', { class: 'game' }, activityLine(m.activity)))));
    r.replaceChildren(...[
      playing.length ? h('h4', null, `Активность — ${playing.length}`) : null, ...playing.map(card),
      h('h4', null, `В сети — ${on.length}`), ...on.map(row), off.length ? h('h4', null, `Не в сети — ${off.length}`) : null, ...off.map(row),
    ].filter(Boolean));
    updateSpeaking();
  }

  // ---------- Рендер: центр ----------
  function renderMain() {
    const m = el.main;
    const t = S.view.type;
    if (t === 'home' || !S.conn) { renderHome(m); return; }
    if (t === 'friends') renderFriends(m);
    else if (t === 'text') renderText(m);
    else if (t === 'voice') renderVoice(m);
  }

  // Переходы между экранами идут через renderAll: именно здесь запускается анимация появления.
  function renderAll() {
    renderRail(); renderSide(); renderMain(); renderRight();
    if (el.main) { el.main.classList.remove('enter'); void el.main.offsetWidth; el.main.classList.add('enter'); }
  }

  // Главная
  function renderHome(m) {
    const addr = h('input', { class: 'input', placeholder: 'Код (abcdef-ghijk) или адрес:порт' });
    const join = async () => {
      const a = C.parseAddress(addr.value);
      if (!a) { C.toast('Не похоже на код или адрес'); return; }
      await connectTo(a);
    };
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    const roomName = h('input', { class: 'input', value: S.profile.name + ' — комната', maxLength: 40 });
    const port = h('input', { class: 'input', value: '7777', type: 'number', min: 1024, max: 65535 });
    const netPass = h('input', { class: 'input', type: 'password', maxLength: 128, placeholder: 'Пароль сети (нужен для доступа из интернета)', autocomplete: 'new-password' });

    const hostCard = h('div', { class: 'card' }, h('h3', null, 'Запустить свой сервер'),
      h('div', { class: 'hint' }, 'Ваш компьютер станет сервером комнаты. Друзья подключаются по коду или по IP и порту. Соединение шифруется.'));
    if (!S.hosting) {
      hostCard.append(h('label', { class: 'lbl' }, 'Название комнаты'), roomName, h('label', { class: 'lbl' }, 'Порт'), port,
        h('label', { class: 'lbl' }, 'Пароль сети'), netPass,
        h('div', { class: 'hint' }, 'С паролем в комнату войдут только те, кто его знает. Пароль не передаётся по сети.'),
        h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: async () => {
          try {
            S.hosting = await native.hostStart({ name: roomName.value, port: Number(port.value), ownerUid: S.uid, password: netPass.value });
            S.hostPassword = netPass.value;
            await connectTo({ host: '127.0.0.1', port: S.hosting.port }, { password: S.hostPassword });
            renderMain();
          } catch (e) { C.toast('Не удалось запустить сервер: ' + (e.message || e)); }
        } }, 'Запустить сервер')));
    } else {
      const hs = S.hosting;
      const pub = h('input', { class: 'input', placeholder: 'Ваш внешний IP (если порт открыт вручную)' });
      const pubOut = h('div', { class: 'hint' });
      const netOut = h('div', { class: 'hint' });
      const openNet = h('button', { class: 'btn primary', onclick: async () => {
        openNet.disabled = true;
        netOut.className = 'hint';
        netOut.textContent = 'Ищу роутер…';
        try {
          const r = await native.openInternet();
          S.hosting.internet = r;
          renderMain();
        } catch (e) { netOut.className = 'hint bad'; netOut.textContent = (e.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); openNet.disabled = false; }
      } }, 'Открыть доступ из интернета');
      const net = S.hosting.internet;
      hostCard.append(
        h('div', { class: 'hint' }, `Сервер работает. ${hs.protected ? '🔒 Закрыт паролем.' : '⚠ Пароля нет: войти может любой, кто знает адрес.'} Код для друзей в той же сети:`),
        h('div', { class: 'code-box' }, hs.code || 'нет сети'),
        h('div', { class: 'row' }, hs.code ? h('button', { class: 'btn', onclick: () => copy(hs.code) }, 'Скопировать код') : null,
          h('button', { class: 'btn danger', onclick: async () => { await disconnect(); await native.hostStop(); S.hosting = null; renderMain(); } }, 'Остановить')),
        h('label', { class: 'lbl' }, 'Отпечаток сервера'),
        h('div', { class: 'hint', style: { wordBreak: 'break-all', userSelect: 'all' } }, hs.fingerprint),
        h('div', { class: 'hint' }, 'Друзья запоминают его при первом входе. Если потом он изменится, приложение предупредит о возможной подмене.'),
        h('label', { class: 'lbl' }, 'Для друзей через интернет'),
        net ? h('div', null,
          net.cgnat ? h('div', { class: 'hint bad' }, `Внешний адрес роутера ${net.externalIp} — общий адрес провайдера (CGNAT), напрямую до вас не достучаться. Используйте общую сеть вроде Radmin VPN, ZeroTier или Tailscale.`)
            : h('div', null, h('div', { class: 'hint' }, `Порт открыт на роутере: ${net.externalIp}:${net.externalPort}. Код для друзей из интернета:`),
              h('div', { class: 'code-box' }, net.code), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => copy(net.code) }, 'Скопировать'),
                h('button', { class: 'btn danger', onclick: async () => { await native.closeInternet(); delete S.hosting.internet; renderMain(); } }, 'Закрыть доступ'))))
          : h('div', null, h('div', { class: 'hint' }, 'Кнопка попросит ваш роутер открыть порт для этой комнаты (UPnP). Порт закроется при остановке сервера. Доступ из интернета включается только с паролем.'),
            openNet, netOut,
            h('div', { class: 'hint', style: { marginTop: '10px' } }, `Если роутер не поддерживает UPnP: пробросьте порт ${hs.port} (TCP) вручную и введите внешний IP ниже либо используйте Radmin VPN, ZeroTier или Tailscale.`),
            pub, h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => {
              try { const code = window.CorsaCode.encode(pub.value.trim(), hs.port); pubOut.replaceChildren(h('div', { class: 'code-box' }, code), h('button', { class: 'btn', onclick: () => copy(code) }, 'Скопировать')); }
              catch (e) { pubOut.textContent = 'Нужен адрес вида 203.0.113.5'; }
            } }, 'Сделать код'), pubOut));
    }

    const saved = S.rooms.length ? h('div', { style: { marginTop: '14px' } }, h('label', { class: 'lbl' }, 'Недавние комнаты'),
      ...S.rooms.map((r) => h('div', { class: 'saved' }, h('div', { class: 'grow' }, h('b', null, (r.locked ? '🔒 ' : '') + r.name), h('div', { class: 'hint' }, r.code)),
        h('button', { class: 'btn', onclick: () => connectTo({ host: r.host, port: r.port }) }, 'Войти'),
        h('button', { class: 'icon-btn', title: 'Убрать', onclick: () => { S.rooms = S.rooms.filter((x) => x !== r); store.set('rooms', S.rooms); renderAll(); } }, '✕')))) : null;

    m.replaceChildren(h('div', { class: 'page' },
      h('h2', { style: { marginTop: 0 } }, S.conn ? 'Главная' : 'Добро пожаловать в corsa-mess'),
      h('div', { class: 'cards' },
        h('div', { class: 'card' }, h('h3', null, 'Подключиться к комнате'),
          h('div', { class: 'hint' }, 'Введите код от друга или IP-адрес и порт.'), h('label', { class: 'lbl' }, 'Код или адрес'), addr,
          h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: join }, 'Подключиться')), saved),
        hostCard)));
  }

  // Друзья
  function renderFriends(m) {
    const members = [...S.conn.members.values()];
    const list = S.friendsTab === 'online' ? members.filter((x) => x.status === 'online') : members;
    const tab = (id, label) => h('div', { class: 'tab' + (S.friendsTab === id ? ' on' : ''), onclick: () => { S.friendsTab = id; renderMain(); } }, label);
    m.replaceChildren(
      h('div', { class: 'main-head' }, h('span', { class: 'title' }, '👥 Друзья'), h('div', { class: 'tabs' }, tab('online', 'В сети'), tab('all', 'Все'))),
      h('div', { class: 'page' }, h('div', { class: 'group-label', style: { padding: '0 0 8px' } }, `${S.friendsTab === 'online' ? 'В сети' : 'Все'} — ${list.length}`),
        ...list.map((u) => h('div', { class: 'member', onclick: () => openProfileCard(u) }, avatarEl(u, { status: u.status }),
          h('div', { class: 'meta' }, h('div', { class: 'nm' }, nameEl(u)), h('div', { class: 'act' }, u.activity ? activityLine(u.activity) : u.custom || statusLabel(u)))))));
  }

  // Чат
  function appendMessage(msg, stick) {
    const box = document.getElementById('messages');
    if (!box) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const shown = C.plugins.transformMessage(msg);
    const media = shown.sticker ? C.media(shown.sticker, 'sticker') : null;
    // Рамка, цвет и эффект имени берутся из текущего профиля автора, если он в комнате.
    const mem = S.conn.members.get(shown.sid);
    const who = mem ? { ...mem, name: shown.name, avatar: shown.avatar } : { name: shown.name, avatar: shown.avatar };
    const author = nameEl(who, { cls: 'author' });
    author.addEventListener('click', () => { if (mem) openProfileCard(mem); });
    const mine = shown.uid === S.conn.meId;
    box.append(h('div', { class: 'msg' + (mine ? ' mine' : '') + (stick ? ' new' : '') },
      avatarEl(who),
      h('div', { class: 'body' },
        h('div', { class: 'head' }, author, h('span', { class: 'time' }, C.fmtTime(shown.ts))),
        shown.text ? richText(shown.text, shown.emojis) : null, media)));
    if (stick && near) box.scrollTop = box.scrollHeight;
  }

  function renderText(m) {
    const ch = S.conn.room.channels.find((c) => c.id === S.view.channel);
    const messages = h('div', { class: 'messages', id: 'messages' });
    const list = S.conn.history.get(ch.id) || [];
    if (!list.length) messages.append(h('div', { class: 'empty' }, h('h3', null, `Это начало канала #${ch.name}`), h('div', null, 'Напишите первое сообщение.')));
    const field = h('textarea', { class: 'field', rows: 1, placeholder: `Написать в #${ch.name}` });
    const submit = () => { sendText(field.value, ch.id); field.value = ''; field.style.height = ''; };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    field.addEventListener('input', () => { field.style.height = 'auto'; field.style.height = Math.min(140, field.scrollHeight) + 'px'; });
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    const composer = h('div', { class: 'composer' }, field,
      h('button', { class: 'btn', title: 'Стикеры и эмодзи', onclick: () => {
        if (pop) { closePop(); return; }
        pop = stickerPopup(ch.id, field, closePop);
        composer.append(pop);
      } }, '😀'),
      h('button', { class: 'btn primary', onclick: submit }, 'Отправить'));
    m.replaceChildren(h('div', { class: 'main-head' }, h('span', { class: 'title' }, '# ' + ch.name)), messages, composer);
    for (const msg of list) appendMessage(msg, false);
    messages.scrollTop = messages.scrollHeight;
    field.focus();
  }

  // Окно выбора: вкладки «Стикеры» и «Эмодзи», категории, быстрое добавление по ссылке.
  // Перерисовывается само, поэтому набранный текст в поле ввода не теряется.
  function stickerPopup(channel, field, close) {
    const lib = C.stickerLib;
    const pop = h('div', { class: 'sticker-pop' });
    const insertEmoji = (name) => {
      const text = `:${name}: `;
      const s = field.selectionStart == null ? field.value.length : field.selectionStart;
      const e = field.selectionEnd == null ? s : field.selectionEnd;
      field.value = field.value.slice(0, s) + text + field.value.slice(e);
      field.focus();
      field.selectionStart = field.selectionEnd = s + text.length;
      field.dispatchEvent(new Event('input'));
    };
    const draw = () => {
      if (!lib.categories.length) lib.addCategory('Мои стикеры');
      if (!lib.cat(S.pickerCat)) S.pickerCat = lib.categories[0].id;
      const cat = lib.cat(S.pickerCat);
      const type = S.pickerTab;
      const items = cat.items.filter((i) => i.type === type);
      const url = h('input', { class: 'input', placeholder: type === 'emoji' ? 'Ссылка на эмодзи' : 'Ссылка на стикер или GIF' });
      const name = type === 'emoji' ? h('input', { class: 'input', placeholder: 'Имя (:имя:)', style: { maxWidth: '110px' } }) : null;
      const hint = h('div', { class: 'hint' }, `Добавится в «${cat.name}». Разрешены: ${Allow.HOSTS.join(', ')}`);
      const add = () => {
        try { lib.addItem(cat.id, { type, name: name && name.value, url: url.value }); draw(); } catch (err) { hint.className = 'hint bad'; hint.textContent = err.message; }
      };
      url.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
      pop.replaceChildren(
        h('div', { class: 'row' },
          h('div', { class: 'chips grow' }, [['sticker', 'Стикеры'], ['emoji', 'Эмодзи']].map(([id, label]) =>
            h('div', { class: 'chip' + (type === id ? ' on' : ''), onclick: () => { S.pickerTab = id; draw(); } }, label))),
          h('button', { class: 'icon-btn', title: 'Управление и экспорт', onclick: () => { close(); openSettings('stickers'); } }, '⚙')),
        h('div', { class: 'chips', style: { margin: '10px 0 6px' } }, lib.categories.map((c) =>
          h('div', { class: 'chip' + (c.id === cat.id ? ' on' : ''), onclick: () => { S.pickerCat = c.id; draw(); } }, c.name))),
        h('div', { class: 'sticker-grid' + (type === 'emoji' ? ' emoji-grid' : '') }, items.length ? items.map((item) =>
          h('div', { class: 'st', title: type === 'emoji' ? `:${item.name}:` : item.name, onclick: () => {
            if (type === 'emoji') insertEmoji(item.name);
            else { S.conn.send({ t: 'msg', channel, sticker: item.url }); close(); }
          } }, C.media(item.url, ''),
          h('button', { class: 'x', title: 'Удалить', onclick: (ev) => { ev.stopPropagation(); lib.removeItem(cat.id, item.id); draw(); } }, '✕'))) :
          [h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'В этой категории пока пусто. Добавьте ссылку ниже.')]),
        h('div', { class: 'row', style: { marginTop: '10px' } }, name, url, h('button', { class: 'btn', onclick: add }, '+')), hint);
    };
    draw();
    return pop;
  }

  // Голос
  function renderVoice(m) {
    const ch = S.conn.room.channels.find((c) => c.id === S.view.channel);
    const v = S.voice;
    const here = v.channel === ch.id;
    const inside = (S.conn.voice[ch.id] || []).map((sid) => S.conn.members.get(sid)).filter(Boolean);
    const head = h('div', { class: 'main-head' }, h('span', { class: 'title' }, '🔊 ' + ch.name));
    if (!here) {
      m.replaceChildren(head, h('div', { class: 'voice-stage' },
        h('div', { class: 'empty' }, h('h3', null, ch.name), h('div', null, inside.length ? `Сейчас в канале: ${inside.map((x) => x.name).join(', ')}` : 'Здесь пока никого нет.'),
          h('button', { class: 'btn primary', style: { marginTop: '16px' }, onclick: async () => {
            try { await v.join(ch.id); } catch (e) { C.toast('Нет доступа к микрофону: ' + e.message); }
          } }, 'Подключиться к каналу'))));
      return;
    }
    const tiles = h('div', { class: 'tiles' });
    for (const t of v.videoTiles()) {
      const who = S.conn.members.get(t.sid);
      const video = h('video', { autoplay: true, playsInline: true, muted: true });
      video.srcObject = t.stream;
      tiles.append(h('div', { class: 'tile big' }, video, h('div', { class: 'label' }, `${who ? who.name : '?'} — экран`),
        h('button', { class: 'btn fs', onclick: () => video.requestFullscreen && video.requestFullscreen() }, '⛶')));
    }
    for (const u of inside) {
      tiles.append(h('div', { class: 'tile', dataset: { sid: u.sid } }, avatarEl(u), h('div', { class: 'label' }, u.name + (u.sid === S.conn.sid ? ' (вы)' : ''))));
    }
    const sharing = !!v.screenStream;
    m.replaceChildren(head, h('div', { class: 'voice-stage' }, tiles),
      h('div', { class: 'voice-controls' },
        h('button', { class: 'btn' + (v.muted ? ' danger' : ''), onclick: () => v.setMuted(!v.muted) }, v.muted ? '🔇 Включить микрофон' : '🎙 Микрофон'),
        h('button', { class: 'btn' + (v.deafened ? ' danger' : ''), onclick: () => v.setDeafened(!v.deafened) }, v.deafened ? '🙉 Включить звук' : '🎧 Звук'),
        h('button', { class: 'btn' + (sharing ? ' primary' : ''), onclick: () => (sharing ? v.stopScreen() : pickScreen()) }, sharing ? '⏹ Остановить показ' : '🖥 Показать экран'),
        h('button', { class: 'btn danger', onclick: () => v.leave() }, '📞 Выйти')));
    updateSpeaking();
  }

  async function pickScreen() {
    let sources = [];
    try { sources = await native.screenSources(); } catch (e) { C.toast('Не удалось получить список экранов'); return; }
    let chosen = sources[0] && sources[0].id;
    const grid = h('div', { class: 'source-grid' });
    const draw = () => grid.replaceChildren(...sources.map((s) => h('div', { class: 'source' + (s.id === chosen ? ' on' : ''), onclick: () => { chosen = s.id; draw(); } },
      h('img', { src: s.thumb, alt: '' }), s.name)));
    draw();
    const dlg = modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, 'Что показать?'), grid,
      h('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn primary', onclick: async () => {
          dlg.close();
          try { await native.screenSelect(chosen); await S.voice.startScreen(); } catch (e) { C.toast('Показ экрана не запустился: ' + e.message); }
        } }, 'Показать'))));
  }

  // ---------- Меню при клике на себя ----------
  let selfMenu = null;
  function closeSelfMenu() {
    if (selfMenu) { selfMenu.cleanup(); selfMenu.node.remove(); selfMenu = null; }
  }

  function setStatus(v) {
    S.status = v;
    store.set('status', v);
    if (S.conn) S.conn.send({ t: 'status', status: v });
    renderUserbar();
  }

  function saveCustomStatus(text) {
    S.profile.custom = text.slice(0, 60);
    saveProfile();
    if (S.conn) S.conn.send({ t: 'profile', custom: S.profile.custom });
  }

  function openSelfMenu(anchor) {
    if (selfMenu) { closeSelfMenu(); return; }
    const node = h('div', { class: 'self-menu' });
    let statusOpen = false;
    let editing = false;
    const draw = () => {
      const invisible = S.status === 'invisible';
      const me = { ...S.profile, sid: '', status: invisible ? 'offline' : 'online', activity: S.activity };
      const pc = /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : null;
      const banner = h('div', { class: 'sm-banner', style: { ...bgStyle(me.banner), ...(pc && !C.safeUrl(me.banner) ? { background: `linear-gradient(135deg, ${pc}, #120407)` } : {}) } });
      const input = h('input', { class: 'input', value: S.profile.custom || '', maxLength: 60, placeholder: 'Что у вас происходит?' });
      const finish = (save) => { editing = false; if (save) saveCustomStatus(input.value.trim()); draw(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
      const bubble = editing ? h('div', { class: 'sm-bubble edit' }, input, h('div', { class: 'hint' }, 'Enter — сохранить, Esc — отмена'))
        : h('div', { class: 'sm-bubble' + (S.profile.custom ? '' : ' empty'), title: 'Изменить статус-фразу', onclick: () => { editing = true; draw(); input.focus(); } },
          S.profile.custom || '+ Статус-фраза');
      const item = (icon, label, onclick, chevron) => h('div', { class: 'sm-item', onclick }, h('span', { class: 'ic' }, icon), h('span', { class: 'grow' }, label), chevron ? h('span', { class: 'chev' }, chevron) : null);
      const opts = statusOpen ? h('div', { class: 'sm-sub' }, [['online', '🟢', 'В сети'], ['invisible', '⚫', 'Невидимка']].map(([id, ic, label]) =>
        h('div', { class: 'sm-item' + (S.status === id ? ' on' : ''), onclick: () => { setStatus(id); draw(); } }, h('span', { class: 'ic' }, ic), h('span', { class: 'grow' }, label), S.status === id ? h('span', null, '✓') : null))) : null;
      const card = h('div', null, banner,
        h('div', { class: 'sm-head' }, avatarEl(me, { status: me.status, cls: 'lg' }), bubble),
        h('div', { class: 'sm-who' }, h('div', { class: 'sm-name' }, nameEl(me)),
          h('div', { class: 'hint' }, [me.pronouns, S.activity ? 'Играет: ' + S.activity.name : ''].filter(Boolean).join(' · ') || (invisible ? 'Невидимка' : 'В сети'))),
        h('div', { class: 'sm-list' },
          item('✎', 'Редактировать профиль', () => { closeSelfMenu(); openSettings('profile'); }),
          item(invisible ? '⚫' : '🟢', invisible ? 'Невидимка' : 'В сети', () => { statusOpen = !statusOpen; draw(); }, statusOpen ? '⌄' : '›'), opts),
        h('div', { class: 'sm-list' }, item('⚙', 'Настройки', () => { closeSelfMenu(); openSettings(); }),
          item('🔔', 'Уведомления', () => { closeSelfMenu(); openSettings('notify'); })));
      const cf = me.cardFrame ? C.media(me.cardFrame, 'card-frame') : null;
      if (cf) cf.addEventListener('error', () => cf.remove());
      node.replaceChildren(...[card, cf].filter(Boolean));
      if (editing) input.focus();
    };
    draw();
    const r = anchor.getBoundingClientRect();
    node.style.left = Math.max(8, Math.min(r.left, innerWidth - 340)) + 'px';
    node.style.bottom = (innerHeight - r.top + 10) + 'px';
    document.body.append(node);
    const onDown = (e) => { if (!node.contains(e.target) && !anchor.contains(e.target)) closeSelfMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') closeSelfMenu(); };
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    selfMenu = { node, cleanup: () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); } };
  }

  // ---------- Карточка профиля ----------
  // Карточка профиля: используется и в окне профиля, и в предпросмотре редактора.
  function profileCardNode(u) {
    const pc = /^#[0-9a-f]{6}$/i.test(u.color || '') ? u.color : null;
    const bannerStyle = { ...bgStyle(u.banner) };
    if (!C.safeUrl(u.banner) && pc) bannerStyle.background = `linear-gradient(135deg, ${pc}, #120407)`;
    const bg = h('div', { class: 'profile-banner', style: bannerStyle });
    const banner = C.safeUrl(u.banner);
    const bannerMedia = banner && /\.(mp4|webm)(\?|$)/i.test(banner) ? C.media(banner, '') : null;
    if (bannerMedia) { bannerMedia.style.cssText = 'width:100%;height:100%;object-fit:cover'; bg.append(bannerMedia); }
    const title = h('h2', { style: { margin: '8px 0 0' } }, nameEl(u));
    const body = h('div', { class: 'profile-body' }, avatarEl(u, { status: u.status, cls: 'lg' }), title,
      u.pronouns ? h('div', { class: 'pronouns' }, u.pronouns) : null,
      h('div', { class: 'hint' }, u.custom ? u.custom : statusLabel(u)),
      u.bio ? h('div', { style: { marginTop: '12px', whiteSpace: 'pre-wrap' } }, u.bio) : null,
      u.activity ? h('div', { class: 'contact-card', style: { marginTop: '14px' } }, h('div', { class: 'game' }, 'Играет'), h('b', null, u.activity.name),
        h('div', { class: 'game' }, [u.activity.details, u.activity.state].filter(Boolean).join(' · ')), h('div', { class: 'game' }, C.fmtElapsed(u.activity.startedAt))) : null);
    const cardFrame = u.cardFrame ? C.media(u.cardFrame, 'card-frame') : null;
    if (cardFrame) cardFrame.addEventListener('error', () => cardFrame.remove());
    const wrap = h('div', { class: 'profile-card-bg', style: bgStyle(u.bg) }, bg, body, cardFrame);
    if (pc) wrap.style.setProperty('--pc', pc);
    return wrap;
  }

  function openProfileCard(u) {
    const card = profileCardNode(u);
    // Владелец комнаты может исключить или заблокировать участника.
    if (S.conn && S.conn.owner && u.sid && u.sid !== S.conn.sid) {
      card.append(h('div', { class: 'profile-body', style: { marginTop: '0', paddingBottom: '16px', position: 'relative', zIndex: 6 } },
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { S.conn.send({ t: 'kick', sid: u.sid }); dlg.close(); } }, 'Выгнать'),
          h('button', { class: 'btn danger', onclick: () => {
            if (confirm(`Заблокировать ${u.name}? Он не сможет войти снова.`)) { S.conn.send({ t: 'kick', sid: u.sid, ban: true }); dlg.close(); }
          } }, 'Заблокировать'))));
    }
    const dlg = modal(card);
  }

  // ---------- Настройки ----------
  function field(label, input, hint) {
    return h('div', null, h('label', { class: 'lbl' }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  }
  function switchRow(label, checked, onChange, hint) {
    const sw = h('input', { type: 'checkbox', class: 'switch', checked });
    sw.addEventListener('change', () => onChange(sw.checked));
    return h('div', { style: { margin: '12px 0' } }, h('div', { class: 'row' }, h('div', { class: 'grow' }, label), sw), hint ? h('div', { class: 'hint' }, hint) : null);
  }
  function select(options, value, onChange) {
    const s = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function urlField(label, key, draft, note, onInput) {
    const input = h('input', { class: 'input', value: draft[key] || '', placeholder: 'https://i.imgur.com/…' });
    const hint = h('div', { class: 'hint' }, note || '');
    input.addEventListener('input', () => {
      draft[key] = input.value.trim();
      const bad = draft[key] && !C.safeUrl(draft[key]);
      input.classList.toggle('bad', !!bad);
      hint.className = bad ? 'hint bad' : 'hint';
      hint.textContent = bad ? 'Этот сайт не в списке проверенных. Разрешены: ' + Allow.HOSTS.join(', ') : note || '';
      if (onInput) onInput();
    });
    return h('div', null, h('label', { class: 'lbl' }, label), input, hint);
  }

  // Ряд кнопок-вариантов.
  function chips(options, current, onPick) {
    const box = h('div', { class: 'chips' });
    const draw = () => box.replaceChildren(...options.map(([v, l]) => h('div', { class: 'chip' + (v === current ? ' on' : ''), onclick: () => { current = v; onPick(v); draw(); } }, l)));
    draw();
    return box;
  }

  function sectionProfile() {
    const draft = { ...PROFILE_DEFAULTS, ...S.profile };
    const preview = h('div', { class: 'preview' });
    const update = () => preview.replaceChildren(profileCardNode({ ...draft, sid: '', status: S.status === 'invisible' ? 'offline' : 'online', activity: S.activity }));
    const text = (key, max, placeholder) => {
      const i = h('input', { class: 'input', value: draft[key] || '', maxLength: max, placeholder: placeholder || '' });
      i.addEventListener('input', () => { draft[key] = i.value; update(); });
      return i;
    };
    const bio = h('textarea', { class: 'input', rows: 3, maxLength: 190, value: draft.bio || '' });
    bio.addEventListener('input', () => { draft.bio = bio.value; update(); });
    const status = select([['online', 'В сети'], ['invisible', 'Невидимка (друзья видят вас как «не в сети»)']], S.status, (v) => {
      S.status = v; store.set('status', v);
      if (S.conn) S.conn.send({ t: 'status', status: v });
      renderUserbar();
      update();
    });
    const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : S.settings.accent });
    color.addEventListener('input', () => { draft.color = color.value; update(); });
    const form = h('div', { class: 'form' },
      field('Имя', text('name', 32)),
      h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Тег (до 4 символов)', text('tag', 4, 'CRS'))), h('div', { class: 'grow' }, field('Местоимения', text('pronouns', 24)))),
      field('Статус-фраза', text('custom', 60, 'Например: не беспокоить')),
      field('О себе', bio),
      h('label', { class: 'lbl' }, 'Цвет профиля'),
      h('div', { class: 'row' }, color, h('button', { class: 'btn', onclick: () => { draft.color = ''; update(); } }, 'Сбросить'),
        h('div', { class: 'hint' }, 'Цвет имени, баннера без картинки и рамки карточки.')),
      h('label', { class: 'lbl' }, 'Рамка аватара'), chips(FRAMES, draft.frame, (v) => { draft.frame = v; update(); }),
      h('label', { class: 'lbl' }, 'Эффект имени'), chips(NAME_FX, draft.nameFx, (v) => { draft.nameFx = v; update(); }),
      urlField('Аватар (ссылка)', 'avatar', draft, 'Картинку загружает у друга его клиент по этой ссылке.', update),
      urlField('Баннер (ссылка)', 'banner', draft, 'Подойдёт и GIF.', update), urlField('Фон профиля (ссылка)', 'bg', draft, 'Подойдёт и GIF.', update),
      h('label', { class: 'lbl' }, 'Свои рамки'),
      urlField('Рамка аватара (ссылка)', 'frameUrl', draft, 'PNG, GIF или WebP с прозрачным центром. Рисуется поверх аватара и чуть больше его.', update),
      urlField('Рамка карточки профиля (ссылка)', 'cardFrame', draft, 'Картинка с прозрачной серединой, растягивается на всю карточку.', update),
      field('Статус', status),
      h('div', { class: 'row', style: { marginTop: '20px' } }, h('button', { class: 'btn primary', onclick: () => {
        S.profile = {
          ...PROFILE_DEFAULTS, ...draft, name: (draft.name || '').trim() || 'Игрок', tag: (draft.tag || '').trim().slice(0, 4),
          avatar: C.safeUrl(draft.avatar) || '', banner: C.safeUrl(draft.banner) || '', bg: C.safeUrl(draft.bg) || '',
          frameUrl: C.safeUrl(draft.frameUrl) || '', cardFrame: C.safeUrl(draft.cardFrame) || '',
        };
        saveProfile();
        if (S.conn) S.conn.send({ t: 'profile', ...profileFields(S.profile) });
        renderAll();
        C.toast('Профиль сохранён');
      } }, 'Сохранить')));
    update();
    return h('div', null, h('h2', null, 'Мой профиль'), h('div', { class: 'editor' }, form, preview));
  }

  function sectionVoice(redraw) {
    const mic = h('div'); const spk = h('div');
    const fillDevices = async () => {
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const opt = (kind) => [['default', 'По умолчанию'], ...devs.filter((d) => d.kind === kind && d.deviceId !== 'default').map((d) => [d.deviceId, d.label || 'Устройство'])];
      mic.replaceChildren(select(opt('audioinput'), S.settings.micId, (v) => { S.settings.micId = v; saveSettings(); }));
      spk.replaceChildren(select(opt('audiooutput'), S.settings.speakerId, (v) => { S.settings.speakerId = v; saveSettings(); }));
    };
    fillDevices();
    const profile = S.settings.voiceProfile;
    const radios = [['isolation', 'Изоляция голоса', 'Убирает шум и эхо, выравнивает громкость'], ['studio', 'Студия', 'Чистый звук без обработки'], ['custom', 'Пользовательский', 'Выберите обработку вручную']];
    return h('div', null, h('h2', null, 'Голос и видео'),
      h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Микрофон', mic)), h('div', { class: 'grow' }, field('Динамик', spk))),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: async () => {
        try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); await fillDevices(); } catch (e) { C.toast('Нет доступа к микрофону'); }
      } }, 'Разрешить доступ и обновить список')),
      h('label', { class: 'lbl' }, 'Профиль ввода'),
      ...radios.map(([id, label, hint]) => {
        const r = h('input', { type: 'radio', name: 'vp', checked: profile === id });
        r.addEventListener('change', () => { S.settings.voiceProfile = id; saveSettings(); redraw(); });
        return h('label', { class: 'list-item', style: { cursor: 'pointer' } }, r, h('div', { class: 'info' }, h('div', null, label), h('div', { class: 'sub' }, hint)));
      }),
      profile === 'custom' ? h('div', null,
        switchRow('Подавление эха', S.settings.echo, (v) => { S.settings.echo = v; saveSettings(); }),
        switchRow('Шумоподавление', S.settings.noise, (v) => { S.settings.noise = v; saveSettings(); }),
        switchRow('Автоматическая громкость', S.settings.agc, (v) => { S.settings.agc = v; saveSettings(); })) : null,
      h('label', { class: 'lbl' }, `Качество звука: ${S.settings.audioKbps} кбит/с, стерео Opus`),
      (() => {
        const r = h('input', { type: 'range', min: 32, max: 510, step: 2, value: S.settings.audioKbps });
        r.addEventListener('input', () => { S.settings.audioKbps = Number(r.value); saveSettings(); r.previousSibling.textContent = `Качество звука: ${r.value} кбит/с, стерео Opus`; });
        return r;
      })(),
      h('div', { class: 'hint' }, 'Применяется при следующем входе в голосовой канал. 128 — отлично для голоса, 256 и выше — для музыки.'));
  }

  function sectionStream() {
    return h('div', null, h('h2', null, 'Стриминг'),
      field('Разрешение', select([[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']], S.settings.screenRes, (v) => { S.settings.screenRes = Number(v); saveSettings(); })),
      field('Кадров в секунду', select([[15, '15'], [30, '30'], [60, '60'], [120, '120']], S.settings.screenFps, (v) => { S.settings.screenFps = Number(v); saveSettings(); })),
      field('Битрейт', select([[3, '3 Мбит/с'], [6, '6 Мбит/с'], [8, '8 Мбит/с'], [12, '12 Мбит/с'], [20, '20 Мбит/с'], [40, '40 Мбит/с']], S.settings.screenMbps, (v) => { S.settings.screenMbps = Number(v); saveSettings(); }),
        'Выше битрейт — лучше картинка, но нужна быстрая сеть. В локальной сети хватает и 40.'),
      field('Что важнее', select([['detail', 'Чёткость (текст, интерфейсы)'], ['fps', 'Плавность (игры)']], S.settings.screenPrefer, (v) => { S.settings.screenPrefer = v; saveSettings(); })),
      switchRow('Передавать звук экрана', S.settings.screenAudio, (v) => { S.settings.screenAudio = v; saveSettings(); }, 'Работает на Windows: звук системы целиком.'));
  }

  function sectionLook(redraw) {
    const color = h('input', { type: 'color', value: S.settings.accent });
    color.addEventListener('input', () => { S.settings.accent = color.value; C.applyAccent(color.value); saveSettings(); });
    const power = h('input', { type: 'range', min: 0, max: 100, step: 1, value: S.settings.glowPower });
    power.addEventListener('input', () => { S.settings.glowPower = Number(power.value); saveSettings(); });
    return h('div', null, h('h2', null, 'Внешний вид'), h('label', { class: 'lbl' }, 'Цвет интерфейса'),
      h('div', { class: 'row wrap' }, color, ...ACCENTS.map((c) => h('button', { class: 'rail-btn', style: { background: c, width: '28px', height: '28px' }, title: c,
        onclick: () => { S.settings.accent = c; C.applyAccent(c); saveSettings(); redraw(); } }))),
      switchRow('Свечение за курсором', S.settings.cursorGlow, (v) => { S.settings.cursorGlow = v; saveSettings(); }, 'Мягкий градиент плавно следует за мышью.'),
      h('label', { class: 'lbl' }, 'Яркость свечения'), power,
      switchRow('Анимации интерфейса', S.settings.animations, (v) => { S.settings.animations = v; saveSettings(); applyAnimations(); }, 'Плавные появления, наведения и пульсации.'),
      h('label', { class: 'lbl' }, 'CSS-темы'),
      h('div', { class: 'hint' }, 'Как в Vencord: положите .css файл в папку тем, включите здесь. Тема может менять переменные цвета или любые стили.'),
      h('div', { class: 'row', style: { margin: '10px 0' } },
        h('button', { class: 'btn', onclick: () => native.openFolder('themes') }, 'Открыть папку тем'),
        h('button', { class: 'btn', onclick: async () => { await C.themes.refresh(); redraw(); } }, 'Обновить')),
      ...(C.themes.list.length ? C.themes.list.map((t) => {
        const on = C.store.get('themes.active', []).includes(t.id);
        return h('div', { class: 'list-item' }, h('div', { class: 'info' }, h('div', null, t.name), h('div', { class: 'sub' }, t.description || t.id)),
          switchRow('', on, (v) => C.themes.toggle(t.id, v)).firstChild);
      }) : [h('div', { class: 'hint' }, 'Тем пока нет.')]));
  }

  function sectionPlugins(redraw) {
    return h('div', null, h('h2', null, 'Плагины'),
      h('div', { class: 'banner-warn' }, 'Плагин — это код с полным доступом к приложению. Включайте только те, которым доверяете.'),
      h('div', { class: 'row', style: { marginBottom: '12px' } },
        h('button', { class: 'btn', onclick: () => native.openFolder('plugins') }, 'Открыть папку плагинов'),
        h('button', { class: 'btn', onclick: async () => { await C.plugins.refresh(); redraw(); } }, 'Обновить')),
      ...(C.plugins.plugins.length ? C.plugins.plugins.map((p) => {
        const sw = h('input', { type: 'checkbox', class: 'switch', checked: p.enabled });
        sw.addEventListener('change', async () => { await C.plugins.toggle(p.info.id, sw.checked); redraw(); });
        return h('div', { class: 'list-item' }, h('div', { class: 'info' }, h('div', null, `${p.info.name} ${p.info.version}`),
          h('div', { class: 'sub' }, p.info.description + (p.info.author ? ' — ' + p.info.author : '')), p.error ? h('div', { class: 'err' }, 'Ошибка: ' + p.error) : null), sw);
      }) : [h('div', { class: 'hint' }, 'Плагинов нет.')]));
  }

  function sectionActivity() {
    return h('div', null, h('h2', null, 'Игры и активность'),
      h('div', { class: 'hint' }, 'Приложение слушает статусы Discord RPC на локальных каналах discord-ipc-N и сообщает друзьям, во что вы играете. Если настоящий Discord запущен, он занимает канал 0, и большинство игр говорят только с ним.'),
      h('div', { class: 'list-item', style: { marginTop: '14px' } }, h('div', { class: 'info' }, h('div', null, 'Сейчас'), h('div', { class: 'sub' }, S.activity ? activityLine(S.activity) : 'ничего не играет'))),
      switchRow('Узнавать название игры у Discord', S.settings.resolveNames, (v) => { S.settings.resolveNames = v; saveSettings(); native.presenceConfig({ resolveNames: v }); },
        'Игра присылает только числовой ID. Чтобы показать название, запрашивается публичная страница приложения на discord.com, при этом Discord видит ваш IP. Выключите — будет «Игра».'),
      h('div', { class: 'hint' }, 'Игры без Rich Presence определяются по запущенному процессу. Свои игры можно добавить в файл games.json в папке данных приложения: {"game.exe": "Название"}.'));
  }

  function sectionNotify() {
    return h('div', null, h('h2', null, 'Уведомления'),
      h('div', { class: 'hint' }, 'Всплывающие окна в правом нижнем углу, как в Steam. Нажмите на окно, чтобы открыть профиль.'),
      switchRow('Когда кто-то начинает играть', S.settings.notifyPlaying, (v) => { S.settings.notifyPlaying = v; saveSettings(); }),
      switchRow('Когда кто-то заходит в сеть или выключает невидимку', S.settings.notifyOnline, (v) => { S.settings.notifyOnline = v; saveSettings(); }),
      switchRow('Звук', S.settings.notifySound, (v) => { S.settings.notifySound = v; saveSettings(); }),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => showPresenceNote({ ...S.profile, sid: '', status: 'online', activity: { name: 'Rust' } }, 'playing') }, 'Показать «играет»'),
        h('button', { class: 'btn', onclick: () => showPresenceNote({ ...S.profile, sid: '', status: 'online', activity: null }, 'online') }, 'Показать «в сети»')));
  }

  function sectionSecurity() {
    const own = h('div', { class: 'hint', style: { wordBreak: 'break-all', userSelect: 'all' } }, '…');
    const pinsBox = h('div');
    const fill = async () => {
      try { own.textContent = (await native.tlsSelf()).fingerprint; } catch (e) { own.textContent = 'недоступно'; }
      const pins = await native.tlsPins().catch(() => []);
      pinsBox.replaceChildren(...(pins.length ? pins.map((p) => h('div', { class: 'list-item' },
        h('div', { class: 'info' }, h('div', null, p.host), h('div', { class: 'sub', style: { wordBreak: 'break-all' } }, p.fingerprint)),
        h('button', { class: 'btn', onclick: async () => { await native.tlsForget(p.host); fill(); } }, 'Забыть'))) :
        [h('div', { class: 'hint' }, 'Пока вы не подключались к чужим серверам.')]));
    };
    fill();
    const li = (t) => h('div', { class: 'hint', style: { margin: '6px 0' } }, '• ' + t);
    return h('div', null, h('h2', null, 'Безопасность'),
      li('Весь обмен с комнатой шифруется (TLS). Подслушать переписку по пути нельзя.'),
      li('Сертификат сервера запоминается при первом входе. Если он изменится, соединение блокируется, и вы увидите предупреждение: так ловится подмена сервера.'),
      li('Пароль сети не отправляется: сервер проверяет ответ на случайный вызов. Повторить подслушанный ответ нельзя. После пяти ошибок адрес блокируется на минуту.'),
      li('Картинки и ссылки грузятся только с проверенных сайтов, редиректы на чужие адреса блокируются, поэтому ваш IP не утекает.'),
      li('Владелец комнаты может исключить или заблокировать участника. Сервер ограничивает число соединений и скорость сообщений.'),
      li('Плагин — это код. Если файлы плагина изменятся после включения, он автоматически отключится.'),
      h('label', { class: 'lbl' }, 'Отпечаток вашего сервера'), own,
      h('div', { class: 'hint' }, 'Сверьте его с другом другим способом (в личной беседе), если хотите быть уверены, что подключаетесь именно к вам.'),
      h('label', { class: 'lbl' }, 'Запомненные серверы'), pinsBox);
  }

  function sectionNetwork() {
    const stun = h('input', { class: 'input', value: S.settings.stun, placeholder: 'stun:stun.l.google.com:19302' });
    stun.addEventListener('change', () => { S.settings.stun = stun.value.trim(); saveSettings(); });
    return h('div', null, h('h2', null, 'Сеть'),
      field('STUN-сервер для голоса через интернет', stun, 'Пусто — голос работает в локальной сети и по общим сетям (VPN). Адрес STUN помогает соединиться через роутеры, но этот сервис увидит ваш IP.'));
  }

  function sectionBackup() {
    const file = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
    file.addEventListener('change', async () => {
      try { store.load(JSON.parse(await file.files[0].text())); C.toast('Готово. Перезапустите приложение.'); } catch (e) { C.toast('Не удалось прочитать файл'); }
    });
    return h('div', null, h('h2', null, 'Резервная копия'),
      h('div', { class: 'hint' }, 'Профиль, настройки, стикеры и список комнат хранятся только на этом компьютере. Сервера-облака нет, поэтому копию делаете вы.'),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onclick: () => {
          const data = store.dump();
          delete data.uid;
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'corsa-mess-backup.json' });
          document.body.append(a); a.click(); a.remove();
        } }, 'Сохранить копию'),
        h('button', { class: 'btn', onclick: () => file.click() }, 'Загрузить копию'), file));
  }

  // Настройки комнаты: только для владельца (того, кто запустил сервер).
  function sectionRoom() {
    const room = S.conn.room;
    const draft = { banner: room.banner || '' };
    const name = h('input', { class: 'input', value: room.name, maxLength: 40 });
    const preview = h('div', { class: 'side-title room-header' });
    const update = () => {
      const safe = C.safeUrl(draft.banner);
      preview.className = 'side-title room-header' + (safe ? ' has-banner' : '');
      preview.style.backgroundImage = safe && !/\.(mp4|webm)(\?|$)/i.test(safe) ? `url("${safe}")` : '';
      preview.replaceChildren(h('span', { class: 'room-name' }, name.value.trim() || room.name));
    };
    name.addEventListener('input', update);
    update();
    return h('div', null, h('h2', null, 'Комната'),
      h('div', { class: 'hint' }, 'Название и баннер видят все участники. Менять их можете только вы.'),
      field('Название', name), urlField('Баннер (ссылка)', 'banner', draft, 'Картинка над списком каналов. Лучше широкая, например 600×240.', update),
      h('label', { class: 'lbl' }, 'Предпросмотр'), h('div', { style: { width: '262px', borderRadius: '12px', overflow: 'hidden' } }, preview),
      h('div', { class: 'row', style: { marginTop: '20px' } }, h('button', { class: 'btn primary', onclick: () => {
        S.conn.send({ t: 'room-set', name: name.value.trim(), banner: C.safeUrl(draft.banner) || null });
        C.toast('Комната обновлена');
      } }, 'Сохранить')));
  }

  // Управление библиотекой: категории, стикеры, эмодзи, экспорт и импорт JSON.
  function sectionStickers(redraw) {
    const lib = C.stickerLib;
    if (!lib.cat(S.mgrCat)) S.mgrCat = lib.categories[0] ? lib.categories[0].id : null;
    const cat = lib.cat(S.mgrCat);
    const attempt = (fn) => { try { fn(); redraw(); } catch (e) { C.toast(e.message); } };
    const save = async (files, okText) => {
      if (!files.length) { C.toast('Нечего экспортировать'); return; }
      try {
        const r = await native.exportFiles(files);
        if (r.saved) C.toast(okText(r));
      } catch (e) { C.toast('Не удалось сохранить: ' + e.message); }
    };
    const json = (obj) => JSON.stringify(obj, null, 2);

    const newName = h('input', { class: 'input', placeholder: 'Название новой категории', maxLength: 40 });
    const addCat = () => attempt(() => { S.mgrCat = lib.addCategory(newName.value).id; });
    newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCat(); });

    const head = h('div', null, h('h2', null, 'Стикеры и эмодзи'),
      h('div', { class: 'hint' }, `Всего в библиотеке: ${lib.total()}. Хранятся только ссылки на проверенные сайты. Эмодзи вставляются в чат как :имя:.`),
      h('div', { class: 'row wrap', style: { margin: '14px 0' } },
        h('button', { class: 'btn primary', onclick: () => save([{ name: 'corsa-stickers', text: json(lib.exportAll()) }], (r) => `Сохранено в ${r.where}`) }, 'Экспорт всего в один файл'),
        h('button', { class: 'btn', onclick: () => save(lib.categories.map((c) => ({ name: c.name, text: json(lib.exportObject([c])) })), (r) => `Сохранено файлов: ${r.saved}`) }, 'Экспорт: файл на категорию'),
        h('button', { class: 'btn', onclick: async () => {
          let files;
          try { files = await native.importFiles(); } catch (e) { C.toast('Не удалось открыть файлы'); return; }
          const total = { categories: 0, items: 0, skipped: 0 };
          let bad = 0;
          for (const f of files) {
            try {
              if (f.error) throw new Error(f.error);
              const r = lib.importData(JSON.parse(f.text));
              total.categories += r.categories; total.items += r.items; total.skipped += r.skipped;
            } catch (e) { bad++; }
          }
          if (files.length) C.toast(`Импорт: категорий ${total.categories}, элементов ${total.items}, пропущено ${total.skipped}${bad ? `, неверных файлов ${bad}` : ''}`);
          redraw();
        } }, 'Импорт из файлов')));

    const catRow = h('div', { class: 'chips', style: { marginBottom: '10px' } }, lib.categories.map((c) =>
      h('div', { class: 'chip' + (cat && c.id === cat.id ? ' on' : ''), onclick: () => { S.mgrCat = c.id; redraw(); } }, `${c.name} · ${c.items.length}`)));

    const parts = [head, h('label', { class: 'lbl' }, 'Категории'), catRow,
      h('div', { class: 'row' }, newName, h('button', { class: 'btn', onclick: addCat }, 'Добавить категорию'))];

    if (cat) {
      const rename = h('input', { class: 'input', value: cat.name, maxLength: 40 });
      rename.addEventListener('change', () => attempt(() => lib.renameCategory(cat.id, rename.value)));
      const type = select([['sticker', 'Стикер'], ['emoji', 'Эмодзи']], 'sticker', () => {});
      const nm = h('input', { class: 'input', placeholder: 'Имя (для эмодзи — латиницей)', style: { maxWidth: '200px' } });
      const url = h('input', { class: 'input', placeholder: 'https://i.imgur.com/…' });
      const addItem = () => attempt(() => { lib.addItem(cat.id, { type: type.value, name: nm.value, url: url.value }); });
      url.addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });
      const others = lib.categories.filter((c) => c.id !== cat.id);
      parts.push(
        h('label', { class: 'lbl' }, 'Выбранная категория'),
        h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, rename),
          h('button', { class: 'icon-btn', title: 'Выше', onclick: () => attempt(() => lib.moveCategory(cat.id, -1)) }, '↑'),
          h('button', { class: 'icon-btn', title: 'Ниже', onclick: () => attempt(() => lib.moveCategory(cat.id, 1)) }, '↓'),
          h('button', { class: 'btn', onclick: () => save([{ name: cat.name, text: json(lib.exportCategory(cat.id)) }], (r) => `Сохранено в ${r.where}`) }, 'Экспорт категории'),
          h('button', { class: 'btn danger', onclick: () => { if (confirm(`Удалить категорию «${cat.name}» вместе с содержимым?`)) attempt(() => lib.deleteCategory(cat.id)); } }, 'Удалить')),
        h('label', { class: 'lbl' }, 'Добавить по ссылке'),
        h('div', { class: 'row wrap' }, type, nm, h('div', { class: 'grow' }, url), h('button', { class: 'btn primary', onclick: addItem }, 'Добавить')),
        h('label', { class: 'lbl' }, `Содержимое — ${cat.items.length}`),
        h('div', { class: 'mgr-grid' }, cat.items.length ? cat.items.map((item) =>
          h('div', { class: 'mgr-item' },
            h('div', { class: 'thumb' }, C.media(item.url, '')),
            h('div', { class: 'nm2', title: item.url }, (item.type === 'emoji' ? ':' + item.name + ':' : item.name) || '(без имени)'),
            h('div', { class: 'row' },
              others.length ? select([['', 'Перенести…'], ...others.map((c) => [c.id, c.name])], '', (to) => { if (to) attempt(() => lib.moveItem(cat.id, item.id, to)); }) : null,
              h('button', { class: 'icon-btn', title: 'Удалить', onclick: () => attempt(() => lib.removeItem(cat.id, item.id)) }, '✕')))) :
          [h('div', { class: 'hint' }, 'Пока пусто. Добавьте стикер или эмодзи по ссылке.')]));
    }
    return h('div', null, ...parts);
  }

  function openSettings(start = 'profile') {
    const sections = [...(S.conn && S.conn.owner ? [['room', 'Комната', sectionRoom]] : []), ['profile', 'Мой профиль', sectionProfile], ['voice', 'Голос и видео', sectionVoice], ['stream', 'Стриминг', sectionStream],
      ['look', 'Внешний вид', sectionLook], ['stickers', 'Стикеры и эмодзи', sectionStickers], ['plugins', 'Плагины', sectionPlugins], ['activity', 'Игры и активность', sectionActivity], ['notify', 'Уведомления', sectionNotify], ['security', 'Безопасность', sectionSecurity],
      ['network', 'Сеть', sectionNetwork], ['backup', 'Резервная копия', sectionBackup]];
    let current = start;
    const nav = h('div', { class: 'settings-nav' });
    const body = h('div', { class: 'settings-body' });
    const draw = () => {
      nav.replaceChildren(h('div', { class: 'group-label' }, 'Настройки'), ...sections.map(([id, label]) =>
        h('div', { class: 'nav' + (id === current ? ' on' : ''), onclick: () => { current = id; draw(); } }, label)),
      h('div', { style: { padding: '14px 12px' } }, h('button', { class: 'btn', onclick: () => { dlg.close(); disconnect(); } }, S.conn ? 'Отключиться от комнаты' : 'Закрыть')));
      const fn = sections.find((s) => s[0] === current)[2];
      body.replaceChildren(fn(draw));
    };
    const dlg = modal(h('div', { style: { display: 'flex', width: '100%', minHeight: 0 } }, nav, body), { wide: true });
    draw();
  }

  const applyAnimations = () => document.body.classList.toggle('no-anim', !S.settings.animations);

  // ---------- Старт ----------
  async function start() {
    C.stickerLib.load();
    C.applyAccent(S.settings.accent);
    C.startCursorGlow(() => S.settings.cursorGlow, () => S.settings.glowPower);
    applyAnimations();
    const app = document.getElementById('app');
    el.rail = h('div', { class: 'rail' });
    el.side = h('div', { class: 'side' });
    el.main = h('div', { class: 'main' });
    el.right = h('div', { class: 'right' });
    app.append(el.rail, el.side, el.main, el.right);
    renderAll();
    native.presenceConfig({ resolveNames: S.settings.resolveNames });
    await C.themes.refresh();
    await C.plugins.refresh();
    const pushActivity = (a) => {
      S.activity = a;
      renderUserbar();
      if (S.conn) S.conn.send({ t: 'activity', activity: a ? { name: a.name, details: a.details, state: a.state, startedAt: a.startedAt } : null });
    };
    native.onPresence(pushActivity);
    native.onTls((ev) => {
      if (ev.kind === 'mismatch') {
        modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0, color: 'var(--warn)' } }, '⚠ Сертификат сервера изменился'),
          h('div', null, `Сервер ${ev.host} раньше представлялся по-другому. Соединение заблокировано: это может быть подмена сервера.`),
          h('label', { class: 'lbl' }, 'Запомненный отпечаток'), h('div', { class: 'hint', style: { wordBreak: 'break-all' } }, ev.expected),
          h('label', { class: 'lbl' }, 'Сейчас'), h('div', { class: 'hint', style: { wordBreak: 'break-all' } }, ev.fingerprint),
          h('div', { class: 'hint', style: { marginTop: '12px' } }, 'Если владелец комнаты переустанавливал приложение, спросите у него новый отпечаток. Если всё верно, забудьте старый в Настройки → Безопасность и подключитесь снова.')));
      } else if (ev.kind === 'new') {
        C.toast(`Сервер ${ev.host} запомнен. Отпечаток: ${ev.fingerprint.slice(0, 23)}…`);
      }
    });
    S.activity = await native.presenceNow();
    renderUserbar();
  }

  start();
})();
