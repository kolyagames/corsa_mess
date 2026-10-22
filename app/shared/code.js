// Код комнаты: IPv4 и порт, записанные 11 буквами в виде abcdef-ghijk.
// Сервера-посредника нет, поэтому код просто кодирует адрес.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CorsaCode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LEN = 11;
  const MAX = 1n << 48n;

  function encode(ip, port) {
    const parts = String(ip).split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      throw new Error('Неверный IPv4-адрес');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Неверный порт');
    let n = 0n;
    for (const p of parts) n = (n << 8n) | BigInt(p);
    n = (n << 16n) | BigInt(port);
    let s = '';
    for (let i = 0; i < LEN; i++) {
      s = String.fromCharCode(97 + Number(n % 26n)) + s;
      n /= 26n;
    }
    return s.slice(0, 6) + '-' + s.slice(6);
  }

  function decode(code) {
    const s = String(code).trim().toLowerCase().replace('-', '');
    if (!new RegExp('^[a-z]{' + LEN + '}$').test(s)) return null;
    let n = 0n;
    for (const ch of s) n = n * 26n + BigInt(ch.charCodeAt(0) - 97);
    if (n >= MAX) return null;
    const port = Number(n & 0xffffn);
    n >>= 16n;
    const ip = [24n, 16n, 8n, 0n].map((sh) => Number((n >> sh) & 0xffn)).join('.');
    if (port < 1) return null;
    return { host: ip, port };
  }

  return { encode, decode };
});
