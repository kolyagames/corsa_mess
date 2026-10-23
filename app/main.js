const { app, BrowserWindow, ipcMain, protocol, session, desktopCapturer, shell, dialog, Notification, globalShortcut, net, Tray, Menu, nativeImage, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRoomServer } = require('./server/room-server');
const { ensureCert } = require('./server/cert');
const Code = require('./shared/code');
const Allowlist = require('./shared/allowlist');
const { startPresenceBridge } = require('./presence');
const { startMediaWatch } = require('./media');
const upnp = require('./upnp');
const lan = require('./server/lan');
const updater = require('./updater');

// Одна копия приложения: повторный запуск просто показывает уже открытое окно (оно могло быть свёрнуто в трей).
if (!process.env.CORSA_TEST && !app.requestSingleInstanceLock()) app.exit(0);
// Запуск вместе с Windows идёт с ключом --hidden: окно не показывается, приложение ждёт в трее.
const startHidden = process.argv.includes('--hidden');

// В локальной сети голос соединяется напрямую по адресам компьютеров. Chromium по умолчанию прячет их
// за случайными именами .local, а в Windows такие имена часто не находятся: голос тогда не соединяется.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// Отладочный порт даёт любому процессу на компьютере полный контроль над приложением, поэтому он запрещён.
// Исключение — только скрытый тестовый запуск (CORSA_TEST), он работает с отдельным профилем.
if (!process.env.CORSA_TEST && process.argv.some((a) => /^--(remote-debugging|inspect)/.test(a))) {
  console.error('Отладочный порт запрещён: он даёт полный доступ к приложению.');
  app.exit(1);
}

const APP_ORIGIN = 'corsa://app';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
};
const SOUND_EXT = /\.(mp3|ogg|wav|m4a|webm)$/i;

// Уведомления Windows показываются от имени приложения, а не «Electron».
if (process.platform === 'win32') app.setAppUserModelId('corsa-mess');

