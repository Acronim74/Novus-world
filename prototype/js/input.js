'use strict';

// ===== Управление =====
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

function pointAimAt(w) {
  const dx = w.x - striker.x;
  const dy = w.y - striker.y;
  const d = Math.hypot(dx, dy);
  if (d < striker.r) return;
  aim.dirX = dx / d;
  aim.dirY = dy / d;
}

function cancelAim() {
  aim.charging = false;
  aim.power = 0;
  drag = null;
  updatePower();
}

canvas.addEventListener('pointerdown', e => {
  if (phase !== 'place') return;
  if (e.button === 2) {
    cancelAim();
    return;
  }
  const w = toWorld(e);
  canvas.setPointerCapture(e.pointerId);
  if (Math.hypot(w.x - striker.x, w.y - striker.y) <= striker.r + 6) {
    drag = { type: 'striker', offX: striker.x - w.x, offY: striker.y - w.y };
  } else {
    drag = { type: 'aim' };
    aim.charging = true;
    aim.startX = e.clientX;
    aim.startY = e.clientY;
    aim.power = 0;
  }
});

canvas.addEventListener('pointermove', e => {
  if (phase !== 'place') return;
  const w = toWorld(e);
  if (drag?.type === 'striker') {
    moveStriker(w.x + drag.offX, w.y + drag.offY);
  } else if (drag?.type === 'aim') {
    const sx = flipped() ? -aim.dirX : aim.dirX;
    const sy = flipped() ? -aim.dirY : aim.dirY;
    const pull = -((e.clientX - aim.startX) * sx + (e.clientY - aim.startY) * sy);
    aim.power = Math.min(1, Math.max(0, pull / MAX_PULL_PX));
    updatePower();
  } else {
    pointAimAt(w);
    const onStriker = Math.hypot(w.x - striker.x, w.y - striker.y) <= striker.r + 6;
    canvas.style.cursor = onStriker ? 'grab' : 'crosshair';
  }
});

canvas.addEventListener('pointerup', () => {
  if (drag?.type === 'aim' && aim.charging && aim.power > 0.01) shoot();
  else cancelAim();
  drag = null;
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (phase !== 'place') return;
  if (e.key === 'Escape') cancelAim();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const step = (e.shiftKey ? 1 : 0.1) * Math.PI / 180;
    const a = Math.atan2(aim.dirY, aim.dirX) + (e.key === 'ArrowLeft' ? -step : step) * (flipped() ? -1 : 1);
    aim.dirX = Math.cos(a);
    aim.dirY = Math.sin(a);
    e.preventDefault();
  }
});
