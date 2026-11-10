'use strict';

// ===== Кабинет: карточка игрока, партии, призы, вход (Google или почта) =====
const PRIZES_KEY = 'novus.prizes.v1';
const PRIZES = [
  { id: 'first', ico: '🏆', name: 'Первая победа', hint: 'Выиграйте любой сет' },
  { id: 'online', ico: '🌐', name: 'По сети', hint: 'Выиграйте сет у живого соперника' },
  { id: 'amateur', ico: '🎯', name: 'Любитель', hint: 'Победите компьютер на уровне «Любитель»' },
  { id: 'master', ico: '🥇', name: 'Мастер', hint: 'Победите компьютер на уровне «Мастер»' },
  { id: 'streak3', ico: '🔥', name: 'Серия из трёх', hint: 'Три победы подряд против компьютера или по сети' },
  { id: 'games10', ico: '🔟', name: '10 партий', hint: 'Сыграйте 10 сетов' },
  { id: 'games50', ico: '⭐', name: '50 партий', hint: 'Сыграйте 50 сетов' },
  { id: 'clean', ico: '8️⃣', name: 'Все 8', hint: 'Выиграйте сет со счётом 8 : 0' },
];

const account = {
  user: null,
  prizes: {},
  busy: false,
  error: '',
  notice: '',
  tab: 'player',
};

function accountSignedIn() {
  return Boolean(account.user && !account.user.isAnonymous);
}

