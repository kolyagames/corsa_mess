// Делает build/icon.ico из src/logo.png (PNG 256x256 внутри ICO). Нужна для значка .exe.
const fs = require('fs');
const path = require('path');

const png = fs.readFileSync(path.join(__dirname, '..', 'src', 'logo.png'));
if (png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error('logo.png должен быть 256x256');

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // зарезервировано
header.writeUInt16LE(1, 2); // тип: значок
header.writeUInt16LE(1, 4); // одно изображение
header[6] = 0; // ширина 256 записывается нулём
header[7] = 0; // высота 256
header.writeUInt16LE(1, 10); // плоскости
header.writeUInt16LE(32, 12); // бит на пиксель
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);

fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([header, png]));
console.log('build/icon.ico готов');
