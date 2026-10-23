// Поиск комнат в локальной сети (и в общих VPN-сетях вроде Radmin, ZeroTier, Hamachi).
// Клиент рассылает короткий запрос на широковещательные адреса своих сетей, сервер комнаты отвечает ему напрямую.
// Windows пропускает ответ на широковещательный запрос без отдельного разрешения брандмауэра,
// поэтому искать комнаты может любой клиент, а разрешение нужно только тому, кто запустил сервер.
const dgram = require('dgram');
const os = require('os');

const PORT = 47777;
const QUERY = 'corsa-mess?1';

function ipToInt(ip) { return ip.split('.').reduce((n, x) => ((n << 8) >>> 0) + Number(x), 0) >>> 0; }
function intToIp(n) { return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.'); }

// Сети этого компьютера: адрес, маска и широковещательный адрес.
function localNets() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
      const addr = ipToInt(i.address);
      const mask = ipToInt(i.netmask);
      out.push({ name, address: i.address, addr, mask, broadcast: intToIp((addr | ~mask) >>> 0) });
    }
  }
  return out;
}

// Наша сеть, в которой находится адрес (или null).
function netFor(ip, nets = localNets()) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const n = ipToInt(ip);
  return nets.find((x) => ((n & x.mask) >>> 0) === ((x.addr & x.mask) >>> 0)) || null;
}

// Отвечаем только тем, кто в одной сети с нами: так ответ нельзя использовать для атак из интернета.
function sameNet(ip, nets = localNets()) {
  if (/^127\./.test(ip || '')) return true;
  return !!netFor(ip, nets);
}

// Сервер комнаты слушает запросы и отвечает сведениями о комнате. getInfo() возвращает null, если отвечать не нужно.
function createResponder({ getInfo, port = PORT }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const lastReply = new Map(); // ip -> время, чтобы не отвечать одному адресу слишком часто
  sock.on('error', () => {});
  sock.on('message', (buf, rinfo) => {
    if (buf.length > 64 || buf.toString('utf8') !== QUERY || !sameNet(rinfo.address)) return;
    const now = Date.now();
    if (now - (lastReply.get(rinfo.address) || 0) < 300) return;
    lastReply.set(rinfo.address, now);
    if (lastReply.size > 256) lastReply.clear();
    const info = getInfo();
    if (!info) return;
    sock.send(Buffer.from(JSON.stringify({ corsa: 1, ...info })), rinfo.port, rinfo.address);
  });
  const ready = new Promise((resolve) => {
    sock.once('listening', resolve);
    sock.once('error', resolve);
  });
  sock.bind(port);
  return { ready, close: () => { try { sock.close(); } catch (e) { /* уже закрыт */ } } };
}

function cleanReply(buf, rinfo) {
  if (buf.length > 1024) return null;
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
  if (!j || j.corsa !== 1 || !Number.isInteger(j.port) || j.port < 1 || j.port > 65535) return null;
  return {
    host: rinfo.address, port: j.port, name: String(j.name || 'Комната').slice(0, 40), locked: !!j.locked,
    members: Number.isInteger(j.members) ? j.members : 0, max: Number.isInteger(j.max) ? j.max : 0,
    fp: typeof j.fp === 'string' ? j.fp.slice(0, 23) : '',
    id: typeof j.id === 'string' ? j.id.slice(0, 16) : '',
  };
}

// Разослать запрос и собрать ответы за timeoutMs.
function scan({ timeoutMs = 800, port = PORT, extra = [] } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const found = new Map();
    let done = false;
    const finish = () => { if (done) return; done = true; try { sock.close(); } catch (e) { /* ignore */ } resolve([...found.values()]); };
    sock.on('error', finish);
    sock.on('message', (buf, rinfo) => {
      const r = cleanReply(buf, rinfo);
      if (r) found.set(`${r.host}:${r.port}`, r);
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch (e) { /* ignore */ }
      const targets = new Set(['255.255.255.255', ...localNets().map((n) => n.broadcast), ...extra]);
      for (const t of targets) sock.send(QUERY, port, t, () => {});
      setTimeout(finish, timeoutMs);
    });
  });
}

module.exports = { createResponder, scan, sameNet, netFor, localNets, PORT };
