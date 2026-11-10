'use strict';

// ===== Судья по правилам ЛФН =====
function firstPawns() {
  if (shot.firstContacts && shot.firstContacts.length) return shot.firstContacts;
  return shot.firstContact ? [shot.firstContact] : [];
}

function startOf(b) {
  return shot.startPos ? shot.startPos.get(b) : null;
}

function pawnDisplaced(b) {
  const start = startOf(b);
  if (!start) return false;
  if (b.state !== 'table') return true;
  return Math.hypot(b.x - start.x, b.y - start.y) > 1;
}

function displacedPawns() {
  if (!shot.startPos) return [];
  return [...shot.startPos.keys()].filter(pawnDisplaced);
}

// п. 11.8: правильный первый контакт.
function isLegalFirst(p) {
  const first = shot.firstContact;
  const rails = shot.railsBeforeFirst;
  const noLight = shot.lightAtStart === 0;
  const oppRail = OPPOSITE[PLAYERS[p].rail];
  if (noLight && !rails.has(oppRail)) {
    const sideToCircle = rails.size > 0 && first && first.owner === p && shot.inCircleAtStart.has(first);
    if (!sideToCircle) return false;
  }
  if (!first) return noLight;
  if (first.owner !== p) {
    if (rails.size === 0) return false;
    return noLight;
  }
  const start = startOf(first);
  if (rails.size === 0 && start && start.inOwnZone) return false;
  if (rails.size === 0 && shot.darkAtStart.has(first)) return false;
  return true;
}

function hangingToUndo() {
  if (!shot?.startPos) return [];
  const list = [];
  for (const [b, start] of shot.startPos) {
    if (start.hanging && b.state === 'pocketed' && !shot.touched.has(b)) list.push(b);
  }
  return list;
}

function leftOwnDark(p) {
  const out = [];
  if (!shot.startPos) return out;
  for (const [b, start] of shot.startPos) {
    if (b.owner !== p) continue;
    if (!start.inOwnZone && !start.inCircle) continue;
    if (b.state !== 'table' || (!inBoardZone(p, b) && !inCircle(b))) out.push(b);
  }
  return out;
}

function findFoul(p, strikerIn, strikerOut) {
  if (strikerIn) return 'шайба упала в лузу (п. 17.1.4)';
  if (strikerOut) return 'шайба вылетела за борт (п. 17.1.5)';

  const first = shot.firstContact;
  const firsts = firstPawns();
  const rails = shot.railsBeforeFirst;
  const noLight = shot.lightAtStart === 0;
  const oppRail = OPPOSITE[PLAYERS[p].rail];
  const hasOwn = firsts.some(b => b.owner === p);
  const hasOpp = firsts.some(b => b.owner !== p);
  const start = first && startOf(first);

  if (rails.size === 0 && start && start.inOwnZone) {
    return 'шайба в начале движения коснулась пешки в своей бортовой зоне (п. 12.10)';
  }
  if (noLight && !rails.has(oppRail)) {
    const sideToCircle = rails.size > 0 && first && first.owner === p && shot.inCircleAtStart.has(first);
    if (!sideToCircle) return 'остались только тёмные пешки, а шайба не коснулась противоположного борта (п. 17.1.6)';
  }
  if (!first) return noLight ? null : 'шайба не коснулась ни одной пешки (п. 11.8)';
  if (rails.size === 0 && hasOwn && hasOpp) {
    return 'прямым ударом одновременно задеты своя пешка и пешка соперника (п. 17.1.2)';
  }
  if (first.owner !== p) {
    if (rails.size === 0) return 'прямым ударом первой задета пешка соперника (п. 17.1.2)';
    if (!noLight) return 'после борта первой задета пешка соперника, хотя есть светлые пешки (п. 17.1.3)';
    return null;
  }
  if (rails.size === 0 && shot.darkAtStart.has(first)) return 'прямой удар по своей тёмной пешке (п. 13.3)';
  if (rails.size === 0 && start && (start.inOwnZone || (first.owner === p && start.inCircle))) {
    return 'прямым ударом сдвинута пешка на своём тёмном поле (п. 17.1.8)';
  }
  return null;
}