function loadPrizes() {
  try {
    const data = JSON.parse(localStorage.getItem(PRIZES_KEY));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function savePrizes(prizes) {
  account.prizes = prizes;
  try {
    localStorage.setItem(PRIZES_KEY, JSON.stringify(prizes));
  } catch {
    // как со статистикой: без хранилища призы просто не запомнятся
  }
}

function rankedGames(games) {
  return games.filter(g => g.mode !== 'hotseat');
}

function prizeUnlocked(games, id) {
  const ranked = rankedGames(games);
  if (id === 'first') return ranked.some(g => gameResult(g) === 'win');
  if (id === 'online') return games.some(g => g.mode === 'online' && gameResult(g) === 'win');
  if (id === 'amateur') return games.some(g => g.mode === 'ai' && g.level >= 2 && gameResult(g) === 'win');
  if (id === 'master') return games.some(g => g.mode === 'ai' && g.level === 3 && gameResult(g) === 'win');
  if (id === 'streak3') return streaks(ranked).best >= 3;
  if (id === 'games10') return ranked.length >= 10;
  if (id === 'games50') return ranked.length >= 50;
  if (id === 'clean') return ranked.some(g => gameResult(g) === 'win' && g.score[mySeat(g)] === 8 && g.score[1 - mySeat(g)] === 0);
  return false;
}

function playerRank(games) {
  const ranked = rankedGames(games);
  if (prizeUnlocked(games, 'master')) return { name: 'Мастер', cls: 'gold' };
  if (ranked.length >= 50) return { name: 'Ветеран', cls: 'gold' };
  if (prizeUnlocked(games, 'amateur')) return { name: 'Любитель', cls: 'green' };
  if (prizeUnlocked(games, 'first')) return { name: 'Игрок', cls: 'green' };
  if (ranked.length) return { name: 'Новичок', cls: '' };
  return { name: 'Новичок', cls: '' };
}

function playerInitials() {
  const n = (myName() || account.user?.displayName || '').trim();
  if (!n) return 'Н';
  const parts = n.split(/\s+/);
  if (parts.length >= 2 && parts[0][0] && parts[1][0]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return n.slice(0, 2).toUpperCase();
}

function mergePrizes(a, b) {
  return { ...a, ...b };
}

function mergeGames(a, b) {
  const map = new Map();
  for (const g of [...a, ...b]) {
    if (g && g.id) map.set(g.id, g);
  }
  return [...map.values()].sort((x, y) => x.at - y.at).slice(-RECORDS_LIMIT);
}

function authMessage(err) {
  const code = err?.code || '';
  if (code === 'auth/popup-blocked') return 'Телефон закрыл окно Google. Разрешите всплывающие окна для этого сайта и нажмите ещё раз.';
  if (code === 'auth/popup-closed-by-user') return 'Окно входа закрыли. Попробуйте ещё раз.';
  if (code === 'auth/operation-not-allowed') return 'В консоли Firebase нужно включить вход через Google и через почту (Authentication → Sign-in method).';
  if (code === 'auth/unauthorized-domain') return 'Этот адрес сайта ещё не разрешён в Firebase: Authentication → Settings → Authorized domains.';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Неверная почта или пароль.';
  if (code === 'auth/user-not-found') return 'Аккаунта с этой почтой нет. Нажмите «Создать аккаунт».';
  if (code === 'auth/email-already-in-use') return 'Эта почта уже занята. Войдите с паролем.';
  if (code === 'auth/weak-password') return 'Пароль слишком короткий: нужно не меньше 6 символов.';
  if (code === 'auth/invalid-email') return 'Похоже, почта написана с ошибкой.';
  if (code === 'auth/network-request-failed') return 'Нет связи с сервером. Проверьте интернет.';
  if (code === 'auth/credential-already-in-use') return 'Этот Google уже используется. Нажмите «Войти через Google» ещё раз — откроется тот же аккаунт.';
  if (code === 'auth/requires-recent-login') return 'Чтобы удалить аккаунт, нужно войти ещё раз — так Google и почта подтверждают, что это вы.';
  return err?.message || String(err);
}

function accountPath(sub) {
  return `users/${account.user.uid}/${sub}`;
}

function accountBlocked() {
  if (new URLSearchParams(location.search).get('net') === 'local') {
    return 'Кабинет работает с облаком. Откройте игру без ?net=local.';
  }
  if (net.code) return 'Сначала выйдите из комнаты — вход меняет аккаунт.';
  return '';
}

async function cloudGet(sub) {
  if (!net.backend?.get || !accountSignedIn()) return null;
  return net.backend.get(accountPath(sub));
}

function cloudSet(sub, value) {
  if (!net.backend?.set || !accountSignedIn()) return;
  net.backend.set(accountPath(sub), value);
}

let cloudTimer = 0;
function pushAccountCloud() {
  if (!accountSignedIn()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    cloudSet('records', { version: 1, games: loadRecords() });
    cloudSet('prizes', account.prizes);
    if (typeof exportProgress === 'function') cloudSet('progress', exportProgress());
    const name = myName();
    const lv = typeof playerLevel === 'function' ? playerLevel() : null;
    cloudSet('public', {
      name,
      at: Date.now(),
      photo: account.user.photoURL || '',
      ...(lv ? { level: lv.level, xp: lv.xp } : {}),
    });
  }, 400);
}

async function pullAccountCloud() {
  if (!accountSignedIn()) return;
  const [remoteRecords, remotePrizes, pub, remoteProgress] = await Promise.all([
    cloudGet('records'),
    cloudGet('prizes'),
    cloudGet('public'),
    cloudGet('progress'),
  ]);
  const mergedGames = mergeGames(loadRecords(), Array.isArray(remoteRecords?.games) ? remoteRecords.games : []);
  if (typeof backfillGameXp === 'function') backfillGameXp(mergedGames);
  saveRecords(mergedGames);
  if (typeof invalidateProgressCache === 'function') invalidateProgressCache();
  const mergedPrizes = mergePrizes(loadPrizes(), remotePrizes && typeof remotePrizes === 'object' ? remotePrizes : {});
  savePrizes(mergedPrizes);
  if (typeof mergeProgress === 'function') mergeProgress(remoteProgress);
  if (pub?.name && !myName()) {
    localStorage.setItem(NAME_KEY, String(pub.name).slice(0, 20));
  }
  refreshAccountPrizes(mergedGames);
  pushAccountCloud();
  renderRecords();
}

function refreshAccountPrizes(games) {
  const have = { ...loadPrizes() };
  let fresh = null;
  for (const prize of PRIZES) {
    if (have[prize.id] || !prizeUnlocked(games, prize.id)) continue;
    have[prize.id] = { at: Date.now() };
    if (!fresh) fresh = prize;
  }
  savePrizes(have);
  if (fresh) {
    toast = { text: `Приз: ${fresh.name}`, cls: 'keep', until: performance.now() + 2800 };
    log(`Получен приз «${fresh.name}».`, 'ok');
  }
}

function onGamesChanged(games) {
  if (typeof noteProgressFromGames === 'function') noteProgressFromGames(games);
  refreshAccountPrizes(games);
  pushAccountCloud();
  renderAccount();
}

async function onAccountAuth(user) {
  const wasGuest = !accountSignedIn();
  account.user = user || null;
  account.prizes = loadPrizes();
  if (accountSignedIn()) {
    if (!myName() && user.displayName) {
      localStorage.setItem(NAME_KEY, user.displayName.trim().slice(0, 20));
    }
    try {
      await pullAccountCloud();
    } catch (e) {
      account.error = authMessage(e);
    }
    account.notice = '';
    if (wasGuest && account.tab === 'auth') account.tab = 'player';
  }
  renderAccount();
  renderRecords();
}

async function withAccount(action) {
  if (new URLSearchParams(location.search).get('net') === 'local') {
    account.error = 'Кабинет работает с облаком. Откройте игру без ?net=local.';
    account.tab = 'auth';
    renderAccount();
    return;
  }
  if (net.code) {
    account.error = 'Сначала выйдите из комнаты — вход меняет аккаунт.';
    account.tab = 'auth';
    renderAccount();
    return;
  }
  account.busy = true;
  account.error = '';
  account.notice = '';
  renderAccount();
  try {
    await netBackend();
    await action();
  } catch (e) {
    account.error = authMessage(e);
  }
  account.busy = false;
  renderAccount();
}

function googleProvider() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

async function signInGoogle() {
  const blocked = accountBlocked();
  if (blocked) {
    account.error = blocked;
    account.tab = 'auth';
    renderAccount();
    return;
  }
  account.error = '';
  account.notice = '';
  // Окно Google нужно открыть сразу по нажатию. Если сначала ждать сеть, телефон блокирует вход.
  if (!window.firebase?.auth) {
    account.notice = 'Подключаемся к серверу… нажмите «Войти через Google» ещё раз.';
    account.tab = 'auth';
    renderAccount();
    try {
      await netBackend();
      account.notice = 'Готово — нажмите «Войти через Google» ещё раз.';
    } catch (e) {
      account.notice = '';
      account.error = authMessage(e);
    }
    renderAccount();
    return;
  }
  const auth = firebase.auth();
  const provider = googleProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      localStorage.setItem('novus.authRedirect', '1');
      await auth.signInWithRedirect(provider);
      return;
    }
    if (e.code === 'auth/popup-closed-by-user') {
      account.error = 'Окно Google закрылось. На телефоне разрешите всплывающие окна для этого сайта и нажмите ещё раз.';
    } else {
      account.error = authMessage(e);
    }
    account.tab = 'auth';
    renderAccount();
  }
}

