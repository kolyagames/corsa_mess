// Интернет-мост: открывает комнату через публичный relay по протоколу bore (https://github.com/ekzhang/bore).
// Не нужны ни роутер, ни UPnP, ни VPN: хозяин держит исходящее соединение к relay, relay отдаёт ему подключения друзей.
// Шифрование (TLS с закреплением сертификата) и пароль комнаты остаются сквозными: relay видит только зашифрованные байты,
// но знает, что кто-то подключился, и адреса подключающихся.
//
// Протокол: управляющее TCP-соединение к relay:7835, сообщения — JSON, разделённый нулевым байтом.
//   клиент → {"Hello":порт}            (0 — любой свободный)       сервер → {"Hello":порт}
//   сервер → "Heartbeat"               (примерно дважды в секунду)
//   сервер → {"Connection":"<uuid>"}   кто-то подключился к порту relay
//   клиент открывает новое соединение к relay:7835 и шлёт {"Accept":"<uuid>"}, дальше по нему идут байты подключившегося.
const net = require('net');

const CONTROL_PORT = 7835;
const MAX_ACTIVE = 64; // одновременно принимаемых соединений
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

// Читает сообщения, разделённые нулевым байтом. Всё, что не JSON, пропускается.
function readFrames(socket, onFrame) {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > 64 * 1024) { socket.destroy(); return; }
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!raw) continue;
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { continue; }
      onFrame(msg);
    }
  });
}

// adopt(socket) — принять соединение друга (его отдают серверу комнаты). onState('open'|'reconnecting'|'closed', {port, relay, error}).
function openTunnel({ relay = 'bore.pub', controlPort = CONTROL_PORT, preferPort = 0, adopt, onState = () => {} }) {
  if (!HOST.test(String(relay))) return Promise.reject(new Error('Некорректный адрес relay'));
  return new Promise((resolve, reject) => {
    let closed = false;
    let control = null;
    let port = 0;
    let asked = Number.isInteger(preferPort) && preferPort >= 1024 && preferPort <= 65535 ? preferPort : 0;
    let lastSeen = Date.now();
    let attempt = 0;
    let first = true;
    let retryTimer = null;
    const active = new Set();

    const state = (s, extra) => { try { onState(s, { port, relay, ...extra }); } catch (e) { /* слушатель сломан */ } };

    function accept(id) {
      if (!UUID.test(String(id)) || active.size >= MAX_ACTIVE) return;
      const s = net.connect({ host: relay, port: controlPort });
      active.add(s);
      s.setNoDelay(true);
      const timer = setTimeout(() => s.destroy(), 8000);
      s.once('connect', () => {
        clearTimeout(timer);
        s.write(JSON.stringify({ Accept: id }) + '\0');
        // Дальше по сокету идут байты друга: отдаём его серверу комнаты.
        if (!adopt(s)) s.destroy();
      });
      s.on('error', () => s.destroy());
      s.on('close', () => { clearTimeout(timer); active.delete(s); });
    }

    function connect() {
      if (closed) return;
      const sock = net.connect({ host: relay, port: controlPort });
      control = sock;
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 15000);
      lastSeen = Date.now();
      const connectTimer = setTimeout(() => sock.destroy(new Error('relay не отвечает')), 10000);
      let gotHello = false;
      sock.once('connect', () => { clearTimeout(connectTimer); sock.write(JSON.stringify({ Hello: asked }) + '\0'); });
      readFrames(sock, (msg) => {
        lastSeen = Date.now();
        if (msg === 'Heartbeat') return;
        if (msg && typeof msg === 'object') {
          if (Number.isInteger(msg.Hello)) {
            gotHello = true;
            attempt = 0;
            port = msg.Hello;
            asked = port; // после обрыва просим тот же порт: код для друзей не меняется
            state('open');
            if (first) { first = false; resolve({ get port() { return port; }, relay, close }); }
          } else if (msg.Connection) accept(msg.Connection);
          else if (msg.Challenge) sock.destroy(new Error('Этот relay требует секрет, а он не поддерживается'));
          else if (typeof msg.Error === 'string') {
            // Занятый предпочитаемый порт — не беда: пробуем любой свободный.
            if (asked && !gotHello) { asked = 0; sock.destroy(new Error('retry-any-port')); } else sock.destroy(new Error(String(msg.Error).slice(0, 200)));
          }
        }
      });
      sock.on('error', (e) => { sock.lastError = e; });
      sock.on('close', () => {
        clearTimeout(connectTimer);
        if (control === sock) control = null;
        if (closed) return;
        const err = sock.lastError ? String(sock.lastError.message || sock.lastError) : 'соединение закрыто';
        if (err === 'retry-any-port') { connect(); return; }
        if (first) { closed = true; clearInterval(watchdog); reject(new Error('Не удалось открыть мост: ' + err)); return; }
        // Связь с relay пропала: переподключаемся с нарастающей паузой.
        state('reconnecting', { error: err });
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5));
        retryTimer = setTimeout(connect, delay);
        if (retryTimer.unref) retryTimer.unref();
      });
    }

    // relay молчит дольше 10 секунд (а он шлёт Heartbeat дважды в секунду) — считаем связь оборванной.
    const watchdog = setInterval(() => { if (control && Date.now() - lastSeen > 10000) control.destroy(new Error('relay замолчал')); }, 2000);
    if (watchdog.unref) watchdog.unref();

    function close() {
      if (closed && !control) return;
      closed = true;
      clearInterval(watchdog);
      clearTimeout(retryTimer);
      if (control) control.destroy();
      for (const s of active) s.destroy();
      active.clear();
      state('closed');
    }

    connect();
  });
}

module.exports = { openTunnel, readFrames, CONTROL_PORT, HOST };
