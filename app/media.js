// «Сейчас играет»: текущий трек из системной панели мультимедиа Windows.
// Работает с любым плеером, который туда пишет (Spotify, Яндекс Музыка, браузеры). Запускается только по просьбе
// интерфейса (плагин «Сейчас играет») и завершается вместе с приложением.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APPS = [[/spotify/i, 'Spotify'], [/yandex|яндекс/i, 'Яндекс Музыка'], [/chrome/i, 'Chrome'], [/msedge/i, 'Edge'],
  [/firefox/i, 'Firefox'], [/opera/i, 'Opera'], [/aimp/i, 'AIMP'], [/foobar/i, 'foobar2000'], [/vlc/i, 'VLC'], [/zune|music\.ui|media\.player/i, 'Медиаплеер']];

function appName(id) {
  const hit = APPS.find(([re]) => re.test(id || ''));
  if (hit) return hit[1];
  return String(id || 'Плеер').replace(/^.*[!\\]/, '').replace(/\.exe$/i, '').slice(0, 32) || 'Плеер';
}

function startMediaWatch({ onChange }) {
  if (process.platform !== 'win32') return { command() {}, stop() {} };
  // Скрипт передаём через -EncodedCommand: файл внутри архива приложения PowerShell прочитать не может.
  const script = fs.readFileSync(path.join(__dirname, 'media-watch.ps1'), 'utf8');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let child = null;
  let stopped = false;
  let restarts = 0;
  let last = null;

  const emit = (track) => {
    const key = JSON.stringify(track);
    if (key === JSON.stringify(last)) return;
    last = track;
    onChange(track);
  };

  function launch() {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 64 * 1024) buf = '';
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        let j = null;
        try { j = JSON.parse(line); } catch (e) { continue; }
        if (!j || !j.title) { emit(null); continue; }
        emit({
          app: appName(j.app), title: String(j.title).slice(0, 128), artist: String(j.artist || '').slice(0, 128), album: String(j.album || '').slice(0, 128),
          playing: j.status === 'Playing', pos: Number(j.pos) || 0, dur: Number(j.dur) || 0, at: Date.now(),
        });
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {});
    child.on('exit', () => {
      child = null;
      // Перезапуск после сбоя, но не бесконечно.
      if (!stopped && restarts++ < 3) setTimeout(() => { if (!stopped) launch(); }, 5000).unref();
    });
  }
  launch();

  return {
    current: () => last,
    command(cmd) { if (child && ['toggle', 'next', 'prev'].includes(cmd)) child.stdin.write(cmd + '\n'); },
    stop() { stopped = true; if (child) { try { child.stdin.end(); } catch (e) { /* ignore */ } const c = child; setTimeout(() => { try { c.kill(); } catch (e) { /* ignore */ } }, 1500).unref(); } },
  };
}

module.exports = { startMediaWatch };
