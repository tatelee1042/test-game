const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const MAX_RESULTS = 8;
const MANA_TYPES = ["W", "U", "B", "R", "G", "C"];

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
const lifeInputs = [...document.querySelectorAll(".life-input")];
const lifeAdjustButtons = [...document.querySelectorAll(".life-adjust")];
const playerCounterElements = [...document.querySelectorAll(".player-counter")];
const zones = [...document.querySelectorAll(".drop-zone")];
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
const cardHoverPreview = document.querySelector(".card-hover-preview");
const cardHoverPreviewImage = cardHoverPreview.querySelector("img");
const saveManagerTrigger = document.querySelector(".save-manager-trigger");
const clearBoardButton = document.querySelector(".clear-board");
const saveManager = document.querySelector(".save-manager");
const saveManagerBackdrop = document.querySelector(".save-manager-backdrop");
const closeSaveManagerButton = document.querySelector(".close-save-manager");
const saveSlotList = document.querySelector(".save-slot-list");
const graveyardViewer = document.querySelector(".graveyard-viewer");
const graveyardViewerBackdrop = document.querySelector(".graveyard-viewer-backdrop");
const graveyardViewerTitle = document.querySelector("#graveyard-viewer-title");
const graveyardViewerCards = document.querySelector(".graveyard-viewer-cards");
const closeGraveyardViewerButton = document.querySelector(".close-graveyard-viewer");
const graveyardZones = [...document.querySelectorAll('[data-zone$="graveyard"]')];
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
let pendingSurgeCast = null;
let pendingEffectChoice = null;
let alliedSpellCastTurn = 0;
const manaPool = Object.fromEntries(MANA_TYPES.map((type) => [type, 0]));

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
  const keywords = "first strike|double strike|deathtouch|defender|flying|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance";
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
  abilityCostBarCopy.textContent = `${choices[0].label} or ${choices[1].label}`;
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
  return zone === "player-hand" || (zone === "player-graveyard" && Boolean(flashbackCostFor(cardElement)));
}

function cardHasKeyword(cardElement, requestedKeyword) {
  const keywords = [
    ...JSON.parse(cardElement.dataset.keywords || "[]"),
    ...JSON.parse(cardElement.dataset.grantedKeywords || "[]"),
  ];
  return keywords.some((keyword) => keyword.toLowerCase() === requestedKeyword.toLowerCase());
}

function cardHasHaste(cardElement) {
  return cardHasKeyword(cardElement, "haste");
}

function canBlockAttacker(blocker, attacker) {
  if (!cardHasKeyword(attacker, "flying")) return true;
  return cardHasKeyword(blocker, "flying") || cardHasKeyword(blocker, "reach");
}

function showMessage(message, tone = "neutral") {
  window.clearTimeout(messageTimer);
  gameMessage.textContent = message;
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
  const counter = document.querySelector(`.${player} .player-counter[data-counter="${type}"]`);
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
  if (/\beach opponent\b/i.test(effect)) recipients.add(controller === "player" ? "opponent" : "player");
  targets.filter((target) => target.classList.contains("life-total")).forEach((target) => {
    recipients.add(target.closest(".opponent") ? "opponent" : "player");
  });
  recipients.forEach((player) => addPlayerCounter(player, type, amount));
  return [...recipients].map((player) => `${player} gained ${amount} ${type} counter${amount === 1 ? "" : "s"}`);
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
    const supportedKeywords = [
      "first strike", "double strike", "deathtouch", "defender", "flying", "haste", "hexproof",
      "indestructible", "lifelink", "menace", "reach", "trample", "vigilance",
    ];
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
  graveyardZones.forEach((zone) => {
    const cards = [...zone.querySelectorAll(":scope > .board-card")];
    cards.forEach((card, index) => card.classList.toggle("graveyard-collapsed", cards.length > 1 && index < cards.length - 1));
    zone.querySelector(".zone-count").textContent = String(cards.length);
    const viewButton = zone.querySelector(".view-graveyard");
    viewButton.hidden = cards.length <= 1;
    viewButton.textContent = `View ${cards.length} cards`;
  });
}

