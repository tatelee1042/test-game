const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const MAX_RESULTS = 8;
const MANA_TYPES = ["W", "U", "B", "R", "G", "C"];

/* ---------------------------------------------------------------------------
 * Seats
 *
 * The board used to be two hardcoded sides told apart by a "player-" or
 * "opponent-" zone prefix. It is now a table of up to four seats — the human
 * plus three computer opponents — and each seat owns a zone prefix named after
 * it. Every seat has the same set of zones, so code that used to ask "is this
 * the opponent?" now asks which seat controls a card and compares seat ids.
 * ------------------------------------------------------------------------- */

const HUMAN_SEAT = "player";
const AI_SEAT_IDS = ["opponent", "opponent2", "opponent3"];
/** What a computer seat does when nobody has told it otherwise. */
const DEFAULT_SEAT_BEHAVIOR = {
  label: "",
  attackTarget: "weakest",
  attackWith: "all",
  blockStyle: "best",
  mainPhase: "pass",
  drawStep: "draw",
};
const seatBehaviors = new Map();
const gameBoard = document.querySelector(".game-board");
const aiSeatTemplate = document.querySelector("#ai-seat-template");

/** The computer seats at the table, in seating order. */
function aiSeatIds() {
  return [...document.querySelectorAll(".ai-seat")].map((section) => section.dataset.seat);
}

/** Every seat in turn order: the human takes the first turn, then each AI seat. */
function seatIds() {
  return [HUMAN_SEAT, ...aiSeatIds()];
}

function seatSection(seatId) {
  return document.querySelector(`.player-side[data-seat="${seatId}"]`);
}

function seatExists(seatId) {
  return Boolean(seatSection(seatId));
}

function isAiSeat(seatId) {
  return seatId !== HUMAN_SEAT;
}

function behaviorFor(seatId) {
  if (!seatBehaviors.has(seatId)) seatBehaviors.set(seatId, { ...DEFAULT_SEAT_BEHAVIOR });
  return seatBehaviors.get(seatId);
}

/**
 * A lone opponent is just "Your Opponent"; once the table grows they are
 * numbered by where they sit, so the names track the seating rather than the
 * order seats happened to be created in.
 */
function defaultSeatLabel(seatId) {
  const order = aiSeatIds();
  if (order.length <= 1) return "Your Opponent";
  const index = order.indexOf(seatId);
  return `Opponent ${(index < 0 ? AI_SEAT_IDS.indexOf(seatId) : index) + 1}`;
}

function seatLabel(seatId) {
  if (seatId === HUMAN_SEAT) return "You";
  return behaviorFor(seatId).label || defaultSeatLabel(seatId);
}

/** Writes each seat's current name through every place the board shows it. */
function refreshSeatLabels() {
  document.querySelectorAll(".ai-seat").forEach((section) => {
    const label = seatLabel(section.dataset.seat);
    section.querySelector(".seat-name").textContent = label;
    section.querySelector(".player-counters")?.setAttribute("aria-label", `${label} counters`);
    section.querySelector(".seat-remove")?.setAttribute("aria-label", `Remove ${label}`);
    section.querySelector(".life-total")?.setAttribute("aria-label", `${label} life total`);
    section.querySelector(".life-input")?.setAttribute("aria-label", `${label} HP`);
    section.querySelectorAll(".life-adjust").forEach((button) => {
      const direction = Number(button.dataset.delta) < 0 ? "Decrease" : "Increase";
      button.setAttribute("aria-label", `${direction} ${label} HP`);
    });
    const hand = section.querySelector(".hand-zone");
    hand?.setAttribute("aria-label", `${label} hand`);
    if (hand) hand.querySelector(".zone-label").textContent = `${label} hand`;
    section.querySelector(".card-piles")?.setAttribute("aria-label", `${label} card piles`);
    const heading = section.querySelector(".battlefield-heading");
    if (heading) heading.textContent = `${label} battlefield`;
  });
  window.repaintTurnState?.();
}

/** "your graveyard" vs "Second Opponent's graveyard". */
function seatPossessive(seatId) {
  return seatId === HUMAN_SEAT ? "your" : `${seatLabel(seatId)}'s`;
}

/** "You gained 3 life" vs "Second Opponent gained 3 life". */
function seatSubject(seatId) {
  return seatId === HUMAN_SEAT ? "You" : seatLabel(seatId);
}

function seatZone(seatId, zoneKind) {
  return document.querySelector(`[data-zone="${seatId}-${zoneKind}"]`);
}

function seatLifeTotal(seatId) {
  return seatSection(seatId)?.querySelector(".life-total") || null;
}

function seatLifeValue(seatId) {
  return Number(seatSection(seatId)?.querySelector(".life-input")?.value || 0);
}

/** Which seat a life-total element or board card belongs to. */
function seatOfElement(element) {
  if (!element) return HUMAN_SEAT;
  const zone = element.parentElement?.dataset.zone || "";
  const prefix = zone.split("-")[0];
  if (prefix && seatExists(prefix)) return prefix;
  return element.closest?.(".player-side")?.dataset.seat || HUMAN_SEAT;
}

function seatsOtherThan(seatId) {
  return seatIds().filter((candidate) => candidate !== seatId);
}

/**
 * Slot 1 and 2 are the top corners, slot 3 the bottom-right; the human always
 * holds the bottom-left. The seat count drives the grid rules that let a board
 * with fewer than three AI seats stretch back out to the old full-width look.
 */
function assignSeatSlots() {
  const seats = [...document.querySelectorAll(".ai-seat")];
  seats.forEach((section, index) => {
    section.dataset.seatSlot = String(index + 1);
  });
  gameBoard.dataset.seatCount = String(seats.length + 1);
}

function buildSeat(seatId) {
  const holder = document.createElement("div");
  holder.innerHTML = aiSeatTemplate.innerHTML
    .replaceAll("__SEAT__", seatId)
    .replaceAll("__LABEL__", "Opponent");
  const section = holder.firstElementChild;
  // The third AI seat sits below the divider, so it follows the human in the DOM.
  if (aiSeatIds().length >= 2) gameBoard.append(section);
  else gameBoard.insertBefore(section, document.querySelector(".turn-divider"));
  section.querySelectorAll(".drop-zone").forEach(registerZone);
  behaviorFor(seatId);
  assignSeatSlots();
  // Adding a seat renames the others: one opponent becomes Opponent 1.
  refreshSeatLabels();
  return section;
}

/**
 * Reshapes the table to match a save — the seats it recorded, no more, no less.
 * Saves written before multiplayer have no seat list and restore as a 1v1 board.
 */
function restoreSeatsFromState(state) {
  const wanted = AI_SEAT_IDS.filter((seatId) => (
    state.aiSeats?.length ? state.aiSeats.includes(seatId) : seatId === AI_SEAT_IDS[0]
  ));
  aiSeatIds().forEach((seatId) => {
    if (!wanted.includes(seatId)) {
      seatSection(seatId)?.remove();
      seatBehaviors.delete(seatId);
    }
  });
  wanted.forEach((seatId) => {
    if (!seatExists(seatId)) buildSeat(seatId);
  });
  assignSeatSlots();
  refreshSeatLabels();
}

/** The lowest unused AI seat id, or null when the table is full. */
function nextFreeSeatId() {
  return AI_SEAT_IDS.find((seatId) => !seatExists(seatId)) || null;
}

function addSeat() {
  const seatId = nextFreeSeatId();
  if (!seatId) return;
  buildSeat(seatId);
  syncSeatControls();
  recalculateStaticAbilities();
  showMessage(`${seatLabel(seatId)} joined the table. Open its behavior settings to decide how it plays.`, "success");
}

function removeSeat(seatId) {
  const section = seatSection(seatId);
  if (!section || !isAiSeat(seatId)) return;
  const removedLabel = seatLabel(seatId);
  // Anything this seat had in play leaves with it, including cards mid-combat.
  section.querySelectorAll(".board-card").forEach((card) => {
    combatAssignments.delete(card);
    card.remove();
  });
  combatAssignments.forEach((target, attacker) => {
    if (section.contains(target)) {
      combatAssignments.delete(attacker);
      attacker.classList.remove("declared-attacker");
      delete attacker.dataset.attackTarget;
    }
  });
  section.remove();
  seatBehaviors.delete(seatId);
  refreshSeatLabels();
  // The seat may have been mid-turn; hand the turn back to the human.
  if (window.currentTurnSeat === seatId) window.setTurnState?.(window.currentTurnPhase || "Untap", window.currentTurnNumber || 1, HUMAN_SEAT);
  assignSeatSlots();
  syncSeatControls();
  recalculateStaticAbilities();
  updateGraveyardDisplays();
  updateExileDisplays();
  updateCombatButton();
  showMessage(`${removedLabel} left the table.`, "success");
}

/** Reflects edit mode and the seat cap on the add/remove controls. */
function syncSeatControls() {
  addSeatButton.disabled = !editingMode || !nextFreeSeatId();
  // The last opponent cannot leave — a board with no opponent has nothing to solve.
  document.querySelectorAll(".ai-seat .seat-remove").forEach((button) => {
    button.disabled = aiSeatIds().length <= 1;
  });
}

/**
 * Wires a zone for placement clicks, drag and drop, and whichever pile display
 * it drives. Called for the human's zones at startup and for each AI seat's
 * zones as that seat is created.
 */
function registerZone(zone) {
  // Seats register their own zones as they are built, so guard against the
  // startup sweep wiring the same zone a second time.
  if (zone.dataset.zoneRegistered === "true") return;
  zone.dataset.zoneRegistered = "true";
  const zoneName = zone.dataset.zone || "";
  zone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (event.target.closest(".board-card") && !selectedCard) return;
    if (selectedPermanent && zoneName === "player-battlefield") {
      resolvePermanent(selectedPermanent, zone);
      return;
    }
    placeSelectedCard(zone);
  });
  zone.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && selectedCard) {
      event.preventDefault();
      placeSelectedCard(zone);
    }
  });
  zone.addEventListener("dragover", (event) => {
    const resolvingPermanent = draggedCard?.classList.contains("awaiting-placement");
    const validResolution = resolvingPermanent && zoneName === "player-battlefield";
    if (!draggedCard || (!editingMode && !validResolution)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (event) => {
    const resolvingPermanent = draggedCard?.classList.contains("awaiting-placement");
    const validResolution = resolvingPermanent && zoneName === "player-battlefield";
    if (!editingMode && !validResolution) return;
    event.preventDefault();
    zone.classList.remove("drag-over");
    if (draggedCard) {
      const resolvedCard = draggedCard;
      const fromZone = resolvedCard.parentElement?.dataset.zone;
      zone.append(resolvedCard);
      if (fromZone === "player-hand" && zoneName === "player-graveyard") {
        resolvedCard.dataset.discardedTurn = String(window.currentTurnNumber || 1);
      }
      if (resolvingPermanent) {
        resolvePermanent(resolvedCard, zone);
      } else {
        refreshCardState(resolvedCard);
      }
    }
  });

  if (zoneName.endsWith("-graveyard")) {
    zone.querySelector(".view-graveyard").addEventListener("click", (event) => {
      event.stopPropagation();
      openGraveyardViewer(zone);
    });
    new MutationObserver(updateGraveyardDisplays).observe(zone, { childList: true });
  }
  if (zoneName.endsWith("-exile")) {
    new MutationObserver(updateExileDisplays).observe(zone, { childList: true });
  }
  if (zoneName.endsWith("-battlefield")) {
    new MutationObserver(() => {
      recalculateStaticAbilities();
      validateManaChoicePrompt();
    }).observe(zone, { childList: true });
    new MutationObserver(arrangeLandStacks).observe(zone, { childList: true });
  }
}

const importer = {
  editToggle: document.querySelector(".edit-toggle"),
  editBanner: document.querySelector(".edit-mode-banner"),
  trigger: document.querySelector(".import-trigger"),
  drawer: document.querySelector(".card-drawer"),
  backdrop: document.querySelector(".drawer-backdrop"),
  close: document.querySelector(".close-drawer"),
  form: document.querySelector(".card-search"),
  query: document.querySelector("#card-query"),
  status: document.querySelector(".search-status"),
  results: document.querySelector(".search-results"),
  toast: document.querySelector(".placement-toast"),
  toastImage: document.querySelector(".placement-toast img"),
  toastCancel: document.querySelector(".placement-toast button"),
};

const manaPoolElement = document.querySelector(".mana-pool");
const clearManaButton = document.querySelector(".clear-mana");
const gameMessage = document.querySelector(".game-message");
const abilityCostBar = document.querySelector(".ability-cost-bar");
const abilityCostBarCopy = abilityCostBar.querySelector("span");
const payPermanentCostButton = abilityCostBar.querySelector(".pay-permanent-cost");
const cancelPermanentCostButton = abilityCostBar.querySelector(".cancel-permanent-cost");
// Seats can be added and removed while the board is being authored, so these
// collections are queried live rather than snapshotted once at startup.
const allLifeInputs = () => [...document.querySelectorAll(".life-input")];
const allLifeAdjustButtons = () => [...document.querySelectorAll(".life-adjust")];
const allPlayerCounters = () => [...document.querySelectorAll(".player-counter")];
const allZones = () => [...document.querySelectorAll(".drop-zone")];
const spellStack = document.querySelector(".spell-stack");
const spellStackBackdrop = document.querySelector(".spell-stack-backdrop");
const spellStackImage = document.querySelector(".spell-stack-image");
const spellStackTitle = document.querySelector("#spell-stack-title");
const spellStackMeta = document.querySelector(".spell-stack-meta");
const spellOracleText = document.querySelector(".spell-oracle-text");
const spellTargetPrompt = document.querySelector(".spell-target-prompt");
const spellTargetOptions = document.querySelector(".spell-target-options");
const resolveSpellButton = document.querySelector(".resolve-spell");
const nextPhaseButton = document.querySelector(".next-phase");
const combatPrompt = document.querySelector(".combat-prompt");
const combatAttackerName = document.querySelector(".combat-attacker-name");
const combatTargetOptions = document.querySelector(".combat-target-options");
const manaChoicePrompt = document.querySelector(".mana-choice-prompt");
const manaChoiceSource = document.querySelector(".mana-choice-source");
const manaChoiceOptions = document.querySelector(".mana-choice-options");
const cancelManaChoiceButton = document.querySelector(".cancel-mana-choice");
const cardHoverPreview = document.querySelector(".card-hover-preview");
const cardHoverPreviewImage = cardHoverPreview.querySelector("img");
const saveManagerTrigger = document.querySelector(".save-manager-trigger");
const clearBoardButton = document.querySelector(".clear-board");
const addSeatButton = document.querySelector(".add-seat");
const seatBehaviorPanel = document.querySelector(".seat-behavior-panel");
const seatBehaviorBackdrop = document.querySelector(".seat-behavior-backdrop");
const seatBehaviorTitle = document.querySelector("#seat-behavior-title");
const seatBehaviorForm = document.querySelector(".seat-behavior-form");
const closeSeatBehaviorButton = document.querySelector(".close-seat-behavior");
const saveManager = document.querySelector(".save-manager");
const saveManagerBackdrop = document.querySelector(".save-manager-backdrop");
const closeSaveManagerButton = document.querySelector(".close-save-manager");
const saveSlotList = document.querySelector(".save-slot-list");
const graveyardViewer = document.querySelector(".graveyard-viewer");
const graveyardViewerBackdrop = document.querySelector(".graveyard-viewer-backdrop");
const graveyardViewerTitle = document.querySelector("#graveyard-viewer-title");
const graveyardViewerCards = document.querySelector(".graveyard-viewer-cards");
const closeGraveyardViewerButton = document.querySelector(".close-graveyard-viewer");
const triggerViewer = document.querySelector(".trigger-viewer");
const triggerViewerBackdrop = document.querySelector(".trigger-viewer-backdrop");
const triggerViewerKind = document.querySelector(".trigger-viewer-kind");
const triggerSourceImage = document.querySelector(".trigger-source-image");
const triggerViewerTitle = document.querySelector("#trigger-viewer-title");
const triggerCondition = document.querySelector(".trigger-condition");
const triggerEffect = document.querySelector(".trigger-effect");
const triggerTargetOptions = document.querySelector(".trigger-target-options");
const resolveTriggerButton = document.querySelector(".resolve-trigger");

let selectedCard = null;
let draggedCard = null;
let selectedPermanent = null;
let editingMode = false;
let messageTimer = null;
let resolvingSpell = null;
let chosenTargets = [];
let requiredTargetCount = 0;
let targetingController = null;
let castDropTargets = [];
let combatAssignments = new Map();
let pendingAttacker = null;
let combatResolved = false;
let cardHoverTimer = null;
let hoveredBoardCard = null;
let clearBoardArmed = false;
let clearBoardTimer = null;
const SAVE_STORAGE_KEY = "daily-spellbook-board-saves-v1";
const SAVE_SLOT_COUNT = 10;
const tokenCardCache = new Map();
let triggerQueue = [];
let activeTrigger = null;
let activeAbilitySource = null;
let abilityTargetingController = null;
let pendingAbilityPayment = null;
let pendingKickerCast = null;
let pendingGraveyardCast = null;
let pendingManaChoice = null;
let pendingSurgeCast = null;
let pendingEffectChoice = null;
let alliedSpellCastTurn = 0;
const manaPool = Object.fromEntries(MANA_TYPES.map((type) => [type, 0]));

const MANA_PIP_ART = new Set(["W", "U", "B", "R", "G", "C"]);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
  ));
}

/** Markup for one `{...}` symbol: real art where we have it, a round token otherwise. */
function manaPipHtml(symbol) {
  const key = symbol.toUpperCase();
  const label = escapeHtml(`{${symbol}}`);
  if (MANA_PIP_ART.has(key)) {
    return `<i class="mana-pip mana-pip-${key.toLowerCase()}" role="img" aria-label="${label}" title="${label}"></i>`;
  }
  const text = escapeHtml(key);
  return `<i class="mana-pip is-text${text.length > 1 ? " is-tight" : ""}" role="img" aria-label="${label}" title="${label}">${text}</i>`;
}

/** Escapes `text`, then swaps every `{...}` for its symbol. Returns HTML. */
function withManaSymbols(text) {
  return escapeHtml(text).replace(/\{([^}]{1,6})\}/g, (_match, symbol) => manaPipHtml(symbol));
}

/** textContent when there is nothing to swap, symbol markup when there is. */
function setManaText(element, text) {
  if (!element) return;
  const value = String(text ?? "");
  if (!value.includes("{")) {
    element.textContent = value;
    return;
  }
  element.innerHTML = withManaSymbols(value);
}

function cardImage(card) {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? "";
}

function cardThumbnail(card) {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? cardImage(card);
}

function manaCostFor(card) {
  return card.mana_cost || card.card_faces?.[0]?.mana_cost || "";
}

function flashbackCostFor(cardElement) {
  if (!cardHasKeyword(cardElement, "flashback")) return "";
  return cardElement.dataset.oracleText.match(/\bFlashback\s+((?:\{[^}]+\})+)/i)?.[1] || "";
}

function kickerCostFor(cardElement) {
  return cardElement.dataset.oracleText.match(/(?:^|\n)Kicker\s+((?:\{[^}]+\})+)/i)?.[1] || "";
}

function surgeCostFor(cardElement) {
  return cardElement.dataset.oracleText.match(/(?:^|\n)Surge\s+((?:\{[^}]+\})+)/i)?.[1] || "";
}

function surgeIsAvailable() {
  return alliedSpellCastTurn === Number(window.currentTurnNumber || 1);
}

function recordAlliedSpellCast() {
  alliedSpellCastTurn = Number(window.currentTurnNumber || 1);
}