protocol.registerSchemesAsPrivileged([
  { scheme: 'corsa', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let roomServer = null;
let selectedScreenSource = null;
let bridge = null;
let hostPort = 0;
let hostHasPassword = false;
let hostCert = null;
let mapping = null;
let renewTimer = null;
let lanResponder = null;
let media = null;
let roomBinding = null; // комната, к которой сейчас подключён интерфейс: {host, port, token} для файлов
let tray = null;
let quitting = false;
let trayHintShown = false;
let updateFile = null; // скачанный и проверенный архив обновления
const prefs = { closeToTray: true };
let pins = {}; // закреплённые отпечатки серверов: адрес -> sha256

// Все запросы из интерфейса принимаются только от нашей страницы в нашем окне.
const isTrusted = (e) => {
  try { return !!win && e.sender === win.webContents && !!e.senderFrame && e.senderFrame.url.startsWith('corsa://app/'); } catch (err) { return false; }
};
const rawHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => rawHandle(channel, (e, ...args) => {
  if (!isTrusted(e)) throw new Error('Запрос отклонён');
  return fn(e, ...args);
});

const userDir = () => app.getPath('userData');
const pluginsDir = () => path.join(userDir(), 'plugins');
const themesDir = () => path.join(userDir(), 'themes');
const soundsDir = () => path.join(userDir(), 'sounds');

function csp() {
  const hosts = Allowlist.cspHosts();
  return [
    "default-src 'none'",
    "script-src 'self' corsa:",
    "style-src 'self' corsa: 'unsafe-inline'",
    `img-src 'self' corsa: data: blob: ${hosts}`,
    `media-src 'self' corsa: blob: ${hosts}`,
    "font-src 'self' corsa:",
    'connect-src ws: wss: corsa:',
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function resolveSafe(root, rel) {
  const full = path.normalize(path.join(root, decodeURIComponent(rel)));
  const base = path.normalize(root + path.sep);
  return full.startsWith(base) ? full : null;
}

// Файл комнаты: corsa://roomfile/<id> → https://<комната>/f/<id>. Запрос идёт через сеть Chromium,
// поэтому сертификат комнаты проверяется закреплённым отпечатком, как и само подключение.
async function roomFile(request, url) {
  const id = url.pathname.replace(/^\//, '');
  if (!roomBinding || !/^[0-9a-f]{24}$/.test(id)) return new Response('not found', { status: 404 });
  const headers = { 'X-Corsa-Token': roomBinding.token };
  const range = request.headers.get('range');
  if (range) headers.Range = range;
  try {
    const r = await net.fetch(`https://${roomBinding.host}:${roomBinding.port}/f/${id}`, { headers });
    const out = { 'Cache-Control': 'no-store' };
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = r.headers.get(k); if (v) out[k] = v; }
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) { return new Response('', { status: 502 }); }
}

function serveCorsa(request) {
  const url = new URL(request.url);
  if (url.hostname === 'roomfile') return roomFile(request, url);
  const roots = {
    app: path.join(__dirname, 'src'),
    shared: path.join(__dirname, 'shared'),
    plugins: pluginsDir(),
    themes: themesDir(),
    sounds: soundsDir(),
  };
  const root = roots[url.hostname];
  if (!root) return new Response('not found', { status: 404 });
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  const file = resolveSafe(root, rel);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
  const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (url.hostname === 'app' && file.endsWith('.html')) headers['Content-Security-Policy'] = csp();
  return new Response(fs.readFileSync(file), { headers });
}

function seedExamples() {
  fs.mkdirSync(path.join(pluginsDir(), 'hello'), { recursive: true });
  fs.mkdirSync(themesDir(), { recursive: true });
  const examples = path.join(__dirname, 'examples');
  const copy = (from, to) => { if (!fs.existsSync(to) && fs.existsSync(from)) fs.copyFileSync(from, to); };
  copy(path.join(examples, 'plugins', 'hello', 'manifest.json'), path.join(pluginsDir(), 'hello', 'manifest.json'));
  copy(path.join(examples, 'plugins', 'hello', 'index.js'), path.join(pluginsDir(), 'hello', 'index.js'));
  for (const f of fs.existsSync(path.join(examples, 'themes')) ? fs.readdirSync(path.join(examples, 'themes')) : []) {
    copy(path.join(examples, 'themes', f), path.join(themesDir(), f));
  }
}

function listPlugins() {
  const out = [];
  for (const id of fs.existsSync(pluginsDir()) ? fs.readdirSync(pluginsDir()) : []) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginsDir(), id, 'manifest.json'), 'utf8'));
      const main = manifest.main || 'index.js';
      const mainFile = resolveSafe(path.join(pluginsDir(), id), main);
      if (!mainFile) continue;
      // Хэш файлов плагина: если они изменятся после того, как вы его включили, плагин не запустится.
      const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(pluginsDir(), id, 'manifest.json'))).update(fs.readFileSync(mainFile)).digest('hex');
      out.push({
        id, hash, name: String(manifest.name || id), version: String(manifest.version || ''),
        description: String(manifest.description || ''), author: String(manifest.author || ''),
        url: `corsa://plugins/${encodeURIComponent(id)}/${main.split('/').map(encodeURIComponent).join('/')}`,
      });
    } catch (e) { /* папка без manifest.json пропускается */ }
  }
  return out;
}

function listThemes() {
  const out = [];
  for (const file of fs.existsSync(themesDir()) ? fs.readdirSync(themesDir()) : []) {
    if (!file.endsWith('.css')) continue;
    const head = fs.readFileSync(path.join(themesDir(), file), 'utf8').slice(0, 400);
    const name = (head.match(/@name\s+(.+?)\s*(?:\*\/|\r?\n|$)/) || [])[1];
    const description = (head.match(/@description\s+(.+?)\s*(?:\*\/|\r?\n|$)/) || [])[1];
    out.push({
      id: file, name: (name || file.replace(/\.css$/, '')).trim(), description: (description || '').trim(),
      url: 'corsa://themes/' + encodeURIComponent(file),
    });
  }
  return out;
}

