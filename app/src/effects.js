// Частицы для эффектов профиля и эффектов на весь экран: снег, искры, сердца, угольки, звёзды, сакура, пузыри,
// падающие звёзды и дождь. Рисуется на <canvas>, останавливается, когда окно скрыто или анимации выключены.
(function () {
  const C = window.Corsa;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.fill();
  }

  function star4(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const d = i % 2 ? r * 0.28 : r;
      ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.fill();
  }

  // Каждый вид: spawn(w, h, initial) создаёт частицу, step(p, w, h, dt) двигает и рисует, возвращает false, если частица ушла.
  const KINDS = {
    snow: {
      spawn: (w, h, init) => ({ x: rnd(0, w), y: init ? rnd(0, h) : -6, r: rnd(1, 3.2), vy: rnd(0.4, 1.2), ph: rnd(0, 6) }),
      step(p, w, h, dt, ctx, o) { p.y += p.vy * dt * o.speed; p.ph += 0.02 * dt; p.x += Math.sin(p.ph) * 0.4; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); return p.y < h + 6; },
    },
    sparkles: {
      spawn: (w, h) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(2, 5), life: 0, max: rnd(60, 140) }),
      step(p, w, h, dt, ctx) { p.life += dt; const t = p.life / p.max; ctx.globalAlpha = Math.sin(t * Math.PI); star4(ctx, p.x, p.y, p.r * (0.6 + Math.sin(t * Math.PI) * 0.6)); return t < 1; },
    },
    hearts: {
      spawn: (w, h, init) => ({ x: rnd(0, w), y: init ? rnd(0, h) : h + 10, s: rnd(6, 13), vy: rnd(0.4, 1), ph: rnd(0, 6) }),
      step(p, w, h, dt, ctx, o) { p.y -= p.vy * dt * o.speed; p.ph += 0.03 * dt; ctx.globalAlpha = Math.min(1, p.y / h + 0.2); heart(ctx, p.x + Math.sin(p.ph) * 6, p.y, p.s); return p.y > -20; },
    },
    embers: {
      spawn: (w, h, init) => ({ x: rnd(0, w), y: init ? rnd(0, h) : h + 4, r: rnd(0.8, 2.2), vy: rnd(0.6, 1.6), vx: rnd(-0.3, 0.3), ph: rnd(0, 6) }),
      step(p, w, h, dt, ctx, o) { p.y -= p.vy * dt * o.speed; p.x += p.vx * dt; p.ph += 0.2 * dt; ctx.globalAlpha = (0.5 + Math.sin(p.ph) * 0.4) * Math.min(1, p.y / h + 0.1); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); return p.y > -6; },
      color: '#ff8a3d',
    },
    stars: {
      spawn: (w, h) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(0.5, 1.6), ph: rnd(0, 6), sp: rnd(0.02, 0.06) }),
      step(p, w, h, dt, ctx) { p.ph += p.sp * dt; ctx.globalAlpha = 0.35 + Math.sin(p.ph) * 0.35; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); return true; },
      steady: true,
    },
    sakura: {
      spawn: (w, h, init) => ({ x: rnd(-20, w), y: init ? rnd(0, h) : -10, s: rnd(3, 6), vy: rnd(0.5, 1.1), vx: rnd(0.2, 0.8), a: rnd(0, 6), va: rnd(-0.04, 0.04) }),
      step(p, w, h, dt, ctx, o) {
        p.y += p.vy * dt * o.speed; p.x += p.vx * dt * o.speed; p.a += p.va * dt;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 7); ctx.fill(); ctx.restore();
        return p.y < h + 10 && p.x < w + 20;
      },
      color: '#ffb7d0',
    },
    bubbles: {
      spawn: (w, h, init) => ({ x: rnd(0, w), y: init ? rnd(0, h) : h + 10, r: rnd(3, 9), vy: rnd(0.3, 0.9), ph: rnd(0, 6) }),
      step(p, w, h, dt, ctx, o) { p.y -= p.vy * dt * o.speed; p.ph += 0.03 * dt; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x + Math.sin(p.ph) * 4, p.y, p.r, 0, 7); ctx.stroke(); return p.y > -12; },
    },
    shooting: {
      spawn: (w, h, init, o) => {
        const a = ((o.angle == null ? 332 : o.angle) * Math.PI) / 180;
        return { x: rnd(0, w * 1.2), y: rnd(-h * 0.2, h * 0.6), vx: Math.cos(a) * -1, vy: Math.sin(a) * -1, len: rnd(60, 140), v: rnd(6, 11), life: init ? rnd(-200, 0) : rnd(-120, 0) };
      },
      step(p, w, h, dt, ctx, o) {
        p.life += dt;
        if (p.life < 0) return true;
        p.x += p.vx * p.v * dt * o.speed; p.y += p.vy * p.v * dt * o.speed;
        const g = ctx.createLinearGradient(p.x, p.y, p.x - p.vx * p.len, p.y - p.vy * p.len);
        g.addColorStop(0, o.color); g.addColorStop(1, 'transparent');
        ctx.strokeStyle = g; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * p.len, p.y - p.vy * p.len); ctx.stroke();
        return p.x > -p.len * 2 && p.x < w + p.len * 2 && p.y < h + p.len * 2 && p.y > -p.len * 2;
      },
      sparse: true,
    },
    rain: {
      spawn: (w, h, init) => ({ x: rnd(-w * 0.2, w), y: init ? rnd(0, h) : -20, len: rnd(10, 22), v: rnd(7, 12) }),
      step(p, w, h, dt, ctx, o) { p.y += p.v * dt * o.speed; p.x += p.v * 0.18 * dt * o.speed; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.18, p.y - p.len); ctx.stroke(); return p.y < h + 20; },
    },
  };
  C.EFFECT_KINDS = Object.keys(KINDS);

  // opts: { count, color, speed, angle, opacity }
  C.particles = function particles(canvas, kind, opts = {}) {
    const def = KINDS[kind];
    if (!def || !canvas) return { stop() {}, update() {} };
    const o = { count: 40, speed: 1, color: def.color || '#ffffff', ...opts };
    if (!o.color) o.color = def.color || '#ffffff';
    const ctx = canvas.getContext('2d');
    let w = 0; let h = 0; let list = []; let raf = 0; let last = performance.now(); let alive = true;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const target = () => (def.sparse ? Math.max(1, Math.round(o.count / 8)) : o.count);
    for (let i = 0; i < target(); i++) list.push(def.spawn(w, h, true, o));
    const frame = (now) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(3, (now - last) / 16.7);
      last = now;
      if (document.hidden || document.body.classList.contains('no-anim') || !canvas.isConnected) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = o.color; ctx.strokeStyle = o.color;
      canvas.style.opacity = o.opacity == null ? 1 : o.opacity;
      const next = [];
      for (const p of list) {
        const keep = def.step(p, w, h, dt, ctx, o);
        if (keep) next.push(p);
      }
      ctx.globalAlpha = 1;
      while (next.length < target()) next.push(def.spawn(w, h, false, o));
      list = next.slice(0, target() * 2);
    };
    raf = requestAnimationFrame(frame);
    return {
      stop() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); },
      update(next) { Object.assign(o, next); if (!o.color) o.color = def.color || '#ffffff'; },
    };
  };
})();
