"use strict";

const LEVEL_COUNT = 100;
const MAX_HEARTS = 3;
const MAX_HINTS = 3;
// [last level, board size]: the board grows every band.
const SIZE_BANDS = [
  [10, 6],
  [25, 7],
  [45, 8],
  [70, 9],
  [100, 10],
];
// Within a band, later levels pick harder puzzles out of this many candidates.
const CANDIDATES = 5;
const PALETTE = [
  "#f28b82",
  "#fbbc6c",
  "#f6dd6b",
  "#9fd98a",
  "#6fcfc4",
  "#8bb4f0",
  "#b79cf0",
  "#f29ccc",
  "#c9a98a",
  "#b8bec6",
];
const EMPTY = 0,
  MARK = 1,
  CAT = 2,
  LOCKED = 3;

const CAT_SVG = `<svg class="cat" viewBox="0 0 100 100" aria-hidden="true">
  <path d="M18 42 L22 8 L43 27 Q50 25 57 27 L78 8 L82 42 Q91 62 80 78 Q68 93 50 93 Q32 93 20 78 Q9 62 18 42Z" fill="#433a52"/>
  <path d="M25 19 L36 29 L26 35Z M75 19 L64 29 L74 35Z" fill="#f4a6b8"/>
  <ellipse cx="37" cy="56" rx="7.5" ry="8.5" fill="#fff"/><ellipse cx="63" cy="56" rx="7.5" ry="8.5" fill="#fff"/>
  <ellipse cx="38" cy="57" rx="3.5" ry="5.5" fill="#222"/><ellipse cx="62" cy="57" rx="3.5" ry="5.5" fill="#222"/>
  <path d="M46 69 L54 69 L50 74Z" fill="#f4a6b8"/>
  <path d="M50 74 Q46 80 41 77 M50 74 Q54 80 59 77" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
</svg>`;
const X_SVG = `<svg class="xmark" viewBox="0 0 100 100" aria-hidden="true">
  <line x1="18" y1="18" x2="82" y2="82"/><line x1="82" y1="18" x2="18" y2="82"/>
</svg>`;

const $ = (id) => document.getElementById(id);
const boardEl = $("board");
let cellEls = [];
let drag = null;
let hintTimer = null;
let explainTimer = null;

const progress = loadProgress();
const state = {
  level: 1,
  puzzle: null,
  colors: [],
  cells: [],
  hearts: MAX_HEARTS,
  hintsLeft: MAX_HINTS,
  best: {},
  history: [],
  over: false,
  busy: false,
  playId: 0,
  start: 0,
  timer: null,
};

function loadProgress() {
  let p = {};
  // Fall back to the key used before the rename to Kattendoku.
  const saved =
    localStorage.getItem("kattendoku-progress") ??
    localStorage.getItem("meowdoku-progress");
  try {
    p = JSON.parse(saved) || {};
  } catch {
    /* corrupt storage: start fresh */
  }
  // Progress from the old Normaal/Moeilijk/Ultra version doesn't map onto the new levels.
  if (!Array.isArray(p.solved)) {
    p.solved = [];
    p.current = 1;
  }
  delete p.lastDiff;
  return p;
}

function saveProgress() {
  localStorage.setItem("kattendoku-progress", JSON.stringify(progress));
}

const maxUnlocked = () =>
  Math.min(LEVEL_COUNT, Math.max(0, ...progress.solved) + 1);
const startLevel = () => Math.min(progress.current, maxUnlocked());

// ---------- Level loading ----------

function levelSpec(level) {
  let first = 1;
  for (const [last, size] of SIZE_BANDS) {
    if (level <= last) return { size, t: (level - first) / (last - first) };
    first = last + 1;
  }
}

// Deterministic per level, so every player gets the same puzzle.
function buildLevel(level) {
  const { size, t } = levelSpec(level);
  const seed = (level * 7919 + 100003) >>> 0;
  const candidates = [];
  for (let k = 0; k < CANDIDATES; k++) {
    const p = generatePuzzle(size, (seed + k * 1000003) >>> 0);
    p.score = rateDifficulty(p);
    candidates.push(p);
  }
  candidates.sort((a, b) => a.score - b.score);
  return { puzzle: candidates[Math.round(t * (CANDIDATES - 1))], seed };
}

