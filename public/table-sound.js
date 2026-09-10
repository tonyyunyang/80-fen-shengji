// Original, locally synthesized paper, wooden taps and short musical accents.
// Audio is opt-in and unlocked by a gesture. No audio files or autoplay music.
export function createTableSound(preferences) {
  let context, noise;
  const voices = new Set();
  function unlock() {
    if (!preferences().sound) return;
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch {}
  }
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) for (const source of voices) { try { source.stop(); } catch {} }
  });
  function tone(frequency, delay, length, volume, type = 'triangle') {
    const at = context.currentTime + delay;
    const source = context.createOscillator(), gain = context.createGain();
    source.type = type; source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(frequency * .86, at + length);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), at + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    source.connect(gain); gain.connect(context.destination); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + length + .01);
  }
  function paper(volume, length = .055, frequency = 2600) {
    if (!noise) {
      noise = context.createBuffer(1, Math.ceil(context.sampleRate * .15), context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const at = context.currentTime, source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = noise; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .65;
    gain.gain.setValueAtTime(Math.max(.0002, volume), at); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    source.connect(filter); filter.connect(gain); gain.connect(context.destination); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + length);
  }
  return (kind = 'card', { points = 0, count = 1 } = {}) => {
    const options = preferences();
    if (!options.sound || !options.volume || !context || context.state !== 'running' || document.hidden) return;
    // Bounded even if a spectator receives a rapid series of public updates.
    if (voices.size > 18) return;
    const volume = options.volume / 100;
    if (kind === 'deal') { paper(.055 * volume, .033, 3400); return; }
    if (kind === 'card') { paper(.075 * volume); tone(440, 0, .04, .032 * volume); return; }
    if (kind === 'play' || kind === 'bury') {
      paper(.14 * volume, .075, 1800); tone(count > 1 ? 165 : 210, 0, .11, .07 * volume);
      if (count > 1 || kind === 'bury') tone(290, .025, .08, .025 * volume);
      return;
    }
    if (kind === 'declaration' || kind === 'trump_set') {
      [392, 587.33, 783.99].forEach((note, i) => tone(note, i * .055, .19, .044 * volume)); return;
    }
    if (kind === 'capture') {
      paper(.07 * volume, .075, 2200);
      if (points) [523.25, 659.25, points >= 20 ? 1046.5 : 783.99].forEach((note, i) => tone(note, i * .07, .16, .036 * volume));
      else tone(330, 0, .09, .03 * volume);
      return;
    }
    if (kind === 'collect') { paper(.09 * volume, .11, 1200); if (points) tone(880, .035, .15, .025 * volume, 'sine'); return; }
    if (kind === 'win' || kind === 'finish') {
      const notes = kind === 'win' ? [392, 523.25, 659.25, 783.99, 1046.5] : [392, 493.88, 587.33];
      notes.forEach((note, i) => tone(note, i * .105, .30, .045 * volume));
      tone(kind === 'win' ? 130.81 : 196, .15, .5, .035 * volume, 'sine');
    }
  };
}
