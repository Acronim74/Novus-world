'use strict';

// ===== Физика =====
// Случайность физики (подскоки, вылеты) идёт от зерна удара — в сетевой игре оба игрока видят один и тот же удар.
let physState = 1;

function seedPhysics(seed) {
  physState = seed >>> 0 || 1;
}

function physRandom() {
  physState = (physState + 0x6d2b79f5) >>> 0;
  let t = physState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function physicsStep(dt) {
  const live = bodies.filter(b => b.state === 'table');
  for (const b of live) integrate(b, dt);
  // Несколько проходов, чтобы фишка, зажатая бортами или другими фишками, вела себя как жёсткая опора.
  for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        if (live[i].state === 'table' && live[j].state === 'table') collidePucks(live[i], live[j]);
      }
    }
    for (const b of live) if (b.state === 'table') collideRails(b);
  }
  for (const b of live) if (b.state === 'table') checkPockets(b, dt);
  trackStrikerReturn();
}

function decel(b) {
  return (b.kind === 'striker' ? cfg.muStriker : cfg.muPawn) * G;
}

function integrate(b, dt) {
  if (b.z > 0 || b.vz > 0) {
    b.vz -= G * dt;
    b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      b.vz = 0;
      b.climb = null;
    }
  } else {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const k = Math.max(0, sp - decel(b) * dt) / sp;
      b.vx *= k;
      b.vy *= k;
    }
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

function collidePucks(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const R = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  // Фишка в прыжке пролетает над другой, если их высоты почти не пересекаются.
  const vertical = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z);
  if (vertical <= 2) return;

  const d = Math.sqrt(d2) || 1e-4;
  const nx = dx / d;
  const ny = dy / d;
  const fa = freedom(a, -nx, -ny);
  const fb = freedom(b, nx, ny);
  const ia = fa / a.m;
  const ib = fb / b.m;
  if (ia + ib < 1e-9) return;
  const pen = R - d;
  a.x -= nx * pen * ia / (ia + ib);
  a.y -= ny * pen * ia / (ia + ib);
  b.x += nx * pen * ib / (ia + ib);
  b.y += ny * pen * ib / (ia + ib);

  const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vrel <= 0) return;
  const j = (1 + cfg.puckE) * vrel / (ia + ib);
  a.vx -= j * ia * nx;
  a.vy -= j * ia * ny;
  b.vx += j * ib * nx;
  b.vy += j * ib * ny;
  clampToRails(a);
  clampToRails(b);
  springBack(b, a, nx, ny, 1 - fb);
  springBack(a, b, -nx, -ny, 1 - fa);
  // Сжатый у борта ряд выдавливает пешки в поле: удар идёт не строго вдоль борта, а под углом.
  buckleOffRail(a, b, nx, ny, vrel);

  noteContact(a, b, vrel);
  popUp(a, vrel);
  popUp(b, vrel);

  if (vrel > cfg.hopThr) {
    const light = a.m < b.m ? a : b.m < a.m ? b : (physRandom() < 0.5 ? a : b);
    // Прижатая к борту пешка не подскакивает: удар остаётся в плоскости и идёт вдоль ряда.
    const pressed = RAILS.some(r => r.gap(light) <= light.r + 0.5);
    if (!pressed) light.vz += (vrel - cfg.hopThr) * cfg.hopK * (0.5 + physRandom());
  }
}

// Насколько фишка может сдвинуться в направлении (dx, dy): борт не даёт пройти сквозь себя,
// но часть удара под углом остаётся — её борт потом отражает, и ряд расходится веером.
function freedom(b, dx, dy) {
  let blocked = 0;
  if (b.z < RAIL_H) {
    for (const rail of RAILS) {
      if (rail.gap(b) > b.r + 0.5) continue;
      const into = -(dx * rail.nx + dy * rail.ny);
      if (into > 0) blocked += into * into;
    }
  }
  return Math.max(0, 1 - blocked);
}

// Прижатая к борту фишка после удара пружинит от него и выходит следом за ударившей,
// немного медленнее её, чтобы не догнать.
function springBack(body, other, nx, ny, support) {
  if (support <= 0) return;
  const target = (other.vx * nx + other.vy * ny) * 0.8;
  const current = body.vx * nx + body.vy * ny;
  if (target >= current) return;
  const dv = (target - current) * support;
  body.vx += dv * nx;
  body.vy += dv * ny;
}

function buckleOffRail(a, b, nx, ny, vrel) {
  if (vrel < 40) return;
  for (const rail of RAILS) {
    const along = Math.abs(nx * -rail.ny + ny * rail.nx);
    if (along < 0.15) continue;
    const kick = vrel * along * cfg.railBuckle;
    if (rail.gap(a) <= a.r + 1) {
      a.vx += rail.nx * kick;
      a.vy += rail.ny * kick;
    }
    if (rail.gap(b) <= b.r + 1) {
      b.vx += rail.nx * kick;
      b.vy += rail.ny * kick;
    }
  }
}

// Фишка, прижатая к борту, не может двигаться в борт: борт забирает эту часть удара,
// и фишка уходит вдоль борта, толкая соседей по ряду.
function clampToRails(b) {
  if (b.z >= RAIL_H) return;
  for (const rail of RAILS) {
    if (rail.gap(b) > b.r + 0.5) continue;
    const vn = b.vx * rail.nx + b.vy * rail.ny;
    if (vn < 0) {
      b.vx -= vn * rail.nx;
      b.vy -= vn * rail.ny;
    }
  }
}

