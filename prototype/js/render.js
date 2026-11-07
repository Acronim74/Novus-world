'use strict';

// ===== Подсказка траектории =====
function castRay(px, py, dx, dy, r) {
  let best = { t: Infinity, type: null };
  const consider = (t, hit) => {
    if (t > 1e-6 && t < best.t) best = { t, ...hit };
  };
  if (dx > 0) consider((FIELD - r - px) / dx, { type: 'rail', side: 'right' });
  if (dx < 0) consider((r - px) / dx, { type: 'rail', side: 'left' });
  if (dy > 0) consider((FIELD - r - py) / dy, { type: 'rail', side: 'bottom' });
  if (dy < 0) consider((r - py) / dy, { type: 'rail', side: 'top' });

  const circleHit = (cx, cy, R) => {
    const fx = px - cx;
    const fy = py - cy;
    const b = fx * dx + fy * dy;
    const disc = b * b - (fx * fx + fy * fy - R * R);
    return disc < 0 ? -1 : -b - Math.sqrt(disc);
  };
  for (const body of bodies) {
    if (body === striker || body.state !== 'table') continue;
    consider(circleHit(body.x, body.y, r + body.r), { type: 'body', body });
  }
  for (const pk of POCKETS) consider(circleHit(pk.x, pk.y, POCKET_R), { type: 'pocket' });
  return best;
}

function drawHint(mode) {
  let px = striker.x;
  let py = striker.y;
  let dx = aim.dirX;
  let dy = aim.dirY;
  let left = mode.len;
  const r = striker.r;
  ctx.save();
  ctx.lineWidth = 1.5 * px1();
  ctx.setLineDash([8, 6]);
  for (let bounce = 0; bounce <= mode.bounces; bounce++) {
    const hit = castRay(px, py, dx, dy, r);
    if (!hit.type) break;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    if (hit.t > left) {
      line(px, py, px + dx * left, py + dy * left);
      break;
    }
    left -= hit.t;
    const hx = px + dx * hit.t;
    const hy = py + dy * hit.t;
    line(px, py, hx, hy);

    if (hit.type === 'pocket') {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ff5252';
      circle(hx, hy, r, false);
      break;
    }
    if (hit.type === 'body') {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      circle(hx, hy, r, false);
      if (!mode.target) break;
      const b = hit.body;
      const nx = (b.x - hx) / (r + b.r);
      const ny = (b.y - hy) / (r + b.r);
      ctx.strokeStyle = b.owner === current ? '#69f0ae' : '#ff8a80';
      ctx.lineWidth = 2.5 * px1();
      line(b.x, b.y, b.x + nx * 160, b.y + ny * 160);
      break;
    }
    // Отскок с учётом потерь: нормальная составляющая гасится сильнее касательной.
    let ndx = dx;
    let ndy = dy;
    if (hit.side === 'left' || hit.side === 'right') {
      ndx = -dx * cfg.railE;
      ndy = dy * cfg.railTangent;
    } else {
      ndx = dx * cfg.railTangent;
      ndy = -dy * cfg.railE;
    }
    const len = Math.hypot(ndx, ndy);
    px = hx;
    py = hy;
    dx = ndx / len;
    dy = ndy / len;
  }
  ctx.restore();
}

// ===== Отрисовка =====
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const view = { s: 1, ox: 0, oy: 0, dpr: 1, gauge: null };
const coarsePointer = window.matchMedia('(pointer: coarse)');

// На сенсорном экране шкала силы — широкая полоса за бортом, её тянут пальцем.
function wideGauge() {
  return coarsePointer.matches && cfg.powerSide !== 'off';
}

function resize() {
  const stage = document.getElementById('stage');
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  view.dpr = dpr;

  const margin = 30;
  const total = FIELD + 2 * RAIL_W + 2 * margin;
  const gw = wideGauge() ? 34 * dpr : 0;
  const gap = wideGauge() ? 6 * dpr : 0;
  view.s = Math.min((canvas.width - gw - gap) / total, canvas.height / total);
  const size = FIELD * view.s;
  const rail = RAIL_W * view.s;
  const left = (canvas.width - total * view.s - gw - gap) / 2;
  const toField = (margin + RAIL_W) * view.s;
  view.oy = (canvas.height - size) / 2;

  if (!gw) {
    view.ox = left + toField;
    const gwRail = Math.max(8 * dpr, rail * 0.5);
    const x = cfg.powerSide === 'left'
      ? view.ox - rail / 2 - gwRail / 2
      : view.ox + size + rail / 2 - gwRail / 2;
    view.gauge = { x, y: view.oy, w: gwRail, h: size };
  } else if (cfg.powerSide === 'left') {
    const gx = left + margin * view.s;
    view.ox = gx + gw + gap + rail;
    view.gauge = { x: gx, y: view.oy, w: gw, h: size };
  } else {
    view.ox = left + toField;
    view.gauge = { x: view.ox + size + rail + gap, y: view.oy, w: gw, h: size };
  }
}

