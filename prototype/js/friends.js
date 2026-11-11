'use strict';

// Друзья только по обоюдному согласию: заявка → подтверждение. Удаление снимает с обеих сторон.
const friends = {
  code: '',
  list: {},
  inbox: {},
  sent: {},
  offs: [],
  pendingAdd: '',
  notice: '',
  error: '',
  snoozed: {},
};

function friendCount() {
  return Object.keys(friends.list || {}).length;
}

function inboxKind(v, kind) {
  if (!v) return false;
  if (kind === 'play') return v.kind === 'play' || (!v.kind && v.room);
  return v.kind === kind;
}

function inboxEntries(kind) {
  return Object.entries(friends.inbox || {}).filter(([, v]) => inboxKind(v, kind));
}

function inboxCount() {
  return inboxEntries('play').length + inboxEntries('friend').length;
}

function isFriend(uid) {
  return Boolean(uid && friends.list?.[uid]);
}

function friendName(uid) {
  return (friends.list?.[uid]?.name || friends.sent?.[uid]?.name || 'Игрок').trim() || 'Игрок';
}

function normalizeFriendCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function randomFriendCode() {
  return Array.from({ length: 6 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
}

function friendLink() {
  if (!friends.code) return '';
  const u = new URL(location.href);
  const local = u.searchParams.get('net');
  u.search = '';
  if (local) u.searchParams.set('net', local);
  u.searchParams.set('add', friends.code);
  return u.toString();
}

function stopFriends() {
  for (const off of friends.offs) {
    try { off(); } catch { /* слушатель уже снят */ }
  }
  friends.offs = [];
  friends.list = {};
  friends.inbox = {};
  friends.sent = {};
  friends.code = '';
  friends.notice = '';
  friends.error = '';
}

async function ensureFriendCode() {
  if (!accountSignedIn() || !net.backend?.get) return;
  const uid = account.user.uid;
  const pub = await net.backend.get(`users/${uid}/public`);
  const have = normalizeFriendCode(pub?.code);
  if (have.length === 6) {
    const owner = await net.backend.get(`codes/${have}`);
    if (owner === uid) {
      friends.code = have;
      return;
    }
  }
  for (let i = 0; i < 8; i++) {
    const code = randomFriendCode();
    if (await net.backend.get(`codes/${code}`)) continue;
    await net.backend.set(`codes/${code}`, uid);
    friends.code = code;
    if (typeof pushAccountCloud === 'function') pushAccountCloud();
    return;
  }
  throw new Error('Не удалось выдать код друга, попробуйте ещё раз.');
}

function pruneSentIfFriends() {
  if (!accountSignedIn() || !net.backend) return;
  for (const uid of Object.keys(friends.sent || {})) {
    if (friends.list[uid]) net.backend.set(`users/${account.user.uid}/sent/${uid}`, null);
  }
}

async function consumeDeclines() {
  if (!accountSignedIn() || !net.backend) return;
  for (const [id, v] of inboxEntries('friend-no')) {
    friends.notice = `${v.name || 'Игрок'} отклонил заявку.`;
    friends.error = '';
    log(`${v.name || 'Игрок'} отклонил заявку в друзья.`, 'info');
    if (friends.sent[id]) await net.backend.set(`users/${account.user.uid}/sent/${id}`, null);
    await net.backend.set(`users/${account.user.uid}/inbox/${id}`, null);
  }
}

async function startFriends() {
  stopFriends();
  if (!accountSignedIn() || !net.backend?.on) return;
  try {
    await ensureFriendCode();
  } catch (e) {
    friends.error = e?.message || String(e);
  }
  const uid = account.user.uid;
  friends.offs.push(net.backend.on(`users/${uid}/friends`, data => {
    friends.list = data && typeof data === 'object' ? data : {};
    pruneSentIfFriends();
    renderFriendsPane();
    if (typeof renderCabinetTabs === 'function') renderCabinetTabs();
    if (typeof renderOnline === 'function') renderOnline();
  }));
  friends.offs.push(net.backend.on(`users/${uid}/sent`, data => {
    friends.sent = data && typeof data === 'object' ? data : {};
    renderFriendsPane();
    if (typeof renderOnline === 'function') renderOnline();
  }));
  friends.offs.push(net.backend.on(`users/${uid}/inbox`, data => {
    friends.inbox = data && typeof data === 'object' ? data : {};
    consumeDeclines();
    renderFriendsPane();
    if (typeof renderCabinetTabs === 'function') renderCabinetTabs();
    maybeShowPlayInvite();
    maybeShowFriendAsk();
  }));
  renderFriendsPane();
  const pendingAdd = friends.pendingAdd || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('novus.addFriend') : '') || '';
  if (pendingAdd) {
    friends.pendingAdd = '';
    try { sessionStorage.removeItem('novus.addFriend'); } catch { /* нет хранилища */ }
    account.tab = 'friends';
    sendFriendRequestByCode(pendingAdd).then(() => openCabinet('friends')).catch(e => {
      friends.error = e?.message || String(e);
      openCabinet('friends');
      renderFriendsPane();
    });
  }
}

async function lookupFriend(uid, knownName) {
  if (!accountSignedIn()) throw new Error('Войдите в кабинет, чтобы добавить друга.');
  if (!uid) throw new Error('Игрок не найден.');
  if (uid === account.user.uid) throw new Error('Это ваш собственный код.');
  const pub = await net.backend.get(`users/${uid}/public`);
  if (!pub) throw new Error('У этого игрока нет кабинета — он играет как гость.');
  return String(knownName || pub.name || 'Игрок').trim().slice(0, 20) || 'Игрок';
}

async function sendFriendRequest(uid, knownName) {
  if (isFriend(uid)) {
    friends.notice = `${knownName || friendName(uid)} уже в друзьях.`;
    friends.error = '';
    renderFriendsPane();
    return;
  }
  if (inboxKind(friends.inbox[uid], 'friend')) {
    await acceptFriendRequest(uid);
    return;
  }
  if (friends.sent[uid]) {
    friends.notice = `Заявка для ${friends.sent[uid].name || 'игрока'} уже отправлена.`;
    friends.error = '';
    renderFriendsPane();
    return;
  }
  const name = await lookupFriend(uid, knownName);
  const me = account.user.uid;
  const payload = {
    from: me,
    name: (myName() || 'Игрок').slice(0, 20),
    at: Date.now(),
    kind: 'friend',
  };
  await net.backend.set(`users/${uid}/inbox/${me}`, payload);
  await net.backend.set(`users/${me}/sent/${uid}`, { at: Date.now(), name });
  friends.notice = `Заявка отправлена: ${name}. Дружба появится, когда подтвердят.`;
  friends.error = '';
  log(`Заявка в друзья отправлена: ${name}.`, 'ok');
  renderFriendsPane();
}

async function sendFriendRequestByCode(raw) {
  const code = normalizeFriendCode(raw);
  if (code.length < 6) throw new Error('Код друга — 6 знаков из кабинета, не код комнаты.');
  const uid = await net.backend.get(`codes/${code}`);
  if (!uid || typeof uid !== 'string') {
    throw new Error('Код не найден. Попросите друга открыть кабинет → Друзья.');
  }
  return sendFriendRequest(uid);
}

async function acceptFriendRequest(uid) {
  if (!accountSignedIn() || !uid) return;
  const inv = friends.inbox[uid];
  const name = String(inv?.name || 'Игрок').trim().slice(0, 20) || 'Игрок';
  const me = account.user.uid;
  const my = (myName() || 'Игрок').slice(0, 20);
  const at = Date.now();
  await net.backend.set(`users/${me}/friends/${uid}`, { at, name });
  await net.backend.set(`users/${uid}/friends/${me}`, { at, name: my });
  await net.backend.set(`users/${me}/inbox/${uid}`, null);
  if (friends.sent[uid]) await net.backend.set(`users/${me}/sent/${uid}`, null);
  friends.notice = `${name} теперь в друзьях.`;
  friends.error = '';
  log(`${name} добавлен в друзья.`, 'ok');
}

async function declineFriendRequest(uid) {
  if (!accountSignedIn() || !uid) return;
  const inv = friends.inbox[uid];
  const me = account.user.uid;
  await net.backend.set(`users/${me}/inbox/${uid}`, null);
  if (inv) {
    await net.backend.set(`users/${uid}/inbox/${me}`, {
      from: me,
      name: (myName() || 'Игрок').slice(0, 20),
      at: Date.now(),
      kind: 'friend-no',
    });
  }
}

async function cancelFriendRequest(uid) {
  if (!accountSignedIn() || !uid) return;
  const me = account.user.uid;
  await net.backend.set(`users/${uid}/inbox/${me}`, null);
  await net.backend.set(`users/${me}/sent/${uid}`, null);
}

async function removeFriend(uid) {
  if (!accountSignedIn() || !uid) return;
  const me = account.user.uid;
  await net.backend.set(`users/${me}/friends/${uid}`, null);
  try {
    await net.backend.set(`users/${uid}/friends/${me}`, null);
  } catch {
    // старые правила базы не пускают снять себя у другого — у вас запись всё равно исчезнет
  }
}

async function sendPlayInvite(uid) {
  if (!accountSignedIn()) throw new Error('Войдите в кабинет, чтобы приглашать друзей.');
  if (!net.code) throw new Error('Сначала создайте комнату.');
  if (uid === account.user.uid) throw new Error('Нельзя пригласить себя.');
  if (net.peerUid) throw new Error('В комнате уже двое.');
  await net.backend.set(`users/${uid}/inbox/${account.user.uid}`, {
    from: account.user.uid,
    name: (myName() || 'Игрок').slice(0, 20),
    room: net.code,
    at: Date.now(),
    kind: 'play',
  });
  friends.notice = `Приглашение отправлено: ${friendName(uid)}.`;
  friends.error = '';
  log(`Приглашение отправлено: ${friendName(uid)}.`, 'ok');
  renderFriendsPane();
}

function inviteFriend(uid) {
  if (!accountSignedIn()) {
    openCabinet('auth');
    return;
  }
  if (net.peerUid) {
    friends.error = 'В комнате уже двое. Выйдите или дождитесь конца партии.';
    renderFriendsPane();
    if (typeof renderOnline === 'function') renderOnline();
    return;
  }
  if (net.code) {
    runOnline(() => sendPlayInvite(uid));
    return;
  }
  pendingInviteUid = uid;
  closeCabinet();
  openOnline();
  openRulesDialog('create');
}

async function afterRoomCreated() {
  if (!pendingInviteUid) return;
  const uid = pendingInviteUid;
  pendingInviteUid = null;
  await sendPlayInvite(uid);
}

function newestInbox(kind) {
  const items = inboxEntries(kind);
  items.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return items[0] || null;
}

function maybeShowPlayInvite() {
  const box = document.getElementById('playInvite');
  if (!box) return;
  const pair = newestInbox('play');
  if (!pair) {
    box.classList.add('closed');
    return;
  }
  const [id, inv] = pair;
  if (net.code && net.code === inv.room) {
    if (accountSignedIn()) net.backend.set(`users/${account.user.uid}/inbox/${id}`, null);
    return;
  }
  if (friends.snoozed[`play:${id}`]) return;
  const offer = document.getElementById('ruleOffer');
  if (offer && !offer.classList.contains('closed')) return;
  fillPlayInvite(id, inv);
  box.classList.remove('closed');
}

function fillPlayInvite(id, inv) {
  const box = document.getElementById('playInvite');
  box.dataset.id = id;
  document.getElementById('playInviteText').textContent =
    `${inv.name || 'Игрок'} приглашает сыграть. Комната ${inv.room}.`;
}

async function dismissPlayInvite(forget) {
  const box = document.getElementById('playInvite');
  const id = box?.dataset.id;
  box?.classList.add('closed');
  if (!id) return;
  if (forget && accountSignedIn()) {
    await net.backend.set(`users/${account.user.uid}/inbox/${id}`, null);
  } else {
    friends.snoozed[`play:${id}`] = true;
  }
}

async function acceptPlayInvite() {
  const box = document.getElementById('playInvite');
  const id = box?.dataset.id;
  const inv = id && friends.inbox[id];
  if (!inv?.room) {
    box?.classList.add('closed');
    return;
  }
  box.classList.add('closed');
  friends.snoozed[`play:${id}`] = true;
  if (net.code === inv.room) {
    if (accountSignedIn()) net.backend.set(`users/${account.user.uid}/inbox/${id}`, null);
    openOnline();
    return;
  }
  if (net.code) leaveRoom();
  closeCabinet();
  openOnline();
  await runOnline(() => joinRoom(inv.room));
  if (net.code === inv.room) {
    if (accountSignedIn()) net.backend.set(`users/${account.user.uid}/inbox/${id}`, null);
  } else {
    delete friends.snoozed[`play:${id}`];
    maybeShowPlayInvite();
  }
}

function maybeShowFriendAsk() {
  const box = document.getElementById('friendAsk');
  if (!box) return;
  const play = document.getElementById('playInvite');
  if (play && !play.classList.contains('closed')) return;
  const pair = newestInbox('friend');
  if (!pair) {
    box.classList.add('closed');
    return;
  }
  const [id, inv] = pair;
  if (friends.snoozed[`friend:${id}`]) return;
  box.dataset.id = id;
  document.getElementById('friendAskText').textContent =
    `${inv.name || 'Игрок'} хочет добавить вас в друзья.`;
  box.classList.remove('closed');
}

async function dismissFriendAsk(forget) {
  const box = document.getElementById('friendAsk');
  const id = box?.dataset.id;
  box?.classList.add('closed');
  if (!id) return;
  if (forget) await declineFriendRequest(id);
  else friends.snoozed[`friend:${id}`] = true;
}

function friendsOnlineMarkup() {
  if (net.peerUid) {
    if (!accountSignedIn()) return '';
    if (isFriend(net.peerUid)) return '';
    if (friends.sent[net.peerUid]) {
      return '<p class="tip">Заявка в друзья отправлена — ждём подтверждения.</p>';
    }
    if (inboxKind(friends.inbox[net.peerUid], 'friend')) {
      return '<button type="button" id="netAddFriend" class="primary">Принять заявку в друзья</button>';
    }
    return '<button type="button" id="netAddFriend">Отправить заявку в друзья</button>';
  }
  if (!accountSignedIn()) {
    return '<p class="tip">Войдите в кабинет — там список друзей, им можно отправить приглашение без ссылки.</p>';
  }
  const rows = Object.entries(friends.list || {});
  if (!rows.length) {
    return '<p class="tip">Друзей пока нет. Кабинет → Друзья: обменяйтесь кодами, заявку нужно подтвердить.</p>';
  }
  return '<div class="friends-invite"><div class="head">Пригласить друга</div>' +
    rows.map(([uid, f]) =>
      `<div class="friend-row">` +
      `<span>${escapeHtml(f.name || 'Игрок')}</span>` +
      `<button type="button" class="primary" data-invite="${escapeHtml(uid)}">Пригласить</button>` +
      `</div>`
    ).join('') +
    '</div>';
}

function bindFriendsOnline(box) {
  box.querySelectorAll('[data-invite]').forEach(btn => {
    btn.addEventListener('click', () => inviteFriend(btn.dataset.invite));
  });
  document.getElementById('netAddFriend')?.addEventListener('click', () => {
    runOnline(async () => {
      await sendFriendRequest(net.peerUid, net.peerName);
      renderOnline();
    });
  });
}

function renderFriendsPane() {
  const box = document.getElementById('cabFriends');
  if (!box) return;
  const err = friends.error ? `<div class="net-error">${escapeHtml(friends.error)}</div>` : '';
  const notice = friends.notice ? `<div class="tip">${escapeHtml(friends.notice)}</div>` : '';

  if (!accountSignedIn()) {
    box.innerHTML =
      '<p class="tip">Войдите — появится ваш код друга. По нему отправляют заявку, дружба появится только после подтверждения.</p>' +
      '<button type="button" id="frGoAuth" class="primary">Войти</button>';
    document.getElementById('frGoAuth')?.addEventListener('click', () => {
      account.tab = 'auth';
      showCabinetTab();
    });
    return;
  }

  const asks = inboxEntries('friend').sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const askHtml = asks.length
    ? '<div class="cab-section-head">Заявки в друзья</div>' +
      asks.map(([id, inv]) =>
        `<div class="friend-row">` +
        `<div><div class="name">${escapeHtml(inv.name || 'Игрок')}</div>` +
        `<div class="hint">${inv.at ? formatWhen(inv.at) : 'хочет добавить вас'}</div></div>` +
        `<button type="button" class="primary" data-accept-fr="${escapeHtml(id)}">Принять</button>` +
        `<button type="button" data-decline-fr="${escapeHtml(id)}">Отклонить</button>` +
        `</div>`
      ).join('')
    : '';

  const plays = inboxEntries('play').sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const playHtml = plays.length
    ? '<div class="cab-section-head">Приглашения в игру</div>' +
      plays.map(([id, inv]) =>
        `<div class="friend-row">` +
        `<div><div class="name">${escapeHtml(inv.name || 'Игрок')}</div>` +
        `<div class="hint">комната ${escapeHtml(inv.room)}${inv.at ? ' · ' + formatWhen(inv.at) : ''}</div></div>` +
        `<button type="button" class="primary" data-accept="${escapeHtml(id)}">Войти</button>` +
        `<button type="button" data-decline="${escapeHtml(id)}">Отклонить</button>` +
        `</div>`
      ).join('')
    : '';

  const waiting = Object.entries(friends.sent || {}).filter(([uid]) => !isFriend(uid))
    .sort((a, b) => String(a[1]?.name || '').localeCompare(String(b[1]?.name || ''), 'ru'));
  const sentHtml = waiting.length
    ? '<div class="cab-section-head">Ждут ответа</div>' +
      waiting.map(([uid, f]) =>
        `<div class="friend-row">` +
        `<div><div class="name">${escapeHtml(f.name || 'Игрок')}</div>` +
        `<div class="hint">заявка отправлена${f.at ? ' · ' + formatWhen(f.at) : ''}</div></div>` +
        `<button type="button" data-cancel-fr="${escapeHtml(uid)}">Отменить</button>` +
        `</div>`
      ).join('')
    : '';

  const list = Object.entries(friends.list || {}).sort((a, b) =>
    String(a[1]?.name || '').localeCompare(String(b[1]?.name || ''), 'ru')
  );
  const listHtml = list.length
    ? '<div class="cab-section-head">Друзья</div>' +
      list.map(([uid, f]) =>
        `<div class="friend-row">` +
        `<div><div class="name">${escapeHtml(f.name || 'Игрок')}</div>` +
        `<div class="hint">${f.at ? 'с ' + formatWhen(f.at) : ''}</div></div>` +
        `<button type="button" class="primary" data-invite="${escapeHtml(uid)}">Пригласить</button>` +
        `<button type="button" data-remove="${escapeHtml(uid)}">Убрать</button>` +
        `</div>`
      ).join('')
    : '<p class="tip">Друзей пока нет. Введите код — уйдёт заявка. Дружба появится, когда её подтвердят. Убрать можно в любой момент.</p>';

  const code = friends.code
    ? `<div class="friend-code"><div class="room-code">Ваш код <b>${escapeHtml(friends.code)}</b></div>` +
      '<p class="tip">Его вводят в кабинете → Друзья. Заявку нужно подтвердить с обеих сторон.</p>' +
      '<div class="invite-actions">' +
      '<button type="button" id="frCopy">Скопировать код</button>' +
      '<button type="button" id="frCopyLink">Скопировать ссылку</button>' +
      '<button type="button" id="frShare" class="primary">Поделиться</button>' +
      '</div></div>'
    : '<p class="tip">Код появится через секунду…</p>';

  box.innerHTML =
    code + notice + err +
    '<form id="frAddForm" class="fr-add">' +
    '<label class="field">Код друга<input id="frAdd" maxlength="8" placeholder="например K7P4QX" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>' +
    '<button type="submit" class="primary">Отправить заявку</button>' +
    '</form>' +
    askHtml + playHtml + sentHtml + listHtml;

  document.getElementById('frCopy')?.addEventListener('click', async e => {
    markCopied(e.currentTarget, await copyText(friends.code));
  });
  document.getElementById('frCopyLink')?.addEventListener('click', async e => {
    markCopied(e.currentTarget, await copyText(friendLink()));
  });
  document.getElementById('frShare')?.addEventListener('click', shareFriendCode);
  document.getElementById('frAddForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    friends.error = '';
    friends.notice = '';
    try {
      await sendFriendRequestByCode(document.getElementById('frAdd').value);
      const input = document.getElementById('frAdd');
      if (input) input.value = '';
    } catch (err) {
      friends.error = err?.message || String(err);
    }
    renderFriendsPane();
  });
  box.querySelectorAll('[data-invite]').forEach(btn => {
    btn.addEventListener('click', () => inviteFriend(btn.dataset.invite));
  });
  box.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Убрать ${friendName(btn.dataset.remove)} из друзей? Исчезнет и у вас, и у него.`)) return;
      await removeFriend(btn.dataset.remove);
    });
  });
  box.querySelectorAll('[data-accept-fr]').forEach(btn => {
    btn.addEventListener('click', () => acceptFriendRequest(btn.dataset.acceptFr));
  });
  box.querySelectorAll('[data-decline-fr]').forEach(btn => {
    btn.addEventListener('click', () => declineFriendRequest(btn.dataset.declineFr));
  });
  box.querySelectorAll('[data-cancel-fr]').forEach(btn => {
    btn.addEventListener('click', () => cancelFriendRequest(btn.dataset.cancelFr));
  });
  box.querySelectorAll('[data-accept]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.getElementById('playInvite').dataset.id = btn.dataset.accept;
      await acceptPlayInvite();
    });
  });
  box.querySelectorAll('[data-decline]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await net.backend.set(`users/${account.user.uid}/inbox/${btn.dataset.decline}`, null);
    });
  });
}

async function shareFriendCode() {
  const url = friendLink();
  if (navigator.share && url) {
    try {
      await navigator.share({
        title: 'Новус',
        text: `Добавь меня в друзья в новусе. Код ${friends.code}`,
        url,
      });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const btn = document.getElementById('frShare');
  if (btn) markCopied(btn, await copyText(url || friends.code));
}

document.getElementById('playInviteJoin')?.addEventListener('click', () => {
  acceptPlayInvite().catch(e => {
    friends.error = e?.message || String(e);
    renderFriendsPane();
  });
});
document.getElementById('playInviteLater')?.addEventListener('click', () => dismissPlayInvite(false));
document.getElementById('playInviteNo')?.addEventListener('click', () => dismissPlayInvite(true));
document.getElementById('playInvite')?.addEventListener('click', e => {
  if (e.target.id === 'playInvite') dismissPlayInvite(false);
});
document.getElementById('friendAskYes')?.addEventListener('click', async () => {
  const id = document.getElementById('friendAsk')?.dataset.id;
  document.getElementById('friendAsk')?.classList.add('closed');
  if (id) await acceptFriendRequest(id);
});
document.getElementById('friendAskLater')?.addEventListener('click', () => dismissFriendAsk(false));
document.getElementById('friendAskNo')?.addEventListener('click', () => dismissFriendAsk(true));
document.getElementById('friendAsk')?.addEventListener('click', e => {
  if (e.target.id === 'friendAsk') dismissFriendAsk(false);
});
document.getElementById('roomRules')?.addEventListener('click', e => {
  if (e.target.closest('.close') || e.target.id === 'roomRules') pendingInviteUid = null;
});

const addFromUrl = new URLSearchParams(location.search).get('add');
if (addFromUrl) {
  friends.pendingAdd = addFromUrl;
  try { sessionStorage.setItem('novus.addFriend', addFromUrl); } catch { /* нет хранилища */ }
  const u = new URL(location.href);
  u.searchParams.delete('add');
  const addUrl = `${u.pathname}${u.search}${u.hash}`;
  if (typeof setAppUrl === 'function') setAppUrl(addUrl);
  else history.replaceState(history.state, '', addUrl);
} else {
  try { friends.pendingAdd = sessionStorage.getItem('novus.addFriend') || ''; } catch { /* нет хранилища */ }
}
