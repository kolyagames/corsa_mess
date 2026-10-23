// Обновление из приложения: новая версия берётся только из релизов репозитория на GitHub.
// Архив проверяется по контрольной сумме SHA-256 из описания релиза; без неё обновление не ставится.
// Установка: после выхода приложения скрипт PowerShell распаковывает архив поверх папки программы и запускает её снова.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net } = require('electron');

const REPO = 'kolyagames/corsa_mess';
const ASSET = 'corsa-mess-win32-x64.zip';
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

function cmpVer(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function check() {
  const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'corsa-mess-updater' } });
  if (!r.ok) throw new Error(`GitHub не ответил (${r.status})`);
  const j = await r.json();
  const version = String(j.tag_name || '').replace(/^v/, '');
  const asset = (j.assets || []).find((a) => a.name === ASSET);
  const url = asset && String(asset.browser_download_url || '');
  const sha256 = ((/SHA-256[^0-9a-f]{0,40}([0-9a-f]{64})/i.exec(j.body || '') || [])[1] || '').toLowerCase() || null;
  return {
    current: app.getVersion(), version, newer: !!version && cmpVer(version, app.getVersion()) > 0,
    url: url.startsWith(DOWNLOAD_PREFIX) ? url : null, size: asset ? asset.size : 0, sha256,
    notes: String(j.body || '').slice(0, 4000), page: String(j.html_url || '').startsWith(`https://github.com/${REPO}/`) ? j.html_url : null,
    packaged: app.isPackaged,
  };
}

// Скачать архив во временную папку, считая SHA-256 на лету. onProgress(доля 0..1).
async function download(info, onProgress) {
  if (!info || !info.url || !info.url.startsWith(DOWNLOAD_PREFIX)) throw new Error('Неизвестный адрес архива');
  if (!/^[0-9a-f]{64}$/.test(info.sha256 || '')) throw new Error('У релиза нет контрольной суммы, обновите вручную со страницы релиза');
  // Старые недоустановленные архивы больше не нужны.
  for (const f of fs.readdirSync(os.tmpdir())) if (/^corsa-mess-[\d.]+-\d+\.zip$/.test(f)) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  const r = await net.fetch(info.url, { headers: { 'User-Agent': 'corsa-mess-updater' } });
  if (!r.ok || !r.body) throw new Error(`Архив не скачался (${r.status})`);
  const total = Number(r.headers.get('content-length')) || info.size || 0;
  const file = path.join(os.tmpdir(), `corsa-mess-${info.version}-${Date.now()}.zip`);
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  const reader = r.body.getReader();
  let got = 0;
  let last = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      if (total && Date.now() - last > 150) { last = Date.now(); onProgress(got / total); }
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  if (hash.digest('hex') !== info.sha256) { fs.rmSync(file, { force: true }); throw new Error('Контрольная сумма не совпала: архив повреждён или подменён. Обновление отменено'); }
  onProgress(1);
  return file;
}

const SCRIPT = `param([string]$Zip, [string]$Dir, [int]$ProcId, [string]$Exe)
$log = Join-Path $env:TEMP 'corsa-mess-update.log'
try {
  try { Wait-Process -Id $ProcId -Timeout 90 -ErrorAction SilentlyContinue } catch { }
  Start-Sleep -Milliseconds 1500
  $tmp = Join-Path $env:TEMP ('corsa-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  & "$env:SystemRoot\\System32\\tar.exe" -xf $Zip -C $tmp
  $src = Join-Path $tmp 'corsa-mess-win32-x64'
  if (-not (Test-Path (Join-Path $src 'corsa-mess.exe'))) { throw 'в архиве нет corsa-mess.exe' }
  & robocopy $src $Dir /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy: $LASTEXITCODE" }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Zip -Force -ErrorAction SilentlyContinue
  "ok $(Get-Date)" | Out-File -FilePath $log -Encoding utf8
} catch {
  "error $(Get-Date): $_" | Out-File -FilePath $log -Encoding utf8
}
if ($Exe) { Start-Process -FilePath $Exe }
`;

// Запустить установку и закрыть приложение. relaunch — что запустить после (по умолчанию само приложение).
function install(zip, { dir = path.dirname(process.execPath), relaunch = process.execPath } = {}) {
  if (!app.isPackaged) throw new Error('Обновление ставится только в собранной версии (corsa-mess.exe)');
  if (!fs.existsSync(zip)) throw new Error('Архив не найден');
  const script = path.join(os.tmpdir(), `corsa-mess-update-${Date.now()}.ps1`);
  fs.writeFileSync(script, '﻿' + SCRIPT, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-Zip', zip, '-Dir', dir, '-ProcId', String(process.pid), '-Exe', relaunch], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return script;
}

module.exports = { check, download, install, cmpVer, SCRIPT };
