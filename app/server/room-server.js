// Сервер комнаты. Запускается в главном процессе приложения по кнопке «Запустить сервер».
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { sanitizeImageUrl } = require('../shared/allowlist');
const { createFileStore, serveFile } = require('./files');

const BRIDGE_IP = 'bridge'; // общий «адрес» всех, кто зашёл через интернет-мост
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_PER_WINDOW = 150 * 1024 * 1024; // не больше 150 МБ за 10 минут от одного участника

const HISTORY_LIMIT = 200;
const MAX_TEXT = 2000;
const MAX_NAME = 32;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 10;

// Ограничения против перегрузки и подбора пароля.
const LIMITS = {
  maxMembers: 50, perIp: 6, handshakeMs: 8000, heartbeatMs: 20000,
  burst: 40, refillPerSec: 20, // на одно соединение: короткий всплеск и постоянная скорость
  maxFails: 5, lockMs: 60000, // неверный пароль: после пяти ошибок адрес блокируется на минуту
};
const KDF_ITERATIONS = 150000;

const FRAMES = ['none', 'neon', 'gradient', 'rainbow', 'pulse', 'aura', 'orbit', 'double'];
const NAME_FX = ['none', 'glow', 'gradient', 'rainbow', 'shine', 'glitch', 'flicker'];
const NAME_FONTS = ['default', 'serif', 'mono', 'script', 'heavy', 'wide'];
const EFFECTS = ['none', 'snow', 'sparkles', 'hearts', 'embers', 'stars', 'sakura', 'bubbles'];
const PLATES = ['none', 'aurora', 'sunset', 'ocean', 'void', 'grid', 'candy', 'forest'];
const CARD_STYLES = ['default', 'glass', 'solid', 'outline'];
const BADGES = ['early', 'gamer', 'music', 'dev', 'artist', 'night', 'streamer', 'cat', 'heart', 'star', 'bolt', 'skull'];
const MAX_CHANNELS = 40;
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

const DEFAULT_CHANNELS = [
  { id: 'general', name: 'общий', type: 'text', category: 'Общее' },
  { id: 'memes', name: 'мемы', type: 'text', category: 'Общее' },
  { id: 'music', name: 'музыка', type: 'text', category: 'Общее' },
  { id: 'voice1', name: 'Голосовой 1', type: 'voice', category: 'Голосовые' },
  { id: 'stream', name: 'Стрим', type: 'voice', category: 'Голосовые' },
];

// Публичный идентификатор вместо настоящего uid: настоящий нужен только для входа и прав владельца,
// поэтому другим участникам он не показывается.
const pubId = (uid) => crypto.createHash('sha256').update('corsa:' + uid).digest('hex').slice(0, 16);

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

// Кастомные эмодзи: в тексте :имя:, ссылки приходят вместе с сообщением. Оставляем только
// те имена, что реально есть в тексте, и только проверенные ссылки.
function cleanEmojis(map, text) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const name of Object.keys(map).slice(0, 12)) {
    if (!/^[A-Za-z0-9_]{2,32}$/.test(name) || !text.includes(`:${name}:`)) continue;
    const url = sanitizeImageUrl(map[name]);
    if (url) out[name] = url;
  }
  return out;
}

function cleanActivity(a) {
  if (!a || typeof a !== 'object') return null;
  const out = {
    name: str(a.name, 64),
    details: str(a.details, 128),
    state: str(a.state, 128),
    startedAt: Number.isFinite(a.startedAt) ? a.startedAt : null,
    image: sanitizeImageUrl(a.image) || null,
    kind: a.kind === 'music' ? 'music' : 'game',
  };
  return out.name || out.details || out.state ? out : null;
}

const hexColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

// Реакция: обычный эмодзи (до 16 символов, без букв и цифр) или свой :имя: со ссылкой.
function reactionKey(v) {
  if (typeof v !== 'string') return null;
  if (/^:[A-Za-z0-9_]{2,32}:$/.test(v)) return v;
  if (v.length > 16 || /[\p{L}\p{N}\s<>]/u.test(v) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v)) return null;
  return v;
}

function cleanChannel(c) {
  if (!c || typeof c !== 'object' || !/^[a-z0-9_-]{1,24}$/i.test(c.id || '')) return null;
  const type = c.type === 'voice' ? 'voice' : 'text';
  const name = str(c.name, 32).trim();
  if (!name) return null;
  return { id: c.id, name, type, category: str(c.category, 32).trim() || (type === 'voice' ? 'Голосовые' : 'Общее'), topic: str(c.topic, 120), nsfw: !!c.nsfw };
}

