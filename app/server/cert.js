// Самоподписанный сертификат сервера. Создаётся один раз и хранится в папке данных,
// поэтому отпечаток не меняется между запусками и клиенты могут его запомнить (закрепление).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

const fingerprintOf = (pem) => new crypto.X509Certificate(pem).fingerprint256;

async function ensureCert(dir) {
  const file = path.join(dir, 'tls.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const x = new crypto.X509Certificate(saved.cert);
    // Обновляем заранее, чтобы сертификат не истёк у пользователя посреди сессии.
    if (saved.key && new Date(x.validTo).getTime() - Date.now() > 30 * 86400000) {
      return { key: saved.key, cert: saved.cert, fingerprint: x.fingerprint256 };
    }
  } catch (e) { /* сертификата ещё нет или он повреждён */ }
  const made = await Promise.resolve(selfsigned.generate([{ name: 'commonName', value: 'corsa-mess' }], { keySize: 2048, days: 3650, algorithm: 'sha256' }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ key: made.private, cert: made.cert }), { mode: 0o600 });
  return { key: made.private, cert: made.cert, fingerprint: fingerprintOf(made.cert) };
}

module.exports = { ensureCert, fingerprintOf };