async function signInEmail(create) {
  const email = document.getElementById('accEmail')?.value.trim() || '';
  const password = document.getElementById('accPass')?.value || '';
  if (!email || !password) {
    account.error = 'Введите почту и пароль.';
    account.tab = 'auth';
    renderAccount();
    return;
  }
  await withAccount(async () => {
    const auth = firebase.auth();
    if (!create) {
      await auth.signInWithEmailAndPassword(email, password);
      return;
    }
    try {
      await auth.createUserWithEmailAndPassword(email, password);
    } catch (e) {
      if (e.code !== 'auth/email-already-in-use') throw e;
      await auth.signInWithEmailAndPassword(email, password);
    }
  });
}

async function signOutAccount() {
  await withAccount(async () => {
    await firebase.auth().signOut();
    await firebase.auth().signInAnonymously();
    account.notice = 'Вы вышли. Статистика на этом устройстве осталась, в облаке — на аккаунте.';
    account.tab = 'player';
  });
}

async function reauthenticate(user) {
  const google = user.providerData.some(p => p.providerId === 'google.com');
  if (google) {
    await user.reauthenticateWithPopup(googleProvider());
    return;
  }
  const email = user.email;
  const password = prompt('Чтобы удалить аккаунт, введите пароль от этой почты.') || '';
  if (!email || !password) throw new Error('Без пароля аккаунт удалить нельзя.');
  const cred = firebase.auth.EmailAuthProvider.credential(email, password);
  await user.reauthenticateWithCredential(cred);
}

