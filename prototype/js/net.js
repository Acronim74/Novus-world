'use strict';

// ===== Игра по сети =====
// Комната в базе: rooms/{код}
//   players {host, guest}  — uid игроков
//   names/{uid}, presence/{uid}
//   rules                  — действующие условия и оформление стола
//   proposal {by, rules, at} — предложение сменить условия: действует только после согласия второго
//   game  {n, red, rules}  — номер партии в комнате, uid того, кто играет красными, и условия этой партии
//   shot  {n, seq, by, d}  — последний удар: где стояла шайба, направление, сила, зерно физики
//   state {n, seq, d}      — позиция после удара, её считает и присылает тот, кто бил
//   aim                    — прицел того, кто сейчас бьёт, чтобы соперник видел кий
//   react/{uid} {e, k}     — последняя реакция игрока (эмодзи) и её случайный ключ
//   match {n, scores}      — счёт сетов комнаты по uid; сбрасывается при выходе
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const NAME_KEY = 'novus.name';

const net = {
  active: false,
  seat: 0,
  code: null,
  uid: null,
  role: null,
  peerUid: null,
  peerName: '',
  peerOnline: false,
  peerAiming: false,
  game: 0,
  red: null,
  seq: 0,
  myShotSeq: 0,
  replaySeq: 0,
  pendingState: null,
  syncing: false,
  backend: null,
  unsubs: [],
  lastAim: '',
  rules: null,
  proposal: null,
  offerShown: 0,
  savedRules: null,
  reactSeen: null,
  reactAt: 0,
  cleanupArmed: null,
  match: {},
  matchCounted: 0,
};

// ----- Хранилище: Firebase или, для проверки, общая память вкладок одного браузера -----
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(s);
  });
}

const firebaseBackend = {
  async init() {
    if (!FIREBASE_CONFIG.databaseURL) throw new Error('Сетевая игра ещё не настроена: нет адреса базы.');
    if (!window.firebase?.database) {
      for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js']) {
        await loadScript(FIREBASE_SDK + f);
      }
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const auth = firebase.auth();
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch {
      // Старые WebView без постоянного хранилища — вход всё равно попробуем.
    }
    try {
      await auth.getRedirectResult();
    } catch (err) {
      window._authRedirectError = err;
    }
    const known = auth.currentUser || await new Promise(resolve => {
      const off = auth.onAuthStateChanged(u => {
        off();
        resolve(u);
      });
    });
    const user = known || (await auth.signInAnonymously()).user;
    this.db = firebase.database();
    auth.onAuthStateChanged(u => {
      if (!u) return;
      net.uid = u.uid;
      if (typeof onAccountAuth === 'function') onAccountAuth(u);
    });
    return user.uid;
  },
  async get(path) {
    return (await this.db.ref(path).get()).val();
  },
  set(path, value) {
    return this.db.ref(path).set(value);
  },
  update(path, value) {
    return this.db.ref(path).update(value);
  },
  on(path, cb) {
    const ref = this.db.ref(path);
    const handler = snap => cb(snap.val());
    ref.on('value', handler);
    return () => ref.off('value', handler);
  },
  // Отметка «в сети», которую сервер сам снимет при обрыве связи; ставится заново после переподключения.
  presence(path) {
    const connected = this.db.ref('.info/connected');
    const handler = snap => {
      if (snap.val() !== true) return;
      const ref = this.db.ref(path);
      ref.onDisconnect().remove();
      ref.set(true);
    };
    this.presencePath = path;
    connected.on('value', handler);
    return () => {
      connected.off('value', handler);
      this.presencePath = null;
      this.db.ref(path).onDisconnect().cancel();
      this.db.ref(path).remove();
    };
  },
  // Сервер удалит запись сам, когда этот игрок отключится (закрыл вкладку, пропала связь).
  removeOnDisconnect(path, on) {
    const ref = this.db.ref(path);
    if (on) {
      ref.onDisconnect().remove().catch(() => {});
      return;
    }
    // cancel() снимает и вложенные отложенные записи, поэтому отметку «в сети» ставим заново.
    ref.onDisconnect().cancel();
    if (this.presencePath?.startsWith(`${path}/`)) this.db.ref(this.presencePath).onDisconnect().remove();
  },
};

const LOCAL_DB_KEY = 'novus.localdb';

