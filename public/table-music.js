export const MUSIC_TRACK = Object.freeze({
  title: 'After Eighty', titleZh: '八十分之后',
  url: '/assets/audio/after-eighty.mp3', seconds: 89.30233560090703,
});

// One decoded, looping buffer on the player's device. No frame-by-frame
// synthesis, server timer, or provider call is needed for background music.
export function createTableMusic(preferences, { getContext, document: doc = document, fetchImpl = fetch, onStatus = () => {} } = {}) {
  let buffer, source, voiceGain, gain, filter, loading, controller, position = 0, startedAt = 0;
  let muffled = true, status = 'off', retryAt = 0;
  const allowed = () => preferences().music && preferences().musicVolume > 0 && !doc.hidden;
  const announce = value => { if (status !== value) { status = value; onStatus(value); } };
  const length = () => Math.min(buffer?.duration || MUSIC_TRACK.seconds, MUSIC_TRACK.seconds);
  function stop() {
    if (!source) return;
    const context = getContext();
    position = (position + Math.max(0, context.currentTime - startedAt)) % length();
    const old = source, oldGain = voiceGain; source = null; voiceGain = null;
    if (doc.hidden || context.state !== 'running') { try { old.stop(); } catch {} old.disconnect(); oldGain.disconnect(); }
    else {
      oldGain.gain.setTargetAtTime(0, context.currentTime, .012);
      old.onended = () => { old.disconnect(); oldGain.disconnect(); };
      try { old.stop(context.currentTime + .07); } catch { old.onended(); }
    }
  }
  function levels() {
    const context = getContext(); if (!gain || !context) return;
    gain.gain.setTargetAtTime(Math.max(0, Math.min(100, preferences().musicVolume)) / 100 * .5, context.currentTime, .08);
    filter.frequency.setTargetAtTime(muffled ? 2400 : 11000, context.currentTime, .4);
  }
  async function sync({ retry = false } = {}) {
    if (!allowed()) {
      controller?.abort(); controller = null; stop();
      announce(preferences().music && doc.hidden ? 'paused' : 'off'); return;
    }
    const context = getContext();
    if (!context || context.state !== 'running') { announce('waiting'); return; }
    levels();
    if (source) return;
    if (retry) retryAt = 0;
    if (Date.now() < retryAt) return;
    if (!buffer) {
      if (loading) return;
      const attempt = new AbortController(); controller = attempt; announce('loading');
      loading = (async () => {
        const response = await fetchImpl(MUSIC_TRACK.url, { signal: attempt.signal });
        if (!response.ok) throw new Error('Music unavailable');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('Music asset is too large');
        const decoded = await context.decodeAudioData(bytes);
        if (!attempt.signal.aborted) buffer = decoded;
      })();
      try { await loading; }
      catch { if (!attempt.signal.aborted) { retryAt = Date.now() + 30000; announce('unavailable'); } }
      finally { loading = null; if (controller === attempt) controller = null; }
      if (attempt.signal.aborted && allowed()) { queueMicrotask(() => sync()); return; }
      if (!buffer || !allowed() || context.state !== 'running') return;
    }
    if (source) return;
    if (!gain) {
      gain = context.createGain(); gain.gain.value = 0;
      filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = .55;
      filter.connect(gain); gain.connect(context.destination);
    }
    source = context.createBufferSource(); source.buffer = buffer; voiceGain = context.createGain();
    voiceGain.gain.value = 0; voiceGain.gain.setTargetAtTime(1, context.currentTime, .02);
    source.loop = true; source.loopStart = 0; source.loopEnd = length(); source.connect(voiceGain); voiceGain.connect(filter);
    startedAt = context.currentTime; source.start(0, position % length());
    levels(); announce('playing');
  }
  return {
    sync,
    update(options = {}) { muffled = options.muffled !== false; sync(); },
    state: () => status,
    dispose() { controller?.abort(); stop(); filter?.disconnect(); gain?.disconnect(); },
  };
}
