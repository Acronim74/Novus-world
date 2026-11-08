'use strict';

// ===== Очки, уровень и оформление стола =====
const PROGRESS_KEY = 'novus.progress.v1';
const STAKE_OPTIONS = [10, 20, 40, 80];
const DEFAULT_STAKE = 20;

const COSMETIC_SLOTS = [
  { key: 'rail', list: 'rails', title: 'Борты' },
  { key: 'felt', list: 'felts', title: 'Поле' },
  { key: 'deco', list: 'decos', title: 'Украшения' },
  { key: 'cue', list: 'cues', title: 'Кий' },
  { key: 'pawns', list: 'pawns', title: 'Пешки' },
  { key: 'striker', list: 'strikers', title: 'Биток' },
];

const COSMETICS = {
  rails: [
    { id: 'oak', name: 'Дуб', level: 1, from: '#6b3f1f', to: '#4a2a12' },
    { id: 'walnut', name: 'Орех', level: 3, from: '#4a3420', to: '#2c1c10' },
    { id: 'black', name: 'Чёрный лак', level: 7, from: '#2a2a2e', to: '#111114' },
    { id: 'mahogany', name: 'Красное дерево', level: 12, from: '#7a2e22', to: '#4a1510' },
  ],
  felts: [
    { id: 'birch', name: 'Берёза', level: 1, fill: '#efe2c4', line: '#1b1b1b' },
    { id: 'club', name: 'Клубный', level: 2, fill: '#3d6b45', line: '#dce8c8' },
    { id: 'navy', name: 'Синий', level: 5, fill: '#2c4a6e', line: '#d0dce8' },
    { id: 'wine', name: 'Бордо', level: 10, fill: '#6b2a32', line: '#f0d8c8' },
    { id: 'night', name: 'Ночной', level: 15, fill: '#1c2430', line: '#8fa0aa' },
  ],
  decos: [
    { id: 'none', name: 'Без украшений', level: 1 },
    { id: 'corners', name: 'Латунные углы', level: 7, accent: '#c9a227' },
    { id: 'inlay', name: 'Инкрустация', level: 12, accent: '#e6c35c' },
  ],
  cues: [
    { id: 'maple', name: 'Клён', level: 1, tip: '#f3dfb7', shaft: '#8d5a2b' },
    { id: 'dark', name: 'Тёмный', level: 2, tip: '#d4b896', shaft: '#3e2723' },
    { id: 'black', name: 'Чёрный', level: 5, tip: '#eceff1', shaft: '#212121' },
    { id: 'carbon', name: 'Карбон', level: 10, tip: '#90caf9', shaft: '#263238' },
  ],
  pawns: [
    { id: 'classic', name: 'Классика', level: 1, colors: ['#b8322a', '#262626'] },
    { id: 'ivory', name: 'Бордо и кость', level: 3, colors: ['#8b1e3f', '#e8dcc8'] },
    { id: 'ocean', name: 'Океан', level: 8, colors: ['#00838f', '#1b4332'] },
    { id: 'gold', name: 'Золото и индиго', level: 10, colors: ['#c9a227', '#1a237e'] },
  ],
  strikers: [
    { id: 'boxwood', name: 'Самшит', level: 1, from: '#e6c48f', to: '#b8874c' },
    { id: 'ivory', name: 'Слоновая кость', level: 5, from: '#fff8e7', to: '#d4c4a8' },
    { id: 'ebony', name: 'Эбен', level: 12, from: '#6a6a6a', to: '#1a1a1a' },
  ],
};

const LOADOUT_DEFAULT = {
  rail: 'oak',
  felt: 'birch',
  deco: 'none',
  cue: 'maple',
  pawns: 'classic',
  striker: 'boxwood',
};

const progress = {
  at: 0,
  loadout: { ...LOADOUT_DEFAULT },
};

function clampStake(n) {
  const v = Number(n);
  if (STAKE_OPTIONS.includes(v)) return v;
  return DEFAULT_STAKE;
}

function xpForLevelGap(level) {
  return 30 + 15 * (level - 1);
}

function levelFromXp(xp) {
  let level = 1;
  let need = 0;
  const total = Math.max(0, Number(xp) || 0);
  while (level < 50) {
    const gap = xpForLevelGap(level);
    if (total < need + gap) {
      return { level, xp: total, into: total - need, need: gap };
    }
    need += gap;
    level++;
  }
  return { level: 50, xp: total, into: xpForLevelGap(50), need: xpForLevelGap(50) };
}

let cachedXpTotal = null;
let skinCache = null;

function invalidateProgressCache() {
  cachedXpTotal = null;
  skinCache = null;
}

function totalXp(games) {
  if (games) {
    cachedXpTotal = games.reduce((s, g) => s + (Number(g.xp) || 0), 0);
    skinCache = null;
    return cachedXpTotal;
  }
  if (cachedXpTotal != null) return cachedXpTotal;
  cachedXpTotal = loadRecords().reduce((s, g) => s + (Number(g.xp) || 0), 0);
  return cachedXpTotal;
}