function flipped() {
  if (net.active) return net.seat === 1;
  return cfg.flip && current === 1;
}

function applyView() {
  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
  if (flipped()) {
    ctx.translate(FIELD, FIELD);
    ctx.rotate(Math.PI);
  }
}

function px1() {
  return view.dpr / view.s;
}

function line(x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function circle(x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d2327';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  applyView();

  const frame = ctx.createLinearGradient(-RAIL_W, -RAIL_W, FIELD + RAIL_W, FIELD + RAIL_W);
  frame.addColorStop(0, '#6b3f1f');
  frame.addColorStop(1, '#4a2a12');
  ctx.fillStyle = frame;
  ctx.fillRect(-RAIL_W, -RAIL_W, FIELD + 2 * RAIL_W, FIELD + 2 * RAIL_W);

  ctx.fillStyle = '#efe2c4';
  ctx.fillRect(0, 0, FIELD, FIELD);

  drawLines();
  if (phase === 'place') drawPlacementArea();
  drawPockets();

  const visible = bodies.filter(b => b.state === 'table').sort((a, b) => a.z - b.z);
  for (const b of visible) drawShadow(b);
  for (const b of visible) drawPuck(b);

  if (phase === 'place') {
    if (cfg.hintLen !== 'off') drawHint(HINT_MODES[cfg.hintLen]);
    drawCue();
  }
  if ((phase === 'ai' && aiShowCue) || (phase === 'remote' && net.peerAiming)) drawCue();
  if ((phase === 'place' || phase === 'ai' || phase === 'remote') && cfg.powerSide !== 'off') drawPowerGauge();
  if (toast && performance.now() < toast.until) drawToast();
  if (phase === 'over') drawBanner(winnerText);
}

function drawLines() {
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = Math.max(LINE_W, px1());
  for (const v of [ZONE, FIELD - ZONE]) {
    line(v, 0, v, FIELD);
    line(0, v, FIELD, v);
  }
  const c = FIELD / 2;
  line(c, 0, c, ZONE);
  line(c, FIELD - ZONE, c, FIELD);
  line(0, c, ZONE, c);
  line(FIELD - ZONE, c, FIELD, c);
  circle(c, c, CIRCLE_R, false);
  line(c - CIRCLE_R, c, c + CIRCLE_R, c);
  line(c, c - CIRCLE_R, c, c + CIRCLE_R);
}

function drawPlacementArea() {
  const a = placementArea(current);
  const y0 = yAtDepth(current, a.d0);
  const y1 = yAtDepth(current, a.d1);
  ctx.save();
  ctx.fillStyle = 'rgba(76, 175, 80, 0.13)';
  ctx.strokeStyle = 'rgba(56, 142, 60, 0.8)';
  ctx.lineWidth = 1.5 * px1();
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.rect(a.x0, Math.min(y0, y1), a.x1 - a.x0, Math.abs(y1 - y0));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPockets() {
  for (const pk of POCKETS) {
    const g = ctx.createRadialGradient(pk.x, pk.y, POCKET_R * 0.2, pk.x, pk.y, POCKET_R);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#2b2b2b');
    ctx.fillStyle = g;
    circle(pk.x, pk.y, POCKET_R, true);
  }
}

function drawShadow(b) {
  const off = 1.5 + b.z * 0.5;
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.3 - b.z / 200)})`;
  circle(b.x + off * 0.6, b.y + off, b.r, true);
}

function drawPuck(b) {
  const lift = (1 + b.z / 120) * (1 - b.sink / 40);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.scale(lift, lift);

  let fill;
  if (b.kind === 'striker') {
    fill = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, 2, 0, 0, b.r);
    fill.addColorStop(0, '#e6c48f');
    fill.addColorStop(1, '#b8874c');
  } else {
    fill = PLAYERS[b.owner].color;
  }
  // Сквозное отверстие видно насквозь — по нему игрок проверяет, видна ли линия.
  ctx.beginPath();
  ctx.arc(0, 0, b.r, 0, Math.PI * 2);
  ctx.arc(0, 0, b.hole, 0, Math.PI * 2, true);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.lineWidth = Math.max(0.8, px1());
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  circle(0, 0, b.r, false);
  circle(0, 0, b.hole, false);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  circle(0, 0, b.r * 0.7, false);
  ctx.restore();

  if (phase === 'place' && b.kind === 'pawn' && b.owner === current && isDark(b)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(60,60,60,0.85)';
    ctx.lineWidth = 1.5 * px1();
    ctx.setLineDash([4, 4]);
    circle(b.x, b.y, b.r + 4, false);
    ctx.restore();
  }
  if (b.kind === 'pawn' && phase !== 'moving' && isHanging(b)) {
    ctx.save();
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 2.5 * px1();
    circle(b.x, b.y, b.r + 4, false);
    ctx.restore();
  }
}

function drawCue() {
  const gap = striker.r + 6 + aim.power * 70;
  const tipX = striker.x - aim.dirX * gap;
  const tipY = striker.y - aim.dirY * gap;
  const len = 700;
  const endX = tipX - aim.dirX * len;
  const endY = tipY - aim.dirY * len;
  ctx.save();
  ctx.lineCap = 'round';
  const g = ctx.createLinearGradient(tipX, tipY, endX, endY);
  g.addColorStop(0, '#f3dfb7');
  g.addColorStop(1, '#8d5a2b');
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 9;
  line(tipX + 4, tipY + 5, endX + 4, endY + 5);
  ctx.strokeStyle = g;
  ctx.lineWidth = 8;
  line(tipX, tipY, endX, endY);
  ctx.restore();
}

// Шкала силы на боковом борту, в координатах экрана: при повороте стола остаётся на своей стороне.
function drawPowerGauge() {
  const d = view.dpr;
  const { x, y: top, w, h } = view.gauge;
  const fill = h * aim.power;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, w / 2);
  ctx.fill();

  if (fill > 0) {
    const g = ctx.createLinearGradient(0, top + h, 0, top);
    g.addColorStop(0, '#4caf50');
    g.addColorStop(0.6, '#ffc107');
    g.addColorStop(1, '#f44336');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, top + h - fill, w, fill, w / 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = Math.max(1, d);
  for (const k of [0.25, 0.5, 0.75]) {
    const y = top + h * (1 - k);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }

  if (aim.power > 0) {
    const text = `${Math.round(aim.power * 100)}%`;
    ctx.font = `700 ${12 * d}px "Segoe UI", sans-serif`;
    const tw = ctx.measureText(text).width + 10 * d;
    const th = 18 * d;
    const ty = Math.min(top + h - th / 2, Math.max(top + th / 2, top + h - fill));
    ctx.fillStyle = 'rgba(20, 24, 27, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x + w / 2 - tw / 2, ty - th / 2, tw, th, 5 * d);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, ty + d);
  } else if (wideGauge() && phase === 'place') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = `${14 * d}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) ctx.fillText('▲', x + w / 2, top + h - (14 + k * 16) * d);
  }
  ctx.restore();
}

