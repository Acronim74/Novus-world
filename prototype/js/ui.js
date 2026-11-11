'use strict';

// ===== Панель =====
const logEl = document.getElementById('log');

function log(text, cls = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.innerHTML = '';
}

function updatePower() {
  const pct = Math.round(aim.power * 100);
  document.getElementById('powerFill').style.width = `${pct}%`;
  const speed = (aim.power * cfg.vMax / 1000).toFixed(1).replace('.', ',');
  document.getElementById('powerValue').textContent = pct ? `${pct}% · ${speed} м/с` : '0%';
}

function updatePanel() {
  const pl = PLAYERS[current];
  const peer = net.peerName || 'Соперник';
  const hint = phase === 'moving' ? 'Фишки в движении…'
    : phase === 'over' ? 'Нажмите «Новая партия»'
    : phase === 'ai' ? `Компьютер ${aiStatus}`
    : phase === 'remote' ? (net.peerOnline ? `${peer} целится…` : `${peer} не в сети — ждём`)
    : 'Поставьте шайбу, прицельтесь и ударьте';
  const room = net.code
    ? `<span class="netline"><span class="dot ${net.peerOnline ? 'on' : net.peerUid ? 'off' : 'wait'}"></span>` +
      `По сети · ${net.code} · <b class="match">${matchLabel()}</b>` +
      `${net.peerUid ? ` · ${escapeHtml(peer)}` : ' · ждём соперника'}</span>`
    : typeof roomLabel === 'function' && roomLabel() ? `<span class="netline">${roomLabel()}</span>` : '';
  document.getElementById('turn').innerHTML =
    `<span class="chip" style="background:${pl.color}"></span>Бьют <b>${pl.name}</b>` +
    '<span id="shotTimer" class="timer"></span>' +
    `<span class="hint">${hint}</span>${room}`;
  timerShown = null;

  const matchBar = net.code ? `<div class="match-bar">Счёт <b>${matchLabel()}</b></div>` : '';
  document.getElementById('scoreboard').innerHTML = matchBar + PLAYERS.map((p, i) => {
    const onTable = pawnsOnTable(i);
    const inPocket = bodies.filter(b => b.kind === 'pawn' && b.owner === i && b.state === 'pocketed').length;
    const sets = net.code ? matchPair()[i] : null;
    const role = net.active ? (i === net.seat ? 'вы' : escapeHtml(net.peerName || 'соперник'))
      : cfg.mode === 'ai' ? (isAI(i) ? `компьютер · ${AI_LEVELS[cfg.level].name.toLowerCase()}` : 'вы')
      : `игрок ${i + 1}`;
    const pips = Array.from({ length: 8 }, (_, k) =>
      `<span class="pip" style="${k < inPocket ? `background:${p.color};border-color:#9aa5ab` : ''}"></span>`).join('');
    const active = i === current && phase !== 'over';
    return `<div class="card${active ? ' active' : ''}">` +
      `<div class="head"><span class="chip" style="background:${p.color}"></span>${p.name}<small>${role}</small>` +
      `${active ? '<span class="bat">бьёт</span>' : ''}</div>` +
      `<div class="big">${inPocket} <small>из 8 забито</small></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="sub">на столе ${onTable}${debt[i] ? ` · <b>долг ${debt[i]}</b>` : ''}${sets != null ? ` · сеты ${sets}` : ''}</div>` +
      `</div>`;
  }).join('');

  renderMini(peer);
  if (typeof maybeShowRuleOffer === 'function') maybeShowRuleOffer();
  const roomsBtn = document.getElementById('btnRooms');
  if (roomsBtn) {
    const inRoom = typeof currentRoom === 'function' && currentRoom();
    roomsBtn.querySelector('.full').textContent = inRoom ? 'Выйти из зала' : 'Залы';
    roomsBtn.hidden = net.active;
  }
  const undoBlocked = typeof roomUndoBlocked === 'function' && roomUndoBlocked();
  for (const b of document.querySelectorAll('.undo')) b.disabled = !snapshot || phase === 'moving' || net.active || undoBlocked;
  updatePower();
  renderSidePanels();
}

// Табло телефона в одну строку: счёт сторон, а между ними — время на удар или что сейчас происходит.
function renderMini(peer) {
  const status = phase === 'ai' ? 'Компьютер…'
    : phase === 'remote' ? (net.peerOnline ? `${peer}…` : 'Ждём…')
    : phase === 'over' ? 'Сет окончен'
    : phase === 'place' ? (cfg.mode === 'hotseat' && !net.active ? 'Удар' : 'Ваш удар') : '';
  const side = i => {
    const inPocket = bodies.filter(b => b.kind === 'pawn' && b.owner === i && b.state === 'pocketed').length;
    const who = net.active ? (i === net.seat ? 'вы' : escapeHtml(peer))
      : cfg.mode === 'ai' ? (isAI(i) ? 'ИИ' : 'вы') : `игрок ${i + 1}`;
    const active = i === current && phase !== 'over';
    const chip = `<span class="chip" style="background:${PLAYERS[i].color}"></span>`;
    const score = `<b>${inPocket}</b><small>/8</small>`;
    const name = `<span class="who">${who}</span>`;
    const owed = debt[i] ? `<span class="debt">долг ${debt[i]}</span>` : '';
    return `<div class="side-score${active ? ' active' : ''}${i === 1 ? ' right' : ''}">` +
      (i === 0 ? chip + score + name + owed : owed + name + score + chip) + '</div>';
  };
  const dot = net.code ? `<span class="dot ${net.peerOnline ? 'on' : net.peerUid ? 'off' : 'wait'}"></span>` : '';
  const match = net.code ? `<span class="match">${matchLabel()}</span>` : '';
  document.getElementById('mini').innerHTML =
    side(0) +
    `<div class="mid${net.code ? ' netline' : ''}">${dot}${match}<span id="shotTimerMini" class="timer"></span><span class="status">${status}</span></div>` +
    side(1);
}

let timerShown = null;

function updateTimer(now) {
  const active = turnDeadline && (phase === 'place' || phase === 'remote');
  const secs = active ? Math.max(0, Math.ceil((turnDeadline - now - 50) / 1000)) : -1;
  if (secs === timerShown) return;
  timerShown = secs;
  for (const id of ['shotTimer', 'shotTimerMini']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = secs >= 0 ? `⏱ ${secs}` : '';
    el.classList.toggle('low', secs >= 0 && secs <= 5);
  }
  document.getElementById('mini').classList.toggle('timed', secs >= 0);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderSidePanels() {
  const last = document.getElementById('lastShot');
  if (!lastShot) {
    last.innerHTML = '<div class="empty">Ударов ещё не было</div>';
  } else {
    const pl = PLAYERS[lastShot.p];
    last.innerHTML =
      `<div class="who"><span class="chip" style="background:${pl.color}"></span>${pl.name}</div>` +
      lastShot.items.map(it =>
        `<div class="event ${it.cls}"><span class="icon">${it.icon}</span><span>${escapeHtml(it.text)}</span></div>`).join('') +
      `<div class="verdict ${lastShot.verdict.cls}">${escapeHtml(lastShot.verdict.text)}</div>`;
  }

  const rows = [
    ['Штрафы', 'fouls'],
    ['Шайба в лузе / за бортом', 'strikerLost'],
    ['Пешки за бортом', 'pawnsOut'],
    ['Забито пешек соперника', 'oppIn'],
  ];
  const head = PLAYERS.map(p => `<th><span class="chip" style="background:${p.color};margin:0"></span></th>`).join('');
  const body = rows.map(([title, key]) =>
    `<tr><td>${title}</td>${stats.map(s => `<td class="${s[key] ? 'hot' : ''}">${s[key]}</td>`).join('')}</tr>`).join('');
  const history = stats.flatMap((s, i) => s.history.slice(0, 3).map(h => ({ i, h })));
  document.getElementById('fouls').innerHTML =
    `<table><tr><th></th>${head}</tr>${body}</table>` +
    (history.length
      ? `<div class="history">${history.map(({ i, h }) =>
        `<div><span class="chip" style="background:${PLAYERS[i].color};width:10px;height:10px"></span>${escapeHtml(capitalize(h))}</div>`).join('')}</div>`
      : '');
}

function bindCheck(id, key, after) {
  const el = document.getElementById(id);
  el.checked = cfg[key];
  el.addEventListener('change', () => {
    cfg[key] = el.checked;
    after?.();
  });
}

function bindRange(id, get, set) {
  const el = document.getElementById(id);
  const out = el.parentElement.querySelector('span');
  el.value = get();
  out.textContent = el.value;
  el.addEventListener('input', () => {
    set(Number(el.value));
    out.textContent = el.value;
  });
}

function bindSelect(id, get, set) {
  const el = document.getElementById(id);
  el.value = String(get());
  el.addEventListener('change', () => set(el.value));
}

// Переключатель из нескольких кнопок: подсвечена та, чьё значение сейчас в настройках.
const segRefreshers = [];

function bindSeg(id, get, set) {
  const el = document.getElementById(id);
  const refresh = () => {
    for (const b of el.querySelectorAll('button[data-v]')) b.classList.toggle('on', b.dataset.v === String(get()));
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    set(b.dataset.v);
    refreshControls();
  });
  segRefreshers.push(refresh);
}

function refreshControls() {
  for (const refresh of segRefreshers) refresh();
  const room = typeof currentRoom === 'function' ? currentRoom() : null;
  document.getElementById('groupLevel').classList.toggle('dim', cfg.mode !== 'ai' || net.active);
  // В комнате и в зале режим соперника не меняют: иначе партия сносится или сбрасывается зал.
  document.getElementById('groupMode').classList.toggle('locked', Boolean(net.code || room));
  // В сетевой партии условия общие: текущий сет уже идёт по ним, новые — только по согласию и со следующей партии.
  for (const id of ['groupTable', 'groupHint', 'groupTime']) document.getElementById(id).classList.toggle('locked', net.active);
  // В зале соперника, подсказку и стол задаёт зал — здесь их только показывают.
  for (const id of ['groupLevel', 'groupTable', 'groupHint']) if (room) document.getElementById(id).classList.add('locked');
  if (!room && !net.active) document.getElementById('groupLevel').classList.remove('locked');
  for (const id of ['optCircleDark', 'optFree', 'optZoneReturn']) document.getElementById(id).disabled = net.active;
  document.getElementById('tableNote').textContent = TABLE_STATES[cfg.table].note;
  const hint = HINT_MODES[cfg.hintLen];
  let hintNote = hint.note;
  if (cfg.mode === 'ai' && !net.active && !room) {
    if (hint.xpMul < 1) hintNote += ' Награда за партию с компьютером меньше.';
    else if (hint.xpMul > 1) hintNote += ' Награда за партию с компьютером больше.';
  }
  document.getElementById('hintNote').textContent = hintNote;
  document.getElementById('timeNote').textContent = cfg.shotTime
    ? `Не успели ударить за ${cfg.shotTime} с — штрафная пешка и ход переходит (п. 17.1.15).`
    : 'Думайте над ударом сколько угодно.';
  const levelNote = document.getElementById('levelNetNote');
  levelNote.textContent = net.code
    ? 'Идёт игра по сети: компьютер не участвует. Условия комнаты меняются в окне «Игра по сети»: один предлагает, другой подтверждает. Пока нет согласия, остаются прежние.'
    : room
      ? `Вы в зале «${room.name}». Здесь нельзя менять соперника, сложность, натирку стола и подсказку — их задаёт зал. Чтобы выбрать условия самому, откройте «Залы» и войдите в «Свободную игру».`
      : '';
  levelNote.classList.toggle('warn', Boolean(net.code || room));
  const xpNote = document.getElementById('aiXpNote');
  if (xpNote) {
    if (cfg.mode !== 'ai') {
      xpNote.textContent = 'Вдвоём на одном устройстве очки не начисляются.';
    } else if (room) {
      xpNote.textContent = `${AI_LEVELS[room.level].name}. Победа: ${room.xpWin} ${plural(room.xpWin, 'очко', 'очка', 'очков')}, поражение: ${room.xpLoss}.`;
    } else if (typeof aiXpPreview === 'function') {
      const prev = aiXpPreview(cfg.level, cfg.hintLen);
      const how = hint.xpMul < 1 ? 'Подсказка снижает награду.'
        : hint.xpMul > 1 ? 'Без подсказки награда выше.'
          : 'Короткая подсказка — обычная награда.';
      xpNote.textContent = `Победа: ${prev.win} ${plural(prev.win, 'очко', 'очка', 'очков')}, поражение: ${prev.loss}. ${how}`;
    } else {
      const pack = AI_LEVELS[cfg.level];
      xpNote.textContent = `Победа: ${pack.xpWin} очков, поражение: ${pack.xpLoss}.`;
    }
  }
}

// Условия, которые в сетевой игре одинаковы у обоих игроков.
function currentRules() {
  return {
    shotTime: cfg.shotTime,
    table: cfg.table,
    hintLen: cfg.hintLen,
    circleDark: cfg.circleDark,
    freePlace: cfg.freePlace,
    zoneReturn: cfg.zoneReturn,
    stake: typeof clampStake === 'function' ? clampStake(cfg.stake) : (Number(cfg.stake) || 20),
    skin: typeof exportTableSkin === 'function' ? exportTableSkin() : undefined,
  };
}

function applyRules(r) {
  cfg.shotTime = Number(r.shotTime) || 0;
  if (TABLE_STATES[r.table]) setTable(r.table);
  if (HINT_MODES[r.hintLen]) cfg.hintLen = r.hintLen;
  cfg.circleDark = r.circleDark !== false;
  cfg.freePlace = Boolean(r.freePlace);
  cfg.zoneReturn = Boolean(r.zoneReturn);
  cfg.stake = typeof clampStake === 'function' ? clampStake(r.stake) : (Number(r.stake) || 20);
  if (typeof applyLoadout === 'function') applyLoadout();
  document.getElementById('optCircleDark').checked = cfg.circleDark;
  document.getElementById('optFree').checked = cfg.freePlace;
  document.getElementById('optZoneReturn').checked = cfg.zoneReturn;
  refreshControls();
}

function setTable(v) {
  cfg.table = v;
  cfg.muStriker = TABLE_STATES[v].muStriker;
  cfg.muPawn = TABLE_STATES[v].muPawn;
  for (const [el, val] of [[muStrikerInput, cfg.muStriker], [muPawnInput, cfg.muPawn]]) {
    el.value = val;
    el.parentElement.querySelector('span').textContent = el.value;
  }
}

bindSeg('optMode', () => cfg.mode, v => {
  if (net.code) return;
  if (typeof currentRoom === 'function' && currentRoom()) return;
  if (typeof leaveRoomToFree === 'function') leaveRoomToFree();
  cfg.mode = v;
  aiToken++;
  aiShowCue = false;
  if (phase === 'ai') startTurn();
  else {
    resetTurnTimer();
    updatePanel();
    maybeStartAI();
  }
});
bindSeg('optLevel', () => cfg.level, v => {
  cfg.level = Number(v);
  updatePanel();
});
bindSeg('optHintLen', () => cfg.hintLen, v => { cfg.hintLen = v; });
bindSeg('optShotTime', () => cfg.shotTime, v => {
  cfg.shotTime = Number(v);
  if (phase === 'place' || phase === 'remote') resetTurnTimer();
});
bindCheck('optFree', 'freePlace', () => {
  if (phase === 'place' && placementProblem(current, striker.x, striker.y)) {
    const spot = findStrikerSpot(current);
    striker.x = spot.x;
    striker.y = spot.y;
  }
});
bindCheck('optFlip', 'flip');
bindCheck('optSlow', 'slow');
const muStrikerInput = document.getElementById('optMuStriker');
const muPawnInput = document.getElementById('optMuPawn');
bindRange('optMuStriker', () => cfg.muStriker, v => { cfg.muStriker = v; });
bindRange('optMuPawn', () => cfg.muPawn, v => { cfg.muPawn = v; });
bindRange('optPuckE', () => cfg.puckE, v => { cfg.puckE = v; });
bindSeg('optTable', () => cfg.table, setTable);
bindRange('optRailE', () => cfg.railE, v => { cfg.railE = v; });
bindRange('optVMax', () => cfg.vMax, v => { cfg.vMax = v; });
bindRange('optClimbPawn', () => cfg.climbThr.pawn, v => { cfg.climbThr.pawn = v; });

bindCheck('optCircleDark', 'circleDark', updatePanel);
bindCheck('optZoneReturn', 'zoneReturn');
bindSelect('optPowerSide', () => cfg.powerSide, v => {
  cfg.powerSide = v;
  resize();
});

for (const b of document.querySelectorAll('.undo')) b.addEventListener('click', restoreSnapshot);

// ----- Окна и вкладки -----
const drawer = document.getElementById('drawer');

function openModal(id) {
  closeDrawer();
  document.getElementById(id).classList.remove('closed');
}

function closeModal(id) {
  document.getElementById(id).classList.add('closed');
}

function overlayOpen() {
  return !drawer.classList.contains('closed') || Boolean(document.querySelector('.modal:not(.closed)'));
}

for (const modal of document.querySelectorAll('.modal')) {
  modal.addEventListener('click', e => {
    if (e.target.closest('.close')) modal.classList.add('closed');
    else if (e.target === modal && modal.id !== 'ruleOffer') modal.classList.add('closed');
  });
}

function openDrawer() {
  drawer.classList.remove('closed');
  document.getElementById('tabSettings').classList.add('on');
}

function closeDrawer() {
  drawer.classList.add('closed');
  document.getElementById('tabSettings').classList.remove('on');
}

function toggleDrawer() {
  if (drawer.classList.contains('closed')) openDrawer();
  else closeDrawer();
}

function askNewGame() {
  // Новая партия начинается в том же зале: из зала выходят только кнопкой «Выйти из зала».
  if (!net.active && !(typeof partyStarted === 'function' && partyStarted())) {
    closeModal('gameOver');
    newGame();
    return;
  }
  document.getElementById('confirmNewText').textContent = net.active
    ? `Начать новый сет? У соперника он тоже начнётся заново, а цвета поменяются. Счёт комнаты ${matchLabel()} сохранится.` +
      (net.proposal ? ' Новые условия ещё не подтверждены — сет начнётся по прежним.' : '')
    : phase === 'over' ? 'Начать новый сет?' : 'Начать новый сет? Текущая партия будет прервана и не попадёт в статистику.';
  openModal('confirmNew');
}

function openLevel() {
  refreshControls();
  openModal('level');
}

document.getElementById('btnConfirmNew').addEventListener('click', () => {
  closeModal('confirmNew');
  if (net.active) netNewGame();
  else newGame();
});
document.getElementById('btnNew').addEventListener('click', askNewGame);
document.getElementById('tabNew').addEventListener('click', () => (net.active ? askNewGame() : openRooms()));
document.getElementById('btnRooms').addEventListener('click', () => openRooms());
document.getElementById('btnLevel').addEventListener('click', openLevel);
document.getElementById('tabLevel').addEventListener('click', openLevel);
document.getElementById('btnDrawer').addEventListener('click', toggleDrawer);
document.getElementById('tabSettings').addEventListener('click', toggleDrawer);
document.getElementById('btnDrawerClose').addEventListener('click', closeDrawer);
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeDrawer();
  for (const modal of document.querySelectorAll('.modal')) modal.classList.add('closed');
});

// ----- Установка на телефон: игра открывается на весь экран, без строки браузера -----
const btnInstall = document.getElementById('btnInstall');
const installNote = document.getElementById('installNote');
const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
let installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  btnInstall.hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  btnInstall.hidden = true;
  installNote.hidden = true;
});
// В Safari на iPhone и iPad своего окна установки нет — только через меню «Поделиться».
if (!installed && /iPhone|iPad|iPod/.test(navigator.userAgent)) btnInstall.hidden = false;

btnInstall.addEventListener('click', async () => {
  if (!installPrompt) {
    installNote.textContent = 'В Safari нажмите «Поделиться» (квадрат со стрелкой) → «На экран „Домой“». Игра появится значком и будет открываться на весь экран.';
    installNote.hidden = false;
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  btnInstall.hidden = true;
});
