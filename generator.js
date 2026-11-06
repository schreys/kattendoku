"use strict";

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
  const r = Math.floor(i / n),
    c = i % n,
    out = [];
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
  sol.forEach((c, r) => {
    reg[r * n + c] = r;
  });
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

// Smaller regions would give away where their cat goes.
const MIN_REGION = 3;

// Grows regions below MIN_REGION with a neighbouring cell from a bigger region,
// keeping only moves after which the puzzle still has exactly one solution.
function growSmallRegions(n, reg, sol, rnd) {
  const size = new Array(n).fill(0);
  reg.forEach((g) => size[g]++);
  for (;;) {
    const small = [...size.keys()].filter((g) => size[g] < MIN_REGION);
    if (!small.length) return true;
    const g = small[Math.floor(rnd() * small.length)];
    const options = [];
    for (let i = 0; i < n * n; i++) {
      const h = reg[i];
      if (h === g || size[h] <= MIN_REGION || i === h * n + sol[h]) continue;
      if (!neighbors4(i, n).some((j) => reg[j] === g)) continue;
      if (staysConnected(n, reg, h, i, h * n + sol[h])) options.push(i);
    }
    let grown = false;
    for (const i of shuffle(options, rnd)) {
      const h = reg[i];
      reg[i] = g;
      if (!findAlternative(n, reg, sol)) {
        size[h]--;
        size[g]++;
        grown = true;
        break;
      }
      reg[i] = h;
    }
    if (!grown) return false;
  }
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
      if (!alt) {
        unique = true;
        break;
      }
      // Move one of the alternative's cats into a neighbouring region, which invalidates that alternative.
      const candidates = [];
      alt.forEach((c, r) => {
        if (c === sol[r]) return;
        const i = r * n + c,
          g = reg[i];
        const targets = [
          ...new Set(
            neighbors4(i, n)
              .map((j) => reg[j])
              .filter((h) => h !== g),
          ),
        ];
        if (targets.length && staysConnected(n, reg, g, i, g * n + sol[g]))
          candidates.push([i, targets]);
      });
      if (!candidates.length) break;
      const [i, targets] = candidates[Math.floor(rnd() * candidates.length)];
      reg[i] = targets[Math.floor(rnd() * targets.length)];
    }
    if (unique && growSmallRegions(n, reg, sol, rnd))
      return { n, reg, sol, starter: Math.floor(rnd() * n) };
  }
}

// Difficulty score: solve with simple logic (singles + "this cat would empty a row/column/region").
// Each elimination step adds 1; needing deeper reasoning than that adds 1000.
function rateDifficulty({ n, reg, sol, starter }) {
  const N = n * n;
  const r = (i) => Math.floor(i / n),
    c = (i) => i % n;
  const clash = (a, b) =>
    r(a) === r(b) ||
    c(a) === c(b) ||
    reg[a] === reg[b] ||
    (Math.abs(r(a) - r(b)) <= 1 && Math.abs(c(a) - c(b)) <= 1);
  const units = [];
  for (let k = 0; k < n; k++) {
    units.push([...Array(n).keys()].map((x) => k * n + x));
    units.push([...Array(n).keys()].map((x) => x * n + k));
    units.push([...Array(N).keys()].filter((i) => reg[i] === k));
  }
  const open = new Array(N).fill(true);
  const placed = new Set();
  const place = (i) => {
    placed.add(i);
    for (let j = 0; j < N; j++) if (open[j] && clash(i, j)) open[j] = false;
  };
  const done = (u) => u.some((i) => placed.has(i));

  if (starter != null) place(starter * n + sol[starter]);
  let steps = 0;
  while (placed.size < n) {
    const single = units.find(
      (u) => !done(u) && u.filter((i) => open[i]).length === 1,
    );
    if (single) {
      place(single.find((i) => open[i]));
      continue;
    }
    let eliminated = false;
    for (let i = 0; i < N && !eliminated; i++) {
      if (!open[i]) continue;
      if (
        units.some(
          (u) =>
            !done(u) &&
            !u.includes(i) &&
            u.every((j) => !open[j] || clash(i, j)),
        )
      ) {
        open[i] = false;
        steps++;
        eliminated = true;
      }
    }
    if (!eliminated) return 1000 + steps;
  }
  return steps;
}

if (typeof module !== "undefined")
  module.exports = {
    generatePuzzle,
    rateDifficulty,
    mulberry32,
    shuffle,
    findAlternative,
  };
