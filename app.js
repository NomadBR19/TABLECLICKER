const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const suits = ["S", "H", "D", "C"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const redSuits = new Set(["H", "D"]);
const suitLabels = { S: "♠", H: "♥", D: "♦", C: "♣" };
const rouletteSegment = 360 / 37;
const SHARED_ROOM = "table-reseau";

const SLOT_SYMBOLS = [
  { id: "cherry", icon: "\uD83C\uDF52", label: "Cerise", weight: 31, mult: 1 },
  { id: "lemon", icon: "\uD83C\uDF4B", label: "Citron", weight: 25, mult: 2 },
  { id: "orange", icon: "\uD83C\uDF4A", label: "Orange", weight: 20, mult: 2 },
  { id: "bell", icon: "\uD83D\uDD14", label: "Cloche", weight: 13, mult: 4 },
  { id: "seven", icon: "7", label: "Sept", weight: 7, mult: 8 },
  { id: "gem", icon: "\uD83D\uDC8E", label: "Diamant", weight: 3, mult: 18 },
  { id: "star", icon: "\u2B50", label: "Wild", weight: 1, mult: 5, wild: true }
];
const SLOT_LINES = [
  { id: "top", name: "Haut", cells: [0, 1, 2] },
  { id: "middle", name: "Milieu", cells: [3, 4, 5] },
  { id: "bottom", name: "Bas", cells: [6, 7, 8] },
  { id: "left", name: "Gauche", cells: [0, 3, 6] },
  { id: "center", name: "Centre", cells: [1, 4, 7] },
  { id: "right", name: "Droite", cells: [2, 5, 8] },
  { id: "diag-a", name: "Diagonale", cells: [0, 4, 8] },
  { id: "diag-b", name: "Diagonale", cells: [2, 4, 6] }
];
const SLOT_SPIN_MS = 1600;
const SLOT_SCATTER_MULT = 3;
const SLOT_CROSS_BONUS_RATE = .05;
const SLOT_AUTO_SPINS = 10;
const SLOT_JACKPOT_SEED = 250;
const SLOT_JACKPOT_CONTRIBUTION = .02;

const upgrades = [
  { id: "finger", name: "Doigt sur", desc: "+1 par clic", base: 15, mult: 1.35, click: 1, cps: 0 },
  { id: "dealer", name: "Croupier auto", desc: "+1 jeton/s", base: 60, mult: 1.42, click: 0, cps: 1 },
  { id: "pit", name: "Mini pit", desc: "+8 jetons/s", base: 420, mult: 1.48, click: 0, cps: 8 },
  { id: "vip", name: "Salon VIP", desc: "+35 jetons/s et +4 clic", base: 2200, mult: 1.55, click: 4, cps: 35 },
  { id: "quant", name: "Algo de cote", desc: "+180 jetons/s", base: 12000, mult: 1.62, click: 0, cps: 180 },
  { id: "ghostDealer", name: "Croupier fantome", desc: "+750 jetons/s, roulette auto", base: 250000, mult: 2.35, click: 0, cps: 750 }
];

const DEFAULT_AUTOMATION = {
  roulette: { enabled: false, amount: 100, choice: "red", lastAt: 0 }
};
const MIN_GHOST_ROULETTE_BET = 100;
const ROULETTE_SPIN_MS = 4900;
const STAKE_BASE_STEPS = [25, 50, 100, 1000];
const MAX_STAKE_TIER = 12;
const MAX_SAFE_CHIPS = Number.MAX_SAFE_INTEGER;
const UI_RENDER_INTERVAL_MS = 250;
const HIDDEN_UI_RENDER_INTERVAL_MS = 1000;

const state = load() || {
  chips: 0,
  heat: 0,
  name: `Joueur${Math.floor(Math.random() * 900 + 100)}`,
  upgrades: Object.fromEntries(upgrades.map(u => [u.id, 0])),
  stats: { gambled: 0, won: 0 },
  automation: { roulette: { ...DEFAULT_AUTOMATION.roulette } }
};
normalizeState();

let mode = "table";
let room = SHARED_ROOM;
let playerId = getPlayerId();
let lastTick = performance.now();
let chipFractionRemainder = 0;
let bj = null;
let stakes = { roulette: 25, blackjack: 40, poker: 50, slots: 25 };
let stakeTier = Math.max(0, Math.min(MAX_STAKE_TIER, Math.floor(Number(localStorage.getItem("table-clicker-stake-tier")) || 0)));
let rouletteChoice = "red";
let rouletteSpin = 0;
let rouletteBusy = false;
let rouletteHistory = [];
let slotsBusy = false;
let slotsAutoBusy = false;
let slotsHistory = [];
let lastDisplayedSlotsJackpot = SLOT_JACKPOT_SEED;
let lastRenderedSlotsJackpot = null;
let lastRenderedSlotsLevel = "";
let lastRenderedSlotsTier = "";
let lastRenderedStakeTier = null;
let pokerBusy = false;
let lastPokerGameAt = Number(localStorage.getItem("table-clicker-last-poker") || 0);
let paidPokerHands = new Set(JSON.parse(localStorage.getItem("table-clicker-paid-poker-hands") || "[]"));
let pokerReady = false;
let pokerReadyCount = 0;
let pokerReadyDeadline = 0;
let pokerHandActive = false;
let pokerMyTurn = false;
let currentRace = null;
let raceScore = 0;
let lastRaceScoreSent = 0;
let paidRaceIds = new Set(JSON.parse(localStorage.getItem("table-clicker-paid-races") || "[]"));
let wonRaceIds = new Set(JSON.parse(localStorage.getItem("table-clicker-won-races") || "[]"));
let raceSnapshots = JSON.parse(localStorage.getItem("table-clicker-race-snapshots") || "{}");
let lastRoomPlayersKey = "";
let lastLobbyKey = "";
let lastPokerReadyKey = "";
let lastPokerHandKey = "";
let lastRaceKey = "";
let lastRaceLeaderboardKey = "";
let lastChatKey = "";
let lastEventsKey = "";
let seenBigWinEvents = new Set();
let seenChatMessages = new Set();
let chatInitialized = false;
let unreadChatCount = 0;
let activeNetworkTab = "chat";
let lastAutomationWarning = "";
let activeCelebrationFrame = 0;
let activeCelebrationCanvas = null;
let lastUiRenderAt = 0;
let lastRaceSyncCheckAt = 0;
let pollTableInFlight = false;
const emojiSpriteCache = new Map();
const prefersReducedMotion = globalThis.matchMedia ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;

const $ = id => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  const value = String(text);
  if (el && el.textContent !== value) el.textContent = value;
}

function setWidth(id, value) {
  const el = $(id);
  if (el && el.style.width !== value) el.style.width = value;
}

function emptyUpgrades() {
  return Object.fromEntries(upgrades.map(u => [u.id, 0]));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function safeWholeNumber(value, fallback = 0, max = MAX_SAFE_CHIPS) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, number));
}

function safeJackpot(value, fallback = SLOT_JACKPOT_SEED) {
  return Math.max(SLOT_JACKPOT_SEED, safeWholeNumber(value, fallback));
}

function save() {
  localStorage.setItem("table-clicker-save", JSON.stringify(state));
}

function load() {
  try { return JSON.parse(localStorage.getItem("table-clicker-save")); } catch { return null; }
}

function normalizeState() {
  state.chips = safeWholeNumber(state.chips);
  state.heat = Math.max(0, Math.min(100, Number(state.heat) || 0));
  state.upgrades = state.upgrades || {};
  upgrades.forEach(u => {
    if (!Number.isFinite(state.upgrades[u.id])) state.upgrades[u.id] = 0;
  });
  state.stats = state.stats || { gambled: 0, won: 0 };
  state.stats.gambled = safeWholeNumber(state.stats.gambled);
  state.stats.won = safeWholeNumber(state.stats.won);
  state.slots = state.slots || {};
  state.slots.jackpot = safeJackpot(state.slots.jackpot);
  state.slots.spins = Math.max(0, Math.floor(Number(state.slots.spins) || 0));
  state.automation = state.automation || {};
  state.automation.roulette = {
    ...DEFAULT_AUTOMATION.roulette,
    ...(state.automation.roulette || {})
  };
  state.automation.roulette.amount = Math.max(MIN_GHOST_ROULETTE_BET, Math.floor(Number(state.automation.roulette.amount) || MIN_GHOST_ROULETTE_BET));
  if (!["red", "black"].includes(state.automation.roulette.choice)) state.automation.roulette.choice = "red";
}

function getPlayerId() {
  const stored = localStorage.getItem("table-clicker-id");
  if (stored) return stored;
  const randomPart = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const id = `player-${randomPart}`;
  localStorage.setItem("table-clicker-id", id);
  return id;
}

function gain(amount) {
  const positive = Math.max(0, Number(amount) || 0);
  if (positive <= 0) return 0;
  const total = chipFractionRemainder + positive;
  const whole = Math.floor(total);
  chipFractionRemainder = total - whole;
  if (whole > 0) {
    state.chips = safeWholeNumber(state.chips + whole);
    if (state.chips >= MAX_SAFE_CHIPS) chipFractionRemainder = 0;
  }
  return whole;
}

function resetChipFractionRemainder() {
  chipFractionRemainder = 0;
}

function addRaceScore(amount) {
  if (!currentRace || currentRace.status !== "running") return;
  const me = myRaceRunner(currentRace);
  if (!me) return;
  raceScore += Math.max(0, amount);
}

function spend(amount) {
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount <= 0 || state.chips < amount) return false;
  state.chips -= amount;
  return true;
}

function clickPower() {
  return 1 + upgrades.reduce((sum, u) => sum + state.upgrades[u.id] * u.click, 0);
}

function cps() {
  return upgrades.reduce((sum, u) => sum + state.upgrades[u.id] * u.cps, 0);
}

function ghostDealerLevel() {
  return state.upgrades.ghostDealer || 0;
}

function ghostRouletteCooldown() {
  const level = ghostDealerLevel();
  return Math.max(30000, 60000 - Math.max(0, level - 1) * 7500);
}

function upgradeCost(u) {
  return Math.floor(u.base * Math.pow(u.mult, state.upgrades[u.id]));
}

function renderUpgrades() {
  $("upgrades").innerHTML = upgrades.map(u => {
    const owned = state.upgrades[u.id];
    const cost = upgradeCost(u);
    return `<button class="upgrade" data-upgrade="${u.id}">
      <span><strong>${escapeHtml(u.name)} niv. ${owned}</strong><p>${escapeHtml(u.desc)}</p></span>
      <strong>${fmt.format(cost)}</strong>
    </button>`;
  }).join("");
}

