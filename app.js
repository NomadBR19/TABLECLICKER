const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const suits = ["S", "H", "D", "C"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const redSuits = new Set(["H", "D"]);
const suitLabels = { S: "♠", H: "♥", D: "♦", C: "♣" };
const rouletteSegment = 360 / 37;
const SHARED_ROOM = "table-reseau";

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

const state = load() || {
  chips: 0,
  prestige: 1,
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
let bj = null;
let stakes = { roulette: 25, blackjack: 40, poker: 50 };
let rouletteChoice = "red";
let rouletteSpin = 0;
let rouletteBusy = false;
let rouletteHistory = [];
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
let lastRoomPlayersKey = "";
let lastLobbyKey = "";
let lastPokerReadyKey = "";
let lastPokerHandKey = "";
let lastRaceKey = "";
let lastChatKey = "";
let lastEventsKey = "";
let seenBigWinEvents = new Set();
let lastAutomationWarning = "";

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function save() {
  localStorage.setItem("table-clicker-save", JSON.stringify(state));
}

function load() {
  try { return JSON.parse(localStorage.getItem("table-clicker-save")); } catch { return null; }
}

function normalizeState() {
  state.upgrades = state.upgrades || {};
  upgrades.forEach(u => {
    if (!Number.isFinite(state.upgrades[u.id])) state.upgrades[u.id] = 0;
  });
  state.stats = state.stats || { gambled: 0, won: 0 };
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
  state.chips += Math.max(0, amount);
}

function addRaceScore(amount) {
  if (!currentRace || currentRace.status !== "running") return;
  const me = (currentRace.players || []).find(p => p.self);
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
  return (1 + upgrades.reduce((sum, u) => sum + state.upgrades[u.id] * u.click, 0)) * state.prestige;
}

function cps() {
  return upgrades.reduce((sum, u) => sum + state.upgrades[u.id] * u.cps, 0) * state.prestige;
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
  $("chips").textContent = fmt.format(state.chips);
  $("income").textContent = `${fmt.format(cps())}/s`;
  $("prestige").textContent = `x${state.prestige.toFixed(2)}`;
  $("clickValue").textContent = `+${fmt.format(clickPower())}`;
  $("rouletteStake").textContent = fmt.format(stakes.roulette);
  $("blackjackStake").textContent = fmt.format(stakes.blackjack);
  $("pokerStake").textContent = fmt.format(stakes.poker);
  $("raceScore").textContent = fmt.format(raceScore);
  updatePokerAvailability();
  updateRaceControls();
  $("heatFill").style.width = `${Math.min(100, state.heat)}%`;
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
    state.stats.won += payout;
    spawnFloatText(origin, `+${fmt.format(payout)}`, "win");
    celebrate(origin, payout >= bet * 4 ? "mega" : "win");
  }
  state.stats.gambled += bet;
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
  }, 3650);
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

  $("ghostLevel").textContent = `Niv. ${level}`;
  $("ghostStatus").textContent = status;
  $("ghostCooldown").style.width = `${cfg.enabled ? Math.min(100, elapsed / cooldown * 100) : 0}%`;
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
  stakes[game] = Math.max(0, Math.floor(stakes[game] + delta));
  render();
}

function setStake(game, amount) {
  stakes[game] = Math.max(0, Math.floor(amount));
  render();
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
  const count = intensity === "mega" ? 90 : 58;
  const rainCount = intensity === "mega" ? 110 : 70;
  const spread = intensity === "mega" ? 1.35 : 1;
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
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), 1650);
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
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), 2600);
  }
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
      state.stats.gambled += me.bet;
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
  lastPokerHandKey = "";
  renderCards($("communityCards"), game.community || []);
  const me = (game.players || []).find(p => p.id === playerId);
  renderCards($("pokerHand"), me ? me.hand : []);
  const winnerText = game.winnerId === playerId ? "Tu gagnes" : `${game.winnerName} gagne`;
  const detail = game.winnerDetail || `Main: ${game.winnerLabel}.`;
  log("pokerLog", `${winnerText}. ${detail} Pot ${fmt.format(game.payout)}.`);
  pokerReady = false;
  pokerReadyDeadline = 0;
  if (game.winnerId === playerId) {
    gain(game.payout);
    state.stats.won += game.payout;
    celebrate($("poker"), "mega");
    save();
    render();
  }
}