async function deleteAccount() {
  if (!accountSignedIn()) return;
  if (net.code) {
    account.error = 'Сначала выйдите из комнаты.';
    account.tab = 'auth';
    renderAccount();
    return;
  }
  if (!confirm('Удалить аккаунт безвозвратно?\n\nОблачная статистика и призы исчезнут на всех устройствах. Записи на этом телефоне или компьютере останутся, как у гостя.')) return;
  await withAccount(async () => {
    const user = firebase.auth().currentUser;
    const uid = user.uid;
    await net.backend.set(`users/${uid}`, null);
    try {
      await user.delete();
    } catch (e) {
      if (e.code !== 'auth/requires-recent-login') throw e;
      await reauthenticate(firebase.auth().currentUser);
      await net.backend.set(`users/${uid}`, null);
      await firebase.auth().currentUser.delete();
    }
    await firebase.auth().signInAnonymously();
    account.notice = 'Аккаунт удалён. На этом устройстве можно играть как гость.';
    account.tab = 'player';
  });
}

function accountStatus() {
  if (!accountSignedIn()) {
    return 'Гость — статистика только в этом браузере.';
  }
  const mail = account.user.email || 'Google';
  return `Вход: ${mail}. На другом устройстве войдите тем же Google или той же почтой — статистика и призы подтянутся.`;
}

function prizesHtml() {
  return PRIZES.map(p => {
    const got = account.prizes[p.id];
    const when = got?.at ? formatWhen(got.at) : '';
    return `<div class="prize${got ? '' : ' off'}" title="${escapeHtml(p.hint)}">` +
      `<div class="ico">${p.ico}</div><div class="name">${escapeHtml(p.name)}</div>` +
      `<div class="hint">${got ? `получен${when ? ' · ' + when : ''}` : escapeHtml(p.hint)}</div></div>`;
  }).join('');
}

function bindNameField() {
  const name = document.getElementById('accName');
  if (!name) return;
  name.value = myName();
  name.addEventListener('change', () => {
    localStorage.setItem(NAME_KEY, name.value.trim());
    if (net.code && net.backend) net.backend.set(roomPath(`names/${net.uid}`), myName());
    pushAccountCloud();
    renderAccount();
  });
}

function showCabinetTab() {
  document.querySelectorAll('#cabTabs button').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.cab === account.tab);
  });
  document.querySelectorAll('#account .cab-pane').forEach(pane => {
    pane.classList.toggle('on', pane.dataset.cab === account.tab);
  });
}

function renderCabinetTabs() {
  const bar = document.getElementById('cabTabs');
  if (!bar) return;
  const tabs = [
    ['player', 'Игрок'],
    ['games', 'Партии'],
    ['trace', 'Трасса'],
    ['table', 'Стол'],
    ['prizes', 'Призы'],
    ['auth', accountSignedIn() ? 'Аккаунт' : 'Вход'],
  ];
  bar.innerHTML = tabs.map(([id, label]) =>
    `<button type="button" role="tab" data-cab="${id}" class="${account.tab === id ? 'on' : ''}">${label}</button>`
  ).join('');
  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      account.tab = btn.dataset.cab;
      showCabinetTab();
    });
  });
}

