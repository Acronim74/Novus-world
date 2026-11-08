'use strict';

// ===== Кабинет: вход (Google или почта), облачная статистика и призы =====
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

function prizeUnlocked(games, id) {
  const ranked = games.filter(g => g.mode !== 'hotseat');
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
  if (code === 'auth/popup-blocked') return 'Браузер закрыл окно входа. Разрешите всплывающие окна или попробуйте ещё раз.';
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

function preferAuthRedirect() {
  return matchMedia('(pointer: coarse)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent);
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
    const name = myName();
    cloudSet('public', {
      name,
      at: Date.now(),
      photo: account.user.photoURL || '',
    });
  }, 400);
}

async function pullAccountCloud() {
  if (!accountSignedIn()) return;
  const [remoteRecords, remotePrizes, pub] = await Promise.all([
    cloudGet('records'),
    cloudGet('prizes'),
    cloudGet('public'),
  ]);
  const mergedGames = mergeGames(loadRecords(), Array.isArray(remoteRecords?.games) ? remoteRecords.games : []);
  saveRecords(mergedGames);
  const mergedPrizes = mergePrizes(loadPrizes(), remotePrizes && typeof remotePrizes === 'object' ? remotePrizes : {});
  savePrizes(mergedPrizes);
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
  refreshAccountPrizes(games);
  pushAccountCloud();
  renderAccount();
}

async function onAccountAuth(user) {
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
  }
  renderAccount();
  renderRecords();
}

async function withAccount(action) {
  if (new URLSearchParams(location.search).get('net') === 'local') {
    account.error = 'Кабинет работает с облаком. Откройте игру без ?net=local.';
    renderAccount();
    return;
  }
  if (net.code) {
    account.error = 'Сначала выйдите из комнаты — вход меняет аккаунт.';
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
  await withAccount(async () => {
    const auth = firebase.auth();
    const provider = googleProvider();
    // Всегда вход, не привязка гостя: иначе со второго устройства Google «уже занят».
    if (preferAuthRedirect()) {
      sessionStorage.setItem('novus.openAccount', '1');
      await auth.signInWithRedirect(provider);
      return;
    }
    await auth.signInWithPopup(provider);
  });
}

async function signInEmail(create) {
  const email = document.getElementById('accEmail')?.value.trim() || '';
  const password = document.getElementById('accPass')?.value || '';
  if (!email || !password) {
    account.error = 'Введите почту и пароль.';
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
  });
}

function accountStatus() {
  if (!accountSignedIn()) {
    return 'Гость — статистика только в этом браузере.';
  }
  const mail = account.user.email || 'Google';
  return `Вход: ${mail}. На другом устройстве войдите тем же Google или той же почтой — статистика и призы подтянутся.`;
}