function findLoseSet(p) {
  const first = shot.firstContact;
  const rails = shot.railsBeforeFirst;
  const start = first && startOf(first);
  const moved = displacedPawns();
  const fromKitchen = rails.size === 0 && start && (start.inOwnZone || (first.owner === p && start.inCircle && start.dark));
  if (fromKitchen && moved.length >= 2) {
    return 'шайба первой задела пешку на своём тёмном поле и сдвинула две или больше пешек (п. 16.1.4)';
  }
  if (!isLegalFirst(p) && leftOwnDark(p).length >= 2) {
    return 'наказуемым ударом выбиты две или больше своих пешек с тёмного поля (п. 16.1.1)';
  }
  return null;
}

function judgeShot() {
  const p = shot.player;
  const undoHang = hangingToUndo();
  const ev = shot.events;
  const pocketed = ev.filter(e => e.type === 'pocket' && !undoHang.includes(e.body)).map(e => e.body);
  const outs = ev.filter(e => e.type === 'out').map(e => e.body);
  const ownIn = pocketed.filter(b => b.kind === 'pawn' && b.owner === p);
  const oppIn = pocketed.filter(b => b.kind === 'pawn' && b.owner === 1 - p);
  const strikerIn = pocketed.includes(striker);
  const strikerOut = outs.includes(striker);
  const pawnsOut = outs.filter(b => b !== striker);
  const loseSet = findLoseSet(p);
  const foul = loseSet ? null : findFoul(p, strikerIn, strikerOut);
  const zoneReturn = cfg.zoneReturn && !foul && !loseSet && shot.returnedPastZone && shot.darkAtStart.size === 0;
  const keepTurn = !foul && !loseSet && !zoneReturn && ownIn.length > 0 && oppIn.length === 0 && pawnsOut.length === 0;
  return { p, ownIn, oppIn, strikerIn, strikerOut, outs, pawnsOut, foul, keepTurn, loseSet, zoneReturn, undoHang };
}

function restoreBodyToStart(b) {
  const start = startOf(b);
  if (!start) return;
  resetBody(b, start.x, start.y);
}

// п. 13.6, 13.8, 17.1.8, 17.1.13: после наказуемого удара часть пешек возвращают.
function restoreAfterFoul(p, foul, loseSet) {
  if (!shot?.startPos || (!foul && !loseSet)) return [];
  // Штраф после правильного удара (шайба в лузе) не откатывает сдвинутые пешки (п. 13.8, 16.1.1).
  if (isLegalFirst(p) && !loseSet) return [];
  const restored = [];
  const moved = displacedPawns();
  const first = shot.firstContact;
  const startFirst = first && startOf(first);
  const kitchenSingle = shot.railsBeforeFirst.size === 0 && startFirst &&
    (startFirst.inOwnZone || (first.owner === p && startFirst.inCircle)) && moved.length === 1;

  for (const [b, start] of shot.startPos) {
    let back = false;
    if (b.owner !== p && b.state === 'out') back = true;
    else if (b.owner !== p && b.state === 'table' && !start.dark && isDark(b)) back = true;
    else if (b.owner === p && start.dark && b.state === 'table' && pawnDisplaced(b)) back = true;
    else if (kitchenSingle && moved[0] === b) back = true;
    if (!back) continue;
    restoreBodyToStart(b);
    restored.push(b);
  }
  return restored;
}

function sortOutPawns(pawns) {
  const order = shot?.strikerTouched || [];
  return [...pawns].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 1000 : ia) - (ib < 0 ? 1000 : ib);
  });
}

function onlyDarkLeft() {
  for (let p = 0; p < 2; p++) {
    const on = bodies.filter(b => b.kind === 'pawn' && b.owner === p && b.state === 'table');
    if (!on.length || on.some(b => !isDark(b))) return false;
  }
  return true;
}

