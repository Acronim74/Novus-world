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
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    if (hit.t > left) {
      hintLine(px, py, px + dx * left, py + dy * left);
      break;
    }
    left -= hit.t;
    const hx = px + dx * hit.t;
    const hy = py + dy * hit.t;
    hintLine(px, py, hx, hy);

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
let ctx = canvas.getContext('2d');
const view = { s: 1, ox: 0, oy: 0, dpr: 1, gauge: null };
const coarsePointer = window.matchMedia('(pointer: coarse)');

const phonePortrait = window.matchMedia('(orientation: portrait) and (max-width: 699px)');
const tabletPortrait = window.matchMedia('(orientation: portrait) and (min-width: 700px) and (max-width: 1024px)');

// На сенсорном экране шкала силы — широкая полоса за бортом, её тянут пальцем.
function wideGauge() {
  return coarsePointer.matches && cfg.powerSide !== 'off';
}

// На телефоне и планшете в портрете шкала лежит под столом, чтобы стол занял всю ширину экрана.
function bottomGauge() {
  return wideGauge() && (phonePortrait.matches || tabletPortrait.matches);
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

  if (bottomGauge()) {
    const margin = 12;
    const total = FIELD + 2 * RAIL_W + 2 * margin;
    const gh = 36 * dpr;
    const gap = 8 * dpr;
    view.s = Math.min(canvas.width / total, (canvas.height - gh - gap) / total);
    const size = FIELD * view.s;
    const toField = (margin + RAIL_W) * view.s;
    const top = (canvas.height - total * view.s - gap - gh) / 2;
    view.ox = (canvas.width - size) / 2;
    view.oy = top + toField;
    const rail = RAIL_W * view.s;
    view.gauge = { x: view.ox - rail, y: top + total * view.s + gap, w: size + 2 * rail, h: gh, horiz: true };
    return;
  }

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

// Линия подсказки: светлый пунктир на тёмной подложке — виден и на светлой фанере, и на тёмном столе.
function hintLine(x0, y0, x1, y1) {
  const color = ctx.strokeStyle;
  const width = ctx.lineWidth;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = width * 2.4;
  line(x0, y0, x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  line(x0, y0, x1, y1);
}

function circle(x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}

function draw() {
  const skin = typeof tableSkin === 'function' ? tableSkin() : null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ensureTableLayer(skin);
  ctx.drawImage(tableLayer, 0, 0);
  applyView();
  if (phase === 'place') drawPlacementArea();

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

function drawDeco(deco) {
  if (!deco || deco.id === 'none') return;
  const accent = deco.accent || '#c9a227';
  const o0 = -RAIL_W;
  const o1 = FIELD + RAIL_W;
  const cap = 78;
  const t = 7;
  ctx.save();
  ctx.fillStyle = accent;
  const corners = [[o0, o0], [o1 - cap, o0], [o0, o1 - cap], [o1 - cap, o1 - cap]];
  for (const [x, y] of corners) {
    ctx.fillRect(x, y, cap, t);
    ctx.fillRect(x, y, t, cap);
    ctx.fillRect(x + cap - t, y, t, cap);
    ctx.fillRect(x, y + cap - t, cap, t);
  }
  if (deco.id === 'inlay') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(8, 8, FIELD - 16, FIELD - 16);
    ctx.strokeRect(-RAIL_W / 2, -RAIL_W / 2, FIELD + RAIL_W, FIELD + RAIL_W);
  }
  ctx.restore();
}

function drawLines(color) {
  ctx.strokeStyle = color || '#1b1b1b';
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

// ===== Стол: статичный слой =====
// Дерево, борта, лузы и свет лампы рисуются один раз и хранятся картинкой:
// фактура дорогая, а меняется только при смене размера окна или оформления.
const tableLayer = document.createElement('canvas');
let tableLayerKey = '';

// k > 0 — светлее, k < 0 — темнее.
function shade(hex, k) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = v => Math.round(Math.max(0, Math.min(255, k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function grainRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

// Волокна дерева: тонкие чуть волнистые линии вдоль доски.
function woodGrain(x, y, w, h, along, seed, strength) {
  const rnd = grainRandom(seed);
  const len = along === 'x' ? w : h;
  const across = along === 'x' ? h : w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // Широкие тональные полосы — слои шпона.
  for (let p = 0; p < across;) {
    const band = 18 + rnd() * 60;
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.035 * strength * rnd()})` : `rgba(60,30,0,${0.04 * strength * rnd()})`;
    if (along === 'x') ctx.fillRect(x, y + p, w, band);
    else ctx.fillRect(x + p, y, band, h);
    p += band;
  }
  for (let p = rnd() * 3; p < across; p += 1.6 + rnd() * 4.5) {
    const amp = 0.6 + rnd() * 2.2;
    const wave = 120 + rnd() * 260;
    const ph = rnd() * 6.28;
    ctx.strokeStyle = rnd() < 0.72
      ? `rgba(70,35,5,${(0.04 + rnd() * 0.1) * strength})`
      : `rgba(255,250,235,${(0.05 + rnd() * 0.09) * strength})`;
    ctx.lineWidth = 0.5 + rnd() * 0.9;
    ctx.beginPath();
    for (let q = 0; q <= len; q += 24) {
      const off = p + Math.sin(q / wave * 6.28 + ph) * amp;
      if (along === 'x') ctx.lineTo(x + q, y + off);
      else ctx.lineTo(x + off, y + q);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function ensureTableLayer(skin) {
  // Поворот стола входит в ключ: лузы и линии должны совпасть с фишками.
  const key = [canvas.width, canvas.height, view.s, view.ox, view.oy, flipped() ? 1 : 0, skin?._key || ''].join('|');
  if (key === tableLayerKey) return;
  tableLayerKey = key;
  tableLayer.width = canvas.width;
  tableLayer.height = canvas.height;
  const main = ctx;
  ctx = tableLayer.getContext('2d');
  try {
    paintTable(skin);
  } finally {
    ctx = main;
  }
}

function paintTable(skin) {
  const W = canvas.width;
  const H = canvas.height;
  const o0 = -RAIL_W;
  const full = FIELD + 2 * RAIL_W;
  const railSkin = skin?.rail || { from: '#6b3f1f', to: '#4a2a12' };
  const feltFill = skin?.felt?.fill || '#efe2c4';

  // Зал: тёмный фон и тёплое пятно света от лампы над столом.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1917';
  ctx.fillRect(0, 0, W, H);
  const cx = view.ox + FIELD * view.s / 2;
  const cy = view.oy + FIELD * view.s / 2;
  const glow = ctx.createRadialGradient(cx, cy, FIELD * view.s * 0.3, cx, cy, FIELD * view.s * 0.95);
  glow.addColorStop(0, 'rgba(255,196,120,0.16)');
  glow.addColorStop(1, 'rgba(255,196,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);

  // Тень стола на полу — в экранных координатах, чтобы не уезжала вверх при повороте.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 26 * view.s;
  ctx.shadowOffsetY = 10 * view.s;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(o0, o0, full, full, 10);
  ctx.fill();
  ctx.restore();

  applyView();

  // Рама: четыре доски со стыком «на ус».
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(o0, o0, full, full, 10);
  ctx.clip();
  const o1 = FIELD + RAIL_W;
  const boards = [
    { pts: [[o0, o0], [o1, o0], [FIELD, 0], [0, 0]], along: 'x', box: [o0, o0, full, RAIL_W], g: [0, o0, 0, 0], light: 0.1 },
    { pts: [[o0, o1], [o1, o1], [FIELD, FIELD], [0, FIELD]], along: 'x', box: [o0, FIELD, full, RAIL_W], g: [0, o1, 0, FIELD], light: -0.16 },
    { pts: [[o0, o0], [0, 0], [0, FIELD], [o0, o1]], along: 'y', box: [o0, o0, RAIL_W, full], g: [o0, 0, 0, 0], light: 0.03 },
    { pts: [[o1, o0], [FIELD, 0], [FIELD, FIELD], [o1, o1]], along: 'y', box: [FIELD, o0, RAIL_W, full], g: [o1, 0, FIELD, 0], light: -0.1 },
  ];
  if (flipped()) {
    const swap = (i, j) => { const t = boards[i].light; boards[i].light = boards[j].light; boards[j].light = t; };
    swap(0, 1);
    swap(2, 3);
  }
  boards.forEach((b, i) => {
    ctx.save();
    ctx.beginPath();
    b.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    // Поперёк доски: скруглённая кромка — светлее сверху, темнее у поля.
    const g = ctx.createLinearGradient(...b.g);
    g.addColorStop(0, shade(railSkin.to, -0.1));
    g.addColorStop(0.18, shade(railSkin.from, 0.16));
    g.addColorStop(0.6, railSkin.from);
    g.addColorStop(1, railSkin.to);
    ctx.fillStyle = g;
    ctx.fillRect(...b.box);
    woodGrain(...b.box, b.along, 9100 + i * 77, 1.5);
    ctx.fillStyle = b.light > 0 ? `rgba(255,235,200,${b.light})` : `rgba(0,0,0,${-b.light})`;
    ctx.fillRect(...b.box);
    ctx.restore();
  });
  // Стыки досок в углах.
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.lineWidth = 1.2;
  for (const [x0, y0, x1, y1] of [[o0, o0, 0, 0], [o1, o0, FIELD, 0], [o0, o1, 0, FIELD], [o1, o1, FIELD, FIELD]]) line(x0, y0, x1, y1);
  ctx.restore();

  // Поле: светлая фанера с волокнами.
  ctx.fillStyle = feltFill;
  ctx.fillRect(0, 0, FIELD, FIELD);
  woodGrain(0, 0, FIELD, FIELD, 'y', 4242, 1);

  drawLines(skin?.felt?.line || '#1b1b1b');
  if (skin?.deco) drawDeco(skin.deco);

  // Свет лампы: центр поля светлее, углы уходят в тень.
  const lamp = ctx.createRadialGradient(FIELD / 2, FIELD / 2, FIELD * 0.15, FIELD / 2, FIELD / 2, FIELD * 0.78);
  lamp.addColorStop(0, 'rgba(255,246,222,0.14)');
  lamp.addColorStop(0.55, 'rgba(255,246,222,0)');
  lamp.addColorStop(1, 'rgba(40,20,0,0.2)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, FIELD, FIELD);

  // Борт выше поля: он отбрасывает на поле тень.
  const edgeShadow = (x0, y0, x1, y1, rect, a) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(...rect);
  };
  const turn = flipped();
  edgeShadow(0, 0, 0, 20, [0, 0, FIELD, 20], turn ? 0.16 : 0.34);
  edgeShadow(0, 0, 16, 0, [0, 0, 16, FIELD], turn ? 0.16 : 0.26);
  edgeShadow(0, FIELD, 0, FIELD - 8, [0, FIELD - 8, FIELD, 8], turn ? 0.34 : 0.16);
  edgeShadow(FIELD, 0, FIELD - 8, 0, [FIELD - 8, 0, 8, FIELD], turn ? 0.26 : 0.16);
  // Кромка борта у поля.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0, 0, FIELD, FIELD);
  ctx.strokeStyle = 'rgba(255,225,180,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-2.5, -2.5, FIELD + 5, FIELD + 5);

  drawPockets();
}

function drawPockets() {
  const sgn = lightSign();
  for (const pk of POCKETS) {
    // Фаска вокруг отверстия.
    const rim = ctx.createLinearGradient(
      pk.x - POCKET_R * sgn, pk.y - POCKET_R * sgn,
      pk.x + POCKET_R * sgn, pk.y + POCKET_R * sgn
    );
    rim.addColorStop(0, 'rgba(60,30,5,0.55)');
    rim.addColorStop(1, 'rgba(255,240,210,0.5)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 3;
    circle(pk.x, pk.y, POCKET_R + 1, false);

    const g = ctx.createRadialGradient(pk.x + 5 * sgn, pk.y + 8 * sgn, POCKET_R * 0.1, pk.x, pk.y, POCKET_R);
    g.addColorStop(0, '#000');
    g.addColorStop(0.7, '#0b0907');
    g.addColorStop(1, '#2a1f15');
    ctx.fillStyle = g;
    circle(pk.x, pk.y, POCKET_R, true);

    ctx.save();
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, POCKET_R - 1, 0, Math.PI * 2);
    ctx.clip();
    // Сетка лузы.
    ctx.strokeStyle = 'rgba(255,235,200,0.07)';
    ctx.lineWidth = 1;
    for (let d = -POCKET_R * 2; d <= POCKET_R * 2; d += 11) {
      line(pk.x + d - POCKET_R, pk.y - POCKET_R, pk.x + d + POCKET_R, pk.y + POCKET_R);
      line(pk.x + d + POCKET_R, pk.y - POCKET_R, pk.x + d - POCKET_R, pk.y + POCKET_R);
    }
    // Стенка отверстия: дальняя от света сторона освещена, ближняя в тени.
    const lit = sgn > 0 ? Math.PI * 0.08 : Math.PI * 1.08;
    ctx.strokeStyle = 'rgba(255,215,160,0.2)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, POCKET_R - 3, lit, lit + Math.PI * 0.54);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, POCKET_R - 4, lit + Math.PI, lit + Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }
}

// Свет падает сверху слева на экране; при повороте стола направление переворачивается.
function lightSign() {
  return flipped() ? -1 : 1;
}

function drawShadow(b) {
  const sgn = lightSign();
  const off = 2.5 + b.z * 0.55;
  const x = b.x + off * 0.55 * sgn;
  const y = b.y + off * sgn;
  const spread = 3 + b.z * 0.12;
  const g = ctx.createRadialGradient(x, y, b.r * 0.55, x, y, b.r + spread);
  g.addColorStop(0, `rgba(0,0,0,${Math.max(0.16, 0.42 - b.z / 160)})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  circle(x, y, b.r + spread, true);
}

function ring(r0, r1) {
  ctx.beginPath();
  ctx.arc(0, 0, r1, 0, Math.PI * 2);
  ctx.arc(0, 0, r0, 0, Math.PI * 2, true);
}

function drawPuck(b) {
  const lift = (1 + b.z / 120) * (1 - b.sink / 40);
  const sgn = lightSign();
  const striker_ = b.kind === 'striker';
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.scale(lift, lift);

  let base;
  let dark;
  if (striker_) {
    const strikerSkin = typeof tableSkin === 'function' ? tableSkin().striker : null;
    base = strikerSkin?.from || '#e6c48f';
    dark = strikerSkin?.to || '#b8874c';
  } else {
    base = PLAYERS[b.owner].color;
    dark = shade(base, -0.42);
  }
  const lx = -b.r * 0.4 * sgn;
  const ly = -b.r * 0.45 * sgn;

  // Сквозное отверстие видно насквозь — по нему игрок проверяет, видна ли линия.
  // Скошенный край фишки.
  const edge = ctx.createRadialGradient(lx, ly, b.r * 0.2, 0, 0, b.r);
  edge.addColorStop(0, shade(base, 0.3));
  edge.addColorStop(0.75, base);
  edge.addColorStop(1, dark);
  ctx.fillStyle = edge;
  ring(b.hole, b.r);
  ctx.fill();

  // Верхняя площадка чуть светлее со стороны лампы.
  const top = ctx.createLinearGradient(lx, ly, -lx, -ly);
  top.addColorStop(0, shade(base, striker_ ? 0.18 : 0.22));
  top.addColorStop(1, shade(base, -0.12));
  ctx.fillStyle = top;
  ring(b.hole, b.r * 0.8);
  ctx.fill();

  ctx.lineWidth = Math.max(0.7, px1());
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  circle(0, 0, b.r, false);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  circle(0, 0, b.r * 0.8, false);
  if (b.r * 0.5 > b.hole + 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    circle(0, 0, b.r * 0.5, false);
  }
  // Стенка отверстия.
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  circle(0, 0, b.hole, false);
  // Блик на кромке.
  ctx.strokeStyle = striker_ ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, px1() * 1.2);
  ctx.lineCap = 'round';
  const a0 = sgn > 0 ? Math.PI * 1.08 : Math.PI * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, b.r * 0.9, a0, a0 + Math.PI * 0.34);
  ctx.stroke();
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
  const cue = typeof tableSkin === 'function' ? tableSkin().cue : null;
  const nx = -aim.dirY;
  const ny = aim.dirX;
  const sgn = lightSign();
  // Участок кия от d0 до d1 (от наконечника), сужение от 3,2 до 6,5 мм полуширины.
  const part = (d0, d1, fill, ox = 0, oy = 0) => {
    const w0 = 3.2 + 3.3 * d0 / len;
    const w1 = 3.2 + 3.3 * d1 / len;
    const ax = tipX - aim.dirX * d0 + ox;
    const ay = tipY - aim.dirY * d0 + oy;
    const bx = tipX - aim.dirX * d1 + ox;
    const by = tipY - aim.dirY * d1 + oy;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(ax + nx * w0, ay + ny * w0);
    ctx.lineTo(bx + nx * w1, by + ny * w1);
    ctx.lineTo(bx - nx * w1, by - ny * w1);
    ctx.lineTo(ax - nx * w0, ay - ny * w0);
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  part(0, len, 'rgba(0,0,0,0.28)', 4 * sgn, 6 * sgn);
  const g = ctx.createLinearGradient(tipX, tipY, tipX - aim.dirX * len, tipY - aim.dirY * len);
  g.addColorStop(0, cue?.tip || '#f3dfb7');
  g.addColorStop(0.55, cue?.shaft || '#8d5a2b');
  g.addColorStop(1, shade(cue?.shaft || '#8d5a2b', -0.35));
  part(0, len, g);
  // Блик вдоль кия со стороны света.
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.2;
  const hx = (nx * -sgn * (ny > 0 ? 1 : -1)) * 1.6;
  const hy = (ny * -sgn * (ny > 0 ? 1 : -1)) * 1.6;
  line(tipX + hx - aim.dirX * 24, tipY + hy - aim.dirY * 24, tipX + hx - aim.dirX * len, tipY + hy - aim.dirY * len);
  part(5, 22, '#f4efe4');
  part(0, 5, '#3f5f8a');
  ctx.restore();
}

// Шкала силы на боковом борту, в координатах экрана: при повороте стола остаётся на своей стороне.
function drawPowerGauge() {
  if (view.gauge.horiz) {
    drawBottomGauge();
    return;
  }
  const d = view.dpr;
  const { x, y: top, w, h } = view.gauge;
  const fill = h * aim.power;
  // Сенсорную шкалу тянут сверху вниз, узкая на борту заполняется снизу вверх.
  const down = wideGauge();
  const edge = down ? top + fill : top + h - fill;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, w / 2);
  ctx.fill();

  if (fill > 0) {
    const g = down ? ctx.createLinearGradient(0, top, 0, top + h) : ctx.createLinearGradient(0, top + h, 0, top);
    g.addColorStop(0, '#4caf50');
    g.addColorStop(0.6, '#ffc107');
    g.addColorStop(1, '#f44336');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, down ? top : top + h - fill, w, fill, w / 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = Math.max(1, d);
  for (const k of [0.25, 0.5, 0.75]) {
    const y = top + h * (down ? k : 1 - k);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }

  if (aim.power > 0) {
    const text = `${Math.round(aim.power * 100)}%`;
    ctx.font = `700 ${12 * d}px Manrope, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(text).width + 10 * d;
    const th = 18 * d;
    const ty = Math.min(top + h - th / 2, Math.max(top + th / 2, edge));
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
    ctx.font = `${14 * d}px Manrope, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) ctx.fillText('▼', x + w / 2, top + (14 + k * 16) * d);
  }
  ctx.restore();
}

// Шкала под столом на телефоне: палец ведут слева направо.
function drawBottomGauge() {
  const d = view.dpr;
  const { x, y, w, h } = view.gauge;
  const fill = w * aim.power;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#15191c';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();

  if (fill > 0) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#4caf50');
    g.addColorStop(0.6, '#ffc107');
    g.addColorStop(1, '#f44336');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(fill, h), h, h / 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = Math.max(1, d);
  for (const k of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(x + w * k, y);
    ctx.lineTo(x + w * k, y + h);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (aim.power > 0) {
    const text = `${Math.round(aim.power * 100)}%`;
    ctx.font = `700 ${13 * d}px Manrope, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(text).width + 12 * d;
    const th = h - 8 * d;
    const tx = Math.min(x + w - tw / 2 - 4 * d, Math.max(x + tw / 2 + 4 * d, x + fill));
    ctx.fillStyle = 'rgba(20, 24, 27, 0.9)';
    ctx.beginPath();
    ctx.roundRect(tx - tw / 2, y + 4 * d, tw, th, 6 * d);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, tx, y + h / 2 + d);
  } else if (phase === 'place') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = `${13 * d}px Manrope, "Segoe UI", sans-serif`;
    ctx.fillText('Сила удара: ведите пальцем вправо ▶▶', x + w / 2, y + h / 2 + d);
  }
  ctx.restore();
}

const TOAST_COLORS = {
  keep: 'rgba(46, 125, 50, 0.92)',
  pass: 'rgba(49, 44, 38, 0.94)',
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
  ctx.font = `600 ${font}px Manrope, "Segoe UI", sans-serif`;
  const tw = ctx.measureText(toast.text).width;
  if (tw + 36 * d > maxW) {
    font *= (maxW - 24 * d) / tw;
    ctx.font = `600 ${font}px Manrope, "Segoe UI", sans-serif`;
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
  ctx.fillStyle = toast.cls === 'win' ? '#1b1917' : '#fff';
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
  ctx.font = `${24 * view.dpr}px Manrope, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.restore();
}