function resolvedOracleText(cardElement) {
  if (cardElement.dataset.resolutionEffectOverride) return cardElement.dataset.resolutionEffectOverride;
  return (cardElement.dataset.oracleText || "").split("\n").flatMap((line) => {
    if (/^(?:Kicker|Surge)\b/i.test(line.trim())) return [];
    const surgeConditional = line.match(/^If (?:this spell(?:'s)?|.+?'s) surge cost was paid,\s*(.+)$/i);
    if (surgeConditional) return cardElement.dataset.surgePaid === "true" ? [surgeConditional[1]] : [];
    const kickerConditional = line.match(/^If (?:this spell|it) was kicked,\s*(.+)$/i);
    if (kickerConditional) return cardElement.dataset.kicked === "true" ? [kickerConditional[1]] : [];
    return [line];
  }).join("\n");
}

function effectChoicesFor(effect) {
  const tapChoice = effect.match(/\b(tap) or (untap)\b/i);
  if (tapChoice) return ["Tap", "Untap"].map((label) => ({ label, effect: effect.replace(tapChoice[0], label.toLowerCase()) }));
  const statChoice = effect.match(/\bgets?\s+([+-]\d+\/[+-]\d+)\s+or\s+([+-]\d+\/[+-]\d+)\s+until end of turn\b/i);
  if (statChoice) return [statChoice[1], statChoice[2]].map((value) => ({
    label: `Get ${value}`,
    effect: effect.replace(statChoice[0], `gets ${value} until end of turn`),
  }));
  const keywords = keywordsWithTrait("grantable").join("|");
  const keywordChoice = effect.match(new RegExp(`\\bgains?\\s+(${keywords})\\s+or\\s+(${keywords})\\s+until end of turn\\b`, "i"));
  if (keywordChoice) return [keywordChoice[1], keywordChoice[2]].map((keyword) => ({
    label: `Gain ${keyword}`,
    effect: effect.replace(keywordChoice[0], `gains ${keyword} until end of turn`),
  }));
  return [];
}

function showEffectChoice(choices, applyChoice) {
  pendingEffectChoice = { choices, applyChoice };
  triggerViewer.hidden = true;
  triggerViewerBackdrop.hidden = true;
  spellStack.hidden = true;
  spellStackBackdrop.hidden = true;
  abilityCostBar.hidden = false;
  abilityCostBar.querySelector("strong").textContent = "Choose one effect";
  setManaText(abilityCostBarCopy, `${choices[0].label} or ${choices[1].label}`);
  payPermanentCostButton.hidden = false;
  payPermanentCostButton.disabled = false;
  payPermanentCostButton.textContent = choices[0].label;
  cancelPermanentCostButton.textContent = choices[1].label;
}

function applyPendingEffectChoice(index) {
  if (!pendingEffectChoice) return;
  const { choices, applyChoice } = pendingEffectChoice;
  pendingEffectChoice = null;
  abilityCostBar.hidden = true;
  cancelPermanentCostButton.textContent = "Cancel";
  applyChoice(choices[index]);
}

function isPlayableCastSource(cardElement) {
  const zone = cardElement.parentElement?.dataset.zone;
  return zone === "player-hand" || (zone === "player-graveyard" && graveyardCastOptionsFor(cardElement).length > 0);
}

/**
 * Every keyword the board understands, in one place.
 *
 * `zones` lists where the keyword actually does something — a Deathtouch
 * creature in the graveyard is inert, a Flashback card only matters there.
 * The remaining fields are the hooks the rules engine reads: combat helpers
 * look up `damageSteps` / `lethalOnAnyDamage` / `tramplesOver`, the blocking
 * code reads `blockableBy` / `blockersRequired`, targeting reads
 * `untargetableBy`, and `grantable` marks the keywords that "gains ~ until
 * end of turn" effects and static anthems are allowed to hand out.
 */
const KEYWORD_LIBRARY = {
  // ── Battlefield · evasion, blocking, attacking ──────────────────────────
  flying: {
    zones: ["battlefield"],
    short: "Fly",
    grantable: true,
    summary: "Can be blocked only by creatures with flying or reach.",
    blockableBy: (blocker) => cardHasKeyword(blocker, "flying") || cardHasKeyword(blocker, "reach"),
  },
  reach: {
    zones: ["battlefield"],
    short: "Rch",
    grantable: true,
    summary: "Can block creatures with flying.",
  },
  menace: {
    zones: ["battlefield"],
    short: "Men",
    grantable: true,
    summary: "Can't be blocked except by two or more creatures.",
    blockersRequired: 2,
  },
  defender: {
    zones: ["battlefield"],
    short: "Def",
    grantable: true,
    summary: "Can't attack.",
    cannotAttack: true,
  },
  haste: {
    zones: ["battlefield"],
    short: "Has",
    grantable: true,
    summary: "Can attack the turn it comes under your control.",
    ignoresSummoningSickness: true,
  },
  vigilance: {
    zones: ["battlefield"],
    short: "Vig",
    grantable: true,
    summary: "Attacking doesn't cause this creature to tap.",
    attacksWithoutTapping: true,
  },

  // ── Battlefield · combat damage ─────────────────────────────────────────
  "first strike": {
    zones: ["battlefield"],
    short: "1st",
    grantable: true,
    summary: "Deals combat damage before creatures without first strike.",
    damageSteps: ["first"],
  },
  "double strike": {
    zones: ["battlefield"],
    short: "2x",
    grantable: true,
    summary: "Deals combat damage in both the first-strike step and the regular step.",
    damageSteps: ["first", "regular"],
  },
  deathtouch: {
    zones: ["battlefield"],
    short: "DT",
    grantable: true,
    summary: "Any nonzero amount of damage it deals to a creature is lethal.",
    lethalOnAnyDamage: true,
  },
  trample: {
    zones: ["battlefield"],
    short: "Tra",
    grantable: true,
    summary: "Combat damage beyond what's lethal is assigned to the defending player.",
    tramplesOver: true,
  },
  lifelink: {
    zones: ["battlefield"],
    short: "LL",
    grantable: true,
    summary: "Damage it deals also causes its controller to gain that much life.",
    lifelink: true,
  },
  indestructible: {
    zones: ["battlefield"],
    short: "Ind",
    grantable: true,
    summary: "Lethal damage and “destroy” effects don't destroy it.",
    indestructible: true,
  },
  prowess: {
    zones: ["battlefield"],
    short: "Pro",
    summary: "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.",
    prowess: true,
  },

  // ── Battlefield · protection from targeting ─────────────────────────────
  hexproof: {
    zones: ["battlefield"],
    short: "Hex",
    grantable: true,
    summary: "Can't be the target of spells or abilities your opponents control.",
    untargetableBy: (chooser, cardController) => chooser !== cardController,
  },
  shroud: {
    zones: ["battlefield"],
    short: "Shr",
    summary: "Can't be the target of any spells or abilities.",
    untargetableBy: () => true,
  },
  ward: {
    zones: ["battlefield"],
    short: "Ward",
    summary: "Spells your opponents control that target this are countered unless its ward cost is paid.",
    wardTax: true,
  },

  // ── Hand · casting permissions and alternate costs ──────────────────────
  flash: {
    zones: ["hand"],
    short: "Flash",
    summary: "You may cast this any time you could cast an instant.",
    castsAtInstantSpeed: true,
  },
  kicker: {
    zones: ["hand"],
    short: "Kick",
    summary: "You may pay an additional cost as you cast this spell.",
  },
  surge: {
    zones: ["hand"],
    short: "Surge",
    summary: "Cast for its surge cost if you or a teammate has cast another spell this turn.",
  },

  // ── Graveyard ───────────────────────────────────────────────────────────
  // ── Graveyard · permission to CAST the card from the graveyard (CR 702:
  //    static abilities, distinct from the activated abilities below) ──────
  flashback: {
    zones: ["graveyard"],
    short: "FB",
    summary: "Cast this from your graveyard for its flashback cost, then exile it. (CR 702.34a)",
    castsFromGraveyard: true,
    graveyardCast: { costMode: "alternative", exilesOnResolve: true, instantOrSorceryOnly: true },
  },
  retrace: {
    zones: ["graveyard"],
    short: "Retrace",
    summary: "Cast this from your graveyard by discarding a land card as an additional cost. (CR 702.81a)",
    castsFromGraveyard: true,
    graveyardCast: {
      costMode: "additional",
      exilesOnResolve: false,
      requirement: { kind: "discard", zone: "player-hand", count: 1, label: "Discard a land card", match: (card) => card.dataset.typeLine.includes("Land") },
    },
  },
  "jump-start": {
    zones: ["graveyard"],
    short: "Jump",
    summary: "Cast this from your graveyard by discarding a card as an additional cost, then exile it. (CR 702.133a)",
    castsFromGraveyard: true,
    graveyardCast: {
      costMode: "additional",
      exilesOnResolve: true,
      instantOrSorceryOnly: true,
      requirement: { kind: "discard", zone: "player-hand", count: 1, label: "Discard a card", match: () => true },
    },
  },
  escape: {
    zones: ["graveyard"],
    short: "Escape",
    summary: "Cast this from your graveyard by paying its escape cost, which exiles other cards from your graveyard. (CR 702.138a)",
    castsFromGraveyard: true,
    graveyardCast: { costMode: "alternative", exilesOnResolve: false, escapes: true },
  },
  harmonize: {
    zones: ["graveyard"],
    short: "Harm",
    summary: "Cast this from your graveyard for its harmonize cost, tapping up to one untapped creature you control to reduce the cost by its power, then exile it. (CR 702.180a)",
    castsFromGraveyard: true,
    graveyardCast: {
      costMode: "alternative",
      exilesOnResolve: true,
      requirement: { kind: "tap", zone: "player-battlefield", count: 1, optional: true, label: "Tap up to one untapped creature to reduce the cost", match: (card) => card.dataset.typeLine.includes("Creature") && !card.classList.contains("tapped") },
    },
  },
  mayhem: {
    zones: ["graveyard"],
    short: "Mayhem",
    summary: "If you discarded this card this turn, cast it from your graveyard for its mayhem cost. (CR 702.187b)",
    castsFromGraveyard: true,
    graveyardCast: {
      costMode: "alternative",
      exilesOnResolve: false,
      requiresDiscardedThisTurn: true,
    },
  },
  disturb: {
    zones: ["graveyard"],
    short: "Disturb",
    summary: "Cast this transformed from your graveyard by paying its disturb cost. (CR 702.146a)",
    castsFromGraveyard: true,
    graveyardCast: { costMode: "alternative", exilesOnResolve: false, transforms: true },
  },
  aftermath: {
    zones: ["graveyard"],
    short: "After",
    summary: "Cast the second half of this split card from your graveyard, then exile it. (CR 702.127a)",
    castsFromGraveyard: true,
    graveyardCast: { costMode: "secondFace", exilesOnResolve: true, instantOrSorceryOnly: true },
  },

  // ── Graveyard · activated abilities (CR 702: these are the only keywords that
  //    are activated abilities functioning while the card is in a graveyard) ──
  unearth: {
    zones: ["graveyard"],
    short: "Unearth",
    summary: "[Cost]: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. Activate only as a sorcery. (CR 702.84a)",
    graveyardAbility: {
      describe: () => "Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step.",
      resolve: resolveUnearth,
    },
  },
  scavenge: {
    zones: ["graveyard"],
    short: "Scavenge",
    summary: "[Cost], Exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Activate only as a sorcery. (CR 702.97a)",
    graveyardAbility: {
      exilesAsCost: true,
      // Routed through the normal targeting flow, so the effect text drives it.
      describe: (card) => `Put ${Number(card.dataset.basePower || 0)} +1/+1 counters on target creature.`,
    },
  },
  embalm: {
    zones: ["graveyard"],
    short: "Embalm",
    summary: "[Cost], Exile this card from your graveyard: Create a token that's a copy of this card, except it's white, has no mana cost, and is a Zombie. Activate only as a sorcery. (CR 702.128a)",
    graveyardAbility: {
      exilesAsCost: true,
      describe: () => "Create a token that's a copy of this card, except it's a white Zombie with no mana cost.",
      resolve: (card) => resolveTokenCopyKeyword(card, { flavor: "white Zombie" }),
    },
  },
  eternalize: {
    zones: ["graveyard"],
    short: "Eternalize",
    summary: "[Cost], Exile this card from your graveyard: Create a token that's a copy of this card, except it's a black 4/4 Zombie with no mana cost. Activate only as a sorcery. (CR 702.129a)",
    graveyardAbility: {
      exilesAsCost: true,
      describe: () => "Create a token that's a copy of this card, except it's a black 4/4 Zombie with no mana cost.",
      resolve: (card) => resolveTokenCopyKeyword(card, { flavor: "black 4/4 Zombie", power: "4", toughness: "4" }),
    },
  },
  encore: {
    zones: ["graveyard"],
    short: "Encore",
    summary: "[Cost], Exile this card from your graveyard: For each opponent, create a token copy that attacks that opponent this turn if able. The tokens gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery. (CR 702.141a)",
    graveyardAbility: {
      exilesAsCost: true,
      describe: () => "For each opponent, create a token copy that attacks that opponent this turn. The tokens gain haste and are sacrificed at the beginning of the next end step.",
      resolve: (card) => resolveTokenCopyKeyword(card, { flavor: "attacking copy", attacking: true, haste: true, sacrificeAtEndStep: true, zombie: false }),
    },
  },
};

function keywordDefinition(keyword) {
  return KEYWORD_LIBRARY[String(keyword).toLowerCase()] ?? null;
}

/** Keyword names carrying a given hook, longest first so regex alternations match greedily. */
function keywordsWithTrait(trait) {
  return Object.keys(KEYWORD_LIBRARY)
    .filter((keyword) => KEYWORD_LIBRARY[keyword][trait])
    .sort((left, right) => right.length - left.length);
}

/** Which of the three zones a card is sitting in, or "" when it's mid-cast or off-board. */
function zoneKindFor(cardElement) {
  const zone = cardElement.parentElement?.dataset.zone || "";
  if (zone.endsWith("-battlefield")) return "battlefield";
  if (zone.endsWith("-hand")) return "hand";
  if (zone.endsWith("-graveyard")) return "graveyard";
  return "";
}

function controllerOf(cardElement) {
  return seatOfElement(cardElement);
}

/** Printed keywords plus anything granted by static anthems or until-end-of-turn effects. */
function cardKeywordNames(cardElement) {
  return [...new Set([
    ...JSON.parse(cardElement.dataset.keywords || "[]"),
    ...JSON.parse(cardElement.dataset.grantedKeywords || "[]"),
    ...JSON.parse(cardElement.dataset.temporaryKeywords || "[]"),
  ].map((keyword) => keyword.toLowerCase()))];
}

function cardHasKeyword(cardElement, requestedKeyword) {
  return cardKeywordNames(cardElement).includes(String(requestedKeyword).toLowerCase());
}

/** The card's keywords that this library knows about AND that work in its current zone. */
function activeKeywordsFor(cardElement) {
  const zoneKind = zoneKindFor(cardElement);
  return cardKeywordNames(cardElement).filter((keyword) => {
    const definition = keywordDefinition(keyword);
    // With no zone (a spell mid-resolution) fall back to the printed keyword.
    return definition && (!zoneKind || definition.zones.includes(zoneKind));
  });
}

/** True when any zone-appropriate keyword on the card carries `trait`. */
function cardKeywordTrait(cardElement, trait) {
  return activeKeywordsFor(cardElement).some((keyword) => keywordDefinition(keyword)?.[trait]);
}

function cardHasHaste(cardElement) {
  return cardHasKeyword(cardElement, "haste");
}

/** Combat damage is dealt in a first-strike step, a regular step, or both. */
function damageStepsFor(cardElement) {
  const steps = new Set();
  activeKeywordsFor(cardElement).forEach((keyword) => {
    keywordDefinition(keyword)?.damageSteps?.forEach((step) => steps.add(step));
  });
  return steps.size ? [...steps] : ["regular"];
}

/** Every evasion keyword on the attacker must accept this blocker. */
function canBlockAttacker(blocker, attacker) {
  return activeKeywordsFor(attacker).every((keyword) => {
    const restriction = keywordDefinition(keyword)?.blockableBy;
    return !restriction || restriction(blocker, attacker);
  });
}

/** Menace and friends raise the number of blockers needed to block at all. */
function blockersRequiredFor(attacker) {
  return activeKeywordsFor(attacker).reduce(
    (most, keyword) => Math.max(most, keywordDefinition(keyword)?.blockersRequired || 1),
    1,
  );
}

function canBeTargetedBy(candidate, chooser = "player") {
  if (!candidate?.classList?.contains("board-card")) return true;
  const cardController = controllerOf(candidate);
  return !activeKeywordsFor(candidate).some((keyword) => {
    const rule = keywordDefinition(keyword)?.untargetableBy;
    return rule && rule(chooser, cardController);
  });
}

function wardCostFor(cardElement) {
  return cardElement.dataset.oracleText?.match(/\bWard\s*[—-]?\s*((?:\{[^}]+\})+)/i)?.[1] || "";
}

/**
 * Ward taxes an opponent's spell that targets the permanent. Returns the first
 * target whose ward cost the player can't pay — that spell is countered.
 */
function unpaidWardTarget(targets) {
  for (const target of targets) {
    if (!target?.classList?.contains("board-card")) continue;
    if (controllerOf(target) === HUMAN_SEAT || !cardKeywordTrait(target, "wardTax")) continue;
    const cost = wardCostFor(target);
    if (!cost) continue;
    const payment = spendManaFor(cost);
    if (!payment.paid) return { target, cost };
  }
  return null;
}

/** Reads the mana cost printed after a keyword, e.g. "Unearth {2}{B}" → "{2}{B}". */
function keywordCostFor(cardElement, keyword) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${keyword}\\s*(?:—|-)?\\s*((?:\\{[^}]+\\})+)`, "i");
  return cardElement.dataset.oracleText?.match(pattern)?.[1] || "";
}

/**
 * Synthesizes the activatable abilities a card offers from your graveyard.
 * Per CR 702, only unearth, scavenge, embalm, eternalize and encore are
 * activated abilities that function there.
 */
function graveyardKeywordAbilities(card) {
  if (zoneKindFor(card) !== "graveyard" || controllerOf(card) !== "player") return [];
  const lines = (card.dataset.oracleText || "").split("\n");
  return activeKeywordsFor(card).flatMap((keyword) => {
    const ability = keywordDefinition(keyword)?.graveyardAbility;
    if (!ability) return [];
    const cost = keywordCostFor(card, keyword);
    if (!cost) return [];
    const lineIndex = lines.findIndex((line) => new RegExp(`^\\s*${keyword}\\b`, "i").test(line));
    return [{
      cost,
      effect: ability.describe(card),
      keyword,
      lineIndex: lineIndex < 0 ? 0 : lineIndex,
      lineCount: lines.length,
    }];
  });
}

function secondFaceOf(card) {
  try {
    return JSON.parse(card.dataset.secondFace || "null");
  } catch {
    return null;
  }
}

/** Escape costs read "Escape—{2}{B}{B}, Exile four other cards from your graveyard." */
function escapeExileCountFor(card) {
  const match = card.dataset.oracleText?.match(/Escape[^\n]*?Exile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?/i);
  return match ? counterAmount(match[1]) : 0;
}

/**
 * Every way this card may currently be cast from your graveyard. Each option
 * carries the mana to pay, any additional cost to satisfy first, and what
 * happens to the card after it resolves.
 */
function graveyardCastOptionsFor(card) {
  if (zoneKindFor(card) !== "graveyard" || controllerOf(card) !== "player") return [];
  return activeKeywordsFor(card).flatMap((keyword) => {
    const definition = keywordDefinition(keyword);
    const spec = definition?.graveyardCast;
    if (!spec) return [];
    if (spec.instantOrSorceryOnly && !/Instant|Sorcery/.test(card.dataset.typeLine)) return [];
    // Mayhem only works on the turn you discarded the card.
    if (spec.requiresDiscardedThisTurn
      && Number(card.dataset.discardedTurn || 0) !== Number(window.currentTurnNumber || 1)) return [];
    const secondFace = secondFaceOf(card);
    if ((spec.transforms || spec.costMode === "secondFace") && !secondFace) return [];
    const cost = spec.costMode === "additional"
      ? card.dataset.manaCost
      : spec.costMode === "secondFace"
        ? secondFace.manaCost
        : keywordCostFor(card, keyword);
    if (!cost) return [];
    let requirement = spec.requirement || null;
    if (spec.escapes) {
      const count = escapeExileCountFor(card);
      requirement = count
        ? { kind: "exile", zone: "player-graveyard", count, label: `Exile ${count} other card${count === 1 ? "" : "s"} from your graveyard`, match: (candidate) => candidate !== card }
        : null;
    }
    return [{ keyword, cost, costMode: spec.costMode, requirement, spec, secondFace }];
  });
}

function graveyardCastLabel(option) {
  const name = option.keyword.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return option.costMode === "additional" ? `${name} ${option.cost}` : `${name} ${option.cost}`;
}

function clearGraveyardCastPrompt() {
  document.querySelectorAll(".legal-ability-cost, .chosen-ability-cost")
    .forEach((card) => card.classList.remove("legal-ability-cost", "chosen-ability-cost"));
  abilityCostBar.hidden = true;
  payPermanentCostButton.hidden = false;
  cancelPermanentCostButton.textContent = "Cancel";
  pendingGraveyardCast = null;
}

/** Lets the player pick the cards to discard/exile/tap for a graveyard cast. */
function showGraveyardCastCostChoices(card, target, option) {
  const { requirement } = option;
  const candidates = [...document.querySelectorAll(`[data-zone="${requirement.zone}"] .board-card`)]
    .filter((candidate) => candidate !== card && requirement.match(candidate));
  if (candidates.length < requirement.count && !requirement.optional) {
    showMessage(`You can't pay ${card.dataset.cardName}'s ${option.keyword} cost — ${requirement.label.toLowerCase()}.`, "error");
    return;
  }
  pendingGraveyardCast = { card, target, option, requirement, selected: [], candidates };
  candidates.forEach((candidate) => candidate.classList.add("legal-ability-cost"));
  abilityCostBar.hidden = false;
  abilityCostBar.querySelector("strong").textContent = requirement.label;
  abilityCostBarCopy.textContent = requirement.optional
    ? "Optional — choose one or cast without it."
    : `Selected 0 of ${requirement.count}`;
  payPermanentCostButton.hidden = false;
  payPermanentCostButton.disabled = !requirement.optional;
  payPermanentCostButton.textContent = requirement.optional ? "Cast without tapping" : `Pay cost (0/${requirement.count})`;
}

/** Applies the chosen additional cost. Called only after the mana was paid. */
function payGraveyardAdditionalCost(option, selected) {
  const kind = option.requirement?.kind;
  if (kind === "discard") {
    selected.forEach((chosen) => {
      chosen.dataset.discardedTurn = String(window.currentTurnNumber || 1);
      document.querySelector('[data-zone="player-graveyard"]').append(chosen);
      refreshCardState(chosen);
    });
  }
  if (kind === "exile") {
    selected.forEach((chosen) => {
      document.querySelector('[data-zone="player-exile"]').append(chosen);
      refreshCardState(chosen);
    });
  }
  if (kind === "tap") {
    selected.forEach((chosen) => {
      chosen.classList.add("tapped");
      chosen.querySelectorAll(".mana-choice").forEach((button) => { button.disabled = true; });
    });
  }
}

function finishGraveyardCast(card, target, option, selected = []) {
  clearGraveyardCastPrompt();
  let cost = option.cost;
  // Harmonize: tapping a creature reduces the cost by that creature's power.
  if (option.requirement?.kind === "tap" && selected.length) {
    const power = creatureCombatStats(selected[0]).power;
    // reduceManaCost takes a cost string, so express the reduction as generic mana.
    if (power > 0) cost = reduceManaCost(cost, `{${power}}`);
  }
  card.dataset.graveyardCastKeyword = option.keyword;
  if (option.spec.exilesOnResolve) card.dataset.castExilesOnResolve = "true";
  if (option.spec.transforms) card.dataset.pendingTransform = "true";
  if (option.spec.escapes) card.dataset.escaped = "true";
  const alternateCost = option.costMode === "additional" ? "" : cost;
  finishCardCast(card, target, false, alternateCost, false, false, () => {
    payGraveyardAdditionalCost(option, selected);
    showMessage(`${card.dataset.cardName} cast from your graveyard with ${option.keyword}.`, "success");
  });
}

function beginGraveyardCast(card, target, option) {
  if (option.requirement) {
    showGraveyardCastCostChoices(card, target, option);
    return;
  }
  finishGraveyardCast(card, target, option);
}

/** More than one graveyard-cast keyword on the same card: let the player choose. */
function offerGraveyardCastChoice(card, target, options) {
  showEffectChoice(
    options.slice(0, 2).map((option) => ({ label: graveyardCastLabel(option), option })),
    (choice) => beginGraveyardCast(card, target, choice.option),
  );
}

/** Disturb casts the card transformed — swap in its back face as it resolves. */
function transformToSecondFace(card) {
  const face = secondFaceOf(card);
  if (!face) return;
  delete card.dataset.pendingTransform;
  card.dataset.secondFace = JSON.stringify({
    name: card.dataset.cardName,
    typeLine: card.dataset.typeLine,
    oracleText: card.dataset.oracleText,
    manaCost: card.dataset.manaCost,
    power: card.dataset.basePower,
    toughness: card.dataset.baseToughness,
    image: card.querySelector("img")?.src || "",
  });
  card.dataset.cardName = face.name || card.dataset.cardName;
  card.dataset.typeLine = face.typeLine || card.dataset.typeLine;
  card.dataset.oracleText = face.oracleText || "";
  card.dataset.basePower = face.power || "";
  card.dataset.baseToughness = face.toughness || "";
  card.dataset.transformed = "true";
  const image = card.querySelector("img");
  if (image && face.image) {
    image.src = face.image;
    image.alt = face.name || card.dataset.cardName;
  }
}

/** Builds a token that copies the given card, reusing its art and rules text. */
function tokenCopyOf(card, { power, toughness, zombie = true } = {}) {
  const image = card.querySelector("img")?.src || "";
  const printedType = card.dataset.typeLine || "";
  // Embalm and eternalize add Zombie to the copy's creature types.
  const typeLine = !zombie || /\bZombie\b/.test(printedType)
    ? printedType
    : `${printedType}${printedType.includes("—") ? "" : " —"} Zombie`;
  const token = createBoardCard({
    id: `${card.dataset.cardId || "copy"}-token`,
    name: card.dataset.cardName,
    mana_cost: "",
    type_line: typeLine || card.dataset.typeLine,
    oracle_text: card.dataset.oracleText || "",
    keywords: JSON.parse(card.dataset.keywords || "[]"),
    power: power ?? card.dataset.basePower,
    toughness: toughness ?? card.dataset.baseToughness,
    produced_mana: [],
    image_uris: { normal: image, small: image },
  });
  token.dataset.isToken = "true";
  return token;
}

/** Shared resolver for embalm, eternalize and encore — each makes a token copy. */
function resolveTokenCopyKeyword(card, { flavor, power, toughness, attacking = false, haste = false, sacrificeAtEndStep = false, zombie = true }) {
  const battlefield = document.querySelector('[data-zone="player-battlefield"]');
  const token = tokenCopyOf(card, { power, toughness, zombie });
  if (haste) token.dataset.temporaryKeywords = JSON.stringify(["haste"]);
  else token.dataset.enteredTurn = String(window.currentTurnNumber || 1);
  if (sacrificeAtEndStep) token.dataset.sacrificeAtEndStep = "true";
  battlefield.append(token);
  if (attacking) {
    token.classList.add("declared-attacker");
    const defender = seatsOtherThan(HUMAN_SEAT)[0];
    token.dataset.attackTarget = seatLabel(defender);
    if (window.currentTurnPhase === "Combat phase") combatAssignments.set(token, seatLifeTotal(defender));
  }
  token.classList.add("token-created");
  window.setTimeout(() => token.classList.remove("token-created"), 650);
  refreshCardState(token);
  recalculateStaticAbilities();
  emitGameEvent("permanent-enter", { card: token, controller: "player" });
  showMessage(`${card.dataset.cardName} returned as a ${flavor} token copy.`, "success");
}

/** Unearth returns the card itself, hasty and short-lived. */
function resolveUnearth(card) {
  const battlefield = document.querySelector('[data-zone="player-battlefield"]');
  battlefield.append(card);
  const temporary = new Set(JSON.parse(card.dataset.temporaryKeywords || "[]"));
  temporary.add("haste");
  card.dataset.temporaryKeywords = JSON.stringify([...temporary]);
  card.dataset.exileAtEndStep = "true";
  card.dataset.damageMarked = "0";
  card.classList.add("permanent-resolved");
  window.setTimeout(() => card.classList.remove("permanent-resolved"), 650);
  refreshCardState(card);
  recalculateStaticAbilities();
  emitGameEvent("permanent-enter", { card, controller: "player" });
  showMessage(`${card.dataset.cardName} was unearthed with haste. It is exiled at the beginning of the next end step.`, "success");
}

/** Cleans up unearthed permanents and encore tokens at the beginning of the end step. */
function resolveEndStepDelayedEffects() {
  const exiling = [...document.querySelectorAll('[data-zone$="battlefield"] .board-card[data-exile-at-end-step="true"]')];
  const sacrificing = [...document.querySelectorAll('[data-zone$="battlefield"] .board-card[data-sacrifice-at-end-step="true"]')];
  exiling.forEach((card) => {
    const owner = controllerOf(card);
    delete card.dataset.exileAtEndStep;
    document.querySelector(`[data-zone="${owner}-exile"]`).append(card);
    refreshCardState(card);
  });
  sacrificing.forEach((card) => {
    delete card.dataset.sacrificeAtEndStep;
    movePermanentToGraveyard(card, { reason: "sacrificed" });
  });
  if (exiling.length || sacrificing.length) {
    recalculateStaticAbilities();
    showMessage(
      `End step: ${[
        exiling.length ? `${exiling.length} unearthed permanent${exiling.length === 1 ? " was" : "s were"} exiled` : "",
        sacrificing.length ? `${sacrificing.length} encore token${sacrificing.length === 1 ? " was" : "s were"} sacrificed` : "",
      ].filter(Boolean).join("; ")}.`,
      "error",
    );
  }
}

/**
 * Shows the keywords that are live for the card's current zone — combat keywords
 * on the battlefield, casting keywords in hand, flashback in the graveyard.
 */
function updateKeywordBadge(card) {
  card.querySelector(".keyword-badge")?.remove();
  // Flashback already has its own cost badge in the graveyard.
  const keywords = activeKeywordsFor(card).filter((keyword) => keyword !== "flashback");
  if (!keywords.length) return;
  const label = (keyword) => {
    const definition = keywordDefinition(keyword);
    const cost = definition.wardTax ? wardCostFor(card) : "";
    return `${definition.short}${cost}`;
  };
  const badge = document.createElement("span");
  badge.className = "keyword-badge";
  setManaText(badge, keywords.map(label).join(" "));
  badge.title = keywords
    .map((keyword) => `${keyword.replace(/\b\w/g, (letter) => letter.toUpperCase())} — ${keywordDefinition(keyword).summary}`)
    .join("\n");
  card.append(badge);
}

/** Prowess: casting a noncreature spell pumps your prowess creatures until end of turn. */
function applyProwessTriggers(spellElement) {
  if (spellElement.dataset.typeLine.includes("Creature")) return;
  const creatures = [...document.querySelectorAll('[data-zone="player-battlefield"] .board-card')]
    .filter((card) => cardKeywordTrait(card, "prowess"));
  if (!creatures.length) return;
  creatures.forEach((card) => {
    card.dataset.temporaryPowerModifier = String(Number(card.dataset.temporaryPowerModifier || 0) + 1);
    card.dataset.temporaryToughnessModifier = String(Number(card.dataset.temporaryToughnessModifier || 0) + 1);
    card.classList.add("temporary-modified");
  });
  recalculateStaticAbilities();
  showMessage(
    `Prowess: ${creatures.map((card) => card.dataset.cardName).join(", ")} got +1/+1 until end of turn.`,
    "success",
  );
}

function showMessage(message, tone = "neutral") {
  window.clearTimeout(messageTimer);
  setManaText(gameMessage, message);
  gameMessage.dataset.tone = tone;
  gameMessage.hidden = false;
  messageTimer = window.setTimeout(() => {
    gameMessage.hidden = true;
  }, 3200);
}

function counterAmount(value) {
  const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return Number(value) || words[value.toLowerCase()] || 1;
}

function tokenInstructionsFor(effect) {
  const instructions = [];
  const numberWords = "a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+";
  const pattern = new RegExp(`\\bcreate(?:s)?\\s+(${numberWords})\\s+([^.;]+?)\\s+tokens?\\b`, "gi");
  for (const match of effect.matchAll(pattern)) {
    const description = match[2].trim();
    const stats = description.match(/(\d+)\/(\d+)/);
    const creatureIndex = description.toLowerCase().lastIndexOf(" creature");
    let nameSource = creatureIndex >= 0 ? description.slice(0, creatureIndex) : description;
    nameSource = nameSource
      .replace(/\d+\/\d+/g, "")
      .replace(/\b(?:white|blue|black|red|green|colorless|tapped|untapped|legendary|artifact|enchantment|and|attacking)\b/gi, " ")
      .replace(/\bwith\b[\s\S]*$/i, "")
      .replace(/[^a-z0-9' -]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const name = nameSource || (creatureIndex >= 0 ? "Creature" : "Token");
    instructions.push({
      count: counterAmount(match[1]),
      name,
      power: stats?.[1] || "",
      toughness: stats?.[2] || "",
      tapped: /\btapped\b/i.test(description),
      attacking: /\band attacking\b/i.test(description),
    });
  }
  return instructions;
}

async function scryfallTokenFor(instruction) {
  const cacheKey = `${instruction.name}|${instruction.power}|${instruction.toughness}`.toLowerCase();
  if (tokenCardCache.has(cacheKey)) return tokenCardCache.get(cacheKey);
  const exactQuery = `include:extras t:token !\"${instruction.name}\"`;
  const broadQuery = `include:extras t:token name:\"${instruction.name}\"`;
  for (const query of [exactQuery, broadQuery]) {
    const response = await fetch(`${SCRYFALL_SEARCH_URL}?q=${encodeURIComponent(query)}&unique=cards`);
    if (!response.ok) continue;
    const payload = await response.json();
    const choices = payload.data || [];
    const matchingStats = choices.find((card) => (
      (!instruction.power || String(card.power) === instruction.power)
      && (!instruction.toughness || String(card.toughness) === instruction.toughness)
    ));
    const token = matchingStats || choices[0];
    if (token) {
      tokenCardCache.set(cacheKey, token);
      return token;
    }
  }
  return null;
}