const localBackend = {
  async init() {
    this.subs = [];
    this.channel = new BroadcastChannel('novus-localdb');
    this.channel.onmessage = () => this.fire();
    let uid = sessionStorage.getItem('novus.localuid');
    if (!uid) {
      uid = `local-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem('novus.localuid', uid);
    }
    return uid;
  },
  read() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_DB_KEY)) || {};
    } catch {
      return {};
    }
  },
  write(db) {
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
    this.channel.postMessage(1);
    this.fire();
  },
  at(db, path) {
    return path.split('/').reduce((o, k) => (o == null ? null : o[k]), db) ?? null;
  },
  put(db, path, value) {
    const keys = path.split('/');
    let o = db;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    if (value == null) delete o[keys.at(-1)];
    else o[keys.at(-1)] = JSON.parse(JSON.stringify(value));
  },
  async get(path) {
    return this.at(this.read(), path);
  },
  async set(path, value) {
    const db = this.read();
    this.put(db, path, value);
    this.write(db);
  },
  async update(path, value) {
    const db = this.read();
    for (const [k, v] of Object.entries(value)) this.put(db, `${path}/${k}`, v);
    this.write(db);
  },
  on(path, cb) {
    const sub = { path, cb, last: undefined };
    this.subs.push(sub);
    setTimeout(() => this.fireOne(sub));
    return () => {
      this.subs = this.subs.filter(s => s !== sub);
    };
  },
  fire() {
    for (const s of [...this.subs]) this.fireOne(s);
  },
  fireOne(sub) {
    const json = JSON.stringify(this.at(this.read(), sub.path));
    if (json === sub.last) return;
    sub.last = json;
    sub.cb(JSON.parse(json));
  },
  presence(path) {
    this.set(path, true);
    const drop = () => {
      const db = this.read();
      this.put(db, path, null);
      this.write(db);
    };
    window.addEventListener('pagehide', drop);
    return () => {
      window.removeEventListener('pagehide', drop);
      drop();
    };
  },
  removeOnDisconnect() {},
};

async function netBackend() {
  if (!net.backend) {
    const backend = new URLSearchParams(location.search).get('net') === 'local' ? localBackend : firebaseBackend;
    net.uid = await backend.init();
    net.backend = backend;
  }
  return net.backend;
}

function roomPath(sub = '') {
  return `rooms/${net.code}${sub ? `/${sub}` : ''}`;
}

function normalizeCode(text) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function randomCode() {
  return Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
}

function myName() {
  return (localStorage.getItem(NAME_KEY) || '').trim().slice(0, 20);
}

// ----- Комната -----
async function createRoom(rules) {
  const db = await netBackend();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    if (await db.get(`rooms/${code}/players`)) continue;
    await db.update(`rooms/${code}`, { 'players/host': net.uid, created: Date.now() });
    // Отдельной записью: правила базы пускают в комнату только после того, как хозяин записан.
    await db.set(`rooms/${code}/rules`, rules);
    return enterRoom(code, 'host');
  }
  throw new Error('Не удалось создать комнату, попробуйте ещё раз.');
}

async function joinRoom(rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length < 4) throw new Error('Введите код комнаты.');
  const db = await netBackend();
  const players = await db.get(`rooms/${code}/players`);
  if (!players?.host) throw new Error(`Комната ${code} не найдена.`);
  if (players.host === net.uid) return enterRoom(code, 'host');
  if (players.guest === net.uid) return enterRoom(code, 'guest');
  if (players.guest) throw new Error(`В комнате ${code} уже играют двое.`);
  await db.set(`rooms/${code}/players/guest`, net.uid);
  return enterRoom(code, 'guest');
}

function enterRoom(code, role) {
  const db = net.backend;
  net.code = code;
  net.role = role;
  net.game = 0;
  net.match = {};
  net.matchCounted = 0;
  net.cleanupArmed = null;
  history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({
    ...Object.fromEntries(new URLSearchParams(location.search)), room: code,
  })}`);
  if (myName()) db.set(roomPath(`names/${net.uid}`), myName());
  net.savedRules ??= currentRules();

  net.unsubs.push(db.presence(roomPath(`presence/${net.uid}`)));
  net.unsubs.push(db.on(roomPath('players'), onPlayers));
  net.unsubs.push(db.on(roomPath('names'), names => {
    net.peerName = (net.peerUid && names?.[net.peerUid]) || '';
    updatePanel();
    renderOnline();
  }));
  net.unsubs.push(db.on(roomPath('presence'), presence => {
    const was = net.peerOnline;
    net.peerOnline = Boolean(net.peerUid && presence?.[net.peerUid]);
    if (was !== net.peerOnline && net.active) log(net.peerOnline ? 'Соперник в сети.' : 'Соперник отключился.', 'info');
    // Комнату каждый раз создают заново: кто отключится последним, тот её и удалит.
    if (net.cleanupArmed !== !net.peerOnline) {
      net.cleanupArmed = !net.peerOnline;
      db.removeOnDisconnect(roomPath(), net.cleanupArmed);
    }
    updatePanel();
    renderOnline();
  }));
  net.unsubs.push(db.on(roomPath('rules'), rules => {
    net.rules = rules;
    if (typeof applyLoadout === 'function') applyLoadout();
    renderOnline();
  }));
  net.unsubs.push(db.on(roomPath('proposal'), onRuleProposal));
  net.unsubs.push(db.on(roomPath('match'), onMatch));
  net.unsubs.push(db.on(roomPath('game'), onGame));
  net.unsubs.push(db.on(roomPath('shot'), onShot));
  net.unsubs.push(db.on(roomPath('state'), onState));
  net.unsubs.push(db.on(roomPath('aim'), onAim));
  net.reactSeen = null;
  net.unsubs.push(db.on(roomPath('react'), onReact));
  renderOnline();
}

function onPlayers(players) {
  if (!players) return;
  net.peerUid = (net.role === 'host' ? players.guest : players.host) || null;
  // Жребий: хозяин комнаты решает, кто играет красными и бьёт первым.
  if (net.role === 'host' && players.guest && !net.game) {
    net.backend.get(roomPath('game')).then(g => {
      if (!g) startRoomGame(1, Math.random() < 0.5 ? players.host : players.guest);
    });
  }
  renderOnline();
}

// Условия комнаты едут вместе с партией, чтобы оба начали её по одним правилам.
function startRoomGame(n, red) {
  return net.backend.set(roomPath('game'), { n, red, rules: net.rules || currentRules() });
}

function onMatch(m) {
  net.match = m?.scores && typeof m.scores === 'object' ? m.scores : {};
  net.matchCounted = m?.n || 0;
  updatePanel();
  renderOnline();
}

function matchPoints(uid) {
  return (uid && net.match[uid]) || 0;
}

function matchPair() {
  const red = matchPoints(net.red);
  const blackUid = net.red && (net.red === net.uid ? net.peerUid : net.uid);
  return [red, matchPoints(blackUid)];
}

function matchLabel() {
  const [red, black] = matchPair();
  return `${red}:${black}`;
}

function addMatchPoint(winnerSeat) {
  if (!net.active || net.matchCounted === net.game) return;
  if (winnerSeat !== 0 && winnerSeat !== 1) return;
  const uid = winnerSeat === 0 ? net.red : (net.red === net.uid ? net.peerUid : net.uid);
  if (!uid) return;
  const scores = { ...net.match, [uid]: matchPoints(uid) + 1 };
  net.match = scores;
  net.matchCounted = net.game;
  net.backend.set(roomPath('match'), { n: net.game, scores });
}

async function onGame(g) {
  if (!g || g.n === net.game) return;
  net.game = g.n;
  net.red = g.red;
  net.seat = g.red === net.uid ? 0 : 1;
  net.active = true;
  if (g.rules) applyRules(g.rules);
  net.seq = 0;
  net.myShotSeq = 0;
  net.replaySeq = 0;
  net.pendingState = null;
  net.peerAiming = false;
  closeOnline();
  closeDrawer();
  newGame();
  log(`Партия по сети №${g.n}: вы играете ${net.seat === 0 ? 'красными и бьёте первыми' : 'чёрными, первыми бьют красные'}.`, 'info');
  toast = { text: net.seat === 0 ? 'Вы — красные, ваш удар' : 'Вы — чёрные, первым бьёт соперник', cls: 'pass', until: performance.now() + 3000 };
  // После перезагрузки страницы сначала восстанавливаем позицию, потом — удар, если он ещё не досчитан.
  net.syncing = true;
  const [st, last] = await Promise.all([net.backend.get(roomPath('state')), net.backend.get(roomPath('shot'))]);
  net.syncing = false;
  if (g.n !== net.game) return;
  if (st && st.n === net.game) applyState(st);
  if (last) onShot(last);
}

function leaveRoom() {
  closeModal('ruleOffer');
  closeModal('roomRules');
  const room = net.code && roomPath();
  const last = !net.peerOnline;
  for (const off of net.unsubs) off();
  net.unsubs = [];
  if (room) {
    net.backend.removeOnDisconnect(room, false);
    if (last) Promise.resolve(net.backend.set(room, null)).catch(() => {});
    else Promise.resolve(net.backend.set(`${room}/match`, null)).catch(() => {});
  }
  net.cleanupArmed = null;
  Object.assign(net, {
    active: false, code: null, role: null, peerUid: null, peerName: '', peerOnline: false,
    peerAiming: false, game: 0, seq: 0, myShotSeq: 0, replaySeq: 0, pendingState: null, rules: null,
    proposal: null, offerShown: 0, match: {}, matchCounted: 0,
  });
  if (net.savedRules) applyRules(net.savedRules);
  net.savedRules = null;
  const params = new URLSearchParams(location.search);
  params.delete('room');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  renderOnline();
  newGame();
}

function netNewGame() {
  // Цвета меняются: в следующей партии первым бьёт другой игрок.
  startRoomGame(net.game + 1, net.red === net.uid ? net.peerUid : net.uid);
}

// ----- Удары -----
function syncedCfg() {
  return {
    muStriker: cfg.muStriker, muPawn: cfg.muPawn, puckE: cfg.puckE, railE: cfg.railE,
    railTangent: cfg.railTangent, vMax: cfg.vMax, climbPawn: cfg.climbThr.pawn,
    circleDark: cfg.circleDark, freePlace: cfg.freePlace,
  };
}

function applyCfg(c) {
  if (!c) return;
  Object.assign(cfg, {
    muStriker: c.muStriker, muPawn: c.muPawn, puckE: c.puckE, railE: c.railE,
    railTangent: c.railTangent, vMax: c.vMax, circleDark: c.circleDark, freePlace: c.freePlace,
  });
  cfg.climbThr.pawn = c.climbPawn;
}

function netShotStarted(seed) {
  if (!net.active || current !== net.seat) return;
  net.seq++;
  net.myShotSeq = net.seq;
  net.backend.set(roomPath('shot'), {
    n: net.game, seq: net.seq, by: net.seat,
    d: JSON.stringify({ x: striker.x, y: striker.y, dx: aim.dirX, dy: aim.dirY, p: aim.power, seed, cfg: syncedCfg() }),
  });
}

function serializeState() {
  return {
    bodies: bodies.map(b => [b.x, b.y, b.state]),
    current, debt, stats, lastShot, winnerText, firstShooter, lostTurn, darkMisses, setWinner,
    match: { n: net.matchCounted, scores: net.match },
    over: phase === 'over',
  };
}

// Время вышло у того, кто бьёт: он же судит и рассылает позицию, как после удара.
function netTimedOut() {
  net.seq++;
  net.myShotSeq = net.seq;
  timeoutShot();
  netShotResolved();
}

function netShotResolved() {
  if (!net.active || !net.myShotSeq) return;
  net.backend.set(roomPath('state'), { n: net.game, seq: net.myShotSeq, d: JSON.stringify(serializeState()) });
  net.myShotSeq = 0;
}

function onShot(s) {
  if (!net.active || net.syncing || !s || s.n !== net.game || s.seq <= net.seq || s.by === net.seat) return;
  if (phase === 'moving') return;
  const d = JSON.parse(s.d);
  applyCfg(d.cfg);
  current = s.by;
  striker.x = d.x;
  striker.y = d.y;
  aim.dirX = d.dx;
  aim.dirY = d.dy;
  aim.power = d.p;
  net.peerAiming = false;
  net.replaySeq = s.seq;
  shoot(d.seed);
}

function onState(st) {
  if (!net.active || net.syncing || !st || st.n !== net.game || st.seq <= net.seq) return;
  if (net.replaySeq === st.seq && phase === 'moving') {
    net.pendingState = st;
    return;
  }
  applyState(st);
}

function netRemoteShotStopped() {
  if (!net.active || !net.replaySeq) return false;
  if (net.pendingState) {
    const st = net.pendingState;
    net.pendingState = null;
    applyState(st);
  }
  return true;
}

function applyState(st) {
  const d = JSON.parse(st.d);
  net.seq = st.seq;
  net.replaySeq = 0;
  net.pendingState = null;
  d.bodies.forEach(([x, y, state], i) => Object.assign(bodies[i], {
    x, y, state, vx: 0, vy: 0, z: 0, vz: 0, sink: 0, sinkV: 0, climb: null, outSide: null,
  }));
  current = d.current;
  debt = d.debt;
  stats = d.stats;
  lastShot = d.lastShot;
  winnerText = d.winnerText;
  if (d.firstShooter != null) firstShooter = d.firstShooter;
  if (d.lostTurn) lostTurn = d.lostTurn;
  if (d.darkMisses) darkMisses = d.darkMisses;
  if (d.match?.scores) {
    net.match = d.match.scores;
    net.matchCounted = d.match.n || net.matchCounted;
  }
  shot = null;
  net.peerAiming = false;
  if (lastShot) {
    toast = { text: lastShot.verdict.text, cls: lastShot.verdict.cls, until: performance.now() + 2600 };
    for (const it of lastShot.items) log(it.text, it.cls === 'bad' ? 'foul' : it.cls === 'ok' ? 'ok' : 'info');
    log(lastShot.verdict.text, lastShot.verdict.cls === 'foul' ? 'foul' : 'info');
  }
  if (d.over) {
    phase = 'over';
    setWinner = d.setWinner;
    const left = [pawnsOnTable(0) + debt[0], pawnsOnTable(1) + debt[1]];
    recordGame(d.setWinner === undefined
      ? (left[0] === 0 && left[1] === 0 ? null : left[0] === 0 ? 0 : 1)
      : d.setWinner, left.map(n => 8 - n));
    updatePanel();
  } else {
    startTurn();
  }
}

// Прицел того, кто бьёт, уходит сопернику несколько раз в секунду.
setInterval(() => {
  if (!net.active || phase !== 'place' || current !== net.seat) return;
  const r = v => Math.round(v * 1000) / 1000;
  const a = { x: r(striker.x), y: r(striker.y), dx: r(aim.dirX), dy: r(aim.dirY), p: r(aim.power) };
  const json = JSON.stringify(a);
  if (json === net.lastAim) return;
  net.lastAim = json;
  net.backend.set(roomPath('aim'), a);
}, 120);

function onAim(a) {
  if (!net.active || !a || phase !== 'remote') return;
  striker.x = a.x;
  striker.y = a.y;
  aim.dirX = a.dx;
  aim.dirY = a.dy;
  aim.power = a.p;
  net.peerAiming = true;
  updatePower();
}

// ----- Реакции -----
const REACTIONS = ['👍', '👏', '🔥', '😮', '😅', '😂', '😬', '😡', '🤝', '🍀'];
const reactBar = document.getElementById('reactBar');
reactBar.innerHTML = REACTIONS.map(e => `<button data-e="${e}">${e}</button>`).join('');

function onReact(all) {
  // Старые реакции, лежащие в комнате при входе, не показываем.
  if (!net.reactSeen) {
    net.reactSeen = Object.fromEntries(Object.entries(all || {}).map(([uid, r]) => [uid, r?.k]));
    return;
  }
  const r = net.peerUid && all?.[net.peerUid];
  if (!r || r.k === net.reactSeen[net.peerUid]) return;
  net.reactSeen[net.peerUid] = r.k;
  if (REACTIONS.includes(r.e)) showReaction(r.e, false);
}

function sendReaction(e) {
  const now = performance.now();
  if (!net.code || !net.peerUid || now - net.reactAt < 1200) return;
  net.reactAt = now;
  net.backend.set(roomPath(`react/${net.uid}`), { e, k: Math.random().toString(36).slice(2, 10) });
  showReaction(e, true);
}

// Свою сторону стола в сетевой партии каждый видит снизу: реакция соперника всплывает у верхнего борта.
function showReaction(e, mine) {
  const el = document.createElement('div');
  el.className = `float-react ${mine ? 'mine' : 'peer'}`;
  el.innerHTML = `<span class="e"></span><span class="who"></span>`;
  el.querySelector('.e').textContent = e;
  el.querySelector('.who').textContent = mine ? 'Вы' : net.peerName || 'Соперник';
  document.getElementById('stage').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function toggleReactBar(btn) {
  if (!reactBar.classList.contains('closed')) {
    reactBar.classList.add('closed');
    return;
  }
  reactBar.classList.remove('closed');
  const r = btn.getBoundingClientRect();
  const w = reactBar.offsetWidth;
  reactBar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  reactBar.style.top = `${Math.max(8, r.top - reactBar.offsetHeight - 8)}px`;
}

for (const id of ['btnReact', 'btnReactTouch']) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    toggleReactBar(btn);
  });
}
reactBar.addEventListener('click', e => {
  const b = e.target.closest('button[data-e]');
  if (!b) return;
  reactBar.classList.add('closed');
  sendReaction(b.dataset.e);
});
document.addEventListener('pointerdown', e => {
  if (!reactBar.contains(e.target) && !e.target.closest('.react')) reactBar.classList.add('closed');
});