function loadLevel(level) {
  state.level = level;
  state.busy = true;
  progress.current = level;
  saveProgress();

  $("levelLabel").textContent = `Level ${level}`;
  $("loading").classList.remove("hidden");

  setTimeout(() => {
    const { puzzle, seed } = buildLevel(level);
    state.puzzle = puzzle;
    state.colors = shuffle(PALETTE.slice(), mulberry32(seed + 1)).slice(
      0,
      puzzle.n,
    );
    $("loading").classList.add("hidden");
    state.busy = false;
    buildBoard();
    resetPlay();
  }, 20);
}

function buildBoard() {
  const { n, reg } = state.puzzle;
  boardEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  boardEl.style.setProperty("--gap", `${Math.max(3, 9 - n / 2)}px`);
  boardEl.replaceChildren();
  cellEls = [];
  for (let i = 0; i < n * n; i++) {
    const d = document.createElement("div");
    d.className = "cell";
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
  state.hearts = MAX_HEARTS;
  state.hintsLeft = MAX_HINTS;
  state.over = false;
  state.playId++;
  lastTap = null;
  boardEl.classList.remove("won");
  clearHint();
  clearExplanation();
  cellEls.forEach((_, i) => paintCell(i));
  renderCounter();
  renderHearts();
  updateButtons();
  startTimer();
}

// ---------- Rendering ----------

function paintCell(i, pop = false) {
  const d = cellEls[i],
    s = state.cells[i];
  d.classList.toggle("locked", s === LOCKED);
  d.classList.toggle("pop", pop);
  d.innerHTML = s === MARK ? X_SVG : s >= CAT ? CAT_SVG : "";
  if (pop) {
    clearTimeout(d.popTimer);
    d.popTimer = setTimeout(() => d.classList.remove("pop"), 900);
  }
}

function cellCenter(i, dy = 0.5) {
  const r = cellEls[i].getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height * dy, r.width];
}

function celebrateCat(i) {
  const [x, y, w] = cellCenter(i, 0.3);
  const colors = [
    state.colors[state.puzzle.reg[i]],
    "#fff",
    "#ffd166",
    "#f28b82",
    "#8bb4f0",
  ];
  setTimeout(() => fx.burst(x, y, 30, colors, w / 70), 200);
}

function poof(i) {
  const [x, y, w] = cellCenter(i);
  fx.burst(x, y, 14, ["#d8d2e0", "#fff", "#b8bec6"], w / 140);
}

function renderCounter() {
  const cats = state.cells.filter((s) => s >= CAT).length;
  const text = `${cats}/${state.puzzle.n}`;
  const el = $("counterText");
  if (el.textContent === text) return;
  el.textContent = text;
  const counter = $("counter");
  counter.classList.remove("bump");
  void counter.offsetWidth;
  counter.classList.add("bump");
}

function renderHearts(justLost = false) {
  $("hearts").innerHTML = Array.from({ length: MAX_HEARTS }, (_, k) => {
    const cls =
      k < state.hearts
        ? ""
        : k === state.hearts && justLost
          ? "lost breaking"
          : "lost";
    return `<span class="${cls}">♥</span>`;
  }).join("");
}

function updateButtons() {
  $("btnUndo").disabled = state.over || !state.history.length;
  $("btnHint").disabled = state.over || state.hintsLeft <= 0;
  $("btnHint").textContent = `Hint (${state.hintsLeft})`;
}

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function startTimer() {
  clearInterval(state.timer);
  state.start = Date.now();
  $("timer").textContent = fmt(0);
  state.timer = setInterval(() => {
    $("timer").textContent = fmt(Date.now() - state.start);
  }, 1000);
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
    celebrateCat(i);
    checkWin();
    return;
  }

  // Clashing cat: explain why and keep the X.
  showExplanation(conflict);
  const d = cellEls[i];
  d.innerHTML = CAT_SVG;
  d.classList.add("wrong");
  const playId = state.playId;
  setTimeout(() => {
    d.classList.remove("wrong");
    if (playId === state.playId) paintCell(i);
  }, 600);
  loseHeart();
}

