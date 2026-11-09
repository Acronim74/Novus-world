'use strict';

// ===== Трасса партии: удары, скорость шайбы, почему кончился сет =====
const TRACE_KEY = 'novus.trace.v1';
const TRACE_LIMIT = 8;
const TRACE_SPIKE = 80;

const matchTrace = {
  game: null,
};

function loadTraces() {
  try {
    const data = JSON.parse(localStorage.getItem(TRACE_KEY));
    return Array.isArray(data?.games) ? data.games : [];
  } catch {
    return [];
  }
}

function saveTrace(game) {
  if (!game || !game.shots.length) return;
  const games = loadTraces().filter(g => g.id !== game.id);
  games.push(JSON.parse(JSON.stringify(game)));
  try {
    localStorage.setItem(TRACE_KEY, JSON.stringify({ version: 1, games: games.slice(-TRACE_LIMIT) }));
  } catch {
    // как со статистикой
  }
}

function startTraceGame() {
  if (matchTrace.game?.shots.length && !matchTrace.game.end) {
    matchTrace.game.end = { winner: undefined, text: 'Партия прервана' };
    saveTrace(matchTrace.game);
  }
  matchTrace.game = {
    id: gameId,
    at: Date.now(),
    mode: typeof net !== 'undefined' && net.active ? 'online' : cfg.mode,
    level: cfg.level,
    first: firstShooter,
    shots: [],
  };
  renderTraceLive();
}

function beginTraceShot(seed) {
  if (!matchTrace.game) startTraceGame();
  const v0 = Math.hypot(striker.vx, striker.vy);
  shot.trace = {
    n: matchTrace.game.shots.length + 1,
    player: current,
    ai: typeof isAI === 'function' && isAI(current),
    seed: seed >>> 0,
    power: Math.round(aim.power * 100),
    dir: [+aim.dirX.toFixed(4), +aim.dirY.toFixed(4)],
    from: [Math.round(striker.x), Math.round(striker.y)],
    v0: Math.round(v0),
    vmax: v0,
    vWatch: v0,
    vzMax: 0,
    spikes: [],
  };
}

function noteTraceSpike(reason) {
  const t = shot?.trace;
  if (!t || !striker || striker.state !== 'table') return;
  const v = Math.hypot(striker.vx, striker.vy);
  if (v > t.vmax) t.vmax = v;
  if (striker.vz > t.vzMax) t.vzMax = striker.vz;
  const gain = v - t.vWatch;
  if (gain >= TRACE_SPIKE) {
    t.spikes.push({
      why: reason || 'шаг',
      d: Math.round(gain),
      from: Math.round(t.vWatch),
      to: Math.round(v),
      x: Math.round(striker.x),
      y: Math.round(striker.y),
    });
    if (t.spikes.length > 16) t.spikes.shift();
  }
  t.vWatch = v;
}

function finishTraceShot(j, extra) {
  const t = shot?.trace;
  if (!t || !matchTrace.game) return;
  t.vmax = Math.round(t.vmax);
  t.gain = t.vmax - t.v0;
  t.own = j?.ownIn?.length || 0;
  t.foul = j?.foul || '';
  t.keep = Boolean(j?.keepTurn);
  t.left = [pawnsOnTable(0) + debt[0], pawnsOnTable(1) + debt[1]];
  if (extra) Object.assign(t, extra);
  matchTrace.game.shots.push(t);
  if (t.gain >= 150) {
    const why = t.spikes.map(s => s.why).filter((x, i, a) => a.indexOf(x) === i).join(', ') || 'неясно';
    log(`Трасса: шайба ускорилась на ${t.gain} мм/с (${why}).`, 'foul');
  }
  renderTraceLive();
}

function endTraceGame(winner, text) {
  if (!matchTrace.game) return;
  matchTrace.game.end = { winner, text: text || '', at: Date.now() };
  saveTrace(matchTrace.game);
  renderTraceLive();
  if (typeof renderTracePane === 'function') renderTracePane();
}

