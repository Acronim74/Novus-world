'use strict';

// QR-код ссылки комнаты: рисуется в браузере, без сторонних сервисов.
// Байт-режим, коррекция L, версии 2–6 — хватает на ссылку с кодом комнаты.
function qrSvg(text, opt = {}) {
  const dark = opt.dark || '#1d1608';
  const light = opt.light || '#f4ead8';
  const modules = qrModules(String(text));
  const n = modules.length;
  const quiet = 4;
  const size = n + quiet * 2;
  let dots = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y][x]) dots += `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`;
    }
  }
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="${size}" height="${size}" fill="${light}"/>` +
    `<g fill="${dark}">${dots}</g></svg>`;
}

function qrModules(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = qrVersionFor(bytes.length);
  const size = 21 + 4 * (version - 1);
  const spec = QR_L[version];
  const data = qrDataCodewords(bytes, spec.data, version);
  const code = rsEncode(data, spec.ec);
  const reserved = qrReserved(size, version);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = qrBuild(size, version, code, reserved, mask);
    const score = qrPenalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  return best;
}

// Ёмкость данных (байты полезной нагрузки) и число байт коррекции для ECC L.
const QR_L = {
  2: { data: 34, ec: 10 },
  3: { data: 55, ec: 15 },
  4: { data: 80, ec: 20 },
  5: { data: 108, ec: 26 },
};

function qrVersionFor(n) {
  for (const v of [2, 3, 4, 5]) {
    if (n + 3 <= QR_L[v].data) return v;
  }
  throw new Error('Ссылка слишком длинная для кода приглашения.');
}

function qrDataCodewords(bytes, capacity, version) {
  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  const pad = [0xec, 0x11];
  let p = 0;
  while (words.length < capacity) words.push(pad[p++ % 2]);
  return words.slice(0, capacity);
}

const QR_EXP = new Uint8Array(512);
const QR_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_EXP[i] = x;
    QR_LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255];
}

function gfMul(a, b) {
  return a && b ? QR_EXP[QR_LOG[a] + QR_LOG[b]] : 0;
}

function rsEncode(data, ec) {
  return rsEncodeBlock(data, ec);
}

function rsEncodeBlock(data, ec) {
  let gen = [1];
  for (let i = 0; i < ec; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], QR_EXP[i]);
    }
    gen = next;
  }
  const out = data.concat(new Array(ec).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = out[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j++) out[i + j] ^= gfMul(gen[j], coef);
  }
  return data.concat(out.slice(data.length));
}

function qrReserved(size, version) {
  const r = Array.from({ length: size }, () => Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) r[y][x] = true;
  };
  const finder = (ox, oy) => {
    for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) mark(ox + x, oy + y);
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 0; i < size; i++) {
    mark(i, 6);
    mark(6, i);
  }
  const align = 10 + 4 * version; // 18, 22, 26, 30, 34 для v2–6
  if (version >= 2) {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) mark(align - 2 + x, align - 2 + y);
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  mark(8, size - 8);
  return r;
}

function qrPlaceFinder(grid, ox, oy) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const edge = x === 0 || y === 0 || x === 6 || y === 6;
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      grid[oy + y][ox + x] = edge || core;
    }
  }
}

function qrPlaceAlign(grid, cx, cy) {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      grid[cy + y][cx + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1;
    }
  }
}

function qrMaskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}

function qrFormatBits(mask) {
  // ECC L = 01.
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function qrPlaceFormat(grid, bits) {
  const n = grid.length;
  const on = i => ((bits >> i) & 1) === 1;
  const set = (x, y, i) => { grid[y][x] = on(i); };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i <= 14; i++) set(14 - i, 8, i);
  for (let i = 0; i <= 7; i++) set(n - 1 - i, 8, i);
  for (let i = 8; i <= 14; i++) set(8, n - 15 + i, i);
  grid[n - 8][8] = true;
}

function qrBuild(size, version, code, reserved, mask) {
  const grid = Array.from({ length: size }, () => Array(size).fill(false));
  qrPlaceFinder(grid, 0, 0);
  qrPlaceFinder(grid, size - 7, 0);
  qrPlaceFinder(grid, 0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }
  if (version >= 2) qrPlaceAlign(grid, 10 + 4 * version, 10 + 4 * version);
  let bit = 0;
  const total = code.length * 8;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        const y = ((col + 1) & 2) === 0 ? size - 1 - row : row;
        if (reserved[y][x]) continue;
        let dark = false;
        if (bit < total) dark = ((code[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        bit++;
        if (qrMaskBit(mask, x, y)) dark = !dark;
        grid[y][x] = dark;
      }
    }
  }
  qrPlaceFormat(grid, qrFormatBits(mask));
  return grid;
}

function qrPenalty(grid) {
  const n = grid.length;
  let score = 0;
  const run = (get) => {
    for (let i = 0; i < n; i++) {
      let last = get(i, 0);
      let len = 1;
      for (let j = 1; j <= n; j++) {
        const v = j < n ? get(i, j) : null;
        if (v === last) {
          len++;
          continue;
        }
        if (len >= 5) score += 3 + (len - 5);
        last = v;
        len = 1;
      }
    }
  };
  run((r, c) => grid[r][c]);
  run((c, r) => grid[r][c]);
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = grid[y][x];
      if (v === grid[y][x + 1] && v === grid[y + 1][x] && v === grid[y + 1][x + 1]) score += 3;
    }
  }
  const finder = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const has = (get) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= n - 11; j++) {
        let ok = true;
        for (let k = 0; k < 11; k++) if (get(i, j + k) !== Boolean(finder[k])) ok = false;
        if (ok) score += 40;
      }
    }
  };
  has((r, c) => grid[r][c]);
  has((c, r) => grid[r][c]);
  let dark = 0;
  for (const row of grid) for (const v of row) if (v) dark++;
  score += 10 * Math.floor(Math.abs(100 * dark / (n * n) - 50) / 5);
  return score;
}