// password: пароль сети (необязательно). tls: { key, cert } — включает wss. limits: переопределение ограничений (для тестов).
// filesDir: папка для файлов комнаты (без неё отправка файлов выключена).
function createRoomServer({ name, port, historyFile, ownerUid = '', password = '', tls = null, limits = {}, log = () => {}, filesDir = null }) {
  const L = { ...LIMITS, ...limits };
  const store = filesDir ? createFileStore({ dir: filesDir, maxFile: L.maxFile, maxTotal: L.maxTotal }) : null;
  const room = { name: str(name, 40) || 'Комната', banner: null };
  // Пароль сразу превращаем в ключ и забываем. Клиент доказывает знание пароля ответом на случайный вызов,
  // сам пароль по сети не передаётся.
  const salt = crypto.randomBytes(16).toString('hex');
  const passKey = password ? crypto.pbkdf2Sync(String(password), salt, KDF_ITERATIONS, 32, 'sha256') : null;
  const banned = { uids: new Set(), ips: new Set() };
  const fails = new Map(); // ip -> { n, until }
  const perIp = new Map(); // ip -> число соединений
  let httpServer = null;
  let bridgeServer = null;
  let bridgeWss = null;
  let heartbeat = null;
  // Права владельца только у владельца, который подключён с этого же компьютера (адрес 127.0.0.1 или ::1).
  const isOwner = (m) => !!ownerUid && m.uid === ownerUid && /^(127\.|::1$)/.test(m.ws.ip || '');
  let channels = DEFAULT_CHANNELS.map((c) => cleanChannel(c));
  let saved = null;
  if (historyFile) {
    try { saved = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch (e) { /* первого файла может не быть */ }
  }
  // Каналы, которые владелец создал или переименовал, хранятся вместе с историей.
  if (saved && saved.__room && Array.isArray(saved.__room.channels)) {
    const list = saved.__room.channels.map(cleanChannel).filter(Boolean).slice(0, MAX_CHANNELS);
    if (list.some((c) => c.type === 'text')) channels = list;
  }
  const history = new Map(channels.filter((c) => c.type === 'text').map((c) => [c.id, []]));
  const firstSeen = new Map(); // публичный id -> когда впервые зашёл
  const pins = new Map(); // канал -> закреплённые сообщения (копии, до 50)
  const members = new Map(); // sid -> member
  let wss = null;
  let saveTimer = null;

  if (saved) {
    for (const [ch, list] of Object.entries(saved)) {
      if (!history.has(ch) || !Array.isArray(list)) continue;
      // Старые записи хранили настоящий uid: заменяем его публичным идентификатором.
      for (const msg of list) if (msg && msg.uid && msg.uid.length !== 16) msg.uid = pubId(msg.uid);
      history.set(ch, list.slice(-HISTORY_LIMIT));
    }
    if (saved.__room) {
      room.banner = sanitizeImageUrl(saved.__room.banner);
      for (const [id, ts] of Object.entries(saved.__room.seen || {})) if (/^[0-9a-f]{16}$/.test(id) && Number.isFinite(ts)) firstSeen.set(id, ts);
      for (const [ch, list] of Object.entries(saved.__room.pins || {})) if (history.has(ch) && Array.isArray(list)) pins.set(ch, list.slice(-50));
    }
  }

  const snapshot = () => JSON.stringify({ ...Object.fromEntries(history), __room: { banner: room.banner, channels, seen: Object.fromEntries([...firstSeen].slice(-500)), pins: Object.fromEntries(pins) } });
  const roomInfo = () => ({ name: room.name, banner: room.banner, channels });
  const findMsg = (channel, id) => (history.get(channel) || []).find((x) => x.id === id);

  // Вложения сообщения: только свои уже загруженные файлы, сведения о них берутся из хранилища.
  function cleanFiles(list, m) {
    if (!store || !Array.isArray(list)) return [];
    const out = [];
    for (const f of list.slice(0, 10)) {
      const meta = store.get(typeof f === 'string' ? f : f && f.id);
      if (!meta || meta.uid !== pubId(m.uid) || out.some((x) => x.id === meta.id)) continue;
      out.push({ id: meta.id, name: meta.name, type: meta.type, kind: meta.kind, size: meta.size, voice: meta.voice || undefined, dur: meta.dur });
    }
    return out;
  }

  // HTTP на том же порту, что и комната: загрузка (POST /upload) и выдача (GET /f/<id>) файлов.
  // Пускает только участников, подключённых сейчас, по их личному ключу.
  function handleHttp(req, res) {
    const fail = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text || ''); };
    const url = new URL(req.url, 'http://room');
    const token = String(req.headers['x-corsa-token'] || '');
    const m = token.length === 32 ? [...members.values()].find((x) => x.fileToken === token) : null;
    if (!store) return fail(404, 'В этой комнате файлы выключены');
    if (!m) return fail(403, 'Нет доступа');
    if (req.method === 'GET' && /^\/f\/[0-9a-f]{24}$/.test(url.pathname)) {
      const meta = store.get(url.pathname.slice(3));
      return meta ? serveFile(req, res, store, meta) : fail(404, 'Файл удалён');
    }
    if (req.method !== 'POST' || url.pathname !== '/upload') return fail(404);
    const now = Date.now();
    m.uploads = (m.uploads || []).filter((u) => now - u.at < UPLOAD_WINDOW_MS);
    const used = m.uploads.reduce((n, u) => n + u.size, 0);
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > store.maxFile) return fail(413, 'Файл больше 25 МБ');
    if (used + declared > UPLOAD_PER_WINDOW) return fail(429, 'Слишком много файлов, подождите несколько минут');
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > store.maxFile) { aborted = true; fail(413, 'Файл больше 25 МБ'); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        let name = 'файл';
        try { name = decodeURIComponent(String(req.headers['x-corsa-name'] || 'файл')); } catch (e) { /* кривое имя */ }
        const meta = store.save(Buffer.concat(chunks), {
          name, hint: String(req.headers['content-type'] || ''), uid: pubId(m.uid),
          voice: req.headers['x-corsa-voice'] === '1', dur: Number(req.headers['x-corsa-duration']),
        });
        m.uploads.push({ at: now, size });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: meta.id, name: meta.name, type: meta.type, kind: meta.kind, size: meta.size, voice: meta.voice, dur: meta.dur }));
      } catch (e) { fail(400, e.message); }
    });
  }

  function saveHistory() {
    if (!historyFile) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(historyFile, snapshot()); }
      catch (e) { log('не удалось сохранить историю: ' + e.message); }
    }, 1000);
  }

  function pub(m) {
    const hidden = m.status === 'invisible';
    return {
      sid: m.sid, uid: pubId(m.uid), name: m.name, avatar: m.avatar, banner: m.banner, bg: m.bg, bio: m.bio,
      color: m.color, frame: m.frame, nameFx: m.nameFx, tag: m.tag, custom: m.custom, pronouns: m.pronouns,
      frameUrl: m.frameUrl, cardFrame: m.cardFrame,
      color2: m.color2, nameColor: m.nameColor, nameColor2: m.nameColor2, nameFont: m.nameFont, effect: m.effect,
      plate: m.plate, plateUrl: m.plateUrl, cardStyle: m.cardStyle, badges: m.badges, links: m.links,
      status: hidden ? 'offline' : m.status,
      activity: hidden ? null : m.activity,
      since: firstSeen.get(pubId(m.uid)) || null, joinedAt: hidden ? null : m.joinedAt, host: isOwner(m),
      // Состояние в голосе: микрофон, звук, показ экрана и чей экран смотрит.
      muted: !!m.muted, deaf: !!m.deaf, screen: !!(m.voice && m.screen), camera: !!(m.voice && m.camera), watching: m.voice ? m.watching : null,
    };
  }

  function voiceState() {
    const v = {};
    for (const c of channels) if (c.type === 'voice') v[c.id] = [];
    for (const m of members.values()) if (m.voice && v[m.voice]) v[m.voice].push(m.sid);
    return v;
  }

  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const m of members.values()) if (m.ws.readyState === 1) m.ws.send(data);
  }

  function applyProfile(m, p) {
    if (typeof p.name === 'string') m.name = str(p.name, MAX_NAME).trim() || m.name;
    if ('avatar' in p) m.avatar = sanitizeImageUrl(p.avatar);
    if ('banner' in p) m.banner = sanitizeImageUrl(p.banner);
    if ('bg' in p) m.bg = sanitizeImageUrl(p.bg);
    // Свои рамки: картинка с прозрачностью поверх аватара и поверх всей карточки профиля.
    if ('frameUrl' in p) m.frameUrl = sanitizeImageUrl(p.frameUrl);
    if ('cardFrame' in p) m.cardFrame = sanitizeImageUrl(p.cardFrame);
    if (typeof p.bio === 'string') m.bio = str(p.bio, 190);
    if ('color' in p) m.color = typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : null;
    if (FRAMES.includes(p.frame)) m.frame = p.frame;
    if (NAME_FX.includes(p.nameFx)) m.nameFx = p.nameFx;
    if (typeof p.tag === 'string') m.tag = str(p.tag, 4).trim();
    if (typeof p.custom === 'string') m.custom = str(p.custom, 60);
    if (typeof p.pronouns === 'string') m.pronouns = str(p.pronouns, 24);
    // Оформление профиля: второй цвет карточки, цвет и шрифт имени, эффект, табличка, значки, ссылки.
    for (const k of ['color2', 'nameColor', 'nameColor2']) if (k in p) m[k] = hexColor(p[k]);
    if (NAME_FONTS.includes(p.nameFont)) m.nameFont = p.nameFont;
    if (EFFECTS.includes(p.effect)) m.effect = p.effect;
    if (PLATES.includes(p.plate)) m.plate = p.plate;
    if ('plateUrl' in p) m.plateUrl = sanitizeImageUrl(p.plateUrl);
    if (CARD_STYLES.includes(p.cardStyle)) m.cardStyle = p.cardStyle;
    if (Array.isArray(p.badges)) m.badges = [...new Set(p.badges.filter((b) => BADGES.includes(b)))].slice(0, 6);
    if (Array.isArray(p.links)) {
      m.links = p.links.slice(0, 3).map((l) => ({ label: str(l && l.label, 20).trim(), url: str(l && l.url, 120).trim() })).filter((l) => l.label || l.url);
    }
  }

  // Управление каналами (только владелец): добавить, изменить, удалить, переместить.
  function editChannels(msg) {
    const idx = channels.findIndex((c) => c.id === msg.id);
    const ch = channels[idx];
    if (msg.op === 'add') {
      if (channels.length >= MAX_CHANNELS) return false;
      const c = cleanChannel({ id: 'c' + crypto.randomBytes(4).toString('hex'), name: msg.name, type: msg.type, category: msg.category, topic: msg.topic, nsfw: msg.nsfw });
      if (!c) return false;
      channels.push(c);
      if (c.type === 'text') history.set(c.id, []);
      return true;
    }
    if (!ch) return false;
    if (msg.op === 'edit') {
      const c = cleanChannel({ ...ch, ...pick(msg, ['name', 'category', 'topic', 'nsfw']), id: ch.id, type: ch.type });
      if (!c) return false;
      channels[idx] = c;
      return true;
    }
    if (msg.op === 'move') {
      const to = idx + (msg.dir < 0 ? -1 : 1);
      if (to < 0 || to >= channels.length) return false;
      [channels[idx], channels[to]] = [channels[to], channels[idx]];
      return true;
    }
    if (msg.op === 'delete') {
      // Последний текстовый канал не удаляется: комнате нужен хотя бы один.
      if (ch.type === 'text' && channels.filter((c) => c.type === 'text').length <= 1) return false;
      channels.splice(idx, 1);
      history.delete(ch.id);
      pins.delete(ch.id);
      for (const mem of members.values()) if (mem.voice === ch.id) { mem.voice = null; mem.screen = false; mem.watching = null; }
      return true;
    }
    return false;
  }

  function failAuth(ws) {
    const now = Date.now();
    const f = fails.get(ws.ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= L.maxFails) { f.until = now + L.lockMs; f.n = 0; }
    fails.set(ws.ip, f);
    send(ws, { t: 'error', code: 'bad-password', text: 'Неверный пароль' });
    ws.close(1008);
  }

  function checkProof(ws, proof) {
    if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
    const want = crypto.createHmac('sha256', passKey).update(ws.nonce).digest();
    return crypto.timingSafeEqual(want, Buffer.from(proof, 'hex'));
  }

  function handleHello(ws, msg) {
    if (passKey && !checkProof(ws, msg.proof)) {
      if (msg.proof === undefined) { send(ws, { t: 'error', code: 'need-password', text: 'Нужен пароль' }); ws.close(1008); } else failAuth(ws);
      return;
    }
    fails.delete(ws.ip);
    const uid = str(msg.uid, 64) || crypto.randomUUID();
    if (banned.uids.has(uid)) { send(ws, { t: 'error', code: 'banned', text: 'Вас заблокировали в этой комнате' }); ws.close(1008); return; }
    clearTimeout(ws.handshake);
    for (const old of [...members.values()]) {
      if (old.uid === uid) { send(old.ws, { t: 'error', text: 'Вы вошли с другого места' }); old.ws.close(); }
    }
    const m = {
      ws, sid: crypto.randomUUID().slice(0, 8), uid, name: 'Гость', avatar: null, banner: null, bg: null, bio: '',
      color: null, frame: 'none', nameFx: 'none', tag: '', custom: '', pronouns: '', frameUrl: null, cardFrame: null,
      color2: null, nameColor: null, nameColor2: null, nameFont: 'default', effect: 'none', plate: 'none', plateUrl: null,
      cardStyle: 'default', badges: [], links: [],
      status: STATUSES.includes(msg.status) ? msg.status : 'online', activity: cleanActivity(msg.activity), voice: null,
      muted: false, deaf: false, screen: false, watching: null, joinedAt: Date.now(), typingAt: 0,
      stamps: [], fileToken: crypto.randomBytes(16).toString('hex'), uploads: [],
    };
    applyProfile(m, msg);
    const pid = pubId(uid);
    if (!firstSeen.has(pid)) { firstSeen.set(pid, Date.now()); saveHistory(); }
    members.set(m.sid, m);
    ws.sid = m.sid;
    send(ws, {
      t: 'welcome', sid: m.sid, me: pid, owner: isOwner(m), fileToken: store ? m.fileToken : null,
      room: roomInfo(),
      members: [...members.values()].map(pub),
      history: Object.fromEntries(history), voice: voiceState(), pins: Object.fromEntries(pins),
    });
    broadcast({ t: 'member', member: pub(m) });
    log(`${m.name} вошёл`);
  }

  function handleMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') { if (!ws.sid) handleHello(ws, msg); return; }
    const m = members.get(ws.sid);
    if (!m) return;

    switch (msg.t) {
      case 'profile':
        applyProfile(m, msg);
        broadcast({ t: 'member', member: pub(m) });
        break;
      case 'room-set': {
        // Название и баннер комнаты меняет только владелец (тот, кто её запустил).
        if (!isOwner(m)) { send(ws, { t: 'error', text: 'Менять комнату может только владелец' }); return; }
        if (typeof msg.name === 'string' && msg.name.trim()) room.name = str(msg.name, 40).trim();
        if ('banner' in msg) room.banner = sanitizeImageUrl(msg.banner);
        saveHistory();
        broadcast({ t: 'room', room: { name: room.name, banner: room.banner } });
        break;
      }
      case 'kick': {
        // Исключить или заблокировать участника может только владелец.
        if (!isOwner(m)) { send(ws, { t: 'error', text: 'Это может сделать только владелец' }); return; }
        const target = members.get(msg.sid);
        if (!target || target === m) return;
        // Адрес блокируется, кроме локального: иначе владелец мог бы запереть сам себя.
        // Адрес блокируется, кроме локального и мостового: через мост адрес общий, и блокировка ударила бы по всем.
        if (msg.ban) { banned.uids.add(target.uid); if (!/^(127\.|::1$)/.test(target.ws.ip) && target.ws.ip !== BRIDGE_IP) banned.ips.add(target.ws.ip); }
        send(target.ws, { t: 'error', code: msg.ban ? 'banned' : 'kicked', text: msg.ban ? 'Вас заблокировали в этой комнате' : 'Вас исключили из комнаты' });
        target.ws.close(1008);
        break;
      }
      case 'status':
        m.status = STATUSES.includes(msg.status) ? msg.status : 'online';
        broadcast({ t: 'member', member: pub(m) });
        break;
      case 'activity':
        m.activity = cleanActivity(msg.activity);
        broadcast({ t: 'member', member: pub(m) });
        break;
      case 'msg': {
        const ch = channels.find((c) => c.id === msg.channel && c.type === 'text');
        if (!ch) return;
        const now = Date.now();
        m.stamps = m.stamps.filter((s) => now - s < RATE_WINDOW_MS);
        if (m.stamps.length >= RATE_MAX) { send(ws, { t: 'error', text: 'Слишком быстро' }); return; }
        m.stamps.push(now);
        const text = str(msg.text, MAX_TEXT).trim();
        const sticker = sanitizeImageUrl(msg.sticker);
        const files = cleanFiles(msg.files, m);
        if (!text && !sticker && !files.length) return;
        const out = {
          id: crypto.randomUUID().slice(0, 12), sid: m.sid, uid: pubId(m.uid), name: m.name, avatar: m.avatar,
          text, sticker, emojis: cleanEmojis(msg.emojis, text), ts: now,
        };
        if (files.length) out.files = files;
        // Ответ на сообщение: сохраняем короткую цитату, чтобы её было видно, даже если оригинал удалят.
        const orig = typeof msg.reply === 'string' ? findMsg(ch.id, msg.reply) : null;
        if (orig) out.reply = { id: orig.id, name: orig.name, text: (orig.text || (orig.sticker ? 'стикер' : '')).slice(0, 100) };
        const list = history.get(ch.id);
        list.push(out);
        if (list.length > HISTORY_LIMIT) list.shift();
        m.typingAt = 0;
        saveHistory();
        broadcast({ t: 'msg', channel: ch.id, msg: out });
        break;
      }
      case 'edit': {
        // Изменить можно только своё сообщение.
        const target = findMsg(msg.channel, msg.id);
        if (!target || target.uid !== pubId(m.uid)) return;
        const text = str(msg.text, MAX_TEXT).trim();
        if (!text && !target.sticker) return;
        target.text = text;
        target.emojis = cleanEmojis({ ...target.emojis, ...(msg.emojis || {}) }, text);
        target.edited = Date.now();
        saveHistory();
        broadcast({ t: 'edit', channel: msg.channel, msg: target });
        break;
      }
      case 'delete': {
        // Удалить можно своё сообщение, владелец удаляет любое.
        const list = history.get(msg.channel);
        const target = findMsg(msg.channel, msg.id);
        if (!target || (target.uid !== pubId(m.uid) && !isOwner(m))) return;
        list.splice(list.indexOf(target), 1);
        // Вложения удалённого сообщения стираются с диска хозяина.
        if (store) for (const f of target.files || []) store.remove(f.id);
        saveHistory();
        broadcast({ t: 'delete', channel: msg.channel, id: target.id, by: m.sid });
        // Удалённое сообщение снимается и с закрепа.
        const pl = pins.get(msg.channel) || [];
        if (pl.some((x) => x.id === target.id)) {
          pins.set(msg.channel, pl.filter((x) => x.id !== target.id));
          broadcast({ t: 'pins', channel: msg.channel, pins: pins.get(msg.channel), id: target.id, pinned: null });
        }
        break;
      }
      case 'react': {
        const target = findMsg(msg.channel, msg.id);
        const key = reactionKey(msg.emoji);
        if (!target || !key) return;
        const reactions = target.reactions || {};
        const who = pubId(m.uid);
        const list = reactions[key] || [];
        if (list.includes(who)) list.splice(list.indexOf(who), 1);
        else {
          if (!reactions[key] && Object.keys(reactions).length >= 20) return;
          // Свой эмодзи-реакция: ссылка только с проверенного сайта.
          if (key.startsWith(':')) {
            const url = sanitizeImageUrl(msg.url) || (target.remoji && target.remoji[key]);
            if (!url) return;
            target.remoji = { ...target.remoji, [key]: url };
          }
          list.push(who);
        }
        if (list.length) reactions[key] = list; else { delete reactions[key]; if (target.remoji) delete target.remoji[key]; }
        target.reactions = reactions;
        saveHistory();
        broadcast({ t: 'react', channel: msg.channel, id: target.id, reactions, remoji: target.remoji || {} });
        break;
      }
      case 'pin': {
        // Закрепить может автор сообщения или владелец. Хранится копия: закреп переживёт старую историю.
        const target = findMsg(msg.channel, msg.id);
        if (!target || (target.uid !== pubId(m.uid) && !isOwner(m))) return;
        const list = pins.get(msg.channel) || [];
        const i = list.findIndex((x) => x.id === target.id);
        if (msg.on === false) { if (i < 0) return; list.splice(i, 1); target.pinned = null; }
        else {
          if (i >= 0) return;
          target.pinned = Date.now();
          list.push({ id: target.id, uid: target.uid, name: target.name, avatar: target.avatar, text: target.text, sticker: target.sticker, emojis: target.emojis, files: target.files, ts: target.ts, pinnedAt: target.pinned, by: m.name });
          if (list.length > 50) list.shift();
        }
        pins.set(msg.channel, list);
        saveHistory();
        broadcast({ t: 'pins', channel: msg.channel, pins: list, id: target.id, pinned: target.pinned || null });
        break;
      }
      case 'dm': {
        // Личное сообщение: сервер только пересылает его двоим и нигде не хранит.
        const target = members.get(msg.to);
        if (!target || target === m) return;
        const now = Date.now();
        m.stamps = m.stamps.filter((s) => now - s < RATE_WINDOW_MS);
        if (m.stamps.length >= RATE_MAX) { send(ws, { t: 'error', text: 'Слишком быстро' }); return; }
        m.stamps.push(now);
        const text = str(msg.text, MAX_TEXT).trim();
        const sticker = sanitizeImageUrl(msg.sticker);
        const files = cleanFiles(msg.files, m);
        if (!text && !sticker && !files.length) return;
        const out = {
          id: crypto.randomUUID().slice(0, 12), from: m.sid, to: target.sid, uid: pubId(m.uid), toUid: pubId(target.uid),
          name: m.name, avatar: m.avatar, text, sticker, emojis: cleanEmojis(msg.emojis, text), ts: now,
        };
        if (files.length) out.files = files;
        send(target.ws, { t: 'dm', msg: out });
        send(ws, { t: 'dm', msg: out });
        break;
      }
      case 'typing': {
        // «Печатает…»: не чаще раза в две секунды, ничего не сохраняется.
        const ch = channels.find((c) => c.id === msg.channel && c.type === 'text');
        const now = Date.now();
        if (!ch || now - m.typingAt < 2000) return;
        m.typingAt = now;
        const data = JSON.stringify({ t: 'typing', channel: ch.id, sid: m.sid });
        for (const o of members.values()) if (o !== m && o.ws.readyState === 1) o.ws.send(data);
        break;
      }
      case 'channel-set': {
        if (!isOwner(m)) { send(ws, { t: 'error', text: 'Каналы меняет только владелец' }); return; }
        if (!editChannels(msg)) return;
        saveHistory();
        broadcast({ t: 'room', room: roomInfo() });
        broadcast({ t: 'voice', voice: voiceState() });
        break;
      }
      case 'voice': {
        const ch = channels.find((c) => c.id === msg.channel && c.type === 'voice');
        m.voice = ch ? ch.id : null;
        if (!m.voice) { m.screen = false; m.camera = false; m.watching = null; }
        if (typeof msg.muted === 'boolean') m.muted = msg.muted;
        if (typeof msg.deaf === 'boolean') m.deaf = msg.deaf;
        broadcast({ t: 'voice', voice: voiceState() });
        broadcast({ t: 'member', member: pub(m) });
        break;
      }
      case 'voice-flags':
        if (typeof msg.muted === 'boolean') m.muted = msg.muted;
        if (typeof msg.deaf === 'boolean') m.deaf = msg.deaf;
        if (typeof msg.screen === 'boolean') m.screen = msg.screen;
        if (typeof msg.camera === 'boolean') m.camera = msg.camera;
        if ('watching' in msg) {
          const target = members.get(msg.watching);
          m.watching = target && m.voice && target.voice === m.voice ? target.sid : null;
        }
        broadcast({ t: 'member', member: pub(m) });
        break;
      case 'ping':
        // Задержка до сервера: клиент показывает её рядом с названием комнаты.
        if (Number.isFinite(msg.ts)) send(ws, { t: 'pong', ts: msg.ts });
        break;
      case 'rtc': {
        const target = members.get(msg.to);
        // Сигналы WebRTC идут только между участниками одного голосового канала.
        if (target && m.voice && target.voice === m.voice && msg.data && typeof msg.data === 'object') {
          send(target.ws, { t: 'rtc', from: m.sid, data: msg.data });
        }
        break;
      }
      default:
    }
  }

  // Принимать ли новое соединение: бан, блокировка за подбор пароля, лимиты.
  function admit(ws, ip) {
    const f = fails.get(ip);
    if (banned.ips.has(ip)) return 'Вас заблокировали в этой комнате';
    if (f && f.until > Date.now()) return 'Слишком много неудачных попыток. Подождите минуту';
    // Через мост настоящих адресов не видно, поэтому у всех мостовых соединений один общий «адрес» и лимит побольше.
    if ((perIp.get(ip) || 0) >= (ip === BRIDGE_IP ? L.perIp * 5 : L.perIp)) return 'Слишком много соединений с вашего адреса';
    if (members.size >= L.maxMembers) return 'Комната заполнена';
    return null;
  }

  // bridged: соединение пришло через интернет-мост (relay), настоящий адрес собеседника неизвестен.
  function onConnection(ws, req, bridged = false) {
    const ip = bridged ? BRIDGE_IP : (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const refuse = admit(ws, ip);
    ws.on('error', () => {});
    if (refuse) { send(ws, { t: 'error', code: 'refused', text: refuse }); ws.close(1008); return; }

    ws.ip = ip;
    ws.alive = true;
    ws.nonce = crypto.randomBytes(16).toString('hex');
    ws.bucket = { tokens: L.burst, at: Date.now() };
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    // Не представился за отведённое время — отключаем, чтобы пустые соединения не копились.
    ws.handshake = setTimeout(() => ws.terminate(), L.handshakeMs);
    ws.on('pong', () => { ws.alive = true; });
    send(ws, { t: 'challenge', nonce: ws.nonce, salt, needPassword: !!passKey, iterations: KDF_ITERATIONS });

    ws.on('message', (data, isBinary) => {
      if (isBinary) { ws.terminate(); return; }
      // Ограничение частоты для любых сообщений, не только для чата.
      const now = Date.now();
      ws.bucket.tokens = Math.min(L.burst, ws.bucket.tokens + ((now - ws.bucket.at) / 1000) * L.refillPerSec);
      ws.bucket.at = now;
      if (ws.bucket.tokens < 1) { ws.close(1008); return; }
      ws.bucket.tokens -= 1;
      handleMessage(ws, data.toString());
    });
    ws.on('close', () => {
      clearTimeout(ws.handshake);
      const left = (perIp.get(ip) || 1) - 1;
      if (left <= 0) perIp.delete(ip); else perIp.set(ip, left);
      const m = members.get(ws.sid);
      if (!m) return;
      members.delete(m.sid);
      broadcast({ t: 'left', sid: m.sid });
      if (m.voice) broadcast({ t: 'voice', voice: voiceState() });
      log(`${m.name} вышел`);
    });
  }

  function start() {
    return new Promise((resolve, reject) => {
      const opts = { maxPayload: 64 * 1024 };
      // Один порт на всё: WebSocket комнаты и HTTP для файлов. С сертификатом — шифрованные wss и https.
      httpServer = tls ? https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }) : http.createServer();
      httpServer.on('request', handleHttp);
      httpServer.once('error', reject);
      httpServer.listen(port, '0.0.0.0', () => { httpServer.removeListener('error', reject); resolve(httpServer.address().port); });
      wss = new WebSocketServer({ server: httpServer, ...opts });
      wss.on('connection', (ws, req) => onConnection(ws, req, false));
      // Второй вход для интернет-моста: порт не слушает, соединения от relay подаются в него вручную (adoptBridged).
      bridgeServer = tls ? https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }) : http.createServer();
      bridgeServer.on('request', handleHttp);
      bridgeWss = new WebSocketServer({ server: bridgeServer, ...opts });
      bridgeWss.on('connection', (ws, req) => onConnection(ws, req, true));
      // Живость соединений: молчащих (оборванная сеть) отключаем.
      heartbeat = setInterval(() => {
        for (const ws of [...wss.clients, ...bridgeWss.clients]) {
          if (ws.alive === false) { ws.terminate(); continue; }
          ws.alive = false;
          try { ws.ping(); } catch (e) { /* ignore */ }
        }
      }, L.heartbeatMs);
      heartbeat.unref();
    });
  }

  function stop() {
    return new Promise((resolve) => {
      clearTimeout(saveTimer);
      if (historyFile) { try { fs.writeFileSync(historyFile, snapshot()); } catch (e) { /* ignore */ } }
      if (store) store.flush();
      clearInterval(heartbeat);
      for (const ws of [...(wss ? wss.clients : []), ...(bridgeWss ? bridgeWss.clients : [])]) ws.terminate();
      if (bridgeServer) { try { bridgeServer.closeAllConnections(); } catch (e) { /* ignore */ } try { bridgeServer.close(() => {}); } catch (e) { /* не слушал */ } }
      if (bridgeWss) { try { bridgeWss.close(); } catch (e) { /* ignore */ } }
      const done = () => resolve();
      if (!wss) { resolve(); return; }
      wss.close(() => { if (httpServer) { httpServer.closeAllConnections && httpServer.closeAllConnections(); httpServer.close(done); } else done(); });
    });
  }

  // Принять соединение, пришедшее через мост: сырой сокет отдаётся серверу, дальше идут TLS, WebSocket и пароль как обычно.
  function adoptBridged(socket) {
    if (!bridgeServer) { socket.destroy(); return false; }
    socket.on('error', () => {});
    bridgeServer.emit('connection', socket);
    return true;
  }

  // Краткие сведения для поиска комнат в локальной сети.
  const info = () => ({ name: room.name, locked: !!passKey, members: [...members.values()].filter((x) => x.status !== 'invisible').length, max: L.maxMembers });

  return { start, stop, info, adoptBridged, memberCount: () => members.size };
}

module.exports = { createRoomServer };
