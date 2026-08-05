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
const lifeInputs = [...document.querySelectorAll(".life-input")];
const lifeAdjustButtons = [...document.querySelectorAll(".life-adjust")];
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

function cardHasKeyword(cardElement, requestedKeyword) {
  const keywords = JSON.parse(cardElement.dataset.keywords || "[]");
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

function hideCardHoverPreview() {
  window.clearTimeout(cardHoverTimer);
  cardHoverTimer = null;
  cardHoverPreview.hidden = true;
  cardHoverPreview.classList.remove("visible");
}

function attachCardHoverPreview(element, imageUrl, cardName) {
  element.addEventListener("mouseenter", () => {
    window.clearTimeout(cardHoverTimer);
    cardHoverTimer = window.setTimeout(() => {
      if (!element.matches(":hover")) return;
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
  manaPool[type] += 1;
  source.classList.add("tapped");
  source.querySelectorAll(".mana-choice").forEach((button) => {
    button.disabled = true;
  });
  renderManaPool();
  showMessage(`${source.dataset.cardName} added {${type}}.`, "success");
}

function untapAllPermanents(announce = true) {
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card.tapped').forEach((card) => {
    card.classList.remove("tapped");
    card.querySelectorAll(".mana-choice").forEach((button) => {
      button.disabled = false;
    });
  });
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card.summoning-sick').forEach((card) => {
    if (Number(card.dataset.enteredTurn) < Number(window.currentTurnNumber || 1)) {
      card.classList.remove("summoning-sick");
      card.querySelector(".summoning-sick-badge")?.remove();
    }
  });
  clearManaPool();
  if (announce) showMessage("Untap step: all your permanents untapped.", "success");
}

function restoreCreaturesAtEndOfTurn() {
  document.querySelectorAll('[data-zone$="battlefield"] .board-card').forEach((card) => {
    if (!card.dataset.typeLine.includes("Creature")) return;
    card.dataset.damageMarked = "0";
    card.dataset.currentPower = card.dataset.basePower;
    card.dataset.currentToughness = card.dataset.baseToughness;
    card.querySelector(".damage-badge")?.remove();
    card.classList.add("stats-restored");
    window.setTimeout(() => card.classList.remove("stats-restored"), 520);
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
  combatAttackerName.textContent = `${attacker.dataset.cardName} (${attacker.dataset.basePower || "?"} power)`;
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
      && !enteredThisTurn;
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
  const power = Number(card.dataset.basePower);
  const toughness = Number(card.dataset.baseToughness);
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
    if (!/\bVigilance\b/i.test(attacker.dataset.oracleText)) attacker.classList.add("tapped");
    if (blocker) {
      const blockerStats = creatureCombatStats(blocker);
      blocker.classList.add("blocking-animation");
      if (markCombatDamage(blocker, attackerStats.power)) lethalCreatures.add(blocker);
      if (markCombatDamage(attacker, blockerStats.power)) lethalCreatures.add(attacker);
      return;
    }
    if (target.classList.contains("life-total")) opponentDamage += attackerStats.power;
    else damagePlaneswalker(target, attackerStats.power);
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
  editingMode = enabled;
  document.body.classList.toggle("editing-mode", enabled);
  importer.editToggle.setAttribute("aria-pressed", String(enabled));
  importer.editToggle.innerHTML = enabled
    ? '<span aria-hidden="true">✓</span> Done editing'
    : '<span aria-hidden="true">✦</span> Edit board';
  importer.trigger.disabled = !enabled;
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
  }
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
  const toughness = Number(card.dataset.baseToughness);
  if (!damage || !Number.isFinite(toughness)) return;
  const badge = document.createElement("span");
  badge.className = "damage-badge";
  badge.textContent = `${Math.max(0, toughness - damage)} toughness`;
  badge.title = `${damage} damage marked on a ${toughness}-toughness creature`;
  card.append(badge);
}

function sendLethalCreatureToGraveyard(card) {
  const battlefieldZone = card.parentElement?.dataset.zone || "";
  const owner = battlefieldZone.startsWith("opponent-") ? "opponent" : "player";
  card.classList.add("creature-dying");
  card.setAttribute("aria-label", `${card.dataset.cardName} has lethal damage and is dying.`);
  window.setTimeout(() => {
    document.querySelector(`[data-zone="${owner}-graveyard"]`).append(card);
    card.classList.remove("creature-dying");
    card.dataset.damageMarked = "0";
    updateCreatureDamageBadge(card);
    refreshCardState(card);
    showMessage(`${card.dataset.cardName} died and was put into ${owner === "player" ? "your" : "the opponent's"} graveyard.`, "error");
  }, 720);
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
  spellStackMeta.textContent = `${cardElement.dataset.manaCost} · ${cardElement.dataset.typeLine}`;
  spellOracleText.textContent = cardElement.dataset.oracleText || "This card has no Oracle rules text.";
  spellStack.hidden = false;
  spellStackBackdrop.hidden = false;
  document.body.classList.add("resolving-spell");
  beginTargetSelection(cardElement.dataset.oracleText || "", presetTargets);
  if (!requiredTargetCount) {
    resolveSpellButton.focus();
    showMessage(`${cardElement.dataset.cardName} is on the stack. Resolve its effect.`, "success");
  }
}

function resolveActiveSpell() {
  if (!resolvingSpell) return;
  const card = resolvingSpell;
  const resolvedTargets = chosenTargets.map(targetLabel);
  const targetElements = [...chosenTargets];
  const damageResults = applyResolvedDamage(card, targetElements);
  clearTargetSelection();
  resolvingSpell = null;
  document.querySelector('[data-zone="player-graveyard"]').append(card);
  card.hidden = false;
  card.classList.add("spell-resolved");
  refreshCardState(card);
  spellStack.hidden = true;
  spellStackBackdrop.hidden = true;
  document.body.classList.remove("resolving-spell");
  showMessage(
    damageResults.length
      ? `${card.dataset.cardName} resolved: ${damageResults.join("; ")}.`
      : `${card.dataset.cardName}'s effect resolved${resolvedTargets.length ? ` on ${resolvedTargets.join(", ")}` : ""}.`,
    "success",
  );
}

function payForCard(cardElement) {
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

  const cost = cardElement.dataset.manaCost;
  if (!cost) {
    showMessage("This card has no payable mana cost.", "error");
    return false;
  }
  const payment = spendManaFor(cost);
  if (!payment.paid) {
    showMessage(payment.reason, "error");
    return false;
  }
  return true;
}

function clearCastDropTargets() {
  castDropTargets.forEach((target) => target.classList.remove("legal-cast-drop", "cast-drag-over"));
  castDropTargets = [];
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
  if (typeLine.includes("Land")) {
    if (target.dataset.zone !== "player-battlefield") return;
    target.append(cardElement);
    refreshCardState(cardElement);
    showMessage(`${cardElement.dataset.cardName} played as a land.`, "success");
    return;
  }
  if (!payForCard(cardElement)) return;
  if (/Instant|Sorcery/.test(typeLine)) {
    const presetTargets = target.matches(".life-total, .board-card") ? [target] : [];
    activateSpellEffect(cardElement, presetTargets);
    return;
  }
  resolvePermanent(cardElement, document.querySelector('[data-zone="player-battlefield"]'));
}

function refreshCardState(element) {
  const zone = element.parentElement?.dataset.zone || "";
  const inPlayerHand = zone === "player-hand";
  const onPlayerBattlefield = zone === "player-battlefield";
  const inGraveyard = zone.endsWith("-graveyard");
  const isLand = element.dataset.typeLine.includes("Land");
  const manaTypes = JSON.parse(element.dataset.producedMana || "[]");

  const awaitingPlacement = element.classList.contains("awaiting-placement");
  if (inGraveyard) {
    element.classList.remove(
      "tapped",
      "declared-attacker",
      "blocked-attacker",
      "declared-blocker",
      "attacking-animation",
      "blocking-animation",
    );
  }
  element.draggable = editingMode || inPlayerHand;
  element.setAttribute("aria-label", editingMode
    ? `${element.dataset.cardName}. Drag to move.`
    : inPlayerHand ? `${element.dataset.cardName}. Drag to play or cast.` : element.dataset.cardName);
  element.querySelector(".cast-card")?.remove();
  element.querySelector(".mana-actions")?.remove();

  if (!editingMode && onPlayerBattlefield && isLand && manaTypes.length) {
    const actions = document.createElement("div");
    actions.className = "mana-actions";
    manaTypes.filter((type) => MANA_TYPES.includes(type)).forEach((type) => {
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
  element.addEventListener("click", (event) => {
    if (!element.classList.contains("awaiting-placement") || event.target.closest("button")) return;
    selectedPermanent = element;
    element.classList.add("selected-for-resolution");
    showMessage(`${element.dataset.cardName} selected. Choose your highlighted battlefield.`, "success");
  });
  let pointerDrag = null;
  element.addEventListener("pointerdown", (event) => {
    const castingFromHand = !editingMode && element.parentElement?.dataset.zone === "player-hand";
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
    const inHand = element.parentElement?.dataset.zone === "player-hand";
    if (!editingMode && !inHand && !element.classList.contains("awaiting-placement")) {
      event.preventDefault();
      return;
    }
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
importer.close.addEventListener("click", closeImporter);
importer.backdrop.addEventListener("click", closeImporter);
importer.form.addEventListener("submit", searchCards);
importer.toastCancel.addEventListener("click", cancelPlacement);
clearManaButton.addEventListener("click", clearManaPool);
document.addEventListener("turn:untap", () => untapAllPermanents());
document.addEventListener("turn:phasechange", (event) => {
  if (event.detail.phase === "Combat phase") beginCombatDeclaration();
  else {
    cleanupCombat();
    if (event.detail.phase === "End step") restoreCreaturesAtEndOfTurn();
  }
});
resolveSpellButton.addEventListener("click", resolveActiveSpell);

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
  if (event.key !== "Escape") return;
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
  if (editingMode || !draggedCard || draggedCard.parentElement?.dataset.zone !== "player-hand") return;
  const target = event.target.closest(".legal-cast-drop");
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  castDropTargets.forEach((candidate) => candidate.classList.toggle("cast-drag-over", candidate === target));
}, true);

document.addEventListener("drop", (event) => {
  if (editingMode || !draggedCard || draggedCard.parentElement?.dataset.zone !== "player-hand") return;
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
    if (event.target.closest(".board-card")) return;
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

renderManaPool();
setEditingMode(false);