// ----- Окно «Игра по сети» -----
const onlineDialog = document.getElementById('online');
let onlineBusy = false;
let onlineError = '';

function roomLink() {
  const u = new URL(location.href);
  const local = u.searchParams.get('net');
  u.search = '';
  if (local) u.searchParams.set('net', local);
  u.searchParams.set('room', net.code);
  return u.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function markCopied(btn, ok) {
  const prev = btn.dataset.label || btn.textContent;
  btn.dataset.label = prev;
  btn.textContent = ok ? 'Скопировано' : 'Не вышло';
  setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600);
}

async function shareRoomInvite() {
  const url = roomLink();
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Новус',
        text: `Сыграем в новус. Код комнаты ${net.code}`,
        url,
      });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const btn = document.getElementById('netShare');
  markCopied(btn, await copyText(url));
}

function inviteMarkup() {
  const url = roomLink();
  let qr = '';
  try {
    qr = typeof qrSvg === 'function' ? qrSvg(url) : '';
  } catch {
    qr = '';
  }
  return `<div class="invite${net.peerUid ? ' compact' : ''}">` +
    (qr ? `<div class="invite-qr">${qr}</div>` : '') +
    '<div class="invite-side">' +
    `<div class="room-code">Комната <b>${net.code}</b></div>` +
    (net.peerUid
      ? ''
      : '<p class="tip">Покажите картинку или код другу: камера телефона откроет игру, мессенджер не нужен.</p>') +
    '<div class="invite-actions">' +
    '<button type="button" id="netCopy">Скопировать ссылку</button>' +
    '<button type="button" id="netCopyCode">Скопировать код</button>' +
    '<button type="button" id="netShare" class="primary">Поделиться</button>' +
    '</div>' +
    `<input id="netLink" class="invite-link" readonly value="${escapeHtml(url)}">` +
    '</div></div>';
}