async function createTokensFromEffect(effect, controller) {
  const instructions = tokenInstructionsFor(effect);
  if (!instructions.length) return [];
  const battlefield = document.querySelector(`[data-zone="${controller}-battlefield"]`);
  const created = [];
  for (const instruction of instructions) {
    try {
      const tokenData = await scryfallTokenFor(instruction);
      if (!tokenData) {
        showMessage(`Scryfall could not find the ${instruction.name} token.`, "error");
        continue;
      }
      for (let index = 0; index < instruction.count; index += 1) {
        const token = createBoardCard(tokenData);
        token.dataset.isToken = "true";
        if (instruction.tapped) token.classList.add("tapped");
        if (instruction.attacking) token.classList.add("declared-attacker");
        if (token.dataset.typeLine.includes("Creature") && !cardHasHaste(token)) {
          token.dataset.enteredTurn = String(window.currentTurnNumber || 1);
        }
        battlefield.append(token);
        token.classList.add("token-created");
        refreshCardState(token);
        window.setTimeout(() => token.classList.remove("token-created"), 650);
        created.push(token);
        emitGameEvent("permanent-enter", { card: token, controller });
      }
    } catch {
      showMessage(`Unable to load the ${instruction.name} token from Scryfall.`, "error");
    }
  }
  recalculateStaticAbilities();
  if (created.length) showMessage(`Created ${created.length} token${created.length === 1 ? "" : "s"} on ${controller === "player" ? "your" : "the opponent's"} battlefield.`, "success");
  return created;
}

function addPlayerCounter(player, type, amount) {
  const counter = seatSection(player)?.querySelector(`.player-counter[data-counter="${type}"]`);
  if (!counter) return;
  const nextValue = Number(counter.dataset.value || 0) + amount;
  counter.dataset.value = String(nextValue);
  counter.textContent = `${type === "poison" ? "Poison" : "Experience"} ${nextValue}`;
  counter.hidden = false;
  counter.classList.remove("counter-added");
  requestAnimationFrame(() => counter.classList.add("counter-added"));
}

function applyPlayerCounterEffects(effect, controller, targets = []) {
  const match = effect.match(/\b(?:gets?|gains?)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(poison|experience) counters?\b/i);
  if (!match) return [];
  const amount = counterAmount(match[1]);
  const type = match[2].toLowerCase();
  const recipients = new Set();
  if (/\b(you get|you gain)/i.test(effect)) recipients.add(controller);
  if (/\beach opponent\b/i.test(effect)) seatsOtherThan(controller).forEach((seatId) => recipients.add(seatId));
  targets.filter((target) => target.classList.contains("life-total")).forEach((target) => {
    recipients.add(seatOfElement(target));
  });
  recipients.forEach((player) => addPlayerCounter(player, type, amount));
  return [...recipients].map((player) => `${seatSubject(player)} gained ${amount} ${type} counter${amount === 1 ? "" : "s"}`);
}

function updateStunCounterBadge(card) {
  const amount = Number(card.dataset.stunCounters || 0);
  let badge = card.querySelector(".stun-counter-badge");
  if (amount <= 0) {
    badge?.remove();
    delete card.dataset.stunCounters;
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "stun-counter-badge";
    card.append(badge);
  }
  badge.textContent = `Stun ${amount}`;
  badge.title = `${amount} stun counter${amount === 1 ? "" : "s"}`;
}

function addStunCounters(card, amount = 1) {
  card.dataset.stunCounters = String(Number(card.dataset.stunCounters || 0) + amount);
  updateStunCounterBadge(card);
}

function untapPermanent(card) {
  const stunCounters = Number(card.dataset.stunCounters || 0);
  if (stunCounters > 0) {
    card.dataset.stunCounters = String(stunCounters - 1);
    updateStunCounterBadge(card);
    card.classList.add("stun-counter-removed");
    window.setTimeout(() => card.classList.remove("stun-counter-removed"), 520);
    return { untapped: false, stunRemoved: true };
  }
  card.classList.remove("tapped");
  card.querySelectorAll(".mana-choice").forEach((button) => {
    button.disabled = false;
  });
  card.classList.add("untapped-by-effect");
  window.setTimeout(() => card.classList.remove("untapped-by-effect"), 520);
  return { untapped: true, stunRemoved: false };
}

function applyPermanentStateEffects(effect, controller, targets = []) {
  const results = [];
  let creatures = targets.filter((target) => target.classList?.contains("board-card") && target.dataset.typeLine?.includes("Creature"));
  if (/\bcreatures? you control\b/i.test(effect)) {
    creatures = [...document.querySelectorAll(`[data-zone="${controller}-battlefield"] .board-card`)]
      .filter((card) => card.dataset.typeLine.includes("Creature"));
  }
  const stunMatch = effect.match(/(?:put|puts?)\s+(a|an|one|two|three|four|five|\d+)\s+stun counters? on\s+(?:it|target creature)/i);
  if (stunMatch) {
    const amount = counterAmount(stunMatch[1]);
    creatures.forEach((card) => {
      addStunCounters(card, amount);
      results.push(`${targetLabel(card)} gained ${amount} stun counter${amount === 1 ? "" : "s"}`);
    });
  }

  const plusCounterMatch = effect.match(/put\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\+1\/\+1\s+counters?\s+on/i);
  if (plusCounterMatch) {
    const amount = counterAmount(plusCounterMatch[1]);
    creatures.forEach((card) => {
      card.dataset.plusOneCounters = String(Number(card.dataset.plusOneCounters || 0) + amount);
      results.push(`${targetLabel(card)} got ${amount} +1/+1 counter${amount === 1 ? "" : "s"}`);
    });
    if (creatures.length) recalculateStaticAbilities();
  }

  if (/\btap\s+(?:it|that creature|target creature)\b/i.test(effect)) {
    creatures.forEach((card) => {
      card.classList.add("tapped");
      card.querySelectorAll(".mana-choice").forEach((button) => { button.disabled = true; });
      results.push(`${targetLabel(card)} tapped`);
    });
  }

  let untapTargets = [];
  if (/\buntap\s+(?:it|that creature|target creature)\b/i.test(effect)) untapTargets = creatures;
  if (/\buntap\s+(?:all\s+)?creatures? you control\b/i.test(effect)) {
    untapTargets = [...document.querySelectorAll(`[data-zone="${controller}-battlefield"] .board-card[data-type-line*="Creature"]`)];
  }
  [...new Set(untapTargets)].forEach((card) => {
    const result = untapPermanent(card);
    results.push(result.stunRemoved
      ? `${targetLabel(card)} stayed tapped and lost a stun counter`
      : `${targetLabel(card)} untapped`);
  });

  if (/\buntil end of turn\b/i.test(effect)) {
    const statMatch = effect.match(/\bgets?\s+([+-]\d+)\/([+-]\d+)\b/i);
    const supportedKeywords = keywordsWithTrait("grantable");
    const gainedKeywords = supportedKeywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(effect.match(/\bgains?\s+(.+?)\s+until end of turn/i)?.[1] || ""));
    [...new Set(creatures)].forEach((card) => {
      if (statMatch) {
        card.dataset.temporaryPowerModifier = String(Number(card.dataset.temporaryPowerModifier || 0) + Number(statMatch[1]));
        card.dataset.temporaryToughnessModifier = String(Number(card.dataset.temporaryToughnessModifier || 0) + Number(statMatch[2]));
      }
      if (gainedKeywords.length) {
        const temporaryKeywords = new Set(JSON.parse(card.dataset.temporaryKeywords || "[]"));
        gainedKeywords.forEach((keyword) => temporaryKeywords.add(keyword));
        card.dataset.temporaryKeywords = JSON.stringify([...temporaryKeywords]);
      }
      if (statMatch || gainedKeywords.length) {
        card.classList.add("temporary-modified");
        const description = [
          statMatch ? `${statMatch[1]}/${statMatch[2]}` : "",
          gainedKeywords.join(", "),
        ].filter(Boolean).join(" and ");
        results.push(`${targetLabel(card)} gained ${description} until end of turn`);
      }
    });
    if (statMatch || gainedKeywords.length) recalculateStaticAbilities();
  }
  return results;
}

function hideCardHoverPreview() {
  window.clearTimeout(cardHoverTimer);
  cardHoverTimer = null;
  cardHoverPreview.hidden = true;
  cardHoverPreview.classList.remove("visible");
}

function updateGraveyardDisplays() {
  document.querySelectorAll('[data-zone$="graveyard"]').forEach((zone) => {
    const cards = [...zone.querySelectorAll(":scope > .board-card")];
    cards.forEach((card, index) => card.classList.toggle("graveyard-collapsed", cards.length > 1 && index < cards.length - 1));
    zone.querySelector(".zone-count").textContent = String(cards.length);
    const viewButton = zone.querySelector(".view-graveyard");
    viewButton.hidden = cards.length <= 1;
    viewButton.textContent = `View ${cards.length} cards`;
  });
}

/** Exile has no viewer button, just a running count of what's been exiled. */
function updateExileDisplays() {
  document.querySelectorAll('[data-zone$="exile"]').forEach((zone) => {
    const cards = [...zone.querySelectorAll(":scope > .board-card")];
    cards.forEach((card, index) => card.classList.toggle("graveyard-collapsed", cards.length > 1 && index < cards.length - 1));
    zone.querySelector(".zone-count").textContent = String(cards.length);
  });
}

function openGraveyardViewer(zone) {
  const cards = [...zone.querySelectorAll(":scope > .board-card")];
  const zoneRect = zone.getBoundingClientRect();
  graveyardViewer.style.setProperty("--grave-origin-x", `${zoneRect.left + zoneRect.width / 2 - window.innerWidth / 2}px`);
  graveyardViewer.style.setProperty("--grave-origin-y", `${zoneRect.top + zoneRect.height / 2 - window.innerHeight / 2}px`);
  const possessive = seatPossessive(zone.dataset.zone.split("-")[0]);
  graveyardViewerTitle.textContent = `${possessive[0].toUpperCase()}${possessive.slice(1)} graveyard`;
  graveyardViewerCards.replaceChildren();
  cards.forEach((card) => {
    const preview = document.createElement("article");
    preview.className = "graveyard-viewer-card";
    preview.style.setProperty("--card-order", String(graveyardViewerCards.children.length));
    const image = document.createElement("img");
    image.src = card.querySelector("img")?.src || "";
    image.alt = card.dataset.cardName;
    const name = document.createElement("span");
    name.textContent = card.dataset.cardName;
    preview.append(image, name);
    graveyardViewerCards.append(preview);
  });
  graveyardViewer.hidden = false;
  graveyardViewerBackdrop.hidden = false;
  document.body.classList.add("viewing-graveyard");
  closeGraveyardViewerButton.focus();
}

function closeGraveyardViewer() {
  graveyardViewer.hidden = true;
  graveyardViewerBackdrop.hidden = true;
  graveyardViewerCards.replaceChildren();
  document.body.classList.remove("viewing-graveyard");
}

function attachCardHoverPreview(element, imageUrl, cardName) {
  element.addEventListener("mouseenter", () => {
    if (draggedCard || element.classList.contains("dragging") || element.classList.contains("pointer-dragging")) return;
    window.clearTimeout(cardHoverTimer);
    cardHoverTimer = window.setTimeout(() => {
      if (draggedCard || element.classList.contains("dragging") || element.classList.contains("pointer-dragging") || !element.matches(":hover")) return;
      const rect = element.getBoundingClientRect();
      const previewWidth = Math.min(260, window.innerWidth - 28);
      const previewHeight = previewWidth / 0.716;
      const left = rect.left + rect.width / 2 < window.innerWidth / 2
        ? Math.min(window.innerWidth - previewWidth - 14, rect.right + 14)
        : Math.max(14, rect.left - previewWidth - 14);
      const top = Math.max(14, Math.min(window.innerHeight - previewHeight - 14, rect.top + rect.height / 2 - previewHeight / 2));
      cardHoverPreviewImage.src = imageUrl;
      cardHoverPreviewImage.alt = cardName;
      cardHoverPreview.style.left = `${left}px`;
      cardHoverPreview.style.top = `${top}px`;
      cardHoverPreview.style.width = `${previewWidth}px`;
      cardHoverPreview.hidden = false;
      requestAnimationFrame(() => cardHoverPreview.classList.add("visible"));
    }, 1000);
  });
  element.addEventListener("mouseleave", hideCardHoverPreview);
  element.addEventListener("pointerdown", hideCardHoverPreview);
}

function renderManaPool() {
  manaPoolElement.replaceChildren();
  const available = MANA_TYPES.filter((type) => manaPool[type] > 0);
  if (!available.length) {
    manaPoolElement.textContent = "Empty";
    return;
  }
  available.forEach((type) => {
    const entry = document.createElement("span");
    entry.className = "mana-pool-entry";
    entry.innerHTML = `${manaPipHtml(type)}<span>${manaPool[type]}</span>`;
    entry.setAttribute("aria-label", `${manaPool[type]} ${type} mana`);
    manaPoolElement.append(entry);
  });
}

function clearManaPool() {
  MANA_TYPES.forEach((type) => {
    manaPool[type] = 0;
  });
  renderManaPool();
}

/** A mana ability just reads "Add ...", including the parenthesised reminder
    text basic-ish lands print. */
function isManaAbility(ability) {
  return /^\(?\s*add\b/i.test(ability.effect.trim());
}

/**
 * True when clicking the card body should simply tap it for mana: it's a land
 * that produces mana and has nothing to activate except its mana abilities.
 * A land with a real activated ability (a creature-land, a fetchland) returns
 * false so the ability menu still opens.
 */
function landTapsOnlyForMana(card) {
  if (!card.dataset.typeLine.includes("Land")) return false;
  const types = JSON.parse(card.dataset.producedMana || "[]").filter((type) => MANA_TYPES.includes(type));
  if (!types.length) return false;
  return activatedAbilitiesFor(card).every(isManaAbility);
}

/**
 * Dismisses the prompt the moment its land stops being mid-tap — it left the
 * battlefield, something else tapped it, or the board went into edit mode.
 */
function validateManaChoicePrompt() {
  if (!pendingManaChoice) return;
  const { card } = pendingManaChoice;
  const stillTapping = !editingMode
    && card.parentElement?.dataset.zone === "player-battlefield"
    && !card.classList.contains("tapped")
    && landTapsOnlyForMana(card);
  if (!stillTapping) closeManaChoicePrompt();
}

function closeManaChoicePrompt() {
  pendingManaChoice?.card.classList.remove("choosing-mana");
  pendingManaChoice = null;
  manaChoicePrompt.hidden = true;
  manaChoiceOptions.replaceChildren();
}

/** Asks which mana a multi-colour land should produce, then taps it for that. */
function openManaChoicePrompt(card, types) {
  closeManaChoicePrompt();
  pendingManaChoice = { card, types };
  card.classList.add("choosing-mana");
  manaChoiceSource.textContent = `${card.dataset.cardName} taps for one of these.`;
  types.forEach((type) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mana-choice-button";
    button.innerHTML = manaPipHtml(type);
    button.setAttribute("aria-label", `Tap ${card.dataset.cardName} for ${type} mana`);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      closeManaChoicePrompt();
      // addMana taps the land, so nothing happens if the player cancels instead.
      addMana(type, card);
      refreshCardState(card);
    });
    manaChoiceOptions.append(button);
  });
  manaChoicePrompt.hidden = false;
  manaChoiceOptions.querySelector("button")?.focus();
}

function addMana(type, source) {
  if (!MANA_TYPES.includes(type)) return;
  if (source.classList.contains("tapped")) return;
  manaPool[type] += 1;
  source.classList.add("tapped");
  source.querySelectorAll(".mana-choice").forEach((button) => {
    button.disabled = true;
  });
  renderManaPool();
  showMessage(`${source.dataset.cardName} added {${type}}.`, "success");
}

const LAND_EDGE = 8;

/**
 * Stacks every land in a column down the right-hand side of its battlefield.
 *
 * Two things shape the layout. Horizontally, the battlefield gets a padding
 * gutter so creatures never flow underneath the lands; the gutter is a card
 * HEIGHT wide because tapping rotates a card 90deg at full size, which is the
 * widest a land ever gets. Vertically, lands overlap by half a card so the top
 * half of each stays readable, tightening only when there are more lands than
 * the battlefield is tall.
 */
function arrangeLandStacks() {
  document.querySelectorAll('[data-zone$="battlefield"]').forEach((battlefield) => {
    [...battlefield.querySelectorAll(":scope > .board-card")].forEach((card) => {
      const isLand = (card.dataset.typeLine || "").includes("Land");
      card.classList.toggle("side-land", isLand);
      if (!isLand) {
        card.style.removeProperty("--land-stack-index");
        card.style.removeProperty("--land-stack-offset");
      }
    });

    const lands = [...battlefield.querySelectorAll(":scope > .side-land")];
    if (!lands.length) {
      battlefield.style.removeProperty("padding-inline-end");
      battlefield.style.removeProperty("--land-right");
      return;
    }
    const cardWidth = lands[0].offsetWidth || 0;
    const cardHeight = lands[0].offsetHeight || 0;

    // Reserve the tapped footprint so a rotated land stays clear of the creatures.
    const gutter = cardHeight + LAND_EDGE * 2;
    battlefield.style.paddingInlineEnd = `${gutter}px`;
    battlefield.style.setProperty("--land-right", `${(gutter - cardWidth) / 2}px`);

    const idealStep = cardHeight / 2;
    const room = battlefield.clientHeight - LAND_EDGE * 2 - cardHeight;
    const maxStep = lands.length > 1 ? room / (lands.length - 1) : idealStep;
    const step = Math.max(0, Math.min(idealStep, maxStep));

    lands.forEach((land, index) => {
      land.style.setProperty("--land-stack-index", String(index));
      land.style.setProperty("--land-stack-offset", `${index * step}px`);
    });
  });
}

window.addEventListener("resize", arrangeLandStacks);

