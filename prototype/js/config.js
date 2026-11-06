'use strict';

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
const SOLVER_ITERATIONS = 2;
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
  fresh: { name: 'Свежая натирка порошком', muStriker: 0.07, muPawn: 0.06 },
  normal: { name: 'Обычная натирка', muStriker: 0.10, muPawn: 0.09 },
  worn: { name: 'Порошок стёрся', muStriker: 0.15, muPawn: 0.14 },
  bare: { name: 'Без порошка', muStriker: 0.28, muPawn: 0.26 },
};

const cfg = {
  table: 'normal',
  muStriker: TABLE_STATES.normal.muStriker,
  muPawn: TABLE_STATES.normal.muPawn,
  railE: 0.68,
  railTangent: 0.92,
  puckE: 0.8,
  vMax: 6500,
  popK: 0.05,
  climbThr: { pawn: 2300, striker: 3800 },
  climbRange: 2500,
  hopThr: 1400,
  hopK: 0.22,
  mode: 'ai',
  level: 2,
  hint: true,
  powerSide: 'right',
  circleDark: true,
  freePlace: false,
  flip: false,
  slow: false,
};