function collideRails(b) {
  for (const rail of RAILS) {
    const gap = rail.gap(b);
    if (b.climb === rail.side || b.z >= RAIL_H) {
      if (gap < -b.r * 0.5) {
        markOut(b, rail.side);
        return;
      }
      continue;
    }
    if (gap >= b.r) continue;
    // Над лузой борт обрывается: фишка сваливается в отверстие, а не отскакивает от угла.
    if (overPocket(b, b.r * 0.25)) continue;

    const vn = -(b.vx * rail.nx + b.vy * rail.ny);
    if (vn > 80) {
      const excess = vn - cfg.climbThr[b.kind];
      if (excess > 0 && physRandom() < Math.min(cfg.climbMax[b.kind], excess / cfg.climbRange[b.kind])) {
        b.climb = rail.side;
        b.vz = Math.max(b.vz, 700 + physRandom() * 300);
        b.vx *= 0.6;
        b.vy *= 0.6;
        noteRail(b, rail.side);
        continue;
      }
      const tx = -rail.ny;
      const ty = rail.nx;
      const vt = (b.vx * tx + b.vy * ty) * cfg.railTangent;
      const vnOut = vn * cfg.railE;
      b.vx = rail.nx * vnOut + tx * vt;
      b.vy = rail.ny * vnOut + ty * vt;
      popUp(b, vn);
      noteRail(b, rail.side);
    } else if (vn > 0) {
      b.vx += vn * rail.nx;
      b.vy += vn * rail.ny;
    }
    const pen = b.r - gap;
    b.x += rail.nx * pen;
    b.y += rail.ny * pen;
  }
}

// Фишка над отверстием проседает тем быстрее, чем дальше её центр за краем.
// Пока она просела меньше чем на половину толщины, край ещё может вытолкнуть её обратно.
function overPocket(b, extra = 0) {
  return POCKETS.some(pk => Math.hypot(b.x - pk.x, b.y - pk.y) < POCKET_R + extra);
}

function checkPockets(b, dt) {
  let overhang = 0;
  if (b.z === 0) {
    for (const pk of POCKETS) {
      const d = Math.hypot(b.x - pk.x, b.y - pk.y);
      // У борта центр пешки идёт по краю лузы, но диск уже над отверстием.
      // Прибавка только пешке у борта: шайба и свободные фишки — Ø100.
      // Допуск 5 мм, не 0,5: после удара ряд отходит от борта на 1–4 мм, иначе луза снова узкая.
      const alongRail = b.kind === 'pawn' && RAILS.some(r => r.gap(b) <= b.r + 5);
      const reach = POCKET_R + (alongRail ? b.r * 0.45 : 0);
      if (d < reach) overhang = Math.max(overhang, Math.min(1, (reach - d) / b.r));
    }
  }
  if (overhang === 0) {
    b.sink = 0;
    b.sinkV = 0;
    return;
  }
  b.sinkV += G * overhang * dt;
  b.sink += b.sinkV * dt;
  if (b.sink <= 0) {
    b.sink = 0;
    b.sinkV = Math.max(0, b.sinkV);
  }
  if (b.sink >= b.h / 2) {
    Object.assign(b, { state: 'pocketed', vx: 0, vy: 0, sink: 0, sinkV: 0 });
    shot?.events.push({ type: 'pocket', body: b });
  }
}

function popUp(b, impactSpeed) {
  if (b.sink > 0) b.sinkV = Math.min(b.sinkV, -impactSpeed * cfg.popK);
}

function markOut(b, side) {
  Object.assign(b, { state: 'out', outSide: side, vx: 0, vy: 0, z: 0, vz: 0, climb: null });
  shot?.events.push({ type: 'out', body: b, side });
}

function pawnsTouchingStriker() {
  const extra = 0.8;
  return bodies.filter(b => b.kind === 'pawn' && b.state === 'table' &&
    Math.hypot(b.x - striker.x, b.y - striker.y) <= b.r + striker.r + extra);
}

function noteContact(a, b, vrel) {
  if (!shot) return;
  if (a.kind === 'pawn') shot.touched.add(a);
  if (b.kind === 'pawn') shot.touched.add(b);
  const pawn = a === striker ? b : b === striker ? a : null;
  if (pawn && pawn.kind === 'pawn' && !shot.strikerTouched.includes(pawn)) {
    shot.strikerTouched.push(pawn);
  }
  if (vrel < 5) return;
  if (!shot.firstContact && pawn && pawn.kind === 'pawn') {
    shot.firstContact = pawn;
    shot.firstContacts = pawnsTouchingStriker();
  }
}

// п. 12.15, 18.1.5: без своих тёмных шайба на обратном ходу не должна уйти за линию своей зоны.
function trackStrikerReturn() {
  if (!shot || striker.state !== 'table') return;
  const d = depthFromOwnRail(shot.player, striker.y);
  if (d > ZONE) shot.crossedIntoField = true;
  if (shot.darkAtStart.size === 0 && shot.crossedIntoField &&
      d < ZONE - STRIKER_SPEC.hole - LINE_W / 2) {
    shot.returnedPastZone = true;
  }
}

function noteRail(b, side) {
  if (shot && b === striker && !shot.firstContact) shot.railsBeforeFirst.add(side);
}

function allStopped() {
  return bodies.every(b => b.state !== 'table' ||
    (b.vx === 0 && b.vy === 0 && b.z === 0 && b.vz === 0 && b.sink === 0));
}