function renderAccount() {
  const btn = document.getElementById('btnAccount');
  if (btn) {
    btn.textContent = accountSignedIn()
      ? `👤 ${myName() || account.user.displayName || 'Кабинет'}`
      : '👤 Войти — статистика на всех устройствах';
  }
  const note = document.getElementById('recordsCloudNote');
  if (note) {
    note.textContent = accountSignedIn()
      ? 'Сохраняется в облаке: откройте кабинет на другом телефоне или компьютере — партии и призы будут теми же.'
      : 'Пока только в этом браузере. Войдите в кабинет, чтобы переносить статистику и призы на другие устройства.';
  }
  const box = document.getElementById('accountBody');
  if (!box) return;
  const busy = account.busy ? ' disabled' : '';
  const err = account.error ? `<div class="net-error">${escapeHtml(account.error)}</div>` : '';
  const notice = account.notice ? `<div class="tip">${escapeHtml(account.notice)}</div>` : '';
  const prizes = PRIZES.map(p => {
    const got = account.prizes[p.id];
    return `<div class="prize${got ? '' : ' off'}" title="${escapeHtml(p.hint)}">` +
      `<div class="ico">${p.ico}</div><div class="name">${escapeHtml(p.name)}</div>` +
      `<div class="hint">${got ? 'получен' : escapeHtml(p.hint)}</div></div>`;
  }).join('');

  if (accountSignedIn()) {
    const photo = account.user.photoURL
      ? `<img class="acc-photo" src="${escapeHtml(account.user.photoURL)}" alt="">`
      : '<div class="acc-photo empty">👤</div>';
    box.innerHTML =
      `<div class="acc-head">${photo}<div>` +
      `<div class="acc-mail">${escapeHtml(account.user.email || account.user.displayName || 'Игрок')}</div>` +
      `<div class="tip">${escapeHtml(accountStatus())}</div></div></div>` +
      '<label class="field">Имя в игре<input id="accName" maxlength="20" autocomplete="nickname"></label>' +
      notice + err +
      '<h3>Призы</h3><div class="prizes">' + prizes + '</div>' +
      `<button id="accOut"${busy}>Выйти из аккаунта</button>` +
      `<button id="accDelete" class="danger"${busy}>Удалить аккаунт</button>`;
    const name = document.getElementById('accName');
    name.value = myName();
    name.addEventListener('change', () => {
      localStorage.setItem(NAME_KEY, name.value.trim());
      if (net.code && net.backend) net.backend.set(roomPath(`names/${net.uid}`), myName());
      pushAccountCloud();
      renderAccount();
    });
    document.getElementById('accOut').addEventListener('click', signOutAccount);
    document.getElementById('accDelete').addEventListener('click', deleteAccount);
    return;
  }

  box.innerHTML =
    '<p class="tip">Войдите — статистика и призы будут на телефоне, планшете и компьютере. На новом устройстве нажмите «Войти через Google» или введите ту же почту и пароль. Без входа всё остаётся только в этом браузере.</p>' +
    `<button id="accGoogle" class="primary"${busy}>Войти через Google</button>` +
    '<div class="acc-or">или почта и пароль</div>' +
    '<label class="field">Почта<input id="accEmail" type="email" autocomplete="email"></label>' +
    '<label class="field">Пароль<input id="accPass" type="password" autocomplete="current-password"></label>' +
    '<div class="sheet-actions acc-mail-actions">' +
    `<button id="accEmailIn"${busy}>Войти</button>` +
    `<button id="accEmailUp" class="primary"${busy}>Создать аккаунт</button>` +
    '</div>' +
    notice + err +
    '<h3>Призы на этом устройстве</h3><div class="prizes">' + prizes + '</div>';
  document.getElementById('accGoogle').addEventListener('click', signInGoogle);
  document.getElementById('accEmailIn').addEventListener('click', () => signInEmail(false));
  document.getElementById('accEmailUp').addEventListener('click', () => signInEmail(true));
}

function openAccount() {
  account.error = '';
  account.prizes = loadPrizes();
  renderAccount();
  document.getElementById('account').classList.remove('closed');
}

function closeAccount() {
  document.getElementById('account').classList.add('closed');
}

function resetAccountProgress() {
  savePrizes({});
  pushAccountCloud();
  renderAccount();
}

account.prizes = loadPrizes();
document.getElementById('btnAccount').addEventListener('click', openAccount);
document.getElementById('btnAccountClose').addEventListener('click', closeAccount);
document.getElementById('account').addEventListener('click', e => {
  if (e.target.id === 'account') closeAccount();
});
document.getElementById('recordsCloudNote')?.addEventListener('click', openAccount);
renderAccount();

function hasSavedAuth() {
  try {
    return Object.keys(localStorage).some(k => k.startsWith('firebase:authUser'));
  } catch {
    return false;
  }
}

const openAfterRedirect = sessionStorage.getItem('novus.openAccount');
if (openAfterRedirect) {
  sessionStorage.removeItem('novus.openAccount');
  openAccount();
}
if ((openAfterRedirect || hasSavedAuth()) && new URLSearchParams(location.search).get('net') !== 'local') {
  netBackend().then(() => {
    if (window._authRedirectError) {
      account.error = authMessage(window._authRedirectError);
      window._authRedirectError = null;
      openAccount();
      renderAccount();
    }
  }).catch(() => {});
}
