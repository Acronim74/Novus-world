'use strict';

// ===== Компьютерный соперник =====
// Компьютер перебирает удары, проигрывает каждый в той же физике, оценивает итог тем же судьёй
// и бьёт выбранный удар с ошибкой прицела и силы, зависящей от уровня.
const AI_PLAYER = 1;
const AI_LEVELS = {
  1: { name: 'Новичок', spots: 1, speeds: [1.6], banks: false, blind: 0.4, pick: 5,
       robustTop: 0, robustRuns: 0, angleSigma: 2.2, powerSigma: 0.18, minThink: 500 },
  2: { name: 'Любитель', spots: 2, speeds: [1.3, 1.9], banks: 'dark', blind: 0, pick: 1,
       robustTop: 4, robustRuns: 2, angleSigma: 0.7, powerSigma: 0.07, minThink: 700 },
  3: { name: 'Мастер', spots: 3, speeds: [1.2, 1.6, 2.3], banks: true, blind: 0, pick: 1,
       robustTop: 6, robustRuns: 4, angleSigma: 0.25, powerSigma: 0.03, minThink: 900 },
};
const POCKET_NAMES = ['левую верхнюю', 'правую верхнюю', 'левую нижнюю', 'правую нижнюю'];

let aiToken = 0;
let aiShowCue = false;
let aiStatus = '';

const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const wait = ms => new Promise(r => setTimeout(r, ms));

function gauss() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function isAI(p) {
  return !net.active && cfg.mode === 'ai' && p === AI_PLAYER;
}

function maybeStartAI() {
  if (phase === 'place' && isAI(current)) runAI();
}

async function runAI() {
  const token = ++aiToken;
  const L = AI_LEVELS[cfg.level];
  phase = 'ai';
  aiShowCue = false;
  aiStatus = 'думает…';
  updatePanel();

  const t0 = performance.now();
  const plan = await planShot(current, L, token);
  if (token !== aiToken) return;
  const rest = L.minThink - (performance.now() - t0);
  if (rest > 0) await wait(rest);
  if (token !== aiToken) return;

  log(`Компьютер (${L.name}): ${plan.label}`, 'info');
  aiStatus = 'целится…';
  updatePanel();
  const angle = Math.atan2(plan.dirY, plan.dirX) + gauss() * L.angleSigma * Math.PI / 180;
  const power = Math.min(1, Math.max(0.03, plan.speed / cfg.vMax * (1 + gauss() * L.powerSigma)));
  await animateAim(plan, angle, power, token);
  if (token !== aiToken) return;

  aiShowCue = false;
  aim.dirX = Math.cos(angle);
  aim.dirY = Math.sin(angle);
  aim.power = power;
  shoot();
}

