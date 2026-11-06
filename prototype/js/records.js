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
  games.push({
    id: gameId,
    at: Date.now(),
    mode: cfg.mode,
    level: cfg.level,
    winner,
    score,
    fouls: stats.map(s => s.fouls),
    seconds: Math.round((Date.now() - gameStartedAt) / 1000),
  });
  saveRecords(games);
  renderRecords();
}

function forgetGame(id) {
  saveRecords(loadRecords().filter(g => g.id !== id));
  renderRecords();
}

function gameResult(g) {
  if (g.winner === null) return 'draw';
  if (g.mode !== 'ai') return g.winner === 0 ? 'red' : 'black';
  return g.winner === HUMAN_PLAYER ? 'win' : 'loss';
}

function summarize(games) {
  const s = { n: games.length, win: 0, loss: 0, draw: 0, mine: 0, theirs: 0 };
  for (const g of games) {
    const r = gameResult(g);
    if (r === 'win') s.win++;
    else if (r === 'loss') s.loss++;
    else s.draw++;
    s.mine += g.score[HUMAN_PLAYER];
    s.theirs += g.score[AI_PLAYER];
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
  const hot = games.filter(g => g.mode !== 'ai');

  if (!games.length) {
    box.innerHTML = '<div class="empty">Сыгранных партий пока нет. Партия попадает сюда, когда одна из сторон забьёт все 8 пешек.</div>';
    return;
  }

  let html = '';
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

  if (hot.length) {
    const red = hot.filter(g => g.winner === 0).length;
    const black = hot.filter(g => g.winner === 1).length;
    const draws = hot.length - red - black;
    const pawns = hot.reduce((acc, g) => [acc[0] + g.score[0], acc[1] + g.score[1]], [0, 0]);
    html += '<h3>Вдвоём</h3>' +
      `<div class="duo"><span class="chip" style="background:${PLAYERS[0].color}"></span>Красные: <b>${red}</b> ${plural(red, 'победа', 'победы', 'побед')}` +
      ` · <span class="chip" style="background:${PLAYERS[1].color}"></span>Чёрные: <b>${black}</b>` +
      `${draws ? ` · переигровок: ${draws}` : ''}<br><small>Пешки за все партии — ${pawns[0]} : ${pawns[1]}</small></div>`;
  }

  html += '<h3>Последние партии</h3><div class="recent">' +
    games.slice(-15).reverse().map(g => {
      const [label, cls] = RESULT_LABELS[gameResult(g)];
      const who = g.mode === 'ai' ? AI_LEVELS[g.level]?.name ?? '' : 'вдвоём';
      const score = g.mode === 'ai' ? `${g.score[HUMAN_PLAYER]} : ${g.score[AI_PLAYER]}` : `${g.score[0]} : ${g.score[1]}`;
      return `<div class="game ${cls}"><span class="res">${label}</span><span class="sc">${score}</span>` +
        `<span class="meta">${who} · ${formatWhen(g.at)} · ${formatDuration(g.seconds)}</span></div>`;
    }).join('') + '</div>';

  box.innerHTML = html;
}

const recordsDialog = document.getElementById('records');

function openRecords() {
  renderRecords();
  recordsDialog.classList.remove('closed');
}

function closeRecords() {
  recordsDialog.classList.add('closed');
}

document.getElementById('btnRecords').addEventListener('click', openRecords);
document.getElementById('btnRecordsClose').addEventListener('click', closeRecords);
recordsDialog.addEventListener('click', e => {
  if (e.target === recordsDialog) closeRecords();
});
document.getElementById('btnRecordsReset').addEventListener('click', () => {
  if (!loadRecords().length) return;
  if (!confirm('Удалить всю статистику партий? Это нельзя отменить.')) return;
  saveRecords([]);
  renderRecords();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeRecords();
});
