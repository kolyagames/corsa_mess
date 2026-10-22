// Сервер комнаты. Запускается в главном процессе приложения по кнопке «Запустить сервер».
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { WebSocketServer } = require('ws');
const { sanitizeImageUrl } = require('../shared/allowlist');

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

const FRAMES = ['none', 'neon', 'gradient', 'rainbow', 'pulse'];
const NAME_FX = ['none', 'glow', 'gradient', 'rainbow'];

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
  };
  return out.name || out.details || out.state ? out : null;
}

// password: пароль сети (необязательно). tls: { key, cert } — включает wss. limits: переопределение ограничений (для тестов).
function createRoomServer({ name, port, historyFile, ownerUid = '', password = '', tls = null, limits = {}, log = () => {} }) {
  const L = { ...LIMITS, ...limits };
  const room = { name: str(name, 40) || 'Комната', banner: null };
  // Пароль сразу превращаем в ключ и забываем. Клиент доказывает знание пароля ответом на случайный вызов,
  // сам пароль по сети не передаётся.
  const salt = crypto.randomBytes(16).toString('hex');
  const passKey = password ? crypto.pbkdf2Sync(String(password), salt, KDF_ITERATIONS, 32, 'sha256') : null;
  const banned = { uids: new Set(), ips: new Set() };
  const fails = new Map(); // ip -> { n, until }
  const perIp = new Map(); // ip -> число соединений
  let httpsServer = null;
  let heartbeat = null;
  const channels = DEFAULT_CHANNELS.map((c) => ({ ...c }));
  const history = new Map(channels.filter((c) => c.type === 'text').map((c) => [c.id, []]));
  const members = new Map(); // sid -> member
  let wss = null;
  let saveTimer = null;

  if (historyFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      for (const [ch, list] of Object.entries(saved)) {
        if (!history.has(ch) || !Array.isArray(list)) continue;
        // Старые записи хранили настоящий uid: заменяем его публичным идентификатором.
        for (const msg of list) if (msg && msg.uid && msg.uid.length !== 16) msg.uid = pubId(msg.uid);
        history.set(ch, list.slice(-HISTORY_LIMIT));
      }
      if (saved.__room) room.banner = sanitizeImageUrl(saved.__room.banner);
    } catch (e) { /* первого файла может не быть */ }
  }

  const snapshot = () => JSON.stringify({ ...Object.fromEntries(history), __room: { banner: room.banner } });

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
      status: hidden ? 'offline' : m.status,
      activity: hidden ? null : m.activity,
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
      status: msg.status === 'invisible' ? 'invisible' : 'online', activity: cleanActivity(msg.activity), voice: null,
      stamps: [],
    };
    applyProfile(m, msg);
    members.set(m.sid, m);
    ws.sid = m.sid;
    send(ws, {
      t: 'welcome', sid: m.sid, me: pubId(uid), owner: !!ownerUid && uid === ownerUid,
      room: { name: room.name, banner: room.banner, channels },
      members: [...members.values()].map(pub),
      history: Object.fromEntries(history), voice: voiceState(),
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
        if (!ownerUid || m.uid !== ownerUid) { send(ws, { t: 'error', text: 'Менять комнату может только владелец' }); return; }
        if (typeof msg.name === 'string' && msg.name.trim()) room.name = str(msg.name, 40).trim();
        if ('banner' in msg) room.banner = sanitizeImageUrl(msg.banner);
        saveHistory();
        broadcast({ t: 'room', room: { name: room.name, banner: room.banner } });
        break;
      }
      case 'kick': {
        // Исключить или заблокировать участника может только владелец.
        if (!ownerUid || m.uid !== ownerUid) { send(ws, { t: 'error', text: 'Это может сделать только владелец' }); return; }
        const target = members.get(msg.sid);
        if (!target || target === m) return;
        // Адрес блокируется, кроме локального: иначе владелец мог бы запереть сам себя.
        if (msg.ban) { banned.uids.add(target.uid); if (!/^(127\.|::1$)/.test(target.ws.ip)) banned.ips.add(target.ws.ip); }
        send(target.ws, { t: 'error', code: msg.ban ? 'banned' : 'kicked', text: msg.ban ? 'Вас заблокировали в этой комнате' : 'Вас исключили из комнаты' });
        target.ws.close(1008);
        break;
      }
      case 'status':
        m.status = msg.status === 'invisible' ? 'invisible' : 'online';
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
        if (!text && !sticker) return;
        const out = {
          id: crypto.randomUUID().slice(0, 12), sid: m.sid, uid: pubId(m.uid), name: m.name, avatar: m.avatar,
          text, sticker, emojis: cleanEmojis(msg.emojis, text), ts: now,
        };
        const list = history.get(ch.id);
        list.push(out);
        if (list.length > HISTORY_LIMIT) list.shift();
        saveHistory();
        broadcast({ t: 'msg', channel: ch.id, msg: out });
        break;
      }
      case 'voice': {
        const ch = channels.find((c) => c.id === msg.channel && c.type === 'voice');
        m.voice = ch ? ch.id : null;
        broadcast({ t: 'voice', voice: voiceState() });
        break;
      }
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
    if ((perIp.get(ip) || 0) >= L.perIp) return 'Слишком много соединений с вашего адреса';
    if (members.size >= L.maxMembers) return 'Комната заполнена';
    return null;
  }

  function onConnection(ws, req) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
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
      if (tls) {
        httpsServer = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' });
        httpsServer.once('error', reject);
        httpsServer.listen(port, '0.0.0.0', () => { httpsServer.removeListener('error', reject); resolve(httpsServer.address().port); });
        wss = new WebSocketServer({ server: httpsServer, ...opts });
      } else {
        wss = new WebSocketServer({ port, host: '0.0.0.0', ...opts });
        wss.once('error', reject);
        wss.once('listening', () => { wss.removeListener('error', reject); resolve(wss.address().port); });
      }
      wss.on('connection', onConnection);
      // Живость соединений: молчащих (оборванная сеть) отключаем.
      heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
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
      clearInterval(heartbeat);
      for (const ws of wss ? wss.clients : []) ws.terminate();
      const done = () => resolve();
      if (!wss) { resolve(); return; }
      wss.close(() => { if (httpsServer) httpsServer.close(done); else done(); });
    });
  }

  return { start, stop, memberCount: () => members.size };
}

module.exports = { createRoomServer };
