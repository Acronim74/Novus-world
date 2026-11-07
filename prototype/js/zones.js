'use strict';

// ===== Зоны и линии =====
function depthFromOwnRail(p, y) {
  return PLAYERS[p].rail === 'bottom' ? FIELD - y : y;
}

function yAtDepth(p, d) {
  return PLAYERS[p].rail === 'bottom' ? FIELD - d : d;
}

function isDark(b) {
  if (b.kind !== 'pawn' || b.state !== 'table') return false;
  const margin = b.hole + LINE_W / 2;
  if (depthFromOwnRail(b.owner, b.y) < ZONE - margin) return true;
  return cfg.circleDark && Math.hypot(b.x - FIELD / 2, b.y - FIELD / 2) < CIRCLE_R - margin;
}

function isHanging(b) {
  if (b.state !== 'table' || b.z > 0) return false;
  return POCKETS.some(pk => {
    const d = Math.hypot(b.x - pk.x, b.y - pk.y);
    return d >= POCKET_R && d < POCKET_R + b.r - 1;
  });
}

function placementArea(p) {
  const r = STRIKER_SPEC.r;
  const m = STRIKER_SPEC.hole + LINE_W / 2;
  if (cfg.freePlace) return { x0: r, x1: FIELD - r, d0: r, d1: FIELD / 2 };
  // п. 12.9: в отверстии шайбы не должны быть видны боковые линии и линия бортовой зоны.
  return { x0: ZONE + m, x1: FIELD - ZONE - m, d0: r, d1: ZONE - m };
}

function placementProblem(p, x, y) {
  const a = placementArea(p);
  const d = depthFromOwnRail(p, y);
  if (x < a.x0 || x > a.x1 || d < a.d0 || d > a.d1) return 'вне зоны';
  for (const pk of POCKETS) {
    if (Math.hypot(x - pk.x, y - pk.y) < POCKET_R + STRIKER_SPEC.r) return 'над лузой';
  }
  for (const b of bodies) {
    if (b === striker || b.state !== 'table') continue;
    if (Math.hypot(x - b.x, y - b.y) < b.r + STRIKER_SPEC.r) return 'касается пешки';
  }
  return null;
}

// Шайба встаёт на пересечение средней линии с линией бортовой зоны — так, чтобы линия не была видна
// в отверстии (п. 12.9). Если место занято, берётся ближайшая свободная точка зоны.
function findStrikerSpot(p) {
  const a = placementArea(p);
  const tx = FIELD / 2;
  const td = Math.min(a.d1, ZONE - STRIKER_SPEC.hole - LINE_W / 2);
  if (!placementProblem(p, tx, yAtDepth(p, td))) return { x: tx, y: yAtDepth(p, td) };
  let best = null;
  let bestDist = Infinity;
  for (let x = a.x0; x <= a.x1; x += 2) {
    for (let d = a.d0; d <= a.d1; d += 2) {
      const dist = Math.hypot(x - tx, d - td);
      if (dist >= bestDist || placementProblem(p, x, yAtDepth(p, d))) continue;
      best = { x, y: yAtDepth(p, d) };
      bestDist = dist;
    }
  }
  return best || { x: tx, y: yAtDepth(p, a.d0) };
}

function moveStriker(x, y) {
  const tries = [[x, y], [x, striker.y], [striker.x, y]];
  for (const [tx, ty] of tries) {
    if (!placementProblem(current, tx, ty)) {
      striker.x = tx;
      striker.y = ty;
      return;
    }
  }
}

function isFree(x, y, r) {
  if (x < r || x > FIELD - r || y < r || y > FIELD - r) return false;
  for (const pk of POCKETS) if (Math.hypot(x - pk.x, y - pk.y) < POCKET_R + r) return false;
  for (const b of bodies) {
    if (b === striker || b.state !== 'table') continue;
    if (Math.hypot(x - b.x, y - b.y) < b.r + r) return false;
  }
  return true;
}