function render(forceUpgrades = false) {
  setText("chips", fmt.format(state.chips));
  setText("income", `${fmt.format(cps())}/s`);
  setText("clickValue", `+${fmt.format(clickPower())}`);
  setText("rouletteStake", fmt.format(stakes.roulette));
  setText("blackjackStake", fmt.format(stakes.blackjack));
  setText("pokerStake", fmt.format(stakes.poker));
  setText("slotsStake", fmt.format(stakes.slots));
  renderStakeTierControls();
  renderSlotsPanel();
  setText("raceScore", fmt.format(raceScore));
  updatePokerAvailability();
  updateRaceControls();
  setWidth("heatFill", `${Math.min(100, state.heat).toFixed(1)}%`);
  renderAutomation();
  if (document.activeElement !== $("playerName")) $("playerName").value = state.name;
  if (forceUpgrades) renderUpgrades();
}

function deck() {
  return suits.flatMap(suit => ranks.map(rank => ({ rank, suit }))).sort(() => Math.random() - .5);
}

function cardValue(card) {
  if (card.rank === "A") return 11;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handValue(hand) {
  let value = hand.reduce((sum, c) => sum + cardValue(c), 0);
  let aces = hand.filter(c => c.rank === "A").length;
  while (value > 21 && aces) {
    value -= 10;
    aces--;
  }
  return value;
}

function renderCards(el, hand, hideFirst = false) {
  el.innerHTML = hand.map((card, i) => {
    if (hideFirst && i === 0) return `<div class="card" style="--i:${i}">?</div>`;
    const red = redSuits.has(card.suit) ? " red" : "";
    return `<div class="card${red}" style="--i:${i}">${escapeHtml(card.rank)}${suitLabels[card.suit] || card.suit}</div>`;
  }).join("");
}

function settleBet(bet, payout, label, origin = null) {
  if (payout > 0) {
    gain(payout);
    state.stats.won = safeWholeNumber(state.stats.won + payout);
    spawnFloatText(origin, `+${fmt.format(payout)}`, "win");
    if (payout >= 1000000) grandCelebrate(origin, "jackpot");
    else celebrate(origin, payout >= bet * 4 ? "mega" : "win");
  }
  state.stats.gambled = safeWholeNumber(state.stats.gambled + bet);
  $("ticker").textContent = label;
  save();
  render();
}

async function announceGame(game, result, amount = 0) {
  if (mode !== "table" || !room) return;
  await sendTableAction({ type: "game", game, result, amount });
}

function playRoulette(options = {}) {
  if (rouletteBusy) return;
  const bet = Math.floor(options.bet || stakes.roulette);
  const choice = options.choice || rouletteChoice;
  const automated = Boolean(options.automated);
  if (!spend(bet)) return log("rouletteLog", "Mise impossible.");
  render();
  rouletteBusy = true;
  $("spinRoulette").disabled = true;
  $("wheel").classList.add("spinning");
  $("wheel").dataset.color = "idle";
  $("wheelNumber").textContent = "*";
  $("wheelColor").textContent = "";
  rouletteSpin += 1080 + Math.floor(Math.random() * 360);
  $("wheel").querySelector(".wheel-ring").style.transform = `rotate(${rouletteSpin}deg)`;
  log("rouletteLog", `${automated ? "Le croupier fantome lance" : "La bille tourne"} pour ${fmt.format(bet)} jetons...`);

  const n = Math.floor(Math.random() * 37);
  const color = n === 0 ? "green" : n % 2 ? "red" : "black";
  const win = choice === color;
  const mult = choice === "green" ? 14 : 2;
  const targetRotation = rouletteTargetRotation(n);
  const currentRotation = positiveModulo(rouletteSpin, 360);
  const rotationDelta = positiveModulo(targetRotation - currentRotation, 360) + 1080;
  const finalRotation = rouletteSpin + rotationDelta;
  rouletteSpin = finalRotation;
  requestAnimationFrame(() => {
    $("wheel").querySelector(".wheel-ring").style.transform = `rotate(${finalRotation}deg)`;
  });
  window.setTimeout(() => {
    $("wheel").classList.remove("spinning");
    $("wheel").dataset.color = color;
    $("wheelNumber").textContent = n;
    $("wheelColor").textContent = colorLabel(color);
    addRouletteHistory(n, color);
    const payout = win ? bet * mult : 0;
    const result = win
      ? `${automated ? "Croupier fantome: " : ""}${colorLabel(color)} ${n}. Gain ${fmt.format(payout)}`
      : `${automated ? "Croupier fantome: " : ""}${colorLabel(color)} ${n}. Perdu ${fmt.format(bet)}`;
    log("rouletteLog", `${result}.`);
    announceGame("roulette", result, payout);
    settleBet(bet, payout, automated ? "Le croupier fantome revient de la roulette." : "La roulette vient de tourner.", $("roulette"));
    rouletteBusy = false;
    $("spinRoulette").disabled = false;
  }, ROULETTE_SPIN_MS);
}

function renderSlotsPanel() {
  const payouts = $("slotsPayouts");
  const level = state.slots.spins >= 200 ? "or" : state.slots.spins >= 50 ? "argent" : "bronze";
  if (level !== lastRenderedSlotsLevel) {
    $("slots").dataset.slotLevel = level;
    lastRenderedSlotsLevel = level;
  }
  const jackpotEl = $("slotsJackpot");
  const jackpotBox = jackpotEl ? jackpotEl.closest(".slot-jackpot") : null;
  const jackpotTier = state.slots.jackpot >= 10000 ? "meteor" : state.slots.jackpot >= 2500 ? "crown" : state.slots.jackpot >= 750 ? "surge" : "base";
  if (jackpotTier !== lastRenderedSlotsTier) {
    $("slots").dataset.jackpotTier = jackpotTier;
    lastRenderedSlotsTier = jackpotTier;
  }
  if (jackpotEl && state.slots.jackpot !== lastRenderedSlotsJackpot) {
    jackpotEl.textContent = fmt.format(state.slots.jackpot);
    lastRenderedSlotsJackpot = state.slots.jackpot;
  }
  if (jackpotBox) {
    const jackpotChanged = state.slots.jackpot !== lastDisplayedSlotsJackpot;
    if (jackpotChanged) {
      jackpotBox.classList.remove("pulse-rise", "pulse-drop");
      void jackpotBox.offsetWidth;
      jackpotBox.classList.add(state.slots.jackpot >= lastDisplayedSlotsJackpot ? "pulse-rise" : "pulse-drop");
    }
  }
  lastDisplayedSlotsJackpot = state.slots.jackpot;
  setText("slotsStatus", `${SLOT_LINES.length} lignes actives - ${level}`);
  if (!payouts || payouts.dataset.ready === "true") {
    return;
  }
  payouts.dataset.ready = "true";
  const wild = SLOT_SYMBOLS.find(symbol => symbol.wild);
  const gem = SLOT_SYMBOLS.find(symbol => symbol.id === "gem");
  payouts.innerHTML = SLOT_SYMBOLS.filter(symbol => !symbol.wild).slice().reverse().map(symbol => `
    <span data-symbol="${escapeHtml(symbol.id)}"><b>${escapeHtml(symbol.icon)}${escapeHtml(symbol.icon)}${escapeHtml(symbol.icon)}</b> x${symbol.mult}</span>
  `).join("") + `<span data-symbol="${escapeHtml(wild.id)}"><b>${escapeHtml(wild.icon.repeat(3))}</b> x${wild.mult}</span><span data-symbol="scatter-gem"><b>3${escapeHtml(gem.icon)}</b> bonus x${SLOT_SCATTER_MULT}</span>`;
}

function setSlotsControlsDisabled(disabled) {
  $("spinSlots").disabled = disabled;
  $("autoSlots10").disabled = disabled;
  document.querySelectorAll("[data-stake-game=\"slots\"] button").forEach(btn => {
    btn.disabled = disabled;
  });
  if (!disabled) renderStakeTierControls();
}

function applySharedSlotsState(slots, options = {}) {
  if (!slots) return;
  const nextJackpot = safeJackpot(slots.jackpot);
  const nextSpins = Math.max(0, Math.floor(Number(slots.spins) || 0));
  const changed = nextJackpot !== state.slots.jackpot || nextSpins !== state.slots.spins;
  state.slots.jackpot = nextJackpot;
  state.slots.spins = nextSpins;
  if (!changed) return;
  if (options.render) render();
  else renderSlotsPanel();
}

function weightedSlotSymbol() {
  const total = SLOT_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);
  let roll = Math.random() * total;
  for (const symbol of SLOT_SYMBOLS) {
    roll -= symbol.weight;
    if (roll <= 0) return symbol;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1];
}

function slotSymbolById(id) {
  return SLOT_SYMBOLS.find(symbol => symbol.id === id) || SLOT_SYMBOLS[0];
}

function hydrateSlotResult(result = {}) {
  return {
    ...result,
    wins: (result.wins || []).map(win => {
      const symbol = slotSymbolById(win.symbolId);
      return {
        ...win,
        icon: symbol.icon,
        label: symbol.label,
      };
    })
  };
}

function winningLineSymbol(symbols) {
  const natural = symbols.find(symbol => !symbol.wild);
  if (!natural) return symbols[0];
  return symbols.every(symbol => symbol.wild || symbol.id === natural.id) ? natural : null;
}

function nearMissSlots(grid, wins) {
  if (wins.length) return null;
  const bestSymbols = new Set(["seven", "gem", "star"]);
  for (const line of SLOT_LINES) {
    const symbols = line.cells.map(index => grid[index]);
    const counts = symbols.reduce((map, symbol) => {
      if (!symbol.wild) map.set(symbol.id, (map.get(symbol.id) || 0) + 1);
      return map;
    }, new Map());
    for (const [id, count] of counts) {
      if (count === 2 && bestSymbols.has(id)) return { ...line, symbolId: id };
    }
  }
  return null;
}

