'use strict';

// ===== Игра по сети =====
// Комната в базе: rooms/{код}
//   players {host, guest}  — uid игроков
//   names/{uid}, presence/{uid}
//   rules                  — условия игры, их выбирает создатель комнаты
//   game  {n, red, rules}  — номер партии в комнате, uid того, кто играет красными, и условия этой партии
//   shot  {n, seq, by, d}  — последний удар: где стояла шайба, направление, сила, зерно физики
//   state {n, seq, d}      — позиция после удара, её считает и присылает тот, кто бил
//   aim                    — прицел того, кто сейчас бьёт, чтобы соперник видел кий
//   react/{uid} {e, k}     — последняя реакция игрока (эмодзи) и её случайный ключ
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
  savedRules: null,
  reactSeen: null,
  reactAt: 0,
  cleanupArmed: null,
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
    const known = await new Promise(resolve => {
      const off = auth.onAuthStateChanged(u => {
        off();
        resolve(u);
      });
    });
    const user = known || (await auth.signInAnonymously()).user;
    this.db = firebase.database();
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
    renderOnline();
  }));
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
  const room = net.code && roomPath();
  const last = !net.peerOnline;
  for (const off of net.unsubs) off();
  net.unsubs = [];
  if (room) {
    net.backend.removeOnDisconnect(room, false);
    if (last) Promise.resolve(net.backend.set(room, null)).catch(() => {});
  }
  net.cleanupArmed = null;
  Object.assign(net, {
    active: false, code: null, role: null, peerUid: null, peerName: '', peerOnline: false,
    peerAiming: false, game: 0, seq: 0, myShotSeq: 0, replaySeq: 0, pendingState: null, rules: null,
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
    current, debt, stats, lastShot, winnerText, firstShooter, lostTurn, setWinner,
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
  const params = new URLSearchParams(location.search);
  params.set('room', net.code);
  return `${location.origin}${location.pathname}?${params}`;
}

function renderOnline() {
  document.getElementById('btnOnline').innerHTML = net.code
    ? `🌐 <span class="full">Комната ${net.code}</span><span class="short">${net.code}</span>`
    : '🌐 <span class="full">Играть по сети с другом</span><span class="short">По сети</span>';
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
      '<div class="tip">Появятся код и ссылка — отправьте их другу.</div></section>' +
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
    `<div class="room-code">Комната <b>${net.code}</b></div>` +
    `<div class="join"><input id="netLink" readonly value="${escapeHtml(roomLink())}"><button id="netCopy">Копировать</button></div>` +
    (navigator.share ? '<button id="netShare" class="primary">Отправить ссылку…</button>' : '') +
    `<div class="peer">${peer}</div>` +
    (net.active ? `<div class="note">Вы играете ${net.seat === 0 ? 'красными' : 'чёрными'}. Партия №${net.game}.</div>` : '') +
    (net.rules
      ? '<div class="rules"><div class="head">Условия игры' +
        (net.role === 'host' ? '<button id="netRules">Изменить</button>' : '') +
        `</div><ul>${rulesLines(net.rules).map(l => `<li>${l}</li>`).join('')}</ul></div>`
      : '') +
    err +
    '<button id="netLeave">Выйти из комнаты</button>';
  document.getElementById('netRules')?.addEventListener('click', () => openRulesDialog('edit'));
  document.getElementById('netCopy').addEventListener('click', async e => {
    const input = document.getElementById('netLink');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    e.target.textContent = 'Скопировано';
  });
  document.getElementById('netShare')?.addEventListener('click', () => {
    navigator.share({ title: 'Новус', text: `Сыграем в новус? Код комнаты ${net.code}`, url: roomLink() }).catch(() => {});
  });
  document.getElementById('netLeave').addEventListener('click', () => {
    if (net.active && phase !== 'over' && !confirm('Выйти из сетевой партии?')) return;
    leaveRoom();
  });
}

// ----- Окно «Условия игры»: создатель комнаты выбирает их перед созданием и может поменять потом -----
const RULE_NAMES = {
  table: { fresh: 'свежая', normal: 'обычная', worn: 'стёрлась', bare: 'без порошка' },
  hintLen: { off: 'нет', short: 'короткая', mid: 'до касания', full: 'с отскоками' },
};
const rulesDialog = document.getElementById('roomRules');
let rulesDraft = null;
let rulesMode = 'create';

function rulesLines(r) {
  return [
    `Время на удар: ${Number(r.shotTime) ? `${r.shotTime} с` : 'без лимита'}`,
    `Натирка стола: ${RULE_NAMES.table[r.table] || r.table}`,
    `Помощь при прицеливании: ${RULE_NAMES.hintLen[r.hintLen] || r.hintLen}`,
    `Центральный круг — ${r.circleDark !== false ? 'тёмное поле' : 'светлое поле'}`,
    r.freePlace ? 'Шайбу можно ставить на всей своей половине' : 'Шайба ставится в бортовой зоне',
  ];
}

function renderRulesDraft() {
  for (const seg of rulesDialog.querySelectorAll('.seg[data-key]')) {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(rulesDraft[seg.dataset.key]));
  }
  for (const box of rulesDialog.querySelectorAll('input[data-key]')) box.checked = Boolean(rulesDraft[box.dataset.key]);
}

function openRulesDialog(mode) {
  rulesMode = mode;
  rulesDraft = { ...(mode === 'edit' && net.rules ? net.rules : currentRules()) };
  document.getElementById('btnRulesOk').textContent = mode === 'edit' ? 'Сохранить' : 'Создать комнату';
  document.getElementById('rulesNote').textContent = mode === 'edit' && net.active
    ? 'Новые условия начнут действовать со следующей партии.'
    : '';
  renderRulesDraft();
  rulesDialog.classList.remove('closed');
}

for (const seg of rulesDialog.querySelectorAll('.seg[data-key]')) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    rulesDraft[seg.dataset.key] = seg.dataset.key === 'shotTime' ? Number(b.dataset.v) : b.dataset.v;
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
  if (rulesMode === 'edit') net.backend.set(roomPath('rules'), rules);
  else runOnline(() => createRoom(rules));
});

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
