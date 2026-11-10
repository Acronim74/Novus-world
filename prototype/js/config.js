'use strict';

// Значки кнопок: тонкие линии вместо эмодзи, цвет берётся у текста кнопки.
const ICON = {
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
  cup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5c0 2.2 1.2 3.6 3.2 4M16 6h3c0 2.2-1.2 3.6-3.2 4M12 13v4M8.5 20h7M10 17h4"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
};

// ===== Инвентарь по Приложению 1 правил (мм, г) =====
const FIELD = 1000;
const RAIL_W = 45;
const RAIL_H = 25;
const POCKET_R = 50;
const POCKET_OFFSET = 15 + POCKET_R;
const ZONE = 130;
const LINE_W = 1;
const CIRCLE_R = 125;
const STRIKER_SPEC = { r: 22.25, h: 14.5, hole: 5, mass: 22 };
const PAWN_SPEC = { r: 15, h: 12, hole: 4, mass: 5 };

const G = 9810;
const DT = 1 / 1000;
const SOLVER_ITERATIONS = 4;
const MAX_PULL_PX = 220;

const POCKETS = [
  { x: POCKET_OFFSET, y: POCKET_OFFSET },
  { x: FIELD - POCKET_OFFSET, y: POCKET_OFFSET },
  { x: POCKET_OFFSET, y: FIELD - POCKET_OFFSET },
  { x: FIELD - POCKET_OFFSET, y: FIELD - POCKET_OFFSET },
];

const PLAYERS = [
  { name: 'Красные', color: '#b8322a', rail: 'bottom' },
  { name: 'Чёрные', color: '#262626', rail: 'top' },
];

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const RAIL_NAMES = { top: 'верхний', bottom: 'нижний', left: 'левый', right: 'правый' };
const RAIL_FROM = { top: 'верхнего', bottom: 'нижнего', left: 'левого', right: 'правого' };

// Нормаль каждого борта направлена внутрь поля.
const RAILS = [
  { side: 'left', nx: 1, ny: 0, gap: b => b.x },
  { side: 'right', nx: -1, ny: 0, gap: b => FIELD - b.x },
  { side: 'top', nx: 0, ny: 1, gap: b => b.y },
  { side: 'bottom', nx: 0, ny: -1, gap: b => FIELD - b.y },
];

// Коэффициенты трения скольжения дерева по лакированной фанере. Порошок снижает трение в 3–4 раза.
// Шайба по правилам не окрашена и не лакирована, пешки окрашены и с углублением на нижней стороне.
const TABLE_STATES = {
  fresh: { name: 'Свежая натирка порошком', note: 'Очень скользко: фишки катятся далеко, бить нужно мягче.', muStriker: 0.07, muPawn: 0.06 },
  normal: { name: 'Обычная натирка', note: 'Как на ухоженном клубном столе.', muStriker: 0.10, muPawn: 0.09 },
  worn: { name: 'Порошок стёрся', note: 'Фишки останавливаются быстрее, нужен удар посильнее.', muStriker: 0.15, muPawn: 0.14 },
  bare: { name: 'Без порошка', note: 'Тяжёлый стол: фишки тормозят, слабые удары не доходят.', muStriker: 0.28, muPawn: 0.26 },
};

// Подсказка траектории: сколько пути показать и сколько отскоков от бортов.
const HINT_MODES = {
  off: { note: 'Без подсказки — как за настоящим столом.', xpMul: 1.5 },
  short: { len: 220, bounces: 0, target: false, note: 'Короткий отрезок от шайбы — только направление.', xpMul: 1 },
  mid: { len: Infinity, bounces: 0, target: false, note: 'Линия до первого касания пешки или борта.', xpMul: 0.5 },
  full: { len: Infinity, bounces: 2, target: true, note: 'Полная линия: отскоки от бортов и куда пойдёт пешка.', xpMul: 0.2 },
};

const cfg = {
  table: 'normal',
  muStriker: TABLE_STATES.normal.muStriker,
  muPawn: TABLE_STATES.normal.muPawn,
  railE: 0.68,
  railTangent: 0.92,
  puckE: 0.8,
  vMax: 5000,
  popK: 0.05,
  // Вылет за борт: тяжёлая шайба уходит только от очень сильного удара прямо в борт,
  // лёгкие пешки — чаще, но тоже лишь от сильных ударов.
  climbThr: { pawn: 3200, striker: 4300 },
  climbRange: { pawn: 6000, striker: 8000 },
  climbMax: { pawn: 0.6, striker: 0.3 },
  hopThr: 2000,
  hopK: 0.16,
  // Насколько сжатый у борта ряд выдавливает пешки в поле (0 — только вдоль борта).
  railBuckle: 0.0015,
  mode: 'ai',
  room: null,
  level: 2,
  hintLen: 'full',
  shotTime: 0,
  powerSide: 'right',
  circleDark: true,
  freePlace: false,
  // п. 18.1.5: шайба на обратном ходу не заезжает в свою зону, если нет тёмных пешек.
  zoneReturn: false,
  flip: false,
  slow: false,
  stake: 20,
};
