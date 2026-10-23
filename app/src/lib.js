// Общие помощники интерфейса. Весь чужой текст попадает на страницу только через textContent.
(function () {
  const C = (window.Corsa = window.Corsa || {});

  C.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (let [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        // В атрибутах (подсказка, поле ввода) иконку показать нельзя: метка вырезается.
        if (typeof v === 'string' && v.includes('{{ic:')) v = C.stripIcons(v);
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in el && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      if (kid.nodeType) { el.append(kid); continue; }
      const s = String(kid);
      el.append(s.includes('{{ic:') && C.iconText ? C.iconText(s) : document.createTextNode(s));
    }
    return el;
  };

  C.store = {
    get(key, def) {
      try {
        const raw = localStorage.getItem('corsa.' + key);
        return raw == null ? def : JSON.parse(raw);
      } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('corsa.' + key, JSON.stringify(val)); } catch (e) { /* хранилище недоступно */ }
    },
    dump() {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith('corsa.')) out[k.slice(6)] = JSON.parse(localStorage.getItem(k));
        }
      } catch (e) { /* ignore */ }
      return out;
    },
    load(obj) {
      for (const [k, v] of Object.entries(obj || {})) this.set(k, v);
    },
  };

  // Адрес в локальной сети: частные диапазоны, loopback, link-local, общие VPN-сети (Hamachi 25.x, Radmin 26.x, CGNAT 100.64/10, Tailscale).
  C.isLocalHost = (host) => {
    const h = String(host || '').toLowerCase();
    if (h === 'localhost' || /^\[?(::1|fe80:|f[cd][0-9a-f]{2}:)/.test(h)) return true;
    const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
    if (!m) return false;
    const a = Number(m[1]); const b = Number(m[2]);
    return a === 10 || a === 127 || a === 25 || a === 26 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  };

  C.uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  C.safeUrl = (u) => (u ? window.CorsaAllowlist.sanitizeImageUrl(u) : null);

  const isVideo = (u) => /\.(mp4|webm)(\?|$)/i.test(u);

  // Картинка или зацикленное видео (Tenor отдаёт анимации в mp4). Адрес проверяется списком сайтов.
  C.media = function media(url, cls) {
    const safe = C.safeUrl(url);
    if (!safe) return null;
    if (isVideo(safe)) {
      return C.h('video', { class: cls, src: safe, autoplay: true, loop: true, muted: true, playsInline: true });
    }
    return C.h('img', { class: cls, src: safe, loading: 'lazy', referrerPolicy: 'no-referrer', draggable: false, alt: '' });
  };

  C.fmtTime = (ts) => {
    const d = new Date(ts);
    const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? 'сегодня в ' + t : d.toLocaleDateString('ru-RU') + ' ' + t;
  };

  C.fmtElapsed = (since) => {
    if (!since) return '';
    const m = Math.max(0, Math.floor((Date.now() - since) / 60000));
    return m < 60 ? `${m} мин.` : `${Math.floor(m / 60)} ч. ${m % 60} мин.`;
  };

  C.toast = function toast(text, ms = 3200) {
    let box = document.getElementById('toasts');
    if (!box) { box = C.h('div', { id: 'toasts' }); document.body.append(box); }
    const el = C.h('div', { class: 'toast' }, text);
    box.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 230); }, ms);
  };

  // Градиентное свечение плавно следует за курсором (переменные --mx и --my для body::after).
  // Движение с инерцией: свечение догоняет курсор мягко, а яркость плавно меняется.
  C.startCursorGlow = function startCursorGlow(isOn, getPower) {
    const root = document.documentElement.style;
    let tx = innerWidth * 0.5, ty = innerHeight * 0.3, x = tx, y = ty, power = 0;
    window.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; });
    document.addEventListener('mouseleave', () => { tx = innerWidth * 0.5; ty = innerHeight * 0.3; });
    const tick = () => {
      const on = isOn();
      const goal = on ? Math.min(1, Math.max(0, getPower() / 100)) : 0;
      power += (goal - power) * 0.08;
      document.body.classList.toggle('no-glow', !on && power < 0.01);
      if (power > 0.003) {
        x += (tx - x) * 0.055;
        y += (ty - y) * 0.055;
        root.setProperty('--mx', x.toFixed(1) + 'px');
        root.setProperty('--my', y.toFixed(1) + 'px');
        root.setProperty('--glow-power', power.toFixed(3));
      }
      requestAnimationFrame(tick);
    };
    tick();
  };

  // Цвет акцента: из одного цвета получаем яркий, тёмный и свечение.
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(rgb, to, t) { return rgb.map((c, i) => Math.round(c + (to[i] - c) * t)); }
  const css = (rgb) => `rgb(${rgb.join(',')})`;

  // hex2 — второй цвет для градиентов (из аватарки). Без него градиенты идут в обычные оттенки акцента.
  C.applyAccent = function applyAccent(hex, hex2, hexEnd) {
    const rgb = hexToRgb(hex) || [255, 42, 68];
    const rgb2 = hexToRgb(hex2);
    const root = document.documentElement.style;
    root.setProperty('--accent2', rgb2 ? css(rgb2) : css(mix(rgb, [255, 255, 255], 0.3)));
    root.setProperty('--accent2-rgb', (rgb2 || mix(rgb, [255, 255, 255], 0.3)).join(','));
    const rgbEnd = hexToRgb(hexEnd);
    root.setProperty('--grad-end', rgbEnd ? css(rgbEnd) : rgb2 ? css(mix(rgb2, [0, 0, 0], 0.35)) : css(mix(rgb, [0, 0, 0], 0.45)));
    root.setProperty('--accent-rgb', rgb.join(','));
    root.setProperty('--accent', css(rgb));
    root.setProperty('--accent-hi', css(mix(rgb, [255, 255, 255], 0.3)));
    root.setProperty('--accent-lo', css(mix(rgb, [0, 0, 0], 0.45)));
    root.setProperty('--accent-dim', css(mix(rgb, [14, 4, 7], 0.8)));
    root.setProperty('--glow', `rgba(${rgb.join(',')},0.45)`);
    root.setProperty('--glow-soft', `rgba(${rgb.join(',')},0.2)`);
  };
})();