function renderOnline() {
  document.getElementById('btnOnline').innerHTML = net.code
    ? `${ICON.globe}<span class="full">Комната ${net.code}</span><span class="short">${net.code}</span>`
    : `${ICON.globe}<span class="full">Игра по сети</span><span class="short">По сети</span>`;
  document.getElementById('tabOnlineLabel').textContent = net.code || 'По сети';
  document.getElementById('tabOnline').classList.toggle('live', Boolean(net.code));
  document.body.classList.toggle('net', Boolean(net.code && net.peerUid));
  if (!net.peerUid) reactBar.classList.add('closed');
  const box = document.getElementById('onlineBody');
  if (!box) return;
  const err = onlineError ? `<div class="net-error">${escapeHtml(onlineError)}</div>` : '';
  const busy = onlineBusy ? ' disabled' : '';
  if (!net.code) {
    const nameField = '<label class="field">Ваше имя<input class="netName" maxlength="20" placeholder="необязательно" autocomplete="nickname"></label>';
    box.innerHTML =
      '<div class="halves">' +
      '<section class="half"><h3>Создать комнату</h3>' + nameField +
      `<button id="netCreate" class="primary"${busy}>Создать комнату</button>` +
      '<div class="tip">Появятся код и картинка — покажите их другу в браузере, мессенджер не нужен.</div></section>' +
      '<section class="half"><h3>Войти в комнату</h3>' + nameField +
      '<label class="field">Код комнаты<input id="netCode" maxlength="7" placeholder="например K7P4Q" autocapitalize="characters" autocomplete="off"></label>' +
      `<button id="netJoin" class="primary"${busy}>Войти</button></section>` +
      '</div>' + err;
    const names = [...box.querySelectorAll('.netName')];
    for (const name of names) {
      name.value = myName();
      name.addEventListener('input', () => {
        for (const other of names) if (other !== name) other.value = name.value;
        localStorage.setItem(NAME_KEY, name.value.trim());
      });
    }
    document.getElementById('netCreate').addEventListener('click', () => openRulesDialog('create'));
    const code = document.getElementById('netCode');
    const join = () => runOnline(() => joinRoom(code.value));
    document.getElementById('netJoin').addEventListener('click', join);
    code.addEventListener('keydown', e => {
      if (e.key === 'Enter') join();
    });
    return;
  }
  const peer = !net.peerUid
    ? '<span class="dot wait"></span>Ждём соперника — отправьте ему ссылку или код'
    : `<span class="dot ${net.peerOnline ? 'on' : 'off'}"></span>${escapeHtml(net.peerName || 'Соперник')} ${net.peerOnline ? 'в сети' : 'не в сети'}`;
  box.innerHTML =
    inviteMarkup() +
    `<div class="peer">${peer}</div>` +
    `<div class="match-bar">Счёт комнаты <b>${matchLabel()}</b></div>` +
    (net.active ? `<div class="note">Вы играете ${net.seat === 0 ? 'красными' : 'чёрными'}. Партия №${net.game}.</div>` : '') +
    (net.rules
      ? '<div class="rules"><div class="head">Условия игры' +
        (canOfferRoomRules() ? '<button id="netRules">Изменить</button>' : '') +
        `</div><ul>${rulesLines(net.rules).map(l => `<li>${l}</li>`).join('')}</ul></div>`
      : '') +
    ruleOfferBanner() +
    err +
    '<button id="netLeave">Выйти из комнаты</button>';
  document.getElementById('netRules')?.addEventListener('click', () => openRulesDialog('edit'));
  document.getElementById('netOfferAccept')?.addEventListener('click', () => runOnline(acceptRuleOffer));
  document.getElementById('netOfferReject')?.addEventListener('click', () => runOnline(rejectRuleOffer));
  document.getElementById('netOfferWithdraw')?.addEventListener('click', () => runOnline(withdrawRuleOffer));
  document.getElementById('netCopy').addEventListener('click', async e => {
    markCopied(e.currentTarget, await copyText(roomLink()));
  });
  document.getElementById('netCopyCode').addEventListener('click', async e => {
    markCopied(e.currentTarget, await copyText(net.code));
  });
  document.getElementById('netShare').addEventListener('click', () => shareRoomInvite());
  document.getElementById('netLeave').addEventListener('click', () => {
    if (net.active && phase !== 'over' && !confirm('Выйти из сетевой партии?')) return;
    leaveRoom();
  });
}

