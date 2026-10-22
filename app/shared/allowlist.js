// Список проверенных сайтов для картинок (аватарки, баннеры, фоны, стикеры, темы).
// Один файл для сервера, главного процесса и интерфейса.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CorsaAllowlist = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Только точные имена хостов, без подстановочных знаков.
  const HOSTS = [
    'i.imgur.com',
    'i.pinimg.com',
    'i.ibb.co',
    'i.postimg.cc',
    'images.imgbox.com',
    'files.catbox.moe',
    'i.gyazo.com',
    'media.tenor.com',
  ];

  const MAX_URL_LENGTH = 400;

  // Возвращает нормализованный адрес или null. Принимает только https на точном хосте из списка,
  // без логина/пароля и без нестандартного порта.
  function sanitizeImageUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
    let u;
    try { u = new URL(value.trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port && u.port !== '443') return null;
    if (!HOSTS.includes(u.hostname.toLowerCase())) return null;
    return u.href;
  }

  // Строка для CSP: img-src и media-src.
  function cspHosts() {
    return HOSTS.map((h) => 'https://' + h).join(' ');
  }

  return { HOSTS, sanitizeImageUrl, cspHosts };
});
