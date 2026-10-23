// Проверки без Electron: код комнаты, список сайтов, сервер комнаты.
const assert = require('assert');
const WebSocket = require('ws');
const Code = require('../shared/code');
const { sanitizeImageUrl } = require('../shared/allowlist');
const { createRoomServer } = require('../server/room-server');

function testCode() {
  for (const [ip, port] of [['192.168.1.5', 7777], ['0.0.0.1', 1], ['255.255.255.255', 65535], ['10.0.0.2', 25565]]) {
    const c = Code.encode(ip, port);
    assert.match(c, /^[a-z]{6}-[a-z]{5}$/);
    assert.deepStrictEqual(Code.decode(c), { host: ip, port });
  }
  assert.strictEqual(Code.decode('zzzzzz-zzzzz'), null);
  assert.strictEqual(Code.decode('abc'), null);
  assert.throws(() => Code.encode('1.2.3', 80));
}

function testAllowlist() {
  assert.ok(sanitizeImageUrl('https://i.imgur.com/abc.png'));
  assert.ok(sanitizeImageUrl('https://media.tenor.com/OjzCsUydYUEAAAPo/cute-cha-pri.mp4'));
  for (const bad of [
    'http://i.imgur.com/abc.png', 'https://imgur.com.evil.com/a.png', 'https://evil.com/i.imgur.com/a.png',
    'https://i.imgur.com@evil.com/a.png', 'https://user:pw@i.imgur.com/a.png', 'https://i.imgur.com:8443/a.png',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null, 42, 'https://sub.i.imgur.com/a.png',
    'https://i.imgur.com.evil.com/a.png', 'https://I.IMGUR.COM.evil.com/a.png',
  ]) assert.strictEqual(sanitizeImageUrl(bad), null, 'должен отклонить: ' + bad);
}

function testStickers() {
  const mem = new Map();
  global.window = {
    CorsaAllowlist: require('../shared/allowlist'),
    Corsa: {
      store: { get: (k, d) => (mem.has(k) ? JSON.parse(mem.get(k)) : d), set: (k, v) => mem.set(k, JSON.stringify(v)) },
      uuid: () => Math.random().toString(36).slice(2) + Date.now().toString(36),
      safeUrl: (u) => (u ? require('../shared/allowlist').sanitizeImageUrl(u) : null),
    },
  };
  // Старый плоский список стикеров переносится в первую категорию.
  mem.set('stickers', JSON.stringify(['https://i.imgur.com/old.png', 'https://evil.com/x.png']));
  require('../src/stickers.js');
  const lib = global.window.Corsa.stickerLib;
  lib.load();
  assert.strictEqual(lib.categories.length, 1);
  assert.strictEqual(lib.categories[0].items.length, 1, 'чужой сайт при миграции отбрасывается');

  const memes = lib.addCategory('Мемы');
  assert.throws(() => lib.addCategory('мемы'), /уже есть/);
  lib.addItem(memes.id, { type: 'sticker', name: 'кот', url: 'https://i.imgur.com/cat.png' });
  lib.addItem(memes.id, { type: 'emoji', name: 'kek lol!', url: 'https://i.imgur.com/kek.png' });
  assert.strictEqual(memes.items[1].name, 'kek_lol', 'имя эмодзи приводится к :имя:');
  assert.throws(() => lib.addItem(memes.id, { type: 'sticker', url: 'https://evil.com/a.png' }), /не в списке/);
  assert.throws(() => lib.addItem(memes.id, { type: 'sticker', url: 'https://i.imgur.com/cat.png' }), /уже есть/);
  assert.deepStrictEqual(lib.usedEmojis('привет :kek_lol: и :nope:'), { kek_lol: 'https://i.imgur.com/kek.png' });

  // Экспорт всего и одной категории, затем импорт в пустую библиотеку.
  const all = JSON.parse(JSON.stringify(lib.exportAll()));
  assert.strictEqual(all.format, 'corsa-mess.stickers');
  assert.strictEqual(all.categories.length, 2);
  const one = lib.exportCategory(memes.id);
  assert.strictEqual(one.categories.length, 1);
  assert.strictEqual(one.categories[0].name, 'Мемы');
  lib.categories = [];
  const r = lib.importData(all);
  assert.deepStrictEqual([r.categories, r.items, r.skipped], [2, 3, 0]);
  const r2 = lib.importData(all);
  assert.deepStrictEqual([r2.categories, r2.items], [0, 0], 'повторный импорт ничего не дублирует');
  assert.strictEqual(r2.skipped, 3);

  // Испорченные элементы пропускаются и считаются.
  const r3 = lib.importData({ format: 'corsa-mess.stickers', version: 1, categories: [
    { name: 'Новая', items: [{ type: 'sticker', url: 'https://evil.com/a.png' }, { type: 'emoji', name: 'ok', url: 'https://i.imgur.com/ok.png' }, null, 'мусор'] },
    { name: 'Сломана' },
  ] });
  assert.deepStrictEqual([r3.categories, r3.items, r3.skipped], [1, 1, 4]);
  assert.strictEqual(lib.importData(['https://i.imgur.com/p.png', 'javascript:alert(1)']).items, 1);
  assert.throws(() => lib.importData({ hello: 1 }), /не файл стикеров/);

  // Перенос между категориями и удаление.
  const [first, second] = lib.categories;
  const item = second.items[0];
  lib.moveItem(second.id, item.id, first.id);
  assert.ok(first.items.some((i) => i.id === item.id));
  lib.deleteCategory(second.id);
  assert.strictEqual(lib.cat(second.id), null);
  delete global.window;
}