// ----- Окно «Условия игры»: перед созданием комнаты — сразу, в комнате — только с согласия обоих -----
const RULE_NAMES = {
  table: { fresh: 'свежая', normal: 'обычная', worn: 'стёрлась', bare: 'без порошка' },
  hintLen: { off: 'нет', short: 'короткая', mid: 'до касания', full: 'с отскоками' },
};
const rulesDialog = document.getElementById('roomRules');
const ruleOfferDialog = document.getElementById('ruleOffer');
let rulesDraft = null;
let rulesMode = 'create';

function rulesLines(r) {
  if (!r) return [];
  const skin = typeof tableSkinCaption === 'function' ? tableSkinCaption(r.skin) : '';
  return [
    `Очки за победу: ${typeof clampStake === 'function' ? clampStake(r.stake) : (Number(r.stake) || 20)}`,
    `Время на удар: ${Number(r.shotTime) ? `${r.shotTime} с` : 'без лимита'}`,
    `Натирка стола: ${RULE_NAMES.table[r.table] || r.table}`,
    skin ? `Оформление стола: ${skin}` : '',
    `Помощь при прицеливании: ${RULE_NAMES.hintLen[r.hintLen] || r.hintLen}`,
    `Центральный круг — ${r.circleDark !== false ? 'тёмное поле' : 'светлое поле'}`,
    r.freePlace ? 'Шайбу можно ставить на всей своей половине' : 'Шайба ставится в бортовой зоне',
    r.zoneReturn ? 'Шайба не должна возвращаться в свою зону (п. 18.1.5)' : 'Обратный ход шайбы в свою зону разрешён',
  ].filter(Boolean);
}