function untapAllPermanents(announce = true) {
  let stunCountersRemoved = 0;
  const seatId = activeSeat();
  document.querySelectorAll(`[data-zone="${seatId}-battlefield"] .board-card.tapped`).forEach((card) => {
    if (untapPermanent(card).stunRemoved) stunCountersRemoved += 1;
  });
  document.querySelectorAll(`[data-zone="${seatId}-battlefield"] .board-card.summoning-sick`).forEach((card) => {
    if (Number(card.dataset.enteredTurn) < Number(window.currentTurnNumber || 1)) {
      card.classList.remove("summoning-sick");
      card.querySelector(".summoning-sick-badge")?.remove();
    }
  });
  clearManaPool();
  const whose = seatId === HUMAN_SEAT ? "your" : `${seatLabel(seatId)}'s`;
  if (announce) showMessage(stunCountersRemoved
    ? `Untap step: ${stunCountersRemoved} stun counter${stunCountersRemoved === 1 ? " was" : "s were"} removed; those permanents stayed tapped.`
    : `Untap step: all ${whose} permanents untapped.`, "success");
}

function restoreCreaturesAtEndOfTurn() {
  document.querySelectorAll('[data-zone$="battlefield"] .board-card').forEach((card) => {
    if (!card.dataset.typeLine.includes("Creature")) return;
    card.dataset.damageMarked = "0";
    card.dataset.currentPower = card.dataset.basePower;
    card.dataset.currentToughness = card.dataset.baseToughness;
    delete card.dataset.temporaryPowerModifier;
    delete card.dataset.temporaryToughnessModifier;
    delete card.dataset.temporaryKeywords;
    card.classList.remove("temporary-modified");
    card.querySelector(".temporary-effect-badge")?.remove();
    card.querySelector(".damage-badge")?.remove();
    card.classList.add("stats-restored");
    window.setTimeout(() => card.classList.remove("stats-restored"), 520);
  });
  recalculateStaticAbilities();
}

function staticAbilityLines(card) {
  return (card.dataset.oracleText || "").split("\n").map((line) => line.trim()).filter((line) => (
    line
    && !/\b(when|whenever|if)\b/i.test(line)
    && !/^At the beginning/i.test(line)
    && !line.includes(":")
  ));
}

function staticSubjectMatches(card, subject) {
  const normalized = subject.toLowerCase().replace(/\b(other|all)\b/g, "").trim();
  if (/^creatures?$/.test(normalized)) return card.dataset.typeLine.includes("Creature");
  const requiredWords = normalized.split(/\s+/).filter((word) => !["creature", "creatures"].includes(word));
  return card.dataset.typeLine.includes("Creature")
    && requiredWords.every((word) => card.dataset.typeLine.toLowerCase().includes(word.replace(/s$/, "")));
}

function recalculateStaticAbilities() {
  const battlefieldCards = [...document.querySelectorAll('[data-zone$="battlefield"] .board-card')];
  battlefieldCards.forEach((card) => {
    card.dataset.currentPower = card.dataset.basePower;
    card.dataset.currentToughness = card.dataset.baseToughness;
    // +1/+1 counters sit on top of printed stats and outlast end-of-turn cleanup.
    const plusCounters = Number(card.dataset.plusOneCounters || 0);
    if (plusCounters) {
      card.dataset.currentPower = String(Number(card.dataset.basePower || 0) + plusCounters);
      card.dataset.currentToughness = String(Number(card.dataset.baseToughness || 0) + plusCounters);
    }
    card.dataset.grantedKeywords = "[]";
    card.classList.remove("static-modified");
    card.querySelector(".static-stats-badge")?.remove();
    card.querySelector(".plus-counter-badge")?.remove();
    if (plusCounters) {
      const badge = document.createElement("span");
      badge.className = "plus-counter-badge";
      badge.textContent = `+${plusCounters}/+${plusCounters}`;
      badge.title = `${plusCounters} +1/+1 counter${plusCounters === 1 ? "" : "s"}`;
      card.append(badge);
    }
  });

  battlefieldCards.forEach((source) => {
    const sourceController = seatOfElement(source);
    staticAbilityLines(source).forEach((line) => {
      const statMatch = line.match(/^(Other\s+)?(.+?)\s+(you control|your opponents control)\s+get\s+([+-]\d+)\/([+-]\d+)/i);
      const keywordMatch = line.match(new RegExp(`^(Other\\s+)?(.+?)\\s+(you control|your opponents control)\\s+have\\s+(${keywordsWithTrait("grantable").join("|")})\\b`, "i"));
      if (!statMatch && !keywordMatch) return;
      const match = statMatch || keywordMatch;
      const excludesSource = Boolean(match[1]);
      const subject = match[2];
      const affectsOpponents = match[3].toLowerCase().includes("opponents");
      battlefieldCards.forEach((card) => {
        const cardController = seatOfElement(card);
        if (excludesSource && card === source) return;
        if ((affectsOpponents ? cardController === sourceController : cardController !== sourceController) || !staticSubjectMatches(card, subject)) return;
        if (statMatch) {
          card.dataset.currentPower = String(Number(card.dataset.currentPower || 0) + Number(statMatch[4]));
          card.dataset.currentToughness = String(Number(card.dataset.currentToughness || 0) + Number(statMatch[5]));
          card.classList.add("static-modified");
        } else {
          const granted = new Set(JSON.parse(card.dataset.grantedKeywords || "[]"));
          granted.add(keywordMatch[4]);
          card.dataset.grantedKeywords = JSON.stringify([...granted]);
          card.classList.add("static-modified");
        }
      });
    });
  });

  battlefieldCards.forEach((card) => {
    const temporaryPower = Number(card.dataset.temporaryPowerModifier || 0);
    const temporaryToughness = Number(card.dataset.temporaryToughnessModifier || 0);
    const temporaryKeywords = JSON.parse(card.dataset.temporaryKeywords || "[]");
    if (temporaryPower || temporaryToughness) {
      card.dataset.currentPower = String(Number(card.dataset.currentPower || 0) + temporaryPower);
      card.dataset.currentToughness = String(Number(card.dataset.currentToughness || 0) + temporaryToughness);
    }
    if (temporaryKeywords.length) {
      const granted = new Set(JSON.parse(card.dataset.grantedKeywords || "[]"));
      temporaryKeywords.forEach((keyword) => granted.add(keyword));
      card.dataset.grantedKeywords = JSON.stringify([...granted]);
    }
    card.classList.toggle("temporary-modified", Boolean(temporaryPower || temporaryToughness || temporaryKeywords.length));
  });

  battlefieldCards.forEach((card) => {
    const enteredThisTurn = Number(card.dataset.enteredTurn || 0) >= Number(window.currentTurnNumber || 1);
    const shouldBeSummoningSick = card.dataset.typeLine.includes("Creature") && enteredThisTurn && !cardKeywordTrait(card, "ignoresSummoningSickness");
    card.classList.toggle("summoning-sick", shouldBeSummoningSick);
    const existingSicknessBadge = card.querySelector(".summoning-sick-badge");
    if (!shouldBeSummoningSick) existingSicknessBadge?.remove();
    else if (!existingSicknessBadge) {
      const badge = document.createElement("span");
      badge.className = "summoning-sick-badge";
      badge.textContent = "Summoning sick";
      badge.title = "This creature cannot attack until your next turn.";
      card.append(badge);
    }
    if (card.classList.contains("static-modified") && card.dataset.typeLine.includes("Creature")) {
      const badge = document.createElement("span");
      badge.className = "static-stats-badge";
      badge.textContent = `${card.dataset.currentPower}/${card.dataset.currentToughness}`;
      badge.title = "Current power and toughness after static abilities";
      card.append(badge);
    }
    updateKeywordBadge(card);
    card.querySelector(".temporary-effect-badge")?.remove();
    if (card.classList.contains("temporary-modified")) {
      const temporaryPower = Number(card.dataset.temporaryPowerModifier || 0);
      const temporaryToughness = Number(card.dataset.temporaryToughnessModifier || 0);
      const temporaryKeywords = JSON.parse(card.dataset.temporaryKeywords || "[]");
      const badge = document.createElement("span");
      badge.className = "temporary-effect-badge";
      badge.textContent = [
        temporaryPower || temporaryToughness ? `${temporaryPower >= 0 ? "+" : ""}${temporaryPower}/${temporaryToughness >= 0 ? "+" : ""}${temporaryToughness}` : "",
        temporaryKeywords.join(", "),
      ].filter(Boolean).join(" · ");
      badge.title = "Temporary effect until end of turn";
      card.append(badge);
    }
    if (card.dataset.typeLine.includes("Creature") && Number(card.dataset.currentToughness) <= 0 && !card.classList.contains("static-lethal-pending")) {
      card.classList.add("static-lethal-pending");
      sendLethalCreatureToGraveyard(card);
    }
  });
  document.querySelectorAll('[data-zone="player-hand"] .board-card, [data-zone="player-graveyard"] .board-card').forEach((card) => {
    const printedCost = card.parentElement.dataset.zone === "player-graveyard" ? flashbackCostFor(card) : card.dataset.manaCost;
    card.dataset.effectiveManaCost = printedCost ? effectiveSpellCost(card, printedCost) : "";
  });
}

function combatTargetLabel(target) {
  return target.classList.contains("life-total") ? seatLabel(seatOfElement(target)) : target.dataset.cardName;
}

/** The seat that would take the damage if this attack goes unblocked. */
function defendingSeatOf(target) {
  return seatOfElement(target);
}

function updateCombatButton() {
  if (window.currentTurnPhase !== "Combat phase" || combatResolved || !combatAssignments.size) {
    nextPhaseButton.disabled = false;
    nextPhaseButton.innerHTML = 'Next phase <span aria-hidden="true">→</span>';
    return;
  }
  nextPhaseButton.textContent = `Finish attackers (${combatAssignments.size})`;
}

function clearCombatTargetPrompt() {
  pendingAttacker?.classList.remove("choosing-attack-target");
  pendingAttacker = null;
  combatPrompt.hidden = true;
  combatTargetOptions.replaceChildren();
  document.querySelectorAll(".legal-combat-target").forEach((target) => target.classList.remove("legal-combat-target"));
}

/**
 * Anyone but the attacking seat is a legal defender: each rival's life total,
 * plus any planeswalker they control.
 */
function combatTargets(attackingSeat = HUMAN_SEAT) {
  return seatsOtherThan(attackingSeat).flatMap((seatId) => [
    seatLifeTotal(seatId),
    ...document.querySelectorAll(`[data-zone="${seatId}-battlefield"] .board-card[data-type-line*="Planeswalker"]`),
  ]).filter(Boolean);
}

function chooseAttackerTarget(attacker) {
  clearCombatTargetPrompt();
  pendingAttacker = attacker;
  attacker.classList.add("choosing-attack-target");
  combatAttackerName.textContent = `${attacker.dataset.cardName} (${attacker.dataset.currentPower || attacker.dataset.basePower || "?"} power)`;
  combatTargetOptions.replaceChildren();
  combatTargets(controllerOf(attacker)).forEach((target) => {
    target.classList.add("legal-combat-target");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = combatTargetLabel(target);
    button.addEventListener("click", () => {
      combatAssignments.set(attacker, target);
      attacker.classList.remove("choosing-attack-target");
      attacker.classList.add("declared-attacker");
      attacker.dataset.attackTarget = combatTargetLabel(target);
      clearCombatTargetPrompt();
      updateCombatButton();
      showMessage(`${attacker.dataset.cardName} will attack ${combatTargetLabel(target)}.`, "success");
    });
    combatTargetOptions.append(button);
  });
  combatPrompt.hidden = false;
}