// Сети компьютера по порядку: сначала настоящая домашняя сеть (Wi-Fi, Ethernet), потом общие VPN-сети,
// в конце виртуальные адаптеры (VirtualBox, Hyper-V, WSL): по их адресам друзья не подключатся.
const VIRTUAL_NET = /virtualbox|vbox|vmware|vethernet|hyper-v|wsl|docker|npcap|bluetooth|loopback/i;
const VPN_NET = /radmin|zerotier|hamachi|tailscale|wireguard|openvpn|tap-|wintun|nordlynx|proton|outline/i;
function lanIps() {
  const res = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || /^169\.254\./.test(i.address)) continue;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address);
      const kind = VIRTUAL_NET.test(name) || /^192\.168\.56\./.test(i.address) ? 'virtual' : VPN_NET.test(name) || /^(25|26)\./.test(i.address) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address) ? 'vpn' : priv ? 'lan' : 'other';
      res.push({ name, address: i.address, priv, kind });
    }
  }
  const rank = { lan: 0, vpn: 1, other: 2, virtual: 3 };
  return res.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

// Какие плагины включены в BetterDiscord и Vencord (Vesktop, Equicord). Настройки читаются только у плагинов из списка ниже:
// их значения переносятся в такие же плагины corsa-mess. Остальные настройки (например, списки друзей Discord) не читаются.
const BD_SETTINGS = ['DiscordEffects'];
const VENCORD_SETTINGS = ['CustomRPC', 'MessageLogger', 'BlurNSFW', 'NitroSoundpad', 'AnonymiseFileNames', 'VoiceMessages', 'CallTimer'];
function migrationScan() {
  const out = [];
  const tryJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } };
  const appData = app.getPath('appData');
  const bdDirs = [path.join(appData, 'BetterDiscord')];
  // Переносная сборка BetterDiscord может лежать в папке программы в домашнем каталоге (например, «Better Vesktop»).
  try {
    for (const d of fs.readdirSync(os.homedir(), { withFileTypes: true })) if (d.isDirectory()) bdDirs.push(path.join(os.homedir(), d.name, 'BetterDiscord'));
  } catch (e) { /* ignore */ }
  for (const dir of bdDirs) {
    for (const channel of ['stable', 'canary', 'ptb']) {
      const j = tryJson(path.join(dir, 'data', channel, 'plugins.json'));
      if (!j || typeof j !== 'object') continue;
      const enabled = Object.entries(j).filter(([, v]) => v === true).map(([k]) => String(k).slice(0, 64));
      const themesDirBd = path.join(dir, 'themes');
      const themes = fs.existsSync(themesDirBd) ? fs.readdirSync(themesDirBd).filter((f) => f.endsWith('.theme.css')).map((f) => f.replace(/\.theme\.css$/, '')) : [];
      const settings = {};
      for (const name of BD_SETTINGS) if (enabled.includes(name)) { const c = tryJson(path.join(dir, 'plugins', name + '.config.json')); if (c) settings[name] = c; }
      out.push({ app: 'BetterDiscord', where: dir, enabled, themes, settings });
    }
  }
  for (const [label, dir] of [['Vesktop', 'vesktop'], ['Vencord', 'Vencord'], ['Equicord', 'Equicord'], ['Equibop', 'equibop']]) {
    const j = tryJson(path.join(appData, dir, 'settings', 'settings.json'));
    if (!j || !j.plugins || typeof j.plugins !== 'object') continue;
    const enabled = Object.entries(j.plugins).filter(([, v]) => v && v.enabled === true).map(([k]) => String(k).slice(0, 64));
    const settings = {};
    for (const name of VENCORD_SETTINGS) if (enabled.includes(name)) settings[name] = j.plugins[name];
    out.push({ app: label, where: path.join(appData, dir), enabled, themes: [], settings });
  }
  return out;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#0e0407', title: 'corsa-mess', show: !process.env.CORSA_TEST && !startHidden,
    icon: path.join(__dirname, 'src', 'logo.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0305', symbolColor: '#ecd9dc', height: 32 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, nodeIntegrationInSubFrames: false,
      backgroundThrottling: !process.env.CORSA_TEST,
    },
  });
  win.setMenuBarVisibility(false);
  win.on('focus', () => win.flashFrame(false));
  // Крестик сворачивает в трей: комната, голос и уведомления продолжают работать.
  win.on('close', (e) => {
    if (quitting || !prefs.closeToTray || process.env.CORSA_TEST || !tray) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({ title: 'corsa-mess работает в фоне', body: roomServer ? 'Ваша комната открыта для друзей. Выйти — правый клик по значку в трее.' : 'Открыть или выйти — значок в трее.', icon: path.join(__dirname, 'src', 'logo.png'), silent: true }).show();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.loadURL(APP_ORIGIN + '/');
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Значок в трее: открыть окно, микрофон и звук, выход. Меню обновляется, когда сервер запускается или останавливается.
function updateTrayMenu() {
  if (!tray) return;
  tray.setToolTip(roomServer ? 'corsa-mess — ваша комната открыта' : 'corsa-mess');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть corsa-mess', click: showWindow },
    { type: 'separator' },
    { label: 'Микрофон вкл/выкл', click: () => tellUi('hotkey', 'mute') },
    { label: 'Звук вкл/выкл', click: () => tellUi('hotkey', 'deafen') },
    { type: 'separator' },
    { label: roomServer ? 'Закрыть комнату и выйти' : 'Выйти', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  if (tray || process.env.CORSA_TEST) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'src', 'logo.png')).resize({ width: 16, height: 16 }));
  tray.on('click', showWindow);
  updateTrayMenu();
}