function sanitizeRules(r) {
  const out = {
    shotTime: Number(r?.shotTime) || 0,
    table: TABLE_STATES[r?.table] ? r.table : 'normal',
    hintLen: HINT_MODES[r?.hintLen] ? r.hintLen : 'full',
    circleDark: r?.circleDark !== false,
    freePlace: Boolean(r?.freePlace),
    zoneReturn: Boolean(r?.zoneReturn),
    stake: typeof clampStake === 'function' ? clampStake(r?.stake) : (Number(r?.stake) || 20),
  };
  if (r?.skin && typeof r.skin === 'object') out.skin = r.skin;
  return out;
}

function rulesKey(r) {
  const s = sanitizeRules(r);
  const skin = s.skin ? Object.keys(s.skin).sort().map(k => s.skin[k]).join(',') : '';
  return [s.stake, s.shotTime, s.table, s.hintLen, s.circleDark, s.freePlace, s.zoneReturn, skin].join('|');
}

function canOfferRoomRules() {
  if (!net.code || !net.rules) return false;
  if (incomingRuleOffer()) return false;
  return Boolean(net.peerUid) || net.role === 'host';
}

function incomingRuleOffer() {
  return Boolean(net.proposal?.by && net.proposal.by !== net.uid && net.proposal.rules);
}