function renderPlayerPane() {
  const box = document.getElementById('cabPlayer');
  if (!box) return;
  const games = loadRecords();
  const ranked = rankedGames(games);
  const s = summarize(ranked);
  const { run, best } = streaks(ranked);
  const rank = playerRank(games);
  const got = PRIZES.filter(p => account.prizes[p.id]).length;
  const photo = account.user?.photoURL
    ? `<img class="acc-photo" src="${escapeHtml(account.user.photoURL)}" alt="">`
    : `<div class="acc-photo empty">${escapeHtml(playerInitials())}</div>`;
  const sync = accountSignedIn()
    ? '<div class="cab-sync on">В облаке — тот же аккаунт на любом устройстве</div>'
    : '<div class="cab-sync">Пока только в этом браузере</div>';
  const guest = accountSignedIn() ? '' :
    '<button type="button" id="cabGoAuth" class="primary">Войти — перенести на телефон и компьютер</button>';
  const hot = games.length - ranked.length;
  const hotNote = hot
    ? `<div class="tip">Ещё ${hot} ${plural(hot, 'партия', 'партии', 'партий')} вдвоём на одном устройстве — во вкладке «Партии».</div>`
    : '';

  box.innerHTML =
    `<div class="cab-card">` +
    `<div class="cab-id">${photo}<div class="cab-who">` +
    `<label class="field">Имя в игре<input id="accName" maxlength="20" autocomplete="nickname"></label>` +
    `<div class="cab-rank gold">${typeof playerLevel === 'function' ? `Уровень ${playerLevel().level}` : escapeHtml(rank.name)}</div>` +
    `<div class="cab-rank-sub">${escapeHtml(rank.name)}</div>` +
    sync +
    `</div></div>` +
    (typeof xpBarHtml === 'function' ? xpBarHtml() : '') +
    `<div class="cab-stats">` +
    `<div><b>${s.n}</b><span>${plural(s.n, 'партия', 'партии', 'партий')}</span></div>` +
    `<div><b>${s.win}</b><span>${plural(s.win, 'победа', 'победы', 'побед')}</span></div>` +
    `<div><b>${percent(s.win, s.win + s.loss)}</b><span>выигр.</span></div>` +
    `<div title="Лучшая серия: ${best}"><b>${run}</b><span>${best ? `серия · ${best}` : 'серия'}</span></div>` +
    `</div>` +
    `<button type="button" id="cabGoTable" class="cab-prize-line">Стол и кии</button>` +
    `<button type="button" id="cabGoPrizes" class="cab-prize-line">Призы <b>${got}</b> из ${PRIZES.length}</button>` +
    guest + hotNote +
    `</div>`;
  bindNameField();
  document.getElementById('cabGoAuth')?.addEventListener('click', () => {
    account.tab = 'auth';
    showCabinetTab();
  });
  document.getElementById('cabGoTable')?.addEventListener('click', () => {
    account.tab = 'table';
    showCabinetTab();
  });
  document.getElementById('cabGoPrizes')?.addEventListener('click', () => {
    account.tab = 'prizes';
    showCabinetTab();
  });
}

function renderPrizesPane() {
  const box = document.getElementById('cabPrizes');
  if (!box) return;
  const got = PRIZES.filter(p => account.prizes[p.id]).length;
  box.innerHTML =
    `<div class="cab-section-head">Получено <b>${got}</b> из ${PRIZES.length}</div>` +
    '<div class="prizes">' + prizesHtml() + '</div>';
}

function renderAuthPane() {
  const box = document.getElementById('accountBody');
  if (!box) return;
  const prevEmail = document.getElementById('accEmail')?.value || '';
  const busy = account.busy ? ' disabled' : '';
  const err = account.error ? `<div class="net-error">${escapeHtml(account.error)}</div>` : '';
  const notice = account.notice ? `<div class="tip">${escapeHtml(account.notice)}</div>` : '';

  if (accountSignedIn()) {
    const photo = account.user.photoURL
      ? `<img class="acc-photo" src="${escapeHtml(account.user.photoURL)}" alt="">`
      : `<div class="acc-photo empty">${escapeHtml(playerInitials())}</div>`;
    box.innerHTML =
      `<div class="acc-head">${photo}<div>` +
      `<div class="acc-mail">${escapeHtml(account.user.email || account.user.displayName || 'Игрок')}</div>` +
      `<div class="tip">${escapeHtml(accountStatus())}</div></div></div>` +
      notice + err +
      `<button type="button" id="accOut"${busy}>Выйти из аккаунта</button>` +
      `<button type="button" id="accDelete" class="danger"${busy}>Удалить аккаунт</button>`;
    document.getElementById('accOut').addEventListener('click', signOutAccount);
    document.getElementById('accDelete').addEventListener('click', deleteAccount);
    return;
  }

  box.innerHTML =
    '<p class="tip">Войдите — статистика и призы будут на телефоне, планшете и компьютере. На новом устройстве нажмите «Войти через Google» или введите ту же почту и пароль. Без входа всё остаётся только в этом браузере.</p>' +
    `<button type="button" id="accGoogle" class="primary"${busy}>Войти через Google</button>` +
    '<div class="acc-or">или почта и пароль</div>' +
    '<form id="accEmailForm">' +
    '<label class="field">Почта<input id="accEmail" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false"></label>' +
    '<label class="field">Пароль<input id="accPass" type="password" autocomplete="current-password"></label>' +
    '<div class="sheet-actions acc-mail-actions">' +
    `<button type="submit" id="accEmailIn"${busy}>Войти</button>` +
    `<button type="button" id="accEmailUp" class="primary"${busy}>Создать аккаунт</button>` +
    '</div></form>' +
    notice + err;
  const emailEl = document.getElementById('accEmail');
  if (emailEl) emailEl.value = prevEmail;
  document.getElementById('accGoogle').addEventListener('click', signInGoogle);
  document.getElementById('accEmailForm').addEventListener('submit', e => {
    e.preventDefault();
    signInEmail(false);
  });
  document.getElementById('accEmailUp').addEventListener('click', () => signInEmail(true));
}

