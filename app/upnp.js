// Автоматическое открытие порта на домашнем роутере по UPnP (IGD). Без этого друзьям из интернета
// пришлось бы вручную пробрасывать порт. Всё происходит только по нажатию кнопки пользователем.
// Запросы идут только на адреса из локальной сети (роутер), чужие адреса из ответов игнорируются.
const dgram = require('dgram');
const http = require('http');
const { URL } = require('url');

const SEARCH = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1';
const MAX_BODY = 256 * 1024;

const isLocalHost = (h) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/.test(h);
const isCgnat = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const tag = (xml, name) => { const m = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'i').exec(xml); return m ? m[1] : ''; };

function discover({ timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch (e) { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('error', () => finish(null));
    sock.on('message', (buf, rinfo) => {
      const m = /^location:\s*(\S+)/im.exec(buf.toString('utf8'));
      if (!m) return;
      try {
        const u = new URL(m[1]);
        // Ответ должен прийти от устройства из локальной сети и указывать на него же.
        if (u.protocol === 'http:' && isLocalHost(u.hostname) && isLocalHost(rinfo.address)) finish(u.href);
      } catch (e) { /* чужой ответ */ }
    });
    const msg = Buffer.from(['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${SEARCH}`, '', ''].join('\r\n'));
    sock.bind(0, () => sock.send(msg, 1900, '239.255.255.250', (err) => { if (err) finish(null); }));
  });
}

function request(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(new Error('Неверный адрес')); return; }
    if (u.protocol !== 'http:' || !isLocalHost(u.hostname)) { reject(new Error('Разрешены только адреса локальной сети')); return; }
    const req = http.request(u, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: timeoutMs }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(new Error('Слишком большой ответ')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Роутер не отвечает')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function describe(location) {
  const r = await request(location);
  if (r.status !== 200) throw new Error('Роутер не отдал описание');
  for (const m of r.text.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
    const type = tag(m[1], 'serviceType');
    if (!/:(WANIPConnection|WANPPPConnection):/i.test(type)) continue;
    const base = tag(r.text, 'URLBase') || location;
    const control = new URL(tag(m[1], 'controlURL'), base);
    if (!isLocalHost(control.hostname)) throw new Error('Роутер указал внешний адрес управления');
    return { controlUrl: control.href, serviceType: type };
  }
  throw new Error('Роутер не поддерживает проброс портов (UPnP)');
}

function soap({ controlUrl, serviceType }, action, args = {}) {
  const inner = Object.entries(args).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('');
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${inner}</u:${action}></s:Body></s:Envelope>`;
  return request(controlUrl, { method: 'POST', body, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${serviceType}#${action}"` } })
    .then((r) => {
      if (r.status !== 200) throw new Error(`Роутер отказал (${tag(r.text, 'errorDescription') || r.status})`);
      return r.text;
    });
}

// Свой адрес в локальной сети, через который достижим роутер.
function localIpFor(host) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('error', (e) => { try { s.close(); } catch (x) { /* ignore */ } reject(e); });
    s.connect(1900, host, () => { const a = s.address().address; s.close(); resolve(a); });
  });
}

// Открывает внешний порт и возвращает внешний адрес. Пробует несколько внешних портов, если первый занят.
async function openPort({ port, lease = 3600, location = null, description = 'corsa-mess' }) {
  const loc = location || await discover();
  if (!loc) throw new Error('Роутер не ответил. Возможно, UPnP выключен в его настройках');
  const svc = await describe(loc);
  const internalIp = await localIpFor(new URL(loc).hostname);
  const externalIp = tag(await soap(svc, 'GetExternalIPAddress'), 'NewExternalIPAddress');
  if (!externalIp) throw new Error('Роутер не сообщил внешний адрес');
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    const externalPort = port + i;
    try {
      await soap(svc, 'AddPortMapping', {
        NewRemoteHost: '', NewExternalPort: externalPort, NewProtocol: 'TCP', NewInternalPort: port,
        NewInternalClient: internalIp, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: lease,
      });
      return { svc, location: loc, internalIp, externalIp, externalPort, cgnat: isCgnat(externalIp), lease };
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('Не удалось открыть порт');
}

async function closePort(mapping) {
  if (!mapping) return;
  await soap(mapping.svc, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: mapping.externalPort, NewProtocol: 'TCP' });
}

module.exports = { discover, describe, openPort, closePort, isLocalHost, isCgnat };
