'use strict';

// ===== Статистика партий (хранится в браузере) =====
const RECORDS_KEY = 'novus.records.v1';
const RECORDS_LIMIT = 500;
const HUMAN_PLAYER = 1 - AI_PLAYER;

function loadRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    return Array.isArray(data?.games) ? data.games : [];
  } catch {
    return [];
  }
}

function saveRecords(games) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify({ version: 1, games: games.slice(-RECORDS_LIMIT) }));
  } catch {
    // Хранилище недоступно (приватный режим) — статистика просто не сохранится.
  }
}

// winner: 0, 1 или null (обе стороны забили все пешки); score — забито пешек каждой стороной.
function recordGame(winner, score) {
  const games = loadRecords().filter(g => g.id !== gameId);
  const game = {
    id: gameId,
    at: Date.now(),
    mode: net.active ? 'online' : cfg.mode,
    level: cfg.level,
    ...(!net.active && cfg.mode === 'ai' ? { hint: cfg.hintLen } : {}),
    ...(!net.active && cfg.mode === 'ai' && cfg.room ? { room: cfg.room } : {}),
    ...(net.active ? {
      seat: net.seat,
      peer: net.peerName || '',
      stake: typeof clampStake === 'function' ? clampStake(net.rules?.stake ?? cfg.stake) : 20,
    } : {}),
    winner,
    score,
    fouls: stats.map(s => s.fouls),
    seconds: Math.round((Date.now() - gameStartedAt) / 1000),
  };
  game.xp = typeof xpForGame === 'function' ? xpForGame(game) : 0;
  games.push(game);
  saveRecords(games);
  renderRecords();
  if (typeof onGamesChanged === 'function') onGamesChanged(games);
  if (typeof noteRoomProgress === 'function') noteRoomProgress(game);
}

function forgetGame(id) {
  saveRecords(loadRecords().filter(g => g.id !== id));
  renderRecords();
}

function mySeat(g) {
  return g.mode === 'online' ? g.seat : HUMAN_PLAYER;
}

function gameResult(g) {
  if (g.winner === null) return 'draw';
  if (g.mode === 'hotseat') return g.winner === 0 ? 'red' : 'black';
  return g.winner === mySeat(g) ? 'win' : 'loss';
}

function summarize(games) {
  const s = { n: games.length, win: 0, loss: 0, draw: 0, mine: 0, theirs: 0 };
  for (const g of games) {
    const r = gameResult(g);
    if (r === 'win') s.win++;
    else if (r === 'loss') s.loss++;
    else s.draw++;
    s.mine += g.score[mySeat(g)];
    s.theirs += g.score[1 - mySeat(g)];
  }
  return s;
}