function scoreSlots(grid, bet, jackpotValue = state.slots.jackpot) {
  const wins = [];
  for (const line of SLOT_LINES) {
    const symbols = line.cells.map(index => grid[index]);
    const symbol = winningLineSymbol(symbols);
    if (symbol) {
      wins.push({
        ...line,
        icon: symbol.icon,
        label: symbol.label,
        symbolId: symbol.id,
        payout: bet * symbol.mult,
      });
    }
  }

  const counts = grid.reduce((map, symbol) => {
    map.set(symbol.id, (map.get(symbol.id) || 0) + 1);
    return map;
  }, new Map());
  let scatterPayout = 0;
  if ((counts.get("gem") || 0) >= 3) {
    scatterPayout = bet * SLOT_SCATTER_MULT;
  }
  const jackpotWin = wins.find(win => win.symbolId === "gem");
  const jackpotPayout = jackpotWin ? safeJackpot(jackpotValue) : 0;

  const lineTotal = wins.reduce((sum, win) => sum + win.payout, 0);
  const crossBonus = wins.length > 1 ? Math.floor(lineTotal * (wins.length - 1) * SLOT_CROSS_BONUS_RATE) : 0;
  const payout = lineTotal + scatterPayout + crossBonus + jackpotPayout;
  const nearMiss = nearMissSlots(grid, wins);
  if (!payout) return { payout: 0, wins, scatterPayout, crossBonus, jackpotPayout, nearMiss, text: nearMiss ? `Presque ${nearMiss.name}. Perdu ${fmt.format(bet)}` : `Aucune ligne. Perdu ${fmt.format(bet)}` };

  const parts = [];
  if (wins.length) parts.push(`${wins.length} ligne${wins.length > 1 ? "s" : ""}`);
  if (scatterPayout) parts.push("bonus diamants");
  if (crossBonus) parts.push("bonus croise");
  if (jackpotPayout) parts.push("jackpot");
  return {
    payout,
    wins,
    scatterPayout,
    crossBonus,
    jackpotPayout,
    nearMiss,
    text: `${parts.join(", ")}. Gain ${fmt.format(payout)}`
  };
}

function highlightSlotPayouts(wins = [], scatterPayout = 0, jackpotPayout = 0) {
  document.querySelectorAll("#slotsPayouts span").forEach(el => {
    const active = wins.some(win => win.symbolId === el.dataset.symbol)
      || (scatterPayout && el.dataset.symbol === "scatter-gem")
      || (jackpotPayout && el.dataset.symbol === "gem");
    el.classList.toggle("active", Boolean(active));
  });
}

function renderSlotGrid(grid, result = {}) {
  const wins = result.wins || [];
  const winningCells = new Set(wins.flatMap(win => win.cells));
  const tone = result.jackpotPayout
    ? "jackpot"
    : result.payout >= Math.max(1, result.bet || 0) * 8
      ? "mega"
      : result.payout > Math.max(1, result.bet || 0)
        ? "win"
        : result.nearMiss
          ? "near"
          : "idle";
  $("slots").dataset.slotTone = tone;
  [...document.querySelectorAll("#slotReels .slot-reel")].forEach((el, index) => {
    el.textContent = grid[index].icon;
    el.dataset.symbol = grid[index].id;
    el.setAttribute("aria-label", grid[index].label);
    el.classList.toggle("win", winningCells.has(index));
    el.classList.toggle("near", Boolean(result.nearMiss && result.nearMiss.cells.includes(index)));
    el.style.setProperty("--i", index);
  });
  const lines = $("slotsWinLines");
  const reels = $("slotReels");
  if (reels) {
    reels.querySelectorAll(".slot-payline").forEach(line => line.remove());
    wins.forEach(win => {
      const line = document.createElement("i");
      line.className = "slot-payline";
      line.dataset.line = win.id;
      line.setAttribute("aria-hidden", "true");
      reels.appendChild(line);
    });
  }
  highlightSlotPayouts(wins, result.scatterPayout, result.jackpotPayout);
  if (!lines) return;
  lines.innerHTML = wins.map(win => `
    <span data-line="${escapeHtml(win.id)}">${escapeHtml(win.name)} ${escapeHtml(win.icon)} x${fmt.format(win.payout)}</span>
  `).join("") + (result.jackpotPayout ? `<span data-line="jackpot">Jackpot +${fmt.format(result.jackpotPayout)}</span>` : "") + (!wins.length && result.nearMiss ? `<span class="near-miss" data-line="${escapeHtml(result.nearMiss.id)}">Presque ${escapeHtml(result.nearMiss.name)}</span>` : "");
}

