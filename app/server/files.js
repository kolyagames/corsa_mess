// Файлы комнаты: картинки, видео, голосовые и прочее. Лежат у хозяина комнаты в папке данных,
// отдаются только участникам по их личному ключу. Тип определяется по содержимому, а не по тому, что прислал клиент:
// показываются внутри чата только картинки, видео и звук, остальное можно только скачать.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 1024 * 1024 * 1024;

// Тип по первым байтам файла. hint — что сказал клиент (нужен, чтобы отличить звук WebM от видео WebM).
function sniff(buf, hint = '') {
  const s = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf.length >= 8 && buf[0] === 0x89 && s(1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'image/webp';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return 'audio/wav';
  if (s(4, 8) === 'ftyp') return /^M4A/.test(s(8, 12)) ? 'audio/mp4' : 'video/mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return /^audio\//.test(hint) ? 'audio/webm' : 'video/webm';
  if (s(0, 4) === 'OggS') return 'audio/ogg';
  if (s(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return 'application/octet-stream';
}

const kindOf = (type) => (type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'file');

function cleanName(n) {
  const s = String(n || 'файл').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80);
  return s || 'файл';
}

function createFileStore({ dir, maxFile = MAX_FILE, maxTotal = MAX_TOTAL }) {
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  const meta = new Map();
  try { for (const m of JSON.parse(fs.readFileSync(indexFile, 'utf8'))) if (/^[0-9a-f]{24}$/.test(m.id) && fs.existsSync(path.join(dir, m.id))) meta.set(m.id, m); } catch (e) { /* новая папка */ }
  let saveTimer = null;
  const saveIndex = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(indexFile, JSON.stringify([...meta.values()])); } catch (e) { /* диск занят */ } }, 300); };
  const total = () => [...meta.values()].reduce((n, m) => n + m.size, 0);

  function remove(id) {
    if (!meta.has(id)) return;
    meta.delete(id);
    try { fs.unlinkSync(path.join(dir, id)); } catch (e) { /* уже удалён */ }
    saveIndex();
  }

  // Сохранить файл. Если места не хватает, удаляются самые старые файлы комнаты.
  function save(buf, { name, hint, uid, voice, dur }) {
    if (!buf.length) throw new Error('Пустой файл');
    if (buf.length > maxFile) throw new Error('Файл больше 25 МБ');
    const type = sniff(buf, hint);
    const id = crypto.randomBytes(12).toString('hex');
    const m = { id, name: cleanName(name), type, kind: kindOf(type), size: buf.length, uid, ts: Date.now() };
    if (voice && m.kind === 'audio') { m.voice = true; if (Number.isFinite(dur)) m.dur = Math.max(0, Math.min(600, Math.round(dur))); }
    const old = [...meta.values()].sort((a, b) => a.ts - b.ts);
    while (old.length && total() + buf.length > maxTotal) remove(old.shift().id);
    fs.writeFileSync(path.join(dir, id), buf);
    meta.set(id, m);
    saveIndex();
    return m;
  }

  const get = (id) => (/^[0-9a-f]{24}$/.test(String(id)) ? meta.get(id) || null : null);
  const filePath = (id) => path.join(dir, id);
  const flush = () => { clearTimeout(saveTimer); try { fs.writeFileSync(indexFile, JSON.stringify([...meta.values()])); } catch (e) { /* ignore */ } };

  return { save, get, remove, filePath, flush, maxFile };
}

// Отдать файл по HTTP с поддержкой Range (перемотка видео и звука).
function serveFile(req, res, store, m) {
  const full = store.filePath(m.id);
  const inline = m.kind !== 'file';
  const headers = {
    'Content-Type': m.type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(m.name)}`,
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : m.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : m.size - 1;
    start = Math.max(0, start); end = Math.min(m.size - 1, end);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${m.size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${m.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': m.size });
  fs.createReadStream(full).pipe(res);
}

module.exports = { createFileStore, serveFile, sniff, MAX_FILE };
