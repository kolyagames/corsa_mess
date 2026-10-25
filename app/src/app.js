(function () {
  const C = window.Corsa;
  const { h, store } = C;
  const native = window.corsaNative;
  const Allow = window.CorsaAllowlist;

  const DEFAULTS = {
    accent: '#ff2a44', voiceProfile: 'isolation', echo: true, noise: true, agc: true, micId: 'default', speakerId: 'default',
    audioKbps: 128, screenRes: 1080, screenFps: 60, screenMbps: 8, screenPrefer: 'detail', screenAudio: true, stun: '', resolveNames: true, cursorGlow: true, glowPower: 55, animations: true,
    notifyPlaying: true, notifyOnline: true, notifySound: true, notifyMessages: 'mentions', notifyDm: true, notifyPreview: true,
    // Голос: шумовой порог (null — выключен) и глобальные клавиши
    gateDb: null, hotkeysGlobal: false, hotMute: 'Control+Shift+M', hotDeafen: 'Control+Shift+D',
    // Запуск и фон, обновления
    closeToTray: true, autostart: false, autoJoin: true, autoHost: false, checkUpdates: true,
    // Вид приложения
    design: 'neon', mode: 'dark', font: 'design', fontSize: 14, round: null, density: 'cozy', msgStyle: 'list', avatarShape: 'circle',
    appBg: '', appBgDim: 55, appBgBlur: 0, showMembers: true, clock24: true, quickCss: '', groupMessages: true, gifHover: false,
    // Сеть
    lanVisible: true, lanScan: true, autoReconnect: true, lanBoost: true, lanScreenMbps: 40, autoIdle: true,
    internetVoice: true, turnUrl: '', turnUser: '', turnPass: '', bridgeRelay: 'bore.pub',
    // Цвета из аватарки
    autoColor: true, autoGradient: true, autoColorOthers: true,
  };
  // Дизайны: свои названия и цвета, без чужих логотипов и фирменных шрифтов.
  const DESIGNS = [
    ['neon', 'Неон', 'Красный неон, свечение за курсором', '#ff2a44', 'dark'],
    ['clay', 'Глина', 'Тёплая бумага, засечки, спокойные цвета', '#c8693f', 'light'],
    ['expressive', 'Экспрессив', 'Крупные формы, тона от акцента, пружинные анимации', '#7c5cff', 'dark'],
    ['glass', 'Стекло', 'Полупрозрачные панели с размытием, крупные заголовки', '#3b82f6', 'light'],
  ];
  const FRAMES = [['none', 'Нет'], ['neon', 'Неон'], ['gradient', 'Градиент'], ['rainbow', 'Радуга'], ['pulse', 'Пульс'], ['aura', 'Аура'], ['orbit', 'Орбита'], ['double', 'Двойная']];
  const NAME_FX = [['none', 'Обычное'], ['glow', 'Свечение'], ['gradient', 'Градиент'], ['rainbow', 'Радуга'], ['shine', 'Блеск'], ['glitch', 'Глитч'], ['flicker', 'Мерцание']];
  const NAME_FONTS = [['default', 'Обычный'], ['serif', 'С засечками'], ['mono', 'Моноширинный'], ['script', 'Рукописный'], ['heavy', 'Жирный'], ['wide', 'Разрядка']];
  const EFFECTS = [['none', 'Нет'], ['snow', 'Снег'], ['sparkles', 'Искры'], ['hearts', 'Сердца'], ['embers', 'Угольки'], ['stars', 'Звёзды'], ['sakura', 'Сакура'], ['bubbles', 'Пузыри']];
  const PLATES = [['none', 'Нет'], ['aurora', 'Сияние'], ['sunset', 'Закат'], ['ocean', 'Океан'], ['void', 'Пустота'], ['grid', 'Сетка'], ['candy', 'Конфета'], ['forest', 'Лес']];
  const CARD_STYLES = [['default', 'Обычная'], ['glass', 'Стекло'], ['solid', 'Сплошная'], ['outline', 'Контур']];
  const BADGES = {
    early: ['{{ic:sprout}}', 'Ранний'], gamer: ['{{ic:gamepad}}', 'Игрок'], music: ['{{ic:note}}', 'Меломан'], dev: ['{{ic:code}}', 'Разработчик'], artist: ['{{ic:palette}}', 'Художник'], night: ['{{ic:moon}}', 'Сова'],
    streamer: ['{{ic:tv}}', 'Стример'], cat: ['{{ic:cat}}', 'Котик'], heart: ['{{ic:heart}}', 'Добряк'], star: ['{{ic:star}}', 'Звезда'], bolt: ['{{ic:bolt}}', 'Быстрый'], skull: ['{{ic:skull}}', 'Жуть'],
  };
  const STATUSES = [['online', '{{ic:st-online}}', 'В сети'], ['idle', '{{ic:moon}}', 'Не на месте'], ['dnd', '{{ic:st-dnd}}', 'Не беспокоить'], ['invisible', '{{ic:st-off}}', 'Невидимка']];
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '💯', '😎', '🙏', '✅'];
  const PROFILE_DEFAULTS = {
    name: 'Игрок', bio: '', avatar: '', banner: '', bg: '', color: '', frame: 'none', nameFx: 'none', tag: '', custom: '', pronouns: '',
    frameUrl: '', cardFrame: '', color2: '', nameColor: '', nameColor2: '', nameFont: 'default', effect: 'none', plate: 'none', plateUrl: '',
    cardStyle: 'default', badges: [], links: [],
  };
  const ACCENTS = ['#ff2a44', '#ff7a1a', '#ffc21a', '#2adf7a', '#2ab8ff', '#3b82f6', '#7c5cff', '#ff3ad1', '#c8693f'];
  const HEX = /^#[0-9a-f]{6}$/i;

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
    detected: null, music: null, activityOverride: null, shareActivity: store.get('shareActivity', true), accentOverride: null,
    typing: new Map(), replyTo: null, editing: null, lan: [], idle: false, watching: null, reconnect: null,
    dms: {}, dmUnread: {}, mentions: {}, blocked: new Set(),
  };

  const saveProfile = () => store.set('profile', S.profile);
  const saveSettings = () => store.set('settings', S.settings);

  // ---------- Вспомогательное ----------
  // Поля профиля, которые уходят на сервер и видны остальным.
  function profileFields(p) {
    const col = (v) => (HEX.test(v || '') ? v : null);
    return {
      name: p.name, bio: p.bio, avatar: C.safeUrl(p.avatar), banner: C.safeUrl(p.banner), bg: C.safeUrl(p.bg),
      color: col(p.color), frame: p.frame, nameFx: p.nameFx, tag: p.tag, custom: p.custom, pronouns: p.pronouns,
      frameUrl: C.safeUrl(p.frameUrl), cardFrame: C.safeUrl(p.cardFrame),
      color2: col(p.color2), nameColor: col(p.nameColor), nameColor2: col(p.nameColor2), nameFont: p.nameFont, effect: p.effect,
      plate: p.plate, plateUrl: C.safeUrl(p.plateUrl), cardStyle: p.cardStyle, badges: p.badges || [], links: p.links || [],
    };
  }

  // Имя с эффектом, цветом, шрифтом и тегом. В узких местах теги можно не показывать.
  function nameEl(u, { tag = true, cls = '' } = {}) {
    const fx = u.nameFx && u.nameFx !== 'none' ? ' fx-' + u.nameFx : '';
    const font = u.nameFont && u.nameFont !== 'default' ? ' nf-' + u.nameFont : '';
    let style = {};
    let grad = '';
    if (!fx) {
      if (HEX.test(u.nameColor || '') && HEX.test(u.nameColor2 || '')) { style = { backgroundImage: `linear-gradient(90deg, ${u.nameColor}, ${u.nameColor2})` }; grad = ' name-grad'; }
      else if (HEX.test(u.nameColor || '')) style = { color: u.nameColor };
      else if (HEX.test(u.color || '')) style = { color: u.color };
    }
    return h('span', { class: cls }, h('span', { class: 'who-name' + fx + font + grad, style, dataset: { text: u.name || '' } }, u.name),
      tag && u.tag ? h('span', { class: 'tag' }, u.tag) : null);
  }

  const dotClass = (s) => 'dot ' + (['online', 'idle', 'dnd'].includes(s) ? s : '');

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
    if (status) el.append(h('span', { class: dotClass(status) }));
    return el;
  }

  const isVideoUrl = (u) => /\.(mp4|webm)(\?|$)/i.test(u || '');
  function bgStyle(url) {
    const safe = C.safeUrl(url);
    return safe && !isVideoUrl(safe) ? { backgroundImage: `url("${safe}")` } : {};
  }

  function activityLine(a) {
    if (!a) return null;
    const parts = [a.details, a.state].filter(Boolean).join(' · ');
    const since = a.startedAt && a.kind !== 'music' ? ' — ' + C.fmtElapsed(a.startedAt) : '';
    return h('span', null, a.kind === 'music' ? '{{ic:note}} ' : '', h('b', null, a.name), parts ? ' · ' + parts : '', since);
  }

  const statusLabel = (m) => ({ online: 'В сети', idle: 'Не на месте', dnd: 'Не беспокоить' }[m.status] || 'Не в сети');
  const isOn = (m) => ['online', 'idle', 'dnd'].includes(m.status);
  const fmtTime = (ts) => {
    if (S.settings.clock24) return C.fmtTime(ts);
    const d = new Date(ts);
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? 'сегодня в ' + t : d.toLocaleDateString('ru-RU') + ' ' + t;
  };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); C.toast('Скопировано'); } catch (e) { C.toast('Не удалось скопировать'); }
  }

  const el = {};
  function modal(content, { wide = false, onClose, cls = '' } = {}) {
    // Всплывающие панели (реакции, звуки, закрепы) не должны оставаться поверх окна.
    document.querySelectorAll('.rx-pop, .sb-pop, .head-pop, .ctx-menu').forEach((x) => x.remove());
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '') },
      h('button', { class: 'icon-btn close', title: 'Закрыть', onclick: () => close() }, '{{ic:close}}'), content);
    overlay.append(box);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    function close() { document.removeEventListener('keydown', onKey); overlay.remove(); if (onClose) onClose(); }
    document.body.append(overlay);
    return { close, box, overlay };
  }

  // Контекстное меню по правому клику: [{label, onclick, danger}] (null пропускается).
  let ctxMenu = null;
  function contextMenu(e, items) {
    e.preventDefault();
    if (ctxMenu) ctxMenu.remove();
    const menu = h('div', { class: 'ctx-menu' }, items.filter(Boolean).map((it) => h('div', { class: 'ctx-item' + (it.danger ? ' danger' : ''), onclick: () => { menu.remove(); ctxMenu = null; it.onclick(); } }, it.label)));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
    ctxMenu = menu;
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); ctxMenu = null; document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
  }

  // Подсказка при наведении: первая строка жирная. Строки собираются в момент наведения.
  function tooltip(node, getLines) {
    let tip = null;
    node.addEventListener('mouseenter', () => {
      const lines = getLines().filter(Boolean);
      if (!lines.length) return;
      tip = h('div', { class: 'tip' }, h('b', null, lines[0]), ...lines.slice(1).map((l) => h('div', null, l)));
      document.body.append(tip);
      const r = node.getBoundingClientRect();
      tip.style.left = r.right + 12 + 'px';
      tip.style.top = Math.max(8, Math.min(r.top + r.height / 2 - tip.offsetHeight / 2, innerHeight - tip.offsetHeight - 8)) + 'px';
    });
    node.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
    node.addEventListener('mousedown', () => { if (tip) { tip.remove(); tip = null; } });
  }

  // ---------- Активность ----------
  // Что видят друзья: своя активность (плагин) или найденная игра, иначе музыка. Можно скрыть совсем.
  function effectiveActivity() {
    if (!S.shareActivity) return null;
    const a = S.activityOverride || S.detected || S.music;
    return C.plugins.intercept('activity', a || null);
  }
  function updateActivity() {
    const a = effectiveActivity();
    const key = JSON.stringify(a);
    if (key === S.activityKey) { renderUserbar(); return; }
    S.activityKey = key;
    S.activity = a;
    renderUserbar();
    if (S.conn) S.conn.send({ t: 'activity', activity: a ? { name: a.name, details: a.details, state: a.state, startedAt: a.startedAt, image: a.image, kind: a.kind } : null });
  }

  // ---------- Подключение ----------
  // Личный секрет S.uid никому не отправляется. Каждому серверу показывается свой идентификатор, посчитанный
  // из секрета и адреса сервера: вражеский сервер не сможет использовать его на других серверах.
  async function deriveUid(host, port) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(S.uid), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${String(host).toLowerCase()}:${port}`)));
    return [...sig].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const wireStatus = () => (S.idle && S.status === 'online' ? 'idle' : S.status);
  function helloPayload(id) {
    return { uid: id, status: wireStatus(), activity: S.activity, ...profileFields(S.profile) };
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
      dlg = modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, '{{ic:lock}} Закрытая сеть'),
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
    // Сами пошли в другую комнату — старое переподключение больше не нужно.
    if (!opts.reconnecting) cancelReconnect();
    if (S.conn) await disconnect({ keepReconnect: opts.reconnecting });
    const known = S.rooms.find((r) => r.host === addr.host && r.port === addr.port);
    const password = opts.password || (known && known.pw) || (S.hosting && addr.host === '127.0.0.1' ? S.hostPassword : '') || '';
    const client = new C.RoomClient({ host: addr.host, port: addr.port, hello: helloPayload(await deriveUid(addr.host, addr.port)), password });
    try { await client.connect(); } catch (e) {
      if ((e.code === 'need-password' || e.code === 'bad-password') && attempt < 4 && !opts.reconnecting) {
        const res = await askPassword(addr, e.code === 'bad-password');
        if (!res || !res.password) return false;
        return connectTo(addr, res, attempt + 1);
      }
      if (!opts.reconnecting) C.toast('Не удалось подключиться: ' + e.message);
      return false;
    }
    S.conn = client;
    S.unread = {};
    S.typing = new Map();
    S.replyTo = null;
    // Личные сообщения и список заблокированных хранятся только у вас, отдельно для каждой комнаты.
    S.roomKey = roomCode(addr.host, addr.port);
    S.dms = store.get('dm.' + S.roomKey, {});
    S.dmUnread = {};
    S.mentions = {};
    S.blocked = new Set(store.get('blocked.' + S.roomKey, []));
    S.voice = new C.VoiceManager({ client, getSettings: () => S.settings, onChange: onVoiceChange });
    // Уведомления считаем по изменению состояния: первое состояние участников запоминаем молча.
    S.seen = new Map([...client.members.values()].map((m) => [m.sid, { status: m.status, game: m.activity ? m.activity.name : null }]));
    client.on('member', (m, prev) => {
      checkPresence(m);
      C.plugins.emit('member', m, prev);
      renderSide(); renderRight();
      if (['friends', 'voice'].includes(S.view.type)) renderMain();
    });
    client.on('left', (who) => { if (who) { S.seen.delete(who.sid); C.plugins.emit('left', who); } renderSide(); renderRight(); if (S.view.type === 'friends') renderMain(); });
    client.on('voice', () => { renderSide(); renderRight(); C.plugins.emit('voice'); });
    client.on('msg', onMessage);
    client.on('edit', onEdit);
    client.on('delete', onDelete);
    client.on('react', onReact);
    client.on('typing', onTyping);
    client.on('role', (mod) => { C.toast(mod ? 'Вас назначили модератором' : 'Вы больше не модератор'); renderAll(); });
    client.on('dm', onDm);
    client.on('pins', onPins);
    client.on('ping', () => renderPing());
    client.on('room', () => {
      // Канал, который сейчас открыт, могли удалить.
      if (S.view.channel && !client.room.channels.find((c) => c.id === S.view.channel)) S.view = firstTextView();
      renderSide(); renderMain();
    });
    client.on('error', (t) => C.toast(t));
    client.on('close', () => onConnectionLost(client, addr));
    const code = roomCode(addr.host, addr.port);
    const keepPw = opts.remember || (known && known.pw && known.pw === password) ? password : '';
    const rec = { ...(known || {}), name: client.room.name, host: addr.host, port: addr.port, code, locked: !!password, pw: keepPw, lastVisit: Date.now(), lastMembers: client.members.size };
    S.rooms = [rec, ...S.rooms.filter((r) => r.code !== code)].slice(0, 16);
    store.set('rooms', S.rooms);
    const wanted = opts.view && opts.view.channel && client.room.channels.find((c) => c.id === opts.view.channel) ? opts.view : null;
    S.view = wanted || firstTextView();
    // Файлы комнаты загружаются и показываются через главный процесс: сообщаем ему, куда мы подключены.
    native.roomBind(client.fileToken ? { host: addr.host, port: addr.port, token: client.fileToken } : null).catch(() => {});
    S.pingTimer = setInterval(() => client.send({ t: 'ping', ts: performance.now() }), 5000);
    client.send({ t: 'ping', ts: performance.now() });
    renderAll();
    C.plugins.emit('connect', client);
    return true;
  }

  function firstTextView() {
    const first = S.conn ? S.conn.room.channels.find((c) => c.type === 'text') : null;
    return first ? { type: 'text', channel: first.id } : { type: 'home' };
  }

  // Связь пропала: если это не исключение и не бан, пробуем переподключиться и вернуться в тот же канал
  // (и в тот же голосовой канал). В локальной сети это спасает от коротких обрывов Wi-Fi.
  function onConnectionLost(client, addr) {
    if (S.conn !== client) return;
    const view = S.view;
    const voiceChannel = S.voice && S.voice.channel;
    clearInterval(S.pingTimer);
    if (S.voice) S.voice.leave().catch(() => {});
    S.conn = null; S.voice = null;
    C.plugins.emit('disconnect');
    if (!S.settings.autoReconnect || client.noReconnect) {
      C.toast('Соединение с комнатой потеряно');
      S.view = { type: 'home' };
      renderAll();
      return;
    }
    const delays = [1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000];
    const state = { addr, view, voiceChannel, attempt: 0, timer: null };
    S.reconnect = state;
    const tryNow = async () => {
      if (S.reconnect !== state) return;
      state.attempt++;
      renderMain();
      const ok = await connectTo(addr, { reconnecting: true, view });
      if (S.reconnect !== state) return;
      if (ok) {
        S.reconnect = null;
        C.toast('Соединение восстановлено');
        if (voiceChannel && S.conn.room.channels.find((c) => c.id === voiceChannel)) S.voice.join(voiceChannel).catch(() => {});
        renderAll();
        return;
      }
      if (state.attempt >= delays.length) { S.reconnect = null; C.toast('Не удалось переподключиться'); S.view = { type: 'home' }; renderAll(); return; }
      state.timer = setTimeout(tryNow, delays[state.attempt]);
    };
    state.timer = setTimeout(tryNow, delays[0]);
    renderAll();
  }

  function cancelReconnect() {
    if (!S.reconnect) return;
    clearTimeout(S.reconnect.timer);
    S.reconnect = null;
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

  // kind: playing, online, listening или свой текст (line) от плагина.
  function showPresenceNote(user, kind, line, sub) {
    if (S.status === 'dnd') return;
    let box = document.getElementById('steam-toasts');
    if (!box) { box = h('div', { id: 'steam-toasts' }); document.body.append(box); }
    while (box.children.length >= 4) box.firstChild.remove();
    const text = line || (kind === 'playing' ? 'играет в' : kind === 'listening' ? 'слушает' : 'в сети');
    const game = sub != null ? sub : kind === 'playing' || kind === 'listening' ? (user.activity ? [user.activity.name, user.activity.details].filter(Boolean).join(' · ') : '') : '';
    const note = h('div', { class: 'snote', onclick: () => { note.remove(); openProfileCard(user); } },
      avatarEl(user), h('div', { class: 'stext' },
        h('div', { class: 'sname' }, nameEl(user, { tag: false })),
        h('div', { class: 'sline' }, text),
        game ? h('div', { class: 'sgame' }, game) : null));
    box.append(note);
    if (S.settings.notifySound) chime();
    setTimeout(() => { note.classList.add('out'); setTimeout(() => note.remove(), 260); }, 6000);
  }

  function checkPresence(m) {
    if (!S.conn || m.sid === S.conn.sid) return;
    const prev = S.seen.get(m.sid);
    const game = m.activity ? m.activity.name : null;
    S.seen.set(m.sid, { status: m.status, game });
    if (!isOn(m)) return;
    const startedGame = game && m.activity.kind !== 'music' && (!prev || prev.game !== game);
    const becameOnline = !prev || !['online', 'idle', 'dnd'].includes(prev.status);
    if (startedGame && S.settings.notifyPlaying) showPresenceNote(m, 'playing');
    else if (becameOnline && S.settings.notifyOnline) showPresenceNote(m, 'online');
  }

  async function disconnect({ keepReconnect } = {}) {
    if (!keepReconnect) cancelReconnect();
    clearInterval(S.pingTimer);
    if (S.voice) { try { await S.voice.leave(); } catch (e) { /* ignore */ } }
    if (S.conn) { const c = S.conn; S.conn = null; c.handlers = {}; c.close(); C.plugins.emit('disconnect'); native.roomBind(null).catch(() => {}); }
    S.voice = null;
    S.view = { type: 'home' };
    renderAll();
  }

  function onMessage(channel, msg) {
    const viewing = S.view.type === 'text' && S.view.channel === channel;
    const typers = S.typing.get(channel);
    if (typers) typers.delete(msg.sid);
    const other = msg.sid !== S.conn.sid;
    if (viewing) { appendMessage(msg, true); renderTyping(); }
    else if (other) S.unread[channel] = (S.unread[channel] || 0) + 1;
    // Сначала считаем упоминание, потом рисуем панель: так у канала сразу виден значок «@».
    if (other && !S.blocked.has(msg.uid)) notifyMessage(channel, msg, viewing);
    if (other && !viewing) renderSide();
    C.plugins.emit('message', channel, msg);
  }

  // ---------- Уведомления о сообщениях ----------
  const mutedKey = (channel) => `${S.roomKey}:${channel}`;
  const isMutedChannel = (channel) => store.get('mutedChannels', []).includes(mutedKey(channel));
  function mentionsMe(msg) {
    const name = (S.profile.name || '').toLowerCase();
    if (name && (msg.text || '').toLowerCase().includes('@' + name)) return true;
    if (msg.reply) { const orig = [...S.conn.history.values()].flat().find((x) => x.id === msg.reply.id); if (orig && orig.uid === S.conn.meId) return true; }
    return false;
  }

  function notifyMessage(channel, msg, viewing) {
    const mention = mentionsMe(msg);
    if (mention && !viewing) S.mentions[channel] = (S.mentions[channel] || 0) + 1;
    const mode = S.settings.notifyMessages;
    const wanted = mention || (mode === 'all' && !isMutedChannel(channel));
    updateTitle();
    if (!wanted || mode === 'none' || S.status === 'dnd') return;
    const ch = S.conn.room.channels.find((c) => c.id === channel);
    const body = S.settings.notifyPreview ? msgSummary(msg) : 'Новое сообщение';
    pushNotice(`${msg.name}${ch ? ' в #' + ch.name : ''}${mention ? ' — упоминание' : ''}`, body, 'ch:' + channel, viewing);
  }

  // Окно не в фокусе — уведомление Windows и мигание на панели задач, в фокусе — короткая подсказка внутри.
  function pushNotice(title, body, tag, viewing) {
    if (!document.hasFocus()) {
      native.notify({ title, body: body.slice(0, 200), tag, silent: !S.settings.notifySound }).catch(() => {});
      native.attention(true).catch(() => {});
    } else if (!viewing) {
      C.toast(`${title}: ${body.slice(0, 90)}`);
    }
  }

  // Заголовок окна: число упоминаний и непрочитанных личных сообщений, точка — если есть просто непрочитанное.
  function updateTitle() {
    const n = Object.values(S.mentions).reduce((a, b) => a + b, 0) + Object.values(S.dmUnread).reduce((a, b) => a + b, 0);
    const any = Object.values(S.unread).some((x) => x > 0);
    document.title = n ? `(${n}) corsa-mess` : any ? '• corsa-mess' : 'corsa-mess';
  }

  // ---------- Личные сообщения ----------
  // Сервер их не хранит: история лежит только у собеседников.
  let dmSaveTimer = null;
  function saveDms() {
    clearTimeout(dmSaveTimer);
    dmSaveTimer = setTimeout(() => { if (S.roomKey) store.set('dm.' + S.roomKey, S.dms); }, 400);
  }

  function onDm(msg) {
    const mine = msg.uid === S.conn.meId;
    const peer = mine ? msg.toUid : msg.uid;
    if (!mine && S.blocked.has(peer)) return;
    const member = memberByPub(peer);
    const conv = S.dms[peer] || { name: member ? member.name : msg.name, avatar: member ? member.avatar : msg.avatar, list: [] };
    if (!mine) { conv.name = msg.name; conv.avatar = msg.avatar; }
    conv.list.push(msg);
    if (conv.list.length > 200) conv.list.shift();
    conv.last = msg.ts;
    S.dms[peer] = conv;
    saveDms();
    const viewing = S.view.type === 'dm' && S.view.peer === peer;
    if (viewing) appendDm(msg, true);
    else if (!mine) S.dmUnread[peer] = (S.dmUnread[peer] || 0) + 1;
    if (!mine) {
      updateTitle();
      if (S.settings.notifyDm && S.status !== 'dnd') pushNotice(`✉ ${msg.name}`, S.settings.notifyPreview ? msgSummary(msg) : 'Личное сообщение', 'dm:' + peer, viewing);
    }
    C.plugins.emit('dm', msg);
    renderSide();
  }

  function openDm(peer) {
    if (!S.dms[peer]) {
      const m = memberByPub(peer);
      S.dms[peer] = { name: m ? m.name : 'Собеседник', avatar: m ? m.avatar : null, list: [], last: Date.now() };
      saveDms();
    }
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    S.view = { type: 'dm', peer };
    S.dmUnread[peer] = 0;
    updateTitle();
    renderAll();
    setMobilePane('main');
  }

  function toggleBlock(pub, name) {
    if (S.blocked.has(pub)) S.blocked.delete(pub);
    else { if (!confirm(`Скрыть сообщения ${name || 'этого участника'} у себя? Он об этом не узнает, личные сообщения от него не будут приходить.`)) return; S.blocked.add(pub); }
    store.set('blocked.' + S.roomKey, [...S.blocked]);
    C.toast(S.blocked.has(pub) ? 'Заблокирован у вас' : 'Разблокирован');
    renderAll();
  }

  function onPins(channel, id) {
    if (S.view.type !== 'text' || S.view.channel !== channel) return;
    const node = msgNode(id);
    const msg = (S.conn.history.get(channel) || []).find((x) => x.id === id);
    if (node && msg) node.replaceWith(messageNode(msg, channel, node.classList.contains('cont')));
    const pin = document.getElementById('pin-count');
    if (pin) pin.textContent = String((S.conn.pins.get(channel) || []).length || '');
  }

  function msgNode(id) { return document.querySelector(`#messages .msg[data-id="${CSS.escape(id)}"]`); }

  function onEdit(channel, msg, before) {
    C.plugins.emit('edit', channel, msg, before);
    const node = msgNode(msg.id);
    if (node) node.replaceWith(messageNode(msg, channel, node.classList.contains('cont')));
  }

  function onDelete(channel, id, gone, by) {
    // Плагин (например, журнал сообщений) может оставить удалённое сообщение на экране.
    const keep = C.plugins.intercept('delete', false, { channel, id, msg: gone, by });
    C.plugins.emit('delete', channel, id, gone);
    const node = msgNode(id);
    if (!node) return;
    if (keep) { node.classList.add('deleted'); const head = node.querySelector('.head'); if (head && !head.querySelector('.del-mark')) head.append(h('span', { class: 'del-mark' }, 'удалено')); }
    else node.remove();
  }

  function onReact(channel, id) {
    const node = msgNode(id);
    const msg = (S.conn.history.get(channel) || []).find((x) => x.id === id);
    if (!node || !msg) return;
    const old = node.querySelector('.reactions');
    const next = reactionsRow(msg, channel);
    if (old) old.replaceWith(next); else node.querySelector('.body').append(next);
  }

  // «Печатает…»: запись живёт 6 секунд, если не продлили.
  function onTyping(channel, sid) {
    if (!S.typing.has(channel)) S.typing.set(channel, new Map());
    S.typing.get(channel).set(sid, Date.now());
    C.plugins.emit('typing', channel, sid);
    renderTyping();
    renderSide();
    setTimeout(() => { renderTyping(); renderSide(); }, 6200);
  }

  function typersIn(channel) {
    const map = S.typing.get(channel);
    if (!map || !S.conn) return [];
    const now = Date.now();
    for (const [sid, ts] of map) if (now - ts > 6000 || !S.conn.members.has(sid)) map.delete(sid);
    return [...map.keys()].map((sid) => S.conn.members.get(sid)).filter(Boolean);
  }

  function renderTyping() {
    const bar = document.getElementById('typing');
    if (!bar || S.view.type !== 'text') return;
    const who = typersIn(S.view.channel);
    if (!who.length) { bar.replaceChildren(); bar.classList.remove('on'); return; }
    const names = who.slice(0, 3).map((m) => m.name).join(', ') + (who.length > 3 ? ` и ещё ${who.length - 3}` : '');
    bar.classList.add('on');
    bar.replaceChildren(h('span', { class: 'dots' }, h('i'), h('i'), h('i')), h('b', null, names), who.length > 1 ? ' печатают…' : ' печатает…');
  }

  function onVoiceChange(light) {
    if (light) { updateSpeaking(); updateNetStats(); return; }
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

  // Качество связи в плитках голосового канала: задержка и признак прямого соединения по локальной сети.
  function updateNetStats() {
    if (!S.voice || S.view.type !== 'voice') return;
    for (const [sid, peer] of S.voice.peers) {
      const tag = document.querySelector(`.tile[data-sid="${CSS.escape(sid)}"] .net`);
      if (!tag || !peer.stats) continue;
      const st = peer.stats;
      tag.textContent = (st.lan ? 'LAN · ' : '') + (st.rtt != null ? st.rtt + ' мс' : '');
      tag.className = 'net' + (st.lan ? ' lan' : '') + (st.rtt > 150 ? ' bad' : '');
    }
  }

  // ---------- Отправка ----------
  function sendText(text, channel, files = []) {
    const t = text.trim();
    if (!t && !files.length) return;
    if (t.startsWith('/') && !files.length) {
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
    const out = { t: 'msg', channel, text: t, emojis: C.stickerLib.usedEmojis(t) };
    if (files.length) out.files = files.map((f) => f.id);
    if (S.replyTo) out.reply = S.replyTo.id;
    S.conn.send(out);
    setReply(null);
  }

  let lastTypingSent = 0;
  function sendTyping(channel) {
    const now = Date.now();
    if (now - lastTypingSent < 2500 || !S.conn) return;
    // Плагин «Невидимый набор» запрещает отправку.
    if (C.plugins.intercept('typing', true, channel) === false) return;
    lastTypingSent = now;
    S.conn.send({ t: 'typing', channel });
  }

  // Форматирование текста: **жирный**, *курсив*, ~~зачёркнутый~~, `код`, ||спойлер||, :эмодзи:, ссылки.
  // Всё собирается из текстовых узлов, HTML из сообщения на страницу не попадает.
  const TOKEN = /(\|\|[\s\S]+?\|\|)|(\*\*[^*]+?\*\*)|(~~[^~]+?~~)|(`[^`\n]+?`)|(\*[^*\s][^*\n]*?\*)|(:[A-Za-z0-9_]{2,32}:)|(https?:\/\/[^\s<>"']+)/g;
  function inline(text, emojis, stats) {
    const out = [];
    let last = 0;
    let m;
    TOKEN.lastIndex = 0;
    const re = new RegExp(TOKEN.source, 'g');
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const s = m[0];
      if (m[1]) {
        const sp = h('span', { class: 'spoiler', title: 'Спойлер: нажмите, чтобы показать', onclick: (e) => { e.currentTarget.classList.add('open'); } }, inline(s.slice(2, -2), emojis, stats));
        out.push(sp); stats.other = true;
      } else if (m[2]) { out.push(h('b', null, inline(s.slice(2, -2), emojis, stats))); stats.other = true; }
      else if (m[3]) { out.push(h('s', null, inline(s.slice(2, -2), emojis, stats))); stats.other = true; }
      else if (m[4]) { out.push(h('code', null, s.slice(1, -1))); stats.other = true; }
      else if (m[5]) { out.push(h('i', null, inline(s.slice(1, -1), emojis, stats))); stats.other = true; }
      else if (m[6]) {
        const url = emojis && emojis[s.slice(1, -1)] ? C.safeUrl(emojis[s.slice(1, -1)]) : null;
        const img = url ? C.media(url, 'emoji') : null;
        if (img) { img.title = s; img.dataset.emoji = s.slice(1, -1); img.dataset.url = url; out.push(img); stats.emoji++; } else { out.push(s); stats.other = true; }
      } else if (m[7]) {
        // Ссылки не открываются, а копируются: так никто не узнает ваш IP через подставную ссылку.
        out.push(h('span', { class: 'link', title: 'Нажмите, чтобы скопировать ссылку', onclick: () => copy(s) }, s)); stats.other = true;
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    if (out.some((x) => typeof x === 'string' && x.trim())) stats.other = true;
    return out;
  }

  // Коротко о сообщении для уведомлений и поиска: текст, иначе вложения или стикер.
  const msgSummary = (m) => (m.text ? plainText(m.text) : m.files && m.files.length ? (m.files[0].voice ? '🎙 Голосовое сообщение' : '📎 ' + m.files.map((f) => f.name).join(', ')) : 'стикер');

  // Текст без разметки: для цитат и подсказок. Спойлер остаётся скрытым.
  const plainText = (t) => String(t || '').replace(/\|\|[\s\S]+?\|\|/g, '▒▒▒').replace(/(\*\*|~~|`|\*)/g, '');

  function richText(text, emojis) {
    const stats = { emoji: 0, other: false };
    const box = h('div', { class: 'text' }, inline(text, emojis, stats));
    if (stats.emoji && stats.emoji <= 8 && !stats.other) box.classList.add('jumbo');
    return box;
  }

  // ---------- API для плагинов ----------
  const memberByPub = (pub) => (S.conn ? [...S.conn.members.values()].find((x) => x.uid === pub) : null);
  C.plugins.appApi = {
    getState: () => ({ user: { ...S.profile }, room: S.conn ? S.conn.room : null, channel: S.view.channel || null, view: { ...S.view }, status: S.status }),
    sendMessage: (channel, text) => { if (S.conn) S.conn.send({ t: 'msg', channel, text: String(text) }); },
    rerender: () => { if (!el.rail) return; renderRail(); renderSide(); renderRight(); refreshMessages(); },
    rerenderUserbar: () => renderUserbar(),
    members: () => (S.conn ? [...S.conn.members.values()] : []),
    member: (sid) => (S.conn ? S.conn.members.get(sid) : null),
    memberByPub,
    me: () => (S.conn ? S.conn.me() : null),
    myPub: () => (S.conn ? S.conn.meId : null),
    connection: () => S.conn,
    voice: () => S.voice,
    history: (channel) => (S.conn ? S.conn.history.get(channel) || [] : []),
    channels: () => (S.conn ? S.conn.room.channels : []),
    channel: (id) => (S.conn ? S.conn.room.channels.find((c) => c.id === id) : null),
    rooms: () => S.rooms,
    hosting: () => S.hosting,
    settings: () => ({ ...S.settings }),
    openProfile: (u) => openProfileCard(u),
    openChannel: (id) => { S.view = { type: S.conn.room.channels.find((c) => c.id === id).type, channel: id }; renderAll(); },
    joinVoice: (id) => S.voice && S.voice.join(id).then(() => { S.view = { type: 'voice', channel: id }; renderAll(); }),
    connectRoom: (r) => connectTo({ host: r.host, port: r.port }),
    uploadBlob: (blob, name, opts) => uploadBlob(blob, name, opts),
    filesEnabled: () => !!(S.conn && S.conn.fileToken),
    modal, avatarEl, nameEl, copy, contextMenu, fmtTime, activityLine,
    media: C.media,
    notify: (user, line, sub) => showPresenceNote(user, 'custom', line, sub),
    setAccentOverride: (hex) => { S.accentOverride = HEX.test(hex || '') ? hex : null; applyAccentColors(); },
    setActivityOverride: (a) => { S.activityOverride = a || null; updateActivity(); },
    setMusic: (a) => { S.music = a || null; updateActivity(); },
    getActivity: () => S.activity,
    detectedActivity: () => S.detected,
    get shareActivity() { return S.shareActivity; },
    setShareActivity: (v) => { S.shareActivity = !!v; store.set('shareActivity', S.shareActivity); updateActivity(); },
    stickerLib: () => C.stickerLib,
    particles: C.particles,
    native: { mediaWatch: native.mediaWatch, mediaCommand: native.mediaCommand, onMedia: native.onMedia },
  };

  // ---------- Рендер: рельса ----------
  function renderRail() {
    const r = el.rail;
    const button = (room) => {
      const active = S.conn && S.conn.host === room.host && S.conn.port === room.port;
      const b = h('button', {
        class: 'rail-btn' + (active ? ' on' : '') + (room.pinned ? ' pinned' : ''),
        onclick: () => { if (!active) connectTo({ host: room.host, port: room.port }); },
        oncontextmenu: (e) => contextMenu(e, [
          { label: room.pinned ? '{{ic:pin}} Открепить' : '{{ic:pin}} Закрепить сверху', onclick: () => { room.pinned = !room.pinned; store.set('rooms', S.rooms); renderRail(); } },
          { label: '{{ic:copy}} Скопировать код', onclick: () => copy(room.code) },
          active ? { label: '{{ic:eject}} Отключиться', onclick: () => disconnect() } : null,
          { label: '{{ic:close}} Убрать из списка', danger: true, onclick: () => { S.rooms = S.rooms.filter((x) => x !== room); store.set('rooms', S.rooms); renderAll(); } },
        ]),
      }, (room.name || '?').charAt(0).toUpperCase());
      tooltip(b, () => [room.name, ...C.plugins.collect('roomTooltip', room)]);
      return b;
    };
    const pinned = S.rooms.filter((x) => x.pinned);
    const rest = S.rooms.filter((x) => !x.pinned);
    const home = h('button', { class: 'rail-btn logo' + (S.view.type === 'home' ? ' on' : ''), onclick: () => { S.view = { type: 'home' }; renderAll(); } }, h('img', { src: 'logo.png', alt: '' }));
    tooltip(home, () => ['Главная']);
    const plus = h('button', { class: 'rail-btn add', onclick: () => { S.view = { type: 'home' }; renderAll(); } }, '+');
    tooltip(plus, () => ['Подключиться или создать']);
    r.replaceChildren(...[home, h('div', { class: 'rail-sep' }), ...pinned.map(button), pinned.length && rest.length ? h('div', { class: 'rail-sep' }) : null,
      ...rest.map(button), plus, ...C.plugins.collect('railBottom', { rooms: S.rooms })].filter(Boolean));
  }

  // ---------- Рендер: боковая панель ----------
  function renderSide() {
    const s = el.side;
    const scroll = h('div', { class: 'side-scroll' });
    const nav = (icon, label, view, extra, ch) => {
      const node = h('div', {
        class: 'nav' + (S.view.type === view.type && S.view.channel === view.channel ? ' on' : ''),
        onclick: () => { S.view = view; if (view.channel) { S.unread[view.channel] = 0; S.mentions[view.channel] = 0; } updateTitle(); renderAll(); setMobilePane('main'); },
        oncontextmenu: ch && ch.type === 'text' ? (e) => {
          const muted = isMutedChannel(ch.id);
          contextMenu(e, [{ label: muted ? '{{ic:bell}} Снова уведомлять' : '{{ic:bell-off}} Не уведомлять (кроме упоминаний)', onclick: () => {
            const list = new Set(store.get('mutedChannels', []));
            if (muted) list.delete(mutedKey(ch.id)); else list.add(mutedKey(ch.id));
            store.set('mutedChannels', [...list]);
            renderSide();
          } }, { label: '{{ic:check}} Отметить прочитанным', onclick: () => { S.unread[ch.id] = 0; S.mentions[ch.id] = 0; updateTitle(); renderSide(); } }]);
        } : null,
      }, h('span', { class: 'nav-ic' }, icon), h('span', { class: 'nav-label' }, label), ...(ch ? C.plugins.collect('channel', { channel: ch, typing: typersIn(ch.id) }) : []),
      ch && ch.type === 'text' && isMutedChannel(ch.id) ? h('span', { class: 'muted-ic', title: 'Уведомления выключены' }, '{{ic:bell-off}}') : null, extra);
      if (ch && ch.topic) node.title = ch.topic;
      return node;
    };

    scroll.append(...C.plugins.collect('sideTop', {}));
    scroll.append(nav('{{ic:home}}', 'Главная', { type: 'home' }));
    if (S.conn) {
      scroll.append(nav('{{ic:users}}', 'Друзья', { type: 'friends' }));
      // Личные беседы: сверху самые свежие.
      const convs = Object.entries(S.dms).filter(([p]) => !S.blocked.has(p)).sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
      if (convs.length) {
        scroll.append(h('div', { class: 'group-label' }, 'Личные сообщения'));
        for (const [peer, conv] of convs.slice(0, 20)) {
          const mm = memberByPub(peer);
          const n = S.dmUnread[peer];
          scroll.append(h('div', { class: 'nav dm-nav' + (S.view.type === 'dm' && S.view.peer === peer ? ' on' : ''), onclick: () => openDm(peer) },
            avatarEl(mm || { name: conv.name, avatar: conv.avatar }, { status: mm ? mm.status : 'offline' }), h('span', { class: 'nav-label' }, mm ? mm.name : conv.name),
            n ? h('span', { class: 'badge' }, n) : null,
            h('button', { class: 'dm-x', title: 'Удалить беседу у себя', onclick: (e) => {
              e.stopPropagation();
              if (!confirm('Удалить эту беседу у себя? У собеседника она останется.')) return;
              delete S.dms[peer]; saveDms();
              if (S.view.type === 'dm' && S.view.peer === peer) S.view = firstTextView();
              renderAll();
            } }, '{{ic:close}}')));
        }
      }
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
        } }, h('span', { class: 'arrow' }, '{{ic:chevron-down}}'), h('span', null, category), closed && unread ? h('span', { class: 'badge' }, unread) : null));
        if (closed) continue;
        for (const ch of list) {
          if (ch.type === 'text') {
            const n = S.unread[ch.id];
            const at = S.mentions[ch.id];
            scroll.append(nav('#', ch.name, { type: 'text', channel: ch.id }, at ? h('span', { class: 'badge mention' }, '@' + at) : n ? h('span', { class: 'badge' }, n) : null, ch));
          } else {
            scroll.append(nav('{{ic:speaker}}', ch.name, { type: 'voice', channel: ch.id }, null, ch));
            const inside = (S.conn.voice[ch.id] || []).map((sid) => S.conn.members.get(sid)).filter(Boolean);
            if (inside.length) {
              scroll.append(h('div', { class: 'voice-members' }, inside.map((m) =>
                h('div', { class: 'voice-member', dataset: { sid: m.sid }, onclick: () => openProfileCard(m) }, avatarEl(m), nameEl(m, { tag: false }),
                  h('span', { class: 'vflags' }, m.screen ? h('span', { class: 'live' }, 'LIVE') : null, m.camera ? '{{ic:camera}}' : null, m.muted ? '{{ic:mic-off}}' : null, m.deaf ? '{{ic:headphones-off}}' : null)))));
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
      style: banner && !isVideoUrl(banner) ? { backgroundImage: `url("${banner}")` } : {},
      title: S.conn && S.conn.owner ? 'Настройки комнаты' : '',
      onclick: () => { if (S.conn && S.conn.owner) openSettings('room'); },
    }, h('span', { class: 'room-name' }, room ? room.name : 'corsa-mess'), S.conn ? h('span', { class: 'ping', id: 'ping' }) : null);
    const updateBar = S.update && S.update.newer ? h('div', { class: 'update-bar', onclick: () => openSettings('updates') }, `{{ic:arrow-up}} Доступна версия ${S.update.version}`, h('span', null, 'Обновить')) : null;
    s.replaceChildren(...[header, scroll, ...C.plugins.collect('sideBottom', {}), updateBar, h('div', { class: 'userbar', id: 'userbar' })].filter(Boolean));
    renderUserbar();
    renderPing();
    updateSpeaking();
  }

  function renderPing() {
    const p = document.getElementById('ping');
    if (!p || !S.conn) return;
    const ms = S.conn.ping;
    p.textContent = ms == null ? '' : `● ${ms} мс`;
    p.className = 'ping' + (ms == null ? '' : ms < 40 ? ' good' : ms < 150 ? ' ok' : ' bad');
    p.title = 'Задержка до сервера комнаты';
  }

  function renderUserbar() {
    const bar = document.getElementById('userbar');
    if (!bar) return;
    const v = S.voice;
    const st = STATUSES.find((x) => x[0] === wireStatus());
    let sub = S.status === 'invisible' ? 'Невидимка' : S.activity ? (S.activity.kind === 'music' ? '{{ic:note}} ' : '') + S.activity.name : st ? st[2] : 'В сети';
    sub = C.plugins.intercept('userbarSub', sub);
    bar.replaceChildren(...[
      h('div', { class: 'who', onclick: (e) => openSelfMenu(e.currentTarget), title: 'Профиль' },
        avatarEl({ ...S.profile }, { status: S.status === 'invisible' ? 'offline' : wireStatus() }),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'name' }, nameEl(S.profile, { tag: false })), h('div', { class: 'sub' }, sub))),
      ...C.plugins.collect('userbar', {}),
      v && v.inChannel ? h('button', { class: 'icon-btn' + (v.muted ? ' off' : ''), title: 'Микрофон', onclick: () => v.setMuted(!v.muted) }, v.muted ? '{{ic:mic-off}}' : '{{ic:mic}}') : null,
      v && v.inChannel ? h('button', { class: 'icon-btn' + (v.deafened ? ' off' : ''), title: 'Звук', onclick: () => v.setDeafened(!v.deafened) }, v.deafened ? '{{ic:headphones-off}}' : '{{ic:headphones}}') : null,
      h('button', { class: 'icon-btn', title: 'Настройки', onclick: () => openSettings() }, '{{ic:gear}}'),
    ].filter(Boolean));
  }

  // ---------- Рендер: правая панель ----------
  function plateStyle(u) {
    const url = C.safeUrl(u.plateUrl);
    return url && !isVideoUrl(url) ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.15)), url("${url}")` } : {};
  }

  function memberRow(m) {
    const plate = m.plateUrl ? ' plate-img' : m.plate && m.plate !== 'none' ? ' plate-' + m.plate : '';
    return h('div', { class: 'member' + (isOn(m) ? '' : ' offline') + plate, style: plateStyle(m), onclick: () => openProfileCard(m),
      oncontextmenu: (e) => contextMenu(e, memberMenu(m)) },
      avatarEl(m, { status: m.status }),
      h('div', { class: 'meta' }, h('div', { class: 'nm' }, nameEl(m), modMark(m), ...C.plugins.collect('member', { member: m })),
        m.activity ? h('div', { class: 'act' }, activityLine(m.activity)) : m.custom ? h('div', { class: 'act' }, m.custom) : null));
  }

  function memberMenu(m) {
    return [
      { label: '{{ic:user}} Профиль', onclick: () => openProfileCard(m) },
      S.conn && m.sid !== S.conn.sid ? { label: '{{ic:mail}} Написать лично', onclick: () => openDm(m.uid) } : null,
      { label: '@ Упомянуть', onclick: () => { const f = document.querySelector('.composer .field'); if (f) { f.value += `@${m.name} `; f.focus(); } } },
      S.conn && m.sid !== S.conn.sid ? { label: S.blocked.has(m.uid) ? '{{ic:check}} Разблокировать у себя' : '{{ic:block}} Скрыть у себя', onclick: () => toggleBlock(m.uid, m.name) } : null,
      S.conn && S.conn.owner && m.sid !== S.conn.sid && !m.host ? { label: m.mod ? '{{ic:shield}} Снять модератора' : '{{ic:shield}} Сделать модератором', onclick: () => S.conn.send({ t: 'mod-set', sid: m.sid, on: !m.mod }) } : null,
      canKick(m) ? { label: '{{ic:door}} Выгнать', danger: true, onclick: () => S.conn.send({ t: 'kick', sid: m.sid }) } : null,
    ];
  }

  // Исключить можно любого, кроме себя и владельца; модератор не может исключить другого модератора.
  const canKick = (m) => !!(S.conn && S.conn.mod && m.sid !== S.conn.sid && !m.host && (S.conn.owner || !m.mod));
  const modMark = (m) => (m.host ? h('span', { class: 'role-mark', title: 'Хозяин комнаты' }, C.icon('crown')) : m.mod ? h('span', { class: 'role-mark', title: 'Модератор' }, C.icon('shield')) : null);

  function renderRight() {
    const r = el.right;
    const show = S.conn && ['text', 'voice', 'friends'].includes(S.view.type) && S.settings.showMembers;
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
    const on = members.filter(isOn);
    const off = members.filter((m) => !isOn(m));
    const playing = members.filter((m) => m.activity);
    const card = (m) => h('div', { class: 'contact-card', onclick: () => openProfileCard(m) },
      h('div', { class: 'row' }, avatarEl(m, { status: m.status }), h('div', { class: 'meta' }, h('b', null, nameEl(m)), h('div', { class: 'game' }, activityLine(m.activity)))));
    r.replaceChildren(...[
      ...C.plugins.collect('memberHeader', { members }),
      playing.length ? h('h4', null, `Активность — ${playing.length}`) : null, ...playing.map(card),
      h('h4', null, `В сети — ${on.length}`), ...on.map(memberRow), off.length ? h('h4', null, `Не в сети — ${off.length}`) : null, ...off.map(memberRow),
    ].filter(Boolean));
    updateSpeaking();
  }

  // ---------- Рендер: центр ----------
  function renderMain() {
    const m = el.main;
    const t = S.view.type;
    if (S.reconnect && !S.conn) { renderReconnect(m); return; }
    if (t !== 'voice') setWatching(null);
    if (t === 'home' || !S.conn) { renderHome(m); return; }
    if (t === 'friends') renderFriends(m);
    else if (t === 'text') renderText(m);
    else if (t === 'voice') renderVoice(m);
    else if (t === 'dm') renderDm(m);
  }

  function renderReconnect(m) {
    const st = S.reconnect;
    m.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty reconnect' },
      h('div', { class: 'spinner' }), h('h3', null, 'Переподключаюсь…'),
      h('div', null, `Связь с ${st.addr.host}:${st.addr.port} пропала. Попытка ${Math.max(1, st.attempt)}.`),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => { cancelReconnect(); S.view = { type: 'home' }; renderAll(); } }, 'Отмена')))));
  }

  // На узком экране (телефон) видна только одна панель разом: список комнат и каналов ("side")
  // или открытый канал/беседа ("main"). Шире определённой ширины переключатель ничего не делает —
  // там видно всё сразу, как на столе.
  const setMobilePane = (p) => { document.body.dataset.mpane = p; };

  // Переходы между экранами идут через renderAll: именно здесь запускается анимация появления.
  function renderAll() {
    renderRail(); renderSide(); renderMain(); renderRight();
    if (el.main) { el.main.classList.remove('enter'); void el.main.offsetWidth; el.main.classList.add('enter'); }
  }

  // Главная
  let lanTimer = null;
  async function scanLan() {
    if (!S.settings.lanScan || S.view.type !== 'home') return;
    try { S.lan = await native.lanScan(); } catch (e) { S.lan = []; }
    const box = document.getElementById('lan-list');
    if (box) box.replaceChildren(...lanItems());
  }

  function lanItems() {
    if (!S.settings.lanScan) return [h('div', { class: 'hint' }, 'Поиск выключен в Настройки → Сеть.')];
    if (!S.lan.length) return [h('div', { class: 'hint' }, 'Пока никого. Комнаты друзей из той же сети (или из общей сети Radmin, ZeroTier, Hamachi) появятся здесь сами.')];
    return S.lan.map((r) => h('div', { class: 'saved lan-room' }, h('div', { class: 'lan-ic' }, '{{ic:antenna}}'),
      h('div', { class: 'grow' }, h('b', null, (r.locked ? '{{ic:lock}} ' : '') + r.name + (r.mine ? ' (ваша)' : '')),
        h('div', { class: 'hint' }, `${r.host}:${r.port} · ${r.members}${r.max ? '/' + r.max : ''} в комнате`)),
      h('button', { class: 'btn primary', onclick: () => connectTo({ host: r.mine ? '127.0.0.1' : r.host, port: r.port }) }, 'Войти')));
  }

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
          try { await startHosting({ name: roomName.value, port: Number(port.value), password: netPass.value }); } catch (e) { C.toast('Не удалось запустить сервер: ' + cleanErr(e)); }
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
      const kindLabel = { lan: 'Локальная сеть', vpn: 'VPN-сеть', other: 'Сеть' };
      const codes = (hs.codes || []).filter((c) => c.code !== hs.code);
      hostCard.append(
        h('div', { class: 'hint' }, `Сервер работает. ${hs.protected ? '{{ic:lock}} Закрыт паролем.' : '{{ic:warn}} Пароля нет: войти может любой, кто знает адрес.'} ${hs.lanVisible ? 'Комната видна друзьям в вашей сети на главной странице.' : ''} Код для друзей в той же сети:`),
        h('div', { class: 'code-box' }, hs.code || 'нет сети'),
        h('div', { class: 'row' }, hs.code ? h('button', { class: 'btn', onclick: () => copy(hs.code) }, 'Скопировать код') : null,
          h('button', { class: 'btn danger', onclick: async () => { await disconnect(); await native.hostStop(); S.hosting = null; renderMain(); } }, 'Остановить')),
        codes.length ? h('div', null, h('label', { class: 'lbl' }, 'Другие сети этого компьютера'),
          ...codes.map((c) => h('div', { class: 'saved' }, h('div', { class: 'grow' }, h('b', null, c.name), h('div', { class: 'hint' }, `${kindLabel[c.kind] || 'Сеть'} · ${c.address} · ${c.code}`)),
            h('button', { class: 'btn', onclick: () => copy(c.code) }, 'Скопировать')))) : null,
        h('label', { class: 'lbl' }, 'Отпечаток сервера'),
        h('div', { class: 'hint', style: { wordBreak: 'break-all', userSelect: 'all' } }, hs.fingerprint),
        h('div', { class: 'hint' }, 'Друзья запоминают его при первом входе. Если потом он изменится, приложение предупредит о возможной подмене.'),
        h('label', { class: 'lbl' }, 'Интернет-мост (без роутера и VPN)'),
        bridgeBlock(hs),
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
      ...S.rooms.map((r) => h('div', { class: 'saved' }, h('div', { class: 'grow' }, h('b', null, (r.pinned ? '{{ic:pin}} ' : '') + (r.locked ? '{{ic:lock}} ' : '') + r.name), h('div', { class: 'hint' }, r.code)),
        h('button', { class: 'btn', onclick: () => connectTo({ host: r.host, port: r.port }) }, 'Войти'),
        h('button', { class: 'icon-btn', title: 'Убрать', onclick: () => { S.rooms = S.rooms.filter((x) => x !== r); store.set('rooms', S.rooms); renderAll(); } }, '{{ic:close}}')))) : null;

    const lanCard = h('div', { class: 'card lan-card' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'В вашей сети'),
      h('button', { class: 'icon-btn', title: 'Обновить', onclick: () => scanLan() }, '{{ic:refresh}}')),
    h('div', { class: 'hint' }, 'Комнаты, запущенные в вашей локальной сети. Код вводить не нужно.'), h('div', { id: 'lan-list' }, ...lanItems()));

    m.replaceChildren(h('div', { class: 'page' },
      h('h2', { style: { marginTop: 0 } }, S.conn ? 'Главная' : 'Добро пожаловать в corsa-mess'),
      h('div', { class: 'cards' },
        h('div', { class: 'card' }, h('h3', null, 'Подключиться к комнате'),
          h('div', { class: 'hint' }, 'Введите код от друга или IP-адрес и порт.'), h('label', { class: 'lbl' }, 'Код или адрес'), addr,
          h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: join }, 'Подключиться')), saved),
        hostCard, lanCard)));
    clearInterval(lanTimer);
    if (S.settings.lanScan) { scanLan(); lanTimer = setInterval(() => { if (S.view.type === 'home' && document.getElementById('lan-list')) scanLan(); else clearInterval(lanTimer); }, 4000); }
  }

  // Интернет-мост: комната открывается через публичный relay (по умолчанию bore.pub). Друзьям — код вида bore.pub:12345.
  function bridgeBlock(hs) {
    const br = hs.bridge;
    const relay = S.settings.bridgeRelay || 'bore.pub';
    const out = h('div', { class: 'hint' });
    if (!br) {
      const go = h('button', { class: 'btn primary', onclick: async () => {
        go.disabled = true; out.className = 'hint'; out.textContent = `Подключаюсь к ${relay}…`;
        try { hs.bridge = await native.bridgeOpen({ relay }); renderMain(); } catch (e) { out.className = 'hint bad'; out.textContent = cleanErr(e); go.disabled = false; }
      } }, 'Открыть через мост');
      return h('div', null,
        h('div', { class: 'hint' }, `Комната станет доступна друзьям из любой сети через общий публичный relay ${relay}: роутер, UPnP и VPN не нужны. Друзья вводят код вида ${relay}:12345. Шифрование и пароль остаются сквозными, relay не может прочитать переписку и голос, но видит адреса подключающихся и знает, что кто-то зашёл. Если relay недоступен, мост не работает. Нужен пароль сети. Закроется при остановке сервера.`),
        go, out);
    }
    const live = br.state !== 'reconnecting';
    return h('div', null,
      h('div', { class: 'hint' }, live ? `Мост открыт через ${br.relay}. Код для друзей из любой сети:` : `Связь с ${br.relay} пропала, переподключаюсь… Код остаётся прежним.`),
      h('div', { class: 'code-box' }, br.code),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => copy(br.code) }, 'Скопировать'),
        h('button', { class: 'btn danger', onclick: async () => { await native.bridgeClose(); delete hs.bridge; renderMain(); } }, 'Закрыть мост')),
      h('div', { class: 'hint' }, 'Первый вход друга: приложение запомнит отпечаток комнаты. Сверьте его с отпечатком выше другим способом, если хотите быть уверены, что relay ничего не подменил.'));
  }

  // Запуск своей комнаты. Название и порт запоминаются для автозапуска, пароль — только если автозапуск включён
  // (в зашифрованном виде средствами Windows).
  async function startHosting({ name, port, password }) {
    // Владелец узнаётся по идентификатору для адреса 127.0.0.1: его знает только этот компьютер.
    S.hosting = await native.hostStart({ name, port, ownerUid: await deriveUid('127.0.0.1', port), password, lanVisible: S.settings.lanVisible });
    S.hostPassword = password;
    store.set('lastHost', { name, port: S.hosting.port });
    if (S.settings.autoHost) await native.secretSet('hostPassword', password || '').catch(() => {});
    await connectTo({ host: '127.0.0.1', port: S.hosting.port }, { password });
    renderMain();
  }

  // Что сделать при запуске приложения: поднять свою комнату или зайти в последнюю.
  async function startupActions() {
    const last = store.get('lastHost', null);
    if (S.settings.autoHost && last && last.port) {
      try {
        const password = await native.secretGet('hostPassword').catch(() => '');
        await startHosting({ name: last.name || S.profile.name + ' — комната', port: last.port, password });
        return;
      } catch (e) { C.toast('Комната не запустилась сама: ' + cleanErr(e)); }
    }
    if (S.settings.autoJoin && S.rooms[0] && !S.conn) {
      const r = S.rooms[0];
      await connectTo({ host: r.host, port: r.port }, { reconnecting: true });
    }
  }

  // Друзья
  function renderFriends(m) {
    const members = [...S.conn.members.values()];
    const list = S.friendsTab === 'online' ? members.filter(isOn) : members;
    const tab = (id, label) => h('div', { class: 'tab' + (S.friendsTab === id ? ' on' : ''), onclick: () => { S.friendsTab = id; renderMain(); } }, label);
    m.replaceChildren(
      h('div', { class: 'main-head' }, h('span', { class: 'title' }, '{{ic:users}} Друзья'), h('div', { class: 'tabs' }, tab('online', 'В сети'), tab('all', 'Все'))),
      h('div', { class: 'page' }, h('div', { class: 'group-label', style: { padding: '0 0 8px' } }, `${S.friendsTab === 'online' ? 'В сети' : 'Все'} — ${list.length}`),
        ...list.map((u) => h('div', { class: 'member friend-row', onclick: () => openProfileCard(u) }, avatarEl(u, { status: u.status }),
          h('div', { class: 'meta grow' }, h('div', { class: 'nm' }, nameEl(u)), h('div', { class: 'act' }, u.activity ? activityLine(u.activity) : u.custom || statusLabel(u))),
          u.sid !== S.conn.sid ? h('button', { class: 'icon-btn', title: 'Написать лично', onclick: (e) => { e.stopPropagation(); openDm(u.uid); } }, '{{ic:mail}}') : null))));
  }

  // ---------- Вложения ----------
  // Файлы лежат у хозяина комнаты и показываются через corsa://roomfile/<id> (главный процесс проверяет сертификат комнаты).
  const fileUrl = (f) => 'corsa://roomfile/' + f.id;
  const fmtSize = (n) => (n < 1024 ? n + ' Б' : n < 1048576 ? Math.round(n / 1024) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ');
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function viewImage(url) {
    modal(h('div', { class: 'modal-body' }, h('img', { class: 'img-viewer', src: url, alt: '' })), { cls: 'viewer-modal' });
  }

  function attachmentsNode(files) {
    if (!files || !files.length) return null;
    const box = h('div', { class: 'atts' });
    for (const f of files) {
      const save = h('button', { class: 'att-save', title: 'Скачать', onclick: (e) => {
        e.stopPropagation();
        native.saveRoomFile({ id: f.id, name: f.name }).then((p) => { if (p) C.toast('Сохранено: ' + p); }).catch((err) => C.toast(cleanErr(err)));
      } }, '{{ic:download}}');
      if (f.kind === 'image') {
        const img = h('img', { src: fileUrl(f), loading: 'lazy', alt: f.name, onclick: () => viewImage(fileUrl(f)) });
        img.addEventListener('error', () => img.replaceWith(h('div', { class: 'hint att-gone' }, `{{ic:image}} ${f.name} — недоступна (комната выключена или файл удалён)`)));
        box.append(h('div', { class: 'att att-img' }, img, save));
      } else if (f.kind === 'video') {
        box.append(h('div', { class: 'att att-video' }, h('video', { src: fileUrl(f), controls: true, preload: 'metadata' }), save));
      } else if (f.kind === 'audio') {
        box.append(h('div', { class: 'att att-audio' + (f.voice ? ' voice' : '') }, h('span', { class: 'att-ic' }, f.voice ? '{{ic:mic}}' : '{{ic:note}}'),
          h('div', { class: 'grow' }, h('div', { class: 'att-name' }, f.voice ? 'Голосовое сообщение' + (f.dur ? ' · ' + fmtDur(f.dur) : '') : f.name),
            h('audio', { src: fileUrl(f), controls: true, preload: 'metadata' })), save));
      } else {
        box.append(h('div', { class: 'att att-file' }, h('span', { class: 'att-ic' }, '{{ic:file}}'),
          h('div', { class: 'grow' }, h('div', { class: 'att-name' }, f.name), h('div', { class: 'hint' }, fmtSize(f.size))), save));
      }
    }
    return box;
  }

  // Ссылки на картинки, GIF и видео с проверенных сайтов показываются под сообщением (до трёх).
  // Ссылки внутри спойлера не раскрываются.
  function linkPreviews(text) {
    if (!text) return null;
    const bare = text.replace(/\|\|[\s\S]+?\|\|/g, '');
    const urls = [...new Set(bare.match(/https?:\/\/[^\s<>"']+/g) || [])].filter((u) => C.safeUrl(u) && /\.(png|jpe?g|gif|webp|mp4|webm)(\?|$)/i.test(u)).slice(0, 3);
    if (!urls.length) return null;
    return h('div', { class: 'link-previews' }, urls.map((u) => {
      const m = C.media(u, '');
      if (!m) return null;
      m.addEventListener('error', () => m.remove());
      if (m.tagName === 'IMG') m.addEventListener('click', () => viewImage(C.safeUrl(u)));
      return m;
    }));
  }

  // Если вы внизу чата, он остаётся внизу и когда картинки и видео догружаются позже текста.
  function keepBottom(box) {
    let stuck = true;
    box.addEventListener('scroll', () => { stuck = box.scrollHeight - box.scrollTop - box.clientHeight < 80; });
    const stick = () => { if (stuck) box.scrollTop = box.scrollHeight; };
    box.addEventListener('load', stick, true);
    box.addEventListener('loadedmetadata', stick, true);
  }

  // Загрузка одного файла на сервер комнаты. Плагины могут сжать картинку или скрыть имя файла.
  async function uploadBlob(blob, name, { voice, dur } = {}) {
    const r = await C.plugins.interceptAsync('upload', { blob, name: name || 'файл', type: blob.type || '', voice: !!voice, dur });
    const data = new Uint8Array(await r.blob.arrayBuffer());
    return native.uploadFile({ name: r.name, type: r.blob.type || r.type, data, voice: r.voice, dur: r.dur });
  }

  // Прикрепление к полю ввода: кнопка 📎, вставка Ctrl+V и перетаскивание. Файлы уходят вместе со следующим сообщением.
  function attachSupport(field, areas) {
    const pending = [];
    const strip = h('div', { class: 'att-strip' });
    const draw = () => {
      strip.replaceChildren(...pending.map((p, i) => h('div', { class: 'att-chip' },
        p.type.startsWith('image/') ? h('img', { src: p.url, alt: '' }) : h('span', { class: 'att-ic' }, p.type.startsWith('video/') ? '{{ic:film}}' : p.type.startsWith('audio/') ? '{{ic:note}}' : '{{ic:file}}'),
        h('span', { class: 'att-cn' }, p.name), h('span', { class: 'hint' }, fmtSize(p.file.size)),
        h('button', { class: 'icon-btn', title: 'Убрать', onclick: () => { URL.revokeObjectURL(p.url); pending.splice(i, 1); draw(); } }, '{{ic:close}}'))));
      strip.classList.toggle('on', pending.length > 0);
    };
    const add = (files) => {
      for (const f of files) {
        if (pending.length >= 10) { C.toast('Не больше 10 файлов за раз'); break; }
        if (f.size > 25 * 1024 * 1024) { C.toast(`${f.name}: больше 25 МБ`); continue; }
        pending.push({ file: f, name: f.name || 'картинка.png', type: f.type || '', url: URL.createObjectURL(f) });
      }
      draw();
      field.focus();
    };
    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
    const button = h('button', { class: 'btn', title: 'Прикрепить файл. Можно и вставить (Ctrl+V) или перетащить в чат', onclick: () => input.click() }, '{{ic:paperclip}}', input);
    field.addEventListener('paste', (e) => { const fl = [...((e.clipboardData && e.clipboardData.files) || [])]; if (fl.length) { e.preventDefault(); add(fl); } });
    for (const area of areas) {
      area.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); area.classList.add('drop'); } });
      area.addEventListener('dragleave', () => area.classList.remove('drop'));
      area.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); area.classList.remove('drop'); add([...e.dataTransfer.files]); });
    }
    const upload = async () => {
      const out = [];
      for (const p of pending) out.push(await uploadBlob(p.file, p.name));
      for (const p of pending) URL.revokeObjectURL(p.url);
      pending.length = 0;
      draw();
      return out;
    };
    return { strip, button, upload, has: () => pending.length > 0 };
  }

  // Пауза в секундах → коротко: 5 с, 1 мин, 1 ч.
  const fmtSlow = (s) => (s < 60 ? `${s} с` : s < 3600 ? `${Math.round(s / 60)} мин` : `${Math.round(s / 3600)} ч`);

  // ---------- Чат ----------
  function reactionsRow(msg, channel) {
    const row = h('div', { class: 'reactions' });
    const me = S.conn.meId;
    for (const [key, list] of Object.entries(msg.reactions || {})) {
      if (!list || !list.length) continue;
      const url = key.startsWith(':') && msg.remoji ? C.safeUrl(msg.remoji[key]) : null;
      const icon = url ? C.media(url, 'emoji') : h('span', { class: 'rx-e' }, key);
      const names = list.map((p) => { const mm = memberByPub(p); return mm ? mm.name : null; }).filter(Boolean);
      const pill = h('button', { class: 'rx' + (list.includes(me) ? ' mine' : ''), onclick: () => react(channel, msg, key, url) },
        icon, h('span', { class: 'rx-n' }, list.length), ...C.plugins.collect('reaction', { msg, key, list }));
      pill.title = (names.length ? names.join(', ') : 'кто-то') + (list.length > names.length ? ` и ещё ${list.length - names.length}` : '');
      row.append(pill);
    }
    return row;
  }

  function react(channel, msg, key, url) {
    S.conn.send({ t: 'react', channel, id: msg.id, emoji: key, url: url || undefined });
  }

  // Мини-выбор реакции: быстрые эмодзи и свои эмодзи из библиотеки.
  function reactionPicker(anchor, channel, msg) {
    document.querySelectorAll('.rx-pop').forEach((x) => x.remove());
    const own = C.stickerLib.categories.flatMap((c) => c.items.filter((i) => i.type === 'emoji')).slice(0, 24);
    const pop = h('div', { class: 'rx-pop' },
      h('div', { class: 'rx-grid' }, QUICK_REACTIONS.map((e) => h('button', { class: 'rx-opt', onclick: () => { react(channel, msg, e); pop.remove(); } }, e))),
      own.length ? h('div', { class: 'rx-grid own' }, own.map((it) => h('button', { class: 'rx-opt', title: `:${it.name}:`, onclick: () => { react(channel, msg, `:${it.name}:`, it.url); pop.remove(); } }, C.media(it.url, 'emoji')))) : null);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (r.top - pop.offsetHeight - 6 < 40 ? r.bottom + 6 : r.top - pop.offsetHeight - 6) + 'px';
    const off = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
  }

  function setReply(msg) {
    S.replyTo = msg ? { id: msg.id, name: msg.name, text: msg.text || (msg.sticker ? 'стикер' : '') } : null;
    const bar = document.getElementById('reply-bar');
    if (!bar) return;
    if (!S.replyTo) { bar.replaceChildren(); bar.classList.remove('on'); return; }
    bar.classList.add('on');
    bar.replaceChildren(h('span', null, '{{ic:reply}} Ответ для ', h('b', null, S.replyTo.name), ': ', plainText(S.replyTo.text).slice(0, 80)),
      h('button', { class: 'icon-btn', title: 'Отменить ответ', onclick: () => setReply(null) }, '{{ic:close}}'));
    const f = document.querySelector('.composer .field');
    if (f) f.focus();
  }

  function startEdit(node, msg, channel) {
    if (S.editing) S.editing.cancel();
    const textBox = node.querySelector('.text');
    const area = h('textarea', { class: 'input edit-field', rows: 2, value: msg.text || '' });
    const hint = h('div', { class: 'hint' }, 'Enter — сохранить, Esc — отмена');
    const box = h('div', { class: 'edit-box' }, area, hint);
    const cancel = () => { box.replaceWith(textBox || h('span')); S.editing = null; };
    const save = () => {
      const t = area.value.trim();
      if (t && t !== msg.text) S.conn.send({ t: 'edit', channel, id: msg.id, text: t, emojis: C.stickerLib.usedEmojis(t) });
      cancel();
    };
    area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); cancel(); } });
    if (textBox) textBox.replaceWith(box); else node.querySelector('.body').append(box);
    S.editing = { cancel };
    area.focus();
    area.selectionStart = area.value.length;
  }

  function deleteMsg(msg, channel, ask = true) {
    if (ask && !confirm('Удалить сообщение? (Shift+клик удаляет без вопроса)')) return;
    S.conn.send({ t: 'delete', channel, id: msg.id });
  }

  function messageNode(shownIn, channel, cont, force) {
    const msg = shownIn;
    // Автор заблокирован у вас: вместо сообщения короткая заглушка, по клику можно посмотреть.
    if (!force && S.blocked.has(msg.uid)) {
      const stub = h('div', { class: 'msg blocked-msg', dataset: { id: msg.id, uid: msg.uid || '', ts: String(msg.ts) } },
        h('span', { class: 'hint', onclick: () => stub.replaceWith(messageNode(msg, channel, false, true)) }, '{{ic:block}} Сообщение заблокированного участника. Показать'));
      return stub;
    }
    const shown = C.plugins.transformMessage(msg);
    const media = shown.sticker ? C.media(shown.sticker, 'sticker') : null;
    if (media) { media.dataset.url = shown.sticker; media.addEventListener('error', () => media.replaceWith(h('div', { class: 'hint' }, 'Стикер не загрузился'))); }
    // Рамка, цвет и эффект имени берутся из текущего профиля автора, если он в комнате.
    // Если автор сейчас в комнате, показываем его нынешнее имя и аватар (плагин мог подменить их в shown).
    const mem = S.conn.members.get(shown.sid);
    const live = mem && mem.uid === shown.uid && shown.name === msg.name;
    const who = mem ? { ...mem, name: live ? mem.name : shown.name, avatar: live ? mem.avatar : shown.avatar } : { name: shown.name, avatar: shown.avatar };
    const author = nameEl(who, { cls: 'author' });
    author.addEventListener('click', () => { if (mem) openProfileCard(mem); });
    const mine = shown.uid === S.conn.meId;
    const canDelete = mine || S.conn.mod;
    const tools = h('div', { class: 'msg-tools' },
      h('button', { title: 'Реакция', onclick: (e) => reactionPicker(e.currentTarget, channel, msg) }, '{{ic:smile}}'),
      h('button', { title: 'Ответить', onclick: () => setReply(msg) }, '{{ic:reply}}'),
      mine && msg.text ? h('button', { title: 'Изменить', onclick: () => startEdit(node, msg, channel) }, '{{ic:pencil}}') : null,
      canDelete ? h('button', { title: msg.pinned ? 'Открепить' : 'Закрепить', onclick: () => S.conn.send({ t: 'pin', channel, id: msg.id, on: !msg.pinned }) }, msg.pinned ? '{{ic:unpin}}' : '{{ic:pin}}') : null,
      canDelete ? h('button', { title: 'Удалить', class: 'danger', onclick: (e) => deleteMsg(msg, channel, !e.shiftKey) }, '{{ic:trash}}') : null,
      ...C.plugins.collect('msgTools', { msg, channel }));
    const mentionsMe = shown.text && S.profile.name && shown.text.toLowerCase().includes('@' + S.profile.name.toLowerCase());
    const node = h('div', { class: 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + (mentionsMe ? ' mention' : ''), dataset: { id: msg.id, uid: shown.uid || '', ts: String(shown.ts) },
      oncontextmenu: (e) => contextMenu(e, [
        { label: '{{ic:smile}} Реакция', onclick: () => reactionPicker(tools, channel, msg) },
        { label: '{{ic:reply}} Ответить', onclick: () => setReply(msg) },
        msg.text ? { label: '{{ic:copy}} Скопировать текст', onclick: () => copy(msg.text) } : null,
        mine && msg.text ? { label: '{{ic:pencil}} Изменить', onclick: () => startEdit(node, msg, channel) } : null,
        canDelete ? { label: msg.pinned ? '{{ic:unpin}} Открепить' : '{{ic:pin}} Закрепить', onclick: () => S.conn.send({ t: 'pin', channel, id: msg.id, on: !msg.pinned }) } : null,
        !mine && mem ? { label: '{{ic:mail}} Написать лично', onclick: () => openDm(mem.uid) } : null,
        canDelete ? { label: '{{ic:trash}} Удалить', danger: true, onclick: () => deleteMsg(msg, channel) } : null,
      ]) },
    cont ? h('span', { class: 'cont-time' }, new Date(shown.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })) : avatarEl(who),
    h('div', { class: 'body' },
      shown.reply ? h('div', { class: 'reply-ref', onclick: () => { const t = msgNode(shown.reply.id); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } } },
        h('span', { class: 'rr-arrow' }, '{{ic:reply-to}}'), h('b', null, shown.reply.name), ' ', plainText(shown.reply.text)) : null,
      cont ? null : h('div', { class: 'head' }, author, mem ? modMark(mem) : null, h('span', { class: 'time' }, fmtTime(shown.ts)), msg.pinned ? h('span', { class: 'pin-mark', title: 'Закреплено' }, '{{ic:pin}}') : null),
      cont && msg.pinned ? h('span', { class: 'pin-mark', title: 'Закреплено' }, '{{ic:pin}}') : null,
      shown.text ? richText(shown.text, shown.emojis) : null,
      shown.edited && !shown.text ? h('span', { class: 'edited', title: 'Изменено ' + fmtTime(shown.edited) }, '(изменено)') : null,
      linkPreviews(shown.text), media, attachmentsNode(shown.files), reactionsRow(msg, channel)),
    tools);
    const textBox = node.querySelector('.body > .text');
    if (shown.edited && textBox) textBox.append(h('span', { class: 'edited', title: 'Изменено ' + fmtTime(shown.edited) }, '(изменено)'));
    for (const extra of C.plugins.collect('message', { msg: shown, node, channel })) if (extra.nodeType) node.querySelector('.body').append(extra);
    return node;
  }

  // Подряд идущие сообщения одного автора в пределах 5 минут собираются в группу (без повторной шапки).
  function appendMessage(msg, stick) {
    const box = document.getElementById('messages');
    if (!box) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prev = box.lastElementChild;
    const cont = S.settings.groupMessages && S.settings.msgStyle !== 'compact' && prev && prev.classList.contains('msg') && !msg.reply &&
      prev.dataset.uid === (msg.uid || '') && msg.ts - Number(prev.dataset.ts) < 5 * 60000;
    const node = messageNode(msg, S.view.channel, cont);
    if (stick) node.classList.add('new');
    box.append(node);
    if (stick && near) box.scrollTop = box.scrollHeight;
  }

  // Перерисовать сообщения открытого канала, не трогая поле ввода (после включения плагина и т. п.).
  function refreshMessages() {
    const box = document.getElementById('messages');
    if (!box || S.view.type !== 'text' || !S.conn) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.querySelectorAll('.msg').forEach((n) => n.remove());
    for (const msg of S.conn.history.get(S.view.channel) || []) appendMessage(msg, false);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function renderText(m) {
    const ch = S.conn.room.channels.find((c) => c.id === S.view.channel);
    if (!ch) { S.view = firstTextView(); renderMain(); return; }
    const messages = h('div', { class: 'messages' + (ch.nsfw ? ' nsfw' : ''), id: 'messages' });
    keepBottom(messages);
    const list = S.conn.history.get(ch.id) || [];
    if (!list.length) messages.append(h('div', { class: 'empty' }, h('h3', null, `Это начало канала #${ch.name}`), h('div', null, ch.topic || 'Напишите первое сообщение.')));
    // «Только чтение»: писать могут владелец и модераторы. Медленный режим: пауза между сообщениями (модераторов не касается).
    const locked = !!ch.readonly && !S.conn.mod;
    const field = h('textarea', { class: 'field', rows: 1, disabled: locked, placeholder: locked ? 'Писать здесь могут только модераторы' : ch.slow && !S.conn.mod ? `Медленный режим: раз в ${fmtSlow(ch.slow)}` : `Написать в #${ch.name}` });
    const att = S.conn.fileToken ? attachSupport(field, [messages, field]) : null;
    let sendBtn = null;
    let sending = false;
    // С файлами: сначала загрузка на сервер комнаты, потом сообщение со ссылками на них.
    const submit = async () => {
      if (sending) return;
      let files = [];
      if (att && att.has()) {
        sending = true; sendBtn.disabled = true; sendBtn.textContent = 'Загрузка…';
        try { files = await att.upload(); } catch (e) { C.toast('Файл не отправлен: ' + cleanErr(e)); }
        sending = false; sendBtn.disabled = false; sendBtn.textContent = 'Отправить';
        if (!files.length && !field.value.trim()) return;
      }
      sendText(field.value, ch.id, files); field.value = ''; field.style.height = '';
    };
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
      if (e.key === 'Escape' && S.replyTo) { setReply(null); return; }
      // Стрелка вверх в пустом поле — изменить своё последнее сообщение.
      if (e.key === 'ArrowUp' && !field.value) {
        const mineLast = [...(S.conn.history.get(ch.id) || [])].reverse().find((x) => x.uid === S.conn.meId && x.text);
        const node = mineLast && msgNode(mineLast.id);
        if (node) { e.preventDefault(); startEdit(node, mineLast, ch.id); }
      }
    });
    field.addEventListener('input', () => {
      field.style.height = 'auto'; field.style.height = Math.min(140, field.scrollHeight) + 'px';
      if (field.value.trim() && !field.value.startsWith('/')) sendTyping(ch.id);
    });
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    sendBtn = h('button', { class: 'btn primary', onclick: submit }, 'Отправить');
    const composer = h('div', { class: 'composer' }, field,
      ...C.plugins.collect('composer', { channel: ch, field, files: !!att, sendFiles: (files) => S.conn.send({ t: 'msg', channel: ch.id, files: files.map((f) => f.id) }) }),
      att ? att.button : null,
      h('button', { class: 'btn', title: 'Стикеры и эмодзи', onclick: () => {
        if (pop) { closePop(); return; }
        pop = stickerPopup(ch.id, field, closePop);
        composer.append(pop);
      } }, '{{ic:smile}}'),
      sendBtn);
    if (locked) composer.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const search = h('input', { class: 'input head-search', placeholder: 'Поиск', title: 'Поиск по каналу (Ctrl+F)' });
    search.addEventListener('input', () => searchPopup(search, ch.id));
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; searchPopup(search, ch.id); field.focus(); } });
    const pinCount = (S.conn.pins.get(ch.id) || []).length;
    const head = h('div', { class: 'main-head' }, h('span', { class: 'title' }, '# ' + ch.name),
      ch.nsfw ? h('span', { class: 'nsfw-pill' }, '18+') : null,
      ch.readonly ? h('span', { class: 'mode-pill', title: 'Писать могут только владелец и модераторы' }, '{{ic:lock}} Только чтение') : null,
      ch.slow ? h('span', { class: 'mode-pill', title: 'Пауза между сообщениями одного участника' }, `Пауза ${fmtSlow(ch.slow)}`) : null,
      ch.topic ? h('span', { class: 'topic' }, ch.topic) : null, h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn pin-btn', title: 'Закреплённые сообщения', onclick: (e) => pinsPopup(e.currentTarget, ch.id) }, '{{ic:pin}}', h('span', { id: 'pin-count' }, pinCount || '')),
      h('div', { class: 'search-wrap' }, C.icon('search'), search),
      h('button', { class: 'icon-btn' + (S.settings.showMembers ? ' on' : ''), title: 'Список участников', onclick: () => { S.settings.showMembers = !S.settings.showMembers; saveSettings(); renderRight(); renderMain(); } }, '{{ic:users}}'));
    m.replaceChildren(...[head, messages, h('div', { class: 'typing', id: 'typing' }), h('div', { class: 'reply-bar', id: 'reply-bar' }), att ? att.strip : null, composer].filter(Boolean));
    for (const msg of list) appendMessage(msg, false);
    messages.scrollTop = messages.scrollHeight;
    renderTyping();
    if (S.replyTo) setReply(S.replyTo.id ? (S.conn.history.get(ch.id) || []).find((x) => x.id === S.replyTo.id) || null : null);
    field.focus();
  }

  // Всплывающий список под шапкой канала: закрепы или результаты поиска. Клик — перейти к сообщению.
  function jumpTo(id) {
    const t = msgNode(id);
    if (!t) { C.toast('Это сообщение уже ушло из истории канала'); return; }
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    t.classList.add('flash');
    setTimeout(() => t.classList.remove('flash'), 1200);
  }

  function headPopup(anchor, title, items, empty) {
    document.querySelectorAll('.head-pop').forEach((x) => x.remove());
    const pop = h('div', { class: 'head-pop' }, h('div', { class: 'hp-title' }, title),
      items.length ? items : h('div', { class: 'hint', style: { padding: '8px' } }, empty));
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = r.bottom + 8 + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
    const off = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    return pop;
  }

  function pinsPopup(anchor, channel) {
    const list = [...(S.conn.pins.get(channel) || [])].reverse();
    headPopup(anchor, `Закреплено — ${list.length}`, list.map((p) => {
      const can = p.uid === S.conn.meId || S.conn.mod;
      return h('div', { class: 'hp-item', onclick: () => jumpTo(p.id) },
        h('div', { class: 'hp-head' }, h('b', null, p.name), h('span', { class: 'time' }, fmtTime(p.ts)),
          can ? h('button', { class: 'icon-btn', title: 'Открепить', onclick: (e) => { e.stopPropagation(); S.conn.send({ t: 'pin', channel, id: p.id, on: false }); e.currentTarget.closest('.hp-item').remove(); } }, '{{ic:close}}') : null),
        p.text ? richText(p.text, p.emojis) : p.sticker ? C.media(p.sticker, 'sticker') : null);
    }), 'Пока ничего не закреплено. Наведите на сообщение и нажмите {{ic:pin}}.');
  }

  function searchPopup(input, channel) {
    const q = input.value.trim().toLowerCase();
    if (!q) { document.querySelectorAll('.head-pop').forEach((x) => x.remove()); return; }
    const found = (S.conn.history.get(channel) || []).filter((x) => !S.blocked.has(x.uid) && ((x.text || '').toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q))).slice(-30).reverse();
    headPopup(input, `Найдено: ${found.length}`, found.map((x) => h('div', { class: 'hp-item', onclick: () => jumpTo(x.id) },
      h('div', { class: 'hp-head' }, h('b', null, x.name), h('span', { class: 'time' }, fmtTime(x.ts))),
      h('div', { class: 'hp-text' }, msgSummary(x).slice(0, 160)))), 'Ничего не нашлось в последних 200 сообщениях.');
    input.focus();
  }

  // Личная беседа: те же текст, эмодзи и стикеры, но без реакций и правки (сервер такие сообщения не хранит).
  function dmNode(msg, cont) {
    const mine = msg.uid === S.conn.meId;
    const mem = memberByPub(msg.uid);
    const who = mem || { name: msg.name, avatar: msg.avatar };
    const media = msg.sticker ? C.media(msg.sticker, 'sticker') : null;
    if (media) media.dataset.url = msg.sticker;
    return h('div', { class: 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : ''), dataset: { id: msg.id, uid: msg.uid, ts: String(msg.ts) },
      oncontextmenu: (e) => contextMenu(e, [msg.text ? { label: '{{ic:copy}} Скопировать текст', onclick: () => copy(msg.text) } : null,
        { label: '{{ic:trash}} Удалить у себя', danger: true, onclick: () => { const conv = S.dms[S.view.peer]; if (conv) { conv.list = conv.list.filter((x) => x.id !== msg.id); saveDms(); renderMain(); } } }]) },
    cont ? h('span', { class: 'cont-time' }, new Date(msg.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })) : avatarEl(who),
    h('div', { class: 'body' }, cont ? null : h('div', { class: 'head' }, nameEl(who, { cls: 'author' }), h('span', { class: 'time' }, fmtTime(msg.ts))),
      msg.text ? richText(msg.text, msg.emojis) : null, linkPreviews(msg.text), media, attachmentsNode(msg.files)));
  }

  function appendDm(msg, stick) {
    const box = document.getElementById('messages');
    if (!box) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prev = box.lastElementChild;
    const cont = S.settings.groupMessages && S.settings.msgStyle !== 'compact' && prev && prev.classList.contains('msg') && prev.dataset.uid === msg.uid && msg.ts - Number(prev.dataset.ts) < 5 * 60000;
    const node = dmNode(msg, cont);
    if (stick) node.classList.add('new');
    box.append(node);
    if (stick && near) box.scrollTop = box.scrollHeight;
  }

  function renderDm(m) {
    const peer = S.view.peer;
    const conv = S.dms[peer] || { name: 'Собеседник', list: [] };
    const mem = memberByPub(peer);
    const name = mem ? mem.name : conv.name;
    const messages = h('div', { class: 'messages', id: 'messages' });
    keepBottom(messages);
    if (!conv.list.length) messages.append(h('div', { class: 'empty' }, h('h3', null, `Беседа с ${name}`), h('div', null, 'Сообщения видите только вы двое. Сервер их пересылает, но не хранит.')));
    const field = h('textarea', { class: 'field', rows: 1, placeholder: mem ? `Написать ${name}` : `${name} сейчас нет в комнате` , disabled: !mem });
    const sendDm = (extra) => { const target = memberByPub(peer); if (!target) { C.toast(`${name} сейчас нет в комнате`); return; } S.conn.send({ t: 'dm', to: target.sid, ...extra }); };
    const att = mem && S.conn.fileToken ? attachSupport(field, [messages, field]) : null;
    let busy = false;
    const submit = async () => {
      const t = field.value.trim();
      if (busy || (!t && !(att && att.has()))) return;
      let files = [];
      if (att && att.has()) { busy = true; try { files = await att.upload(); } catch (e) { C.toast('Файл не отправлен: ' + cleanErr(e)); } busy = false; }
      if (!t && !files.length) return;
      sendDm({ text: t, emojis: C.stickerLib.usedEmojis(t), files: files.map((f) => f.id) });
      field.value = ''; field.style.height = '';
    };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    field.addEventListener('input', () => { field.style.height = 'auto'; field.style.height = Math.min(140, field.scrollHeight) + 'px'; });
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    const composer = h('div', { class: 'composer' }, field,
      ...(mem ? C.plugins.collect('composer', { channel: null, dm: peer, field, files: !!att, sendFiles: (files) => sendDm({ files: files.map((f) => f.id) }) }) : []),
      att ? att.button : null,
      h('button', { class: 'btn', title: 'Стикеры и эмодзи', disabled: !mem, onclick: () => {
        if (pop) { closePop(); return; }
        pop = stickerPopup(null, field, closePop, (url) => sendDm({ sticker: url }));
        composer.append(pop);
      } }, '{{ic:smile}}'),
      h('button', { class: 'btn primary', disabled: !mem, onclick: submit }, 'Отправить'));
    const head = h('div', { class: 'main-head' }, mem ? avatarEl(mem, { status: mem.status }) : null, h('span', { class: 'title' }, '@ ' + name),
      h('span', { class: 'topic' }, mem ? statusLabel(mem) : 'не в комнате'), h('span', { class: 'spacer' }),
      mem ? h('button', { class: 'icon-btn', title: 'Профиль', onclick: () => openProfileCard(mem) }, '{{ic:user}}') : null);
    m.replaceChildren(...[head, messages, att ? att.strip : null, composer].filter(Boolean));
    for (const msg of conv.list) appendDm(msg, false);
    messages.scrollTop = messages.scrollHeight;
    if (mem) field.focus();
  }

  // Окно выбора: вкладки «Стикеры» и «Эмодзи», категории, быстрое добавление по ссылке.
  // Перерисовывается само, поэтому набранный текст в поле ввода не теряется.
  function stickerPopup(channel, field, close, onSticker) {
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
          h('button', { class: 'icon-btn', title: 'Управление и экспорт', onclick: () => { close(); openSettings('stickers'); } }, '{{ic:gear}}')),
        h('div', { class: 'chips', style: { margin: '10px 0 6px' } }, lib.categories.map((c) =>
          h('div', { class: 'chip' + (c.id === cat.id ? ' on' : ''), onclick: () => { S.pickerCat = c.id; draw(); } }, c.name))),
        h('div', { class: 'sticker-grid' + (type === 'emoji' ? ' emoji-grid' : '') }, items.length ? items.map((item) =>
          h('div', { class: 'st', title: type === 'emoji' ? `:${item.name}:` : item.name, onclick: () => {
            if (type === 'emoji') insertEmoji(item.name);
            else if (onSticker) { onSticker(item.url); close(); }
            else { const out = { t: 'msg', channel, sticker: item.url }; if (S.replyTo) out.reply = S.replyTo.id; S.conn.send(out); setReply(null); close(); }
          } }, C.media(item.url, ''),
          h('button', { class: 'x', title: 'Удалить', onclick: (ev) => { ev.stopPropagation(); lib.removeItem(cat.id, item.id); draw(); } }, '{{ic:close}}'))) :
          [h('div', { class: 'hint', style: { gridColumn: '1 / -1' } }, 'В этой категории пока пусто. Добавьте ссылку ниже.')]),
        h('div', { class: 'row', style: { marginTop: '10px' } }, name, url, h('button', { class: 'btn', onclick: add }, '+')), hint);
    };
    draw();
    return pop;
  }

  // ---------- Голос ----------
  // Чей экран сейчас смотрим: другие видят это в плагине «Зрители трансляции».
  function setWatching(sid) {
    if (S.watching === sid) return;
    S.watching = sid;
    if (S.conn && S.voice && S.voice.channel) S.conn.send({ t: 'voice-flags', watching: sid });
  }

  function renderVoice(m) {
    const ch = S.conn.room.channels.find((c) => c.id === S.view.channel);
    if (!ch) { S.view = firstTextView(); renderMain(); return; }
    const v = S.voice;
    const here = v.channel === ch.id;
    const inside = (S.conn.voice[ch.id] || []).map((sid) => S.conn.members.get(sid)).filter(Boolean);
    const head = h('div', { class: 'main-head' }, h('span', { class: 'title' }, '{{ic:speaker}} ' + ch.name), ch.topic ? h('span', { class: 'topic' }, ch.topic) : null);
    if (!here) {
      setWatching(null);
      m.replaceChildren(head, h('div', { class: 'voice-stage' },
        h('div', { class: 'empty' }, h('h3', null, ch.name), h('div', null, inside.length ? `Сейчас в канале: ${inside.map((x) => x.name).join(', ')}` : 'Здесь пока никого нет.'),
          h('button', { class: 'btn primary', style: { marginTop: '16px' }, onclick: async () => {
            try { await v.join(ch.id); } catch (e) { C.toast('Нет доступа к микрофону: ' + e.message); }
          } }, 'Подключиться к каналу'))));
      return;
    }
    const tiles = h('div', { class: 'tiles' });
    let watched = null;
    const cams = new Map();
    for (const t of v.videoTiles()) {
      // Камера показывается в плитке участника вместо аватара, экран — отдельной большой плиткой.
      if (t.kind === 'camera') { cams.set(t.sid, t.stream); continue; }
      const who = S.conn.members.get(t.sid);
      if (!t.mine && !watched) watched = t.sid;
      const video = h('video', { autoplay: true, playsInline: true, muted: true });
      video.srcObject = t.stream;
      const tile = h('div', { class: 'tile big', dataset: { screen: t.sid } }, video, h('div', { class: 'label' }, `${who ? who.name : '?'} — экран`),
        h('button', { class: 'btn fs', onclick: () => video.requestFullscreen && video.requestFullscreen() }, '⛶'));
      for (const extra of C.plugins.collect('voiceTile', { sid: t.sid, mine: t.mine, kind: 'screen' })) tile.append(extra);
      tiles.append(tile);
    }
    setWatching(watched);
    for (const u of inside) {
      const cam = cams.get(u.sid);
      let face = avatarEl(u);
      if (cam) { face = h('video', { autoplay: true, playsInline: true, muted: true, class: u.sid === S.conn.sid ? 'mirror' : '' }); face.srcObject = cam; }
      const tile = h('div', { class: 'tile' + (cam ? ' cam' : ''), dataset: { sid: u.sid } }, face,
        h('div', { class: 'label' }, u.name + (u.sid === S.conn.sid ? ' (вы)' : ''), u.muted ? ' {{ic:mic-off}}' : '', u.deaf ? ' {{ic:headphones-off}}' : ''),
        u.sid !== S.conn.sid ? h('span', { class: 'net' }) : null);
      if (u.sid !== S.conn.sid) {
        tile.addEventListener('contextmenu', (e) => contextMenu(e, [{ label: '{{ic:speaker}} Громкость…', onclick: () => volumeDialog(u) }, { label: '{{ic:user}} Профиль', onclick: () => openProfileCard(u) }]));
      }
      for (const extra of C.plugins.collect('voiceTile', { sid: u.sid, mine: u.sid === S.conn.sid, kind: 'user' })) tile.append(extra);
      tiles.append(tile);
    }
    const sharing = !!v.screenStream;
    m.replaceChildren(head, h('div', { class: 'voice-stage' }, tiles),
      h('div', { class: 'voice-controls' },
        h('button', { class: 'btn' + (v.muted ? ' danger' : ''), onclick: () => v.setMuted(!v.muted) }, v.muted ? '{{ic:mic-off}} Включить микрофон' : '{{ic:mic}} Микрофон'),
        h('button', { class: 'btn' + (v.deafened ? ' danger' : ''), onclick: () => v.setDeafened(!v.deafened) }, v.deafened ? '{{ic:headphones-off}} Включить звук' : '{{ic:headphones}} Звук'),
        h('button', { class: 'btn' + (v.cameraStream ? ' primary' : ''), onclick: async () => {
          try { if (v.cameraStream) v.stopCamera(); else await v.startCamera(); } catch (e) { C.toast('Камера не включилась: ' + e.message); }
        } }, v.cameraStream ? '{{ic:camera}} Стоп камера' : '{{ic:camera}} Камера'),
        h('button', { class: 'btn' + (sharing ? ' primary' : ''), title: sharing ? 'Остановить показ экрана' : 'Показать экран', onclick: () => (sharing ? v.stopScreen() : pickScreen()) }, sharing ? '{{ic:stop}} Стоп экран' : '{{ic:screen}} Экран'),
        ...C.plugins.collect('voiceControls', { channel: ch }),
        h('button', { class: 'btn danger', onclick: () => v.leave() }, '{{ic:phone-down}} Выйти')));
    updateSpeaking();
    updateNetStats();
  }

  function volumeDialog(u) {
    const cur = S.voice.volumes.has(u.sid) ? S.voice.volumes.get(u.sid) : 1;
    const label = h('label', { class: 'lbl' }, `Громкость: ${Math.round(cur * 100)}%`);
    const r = h('input', { type: 'range', min: 0, max: 100, value: Math.round(cur * 100) });
    r.addEventListener('input', () => { S.voice.setVolume(u.sid, Number(r.value) / 100); label.textContent = `Громкость: ${r.value}%`; });
    modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, u.name), label, r, h('div', { class: 'hint' }, 'Действует только у вас.')));
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
    S.idle = false;
    store.set('status', v);
    if (S.conn) S.conn.send({ t: 'status', status: wireStatus() });
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
      const me = { ...S.profile, sid: '', status: invisible ? 'offline' : wireStatus(), activity: S.activity };
      const pc = HEX.test(me.color || '') ? me.color : null;
      const banner = h('div', { class: 'sm-banner', style: { ...bgStyle(me.banner), ...(pc && !C.safeUrl(me.banner) ? { background: `linear-gradient(135deg, ${pc}, ${HEX.test(me.color2 || '') ? me.color2 : '#120407'})` } : {}) } });
      const input = h('input', { class: 'input', value: S.profile.custom || '', maxLength: 60, placeholder: 'Что у вас происходит?' });
      const finish = (save) => { editing = false; if (save) saveCustomStatus(input.value.trim()); draw(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
      const bubble = editing ? h('div', { class: 'sm-bubble edit' }, input, h('div', { class: 'hint' }, 'Enter — сохранить, Esc — отмена'))
        : h('div', { class: 'sm-bubble' + (S.profile.custom ? '' : ' empty'), title: 'Изменить статус-фразу', onclick: () => { editing = true; draw(); input.focus(); } },
          S.profile.custom || '+ Статус-фраза');
      const item = (icon, label, onclick, chevron) => h('div', { class: 'sm-item', onclick }, h('span', { class: 'ic' }, icon), h('span', { class: 'grow' }, label), chevron ? h('span', { class: 'chev' }, chevron) : null);
      const cur = STATUSES.find((x) => x[0] === S.status) || STATUSES[0];
      const opts = statusOpen ? h('div', { class: 'sm-sub' }, STATUSES.map(([id, ic, label]) =>
        h('div', { class: 'sm-item' + (S.status === id ? ' on' : ''), onclick: () => { setStatus(id); draw(); } }, h('span', { class: 'ic' }, ic), h('span', { class: 'grow' }, label), S.status === id ? h('span', null, '{{ic:check}}') : null))) : null;
      const card = h('div', null, banner,
        h('div', { class: 'sm-head' }, avatarEl(me, { status: me.status, cls: 'lg' }), bubble),
        h('div', { class: 'sm-who' }, h('div', { class: 'sm-name' }, nameEl(me)),
          h('div', { class: 'hint' }, [me.pronouns, S.activity ? (S.activity.kind === 'music' ? 'Слушает: ' : 'Играет: ') + S.activity.name : ''].filter(Boolean).join(' · ') || cur[2])),
        h('div', { class: 'sm-list' },
          item('{{ic:pencil}}', 'Редактировать профиль', () => { closeSelfMenu(); openSettings('profile'); }),
          item(cur[1], cur[2], () => { statusOpen = !statusOpen; draw(); }, statusOpen ? '{{ic:chevron-down}}' : '{{ic:chevron-right}}'), opts),
        h('div', { class: 'sm-list' }, item('{{ic:palette}}', 'Внешний вид', () => { closeSelfMenu(); openSettings('look'); }),
          item('{{ic:gear}}', 'Настройки', () => { closeSelfMenu(); openSettings(); }),
          item('{{ic:bell}}', 'Уведомления', () => { closeSelfMenu(); openSettings('notify'); })));
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
  function profileCardNode(u, { live = true } = {}) {
    const pc = HEX.test(u.color || '') ? u.color : null;
    const pc2 = HEX.test(u.color2 || '') ? u.color2 : null;
    const bannerStyle = { ...bgStyle(u.banner) };
    if (!C.safeUrl(u.banner) && pc) bannerStyle.background = `linear-gradient(135deg, ${pc}, ${pc2 || '#120407'})`;
    const bg = h('div', { class: 'profile-banner', style: bannerStyle, dataset: { view: C.safeUrl(u.banner) || '' } });
    const banner = C.safeUrl(u.banner);
    const bannerMedia = banner && isVideoUrl(banner) ? C.media(banner, '') : null;
    if (bannerMedia) { bannerMedia.style.cssText = 'width:100%;height:100%;object-fit:cover'; bg.append(bannerMedia); }
    const title = h('h2', { style: { margin: '8px 0 0' } }, nameEl(u));
    const badges = (u.badges || []).filter((b) => BADGES[b]);
    const links = (u.links || []).filter((l) => l && (l.label || l.url));
    const sinceLine = u.since ? 'В комнате с ' + new Date(u.since).toLocaleDateString('ru-RU') : '';
    const body = h('div', { class: 'profile-body' }, avatarEl(u, { status: u.status, cls: 'lg' }),
      badges.length || u.host || u.mod ? h('div', { class: 'badges' }, u.host ? h('span', { class: 'bdg', title: 'Хозяин комнаты' }, '{{ic:crown}}') : u.mod ? h('span', { class: 'bdg', title: 'Модератор' }, '{{ic:shield}}') : null,
        badges.map((b) => h('span', { class: 'bdg', title: BADGES[b][1] }, BADGES[b][0]))) : null,
      title,
      u.pronouns ? h('div', { class: 'pronouns' }, u.pronouns) : null,
      h('div', { class: 'hint' }, u.custom ? u.custom : statusLabel(u)),
      u.bio ? h('div', { class: 'bio' }, inline(u.bio, null, { emoji: 0 })) : null,
      links.length ? h('div', { class: 'links' }, links.map((l) => h('span', { class: 'plink', title: l.url ? 'Нажмите, чтобы скопировать' : '', onclick: () => l.url && copy(l.url) }, '{{ic:link}} ', l.label || l.url))) : null,
      u.activity ? h('div', { class: 'contact-card act-card', style: { marginTop: '14px' } }, u.activity.image ? C.media(u.activity.image, 'act-img') : null,
        h('div', { class: 'grow' }, h('div', { class: 'game' }, u.activity.kind === 'music' ? 'Слушает' : 'Играет'), h('b', null, u.activity.name),
          h('div', { class: 'game' }, [u.activity.details, u.activity.state].filter(Boolean).join(' · ')), u.activity.kind !== 'music' && u.activity.startedAt ? h('div', { class: 'game' }, C.fmtElapsed(u.activity.startedAt)) : null)) : null,
      sinceLine ? h('div', { class: 'hint', style: { marginTop: '10px' } }, sinceLine) : null,
      ...(live ? C.plugins.collect('profile', { user: u }) : []));
    const cardFrame = u.cardFrame ? C.media(u.cardFrame, 'card-frame') : null;
    if (cardFrame) cardFrame.addEventListener('error', () => cardFrame.remove());
    const fx = u.effect && u.effect !== 'none' ? h('canvas', { class: 'fx-canvas' }) : null;
    const wrap = h('div', { class: 'profile-card-bg cs-' + (u.cardStyle || 'default'), style: bgStyle(u.bg) }, bg, body, fx, cardFrame);
    if (pc) wrap.style.setProperty('--pc', pc);
    if (pc && pc2) wrap.style.setProperty('--pc2', pc2);
    // Нет ни своего цвета, ни баннера: карточка красится в цвета аватарки (градиент из двух главных цветов).
    if (!pc && !banner && u.avatar && S.settings.autoColorOthers) {
      C.palette.fromUrl(u.avatar).then((p) => {
        if (!p || p.gray || !p.accent) return;
        const c1 = C.palette.toHex(C.palette.fit(p.accent, 'dark'));
        const c2 = C.palette.toHex(C.palette.fit(p.accent2, 'dark'));
        bg.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
        wrap.style.setProperty('--pc', c1);
        wrap.style.setProperty('--pc2', c2);
      });
    }
    if (fx) {
      // Эффект запускается, когда карточка появилась на странице, и сам останавливается, когда её убрали.
      requestAnimationFrame(() => {
        const run = C.particles(fx, u.effect, { count: 36, color: u.effect === 'sparkles' || u.effect === 'stars' ? pc || '#ffffff' : undefined });
        const stopWhenGone = setInterval(() => { if (!fx.isConnected) { run.stop(); clearInterval(stopWhenGone); } }, 1000);
      });
    }
    return wrap;
  }

  function openProfileCard(u) {
    const card = profileCardNode(u);
    if (S.conn && u.sid && u.sid !== S.conn.sid && u.uid) {
      const blocked = S.blocked.has(u.uid);
      card.append(h('div', { class: 'profile-body', style: { marginTop: '0', paddingBottom: '16px', position: 'relative', zIndex: 6 } },
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', onclick: () => { dlg.close(); openDm(u.uid); } }, '{{ic:mail}} Написать'),
          h('button', { class: 'btn', onclick: () => { dlg.close(); toggleBlock(u.uid, u.name); } }, blocked ? 'Разблокировать' : '{{ic:block}} Скрыть у себя'),
          // Владелец назначает модераторов и блокирует, модератор может исключить.
          S.conn.owner && !u.host ? h('button', { class: 'btn', onclick: () => { S.conn.send({ t: 'mod-set', sid: u.sid, on: !u.mod }); dlg.close(); } }, u.mod ? '{{ic:shield}} Снять модератора' : '{{ic:shield}} Сделать модератором') : null,
          canKick(u) ? h('button', { class: 'btn', onclick: () => { S.conn.send({ t: 'kick', sid: u.sid }); dlg.close(); } }, 'Выгнать') : null,
          S.conn.owner ? h('button', { class: 'btn danger', onclick: () => {
            if (confirm(`Заблокировать ${u.name} в комнате? Он не сможет войти снова.`)) { S.conn.send({ t: 'kick', sid: u.sid, ban: true }); dlg.close(); }
          } }, 'Бан') : null)));
    }
    const dlg = modal(card, { cls: 'profile-modal' });
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
    const s = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, C.stripIcons(l))));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function range(label, min, max, step, value, fmt, onInput) {
    const lbl = h('label', { class: 'lbl' }, `${label}: ${fmt(value)}`);
    const r = h('input', { type: 'range', min, max, step, value });
    r.addEventListener('input', () => { lbl.textContent = `${label}: ${fmt(Number(r.value))}`; onInput(Number(r.value)); });
    return h('div', null, lbl, r);
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

  // Цвет с кнопкой «нет»: пустая строка означает «не задан».
  function colorPick(label, draft, key, fallback, onChange) {
    const c = h('input', { type: 'color', value: HEX.test(draft[key] || '') ? draft[key] : fallback });
    const state = h('span', { class: 'hint' }, HEX.test(draft[key] || '') ? draft[key] : 'не задан');
    c.addEventListener('input', () => { draft[key] = c.value; state.textContent = c.value; onChange(); });
    return h('div', null, h('label', { class: 'lbl' }, label), h('div', { class: 'row' }, c, h('button', { class: 'btn', onclick: () => { draft[key] = ''; state.textContent = 'не задан'; onChange(); } }, 'Сбросить'), state));
  }

  function sectionProfile(redraw) {
    const draft = S.profileDraft || { ...PROFILE_DEFAULTS, ...S.profile, badges: [...(S.profile.badges || [])], links: (S.profile.links || []).map((l) => ({ ...l })) };
    S.profileDraft = draft;
    const tab = S.profileTab || 'main';
    const preview = h('div', { class: 'preview' });
    const update = () => preview.replaceChildren(profileCardNode({ ...draft, sid: '', status: S.status === 'invisible' ? 'offline' : wireStatus(), activity: S.activity }, { live: false }),
      h('div', { class: 'preview-row' }, h('div', { class: 'hint' }, 'В списке участников:'), memberRow({ ...draft, sid: '', status: 'online', activity: null })));
    const text = (key, max, placeholder) => {
      const i = h('input', { class: 'input', value: draft[key] || '', maxLength: max, placeholder: placeholder || '' });
      i.addEventListener('input', () => { draft[key] = i.value; update(); });
      return i;
    };
    const tabs = h('div', { class: 'tabs sub-tabs' }, [['main', 'Основное'], ['style', 'Оформление'], ['card', 'Карточка'], ['badges', 'Значки и ссылки']].map(([id, label]) =>
      h('div', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { S.profileTab = id; redraw(); } }, label)));
    let body;
    if (tab === 'main') {
      const bio = h('textarea', { class: 'input', rows: 3, maxLength: 190, value: draft.bio || '' });
      bio.addEventListener('input', () => { draft.bio = bio.value; update(); });
      body = h('div', null,
        field('Имя', text('name', 32)),
        h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Тег (до 4 символов)', text('tag', 4, 'CRS'))), h('div', { class: 'grow' }, field('Местоимения', text('pronouns', 24)))),
        field('Статус-фраза', text('custom', 60, 'Например: не беспокоить')),
        field('О себе', bio, 'Можно **жирный**, *курсив*, ||спойлер||.'),
        urlField('Аватар (ссылка)', 'avatar', draft, 'Картинку загружает у друга его клиент по этой ссылке. GIF тоже можно.', update),
        field('Статус', select(STATUSES.map(([id, ic, l]) => [id, `${ic} ${l}`]), S.status, (v) => { setStatus(v); update(); })));
    } else if (tab === 'style') {
      body = h('div', null,
        h('label', { class: 'lbl' }, 'Рамка аватара'), chips(FRAMES, draft.frame, (v) => { draft.frame = v; update(); }),
        urlField('Своя рамка аватара (ссылка)', 'frameUrl', draft, 'PNG, GIF или WebP с прозрачным центром. Рисуется поверх аватара и чуть больше его.', update),
        h('label', { class: 'lbl' }, 'Эффект имени'), chips(NAME_FX, draft.nameFx, (v) => { draft.nameFx = v; update(); }),
        h('label', { class: 'lbl' }, 'Шрифт имени'), chips(NAME_FONTS, draft.nameFont, (v) => { draft.nameFont = v; update(); }),
        h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, colorPick('Цвет имени', draft, 'nameColor', S.settings.accent, update)),
          h('div', { class: 'grow' }, colorPick('Второй цвет имени (градиент)', draft, 'nameColor2', '#ffffff', update))),
        h('div', { class: 'hint' }, 'Эффект имени важнее цвета: чтобы был виден свой цвет, выберите «Обычное».'),
        h('label', { class: 'lbl' }, 'Табличка в списке участников'), chips(PLATES, draft.plate, (v) => { draft.plate = v; update(); }),
        urlField('Своя табличка (ссылка на картинку)', 'plateUrl', draft, 'Широкая картинка или GIF за вашим именем в списке участников.', update));
    } else if (tab === 'card') {
      body = h('div', null,
        h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, colorPick('Цвет профиля', draft, 'color', S.settings.accent, update)),
          h('div', { class: 'grow' }, colorPick('Второй цвет (градиент карточки)', draft, 'color2', '#120407', update))),
        h('label', { class: 'lbl' }, 'Стиль карточки'), chips(CARD_STYLES, draft.cardStyle, (v) => { draft.cardStyle = v; update(); }),
        h('label', { class: 'lbl' }, 'Эффект профиля'), chips(EFFECTS, draft.effect, (v) => { draft.effect = v; update(); }),
        urlField('Баннер (ссылка)', 'banner', draft, 'Подойдёт и GIF.', update), urlField('Фон профиля (ссылка)', 'bg', draft, 'Подойдёт и GIF.', update),
        urlField('Рамка карточки профиля (ссылка)', 'cardFrame', draft, 'Картинка с прозрачной серединой, растягивается на всю карточку.', update));
    } else {
      const badgeBox = h('div', { class: 'badge-pick' });
      const drawBadges = () => badgeBox.replaceChildren(...Object.entries(BADGES).map(([id, [ic, label]]) => {
        const on = draft.badges.includes(id);
        return h('div', { class: 'chip' + (on ? ' on' : ''), onclick: () => {
          if (on) draft.badges = draft.badges.filter((x) => x !== id);
          else if (draft.badges.length < 6) draft.badges = [...draft.badges, id];
          else C.toast('Не больше шести значков');
          drawBadges(); update();
        } }, `${ic} ${label}`);
      }));
      drawBadges();
      const linkRows = h('div');
      const drawLinks = () => linkRows.replaceChildren(...[0, 1, 2].map((i) => {
        const l = draft.links[i] || { label: '', url: '' };
        const a = h('input', { class: 'input', value: l.label, maxLength: 20, placeholder: 'Подпись (Steam, Twitch…)' });
        const b = h('input', { class: 'input', value: l.url, maxLength: 120, placeholder: 'Ссылка или ник' });
        const sync = () => { draft.links[i] = { label: a.value, url: b.value }; draft.links = draft.links.filter(Boolean); update(); };
        a.addEventListener('input', sync); b.addEventListener('input', sync);
        return h('div', { class: 'row', style: { marginBottom: '6px' } }, h('div', { style: { width: '40%' } }, a), h('div', { class: 'grow' }, b));
      }));
      drawLinks();
      body = h('div', null, h('label', { class: 'lbl' }, 'Значки (до шести)'), badgeBox,
        h('label', { class: 'lbl' }, 'Ссылки в профиле'), linkRows,
        h('div', { class: 'hint' }, 'Ссылки не открываются по клику, а копируются: так никто не узнает ваш IP через подставную ссылку.'));
    }
    const save = h('div', { class: 'row', style: { marginTop: '20px' } }, h('button', { class: 'btn primary', onclick: () => {
      S.profile = {
        ...PROFILE_DEFAULTS, ...draft, name: (draft.name || '').trim() || 'Игрок', tag: (draft.tag || '').trim().slice(0, 4),
        avatar: C.safeUrl(draft.avatar) || '', banner: C.safeUrl(draft.banner) || '', bg: C.safeUrl(draft.bg) || '',
        frameUrl: C.safeUrl(draft.frameUrl) || '', cardFrame: C.safeUrl(draft.cardFrame) || '', plateUrl: C.safeUrl(draft.plateUrl) || '',
        links: (draft.links || []).filter((l) => l && (l.label || l.url)).slice(0, 3),
      };
      saveProfile();
      S.profileDraft = null;
      refreshPalette();
      if (S.conn) S.conn.send({ t: 'profile', ...profileFields(S.profile) });
      renderAll();
      C.toast('Профиль сохранён');
    } }, 'Сохранить'), h('button', { class: 'btn', onclick: () => { S.profileDraft = null; redraw(); } }, 'Отменить изменения'));
    update();
    return h('div', null, h('h2', null, 'Мой профиль'), tabs, h('div', { class: 'editor' }, h('div', { class: 'form' }, body, save), preview));
  }

  function sectionVoice(redraw) {
    const mic = h('div'); const spk = h('div'); const cam = h('div');
    const fillDevices = async () => {
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const opt = (kind) => [['default', 'По умолчанию'], ...devs.filter((d) => d.kind === kind && d.deviceId !== 'default').map((d) => [d.deviceId, d.label || 'Устройство'])];
      mic.replaceChildren(select(opt('audioinput'), S.settings.micId, (v) => { S.settings.micId = v; saveSettings(); }));
      spk.replaceChildren(select(opt('audiooutput'), S.settings.speakerId, (v) => { S.settings.speakerId = v; saveSettings(); }));
      cam.replaceChildren(select(opt('videoinput'), S.settings.cameraId || 'default', (v) => { S.settings.cameraId = v; saveSettings(); }));
    };
    fillDevices();
    const profile = S.settings.voiceProfile;
    const meter = micMeter();
    const radios = [['isolation', 'Изоляция голоса', 'Убирает шум и эхо, выравнивает громкость'], ['studio', 'Студия', 'Чистый звук без обработки'], ['custom', 'Пользовательский', 'Выберите обработку вручную']];
    return h('div', null, h('h2', null, 'Голос и видео'),
      h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Микрофон', mic)), h('div', { class: 'grow' }, field('Динамик', spk))),
      field('Камера', cam),
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
      range('Качество звука', 32, 510, 2, S.settings.audioKbps, (v) => `${v} кбит/с, стерео Opus`, (v) => { S.settings.audioKbps = v; saveSettings(); }),
      h('div', { class: 'hint' }, 'Применяется при следующем входе в голосовой канал. 128 — отлично для голоса, 256 и выше — для музыки.'),
      h('label', { class: 'lbl' }, 'Шумовой порог'),
      switchRow('Не передавать звук тише порога', S.settings.gateDb != null, (v) => { S.settings.gateDb = v ? -50 : null; saveSettings(); if (S.voice) S.voice.applyGate(); redraw(); },
        'Клавиатура, вентилятор и фон не слышны, пока вы молчите. Сдвиньте порог так, чтобы полоска переходила его только когда вы говорите.'),
      S.settings.gateDb != null ? range('Порог', -80, -10, 1, S.settings.gateDb, (v) => v + ' дБ', (v) => { S.settings.gateDb = v; saveSettings(); if (S.voice) S.voice.applyGate(); meter.setThreshold(v); }) : null,
      meter.node,
      h('label', { class: 'lbl' }, 'Глобальные клавиши'),
      switchRow('Работают и когда окно свёрнуто (например, в игре)', S.settings.hotkeysGlobal, (v) => { S.settings.hotkeysGlobal = v; saveSettings(); applyGlobalHotkeys(true); }),
      h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Микрофон вкл/выкл', hotkeyInput('hotMute'))), h('div', { class: 'grow' }, field('Звук вкл/выкл', hotkeyInput('hotDeafen')))),
      h('div', { class: 'hint' }, 'Нажмите в поле нужное сочетание (с Ctrl, Alt или Shift, либо F1–F24). Backspace — убрать.'));
  }

  // Полоска уровня микрофона с отметкой порога. В голосе берёт уровень из канала, иначе включает проверку на 20 секунд.
  function micMeter() {
    const fill = h('i');
    const mark = h('b');
    const label = h('span', { class: 'hint' }, '');
    let test = null; let raf = 0; let until = 0;
    const node = h('div', { class: 'mic-meter' }, h('div', { class: 'mm-bar' }, fill, mark), h('div', { class: 'row' }, label,
      h('button', { class: 'btn', onclick: async () => {
        if (S.voice && S.voice.inChannel) return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.settings.micId !== 'default' ? { exact: S.settings.micId } : undefined } });
          const ctx = new AudioContext();
          const an = ctx.createAnalyser();
          an.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(an);
          test = { stream, ctx, an, data: new Float32Array(1024) };
          until = Date.now() + 20000;
        } catch (e) { C.toast('Нет доступа к микрофону'); }
      } }, 'Проверить микрофон')));
    const pos = (db) => Math.max(0, Math.min(100, ((db + 90) / 90) * 100));
    const setThreshold = (db) => { mark.style.left = pos(db) + '%'; mark.style.display = db == null ? 'none' : ''; };
    setThreshold(S.settings.gateDb);
    const stopTest = () => { if (test) { test.stream.getTracks().forEach((t) => t.stop()); test.ctx.close().catch(() => {}); test = null; } };
    const tick = () => {
      if (!node.isConnected) { stopTest(); return; }
      raf = requestAnimationFrame(tick);
      let db = null;
      if (S.voice && S.voice.micLevel) db = S.voice.micLevel.db;
      else if (test) {
        test.an.getFloatTimeDomainData(test.data);
        let s = 0; for (const v of test.data) s += v * v;
        db = 10 * Math.log10(s / test.data.length + 1e-12);
        if (Date.now() > until) stopTest();
      }
      fill.style.width = db == null ? '0%' : pos(db) + '%';
      const open = db != null && (S.settings.gateDb == null || db > S.settings.gateDb);
      fill.classList.toggle('open', open);
      label.textContent = db == null ? (S.voice && S.voice.inChannel ? '' : 'Нажмите «Проверить микрофон» и скажите что-нибудь') : `${Math.round(db)} дБ ${open ? '— передаётся' : '— тишина'}`;
    };
    raf = requestAnimationFrame(tick);
    return { node, setThreshold };
  }

  // Поле, которое запоминает нажатое сочетание клавиш в формате Electron (Control+Shift+M).
  function keyName(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^(F\d{1,2})$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return 'num' + m[1];
    return null;
  }
  function hotkeyInput(key) {
    const i = h('input', { class: 'input hotkey', value: S.settings[key] || '', placeholder: 'не задано', readOnly: true });
    i.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { i.blur(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { S.settings[key] = ''; i.value = ''; saveSettings(); applyGlobalHotkeys(); return; }
      const k = keyName(e.code);
      if (!k) return;
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
      if (!mods.length && !/^F\d+$/.test(k)) { C.toast('Нужен Ctrl, Alt или Shift (или клавиша F1–F24)'); return; }
      S.settings[key] = [...mods, k].join('+');
      i.value = S.settings[key];
      saveSettings();
      applyGlobalHotkeys(true);
    });
    return i;
  }

  async function applyGlobalHotkeys(report) {
    const s = S.settings;
    const list = s.hotkeysGlobal ? [{ id: 'mute', accel: s.hotMute }, { id: 'deafen', accel: s.hotDeafen }].filter((x) => x.accel) : [];
    const ok = await native.setGlobalHotkeys(list).catch(() => []);
    if (report && list.length && ok.length < list.length) C.toast('Часть сочетаний занята другой программой, выберите другие');
  }

  // Короткий сигнал при переключении микрофона глобальной клавишей: в игре окна не видно.
  function beep(freq) {
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.14);
    } catch (e) { /* звук недоступен */ }
  }

  function onHotkey(id) {
    const v = S.voice;
    if (!v || !v.inChannel) return;
    if (id === 'mute') { v.setMuted(!v.muted); beep(v.muted ? 330 : 660); }
    if (id === 'deafen') { v.setDeafened(!v.deafened); beep(v.deafened ? 260 : 720); }
  }

  function sectionStream() {
    return h('div', null, h('h2', null, 'Стриминг'),
      field('Разрешение', select([[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']], S.settings.screenRes, (v) => { S.settings.screenRes = Number(v); saveSettings(); })),
      field('Кадров в секунду', select([[15, '15'], [30, '30'], [60, '60'], [120, '120']], S.settings.screenFps, (v) => { S.settings.screenFps = Number(v); saveSettings(); })),
      field('Битрейт', select([[3, '3 Мбит/с'], [6, '6 Мбит/с'], [8, '8 Мбит/с'], [12, '12 Мбит/с'], [20, '20 Мбит/с'], [40, '40 Мбит/с']], S.settings.screenMbps, (v) => { S.settings.screenMbps = Number(v); saveSettings(); }),
        'Выше битрейт — лучше картинка, но нужна быстрая сеть. Для зрителей в той же локальной сети битрейт поднимается сам (Настройки → Сеть).'),
      field('Что важнее', select([['detail', 'Чёткость (текст, интерфейсы)'], ['fps', 'Плавность (игры)']], S.settings.screenPrefer, (v) => { S.settings.screenPrefer = v; saveSettings(); })),
      switchRow('Передавать звук экрана', S.settings.screenAudio, (v) => { S.settings.screenAudio = v; saveSettings(); }, 'Работает на Windows: звук системы целиком.'));
  }

  // ---------- Цвета из аватарки ----------
  // Акцент выбирается так: цвет трека («Цвет под музыку») важнее всего, затем цвет из своей аватарки, затем выбранный вручную.
  // Второй цвет аватарки идёт в градиенты (кнопки, фон, рамки, баннеры); без него градиенты строятся из оттенков акцента.
  function applyAccentColors(mode) {
    const s = S.settings;
    const m = mode || document.body.dataset.mode || 'dark';
    const p = S.palette;
    if (S.accentOverride) { C.applyAccent(S.accentOverride, null); return; }
    if (s.autoColor && p && !p.gray && p.accent) {
      const a = C.palette.fit(p.accent, m);
      const b = s.autoGradient && p.accent2 ? C.palette.fit(p.accent2, m) : null;
      C.applyAccent(C.palette.toHex(a), b ? C.palette.toHex(b) : null, b ? C.palette.toHex(C.palette.deep(p.accent2, m)) : null);
      return;
    }
    C.applyAccent(s.accent, null);
  }

  // Считает палитру своей аватарки. Последний результат запоминается: при запуске цвета появляются сразу, без вспышки.
  async function refreshPalette() {
    const url = C.safeUrl(S.profile.avatar);
    if (!S.settings.autoColor || !url) { S.palette = null; applyAccentColors(); renderPaletteSwatches(); return; }
    const cached = store.get('palette', null);
    if (cached && cached.url === url && !S.palette) { S.palette = cached.p; applyAccentColors(); }
    const p = await C.palette.fromUrl(url);
    if (C.safeUrl(S.profile.avatar) !== url) return; // аватарку успели сменить
    S.palette = p;
    if (p) store.set('palette', { url, p }); else store.set('palette', null);
    applyAccentColors();
    renderPaletteSwatches();
  }

  function renderPaletteSwatches() {
    const box = document.getElementById('palette-swatches');
    if (!box) return;
    const p = S.palette;
    box.replaceChildren(...(p && p.colors.length ? p.colors.map((c) => h('span', { class: 'pal-swatch', title: C.palette.toHex(c.rgb), style: { background: C.palette.toHex(c.rgb) } })) : [h('span', { class: 'hint' }, S.profile.avatar ? 'Из этой аватарки цвет подобрать не вышло (она серая или не загрузилась)' : 'Сначала задайте аватарку в профиле')]));
  }

  // ---------- Внешний вид ----------
  function applyLook() {
    const s = S.settings;
    const b = document.body;
    b.dataset.design = s.design;
    const mode = s.mode === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.mode;
    b.dataset.mode = mode;
    b.style.setProperty('--fs', Math.min(20, Math.max(11, s.fontSize)) + 'px');
    if (s.round == null) b.style.removeProperty('--round'); else b.style.setProperty('--round', String(s.round));
    b.style.setProperty('--av-r', { circle: '50%', squircle: '32%', square: '14%' }[s.avatarShape] || '50%');
    const fonts = { system: "'Segoe UI', system-ui, sans-serif", inter: "'Inter', 'Segoe UI', sans-serif", roboto: "'Roboto Flex', 'Segoe UI', sans-serif",
      serif: "'Source Serif 4', Georgia, serif", mono: "Consolas, 'Cascadia Mono', monospace" };
    for (const v of ['--font', '--font-head', '--font-msg']) { if (fonts[s.font]) b.style.setProperty(v, fonts[s.font]); else b.style.removeProperty(v); }
    b.classList.remove('dense-compact', 'dense-cozy', 'dense-spacious', 'msgs-list', 'msgs-bubbles', 'msgs-compact');
    b.classList.add('dense-' + s.density, 'msgs-' + s.msgStyle);
    b.classList.toggle('gif-hover', !!s.gifHover);
    // Фон приложения по ссылке: с затемнением и размытием, чтобы текст оставался читаемым.
    let bg = document.getElementById('app-bg');
    const url = C.safeUrl(s.appBg);
    if (url) {
      if (!bg) { bg = h('div', { id: 'app-bg' }); document.body.prepend(bg); }
      bg.replaceChildren();
      bg.style.backgroundImage = isVideoUrl(url) ? '' : `url("${url}")`;
      if (isVideoUrl(url)) bg.append(C.media(url, 'bg-media'));
      bg.style.setProperty('--dim', String(s.appBgDim / 100));
      bg.style.setProperty('--blur', s.appBgBlur + 'px');
      b.classList.add('has-app-bg');
    } else { if (bg) bg.remove(); b.classList.remove('has-app-bg'); }
    let qc = document.getElementById('quick-css');
    if (!qc) { qc = h('style', { id: 'quick-css' }); document.head.append(qc); }
    qc.textContent = s.quickCss || '';
    applyAccentColors(mode);
    // Кнопки окна (свернуть, закрыть) красятся под тему.
    requestAnimationFrame(() => {
      const tb = document.getElementById('titlebar');
      if (!tb || !native.setTitleBar) return;
      const cs = getComputedStyle(tb);
      native.setTitleBar({ color: opaque(cs.backgroundColor, mode), symbolColor: opaque(cs.color, mode) }).catch(() => {});
    });
  }

  // Цвет кнопок окна должен быть непрозрачным: полупрозрачный смешиваем с фоном режима.
  function opaque(color, mode) {
    const m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return mode === 'light' ? '#f4f3f6' : '#0a0305';
    const [r, g, b, a = 1] = m[1].split(',').map((x) => Number(x.trim()));
    const base = mode === 'light' ? [244, 243, 246] : [16, 16, 22];
    const mix = [r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a)));
    return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  function sectionLook(redraw) {
    const s = S.settings;
    requestAnimationFrame(() => renderPaletteSwatches());
    const set = (k, v, re) => { s[k] = v; saveSettings(); applyLook(); if (re) redraw(); };
    const color = h('input', { type: 'color', value: s.accent });
    color.addEventListener('input', () => { s.accent = color.value; saveSettings(); applyLook(); });
    const designCards = h('div', { class: 'design-grid' }, DESIGNS.map(([id, name, desc, accent, mode]) =>
      h('div', { class: 'design-card' + (s.design === id ? ' on' : ''), dataset: { d: id }, onclick: () => {
        s.design = id; s.accent = accent; s.mode = mode; s.round = null;
        saveSettings(); applyLook(); redraw();
      } }, h('div', { class: 'design-thumb', dataset: { d: id } }, h('i'), h('i'), h('i'), h('b', { style: { background: accent } })),
      h('div', { class: 'design-name' }, name), h('div', { class: 'hint' }, desc))));
    const bgDraft = { appBg: s.appBg };
    const quick = h('textarea', { class: 'input code', rows: 6, value: s.quickCss, placeholder: '/* Свой CSS, применяется сразу. Например:\n.msg .text { font-size: 15px; } */' });
    quick.addEventListener('input', () => { s.quickCss = quick.value; saveSettings(); applyLook(); });
    return h('div', null, h('h2', null, 'Внешний вид'),
      h('label', { class: 'lbl' }, 'Дизайн'), designCards,
      h('div', { class: 'row wrap', style: { marginTop: '6px' } },
        h('div', { class: 'grow' }, h('label', { class: 'lbl' }, 'Режим'), chips([['dark', '{{ic:moon}} Тёмный'], ['light', '{{ic:sun}} Светлый'], ['auto', '{{ic:screen}} Как в системе']], s.mode, (v) => set('mode', v)))),
      h('label', { class: 'lbl' }, 'Цвет акцента'),
      h('div', { class: 'row wrap' }, color, ...ACCENTS.map((c) => h('button', { class: 'swatch' + (c === s.accent ? ' on' : ''), style: { background: c }, title: c,
        onclick: () => { s.accent = c; saveSettings(); applyLook(); redraw(); } }))),
      h('label', { class: 'lbl' }, 'Цвета из аватарки'),
      switchRow('Подбирать цвет интерфейса по моей аватарке', s.autoColor, (v) => { s.autoColor = v; saveSettings(); refreshPalette(); redraw(); }, s.autoColor ? 'Сейчас акцент берётся из аватарки, цвет выше действует, когда это выключено или аватарки нет.' : 'Акцент берётся из цвета выше.'),
      switchRow('Градиенты из двух цветов аватарки', s.autoGradient, (v) => { s.autoGradient = v; saveSettings(); applyLook(); }, 'Второй цвет аватарки идёт в кнопки, фон, рамки и баннеры. Выключено — градиенты из оттенков одного цвета.'),
      switchRow('Красить карточки профилей по их аватаркам', s.autoColorOthers, (v) => { s.autoColorOthers = v; saveSettings(); }, 'Если у человека нет своего цвета и баннера, его карточка красится в цвета его аватарки. Свои цвета и баннер всегда важнее.'),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('div', { id: 'palette-swatches', class: 'pal-row' }), h('button', { class: 'btn', onclick: () => { S.palette = null; refreshPalette(); } }, 'Пересчитать')),
      h('div', { class: 'row wrap' },
        h('div', { class: 'grow' }, field('Шрифт', select([['design', 'Как в дизайне'], ['system', 'Системный'], ['inter', 'Inter'], ['roboto', 'Roboto Flex'], ['serif', 'Source Serif'], ['mono', 'Моноширинный']], s.font, (v) => set('font', v)))),
        h('div', { class: 'grow' }, range('Размер текста', 11, 20, 1, s.fontSize, (v) => v + ' px', (v) => set('fontSize', v)))),
      range('Скругление углов', 0, 2.5, 0.05, s.round == null ? 1 : s.round, (v) => (s.round == null ? 'как в дизайне' : Math.round(v * 100) + '%'), (v) => set('round', v)),
      h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { class: 'btn', onclick: () => set('round', null, true) }, 'Скругление как в дизайне')),
      h('label', { class: 'lbl' }, 'Плотность'), chips([['compact', 'Плотно'], ['cozy', 'Обычно'], ['spacious', 'Просторно']], s.density, (v) => set('density', v)),
      h('label', { class: 'lbl' }, 'Сообщения'), chips([['list', 'Список'], ['bubbles', 'Пузыри'], ['compact', 'Компактно (в строку)']], s.msgStyle, (v) => set('msgStyle', v)),
      h('label', { class: 'lbl' }, 'Форма аватаров'), chips([['circle', '● Круг'], ['squircle', '▢ Скруглённый квадрат'], ['square', '■ Квадрат']], s.avatarShape, (v) => set('avatarShape', v)),
      switchRow('Собирать подряд идущие сообщения в группу', s.groupMessages, (v) => { set('groupMessages', v); refreshMessages(); }),
      switchRow('Показывать список участников', s.showMembers, (v) => { set('showMembers', v); renderRight(); }),
      switchRow('24-часовое время', s.clock24, (v) => { set('clock24', v); refreshMessages(); }),
      switchRow('Анимировать GIF только при наведении', s.gifHover, (v) => set('gifHover', v), 'Экономит видеокарту. По умолчанию анимации играют всегда.'),
      h('label', { class: 'lbl' }, 'Фон приложения'),
      urlField('Картинка или GIF (ссылка)', 'appBg', bgDraft, 'Лежит под всеми панелями. Только проверенные сайты.', () => { if (!bgDraft.appBg || C.safeUrl(bgDraft.appBg)) set('appBg', C.safeUrl(bgDraft.appBg) || ''); }),
      h('div', { class: 'row wrap' },
        h('div', { class: 'grow' }, range('Затемнение', 0, 90, 1, s.appBgDim, (v) => v + '%', (v) => set('appBgDim', v))),
        h('div', { class: 'grow' }, range('Размытие', 0, 30, 1, s.appBgBlur, (v) => v + ' px', (v) => set('appBgBlur', v)))),
      h('label', { class: 'lbl' }, 'Эффекты'),
      switchRow('Свечение за курсором', s.cursorGlow, (v) => set('cursorGlow', v), 'Мягкий градиент плавно следует за мышью. В дизайнах без свечения не показывается.'),
      range('Яркость свечения', 0, 100, 1, s.glowPower, (v) => v + '%', (v) => { s.glowPower = v; saveSettings(); }),
      switchRow('Анимации интерфейса', s.animations, (v) => { set('animations', v); applyAnimations(); }, 'Плавные появления, наведения и пульсации.'),
      h('label', { class: 'lbl' }, 'Свой CSS'),
      h('div', { class: 'hint' }, 'Как Quick CSS в Vencord: пишите стили, они применяются сразу.'), quick,
      h('label', { class: 'lbl' }, 'CSS-темы'),
      h('div', { class: 'hint' }, 'Как в Vencord: положите .css файл в папку тем, включите здесь. Тема ложится поверх дизайна.'),
      h('div', { class: 'row', style: { margin: '10px 0' } },
        h('button', { class: 'btn', onclick: () => native.openFolder('themes') }, 'Открыть папку тем'),
        h('button', { class: 'btn', onclick: async () => { await C.themes.refresh(); redraw(); } }, 'Обновить')),
      ...(C.themes.list.length ? C.themes.list.map((t) => {
        const on = C.store.get('themes.active', []).includes(t.id);
        return h('div', { class: 'list-item' }, h('div', { class: 'info' }, h('div', null, t.name), h('div', { class: 'sub' }, t.description || t.id)),
          switchRow('', on, (v) => C.themes.toggle(t.id, v)).firstChild);
      }) : [h('div', { class: 'hint' }, 'Тем пока нет.')]),
      h('div', { class: 'row', style: { marginTop: '20px' } }, h('button', { class: 'btn danger', onclick: () => {
        if (!confirm('Вернуть вид по умолчанию?')) return;
        for (const k of ['design', 'mode', 'accent', 'font', 'fontSize', 'round', 'density', 'msgStyle', 'avatarShape', 'appBg', 'appBgDim', 'appBgBlur', 'quickCss', 'gifHover', 'groupMessages']) s[k] = DEFAULTS[k];
        saveSettings(); applyLook(); redraw();
      } }, 'Сбросить вид')));
  }

  // ---------- Плагины ----------
  function pluginSettingsForm(p) {
    const st = C.plugins.settingsOf(p.info.id);
    if (!st || !st.schema.length) return null;
    return h('div', { class: 'plugin-settings' }, st.schema.map((f) => {
      const v = st.values[f.key];
      if (f.type === 'switch') return switchRow(f.label, !!v, (x) => st.set(f.key, x), f.hint);
      if (f.type === 'select') return field(f.label, select(f.options, v, (x) => st.set(f.key, typeof f.default === 'number' ? Number(x) : x)), f.hint);
      if (f.type === 'range') return h('div', null, range(f.label, f.min, f.max, f.step || 1, v, (x) => `${x}${f.unit || ''}`, (x) => st.set(f.key, x)), f.hint ? h('div', { class: 'hint' }, f.hint) : null);
      if (f.type === 'color') { const c = h('input', { type: 'color', value: v }); c.addEventListener('input', () => st.set(f.key, c.value)); return field(f.label, c, f.hint); }
      const i = h('input', { class: 'input', value: v == null ? '' : v, maxLength: f.max || 200, placeholder: f.placeholder || '' });
      i.addEventListener('change', () => st.set(f.key, i.value));
      return field(f.label, i, f.hint);
    }));
  }

  // Перенос из BetterDiscord и Vencord: какие плагины у вас были включены и чем они стали здесь.
  function migrationPlan(sources) {
    const map = C.pluginOrigins || {};
    const rows = [];
    const toEnable = new Set();
    const settings = []; // [{plugin, values}]
    for (const src of sources) {
      for (const name of src.enabled) {
        const t = map[name];
        if (!t) continue;
        if (t.plugin && !t.optional) toEnable.add(t.plugin);
        if (t.settings && src.settings && src.settings[name]) { try { settings.push({ plugin: t.plugin, values: t.settings(src.settings[name]) || {} }); } catch (e) { /* чужой формат */ } }
        rows.push({ src: src.app, name, t });
      }
    }
    return { rows, toEnable, settings };
  }

  // Значения из чужих настроек проверяются по схеме нашего плагина: тип, пределы, допустимые варианты.
  function applyPluginSettings(id, values) {
    const st = C.plugins.settingsOf(id);
    if (!st) return 0;
    let n = 0;
    for (const f of st.schema) {
      let v = values[f.key];
      if (v === undefined || v === null) continue;
      if (f.type === 'switch') { if (typeof v !== 'boolean') continue; }
      else if (f.type === 'range') { if (!Number.isFinite(v)) continue; v = Math.max(f.min, Math.min(f.max, v)); }
      else if (f.type === 'select') { if (!f.options.some(([o]) => o === v)) continue; }
      else if (f.type === 'color') { if (!HEX.test(v)) continue; }
      else { if (typeof v !== 'string' || !v) continue; v = v.slice(0, f.max || 200); }
      st.set(f.key, v);
      n++;
    }
    return n;
  }

  async function applyMigration(plan) {
    for (const s of plan.settings) applyPluginSettings(s.plugin, s.values);
    for (const id of plan.toEnable) await C.plugins.toggle(id, true);
    // Плагины, которые уже работали, подхватывают перенесённые настройки.
    for (const s of plan.settings) { const e = C.plugins.plugins.find((p) => p.info.id === s.plugin); if (e && e.enabled && e.def.onSettings) { try { e.def.onSettings(); } catch (err) { /* ignore */ } } }
  }

  // Первый запуск на компьютере, где есть BetterDiscord или Vencord: переносим включённые плагины и их настройки сами.
  async function autoMigrate() {
    if (store.get('migrated')) return;
    store.set('migrated', Date.now());
    let sources = [];
    try { sources = await native.migrationScan(); } catch (e) { return; }
    if (!sources.length) return;
    const plan = migrationPlan(sources);
    if (!plan.toEnable.size) return;
    await applyMigration(plan);
    renderAll();
    C.toast(`Перенесены ваши плагины из ${[...new Set(sources.map((s) => s.app))].join(' и ')}: ${plan.toEnable.size}. Подробнее — Настройки → Плагины.`, 7000);
  }

  async function migrateDialog(redraw) {
    let sources = [];
    try { sources = await native.migrationScan(); } catch (e) { C.toast('Не удалось прочитать настройки'); return; }
    const plan = migrationPlan(sources);
    const { rows, toEnable } = plan;
    const seen = new Set();
    const uniq = rows.filter((r) => { const k = r.name; if (seen.has(k)) return false; seen.add(k); return true; });
    const icon = (t) => (t.optional ? '{{ic:check-box}}' : t.plugin ? '{{ic:check-circle}}' : t.native ? '{{ic:star}}' : '{{ic:minus}}');
    const pname = (id) => (C.plugins.plugins.find((p) => p.info.id === id) || { info: { name: id } }).info.name;
    const label = (t) => (t.optional ? `есть плагин «${pname(t.plugin)}», но сам не включается: он прячет чужое оформление профилей` : t.plugin ? `плагин «${pname(t.plugin)}»` : t.native ? 'уже встроено: ' + t.native : t.none);
    const themes = sources.flatMap((s) => s.themes || []);
    const dlg = modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, 'Перенос плагинов'),
      sources.length ? h('div', { class: 'hint' }, 'Найдено: ' + sources.map((s) => `${s.app} (${s.enabled.length} включено)`).join(', ') + '. Код чужих плагинов не копируется: их возможности сделаны заново под corsa-mess.')
        : h('div', { class: 'hint bad' }, 'BetterDiscord и Vencord на этом компьютере не найдены.'),
      h('div', { class: 'migrate-list' }, uniq.map((r) => h('div', { class: 'list-item' }, h('span', null, icon(r.t)),
        h('div', { class: 'info' }, h('div', null, r.name, h('span', { class: 'hint' }, ' · ' + r.src)), h('div', { class: 'sub' }, label(r.t)))))),
      themes.length ? h('div', { class: 'hint' }, `Темы Discord (${themes.join(', ')}) рассчитаны на устройство Discord и здесь не работают. Похожие темы уже есть: Translucence, Midnight, Galaxy.`) : null,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => dlg.close() }, 'Закрыть'),
        toEnable.size ? h('button', { class: 'btn primary', onclick: async () => {
          await applyMigration(plan);
          dlg.close(); redraw(); C.toast(`Включено плагинов: ${toEnable.size}, перенесены настройки: ${plan.settings.length}`);
        } }, `Включить ${toEnable.size} и перенести настройки`) : null)), { wide: false });
  }

  function sectionPlugins(redraw) {
    const q = (S.pluginQuery || '').toLowerCase();
    const search = h('input', { class: 'input', placeholder: 'Поиск плагина', value: S.pluginQuery || '' });
    search.addEventListener('input', () => { S.pluginQuery = search.value; const pos = search.selectionStart; redraw(); const ns = document.querySelector('.plugin-search .input'); if (ns) { ns.focus(); ns.selectionStart = ns.selectionEnd = pos; } });
    const match = (p) => !q || [p.info.name, p.info.description, p.info.origin].join(' ').toLowerCase().includes(q);
    const card = (p) => {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked: p.enabled });
      sw.addEventListener('change', async () => { await C.plugins.toggle(p.info.id, sw.checked); redraw(); });
      const open = S.pluginOpen === p.info.id;
      const form = open && p.enabled ? pluginSettingsForm(p) : null;
      const hasSettings = p.builtin && p.def && p.def.settings && p.def.settings.length;
      return h('div', { class: 'plugin-card' + (p.enabled ? ' on' : '') },
        h('div', { class: 'row' }, h('div', { class: 'info grow' }, h('div', { class: 'pname' }, p.info.name, p.info.version ? ' ' + p.info.version : ''),
          h('div', { class: 'sub' }, p.info.description + (p.info.author ? ' — ' + p.info.author : '')),
          p.info.origin ? h('div', { class: 'origin' }, 'по мотивам: ' + p.info.origin) : null,
          p.error ? h('div', { class: 'err' }, 'Ошибка: ' + p.error) : null),
        hasSettings ? h('button', { class: 'icon-btn' + (open ? ' on' : ''), title: 'Настройки плагина', disabled: !p.enabled, onclick: () => { S.pluginOpen = open ? null : p.info.id; redraw(); } }, '{{ic:gear}}') : null, sw),
        form);
    };
    const builtins = C.plugins.plugins.filter((p) => p.builtin && match(p));
    const groups = new Map();
    for (const p of builtins) { const k = p.info.category || 'Разное'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    const own = C.plugins.plugins.filter((p) => !p.builtin && match(p));
    return h('div', null, h('h2', null, 'Плагины'),
      h('div', { class: 'row wrap', style: { marginBottom: '12px' } },
        h('button', { class: 'btn primary', onclick: () => migrateDialog(redraw) }, '{{ic:share}} Перенести из BetterDiscord и Vencord'),
        h('div', { class: 'grow plugin-search' }, search)),
      h('div', { class: 'hint' }, `Встроенных: ${C.plugins.plugins.filter((p) => p.builtin).length}, включено: ${C.plugins.plugins.filter((p) => p.enabled).length}. Встроенные — часть приложения, их код открыт в src/builtin.`),
      ...[...groups].map(([name, list]) => h('div', null, h('label', { class: 'lbl' }, name), ...list.map(card))),
      h('label', { class: 'lbl' }, 'Свои плагины'),
      h('div', { class: 'banner-warn' }, 'Свой плагин — это код с полным доступом к приложению. Включайте только те, которым доверяете.'),
      h('div', { class: 'row', style: { marginBottom: '12px' } },
        h('button', { class: 'btn', onclick: () => native.openFolder('plugins') }, 'Открыть папку плагинов'),
        h('button', { class: 'btn', onclick: async () => { await C.plugins.refresh(); redraw(); } }, 'Обновить')),
      ...(own.length ? own.map(card) : [h('div', { class: 'hint' }, 'Своих плагинов нет.')]));
  }

  function sectionActivity() {
    return h('div', null, h('h2', null, 'Игры и активность'),
      switchRow('Показывать друзьям, во что я играю и что слушаю', S.shareActivity, (v) => C.plugins.appApi.setShareActivity(v)),
      h('div', { class: 'hint' }, 'Приложение слушает статусы Discord RPC на локальных каналах discord-ipc-N и сообщает друзьям, во что вы играете. Если настоящий Discord запущен, он занимает канал 0, и большинство игр говорят только с ним.'),
      h('div', { class: 'list-item', style: { marginTop: '14px' } }, h('div', { class: 'info' }, h('div', null, 'Сейчас'), h('div', { class: 'sub' }, S.activity ? activityLine(S.activity) : 'ничего не играет'))),
      switchRow('Узнавать название игры у Discord', S.settings.resolveNames, (v) => { S.settings.resolveNames = v; saveSettings(); native.presenceConfig({ resolveNames: v }); },
        'Игра присылает только числовой ID. Чтобы показать название, запрашивается публичная страница приложения на discord.com, при этом Discord видит ваш IP. Выключите — будет «Игра».'),
      h('div', { class: 'hint' }, 'Игры без Rich Presence определяются по запущенному процессу. Свои игры можно добавить в файл games.json в папке данных приложения: {"game.exe": "Название"}. Свою активность вручную и музыку включают плагины «Своя активность» и «Сейчас играет».'));
  }

  function sectionNotify() {
    return h('div', null, h('h2', null, 'Уведомления'),
      h('div', { class: 'hint' }, 'Всплывающие окна в правом нижнем углу, как в Steam. Нажмите на окно, чтобы открыть профиль. В статусе «Не беспокоить» окна не показываются.'),
      switchRow('Когда кто-то начинает играть', S.settings.notifyPlaying, (v) => { S.settings.notifyPlaying = v; saveSettings(); }),
      switchRow('Когда кто-то заходит в сеть или выключает невидимку', S.settings.notifyOnline, (v) => { S.settings.notifyOnline = v; saveSettings(); }),
      switchRow('Звук', S.settings.notifySound, (v) => { S.settings.notifySound = v; saveSettings(); }),
      h('label', { class: 'lbl' }, 'Сообщения'),
      field('Уведомлять о сообщениях в каналах', select([['mentions', 'Только упоминания и ответы мне'], ['all', 'Обо всех (кроме выключенных каналов)'], ['none', 'Никогда']], S.settings.notifyMessages, (v) => { S.settings.notifyMessages = v; saveSettings(); }),
        'Когда окно свёрнуто или в фоне — уведомление Windows и мигание на панели задач. Канал можно выключить правым кликом по нему.'),
      switchRow('Уведомлять о личных сообщениях', S.settings.notifyDm, (v) => { S.settings.notifyDm = v; saveSettings(); }),
      switchRow('Показывать текст сообщения в уведомлении', S.settings.notifyPreview, (v) => { S.settings.notifyPreview = v; saveSettings(); }, 'Выключите, если за экраном могут подсматривать.'),
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: () => native.notify({ title: 'corsa-mess', body: 'Так выглядит уведомление о сообщении', silent: true }) }, 'Показать уведомление Windows')),
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
      li('Картинки и ссылки грузятся только с проверенных сайтов, редиректы на чужие адреса блокируются, поэтому ваш IP не утекает. Ссылки в сообщениях не открываются, а копируются.'),
      li('Владелец комнаты может исключить или заблокировать участника. Сервер ограничивает число соединений и скорость сообщений.'),
      li('Поиск комнат в сети отвечает только компьютерам из той же сети, из интернета он не виден.'),
      li('Свой плагин — это код. Если файлы плагина изменятся после включения, он автоматически отключится.'),
      h('label', { class: 'lbl' }, 'Отпечаток вашего сервера'), own,
      h('div', { class: 'hint' }, 'Сверьте его с другом другим способом (в личной беседе), если хотите быть уверены, что подключаетесь именно к вам.'),
      h('label', { class: 'lbl' }, 'Запомненные серверы'), pinsBox);
  }

  function sectionNetwork() {
    const s = S.settings;
    const stun = h('input', { class: 'input', value: s.stun, placeholder: 'stun:stun.l.google.com:19302' });
    stun.addEventListener('change', () => { s.stun = stun.value.trim(); saveSettings(); });
    const ips = h('div', { class: 'hint' }, '…');
    native.lanIps().then((list) => ips.replaceChildren(...list.map((i) => h('div', null, `${i.name}: ${i.address} — ${{ lan: 'локальная сеть', vpn: 'VPN-сеть', virtual: 'виртуальный адаптер (друзья по нему не подключатся)', other: 'сеть' }[i.kind]}`)))).catch(() => { ips.textContent = 'недоступно'; });
    return h('div', null, h('h2', null, 'Сеть'),
      h('label', { class: 'lbl' }, 'Локальная сеть'),
      switchRow('Искать комнаты в моей сети', s.lanScan, (v) => { s.lanScan = v; saveSettings(); }, 'Комнаты друзей из той же сети (и из Radmin, ZeroTier, Hamachi) появляются на главной, код вводить не нужно.'),
      switchRow('Показывать мою комнату в сети', s.lanVisible, (v) => { s.lanVisible = v; saveSettings(); }, 'Действует при следующем запуске сервера. Видно название, замок и число участников.'),
      switchRow('Максимум качества в локальной сети', s.lanBoost, (v) => { s.lanBoost = v; saveSettings(); }, 'Если зритель подключён напрямую по локальной сети, показ экрана идёт с повышенным битрейтом.'),
      range('Битрейт экрана в локальной сети', 10, 80, 5, s.lanScreenMbps, (v) => v + ' Мбит/с', (v) => { s.lanScreenMbps = v; saveSettings(); }),
      switchRow('Переподключаться при обрыве', s.autoReconnect, (v) => { s.autoReconnect = v; saveSettings(); }, 'Если Wi-Fi моргнул, приложение само вернётся в тот же канал и в голос.'),
      switchRow('«Не на месте» через 10 минут без действий', s.autoIdle, (v) => { s.autoIdle = v; saveSettings(); }),
      h('label', { class: 'lbl' }, 'Сети этого компьютера'), ips,
      h('label', { class: 'lbl' }, 'Интернет'),
      field('Relay для интернет-моста', relayField(), 'По умолчанию bore.pub (общий публичный сервер с открытым исходным кодом bore). Можно указать свой bore-сервер без секрета: он должен принимать подключения на порту 7835.'),
      switchRow('Голос через интернет (STUN)', s.internetVoice, (v) => { s.internetVoice = v; saveSettings(); },
        'Если комната не в локальной сети, голос соединяется напрямую через роутеры с помощью публичных STUN-серверов Google и Cloudflare: они видят ваш IP, звук через них не идёт. В локальной сети и в общих VPN (Radmin, ZeroTier, Hamachi) STUN не используется. Не всегда выходит: если у обоих провайдер выдаёт общий адрес (CGNAT), нужен TURN или общая сеть.'),
      field('Свой STUN-сервер (необязательно)', stun, 'Например stun:stun.example.com:3478. Если задан, вместо серверов выше используется он.'),
      h('label', { class: 'lbl' }, 'TURN: запасной путь для голоса'),
      h('div', { class: 'hint' }, 'TURN пропускает звук через сервер, когда напрямую не выходит. Нужен свой сервер (например, coturn на недорогом VPS): общего бесплатного у приложения нет. Звук остаётся зашифрованным.'),
      h('div', { class: 'row wrap' },
        h('div', { class: 'grow' }, field('Адрес', turnField('turnUrl', 'turn:turn.example.com:3478'))),
        h('div', { class: 'grow' }, field('Логин', turnField('turnUser', ''))),
        h('div', { class: 'grow' }, field('Пароль', turnField('turnPass', '', true)))));
  }

  function relayField() {
    const i = h('input', { class: 'input', value: S.settings.bridgeRelay || 'bore.pub', placeholder: 'bore.pub', maxLength: 253 });
    i.addEventListener('change', () => {
      const v = i.value.trim().toLowerCase() || 'bore.pub';
      if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(v)) { C.toast('Некорректный адрес relay'); i.value = S.settings.bridgeRelay; return; }
      S.settings.bridgeRelay = v; saveSettings();
    });
    return i;
  }

  function turnField(key, placeholder, secret) {
    const i = h('input', { class: 'input', value: S.settings[key] || '', placeholder, maxLength: 200, type: secret ? 'password' : 'text', autocomplete: 'off' });
    i.addEventListener('change', () => { S.settings[key] = i.value.trim(); saveSettings(); });
    return i;
  }

  function sectionStartup(redraw) {
    const s = S.settings;
    const info = S.appInfo || {};
    const last = store.get('lastHost', null);
    return h('div', null, h('h2', null, 'Запуск и фон'),
      switchRow('Крестик сворачивает в трей', s.closeToTray, (v) => { s.closeToTray = v; saveSettings(); native.appPrefs({ closeToTray: v }); },
        'Комната, голос и уведомления продолжают работать. Выйти совсем — правый клик по значку в трее.'),
      switchRow('Запускать вместе с Windows (свёрнутым в трей)', info.autostart, async (v) => { s.autostart = v; saveSettings(); S.appInfo = await native.appPrefs({ autostart: v }); redraw(); },
        info.packaged ? '' : 'Работает только в собранной версии (corsa-mess.exe).'),
      switchRow('Заходить в последнюю комнату при запуске', s.autoJoin, (v) => { s.autoJoin = v; saveSettings(); }),
      switchRow('Сразу открывать свою комнату', s.autoHost, async (v) => {
        s.autoHost = v; saveSettings();
        if (v && S.hosting) await native.secretSet('hostPassword', S.hostPassword || '').catch(() => {});
        if (!v) await native.secretSet('hostPassword', '').catch(() => {});
        redraw();
      }, last ? `При запуске приложение само поднимет «${last.name}» на порту ${last.port}${s.autoHost ? '. Пароль хранится зашифрованным средствами Windows' : ''}.` : 'Сначала один раз запустите свою комнату на главной.'),
      h('div', { class: 'hint', style: { marginTop: '14px' } }, 'Вместе с автозапуском Windows получается свой маленький сервер: компьютер включён — комната открыта для друзей.'));
  }

  function sectionUpdates(redraw) {
    const s = S.settings;
    const u = S.update;
    const status = h('div', { class: 'hint' });
    const bar = h('div', { class: 'mm-bar' }, h('i', { class: 'open' }));
    bar.style.display = 'none';
    const check = async () => { status.textContent = 'Проверяю…'; await checkUpdates(true); redraw(); };
    const parts = [h('h2', null, 'Обновления'),
      h('div', { class: 'list-item' }, h('div', { class: 'info' }, h('div', null, `Сейчас: ${(S.appInfo && S.appInfo.version) || '?'}`),
        h('div', { class: 'sub' }, u ? (u.newer ? `Доступна версия ${u.version}` : `Последняя версия ${u.version} — у вас она и стоит`) : 'Ещё не проверяли')),
      h('button', { class: 'btn', onclick: check }, 'Проверить')),
      switchRow('Проверять обновления при запуске', s.checkUpdates, (v) => { s.checkUpdates = v; saveSettings(); }, 'Приложение спрашивает GitHub о последнем релизе corsa-mess. GitHub при этом видит ваш IP, больше ничего не отправляется.'),
      status];
    if (u && u.newer) {
      const go = h('button', { class: 'btn primary' }, u.sha256 ? `Скачать и установить ${u.version}` : 'Открыть страницу релиза');
      go.onclick = async () => {
        if (!u.sha256 || !u.packaged) { native.openReleasePage(u.page); return; }
        go.disabled = true; bar.style.display = ''; status.textContent = 'Скачиваю…';
        const off = native.onUpdateProgress((p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; status.textContent = `Скачано ${Math.round(p * 100)}%`; });
        try {
          await native.updateDownload();
          off();
          status.textContent = 'Скачано и проверено (контрольная сумма совпала). Приложение закроется, обновится и откроется само.';
          go.textContent = 'Перезапустить и обновить';
          go.disabled = false;
          go.onclick = () => native.updateInstall().catch((e) => C.toast(cleanErr(e)));
        } catch (e) { off(); go.disabled = false; status.className = 'hint bad'; status.textContent = cleanErr(e); }
      };
      parts.push(h('div', { class: 'update-notes' }, h('label', { class: 'lbl' }, `Что нового в ${u.version}`), h('div', { class: 'bio' }, inline(u.notes.replace(/SHA-256[^\n]*/gi, '').trim().slice(0, 1500), null, { emoji: 0 }))),
        bar, h('div', { class: 'row', style: { marginTop: '10px' } }, go, h('button', { class: 'btn', onclick: () => native.openReleasePage(u.page) }, 'Страница релиза')),
        !u.packaged ? h('div', { class: 'hint' }, 'Это запуск из исходников: обновите через git pull.') : !u.sha256 ? h('div', { class: 'hint' }, 'У этого релиза нет контрольной суммы, поэтому само обновление не ставится. Скачайте архив со страницы релиза.') : null);
    }
    return h('div', null, ...parts);
  }

  // Проверка новой версии. Тихо — без сообщений об ошибках (при запуске).
  async function checkUpdates(loud) {
    try {
      S.update = await native.updateCheck();
      if (S.update.newer) renderSide();
      else if (loud) C.toast('У вас последняя версия');
    } catch (e) { if (loud) C.toast('Не удалось проверить: ' + cleanErr(e)); }
  }

  function sectionBackup() {
    const file = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
    file.addEventListener('change', async () => {
      try { store.load(JSON.parse(await file.files[0].text())); C.toast('Готово. Перезапустите приложение.'); } catch (e) { C.toast('Не удалось прочитать файл'); }
    });
    return h('div', null, h('h2', null, 'Резервная копия'),
      h('div', { class: 'hint' }, 'Профиль, настройки, стикеры, плагины и список комнат хранятся только на этом компьютере. Сервера-облака нет, поэтому копию делаете вы.'),
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
  function sectionRoom(redraw) {
    const room = S.conn.room;
    const draft = { banner: room.banner || '' };
    const name = h('input', { class: 'input', value: room.name, maxLength: 40 });
    const preview = h('div', { class: 'side-title room-header' });
    const update = () => {
      const safe = C.safeUrl(draft.banner);
      preview.className = 'side-title room-header' + (safe ? ' has-banner' : '');
      preview.style.backgroundImage = safe && !isVideoUrl(safe) ? `url("${safe}")` : '';
      preview.replaceChildren(h('span', { class: 'room-name' }, name.value.trim() || room.name));
    };
    name.addEventListener('input', update);
    update();
    const send = (op) => { S.conn.send({ t: 'channel-set', ...op }); setTimeout(redraw, 200); };
    const chRow = (c) => {
      const nm = h('input', { class: 'input', value: c.name, maxLength: 32 });
      const cat = h('input', { class: 'input', value: c.category || '', maxLength: 32, placeholder: 'Категория' });
      const topic = h('input', { class: 'input', value: c.topic || '', maxLength: 120, placeholder: 'Тема канала (видна в шапке)' });
      nm.addEventListener('change', () => send({ op: 'edit', id: c.id, name: nm.value }));
      cat.addEventListener('change', () => send({ op: 'edit', id: c.id, category: cat.value }));
      topic.addEventListener('change', () => send({ op: 'edit', id: c.id, topic: topic.value }));
      const nsfw = h('input', { type: 'checkbox', class: 'switch', checked: !!c.nsfw, title: '18+' });
      nsfw.addEventListener('change', () => send({ op: 'edit', id: c.id, nsfw: nsfw.checked }));
      // Только чтение: писать могут владелец и модераторы. Пауза: сколько секунд ждать между сообщениями (модераторов не касается).
      const ro = h('input', { type: 'checkbox', class: 'switch', checked: !!c.readonly, title: 'Только чтение' });
      ro.addEventListener('change', () => send({ op: 'edit', id: c.id, readonly: ro.checked }));
      const slow = select([[0, 'Без паузы'], [5, '5 с'], [10, '10 с'], [30, '30 с'], [60, '1 мин'], [300, '5 мин'], [900, '15 мин'], [3600, '1 ч'], [21600, '6 ч']], c.slow || 0, (v) => send({ op: 'edit', id: c.id, slow: Number(v) }));
      slow.title = 'Медленный режим';
      return h('div', { class: 'ch-row' }, h('span', { class: 'ch-ic' }, c.type === 'voice' ? '{{ic:speaker}}' : '#'), h('div', { class: 'grow ch-fields' }, h('div', { class: 'row' }, nm, cat), topic),
        c.type === 'text' ? h('div', { class: 'ch-modes' }, h('label', { class: 'ch-nsfw', title: 'Писать могут только владелец и модераторы' }, 'Чтение', ro), h('label', { class: 'ch-nsfw', title: 'Медленный режим' }, slow)) : null,
        c.type === 'text' ? h('label', { class: 'ch-nsfw', title: 'Канал 18+' }, '18+', nsfw) : null,
        h('button', { class: 'icon-btn', title: 'Выше', onclick: () => send({ op: 'move', id: c.id, dir: -1 }) }, '{{ic:arrow-up}}'),
        h('button', { class: 'icon-btn', title: 'Ниже', onclick: () => send({ op: 'move', id: c.id, dir: 1 }) }, '{{ic:arrow-down}}'),
        h('button', { class: 'icon-btn', title: 'Удалить', onclick: () => { if (confirm(`Удалить канал «${c.name}»${c.type === 'text' ? ' вместе с историей' : ''}?`)) send({ op: 'delete', id: c.id }); } }, '{{ic:trash}}'));
    };
    const newName = h('input', { class: 'input', placeholder: 'Название канала', maxLength: 32 });
    const newCat = h('input', { class: 'input', placeholder: 'Категория', maxLength: 32 });
    const newType = select([['text', '# Текстовый'], ['voice', '{{ic:speaker}} Голосовой']], 'text', () => {});
    return h('div', null, h('h2', null, 'Комната'),
      h('div', { class: 'hint' }, 'Название, баннер и каналы видят все участники. Менять их можете только вы.'),
      field('Название', name), urlField('Баннер (ссылка)', 'banner', draft, 'Картинка над списком каналов. Лучше широкая, например 600×240.', update),
      h('label', { class: 'lbl' }, 'Предпросмотр'), h('div', { style: { width: '262px', borderRadius: '12px', overflow: 'hidden' } }, preview),
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => {
        S.conn.send({ t: 'room-set', name: name.value.trim(), banner: C.safeUrl(draft.banner) || null });
        C.toast('Комната обновлена');
      } }, 'Сохранить название и баннер')),
      h('label', { class: 'lbl' }, 'Каналы'),
      h('div', { class: 'hint' }, 'Изменения применяются сразу, как только вы уходите с поля. Каналы 18+ помечаются и могут размываться плагинами.'),
      h('div', { class: 'ch-list' }, room.channels.map(chRow)),
      h('div', { class: 'row', style: { marginTop: '10px' } }, newType, newName, newCat,
        h('button', { class: 'btn primary', onclick: () => { if (!newName.value.trim()) return; send({ op: 'add', type: newType.value, name: newName.value, category: newCat.value || undefined }); } }, 'Добавить')));
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
          h('button', { class: 'icon-btn', title: 'Выше', onclick: () => attempt(() => lib.moveCategory(cat.id, -1)) }, '{{ic:arrow-up}}'),
          h('button', { class: 'icon-btn', title: 'Ниже', onclick: () => attempt(() => lib.moveCategory(cat.id, 1)) }, '{{ic:arrow-down}}'),
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
              h('button', { class: 'icon-btn', title: 'Удалить', onclick: () => attempt(() => lib.removeItem(cat.id, item.id)) }, '{{ic:close}}')))) :
          [h('div', { class: 'hint' }, 'Пока пусто. Добавьте стикер или эмодзи по ссылке.')]));
    }
    return h('div', null, ...parts);
  }

  function openSettings(start = 'profile') {
    const sections = [...(S.conn && S.conn.owner ? [['room', '{{ic:home}} Комната', sectionRoom]] : []), ['profile', '{{ic:user}} Мой профиль', sectionProfile], ['look', '{{ic:palette}} Внешний вид', sectionLook],
      ['voice', '{{ic:mic}} Голос и видео', sectionVoice], ['stream', '{{ic:screen}} Стриминг', sectionStream], ['stickers', '{{ic:smile}} Стикеры и эмодзи', sectionStickers], ['plugins', '{{ic:puzzle}} Плагины', sectionPlugins],
      ['activity', '{{ic:gamepad}} Игры и активность', sectionActivity], ['notify', '{{ic:bell}} Уведомления', sectionNotify], ['network', '{{ic:antenna}} Сеть', sectionNetwork], ['startup', '{{ic:rocket}} Запуск и фон', sectionStartup],
      ['security', '{{ic:lock}} Безопасность', sectionSecurity], ['updates', '{{ic:arrow-up}} Обновления', sectionUpdates], ['backup', '{{ic:save}} Резервная копия', sectionBackup]];
    let current = sections.find((s) => s[0] === start) ? start : 'profile';
    const nav = h('div', { class: 'settings-nav' });
    const body = h('div', { class: 'settings-body' });
    // На узком экране показывается только одна панель разом (список разделов или сам раздел),
    // как в мобильном интерфейсе — переключает класс на обёртке, а не версия модалки.
    const wrap = h('div', { class: 'settings-wrap' }, nav, body);
    const back = h('button', { class: 'settings-back', onclick: () => wrap.classList.remove('show-body') }, '{{ic:chevron-left}} Настройки');
    const draw = () => {
      nav.replaceChildren(h('div', { class: 'group-label' }, 'Настройки'), ...sections.map(([id, label]) =>
        h('div', { class: 'nav' + (id === current ? ' on' : ''), onclick: () => { current = id; wrap.classList.add('show-body'); draw(); body.scrollTop = 0; } }, label)),
      h('div', { style: { padding: '14px 12px' } }, h('button', { class: 'btn', onclick: () => { dlg.close(); if (S.conn) disconnect(); } }, S.conn ? 'Отключиться от комнаты' : 'Закрыть')));
      const fn = sections.find((s) => s[0] === current)[2];
      const top = body.scrollTop;
      body.replaceChildren(back, fn(draw));
      body.scrollTop = top;
    };
    const dlg = modal(wrap, { wide: true, onClose: () => { S.profileDraft = null; } });
    draw();
  }

  const applyAnimations = () => document.body.classList.toggle('no-anim', !S.settings.animations);

  // «Не на месте»: через 10 минут без мыши и клавиатуры, обратно — при первом действии.
  function startIdleWatch() {
    let lastInput = Date.now();
    const wake = () => {
      lastInput = Date.now();
      if (S.idle) { S.idle = false; if (S.conn) S.conn.send({ t: 'status', status: wireStatus() }); renderUserbar(); }
    };
    for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel']) window.addEventListener(ev, wake, { passive: true });
    setInterval(() => {
      if (!S.settings.autoIdle || S.status !== 'online' || S.idle) return;
      if (Date.now() - lastInput > 10 * 60000) { S.idle = true; if (S.conn) S.conn.send({ t: 'status', status: wireStatus() }); renderUserbar(); }
    }, 30000);
  }

  // ---------- Старт ----------
  async function start() {
    C.stickerLib.load();
    applyLook();
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.settings.mode === 'auto') applyLook(); });
    C.startCursorGlow(() => S.settings.cursorGlow, () => S.settings.glowPower);
    applyAnimations();
    const app = document.getElementById('app');
    el.rail = h('div', { class: 'rail' });
    el.side = h('div', { class: 'side' });
    el.main = h('div', { class: 'main' });
    el.right = h('div', { class: 'right' });
    // Кнопка "назад" к списку каналов — видна только на узком экране, когда открыт канал/беседа
    // (см. .mobile-back в styles.css). Отдельный элемент, а не часть main-head: контент .main
    // целиком перерисовывается при каждом переходе, а эта кнопка должна пережить перерисовку.
    el.mobileBack = h('button', { class: 'mobile-back', title: 'К списку каналов', onclick: () => setMobilePane('side') }, '{{ic:chevron-left}}');
    app.append(el.rail, el.side, el.main, el.right, el.mobileBack);
    setMobilePane('side');
    renderAll();
    native.presenceConfig({ resolveNames: S.settings.resolveNames });
    await C.themes.refresh();
    await C.plugins.refresh();
    renderAll();
    autoMigrate();
    S.appInfo = await native.appPrefs({ closeToTray: S.settings.closeToTray }).catch(() => ({}));
    startupActions();
    if (S.settings.checkUpdates) setTimeout(() => checkUpdates(false), 4000);
    native.onPresence((a) => { S.detected = a; updateActivity(); });
    native.onTls((ev) => {
      if (ev.kind === 'mismatch') {
        modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0, color: 'var(--warn)' } }, '{{ic:warn}} Сертификат сервера изменился'),
          h('div', null, `Сервер ${ev.host} раньше представлялся по-другому. Соединение заблокировано: это может быть подмена сервера.`),
          h('label', { class: 'lbl' }, 'Запомненный отпечаток'), h('div', { class: 'hint', style: { wordBreak: 'break-all' } }, ev.expected),
          h('label', { class: 'lbl' }, 'Сейчас'), h('div', { class: 'hint', style: { wordBreak: 'break-all' } }, ev.fingerprint),
          h('div', { class: 'hint', style: { marginTop: '12px' } }, 'Если владелец комнаты переустанавливал приложение, спросите у него новый отпечаток. Если всё верно, забудьте старый в Настройки → Безопасность и подключитесь снова.')));
      } else if (ev.kind === 'new') {
        C.toast(`Сервер ${ev.host} запомнен. Отпечаток: ${ev.fingerprint.slice(0, 23)}…`);
      }
    });
    S.detected = await native.presenceNow();
    updateActivity();
    startIdleWatch();
    refreshPalette();
    // Клик по уведомлению Windows открывает канал или беседу.
    native.onNotifyClick((tag) => {
      if (!S.conn) return;
      if (tag.startsWith('ch:')) { const id = tag.slice(3); if (S.conn.room.channels.find((c) => c.id === id)) { S.view = { type: 'text', channel: id }; S.unread[id] = 0; S.mentions[id] = 0; updateTitle(); renderAll(); } }
      else if (tag.startsWith('dm:')) openDm(tag.slice(3));
    });
    native.onHotkey(onHotkey);
    // Состояние моста (открыт, переподключается, закрыт) приходит из главного процесса.
    native.onBridge((st) => {
      if (!S.hosting) return;
      if (st.state === 'closed') { delete S.hosting.bridge; } else if (S.hosting.bridge) { S.hosting.bridge = { ...S.hosting.bridge, ...st }; }
      if (S.view.type === 'home') renderMain();
    });
    applyGlobalHotkeys();
    window.addEventListener('focus', () => native.attention(false).catch(() => {}));
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF' && S.view.type === 'text') { const s = document.querySelector('.head-search'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
    });
  }

  start();
})();
