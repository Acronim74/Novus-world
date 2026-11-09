'use strict';

// ===== Залы: лестница партий с компьютером =====
// Каждый зал задаёт соперника, подсказку и стол. Следующий зал открывается победами в предыдущем.
// Свободная игра — прежний режим, где всё выбирается вручную.
const ROOMS_KEY = 'novus.rooms.v1';

const ROOMS = [
  { id: 'dacha', name: 'Дача', icon: '🏡', level: 0, hint: 'full', table: 'normal', need: 0, xpWin: 6, xpLoss: 2, undo: true,
    note: 'Учимся: подсказка показывает весь путь, соперник сам ещё учится, удар можно отменить.' },
  { id: 'yard', name: 'Двор', icon: '🌳', level: 1, hint: 'mid', table: 'worn', need: 2, xpWin: 12, xpLoss: 3,
    note: 'Подсказка до первого касания. Порошок стёрся — бить нужно сильнее.' },
  { id: 'club', name: 'Клуб', icon: '🎱', level: 2, hint: 'short', table: 'normal', need: 2, xpWin: 24, xpLoss: 5,
    note: 'Только направление удара. Соперник считает удары и бьёт точно.' },
  { id: 'city', name: 'Турнир города', icon: '🏙', level: 4, hint: 'short', table: 'fresh', need: 3, xpWin: 40, xpLoss: 7,
    note: 'Свежая натирка: всё катится далеко. Соперник почти мастер.' },
  { id: 'grand', name: 'Большой чемпионат', icon: '🏆', level: 3, hint: 'off', table: 'random', need: 3, xpWin: 70, xpLoss: 10,
    note: 'Без подсказки, как за настоящим столом. Натирка каждый раз своя.' },
];
const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));

// Свободная игра помнит свои настройки отдельно от залов.
const FREE_DEFAULT = { level: 2, hint: 'full', table: 'normal' };

const rooms = {
  last: null, // id зала, 'free' или null — ещё не выбирал (первый вход)
  free: { ...FREE_DEFAULT },
  tutorialDone: false,
};

function loadRooms() {
  try {
    const d = JSON.parse(localStorage.getItem(ROOMS_KEY));
    if (d && typeof d === 'object') {
      rooms.last = d.last === 'free' || ROOM_BY_ID[d.last] ? d.last : null;
      rooms.free = { ...FREE_DEFAULT, ...(d.free || {}) };
      rooms.tutorialDone = Boolean(d.tutorialDone);
    }
  } catch {
    // Хранилище недоступно — начнём с первого зала.
  }
}

function saveRooms() {
  try {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  } catch {
    // ничего страшного: выбор зала просто не запомнится
  }
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
  setTable(room.table === 'random' ? randomTable() : room.table);
}

function rememberFree() {
  if (cfg.room || cfg.mode !== 'ai') return;
  rooms.free = { level: cfg.level, hint: cfg.hintLen, table: cfg.table };
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
  refreshControls();
  newGame();
}

// Свободный выбор уровня, подсказки или режима в настройках выводит из зала.
function leaveRoomToFree() {
  if (!cfg.room) return;
  cfg.room = null;
  if (!(cfg.level >= 1 && cfg.level <= 3)) cfg.level = rooms.free.level >= 1 && rooms.free.level <= 3 ? rooms.free.level : FREE_DEFAULT.level;
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
    toast = { text: `Открыт зал «${room.name}»!`, cls: 'keep', until: performance.now() + 3600 };
    roomUnlockedNotice = room.id;
  }
}
let roomUnlockedNotice = null;

// ----- Окно выбора зала -----
function renderRooms() {
  const box = document.getElementById('roomsList');
  if (!box) return;
  const games = loadRecords();
  const open = openRoomsCount(games);
  const active = currentRoom()?.id || (cfg.mode === 'ai' ? 'free' : 'hotseat');
  const inGame = phase !== 'over' && stats.some(s => s.history.length);

  let html = '';
  ROOMS.forEach((room, i) => {
    const isOpen = i < open;
    const wins = roomWins(room.id, games);
    const played = roomGames(room.id, games).length;
    const next = ROOMS[i + 1];
    let progress = '';
    if (!isOpen) {
      const prev = ROOMS[i - 1];
      const have = roomWins(prev.id, games);
      progress = `Откроется после ${room.need} ${plural(room.need, 'победы', 'побед', 'побед')} в зале «${prev.name}» · сейчас ${Math.min(have, room.need)} из ${room.need}`;
    } else if (next && i + 1 >= open) {
      progress = `До зала «${next.name}»: ${Math.min(wins, next.need)} из ${next.need} ${plural(next.need, 'победы', 'побед', 'побед')}`;
    } else if (played) {
      progress = `Побед: ${wins} из ${played}`;
    }
    const fresh = roomUnlockedNotice === room.id ? ' fresh' : '';
    html += `<div class="room-card${isOpen ? '' : ' shut'}${active === room.id ? ' here' : ''}${fresh}">` +
      `<div class="room-icon">${isOpen ? room.icon : '🔒'}</div>` +
      `<div class="room-body"><div class="room-name">${i + 1}. ${room.name}</div>` +
      `<div class="room-meta">${AI_LEVELS[room.level].name} · ${HINT_SHORT[room.hint]} · ${room.table === 'random' ? 'натирка случайная' : TABLE_STATES[room.table].name.toLowerCase()}</div>` +
      `<div class="room-note">${room.note}</div>` +
      (progress ? `<div class="room-progress">${progress}</div>` : '') +
      `<div class="room-xp">Победа +${room.xpWin} · поражение +${room.xpLoss}</div></div>` +
      (isOpen ? `<button class="primary" data-room="${room.id}">${active === room.id && inGame ? 'Заново' : 'Играть'}</button>` : '') +
      '</div>';
  });
  html += '<div class="room-extra">' +
    `<button data-room="free"${active === 'free' ? ' class="here"' : ''}>🎯 Свободная игра<small>соперник, подсказка и стол — на выбор</small></button>` +
    `<button data-room="hotseat"${active === 'hotseat' ? ' class="here"' : ''}>👥 Вдвоём на одном устройстве<small>очки не начисляются</small></button>` +
    '</div>';
  box.innerHTML = html;
  document.getElementById('roomsWarn').textContent = inGame
    ? 'Текущая партия прервётся и не попадёт в статистику.'
    : '';
  roomUnlockedNotice = null;
}

const HINT_SHORT = {
  off: 'без подсказки',
  short: 'короткая подсказка',
  mid: 'подсказка до касания',
  full: 'полная подсказка',
};

function openRooms() {
  renderRooms();
  openModal('rooms');
}

document.getElementById('roomsList')?.addEventListener('click', e => {
  const btn = e.target.closest('button[data-room]');
  if (btn) enterHall(btn.dataset.room);
});

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
  } else {
    // Первый вход: сразу ставим Дачу, а поверх стола показываем залы.
    cfg.room = ROOMS[0].id;
    cfg.mode = 'ai';
    applyRoom();
    return true;
  }
  return false;
}
