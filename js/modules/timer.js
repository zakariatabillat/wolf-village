// ============================================================
//  SQUAD 5 — CHRONO DE DÉBAT
//  Reçoit : { duration (s), bus, tickMs }
//  Renvoie : un objet { start, pause, resume, skip, addTime, remaining, done }
//  Émet    : debate:start, debate:tick { remaining }, debate:end { skipped }
//  Stocke  : le temps restant (dans la fermeture)
// ============================================================
import { EVENTS } from '../core/bus.js';

export function createTimer({ duration = 60, bus = null, tickMs = 1000 } = {}) {
  let remaining = Math.max(0, Math.floor(duration));
  let intervalId = null;
  let paused = false;
  let finished = false;
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; }); // se résout à la fin du débat

  function finish(skipped) {
    if (finished) return; // ne jamais terminer deux fois
    finished = true;
    clearInterval(intervalId);
    bus?.emit(EVENTS.DEBATE_END, { skipped });
    resolveDone({ skipped });
  }

  function tick() {
    if (paused) return;
    remaining -= 1;
    bus?.emit(EVENTS.DEBATE_TICK, { remaining });
    if (remaining <= 0) finish(false);
  }

  return {
    start() {
      bus?.emit(EVENTS.DEBATE_START, { duration: remaining });
      if (remaining <= 0) { finish(false); return done; } // cas limite : durée 0
      intervalId = setInterval(tick, tickMs);
      return done;
    },
    pause()  { paused = true; },
    resume() { paused = false; },
    skip()   { finish(true); },
    addTime(sec) { if (!finished) remaining += sec; },
    get remaining() { return remaining; },
    get paused() { return paused; },
    done,
  };
}

/** Format mm:ss pour l'affichage. */
export function formatTime(sec) {
  const s = Math.max(0, sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