function loseHeart() {
  state.hearts--;
  renderHearts(true);
  const heart = $("hearts").children[state.hearts].getBoundingClientRect();
  fx.burst(
    heart.left + heart.width / 2,
    heart.top + heart.height / 2,
    18,
    ["#e5484d", "#ff9a9a", "#fff"],
    0.7,
  );
  boardEl.classList.remove("hurt");
  void boardEl.offsetWidth;
  boardEl.classList.add("hurt");
  if (state.hearts > 0) return;

  state.over = true;
  stopTimer();
  clearHint();
  updateButtons();
  const playId = state.playId;
  setTimeout(() => {
    if (playId !== state.playId) return;
    showModal(
      "Oei, geen hartjes meer",
      "<p>Drie keer gebotst, de katten zijn boos. Begin het level opnieuw!</p>",
      [
        { label: "Levels", action: openLevels },
        { label: "Opnieuw", primary: true, action: resetPlay },
      ],
    );
  }, 1000);
}

function findConflict(i) {
  const { n, reg } = state.puzzle;
  const rc = (k) => [Math.floor(k / n), k % n];
  const [r1, c1] = rc(i);
  for (let k = 0; k < n * n; k++) {
    if (state.cells[k] < CAT) continue;
    const [r2, c2] = rc(k);
    const why =
      r1 === r2
        ? "staat in dezelfde rij als"
        : c1 === c2
          ? "staat in dezelfde kolom als"
          : reg[i] === reg[k]
            ? "staat in hetzelfde gebied als"
            : Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1
              ? "raakt"
              : null;
    if (why) return { cells: [k], text: `Deze kat ${why} een andere kat.` };
  }
  return null;
}

function showExplanation({ cells, text }) {
  clearExplanation();
  cells.forEach((k) => cellEls[k].classList.add("conflict"));
  const msg = $("message");
  msg.textContent = text;
  msg.classList.add("error");
  explainTimer = setTimeout(clearExplanation, 5000);
}

function clearExplanation() {
  clearTimeout(explainTimer);
  cellEls.forEach((el) => el.classList.remove("conflict"));
  const msg = $("message");
  msg.textContent = msg.dataset.tip;
  msg.classList.remove("error");
}

function checkWin() {
  const cats = state.cells.filter((s) => s >= CAT).length;
  if (cats !== state.puzzle.n) return;
  state.over = true;
  const time = stopTimer();
  const solved = progress.solved;
  if (!solved.includes(state.level)) solved.push(state.level);
  saveProgress();
  state.best[state.level] = Math.min(state.best[state.level] ?? Infinity, time);
  boardEl.classList.add("won");
  const n = state.puzzle.n;
  cellEls.forEach((el, k) =>
    el.style.setProperty("--wave", `${((k % n) + Math.floor(k / n)) * 70}ms`),
  );
  setTimeout(() => fx.show([...state.colors, "#fff", "#ffd166"]), 500);
  updateButtons();

  const buttons = [{ label: "Opnieuw spelen", action: resetPlay }];
  if (state.level < LEVEL_COUNT) {
    buttons.push({
      label: "Volgend level",
      primary: true,
      action: () => loadLevel(state.level + 1),
    });
  }
  const playId = state.playId;
  const pending = submitScore(state.level, time);
  setTimeout(() => {
    if (playId !== state.playId) return;
    const body = document.createElement("div");
    const p = document.createElement("p");
    p.innerHTML = `Level ${state.level} in <b>${fmtPrecise(time)}</b>.`;
    body.append(p, scoreList(state.level, pending));
    showModal("Miauw! Opgelost", body, buttons);
  }, 2600);
}

// ---------- Highscores ----------

const HS = window.KATTENDOKU_CONFIG ?? {};
const hsEnabled = Boolean(HS.supabaseUrl && HS.supabaseKey);

const fmtPrecise = (ms) => `${fmt(ms)}.${Math.floor((ms % 1000) / 100)}`;

