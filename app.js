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
const untapButton = document.querySelector(".untap-all");
const gameMessage = document.querySelector(".game-message");
const zones = [...document.querySelectorAll(".drop-zone")];

let selectedCard = null;
let draggedCard = null;
let selectedPermanent = null;
let editingMode = false;
let messageTimer = null;
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

function showMessage(message, tone = "neutral") {
  window.clearTimeout(messageTimer);
  gameMessage.textContent = message;
  gameMessage.dataset.tone = tone;
  gameMessage.hidden = false;
  messageTimer = window.setTimeout(() => {
    gameMessage.hidden = true;
  }, 3200);
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

function untapAllLands(announce = true) {
  document.querySelectorAll('[data-zone="player-battlefield"] .board-card.tapped').forEach((card) => {
    card.classList.remove("tapped");
    card.querySelectorAll(".mana-choice").forEach((button) => {
      button.disabled = false;
    });
  });
  clearManaPool();
  if (announce) showMessage("All lands untapped. Mana pool emptied.");
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
  editingMode = enabled;
  document.body.classList.toggle("editing-mode", enabled);
  importer.editToggle.setAttribute("aria-pressed", String(enabled));
  importer.editToggle.innerHTML = enabled
    ? '<span aria-hidden="true">✓</span> Done editing'
    : '<span aria-hidden="true">✦</span> Edit board';
  importer.trigger.disabled = !enabled;
  importer.editBanner.hidden = !enabled;
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

function playCard(cardElement) {
  const typeLine = cardElement.dataset.typeLine;
  if (typeLine.includes("Land")) {
    document.querySelector('[data-zone="player-battlefield"]').append(cardElement);
    refreshCardState(cardElement);
    showMessage(`${cardElement.dataset.cardName} played as a land.`, "success");
    return;
  }

  const cost = cardElement.dataset.manaCost;
  if (!cost) {
    showMessage("This card has no payable mana cost.", "error");
    return;
  }
  const payment = spendManaFor(cost);
  if (!payment.paid) {
    showMessage(payment.reason, "error");
    return;
  }

  if (/Instant|Sorcery/.test(typeLine)) {
    document.querySelector('[data-zone="player-graveyard"]').append(cardElement);
    cardElement.classList.add("spell-resolved");
    refreshCardState(cardElement);
    showMessage(`${cardElement.dataset.cardName} cast for ${cost}.`, "success");
    return;
  }

  cardElement.classList.add("awaiting-placement");
  cardElement.draggable = false;
  cardElement.querySelector(".cast-card")?.remove();
  cardElement.setAttribute("aria-label", `${cardElement.dataset.cardName}. Paid and ready—drag it to your battlefield.`);
  document.querySelector('[data-zone="player-battlefield"]').classList.add("resolve-target");
  showMessage(`${cardElement.dataset.cardName} is paid for. Drag it—or select it, then the battlefield.`, "success");
}

function refreshCardState(element) {
  const zone = element.parentElement?.dataset.zone || "";
  const inPlayerHand = zone === "player-hand";
  const onPlayerBattlefield = zone === "player-battlefield";
  const isLand = element.dataset.typeLine.includes("Land");
  const manaTypes = JSON.parse(element.dataset.producedMana || "[]");

  const awaitingPlacement = element.classList.contains("awaiting-placement");
  element.draggable = editingMode;
  element.setAttribute("aria-label", editingMode ? `${element.dataset.cardName}. Drag to move.` : element.dataset.cardName);
  element.querySelector(".cast-card")?.remove();
  element.querySelector(".mana-actions")?.remove();

  if (!editingMode && inPlayerHand && !awaitingPlacement) {
    const cast = document.createElement("button");
    cast.className = "cast-card";
    cast.type = "button";
    cast.textContent = isLand ? "Play land" : `Cast ${element.dataset.manaCost || "—"}`;
    cast.addEventListener("click", () => playCard(element));
    element.append(cast);
  }

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
  battlefield.append(card);
  card.classList.remove("awaiting-placement", "pointer-dragging", "selected-for-resolution");
  card.classList.add("permanent-resolved");
  card.removeAttribute("style");
  selectedPermanent = null;
  battlefield.classList.remove("resolve-target", "drag-over");
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

  const image = document.createElement("img");
  image.src = cardImage(card);
  image.alt = card.name;
  image.loading = "lazy";

  const cost = document.createElement("span");
  cost.className = "card-mana-cost";
  cost.textContent = element.dataset.manaCost || (element.dataset.typeLine.includes("Land") ? "Land" : "No cost");

  const remove = document.createElement("button");
  remove.className = "remove-card";
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${card.name}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => element.remove());

  element.append(image, cost, remove);
  element.addEventListener("click", (event) => {
    if (!element.classList.contains("awaiting-placement") || event.target.closest("button")) return;
    selectedPermanent = element;
    element.classList.add("selected-for-resolution");
    showMessage(`${element.dataset.cardName} selected. Choose your highlighted battlefield.`, "success");
  });
  let pointerDrag = null;
  element.addEventListener("pointerdown", (event) => {
    if (!element.classList.contains("awaiting-placement") || event.target.closest("button")) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    pointerDrag = { pointerId: event.pointerId, width: rect.width, height: rect.height };
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
    element.style.left = `${event.clientX - pointerDrag.width / 2}px`;
    element.style.top = `${event.clientY - pointerDrag.height / 2}px`;
  });
  element.addEventListener("pointerup", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    pointerDrag = null;
    element.releasePointerCapture(event.pointerId);
    const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-zone="player-battlefield"]');
    if (destination) {
      resolvePermanent(element, destination);
    } else {
      element.classList.remove("pointer-dragging");
      element.removeAttribute("style");
    }
  });
  element.addEventListener("dragstart", (event) => {
    if (!editingMode && !element.classList.contains("awaiting-placement")) {
      event.preventDefault();
      return;
    }
    draggedCard = element;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
    window.requestAnimationFrame(() => element.classList.add("dragging"));
  });
  element.addEventListener("dragend", () => {
    draggedCard = null;
    element.classList.remove("dragging");
    zones.forEach((zone) => zone.classList.remove("drag-over"));
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
untapButton.addEventListener("click", () => untapAllLands());

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (selectedCard) cancelPlacement();
  else if (importer.drawer.getAttribute("aria-hidden") === "false") closeImporter();
});

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