function openGraveyardViewer(zone) {
  const cards = [...zone.querySelectorAll(":scope > .board-card")];
  const zoneRect = zone.getBoundingClientRect();
  graveyardViewer.style.setProperty("--grave-origin-x", `${zoneRect.left + zoneRect.width / 2 - window.innerWidth / 2}px`);
  graveyardViewer.style.setProperty("--grave-origin-y", `${zoneRect.top + zoneRect.height / 2 - window.innerHeight / 2}px`);
  graveyardViewerTitle.textContent = zone.dataset.zone.startsWith("opponent-") ? "Opponent graveyard" : "Your graveyard";
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
    const symbol = document.createElement("span");
    symbol.className = `mana-symbol mana-${type.toLowerCase()}`;
    symbol.textContent = `${type} ${manaPool[type]}`;
    manaPoolElement.append(symbol);
  });
}

function clearManaPool() {
  MANA_TYPES.forEach((type) => {
    manaPool[type] = 0;
  });
  renderManaPool();
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

function arrangeMountainStacks() {
  document.querySelectorAll('[data-zone$="battlefield"]').forEach((battlefield) => {
    [...battlefield.querySelectorAll(":scope > .board-card")].forEach((card) => {
      const isMountain = /(?:^|—|\/\/).*\bMountain\b/i.test(card.dataset.typeLine || "");
      card.classList.toggle("mountain-land", isMountain);
      if (!isMountain) card.style.removeProperty("--mountain-stack-index");
    });
    [...battlefield.querySelectorAll(":scope > .mountain-land")].forEach((mountain, index) => {
      mountain.style.setProperty("--mountain-stack-index", String(index));
      mountain.style.setProperty("--mountain-stack-offset", `${index * mountain.getBoundingClientRect().width * 0.5}px`);
    });
  });
}

window.addEventListener("resize", arrangeMountainStacks);

function untapAllPermanents(announce = true) {
  let stunCountersRemoved = 0;
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card.tapped').forEach((card) => {
    if (untapPermanent(card).stunRemoved) stunCountersRemoved += 1;
  });
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card.summoning-sick').forEach((card) => {
    if (Number(card.dataset.enteredTurn) < Number(window.currentTurnNumber || 1)) {
      card.classList.remove("summoning-sick");
      card.querySelector(".summoning-sick-badge")?.remove();
    }
  });
  clearManaPool();
  if (announce) showMessage(stunCountersRemoved
    ? `Untap step: ${stunCountersRemoved} stun counter${stunCountersRemoved === 1 ? " was" : "s were"} removed; those permanents stayed tapped.`
    : "Untap step: all your permanents untapped.", "success");
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
    card.dataset.grantedKeywords = "[]";
    card.classList.remove("static-modified");
    card.querySelector(".static-stats-badge")?.remove();
  });

  battlefieldCards.forEach((source) => {
    const sourceController = source.parentElement.dataset.zone.startsWith("opponent-") ? "opponent" : "player";
    staticAbilityLines(source).forEach((line) => {
      const statMatch = line.match(/^(Other\s+)?(.+?)\s+(you control|your opponents control)\s+get\s+([+-]\d+)\/([+-]\d+)/i);
      const keywordMatch = line.match(/^(Other\s+)?(.+?)\s+(you control|your opponents control)\s+have\s+(flying|haste|reach|vigilance|defender)\b/i);
      if (!statMatch && !keywordMatch) return;
      const match = statMatch || keywordMatch;
      const excludesSource = Boolean(match[1]);
      const subject = match[2];
      const affectsOpponents = match[3].toLowerCase().includes("opponents");
      battlefieldCards.forEach((card) => {
        const cardController = card.parentElement.dataset.zone.startsWith("opponent-") ? "opponent" : "player";
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
    const shouldBeSummoningSick = card.dataset.typeLine.includes("Creature") && enteredThisTurn && !cardHasKeyword(card, "haste");
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
  return target.classList.contains("life-total") ? "Enemy Planeswalker" : target.dataset.cardName;
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

function combatTargets() {
  return [
    document.querySelector('.opponent .life-total'),
    ...document.querySelectorAll('[data-zone="opponent-battlefield"] .board-card[data-type-line*="Planeswalker"]'),
  ].filter(Boolean);
}

function chooseAttackerTarget(attacker) {
  clearCombatTargetPrompt();
  pendingAttacker = attacker;
  attacker.classList.add("choosing-attack-target");
  combatAttackerName.textContent = `${attacker.dataset.cardName} (${attacker.dataset.currentPower || attacker.dataset.basePower || "?"} power)`;
  combatTargetOptions.replaceChildren();
  combatTargets().forEach((target) => {
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

function beginCombatDeclaration() {
  combatAssignments = new Map();
  combatResolved = false;
  clearCombatTargetPrompt();
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card').forEach((card) => {
    const enteredThisTurn = Number(card.dataset.enteredTurn || 0) >= Number(window.currentTurnNumber || 1)
      && !cardHasHaste(card);
    const canAttack = card.dataset.typeLine.includes("Creature")
      && !card.classList.contains("tapped")
      && !enteredThisTurn
      && !cardHasKeyword(card, "defender")
      && !/\bcan(?:not|'t) attack\b/i.test(card.dataset.oracleText || "");
    card.classList.toggle("summoning-sick", card.dataset.typeLine.includes("Creature") && enteredThisTurn);
    card.classList.toggle("combat-eligible", canAttack);
  });
  updateCombatButton();
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
      document.querySelector('[data-zone="opponent-graveyard"]').append(target);
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
  return [...availableBlockers].sort((left, right) => {
    const leftStats = creatureCombatStats(left);
    const rightStats = creatureCombatStats(right);
    const rank = (stats) => {
      const killsAttacker = stats.power >= attackerStats.remainingToughness;
      const survivesAttacker = stats.remainingToughness > attackerStats.power;
      if (killsAttacker && survivesAttacker) return 0;
      if (killsAttacker) return 1;
      if (survivesAttacker) return 2;
      return 3;
    };
    return rank(leftStats) - rank(rightStats)
      || leftStats.power + leftStats.toughness - (rightStats.power + rightStats.toughness);
  })[0] || null;
}

function declareAutomaticBlockers() {
  const available = new Set(
    [...document.querySelectorAll('[data-zone="opponent-battlefield"] .board-card')]
      .filter((card) => card.dataset.typeLine.includes("Creature") && !card.classList.contains("tapped")),
  );
  const blocks = new Map();
  combatAssignments.forEach((_target, attacker) => {
    if (!available.size) return;
    const legalBlockers = [...available].filter((blocker) => canBlockAttacker(blocker, attacker));
    const blocker = chooseBestBlocker(attacker, legalBlockers);
    if (!blocker) return;
    blocks.set(attacker, blocker);
    available.delete(blocker);
    attacker.classList.add("blocked-attacker");
    blocker.classList.add("declared-blocker");
    attacker.dataset.blockedBy = blocker.dataset.cardName;
    blocker.dataset.blocking = attacker.dataset.cardName;
  });
  return blocks;
}

function showDeclaredBlockers(blocks) {
  combatPrompt.hidden = false;
  combatPrompt.querySelector("strong").textContent = "Opponent declared blockers";
  combatAttackerName.textContent = blocks.size
    ? "Blocked creatures will exchange combat damage."
    : "No creatures were available to block.";
  combatTargetOptions.replaceChildren();
  if (!blocks.size) return;
  blocks.forEach((blocker, attacker) => {
    const assignment = document.createElement("span");
    assignment.className = "block-assignment";
    assignment.textContent = `${blocker.dataset.cardName} blocks ${attacker.dataset.cardName}`;
    combatTargetOptions.append(assignment);
  });
}

function markCombatDamage(card, amount) {
  const stats = creatureCombatStats(card);
  card.dataset.damageMarked = String(Number(card.dataset.damageMarked || 0) + amount);
  updateCreatureDamageBadge(card);
  return amount >= stats.remainingToughness;
}

function resolveCombatDamage(blocks) {
  let opponentDamage = 0;
  const lethalCreatures = new Set();
  combatAssignments.forEach((target, attacker) => {
    const attackerStats = creatureCombatStats(attacker);
    const blocker = blocks.get(attacker);
    attacker.classList.add("attacking-animation");
    if (!cardHasKeyword(attacker, "vigilance")) attacker.classList.add("tapped");
    if (blocker) {
      const blockerStats = creatureCombatStats(blocker);
      blocker.classList.add("blocking-animation");
      if (markCombatDamage(blocker, attackerStats.power)) lethalCreatures.add(blocker);
      if (markCombatDamage(attacker, blockerStats.power)) lethalCreatures.add(attacker);
      emitGameEvent("damage", { card: attacker, targets: [blocker], damage: attackerStats.power });
      emitGameEvent("damage", { card: blocker, targets: [attacker], damage: blockerStats.power });
      return;
    }
    if (target.classList.contains("life-total")) opponentDamage += attackerStats.power;
    else damagePlaneswalker(target, attackerStats.power);
    emitGameEvent("damage", { card: attacker, targets: [target], damage: attackerStats.power });
  });

  if (opponentDamage) {
    const opponentLife = document.querySelector('.opponent .life-input');
    opponentLife.value = String(Math.max(0, Number(opponentLife.value || 0) - opponentDamage));
  }
  lethalCreatures.forEach(sendLethalCreatureToGraveyard);
  combatResolved = true;
  combatPrompt.hidden = true;
  document.querySelectorAll(".combat-eligible").forEach((card) => card.classList.remove("combat-eligible"));
  window.setTimeout(() => {
    document.querySelectorAll(".attacking-animation, .blocking-animation").forEach((card) => {
      card.classList.remove("attacking-animation", "blocking-animation");
    });
  }, 650);
  updateCombatButton();
  showMessage(
    `Combat damage resolved${opponentDamage ? `: ${opponentDamage} damage to the opponent` : blocks.size ? ": blocked creatures exchanged damage" : ""}.`,
    "success",
  );
}

window.finishCombatAttackers = function finishCombatAttackers() {
  if (!combatAssignments.size || combatResolved) return false;
  clearCombatTargetPrompt();
  combatResolved = true;
  combatAssignments.forEach((_target, attacker) => emitGameEvent("attacks", { card: attacker }));
  const blocks = declareAutomaticBlockers();
  showDeclaredBlockers(blocks);
  nextPhaseButton.disabled = true;
  nextPhaseButton.textContent = "Opponent blocking…";
  window.setTimeout(() => resolveCombatDamage(blocks), 760);
  return true;
};


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
  lifeInputs.forEach((input) => {
    input.disabled = !enabled;
  });
  lifeAdjustButtons.forEach((button) => {
    button.disabled = !enabled;
  });
  document.querySelectorAll(".board-card").forEach(refreshCardState);

  if (!enabled) {
    cancelPlacement();
    if (importer.drawer.getAttribute("aria-hidden") === "false") closeImporter();
    closeSaveManager();
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

function captureBoardState() {
  return {
    savedAt: new Date().toISOString(),
    phase: window.currentTurnPhase || "Untap",
    turnNumber: window.currentTurnNumber || 1,
    life: lifeInputs.map((input) => input.value),
    counters: playerCounterElements.map((counter) => Number(counter.dataset.value || 0)),
    zones: Object.fromEntries(zones.map((zone) => [
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
  document.querySelectorAll(".board-card").forEach((card) => card.remove());
  lifeInputs.forEach((input, index) => {
    input.value = state.life?.[index] ?? "20";
  });
  playerCounterElements.forEach((counter, index) => {
    const value = Number(state.counters?.[index] || 0);
    counter.dataset.value = String(value);
    counter.textContent = `${counter.dataset.counter === "poison" ? "Poison" : "Experience"} ${value}`;
    counter.hidden = value === 0;
  });
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
  window.setTurnState?.(state.phase || "Untap", state.turnNumber || 1);
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
  lifeInputs.forEach((input) => { input.value = "20"; });
  playerCounterElements.forEach((counter) => {
    counter.dataset.value = "0";
    counter.hidden = true;
  });
  clearBoardButton.innerHTML = '<span aria-hidden="true">⌫</span> Clear board';
  showMessage("Current board cleared. Saved slots were not changed.", "success");
}

function cancelPlacement() {
  selectedCard = null;
  importer.toast.hidden = true;
  zones.forEach((zone) => zone.classList.remove("placement-target"));
}

function beginPlacement(card) {
  selectedCard = card;
  importer.toastImage.src = cardThumbnail(card);
  importer.toastImage.alt = card.name;
  importer.toast.querySelector("span").textContent = `Place ${card.name} in any highlighted zone`;
  importer.toast.hidden = false;
  zones.forEach((zone) => zone.classList.add("placement-target"));
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
  const controller = sourceCard.parentElement?.dataset.zone?.startsWith("opponent-") ? "opponent" : "player";
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
  const controller = source.parentElement?.dataset.zone?.startsWith("opponent-") ? "opponent" : "player";
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

  const controller = source.parentElement?.dataset.zone?.startsWith("opponent-") ? "opponent" : "player";
  const lifeInput = document.querySelector(`.${controller} .life-input`);
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

function movePermanentToGraveyard(card, { reason = "died", announce = false } = {}) {
  if (card.classList.contains("moving-to-graveyard")) return;
  const battlefieldZone = card.parentElement?.dataset.zone || "";
  const owner = battlefieldZone.startsWith("opponent-") ? "opponent" : "player";
  const died = battlefieldZone.endsWith("-battlefield") && card.dataset.typeLine.includes("Creature");
  card.classList.add("moving-to-graveyard");
  if (died) {
    card.classList.add("creature-dying");
    emitGameEvent("dies", { card, controller: owner, reason });
    card.setAttribute("aria-label", `${card.dataset.cardName} ${reason === "sacrificed" ? "was sacrificed and is dying" : "has died"}.`);
  }
  const delay = died ? 720 : 0;
  window.setTimeout(() => {
    document.querySelector(`[data-zone="${owner}-graveyard"]`).append(card);
    card.classList.remove("creature-dying", "moving-to-graveyard");
    card.classList.remove("static-lethal-pending");
    card.dataset.damageMarked = "0";
    updateCreatureDamageBadge(card);
    refreshCardState(card);
    if (announce) showMessage(`${card.dataset.cardName} died and was put into ${owner === "player" ? "your" : "the opponent's"} graveyard.`, "error");
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
  return [...candidates];
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
  triggerCondition.textContent = `Cost: ${ability.cost}`;
  triggerEffect.textContent = ability.effect;
  triggerTargetOptions.replaceChildren();
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", closeActivatedAbilityMenu);
  triggerTargetOptions.append(cancelButton);
  resolveTriggerButton.dataset.mode = "confirm-ability-cost";
  resolveTriggerButton.textContent = `Pay ${ability.cost}`;
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
  document.querySelectorAll(".legal-ability-cost, .chosen-ability-cost").forEach((card) => card.classList.remove("legal-ability-cost", "chosen-ability-cost"));
  abilityCostBar.hidden = true;
  pendingAbilityPayment = null;
  activeAbilitySource = null;
  activeTrigger = { source, effect: ability.effect, cost: ability.cost, targets: [], context: {}, type: "activated" };
  triggerViewerKind.textContent = "Activated ability";
  triggerCondition.textContent = `${ability.cost} paid`;
  triggerEffect.textContent = ability.effect;
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
  const controller = source.parentElement?.dataset.zone?.startsWith("opponent-") ? "opponent" : "player";
  const damage = fixedDamageAmount(effect);
  if (damage && !targets.length && /\b(each opponent|defending player)\b/i.test(effect)) {
    targets = [document.querySelector(`.${controller === "player" ? "opponent" : "player"} .life-total`)];
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
    const life = document.querySelector(`.${controller} .life-input`);
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
  spellStackMeta.textContent = `${paidCost} · ${cardElement.dataset.typeLine}${cardElement.dataset.printedCastCost && cardElement.dataset.printedCastCost !== paidCost ? ` · reduced from ${cardElement.dataset.printedCastCost}` : ""}`;
  const effectText = resolvedOracleText(cardElement);
  spellOracleText.textContent = effectText || "This card has no Oracle rules text.";
  spellStack.hidden = false;
  spellStackBackdrop.hidden = false;
  document.body.classList.add("resolving-spell");
  beginTargetSelection(effectText, presetTargets);
  if (!requiredTargetCount) {
    resolveSpellButton.focus();
    showMessage(`${cardElement.dataset.cardName} is on the stack. Resolve its effect.`, "success");
  }
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
  const counterResults = applyPlayerCounterEffects(effectText, "player", targetElements);
  const stateResults = applyPermanentStateEffects(effectText, "player", targetElements);
  const originalOracleText = card.dataset.oracleText;
  card.dataset.oracleText = effectText;
  const damageResults = applyResolvedDamage(card, targetElements);
  card.dataset.oracleText = originalOracleText;
  void createTokensFromEffect(effectText, "player");
  clearTargetSelection();
  resolvingSpell = null;
  const destination = card.dataset.castFromFlashback === "true" ? "player-exile" : "player-graveyard";
  delete card.dataset.castFromFlashback;
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

function finishCardCast(cardElement, target, castingWithFlashback = false, alternateCost = "", kicked = false, surged = false) {
  abilityCostBar.hidden = true;
  cancelPermanentCostButton.textContent = "Cancel";
  pendingKickerCast = null;
  pendingSurgeCast = null;
  if (!payForCard(cardElement, alternateCost || (castingWithFlashback ? flashbackCostFor(cardElement) : ""))) return;
  if (kicked) cardElement.dataset.kicked = "true";
  else delete cardElement.dataset.kicked;
  if (surged) cardElement.dataset.surgePaid = "true";
  else delete cardElement.dataset.surgePaid;
  recordAlliedSpellCast();
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
  const inGraveyard = zone.endsWith("-graveyard");
  const isLand = element.dataset.typeLine.includes("Land");
  const manaTypes = JSON.parse(element.dataset.producedMana || "[]");
  updateStunCounterBadge(element);
  element.classList.toggle(
    "has-activated-ability",
    !editingMode && onPlayerBattlefield && activatedAbilitiesFor(element).length > 0,
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
  const flashbackCost = inPlayerGraveyard ? flashbackCostFor(element) : "";
  const canCastWithFlashback = !editingMode && Boolean(flashbackCost);
  element.draggable = editingMode || inPlayerHand || canCastWithFlashback;
  element.setAttribute("aria-label", editingMode
    ? `${element.dataset.cardName}. Drag to move.`
    : inPlayerHand
      ? `${element.dataset.cardName}. Drag to play or cast.`
      : canCastWithFlashback
        ? `${element.dataset.cardName}. Flashback ${flashbackCost}. Drag to cast from the graveyard.`
        : element.dataset.cardName);
  element.querySelector(".cast-card")?.remove();
  element.querySelector(".mana-actions")?.remove();
  element.querySelector(".flashback-badge")?.remove();
  element.classList.remove("single-mana-land");

  if (inPlayerGraveyard && flashbackCost) {
    const badge = document.createElement("span");
    badge.className = "flashback-badge";
    badge.textContent = `Flashback ${flashbackCost}`;
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
    const actions = document.createElement("div");
    actions.className = "mana-actions";
    payableManaTypes.forEach((type) => {
      const choice = document.createElement("button");
      choice.className = `mana-choice mana-${type.toLowerCase()}`;
      choice.type = "button";
      choice.textContent = type;
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
    if (!editingMode && zone === "player-battlefield" && element.dataset.typeLine.includes("Land") && manaTypes.length === 1 && !event.target.closest("button")) {
      event.preventDefault();
      event.stopPropagation();
      if (Number(element.dataset.manaReadyAt || 0) > Date.now()) return;
      addMana(manaTypes[0], element);
      refreshCardState(element);
      return;
    }
    const canChooseActivatedAbility = !editingMode
      && zone === "player-battlefield"
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
    zones.forEach((zone) => zone.classList.remove("drag-over"));
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
  alliedSpellCastTurn = 0;
  restoreCreaturesAtEndOfTurn();
  untapAllPermanents();
});
document.addEventListener("team:spellcast", recordAlliedSpellCast);
document.addEventListener("turn:phasechange", (event) => {
  emitGameEvent("phase", { phase: event.detail.phase });
  if (event.detail.phase === "Combat phase") beginCombatDeclaration();
  else {
    cleanupCombat();
  }
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
  closeActivatedAbilityMenu();
});

lifeAdjustButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!editingMode) return;
    const input = button.parentElement.querySelector(".life-input");
    const nextValue = Math.max(0, Math.min(999, Number(input.value || 0) + Number(button.dataset.delta)));
    input.value = String(nextValue);
  });
});

lifeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const value = Number(input.value);
    input.value = String(Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(value))) : 0);
  });
});

document.addEventListener("keydown", (event) => {
  if (editingMode && event.key.toLowerCase() === "t" && !event.target.matches("input, textarea")) {
    const focusedCard = document.activeElement?.closest?.(".board-card");
    const card = focusedCard || hoveredBoardCard;
    const zone = card?.parentElement?.dataset.zone || "";
    if (card?.dataset.typeLine.includes("Creature") && zone.endsWith("-battlefield")) {
      event.preventDefault();
      card.classList.toggle("tapped");
      refreshCardState(card);
      showMessage(`${card.dataset.cardName} ${card.classList.contains("tapped") ? "tapped" : "untapped"}.`, "success");
      return;
    }
  }
  if (event.key !== "Escape") return;
  if (activeAbilitySource) {
    closeActivatedAbilityMenu();
    return;
  }
  if (!graveyardViewer.hidden) {
    closeGraveyardViewer();
    return;
  }
  if (selectedCard) cancelPlacement();
  else if (importer.drawer.getAttribute("aria-hidden") === "false") closeImporter();
});

document.addEventListener("click", (event) => {
  const attacker = event.target.closest('[data-zone="player-battlefield"] .combat-eligible');
  if (!attacker || editingMode || window.currentTurnPhase !== "Combat phase") return;
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

zones.forEach((zone) => {
  zone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (event.target.closest(".board-card") && !selectedCard) return;
    if (selectedPermanent && zone.dataset.zone === "player-battlefield") {
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
    const validResolution = resolvingPermanent && zone.dataset.zone === "player-battlefield";
    if (!draggedCard || (!editingMode && !validResolution)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (event) => {
    const resolvingPermanent = draggedCard?.classList.contains("awaiting-placement");
    const validResolution = resolvingPermanent && zone.dataset.zone === "player-battlefield";
    if (!editingMode && !validResolution) return;
    event.preventDefault();
    zone.classList.remove("drag-over");
    if (draggedCard) {
      const resolvedCard = draggedCard;
      zone.append(resolvedCard);
      if (resolvingPermanent) {
        resolvePermanent(resolvedCard, zone);
      } else {
        refreshCardState(resolvedCard);
      }
    }
  });
});

graveyardZones.forEach((zone) => {
  zone.querySelector(".view-graveyard").addEventListener("click", (event) => {
    event.stopPropagation();
    openGraveyardViewer(zone);
  });
  new MutationObserver(updateGraveyardDisplays).observe(zone, { childList: true });
});
closeGraveyardViewerButton.addEventListener("click", closeGraveyardViewer);
graveyardViewerBackdrop.addEventListener("click", closeGraveyardViewer);
updateGraveyardDisplays();

const staticAbilityObserver = new MutationObserver(() => recalculateStaticAbilities());
document.querySelectorAll('[data-zone$="battlefield"]').forEach((battlefield) => {
  staticAbilityObserver.observe(battlefield, { childList: true });
  new MutationObserver(arrangeMountainStacks).observe(battlefield, { childList: true });
});
arrangeMountainStacks();
recalculateStaticAbilities();

renderManaPool();
setEditingMode(false);