async function hsFetch(path, options = {}) {
  const headers = {
    apikey: HS.supabaseKey,
    "Content-Type": "application/json",
    ...options.headers,
  };
  // Legacy anon keys are JWTs and also go in the Authorization header; publishable keys don't.
  if (!HS.supabaseKey.startsWith("sb_"))
    headers.Authorization = `Bearer ${HS.supabaseKey}`;
  const res = await fetch(`${HS.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) throw new Error(`Highscores: HTTP ${res.status}`);
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

// Supabase returns at most 1000 rows per request, so fetch in pages. `path` must have a stable order.
async function hsFetchAll(path) {
  const PAGE = 1000;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await hsFetch(`${path}&limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function submitScore(level, timeMs) {
  if (!hsEnabled || !progress.playerName) return Promise.resolve();
  return hsFetch("scores", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      name: progress.playerName,
      level,
      time_ms: Math.round(timeMs),
    }),
  });
}

// PostgREST takes everything after "eq." literally, so only URL-encoding is needed.
const pgValue = (v) => encodeURIComponent(v);
// Must match the generated name_key column (lower(name)) in supabase.sql.
const nameKey = (name) => (name ?? "").toLowerCase();

// Rebuilds solved levels and best times for the current player from the online scores.
// Returns true when the player's start level moved forward.
async function syncProgress() {
  if (!hsEnabled || !progress.playerName) return false;
  const before = startLevel();
  const rows = await hsFetchAll(
    `scores?select=level,time_ms&name_key=eq.${pgValue(nameKey(progress.playerName))}&order=id.asc`,
  );
  let added = false;
  for (const r of rows) {
    if (!progress.solved.includes(r.level)) {
      progress.solved.push(r.level);
      added = true;
    }
    state.best[r.level] = Math.min(state.best[r.level] ?? Infinity, r.time_ms);
  }
  if (added) progress.current = Math.max(progress.current, maxUnlocked());
  saveProgress();
  return startLevel() !== before;
}

function switchPlayer(name) {
  if (progress.playerName && nameKey(progress.playerName) !== nameKey(name)) {
    progress.solved = [];
    progress.current = 1;
  }
  progress.playerName = name;
  state.best = {};
  saveProgress();
  syncProgress()
    .catch(() => {})
    .finally(() => loadLevel(startLevel()));
}

async function fetchTop(level) {
  const query = `scores?select=name,time_ms&level=eq.${Number(level)}&order=time_ms.asc&limit=200`;
  const rows = await hsFetch(query);
  const seen = new Set();
  const best = [];
  for (const r of rows) {
    if (seen.has(nameKey(r.name))) continue;
    seen.add(nameKey(r.name));
    best.push(r);
    if (best.length === 10) break;
  }
  return best;
}

// All scores grouped per level with one (best) entry per player, fastest first.
async function fetchBoard() {
  const rows = await hsFetchAll(
    `scores?select=name,level,time_ms&order=time_ms.asc,id.asc`,
  );
  const levels = new Map();
  for (const r of rows) {
    if (!levels.has(r.level)) levels.set(r.level, []);
    const list = levels.get(r.level);
    if (!list.some((x) => nameKey(x.name) === nameKey(r.name))) list.push(r);
  }
  return levels;
}

const isMe = (name) => nameKey(name) === nameKey(progress.playerName);

// Names come from other players: only ever render them with textContent.
function rankList(items, label, value) {
  const ol = document.createElement("ol");
  for (const item of items) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    const right = document.createElement("span");
    name.textContent = label(item);
    right.textContent = value(item);
    li.classList.toggle("me", isMe(label(item)));
    li.append(name, right);
    ol.append(li);
  }
  return ol;
}

function asyncBlock(load, render) {
  const wrap = document.createElement("div");
  wrap.className = "scores";
  if (!hsEnabled) {
    wrap.textContent = "Highscores zijn nog niet ingesteld.";
    return wrap;
  }
  wrap.textContent = "Highscores laden…";
  load()
    .then((data) => {
      wrap.replaceChildren();
      render(wrap, data);
    })
    .catch(() => {
      wrap.textContent = "Highscores konden niet geladen worden.";
    });
  return wrap;
}

