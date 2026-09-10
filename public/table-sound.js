// Short, locally synthesized paper/tap sounds. No downloads or autoplay audio.
export function createTableSound(preferences) {
  let context;
  function unlock() {
    if (!preferences().sound) return;
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch {}
  }
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  return (kind = 'card') => {
    const options = preferences();
    if (!options.sound || !options.volume || !context || context.state !== 'running' || document.hidden) return;
    const time = context.currentTime, length = kind === 'play' ? .1 : .045;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(kind === 'play' ? 210 : 430, time);
    oscillator.frequency.exponentialRampToValueAtTime(90, time + length);
    gain.gain.setValueAtTime(.045 * options.volume / 100, time);
    gain.gain.exponentialRampToValueAtTime(.001, time + length);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(time); oscillator.stop(time + length);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  };
}
