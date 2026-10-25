#!/usr/bin/env node
// Собирает www/ для Android-сборки из общего веб-интерфейса в app/src и app/shared.
// Единственный источник правды для интерфейса — app/src: этот скрипт просто копирует его
// и добавляет Android-специфичный мостик (android-src/android-bridge.js) поверх, ничего в
// самом интерфейсе не меняя (кроме двух строк в index.html — замена "corsa://" протокола,
// которого на Android нет, на обычные относительные пути).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'app', 'src');
const SHARED = path.join(ROOT, 'app', 'shared');
const OUT = path.join(__dirname, '..', 'www');
const ANDROID_SRC = path.join(__dirname, '..', 'android-src');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, entry.name);
    const t = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(f, t);
    else fs.copyFileSync(f, t);
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

copyDir(SRC, OUT);
copyDir(SHARED, path.join(OUT, 'shared'));
fs.copyFileSync(path.join(ANDROID_SRC, 'android-bridge.js'), path.join(OUT, 'android-bridge.js'));

// package.json приложения — источник номера версии, чтобы Android и Windows сборки совпадали.
const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'package.json'), 'utf8')).version;

let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace(/<script src="corsa:\/\/shared\/([a-zA-Z0-9_.-]+)"><\/script>/g, '<script src="shared/$1"></script>');
html = html.replace(
  '<script src="client.js"></script>',
  `<script>window.CORSA_VERSION = ${JSON.stringify(appVersion)};</script>\n  <script src="android-bridge.js"></script>\n  <script src="client.js"></script>`,
);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log(`www собран из app/src в ${path.relative(process.cwd(), OUT)} (corsa-mess ${appVersion})`);
