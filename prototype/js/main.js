'use strict';

// ===== Главный цикл =====
let lastTime = performance.now();
let accumulator = 0;

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
      endShot();
    }
  }
  draw();
  requestAnimationFrame(frame);
}

new ResizeObserver(resize).observe(document.getElementById('stage'));
coarsePointer.addEventListener('change', resize);
resize();
newGame();
requestAnimationFrame(frame);
