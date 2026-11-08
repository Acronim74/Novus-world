'use strict';

// ===== Состояние игры =====
let bodies = [];
let striker = null;
let current = 0;
let debt = [0, 0];
let phase = 'place';
let shot = null;
let snapshot = null;
let winnerText = null;
let stats = [newStats(), newStats()];
let lastShot = null;
let toast = null;
let gameId = 0;
let gameStartedAt = 0;
let turnDeadline = 0;
let firstShooter = 0;
let lostTurn = [false, false];
let setWinner = undefined;

function newStats() {
  return { fouls: 0, strikerLost: 0, pawnsOut: 0, oppIn: 0, history: [] };
}

const aim = { dirX: 0, dirY: -1, power: 0, charging: false, startX: 0, startY: 0 };
let drag = null;

function makeBody(kind, owner, id, x, y) {
  const s = kind === 'striker' ? STRIKER_SPEC : PAWN_SPEC;
  return {
    kind, owner, id, x, y,
    vx: 0, vy: 0, z: 0, vz: 0,
    r: s.r, h: s.h, hole: s.hole, m: s.mass,
    state: 'table', sink: 0, sinkV: 0, climb: null, outSide: null,
  };
}

function newGame() {
  aiToken++;
  bodies = [];
  for (let p = 0; p < 2; p++) {
    // Свои пешки стоят у борта напротив игрока, по 4 с каждой стороны средней линии.
    const y = PLAYERS[p].rail === 'bottom' ? PAWN_SPEC.r : FIELD - PAWN_SPEC.r;
    for (let i = 0; i < 8; i++) {
      bodies.push(makeBody('pawn', p, i + 1, FIELD / 2 + (i - 3.5) * 2 * PAWN_SPEC.r, y));
    }
  }
  striker = makeBody('striker', 0, 0, 0, 0);
  bodies.push(striker);
  current = 0;
  debt = [0, 0];
  winnerText = null;
  firstShooter = 0;
  lostTurn = [false, false];
  setWinner = undefined;
  snapshot = null;
  stats = [newStats(), newStats()];
  lastShot = null;
  toast = null;
  gameId = Date.now();
  gameStartedAt = gameId;
  clearLog();
  log('Новая партия. Первыми бьют красные (снизу).', 'info');
  startTurn();
}

function startTurn() {
  phase = net.active && current !== net.seat ? 'remote' : 'place';
  Object.assign(striker, { state: 'table', vx: 0, vy: 0, z: 0, vz: 0, sink: 0, sinkV: 0, climb: null, owner: current });
  const spot = findStrikerSpot(current);
  striker.x = spot.x;
  striker.y = spot.y;
  aim.dirX = 0;
  aim.dirY = PLAYERS[current].rail === 'bottom' ? -1 : 1;
  aim.power = 0;
  aim.charging = false;
  resetTurnTimer();
  updatePanel();
  maybeStartAI();
}

// Компьютер бьёт без ограничения; в сетевой игре время на чужой удар только показывается.
function resetTurnTimer() {
  turnDeadline = cfg.shotTime && !isAI(current) ? performance.now() + cfg.shotTime * 1000 : 0;
}