/** A creature can be declared as an attacker if it is awake, untapped and willing. */
function canDeclareAsAttacker(card) {
  const enteredThisTurn = Number(card.dataset.enteredTurn || 0) >= Number(window.currentTurnNumber || 1)
    && !cardKeywordTrait(card, "ignoresSummoningSickness");
  return card.dataset.typeLine.includes("Creature")
    && !card.classList.contains("tapped")
    && !enteredThisTurn
    && !cardKeywordTrait(card, "cannotAttack")
    && !/\bcan(?:not|'t) attack\b/i.test(card.dataset.oracleText || "");
}

function beginCombatDeclaration() {
  combatAssignments = new Map();
  combatResolved = false;
  clearCombatTargetPrompt();
  const attackingSeat = activeSeat();
  document.querySelectorAll(`[data-zone="${attackingSeat}-battlefield"] .board-card`).forEach((card) => {
    const enteredThisTurn = Number(card.dataset.enteredTurn || 0) >= Number(window.currentTurnNumber || 1)
      && !cardKeywordTrait(card, "ignoresSummoningSickness");
    card.classList.toggle("summoning-sick", card.dataset.typeLine.includes("Creature") && enteredThisTurn);
    card.classList.toggle("combat-eligible", canDeclareAsAttacker(card));
  });
  updateCombatButton();
  if (isAiSeat(attackingSeat)) {
    declareAiAttackers(attackingSeat);
    return;
  }
  showMessage("Declare attackers: select an untapped creature, then choose what it attacks.");
}

function cleanupCombat() {
  clearCombatTargetPrompt();
  document.querySelectorAll(".combat-eligible, .declared-attacker, .choosing-attack-target, .blocked-attacker, .declared-blocker").forEach((card) => {
    card.classList.remove("combat-eligible", "declared-attacker", "choosing-attack-target", "blocked-attacker", "declared-blocker");
    delete card.dataset.attackTarget;
    delete card.dataset.blockedBy;
    delete card.dataset.blocking;
  });
  combatAssignments = new Map();
  combatResolved = false;
  updateCombatButton();
}

function damagePlaneswalker(target, amount) {
  const startingLoyalty = Number(target.dataset.currentLoyalty || target.dataset.baseLoyalty);
  if (!Number.isFinite(startingLoyalty)) return;
  const remaining = Math.max(0, startingLoyalty - amount);
  target.dataset.currentLoyalty = String(remaining);
  let badge = target.querySelector(".loyalty-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "loyalty-badge";
    target.append(badge);
  }
  badge.textContent = `${remaining} loyalty`;
  if (remaining === 0) {
    target.classList.add("creature-dying");
    window.setTimeout(() => {
      document.querySelector(`[data-zone="${restingZoneFor(target, controllerOf(target))}"]`).append(target);
      target.classList.remove("creature-dying");
      refreshCardState(target);
    }, 720);
  }
}

function creatureCombatStats(card) {
  const power = Number(card.dataset.currentPower || card.dataset.basePower);
  const toughness = Number(card.dataset.currentToughness || card.dataset.baseToughness);
  const markedDamage = Number(card.dataset.damageMarked || 0);
  return {
    power: Number.isFinite(power) ? power : 0,
    toughness: Number.isFinite(toughness) ? toughness : 0,
    remainingToughness: Number.isFinite(toughness) ? toughness - markedDamage : 0,
  };
}

function chooseBestBlocker(attacker, availableBlockers) {
  const attackerStats = creatureCombatStats(attacker);
  const attackerDeathtouch = cardKeywordTrait(attacker, "lethalOnAnyDamage");
  return [...availableBlockers].sort((left, right) => {
    const leftStats = creatureCombatStats(left);
    const rightStats = creatureCombatStats(right);
    const rank = (stats, blocker) => {
      const killsAttacker = cardKeywordTrait(attacker, "indestructible")
        ? false
        : stats.power >= attackerStats.remainingToughness
          || (stats.power > 0 && cardKeywordTrait(blocker, "lethalOnAnyDamage"));
      const survivesAttacker = cardKeywordTrait(blocker, "indestructible")
        || (stats.remainingToughness > attackerStats.power && !(attackerDeathtouch && attackerStats.power > 0));
      if (killsAttacker && survivesAttacker) return 0;
      if (killsAttacker) return 1;
      if (survivesAttacker) return 2;
      return 3;
    };
    return rank(leftStats, left) - rank(rightStats, right)
      || leftStats.power + leftStats.toughness - (rightStats.power + rightStats.toughness);
  })[0] || null;
}

/** Untapped creatures a seat could still put in front of an attacker. */
function blockerPoolFor(seatId) {
  return [...document.querySelectorAll(`[data-zone="${seatId}-battlefield"] .board-card`)]
    .filter((card) => card.dataset.typeLine.includes("Creature") && !card.classList.contains("tapped"));
}

/** A block is worth making if the blocker kills the attacker or lives through it. */
function blockIsProfitable(attacker, blocker) {
  const attackerStats = creatureCombatStats(attacker);
  const blockerStats = creatureCombatStats(blocker);
  const killsAttacker = !cardKeywordTrait(attacker, "indestructible")
    && (blockerStats.power >= attackerStats.remainingToughness
      || (blockerStats.power > 0 && cardKeywordTrait(blocker, "lethalOnAnyDamage")));
  const survives = cardKeywordTrait(blocker, "indestructible")
    || (blockerStats.remainingToughness > attackerStats.power
      && !(cardKeywordTrait(attacker, "lethalOnAnyDamage") && attackerStats.power > 0));
  return killsAttacker || survives;
}

/** Chump blocking spends the least valuable body available. */
function cheapestBlocker(availableBlockers) {
  return [...availableBlockers].sort((left, right) => {
    const leftStats = creatureCombatStats(left);
    const rightStats = creatureCombatStats(right);
    return (leftStats.power + leftStats.toughness) - (rightStats.power + rightStats.toughness);
  })[0] || null;
}

/**
 * Blocks are attacker → blockers[], since menace forces multi-creature blocks.
 * Attackers are grouped by the seat they are attacking, and each defending seat
 * blocks in whatever style its behavior settings call for. The human's seat
 * blocks with the best available trade.
 */
function declareAutomaticBlockers() {
  const blocks = new Map();
  const attackersByDefender = new Map();
  combatAssignments.forEach((target, attacker) => {
    const seatId = defendingSeatOf(target);
    if (!attackersByDefender.has(seatId)) attackersByDefender.set(seatId, []);
    attackersByDefender.get(seatId).push(attacker);
  });

  attackersByDefender.forEach((attackers, seatId) => {
    const style = isAiSeat(seatId) ? behaviorFor(seatId).blockStyle : "best";
    if (style === "never") return;
    const available = new Set(blockerPoolFor(seatId));
    // A chump blocker wants to stop the biggest attacker first.
    const order = style === "chump"
      ? [...attackers].sort((left, right) => creatureCombatStats(right).power - creatureCombatStats(left).power)
      : attackers;
    order.forEach((attacker) => {
      if (!available.size) return;
      const required = blockersRequiredFor(attacker);
      const legalBlockers = [...available].filter((blocker) => canBlockAttacker(blocker, attacker));
      if (legalBlockers.length < required) return;
      const chosen = [];
      while (chosen.length < required) {
        const pool = legalBlockers.filter((candidate) => !chosen.includes(candidate));
        const blocker = style === "chump" ? cheapestBlocker(pool) : chooseBestBlocker(attacker, pool);
        if (!blocker) break;
        if (style === "profitable" && !blockIsProfitable(attacker, blocker)) break;
        chosen.push(blocker);
      }
      // Menace and friends mean a partial block is no block at all.
      if (chosen.length < required) return;
      blocks.set(attacker, chosen);
      attacker.classList.add("blocked-attacker");
      attacker.dataset.blockedBy = chosen.map((blocker) => blocker.dataset.cardName).join(", ");
      chosen.forEach((blocker) => {
        available.delete(blocker);
        blocker.classList.add("declared-blocker");
        blocker.dataset.blocking = attacker.dataset.cardName;
      });
    });
  });
  return blocks;
}

function showDeclaredBlockers(blocks) {
  const defenders = [...new Set([...combatAssignments.values()].map(defendingSeatOf))];
  combatPrompt.hidden = false;
  combatPrompt.querySelector("strong").textContent = defenders.length === 1
    ? `${seatLabel(defenders[0])} declared blockers`
    : "Blockers declared";
  combatAttackerName.textContent = blocks.size
    ? "Blocked creatures will exchange combat damage."
    : "No creatures were available to block.";
  combatTargetOptions.replaceChildren();
  if (!blocks.size) return;
  blocks.forEach((blockers, attacker) => {
    const assignment = document.createElement("span");
    assignment.className = "block-assignment";
    assignment.textContent = `${blockers.map((blocker) => blocker.dataset.cardName).join(" and ")} block${blockers.length > 1 ? "" : "s"} ${attacker.dataset.cardName}`;
    combatTargetOptions.append(assignment);
  });
}

function adjustPlayerLife(who, delta) {
  const input = seatSection(who)?.querySelector(".life-input");
  if (!input) return;
  input.value = String(Math.max(0, Number(input.value || 0) + delta));
}

/** Marks damage on a creature and records whether deathtouch/toughness made it lethal. */
function markCombatDamage(source, target, amount, state) {
  if (amount <= 0) return;
  target.dataset.damageMarked = String(Number(target.dataset.damageMarked || 0) + amount);
  updateCreatureDamageBadge(target);
  const { toughness } = creatureCombatStats(target);
  const lethal = cardKeywordTrait(source, "lethalOnAnyDamage")
    || Number(target.dataset.damageMarked || 0) >= toughness;
  if (lethal && !cardKeywordTrait(target, "indestructible")) {
    state.lethal.add(target);
    state.alive.delete(target);
  }
}

/**
 * Splits an attacker's power across its blockers, lethal-damage-first. Deathtouch
 * makes 1 damage lethal, and trample lets whatever is left over spill onto the
 * defending player or planeswalker.
 */
function assignAttackerDamage(attacker, blockers) {
  const deathtouch = cardKeywordTrait(attacker, "lethalOnAnyDamage");
  const trample = cardKeywordTrait(attacker, "tramplesOver");
  const events = [];
  let remaining = creatureCombatStats(attacker).power;
  blockers.forEach((blocker, index) => {
    if (remaining <= 0) return;
    const lethalNeeded = deathtouch ? 1 : Math.max(1, creatureCombatStats(blocker).remainingToughness);
    // Without trample the excess has nowhere to go, so the last blocker soaks it.
    const isLast = index === blockers.length - 1;
    const assigned = !trample && isLast ? remaining : Math.min(remaining, lethalNeeded);
    remaining -= assigned;
    events.push({ source: attacker, target: blocker, amount: assigned });
  });
  return { events, trampleDamage: trample ? remaining : 0 };
}

function resolveCombatDamage(blocks) {
  const attackers = [...combatAssignments.keys()];
  const blockerList = [...blocks.values()].flat();
  const state = {
    alive: new Set([...attackers, ...blockerList]),
    lethal: new Set(),
    lifeGain: Object.fromEntries(seatIds().map((seatId) => [seatId, 0])),
  };
  // Combat can hit several seats at once, so damage to players is tallied per seat.
  const damageBySeat = Object.fromEntries(seatIds().map((seatId) => [seatId, 0]));

  attackers.forEach((attacker) => {
    attacker.classList.add("attacking-animation");
    if (!cardKeywordTrait(attacker, "attacksWithoutTapping")) attacker.classList.add("tapped");
  });
  blockerList.forEach((blocker) => blocker.classList.add("blocking-animation"));

  // First strike and double strike split combat into two damage steps; anything
  // that dies in the first step never deals its regular-step damage.
  const anyFirstStrike = [...attackers, ...blockerList].some((card) => damageStepsFor(card).includes("first"));
  const steps = anyFirstStrike ? ["first", "regular"] : ["regular"];

  steps.forEach((step) => {
    const creatureDamage = [];
    const playerDamage = [];

    attackers.forEach((attacker) => {
      if (!state.alive.has(attacker) || !damageStepsFor(attacker).includes(step)) return;
      const target = combatAssignments.get(attacker);
      if (!blocks.has(attacker)) {
        playerDamage.push({ source: attacker, target, amount: creatureCombatStats(attacker).power });
        return;
      }
      const survivors = blocks.get(attacker).filter((blocker) => state.alive.has(blocker));
      const { events, trampleDamage } = assignAttackerDamage(attacker, survivors);
      creatureDamage.push(...events);
      if (trampleDamage > 0) playerDamage.push({ source: attacker, target, amount: trampleDamage });
    });

    blocks.forEach((blockers, attacker) => {
      blockers.forEach((blocker) => {
        if (!state.alive.has(blocker) || !damageStepsFor(blocker).includes(step)) return;
        if (!state.alive.has(attacker)) return;
        creatureDamage.push({ source: blocker, target: attacker, amount: creatureCombatStats(blocker).power });
      });
    });

    // Damage within a step is simultaneous: total it up before anything dies.
    [...creatureDamage, ...playerDamage].forEach((event) => {
      if (event.amount > 0 && cardKeywordTrait(event.source, "lifelink")) {
        const gainer = controllerOf(event.source);
        state.lifeGain[gainer] = (state.lifeGain[gainer] || 0) + event.amount;
      }
    });
    creatureDamage.forEach((event) => markCombatDamage(event.source, event.target, event.amount, state));
    playerDamage.forEach((event) => {
      if (event.amount <= 0) return;
      if (event.target.classList.contains("life-total")) {
        const defender = defendingSeatOf(event.target);
        damageBySeat[defender] = (damageBySeat[defender] || 0) + event.amount;
      }
      else damagePlaneswalker(event.target, event.amount);
    });
    [...creatureDamage, ...playerDamage].forEach((event) => {
      if (event.amount > 0) emitGameEvent("damage", { card: event.source, targets: [event.target], damage: event.amount });
    });
  });

  Object.entries(damageBySeat).forEach(([who, amount]) => {
    if (amount > 0) adjustPlayerLife(who, -amount);
  });
  Object.entries(state.lifeGain).forEach(([who, amount]) => {
    if (amount > 0) adjustPlayerLife(who, amount);
  });
  state.lethal.forEach(sendLethalCreatureToGraveyard);
  combatResolved = true;
  combatPrompt.hidden = true;
  document.querySelectorAll(".combat-eligible").forEach((card) => card.classList.remove("combat-eligible"));
  window.setTimeout(() => {
    document.querySelectorAll(".attacking-animation, .blocking-animation").forEach((card) => {
      card.classList.remove("attacking-animation", "blocking-animation");
    });
  }, 650);
  updateCombatButton();
  const summary = [
    ...Object.entries(damageBySeat)
      .filter(([, amount]) => amount > 0)
      .map(([who, amount]) => `${amount} damage to ${who === HUMAN_SEAT ? "you" : seatLabel(who)}`),
    ...Object.entries(state.lifeGain)
      .filter(([, amount]) => amount > 0)
      .map(([who, amount]) => `${seatSubject(who)} gained ${amount} life`),
    state.lethal.size ? `${state.lethal.size} creature${state.lethal.size === 1 ? "" : "s"} died` : "",
  ].filter(Boolean);
  showMessage(
    `Combat damage resolved${summary.length ? `: ${summary.join(", ")}` : blocks.size ? ": blocked creatures exchanged damage" : ""}.`,
    "success",
  );
  // A computer seat carries its own turn forward once combat has settled.
  if (isAiSeat(activeSeat()) && !editingMode) {
    nextPhaseButton.disabled = false;
    scheduleAiStep(() => window.advancePhase());
  }
}

window.finishCombatAttackers = function finishCombatAttackers() {
  if (!combatAssignments.size || combatResolved) return false;
  clearCombatTargetPrompt();
  combatResolved = true;
  combatAssignments.forEach((_target, attacker) => emitGameEvent("attacks", { card: attacker }));
  const blocks = declareAutomaticBlockers();
  showDeclaredBlockers(blocks);
  const defenders = [...new Set([...combatAssignments.values()].map(defendingSeatOf))];
  nextPhaseButton.disabled = true;
  nextPhaseButton.textContent = defenders.length === 1 && defenders[0] === HUMAN_SEAT
    ? "Blocking…"
    : `${defenders.length === 1 ? seatLabel(defenders[0]) : "Defenders"} blocking…`;
  window.setTimeout(() => resolveCombatDamage(blocks), 760);
  return true;
};


/* ---------------------------------------------------------------------------
 * Turn order and computer seats
 *
 * Every seat takes a full turn through all seven phases. Puzzles are built to be
 * solved on the human's turn, so in practice the AI turns rarely come up — but
 * when they do the table plays on around the seats in order.
 * ------------------------------------------------------------------------- */

const AI_STEP_DELAY = 850;
let aiTurnTimer = null;

function activeSeat() {
  const seatId = window.currentTurnSeat || HUMAN_SEAT;
  return seatExists(seatId) ? seatId : HUMAN_SEAT;
}

/** Turn order runs around the table: the human first, then each AI seat. */
window.nextSeatInTurnOrder = function nextSeatInTurnOrder(seatId) {
  const order = seatIds();
  const index = order.indexOf(seatId);
  if (index < 0) return HUMAN_SEAT;
  return order[(index + 1) % order.length];
};

/** The turn number only ticks over when play comes back around to the human. */
window.seatStartsNewRound = function seatStartsNewRound(_previousSeat, nextSeat) {
  return nextSeat === HUMAN_SEAT;
};

window.seatTurnLabel = function seatTurnLabel(seatId) {
  return seatId === HUMAN_SEAT ? "Your turn" : `${seatLabel(seatId)}'s turn`;
};

/** Lights up the turn marker on whichever seat is currently taking its turn. */
function paintSeatTurnMarkers() {
  const current = activeSeat();
  seatIds().forEach((seatId) => {
    const section = seatSection(seatId);
    if (!section) return;
    section.classList.toggle("seat-taking-turn", seatId === current);
    section.querySelector(".turn-marker")?.classList.toggle("active", seatId === current);
  });
  const humanEyebrow = seatSection(HUMAN_SEAT)?.querySelector(".eyebrow");
  if (humanEyebrow) humanEyebrow.textContent = current === HUMAN_SEAT ? "You · Your turn" : "You · Waiting";
}

function clearAiTurnTimer() {
  window.clearTimeout(aiTurnTimer);
  aiTurnTimer = null;
}

function scheduleAiStep(action, delay = AI_STEP_DELAY) {
  clearAiTurnTimer();
  aiTurnTimer = window.setTimeout(action, delay);
}

/** Untapped lands are the only mana an AI seat can count on. */
function untappedLandsFor(seatId) {
  return [...document.querySelectorAll(`[data-zone="${seatId}-battlefield"] .board-card`)]
    .filter((card) => card.dataset.typeLine.includes("Land") && !card.classList.contains("tapped"));
}

/**
 * AI seats do not use the mana pool — it belongs to the human's console — so
 * affordability is approximated by counting untapped lands against the card's
 * total mana value. Good enough for the boards these puzzles set up.
 */
function manaValueOf(cost) {
  return parseCost(cost).reduce((total, symbol) => {
    const generic = Number(symbol);
    return total + (Number.isFinite(generic) ? generic : 1);
  }, 0);
}

function aiPlaysLand(seatId) {
  const hand = seatZone(seatId, "hand");
  const land = [...hand.querySelectorAll(":scope > .board-card")]
    .find((card) => card.dataset.typeLine.includes("Land"));
  if (!land) return false;
  seatZone(seatId, "battlefield").append(land);
  refreshCardState(land);
  emitGameEvent("permanent-enter", { card: land, controller: seatId });
  showMessage(`${seatLabel(seatId)} played ${land.dataset.cardName}.`);
  return true;
}

/** Casts whatever the seat can pay for, biggest first, tapping lands to do it. */
function aiCastsFromHand(seatId) {
  const hand = seatZone(seatId, "hand");
  const battlefield = seatZone(seatId, "battlefield");
  const castable = [...hand.querySelectorAll(":scope > .board-card")]
    .filter((card) => !card.dataset.typeLine.includes("Land") && card.dataset.typeLine.includes("Creature"))
    .sort((left, right) => manaValueOf(right.dataset.manaCost) - manaValueOf(left.dataset.manaCost));
  let cast = 0;
  castable.forEach((card) => {
    const available = untappedLandsFor(seatId);
    const cost = manaValueOf(card.dataset.manaCost);
    if (!cost || cost > available.length) return;
    available.slice(0, cost).forEach((land) => {
      land.classList.add("tapped");
      refreshCardState(land);
    });
    battlefield.append(card);
    if (!cardHasHaste(card)) card.dataset.enteredTurn = String(window.currentTurnNumber || 1);
    refreshCardState(card);
    emitGameEvent("permanent-enter", { card, controller: seatId });
    cast += 1;
  });
  if (cast) showMessage(`${seatLabel(seatId)} cast ${cast} creature${cast === 1 ? "" : "s"}.`);
  return cast > 0;
}

function aiDrawsCard(seatId) {
  const library = seatZone(seatId, "library");
  const topCard = library.querySelector(":scope > .board-card:last-of-type");
  if (!topCard) return false;
  seatZone(seatId, "hand").append(topCard);
  refreshCardState(topCard);
  return true;
}

/** Ranks the seats this one is willing to attack, best target first. */
function aiAttackTargets(seatId) {
  const behavior = behaviorFor(seatId);
  const rivals = seatsOtherThan(seatId);
  if (behavior.attackTarget === "none" || !rivals.length) return [];
  if (behavior.attackTarget === "player") return rivals.includes(HUMAN_SEAT) ? [HUMAN_SEAT] : rivals;
  if (behavior.attackTarget === "random") return [rivals[Math.floor(Math.random() * rivals.length)]];
  // "Weakest" and "strongest" score a seat by its life plus the bodies it can
  // put in the way, so an open board reads as a softer target than a defended one.
  const score = (rival) => seatLifeValue(rival) + blockerPoolFor(rival).length * 2;
  const ranked = [...rivals].sort((left, right) => score(left) - score(right));
  return behavior.attackTarget === "strongest" ? ranked.reverse() : ranked;
}

/** An attack is worth making if nothing the defender has can profitably stop it. */
function aiAttackIsSafe(attacker, defendingSeat) {
  return !blockerPoolFor(defendingSeat).some((blocker) => (
    canBlockAttacker(blocker, attacker) && blockIsProfitable(attacker, blocker)
  ));
}

function declareAiAttackers(seatId) {
  const behavior = behaviorFor(seatId);
  const [defendingSeat] = aiAttackTargets(seatId);
  const eligible = [...document.querySelectorAll(`[data-zone="${seatId}-battlefield"] .board-card.combat-eligible`)];

  if (behavior.attackWith === "none" || !defendingSeat || !eligible.length) {
    showMessage(`${seatLabel(seatId)} did not attack.`);
    scheduleAiStep(() => window.advancePhase());
    return;
  }

  const target = seatLifeTotal(defendingSeat);
  const attacking = behavior.attackWith === "profitable"
    ? eligible.filter((attacker) => aiAttackIsSafe(attacker, defendingSeat))
    : eligible;

  if (!attacking.length) {
    showMessage(`${seatLabel(seatId)} held its creatures back.`);
    scheduleAiStep(() => window.advancePhase());
    return;
  }

  attacking.forEach((attacker) => {
    combatAssignments.set(attacker, target);
    attacker.classList.add("declared-attacker");
    attacker.dataset.attackTarget = combatTargetLabel(target);
  });
  updateCombatButton();
  showMessage(
    `${seatLabel(seatId)} attacks ${defendingSeat === HUMAN_SEAT ? "you" : seatLabel(defendingSeat)} with ${attacking.length} creature${attacking.length === 1 ? "" : "s"}.`,
    "error",
  );
  // Hand off to the shared combat pipeline, which declares blockers for the
  // defending seat and resolves damage, then carries the turn forward.
  scheduleAiStep(() => {
    if (!window.finishCombatAttackers()) window.advancePhase();
  });
}

/** Runs the active AI seat's business for the phase it just entered. */
function runAiPhase(seatId, phase) {
  const behavior = behaviorFor(seatId);
  switch (phase) {
    case "Draw":
      if (behavior.drawStep === "draw" && aiDrawsCard(seatId)) {
        showMessage(`${seatLabel(seatId)} drew a card.`);
      }
      scheduleAiStep(() => window.advancePhase());
      break;
    case "Main phase 1":
      if (behavior.mainPhase !== "pass") aiPlaysLand(seatId);
      if (behavior.mainPhase === "landCast") aiCastsFromHand(seatId);
      scheduleAiStep(() => window.advancePhase());
      break;
    case "Main phase 2":
      // A second look, in case combat freed up mana or the first main was skipped.
      if (behavior.mainPhase === "landCast") aiCastsFromHand(seatId);
      scheduleAiStep(() => window.advancePhase());
      break;
    case "Combat phase":
      // beginCombatDeclaration already routed this seat into declareAiAttackers.
      break;
    default:
      scheduleAiStep(() => window.advancePhase());
  }
}

/* ---------------------------------------------------------------------------
 * Behavior settings
 *
 * A computer seat does not improvise: the board author decides in edit mode who
 * it attacks, what it attacks with, how it blocks, and what it does with its
 * main phases. Those choices are what runAiPhase reads on the seat's own turn.
 * ------------------------------------------------------------------------- */

let behaviorSeatId = null;

function openSeatBehavior(seatId) {
  if (!editingMode || !seatExists(seatId)) return;
  behaviorSeatId = seatId;
  const behavior = behaviorFor(seatId);
  seatBehaviorTitle.textContent = `${seatLabel(seatId)} · behavior`;
  seatBehaviorForm.elements.label.value = seatLabel(seatId);
  Object.entries(behavior).forEach(([field, value]) => {
    if (seatBehaviorForm.elements[field]) seatBehaviorForm.elements[field].value = value;
  });
  seatBehaviorPanel.hidden = false;
  seatBehaviorBackdrop.hidden = false;
  window.setTimeout(() => seatBehaviorForm.elements.label.focus(), 80);
}

function closeSeatBehavior() {
  behaviorSeatId = null;
  seatBehaviorPanel.hidden = true;
  seatBehaviorBackdrop.hidden = true;
}

/** Settings apply as they are changed — there is nothing to submit. */
function saveSeatBehaviorFromForm() {
  if (!behaviorSeatId) return;
  const behavior = behaviorFor(behaviorSeatId);
  Object.keys(DEFAULT_SEAT_BEHAVIOR).forEach((field) => {
    const control = seatBehaviorForm.elements[field];
    if (control) behavior[field] = control.value;
  });
  // An empty name falls back to the seat's positional default.
  behavior.label = seatBehaviorForm.elements.label.value.trim();
  refreshSeatLabels();
  seatBehaviorTitle.textContent = `${seatLabel(behaviorSeatId)} · behavior`;
}

function openImporter() {
  if (!editingMode) return;
  importer.drawer.setAttribute("aria-hidden", "false");
  importer.backdrop.hidden = false;
  document.body.classList.add("drawer-open");
  window.setTimeout(() => importer.query.focus(), 80);
}

function closeImporter() {
  importer.drawer.setAttribute("aria-hidden", "true");
  importer.backdrop.hidden = true;
  document.body.classList.remove("drawer-open");
}

function setEditingMode(enabled) {
  closeManaChoicePrompt();
  if (enabled && activeAbilitySource) closeActivatedAbilityMenu();
  editingMode = enabled;
  document.body.classList.toggle("editing-mode", enabled);
  importer.editToggle.setAttribute("aria-pressed", String(enabled));
  importer.editToggle.innerHTML = enabled
    ? '<span aria-hidden="true">✓</span> Done editing'
    : '<span aria-hidden="true">✦</span> Edit board';
  importer.trigger.disabled = !enabled;
  saveManagerTrigger.disabled = !enabled;
  clearBoardButton.disabled = !enabled;
  importer.editBanner.hidden = !enabled;
  syncSeatControls();
  allLifeInputs().forEach((input) => {
    input.disabled = !enabled;
  });
  allLifeAdjustButtons().forEach((button) => {
    button.disabled = !enabled;
  });
  document.querySelectorAll(".board-card").forEach(refreshCardState);

  if (!enabled) {
    cancelPlacement();
    if (importer.drawer.getAttribute("aria-hidden") === "false") closeImporter();
    closeSaveManager();
    closeSeatBehavior();
  }
}

function readBoardSaves() {
  try {
    const saves = JSON.parse(localStorage.getItem(SAVE_STORAGE_KEY) || "[]");
    return Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => saves[index] || null);
  } catch (_error) {
    return Array(SAVE_SLOT_COUNT).fill(null);
  }
}

function writeBoardSaves(saves) {
  localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(saves));
}

function serializeBoardCard(card) {
  return {
    data: { ...card.dataset },
    image: card.querySelector("img")?.src || "",
    classes: ["tapped", "summoning-sick"].filter((name) => card.classList.contains(name)),
  };
}

/**
 * Life and counters are keyed by seat rather than by position so a save survives
 * seats being added or removed. `life` and `counters` are still written as flat
 * arrays for saves made before multiplayer, which loadBoardState falls back to.
 */
function captureBoardState() {
  return {
    savedAt: new Date().toISOString(),
    phase: window.currentTurnPhase || "Untap",
    turnNumber: window.currentTurnNumber || 1,
    turnSeat: activeSeat(),
    aiSeats: aiSeatIds(),
    seats: Object.fromEntries(seatIds().map((seatId) => {
      const section = seatSection(seatId);
      return [seatId, {
        label: seatLabel(seatId),
        life: section?.querySelector(".life-input")?.value ?? "20",
        counters: Object.fromEntries([...section.querySelectorAll(".player-counter")]
          .map((counter) => [counter.dataset.counter, Number(counter.dataset.value || 0)])),
        behavior: isAiSeat(seatId) ? { ...behaviorFor(seatId) } : null,
      }];
    })),
    life: allLifeInputs().map((input) => input.value),
    counters: allPlayerCounters().map((counter) => Number(counter.dataset.value || 0)),
    zones: Object.fromEntries(allZones().map((zone) => [
      zone.dataset.zone,
      [...zone.querySelectorAll(":scope > .board-card")].map(serializeBoardCard),
    ])),
  };
}

function savedCardToScryfall(record) {
  return {
    id: record.data.cardId,
    name: record.data.cardName,
    mana_cost: record.data.manaCost,
    type_line: record.data.typeLine,
    produced_mana: JSON.parse(record.data.producedMana || "[]"),
    oracle_text: record.data.oracleText,
    power: record.data.basePower,
    toughness: record.data.baseToughness,
    loyalty: record.data.baseLoyalty,
    keywords: JSON.parse(record.data.keywords || "[]"),
    image_uris: { normal: record.image, small: record.image },
  };
}

function loadBoardState(state) {
  closeManaChoicePrompt();
  clearAiTurnTimer();
  document.querySelectorAll(".board-card").forEach((card) => card.remove());
  restoreSeatsFromState(state);
  if (state.seats) {
    Object.entries(state.seats).forEach(([seatId, saved]) => {
      const section = seatSection(seatId);
      if (!section) return;
      section.querySelector(".life-input").value = saved.life ?? "20";
      section.querySelectorAll(".player-counter").forEach((counter) => {
        const value = Number(saved.counters?.[counter.dataset.counter] || 0);
        counter.dataset.value = String(value);
        counter.textContent = `${counter.dataset.counter === "poison" ? "Poison" : "Experience"} ${value}`;
        counter.hidden = value === 0;
      });
      if (saved.behavior) seatBehaviors.set(seatId, { ...DEFAULT_SEAT_BEHAVIOR, ...saved.behavior });
    });
  } else {
    // A save from before multiplayer: two seats, flat arrays, positional order.
    allLifeInputs().forEach((input, index) => {
      input.value = state.life?.[index] ?? "20";
    });
    allPlayerCounters().forEach((counter, index) => {
      const value = Number(state.counters?.[index] || 0);
      counter.dataset.value = String(value);
      counter.textContent = `${counter.dataset.counter === "poison" ? "Poison" : "Experience"} ${value}`;
      counter.hidden = value === 0;
    });
  }
  Object.entries(state.zones || {}).forEach(([zoneName, records]) => {
    const zone = document.querySelector(`[data-zone="${zoneName}"]`);
    if (!zone) return;
    records.forEach((record) => {
      const card = createBoardCard(savedCardToScryfall(record));
      Object.assign(card.dataset, record.data);
      record.classes?.forEach((name) => card.classList.add(name));
      zone.append(card);
      refreshCardState(card);
      updateCreatureDamageBadge(card);
    });
  });
  refreshSeatLabels();
  syncSeatControls();
  const savedSeat = state.turnSeat && seatExists(state.turnSeat) ? state.turnSeat : HUMAN_SEAT;
  window.setTurnState?.(state.phase || "Untap", state.turnNumber || 1, savedSeat);
  showMessage("Board save loaded.", "success");
}

function renderSaveSlots() {
  const saves = readBoardSaves();
  saveSlotList.replaceChildren();
  saves.forEach((save, index) => {
    const row = document.createElement("div");
    row.className = "save-slot";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `Save ${index + 1}`;
    const meta = document.createElement("span");
    const cardCount = save ? Object.values(save.zones || {}).reduce((total, cards) => total + cards.length, 0) : 0;
    meta.textContent = save
      ? `${cardCount} cards · ${save.phase || "Untap"} · ${new Date(save.savedAt).toLocaleString()}`
      : "Empty slot";
    details.append(title, meta);
    const actions = document.createElement("div");
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = save ? "Overwrite" : "Save here";
    saveButton.addEventListener("click", () => {
      const updated = readBoardSaves();
      updated[index] = captureBoardState();
      writeBoardSaves(updated);
      renderSaveSlots();
      showMessage(`Board saved to slot ${index + 1}.`, "success");
    });
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.disabled = !save;
    loadButton.addEventListener("click", () => {
      const selectedSave = readBoardSaves()[index];
      if (!selectedSave) return;
      loadBoardState(selectedSave);
      closeSaveManager();
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-save";
    deleteButton.textContent = "Delete";
    deleteButton.disabled = !save;
    deleteButton.addEventListener("click", () => {
      const updated = readBoardSaves();
      updated[index] = null;
      writeBoardSaves(updated);
      renderSaveSlots();
    });
    actions.append(saveButton, loadButton, deleteButton);
    row.append(details, actions);
    saveSlotList.append(row);
  });
}

function openSaveManager() {
  if (!editingMode) return;
  renderSaveSlots();
  saveManager.hidden = false;
  saveManagerBackdrop.hidden = false;
}

function closeSaveManager() {
  saveManager.hidden = true;
  saveManagerBackdrop.hidden = true;
}

function clearCurrentBoard() {
  if (!clearBoardArmed) {
    clearBoardArmed = true;
    clearBoardButton.textContent = "Confirm clear";
    window.clearTimeout(clearBoardTimer);
    clearBoardTimer = window.setTimeout(() => {
      clearBoardArmed = false;
      clearBoardButton.innerHTML = '<span aria-hidden="true">⌫</span> Clear board';
    }, 3500);
    return;
  }
  window.clearTimeout(clearBoardTimer);
  clearBoardArmed = false;
  document.querySelectorAll(".board-card").forEach((card) => card.remove());
  allLifeInputs().forEach((input) => { input.value = "20"; });
  allPlayerCounters().forEach((counter) => {
    counter.dataset.value = "0";
    counter.hidden = true;
  });
  clearBoardButton.innerHTML = '<span aria-hidden="true">⌫</span> Clear board';
  showMessage("Current board cleared. Saved slots were not changed.", "success");
}

function cancelPlacement() {
  selectedCard = null;
  importer.toast.hidden = true;
  allZones().forEach((zone) => zone.classList.remove("placement-target"));
}

function beginPlacement(card) {
  selectedCard = card;
  importer.toastImage.src = cardThumbnail(card);
  importer.toastImage.alt = card.name;
  importer.toast.querySelector("span").textContent = `Place ${card.name} in any highlighted zone`;
  importer.toast.hidden = false;
  allZones().forEach((zone) => zone.classList.add("placement-target"));
  closeImporter();
}

function parseCost(cost) {
  if (!cost) return [];
  const firstCost = cost.split(" // ")[0];
  return [...firstCost.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function reductionSubjectMatches(card, subject) {
  const normalized = subject.toLowerCase().trim();
  if (!normalized || normalized === "all" || normalized === "your") return true;
  if (normalized.includes("instant and sorcery")) return /Instant|Sorcery/.test(card.dataset.typeLine);
  return ["creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker"]
    .some((type) => normalized.includes(type) && card.dataset.typeLine.toLowerCase().includes(type));
}

function reduceManaCost(cost, reduction) {
  const costSymbols = parseCost(cost);
  const reductionSymbols = parseCost(reduction);
  let generic = 0;
  const remaining = [];
  costSymbols.forEach((symbol) => {
    if (/^\d+$/.test(symbol)) generic += Number(symbol);
    else remaining.push(symbol);
  });
  reductionSymbols.forEach((symbol) => {
    if (/^\d+$/.test(symbol)) generic = Math.max(0, generic - Number(symbol));
    else {
      const index = remaining.indexOf(symbol);
      if (index >= 0) remaining.splice(index, 1);
    }
  });
  return `${generic > 0 ? `{${generic}}` : ""}${remaining.map((symbol) => `{${symbol}}`).join("")}` || "{0}";
}

function effectiveSpellCost(card, printedCost) {
  let cost = printedCost;
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card').forEach((source) => {
    staticAbilityLines(source).forEach((line) => {
      const match = line.match(/^(?:Your\s+)?(.*?)spells?(?:\s+you cast)?\s+cost\s+((?:\{[^}]+\})+)\s+less to cast/i);
      if (match && reductionSubjectMatches(card, match[1])) cost = reduceManaCost(cost, match[2]);
    });
  });
  return cost;
}

function effectiveActivatedAbilityCost(sourceCard, printedCost) {
  let cost = printedCost;
  const controller = seatOfElement(sourceCard);
  document.querySelectorAll(`[data-zone="${controller}-battlefield"] .board-card`).forEach((source) => {
    staticAbilityLines(source).forEach((line) => {
      const match = line.match(/^(?:Activated\s+)?abilities(?: of (.+?))? you (?:activate|control) cost ((?:\{[^}]+\})+) less to activate/i);
      if (!match) return;
      if (!match[1] || sourceCard.dataset.typeLine.toLowerCase().includes(match[1].toLowerCase().replace(/s$/, ""))) {
        cost = reduceManaCost(cost, match[2]);
      }
    });
  });
  return cost;
}

