'use strict';

// ===== Управление =====
// Мышь: наведение — прицел, нажать и тянуть назад — сила.
// Палец: вести по полю — прицел, вниз по шкале силы — сила, отпустить — удар.
const TOUCH_GRAB_PX = 26;
const GAUGE_PAD_PX = 14;

function toWorld(e) {
  const rect = canvas.getBoundingClientRect();
  let x = ((e.clientX - rect.left) * view.dpr - view.ox) / view.s;
  let y = ((e.clientY - rect.top) * view.dpr - view.oy) / view.s;
  if (flipped()) {
    x = FIELD - x;
    y = FIELD - y;
  }
  return { x, y };
}

function inGauge(e) {
  if (cfg.powerSide === 'off' || !view.gauge) return false;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * view.dpr;
  const y = (e.clientY - rect.top) * view.dpr;
  const g = view.gauge;
  const pad = GAUGE_PAD_PX * view.dpr;
  return x >= g.x - pad && x <= g.x + g.w + pad && y >= g.y - pad && y <= g.y + g.h + pad;
}

function onStriker(e, w) {
  const extra = e.pointerType === 'mouse' ? 6 : TOUCH_GRAB_PX * view.dpr / view.s;
  return Math.hypot(w.x - striker.x, w.y - striker.y) <= striker.r + extra;
}

function pointAimAt(w) {
  const dx = w.x - striker.x;
  const dy = w.y - striker.y;
  const d = Math.hypot(dx, dy);
  if (d < striker.r) return;
  aim.dirX = dx / d;
  aim.dirY = dy / d;
}

// deg > 0 — по часовой стрелке на экране.
function rotateAim(deg) {
  const a = Math.atan2(aim.dirY, aim.dirX) + deg * Math.PI / 180;
  aim.dirX = Math.cos(a);
  aim.dirY = Math.sin(a);
}

function cancelAim() {
  aim.charging = false;
  aim.power = 0;
  drag = null;
  updatePower();
}

canvas.addEventListener('pointerdown', e => {
  if (phase !== 'place' || drag) return;
  if (e.button === 2) {
    cancelAim();
    return;
  }
  const touch = e.pointerType !== 'mouse';
  const w = toWorld(e);
  canvas.setPointerCapture(e.pointerId);
  if (touch && inGauge(e)) {
    drag = { type: 'gauge', id: e.pointerId, startY: e.clientY };
    aim.charging = true;
    aim.power = 0;
    updatePower();
  } else if (onStriker(e, w)) {
    drag = { type: 'striker', id: e.pointerId, offX: striker.x - w.x, offY: striker.y - w.y };
  } else if (touch) {
    drag = { type: 'point', id: e.pointerId };
    pointAimAt(w);
  } else {
    drag = { type: 'aim', id: e.pointerId };
    aim.charging = true;
    aim.startX = e.clientX;
    aim.startY = e.clientY;
    aim.power = 0;
  }
});

canvas.addEventListener('pointermove', e => {
  if (phase !== 'place') return;
  if (drag && e.pointerId !== drag.id) return;
  const w = toWorld(e);
  if (drag?.type === 'striker') {
    moveStriker(w.x + drag.offX, w.y + drag.offY);
  } else if (drag?.type === 'point') {
    pointAimAt(w);
  } else if (drag?.type === 'gauge') {
    const pull = (wideGauge() ? e.clientY - drag.startY : drag.startY - e.clientY) * view.dpr;
    aim.power = Math.min(1, Math.max(0, pull / (view.gauge.h * 0.85)));
    updatePower();
  } else if (drag?.type === 'aim') {
    const sx = flipped() ? -aim.dirX : aim.dirX;
    const sy = flipped() ? -aim.dirY : aim.dirY;
    const pull = -((e.clientX - aim.startX) * sx + (e.clientY - aim.startY) * sy);
    aim.power = Math.min(1, Math.max(0, pull / MAX_PULL_PX));
    updatePower();
  } else if (e.pointerType !== 'touch') {
    pointAimAt(w);
    canvas.style.cursor = onStriker(e, w) ? 'grab' : 'crosshair';
  }
});

canvas.addEventListener('pointerup', e => {
  if (drag && e.pointerId !== drag.id) return;
  const charged = (drag?.type === 'aim' || drag?.type === 'gauge') && aim.charging && aim.power > 0.01;
  if (charged && phase === 'place') shoot();
  else cancelAim();
  drag = null;
});

canvas.addEventListener('pointercancel', e => {
  if (drag && e.pointerId === drag.id) cancelAim();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (phase !== 'place') return;
  if (e.key === 'Escape') cancelAim();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const step = e.shiftKey ? 1 : 0.1;
    rotateAim((e.key === 'ArrowLeft' ? -step : step) * (flipped() ? -1 : 1));
    e.preventDefault();
  }
});

// Кнопки точного прицела: держать — поворот ускоряется.
function bindRotateButton(id, sign) {
  const btn = document.getElementById(id);
  let timer = null;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (phase !== 'place') return;
    stop();
    const started = performance.now();
    const tick = () => {
      const held = performance.now() - started;
      const step = held < 500 ? 0.1 : held < 1500 ? 0.3 : 1;
      rotateAim(sign * step * (flipped() ? -1 : 1));
      timer = setTimeout(tick, held < 500 ? 120 : 40);
    };
    tick();
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

bindRotateButton('btnRotL', -1);
bindRotateButton('btnRotR', 1);