function connect(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  ws.next = (pred, ms = 2000) => new Promise((resolve, reject) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
    const w = { pred, resolve };
    waiters.push(w);
    setTimeout(() => {
      const k = waiters.indexOf(w);
      if (k >= 0) waiters.splice(k, 1);
      reject(new Error('таймаут ожидания сообщения'));
    }, ms);
  });
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

async function testServer() {
  const srv = createRoomServer({ name: 'тест', port: 0, ownerUid: 'ua' });
  const port = await srv.start();
  const a = await connect(port);
  a.send(JSON.stringify({ t: 'hello', uid: 'ua', name: 'Ваня', avatar: 'https://i.imgur.com/a.png' }));
  const wa = await a.next((m) => m.t === 'welcome');
  assert.strictEqual(wa.room.channels.length, 5);

  const b = await connect(port);
  b.send(JSON.stringify({ t: 'hello', uid: 'ub', name: 'Саша', avatar: 'https://evil.com/x.png', status: 'invisible' }));
  const wb = await b.next((m) => m.t === 'welcome');
  const me = wb.members.find((m) => m.sid === wb.sid);
  assert.strictEqual(me.avatar, null, 'чужой сайт для аватарки должен отклоняться');
  assert.strictEqual(me.status, 'offline', 'невидимка выглядит как офлайн');

  // Владелец комнаты, публичные идентификаторы и категории каналов.
  assert.strictEqual(wa.owner, true);
  assert.strictEqual(wb.owner, false);
  assert.match(wa.me, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(wb.members).includes('"ua"'), 'настоящий uid другим не показывается');
  assert.deepStrictEqual([...new Set(wa.room.channels.map((c) => c.category))], ['Общее', 'Голосовые']);
  b.send(JSON.stringify({ t: 'room-set', name: 'Взлом', banner: 'https://i.imgur.com/b.png' }));
  assert.match((await b.next((m) => m.t === 'error')).text, /только владелец/);
  a.send(JSON.stringify({ t: 'room-set', name: 'Галактика', banner: 'https://i.imgur.com/b.png' }));
  const rs = await b.next((m) => m.t === 'room');
  assert.deepStrictEqual(rs.room, { name: 'Галактика', banner: 'https://i.imgur.com/b.png' });
  a.send(JSON.stringify({ t: 'room-set', banner: 'https://evil.com/b.png' }));
  assert.strictEqual((await b.next((m) => m.t === 'room')).room.banner, null);

  a.send(JSON.stringify({ t: 'msg', channel: 'general', text: 'привет', sticker: 'https://evil.com/s.png' }));
  const m1 = await b.next((m) => m.t === 'msg');
  assert.strictEqual(m1.msg.text, 'привет');
  assert.strictEqual(m1.msg.sticker, null);

  a.send(JSON.stringify({ t: 'msg', channel: 'general', text: '', sticker: 'https://media.tenor.com/x/y.mp4' }));
  assert.ok((await b.next((m) => m.t === 'msg')).msg.sticker);

  // Расширенный профиль: цвет, рамка, эффект имени, тег.
  b.send(JSON.stringify({ t: 'profile', color: '#FF00AA', frame: 'rainbow', nameFx: 'glow', tag: 'ABCDEFG', custom: 'занят', pronouns: 'он' }));
  const upd = await a.next((m) => m.t === 'member' && m.member.sid === wb.sid && m.member.frame === 'rainbow');
  assert.strictEqual(upd.member.color, '#ff00aa');
  assert.strictEqual(upd.member.tag, 'ABCD', 'тег обрезается до 4 символов');
  b.send(JSON.stringify({ t: 'profile', color: 'red', frame: 'evil', nameFx: '<b>' }));
  const bad = await a.next((m) => m.t === 'member' && m.member.sid === wb.sid && m.member.color === null && m.member.frame === 'rainbow');
  assert.strictEqual(bad.member.frame, 'rainbow', 'неизвестная рамка игнорируется');
  assert.strictEqual(bad.member.nameFx, 'glow');

  // Кастомные эмодзи: только проверенные ссылки и только те, что есть в тексте.
  a.send(JSON.stringify({ t: 'msg', channel: 'general', text: 'смотри :kek: и :evil: и :unused:', emojis: {
    kek: 'https://i.imgur.com/kek.png', evil: 'https://evil.com/x.png', unused2: 'https://i.imgur.com/u.png', 'bad name': 'https://i.imgur.com/b.png',
  } }));
  const em = await b.next((m) => m.t === 'msg' && m.msg.text.includes(':kek:'));
  assert.deepStrictEqual(em.msg.emojis, { kek: 'https://i.imgur.com/kek.png' });

  // Свои рамки по ссылкам: только проверенные сайты.
  b.send(JSON.stringify({ t: 'profile', frameUrl: 'https://i.imgur.com/ring.gif', cardFrame: 'https://evil.com/card.png' }));
  const fr = await a.next((m) => m.t === 'member' && m.member.sid === wb.sid && m.member.frameUrl);
  assert.strictEqual(fr.member.frameUrl, 'https://i.imgur.com/ring.gif');
  assert.strictEqual(fr.member.cardFrame, null);

  // Голос: сигналы только внутри одного канала.
  a.send(JSON.stringify({ t: 'voice', channel: 'voice1' }));
  await b.next((m) => m.t === 'voice');
  b.send(JSON.stringify({ t: 'rtc', to: wa.sid, data: { x: 1 } }));
  await assert.rejects(a.next((m) => m.t === 'rtc', 300));
  b.send(JSON.stringify({ t: 'voice', channel: 'voice1' }));
  await a.next((m) => m.t === 'voice' && m.voice.voice1.length === 2);
  b.send(JSON.stringify({ t: 'rtc', to: wa.sid, data: { x: 2 } }));
  assert.deepStrictEqual((await a.next((m) => m.t === 'rtc')).data, { x: 2 });

  // Ограничение частоты сообщений.
  for (let i = 0; i < 12; i++) a.send(JSON.stringify({ t: 'msg', channel: 'general', text: 'спам ' + i }));
  await a.next((m) => m.t === 'error');

  // Тот же пользователь заходит повторно: старое соединение закрывается.
  const a2 = await connect(port);
  a2.send(JSON.stringify({ t: 'hello', uid: 'ua', name: 'Ваня' }));
  await a2.next((m) => m.t === 'welcome');
  await new Promise((r) => a.once('close', r));

  a2.close(); b.close();
  await srv.stop();
}