function activatedAbilitiesFor(card) {
  // A card's printed "cost: effect" abilities don't function from the graveyard —
  // only its graveyard keyword abilities do.
  if (zoneKindFor(card) === "graveyard") return graveyardKeywordAbilities(card);
  const lines = (card.dataset.oracleText || "").split("\n");
  return lines.flatMap((line, lineIndex) => {
    const match = line.trim().match(/^(.+?):\s*(.+)$/);
    if (!match) return [];
    return [{ cost: match[1].trim(), effect: match[2].trim(), lineIndex, lineCount: lines.length }];
  });
}

function permanentCostRequirement(cost, source) {
  const match = cost.match(/\b(tap|sacrifice|return|exile)\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?(?:(other|another)\s+)?(?:(untapped)\s+)?([a-z]+)\s+you control(?:\s+to its owner[’']s hand)?/i)
    || cost.match(/\b(sacrifice|exile)\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?(?:(other|another)\s+)?(?:(untapped)\s+)?([a-z]+)\b/i);
  if (!match) return null;
  const action = match[1].toLowerCase();
  const amount = match[2] || "a";
  const excludesSource = Boolean(match[3]);
  const requiresUntapped = Boolean(match[4]) || action === "tap";
  const rawKind = match[5].toLowerCase();
  const kind = ({ creatures: "creature", artifacts: "artifact", lands: "land", permanents: "permanent", elves: "elf" })[rawKind]
    || rawKind.replace(/s$/, "");
  const controller = seatOfElement(source);
  const candidates = [...document.querySelectorAll(`[data-zone="${controller}-battlefield"] .board-card`)].filter((card) => {
    if (excludesSource && card === source) return false;
    if (kind !== "permanent" && !card.dataset.typeLine.toLowerCase().includes(kind)) return false;
    if (requiresUntapped && card.classList.contains("tapped")) return false;
    return true;
  });
  return { action, count: counterAmount(amount), excludesSource, requiresUntapped, kind, candidates, matchedText: match[0] };
}

function payActivatedAbilityCost(source, printedCost, selectedPermanents = []) {
  const permanentRequirement = permanentCostRequirement(printedCost, source);
  if (permanentRequirement) {
    const legalSelections = selectedPermanents.filter((card) => permanentRequirement.candidates.includes(card));
    if (legalSelections.length !== permanentRequirement.count) {
      return { paid: false, reason: `Choose ${permanentRequirement.count} legal ${permanentRequirement.kind}${permanentRequirement.count === 1 ? "" : "s"} to pay this cost.` };
    }
  }
  const symbols = parseCost(printedCost);
  if (symbols.includes("Q")) return { paid: false, reason: "Untap-symbol costs are not supported yet." };
  const requiresTap = symbols.includes("T");
  if (requiresTap && source.classList.contains("tapped")) return { paid: false, reason: `${source.dataset.cardName} is already tapped.` };
  if (requiresTap && source.dataset.typeLine.includes("Creature") && source.classList.contains("summoning-sick") && !cardHasHaste(source)) {
    return { paid: false, reason: `${source.dataset.cardName} has summoning sickness and cannot pay a {T} cost.` };
  }

  const lifeMatch = printedCost.match(/pay\s+(\d+)\s+life/i);
  const unsupported = printedCost
    .replace(permanentRequirement?.matchedText || /$^/, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/pay\s+\d+\s+life/ig, "")
    .replace(/[,.\s]/g, "");
  if (unsupported) return { paid: false, reason: `This ability uses an unsupported cost: ${printedCost}.` };

  const controller = seatOfElement(source);
  const lifeInput = seatSection(controller)?.querySelector(".life-input");
  const lifePayment = Number(lifeMatch?.[1] || 0);
  if (lifePayment && Number(lifeInput.value) < lifePayment) return { paid: false, reason: `You cannot pay ${lifePayment} life.` };

  const manaSymbols = symbols.filter((symbol) => !["T", "Q"].includes(symbol));
  const printedManaCost = manaSymbols.map((symbol) => `{${symbol}}`).join("") || "{0}";
  const manaCost = effectiveActivatedAbilityCost(source, printedManaCost);
  if (manaCost !== "{0}") {
    const payment = spendManaFor(manaCost);
    if (!payment.paid) return payment;
  }
  if (lifePayment) lifeInput.value = String(Number(lifeInput.value) - lifePayment);
  if (requiresTap) source.classList.add("tapped");
  if (permanentRequirement) {
    selectedPermanents.forEach((card) => {
      if (permanentRequirement.action === "tap") card.classList.add("tapped");
      if (permanentRequirement.action === "sacrifice") movePermanentToGraveyard(card, { reason: "sacrificed" });
      if (permanentRequirement.action === "return") document.querySelector(`[data-zone="${controller}-hand"]`).append(card);
      if (permanentRequirement.action === "exile") document.querySelector(`[data-zone="${controller}-exile"]`).append(card);
      refreshCardState(card);
    });
  }
  refreshCardState(source);
  return { paid: true, manaCost, printedManaCost };
}

function spendManaFor(cost) {
  const symbols = parseCost(cost);
  if (symbols.some((symbol) => symbol === "X" || symbol === "S")) {
    return { paid: false, reason: "Variable and snow costs require manual resolution." };
  }

  const working = { ...manaPool };
  let generic = 0;
  const flexible = [];

  symbols.forEach((symbol) => {
    if (/^\d+$/.test(symbol)) generic += Number(symbol);
    else if (MANA_TYPES.includes(symbol)) flexible.push([symbol]);
    else if (symbol.includes("/P")) flexible.push([symbol.split("/")[0]]);
    else if (symbol.includes("/")) {
      const choices = symbol.split("/");
      flexible.push(choices.filter((choice) => MANA_TYPES.includes(choice)));
      const genericChoice = choices.find((choice) => /^\d+$/.test(choice));
      if (genericChoice) flexible[flexible.length - 1].push(Number(genericChoice));
    }
  });

  function payFlexible(index, pool, addedGeneric) {
    if (index === flexible.length) {
      const totalGeneric = generic + addedGeneric;
      const manaAvailable = MANA_TYPES.reduce((total, type) => total + pool[type], 0);
      return manaAvailable >= totalGeneric ? { pool, generic: totalGeneric } : null;
    }
    for (const choice of flexible[index]) {
      const nextPool = { ...pool };
      if (typeof choice === "number") {
        const result = payFlexible(index + 1, nextPool, addedGeneric + choice);
        if (result) return result;
      } else if (nextPool[choice] > 0) {
        nextPool[choice] -= 1;
        const result = payFlexible(index + 1, nextPool, addedGeneric);
        if (result) return result;
      }
    }
    return null;
  }

  const afterSymbols = payFlexible(0, working, 0);
  if (!afterSymbols) return { paid: false, reason: `Mana pool cannot pay ${cost}.` };

  let genericRemaining = afterSymbols.generic;
  for (const type of MANA_TYPES) {
    const spend = Math.min(afterSymbols.pool[type], genericRemaining);
    afterSymbols.pool[type] -= spend;
    genericRemaining -= spend;
  }
  if (genericRemaining > 0) return { paid: false, reason: `Mana pool cannot pay ${cost}.` };

  MANA_TYPES.forEach((type) => {
    manaPool[type] = afterSymbols.pool[type];
  });
  renderManaPool();
  return { paid: true };
}

function castingPermission(typeLine) {
  const phase = window.currentTurnPhase || "Untap";
  if (typeLine.includes("Sorcery") && !["Main phase 1", "Main phase 2"].includes(phase)) {
    return { allowed: false, reason: `Sorceries can only be cast during Main 1 or Main 2. Current phase: ${phase}.` };
  }
  if (typeLine.includes("Instant") && phase === "Untap") {
    return { allowed: false, reason: "Instants cannot be cast during the untap step." };
  }
  return { allowed: true };
}

function targetCountFor(oracleText) {
  if (!/\btarget\b/i.test(oracleText)) return 0;
  const numberedTarget = oracleText.match(/\b(one|two|three|four|five|six|seven|\d+)\s+targets?\b/i);
  if (!numberedTarget) return 1;
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  return Number(numberedTarget[1]) || words[numberedTarget[1].toLowerCase()] || 1;
}

function targetLabel(element) {
  if (element.classList.contains("life-total")) {
    return element.getAttribute("aria-label").replace(" life total", "");
  }
  return element.dataset.cardName || element.getAttribute("aria-label") || "target";
}

function fixedDamageAmount(oracleText) {
  const match = oracleText.match(/\bdeals?\s+(\d+)\s+damage\b/i);
  return match ? Number(match[1]) : 0;
}

function updateCreatureDamageBadge(card) {
  card.querySelector(".damage-badge")?.remove();
  const damage = Number(card.dataset.damageMarked || 0);
  const toughness = Number(card.dataset.currentToughness || card.dataset.baseToughness);
  if (!damage || !Number.isFinite(toughness)) return;
  const badge = document.createElement("span");
  badge.className = "damage-badge";
  badge.textContent = `${Math.max(0, toughness - damage)} toughness`;
  badge.title = `${damage} damage marked on a ${toughness}-toughness creature`;
  card.append(badge);
}

/**
 * Where a permanent goes when it leaves the battlefield. Tokens cease to exist
 * rather than piling up in the graveyard, so they are exiled instead.
 */
function restingZoneFor(card, owner) {
  return card.dataset.isToken === "true" ? `${owner}-exile` : `${owner}-graveyard`;
}

function movePermanentToGraveyard(card, { reason = "died", announce = false } = {}) {
  if (card.classList.contains("moving-to-graveyard")) return;
  const battlefieldZone = card.parentElement?.dataset.zone || "";
  const owner = seatOfElement(card);
  const died = battlefieldZone.endsWith("-battlefield") && card.dataset.typeLine.includes("Creature");
  const isToken = card.dataset.isToken === "true";
  card.classList.add("moving-to-graveyard");
  if (died) {
    card.classList.add("creature-dying");
    // "Dies" triggers still see the token before it ceases to exist.
    emitGameEvent("dies", { card, controller: owner, reason });
    card.setAttribute("aria-label", `${card.dataset.cardName} ${reason === "sacrificed" ? "was sacrificed and is dying" : "has died"}.`);
  }
  const delay = died ? 720 : 0;
  window.setTimeout(() => {
    document.querySelector(`[data-zone="${restingZoneFor(card, owner)}"]`).append(card);
    card.classList.remove("creature-dying", "moving-to-graveyard");
    card.classList.remove("static-lethal-pending");
    card.dataset.damageMarked = "0";
    updateCreatureDamageBadge(card);
    refreshCardState(card);
    if (announce) {
      showMessage(
        isToken
          ? `${card.dataset.cardName} died and was exiled — tokens cease to exist.`
          : `${card.dataset.cardName} died and was put into ${owner === "player" ? "your" : "the opponent's"} graveyard.`,
        "error",
      );
    }
  }, delay);
}

function sendLethalCreatureToGraveyard(card) {
  movePermanentToGraveyard(card, { reason: "lethal damage", announce: true });
}

function applyResolvedDamage(card, targets) {
  const damage = fixedDamageAmount(card.dataset.oracleText || "");
  if (!damage) return [];
  const results = [];
  targets.forEach((target) => {
    if (target.classList.contains("life-total")) {
      const input = target.querySelector(".life-input");
      input.value = String(Math.max(0, Number(input.value || 0) - damage));
      results.push(`${damage} damage to ${targetLabel(target)}`);
      return;
    }
    const toughness = Number(target.dataset.baseToughness);
    if (target.dataset.typeLine?.includes("Creature") && Number.isFinite(toughness)) {
      const totalDamage = Number(target.dataset.damageMarked || 0) + damage;
      target.dataset.damageMarked = String(totalDamage);
      updateCreatureDamageBadge(target);
      results.push(`${damage} damage to ${targetLabel(target)}`);
      if (totalDamage >= toughness) sendLethalCreatureToGraveyard(target);
    }
  });
  if (results.length) emitGameEvent("damage", { card, targets, damage });
  return results;
}

function eligibleTargetsFor(oracleText) {
  const text = oracleText.toLowerCase();
  const candidates = new Set();
  const addPlayers = (opponentOnly = false) => {
    document.querySelectorAll(".life-total").forEach((lifeTotal) => {
      if (!opponentOnly || /opponent/i.test(lifeTotal.getAttribute("aria-label"))) candidates.add(lifeTotal);
    });
  };
  const addBattlefieldCards = (matcher = () => true) => {
    document.querySelectorAll('[data-zone$="battlefield"] .board-card').forEach((card) => {
      if (card !== resolvingSpell && matcher(card.dataset.typeLine.toLowerCase())) candidates.add(card);
    });
  };

  if (text.includes("any target")) {
    addPlayers();
    addBattlefieldCards((type) => /creature|planeswalker|battle/.test(type));
  }
  if (/target (?:player|players)/.test(text)) addPlayers();
  if (/target opponent/.test(text)) addPlayers(true);
  if (/target (?:creature|creatures)/.test(text)) addBattlefieldCards((type) => type.includes("creature"));
  if (/target (?:planeswalker|planeswalkers)/.test(text)) addBattlefieldCards((type) => type.includes("planeswalker"));
  if (/target (?:permanent|permanents)/.test(text)) addBattlefieldCards();
  ["artifact", "enchantment", "land", "battle"].forEach((kind) => {
    if (text.includes(`target ${kind}`)) addBattlefieldCards((type) => type.includes(kind));
  });
  if (/target (?:card|cards).*graveyard/.test(text)) {
    document.querySelectorAll('[data-zone$="graveyard"] .board-card').forEach((card) => candidates.add(card));
  }

  if (!candidates.size) {
    addPlayers();
    addBattlefieldCards();
  }
  // Hexproof and shroud remove permanents from the pool of legal targets.
  return [...candidates].filter((candidate) => canBeTargetedBy(candidate, "player"));
}

function triggeredAbilitiesFor(card) {
  return (card.dataset.oracleText || "").split("\n").flatMap((line) => {
    const match = line.trim().match(/\b(When|Whenever)\s+(.+?),\s+(.+)$/i);
    if (!match) return [];
    const kickedEffect = match[3].match(/^if (?:it|this spell|this creature) was kicked,\s*(.+)$/i);
    return [{
      source: card,
      word: match[1],
      condition: match[2],
      effect: kickedEffect?.[1] || match[3],
      requiresKicked: Boolean(kickedEffect),
    }];
  });
}

function triggerMatchesEvent(trigger, eventName, context) {
  const condition = trigger.condition.toLowerCase();
  const source = trigger.source;
  const eventCard = context.card;
  const sameCard = eventCard === source;
  const sourceController = source.parentElement?.dataset.zone?.split("-")[0];
  const eventController = eventCard?.parentElement?.dataset.zone?.split("-")[0] || context.controller;
  const typeMatches = !eventCard
    || !/(creature|land|artifact|enchantment|planeswalker)/.test(condition)
    || ["creature", "land", "artifact", "enchantment", "planeswalker"].some((type) => condition.includes(type) && eventCard.dataset.typeLine.toLowerCase().includes(type));
  const controlledByYou = /(?:under your control|you control)/.test(condition);
  const controlledByOpponent = /(?:under an? opponent's control|an? opponent controls|your opponents control|you (?:do not|don't) control)/.test(condition);
  const controlMatches = (!controlledByYou || sourceController === eventController)
    && (!controlledByOpponent || sourceController !== eventController);
  const namesSource = condition.includes(source.dataset.cardName.toLowerCase());
  const refersToSource = /\b(this|it)\b/.test(condition) || namesSource;
  const excludesSource = /\b(?:another|other)\b/.test(condition);
  const tokenMatches = !eventCard
    || (!/\bnontoken\b/.test(condition) || eventCard.dataset.isToken !== "true")
    && (!/\btoken creature\b/.test(condition) || eventCard.dataset.isToken === "true");
  const subjectMatches = (refersToSource ? sameCard : true) && (!excludesSource || !sameCard);

  if (trigger.requiresKicked && source.dataset.kicked !== "true") return false;

  if (eventName === "permanent-enter") return condition.includes("enters") && typeMatches && controlMatches && subjectMatches;
  if (eventName === "spell-cast") return condition.includes("cast") && typeMatches && controlMatches;
  if (eventName === "attacks") return condition.includes("attack") && typeMatches && controlMatches && subjectMatches;
  if (eventName === "dies") return /\b(?:dies|die)\b/.test(condition) && typeMatches && tokenMatches && controlMatches && subjectMatches;
  if (eventName === "damage") return condition.includes("deals damage") && subjectMatches;
  if (eventName === "phase") {
    const phase = String(context.phase || "").toLowerCase();
    return condition.includes("beginning") && (
      condition.includes(phase.replace(" phase", "").replace(" step", ""))
      || (phase === "end step" && condition.includes("end step"))
    );
  }
  return false;
}

function emitGameEvent(eventName, context = {}) {
  const battlefieldCards = [...document.querySelectorAll('[data-zone$="battlefield"] .board-card')];
  battlefieldCards.forEach((card) => {
    triggeredAbilitiesFor(card).forEach((trigger) => {
      if (triggerMatchesEvent(trigger, eventName, context)) triggerQueue.push({ ...trigger, eventName, context, targets: [] });
    });
  });
  showNextTriggeredAbility();
}

function renderAbilityTargets() {
  triggerTargetOptions.replaceChildren();
  resolveTriggerButton.dataset.mode = "resolve";
  resolveTriggerButton.textContent = "Resolve ability";
  const requiredTargets = targetCountFor(activeTrigger.effect);
  const candidates = requiredTargets ? eligibleTargetsFor(activeTrigger.effect) : [];
  if (activeTrigger.type === "activated" && requiredTargets) {
    abilityTargetingController?.abort();
    abilityTargetingController = new AbortController();
    triggerViewer.hidden = true;
    triggerViewerBackdrop.hidden = true;
    abilityCostBar.hidden = false;
    abilityCostBar.querySelector("strong").textContent = `Choose ${requiredTargets} target${requiredTargets === 1 ? "" : "s"}`;
    abilityCostBarCopy.textContent = candidates.length ? "Click a highlighted target on the board." : "No legal targets available.";
    payPermanentCostButton.hidden = true;
    candidates.forEach((candidate) => {
      candidate.classList.add("legal-ability-target");
      candidate.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const selectedIndex = activeTrigger.targets.indexOf(candidate);
        if (selectedIndex >= 0) activeTrigger.targets.splice(selectedIndex, 1);
        else if (activeTrigger.targets.length < requiredTargets) activeTrigger.targets.push(candidate);
        candidate.classList.toggle("chosen-ability-target", activeTrigger.targets.includes(candidate));
        abilityCostBarCopy.textContent = activeTrigger.targets.length
          ? `Selected: ${activeTrigger.targets.map(targetLabel).join(", ")}`
          : "Click a highlighted target on the board.";
        if (activeTrigger.targets.length === requiredTargets) resolveTriggeredAbility();
      }, { capture: true, signal: abilityTargetingController.signal });
    });
    return;
  }
  candidates.forEach((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = targetLabel(candidate);
    button.targetElement = candidate;
    button.addEventListener("click", () => {
      activeTrigger.targets = [candidate];
      triggerTargetOptions.querySelectorAll("button").forEach((option) => option.classList.toggle("selected", option === button));
      resolveTriggerButton.disabled = false;
    });
    triggerTargetOptions.append(button);
  });
  resolveTriggerButton.disabled = requiredTargets > 0 && candidates.length > 0;
  if (requiredTargets && !candidates.length) resolveTriggerButton.textContent = "Dismiss — no legal targets";
}

function closeActivatedAbilityMenu() {
  abilityTargetingController?.abort();
  abilityTargetingController = null;
  document.querySelectorAll(".legal-ability-cost, .chosen-ability-cost, .legal-ability-target, .chosen-ability-target").forEach((card) => card.classList.remove("legal-ability-cost", "chosen-ability-cost", "legal-ability-target", "chosen-ability-target"));
  activeAbilitySource?.classList.remove("ability-inspecting");
  activeAbilitySource?.querySelector(".activated-ability-overlay")?.remove();
  if (activeAbilitySource?.dataset.inspectionZone) {
    document.querySelector(`[data-zone="${activeAbilitySource.dataset.inspectionZone}"]`)?.append(activeAbilitySource);
    delete activeAbilitySource.dataset.inspectionZone;
    refreshCardState(activeAbilitySource);
  }
  activeAbilitySource = null;
  pendingAbilityPayment = null;
  activeTrigger = null;
  triggerViewer.hidden = true;
  triggerViewer.classList.remove("death-trigger-viewer");
  triggerViewerBackdrop.hidden = true;
  abilityCostBar.hidden = true;
  payPermanentCostButton.hidden = false;
  resolveTriggerButton.dataset.mode = "resolve";
  showNextTriggeredAbility();
}

function requestActivatedAbilityPayment(source, ability) {
  pendingAbilityPayment = { source, ability, requirement: null, selected: [] };
  triggerSourceImage.src = source.querySelector("img")?.src || "";
  triggerSourceImage.alt = source.dataset.cardName;
  triggerViewerTitle.textContent = source.dataset.cardName;
  triggerViewerKind.textContent = "Pay ability cost";
  setManaText(triggerCondition, `Cost: ${ability.cost}`);
  setManaText(triggerEffect, ability.effect);
  triggerTargetOptions.replaceChildren();
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", closeActivatedAbilityMenu);
  triggerTargetOptions.append(cancelButton);
  resolveTriggerButton.dataset.mode = "confirm-ability-cost";
  setManaText(resolveTriggerButton, `Pay ${ability.cost}`);
  resolveTriggerButton.disabled = false;
  triggerViewer.hidden = false;
  triggerViewerBackdrop.hidden = false;
  resolveTriggerButton.focus();
  source.classList.remove("ability-inspecting");
  source.querySelector(".activated-ability-overlay")?.remove();
  if (source.dataset.inspectionZone) {
    document.querySelector(`[data-zone="${source.dataset.inspectionZone}"]`)?.append(source);
    delete source.dataset.inspectionZone;
    refreshCardState(source);
  }
}

function showPermanentCostChoices(source, ability, requirement) {
  pendingAbilityPayment = { source, ability, requirement, selected: [] };
  requirement.candidates.forEach((candidate) => {
    candidate.classList.add("legal-ability-cost");
  });
  triggerViewer.hidden = true;
  triggerViewerBackdrop.hidden = true;
  abilityCostBar.hidden = false;
  payPermanentCostButton.hidden = false;
  abilityCostBar.querySelector("strong").textContent = `Choose ${requirement.count} ${requirement.requiresUntapped ? "untapped " : ""}${requirement.kind}${requirement.count === 1 ? "" : "s"} to ${requirement.action}`;
  abilityCostBarCopy.textContent = `Selected 0 of ${requirement.count}`;
  payPermanentCostButton.disabled = true;
  payPermanentCostButton.textContent = `Pay cost (0/${requirement.count})`;
  if (!requirement.candidates.length) {
    payPermanentCostButton.textContent = "No legal permanent available";
    showMessage(`No legal ${requirement.kind} is available to pay this ability's cost.`, "error");
  }
}

