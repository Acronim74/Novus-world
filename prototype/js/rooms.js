'use strict';

// ===== Залы: лестница партий с компьютером =====
// Каждый зал задаёт соперника, подсказку и стол. Следующий зал открывается победами в предыдущем.
// Свободная игра — прежний режим, где всё выбирается вручную.
const ROOMS_KEY = 'novus.rooms.v1';

const ROOMS = [
  { id: 'dacha', name: 'Дача', icon: '🏡', level: 0, hint: 'full', table: 'normal', need: 0, xpWin: 6, xpLoss: 2, undo: true, zoneReturn: false,
    note: 'Учимся: подсказка показывает весь путь, соперник сам ещё учится, удар можно отменить. Возврат шайбы в свою зону серию ещё не обрывает.' },
  { id: 'yard', name: 'Двор', icon: '🌳', level: 1, hint: 'mid', table: 'worn', need: 2, xpWin: 12, xpLoss: 3, zoneReturn: false,
    note: 'Подсказка до первого касания. Порошок стёрся — бить нужно сильнее. Возврат шайбы в свою зону пока разрешён.' },
  { id: 'club', name: 'Клуб', icon: '🎱', level: 2, hint: 'short', table: 'normal', need: 2, xpWin: 24, xpLoss: 5, zoneReturn: true,
    note: 'Только направление удара. Соперник считает удары и бьёт точно. Если шайба вернулась в свою зону — ход переходит, даже когда пешка забита (п. 18.1.5).' },
  { id: 'city', name: 'Турнир города', icon: '🏙', level: 4, hint: 'short', table: 'fresh', need: 3, xpWin: 40, xpLoss: 7, zoneReturn: true,
    note: 'Свежая натирка: всё катится далеко. Соперник почти мастер. Шайба в свою зону отдаёт ход (п. 18.1.5).' },
  { id: 'grand', name: 'Большой чемпионат', icon: '🏆', level: 3, hint: 'off', table: 'random', need: 3, xpWin: 70, xpLoss: 10, zoneReturn: true,
    note: 'Без подсказки, как за настоящим столом. Натирка каждый раз своя. Шайба в свою зону отдаёт ход (п. 18.1.5).' },
];
const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));

// Свободная игра помнит свои настройки отдельно от залов.
const FREE_DEFAULT = { level: 2, hint: 'full', table: 'normal', zoneReturn: false };

const rooms = {
  last: null, // id зала, 'free' или null — ещё не выбирал (первый вход)
  free: { ...FREE_DEFAULT },
  tutorialDone: false,
  at: 0,
};

function loadRooms() {
  try {
    const d = JSON.parse(localStorage.getItem(ROOMS_KEY));
    if (d && typeof d === 'object') {
      rooms.last = d.last === 'free' || ROOM_BY_ID[d.last] ? d.last : null;
      rooms.free = { ...FREE_DEFAULT, ...(d.free || {}) };
      rooms.tutorialDone = Boolean(d.tutorialDone);
      rooms.at = Number(d.at) || 0;
    }
  } catch {
    // Хранилище недоступно — начнём с первого зала.
  }
}

function saveRooms() {
  try {
    rooms.at = Date.now();
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  } catch {
    // ничего страшного: выбор зала просто не запомнится
  }
  if (typeof pushAccountCloud === 'function') pushAccountCloud();
}

function exportRoomsState() {
  return {
    version: 1,
    at: rooms.at || 0,
    last: rooms.last,
    free: rooms.free,
    tutorialDone: rooms.tutorialDone,
  };
}

function mergeRoomsCloud(remote) {
  if (!remote || typeof remote !== 'object') return;
  if (remote.tutorialDone) rooms.tutorialDone = true;
  const remoteAt = Number(remote.at) || 0;
  const localAt = Number(rooms.at) || 0;
  if (!rooms.last || remoteAt >= localAt) {
    if (remote.last === 'free' || ROOM_BY_ID[remote.last]) rooms.last = remote.last;
    if (remote.free && typeof remote.free === 'object') {
      rooms.free = { ...FREE_DEFAULT, ...remote.free };
    }
  }
  rooms.at = Math.max(localAt, remoteAt);
  try {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  } catch {
    // как с партиями: без хранилища просто не запомнится
  }
}