// ---------- Защита: пароль, блокировки, лимиты, бан, TLS ----------
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ensureCert } = require('../server/cert');

function rawClient(url, opts = {}) {
  const ws = new WebSocket(url, opts);
  const inbox = [];
  const waiters = [];
  let closed = null;
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  ws.on('close', (code) => { closed = code; for (const w of waiters.splice(0)) w.reject(new Error('закрыто кодом ' + code)); });
  ws.on('error', () => {});
  ws.next = (pred = () => true, ms = 2000) => new Promise((resolve, reject) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
    if (closed !== null) return reject(new Error('закрыто кодом ' + closed));
    const w = { pred, resolve, reject };
    waiters.push(w);
    setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('таймаут')); } }, ms);
  });
  ws.closedPromise = () => new Promise((resolve) => (closed !== null ? resolve(closed) : ws.once('close', resolve)));
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(ws)); ws.once('error', reject); });
}

const proofFor = (password, ch) => crypto.createHmac('sha256', crypto.pbkdf2Sync(password, ch.salt, ch.iterations, 32, 'sha256')).update(ch.nonce).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function testSecurity() {
  // Пароль сети: вызов-ответ, пароль по сети не передаётся, блокировка после ошибок.
  let srv = createRoomServer({ name: 'закрытая', port: 0, password: 'секрет', limits: { maxFails: 3, lockMs: 500 } });
  let port = await srv.start();
  let c = await rawClient('ws://127.0.0.1:' + port);
  let ch = await c.next((m) => m.t === 'challenge');
  assert.strictEqual(ch.needPassword, true);
  c.send(JSON.stringify({ t: 'hello', uid: 'u1', name: 'без пароля' }));
  assert.strictEqual((await c.next((m) => m.t === 'error')).code, 'need-password');
  for (let i = 0; i < 3; i++) {
    c = await rawClient('ws://127.0.0.1:' + port);
    ch = await c.next((m) => m.t === 'challenge');
    c.send(JSON.stringify({ t: 'hello', uid: 'u1', name: 'x', proof: proofFor('не тот', ch) }));
    assert.strictEqual((await c.next((m) => m.t === 'error')).code, 'bad-password');
  }
  c = await rawClient('ws://127.0.0.1:' + port);
  assert.strictEqual((await c.next((m) => m.t === 'error')).code, 'refused', 'после трёх ошибок адрес заблокирован');
  await sleep(600);
  c = await rawClient('ws://127.0.0.1:' + port);
  ch = await c.next((m) => m.t === 'challenge');
  c.send(JSON.stringify({ t: 'hello', uid: 'u1', name: 'свой', proof: proofFor('секрет', ch) }));
  await c.next((m) => m.t === 'welcome');
  // Чужой вызов повторить нельзя: ответ привязан к случайному nonce этого соединения.
  const stale = proofFor('секрет', ch);
  const c2 = await rawClient('ws://127.0.0.1:' + port);
  await c2.next((m) => m.t === 'challenge');
  c2.send(JSON.stringify({ t: 'hello', uid: 'u2', name: 'повтор', proof: stale }));
  assert.strictEqual((await c2.next((m) => m.t === 'error')).code, 'bad-password', 'подслушанный ответ не подходит');
  c.close();
  await srv.stop();

  // Не представился — отключают. Бинарные данные и всплески сообщений — тоже.
  srv = createRoomServer({ name: 'лимиты', port: 0, limits: { handshakeMs: 250, burst: 6, refillPerSec: 0, perIp: 3 } });
  port = await srv.start();
  c = await rawClient('ws://127.0.0.1:' + port);
  await c.closedPromise();
  c = await rawClient('ws://127.0.0.1:' + port);
  c.send(Buffer.from([1, 2, 3]));
  await c.closedPromise();
  c = await rawClient('ws://127.0.0.1:' + port);
  c.send(JSON.stringify({ t: 'hello', uid: 'flood', name: 'флуд' }));
  await c.next((m) => m.t === 'welcome');
  for (let i = 0; i < 20; i++) c.send(JSON.stringify({ t: 'status', status: 'online' }));
  assert.ok((await c.closedPromise()) >= 1000, 'флуд разрывает соединение');
  const open = [];
  for (let i = 0; i < 3; i++) open.push(await rawClient('ws://127.0.0.1:' + port));
  const over = await rawClient('ws://127.0.0.1:' + port);
  assert.strictEqual((await over.next((m) => m.t === 'error')).code, 'refused', 'больше трёх соединений с адреса нельзя');
  open.forEach((w) => w.close());
  await srv.stop();

  // Владелец исключает и банит. Адрес 127.0.0.1 не банится, чтобы не запереть владельца.
  srv = createRoomServer({ name: 'бан', port: 0, ownerUid: 'boss' });
  port = await srv.start();
  const hello = async (uid, name) => {
    const w = await rawClient('ws://127.0.0.1:' + port);
    w.send(JSON.stringify({ t: 'hello', uid, name }));
    const welcome = await w.next((m) => m.t === 'welcome' || m.t === 'error');
    return { w, welcome };
  };
  const boss = await hello('boss', 'Владелец');
  const guest = await hello('guest', 'Гость');
  const guestSid = guest.welcome.sid;
  guest.w.send(JSON.stringify({ t: 'kick', sid: boss.welcome.sid }));
  assert.match((await guest.w.next((m) => m.t === 'error')).text, /только владелец/);
  boss.w.send(JSON.stringify({ t: 'kick', sid: guestSid, ban: true }));
  assert.strictEqual((await guest.w.next((m) => m.t === 'error')).code, 'banned');
  await guest.w.closedPromise();
  assert.strictEqual((await hello('guest', 'Гость')).welcome.code, 'banned', 'забаненный uid не входит');
  assert.strictEqual((await hello('other', 'Другой')).welcome.t, 'welcome', 'локальный адрес не банится');
  await srv.stop();

  // TLS: wss работает, отпечаток совпадает, обычный ws к TLS-порту не подключается.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corsa-tls-'));
  const cert = await ensureCert(dir);
  assert.strictEqual((await ensureCert(dir)).fingerprint, cert.fingerprint, 'сертификат переиспользуется');
  srv = createRoomServer({ name: 'tls', port: 0, tls: { key: cert.key, cert: cert.cert } });
  port = await srv.start();
  const secure = await rawClient('wss://127.0.0.1:' + port, { rejectUnauthorized: false });
  assert.strictEqual(secure._socket.getPeerCertificate().fingerprint256, cert.fingerprint);
  assert.strictEqual((await secure.next((m) => m.t === 'challenge')).needPassword, false);
  secure.close();
  await assert.rejects(rawClient('wss://127.0.0.1:' + port), 'без доверия к сертификату соединение не открывается');
  await assert.rejects(rawClient('ws://127.0.0.1:' + port));
  await srv.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- UPnP на макете роутера ----------
async function testUpnp() {
  const http = require('http');
  const upnp = require('../upnp');
  const mapped = new Map();
  let externalIp = '203.0.113.7';
  let evilControl = false;
  const igd = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/desc.xml') {
        res.end(`<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>${evilControl ? 'http://8.8.8.8/ctl' : '/ctl'}</controlURL></service></serviceList></device></root>`);
        return;
      }
      const action = /#(\w+)"/.exec(req.headers.soapaction || '')[1];
      const arg = (n) => (new RegExp(`<${n}>([^<]*)</${n}>`).exec(body) || [])[1];
      const reply = (inner) => res.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`);
      if (action === 'GetExternalIPAddress') return reply(`<u:GetExternalIPAddressResponse><NewExternalIPAddress>${externalIp}</NewExternalIPAddress></u:GetExternalIPAddressResponse>`);
      if (action === 'AddPortMapping') {
        const ext = Number(arg('NewExternalPort'));
        if (ext === 7777) { res.statusCode = 500; return res.end('<errorDescription>ConflictInMappingEntry</errorDescription>'); }
        mapped.set(ext, { internal: Number(arg('NewInternalPort')), client: arg('NewInternalClient'), proto: arg('NewProtocol') });
        return reply('<u:AddPortMappingResponse/>');
      }
      if (action === 'DeletePortMapping') { mapped.delete(Number(arg('NewExternalPort'))); return reply('<u:DeletePortMappingResponse/>'); }
      res.statusCode = 400; return res.end();
    });
  });
  await new Promise((r) => igd.listen(0, '127.0.0.1', r));
  const location = `http://127.0.0.1:${igd.address().port}/desc.xml`;

  const m = await upnp.openPort({ port: 7777, location });
  assert.strictEqual(m.externalIp, '203.0.113.7');
  assert.strictEqual(m.externalPort, 7778, 'занятый внешний порт пропускается');
  assert.deepStrictEqual(mapped.get(7778), { internal: 7777, client: '127.0.0.1', proto: 'TCP' });
  assert.strictEqual(m.cgnat, false);
  await upnp.closePort(m);
  assert.strictEqual(mapped.size, 0, 'при остановке сопоставление удаляется');

  externalIp = '100.64.1.2';
  assert.strictEqual((await upnp.openPort({ port: 9000, location })).cgnat, true, 'общий адрес провайдера определяется');
  evilControl = true;
  await assert.rejects(upnp.openPort({ port: 9100, location }), /внешний адрес/, 'роутер не может направить нас на чужой адрес');
  await assert.rejects(upnp.openPort({ port: 9100, location: 'http://8.8.8.8/desc.xml' }), /локальной сети/);
  await new Promise((r) => igd.close(r));
}