function beginActivatedAbility(source, ability, selectedPermanents = null) {
  const graveyardAbility = ability.keyword ? keywordDefinition(ability.keyword)?.graveyardAbility : null;
  // Every graveyard keyword ability is "Activate only as a sorcery."
  if (graveyardAbility && !["Main phase 1", "Main phase 2"].includes(window.currentTurnPhase)) {
    showMessage(`${ability.keyword} can only be activated during your main phase. Current phase: ${window.currentTurnPhase}.`, "error");
    return;
  }
  const permanentRequirement = permanentCostRequirement(ability.cost, source);
  if (permanentRequirement && selectedPermanents === null) {
    showPermanentCostChoices(source, ability, permanentRequirement);
    return;
  }
  const payment = payActivatedAbilityCost(source, ability.cost, selectedPermanents || []);
  if (!payment.paid) {
    showMessage(payment.reason, "error");
    return;
  }
  if (graveyardAbility) {
    // "Exile this card from your graveyard" is part of the activation cost.
    if (graveyardAbility.exilesAsCost) {
      document.querySelector('[data-zone="player-exile"]').append(source);
      refreshCardState(source);
    }
    if (graveyardAbility.resolve) {
      pendingAbilityPayment = null;
      activeAbilitySource = null;
      abilityCostBar.hidden = true;
      triggerViewer.hidden = true;
      triggerViewerBackdrop.hidden = true;
      resolveTriggerButton.dataset.mode = "resolve";
      graveyardAbility.resolve(source);
      showNextTriggeredAbility();
      return;
    }
    // No direct resolver (scavenge) — fall through to the normal targeting flow.
  }
  document.querySelectorAll(".legal-ability-cost, .chosen-ability-cost").forEach((card) => card.classList.remove("legal-ability-cost", "chosen-ability-cost"));
  abilityCostBar.hidden = true;
  pendingAbilityPayment = null;
  activeAbilitySource = null;
  activeTrigger = { source, effect: ability.effect, cost: ability.cost, targets: [], context: {}, type: "activated" };
  triggerViewerKind.textContent = "Activated ability";
  setManaText(triggerCondition, `${ability.cost} paid`);
  setManaText(triggerEffect, ability.effect);
  renderAbilityTargets();
  if (targetCountFor(ability.effect) === 0) {
    resolveTriggeredAbility();
    return;
  }
  showMessage(`${source.dataset.cardName}'s ability cost was paid. Click a highlighted target on the board.`, "success");
}

function openActivatedAbilityMenu(source) {
  const abilities = activatedAbilitiesFor(source);
  if (!abilities.length || activeTrigger || activeAbilitySource || resolvingSpell) return;
  hideCardHoverPreview();
  activeAbilitySource = source;
  source.dataset.inspectionZone = source.parentElement.dataset.zone;
  document.body.append(source);
  source.classList.add("ability-inspecting");
  const overlay = document.createElement("div");
  overlay.className = "activated-ability-overlay";
  abilities.forEach((ability) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ability-text-highlight";
    button.setAttribute("aria-label", `Activate ${ability.cost}: ${ability.effect}`);
    button.title = `Activate ${ability.cost}: ${ability.effect}`;
    const lineHeight = Math.max(7, 27 / Math.max(1, ability.lineCount));
    const lineTop = 58 + (ability.lineIndex / Math.max(1, ability.lineCount)) * 27;
    button.style.setProperty("--ability-line-top", `${lineTop}%`);
    button.style.setProperty("--ability-line-height", `${lineHeight}%`);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      requestActivatedAbilityPayment(source, ability);
    });
    overlay.append(button);
  });
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close-ability-inspection";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Cancel ability selection");
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeActivatedAbilityMenu();
  });
  overlay.append(closeButton);
  source.append(overlay);
  triggerViewer.hidden = true;
  triggerViewerBackdrop.hidden = false;
  overlay.querySelector("button")?.focus();
}

function openSurgeCastMenu(source) {
  const surgeCost = surgeCostFor(source);
  if (!surgeCost || !surgeIsAvailable() || activeTrigger || activeAbilitySource || resolvingSpell) return;
  hideCardHoverPreview();
  activeAbilitySource = source;
  source.dataset.inspectionZone = source.parentElement.dataset.zone;
  document.body.append(source);
  source.classList.add("ability-inspecting");
  const lines = (source.dataset.oracleText || "").split("\n").filter((line) => line.trim());
  const surgeLineIndex = Math.max(0, lines.findIndex((line) => /^Surge\b/i.test(line.trim())));
  const overlay = document.createElement("div");
  overlay.className = "activated-ability-overlay";
  const surgeButton = document.createElement("button");
  surgeButton.type = "button";
  surgeButton.className = "ability-text-highlight";
  surgeButton.setAttribute("aria-label", `Cast with surge for ${surgeCost}`);
  surgeButton.title = `Cast with surge for ${surgeCost}`;
  surgeButton.style.setProperty("--ability-line-top", `${58 + (surgeLineIndex / Math.max(1, lines.length)) * 27}%`);
  surgeButton.style.setProperty("--ability-line-height", `${Math.max(7, 27 / Math.max(1, lines.length))}%`);
  surgeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    source.classList.remove("ability-inspecting");
    overlay.remove();
    document.querySelector(`[data-zone="${source.dataset.inspectionZone}"]`)?.append(source);
    delete source.dataset.inspectionZone;
    activeAbilitySource = null;
    triggerViewerBackdrop.hidden = true;
    refreshCardState(source);
    offerSurgeChoice(source, document.querySelector('[data-zone="player-battlefield"]'), surgeCost, false, false);
  });
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close-ability-inspection";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Cancel surge casting");
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeActivatedAbilityMenu();
  });
  overlay.append(surgeButton, closeButton);
  source.append(overlay);
  triggerViewer.hidden = true;
  triggerViewerBackdrop.hidden = false;
  surgeButton.focus();
}

function showNextTriggeredAbility() {
  if (activeTrigger || activeAbilitySource || !triggerQueue.length) return;
  activeTrigger = triggerQueue.shift();
  triggerSourceImage.src = activeTrigger.source.querySelector("img")?.src || "";
  triggerSourceImage.alt = activeTrigger.source.dataset.cardName;
  triggerViewerTitle.textContent = activeTrigger.source.dataset.cardName;
  const isDeathTrigger = activeTrigger.eventName === "dies";
  triggerViewer.classList.toggle("death-trigger-viewer", isDeathTrigger);
  triggerViewerKind.textContent = isDeathTrigger ? "Death trigger" : "Triggered ability";
  triggerCondition.textContent = `${activeTrigger.word} ${activeTrigger.condition}…`;
  triggerEffect.textContent = activeTrigger.effect;
  renderAbilityTargets();
  triggerViewer.hidden = false;
  triggerViewerBackdrop.hidden = false;
  resolveTriggerButton.focus();
}

function resolveTriggeredAbility() {
  if (resolveTriggerButton.dataset.mode === "ability-menu") {
    closeActivatedAbilityMenu();
    return;
  }
  if (resolveTriggerButton.dataset.mode === "ability-cost-targets") {
    if (!pendingAbilityPayment || pendingAbilityPayment.selected.length !== pendingAbilityPayment.requirement.count) return;
    beginActivatedAbility(pendingAbilityPayment.source, pendingAbilityPayment.ability, [...pendingAbilityPayment.selected]);
    return;
  }
  if (resolveTriggerButton.dataset.mode === "confirm-ability-cost") {
    if (!pendingAbilityPayment) return;
    beginActivatedAbility(pendingAbilityPayment.source, pendingAbilityPayment.ability);
    return;
  }
  if (!activeTrigger) return;
  if (!activeTrigger.choiceMade) {
    const choices = effectChoicesFor(activeTrigger.effect);
    if (choices.length) {
      showEffectChoice(choices, (choice) => {
        activeTrigger.effect = choice.effect;
        activeTrigger.choiceMade = true;
        resolveTriggeredAbility();
      });
      return;
    }
  }
  const { source, effect } = activeTrigger;
  let { targets } = activeTrigger;
  const controller = seatOfElement(source);
  const damage = fixedDamageAmount(effect);
  if (damage && !targets.length && /\b(each opponent|defending player)\b/i.test(effect)) {
    targets = seatsOtherThan(controller).map(seatLifeTotal).filter(Boolean);
  }
  if (damage && !targets.length && /\b(player or planeswalker) that (?:creature|it) is attacking\b/i.test(effect)) {
    const attackedTarget = combatAssignments.get(activeTrigger.context.card);
    if (attackedTarget) targets = [attackedTarget];
  }
  const counterResults = applyPlayerCounterEffects(effect, controller, targets);
  const stateResults = applyPermanentStateEffects(effect, controller, targets);
  void createTokensFromEffect(effect, controller);
  if (damage && targets.length) {
    const originalOracle = source.dataset.oracleText;
    source.dataset.oracleText = effect;
    applyResolvedDamage(source, targets);
    source.dataset.oracleText = originalOracle;
  }
  const lifeGain = effect.match(/\bgain(?:s)?\s+(\d+)\s+life\b/i);
  if (lifeGain) {
    const life = seatSection(controller)?.querySelector(".life-input");
    life.value = String(Math.min(999, Number(life.value || 0) + Number(lifeGain[1])));
  }
  const draw = effect.match(/\bdraw\s+(a|one|two|three|four|five|\d+)\s+cards?\b/i);
  if (draw) {
    const numbers = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
    const amount = Number(draw[1]) || numbers[draw[1].toLowerCase()] || 1;
    const library = document.querySelector(`[data-zone="${controller}-library"]`);
    const hand = document.querySelector(`[data-zone="${controller}-hand"]`);
    for (let index = 0; index < amount; index += 1) {
      const topCard = library.querySelector(":scope > .board-card:last-of-type");
      if (!topCard) break;
      hand.append(topCard);
      refreshCardState(topCard);
    }
  }
  const addManaMatch = effect.match(/\badd\s+\{([WUBRGC])\}/i);
  if (addManaMatch) {
    manaPool[addManaMatch[1].toUpperCase()] += 1;
    renderManaPool();
  }
  const abilityKind = activeTrigger.type === "activated" ? "activated ability" : "triggered ability";
  showMessage(
    counterResults.length || stateResults.length
      ? `${source.dataset.cardName}'s ability resolved: ${[...counterResults, ...stateResults].join("; ")}.`
      : `${source.dataset.cardName}'s ${abilityKind} resolved.`,
    "success",
  );
  activeTrigger = null;
  abilityTargetingController?.abort();
  abilityTargetingController = null;
  document.querySelectorAll(".legal-ability-target, .chosen-ability-target").forEach((target) => target.classList.remove("legal-ability-target", "chosen-ability-target"));
  abilityCostBar.hidden = true;
  triggerViewer.hidden = true;
  triggerViewer.classList.remove("death-trigger-viewer");
  triggerViewerBackdrop.hidden = true;
  resolveTriggerButton.dataset.mode = "resolve";
  showNextTriggeredAbility();
}

function updateTargetPrompt() {
  const remaining = requiredTargetCount - chosenTargets.length;
  const names = chosenTargets.map(targetLabel);
  spellTargetPrompt.querySelector("strong").textContent = remaining > 0
    ? `Choose ${remaining} more target${remaining === 1 ? "" : "s"}`
    : "Target selected";
  spellTargetPrompt.querySelector("span").textContent = names.length
    ? names.join(", ")
    : "Select a highlighted player or card on the board.";
  resolveSpellButton.disabled = remaining > 0;
  spellTargetOptions.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", chosenTargets.includes(button.targetElement));
    button.setAttribute("aria-pressed", String(chosenTargets.includes(button.targetElement)));
  });
}

function toggleSpellTarget(candidate) {
  const selectedIndex = chosenTargets.indexOf(candidate);
  if (selectedIndex >= 0) {
    chosenTargets.splice(selectedIndex, 1);
    candidate.classList.remove("chosen-spell-target");
  } else if (chosenTargets.length < requiredTargetCount) {
    chosenTargets.push(candidate);
    candidate.classList.add("chosen-spell-target");
  }
  updateTargetPrompt();
}

function beginTargetSelection(oracleText, presetTargets = []) {
  requiredTargetCount = targetCountFor(oracleText);
  chosenTargets = presetTargets.slice(0, requiredTargetCount);
  targetingController?.abort();
  targetingController = new AbortController();
  spellTargetPrompt.hidden = requiredTargetCount === 0;
  resolveSpellButton.disabled = requiredTargetCount > 0;
  spellStackBackdrop.hidden = requiredTargetCount > 0;
  if (!requiredTargetCount) return;

  const candidates = eligibleTargetsFor(oracleText);
  spellTargetOptions.replaceChildren();
  candidates.forEach((candidate) => {
    candidate.classList.add("legal-spell-target");
    const selectButton = document.createElement("button");
    selectButton.className = "select-spell-target";
    selectButton.type = "button";
    selectButton.textContent = targetLabel(candidate);
    selectButton.setAttribute("aria-label", `Target ${targetLabel(candidate)}`);
    selectButton.setAttribute("aria-pressed", "false");
    selectButton.targetElement = candidate;
    selectButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSpellTarget(candidate);
    });
    spellTargetOptions.append(selectButton);
  });
  updateTargetPrompt();
  showMessage(`Choose ${requiredTargetCount} highlighted target${requiredTargetCount === 1 ? "" : "s"} for ${resolvingSpell.dataset.cardName}.`);
}

function clearTargetSelection() {
  targetingController?.abort();
  targetingController = null;
  document.querySelectorAll(".legal-spell-target, .chosen-spell-target").forEach((target) => {
    target.classList.remove("legal-spell-target", "chosen-spell-target");
  });
  spellTargetOptions.replaceChildren();
  chosenTargets = [];
  requiredTargetCount = 0;
}

function activateSpellEffect(cardElement, presetTargets = []) {
  resolvingSpell = cardElement;
  cardElement.hidden = true;
  document.body.append(cardElement);
  spellStackImage.src = cardElement.querySelector("img")?.src || "";
  spellStackImage.alt = cardElement.dataset.cardName;
  spellStackTitle.textContent = cardElement.dataset.cardName;
  const paidCost = cardElement.dataset.lastPaidCost || cardElement.dataset.manaCost;
  setManaText(spellStackMeta, `${paidCost} · ${cardElement.dataset.typeLine}${cardElement.dataset.printedCastCost && cardElement.dataset.printedCastCost !== paidCost ? ` · reduced from ${cardElement.dataset.printedCastCost}` : ""}`);
  const effectText = resolvedOracleText(cardElement);
  setManaText(spellOracleText, effectText || "This card has no Oracle rules text.");
  spellStack.hidden = false;
  spellStackBackdrop.hidden = false;
  document.body.classList.add("resolving-spell");
  beginTargetSelection(effectText, presetTargets);
  if (!requiredTargetCount) {
    resolveSpellButton.focus();
    showMessage(`${cardElement.dataset.cardName} is on the stack. Resolve its effect.`, "success");
  }
}

/** Clears the stack UI and puts a finished (or countered) spell into its rest zone. */
function retireResolvedSpell(card) {
  clearTargetSelection();
  resolvingSpell = null;
  const destination = card.dataset.castFromFlashback === "true" || card.dataset.castExilesOnResolve === "true"
    ? "player-exile"
    : "player-graveyard";
  delete card.dataset.castFromFlashback;
  delete card.dataset.castExilesOnResolve;
  delete card.dataset.graveyardCastKeyword;
  delete card.dataset.lastPaidCost;
  delete card.dataset.printedCastCost;
  delete card.dataset.surgePaid;
  delete card.dataset.resolutionEffectOverride;
  document.querySelector(`[data-zone="${destination}"]`).append(card);
  card.hidden = false;
  card.classList.add("spell-resolved");
  refreshCardState(card);
  spellStack.hidden = true;
  spellStackBackdrop.hidden = true;
  document.body.classList.remove("resolving-spell");
}

function resolveActiveSpell() {
  if (!resolvingSpell) return;
  const card = resolvingSpell;
  const effectText = resolvedOracleText(card);
  if (!card.dataset.resolutionEffectOverride) {
    const choices = effectChoicesFor(effectText);
    if (choices.length) {
      showEffectChoice(choices, (choice) => {
        card.dataset.resolutionEffectOverride = choice.effect;
        resolveActiveSpell();
      });
      return;
    }
  }
  const resolvedTargets = chosenTargets.map(targetLabel);
  const targetElements = [...chosenTargets];
  const ward = unpaidWardTarget(targetElements);
  if (ward) {
    retireResolvedSpell(card);
    showMessage(
      `${card.dataset.cardName} was countered — ${ward.target.dataset.cardName} has ward ${ward.cost} and your mana pool couldn't pay it.`,
      "error",
    );
    return;
  }
  const counterResults = applyPlayerCounterEffects(effectText, "player", targetElements);
  const stateResults = applyPermanentStateEffects(effectText, "player", targetElements);
  const originalOracleText = card.dataset.oracleText;
  card.dataset.oracleText = effectText;
  const damageResults = applyResolvedDamage(card, targetElements);
  card.dataset.oracleText = originalOracleText;
  void createTokensFromEffect(effectText, "player");
  retireResolvedSpell(card);
  showMessage(
    damageResults.length || counterResults.length || stateResults.length
      ? `${card.dataset.cardName} resolved: ${[...damageResults, ...counterResults, ...stateResults].join("; ")}.`
      : `${card.dataset.cardName}'s effect resolved${resolvedTargets.length ? ` on ${resolvedTargets.join(", ")}` : ""}.`,
    "success",
  );
}

function payForCard(cardElement, alternateCost = "") {
  const typeLine = cardElement.dataset.typeLine;
  if (resolvingSpell) {
    showMessage(`Resolve ${resolvingSpell.dataset.cardName} before casting another spell.`, "error");
    return false;
  }

  const permission = castingPermission(typeLine);
  if (!permission.allowed) {
    showMessage(permission.reason, "error");
    return false;
  }

  const printedCost = alternateCost || cardElement.dataset.manaCost;
  if (!printedCost) {
    showMessage("This card has no payable mana cost.", "error");
    return false;
  }
  const cost = effectiveSpellCost(cardElement, printedCost);
  const payment = spendManaFor(cost);
  if (!payment.paid) {
    showMessage(payment.reason, "error");
    return false;
  }
  cardElement.dataset.lastPaidCost = cost;
  cardElement.dataset.printedCastCost = printedCost;
  if (cost !== printedCost) showMessage(`${cardElement.dataset.cardName}'s cost was reduced from ${printedCost} to ${cost}.`, "success");
  return true;
}

function clearCastDropTargets() {
  castDropTargets.forEach((target) => target.classList.remove("legal-cast-drop", "cast-drag-over"));
  castDropTargets = [];
}

function combinedManaCosts(...costs) {
  return costs.flatMap((cost) => parseCost(cost)).map((symbol) => `{${symbol}}`).join("") || "{0}";
}

function finishCardCast(cardElement, target, castingWithFlashback = false, alternateCost = "", kicked = false, surged = false, afterPayment = null) {
  abilityCostBar.hidden = true;
  cancelPermanentCostButton.textContent = "Cancel";
  pendingKickerCast = null;
  pendingSurgeCast = null;
  if (!payForCard(cardElement, alternateCost || (castingWithFlashback ? flashbackCostFor(cardElement) : ""))) return;
  afterPayment?.();
  if (kicked) cardElement.dataset.kicked = "true";
  else delete cardElement.dataset.kicked;
  if (surged) cardElement.dataset.surgePaid = "true";
  else delete cardElement.dataset.surgePaid;
  recordAlliedSpellCast();
  applyProwessTriggers(cardElement);
  emitGameEvent("spell-cast", { card: cardElement, kicked, surged });
  if (/Instant|Sorcery/.test(cardElement.dataset.typeLine)) {
    if (castingWithFlashback) cardElement.dataset.castFromFlashback = "true";
    const presetTargets = target.matches(".life-total, .board-card") ? [target] : [];
    activateSpellEffect(cardElement, presetTargets);
    return;
  }
  resolvePermanent(cardElement, document.querySelector('[data-zone="player-battlefield"]'));
}

function offerKickerChoice(cardElement, target, kickerCost) {
  pendingKickerCast = { cardElement, target, kickerCost };
  const combinedCost = combinedManaCosts(cardElement.dataset.manaCost, kickerCost);
  abilityCostBar.hidden = false;
  abilityCostBar.querySelector("strong").textContent = `Kick ${cardElement.dataset.cardName}?`;
  abilityCostBarCopy.textContent = `Cast normally for ${cardElement.dataset.manaCost}, or kicked for ${combinedCost}.`;
  payPermanentCostButton.hidden = false;
  payPermanentCostButton.disabled = false;
  payPermanentCostButton.textContent = `Kick ${kickerCost}`;
  cancelPermanentCostButton.textContent = "Cast normally";
}

function offerSurgeChoice(cardElement, target, surgeCost, castingWithFlashback = false, allowNormal = true) {
  pendingSurgeCast = { cardElement, target, surgeCost, castingWithFlashback, allowNormal };
  abilityCostBar.hidden = false;
  abilityCostBar.querySelector("strong").textContent = `Use surge for ${cardElement.dataset.cardName}?`;
  abilityCostBarCopy.textContent = `You or a teammate cast a spell this turn. Pay ${surgeCost} instead of ${cardElement.dataset.manaCost}.`;
  payPermanentCostButton.hidden = false;
  payPermanentCostButton.disabled = false;
  payPermanentCostButton.textContent = `Pay surge ${surgeCost}`;
  cancelPermanentCostButton.textContent = allowNormal ? "Pay normal cost" : "Cancel";
}

function prepareCastDropTargets(cardElement) {
  clearCastDropTargets();
  const typeLine = cardElement.dataset.typeLine;
  const oracleText = cardElement.dataset.oracleText || "";
  if (/Instant|Sorcery/.test(typeLine) && /\btarget\b/i.test(oracleText)) {
    castDropTargets = eligibleTargetsFor(oracleText);
  } else {
    castDropTargets = [document.querySelector('[data-zone="player-battlefield"]')];
  }
  castDropTargets.forEach((target) => target?.classList.add("legal-cast-drop"));
}

function castCardByDrop(cardElement, target) {
  const typeLine = cardElement.dataset.typeLine;
  const castingWithFlashback = cardElement.parentElement?.dataset.zone === "player-graveyard";
  if (typeLine.includes("Land")) {
    if (target.dataset.zone !== "player-battlefield") return;
    target.append(cardElement);
    cardElement.dataset.manaReadyAt = String(Date.now() + 500);
    cardElement.classList.add("land-entering");
    refreshCardState(cardElement);
    window.setTimeout(() => {
      delete cardElement.dataset.manaReadyAt;
      cardElement.classList.remove("land-entering");
    }, 500);
    showMessage(`${cardElement.dataset.cardName} played as a land.`, "success");
    return;
  }
  if (castingWithFlashback) {
    const options = graveyardCastOptionsFor(cardElement);
    if (!options.length) return;
    if (options.length > 1) offerGraveyardCastChoice(cardElement, target, options);
    else beginGraveyardCast(cardElement, target, options[0]);
    return;
  }
  const kickerCost = !castingWithFlashback && typeLine.includes("Creature") ? kickerCostFor(cardElement) : "";
  if (kickerCost) {
    offerKickerChoice(cardElement, target, kickerCost);
    return;
  }
  const surgeCost = !castingWithFlashback ? surgeCostFor(cardElement) : "";
  if (surgeCost && surgeIsAvailable()) {
    offerSurgeChoice(cardElement, target, surgeCost, castingWithFlashback);
    return;
  }
  finishCardCast(cardElement, target, castingWithFlashback);
}