function noteDarkMiss(p, hitOwn) {
  if (!onlyDarkLeft()) {
    darkMisses = [0, 0];
    return false;
  }
  if (!hitOwn) darkMisses[p]++;
  return darkMisses[0] >= 3 && darkMisses[1] >= 3;
}

function endShot() {
  const { p, ownIn, oppIn, strikerIn, strikerOut, outs, pawnsOut, foul, keepTurn, loseSet, zoneReturn, undoHang } = judgeShot();
  const opp = 1 - p;
  const items = [];
  const st = stats[p];

  for (const b of undoHang) {
    restoreBodyToStart(b);
    log(`${capitalize(pawnName(b))} висела и упала без касания — положение восстановлено (п. 12.19.2)`, 'info');
    items.push({ cls: 'warn', icon: '◐', text: `${capitalize(pawnName(b))} висела и упала сама — возвращена (п. 12.19.2)` });
  }

  const first = describeFirstContact();
  log(first, 'info');
  items.push({ cls: 'info', icon: '•', text: first });
  if (ownIn.length) {
    log(`Забито своих: ${ownIn.length}`, 'ok');
    items.push({ cls: 'ok', icon: '✓', text: `Забита своя пешка${ownIn.length > 1 ? ` ×${ownIn.length}` : ''}` });
  }
  if (oppIn.length) {
    log(`Забито пешек соперника: ${oppIn.length}`, 'foul');
    items.push({ cls: 'bad', icon: '✗', text: `Забита пешка соперника${oppIn.length > 1 ? ` ×${oppIn.length}` : ''}` });
    st.oppIn += oppIn.length;
  }
  if (strikerIn) {
    log('Шайба упала в лузу', 'foul');
    items.push({ cls: 'bad', icon: '●', text: 'Шайба упала в лузу' });
    st.strikerLost++;
  }
  for (const b of outs) {
    log(`${b === striker ? 'Шайба' : pawnName(b)} вылетела через ${RAIL_NAMES[b.outSide]} борт`, 'foul');
    if (b === striker) {
      items.push({ cls: 'bad', icon: '↗', text: `Шайба вылетела через ${RAIL_NAMES[b.outSide]} борт` });
      st.strikerLost++;
    } else {
      items.push({ cls: 'warn', icon: '↗', text: `${capitalize(pawnName(b))} вылетела через ${RAIL_NAMES[b.outSide]} борт` });
      st.pawnsOut++;
    }
  }
  const hanging = bodies.filter(b => b.kind === 'pawn' && isHanging(b));
  if (hanging.length) {
    log(`Висит над лузой: ${hanging.map(pawnName).join(', ')}`, 'info');
    for (const b of hanging) items.push({ cls: 'warn', icon: '◐', text: `${capitalize(pawnName(b))} висит над лузой` });
  }
  if (!ownIn.length && !oppIn.length && !strikerIn && !outs.length && !undoHang.length) {
    items.push({ cls: 'info', icon: '–', text: 'Ничего не забито' });
  }

  const restored = restoreAfterFoul(p, foul, loseSet);
  for (const b of restored) {
    log(`${capitalize(pawnName(b))} возвращена на место до удара`, 'info');
    items.push({ cls: 'warn', icon: '↩', text: `${capitalize(pawnName(b))} возвращена (п. 13.6, 13.8, 17.1.8, 17.1.13)` });
  }

  const stillOut = pawnsOut.filter(b => b.state === 'out');
  for (const b of sortOutPawns(stillOut)) placeOutPawn(b);

  if (foul) {
    log(`Нарушение: ${foul}. Штрафная пешка.`, 'foul');
    const debtBefore = debt[p];
    placePenaltyPawn(p);
    const toDebt = debt[p] > debtBefore;
    items.push({ cls: 'bad', icon: '!', text: `Нарушение: ${foul}. ${toDebt ? 'Штрафная пешка в долг' : 'Штрафная пешка выставлена'}` });
    st.fouls++;
    st.history.unshift(foul);
  }
  if (zoneReturn) {
    log('Шайба обратным ходом ушла за линию своей зоны — ход переходит (п. 18.1.5).', 'info');
    items.push({ cls: 'warn', icon: '↩', text: 'Шайба вернулась за линию своей зоны (п. 18.1.5)' });
  }
  if (!keepTurn && debt[p] > 0) payDebt(p);
  if (keepTurn && pawnsOnTable(p) === 0 && debt[p] > 0) payDebt(p);
  if (!keepTurn) lostTurn[p] = true;

  const hitOwn = shot.firstContact && shot.firstContact.owner === p;
  const darkStalemate = noteDarkMiss(p, hitOwn);

  const left = [pawnsOnTable(0) + debt[0], pawnsOnTable(1) + debt[1]];
  let winner;
  if (loseSet) {
    winner = opp;
    winnerText = `${PLAYERS[opp].name} выиграли сет: ${loseSet}`;
  } else if (darkStalemate) {
    winner = null;
    winnerText = 'Только тёмные пешки и по три промаха — сет переигрывается (п. 20.6)';
  } else if (left[0] === 0 && left[1] === 0) {
    if (foul) {
      winner = opp;
      winnerText = `${PLAYERS[opp].name} выиграли сет: последние пешки забиты с нарушением (п. 20.4, 20.5)`;
    } else if (!lostTurn[p] && p !== firstShooter) {
      winner = null;
      winnerText = 'Оба первой серией забили все пешки — сет переигрывается (п. 20.4)';
    } else {
      winner = null;
      winnerText = 'Обе стороны забили все пешки — сет переигрывается (п. 20.5)';
    }
  } else if (left[p] === 0 && keepTurn && !lostTurn[p] && p === firstShooter) {
    if (typeof finishTraceShot === 'function') finishTraceShot({ ownIn, foul, keepTurn }, { note: 'п. 20.4: ход сопернику' });
    shot = null;
    log('Первая серия на все 8 пешек. Серия прерывается, ход переходит сопернику (п. 20.4).', 'info');
    setLastShot(p, items, { cls: 'pass', text: 'Все 8 забиты. Ход сопернику (п. 20.4)' });
    current = opp;
    startTurn();
    return;
  } else if (left[0] === 0 || left[1] === 0) {
    const leader = left[0] === 0 ? 0 : 1;
    const other = 1 - leader;
    // п. 20.4: пустой стол первого бьющего — не победа, пока соперник продолжает свою первую серию.
    const waitingReply = leader === firstShooter && !lostTurn[firstShooter] && p === other && keepTurn && left[other] > 0;
    if (!waitingReply) {
      winner = leader;
      const unanswered = winner === firstShooter && !lostTurn[firstShooter];
      winnerText = unanswered
        ? `${PLAYERS[winner].name} выиграли сет: соперник не ответил первой серией (п. 20.4)`
        : `${PLAYERS[winner].name} выиграли сет!`;
    }
  }

  if (typeof finishTraceShot === 'function') {
    finishTraceShot({ ownIn, foul, keepTurn }, winnerText ? { note: winnerText } : null);
  }
  shot = null;
  if (winnerText) {
    if (typeof endTraceGame === 'function') endTraceGame(winner, winnerText);
    phase = 'over';
    setWinner = winner;
    if (net.active && current === net.seat) addMatchPoint(winner);
    if (net.active && (winner === 0 || winner === 1)) winnerText += ` Счёт ${matchLabel()}`;
    recordGame(winner, left.map(n => 8 - n));
    log(winnerText, 'ok');
    setLastShot(p, items, { cls: loseSet ? 'foul' : 'win', text: winnerText });
    updatePanel();
    return;
  }

  if (keepTurn) {
    log('Своя пешка забита без нарушений — серия продолжается.', 'ok');
    setLastShot(p, items, { cls: 'keep', text: 'Забита! Серия продолжается' });
  } else {
    const why = foul ? 'нарушение'
      : zoneReturn ? 'шайба вернулась за линию своей зоны'
      : ownIn.length === 0 ? 'не забито ни одной своей пешки'
      : oppIn.length > 0 ? 'вместе со своей забита пешка соперника'
      : 'пешка вылетела за борт';
    log(`Ход переходит к сопернику: ${why}.`, 'info');
    setLastShot(p, items, foul
      ? { cls: 'foul', text: 'Штраф. Ход переходит к сопернику' }
      : { cls: 'pass', text: `Ход переходит: ${why}` });
    current = opp;
  }
  startTurn();
}