function randomSlotPreview() {
  return Array.from({ length: 9 }, () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
}

function addSlotsHistory(grid, payout, wins, bet, result = {}) {
  slotsHistory = [{
    grid,
    payout,
    bet,
    wins: wins.length,
    jackpot: Boolean(result.jackpotPayout),
    scatter: Boolean(result.scatterPayout),
    cross: Boolean(result.crossBonus),
    near: Boolean(result.nearMiss),
  }, ...slotsHistory].slice(0, 6);
  $("slotsHistory").innerHTML = slotsHistory.map(item => {
    const rows = [0, 3, 6].map(start => item.grid.slice(start, start + 3).map(symbol => escapeHtml(symbol.icon)).join("")).join("/");
    const net = item.payout - item.bet;
    const netText = net >= 0 ? `+${fmt.format(net)}` : `-${fmt.format(Math.abs(net))}`;
    const badges = [
      item.jackpot ? `<i class="slot-history-badge jackpot">JACKPOT</i>` : "",
      item.scatter ? `<i class="slot-history-badge scatter">3GEM</i>` : "",
      item.cross ? `<i class="slot-history-badge cross">X</i>` : "",
      item.near && !item.payout ? `<i class="slot-history-badge near">PRESQUE</i>` : "",
    ].join("");
    return `
      <span class="${item.payout > item.bet ? "win" : item.payout > 0 ? "push" : ""}${item.jackpot ? " jackpot" : ""}" title="${item.payout > 0 ? `Gain ${fmt.format(item.payout)}` : "Perdu"}">
        ${rows} <b>${netText}</b>${item.wins ? ` L${item.wins}` : ""}${badges}
      </span>
    `;
  }).join("");
}

function previewSlotsSpin(finalGrid) {
  const reelEls = [...document.querySelectorAll("#slotReels .slot-reel")];
  const startedAt = performance.now();
  const columnStopAt = [780, 1060, 1340];
  let ticks = 0;
  const timer = window.setInterval(() => {
    const elapsed = performance.now() - startedAt;
    reelEls.forEach((el, index) => {
      const col = index % 3;
      if (elapsed >= columnStopAt[col]) {
        const finalSymbol = finalGrid[index];
        if (el.dataset.symbol !== finalSymbol.id) {
          el.textContent = finalSymbol.icon;
          el.dataset.symbol = finalSymbol.id;
          el.setAttribute("aria-label", finalSymbol.label);
          el.classList.add("settled");
        }
        return;
      }
      const symbol = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
      el.textContent = symbol.icon;
      el.dataset.symbol = symbol.id;
      el.setAttribute("aria-label", symbol.label);
      el.classList.remove("win", "near", "settled");
      el.style.setProperty("--i", index);
    });
    ticks += 1;
    if (ticks >= 22) window.clearInterval(timer);
  }, 70);
  return () => window.clearInterval(timer);
}

function settleSlotsSpin(grid, bet, previewTimer, auto = null, resolvedResult = null) {
  if (previewTimer) previewTimer();
  const result = resolvedResult ? hydrateSlotResult(resolvedResult) : scoreSlots(grid, bet, state.slots.jackpot);
  result.bet = bet;
  renderSlotGrid(grid, result);
  addSlotsHistory(grid, result.payout, result.wins, bet, result);
  if (!auto) {
    log("slotsLog", `Golden Grid: ${result.text}.`);
    announceGame("machine", `Golden Grid: ${result.text}`, result.payout);
  }
  settleBet(bet, result.payout, "La machine a sous rend son verdict.", $("slots"));
  setSlotsControlsDisabled(true);
  $("slotReels").classList.remove("spinning");
  document.querySelectorAll("#slotReels .slot-reel").forEach(el => el.classList.remove("settled"));
  if (auto) {
    auto.totalBet += bet;
    auto.totalPayout += result.payout;
    auto.bestPayout = Math.max(auto.bestPayout, result.payout);
    auto.jackpots = (auto.jackpots || 0) + (result.jackpotPayout ? 1 : 0);
  }
  if (!auto && result.wins.length > 1) {
    showTableAnnouncement(`Machine: ${result.wins.length} lignes croisees`, `slots-cross-${Date.now()}`);
  }
  if (auto && auto.remaining > 1) {
    slotsBusy = false;
    window.setTimeout(() => spinSlots({ auto: { ...auto, remaining: auto.remaining - 1 } }), 420);
    return;
  }
  if (auto) {
    const net = auto.totalPayout - auto.totalBet;
    const sign = net >= 0 ? "+" : "-";
    const jackpotText = auto.jackpots ? ` ${auto.jackpots} jackpot${auto.jackpots > 1 ? "s" : ""}.` : "";
    const summary = `Auto x${SLOT_AUTO_SPINS}: mises ${fmt.format(auto.totalBet)}, gains ${fmt.format(auto.totalPayout)}, net ${sign}${fmt.format(Math.abs(net))}. Meilleur ${fmt.format(auto.bestPayout)}.${jackpotText}`;
    log("slotsLog", summary);
    announceGame("machine", summary, Math.max(0, net));
  }
  $("slots").classList.remove("game-running");
  slotsBusy = false;
  slotsAutoBusy = false;
  setSlotsControlsDisabled(false);
}

async function spinSlots(options = {}) {
  if (slotsBusy) return;
  const bet = Math.floor(stakes.slots);
  if (!spend(bet)) {
    if (options.auto) {
      slotsAutoBusy = false;
      setSlotsControlsDisabled(false);
      const net = options.auto.totalPayout - options.auto.totalBet;
      const sign = net >= 0 ? "+" : "-";
      log("slotsLog", `Auto interrompu: fonds insuffisants. Net ${sign}${fmt.format(Math.abs(net))}.`);
    } else {
      log("slotsLog", "Mise impossible.");
    }
    return;
  }
  slotsBusy = true;
  const auto = options.auto || null;
  if (auto) slotsAutoBusy = true;
  $("slots").classList.add("game-running");
  $("slotReels").classList.add("spinning");
  setSlotsControlsDisabled(true);
  $("slotsWinLines").innerHTML = "";
  $("slotReels").querySelectorAll(".slot-payline").forEach(line => line.remove());
  highlightSlotPayouts();
  const spinLabel = auto ? `Auto ${SLOT_AUTO_SPINS - auto.remaining + 1}/${SLOT_AUTO_SPINS}` : "Golden Grid";
  log("slotsLog", `${spinLabel}: les 8 lignes tournent pour ${fmt.format(bet)} jetons...`);

  const sync = await sendTableAction({ type: "slots_spin", amount: bet }, true);
  if (!sync.ok) {
    gain(bet);
    slotsBusy = false;
    slotsAutoBusy = false;
    $("slots").classList.remove("game-running");
    $("slotReels").classList.remove("spinning");
    setSlotsControlsDisabled(false);
    log("slotsLog", sync.error || "Jackpot indisponible.");
    render();
    return;
  }
  const grid = Array.from({ length: 9 }, (_, index) => slotSymbolById((sync.grid || [])[index]));
  applySharedSlotsState(sync.slots, { render: true });
  const previewTimer = previewSlotsSpin(grid);
  window.setTimeout(() => settleSlotsSpin(grid, bet, previewTimer, auto, sync.result || null), SLOT_SPIN_MS);
}

function autoSlots10() {
  if (slotsBusy || slotsAutoBusy) return;
  const bet = Math.floor(stakes.slots);
  if (state.chips < bet) return log("slotsLog", "Mise impossible.");
  spinSlots({ auto: { remaining: SLOT_AUTO_SPINS, totalBet: 0, totalPayout: 0, bestPayout: 0, jackpots: 0 } });
}

function renderAutomation() {
  const panel = $("ghostAutomation");
  if (!panel) return;
  const level = ghostDealerLevel();
  panel.hidden = level <= 0;
  if (level <= 0) return;

  const cfg = state.automation.roulette;
  const now = Date.now();
  const cooldown = ghostRouletteCooldown();
  const elapsed = Math.max(0, now - (cfg.lastAt || 0));
  const remaining = cfg.enabled ? Math.max(0, cooldown - elapsed) : cooldown;
  const status = cfg.enabled
    ? `Actif - prochain lancer dans ${Math.ceil(remaining / 1000)}s`
    : `Pret - delai ${Math.round(cooldown / 1000)}s`;

  setText("ghostLevel", `Niv. ${level}`);
  setText("ghostStatus", status);
  setWidth("ghostCooldown", `${cfg.enabled ? Math.min(100, elapsed / cooldown * 100).toFixed(1) : 0}%`);
  $("ghostToggle").checked = Boolean(cfg.enabled);
  if (document.activeElement !== $("ghostAmount")) $("ghostAmount").value = cfg.amount;
  if (document.activeElement !== $("ghostChoice")) $("ghostChoice").value = cfg.choice;
  panel.classList.toggle("automation-active", Boolean(cfg.enabled));
}

function runAutomation() {
  const level = ghostDealerLevel();
  const cfg = state.automation.roulette;
  if (level <= 0 || !cfg.enabled || rouletteBusy) return;
  const now = Date.now();
  if (now - (cfg.lastAt || 0) < ghostRouletteCooldown()) return;
  const bet = Math.max(MIN_GHOST_ROULETTE_BET, Math.floor(Number(cfg.amount) || MIN_GHOST_ROULETTE_BET));
  if (state.chips < bet) {
    if (lastAutomationWarning !== "wait-chips") log("rouletteLog", "Le croupier fantome attend assez de jetons.");
    lastAutomationWarning = "wait-chips";
    return;
  }
  lastAutomationWarning = "";
  cfg.lastAt = now;
  save();
  playRoulette({ bet, choice: cfg.choice, automated: true });
}

function addRouletteHistory(number, color) {
  rouletteHistory = [{ number, color }, ...rouletteHistory].slice(0, 18);
  $("rouletteHistory").innerHTML = rouletteHistory.map(item => `
    <span class="roulette-dot ${item.color}" title="${colorLabel(item.color)} ${item.number}">${item.number}</span>
  `).join("");
}

function colorLabel(color) {
  if (color === "red") return "Rouge";
  if (color === "black") return "Noir";
  return "Zero";
}

function rouletteColor(number) {
  if (number === 0) return "green";
  return number % 2 ? "red" : "black";
}

function rouletteTargetRotation(number) {
  const pocketCenter = number * rouletteSegment + rouletteSegment / 2;
  return positiveModulo(-pocketCenter, 360);
}

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function paintRouletteWheel() {
  const stops = [];
  for (let number = 0; number < 37; number++) {
    const color = rouletteColor(number);
    const cssColor = color === "green" ? "var(--green)" : color === "red" ? "var(--red)" : "var(--black)";
    const start = number * rouletteSegment;
    const end = (number + 1) * rouletteSegment;
    stops.push(`${cssColor} ${start.toFixed(3)}deg ${end.toFixed(3)}deg`);
  }
  $("wheel").querySelector(".wheel-ring").style.background = `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

function updateStake(game, delta) {
  stakes[game] = safeWholeNumber(stakes[game] + delta);
  render();
}

function setStake(game, amount) {
  stakes[game] = safeWholeNumber(amount);
  render();
}

function currentStakeSteps() {
  const multiplier = Math.pow(10, stakeTier);
  return STAKE_BASE_STEPS.map(value => value * multiplier);
}

function setStakeTier(delta) {
  stakeTier = Math.max(0, Math.min(MAX_STAKE_TIER, stakeTier + delta));
  localStorage.setItem("table-clicker-stake-tier", String(stakeTier));
  $("ticker").textContent = stakeTier === 0
    ? "Mises en mode standard."
    : `Mises x${fmt.format(Math.pow(10, stakeTier))}.`;
  render();
}

function renderStakeTierControls() {
  if (lastRenderedStakeTier === stakeTier) return;
  lastRenderedStakeTier = stakeTier;
  const steps = currentStakeSteps();
  document.querySelectorAll("[data-stake-step]").forEach(btn => {
    const index = Math.max(0, Math.min(steps.length - 1, Number(btn.dataset.stakeStep) || 0));
    const value = steps[index];
    btn.dataset.stakeAdd = value;
    btn.textContent = `+${fmt.format(value)}`;
  });
  document.querySelectorAll("[data-stake-sub]").forEach(btn => {
    const value = steps[0];
    btn.dataset.stakeAdd = -value;
    btn.textContent = `-${fmt.format(value)}`;
  });
  document.querySelectorAll("[data-stake-tier-down]").forEach(btn => {
    btn.disabled = stakeTier <= 0;
  });
  document.querySelectorAll("[data-stake-tier-up]").forEach(btn => {
    btn.disabled = stakeTier >= MAX_STAKE_TIER;
  });
}

function setRouletteChoice(choice) {
  rouletteChoice = choice;
  document.querySelectorAll("[data-roulette-choice]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.rouletteChoice === choice);
  });
}

function updatePokerAvailability() {
  const available = Boolean(room);
  $("drawPoker").disabled = !available || pokerBusy || pokerHandActive;
  $("drawPoker").textContent = pokerReady ? "Annuler pret" : "Pret pour le poker";
  $("pokerStay").disabled = !pokerMyTurn || pokerBusy;
  $("pokerFold").disabled = !pokerMyTurn || pokerBusy;
  if (!available) $("pokerStatus").textContent = "Table reseau indisponible";
  else if (pokerHandActive) $("pokerStatus").textContent = pokerMyTurn ? "A toi de jouer" : "Main en cours";
  else if (pokerReadyDeadline > 0) {
    const remaining = Math.max(0, Math.ceil(pokerReadyDeadline * 1000 - Date.now()) / 1000);
    $("pokerStatus").textContent = `Depart dans ${Math.ceil(remaining)}s - ${pokerReadyCount} joueurs`;
  } else $("pokerStatus").textContent = pokerReadyCount
    ? `${pokerReadyCount} joueur${pokerReadyCount > 1 ? "s" : ""} pret${pokerReadyCount > 1 ? "s" : ""}`
    : "2 joueurs minimum";
}

function celebrate(origin, intensity = "win") {
  const layer = $("celebrationLayer");
  if (!layer) return;
  const rect = origin ? origin.getBoundingClientRect() : null;
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight * .42;
  const faces = [":)", ":D", "$", "*", "+", "!", "WIN"];
  const count = intensity === "mega" ? 18 : 8;
  const rainCount = 0;
  const spread = intensity === "mega" ? 1.25 : .7;
  const fragment = document.createDocumentFragment();
  const created = [];
  shakeElements(origin, intensity);
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "smiley-burst";
    el.textContent = faces[Math.floor(Math.random() * faces.length)];
    el.style.setProperty("--x", `${x}px`);
    el.style.setProperty("--y", `${y}px`);
    el.style.setProperty("--dx", `${Math.cos((Math.PI * 2 * i) / count) * (90 + Math.random() * 230) * spread}px`);
    el.style.setProperty("--dy", `${(Math.sin((Math.PI * 2 * i) / count) * (70 + Math.random() * 190) - 105) * spread}px`);
    el.style.setProperty("--rot", `${Math.floor(Math.random() * 720 - 360)}deg`);
    el.style.setProperty("--size", `${Math.floor(18 + Math.random() * (intensity === "mega" ? 28 : 21))}px`);
    fragment.appendChild(el);
    created.push(el);
  }
  for (let i = 0; i < rainCount; i++) {
    const el = document.createElement("span");
    el.className = "emoji-rain";
    el.textContent = faces[Math.floor(Math.random() * faces.length)];
    el.style.setProperty("--x", `${Math.random() * 100}vw`);
    el.style.setProperty("--drift", `${Math.floor(Math.random() * 180 - 90)}px`);
    el.style.setProperty("--rot", `${Math.floor(Math.random() * 720 - 360)}deg`);
    el.style.setProperty("--size", `${Math.floor(16 + Math.random() * (intensity === "mega" ? 26 : 18))}px`);
    el.style.setProperty("--duration", `${(1.25 + Math.random() * .85).toFixed(2)}s`);
    el.style.animationDelay = `${(Math.random() * .32).toFixed(2)}s`;
    fragment.appendChild(el);
    created.push(el);
  }
  layer.appendChild(fragment);
  window.setTimeout(() => created.forEach(el => el.remove()), intensity === "mega" ? 2600 : 1700);
}

function emojiSprite(emoji, size) {
  const roundedSize = Math.max(18, Math.min(42, Math.round(size)));
  const key = `${emoji}:${roundedSize}`;
  if (emojiSpriteCache.has(key)) return emojiSpriteCache.get(key);
  const canvas = document.createElement("canvas");
  const pad = 6;
  canvas.width = roundedSize + pad * 2;
  canvas.height = roundedSize + pad * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = `${roundedSize}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, canvas.width / 2, canvas.height / 2);
  emojiSpriteCache.set(key, canvas);
  return canvas;
}