function streaks(games) {
  let run = 0;
  let best = 0;
  for (const g of games) {
    run = gameResult(g) === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { run, best };
}

function percent(a, n) {
  return n ? `${Math.round(a / n * 100)}%` : '—';
}

function formatWhen(ms) {
  return new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  return m ? `${m} мин` : `${sec} с`;
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const RESULT_LABELS = {
  win: ['Победа', 'ok'],
  loss: ['Поражение', 'bad'],
  draw: ['Переигровка', 'info'],
  red: ['Победили красные', 'info'],
  black: ['Победили чёрные', 'info'],
};

function renderRecords() {
  const box = document.getElementById('recordsBody');
  if (!box) return;
  const games = loadRecords();
  const ai = games.filter(g => g.mode === 'ai');
  const hot = games.filter(g => g.mode === 'hotseat');
  const online = games.filter(g => g.mode === 'online');

  if (!games.length) {
    box.innerHTML = '<div class="empty">Сыгранных партий пока нет. Партия попадает сюда, когда одна из сторон забьёт все 8 пешек.</div>';
    return;
  }

  let html = '';
  const roomed = typeof ROOMS !== 'undefined' ? ROOMS.filter(r => ai.some(g => g.room === r.id)) : [];
  if (roomed.length) {
    html += '<h3>Залы</h3>' +
      '<table class="rec"><tr><th>Зал</th><th>Игр</th><th>Побед</th><th>Пораж.</th><th>%</th><th>Пешки<br><small>вы : он</small></th></tr>' +
      roomed.map(r => {
        const s = summarize(ai.filter(g => g.room === r.id));
        return `<tr><td>${r.icon} ${r.name}</td><td>${s.n}</td><td class="w">${s.win}</td><td class="l">${s.loss}</td>` +
          `<td>${percent(s.win, s.win + s.loss)}</td><td>${s.mine} : ${s.theirs}</td></tr>`;
      }).join('') + '</table>';
  }
  if (ai.length) {
    const rows = [1, 2, 3].map(l => [AI_LEVELS[l].name, summarize(ai.filter(g => g.level === l))]);
    rows.push(['Всего', summarize(ai)]);
    const { run, best } = streaks(ai);
    html += '<h3>Против компьютера</h3>' +
      '<table class="rec"><tr><th>Уровень</th><th>Игр</th><th>Побед</th><th>Пораж.</th><th>%</th><th>Пешки<br><small>вы : он</small></th></tr>' +
      rows.map(([name, s], i) => `<tr class="${i === 3 ? 'total' : ''}${s.n ? '' : ' none'}">` +
        `<td>${name}</td><td>${s.n}</td><td class="w">${s.win}</td><td class="l">${s.loss}</td>` +
        `<td>${percent(s.win, s.win + s.loss)}</td><td>${s.mine} : ${s.theirs}</td></tr>`).join('') +
      '</table>' +
      `<div class="streak">Серия побед сейчас: <b>${run}</b> · лучшая: <b>${best}</b></div>`;
  }

  if (online.length) {
    const s = summarize(online);
    html += '<h3>По сети</h3>' +
      `<div class="duo">Игр: <b>${s.n}</b> · побед: <b class="w">${s.win}</b> · поражений: <b class="l">${s.loss}</b>` +
      ` · ${percent(s.win, s.win + s.loss)}<br><small>Пешки за все партии — вы ${s.mine} : ${s.theirs} соперники</small></div>`;
  }

  if (hot.length) {
    const red = hot.filter(g => g.winner === 0).length;
    const black = hot.filter(g => g.winner === 1).length;
    const draws = hot.length - red - black;
    const pawns = hot.reduce((acc, g) => [acc[0] + g.score[0], acc[1] + g.score[1]], [0, 0]);
    html += '<h3>Вдвоём</h3>' +
      `<div class="duo"><span class="chip" style="background:${PLAYERS[0].color}"></span>${PLAYERS[0].name}: <b>${red}</b> ${plural(red, 'победа', 'победы', 'побед')}` +
      ` · <span class="chip" style="background:${PLAYERS[1].color}"></span>${PLAYERS[1].name}: <b>${black}</b>` +
      `${draws ? ` · переигровок: ${draws}` : ''}<br><small>Пешки за все партии — ${pawns[0]} : ${pawns[1]}</small></div>`;
  }

  html += '<h3>Последние партии</h3><div class="recent">' +
    games.slice(-15).reverse().map(g => {
      const [label, cls] = RESULT_LABELS[gameResult(g)];
      const room = typeof ROOM_BY_ID !== 'undefined' ? ROOM_BY_ID[g.room] : null;
      const who = room ? `${room.icon} ${room.name}`
        : g.mode === 'ai' ? AI_LEVELS[g.level]?.name ?? ''
        : g.mode === 'online' ? `по сети${g.peer ? `, ${escapeHtml(g.peer)}` : ''}` : 'вдвоём';
      const score = g.mode === 'hotseat' ? `${g.score[0]} : ${g.score[1]}` : `${g.score[mySeat(g)]} : ${g.score[1 - mySeat(g)]}`;
      const xp = g.xp ? ` · +${g.xp}` : '';
      return `<div class="game ${cls}"><span class="res">${label}</span><span class="sc">${score}${xp}</span>` +
        `<span class="meta">${who} · ${formatWhen(g.at)} · ${formatDuration(g.seconds)}</span></div>`;
    }).join('') + '</div>';

  box.innerHTML = html;
}

function openRecords() {
  if (typeof openCabinet === 'function') {
    openCabinet('games');
    return;
  }
  renderRecords();
}

function closeRecords() {
  if (typeof closeCabinet === 'function') closeCabinet();
}

document.getElementById('btnRecordsReset')?.addEventListener('click', () => {
  if (!loadRecords().length) return;
  const extra = typeof accountSignedIn === 'function' && accountSignedIn()
    ? '\n\nСтатистика сотрётся и в облаке.'
    : '';
  if (!confirm('Удалить всю статистику партий? Это нельзя отменить.' + extra)) return;
  saveRecords([]);
  if (typeof resetAccountProgress === 'function') resetAccountProgress();
  renderRecords();
});