async function animateAim(plan, angle, power, token) {
  const sx = striker.x;
  const sy = striker.y;
  const a0 = Math.atan2(aim.dirY, aim.dirX);
  const da = ((angle - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const move = 600;
  const pull = 450;
  const start = performance.now();
  aiShowCue = true;
  for (;;) {
    await nextFrame();
    if (token !== aiToken) return;
    const t = performance.now() - start;
    const k = Math.min(1, t / move);
    const e = k * k * (3 - 2 * k);
    striker.x = sx + (plan.x - sx) * e;
    striker.y = sy + (plan.y - sy) * e;
    const a = a0 + da * e;
    aim.dirX = Math.cos(a);
    aim.dirY = Math.sin(a);
    aim.power = t > move ? power * Math.min(1, (t - move) / pull) : 0;
    updatePower();
    if (t >= move + pull + 150) return;
  }
}

async function planShot(p, L, token) {
  const cands = generateCandidates(p, L);
  let sliceStart = performance.now();
  const stillValid = async () => {
    if (performance.now() - sliceStart > 12) {
      await nextFrame();
      sliceStart = performance.now();
    }
    return token === aiToken;
  };

  for (const c of cands) {
    c.score = simulateCandidate(p, c, 0, 0);
    if (!(await stillValid())) return null;
  }
  cands.sort((a, b) => b.score - a.score);

  if (L.robustRuns > 0) {
    // Проверка на устойчивость: тот же удар с ошибкой исполнения, чтобы не выбирать «ювелирные» удары.
    const top = cands.slice(0, L.robustTop);
    for (const c of top) {
      let sum = c.score;
      for (let k = 0; k < L.robustRuns; k++) {
        sum += simulateCandidate(p, c, L.angleSigma, L.powerSigma);
        if (!(await stillValid())) return null;
      }
      c.avg = sum / (L.robustRuns + 1);
    }
    top.sort((a, b) => b.avg - a.avg);
    return top[0];
  }
  return cands[Math.floor(Math.random() * Math.min(L.pick, cands.length))];
}

function simulateCandidate(p, c, angleSigma, powerSigma) {
  const saved = bodies.map(b => ({ ...b }));
  const savedShot = shot;
  striker.x = c.x;
  striker.y = c.y;
  const a = Math.atan2(c.dirY, c.dirX) + gauss() * angleSigma * Math.PI / 180;
  const v = Math.min(cfg.vMax, c.speed * (1 + gauss() * powerSigma));
  shot = makeShotRecord(p);
  striker.vx = Math.cos(a) * v;
  striker.vy = Math.sin(a) * v;
  for (let s = 0; s < 6000 && !allStopped(); s++) physicsStep(DT);
  const score = scoreOutcome(p);
  saved.forEach((s, i) => Object.assign(bodies[i], s));
  shot = savedShot;
  return score;
}

function scoreOutcome(p) {
  const j = judgeShot();
  let s = j.ownIn.length * 100 - j.oppIn.length * 70 - j.pawnsOut.length * 40;
  if (j.foul) s -= 150;
  if (j.keepTurn) s += 40 + positionValue(p);
  else s -= positionValue(1 - p);
  return s;
}

// Насколько удобна позиция игроку: светлые пешки у луз и висящие пешки легко забить.
function positionValue(p) {
  let v = 0;
  for (const b of bodies) {
    if (b.kind !== 'pawn' || b.owner !== p || b.state !== 'table') continue;
    if (isHanging(b)) {
      v += 12;
      continue;
    }
    if (isDark(b)) continue;
    const d = Math.min(...POCKETS.map(pk => Math.hypot(b.x - pk.x, b.y - pk.y)));
    v += 2 + 8 * Math.max(0, 1 - d / 400);
  }
  return v;
}

function contactSpeed(pawnTravel, cos, factor) {
  const vPawn = Math.sqrt(2 * cfg.muPawn * G * pawnTravel) * factor + 100;
  const transfer = (1 + cfg.puckE) * STRIKER_SPEC.mass / (STRIKER_SPEC.mass + PAWN_SPEC.mass) * cos;
  return vPawn / transfer;
}

function launchSpeed(vEnd, dist) {
  return Math.sqrt(vEnd * vEnd + 2 * cfg.muStriker * G * dist);
}

function placementSamples(p) {
  const a = placementArea(p);
  const out = [];
  const depths = [a.d0, (a.d0 + a.d1) / 2, a.d1];
  for (let x = a.x0; x <= a.x1 + 0.01; x += 25) {
    for (const d of depths) {
      const y = yAtDepth(p, d);
      if (!placementProblem(p, x, y)) out.push({ x, y });
    }
  }
  return out;
}

// Лучшие места для шайбы, чтобы бить по точке (gx, gy) в направлении (tx, ty) с наименьшим срезом.
function bestSpots(p, spots, gx, gy, tx, ty, n) {
  const res = [];
  const a = placementArea(p);
  if (Math.abs(ty) > 1e-3) {
    for (const d of [(a.d0 + a.d1) / 2, a.d0, a.d1]) {
      const y = yAtDepth(p, d);
      const t = (gy - y) / ty;
      const x = gx - tx * t;
      if (t > 30 && !placementProblem(p, x, y)) {
        res.push({ x, y });
        break;
      }
    }
  }
  const scored = spots.map(s => {
    const dx = gx - s.x;
    const dy = gy - s.y;
    const l = Math.hypot(dx, dy) || 1;
    return { s, cos: (dx * tx + dy * ty) / l };
  }).sort((u, v) => v.cos - u.cos);
  for (const { s } of scored) {
    if (res.length >= n) break;
    if (res.every(r => Math.abs(r.x - s.x) > 20 || Math.abs(r.y - s.y) > 20)) res.push(s);
  }
  return res.slice(0, n);
}

// Удар от противоположного борта: ищем точку на борту, после отскока от которой
// (с учётом потерь скорости) шайба приходит в (gx, gy).
function bankAim(p, sx, sy, gx, gy) {
  const r = STRIKER_SPEC.r;
  const side = OPPOSITE[PLAYERS[p].rail];
  const yr = side === 'bottom' ? FIELD - r : r;
  const outDir = xb => {
    const dx = xb - sx;
    const dy = yr - sy;
    const l = Math.hypot(dx, dy);
    const ox = dx / l * cfg.railTangent;
    const oy = -dy / l * cfg.railE;
    const ol = Math.hypot(ox, oy);
    return { inX: dx / l, inY: dy / l, len1: l, outX: ox / ol, outY: oy / ol, loss: ol };
  };
  const f = xb => {
    const o = outDir(xb);
    return o.outX * (gy - yr) - o.outY * (gx - xb);
  };
  const N = 120;
  let prevX = r;
  let prev = f(prevX);
  for (let i = 1; i <= N; i++) {
    const x = r + (FIELD - 2 * r) * i / N;
    const v = f(x);
    if (Math.sign(v) !== Math.sign(prev)) {
      let lo = prevX;
      let hi = x;
      let flo = prev;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (Math.sign(fm) === Math.sign(flo)) {
          lo = mid;
          flo = fm;
        } else {
          hi = mid;
        }
      }
      const xb = (lo + hi) / 2;
      const o = outDir(xb);
      const len2 = (gx - xb) * o.outX + (gy - yr) * o.outY;
      if (len2 > 0) return { ...o, side, bx: xb, by: yr, len2 };
    }
    prevX = x;
    prev = v;
  }
  return null;
}

function generateCandidates(p, L) {
  const cands = [];
  const spots = placementSamples(p);
  const own = bodies.filter(b => b.kind === 'pawn' && b.owner === p && b.state === 'table');
  const light = own.filter(b => !isDark(b));
  const R = STRIKER_SPEC.r + PAWN_SPEC.r;
  const r = STRIKER_SPEC.r;
  const step = Math.max(1, Math.ceil(spots.length / 4));
  const bankSpots = spots.filter((_, i) => i % step === 0);

  for (const pawn of own) {
    if (Math.random() < L.blind) continue;
    const dark = isDark(pawn);
    POCKETS.forEach((pk, k) => {
      const ul = Math.hypot(pawn.x - pk.x, pawn.y - pk.y);
      if (ul < 1) return;
      const ux = (pawn.x - pk.x) / ul;
      const uy = (pawn.y - pk.y) / ul;
      const gx = pawn.x + ux * R;
      const gy = pawn.y + uy * R;
      const travel = Math.max(10, ul - POCKET_R * 0.6);
      const target = `${dark ? 'тёмную' : 'светлую'} пешку в ${POCKET_NAMES[k]} лузу`;

      if (!dark) {
        for (const s of bestSpots(p, spots, gx, gy, -ux, -uy, L.spots)) {
          const dx = gx - s.x;
          const dy = gy - s.y;
          const dl = Math.hypot(dx, dy);
          const dirX = dx / dl;
          const dirY = dy / dl;
          const cos = -(dirX * ux + dirY * uy);
          if (cos < 0.3) continue;
          const hit = castRay(s.x, s.y, dirX, dirY, r);
          if (hit.type !== 'body' || hit.body !== pawn) continue;
          for (const f of L.speeds) {
            const v = launchSpeed(contactSpeed(travel, cos, f), dl);
            cands.push({ x: s.x, y: s.y, dirX, dirY, speed: Math.min(cfg.vMax, v), label: `прямой удар, ${target}` });
          }
        }
      }

      if (L.banks === true || (L.banks === 'dark' && dark)) {
        for (const s of bankSpots) {
          const b = bankAim(p, s.x, s.y, gx, gy);
          if (!b) continue;
          const cos = -(b.outX * ux + b.outY * uy);
          if (cos < 0.3) continue;
          const h1 = castRay(s.x, s.y, b.inX, b.inY, r);
          if (h1.type !== 'rail' || h1.side !== b.side) continue;
          const h2 = castRay(b.bx, b.by, b.outX, b.outY, r);
          if (h2.type !== 'body' || h2.body !== pawn) continue;
          for (const f of L.speeds) {
            const vAfter = launchSpeed(contactSpeed(travel, cos, f), b.len2);
            const v = launchSpeed(vAfter / b.loss, b.len1);
            cands.push({ x: s.x, y: s.y, dirX: b.inX, dirY: b.inY, speed: Math.min(cfg.vMax, v),
              label: `от ${RAIL_FROM[b.side]} борта, ${target}` });
          }
        }
      }
    });
  }

  // Запасные удары: хотя бы попасть в свою пешку и не получить штраф.
  for (const pawn of light) {
    const near = [...spots].sort((u, v) => Math.abs(u.x - pawn.x) - Math.abs(v.x - pawn.x)).slice(0, 2);
    for (const s of near) {
      const dx = pawn.x - s.x;
      const dy = pawn.y - s.y;
      const dl = Math.hypot(dx, dy);
      const hit = castRay(s.x, s.y, dx / dl, dy / dl, r);
      if (hit.type !== 'body' || hit.body !== pawn) continue;
      for (const k of [0.25, 0.45]) {
        cands.push({ x: s.x, y: s.y, dirX: dx / dl, dirY: dy / dl, speed: cfg.vMax * k, label: 'безопасный удар по своей пешке' });
      }
    }
  }
  if (light.length === 0) {
    for (const pawn of own) {
      for (const s of bankSpots) {
        const b = bankAim(p, s.x, s.y, pawn.x, pawn.y);
        if (!b) continue;
        cands.push({ x: s.x, y: s.y, dirX: b.inX, dirY: b.inY, speed: cfg.vMax * 0.5,
          label: `от ${RAIL_FROM[b.side]} борта по тёмной пешке` });
      }
    }
  }
  if (!cands.length) {
    const s = spots[Math.floor(spots.length / 2)] || { x: striker.x, y: striker.y };
    cands.push({ x: s.x, y: s.y, dirX: 0, dirY: PLAYERS[p].rail === 'bottom' ? -1 : 1,
      speed: cfg.vMax * 0.4, label: 'удар в противоположный борт' });
  }
  return cands;
}
