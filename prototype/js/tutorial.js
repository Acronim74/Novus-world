'use strict';

// ===== Обучение: три подсказки в первой партии на Даче =====
const coach = {
  active: false,
  step: 0,
  darkShown: false,
};

const touchDevice = matchMedia('(pointer: coarse)').matches;

const COACH_STEPS = [
  {
    title: 'Ваш удар',
    text: () => touchDevice
      ? 'Шайба стоит в вашей зоне у нижнего борта — её можно передвинуть пальцем. Коснитесь стола там, куда бить, и уберите палец: прицел останется. Потом потяните шкалу силы и отпустите.'
      : 'Шайба стоит в вашей зоне у нижнего борта — её можно перетащить мышью. Наведите мышь, куда бить, нажмите и оттяните назад: чем дальше, тем сильнее. Отпустите — удар.',
    next: 'Дальше',
  },
  {
    title: 'Первый удар — как у мастеров',
    text: () => 'Ваши красные пешки стоят рядом у дальнего борта. Поставьте шайбу к краю зоны и ударьте в край крайней пешки: ряд сдвинется вдоль борта, а пешка с другого конца покатится в угловую лузу. Линия подсказки покажет, куда она пойдёт.',
    next: 'Попробую',
  },
];

const DARK_STEP = {
  title: 'Тёмные пешки',
  text: () => 'Своя пешка в вашей зоне у ближнего борта — тёмная, она отмечена на столе. Прямо по ней бить нельзя: сначала шайба должна отскочить от борта (п. 13.3).',
  next: 'Понятно',
};

function coachEl() {
  let el = document.getElementById('coach');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'coach';
  el.className = 'closed';
  el.setAttribute('role', 'status');
  document.getElementById('stage').appendChild(el);
  el.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'skip') finishTutorial();
    else nextCoach();
  });
  return el;
}

function showCoach(step, label) {
  const el = coachEl();
  el.innerHTML =
    `<div class="coach-step">${label}</div>` +
    `<div class="coach-title">${step.title}</div>` +
    `<div class="coach-text">${step.text()}</div>` +
    '<div class="coach-actions">' +
    (coach.step < COACH_STEPS.length ? '<button data-act="skip">Пропустить обучение</button>' : '') +
    `<button class="primary" data-act="next">${step.next}</button></div>`;
  el.classList.remove('closed');
}

function hideCoach() {
  document.getElementById('coach')?.classList.add('closed');
}

function startTutorial() {
  hideCoach();
  coach.active = false;
  if (typeof currentRoom !== 'function' || rooms.tutorialDone) return;
  const room = currentRoom();
  if (!room || room.id !== ROOMS[0].id) return;
  coach.active = true;
  coach.step = 0;
  coach.darkShown = false;
  showCoach(COACH_STEPS[0], `Обучение · 1 из 3`);
}

function nextCoach() {
  if (coach.step < COACH_STEPS.length) coach.step++;
  if (coach.step < COACH_STEPS.length) {
    showCoach(COACH_STEPS[coach.step], `Обучение · ${coach.step + 1} из 3`);
    return;
  }
  hideCoach();
  if (coach.darkShown) finishTutorial();
}

function finishTutorial() {
  coach.active = false;
  hideCoach();
  rooms.tutorialDone = true;
  saveRooms();
}

// Подсказка про тёмные пешки — когда они впервые появятся у игрока.
setInterval(() => {
  if (!coach.active || coach.darkShown || coach.step < COACH_STEPS.length) return;
  if (phase === 'over') {
    finishTutorial();
    return;
  }
  if (phase !== 'place' || current !== HUMAN_PLAYER) return;
  const dark = bodies.some(b => b.kind === 'pawn' && b.owner === HUMAN_PLAYER && b.state === 'table' && isDark(b));
  if (!dark) return;
  coach.darkShown = true;
  showCoach(DARK_STEP, 'Обучение · 3 из 3');
}, 400);
