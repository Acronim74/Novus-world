#!/usr/bin/env node
// Стенд физики первого удара. Запускает настоящий код игры (prototype/js) без браузера
// и проверяет поведение, сверенное с видео реальных партий.
//
//   node tools/physics-bench.js                     — все проверки (несколько минут)
//   node tools/physics-bench.js --fast              — грубее, примерно вдвое быстрее (~1 мин на 2 ядрах)
//   node tools/physics-bench.js --set railBuckle=0.003 --set puckE=0.9
//                                                    — то же с изменёнными числами из cfg
//
// Код выхода 1, если хоть одна проверка не прошла: можно вешать на CI или pre-commit.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const JS_DIR = path.join(__dirname, '..', 'prototype', 'js');
const FILES = ['config', 'state', 'zones', 'shot', 'physics', 'referee'];
// Что считаем правильным (по видео: финал New York 2017 и ролик «7 из 8 за первый ход»).
const TARGETS = {
  railRoll: { min: 14, of: 20, text: 'пешка вдоль борта падает в лузу' },
  technique: { min: 8, of: 9, text: 'приём из видео, лучший прицел' },
  random: { max: 6, text: 'случайный первый удар забивает, %' },
  chain: { min: 0.5, text: 'удар по ряду доходит до последней пешки (доля скорости)' },
};
// ---------- загрузка игры в песочницу ----------
function loadGame(overrides) {
  let src = `var net = { active: false }; var aiToken = 0;
    function isAI() { return false } function maybeStartAI() {}
    function updatePanel() {} function log() {} function clearLog() {} function updatePower() {}`;
  for (const f of FILES) {
    src += '\n' + fs.readFileSync(path.join(JS_DIR, f + '.js'), 'utf8').replace("'use strict';", '');
  }
  src += `
    Object.assign(cfg, ${JSON.stringify(overrides)});
    function runShot(sx, sy, ang, power, seed) {
      newGame();
      striker.x = sx; striker.y = sy;
      if (placementProblem(0, sx, sy)) return null;
      aim.dirX = Math.sin(ang); aim.dirY = -Math.cos(ang); aim.power = power;
      seedPhysics(seed);
      const sp = cfg.vMax * power;
      striker.vx = aim.dirX * sp; striker.vy = aim.dirY * sp;
      shot = makeShotRecord(0); phase = 'moving';
      for (let t = 0; t < 30000 && !allStopped(); t++) physicsStep(DT);
      const j = judgeShot();
      return { own: j.ownIn.length, foul: !!j.foul };
    }
    this.game = {
      runShot, newGame, placementArea, yAtDepth,
      step: () => physicsStep(DT),
      get bodies() { return bodies },
    };`;
  const ctx = { console, performance, Math, Set, Map, Infinity, Object, JSON, Array };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.game;
}
// Удар от линии своей зоны (игрок 0, свой ряд пешек — у дальнего борта, x 395…605).
function zone(game) {
  const a = game.placementArea(0);
  return { x0: a.x0, x1: a.x1, y: game.yAtDepth(0, a.d1) };
}
const aimAt = (x, y, tx) => Math.atan2(tx - x, y - 15);
// ---------- задания (выполняются в воркерах) ----------
const JOBS = {
  // Пешка, катящаяся вдоль борта, должна свалиться в угловую лузу (видео сверху, удар 1).
  railRoll(game) {
    let ok = 0, n = 0;
    for (const v of [1000, 1500, 2000, 2500, 3000]) for (const g of [0, 1, 2, 4]) {
      game.newGame();
      for (const b of game.bodies) b.state = 'pocketed';
      const p = game.bodies.find(b => b.kind === 'pawn');
      Object.assign(p, { state: 'table', x: 700, y: 15 + g, vx: v, vy: 0, vz: 0, z: 0 });
      for (let i = 0; i < 5000; i++) game.step();
      n++;
      if (p.state === 'pocketed') ok++;
    }
    return { ok, n };
  },
  // Шайба у борта бьёт строго вдоль ряда: сколько скорости доходит до последней пешки.
  chain(game) {
    game.newGame();
    const bs = game.bodies;
    for (const b of bs) if (b.kind === 'pawn' && b.owner === 1) b.state = 'pocketed';
    const row = bs.filter(b => b.kind === 'pawn' && b.owner === 0).sort((a, b) => a.x - b.x);
    const st = bs.find(b => b.kind === 'striker');
    Object.assign(st, { x: row[0].x - 60, y: 15 + (st.r - row[0].r), vx: 3000, vy: 0 });
    let last = 0;
    for (let i = 0; i < 400; i++) {
      game.step();
      last = Math.max(last, Math.hypot(row[7].vx, row[7].vy));
    }
    return { share: last / 3000 };
  },
  // Приём из видео: шайба с края зоны бьёт в край ближней крайней пешки.
  // Для каждого прицела 9 попыток (3 силы × 3 зерна); ищем самый надёжный.
  technique(game, part, parts, fast) {
    const z = zone(game);
    const res = [];
    let i = 0;
    for (const x of [z.x0, z.x0 + 60, z.x0 + 120, z.x1 - 120, z.x1 - 60, z.x1])
      for (let off = -14; off <= 14; off += fast ? 4 : 2) {
        if (i++ % parts !== part) continue;
        const tx = x < 500 ? 395 : 605; // ближний к шайбе конец ряда
        let ok = 0;
        for (const p of [0.6, 0.8, 1]) for (const s of [1, 2, 3]) {
          const r = game.runShot(x, z.y, aimAt(x, z.y, tx + (x < 500 ? off : -off)), p, s * 31);
          if (r && r.own && !r.foul) ok++;
        }
        res.push({ x: Math.round(x), off, ok });
      }
    return res;
  },
  // Случайный первый удар: равномерный перебор позиций, углов и сил.
  random(game, part, parts, fast) {
    const z = zone(game);
    let n = 0, ok = 0, i = 0;
    for (let x = z.x0; x <= z.x1; x += fast ? 120 : 80)
      for (let deg = -60; deg <= 60; deg += fast ? 4 : 2)
        for (const p of [0.3, 0.55, 0.8, 1]) {
          if (i++ % parts !== part) continue;
          const r = game.runShot(x, z.y, deg * Math.PI / 180, p, 12345);
          if (!r) continue;
          n++;
          if (r.own && !r.foul) ok++;
        }
    return { n, ok };
  },
};
if (!isMainThread) {
  const { job, part, parts, fast, overrides } = workerData;
  parentPort.postMessage(JOBS[job](loadGame(overrides), part, parts, fast));
  return;
}
// ---------- главный поток ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const overrides = {};
  let fast = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fast') fast = true;
    else if (args[i] === '--set') {
      const [k, v] = (args[++i] || '').split('=');
      if (!k || v === undefined) throw new Error('Формат: --set имя=число');
      overrides[k] = isNaN(Number(v)) ? v : Number(v);
    } else throw new Error('Неизвестный параметр: ' + args[i]);
  }
  return { overrides, fast };
}
function runJob(job, parts, fast, overrides) {
  return Promise.all(Array.from({ length: parts }, (_, part) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { job, part, parts, fast, overrides } });
    w.once('message', res);
    w.once('error', rej);
  })));
}
(async () => {
  const { overrides, fast } = parseArgs();
  const game = loadGame(overrides); // проверка, что код игры загружается
  const cpu = Math.max(1, Math.min(8, os.cpus().length));
  const t0 = Date.now();
  console.log('Стенд физики Novuss' + (fast ? ' (быстрый режим)' : ''));
  if (Object.keys(overrides).length) console.log('Изменено в cfg:', overrides);
  console.log('');
  const [[rail], [chain], tech, rand] = await Promise.all([
    runJob('railRoll', 1, fast, overrides),
    runJob('chain', 1, fast, overrides),
    runJob('technique', cpu, fast, overrides),
    runJob('random', cpu, fast, overrides),
  ]);
  const techAll = tech.flat().sort((a, b) => b.ok - a.ok);
  const best = techAll[0];
  const techTotal = techAll.reduce((s, r) => s + r.ok, 0);
  const randN = rand.reduce((s, r) => s + r.n, 0);
  const randOk = rand.reduce((s, r) => s + r.ok, 0);
  const randPct = 100 * randOk / randN;
  const rows = [
    [TARGETS.railRoll.text, `${rail.ok} из ${rail.n}`, `≥ ${TARGETS.railRoll.min}`, rail.ok >= TARGETS.railRoll.min],
    [TARGETS.chain.text, chain.share.toFixed(2), `≥ ${TARGETS.chain.min}`, chain.share >= TARGETS.chain.min],
    [TARGETS.technique.text, `${best.ok} из 9`, `≥ ${TARGETS.technique.min}`, best.ok >= TARGETS.technique.min],
    [TARGETS.random.text, `${randPct.toFixed(1)} (${randOk}/${randN})`, `≤ ${TARGETS.random.max}`, randPct <= TARGETS.random.max],
  ];
  const w = Math.max(...rows.map(r => r[0].length));
  for (const [name, val, goal, pass] of rows) {
    console.log(`${pass ? '✓' : '✗'} ${name.padEnd(w)}  ${String(val).padEnd(16)} цель ${goal}`);
  }
  console.log('');
  console.log(`Приём из видео, все прицелы: ${(100 * techTotal / (techAll.length * 9)).toFixed(1)}%`);
  console.log('Лучшие прицелы (x шайбы, смещение от центра крайней пешки в мм, попаданий из 9):');
  console.log('  ' + techAll.slice(0, 4).map(r => `x=${r.x} смещ=${r.off}: ${r.ok}`).join('   '));
  console.log(`\nГотово за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  process.exit(rows.every(r => r[3]) ? 0 : 1);
})().catch(e => {
  console.error('Стенд упал:', e.message || e);
  process.exit(2);
});