function inferHallFromGames(games = loadRecords()) {
  if (!games.some(g => g.room)) return null;
  const n = openRoomsCount(games);
  if (!n) return null;
  return ROOMS[n - 1].id;
}

function applyCloudHalls({ enter = false } = {}) {
  const games = loadRecords();
  if (games.some(g => g.room) || openRoomsCount(games) > 1) {
    rooms.tutorialDone = true;
  }
  if (!rooms.last) rooms.last = inferHallFromGames(games);
  try {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  } catch { /* */ }
  if (rooms.tutorialDone) {
    if (typeof hideCoach === 'function') hideCoach();
    if (typeof coach === 'object') coach.active = false;
  }
  if (typeof renderRooms === 'function') renderRooms();
  if (!enter || net.active || net.code) return Boolean(rooms.last);
  if (rooms.last === 'free') {
    const f = rooms.free;
    cfg.room = null;
    cfg.mode = 'ai';
    cfg.level = AI_LEVELS[f.level] && f.level >= 1 && f.level <= 3 ? f.level : FREE_DEFAULT.level;
    if (HINT_MODES[f.hint]) cfg.hintLen = f.hint;
    if (TABLE_STATES[f.table]) setTable(f.table);
    cfg.zoneReturn = Boolean(f.zoneReturn);
    closeModal('rooms');
    if (typeof refreshControls === 'function') refreshControls();
    newGame();
    return true;
  }
  const idx = ROOMS.findIndex(r => r.id === rooms.last);
  if (idx >= 0 && roomOpen(idx, games)) {
    cfg.room = rooms.last;
    cfg.mode = 'ai';
    applyRoom();
    closeModal('rooms');
    if (typeof refreshControls === 'function') refreshControls();
    newGame();
    return true;
  }
  return false;
}

function settleHallsBoot() {
  const wait = Boolean(window._awaitHalls);
  window._awaitHalls = false;
  const picker = document.getElementById('rooms');
  const roomsOpen = picker && !picker.classList.contains('closed');
  const enter = wait || (roomsOpen && typeof partyStarted === 'function' && !partyStarted());
  if (applyCloudHalls({ enter }) && enter) return;
  if (wait) openRooms();
  else renderRooms();
}

function currentRoom() {
  return !net.active && cfg.mode === 'ai' && cfg.room ? ROOM_BY_ID[cfg.room] : null;
}

function roomWins(id, games = loadRecords()) {
  return games.filter(g => g.mode === 'ai' && g.room === id && gameResult(g) === 'win').length;
}

function roomGames(id, games = loadRecords()) {
  return games.filter(g => g.mode === 'ai' && g.room === id);
}

// Зал открыт, если в предыдущем набрано нужное число побед.
function roomOpen(i, games = loadRecords()) {
  if (i === 0) return true;
  return roomOpen(i - 1, games) && roomWins(ROOMS[i - 1].id, games) >= ROOMS[i].need;
}

function openRoomsCount(games = loadRecords()) {
  let n = 0;
  while (n < ROOMS.length && roomOpen(n, games)) n++;
  return n;
}

function randomTable() {
  const keys = Object.keys(TABLE_STATES);
  return keys[Math.floor(Math.random() * keys.length)];
}

// Ставит условия зала. Вызывается при входе в зал и перед каждой новой партией.
function applyRoom() {
  const room = currentRoom();
  if (!room) return;
  cfg.level = room.level;
  cfg.hintLen = room.hint;
  cfg.zoneReturn = Boolean(room.zoneReturn);
  setTable(room.table === 'random' ? randomTable() : room.table);
  const zoneBox = document.getElementById('optZoneReturn');
  if (zoneBox) zoneBox.checked = cfg.zoneReturn;
}

function rememberFree() {
  if (cfg.room || cfg.mode !== 'ai') return;
  rooms.free = { level: cfg.level, hint: cfg.hintLen, table: cfg.table, zoneReturn: cfg.zoneReturn };
}