function scoreList(level, pending = Promise.resolve()) {
  return asyncBlock(
    () => pending.catch(() => {}).then(() => fetchTop(level)),
    (wrap, rows) => {
      if (!rows.length)
        wrap.textContent = "Nog geen tijden voor dit level. Wees de eerste!";
      else
        wrap.append(
          rankList(
            rows,
            (r) => r.name,
            (r) => fmtPrecise(r.time_ms),
          ),
        );
    },
  );
}

function allLevelsList() {
  return asyncBlock(
    () => fetchBoard(),
    (wrap, levels) => {
      if (!levels.size) {
        wrap.textContent = "Nog geen tijden. Wees de eerste!";
        return;
      }
      for (const level of [...levels.keys()].sort((a, b) => a - b)) {
        const list = levels.get(level);
        const block = document.createElement("div");
        block.className = "level-scores";
        const head = document.createElement("div");
        head.className = "level-scores-head";
        const title = document.createElement("b");
        title.textContent = `Level ${level}`;
        const mine = document.createElement("span");
        const me = list.findIndex((r) => isMe(r.name));
        if (me >= 0)
          mine.textContent = `jij: #${me + 1} · ${fmtPrecise(list[me].time_ms)}`;
        head.append(title, mine);
        block.append(
          head,
          rankList(
            list.slice(0, 3),
            (r) => r.name,
            (r) => fmtPrecise(r.time_ms),
          ),
        );
        wrap.append(block);
      }
    },
  );
}

function playersList() {
  return asyncBlock(
    () => fetchBoard(),
    (wrap, levels) => {
      const players = new Map();
      for (const list of levels.values()) {
        list.forEach((r, rank) => {
          const key = nameKey(r.name);
          if (!players.has(key))
            players.set(key, { name: r.name, solved: 0, records: 0 });
          const p = players.get(key);
          p.solved++;
          if (rank === 0) p.records++;
        });
      }
      if (!players.size) {
        wrap.textContent = "Nog geen spelers.";
        return;
      }
      const ranked = [...players.values()].sort(
        (a, b) =>
          b.solved - a.solved ||
          b.records - a.records ||
          a.name.localeCompare(b.name),
      );
      wrap.append(
        rankList(
          ranked,
          (p) => p.name,
          (p) =>
            `${p.solved} ${p.solved === 1 ? "level" : "levels"} · ${p.records} ${p.records === 1 ? "record" : "records"}`,
        ),
      );
    },
  );
}

function segmented(options, active, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "seg";
  for (const [value, label] of options) {
    const b = document.createElement("button");
    b.textContent = label;
    b.classList.toggle("active", value === active);
    b.onclick = () => onPick(value);
    wrap.append(b);
  }
  return wrap;
}

function askName(then) {
  const wrap = document.createElement("div");
  const p = document.createElement("p");
  p.textContent = "Geef je naam in, dan komen je tijden in de highscores.";
  const input = document.createElement("input");
  input.className = "name-input";
  input.maxLength = 20;
  input.placeholder = "Je naam";
  input.value = progress.playerName ?? "";
  wrap.append(p, input);

  const save = () => {
    const name = input.value.trim();
    if (!name) {
      input.classList.remove("shake");
      void input.offsetWidth;
      input.classList.add("shake");
      input.focus();
      return false;
    }
    if (nameKey(name) !== nameKey(progress.playerName)) switchPlayer(name);
    else {
      progress.playerName = name;
      saveProgress();
    }
    return true;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && save()) {
      hideModal();
      then?.();
    }
  });
  showModal(
    "Wie speelt er?",
    wrap,
    [{ label: "Starten", primary: true, validate: save, action: then }],
    { locked: !progress.playerName },
  );
  setTimeout(() => input.focus(), 50);
}

