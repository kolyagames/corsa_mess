const { app, BrowserWindow, ipcMain, protocol, session, desktopCapturer, shell, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRoomServer } = require('./server/room-server');
const { ensureCert } = require('./server/cert');
const Code = require('./shared/code');
const Allowlist = require('./shared/allowlist');
const { startPresenceBridge } = require('./presence');
const upnp = require('./upnp');

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
};

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

function serveCorsa(request) {
  const url = new URL(request.url);
  const roots = {
    app: path.join(__dirname, 'src'),
    shared: path.join(__dirname, 'shared'),
    plugins: pluginsDir(),
    themes: themesDir(),
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

function lanIps() {
  const res = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address);
      res.push({ name, address: i.address, priv });
    }
  }
  return res.sort((a, b) => Number(b.priv) - Number(a.priv));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#0e0407', title: 'corsa-mess', show: !process.env.CORSA_TEST,
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.loadURL(APP_ORIGIN + '/');
}

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
    });
    const actual = await srv.start();
    roomServer = srv;
    hostPort = actual;
    hostHasPassword = !!password;
    const ips = lanIps();
    const best = ips[0] && ips[0].address;
    return {
      port: actual, ips, code: best ? Code.encode(best, actual) : null, local: Code.encode('127.0.0.1', actual),
      fingerprint: hostCert.fingerprint, protected: hostHasPassword,
    };
  });
  ipcMain.handle('host:stop', async () => {
    await closeMapping();
    if (roomServer) { await roomServer.stop(); roomServer = null; }
    hostPort = 0;
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
  bridge = startPresenceBridge({ onChange: (a) => win && !win.isDestroyed() && win.webContents.send('presence:change', a) });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  if (bridge) bridge.stop();
  await closeMapping();
  if (roomServer) await roomServer.stop();
  app.quit();
});
