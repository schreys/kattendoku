'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function neighbors4(i, n) {
  const r = Math.floor(i / n), c = i % n, out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

// Random column per row: no shared column and no diagonal contact between consecutive rows.
function makeSolution(n, rnd) {
  const cols = new Array(n);
  const used = new Array(n).fill(false);
  const bt = (r) => {
    if (r === n) return true;
    for (const c of shuffle([...Array(n).keys()], rnd)) {
      if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
      used[c] = true;
      cols[r] = c;
      if (bt(r + 1)) return true;
      used[c] = false;
    }
    return false;
  };
  bt(0);
  return cols;
}

// Region r is seeded at the cat of row r and grows randomly until the grid is full.
function growRegions(n, sol, rnd) {
  const reg = new Array(n * n).fill(-1);
  sol.forEach((c, r) => { reg[r * n + c] = r; });
  let left = n * n - n;
  while (left > 0) {
    const i = Math.floor(rnd() * n * n);
    if (reg[i] !== -1) continue;
    const nb = neighbors4(i, n).filter((j) => reg[j] !== -1);
    if (!nb.length) continue;
    reg[i] = reg[nb[Math.floor(rnd() * nb.length)]];
    left--;
  }
  return reg;
}

// Returns a valid solution different from `sol`, or null if `sol` is unique.
function findAlternative(n, reg, sol) {
  const cols = new Array(n);
  const usedC = new Array(n).fill(false);
  const usedR = new Array(n).fill(false);
  let found = null;
  const bt = (r) => {
    if (r === n) {
      if (cols.some((c, k) => c !== sol[k])) {
        found = cols.slice();
        return true;
      }
      return false;
    }
    for (let c = 0; c < n; c++) {
      if (usedC[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
      const g = reg[r * n + c];
      if (usedR[g]) continue;
      usedC[c] = usedR[g] = true;
      cols[r] = c;
      if (bt(r + 1)) return true;
      usedC[c] = usedR[g] = false;
    }
    return false;
  };
  bt(0);
  return found;
}

function staysConnected(n, reg, g, removed, start) {
  let total = 0;
  for (let i = 0; i < n * n; i++) if (reg[i] === g && i !== removed) total++;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    for (const j of neighbors4(i, n)) {
      if (j !== removed && reg[j] === g && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === total;
}

// Builds an n×n puzzle with exactly one solution. Deterministic for a given seed.
function generatePuzzle(n, seed) {
  const rnd = mulberry32(seed);
  for (;;) {
    const sol = makeSolution(n, rnd);
    const reg = growRegions(n, sol, rnd);
    let unique = false;
    for (let step = 0; step < n * n * 4; step++) {
      const alt = findAlternative(n, reg, sol);
      if (!alt) { unique = true; break; }
      // Move one of the alternative's cats into a neighbouring region, which invalidates that alternative.
      const candidates = [];
      alt.forEach((c, r) => {
        if (c === sol[r]) return;
        const i = r * n + c, g = reg[i];
        const targets = [...new Set(neighbors4(i, n).map((j) => reg[j]).filter((h) => h !== g))];
        if (targets.length && staysConnected(n, reg, g, i, g * n + sol[g])) candidates.push([i, targets]);
      });
      if (!candidates.length) break;
      const [i, targets] = candidates[Math.floor(rnd() * candidates.length)];
      reg[i] = targets[Math.floor(rnd() * targets.length)];
    }
    if (unique) return { n, reg, sol, starter: Math.floor(rnd() * n) };
  }
}

if (typeof module !== 'undefined') module.exports = { generatePuzzle, mulberry32, shuffle, findAlternative };