function enterHall(id) {
  if (net.code) leaveRoom();
  rememberFree();
  if (id === 'free') {
    cfg.room = null;
    cfg.mode = 'ai';
    const f = rooms.free;
    cfg.level = AI_LEVELS[f.level] && f.level >= 1 && f.level <= 3 ? f.level : FREE_DEFAULT.level;
    if (HINT_MODES[f.hint]) cfg.hintLen = f.hint;
    if (TABLE_STATES[f.table]) setTable(f.table);
    cfg.zoneReturn = Boolean(f.zoneReturn);
  } else if (id === 'hotseat') {
    cfg.room = null;
    cfg.mode = 'hotseat';
  } else {
    if (!ROOM_BY_ID[id]) return;
    cfg.room = id;
    cfg.mode = 'ai';
    applyRoom();
  }
  rooms.last = id === 'hotseat' ? 'free' : id;
  saveRooms();
  closeModal('rooms');
  closeModal('gameOver');
  refreshControls();
  newGame();
}

// Свободный выбор уровня, подсказки или режима в настройках выводит из зала.
function leaveRoomToFree() {
  if (!cfg.room) return;
  cfg.room = null;
  if (!(cfg.level >= 1 && cfg.level <= 3)) cfg.level = rooms.free.level >= 1 && rooms.free.level <= 3 ? rooms.free.level : FREE_DEFAULT.level;
  cfg.zoneReturn = Boolean(rooms.free.zoneReturn);
  rooms.last = 'free';
  saveRooms();
}

function roomUndoBlocked() {
  const room = currentRoom();
  return Boolean(room && !room.undo);
}

function roomLabel() {
  const room = currentRoom();
  return room ? `${room.icon} ${room.name}` : '';
}

function roomXp(g) {
  const room = ROOM_BY_ID[g.room];
  if (!room) return null;
  const result = gameResult(g);
  if (result === 'win') return room.xpWin;
  if (result === 'loss') return room.xpLoss;
  return 1;
}

// После записанной партии: сообщить об открытом зале.
function noteRoomProgress(game) {
  if (!game?.room) return;
  const games = loadRecords();
  const before = openRoomsCount(games.filter(g => g.id !== game.id));
  const after = openRoomsCount(games);
  if (after > before) {
    const room = ROOMS[after - 1];
    roomUnlockedNotice = room.id;
  }
}
let roomUnlockedNotice = null;

// ----- Окно выбора зала: карточки, которые листаются -----
// Рисунки залов: тонкие линии, цвет задаёт карточка.
const ROOM_ART = {
  dacha: '<path d="M14 62h92"/><path d="M30 62V40l20-16 20 16v22"/><path d="M44 62V48h12v14"/><path d="M60 30v-8h5v12"/><circle cx="92" cy="20" r="7"/><path d="M88 62V46M88 46c-7 0-9-10-3-13 1-6 11-6 12 0 6 3 3 13-3 13"/>',
  yard: '<path d="M10 64h100"/><path d="M18 64V26h26v38M52 64V16h26v48"/><path d="M25 34h4M33 34h4M25 44h4M33 44h4M59 25h4M67 25h4M59 35h4M67 35h4M59 45h4M67 45h4"/><path d="M96 64V48M96 48c-8 0-9-11-2-14 2-7 12-5 12 2 5 4 1 12-5 12"/><path d="M84 64v-6h-6v6M76 58h10"/>',
  club: '<path d="M60 6v14"/><path d="M42 30c2-8 8-12 18-12s16 4 18 12z"/><path d="M48 34l-6 12M72 34l6 12M60 34v10" opacity=".55"/><rect x="24" y="48" width="72" height="10" rx="2"/><path d="M32 58v10M88 58v10"/><circle cx="46" cy="53" r="1.6"/><circle cx="60" cy="53" r="1.6"/><circle cx="74" cy="53" r="1.6"/>',
  city: '<path d="M8 66h104"/><path d="M16 66V40h16v26M36 66V28h14v38M54 66V18l8-8 8 8v48M74 66V34h14v32M92 66V44h12v22"/><path d="M62 10V4"/><path d="M22 47h4M22 55h4M41 36h4M41 46h4M41 56h4M60 26h4M60 36h4M60 46h4M79 42h4M79 52h4M96 51h4"/>',
  grand: '<path d="M44 14h32v16a16 16 0 0 1-32 0z"/><path d="M44 18H32c0 9 5 14 13 15M76 18h12c0 9-5 14-13 15"/><path d="M60 46v10M48 64h24M52 56h16v8H52z"/><path d="M60 21l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z"/><path d="M18 40l3 3M102 40l-3 3M14 26h4M102 26h4" opacity=".6"/>',
  free: '<circle cx="60" cy="38" r="24"/><circle cx="60" cy="38" r="14"/><circle cx="60" cy="38" r="4"/><path d="M60 8v10M60 58v10M30 38h10M80 38h10"/>',
  hotseat: '<circle cx="42" cy="26" r="10"/><path d="M22 62c0-12 9-18 20-18s20 6 20 18"/><circle cx="82" cy="30" r="8"/><path d="M70 46c3-2 7-3 12-3 10 0 17 6 17 17"/>',
};
const LOCK_ART = '<rect x="44" y="36" width="32" height="26" rx="4"/><path d="M50 36v-8a10 10 0 0 1 20 0v8"/><circle cx="60" cy="48" r="2.5"/><path d="M60 50.5V55"/>';