function renderAccount() {
  const name = myName() || account.user?.displayName || '';
  const btn = document.getElementById('btnAccount');
  if (btn) btn.innerHTML = `${ICON.user}<span>${name ? escapeHtml(name) : 'Кабинет'}</span>`;
  const cab = document.getElementById('btnCabinet');
  if (cab) {
    cab.innerHTML = name
      ? `${ICON.user}<span class="full">${escapeHtml(name)}</span>`
      : `${ICON.user}<span class="full">Кабинет</span>`;
  }
  const note = document.getElementById('recordsCloudNote');
  if (note) {
    note.textContent = accountSignedIn()
      ? 'Сохраняется в облаке: откройте кабинет на другом телефоне или компьютере — партии и призы будут теми же.'
      : 'Пока только в этом браузере. Войдите, чтобы переносить статистику и призы на другие устройства.';
  }
  renderCabinetTabs();
  renderPlayerPane();
  if (typeof renderTablePane === 'function') renderTablePane();
  if (typeof renderTracePane === 'function') renderTracePane();
  renderPrizesPane();
  renderAuthPane();
  renderRecords();
  showCabinetTab();
}

function openCabinet(tab) {
  if (tab) account.tab = tab;
  account.error = '';
  account.prizes = loadPrizes();
  renderAccount();
  renderRecords();
  document.getElementById('account').classList.remove('closed');
}

function closeCabinet() {
  document.getElementById('account').classList.add('closed');
}

function openAccount() {
  openCabinet(account.tab || 'player');
}

function closeAccount() {
  closeCabinet();
}

function resetAccountProgress() {
  savePrizes({});
  if (typeof resetLoadout === 'function') resetLoadout();
  pushAccountCloud();
  renderAccount();
}

account.prizes = loadPrizes();
refreshAccountPrizes(loadRecords());
document.getElementById('btnAccount').addEventListener('click', () => openCabinet('player'));
document.getElementById('btnCabinet')?.addEventListener('click', () => openCabinet('player'));
document.getElementById('btnAccountClose').addEventListener('click', closeCabinet);
document.getElementById('account').addEventListener('click', e => {
  if (e.target.id === 'account') closeCabinet();
});
document.getElementById('recordsCloudNote')?.addEventListener('click', () => {
  if (!accountSignedIn()) openCabinet('auth');
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCabinet();
});
renderAccount();

const openAfterRedirect = localStorage.getItem('novus.authRedirect') || sessionStorage.getItem('novus.openAccount');
if (openAfterRedirect) {
  localStorage.removeItem('novus.authRedirect');
  sessionStorage.removeItem('novus.openAccount');
  openCabinet('player');
}
if (new URLSearchParams(location.search).get('net') !== 'local') {
  netBackend().then(() => {
    if (window._authRedirectError) {
      account.error = authMessage(window._authRedirectError);
      window._authRedirectError = null;
      openCabinet('auth');
      renderAccount();
    }
  }).catch(e => {
    account.error = authMessage(e);
  });
}
