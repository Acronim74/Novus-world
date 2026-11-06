'use strict';

// ===== Упрощённый судья =====
function findFoul(p, strikerIn, strikerOut) {
  if (strikerIn) return 'шайба упала в лузу (п. 17.1.4)';
  if (strikerOut) return 'шайба вылетела за борт (п. 17.1.5)';

  const first = shot.firstContact;
  const rails = shot.railsBeforeFirst;
  const noLight = shot.lightAtStart === 0;
  const oppRail = OPPOSITE[PLAYERS[p].rail];

  if (noLight && !rails.has(oppRail)) {
    const sideToCircle = rails.size > 0 && first && first.owner === p && shot.inCircleAtStart.has(first);
    if (!sideToCircle) return 'остались только тёмные пешки, а шайба не коснулась противоположного борта (п. 17.1.6)';
  }
  if (!first) return noLight ? null : 'шайба не коснулась ни одной пешки (п. 11.8)';
  if (first.owner !== p) {
    if (rails.size === 0) return 'прямым ударом первой задета пешка соперника (п. 17.1.2)';
    if (!noLight) return 'после борта первой задета пешка соперника, хотя есть светлые пешки (п. 17.1.3)';
    return null;
  }
  if (rails.size === 0 && shot.darkAtStart.has(first)) return 'прямой удар по своей тёмной пешке (п. 13.3)';
  return null;
}

function judgeShot() {
  const p = shot.player;
  const ev = shot.events;
  const pocketed = ev.filter(e => e.type === 'pocket').map(e => e.body);
  const outs = ev.filter(e => e.type === 'out').map(e => e.body);
  const ownIn = pocketed.filter(b => b.kind === 'pawn' && b.owner === p);
  const oppIn = pocketed.filter(b => b.kind === 'pawn' && b.owner === 1 - p);
  const strikerIn = pocketed.includes(striker);
  const strikerOut = outs.includes(striker);
  const pawnsOut = outs.filter(b => b !== striker);
  const foul = findFoul(p, strikerIn, strikerOut);
  const keepTurn = !foul && ownIn.length > 0 && oppIn.length === 0 && pawnsOut.length === 0;
  return { p, ownIn, oppIn, strikerIn, strikerOut, outs, pawnsOut, foul, keepTurn };
}

function endShot() {
  const { p, ownIn, oppIn, strikerIn, strikerOut, outs, pawnsOut, foul, keepTurn } = judgeShot();
  const opp = 1 - p;
  const items = [];
  const st = stats[p];

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
      items.push({ cls: 'warn', icon: '↗', text: `${capitalize(pawnName(b))} вылетела через ${RAIL_NAMES[b.outSide]} борт — ставится в центральный круг` });
      st.pawnsOut++;
    }
  }
  const hanging = bodies.filter(b => b.kind === 'pawn' && isHanging(b));
  if (hanging.length) {
    log(`Висит над лузой: ${hanging.map(pawnName).join(', ')}`, 'info');
    for (const b of hanging) items.push({ cls: 'warn', icon: '◐', text: `${capitalize(pawnName(b))} висит над лузой` });
  }
  if (!ownIn.length && !oppIn.length && !strikerIn && !outs.length) {
    items.push({ cls: 'info', icon: '–', text: 'Ничего не забито' });
  }

  for (const b of pawnsOut) placeOutPawn(b);

  if (foul) {
    log(`Нарушение: ${foul}. Штрафная пешка.`, 'foul');
    const debtBefore = debt[p];
    placePenaltyPawn(p);
    const toDebt = debt[p] > debtBefore;
    items.push({ cls: 'bad', icon: '!', text: `Нарушение: ${foul}. ${toDebt ? 'Штрафная пешка в долг' : 'Штрафная пешка выставлена'}` });
    st.fouls++;
    st.history.unshift(foul);
  }
  if (!keepTurn && debt[p] > 0) payDebt(p);
  if (keepTurn && pawnsOnTable(p) === 0 && debt[p] > 0) payDebt(p);

  const left = [pawnsOnTable(0) + debt[0], pawnsOnTable(1) + debt[1]];
  let winner;
  if (left[0] === 0 && left[1] === 0) {
    winner = null;
    winnerText = 'Обе стороны забили все пешки — сет переигрывается (п. 20.5)';
  } else if (left[0] === 0 || left[1] === 0) {
    winner = left[0] === 0 ? 0 : 1;
    winnerText = `${PLAYERS[winner].name} выиграли сет!`;
  }

  shot = null;
  if (winnerText) {
    phase = 'over';
    recordGame(winner, left.map(n => 8 - n));
    log(winnerText, 'ok');
    setLastShot(p, items, { cls: 'win', text: winnerText });
    updatePanel();
    return;
  }

  if (keepTurn) {
    log('Своя пешка забита без нарушений — серия продолжается.', 'ok');
    setLastShot(p, items, { cls: 'keep', text: 'Забита! Серия продолжается' });
  } else {
    const why = foul ? 'нарушение'
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
  const rails = [...shot.railsBeforeFirst].map(s => RAIL_NAMES[s]).join(', ');
  const how = rails ? `после борта (${rails})` : 'прямым ударом';
  if (!f) return rails ? `Шайба коснулась бортов (${rails}), но не задела ни одной пешки` : 'Шайба не задела ни одной пешки';
  const whose = f.owner === shot.player
    ? (shot.darkAtStart.has(f) ? 'своя тёмная' : 'своя светлая')
    : 'пешка соперника';
  return `Первое касание ${how}: ${whose}${f.owner === shot.player ? ' пешка' : ''}`;
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
