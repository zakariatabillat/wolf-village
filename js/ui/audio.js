// ============================================================
//  NARRATEUR (synthèse vocale) + AMBIANCE SONORE (Web Audio, générée)
//  Aucun fichier audio : tout est synthétisé dans le navigateur.
// ============================================================

export function createNarrator() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  let enabled = false;
  let voice = null;
  function pickVoice() {
    if (!supported) return;
    const voices = speechSynthesis.getVoices();
    voice = voices.find(v => /^fr/i.test(v.lang) && /(Google|Thomas|Amélie|Audrey|Daniel|Denise|Henri)/i.test(v.name))
      ?? voices.find(v => /^fr/i.test(v.lang)) ?? null;
  }
  if (supported) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  return {
    get enabled() { return enabled; },
    setEnabled(on) { enabled = on && supported; if (!enabled && supported) speechSynthesis.cancel(); },
    say(text) {
      if (!enabled) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/[·]/g, ''));
        u.lang = 'fr-FR'; if (voice) u.voice = voice;
        u.rate = 0.98; u.pitch = 0.82;
        speechSynthesis.speak(u);
      } catch { /* voix indisponible */ }
    },
  };
}

export function createAmbience() {
  let ctx = null, master = null, windGain = null, fireGain = null, enabled = true, started = false;

  function noiseBuffer(seconds = 2) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // bruit brun
    return buf;
  }

  function start() {
    if (started) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = enabled ? 0.5 : 0; master.connect(ctx.destination);
      // Vent : bruit brun filtré, modulé lentement
      const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(4); wind.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 220; lfo.connect(lfoGain).connect(bp.frequency);
      windGain = ctx.createGain(); windGain.gain.value = 0.25;
      wind.connect(bp).connect(windGain).connect(master); wind.start(); lfo.start();
      // Feu : crépitements aléatoires
      fireGain = ctx.createGain(); fireGain.gain.value = 0.35; fireGain.connect(master);
      const crackle = () => {
        if (!ctx) return;
        const t = ctx.currentTime;
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.05);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800 + Math.random() * 2500;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.4 * Math.random(), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(hp).connect(g).connect(fireGain); src.start(t);
        setTimeout(crackle, 40 + Math.random() * 260);
      };
      crackle();
      started = true;
    } catch { /* audio refusé */ }
  }

  /** Hurlement de loup synthétisé. */
  function howl() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vibG = ctx.createGain(); vibG.gain.value = 9; vib.connect(vibG).connect(osc.frequency);
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(610, t + 0.7);
    osc.frequency.linearRampToValueAtTime(560, t + 2.2);
    osc.frequency.linearRampToValueAtTime(380, t + 3.0);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.5); g.gain.linearRampToValueAtTime(0.12, t + 2.3); g.gain.linearRampToValueAtTime(0, t + 3.1);
    const delay = ctx.createDelay(); delay.delayTime.value = 0.32; const fb = ctx.createGain(); fb.gain.value = 0.35;
    osc.connect(lp).connect(g); g.connect(master); g.connect(delay); delay.connect(fb).connect(delay); delay.connect(master);
    osc.start(t); vib.start(t); osc.stop(t + 3.2); vib.stop(t + 3.2);
  }

  /** Petit "gong" (vote, mort, fin). */
  function chime(freq = 220, dur = 1.6) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    [1, 2.01, 3.03].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.18 / (i + 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master); o.start(t); o.stop(t + dur);
    });
  }

  return {
    start,
    howl,
    chime,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = on; if (master) master.gain.value = on ? 0.5 : 0; },
    setNight(isNight) { if (windGain) windGain.gain.value = isNight ? 0.3 : 0.12; },
  };
}