function myRuleOffer() {
  return Boolean(net.proposal?.by && net.proposal.by === net.uid);
}

function renderRulesDraft() {
  for (const seg of rulesDialog.querySelectorAll('.seg[data-key]')) {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(rulesDraft[seg.dataset.key]));
  }
  for (const box of rulesDialog.querySelectorAll('input[data-key]')) box.checked = Boolean(rulesDraft[box.dataset.key]);
}

function openRulesDialog(mode) {
  if (mode === 'edit' && incomingRuleOffer()) {
    maybeShowRuleOffer(true);
    return;
  }
  rulesMode = mode;
  rulesDraft = { ...(mode === 'edit' && net.rules ? net.rules : currentRules()) };
  if (typeof exportTableSkin === 'function' && (mode !== 'edit' || net.role === 'host')) {
    rulesDraft.skin = exportTableSkin();
  }
  const needConfirm = mode === 'edit' && net.peerUid;
  document.getElementById('btnRulesOk').textContent = mode === 'create'
    ? 'Создать комнату'
    : needConfirm ? 'Предложить сопернику' : 'Сохранить';
  const skin = typeof tableSkinCaption === 'function' ? tableSkinCaption(rulesDraft.skin) : '';
  let note = '';
  if (mode === 'edit' && net.active) note = 'Новые условия начнут действовать со следующей партии. ';
  if (needConfirm) {
    note += 'Соперник должен подтвердить. Если не подтвердит, условия останутся прежними. ';
  }
  if (skin && (mode !== 'edit' || net.role === 'host')) {
    note += `Оформление стола — из вашего кабинета: ${skin}. Соперник увидит этот стол.`;
  }
  document.getElementById('rulesNote').textContent = note.trim();
  renderRulesDraft();
  rulesDialog.classList.remove('closed');
}

function publishRoomTableSkin() {
  if (net.role !== 'host' || !net.code || !net.backend || typeof exportTableSkin !== 'function') return;
  const skin = exportTableSkin();
  if (net.rules) net.rules.skin = skin;
  net.backend.set(roomPath('rules/skin'), skin);
}

async function proposeRoomRules(raw) {
  const rules = sanitizeRules(raw);
  if (net.role === 'host' && typeof exportTableSkin === 'function') rules.skin = exportTableSkin();
  else if (net.rules?.skin) rules.skin = net.rules.skin;
  if (!net.peerUid) {
    await net.backend.set(roomPath('rules'), rules);
    log('Условия комнаты обновлены.', 'ok');
    return;
  }
  if (incomingRuleOffer()) {
    throw new Error('Сначала ответьте на предложение соперника.');
  }
  if (rulesKey(rules) === rulesKey(net.rules)) {
    log('Условия те же — предлагать нечего.', 'info');
    return;
  }
  await net.backend.set(roomPath('proposal'), { by: net.uid, rules, at: Date.now() });
  log('Предложение отправлено. Пока соперник не подтвердит, условия прежние.', 'info');
}

