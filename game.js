'use strict';

const LEVEL_COUNT = 100;
const DIFFS = {
  normal: { label: 'Normaal', salt: 1, size: (lvl) => (lvl <= 20 ? 6 : 7) },
  hard: { label: 'Moeilijk', salt: 2, size: () => 8 },
  ultra: { label: 'Ultra', salt: 3, size: (lvl) => (lvl <= 20 ? 9 : 10) },
};
const PALETTE = [
  '#f28b82', '#fbbc6c', '#f6dd6b', '#9fd98a', '#6fcfc4',
  '#8bb4f0', '#b79cf0', '#f29ccc', '#c9a98a', '#b8bec6',
];
const EMPTY = 0, MARK = 1, CAT = 2, LOCKED = 3;

const CAT_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <path d="M18 42 L22 8 L43 27 Q50 25 57 27 L78 8 L82 42 Q91 62 80 78 Q68 93 50 93 Q32 93 20 78 Q9 62 18 42Z" fill="#433a52"/>
  <path d="M25 19 L36 29 L26 35Z M75 19 L64 29 L74 35Z" fill="#f4a6b8"/>
  <ellipse cx="37" cy="56" rx="7.5" ry="8.5" fill="#fff"/><ellipse cx="63" cy="56" rx="7.5" ry="8.5" fill="#fff"/>
  <ellipse cx="38" cy="57" rx="3.5" ry="5.5" fill="#222"/><ellipse cx="62" cy="57" rx="3.5" ry="5.5" fill="#222"/>
  <path d="M46 69 L54 69 L50 74Z" fill="#f4a6b8"/>
  <path d="M50 74 Q46 80 41 77 M50 74 Q54 80 59 77" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