function playerLevel(games) {
  return levelFromXp(totalXp(games));
}

function hintXpMul(hint) {
  const mul = HINT_MODES[hint]?.xpMul;
  return mul == null ? 1 : mul;
}

function scaleHintXp(base, hint, win) {
  const n = Math.round(Number(base) * hintXpMul(hint));
  if (win) return Math.max(1, n);
  return Math.max(0, n);
}

function aiXpPreview(level, hint) {
  const pack = AI_LEVELS[level] || AI_LEVELS[2];
  return {
    win: scaleHintXp(pack.xpWin, hint, true),
    loss: scaleHintXp(pack.xpLoss, hint, false),
  };
}

function xpForGame(g) {
  if (!g || g.mode === 'hotseat') return 0;
  const result = gameResult(g);
  if (g.mode === 'online') {
    if (result !== 'win') return 0;
    return clampStake(g.stake);
  }
  if (g.mode === 'ai') {
    const pack = AI_LEVELS[g.level] || AI_LEVELS[2];
    const hint = g.hint || 'short';
    if (result === 'win') return scaleHintXp(pack.xpWin, hint, true);
    if (result === 'loss') return scaleHintXp(pack.xpLoss, hint, false);
    return 1;
  }
  return 0;
}

function backfillGameXp(games) {
  let changed = false;
  for (const g of games) {
    if (g.xp != null) continue;
    g.xp = xpForGame(g);
    changed = true;
  }
  return changed;
}

function cosmeticById(list, id) {
  return COSMETICS[list].find(x => x.id === id) || COSMETICS[list][0];
}

function loadoutItem(slot) {
  const spec = COSMETIC_SLOTS.find(s => s.key === slot);
  return cosmeticById(spec.list, progress.loadout[slot]);
}

function isUnlocked(item, level) {
  return item.level <= level;
}

function skinFromIds(ids, level) {
  const src = { ...LOADOUT_DEFAULT, ...(ids || {}) };
  const pick = slot => {
    const spec = COSMETIC_SLOTS.find(s => s.key === slot);
    const item = cosmeticById(spec.list, src[slot]);
    return isUnlocked(item, level) ? item : COSMETICS[spec.list][0];
  };
  return {
    rail: pick('rail'),
    felt: pick('felt'),
    deco: pick('deco'),
    cue: pick('cue'),
    pawns: pick('pawns'),
    striker: pick('striker'),
  };
}

function exportTableSkin() {
  const skin = skinFromIds(progress.loadout, playerLevel().level);
  const ids = {};
  for (const spec of COSMETIC_SLOTS) ids[spec.key] = skin[spec.key].id;
  return ids;
}

function tableSkinCaption(ids) {
  const skin = skinFromIds(ids || exportTableSkin(), 99);
  return `${skin.rail.name}, ${skin.felt.name}, ${skin.deco.name}`;
}

function roomTableSkinIds() {
  if (typeof net === 'undefined' || !net.code || net.role === 'host' || !net.rules?.skin) return null;
  return net.rules.skin;
}

function tableSkin() {
  const remote = roomTableSkinIds();
  const level = remote ? 99 : playerLevel().level;
  const ids = remote || progress.loadout;
  const key = (remote ? 'r' : 'l') + ':' + level + ':' + COSMETIC_SLOTS.map(s => ids[s.key] || '').join(',');
  if (skinCache && skinCache._key === key) return skinCache;
  skinCache = skinFromIds(ids, level);
  skinCache._key = key;
  return skinCache;
}

function applyLoadout() {
  invalidateProgressCache();
  const pawns = tableSkin().pawns;
  PLAYERS[0].color = pawns.colors[0];
  PLAYERS[1].color = pawns.colors[1];
  if (typeof updatePanel === 'function') updatePanel();
}

function loadProgress() {
  try {
    const data = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (!data || typeof data !== 'object') return;
    progress.at = Number(data.at) || 0;
    progress.loadout = { ...LOADOUT_DEFAULT, ...(data.loadout || {}) };
  } catch {
    // без хранилища остаётся стол по умолчанию
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      version: 1,
      at: progress.at,
      loadout: progress.loadout,
    }));
  } catch {
    // как со статистикой
  }
}

function exportProgress() {
  return { version: 1, at: progress.at, loadout: progress.loadout };
}

function mergeProgress(remote) {
  if (!remote || typeof remote !== 'object') return;
  if ((Number(remote.at) || 0) > (progress.at || 0)) {
    invalidateProgressCache();
    progress.at = Number(remote.at) || 0;
    progress.loadout = { ...LOADOUT_DEFAULT, ...(remote.loadout || {}) };
    saveProgress();
    applyLoadout();
  }
}

