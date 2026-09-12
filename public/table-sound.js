// Original, locally synthesized paper, wooden taps and short musical accents.
// The effects are synthesized locally; music shares this gesture-unlocked context.
export function createTableSound(preferences) {
  let context, master; const noises = [], unlocked = new Set();
  const voices = new Set(), previews = new Set();
  async function unlock() {
    if (!preferences().sound && !preferences().music) return;
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (!master) { master = context.createGain(); master.connect(context.destination); }
      if (context.state !== 'running') await context.resume();
      sync(); for (const listener of unlocked) listener();
    } catch {}
  }
  function stop() { for (const timer of previews) clearTimeout(timer); previews.clear(); for (const source of voices) { try { source.stop(); } catch {} } }
  function sync() {
    if (!master) return;
    master.gain.setTargetAtTime(preferences().sound ? preferences().volume / 100 : 0, context.currentTime, .025);
    if (!preferences().sound || !preferences().volume) stop();
  }
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stop(); context?.suspend().catch(() => {}); }
    else if (context) unlock();
  });
  function tone(frequency, delay, length, volume, type = 'triangle') {
    const at = context.currentTime + delay;
    const source = context.createOscillator(), gain = context.createGain();
    source.type = type; source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(frequency * .995, at + length);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), at + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    source.connect(gain); gain.connect(master); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + length + .01);
  }
  function paper(volume, length = .055, frequency = 2600, delay = 0) {
    if (!noises.length) {
      for (let variant = 0; variant < 4; variant++) {
        const noise = context.createBuffer(1, Math.ceil(context.sampleRate * .22), context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noises.push(noise);
      }
    }
    const at = context.currentTime + delay, source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = noises[Math.floor(Math.random() * noises.length)]; source.playbackRate.value = .96 + Math.random() * .08;
    filter.type = 'bandpass'; filter.frequency.value = frequency * (.94 + Math.random() * .12); filter.Q.value = .65;
    gain.gain.setValueAtTime(.0001, at); gain.gain.linearRampToValueAtTime(Math.max(.0002, volume), at + .002);
    gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    source.connect(filter); filter.connect(gain); gain.connect(master); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + length);
  }
  const play = (kind = 'card', { points = 0, count = 1, milestone = false } = {}) => {
    const options = preferences();
    if (!options.sound || !options.volume || !context || context.state !== 'running' || document.hidden) return;
    // Bounded even if a spectator receives a rapid series of public updates.
    if (voices.size > 18) return;
    const volume = 1;
    if (kind === 'deal') { paper(.055 * volume, .033, 3400); return; }
    if (kind === 'card') { paper(.06 * volume); tone(369.99, 0, .035, .025 * volume); return; }
    if (kind === 'play' || kind === 'bury') {
      paper(.14 * volume, .075, 1800); tone(count > 1 ? 165 : 210, 0, .11, .07 * volume);
      if (count > 1 || kind === 'bury') {
        const taps = Math.min(3, Math.max(2, Math.ceil(count / 2)));
        for (let i = 1; i < taps; i++) { paper(.055, .047, 2100 + i * 130, i * .035); tone(185 + i * 22, i * .035, .075, .025); }
      }
      return;
    }
    if (kind === 'declaration' || kind === 'trump_set') {
      [369.99, 493.88, 739.99].forEach((note, i) => tone(note, i * .055, .19, .044 * volume)); return;
    }
    if (kind === 'capture') {
      paper(.07 * volume, .075, 2200);
      tone(185, 0, .09, .025 * volume);
      return;
    }
    if (kind === 'collect') {
      paper(.09 * volume, .11, 1200);
      if (points) {
        const notes = milestone ? [369.99, 493.88, 587.33, 739.99] : points >= 20 ? [493.88, 587.33, 739.99] : [493.88, 587.33];
        notes.forEach((note, i) => tone(note, .035 + i * .07, milestone ? .25 : .17, milestone ? .048 : .035, 'sine'));
      }
      return;
    }
    if (kind === 'win' || kind === 'finish') {
      const notes = kind === 'win' ? [246.94, 369.99, 493.88, 587.33, 739.99] : [369.99, 329.63, 277.18];
      notes.forEach((note, i) => tone(note, i * .105, .30, .045 * volume));
      tone(kind === 'win' ? 123.47 : 185, .15, .5, .035 * volume, 'sine');
    }
  };
  play.unlock = unlock; play.sync = sync; play.stop = stop;
  play.preview = async () => {
    stop(); await unlock();
    for (const [delay, kind, options] of [[0,'deal'],[180,'deal'],[360,'deal'],[1050,'play'],[1900,'play',{count:6}],
      [2900,'capture',{points:20}],[3300,'collect',{points:20}],[4400,'collect',{points:40,milestone:true}],[5800,'win']]) {
      const timer = setTimeout(() => { previews.delete(timer); play(kind, options); }, delay); previews.add(timer);
    }
  };
  play.getContext = () => context;
  play.onUnlock = listener => { unlocked.add(listener); return () => unlocked.delete(listener); };
  return play;
}