function openScores(view = "level") {
  const body = document.createElement("div");
  const who = document.createElement("p");
  who.textContent = `Je speelt als ${progress.playerName ?? "?"}.`;
  const views = [
    ["level", "Dit level"],
    ["all", "Alle levels"],
    ["players", "Spelers"],
  ];
  body.append(
    who,
    segmented(views, view, (v) => openScores(v)),
  );
  if (view === "level") {
    const sub = document.createElement("p");
    sub.className = "scores-sub";
    sub.textContent = `Level ${state.level}`;
    body.append(sub, scoreList(state.level));
  } else {
    body.append(view === "all" ? allLevelsList() : playersList());
  }
  showModal("Highscores", body, [
    { label: "Naam wijzigen", action: () => askName(() => openScores(view)) },
    { label: "Sluiten", primary: true },
  ]);
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
  if (state.over || state.busy || state.hintsLeft <= 0) return;
  const { n, reg, sol } = state.puzzle;
  const misplaced = state.cells.findIndex(
    (s, i) => s === CAT && sol[Math.floor(i / n)] !== i % n,
  );
  if (misplaced >= 0) {
    useHint();
    showExplanation({
      cells: [misplaced],
      text: "Deze kat staat niet op de goede plek. Haal hem weg en probeer het opnieuw.",
    });
    return;
  }
  const cats = [];
  state.cells.forEach((s, i) => {
    if (s >= CAT) cats.push(i);
  });
  const blocked = (i) =>
    cats.some((k) => {
      const r1 = Math.floor(i / n),
        c1 = i % n,
        r2 = Math.floor(k / n),
        c2 = k % n;
      return (
        r1 === r2 ||
        c1 === c2 ||
        reg[i] === reg[k] ||
        (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1)
      );
    });

  let best = -1,
    bestCount = Infinity;
  for (let g = 0; g < n; g++) {
    if (state.cells[g * n + sol[g]] >= CAT) continue;
    let open = 0;
    for (let i = 0; i < n * n; i++) if (reg[i] === g && !blocked(i)) open++;
    if (open < bestCount) {
      best = g;
      bestCount = open;
    }
  }
  if (best < 0) return;

  useHint();
  clearHint();
  const el = cellEls[best * n + sol[best]];
  el.classList.add("hint");
  hintTimer = setTimeout(clearHint, 3000);
}

function useHint() {
  state.hintsLeft--;
  updateButtons();
}

function clearHint() {
  clearTimeout(hintTimer);
  cellEls.forEach((el) => el.classList.remove("hint"));
}

// ---------- Input ----------

const DOUBLE_TAP_MS = 320;
let lastTap = null;

boardEl.addEventListener("pointerdown", (e) => {
  const d = e.target.closest(".cell");
  if (!d || state.over || state.busy || e.button !== 0) return;
  e.preventDefault();
  clearExplanation();
  const i = +d.dataset.i,
    s = state.cells[i];
  drag = {
    start: i,
    startState: s,
    mode: null,
    moved: false,
    cells: state.cells.slice(),
    historyLength: state.history.length,
  };
  if (s === EMPTY) {
    pushHistory();
    setCell(i, MARK, true);
    drag.mode = "mark";
  } else if (s === MARK) {
    drag.mode = "pending";
  }
});

boardEl.addEventListener("pointermove", (e) => {
  if (!drag || !drag.mode) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".cell");
  if (!el || !boardEl.contains(el)) return;
  const j = +el.dataset.i;
  if (j === drag.start && !drag.moved) return;
  drag.moved = true;
  if (drag.mode === "pending") {
    pushHistory();
    setCell(drag.start, EMPTY);
    drag.mode = "erase";
  }
  if (drag.mode === "mark" && state.cells[j] === EMPTY) setCell(j, MARK, true);
  if (drag.mode === "erase" && state.cells[j] === MARK) setCell(j, EMPTY);
});