// Секреты (пароль своей комнаты для автозапуска) шифруются средствами Windows и лежат в папке данных.
const SECRET_KEYS = ['hostPassword'];
const secretsFile = () => path.join(userDir(), 'secrets.json');
function readSecrets() { try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')) || {}; } catch (e) { return {}; } }

const pinsFile = () => path.join(userDir(), 'pins.json');
function loadPins() {
  try { pins = JSON.parse(fs.readFileSync(pinsFile(), 'utf8')) || {}; } catch (e) { pins = {}; }
}
function savePins() {
  try { fs.writeFileSync(pinsFile(), JSON.stringify(pins, null, 2)); } catch (e) { /* ignore */ }
}
const tellUi = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// Серверы комнат используют самоподписанные сертификаты. Мы не отключаем проверку, а закрепляем отпечаток:
// при первом подключении запоминаем его, при следующих сверяем. Если отпечаток изменился, соединение блокируется.
function setupCertificates(ses) {
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.verificationResult === 'net::OK') { callback(0); return; }
    let x509;
    try { x509 = new crypto.X509Certificate(request.certificate.data); } catch (e) { callback(-3); return; }
    if (!/CN=corsa-mess/.test(x509.subject)) { callback(-3); return; }
    const host = request.hostname;
    if (/^(127\.|localhost$|::1$)/.test(host)) { callback(0); return; }
    const fp = x509.fingerprint256;
    if (!pins[host]) {
      pins[host] = fp;
      savePins();
      tellUi('tls:event', { kind: 'new', host, fingerprint: fp });
      callback(0);
    } else if (pins[host] === fp) {
      callback(0);
    } else {
      tellUi('tls:event', { kind: 'mismatch', host, fingerprint: fp, expected: pins[host] });
      callback(-2);
    }
  });
}

async function closeMapping() {
  clearInterval(renewTimer);
  renewTimer = null;
  const m = mapping;
  mapping = null;
  if (m) { try { await upnp.closePort(m); } catch (e) { /* роутер мог перезагрузиться */ } }
}

function setupSession() {
  const ses = session.defaultSession;
  setupCertificates(ses);
  const allowed = new Set(['media', 'display-capture', 'fullscreen']);
  const fromApp = (url) => typeof url === 'string' && url.startsWith(APP_ORIGIN);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.has(perm) && fromApp(details.requestingUrl)));
  ses.setPermissionCheckHandler((wc, perm, origin) => allowed.has(perm) && fromApp(origin + '/'));
  ses.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const src = sources.find((s) => s.id === selectedScreenSource) || sources[0];
      if (!src) return callback({});
      callback({ video: src, audio: process.platform === 'win32' ? 'loopback' : undefined });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