function rememberSet(storageKey, set, value) {
  set.add(value);
  const recent = Array.from(set).slice(-16);
  const next = new Set(recent);
  localStorage.setItem(storageKey, JSON.stringify(recent));
  return next;
}

function updateRaceControls() {
  const race = currentRace;
  const hasRace = Boolean(race);
  const me = race ? (race.players || []).find(p => p.self) : null;
  const isHost = race && race.hostId === playerId;
  const lobby = race && race.status === "lobby";
  const running = race && race.status === "running";

  $("raceCreate").disabled = hasRace;
  $("raceJoin").disabled = !lobby;
  $("raceJoin").textContent = me && lobby ? "Annuler" : "Rejoindre";
  $("raceStart").disabled = !lobby || !isHost || (race.players || []).length < 2;
  $("raceDuration").disabled = hasRace;
  $("raceBet").disabled = running;
  $("raceProgress").style.width = running
    ? `${Math.max(0, Math.min(100, (race.remaining / race.duration) * 100))}%`
    : "0%";
}

function renderRace(race) {
  currentRace = race;
  if (!race) {
    raceScore = 0;
    lastRaceKey = "";
    $("raceStatus").textContent = "Aucune course";
    $("raceLog").textContent = "Cree une course ou rejoins celle de la table.";
    setHtmlIfChanged("racePlayers", `<div class="empty-row">Aucune course en attente.</div>`);
    updateRaceControls();
    return;
  }

  const me = (race.players || []).find(p => p.self);
  if (race.status === "running" && me) {
    if (!paidRaceIds.has(race.id)) {
      if (spend(me.bet)) {
        state.stats.gambled += me.bet;
        paidRaceIds = rememberSet("table-clicker-paid-races", paidRaceIds, race.id);
        raceScore = 0;
        save();
      } else {
        $("raceLog").textContent = "Mise course impossible au depart.";
      }
    } else {
      raceScore = Math.max(raceScore, Number(me.score || 0));
    }
  }

  const key = [
    race.id,
    race.status,
    Math.floor(race.remaining || 0),
    (race.players || []).map(p => `${p.id}:${p.name}:${p.bet}:${Math.floor(p.score || 0)}:${p.self}`).join(",")
  ].join("|");
  if (key !== lastRaceKey) {
    lastRaceKey = key;
    setHtmlIfChanged("racePlayers", (race.players || []).map(p => `
    <div class="ready-player${p.self ? " self" : ""}">
      <span>${escapeHtml(p.name)}${p.self ? " (toi)" : ""}${p.host ? " - hote" : ""}</span>
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
    $("raceLog").textContent = `Course de ${race.duration}s. Pot actuel ${fmt.format(pot)}.`;
  }
  updateRaceControls();
}

function applyRaceResult(result) {
  if (!result || result.type !== "race" || wonRaceIds.has(result.id)) return;
  currentRace = null;
  const me = (result.players || []).find(p => p.id === playerId);
  if (!me) return;
  wonRaceIds = rememberSet("table-clicker-won-races", wonRaceIds, result.id);
  if (result.winnerId === playerId) {
    gain(result.payout);
    state.stats.won += result.payout;
    $("raceLog").textContent = `Tu gagnes la course. Pot ${fmt.format(result.payout)}.`;
    showTableAnnouncement(`${state.name} gagne la course: ${fmt.format(result.payout)} jetons`, `race-win-${result.id}`);
    celebrate($("race"), result.payout >= 100000 ? "mega" : "win");
  } else {
    $("raceLog").textContent = `${result.winnerName} gagne la course avec ${fmt.format(Math.floor((result.players || [])[0]?.score || 0))} points.`;
  }
  raceScore = 0;
  save();
  render();
}

async function createRace() {
  const duration = Number($("raceDuration").value || 60);
  const amount = Math.max(1, Math.floor(Number($("raceBet").value) || 100));
  if (amount > state.chips) return log("raceLog", "Mise course impossible.");
  const res = await sendTableAction({ type: "race_create", duration, amount }, true);
  if (!res.ok) return log("raceLog", res.error || "Course impossible.");
  renderRace(res.race);
  pollTable();
}

async function joinRace() {
  const race = currentRace;
  if (!race || race.status !== "lobby") return;
  const me = (race.players || []).find(p => p.self);
  const amount = me ? 0 : Math.max(1, Math.floor(Number($("raceBet").value) || 100));
  if (amount > state.chips) return log("raceLog", "Mise course impossible.");
  const res = await sendTableAction({ type: "race_join", amount }, true);
  if (!res.ok) return log("raceLog", res.error || "Participation impossible.");
  renderRace(res.race);
  pollTable();
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
  const me = (currentRace.players || []).find(p => p.self);
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
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, playerId, name: state.name, chips: Math.floor(state.chips), action })
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
  try {
    const res = await fetch(`/api/lobby?room=${encodeURIComponent(SHARED_ROOM)}&playerId=${encodeURIComponent(playerId)}&name=${encodeURIComponent(state.name)}&chips=${Math.floor(state.chips)}`);
    const data = await res.json();
    renderLobby(data.players || []);
  } catch {
    renderLobby([]);
  }
}

async function pollTable() {
  room = SHARED_ROOM;
  try {
    const res = await fetch(`/api/state?room=${encodeURIComponent(SHARED_ROOM)}&playerId=${encodeURIComponent(playerId)}&name=${encodeURIComponent(state.name)}&chips=${Math.floor(state.chips)}`);
    const data = await res.json();
    $("tableStatus").textContent = "Reseau";
    renderRoomPlayers(data.players || []);
    renderLobby(data.lobby || data.players || []);
    renderChat(data.chat || []);
    renderEvents(data.events || []);
    renderPokerReady(data.pokerReady || [], data.pokerReadyDeadline || 0);
    renderPokerHand(data.pokerHand || null);
    renderRace(data.race || null);
    applyPokerGame(data.lastGame);
    applyRaceResult(data.lastRace);
  } catch {
    $("tableStatus").textContent = "Hors ligne";
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
  const key = players.map(p => `${p.id}:${p.name}:${p.ip || ""}:${p.host || ""}`).join("|");
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
      </dl>
    </div>
  `).join("") || `<div class="empty-row">Aucun joueur en ligne.</div>`);
}

function setNetworkTab(tab) {
  document.querySelectorAll("[data-network-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.networkTab === tab);
  });
  $("networkChatPanel").classList.toggle("active", tab === "chat");
  $("networkPlayersPanel").classList.toggle("active", tab === "players");
  $("networkJournalPanel").classList.toggle("active", tab === "journal");
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
    if ((event.kind === "bigwin" || event.kind === "announce") && fresh) {
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
  document.querySelectorAll("[data-stake-add]").forEach(btn => btn.addEventListener("click", () => {
    updateStake(btn.closest("[data-stake-game]").dataset.stakeGame, Number(btn.dataset.stakeAdd));
  }));
  document.querySelectorAll("[data-stake-all]").forEach(btn => btn.addEventListener("click", () => {
    setStake(btn.closest("[data-stake-game]").dataset.stakeGame, state.chips);
  }));
  document.querySelectorAll("[data-stake-clear]").forEach(btn => btn.addEventListener("click", () => {
    setStake(btn.closest("[data-stake-game]").dataset.stakeGame, 0);
  }));
  document.querySelectorAll("[data-roulette-choice]").forEach(btn => btn.addEventListener("click", () => {
    setRouletteChoice(btn.dataset.rouletteChoice);
  }));
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
  $("saveButton").addEventListener("click", () => {
    save();
    $("ticker").textContent = "Partie sauvegardee.";
  });
  $("resetButton").addEventListener("click", () => {
    if (!confirm("Reinitialiser la partie solo ?")) return;
    localStorage.removeItem("table-clicker-save");
    location.reload();
  });
  $("prestigeButton").addEventListener("click", () => {
    if (state.chips < 25000) return $("ticker").textContent = "Prestige disponible a 25 000 jetons.";
    const bonus = 1 + Math.sqrt(state.chips / 25000) * .16;
    state.chips = 0;
    state.prestige += bonus - 1;
    state.upgrades = Object.fromEntries(upgrades.map(u => [u.id, 0]));
    state.automation.roulette.enabled = false;
    state.automation.roulette.lastAt = 0;
    $("ticker").textContent = `Prestige augmente: x${state.prestige.toFixed(2)}.`;
    save();
    render(true);
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
  syncRaceScore();
  render();
  requestAnimationFrame(loop);
}

bind();
paintRouletteWheel();
render(true);
sendTableAction({ type: "join" });
pollTable();
setInterval(save, 4000);
setInterval(pollTable, 2500);
setInterval(runAutomation, 1000);
requestAnimationFrame(loop);