window.addEventListener("pointerup", () => {
  if (!drag) return;
  const { start, startState, moved, cells, historyLength } = drag;
  drag = null;
  if (moved || state.over) {
    lastTap = null;
    return;
  }

  const now = performance.now();
  if (lastTap && lastTap.i === start && now - lastTap.t < DOUBLE_TAP_MS) {
    // Double tap: undo what the first tap did, then try to place a cat.
    const before = lastTap;
    lastTap = null;
    state.cells = before.cells;
    state.history.length = before.historyLength;
    paintCell(start);
    renderCounter();
    updateButtons();
    if (state.cells[start] < CAT) tryPlaceCat(start);
    return;
  }
  lastTap = { i: start, t: now, cells, historyLength };

  if (startState === MARK) {
    pushHistory();
    setCell(start, EMPTY);
  } else if (startState === CAT) {
    pushHistory();
    setCell(start, EMPTY);
    poof(start);
  }
});

window.addEventListener("pointercancel", () => {
  drag = null;
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
});

// ---------- Modals ----------

function showModal(title, body, buttons, { locked = false } = {}) {
  $("modal").dataset.locked = locked ? "1" : "";
  $("modalTitle").textContent = title;
  const bodyEl = $("modalBody");
  if (typeof body === "string") bodyEl.innerHTML = body;
  else bodyEl.replaceChildren(body);
  const wrap = $("modalButtons");
  wrap.replaceChildren();
  for (const b of buttons) {
    const el = document.createElement("button");
    el.textContent = b.label;
    if (b.primary) el.className = "primary";
    el.onclick = () => {
      if (b.validate && !b.validate()) return;
      hideModal();
      b.action?.();
    };
    wrap.appendChild(el);
  }
  $("modal").classList.remove("hidden");
}

function hideModal() {
  $("modal").classList.add("hidden");
}

function openLevels() {
  const grid = document.createElement("div");
  grid.className = "level-grid";
  const solved = new Set(progress.solved);
  const best = state.best;
  const max = maxUnlocked();
  for (let l = 1; l <= LEVEL_COUNT; l++) {
    const b = document.createElement("button");
    b.textContent = l;
    if (best[l]) {
      const t = document.createElement("small");
      t.textContent = fmt(best[l]);
      b.append(t);
    }
    b.classList.toggle("done", solved.has(l));
    b.classList.toggle("current", l === state.level);
    b.disabled = l > max;
    b.onclick = () => {
      hideModal();
      loadLevel(l);
    };
    grid.appendChild(b);
  }
  showModal("Levels", grid, [{ label: "Sluiten" }]);
}

function openHelp() {
  showModal(
    "Zo speel je Kattendoku",
    `
    <ul class="rules">
      <li><b>Eén kat per kleur</b> &ndash; elk gekleurd gebied krijgt precies één kat.</li>
      <li><b>Eén kat per rij en kolom</b> &ndash; katten delen nooit een rij of kolom.</li>
      <li><b>Niet aanraken</b> &ndash; ook diagonaal mogen katten elkaar niet raken.</li>
      <li><b>Bediening</b> &ndash; klik zet een X of haalt hem weg, dubbelklik zet een kat, klik op een kat haalt hem weg. Sleep over lege vakjes om snel X'en te zetten.</li>
      <li><b>Hartjes</b> &ndash; een kat die botst met een kat die er al staat kost een hartje. Na 3 fouten moet je het level opnieuw beginnen.</li>
      <li><b>Hint</b> &ndash; maximaal 3 per level. Wijst een nuttig vakje aan, of een kat die niet goed staat.</li>
      <li>Begin bij de kat die al op het bord staat.</li>
    </ul>`,
    [{ label: "Spelen", primary: true }],
  );
}

$("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal" && !$("modal").dataset.locked) hideModal();
});
$("btnLevels").onclick = openLevels;
$("btnHint").onclick = hint;
$("btnUndo").onclick = undo;
$("btnRestart").onclick = () => {
  if (!state.busy) resetPlay();
};
$("btnHelp").onclick = openHelp;
$("btnScores").onclick = () => openScores();

loadLevel(startLevel());
const firstHelp = () => {
  if (progress.seenHelp) return;
  progress.seenHelp = true;
  saveProgress();
  openHelp();
};
if (progress.playerName) {
  firstHelp();
  syncProgress()
    .then((moved) => {
      if (moved && !state.history.length) loadLevel(startLevel());
    })
    .catch(() => {});
} else {
  askName(firstHelp);
}
