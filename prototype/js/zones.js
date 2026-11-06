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

function findStrikerSpot(p) {
  const a = placementArea(p);
  for (let off = 0; off <= FIELD / 2; off += 5) {
    for (const sx of off === 0 ? [1] : [1, -1]) {
      const x = FIELD / 2 + sx * off;
      if (x < a.x0 || x > a.x1) continue;
      for (let d = a.d0; d <= a.d1; d += 1) {
        const y = yAtDepth(p, d);
        if (!placementProblem(p, x, y)) return { x, y };
      }
    }
  }
  return { x: FIELD / 2, y: yAtDepth(p, a.d0) };
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
