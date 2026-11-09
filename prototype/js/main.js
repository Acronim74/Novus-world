'use strict';

// ===== Главный цикл =====
let lastTime = performance.now();
let accumulator = 0;
let prevFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (phase === 'moving') {
    accumulator += dt * (cfg.slow ? 0.2 : 1);
    let steps = 0;
    while (accumulator >= DT && steps < 200) {
      physicsStep(DT);
      accumulator -= DT;
      steps++;
    }
    if (allStopped()) {
      accumulator = 0;
      // Чужой сетевой удар судит тот, кто бил: ждём его итог и ставим фишки по нему.
      if (!netRemoteShotStopped()) {
        endShot();
        netShotResolved();
      }
    }
  }
  if (turnDeadline && phase === 'place') {
    // Пока открыто окно или настройки, время на удар не идёт; по сети — идёт, чтобы соперник не ждал.
    if (!net.active && overlayOpen()) turnDeadline += now - prevFrame;
    else if (now >= turnDeadline) {
      turnDeadline = 0;
      if (net.active) netTimedOut();
      else timeoutShot();
    }
  }
  prevFrame = now;
  updateTimer(now);
  draw();
  requestAnimationFrame(frame);
}

new ResizeObserver(resize).observe(document.getElementById('stage'));
coarsePointer.addEventListener('change', resize);
phonePortrait.addEventListener('change', resize);
tabletPortrait.addEventListener('change', resize);
resize();
const firstVisit = typeof startFromRooms === 'function' && startFromRooms();
refreshControls();
newGame();
if (firstVisit) openRooms();
requestAnimationFrame(frame);