function refreshCardState(element) {
  const zone = element.parentElement?.dataset.zone || "";
  const inPlayerHand = zone === "player-hand";
  const inPlayerGraveyard = zone === "player-graveyard";
  const onPlayerBattlefield = zone === "player-battlefield";
  // Graveyard and exile are both "off the battlefield": reset combat state there.
  const inGraveyard = zone.endsWith("-graveyard") || zone.endsWith("-exile");
  const isLand = element.dataset.typeLine.includes("Land");
  const manaTypes = JSON.parse(element.dataset.producedMana || "[]");
  updateStunCounterBadge(element);
  updateKeywordBadge(element);
  element.classList.toggle(
    "has-activated-ability",
    !editingMode && (onPlayerBattlefield || inPlayerGraveyard) && activatedAbilitiesFor(element).length > 0,
  );

  const awaitingPlacement = element.classList.contains("awaiting-placement");
  if (inGraveyard) {
    element.classList.remove(
      "tapped",
      "summoning-sick",
      "declared-attacker",
      "blocked-attacker",
      "declared-blocker",
      "attacking-animation",
      "blocking-animation",
    );
    element.querySelector(".summoning-sick-badge")?.remove();
    element.querySelector(".temporary-effect-badge")?.remove();
    delete element.dataset.enteredTurn;
    delete element.dataset.temporaryPowerModifier;
    delete element.dataset.temporaryToughnessModifier;
    delete element.dataset.temporaryKeywords;
    element.dataset.currentPower = element.dataset.basePower;
    element.dataset.currentToughness = element.dataset.baseToughness;
    element.classList.remove("temporary-modified");
  }
  const graveyardCastOptions = inPlayerGraveyard ? graveyardCastOptionsFor(element) : [];
  const canCastFromGraveyard = !editingMode && graveyardCastOptions.length > 0;
  const graveyardCastSummary = graveyardCastOptions.map(graveyardCastLabel).join(" · ");
  element.draggable = editingMode || inPlayerHand || canCastFromGraveyard;
  element.setAttribute("aria-label", editingMode
    ? `${element.dataset.cardName}. Drag to move.`
    : inPlayerHand
      ? `${element.dataset.cardName}. Drag to play or cast.`
      : canCastFromGraveyard
        ? `${element.dataset.cardName}. ${graveyardCastSummary}. Drag to cast from the graveyard.`
        : element.dataset.cardName);
  element.querySelector(".cast-card")?.remove();
  element.querySelector(".mana-actions")?.remove();
  element.querySelector(".flashback-badge")?.remove();
  element.classList.remove("single-mana-land", "multi-mana-land");

  if (canCastFromGraveyard) {
    const badge = document.createElement("span");
    badge.className = "flashback-badge";
    setManaText(badge, graveyardCastSummary);
    badge.title = graveyardCastOptions
      .map((option) => keywordDefinition(option.keyword)?.summary || option.keyword)
      .join("\n");
    element.append(badge);
  }

  if (!editingMode && onPlayerBattlefield && isLand && manaTypes.length) {
    const payableManaTypes = manaTypes.filter((type) => MANA_TYPES.includes(type));
    if (payableManaTypes.length === 1) {
      element.classList.add("single-mana-land");
      element.title = element.classList.contains("tapped")
        ? `${element.dataset.cardName} is tapped`
        : `Click ${element.dataset.cardName} to tap for {${payableManaTypes[0]}}`;
      return;
    }
    if (landTapsOnlyForMana(element)) {
      element.classList.add("multi-mana-land");
      element.title = element.classList.contains("tapped")
        ? `${element.dataset.cardName} is tapped`
        : `Click ${element.dataset.cardName} to tap it and choose from {${payableManaTypes.join("} {")}}`;
    }
    const actions = document.createElement("div");
    actions.className = "mana-actions";
    payableManaTypes.forEach((type) => {
      const choice = document.createElement("button");
      choice.className = "mana-choice is-pip";
      choice.type = "button";
      choice.innerHTML = manaPipHtml(type);
      choice.setAttribute("aria-label", `Tap for {${type}}`);
      choice.title = `Tap for {${type}}`;
      choice.disabled = element.classList.contains("tapped");
      choice.addEventListener("click", () => addMana(type, element));
      actions.append(choice);
    });
    element.append(actions);
  }
}

function resolvePermanent(card, battlefield) {
  const castFromHand = card.parentElement?.dataset.zone === "player-hand";
  if (card.dataset.pendingTransform === "true") transformToSecondFace(card);
  spellStack.hidden = true;
  spellStackBackdrop.hidden = true;
  document.body.classList.remove("resolving-spell");
  battlefield.append(card);
  card.classList.remove("awaiting-placement", "pointer-dragging", "selected-for-resolution");
  card.classList.add("permanent-resolved");
  card.removeAttribute("style");
  selectedPermanent = null;
  battlefield.classList.remove("resolve-target", "drag-over");
  if (castFromHand && card.dataset.typeLine.includes("Creature") && !cardHasHaste(card)) {
    card.dataset.enteredTurn = String(window.currentTurnNumber || 1);
    card.classList.add("summoning-sick");
    const badge = document.createElement("span");
    badge.className = "summoning-sick-badge";
    badge.textContent = "Summoning sick";
    badge.title = "This creature cannot attack until your next turn.";
    card.append(badge);
  }
  showMessage(`${card.dataset.cardName} resolved onto the battlefield.`, "success");
  window.setTimeout(() => card.classList.remove("permanent-resolved"), 650);
  refreshCardState(card);
  delete card.dataset.lastPaidCost;
  delete card.dataset.printedCastCost;
  emitGameEvent("permanent-enter", { card });
  delete card.dataset.kicked;
  delete card.dataset.surgePaid;
}

function createBoardCard(card) {
  const element = document.createElement("article");
  element.className = "board-card";
  element.tabIndex = 0;
  element.dataset.cardId = card.id;
  element.dataset.cardName = card.name;
  element.dataset.manaCost = manaCostFor(card);
  element.dataset.typeLine = card.type_line || card.card_faces?.[0]?.type_line || "";
  element.dataset.producedMana = JSON.stringify(card.produced_mana || []);
  element.dataset.oracleText = card.oracle_text || card.card_faces?.map((face) => face.oracle_text).filter(Boolean).join("\n\n") || "";
  element.dataset.keywords = JSON.stringify(card.keywords || []);
  element.dataset.baseToughness = card.toughness || card.card_faces?.find((face) => face.toughness)?.toughness || "";
  element.dataset.basePower = card.power || card.card_faces?.find((face) => face.power)?.power || "";
  element.dataset.baseLoyalty = card.loyalty || card.card_faces?.find((face) => face.loyalty)?.loyalty || "";
  const backFace = card.card_faces?.[1];
  if (backFace) {
    element.dataset.secondFace = JSON.stringify({
      name: backFace.name || "",
      typeLine: backFace.type_line || "",
      oracleText: backFace.oracle_text || "",
      manaCost: backFace.mana_cost || "",
      power: backFace.power || "",
      toughness: backFace.toughness || "",
      image: backFace.image_uris?.normal || "",
    });
  }
  element.dataset.damageMarked = "0";

  const image = document.createElement("img");
  image.src = cardImage(card);
  image.alt = card.name;
  image.loading = "lazy";

  const remove = document.createElement("button");
  remove.className = "remove-card";
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${card.name}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => element.remove());

  element.append(image, remove);
  attachCardHoverPreview(element, image.src, card.name);
  element.addEventListener("mouseenter", () => { hoveredBoardCard = element; });
  element.addEventListener("mouseleave", () => {
    if (hoveredBoardCard === element) hoveredBoardCard = null;
  });
  element.addEventListener("click", (event) => {
    const zone = element.parentElement?.dataset.zone;
    if (pendingManaChoice && pendingManaChoice.card !== element) closeManaChoicePrompt();
    if (pendingGraveyardCast?.requirement) {
      event.preventDefault();
      event.stopPropagation();
      const { requirement, selected, candidates } = pendingGraveyardCast;
      if (!candidates.includes(element)) {
        showMessage("Choose a highlighted card to pay this cost.", "error");
        return;
      }
      const chosenIndex = selected.indexOf(element);
      if (chosenIndex >= 0) selected.splice(chosenIndex, 1);
      else if (selected.length < requirement.count) selected.push(element);
      element.classList.toggle("chosen-ability-cost", selected.includes(element));
      abilityCostBarCopy.textContent = requirement.optional && !selected.length
        ? "Optional — choose one or cast without it."
        : `Selected ${selected.length} of ${requirement.count}`;
      payPermanentCostButton.disabled = !requirement.optional && selected.length !== requirement.count;
      payPermanentCostButton.textContent = requirement.optional
        ? (selected.length ? `Tap ${selected[0].dataset.cardName}` : "Cast without tapping")
        : `Pay cost (${selected.length}/${requirement.count})`;
      return;
    }
    if (pendingAbilityPayment?.requirement) {
      event.preventDefault();
      event.stopPropagation();
      const { requirement, selected } = pendingAbilityPayment;
      if (!requirement.candidates.includes(element)) {
        showMessage(`Choose a highlighted ${requirement.kind} to pay the ability cost.`, "error");
        return;
      }
      const selectedIndex = selected.indexOf(element);
      if (selectedIndex >= 0) selected.splice(selectedIndex, 1);
      else if (selected.length < requirement.count) selected.push(element);
      element.classList.toggle("chosen-ability-cost", selected.includes(element));
      abilityCostBarCopy.textContent = `Selected ${selected.length} of ${requirement.count}`;
      payPermanentCostButton.disabled = selected.length !== requirement.count;
      payPermanentCostButton.textContent = `Pay cost (${selected.length}/${requirement.count})`;
      return;
    }
    const canChooseSurge = !editingMode
      && zone === "player-hand"
      && surgeIsAvailable()
      && !pendingSurgeCast
      && Boolean(surgeCostFor(element));
    if (canChooseSurge && !event.target.closest("button")) {
      event.preventDefault();
      event.stopPropagation();
      openSurgeCastMenu(element);
      return;
    }
    const manaTypes = JSON.parse(element.dataset.producedMana || "[]").filter((type) => MANA_TYPES.includes(type));
    if (!editingMode && zone === "player-battlefield" && landTapsOnlyForMana(element) && !event.target.closest("button")) {
      event.preventDefault();
      event.stopPropagation();
      if (Number(element.dataset.manaReadyAt || 0) > Date.now()) return;
      if (element.classList.contains("tapped")) {
        showMessage(`${element.dataset.cardName} is already tapped.`, "error");
        return;
      }
      if (manaTypes.length === 1) {
        addMana(manaTypes[0], element);
        refreshCardState(element);
        return;
      }
      openManaChoicePrompt(element, manaTypes);
      return;
    }
    const canChooseActivatedAbility = !editingMode
      && (zone === "player-battlefield" || zone === "player-graveyard")
      && activatedAbilitiesFor(element).length > 0
      && !(window.currentTurnPhase === "Combat phase" && element.classList.contains("combat-eligible"));
    if (canChooseActivatedAbility && !event.target.closest("button")) {
      event.preventDefault();
      event.stopPropagation();
      openActivatedAbilityMenu(element);
      return;
    }
    if (!element.classList.contains("awaiting-placement") || event.target.closest("button")) return;
    selectedPermanent = element;
    element.classList.add("selected-for-resolution");
    showMessage(`${element.dataset.cardName} selected. Choose your highlighted battlefield.`, "success");
  });
  let pointerDrag = null;
  element.addEventListener("pointerdown", (event) => {
    const castingFromHand = !editingMode && isPlayableCastSource(element);
    const placingPermanent = element.classList.contains("awaiting-placement");
    if ((!placingPermanent && !castingFromHand) || event.target.closest("button")) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    pointerDrag = {
      pointerId: event.pointerId,
      width: rect.width,
      height: rect.height,
      castingFromHand,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (castingFromHand) prepareCastDropTargets(element);
    element.setPointerCapture(event.pointerId);
    element.classList.add("pointer-dragging");
    Object.assign(element.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      left: `${event.clientX - rect.width / 2}px`,
      top: `${event.clientY - rect.height / 2}px`,
    });
  });
  element.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    pointerDrag.clientX = event.clientX;
    pointerDrag.clientY = event.clientY;
    element.style.left = `${event.clientX - pointerDrag.width / 2}px`;
    element.style.top = `${event.clientY - pointerDrag.height / 2}px`;
  });
  function completePointerDrag(clientX, clientY) {
    if (!pointerDrag) return;
    const wasCastingFromHand = pointerDrag.castingFromHand;
    pointerDrag = null;
    const dropPoint = document.elementFromPoint(clientX, clientY);
    const castTarget = dropPoint?.closest(".legal-cast-drop");
    const destination = dropPoint?.closest('[data-zone="player-battlefield"]');
    element.classList.remove("pointer-dragging");
    element.removeAttribute("style");
    if (wasCastingFromHand && castTarget) {
      clearCastDropTargets();
      castCardByDrop(element, castTarget);
    } else if (!wasCastingFromHand && destination) {
      resolvePermanent(element, destination);
    } else {
      clearCastDropTargets();
    }
  }
  element.addEventListener("pointerup", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const { clientX, clientY } = event;
    element.releasePointerCapture(event.pointerId);
    completePointerDrag(clientX, clientY);
  });
  element.addEventListener("lostpointercapture", () => {
    if (!pointerDrag) return;
    completePointerDrag(pointerDrag.clientX, pointerDrag.clientY);
  });
  element.addEventListener("dragstart", (event) => {
    closeManaChoicePrompt();
    const inHand = isPlayableCastSource(element);
    if (!editingMode && !inHand && !element.classList.contains("awaiting-placement")) {
      event.preventDefault();
      return;
    }
    hideCardHoverPreview();
    draggedCard = element;
    if (!editingMode && inHand) prepareCastDropTargets(element);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
    window.requestAnimationFrame(() => element.classList.add("dragging"));
  });
  element.addEventListener("dragend", () => {
    draggedCard = null;
    element.classList.remove("dragging");
    allZones().forEach((zone) => zone.classList.remove("drag-over"));
    clearCastDropTargets();
  });
  refreshCardState(element);
  return element;
}

function placeSelectedCard(zone) {
  if (!selectedCard) return;
  const element = createBoardCard(selectedCard);
  zone.append(element);
  refreshCardState(element);
  recalculateStaticAbilities();
  cancelPlacement();
}

function renderResults(cards) {
  importer.results.replaceChildren();
  cards.slice(0, MAX_RESULTS).forEach((card) => {
    const result = document.createElement("button");
    result.className = "search-result";
    result.type = "button";
    const image = document.createElement("img");
    image.src = cardThumbnail(card);
    image.alt = "";
    image.loading = "lazy";
    const details = document.createElement("span");
    details.className = "result-details";
    const name = document.createElement("strong");
    name.textContent = card.name;
    const meta = document.createElement("span");
    meta.textContent = `${manaCostFor(card) || "Land / no cost"} · ${card.type_line}`;
    details.append(name, meta);
    result.append(image, details);
    attachCardHoverPreview(result, cardImage(card), card.name);
    result.addEventListener("click", () => beginPlacement(card));
    importer.results.append(result);
  });
}

async function searchCards(event) {
  event.preventDefault();
  const query = importer.query.value.trim();
  if (!query) return;
  importer.status.textContent = `Searching for “${query}”…`;
  importer.results.replaceChildren();
  try {
    const url = new URL(SCRYFALL_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("unique", "cards");
    url.searchParams.set("order", "name");
    const response = await fetch(url, { headers: { Accept: "application/json;q=0.9,*/*;q=0.8" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.details || "Scryfall could not complete that search.");
    renderResults(payload.data);
    importer.status.textContent = `${payload.total_cards} result${payload.total_cards === 1 ? "" : "s"}. Choose a card to place it.`;
  } catch (error) {
    importer.status.textContent = error.message || "Unable to reach Scryfall. Please try again.";
  }
}

importer.trigger.addEventListener("click", openImporter);
importer.editToggle.addEventListener("click", () => setEditingMode(!editingMode));
saveManagerTrigger.addEventListener("click", openSaveManager);
clearBoardButton.addEventListener("click", clearCurrentBoard);
closeSaveManagerButton.addEventListener("click", closeSaveManager);
saveManagerBackdrop.addEventListener("click", closeSaveManager);
importer.close.addEventListener("click", closeImporter);
importer.backdrop.addEventListener("click", closeImporter);
importer.form.addEventListener("submit", searchCards);
importer.toastCancel.addEventListener("click", cancelPlacement);
clearManaButton.addEventListener("click", clearManaPool);
document.addEventListener("turn:untap", () => {
  closeManaChoicePrompt();
  alliedSpellCastTurn = 0;
  restoreCreaturesAtEndOfTurn();
  untapAllPermanents();
});
document.addEventListener("team:spellcast", recordAlliedSpellCast);
document.addEventListener("turn:phasechange", (event) => {
  closeManaChoicePrompt();
  clearAiTurnTimer();
  paintSeatTurnMarkers();
  emitGameEvent("phase", { phase: event.detail.phase });
  if (event.detail.phase === "End step") resolveEndStepDelayedEffects();
  if (event.detail.phase === "Combat phase") beginCombatDeclaration();
  else {
    cleanupCombat();
  }
  // A computer seat plays its own turn out; the human drives their own.
  const seatId = activeSeat();
  if (isAiSeat(seatId) && !editingMode) runAiPhase(seatId, event.detail.phase);
});
resolveSpellButton.addEventListener("click", resolveActiveSpell);
resolveTriggerButton.addEventListener("click", resolveTriggeredAbility);
payPermanentCostButton.addEventListener("click", () => {
  if (pendingEffectChoice) {
    applyPendingEffectChoice(0);
    return;
  }
  if (pendingSurgeCast) {
    const { cardElement, target, surgeCost, castingWithFlashback } = pendingSurgeCast;
    finishCardCast(cardElement, target, castingWithFlashback, surgeCost, false, true);
    return;
  }
  if (pendingKickerCast) {
    const { cardElement, target, kickerCost } = pendingKickerCast;
    finishCardCast(cardElement, target, false, combinedManaCosts(cardElement.dataset.manaCost, kickerCost), true);
    return;
  }
  if (pendingGraveyardCast) {
    const { card, target, option, selected } = pendingGraveyardCast;
    finishGraveyardCast(card, target, option, [...selected]);
    return;
  }
  if (activeTrigger?.type === "activated" && targetCountFor(activeTrigger.effect) > 0) {
    if (activeTrigger.targets.length === targetCountFor(activeTrigger.effect)) resolveTriggeredAbility();
    return;
  }
  if (!pendingAbilityPayment?.requirement || pendingAbilityPayment.selected.length !== pendingAbilityPayment.requirement.count) return;
  beginActivatedAbility(pendingAbilityPayment.source, pendingAbilityPayment.ability, [...pendingAbilityPayment.selected]);
});
cancelPermanentCostButton.addEventListener("click", () => {
  if (pendingEffectChoice) {
    applyPendingEffectChoice(1);
    return;
  }
  if (pendingSurgeCast) {
    const { cardElement, target, castingWithFlashback, allowNormal } = pendingSurgeCast;
    if (!allowNormal) {
      pendingSurgeCast = null;
      abilityCostBar.hidden = true;
      cancelPermanentCostButton.textContent = "Cancel";
      return;
    }
    finishCardCast(cardElement, target, castingWithFlashback);
    return;
  }
  if (pendingKickerCast) {
    const { cardElement, target } = pendingKickerCast;
    finishCardCast(cardElement, target, false, "", false);
    return;
  }
  if (pendingGraveyardCast) {
    const cancelled = pendingGraveyardCast.card.dataset.cardName;
    clearGraveyardCastPrompt();
    showMessage(`Cancelled casting ${cancelled} from your graveyard.`, "error");
    return;
  }
  closeActivatedAbilityMenu();
});

// Delegated, so seats added during editing get working life controls for free.
document.addEventListener("click", (event) => {
  const button = event.target.closest(".life-adjust");
  if (!button || !editingMode) return;
  const input = button.parentElement.querySelector(".life-input");
  const nextValue = Math.max(0, Math.min(999, Number(input.value || 0) + Number(button.dataset.delta)));
  input.value = String(nextValue);
});

document.addEventListener("change", (event) => {
  const input = event.target.closest(".life-input");
  if (!input) return;
  const value = Number(input.value);
  input.value = String(Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(value))) : 0);
});

document.addEventListener("keydown", (event) => {
  if (editingMode && event.key.toLowerCase() === "t" && !event.target?.matches?.("input, textarea")) {
    const focusedCard = document.activeElement?.closest?.(".board-card");
    const card = focusedCard || hoveredBoardCard;
    const zone = card?.parentElement?.dataset.zone || "";
    if (card && zone.endsWith("-battlefield")) {
      event.preventDefault();
      card.classList.toggle("tapped");
      refreshCardState(card);
      showMessage(`${card.dataset.cardName} ${card.classList.contains("tapped") ? "tapped" : "untapped"}.`, "success");
      return;
    }
  }
  if (event.key !== "Escape") return;
  if (pendingManaChoice) {
    closeManaChoicePrompt();
    return;
  }
  if (activeAbilitySource) {
    closeActivatedAbilityMenu();
    return;
  }
  if (!graveyardViewer.hidden) {
    closeGraveyardViewer();
    return;
  }
  if (!seatBehaviorPanel.hidden) {
    closeSeatBehavior();
    return;
  }
  if (selectedCard) cancelPlacement();
  else if (importer.drawer.getAttribute("aria-hidden") === "false") closeImporter();
});

// Capture phase: any click that isn't the prompt or its own land ends the tap.
document.addEventListener("click", (event) => {
  if (!pendingManaChoice) return;
  if (event.target.closest?.(".mana-choice-prompt")) return;
  if (event.target.closest?.(".board-card") === pendingManaChoice.card) return;
  closeManaChoicePrompt();
}, { capture: true });

document.addEventListener("click", (event) => {
  const attacker = event.target.closest('[data-zone="player-battlefield"] .combat-eligible');
  if (!attacker || editingMode || window.currentTurnPhase !== "Combat phase") return;
  if (activeSeat() !== HUMAN_SEAT) return;
  event.preventDefault();
  if (combatAssignments.has(attacker)) {
    combatAssignments.delete(attacker);
    attacker.classList.remove("declared-attacker");
    delete attacker.dataset.attackTarget;
    clearCombatTargetPrompt();
    updateCombatButton();
    showMessage(`${attacker.dataset.cardName} removed from combat.`);
    return;
  }
  chooseAttackerTarget(attacker);
});

document.addEventListener("dragover", (event) => {
  if (editingMode || !draggedCard || !isPlayableCastSource(draggedCard)) return;
  const target = event.target.closest(".legal-cast-drop");
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  castDropTargets.forEach((candidate) => candidate.classList.toggle("cast-drag-over", candidate === target));
}, true);

document.addEventListener("drop", (event) => {
  if (editingMode || !draggedCard || !isPlayableCastSource(draggedCard)) return;
  const target = event.target.closest(".legal-cast-drop");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  const card = draggedCard;
  clearCastDropTargets();
  castCardByDrop(card, target);
}, true);

// A board always opens against a single opponent; more seats are added in edit
// mode. Build it before the sweep below so its zones are wired like any other.
buildSeat(AI_SEAT_IDS[0]);
paintSeatTurnMarkers();

// Every zone on the board wires itself the same way, human seat or not.
allZones().forEach(registerZone);

addSeatButton.addEventListener("click", addSeat);
closeSeatBehaviorButton.addEventListener("click", closeSeatBehavior);
seatBehaviorBackdrop.addEventListener("click", closeSeatBehavior);
seatBehaviorForm.addEventListener("input", saveSeatBehaviorFromForm);
seatBehaviorForm.addEventListener("change", saveSeatBehaviorFromForm);
seatBehaviorForm.addEventListener("submit", (event) => event.preventDefault());

// Seat controls are rebuilt with each seat, so delegate from the board.
gameBoard.addEventListener("click", (event) => {
  const seatId = event.target.closest(".ai-seat")?.dataset.seat;
  if (!seatId) return;
  if (event.target.closest(".seat-behavior")) {
    event.stopPropagation();
    openSeatBehavior(seatId);
  }
  if (event.target.closest(".seat-remove")) {
    event.stopPropagation();
    removeSeat(seatId);
  }
});

closeGraveyardViewerButton.addEventListener("click", closeGraveyardViewer);
graveyardViewerBackdrop.addEventListener("click", closeGraveyardViewer);
updateGraveyardDisplays();
updateExileDisplays();

arrangeLandStacks();
recalculateStaticAbilities();

renderManaPool();
setEditingMode(false);

cancelManaChoiceButton.addEventListener("click", closeManaChoicePrompt);