function roomArt(id, locked) {
  return `<svg viewBox="0 0 120 76" aria-hidden="true">${locked ? LOCK_ART : ROOM_ART[id]}</svg>`;
}

function pipsHtml(have, need) {
  let html = '';
  for (let k = 0; k < need; k++) html += `<i${k < have ? ' class="on"' : ''}></i>`;
  return `<span class="rc-pips">${html}</span>`;
}

function partyStarted() {
  // Партия начата, когда в ней был хотя бы один удар (трасса партии ведёт их счёт).
  return phase !== 'over' && typeof matchTrace !== 'undefined' && Boolean(matchTrace.game?.shots?.length);
}

function renderRooms() {
  const box = document.getElementById('roomsList');
  if (!box) return;
  const games = loadRecords();
  const open = openRoomsCount(games);
  const active = currentRoom()?.id || (cfg.mode === 'ai' ? 'free' : 'hotseat');
  const inGame = partyStarted();
  const actions = id => active === id && inGame
    ? `<button data-room-close>Продолжить</button><button class="primary" data-room="${id}">Заново</button>`
    : `<button class="primary" data-room="${id}">${active === id ? 'Играть ещё' : 'Войти'}</button>`;

  let html = '';
  ROOMS.forEach((room, i) => {
    const isOpen = i < open;
    const wins = roomWins(room.id, games);
    const played = roomGames(room.id, games).length;
    const next = ROOMS[i + 1];
    let progress;
    if (!isOpen) {
      const prev = ROOMS[i - 1];
      const have = Math.min(roomWins(prev.id, games), room.need);
      progress = `<div class="rc-progress">${pipsHtml(have, room.need)}<span>Нужно ${room.need} ${plural(room.need, 'победа', 'победы', 'побед')} в зале «${prev.name}»</span></div>`;
    } else if (next && i + 1 >= open) {
      progress = `<div class="rc-progress">${pipsHtml(Math.min(wins, next.need), next.need)}<span>до зала «${next.name}»</span></div>`;
    } else {
      progress = `<div class="rc-progress done"><span>${played ? `Побед: ${wins} из ${played}` : 'Зал пройден'}</span></div>`;
    }
    html += `<article class="rc${isOpen ? '' : ' shut'}${active === room.id ? ' here' : ''}${roomUnlockedNotice === room.id ? ' fresh' : ''}" data-card="${room.id}">` +
      `<div class="rc-art">${roomArt(room.id, !isOpen)}<span class="rc-no">Зал ${i + 1} из ${ROOMS.length}</span>` +
      (active === room.id ? '<span class="rc-here">вы здесь</span>' : '') + '</div>' +
      `<div class="rc-body"><h3>${room.name}</h3>` +
      '<div class="rc-chips">' +
      `<span>${AI_LEVELS[room.level].name}</span><span>${HINT_SHORT[room.hint]}</span>` +
      `<span>${room.table === 'random' ? 'натирка случайная' : TABLE_STATES[room.table].name.toLowerCase()}</span>` +
      (room.zoneReturn ? '<span>биток не в свою зону</span>' : '') + '</div>' +
      `<p>${room.note}</p>${progress}</div>` +
      `<div class="rc-foot"><div class="rc-xp"><b>+${room.xpWin}</b> за победу<br><b>+${room.xpLoss}</b> за поражение</div>` +
      `<div class="rc-actions">${isOpen ? actions(room.id) : '<button disabled>Закрыт</button>'}</div></div>` +
      '</article>';
  });
  const extra = [
    ['free', 'Свободная игра', ['соперник на выбор', 'подсказка на выбор', 'любой стол'],
      'Тренировка без лестницы: все условия вы задаёте сами в окне «Сложность». Очки идут по уровню соперника.'],
    ['hotseat', 'Вдвоём', ['одно устройство', 'ходы по очереди'],
      'Партия с тем, кто рядом: бьёте по очереди на одном экране. Очки не начисляются.'],
  ];
  for (const [id, name, chips, note] of extra) {
    html += `<article class="rc extra${active === id ? ' here' : ''}" data-card="${id}">` +
      `<div class="rc-art">${roomArt(id, false)}<span class="rc-no">Без лестницы</span>` +
      (active === id ? '<span class="rc-here">вы здесь</span>' : '') + '</div>' +
      `<div class="rc-body"><h3>${name}</h3><div class="rc-chips">${chips.map(c => `<span>${c}</span>`).join('')}</div><p>${note}</p></div>` +
      `<div class="rc-foot"><div class="rc-xp"></div><div class="rc-actions">${actions(id)}</div></div></article>`;
  }
  box.innerHTML = html;
  document.getElementById('roomsDots').innerHTML =
    [...box.children].map((c, k) => `<button data-go="${k}" aria-label="Карточка ${k + 1}"></button>`).join('');
  document.getElementById('roomsWarn').textContent = inGame
    ? 'Если войти в другой зал или начать заново, текущая партия прервётся и не попадёт в статистику.'
    : '';
  const focus = roomUnlockedNotice || active;
  roomUnlockedNotice = null;
  requestAnimationFrame(() => {
    const card = box.querySelector(`[data-card="${focus}"]`);
    if (card) roomsGo([...box.children].indexOf(card), false);
    markRoomPage();
  });
}

