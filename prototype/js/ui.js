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
  const hint = phase === 'moving' ? 'Фишки в движении…'
    : phase === 'over' ? 'Нажмите «Новая партия»'
    : phase === 'ai' ? `Компьютер ${aiStatus}`
    : 'Поставьте шайбу, прицельтесь и ударьте';
  document.getElementById('turn').innerHTML =
    `<span class="chip" style="background:${pl.color}"></span>Бьют <b>${pl.name}</b>` +
    `<span class="hint">${hint}</span>`;

  document.getElementById('scoreboard').innerHTML = PLAYERS.map((p, i) => {
    const onTable = pawnsOnTable(i);
    const inPocket = bodies.filter(b => b.kind === 'pawn' && b.owner === i && b.state === 'pocketed').length;
    const role = cfg.mode === 'ai'
      ? (isAI(i) ? `компьютер · ${AI_LEVELS[cfg.level].name.toLowerCase()}` : 'вы')
      : `игрок ${i + 1}`;
    const pips = Array.from({ length: 8 }, (_, k) =>
      `<span class="pip" style="${k < inPocket ? `background:${p.color};border-color:#9aa5ab` : ''}"></span>`).join('');
    const active = i === current && phase !== 'over';
    return `<div class="card${active ? ' active' : ''}">` +
      `<div class="head"><span class="chip" style="background:${p.color}"></span>${p.name}<small>${role}</small>` +
      `${active ? '<span class="bat">бьёт</span>' : ''}</div>` +
      `<div class="big">${inPocket} <small>из 8 забито</small></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="sub">на столе ${onTable}${debt[i] ? ` · <b>долг ${debt[i]}</b>` : ''}</div>` +
      `</div>`;
  }).join('');

  document.getElementById('btnUndo').disabled = !snapshot || phase === 'moving';
  updatePower();
  renderSidePanels();
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

bindSelect('optMode', () => cfg.mode, v => {
  cfg.mode = v;
  aiToken++;
  aiShowCue = false;
  if (phase === 'ai') startTurn();
  else {
    updatePanel();
    maybeStartAI();
  }
});
bindSelect('optLevel', () => cfg.level, v => {
  cfg.level = Number(v);
  updatePanel();
});
bindCheck('optHint', 'hint');
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
bindSelect('optTable', () => cfg.table, v => {
  cfg.table = v;
  cfg.muStriker = TABLE_STATES[v].muStriker;
  cfg.muPawn = TABLE_STATES[v].muPawn;
  for (const [el, val] of [[muStrikerInput, cfg.muStriker], [muPawnInput, cfg.muPawn]]) {
    el.value = val;
    el.parentElement.querySelector('span').textContent = el.value;
  }
});
bindRange('optRailE', () => cfg.railE, v => { cfg.railE = v; });
bindRange('optVMax', () => cfg.vMax, v => { cfg.vMax = v; });
bindRange('optClimbPawn', () => cfg.climbThr.pawn, v => { cfg.climbThr.pawn = v; });

bindCheck('optCircleDark', 'circleDark', updatePanel);
bindSelect('optPowerSide', () => cfg.powerSide, v => {
  cfg.powerSide = v;
  resize();
});

document.getElementById('btnNew').addEventListener('click', newGame);
document.getElementById('btnUndo').addEventListener('click', restoreSnapshot);

const drawer = document.getElementById('drawer');
document.getElementById('btnDrawer').addEventListener('click', () => drawer.classList.toggle('closed'));
document.getElementById('btnDrawerClose').addEventListener('click', () => drawer.classList.add('closed'));
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !drawer.classList.contains('closed')) drawer.classList.add('closed');
});