function setupIpc() {
  ipcMain.handle('host:start', async (e, opts) => {
    if (roomServer) throw new Error('Сервер уже запущен');
    const name = String(opts && opts.name || 'Комната').slice(0, 40);
    const port = opts && opts.port == null ? 7777 : Number(opts && opts.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Порт должен быть от 1024 до 65535');
    const password = String(opts && opts.password || '').slice(0, 128);
    fs.mkdirSync(path.join(userDir(), 'rooms'), { recursive: true });
    // Сертификат создаётся один раз и хранится в папке данных, чтобы отпечаток не менялся.
    hostCert = hostCert || await ensureCert(userDir());
    const srv = createRoomServer({
      name, port, password, tls: { key: hostCert.key, cert: hostCert.cert },
      ownerUid: String(opts && opts.ownerUid || '').slice(0, 64), historyFile: path.join(userDir(), 'rooms', `${port}.json`),
      filesDir: path.join(userDir(), 'rooms', `${port}-files`),
    });
    const actual = await srv.start();
    roomServer = srv;
    hostPort = actual;
    hostHasPassword = !!password;
    // Комната видна в списке «В вашей сети» у тех, кто в той же сети. Отключается в настройках.
    if (!opts || opts.lanVisible !== false) {
      const id = crypto.randomBytes(6).toString('hex');
      lanResponder = lan.createResponder({ getInfo: () => (roomServer ? { ...roomServer.info(), port: hostPort, fp: hostCert.fingerprint.slice(0, 23), id } : null) });
      await lanResponder.ready;
    }
    updateTrayMenu();
    const ips = lanIps().filter((i) => i.kind !== 'virtual');
    const best = ips[0] && ips[0].address;
    return {
      port: actual, ips, code: best ? Code.encode(best, actual) : null, local: Code.encode('127.0.0.1', actual),
      codes: ips.map((i) => ({ name: i.name, kind: i.kind, address: i.address, code: Code.encode(i.address, actual) })),
      fingerprint: hostCert.fingerprint, protected: hostHasPassword, lanVisible: !!lanResponder,
    };
  });
  ipcMain.handle('host:stop', async () => {
    await closeMapping();
    if (lanResponder) { lanResponder.close(); lanResponder = null; }
    if (roomServer) { await roomServer.stop(); roomServer = null; }
    hostPort = 0;
    updateTrayMenu();
    return true;
  });
  ipcMain.handle('lan:scan', async () => {
    const found = await lan.scan({ timeoutMs: 700 });
    const ips = lanIps();
    const own = new Set(ips.map((i) => i.address));
    // Одна комната отвечает через каждую общую сеть. Оставляем один адрес: сначала настоящую локальную сеть, потом VPN.
    const rank = { lan: 0, vpn: 1, other: 2, virtual: 3 };
    const kindOf = (ip) => { const n = lan.netFor(ip); const i = n && ips.find((x) => x.address === n.address); return i ? i.kind : 'other'; };
    const best = new Map();
    for (const r of found) {
      const key = r.id || `${r.host}:${r.port}`;
      const k = kindOf(r.host);
      const cur = best.get(key);
      if (!cur || rank[k] < rank[cur.kind]) best.set(key, { ...r, kind: k });
    }
    return [...best.values()].map((r) => ({ ...r, mine: own.has(r.host) && r.port === hostPort, code: Code.encode(r.host, r.port) }));
  });
  ipcMain.handle('media:watch', (e, on) => {
    if (on && !media) media = startMediaWatch({ onChange: (t) => tellUi('media:change', t) });
    if (!on && media) { media.stop(); media = null; tellUi('media:change', null); }
    return media ? media.current() : null;
  });
  ipcMain.handle('media:cmd', (e, cmd) => { if (media) media.command(String(cmd)); return true; });
  ipcMain.handle('migrate:scan', () => migrationScan());
  // Фон и автозапуск. Автозапуск с Windows доступен только в собранной версии.
  ipcMain.handle('app:prefs', (e, p) => {
    if (p && typeof p.closeToTray === 'boolean') prefs.closeToTray = p.closeToTray;
    if (p && typeof p.autostart === 'boolean' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: p.autostart, args: ['--hidden'] });
    return { packaged: app.isPackaged, autostart: app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : false, startedHidden: startHidden, version: app.getVersion() };
  });
  ipcMain.handle('secret:set', (e, key, value) => {
    if (!SECRET_KEYS.includes(key)) throw new Error('Неизвестный ключ');
    const all = readSecrets();
    if (!value) delete all[key];
    else if (safeStorage.isEncryptionAvailable()) all[key] = safeStorage.encryptString(String(value).slice(0, 256)).toString('base64');
    else return false;
    fs.writeFileSync(secretsFile(), JSON.stringify(all));
    return true;
  });
  ipcMain.handle('secret:get', (e, key) => {
    if (!SECRET_KEYS.includes(key)) throw new Error('Неизвестный ключ');
    const v = readSecrets()[key];
    try { return v && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : ''; } catch (err) { return ''; }
  });
  // Обновления: проверить, скачать с проверкой суммы, установить и перезапустить.
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', async (e, info) => {
    updateFile = null;
    updateFile = await updater.download(info, (p) => tellUi('update:progress', p));
    return true;
  });
  ipcMain.handle('update:install', () => {
    if (!updateFile) throw new Error('Сначала скачайте обновление');
    updater.install(updateFile);
    quitting = true;
    setTimeout(() => app.quit(), 300);
    return true;
  });
  ipcMain.handle('update:page', (e, url) => { if (/^https:\/\/github\.com\/kolyagames\/corsa_mess\//.test(String(url))) shell.openExternal(String(url)); return true; });
  // Файлы комнаты: интерфейс сообщает, к какой комнате он подключён, загрузка и сохранение идут отсюда.
  ipcMain.handle('room:bind', (e, b) => {
    const ok = b && /^([a-z0-9.-]{1,253}|\[[0-9a-f:]+\])$/i.test(String(b.host)) && Number.isInteger(b.port) && b.port > 0 && b.port < 65536 && /^[0-9a-f]{32}$/.test(String(b.token));
    roomBinding = ok ? { host: String(b.host), port: b.port, token: String(b.token) } : null;
    return !!roomBinding;
  });
  ipcMain.handle('room:upload', async (e, f) => {
    if (!roomBinding) throw new Error('Нет подключения к комнате');
    const data = f && f.data;
    if (!(data instanceof Uint8Array) || !data.length) throw new Error('Пустой файл');
    if (data.length > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ');
    const r = await net.fetch(`https://${roomBinding.host}:${roomBinding.port}/upload`, {
      method: 'POST', body: Buffer.from(data.buffer, data.byteOffset, data.length),
      headers: {
        'X-Corsa-Token': roomBinding.token, 'Content-Type': String(f.type || 'application/octet-stream').slice(0, 80),
        'X-Corsa-Name': encodeURIComponent(String(f.name || 'файл').slice(0, 120)), 'X-Corsa-Voice': f.voice ? '1' : '0', 'X-Corsa-Duration': String(Number(f.dur) || 0),
      },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text || `ошибка ${r.status}`);
    return JSON.parse(text);
  });
  ipcMain.handle('room:save', async (e, f) => {
    if (!roomBinding || !/^[0-9a-f]{24}$/.test(String(f && f.id))) throw new Error('Файл недоступен');
    const name = String(f.name || 'файл').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'файл';
    const r = await dialog.showSaveDialog(win, { defaultPath: name });
    if (r.canceled || !r.filePath) return false;
    const res = await net.fetch(`https://${roomBinding.host}:${roomBinding.port}/f/${f.id}`, { headers: { 'X-Corsa-Token': roomBinding.token } });
    if (!res.ok) throw new Error('Файл удалён или недоступен');
    fs.writeFileSync(r.filePath, Buffer.from(await res.arrayBuffer()));
    return r.filePath;
  });
  // Уведомление Windows о сообщении. По клику окно выходит вперёд и открывает нужный канал или беседу.
  const notes = new Set();
  ipcMain.handle('notify:show', (e, n) => {
    if (!Notification.isSupported() || !n) return false;
    const note = new Notification({ title: String(n.title || 'corsa-mess').slice(0, 80), body: String(n.body || '').slice(0, 240), icon: path.join(__dirname, 'src', 'logo.png'), silent: !!n.silent });
    notes.add(note);
    const done = () => notes.delete(note);
    note.on('close', done);
    note.on('click', () => {
      done();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      tellUi('notify:click', String(n.tag || '').slice(0, 80));
    });
    note.show();
    return true;
  });
  // Мигание кнопки на панели задач, пока окно не в фокусе.
  ipcMain.handle('win:attention', (e, on) => { if (win && !win.isDestroyed() && (!on || !win.isFocused())) win.flashFrame(!!on); return true; });
  // Глобальные клавиши (работают и в игре): [{id, accel}]. Пустой список снимает все.
  ipcMain.handle('hotkeys:global', (e, list) => {
    globalShortcut.unregisterAll();
    const ok = [];
    for (const k of Array.isArray(list) ? list.slice(0, 8) : []) {
      const accel = String(k && k.accel || '');
      const id = String(k && k.id || '').slice(0, 32);
      if (!/^[A-Za-z0-9+]{1,40}$/.test(accel) || !id) continue;
      try { if (globalShortcut.register(accel, () => tellUi('hotkey', id))) ok.push(id); } catch (err) { /* сочетание занято другой программой */ }
    }
    return ok;
  });
  // Звуки для звуковой панели: свои файлы копируются в папку данных и отдаются как corsa://sounds/…
  const listSounds = () => (fs.existsSync(soundsDir()) ? fs.readdirSync(soundsDir()).filter((f) => SOUND_EXT.test(f)) : [])
    .map((file) => ({ file, name: file.replace(SOUND_EXT, ''), url: 'corsa://sounds/' + encodeURIComponent(file) }));
  ipcMain.handle('sounds:list', () => listSounds());
  ipcMain.handle('sounds:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Звук', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'webm'] }] });
    if (r.canceled) return { list: listSounds(), skipped: 0 };
    fs.mkdirSync(soundsDir(), { recursive: true });
    let skipped = 0;
    for (const p of r.filePaths.slice(0, 40)) {
      const ext = (path.extname(p).match(SOUND_EXT) || [''])[0].toLowerCase();
      if (!ext || fs.statSync(p).size > 3 * 1024 * 1024) { skipped++; continue; }
      const base = path.basename(p, path.extname(p)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 40) || 'sound';
      let name = base;
      for (let k = 2; fs.existsSync(path.join(soundsDir(), name + ext)); k++) name = `${base} (${k})`;
      fs.copyFileSync(p, path.join(soundsDir(), name + ext));
    }
    return { list: listSounds(), skipped };
  });
  ipcMain.handle('sounds:remove', (e, file) => {
    const full = resolveSafe(soundsDir(), String(file));
    if (full && SOUND_EXT.test(full) && fs.existsSync(full)) fs.unlinkSync(full);
    return listSounds();
  });
  // Цвет кнопок окна под дизайн (светлый или тёмный).
  ipcMain.handle('window:titlebar', (e, c) => {
    const ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    if (win && c && ok(c.color) && ok(c.symbolColor) && win.setTitleBarOverlay) win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 32 });
    return true;
  });
  // Открыть доступ из интернета: порт на роутере открывается только по нажатию кнопки и только при заданном пароле.
  ipcMain.handle('net:open-internet', async () => {
    if (!roomServer || !hostPort) throw new Error('Сначала запустите сервер');
    if (!hostHasPassword) throw new Error('Для доступа из интернета задайте пароль сети: без него в комнату сможет войти кто угодно');
    await closeMapping();
    const m = await upnp.openPort({ port: hostPort, lease: 3600 });
    mapping = m;
    // Пока сервер работает, продлеваем аренду порта. Роутер сам закроет порт, если приложение закроется аварийно.
    renewTimer = setInterval(() => {
      upnp.openPort({ port: hostPort, lease: 3600, location: m.location }).then((r) => { mapping = r; }).catch(() => {});
    }, 30 * 60 * 1000);
    renewTimer.unref();
    return { externalIp: m.externalIp, externalPort: m.externalPort, cgnat: m.cgnat, code: m.cgnat ? null : Code.encode(m.externalIp, m.externalPort) };
  });
  ipcMain.handle('net:close-internet', async () => { await closeMapping(); return true; });
  ipcMain.handle('tls:pins', () => Object.entries(pins).map(([host, fingerprint]) => ({ host, fingerprint })));
  ipcMain.handle('tls:forget', (e, host) => { delete pins[String(host)]; savePins(); return true; });
  ipcMain.handle('tls:self', async () => {
    hostCert = hostCert || await ensureCert(userDir());
    return { fingerprint: hostCert.fingerprint };
  });
  ipcMain.handle('host:code', (e, ip, port) => {
    try { return Code.encode(String(ip), Number(port)); } catch (err) { return null; }
  });
  ipcMain.handle('net:ips', () => lanIps());
  ipcMain.handle('plugins:list', () => listPlugins());
  ipcMain.handle('themes:list', () => listThemes());
  ipcMain.handle('folder:open', (e, kind) => {
    const dir = kind === 'themes' ? themesDir() : pluginsDir();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });
  ipcMain.handle('screen:select', (e, id) => { selectedScreenSource = String(id); return true; });
  // Экспорт и импорт файлов стикеров через системные окна выбора файла.
  const safeFileName = (n) => {
    let s = String(n || 'stickers').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 60) || 'stickers';
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
    return s;
  };
  ipcMain.handle('files:export', async (e, files) => {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error('Нечего сохранять');
    const items = files.map((f) => ({ name: safeFileName(f.name), text: String(f.text) }));
    if (items.length === 1) {
      const r = await dialog.showSaveDialog(win, { defaultPath: items[0].name + '.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return { saved: 0 };
      fs.writeFileSync(r.filePath, items[0].text);
      return { saved: 1, where: r.filePath };
    }
    const r = await dialog.showOpenDialog(win, { title: 'Куда сохранить файлы категорий', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { saved: 0 };
    const used = new Set();
    for (const it of items) {
      let base = it.name;
      for (let k = 2; used.has(base.toLowerCase()); k++) base = `${it.name} (${k})`;
      used.add(base.toLowerCase());
      fs.writeFileSync(path.join(r.filePaths[0], base + '.json'), it.text);
    }
    return { saved: items.length, where: r.filePaths[0] };
  });
  ipcMain.handle('files:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return [];
    return r.filePaths.slice(0, 50).map((p) => {
      const name = path.basename(p);
      if (fs.statSync(p).size > 2 * 1024 * 1024) return { name, error: 'Файл больше 2 МБ' };
      return { name, text: fs.readFileSync(p, 'utf8') };
    });
  });
  ipcMain.handle('presence:detect', () => (bridge ? bridge.current() : null));
  ipcMain.handle('presence:config', (e, c) => { if (bridge) bridge.configure(c); return true; });
}

app.whenReady().then(() => {
  protocol.handle('corsa', serveCorsa);
  seedExamples();
  loadPins();
  setupSession();
  setupIpc();
  createWindow();
  createTray();
  bridge = startPresenceBridge({ onChange: (a) => win && !win.isDestroyed() && win.webContents.send('presence:change', a) });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', async () => {
  if (bridge) bridge.stop();
  if (media) media.stop();
  if (lanResponder) lanResponder.close();
  await closeMapping();
  if (roomServer) await roomServer.stop();
  app.quit();
});