const HINT_SHORT = {
  off: 'без подсказки',
  short: 'короткая подсказка',
  mid: 'подсказка до касания',
  full: 'полная подсказка',
};

function roomsPage() {
  const box = document.getElementById('roomsList');
  const mid = box.scrollLeft + box.clientWidth / 2;
  let best = 0;
  let bestD = Infinity;
  [...box.children].forEach((c, k) => {
    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

function roomsGo(k, smooth = true) {
  const box = document.getElementById('roomsList');
  const card = box.children[Math.max(0, Math.min(box.children.length - 1, k))];
  if (!card) return;
  box.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - box.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
}

function markRoomPage() {
  const box = document.getElementById('roomsList');
  const k = roomsPage();
  [...box.children].forEach((c, n) => c.classList.toggle('cur', n === k));
  [...document.getElementById('roomsDots').children].forEach((d, n) => d.classList.toggle('on', n === k));
  document.getElementById('roomsPrev').disabled = k === 0;
  document.getElementById('roomsNext').disabled = k === box.children.length - 1;
}

function openRooms() {
  closeModal('gameOver');
  renderRooms();
  openModal('rooms');
}

{
  const box = document.getElementById('roomsList');
  box.addEventListener('click', e => {
    if (e.target.closest('[data-room-close]')) {
      closeModal('rooms');
      return;
    }
    const btn = e.target.closest('button[data-room]');
    if (btn) {
      enterHall(btn.dataset.room);
      return;
    }
    const card = e.target.closest('.rc');
    if (card && !card.classList.contains('cur')) roomsGo([...box.children].indexOf(card));
  });
  let raf = 0;
  box.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(markRoomPage);
  }, { passive: true });
  document.getElementById('roomsPrev').addEventListener('click', () => roomsGo(roomsPage() - 1));
  document.getElementById('roomsNext').addEventListener('click', () => roomsGo(roomsPage() + 1));
  document.getElementById('roomsDots').addEventListener('click', e => {
    const dot = e.target.closest('button[data-go]');
    if (dot) roomsGo(Number(dot.dataset.go));
  });
  document.addEventListener('keydown', e => {
    if (document.getElementById('rooms').classList.contains('closed')) return;
    if (e.key === 'ArrowLeft') roomsGo(roomsPage() - 1);
    if (e.key === 'ArrowRight') roomsGo(roomsPage() + 1);
  });
}

// ----- Конец партии: зал остаётся, пока игрок сам из него не выйдет -----
function showGameOver(game) {
  if (net.active || !game) return;
  const result = gameResult(game);
  const room = ROOM_BY_ID[game.room];
  const games = loadRecords();
  const title = result === 'win' ? 'Победа!' : result === 'loss' ? 'Поражение' : result === 'draw' ? 'Ничья'
    : `${PLAYERS[game.winner].name} победили`;
  let html = `<div class="go-score"><b>${game.score[0]}</b><span>:</span><b>${game.score[1]}</b></div>`;
  if (game.xp) html += `<div class="go-xp">+${game.xp} ${plural(game.xp, 'очко', 'очка', 'очков')}</div>`;
  let nextRoom = null;
  if (room) {
    const i = ROOMS.indexOf(room);
    const next = ROOMS[i + 1];
    const wins = roomWins(room.id, games);
    if (next && wins >= next.need) {
      const justOpened = result === 'win' && wins === next.need;
      if (justOpened) nextRoom = next;
      html += `<div class="go-line${justOpened ? ' gold' : ''}">${justOpened ? `Открыт зал «${next.name}»!` : `Зал «${next.name}» открыт`}</div>`;
    } else if (next) {
      html += `<div class="go-line">${pipsHtml(wins, next.need)} до зала «${next.name}»: ${wins} из ${next.need} ${plural(next.need, 'победы', 'побед', 'побед')}</div>`;
    }
  }
  document.getElementById('gameOverTitle').textContent = title;
  document.getElementById('gameOverRoom').textContent = room ? `${room.name} · зал ${ROOMS.indexOf(room) + 1}`
    : cfg.mode === 'ai' ? 'Свободная игра' : 'Вдвоём на одном устройстве';
  document.getElementById('gameOverBody').innerHTML = html;
  const nextBtn = document.getElementById('btnNextRoom');
  nextBtn.hidden = !nextRoom;
  if (nextRoom) {
    nextBtn.textContent = `В зал «${nextRoom.name}»`;
    nextBtn.dataset.room = nextRoom.id;
  }
  document.getElementById('btnAgain').className = nextRoom ? '' : 'primary';
  document.getElementById('gameOver').dataset.result = result;
  openModal('gameOver');
}

document.getElementById('btnAgain').addEventListener('click', () => {
  closeModal('gameOver');
  newGame();
});
document.getElementById('btnNextRoom').addEventListener('click', e => enterHall(e.currentTarget.dataset.room));
document.getElementById('btnLeaveRoom').addEventListener('click', openRooms);

// ----- Старт: первый вход — выбор зала, дальше — последний зал -----
loadRooms();
cfg.room = null;

function startFromRooms() {
  if (rooms.last && rooms.last !== 'free' && roomOpen(ROOMS.findIndex(r => r.id === rooms.last))) {
    cfg.room = rooms.last;
    cfg.mode = 'ai';
    applyRoom();
  } else if (rooms.last === 'free') {
    const f = rooms.free;
    if (f.level >= 1 && f.level <= 3) cfg.level = f.level;
    if (HINT_MODES[f.hint]) cfg.hintLen = f.hint;
    if (TABLE_STATES[f.table]) setTable(f.table);
    cfg.zoneReturn = Boolean(f.zoneReturn);
  } else {
    // Первый вход: сразу ставим Дачу, а поверх стола показываем залы.
    cfg.room = ROOMS[0].id;
    cfg.mode = 'ai';
    applyRoom();
    return true;
  }
  return false;
}
