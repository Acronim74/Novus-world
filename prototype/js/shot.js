'use strict';

// ===== Удар =====
function makeShotRecord(p) {
  const own = bodies.filter(b => b.kind === 'pawn' && b.owner === p && b.state === 'table');
  const startPos = new Map();
  for (const b of bodies) {
    if (b.kind !== 'pawn' || b.state !== 'table') continue;
    startPos.set(b, {
      x: b.x,
      y: b.y,
      dark: isDark(b),
      inOwnZone: inBoardZone(p, b),
      inCircle: inCircle(b),
      hanging: isHanging(b),
    });
  }
  return {
    player: p,
    startX: striker.x,
    events: [],
    firstContact: null,
    firstContacts: [],
    railsBeforeFirst: new Set(),
    lightAtStart: own.filter(b => !isDark(b)).length,
    darkAtStart: new Set(own.filter(isDark)),
    inCircleAtStart: new Set(own.filter(b => inCircle(b))),
    startPos,
    touched: new Set(),
    strikerTouched: [],
    crossedIntoField: false,
  };
}

function shoot(seed = (Math.random() * 4294967296) >>> 0) {
  // Против компьютера откат возвращает к последнему удару человека; по сети отката нет.
  if (!isAI(current) && !net.active) snapshot = takeSnapshot();
  seedPhysics(seed);
  const speed = cfg.vMax * aim.power;
  striker.vx = aim.dirX * speed;
  striker.vy = aim.dirY * speed;
  shot = makeShotRecord(current);
  if (typeof beginTraceShot === 'function') beginTraceShot(seed);
  phase = 'moving';
  aim.charging = false;
  log(`${PLAYERS[current].name}${isAI(current) ? ' (компьютер)' : ''}: удар, сила ${Math.round(aim.power * 100)}% · зерно ${seed >>> 0}`, 'shot');
  netShotStarted(seed);
  updatePanel();
}

function takeSnapshot() {
  return {
    bodies: bodies.map(b => ({ ...b })),
    current,
    debt: [...debt],
    stats: stats.map(s => ({ ...s, history: [...s.history] })),
    lastShot,
    firstShooter,
    lostTurn: [...lostTurn],
    darkMisses: [...darkMisses],
  };
}

function restoreSnapshot() {
  if (!snapshot || phase === 'moving') return;
  if (typeof roomUndoBlocked === 'function' && roomUndoBlocked()) return;
  if (phase === 'over') forgetGame(gameId);
  aiToken++;
  snapshot.bodies.forEach((s, i) => Object.assign(bodies[i], s));
  current = snapshot.current;
  debt = [...snapshot.debt];
  stats = snapshot.stats.map(s => ({ ...s, history: [...s.history] }));
  lastShot = snapshot.lastShot;
  firstShooter = snapshot.firstShooter;
  lostTurn = [...snapshot.lostTurn];
  darkMisses = [...(snapshot.darkMisses || [0, 0])];
  toast = null;
  winnerText = null;
  setWinner = undefined;
  phase = 'place';
  aim.power = 0;
  aiShowCue = false;
  resetTurnTimer();
  log('Позиция возвращена к моменту перед ударом.', 'info');
  updatePanel();
  maybeStartAI();
}