function playerTraceName(p, shotRow) {
  if (shotRow?.ai) return 'компьютер';
  return PLAYERS[p]?.name || `игрок ${p + 1}`;
}

function traceShotHtml(s) {
  const who = playerTraceName(s.player, s);
  const gain = s.gain > 40 ? `<span class="spike">шайба ${s.v0}→${s.vmax} мм/с (+${s.gain})</span>` : `шайба ${s.v0}→${s.vmax} мм/с`;
  const result = s.note || (s.foul ? s.foul : s.keep ? `забито ${s.own}, серия` : s.own ? `забито ${s.own}, ход дальше` : 'мимо');
  const spikes = s.spikes?.length
    ? '<ul class="trace-spikes">' + s.spikes.map(x =>
      `<li>+${x.d} от ${escapeHtml(x.why)} · ${x.from}→${x.to} @ ${x.x},${x.y}</li>`).join('') + '</ul>'
    : '';
  return `<div class="trace-shot${s.gain >= 150 ? ' hot' : ''}">` +
    `<div><b>№${s.n}</b> ${escapeHtml(who)} · ${s.power}% · зерно ${s.seed}</div>` +
    `<div class="sub">${gain} · с (${s.from[0]}, ${s.from[1]}) · ${escapeHtml(result)}` +
    `${s.left ? ` · осталось ${s.left[0]}:${s.left[1]}` : ''}</div>${spikes}</div>`;
}

function renderTraceList(game) {
  if (!game) return '<div class="empty">Партий в трассе ещё нет.</div>';
  const mode = game.mode === 'ai' ? `компьютер · ${AI_LEVELS[game.level]?.name || game.level}`
    : game.mode === 'online' ? 'по сети'
    : 'вдвоём';
  const end = game.end?.text
    ? `<div class="verdict ${game.end.winner == null && game.end.text ? 'pass' : 'win'}">${escapeHtml(game.end.text)}</div>`
    : '<div class="tip">Партия идёт.</div>';
  const shots = game.shots.length
    ? game.shots.map(traceShotHtml).join('')
    : '<div class="empty">Ударов ещё не было.</div>';
  return `<div class="tip">${new Date(game.at).toLocaleString('ru')} · ${escapeHtml(mode)} · ${game.shots.length} ${plural(game.shots.length, 'удар', 'удара', 'ударов')}</div>` +
    end + shots;
}

function renderTraceLive() {
  const box = document.getElementById('traceLive');
  if (!box) return;
  box.innerHTML = renderTraceList(matchTrace.game);
}

function renderTracePane() {
  const box = document.getElementById('cabTrace');
  if (!box) return;
  const past = loadTraces().slice().reverse();
  const current = matchTrace.game;
  const listed = current ? [current, ...past.filter(g => g.id !== current.id)] : past;
  let html = '<p class="tip">Каждый удар: кто бил, сила, зерно физики, скорость шайбы. Если шайба ускорилась сама — строка красная и указано, от чего (фишка, борт, веер, подскок).</p>';
  html += '<div class="sheet-actions"><button type="button" id="traceCopy">Копировать JSON</button>' +
    '<button type="button" id="traceClear">Очистить трассы</button></div>';
  if (!listed.length) html += '<div class="empty">Сыграйте партию — трасса появится здесь.</div>';
  for (const g of listed.slice(0, TRACE_LIMIT)) html += `<div class="trace-game">${renderTraceList(g)}</div>`;
  box.innerHTML = html;
  document.getElementById('traceCopy')?.addEventListener('click', async () => {
    const payload = JSON.stringify({ current, past }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      log('Трасса скопирована.', 'ok');
    } catch {
      log('Не удалось скопировать трассу.', 'foul');
    }
  });
  document.getElementById('traceClear')?.addEventListener('click', () => {
    if (!confirm('Удалить сохранённые трассы партий?')) return;
    try { localStorage.removeItem(TRACE_KEY); } catch { /* */ }
    if (matchTrace.game) matchTrace.game.shots = [];
    renderTracePane();
    renderTraceLive();
  });
}
