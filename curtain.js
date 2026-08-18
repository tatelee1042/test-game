/**
 * Curtain transitions.
 *
 * A curtain covers the viewport, lets the caller swap what is underneath while
 * nobody can see it, then uncovers the new view. The board is rebuilt from
 * scratch on a reset — zones emptied, cards re-created, counters re-hung — and
 * doing that in the open reads as a flicker of half-built board. Behind a
 * curtain it reads as one deliberate change.
 *
 * The only effect here is `blinds`: venetian slats that scale shut across the
 * screen in a stagger, then keep scaling the same way to open again. Modelled
 * on Motion+'s curtains/blinds effect, but written against the Web Animations
 * API so the board carries no animation dependency.
 *
 *   await Curtains.blinds(() => rebuildTheBoard());
 */

/** Slat thickness in px, matching the effect's documented default. */
const DEFAULT_SLAT_SIZE = 64;
/** How long a single slat takes to close, and again to open, in ms. */
const DEFAULT_DURATION = 620;
/** Spread between the first slat starting and the last one starting, in ms. */
const DEFAULT_STAGGER = 380;
const DEFAULT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Slats are laid out by hand rather than by grid because they have to overlap.
 * Scaling two exactly-adjacent boxes leaves a sub-pixel seam that flickers the
 * background through the middle of a closed curtain, so every slat is drawn one
 * pixel taller than its slot and laps over its neighbour.
 */
function buildSlats(stage, { size, direction }) {
  const vertical = direction === "row";
  const extent = vertical ? stage.clientHeight : stage.clientWidth;
  // Round to whole slats so they divide the screen exactly: a leftover strip at
  // the far edge would close on its own beat and give the trick away.
  const count = Math.max(1, Math.round(extent / size));
  const slatSize = extent / count;

  const slats = [];
  for (let index = 0; index < count; index += 1) {
    const slat = document.createElement("div");
    slat.className = "motion-curtain";
    slat.style[vertical ? "top" : "left"] = `${index * slatSize}px`;
    slat.style[vertical ? "height" : "width"] = `${slatSize + 1}px`;
    stage.append(slat);
    slats.push(slat);
  }
  return slats;
}

/**
 * One phase of the curtain — every slat running the same scale, each starting a
 * beat after the one before it. Resolves when the last slat lands.
 */
function runPhase(slats, { from, to, origin, axis, duration, stagger, easing }) {
  const step = slats.length > 1 ? stagger / (slats.length - 1) : 0;
  const animations = slats.map((slat, index) => {
    slat.style.transformOrigin = origin;
    return slat.animate(
      [{ transform: `${axis}(${from})` }, { transform: `${axis}(${to})` }],
      { duration, delay: index * step, easing, fill: "forwards" },
    );
  });
  return Promise.all(animations.map((animation) => animation.finished));
}

/**
 * Closes venetian blinds over the page, runs `update` behind them, then opens
 * them again.
 *
 * @param {() => unknown | Promise<unknown>} update What to change while hidden.
 * @param {object} [options]
 * @param {number} [options.size] Slat thickness in px.
 * @param {"row" | "column"} [options.direction] Horizontal or vertical slats.
 * @param {"normal" | "reverse"} [options.directionMode] `normal` opens the
 *   slats the way they closed, carrying the motion on through; `reverse`
 *   retreats the way the curtain came.
 * @returns {Promise<void>} Resolves once the curtain is gone.
 */
async function blinds(update, options = {}) {
  const {
    size = DEFAULT_SLAT_SIZE,
    direction = "row",
    directionMode = "normal",
    duration = DEFAULT_DURATION,
    stagger = DEFAULT_STAGGER,
    easing = DEFAULT_EASING,
  } = options;

  // A curtain the player cannot see is just a delay in front of the change.
  if (reducedMotion.matches || typeof Element.prototype.animate !== "function") {
    await update();
    return;
  }

  const stage = document.createElement("div");
  stage.className = "motion-curtains";
  stage.dataset.direction = direction;
  // Purely decorative, and it swallows clicks aimed at whatever it is covering.
  stage.setAttribute("aria-hidden", "true");
  document.body.append(stage);

  const vertical = direction === "row";
  const axis = vertical ? "scaleY" : "scaleX";
  const leadingEdge = vertical ? "top" : "left";
  const trailingEdge = vertical ? "bottom" : "right";

  try {
    const slats = buildSlats(stage, { size, direction });
    await runPhase(slats, {
      from: 0,
      to: 1,
      origin: leadingEdge,
      axis,
      duration,
      stagger,
      easing,
    });

    // The one moment the board is allowed to look unfinished.
    await update();

    await runPhase(slats, {
      from: 1,
      to: 0,
      // `normal` pins the far edge so the slat keeps travelling the way it was
      // already going; `reverse` pins the near edge and it withdraws.
      origin: directionMode === "reverse" ? leadingEdge : trailingEdge,
      axis,
      duration,
      stagger,
      easing,
    });
  } finally {
    stage.remove();
  }
}

window.Curtains = { blinds };