const TOAST_COLORS = {
  keep: 'rgba(46, 125, 50, 0.92)',
  pass: 'rgba(55, 71, 79, 0.92)',
  foul: 'rgba(183, 28, 28, 0.92)',
  win: 'rgba(255, 179, 0, 0.95)',
};

function drawToast() {
  const left = toast.until - performance.now();
  const alpha = Math.min(1, left / 400);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  const d = view.dpr;
  const maxW = FIELD * view.s * 0.94;
  let font = 18 * d;
  ctx.font = `600 ${font}px "Segoe UI", sans-serif`;
  const tw = ctx.measureText(toast.text).width;
  if (tw + 36 * d > maxW) {
    font *= (maxW - 24 * d) / tw;
    ctx.font = `600 ${font}px "Segoe UI", sans-serif`;
  }
  const w = Math.min(maxW, ctx.measureText(toast.text).width + 36 * d);
  const h = font + 22 * d;
  const cx = view.ox + FIELD * view.s / 2;
  const x = cx - w / 2;
  const y = view.oy + FIELD * view.s * 0.36 - h / 2;
  ctx.fillStyle = TOAST_COLORS[toast.cls] || TOAST_COLORS.pass;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10 * d);
  ctx.fill();
  ctx.fillStyle = toast.cls === 'win' ? '#1d2327' : '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(toast.text, cx, y + h / 2 + d);
  ctx.restore();
}

function drawBanner(text) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const h = 80 * view.dpr;
  ctx.fillRect(0, canvas.height / 2 - h / 2, canvas.width, h);
  ctx.fillStyle = '#fff';
  ctx.font = `${24 * view.dpr}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.restore();
}
