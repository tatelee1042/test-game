/**
 * Puzzle timer.
 *
 * Times how long a player took to solve the day's puzzle. It starts the first
 * time they open that puzzle and runs until the first time they finish it —
 * whichever tab, whichever visit. Closing the page and coming back later
 * resumes the same clock rather than starting a new one, because the question
 * it answers is "how long did this puzzle take you", not "how long was this
 * page open".
 *
 * It only runs while the player is actually here. A tab left open behind other
 * work is not time spent on the puzzle, so the clock stops the moment the tab
 * is hidden or the window loses focus, and picks up again on the way back.
 *
 * Once a puzzle is finished the record is frozen. Resetting the board and
 * solving it again does not overwrite the first time, which is the one worth
 * keeping.
 */

const TIMER_STORAGE_KEY = "spellbook.timers";
/** Long enough that a crash costs a second or two, short enough to be cheap. */
const TIMER_PERSIST_EVERY_MS = 2000;
const TIMER_TICK_MS = 250;

let timerPuzzleId = null;
/** Milliseconds banked from previous visits and from this one, up to `since`. */
let bankedMs = 0;
/** When the current running stretch began, or null while the clock is stopped. */
let runningSince = null;
/** Frozen the first time the puzzle is finished; null while it is unsolved. */
let finishedMs = null;
let tickHandle = null;
let lastPersistedAt = 0;
let onChange = null;

function readRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (_error) {
    return {};
  }
}

function writeRecord() {
  if (!timerPuzzleId) return;
  try {
    const records = readRecords();
    records[timerPuzzleId] = { elapsedMs: Math.round(elapsedMs()), finishedMs };
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(records));
  } catch (_error) {
    // A timer that cannot be remembered is still a timer for this visit.
  }
  lastPersistedAt = Date.now();
}

/** Total time on this puzzle, including the stretch currently running. */
function elapsedMs() {
  if (finishedMs !== null) return finishedMs;
  return bankedMs + (runningSince === null ? 0 : Date.now() - runningSince);
}

/** Here means: this tab is the visible one, and the window has focus. */
function playerIsPresent() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function shouldRun() {
  return Boolean(timerPuzzleId) && finishedMs === null && playerIsPresent();
}

function tick() {
  onChange?.(elapsedMs(), finishedMs !== null);
  if (Date.now() - lastPersistedAt >= TIMER_PERSIST_EVERY_MS) writeRecord();
}

/** Starts or stops the clock to match whether the player is actually here. */
function syncRunning() {
  const running = runningSince !== null;
  if (shouldRun() === running) return;
  if (running) {
    bankedMs += Date.now() - runningSince;
    runningSince = null;
    window.clearInterval(tickHandle);
    tickHandle = null;
    writeRecord();
  } else {
    runningSince = Date.now();
    tickHandle = window.setInterval(tick, TIMER_TICK_MS);
  }
  onChange?.(elapsedMs(), finishedMs !== null);
}

document.addEventListener("visibilitychange", syncRunning);
window.addEventListener("focus", syncRunning);
window.addEventListener("blur", syncRunning);
// Closing the tab is just another way to stop being here, and the last stretch
// is only in memory until something writes it down.
window.addEventListener("pagehide", () => {
  if (runningSince !== null) {
    bankedMs += Date.now() - runningSince;
    runningSince = null;
  }
  writeRecord();
});

const PuzzleTimer = {
  /**
   * Puts a puzzle on the clock. Resumes whatever that puzzle has already
   * banked; if it was finished on an earlier visit, it stays finished.
   */
  open(puzzleId, { onChange: handler = null } = {}) {
    if (timerPuzzleId && timerPuzzleId !== puzzleId) {
      // Bank the outgoing puzzle's time before the incoming one takes over.
      if (runningSince !== null) bankedMs += Date.now() - runningSince;
      runningSince = null;
      writeRecord();
    }
    window.clearInterval(tickHandle);
    tickHandle = null;

    timerPuzzleId = puzzleId || null;
    onChange = handler ?? onChange;
    const record = timerPuzzleId ? readRecords()[timerPuzzleId] : null;
    bankedMs = Number(record?.elapsedMs) || 0;
    finishedMs = Number.isFinite(record?.finishedMs) ? record.finishedMs : null;
    lastPersistedAt = 0;

    syncRunning();
    onChange?.(elapsedMs(), finishedMs !== null);
    return elapsedMs();
  },

  /**
   * Stops the clock for good and returns the time. Finishing a puzzle that was
   * already finished returns the first time rather than a new one.
   */
  finish() {
    if (!timerPuzzleId) return null;
    if (finishedMs === null) {
      finishedMs = Math.round(elapsedMs());
      if (runningSince !== null) runningSince = null;
      window.clearInterval(tickHandle);
      tickHandle = null;
      writeRecord();
      onChange?.(finishedMs, true);
    }
    return finishedMs;
  },

  elapsedMs,
  isFinished: () => finishedMs !== null,
  isRunning: () => runningSince !== null,

  /** m:ss under an hour, h:mm:ss past it. Never a bare seconds count. */
  format(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const seconds = String(total % 60).padStart(2, "0");
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
      : `${minutes}:${seconds}`;
  },

  /** "4 minutes 12 seconds" — for the sentence on the win screen. */
  spell(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    const parts = [];
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    if (seconds || !minutes) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
    return parts.join(" ");
  },
};

window.PuzzleTimer = PuzzleTimer;
