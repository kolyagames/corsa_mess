// Цвета из картинки: палитра аватарки → акцент, второй цвет для градиентов и тона для карточек профиля.
// Картинка скачивается главным процессом только с проверенных сайтов (тот же список, что и для аватарок), здесь она
// уменьшается до 64×64 и считается. Серые и почти чёрно-белые картинки цвета не дают: остаётся выбранный вручную.
(function () {
  const C = (window.Corsa = window.Corsa || {});

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0; let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb([h, s, l]) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const toHex = (rgb) => '#' + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');

  // data — RGBA-пиксели (как у ImageData). Возвращает { colors: [{rgb, hsl, share}], accent, accent2, gray } без обращения к DOM.
  function fromPixels(data) {
    const buckets = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // прозрачное не считаем
      total++;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(key, b);
    }
    if (!total) return { colors: [], accent: null, accent2: null, gray: true };
    const items = [];
    for (const b of buckets.values()) {
      const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
      const hsl = rgbToHsl(rgb);
      // Яркие насыщенные цвета важнее серых; почти чёрное и почти белое почти не считаются.
      const light = hsl[2] < 0.1 || hsl[2] > 0.93 ? 0.05 : 1;
      const score = b.n * Math.pow(0.15 + hsl[1], 1.6) * light;
      items.push({ rgb, hsl, share: b.n / total, score });
    }
    items.sort((a, b) => b.score - a.score);
    const colors = [];
    for (const it of items) {
      if (colors.length >= 3) break;
      // Разные цвета: заметно отличаются по тону (или один из них серый и по светлоте).
      const far = colors.every((c) => (it.hsl[1] > 0.2 && c.hsl[1] > 0.2 ? hueDist(it.hsl[0], c.hsl[0]) > 35 : Math.abs(it.hsl[2] - c.hsl[2]) > 0.25));
      if (far) colors.push(it);
    }
    const out = (list) => list.map((c) => ({ rgb: c.rgb.map(Math.round), hsl: c.hsl, share: c.share }));
    // Главный цвет выбирается среди насыщенных и заметных по площади: серый или белый фон акцентом не становится,
    // даже если его в картинке больше всего.
    const vivid = items.filter((it) => it.hsl[1] >= 0.18 && it.share > 0.01 && it.hsl[2] > 0.1 && it.hsl[2] < 0.93);
    // Практически серая картинка: цвет подбирать не из чего.
    if (!vivid.length) return { colors: out(colors), accent: null, accent2: null, gray: true };
    const lead = vivid[0];
    // Второй цвет — насыщенный, заметно другого тона, но не дальше 90°: далёкие тона в градиенте смешиваются в серую кашу.
    const second = vivid.find((c) => c !== lead && hueDist(c.hsl[0], lead.hsl[0]) > 20 && hueDist(c.hsl[0], lead.hsl[0]) <= 90);
    // Если подходящего второго цвета нет, берём соседний тон: градиент получается из родственных оттенков.
    const accent2 = second ? second.rgb : hslToRgb([lead.hsl[0] + 38, clamp(lead.hsl[1], 0.45, 0.9), clamp(lead.hsl[2], 0.4, 0.62)]);
    // Для показа в настройках: главный и ещё до двух заметно разных цветов.
    const shown = [lead];
    for (const it of items) { if (shown.length >= 3) break; if (shown.every((c) => (c.hsl[1] > 0.2 && it.hsl[1] > 0.2 ? hueDist(c.hsl[0], it.hsl[0]) > 35 : Math.abs(c.hsl[2] - it.hsl[2]) > 0.25))) shown.push(it); }
    return { colors: out(shown), accent: lead.rgb.map(Math.round), accent2: accent2.map(Math.round), gray: false };
  }

  // Подгоняет цвет под интерфейс: в тёмном режиме светлее и насыщеннее, в светлом темнее, чтобы текст и кнопки читались.
  function fit(rgb, mode) {
    if (!rgb) return null;
    const [h, s, l] = rgbToHsl(rgb);
    const light = mode === 'light';
    return hslToRgb([h, clamp(s, 0.5, 0.95), light ? clamp(l, 0.36, 0.5) : clamp(l, 0.52, 0.68)]);
  }

  const cache = new Map(); // адрес → обещание палитры

  // Палитра по адресу картинки (только проверенные сайты). null — картинки нет или она не подошла.
  function fromUrl(url) {
    const safe = C.safeUrl && C.safeUrl(url);
    if (!safe || /\.(mp4|webm)(\?|$)/i.test(safe)) return Promise.resolve(null);
    if (!cache.has(safe)) {
      cache.set(safe, (async () => {
        try {
          const res = await window.corsaNative.fetchImage(safe);
          if (!res || !res.data) return null;
          const bmp = await createImageBitmap(new Blob([res.data], { type: res.type }));
          const size = 64;
          const canvas = new OffscreenCanvas(size, size);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0, size, size);
          bmp.close();
          return fromPixels(ctx.getImageData(0, 0, size, size).data);
        } catch (e) { return null; }
      })());
      if (cache.size > 60) cache.delete(cache.keys().next().value);
    }
    return cache.get(safe);
  }

  // Тёмный конец градиента: тот же тон, насыщенность сохраняется (смешивание с чёрным даёт грязь).
  function deep(rgb, mode) {
    if (!rgb) return null;
    const [h, s] = rgbToHsl(rgb);
    return hslToRgb([h, clamp(s, 0.5, 0.9), mode === 'light' ? 0.42 : 0.33]);
  }

  C.palette = { fromPixels, fromUrl, fit, deep, toHex, rgbToHsl, hslToRgb };
})();