function celebrationProfile(theme = "jackpot") {
  const area = window.innerWidth * window.innerHeight;
  const compact = area < 700000;
  const reduced = Boolean(prefersReducedMotion && prefersReducedMotion.matches);
  if (reduced) {
    return { confetti: theme === "race" ? 18 : 24, emojis: 6, frameStep: 48, duration: 1500, shake: false };
  }
  return {
    confetti: theme === "race" ? (compact ? 52 : 84) : (compact ? 68 : 110),
    emojis: compact ? 12 : 18,
    frameStep: compact ? 40 : 33,
    duration: compact ? 1900 : 2200,
    shake: true,
  };
}

function grandCelebrate(origin, theme = "jackpot") {
  const layer = $("celebrationLayer");
  if (!layer) return;
  if (activeCelebrationFrame) cancelAnimationFrame(activeCelebrationFrame);
  if (activeCelebrationCanvas) activeCelebrationCanvas.remove();
  const rect = origin ? origin.getBoundingClientRect() : null;
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight * .42;
  const dpr = 1;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.className = "celebration-canvas";
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.scale(dpr, dpr);
  layer.appendChild(canvas);
  activeCelebrationCanvas = canvas;
  const profile = celebrationProfile(theme);

  const emojis = theme === "race"
    ? ["\u{1F3C1}", "\u{1F3C6}", "\u{1F4A5}", "\u{1F389}", "\u{2B50}", "\u{1F4B0}"]
    : ["\u{1F389}", "\u{1F4B0}", "\u{2728}", "\u{1F3C6}", "\u{1F48E}", "\u{1F525}"];
  const colors = ["#ffd35a", "#ef4c57", "#45d686", "#54b8ff", "#fff3b9", "#f08cff"];
  const particles = [];
  if (profile.shake) shakeElements(origin, "mega");

  for (let i = 0; i < profile.confetti; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 12;
    particles.push({
      type: "confetti",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 7 - Math.random() * 8,
      gravity: .18 + Math.random() * .16,
      size: 5 + Math.random() * 9,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .28,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1700 + Math.random() * 1200
    });
  }
  for (let i = 0; i < profile.emojis; i++) {
    const size = 18 + Math.random() * 20;
    const text = emojis[Math.floor(Math.random() * emojis.length)];
    particles.push({
      type: "emoji",
      sprite: emojiSprite(text, size),
      x: Math.random() * window.innerWidth,
      y: -30 - Math.random() * 260,
      vx: (Math.random() - .5) * 2.8,
      vy: 2.8 + Math.random() * 4.4,
      gravity: .045 + Math.random() * .045,
      size,
      rot: (Math.random() - .5) * .5,
      spin: (Math.random() - .5) * .035,
      life: 2100 + Math.random() * 900
    });
  }

  const startedAt = performance.now();
  let lastFrameAt = 0;
  function animate(now) {
    if (now - lastFrameAt < profile.frameStep) {
      activeCelebrationFrame = requestAnimationFrame(animate);
      return;
    }
    lastFrameAt = now;
    const elapsed = now - startedAt;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let activeCount = 0;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rot += p.spin;
      const alpha = Math.max(0, Math.min(1, 1 - elapsed / p.life));
      const visible = alpha > 0 && p.x > -120 && p.x < window.innerWidth + 120 && p.y < window.innerHeight + 160;
      if (!visible) continue;
      activeCount += 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.type === "emoji") {
        if (p.sprite) ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.8);
      }
      ctx.restore();
    }
    if (elapsed < profile.duration && activeCount > 0) activeCelebrationFrame = requestAnimationFrame(animate);
    else {
      canvas.remove();
      if (activeCelebrationCanvas === canvas) activeCelebrationCanvas = null;
      activeCelebrationFrame = 0;
    }
  }
  activeCelebrationFrame = requestAnimationFrame(animate);
}