// Каналы, ответы, правка, удаление, реакции, «печатает…», новые поля профиля и статусы.
async function testChat() {
  const srv = createRoomServer({ name: 'чат', port: 0, ownerUid: 'own' });
  const port = await srv.start();
  const a = await connect(port);
  a.send(JSON.stringify({ t: 'hello', uid: 'own', name: 'Хозяин' }));
  await a.next((m) => m.t === 'welcome');
  const b = await connect(port);
  b.send(JSON.stringify({
    t: 'hello', uid: 'guest', name: 'Гость', status: 'dnd', color2: '#112233', nameColor: 'red', nameFont: 'script', effect: 'snow', plate: 'aurora',
    plateUrl: 'https://evil.com/p.png', cardStyle: 'glass', badges: ['gamer', 'hacker', 'gamer', 'cat'], links: [{ label: 'Steam', url: 'kolya' }, {}, {}, { label: 'лишняя' }],
  }));
  const wb = await b.next((m) => m.t === 'welcome');
  const g = wb.members.find((m) => m.sid === wb.sid);
  assert.strictEqual(g.status, 'dnd');
  assert.strictEqual(g.color2, '#112233');
  assert.strictEqual(g.nameColor, null, 'цвет только в виде #rrggbb');
  assert.strictEqual(g.nameFont, 'script');
  assert.strictEqual(g.effect, 'snow');
  assert.strictEqual(g.plateUrl, null, 'табличка только с проверенных сайтов');
  assert.deepStrictEqual(g.badges, ['gamer', 'cat'], 'неизвестные и повторные значки отбрасываются');
  assert.deepStrictEqual(g.links, [{ label: 'Steam', url: 'kolya' }]);
  assert.ok(g.since > 0 && g.joinedAt > 0);
  assert.strictEqual(wb.members.find((m) => m.name === 'Хозяин').host, true);

  // Каналы меняет только владелец.
  b.send(JSON.stringify({ t: 'channel-set', op: 'add', name: 'взлом', type: 'text' }));
  assert.match((await b.next((m) => m.t === 'error')).text, /только владелец/);
  a.send(JSON.stringify({ t: 'channel-set', op: 'add', name: 'арт', type: 'text', category: 'Творчество', nsfw: true, topic: 'рисунки' }));
  const added = (await b.next((m) => m.t === 'room' && m.room.channels.length === 6)).room.channels.pop();
  assert.deepStrictEqual({ name: added.name, category: added.category, nsfw: added.nsfw, topic: added.topic }, { name: 'арт', category: 'Творчество', nsfw: true, topic: 'рисунки' });
  a.send(JSON.stringify({ t: 'channel-set', op: 'edit', id: added.id, name: 'арт-18', nsfw: false }));
  const edited = (await b.next((m) => m.t === 'room' && m.room.channels.some((c) => c.name === 'арт-18'))).room.channels.find((c) => c.id === added.id);
  assert.strictEqual(edited.nsfw, false);
  a.send(JSON.stringify({ t: 'channel-set', op: 'move', id: added.id, dir: -1 }));
  const moved = (await b.next((m) => m.t === 'room' && m.room.channels[4].id === added.id)).room.channels;
  assert.strictEqual(moved[4].id, added.id);

  // Ответ, правка и удаление.
  a.send(JSON.stringify({ t: 'msg', channel: 'general', text: 'исходное' }));
  const orig = (await b.next((m) => m.t === 'msg')).msg;
  b.send(JSON.stringify({ t: 'msg', channel: 'general', text: 'ответ', reply: orig.id }));
  const rep = (await a.next((m) => m.t === 'msg' && m.msg.text === 'ответ')).msg;
  assert.deepStrictEqual(rep.reply, { id: orig.id, name: 'Хозяин', text: 'исходное' });
  b.send(JSON.stringify({ t: 'edit', channel: 'general', id: orig.id, text: 'чужая правка' }));
  a.send(JSON.stringify({ t: 'edit', channel: 'general', id: orig.id, text: 'исправлено' }));
  const ed = await b.next((m) => m.t === 'edit');
  assert.strictEqual(ed.msg.text, 'исправлено', 'чужое сообщение изменить нельзя, своё можно');
  assert.ok(ed.msg.edited);
  b.send(JSON.stringify({ t: 'delete', channel: 'general', id: orig.id }));
  a.send(JSON.stringify({ t: 'delete', channel: 'general', id: rep.id }));
  const del = await b.next((m) => m.t === 'delete');
  assert.strictEqual(del.id, rep.id, 'гость не удалит чужое, владелец удалит любое');

  // Реакции: обычный эмодзи, свой эмодзи только с проверенного сайта, повторное нажатие снимает.
  b.send(JSON.stringify({ t: 'react', channel: 'general', id: orig.id, emoji: '🔥' }));
  let rx = await a.next((m) => m.t === 'react');
  assert.strictEqual(rx.reactions['🔥'].length, 1);
  b.send(JSON.stringify({ t: 'react', channel: 'general', id: orig.id, emoji: 'текст' }));
  b.send(JSON.stringify({ t: 'react', channel: 'general', id: orig.id, emoji: ':cat:', url: 'https://evil.com/c.png' }));
  b.send(JSON.stringify({ t: 'react', channel: 'general', id: orig.id, emoji: ':cat:', url: 'https://i.imgur.com/c.png' }));
  rx = await a.next((m) => m.t === 'react');
  assert.deepStrictEqual(Object.keys(rx.reactions), ['🔥', ':cat:'], 'текст и чужой сайт не становятся реакцией');
  assert.strictEqual(rx.remoji[':cat:'], 'https://i.imgur.com/c.png');
  b.send(JSON.stringify({ t: 'react', channel: 'general', id: orig.id, emoji: '🔥' }));
  rx = await a.next((m) => m.t === 'react');
  assert.ok(!rx.reactions['🔥']);

  // «Печатает…» приходит другим, но не чаще раза в две секунды.
  b.send(JSON.stringify({ t: 'typing', channel: 'general' }));
  b.send(JSON.stringify({ t: 'typing', channel: 'general' }));
  assert.strictEqual((await a.next((m) => m.t === 'typing')).sid, wb.sid);
  await assert.rejects(a.next((m) => m.t === 'typing', 400), /таймаут/);

  // Голос: флаги и «кого смотрит» только внутри своего канала.
  b.send(JSON.stringify({ t: 'voice', channel: 'voice1', muted: true }));
  const vm = await a.next((m) => m.t === 'member' && m.member.sid === wb.sid && m.member.muted);
  assert.strictEqual(vm.member.muted, true);
  b.send(JSON.stringify({ t: 'voice-flags', screen: true, watching: 'nobody' }));
  const vf = await a.next((m) => m.t === 'member' && m.member.sid === wb.sid && m.member.screen);
  assert.strictEqual(vf.member.watching, null);
  b.send(JSON.stringify({ t: 'ping', ts: 123 }));
  assert.strictEqual((await b.next((m) => m.t === 'pong')).ts, 123);

  // Удалённый канал пропадает вместе с историей, последний текстовый канал не удаляется.
  a.send(JSON.stringify({ t: 'channel-set', op: 'delete', id: 'voice1' }));
  await b.next((m) => m.t === 'room' && !m.room.channels.some((c) => c.id === 'voice1'));
  const v2 = await b.next((m) => m.t === 'voice' && !('voice1' in m.voice));
  assert.ok(v2, 'голосовой канал пропадает из состояния голоса');
  const left = await b.next((m) => m.t === 'member' && m.member.sid === wb.sid && !m.member.screen, 300).catch(() => null);
  assert.ok(left === null || left.member.watching === null);
  a.close(); b.close();
  await srv.stop();
}