async function acceptRuleOffer() {
  const p = net.proposal;
  if (!p?.rules || p.by === net.uid) return;
  const rules = sanitizeRules(p.rules);
  // Оформление стола задаёт хозяин: если предлагает гость, стол не меняем.
  if (net.role === 'host' && net.rules?.skin) rules.skin = net.rules.skin;
  await net.backend.set(roomPath('rules'), rules);
  await net.backend.set(roomPath('proposal'), null);
  closeModal('ruleOffer');
  log('Новые условия приняты. Они войдут в силу со следующей партии.', 'ok');
}

async function rejectRuleOffer() {
  if (!net.proposal) return;
  await net.backend.set(roomPath('proposal'), null);
  closeModal('ruleOffer');
  log('Предложение отклонено, условия прежние.', 'info');
}

async function withdrawRuleOffer() {
  if (!myRuleOffer()) return;
  await net.backend.set(roomPath('proposal'), null);
  log('Предложение отозвано, условия прежние.', 'info');
}

function fillRuleOffer() {
  const p = net.proposal;
  if (!p?.rules) return;
  document.getElementById('ruleOfferText').textContent =
    `${net.peerName || 'Соперник'} предлагает изменить условия. Если отклоните — останутся прежние. Новые войдут в силу со следующей партии.`;
  document.getElementById('ruleOfferList').innerHTML = rulesLines(p.rules).map(l => `<li>${l}</li>`).join('');
}

function maybeShowRuleOffer(force = false) {
  if (!incomingRuleOffer()) {
    ruleOfferDialog.classList.add('closed');
    return;
  }
  fillRuleOffer();
  if (!force && net.active && phase !== 'over') return;
  if (!force && net.offerShown === net.proposal.at) return;
  net.offerShown = net.proposal.at;
  ruleOfferDialog.classList.remove('closed');
}

function onRuleProposal(p) {
  const prev = net.proposal?.at;
  net.proposal = p?.by && p.rules ? p : null;
  if (!net.proposal) net.offerShown = 0;
  renderOnline();
  if (incomingRuleOffer()) {
    fillRuleOffer();
    if (prev !== net.proposal.at) log('Соперник предлагает новые условия.', 'info');
    maybeShowRuleOffer();
  } else {
    ruleOfferDialog.classList.add('closed');
  }
}

function ruleOfferBanner() {
  if (incomingRuleOffer()) {
    return '<div class="offer-banner">' +
      '<div>Соперник предлагает новые условия. Пока вы не подтвердите, играют прежние.</div>' +
      '<div class="offer-actions"><button id="netOfferReject">Оставить как было</button>' +
      '<button id="netOfferAccept" class="primary">Принять</button></div></div>';
  }
  if (myRuleOffer()) {
    return '<div class="offer-banner wait">' +
      '<div>Предложение отправлено. Ждём согласия. Пока его нет, условия прежние.</div>' +
      '<div class="offer-actions"><button id="netOfferWithdraw">Отозвать</button></div></div>';
  }
  return '';
}

for (const seg of rulesDialog.querySelectorAll('.seg[data-key]')) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    rulesDraft[seg.dataset.key] = seg.dataset.key === 'shotTime' || seg.dataset.key === 'stake'
      ? Number(b.dataset.v)
      : b.dataset.v;
    renderRulesDraft();
  });
}
for (const box of rulesDialog.querySelectorAll('input[data-key]')) {
  box.addEventListener('change', () => {
    rulesDraft[box.dataset.key] = box.checked;
  });
}
document.getElementById('btnRulesOk').addEventListener('click', () => {
  rulesDialog.classList.add('closed');
  const rules = { ...rulesDraft };
  if (rulesMode === 'edit') runOnline(() => proposeRoomRules(rules));
  else runOnline(() => createRoom(rules));
});
document.getElementById('btnRuleAccept').addEventListener('click', () => runOnline(acceptRuleOffer));
document.getElementById('btnRuleReject').addEventListener('click', () => runOnline(rejectRuleOffer));

async function runOnline(action) {
  onlineBusy = true;
  onlineError = '';
  renderOnline();
  try {
    await action();
  } catch (e) {
    onlineError = e?.code === 'PERMISSION_DENIED' || /permission/i.test(e?.message)
      ? 'Сервер отказал в доступе. Проверьте код комнаты; если ошибка повторяется, проверьте правила базы в Firebase.'
      : e?.message || String(e);
  }
  onlineBusy = false;
  renderOnline();
}

function openOnline() {
  renderOnline();
  onlineDialog.classList.remove('closed');
}

function closeOnline() {
  onlineDialog.classList.add('closed');
}

for (const id of ['btnOnline', 'tabOnline']) {
  document.getElementById(id).addEventListener('click', () => {
    closeDrawer();
    openOnline();
  });
}
document.getElementById('btnOnlineClose').addEventListener('click', closeOnline);
for (const id of ['turn', 'mini']) {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.closest('.netline')) openOnline();
  });
}
onlineDialog.addEventListener('click', e => {
  if (e.target === onlineDialog) closeOnline();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeOnline();
});

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  openOnline();
  runOnline(() => joinRoom(roomFromUrl));
}
