'use strict';

// Canvas particle effects (sparkles, fireworks) drawn over the whole page.
const fx = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let parts = [];
  let running = false;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  addEventListener('resize', resize);
  resize();

  const start = () => {
    if (running) return;
    if (canvas.width !== Math.round(innerWidth * (window.devicePixelRatio || 1))) resize();
    running = true;
    requestAnimationFrame(tick);
  };

  function burst(x, y, count, colors, power = 1) {
    if (reduced) return;
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 4) * power;
      parts.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.2 * power,
        g: 0.12,
        life: 1,
        decay: 0.012 + Math.random() * 0.018,
        size: (1.5 + Math.random() * 2.5) * Math.max(power, 0.6),
        color: colors[k % colors.length],
        star: Math.random() < 0.35,
        spin: Math.random() * 6,
      });
    }
    start();
  }

  function rocket(x, colors) {
    const g = 0.15;
    const height = innerHeight * (0.45 + Math.random() * 0.35);
    parts.push({
      x, y: innerHeight + 10,
      vx: (Math.random() - 0.5) * 2,
      vy: -Math.sqrt(2 * g * height),
      g, life: 1, decay: 0, size: 3, color: '#fff', rocket: true, colors,
    });
    start();
  }

  function show(colors, duration = 2400, shots = 12) {
    if (reduced) return;
    for (let k = 0; k < shots; k++) {
      setTimeout(() => rocket(innerWidth * (0.12 + Math.random() * 0.76), colors), (k / shots) * duration);
    }
  }

  function drawStar(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.spin += 0.12));
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? p.size : p.size * 2.4;
      const a = (k * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const alive = [];
    // Items pushed while looping (explosions, trails) are still visited by for...of.
    for (const p of parts) {
      p.vy += p.g;
      if (!p.rocket) {
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.life -= p.decay;
      }
      p.x += p.vx;
      p.y += p.vy;

      if (p.rocket) {
        if (p.vy >= -0.5) {
          burst(p.x, p.y, 80, p.colors, 1.7);
          continue;
        }
        parts.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5), vy: Math.random(), g: 0.04,
          life: 0.7, decay: 0.04, size: 1.6, color: '#ffd166' });
      }
      if (p.life <= 0) continue;

      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.fillStyle = p.color;
      if (p.star) drawStar(p);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      alive.push(p);
    }
    ctx.globalAlpha = 1;
    parts = alive;
    if (parts.length) requestAnimationFrame(tick);
    else running = false;
  }

  return { burst, show };
})();