function resetLoadout() {
  invalidateProgressCache();
  progress.at = Date.now();
  progress.loadout = { ...LOADOUT_DEFAULT };
  saveProgress();
  applyLoadout();
  if (typeof publishRoomTableSkin === 'function') publishRoomTableSkin();
}

function setLoadout(slot, id) {
  const spec = COSMETIC_SLOTS.find(s => s.key === slot);
  const item = cosmeticById(spec.list, id);
  if (!isUnlocked(item, playerLevel().level)) return;
  progress.loadout[slot] = item.id;
  progress.at = Date.now();
  saveProgress();
  applyLoadout();
  if (typeof pushAccountCloud === 'function') pushAccountCloud();
  if (typeof publishRoomTableSkin === 'function') publishRoomTableSkin();
  if (typeof renderAccount === 'function') renderAccount();
}

function itemsUnlockedAt(level) {
  const names = [];
  for (const spec of COSMETIC_SLOTS) {
    for (const item of COSMETICS[spec.list]) {
      if (item.level === level && item.id !== LOADOUT_DEFAULT[spec.key]) names.push(item.name);
    }
  }
  return names;
}

function noteProgressFromGames(games) {
  invalidateProgressCache();
  const last = games[games.length - 1];
  const xp = Number(last?.xp) || 0;
  if (!xp) return;
  const now = playerLevel(games);
  const prev = levelFromXp(now.xp - xp);
  if (typeof winnerText === 'string' && winnerText) {
    winnerText += `  +${xp}`;
    if (now.level > prev.level) winnerText += `  ур. ${now.level}`;
  }
  log(`+${xp} ${plural(xp, 'очко', 'очка', 'очков')}. Уровень ${now.level}.`, 'ok');
  if (now.level > prev.level) {
    const unlocked = itemsUnlockedAt(now.level);
    const extra = unlocked.length ? ` Открыто: ${unlocked.join(', ')}.` : '';
    toast = { text: `Уровень ${now.level}!${extra}`, cls: 'keep', until: performance.now() + 3200 };
  }
}

function swatchStyle(slot, item) {
  if (slot === 'rail' || slot === 'striker') {
    return `background:linear-gradient(135deg,${item.from},${item.to})`;
  }
  if (slot === 'felt') return `background:${item.fill}`;
  if (slot === 'cue') {
    return `background:linear-gradient(90deg,${item.tip},${item.shaft})`;
  }
  if (slot === 'pawns') {
    return `background:linear-gradient(90deg,${item.colors[0]} 50%,${item.colors[1]} 50%)`;
  }
  if (slot === 'deco') {
    return item.id === 'none' ? 'background:#313a40' : `background:${item.accent || '#c9a227'}`;
  }
  return '';
}

function renderTablePane() {
  const box = document.getElementById('cabTable');
  if (!box) return;
  const lv = playerLevel();
  const skin = skinFromIds(progress.loadout, lv.level);
  let html = `<p class="tip">Очки за партии поднимают уровень. На каждом уровне открываются борта, поле, кий, пешки и биток. С компьютером и вдвоём на одном устройстве стол видите только вы. В партии по сети оформление задаёт тот, кто создал комнату — оба игрока видят его стол.</p>`;
  html += `<div class="cab-section-head">Уровень <b>${lv.level}</b> · ${lv.into} / ${lv.need} до следующего</div>`;
  html += `<div class="xp-bar"><div style="width:${Math.round(lv.into / lv.need * 100)}%"></div></div>`;
  for (const spec of COSMETIC_SLOTS) {
    html += `<div class="cab-section-head">${spec.title}</div><div class="skins">`;
    for (const item of COSMETICS[spec.list]) {
      const open = isUnlocked(item, lv.level);
      const on = skin[spec.key].id === item.id && open;
      html += `<button type="button" class="skin${on ? ' on' : ''}${open ? '' : ' locked'}" data-slot="${spec.key}" data-id="${item.id}" ${open ? '' : 'disabled'}>` +
        `<div class="sw" style="${swatchStyle(spec.key, item)}"></div>` +
        `<div class="name">${escapeHtml(item.name)}</div>` +
        `<div class="need">${open ? (on ? 'выбран' : 'открыт') : `уровень ${item.level}`}</div></button>`;
    }
    html += '</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('.skin:not(.locked)').forEach(btn => {
    btn.addEventListener('click', () => setLoadout(btn.dataset.slot, btn.dataset.id));
  });
}

function xpBarHtml() {
  const lv = playerLevel();
  const pct = Math.round(lv.into / lv.need * 100);
  return `<div class="xp">` +
    `<div class="xp-top"><span>Уровень ${lv.level}</span><span>${lv.into} / ${lv.need}</span></div>` +
    `<div class="xp-bar"><div style="width:${pct}%"></div></div></div>`;
}

loadProgress();
const _bootGames = loadRecords();
if (backfillGameXp(_bootGames)) saveRecords(_bootGames);
applyLoadout();