</svg>`;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
let cellEls = [];
let drag = null;
let hintTimer = null;
let explainTimer = null;

const progress = loadProgress();
const state = {
  diff: progress.lastDiff in DIFFS ? progress.lastDiff : 'normal',
  level: 1,
  puzzle: null,
  colors: [],
  cells: [],
  history: [],
  over: false,
  busy: false,
  playId: 0,
  start: 0,
  timer: null,
};

function loadProgress() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('meowdoku-progress')) || {}; } catch { /* corrupt storage: start fresh */ }
  p.solved ??= { normal: [], hard: [], ultra: [] };
  p.current ??= { normal: 1, hard: 1, ultra: 1 };
  return p;
}

function saveProgress() {
  localStorage.setItem('meowdoku-progress', JSON.stringify(progress));
}

const maxUnlocked = (diff) => Math.min(LEVEL_COUNT, Math.max(0, ...progress.solved[diff]) + 1);

// ---------- Level loading ----------

function loadLevel(diff, level) {
  state.diff = diff;
  state.level = level;
  state.busy = true;
  progress.lastDiff = diff;
  progress.current[diff] = level;
  saveProgress();

  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.diff === diff));
  $('levelLabel').textContent = `Level ${level}`;
  $('loading').classList.remove('hidden');

  setTimeout(() => {
    const n = DIFFS[diff].size(level);
    const seed = (DIFFS[diff].salt * 100003 + level * 7919) >>> 0;
    state.puzzle = generatePuzzle(n, seed);
    state.colors = shuffle(PALETTE.slice(), mulberry32(seed + 1)).slice(0, n);
    $('loading').classList.add('hidden');
    state.busy = false;
    buildBoard();
    resetPlay();
  }, 20);
}

function buildBoard() {
  const { n, reg } = state.puzzle;
  boardEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  boardEl.style.setProperty('--gap', `${Math.max(3, 9 - n / 2)}px`);
  boardEl.replaceChildren();
  cellEls = [];
  for (let i = 0; i < n * n; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.i = i;
    d.style.background = state.colors[reg[i]];
    boardEl.appendChild(d);
    cellEls.push(d);
  }
}

function resetPlay() {
  const { n, sol, starter } = state.puzzle;
  state.cells = new Array(n * n).fill(EMPTY);
  state.cells[starter * n + sol[starter]] = LOCKED;
  state.history = [];
  state.over = false;
  state.playId++;
  boardEl.classList.remove('won');
  clearHint();
  clearExplanation();
  cellEls.forEach((_, i) => paintCell(i));
  renderCounter();
  updateButtons();
  startTimer();
}

// ---------- Rendering ----------

function paintCell(i, pop = false) {
  const d = cellEls[i], s = state.cells[i];
  d.classList.toggle('locked', s === LOCKED);
  d.classList.toggle('pop', pop);
  d.innerHTML = s === MARK ? '<span class="mark">×</span>' : s >= CAT ? CAT_SVG : '';
}

function renderCounter() {
  const cats = state.cells.filter((s) => s >= CAT).length;
  $('counterText').textContent = `${cats}/${state.puzzle.n}`;
}

function updateButtons() {
  $('btnUndo').disabled = state.over || !state.history.length;
  $('btnHint').disabled = state.over;
}

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function startTimer() {
  clearInterval(state.timer);
  state.start = Date.now();
  $('timer').textContent = fmt(0);
  state.timer = setInterval(() => { $('timer').textContent = fmt(Date.now() - state.start); }, 1000);
}

function stopTimer() {
  clearInterval(state.timer);
  return Date.now() - state.start;
}

// ---------- Game actions ----------

function pushHistory() {
  state.history.push(state.cells.slice());
  updateButtons();
}

function setCell(i, v, pop = false) {
  state.cells[i] = v;
  paintCell(i, pop);
  renderCounter();
}

function tryPlaceCat(i) {
  clearHint();
  const conflict = findConflict(i);
  if (!conflict) {
    pushHistory();
    setCell(i, CAT, true);
    checkWin();
    return;
  }

  // Clashing cat: explain why and keep the X.
  showExplanation(conflict);
  const d = cellEls[i];
  d.innerHTML = CAT_SVG;
  d.classList.add('wrong');
  const playId = state.playId;
  setTimeout(() => {
    d.classList.remove('wrong');
    if (playId === state.playId) paintCell(i);
  }, 600);
}

function findConflict(i) {
  const { n, reg } = state.puzzle;
  const rc = (k) => [Math.floor(k / n), k % n];
  const [r1, c1] = rc(i);
  for (let k = 0; k < n * n; k++) {
    if (state.cells[k] < CAT) continue;
    const [r2, c2] = rc(k);
    const why = r1 === r2 ? 'staat in dezelfde rij als'
      : c1 === c2 ? 'staat in dezelfde kolom als'
      : reg[i] === reg[k] ? 'staat in hetzelfde gebied als'
      : Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 ? 'raakt'
      : null;
    if (why) return { cells: [k], text: `Deze kat ${why} een andere kat.` };
  }
  return null;
}

function showExplanation({ cells, text }) {
  clearExplanation();
  cells.forEach((k) => cellEls[k].classList.add('conflict'));
  const msg = $('message');
  msg.textContent = text;
  msg.classList.add('error');
  explainTimer = setTimeout(clearExplanation, 5000);
}

function clearExplanation() {
  clearTimeout(explainTimer);
  cellEls.forEach((el) => el.classList.remove('conflict'));
  const msg = $('message');
  msg.textContent = msg.dataset.tip;
  msg.classList.remove('error');
}

function checkWin() {
  const cats = state.cells.filter((s) => s >= CAT).length;
  if (cats !== state.puzzle.n) return;
  state.over = true;
  const time = stopTimer();
  const solved = progress.solved[state.diff];
  if (!solved.includes(state.level)) solved.push(state.level);
  saveProgress();
  boardEl.classList.add('won');
  updateButtons();

  const buttons = [{ label: 'Opnieuw spelen', action: resetPlay }];
  if (state.level < LEVEL_COUNT) {
    buttons.push({ label: 'Volgend level', primary: true, action: () => loadLevel(state.diff, state.level + 1) });
  }
  const playId = state.playId;
  setTimeout(() => {
    if (playId !== state.playId) return;
    showModal('Miauw! Opgelost', `<p>Level ${state.level} (${DIFFS[state.diff].label}) in <b>${fmt(time)}</b>.</p>`, buttons);
  }, 900);
}

function undo() {
  if (state.over || !state.history.length) return;
  clearHint();
  state.cells = state.history.pop();
  cellEls.forEach((_, i) => paintCell(i));
  renderCounter();
  updateButtons();
}

// Points at the solution cell of the region with the fewest cells still open given the placed cats.
function hint() {
  if (state.over || state.busy) return;
  const { n, reg, sol } = state.puzzle;
  const misplaced = state.cells.findIndex((s, i) => s === CAT && sol[Math.floor(i / n)] !== i % n);
  if (misplaced >= 0) {
    showExplanation({ cells: [misplaced], text: 'Deze kat staat niet op de goede plek. Haal hem weg en probeer het opnieuw.' });
    return;
  }
  const cats = [];
  state.cells.forEach((s, i) => { if (s >= CAT) cats.push(i); });
  const blocked = (i) => cats.some((k) => {
    const r1 = Math.floor(i / n), c1 = i % n, r2 = Math.floor(k / n), c2 = k % n;
    return r1 === r2 || c1 === c2 || reg[i] === reg[k] || (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1);
  });

  let best = -1, bestCount = Infinity;
  for (let g = 0; g < n; g++) {
    if (state.cells[g * n + sol[g]] >= CAT) continue;
    let open = 0;
    for (let i = 0; i < n * n; i++) if (reg[i] === g && !blocked(i)) open++;
    if (open < bestCount) { best = g; bestCount = open; }
  }
  if (best < 0) return;

  clearHint();
  const el = cellEls[best * n + sol[best]];
  el.classList.add('hint');
  hintTimer = setTimeout(clearHint, 3000);
}

function clearHint() {
  clearTimeout(hintTimer);
  cellEls.forEach((el) => el.classList.remove('hint'));
}

// ---------- Input ----------

boardEl.addEventListener('pointerdown', (e) => {
  const d = e.target.closest('.cell');
  if (!d || state.over || state.busy || e.button !== 0) return;
  e.preventDefault();
  clearExplanation();
  const i = +d.dataset.i, s = state.cells[i];
  drag = { start: i, startState: s, mode: null, moved: false };
  if (s === EMPTY) {
    pushHistory();
    setCell(i, MARK);
    drag.mode = 'mark';
  } else if (s === MARK) {
    drag.mode = 'pending';
  }
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || !drag.mode) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
  if (!el || !boardEl.contains(el)) return;
  const j = +el.dataset.i;
  if (j === drag.start && !drag.moved) return;
  drag.moved = true;
  if (drag.mode === 'pending') {
    pushHistory();
    setCell(drag.start, EMPTY);
    drag.mode = 'erase';
  }
  if (drag.mode === 'mark' && state.cells[j] === EMPTY) setCell(j, MARK);
  if (drag.mode === 'erase' && state.cells[j] === MARK) setCell(j, EMPTY);
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const { start, startState, moved } = drag;
  drag = null;
  if (moved || state.over) return;
  if (startState === MARK) tryPlaceCat(start);
  else if (startState === CAT) {
    pushHistory();
    setCell(start, EMPTY);
  }
});

window.addEventListener('pointercancel', () => { drag = null; });

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    undo();
  }
});

// ---------- Modals ----------

function showModal(title, body, buttons) {
  $('modalTitle').textContent = title;
  const bodyEl = $('modalBody');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.replaceChildren(body);
  const wrap = $('modalButtons');
  wrap.replaceChildren();
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.primary) el.className = 'primary';
    el.onclick = () => { hideModal(); b.action?.(); };
    wrap.appendChild(el);
  }
  $('modal').classList.remove('hidden');
}

function hideModal() {
  $('modal').classList.add('hidden');
}

function openLevels() {
  const grid = document.createElement('div');
  grid.className = 'level-grid';
  const solved = new Set(progress.solved[state.diff]);
  const max = maxUnlocked(state.diff);
  for (let l = 1; l <= LEVEL_COUNT; l++) {
    const b = document.createElement('button');
    b.textContent = l;
    b.classList.toggle('done', solved.has(l));
    b.classList.toggle('current', l === state.level);
    b.disabled = l > max;
    b.onclick = () => { hideModal(); loadLevel(state.diff, l); };
    grid.appendChild(b);
  }
  showModal(`Levels · ${DIFFS[state.diff].label}`, grid, [{ label: 'Sluiten' }]);
}

function openHelp() {
  showModal('Zo speel je Meowdoku', `
    <ul class="rules">
      <li><b>Eén kat per kleur</b> &ndash; elk gekleurd gebied krijgt precies één kat.</li>
      <li><b>Eén kat per rij en kolom</b> &ndash; katten delen nooit een rij of kolom.</li>
      <li><b>Niet aanraken</b> &ndash; ook diagonaal mogen katten elkaar niet raken.</li>
      <li><b>Bediening</b> &ndash; 1e klik zet een X, 2e klik een kat, 3e klik wist. Sleep over lege vakjes om snel X'en te zetten.</li>
      <li><b>Botsing</b> &ndash; een kat die botst met een kat die er al staat wordt niet geplaatst; je ziet waarom.</li>
      <li><b>Hint</b> &ndash; wijst een nuttig vakje aan, of een kat die niet goed staat.</li>
      <li>Begin bij de kat die al op het bord staat.</li>
    </ul>`, [{ label: 'Spelen', primary: true }]);
}

$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') hideModal(); });
$('tabs').addEventListener('click', (e) => {
  const diff = e.target.closest('button')?.dataset.diff;
  if (diff && !state.busy) loadLevel(diff, Math.min(progress.current[diff], maxUnlocked(diff)));
});
$('btnLevels').onclick = openLevels;
$('btnHint').onclick = hint;
$('btnUndo').onclick = undo;
$('btnRestart').onclick = () => { if (!state.busy) resetPlay(); };
$('btnHelp').onclick = openHelp;

loadLevel(state.diff, Math.min(progress.current[state.diff], maxUnlocked(state.diff)));
if (!progress.seenHelp) {
  progress.seenHelp = true;
  saveProgress();
  openHelp();
}
