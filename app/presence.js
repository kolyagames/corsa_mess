// «Играет в…»: два источника.
// 1) Discord RPC: игры и программы, которые уже умеют говорить Discord'у про свой статус, подключаются
//    к локальному каналу discord-ipc-N. Мы слушаем свободный канал и показываем их статус друзьям.
//    Если настоящий Discord запущен, он занимает канал 0 и большинство игр говорят только с ним.
// 2) Процессы: если игра ничего не отправляет, ищем её запущенный процесс по списку.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');

const KNOWN_GAMES = {
  'cs2.exe': 'Counter-Strike 2', 'robloxplayerbeta.exe': 'Roblox', 'valorant-win64-shipping.exe': 'VALORANT',
  'terraria.exe': 'Terraria', 'gta5.exe': 'Grand Theft Auto V', 'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends', 'dota2.exe': 'Dota 2', 'rocketleague.exe': 'Rocket League',
  'eurotrucks2.exe': 'Euro Truck Simulator 2', 'repo.exe': 'R.E.P.O.', 'overwatch.exe': 'Overwatch 2',
  'leagueoflegends.exe': 'League of Legends', 'hl2.exe': 'Half-Life 2', 'stardewvalley.exe': 'Stardew Valley',
  'cyberpunk2077.exe': 'Cyberpunk 2077', 'eldenring.exe': 'ELDEN RING', 'rustclient.exe': 'Rust',
};

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const nameCache = new Map();

function pipePath(n) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\discord-ipc-${n}` : path.join(process.env.XDG_RUNTIME_DIR || '/tmp', `discord-ipc-${n}`);
}

function frame(op, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function startPresenceBridge({ onChange }) {
  const cfg = { resolveNames: true };
  const rpcActivities = new Map(); // сокет -> активность
  let processActivity = null;
  let last = 'null';
  let servers = [];
  let timer = null;

  let extra = {};
  try { extra = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'games.json'), 'utf8')); } catch (e) { /* файла может не быть */ }
  const games = { ...KNOWN_GAMES };
  for (const [exe, name] of Object.entries(extra)) games[String(exe).toLowerCase()] = String(name);

  function current() {
    const rpc = [...rpcActivities.values()].filter(Boolean).pop();
    return rpc || processActivity || null;
  }

  function emit() {
    const a = current();
    const key = JSON.stringify(a);
    if (key !== last) { last = key; onChange(a); }
  }

  async function resolveName(clientId) {
    if (!/^\d{5,25}$/.test(clientId)) return null;
    if (nameCache.has(clientId)) return nameCache.get(clientId);
    try {
      const r = await fetch(`https://discord.com/api/v10/applications/${clientId}/rpc`);
      const j = r.ok ? await r.json() : null;
      const name = j && typeof j.name === 'string' ? j.name : null;
      nameCache.set(clientId, name);
      return name;
    } catch (e) { return null; }
  }

  function toMs(t) {
    if (!Number.isFinite(t)) return null;
    return t < 1e12 ? t * 1000 : t;
  }

  async function setRpc(sock, clientId, act) {
    if (!act) { rpcActivities.delete(sock); return emit(); }
    const name = (typeof act.name === 'string' && act.name) || (cfg.resolveNames ? await resolveName(clientId) : null) || 'Игра';
    rpcActivities.set(sock, {
      source: 'rpc', name, details: String(act.details || '').slice(0, 128), state: String(act.state || '').slice(0, 128),
      startedAt: toMs(act.timestamps && act.timestamps.start),
    });
    emit();
  }

  function onConnection(sock) {
    let buf = Buffer.alloc(0);
    let clientId = '';
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readUInt32LE(0);
        const len = buf.readUInt32LE(4);
        if (len > 64 * 1024) { sock.destroy(); return; }
        if (buf.length < 8 + len) return;
        let data = null;
        try { data = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch (e) { /* пустой кадр */ }
        buf = buf.subarray(8 + len);
        if (op === OP.HANDSHAKE && data) {
          clientId = String(data.client_id || '');
          sock.write(frame(OP.FRAME, {
            cmd: 'DISPATCH', evt: 'READY', nonce: null,
            data: { v: 1, config: { cdn_host: 'cdn.discordapp.com', api_endpoint: '//discord.com/api', environment: 'production' },
              user: { id: '1', username: 'corsa', discriminator: '0', avatar: null } },
          }));
        } else if (op === OP.FRAME && data && data.cmd === 'SET_ACTIVITY') {
          const act = data.args && data.args.activity;
          setRpc(sock, clientId, act);
          sock.write(frame(OP.FRAME, { cmd: 'SET_ACTIVITY', data: act || null, evt: null, nonce: data.nonce }));
        } else if (op === OP.PING) {
          sock.write(frame(OP.PONG, data || {}));
        } else if (op === OP.CLOSE) {
          sock.end();
        }
      }
    });
    const gone = () => { if (rpcActivities.delete(sock)) emit(); };
    sock.on('close', gone);
    sock.on('error', gone);
  }

  // Берём все свободные каналы из 0-9, чтобы не мешать настоящему Discord.
  for (let n = 0; n < 10; n++) {
    const srv = net.createServer(onConnection);
    srv.on('error', () => {});
    try { srv.listen(pipePath(n)); servers.push(srv); } catch (e) { /* канал занят */ }
  }

  function scanProcesses() {
    if (process.platform !== 'win32') return;
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return;
      let found = null;
      for (const line of out.split(/\r?\n/)) {
        const exe = (line.match(/^"([^"]+)"/) || [])[1];
        const name = exe && games[exe.toLowerCase()];
        if (name) { found = name; break; }
      }
      if (!found) processActivity = null;
      else if (!processActivity || processActivity.name !== found) {
        processActivity = { source: 'process', name: found, details: '', state: '', startedAt: Date.now() };
      }
      emit();
    });
  }
  scanProcesses();
  timer = setInterval(scanProcesses, 15000);

  return {
    current,
    configure: (c) => { if (c && typeof c.resolveNames === 'boolean') cfg.resolveNames = c.resolveNames; },
    stop: () => { clearInterval(timer); for (const s of servers) { try { s.close(); } catch (e) { /* ignore */ } } },
  };
}

module.exports = { startPresenceBridge };