function spawnFloatText(origin, text, tone = "gain") {
  const layer = $("celebrationLayer");
  if (!layer) return;
  const rect = origin ? origin.getBoundingClientRect() : null;
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const el = document.createElement("span");
  el.className = `float-text ${tone}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty("--drift", `${Math.floor(Math.random() * 80 - 40)}px`);
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), 950);
}

function showTableAnnouncement(text, key = "") {
  if (key && seenBigWinEvents.has(key)) return;
  if (key) seenBigWinEvents.add(key);
  const layer = $("celebrationLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "table-announcement";
  el.textContent = text;
  const x = 14 + Math.random() * 56;
  const y = 16 + Math.random() * 54;
  el.style.left = `${x}vw`;
  el.style.top = `${y}vh`;
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), 5200);
}

function showJackpotAnnouncement(text, key = "") {
  if (key && seenBigWinEvents.has(key)) return;
  if (key) seenBigWinEvents.add(key);
  const layer = $("celebrationLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "table-announcement jackpot";
  el.textContent = `JACKPOT\n${text}`;
  el.style.left = "50vw";
  el.style.top = "16vh";
  layer.appendChild(el);
  grandCelebrate($("slots"), "jackpot");
  window.setTimeout(() => el.remove(), 6800);
}

function showChatAnnouncement(message, key = "") {
  if (!message || message.playerId === playerId) return;
  const name = message.name || "Joueur";
  const text = String(message.text || "").slice(0, 80);
  showTableAnnouncement(`${name}: ${text}`, key);
}

function shakeElements(origin, intensity = "win") {
  const className = intensity === "mega" ? "site-mega-jolt" : "site-jolt";
  const targets = new Set([
    $("wheel"),
    document.querySelector(".games-panel"),
    document.querySelector(".click-panel"),
    document.querySelector(".upgrades-panel"),
    ...document.querySelectorAll(".stats-strip article")
  ]);
  if (origin) {
    targets.add(origin);
    const panel = origin.closest(".panel");
    if (panel) targets.add(panel);
  }
  targets.forEach(el => {
    if (!el) return;
    el.classList.remove("site-jolt", "site-mega-jolt");
    void el.offsetWidth;
    el.classList.add(className);
  });
  window.setTimeout(() => {
    targets.forEach(el => el && el.classList.remove(className));
  }, intensity === "mega" ? 760 : 560);
}

function dealBlackjack() {
  const bet = stakes.blackjack;
  if (!spend(bet)) return log("blackjackLog", "Mise impossible.");
  $("blackjack").classList.add("game-running");
  render();
  const d = deck();
  bj = { bet, deck: d, player: [d.pop(), d.pop()], dealer: [d.pop(), d.pop()], open: true };
  $("blackjackHit").disabled = false;
  $("blackjackStand").disabled = false;
  $("blackjackDeal").disabled = true;
  renderBlackjack(true);
  if (handValue(bj.player) === 21) standBlackjack();
}

function hitBlackjack() {
  bj.player.push(bj.deck.pop());
  if (handValue(bj.player) > 21) finishBlackjack("Tu depasses 21.", 0);
  else renderBlackjack(true);
}

function standBlackjack() {
  while (handValue(bj.dealer) < 17) bj.dealer.push(bj.deck.pop());
  const pv = handValue(bj.player);
  const dv = handValue(bj.dealer);
  if (dv > 21 || pv > dv) finishBlackjack("Blackjack gagne.", bj.bet * 2);
  else if (pv === dv) finishBlackjack("Egalite, mise rendue.", bj.bet);
  else finishBlackjack("Le croupier gagne.", 0);
}

function renderBlackjack(hideDealer) {
  renderCards($("dealerHand"), bj.dealer, hideDealer);
  renderCards($("playerHand"), bj.player);
  log("blackjackLog", `Main: ${handValue(bj.player)}.`);
}

function finishBlackjack(message, payout) {
  renderCards($("dealerHand"), bj.dealer);
  renderCards($("playerHand"), bj.player);
  $("blackjackHit").disabled = true;
  $("blackjackStand").disabled = true;
  $("blackjackDeal").disabled = false;
  $("blackjack").classList.remove("game-running");
  const text = `${message} ${payout ? `Paiement ${fmt.format(payout)}.` : ""}`;
  log("blackjackLog", text);
  announceGame("blackjack", text, payout > bj.bet ? payout : 0);
  settleBet(bj.bet, payout, "Une main de blackjack se termine.", $("blackjack"));
  bj = null;
}

async function playPoker() {
  if (pokerBusy) return;
  if (!room) {
    return log("pokerLog", "Table reseau indisponible.");
  }
  const bet = stakes.poker;
  if (state.chips < bet) return log("pokerLog", "Mise impossible.");
  pokerBusy = true;
  $("poker").classList.add("game-running");
  $("drawPoker").disabled = true;
  const readyAmount = pokerReady ? 0 : bet;
  log("pokerLog", readyAmount ? `Pret pour ${fmt.format(bet)} jetons. La main part a 2 joueurs prets.` : "Participation poker annulee.");

  try {
    const res = await sendTableAction({ type: "poker_ready", amount: readyAmount }, true);
    if (!res.ok) throw new Error(res.error || "Poker indisponible.");
    pokerReady = readyAmount > 0 && !res.pokerHand;
    pokerReadyDeadline = Number(res.pokerReadyDeadline || 0);
    if (res.pokerHand) renderPokerHand(res.pokerHand);
    save();
  } catch (err) {
    log("pokerLog", err.message || "Poker indisponible.");
  } finally {
    if (!pokerHandActive) $("poker").classList.remove("game-running");
    pokerBusy = false;
    updatePokerAvailability();
    render();
  }
}

async function playPokerDecision(decision) {
  if (pokerBusy || !pokerMyTurn) return;
  pokerBusy = true;
  $("poker").classList.add("game-running");
  try {
    const res = await sendTableAction({ type: "poker_action", decision }, true);
    if (!res.ok) throw new Error(res.error || "Action poker refusee.");
    if (res.pokerHand) renderPokerHand(res.pokerHand);
    if (res.game) applyPokerGame(res.game);
    pollTable();
  } catch (err) {
    log("pokerLog", err.message || "Action poker impossible.");
  } finally {
    pokerBusy = false;
    if (!pokerHandActive) $("poker").classList.remove("game-running");
    updatePokerAvailability();
  }
}

function phaseLabel(phase) {
  if (phase === "preflop") return "Preflop";
  if (phase === "flop") return "Flop";
  if (phase === "turn") return "Turn";
  if (phase === "river") return "River";
  return "Showdown";
}

function rememberPaidPokerHand(handAt) {
  paidPokerHands.add(handAt);
  const recent = Array.from(paidPokerHands).slice(-12);
  paidPokerHands = new Set(recent);
  localStorage.setItem("table-clicker-paid-poker-hands", JSON.stringify(recent));
}

function renderPokerHand(hand) {
  if (!hand || hand.type !== "poker_hand") {
    pokerHandActive = false;
    pokerMyTurn = false;
    lastPokerHandKey = "";
    $("poker").classList.remove("game-running");
    updatePokerAvailability();
    return;
  }

  pokerHandActive = true;
  pokerReady = false;
  pokerReadyCount = 0;
  pokerReadyDeadline = 0;
  const me = (hand.players || []).find(p => p.self);
  pokerMyTurn = Boolean(me && me.status === "active" && !me.acted);

  if (me && me.bet > 0 && !paidPokerHands.has(hand.at)) {
    if (spend(me.bet)) {
      state.stats.gambled = safeWholeNumber(state.stats.gambled + me.bet);
      rememberPaidPokerHand(hand.at);
      $("ticker").textContent = "Ta mise poker est posee sur la table.";
      save();
      render();
    }
  }

  const visibleCommunity = hand.community || [];
  renderCards($("communityCards"), visibleCommunity);
  renderCards($("pokerHand"), me ? me.hand || [] : []);

  const key = [
    hand.at,
    hand.phase,
    hand.revealed,
    hand.pot,
    (hand.players || []).map(p => `${p.id}:${p.name}:${p.status}:${p.acted}:${p.bet}:${p.self}`).join(",")
  ].join("|");
  if (key !== lastPokerHandKey) {
    lastPokerHandKey = key;
    setHtmlIfChanged("pokerReadyList", (hand.players || []).map(p => `
    <div class="ready-player${p.self ? " self" : ""}">
      <span>${escapeHtml(p.name)}${p.self ? " (toi)" : ""} - ${p.status === "folded" ? "couche" : p.acted ? "reste" : "attend"}</span>
      <strong>${fmt.format(p.bet)}</strong>
    </div>
    `).join(""));
  }

  const waiting = (hand.players || []).filter(p => p.status === "active" && !p.acted).map(p => p.name);
  const suffix = waiting.length ? ` En attente: ${waiting.join(", ")}.` : " Tout le monde a parle.";
  log("pokerLog", `${phaseLabel(hand.phase)}. Pot ${fmt.format(hand.pot || 0)}.${suffix}`);
  $("poker").classList.toggle("game-running", pokerHandActive);
  updatePokerAvailability();
}

function applyPokerGame(game) {
  if (!game || game.type !== "poker") return;
  if (game.at <= lastPokerGameAt) return;
  lastPokerGameAt = game.at;
  localStorage.setItem("table-clicker-last-poker", String(game.at));
  pokerHandActive = false;
  pokerMyTurn = false;
  pokerReady = false;
  pokerReadyCount = 0;
  pokerReadyDeadline = 0;
  lastPokerHandKey = "";
  renderCards($("communityCards"), game.community || []);
  const me = (game.players || []).find(p => p.id === playerId);
  renderCards($("pokerHand"), me ? me.hand : []);
  const winnerText = game.winnerId === playerId ? "Tu gagnes" : `${game.winnerName} gagne`;
  const detail = game.winnerDetail || `Main: ${game.winnerLabel}.`;
  log("pokerLog", `${winnerText}. ${detail} Pot ${fmt.format(game.payout)}.`);
  if (game.winnerId === playerId) {
    gain(game.payout);
    state.stats.won = safeWholeNumber(state.stats.won + game.payout);
    if (game.payout >= 1000000) grandCelebrate($("poker"), "jackpot");
    else celebrate($("poker"), "mega");
    save();
  }
  updatePokerAvailability();
  render();
}

function rememberSet(storageKey, set, value) {
  set.add(value);
  const recent = Array.from(set).slice(-16);
  const next = new Set(recent);
  localStorage.setItem(storageKey, JSON.stringify(recent));
  return next;
}

function rememberRaceSnapshot(raceId, bet = 0) {
  if (!raceId || raceSnapshots[raceId]) return;
  raceSnapshots[raceId] = {
    chips: Math.max(0, safeWholeNumber(state.chips) - Math.max(0, Math.floor(Number(bet) || 0))),
    heat: state.heat,
    upgrades: { ...state.upgrades },
    automation: JSON.parse(JSON.stringify(state.automation || {}))
  };
  localStorage.setItem("table-clicker-race-snapshots", JSON.stringify(raceSnapshots));
}

function restoreRaceSnapshot(raceId) {
  const snapshot = raceSnapshots[raceId];
  if (!snapshot) return false;
  state.chips = safeWholeNumber(snapshot.chips);
  state.heat = Number(snapshot.heat) || 0;
  state.upgrades = { ...snapshot.upgrades };
  state.automation = JSON.parse(JSON.stringify(snapshot.automation || {}));
  normalizeState();
  delete raceSnapshots[raceId];
  localStorage.setItem("table-clicker-race-snapshots", JSON.stringify(raceSnapshots));
  return true;
}

function myRaceRunner(race) {
  if (!race) return null;
  return (race.players || []).find(p => p.id === playerId && p.self === true && p.participant === true) || null;
}

function updateRaceControls() {
  const race = currentRace;
  const hasRace = Boolean(race);
  const me = myRaceRunner(race);
  const isHost = race && race.hostId === playerId;
  const lobby = race && race.status === "lobby";
  const running = race && race.status === "running";

  $("raceCreate").disabled = hasRace;
  $("raceJoin").disabled = !lobby;
  $("raceJoin").textContent = me && lobby ? "Annuler" : "Rejoindre";
  $("raceStart").disabled = !lobby || !isHost || (race.players || []).length < 2;
  $("raceDuration").disabled = hasRace;
  $("raceBetAmount").disabled = Boolean(running || (lobby && me));
  if (running && me) $("raceBetAmount").value = Math.max(1, Math.floor(Number(me.bet || 1)));
  $("raceProgress").style.width = running
    ? `${Math.max(0, Math.min(100, (race.remaining / race.duration) * 100))}%`
    : "0%";

  const wagerPanel = $("raceWagerPanel");
  if (wagerPanel) {
    const canWager = running && !me && race.bettingOpen && !race.myWager;
    wagerPanel.hidden = !running;
    $("raceWagerPlace").disabled = !canWager;
    $("raceWagerTarget").disabled = !canWager;
    $("raceWagerAmount").disabled = !canWager;
  }
}

function formatRaceDuration(seconds) {
  const minutes = Math.max(1, Math.round(Number(seconds || 60) / 60));
  return `${minutes} min`;
}

function applyRaceStartReset(race, me) {
  if (!race || !me || me.id !== playerId || me.self !== true || me.participant !== true || paidRaceIds.has(race.id)) return;
  const bet = Math.max(0, Math.floor(Number(me.bet || 0)));
  rememberRaceSnapshot(race.id, bet);
  state.stats.gambled = safeWholeNumber(state.stats.gambled + bet);
  state.chips = 0;
  resetChipFractionRemainder();
  state.heat = 0;
  state.upgrades = emptyUpgrades();
  state.automation.roulette.enabled = false;
  state.automation.roulette.lastAt = 0;
  paidRaceIds = rememberSet("table-clicker-paid-races", paidRaceIds, race.id);
  raceScore = 0;
  lastRaceScoreSent = 0;
  $("ticker").textContent = `Course lancee: mise de ${fmt.format(bet)} jetons, depart a zero.`;
  save();
  render(true);
}

function renderRace(race) {
  currentRace = race;
  if (!race) {
    raceScore = 0;
    lastRaceKey = "";
    $("raceStatus").textContent = "Aucune course";
    $("raceLog").textContent = "Cree une course ou rejoins celle de la table.";
    setHtmlIfChanged("racePlayers", `<div class="empty-row">Aucune course en attente.</div>`);
    renderRaceWagers(null);
    updateRaceControls();
    return;
  }

  const me = myRaceRunner(race);
  if (race.status === "running" && me) {
    applyRaceStartReset(race, me);
    raceScore = Math.max(raceScore, Number(me.score || 0));
  }

  const key = [
    race.id,
    race.status,
    Math.floor(race.remaining || 0),
    (race.players || []).map(p => `${p.id}:${p.name}:${p.bet}:${Math.floor(p.score || 0)}:${p.self}`).join(",")
  ].join("|");
  if (key !== lastRaceKey) {
    lastRaceKey = key;
    const maxScore = Math.max(1, ...(race.players || []).map(p => Math.floor(Number(p.score || 0))));
    const sortedRacePlayers = (race.players || []).slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    setHtmlIfChanged("racePlayers", sortedRacePlayers.map(p => `
    <div class="ready-player race-player${p.self ? " self" : ""}">
      <div>
        <span>${escapeHtml(p.name)}${p.self ? " (toi)" : ""}${p.host ? " - hote" : ""} - mise ${fmt.format(p.bet || 0)}</span>
        <div class="race-player-track"><i style="width:${Math.max(3, Math.min(100, Number(p.score || 0) / maxScore * 100))}%"></i></div>
      </div>
      <strong>${fmt.format(Math.floor(p.score || 0))}</strong>
    </div>
    `).join("") || `<div class="empty-row">Aucun participant.</div>`);
  }

  const pot = (race.players || []).reduce((sum, p) => sum + Number(p.bet || 0), 0);
  if (race.status === "running") {
    $("raceStatus").textContent = `${Math.ceil(race.remaining || 0)}s restantes`;
    $("raceLog").textContent = `Pot ${fmt.format(pot)}. Le meilleur score gagne.`;
  } else {
    $("raceStatus").textContent = `${race.hostName} invite la table`;
    $("raceLog").textContent = `Course de ${formatRaceDuration(race.duration)}. Choisis ta mise avant de rejoindre.`;
  }
  renderRaceWagers(race);
  updateRaceControls();
}

function renderRaceWagers(race) {
  const panel = $("raceWagerPanel");
  if (!panel) return;
  if (!race || race.status !== "running") {
    panel.hidden = true;
    setHtmlIfChanged("raceWagerList", "");
    return;
  }

  const me = myRaceRunner(race);
  const canWager = !me && race.bettingOpen && !race.myWager;
  panel.hidden = false;
  $("raceWagerStatus").textContent = race.bettingOpen
    ? `Ouverts ${Math.ceil(race.bettingRemaining || 0)}s - pot ${fmt.format(race.wagerPot || 0)}`
    : `Fermes - pot ${fmt.format(race.wagerPot || 0)}`;
  $("raceWagerPlace").disabled = !canWager;
  $("raceWagerTarget").disabled = !canWager;
  $("raceWagerAmount").disabled = !canWager;

  const target = $("raceWagerTarget");
  const previous = target.value;
  const options = (race.players || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  if (target.innerHTML !== options) {
    target.innerHTML = options;
    if ([...target.options].some(option => option.value === previous)) target.value = previous;
  }

  const rows = [];
  if (race.myWager) {
    rows.push(`<div class="ready-player self"><span>Ton pari sur ${escapeHtml(race.myWager.targetName)}</span><strong>${fmt.format(race.myWager.amount)}</strong></div>`);
  } else if (me) {
    rows.push(`<div class="empty-row">Tu cours deja: seuls les spectateurs peuvent parier.</div>`);
  } else if (!race.bettingOpen) {
    rows.push(`<div class="empty-row">Paris fermes apres le premier quart de course.</div>`);
  }
  rows.push(...(race.wagersByTarget || []).map(item => `
    <div class="ready-player">
      <span>${escapeHtml(item.targetName)}</span>
      <strong>${fmt.format(item.amount || 0)}</strong>
    </div>
  `));
  setHtmlIfChanged("raceWagerList", rows.join("") || `<div class="empty-row">Aucun pari pour le moment.</div>`);
}

function applyRaceResult(result) {
  if (!result || result.type !== "race" || wonRaceIds.has(result.id)) return;
  if (currentRace && currentRace.id && currentRace.id !== result.id) return;
  const me = (result.players || []).find(p => p.id === playerId);
  const myWager = (result.wagerPayouts || []).find(p => p.id === playerId);
  if (!me && !myWager) return;
  currentRace = null;
  wonRaceIds = rememberSet("table-clicker-won-races", wonRaceIds, result.id);
  if (me) {
    if (!restoreRaceSnapshot(result.id)) state.chips = 0;
    resetChipFractionRemainder();
  }
  if (result.winnerId === playerId) {
    gain(result.payout);
    state.stats.won = safeWholeNumber(state.stats.won + result.payout);
    $("raceLog").textContent = `Tu gagnes la course. Pot ${fmt.format(result.payout)}.`;
    showTableAnnouncement(`${state.name} gagne la course: ${fmt.format(result.payout)} jetons`, `race-win-${result.id}`);
    grandCelebrate($("race"), "race");
  } else if (myWager && myWager.payout > 0) {
    gain(myWager.payout);
    state.stats.won = safeWholeNumber(state.stats.won + myWager.payout);
    $("raceLog").textContent = `Pari gagne sur ${result.winnerName}. Gain ${fmt.format(myWager.payout)}.`;
    celebrate($("race"), myWager.payout >= 1000000 ? "mega" : "win");
  } else if (myWager) {
    $("raceLog").textContent = `Pari perdu. ${result.winnerName} gagne la course.`;
  } else {
    $("raceLog").textContent = `${result.winnerName} gagne la course avec ${fmt.format(Math.floor((result.players || [])[0]?.score || 0))} points.`;
  }
  raceScore = 0;
  save();
  render(Boolean(me));
}

async function placeRaceWager() {
  const race = currentRace;
  if (!race || race.status !== "running") return;
  const amount = Math.max(1, Math.floor(Number($("raceWagerAmount").value) || 0));
  const targetId = $("raceWagerTarget").value;
  if (!targetId) return log("raceLog", "Choisis un coureur.");
  if (amount > state.chips) return log("raceLog", "Mise pari impossible.");
  const res = await sendTableAction({ type: "race_wager", targetId, amount }, true);
  if (!res.ok) return log("raceLog", res.error || "Pari impossible.");
  if (spend(amount)) {
    state.stats.gambled = safeWholeNumber(state.stats.gambled + amount);
    $("ticker").textContent = "Pari course enregistre.";
    save();
  }
  renderRace(res.race);
  pollTable();
}

async function createRace() {
  const minutes = Math.max(1, Math.floor(Number($("raceDuration").value) || 1));
  const duration = minutes * 60;
  const amount = raceBetAmount();
  if (amount <= 0) return log("raceLog", "Il faut miser au moins 1 jeton pour ouvrir une course.");
  if (amount > state.chips) return log("raceLog", "Mise course impossible.");
  const res = await sendTableAction({ type: "race_create", duration, amount }, true);
  if (!res.ok) return log("raceLog", res.error || "Course impossible.");
  renderRace(res.race);
  pollTable();
}

async function joinRace() {
  const race = currentRace;
  if (!race || race.status !== "lobby") return;
  const me = myRaceRunner(race);
  const amount = me ? 0 : raceBetAmount();
  if (!me && amount <= 0) return log("raceLog", "Il faut au moins 1 jeton pour rejoindre une course.");
  if (!me && amount > state.chips) return log("raceLog", "Mise course impossible.");
  const res = await sendTableAction({ type: "race_join", amount }, true);
  if (!res.ok) return log("raceLog", res.error || "Participation impossible.");
  renderRace(res.race);
  pollTable();
}

function raceBetAmount() {
  return Math.max(0, Math.floor(Number($("raceBetAmount").value) || 0));
}

async function startRace() {
  const res = await sendTableAction({ type: "race_start" }, true);
  if (!res.ok) return log("raceLog", res.error || "Depart impossible.");
  raceScore = 0;
  renderRace(res.race);
  pollTable();
}

function syncRaceScore(force = false) {
  if (!currentRace || currentRace.status !== "running") return;
  const me = myRaceRunner(currentRace);
  if (!me) return;
  const now = Date.now();
  if (!force && now - lastRaceScoreSent < 1000) return;
  lastRaceScoreSent = now;
  sendTableAction({ type: "race_score", score: raceScore }, true).then(res => {
    if (res.lastRace) applyRaceResult(res.lastRace);
    if (res.race) renderRace(res.race);
  });
}

function log(id, text) {
  $(id).textContent = text;
}

async function sendTableAction(action, expectJson = false) {
  room = SHARED_ROOM;
  const chips = safeWholeNumber(state.chips);
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, playerId, name: state.name, chips, action })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || "Action refusee." };
    return expectJson ? data : { ok: true };
  } catch {
    $("tableStatus").textContent = "Hors ligne";
    return { ok: false, error: "Serveur hors ligne." };
  }
}

async function pollLobby() {
  const chips = safeWholeNumber(state.chips);
  try {
    const res = await fetch(`/api/lobby?room=${encodeURIComponent(SHARED_ROOM)}&playerId=${encodeURIComponent(playerId)}&name=${encodeURIComponent(state.name)}&chips=${chips}`);
    const data = await res.json();
    renderLobby(data.players || []);
  } catch {
    renderLobby([]);
  }
}

async function pollTable() {
  if (pollTableInFlight) return;
  pollTableInFlight = true;
  room = SHARED_ROOM;
  const chips = safeWholeNumber(state.chips);
  try {
    const res = await fetch(`/api/state?room=${encodeURIComponent(SHARED_ROOM)}&playerId=${encodeURIComponent(playerId)}&name=${encodeURIComponent(state.name)}&chips=${chips}`);
    const data = await res.json();
    $("tableStatus").textContent = "Reseau";
    renderRoomPlayers(data.players || []);
    renderLobby(data.lobby || data.players || []);
    renderChat(data.chat || []);
    renderEvents(data.events || []);
    renderRaceLeaderboard(data.raceLeaderboard || []);
    applySharedSlotsState(data.slots);
    renderPokerReady(data.pokerReady || [], data.pokerReadyDeadline || 0);
    renderPokerHand(data.pokerHand || null);
    renderRace(data.race || null);
    applyPokerGame(data.lastGame);
    applyRaceResult(data.lastRace);
  } catch {
    $("tableStatus").textContent = "Hors ligne";
  } finally {
    pollTableInFlight = false;
  }
}

function renderRoomPlayers(players) {
  const key = players.map(p => `${p.id}:${p.name}`).join("|");
  if (key === lastRoomPlayersKey) return;
  lastRoomPlayersKey = key;
  const holder = $("players");
  if (holder) holder.innerHTML = players.map(p => `${escapeHtml(p.name)}`).join(", ");
}

function renderLobby(players) {
  const key = players.map(p => `${p.id}:${p.name}:${p.ip || ""}:${p.host || ""}:${p.lastJackpot?.amount || 0}:${p.lastJackpot?.at || 0}`).join("|");
  if (key === lastLobbyKey) return;
  lastLobbyKey = key;
  setHtmlIfChanged("onlinePlayers", players.map(p => `
    <div class="player-detail${p.self ? " self" : ""}">
      <div class="player-detail-head">
        <strong>${escapeHtml(p.name)}${p.self ? " (toi)" : ""}</strong>
      </div>
      <dl>
        <dt>IP</dt><dd>${escapeHtml(p.ip || "inconnue")}</dd>
        <dt>Host</dt><dd>${escapeHtml(p.host || "inconnu")}</dd>
        ${p.lastJackpot?.amount ? `<dt>Jackpot</dt><dd class="player-jackpot">Dernier jackpot de ${fmt.format(p.lastJackpot.amount)} jetons</dd>` : ``}
      </dl>
    </div>
  `).join("") || `<div class="empty-row">Aucun joueur en ligne.</div>`);
}

function renderRaceLeaderboard(entries) {
  const key = entries.map(entry => [
    entry.id,
    entry.name,
    entry.races,
    entry.wins,
    Math.floor(Number(entry.bestScore || 0)),
    entry.bestPayout || 0,
    entry.self
  ].join(":")).join("|");
  if (key === lastRaceLeaderboardKey) return;
  lastRaceLeaderboardKey = key;
  setHtmlIfChanged("raceLeaderboard", entries.map((entry, index) => {
    const races = Math.max(0, Math.floor(Number(entry.races || 0)));
    const wins = Math.max(0, Math.floor(Number(entry.wins || 0)));
    const bestScore = Math.max(0, Math.floor(Number(entry.bestScore || 0)));
    const bestPayout = Math.max(0, Math.floor(Number(entry.bestPayout || 0)));
    return `
    <div class="leaderboard-row${entry.self ? " self" : ""}">
      <strong class="leaderboard-rank">#${index + 1}</strong>
      <div>
        <span>${escapeHtml(entry.name)}${entry.self ? " (toi)" : ""}</span>
        <small>${fmt.format(races)} course${races > 1 ? "s" : ""} - record ${fmt.format(bestScore)}</small>
      </div>
      <strong>${fmt.format(wins)} victoire${wins > 1 ? "s" : ""}${bestPayout ? `<small>Top pot ${fmt.format(bestPayout)}</small>` : ""}</strong>
    </div>
    `;
  }).join("") || `<div class="empty-row">Aucune course terminee pour le moment.</div>`);
}

function setNetworkTab(tab) {
  activeNetworkTab = tab;
  document.querySelectorAll("[data-network-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.networkTab === tab);
  });
  $("networkChatPanel").classList.toggle("active", tab === "chat");
  $("networkPlayersPanel").classList.toggle("active", tab === "players");
  $("networkLeaderboardPanel").classList.toggle("active", tab === "leaderboard");
  $("networkJournalPanel").classList.toggle("active", tab === "journal");
  if (tab === "chat") {
    unreadChatCount = 0;
    updateChatUnreadBadge();
  }
}

function updateChatUnreadBadge() {
  const badge = $("chatUnreadBadge");
  if (!badge) return;
  badge.hidden = unreadChatCount <= 0;
  badge.textContent = unreadChatCount > 99 ? "99+" : String(unreadChatCount);
}

function renderPokerReady(players, deadline = 0) {
  pokerReady = players.some(p => p.self);
  pokerReadyCount = players.length;
  pokerReadyDeadline = Number(deadline || 0);
  const key = players.map(p => `${p.id}:${p.name}:${p.amount}:${p.self}`).join("|");
  if (key !== lastPokerReadyKey) {
    lastPokerReadyKey = key;
    setHtmlIfChanged("pokerReadyList", players.map(p => `
    <div class="ready-player${p.self ? " self" : ""}">
      <span>${escapeHtml(p.name)}${p.self ? " (toi)" : ""}</span>
      <strong>${fmt.format(p.amount)}</strong>
    </div>
    `).join("") || `<div class="empty-row">Aucun joueur pret.</div>`);
  }
  updatePokerAvailability();
}

function renderChat(messages) {
  const key = messages.map(msg => `${msg.at}:${msg.playerId}:${msg.name}:${msg.text}`).join("|");
  if (key === lastChatKey) return;
  const newUnreadMessages = [];
  messages.forEach(msg => {
    const messageKey = `${msg.at}:${msg.playerId}:${msg.text}`;
    if (!seenChatMessages.has(messageKey)) {
      if (chatInitialized && activeNetworkTab !== "chat" && msg.playerId !== playerId) {
        newUnreadMessages.push({ ...msg, key: messageKey });
      }
      seenChatMessages.add(messageKey);
    }
  });
  if (seenChatMessages.size > 90) {
    seenChatMessages = new Set(Array.from(seenChatMessages).slice(-60));
  }
  if (newUnreadMessages.length) {
    unreadChatCount += newUnreadMessages.length;
    newUnreadMessages.forEach(msg => showChatAnnouncement(msg, `chat-${msg.key}`));
    updateChatUnreadBadge();
  } else if (activeNetworkTab === "chat" && unreadChatCount) {
    unreadChatCount = 0;
    updateChatUnreadBadge();
  }
  chatInitialized = true;
  lastChatKey = key;
  const box = $("chatMessages");
  const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 12;
  setHtmlIfChanged("chatMessages", messages.map(msg => `
    <div class="chat-message${msg.playerId === playerId ? " self" : ""}">
      <strong>${escapeHtml(msg.name)}</strong>
      <span>${escapeHtml(msg.text)}</span>
    </div>
  `).join("") || `<div class="empty-row">Le chat de la table est vide.</div>`);
  if (wasNearBottom) box.scrollTop = box.scrollHeight;
}

function renderEvents(events) {
  const key = events.map(event => `${event.at}:${event.kind}:${event.text}`).join("|");
  events.forEach(event => {
    const fresh = Date.now() - Number(event.at || 0) * 1000 < 15000;
    if (event.kind === "jackpot" && fresh) {
      showJackpotAnnouncement(event.text, `${event.at}:${event.text}`);
    } else if ((event.kind === "bigwin" || event.kind === "announce") && fresh) {
      showTableAnnouncement(event.text, `${event.at}:${event.text}`);
    }
  });
  if (key === lastEventsKey) return;
  lastEventsKey = key;
  setHtmlIfChanged("roomEvents", events.slice().reverse().map(event => `
    <div class="event-row ${escapeHtml(event.kind || "event")}">${escapeHtml(event.text)}</div>
  `).join("") || `<div class="empty-row">Aucun evenement.</div>`);
}

function setHtmlIfChanged(id, html) {
  const el = $(id);
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function bind() {
  $("mainClick").addEventListener("click", () => {
    const heatBonus = 1 + Math.min(.6, state.heat / 180);
    const amount = clickPower() * heatBonus;
    gain(amount);
    addRaceScore(amount);
    state.heat = Math.min(100, state.heat + 6);
    spawnFloatText($("mainClick"), `+${fmt.format(amount)}`);
    $("mainClick").classList.remove("chip-hit");
    void $("mainClick").offsetWidth;
    $("mainClick").classList.add("chip-hit");
    render();
  });
  $("upgrades").addEventListener("click", e => {
    const btn = e.target.closest("[data-upgrade]");
    if (!btn) return;
    const u = upgrades.find(item => item.id === btn.dataset.upgrade);
    if (spend(upgradeCost(u))) {
      state.upgrades[u.id]++;
      $("ticker").textContent = `${u.name} ameliore.`;
      celebrate(btn, "win");
      save();
      render(true);
    }
  });
  $("spinRoulette").addEventListener("click", playRoulette);
  document.querySelectorAll("[data-stake-step], [data-stake-sub]").forEach(btn => btn.addEventListener("click", () => {
    updateStake(btn.closest("[data-stake-game]").dataset.stakeGame, Number(btn.dataset.stakeAdd));
  }));
  document.querySelectorAll("[data-stake-tier-down]").forEach(btn => btn.addEventListener("click", () => setStakeTier(-1)));
  document.querySelectorAll("[data-stake-tier-up]").forEach(btn => btn.addEventListener("click", () => setStakeTier(1)));
  document.querySelectorAll("[data-stake-all]").forEach(btn => btn.addEventListener("click", () => {
    setStake(btn.closest("[data-stake-game]").dataset.stakeGame, state.chips);
  }));
  document.querySelectorAll("[data-stake-clear]").forEach(btn => btn.addEventListener("click", () => {
    setStake(btn.closest("[data-stake-game]").dataset.stakeGame, 0);
  }));
  document.querySelectorAll("[data-roulette-choice]").forEach(btn => btn.addEventListener("click", () => {
    setRouletteChoice(btn.dataset.rouletteChoice);
  }));
  $("spinSlots").addEventListener("click", spinSlots);
  $("autoSlots10").addEventListener("click", autoSlots10);
  $("slotsWinLines").addEventListener("mouseover", e => {
    const badge = e.target.closest("[data-line]");
    if (!badge) return;
    document.querySelectorAll(".slot-payline").forEach(line => {
      line.classList.toggle("focus", line.dataset.line === badge.dataset.line);
    });
  });
  $("slotsWinLines").addEventListener("mouseout", () => {
    document.querySelectorAll(".slot-payline").forEach(line => line.classList.remove("focus"));
  });
  $("ghostToggle").addEventListener("change", e => {
    state.automation.roulette.enabled = e.target.checked;
    if (e.target.checked && !state.automation.roulette.lastAt) {
      state.automation.roulette.lastAt = Date.now() - ghostRouletteCooldown();
    }
    $("ticker").textContent = e.target.checked ? "Roulette fantome activee." : "Roulette fantome en pause.";
    save();
    render();
  });
  $("ghostAmount").addEventListener("change", e => {
    state.automation.roulette.amount = Math.max(MIN_GHOST_ROULETTE_BET, Math.floor(Number(e.target.value) || MIN_GHOST_ROULETTE_BET));
    save();
    render();
  });
  $("ghostChoice").addEventListener("change", e => {
    state.automation.roulette.choice = ["red", "black"].includes(e.target.value) ? e.target.value : "red";
    save();
    render();
  });
  $("blackjackDeal").addEventListener("click", dealBlackjack);
  $("blackjackHit").addEventListener("click", hitBlackjack);
  $("blackjackStand").addEventListener("click", standBlackjack);
  $("drawPoker").addEventListener("click", playPoker);
  $("pokerStay").addEventListener("click", () => playPokerDecision("stay"));
  $("pokerFold").addEventListener("click", () => playPokerDecision("fold"));
  $("raceCreate").addEventListener("click", createRace);
  $("raceJoin").addEventListener("click", joinRace);
  $("raceStart").addEventListener("click", startRace);
  $("raceWagerPlace").addEventListener("click", placeRaceWager);
  document.querySelectorAll("[data-network-tab]").forEach(btn => {
    btn.addEventListener("click", () => setNetworkTab(btn.dataset.networkTab));
  });
  $("chatForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("chatInput").value.trim();
    if (!text || !room) return;
    $("chatInput").value = "";
    sendTableAction({ type: "chat", text }).then(pollTable);
  });
  $("playerName").addEventListener("change", e => {
    state.name = e.target.value.trim() || state.name;
    save();
    pollTable();
  });
}

function loop(now) {
  const dt = Math.min(2, (now - lastTick) / 1000);
  lastTick = now;
  const passive = cps() * dt;
  if (passive > 0) {
    gain(passive);
    addRaceScore(passive);
  }
  state.heat = Math.max(0, state.heat - 12 * dt);
  if (now - lastRaceSyncCheckAt >= 250) {
    lastRaceSyncCheckAt = now;
    syncRaceScore();
  }
  const renderInterval = document.hidden ? HIDDEN_UI_RENDER_INTERVAL_MS : UI_RENDER_INTERVAL_MS;
  if (now - lastUiRenderAt >= renderInterval) {
    lastUiRenderAt = now;
    render();
  }
  requestAnimationFrame(loop);
}

bind();
paintRouletteWheel();
render(true);
sendTableAction({ type: "join" });
pollTable();
setInterval(save, 4000);
setInterval(() => {
  if (!document.hidden) pollTable();
}, 2500);
setInterval(() => {
  if (document.hidden) pollTable();
}, 10000);
setInterval(runAutomation, 1000);
document.addEventListener("visibilitychange", () => {
  lastTick = performance.now();
  if (!document.hidden) {
    pollTable();
    render();
  }
});
requestAnimationFrame(loop);