// Поиск комнат в локальной сети: ответ приходит на запрос, сведения о комнате верные.
async function testLan() {
  const lan = require('../server/lan');
  const port = 47000 + Math.floor(Math.random() * 900);
  const responder = lan.createResponder({ port, getInfo: () => ({ name: 'Комната Коли', locked: true, members: 3, max: 50, port: 7777, fp: 'AB:CD' }) });
  await responder.ready;
  const found = await lan.scan({ port, timeoutMs: 600, extra: ['127.0.0.1'] });
  responder.close();
  const r = found.find((x) => x.name === 'Комната Коли');
  assert.ok(r, 'комната должна найтись');
  assert.deepStrictEqual({ port: r.port, locked: r.locked, members: r.members }, { port: 7777, locked: true, members: 3 });
  assert.strictEqual(lan.sameNet('8.8.8.8'), false, 'адресам из интернета сервер не отвечает');
}

(async () => {
  testCode(); console.log('ok  код комнаты');
  testAllowlist(); console.log('ok  список сайтов');
  testStickers(); console.log('ok  библиотека стикеров и импорт/экспорт');
  await testServer(); console.log('ok  сервер комнаты');
  await testSecurity(); console.log('ok  защита: пароль, лимиты, бан, TLS');
  await testUpnp(); console.log('ok  UPnP на макете роутера');
  await testChat(); console.log('ok  каналы, ответы, правка, реакции, «печатает…», профиль');
  await testLan(); console.log('ok  поиск комнат в локальной сети');
})().catch((e) => { console.error('ПРОВАЛ:', e); process.exit(1); });