// п. 17.1.15: удар не выполнен вовремя — штрафная пешка, ход переходит.
function timeoutShot() {
  const p = current;
  if (!isAI(p) && !net.active) snapshot = takeSnapshot();
  drag = null;
  aim.charging = false;
  aim.power = 0;
  log(`${PLAYERS[p].name}: время на удар (${cfg.shotTime} с) истекло. Штрафная пешка.`, 'foul');
  const debtBefore = debt[p];
  placePenaltyPawn(p);
  const toDebt = debt[p] > debtBefore;
  stats[p].fouls++;
  stats[p].history.unshift('время на удар истекло (п. 17.1.15)');
  if (debt[p] > 0) payDebt(p);
  lostTurn[p] = true;
  if (typeof finishTraceShot === 'function' && matchTrace?.game) {
    matchTrace.game.shots.push({
      n: matchTrace.game.shots.length + 1,
      player: p,
      ai: typeof isAI === 'function' && isAI(p),
      power: 0,
      v0: 0,
      vmax: 0,
      gain: 0,
      spikes: [],
      from: [Math.round(striker.x), Math.round(striker.y)],
      note: 'время на удар истекло (п. 17.1.15)',
      keep: false,
      left: [pawnsOnTable(0) + debt[0], pawnsOnTable(1) + debt[1]],
    });
  }
  const rematch = noteDarkMiss(p, false);
  const left = [pawnsOnTable(0) + debt[0], pawnsOnTable(1) + debt[1]];
  if (rematch || left[0] === 0 || left[1] === 0) {
    const winner = rematch ? null : (left[0] === 0 ? 0 : 1);
    winnerText = rematch
      ? 'Только тёмные пешки и по три промаха — сет переигрывается (п. 20.6)'
      : (winner === firstShooter && !lostTurn[firstShooter]
        ? `${PLAYERS[winner].name} выиграли сет: соперник не ответил первой серией (п. 20.4)`
        : `${PLAYERS[winner].name} выиграли сет!`);
    phase = 'over';
    setWinner = winner;
    if (typeof endTraceGame === 'function') endTraceGame(winner, winnerText);
    recordGame(winner, left.map(n => 8 - n));
    setLastShot(p, [{ cls: 'bad', icon: '⏱', text: `Время на удар (${cfg.shotTime} с) истекло. ${toDebt ? 'Штрафная пешка в долг' : 'Штрафная пешка выставлена'}` }],
      { cls: 'win', text: winnerText });
    updatePanel();
    return;
  }
  setLastShot(p, [{ cls: 'bad', icon: '⏱', text: `Время на удар (${cfg.shotTime} с) истекло. ${toDebt ? 'Штрафная пешка в долг' : 'Штрафная пешка выставлена'}` }],
    { cls: 'foul', text: 'Время вышло. Штраф, ход переходит' });
  current = 1 - p;
  startTurn();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function setLastShot(p, items, verdict) {
  lastShot = { p, items, verdict };
  toast = { text: verdict.text, cls: verdict.cls, until: performance.now() + 2600 };
  renderSidePanels();
}

function describeFirstContact() {
  const f = shot.firstContact;
  const firsts = firstPawns();
  const rails = [...shot.railsBeforeFirst].map(s => RAIL_NAMES[s]).join(', ');
  const how = rails ? `после борта (${rails})` : 'прямым ударом';
  if (!f) return rails ? `Шайба коснулась бортов (${rails}), но не задела ни одной пешки` : 'Шайба не задела ни одной пешки';
  const label = b => {
    if (b.owner !== shot.player) return 'пешка соперника';
    return shot.darkAtStart.has(b) ? 'своя тёмная пешка' : 'своя светлая пешка';
  };
  if (firsts.length > 1) return `Первое касание ${how}: сразу ${firsts.map(label).join(' и ')}`;
  return `Первое касание ${how}: ${label(f)}`;
}

function pawnName(b) {
  return `${b.owner === 0 ? 'красная' : 'чёрная'} пешка`;
}

function pawnsOnTable(p) {
  return bodies.filter(b => b.kind === 'pawn' && b.owner === p && b.state === 'table').length;
}

function resetBody(b, x, y) {
  Object.assign(b, { state: 'table', x, y, vx: 0, vy: 0, z: 0, vz: 0, sink: 0, sinkV: 0, climb: null, outSide: null });
}

// п. 12.20: центр круга, затем точки диаметров у края круга, начиная со стороны вылета.
function placeOutPawn(b) {
  const c = FIELD / 2;
  const order = ['top', 'right', 'bottom', 'left'];
  const dirs = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
  const start = Math.max(0, order.indexOf(b.outSide));
  const sides = order.map((_, k) => dirs[order[(start + k) % 4]]);
  const edge = CIRCLE_R - b.r;
  const candidates = [[c, c]];
  for (const [dx, dy] of sides) candidates.push([c + dx * edge, c + dy * edge]);
  for (let t = edge - 1; t > 0; t -= 1) {
    for (const [dx, dy] of sides) candidates.push([c + dx * t, c + dy * t]);
  }
  for (const [x, y] of candidates) {
    if (isFree(x, y, b.r)) {
      resetBody(b, x, y);
      log(`${pawnName(b)} выставлена в центральный круг (п. 12.20)`, 'info');
      return;
    }
  }
  for (let rad = 0; rad < FIELD; rad += 2) {
    for (let a = 0; a < 360; a += 10) {
      const x = c + rad * Math.cos(a * Math.PI / 180);
      const y = c + rad * Math.sin(a * Math.PI / 180);
      if (isFree(x, y, b.r)) {
        resetBody(b, x, y);
        return;
      }
    }
  }
}

// п. 17.3: на середину бортовой зоны, где стоят пешки игрока, вплотную к борту.
function findPenaltySpot(p) {
  const y = PLAYERS[p].rail === 'bottom' ? PAWN_SPEC.r : FIELD - PAWN_SPEC.r;
  const c = FIELD / 2;
  for (let d = 0; d <= c; d += 0.5) {
    const l = isFree(c - d, y, PAWN_SPEC.r);
    const r = isFree(c + d, y, PAWN_SPEC.r);
    if (d === 0 && l) return { x: c, y };
    if (l && r) {
      const own = side => bodies.filter(b => b.kind === 'pawn' && b.owner === p && b.state === 'table' && (side < 0 ? b.x < c : b.x > c)).length;
      const all = side => bodies.filter(b => b.kind === 'pawn' && b.state === 'table' && (side < 0 ? b.x < c : b.x > c)).length;
      let side;
      if (own(-1) !== own(1)) side = own(-1) < own(1) ? -1 : 1;
      else if (all(-1) !== all(1)) side = all(-1) < all(1) ? -1 : 1;
      else side = shot && shot.startX < c ? -1 : 1;
      return { x: c + side * d, y };
    }
    if (l) return { x: c - d, y };
    if (r) return { x: c + d, y };
  }
  return null;
}

function placePenaltyPawn(p) {
  const pawn = bodies.find(b => b.kind === 'pawn' && b.owner === p && b.state === 'pocketed');
  const spot = pawn && findPenaltySpot(p);
  if (!spot) {
    debt[p]++;
    log('Все пешки на столе — штрафная пешка записана в долг (п. 17.4).', 'info');
    return;
  }
  resetBody(pawn, spot.x, spot.y);
}

function payDebt(p) {
  while (debt[p] > 0) {
    const pawn = bodies.find(b => b.kind === 'pawn' && b.owner === p && b.state === 'pocketed');
    const spot = pawn && findPenaltySpot(p);
    if (!spot) return;
    resetBody(pawn, spot.x, spot.y);
    debt[p]--;
    log('Выставлена долговая пешка (п. 17.5).', 'info');
  }
}
