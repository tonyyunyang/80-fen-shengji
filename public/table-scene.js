// Decorative only: the DOM remains the complete, accessible game surface.
// WebGL renders on demand; no animation loop runs while the table is idle.
export async function createTableScene(host, enabled = true) {
  let renderer, scene, camera, group, observer, texture, frame = 0, frames = 0;
  let width = 0, height = 0, x = 0, y = 0, targetX = 0, targetY = 0, disposed = false, lost = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(pointer: fine)');
  const table = host.parentElement;
  const status = value => { host.dataset.renderer = value; table.dataset.scene = value; };
  const cancel = () => { cancelAnimationFrame(frame); frame = 0; };
  function request() { if (!frame && renderer && enabled && !document.hidden && !disposed && !lost) frame = requestAnimationFrame(render); }
  function render() {
    frame = 0;
    if (!enabled || document.hidden || disposed || lost) return;
    x += (targetX - x) * .16; y += (targetY - y) * .16;
    group.rotation.set(y, x, 0);
    renderer.render(scene, camera); host.dataset.frames = String(++frames);
    if (Math.abs(targetX - x) + Math.abs(targetY - y) > .00015) request();
  }
  function pointer(event) {
    if (reduced.matches || !fine.matches) return;
    const rect = table.getBoundingClientRect();
    targetX = ((event.clientX - rect.left) / rect.width - .5) * .018;
    targetY = ((event.clientY - rect.top) / rect.height - .5) * .018; request();
  }
  const center = () => { targetX = targetY = 0; if (reduced.matches) x = y = 0; request(); };
  const visibility = () => document.hidden ? cancel() : request();
  const api = {
    setEnabled(value) { enabled = value; host.hidden = !value || lost || disposed; status(value && renderer && !lost && !disposed ? 'webgl' : 'css'); value ? request() : cancel(); },
    dispose() {
      disposed = true; cancel(); observer?.disconnect();
      table.removeEventListener('pointermove', pointer); table.removeEventListener('pointerleave', center);
      document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', center);
      group?.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      texture?.dispose(); renderer?.dispose(); host.replaceChildren();
    },
  };
  try {
    const canvas = document.createElement('canvas');
    // Probe before importing Three; unsupported devices keep the CSS table.
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!context) { status('css'); return api; }
    const THREE = await import('/vendor/three/0.185.1/three.module.min.js');
    renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene(); group = new THREE.Group(); scene.add(group);
    camera = new THREE.OrthographicCamera(-6, 6, 3, -3, .1, 30); camera.position.set(0, -.45, 12); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xfff6de, 0x0a1c19, 2.1));
    const lamp = new THREE.DirectionalLight(0xffefcf, 3); lamp.position.set(-3, 5, 8); scene.add(lamp);
    const bounce = new THREE.DirectionalLight(0x89b8ab, .65); bounce.position.set(5, -3, 4); scene.add(bounce);
    const weave = document.createElement('canvas'); weave.width = weave.height = 128;
    const ctx = weave.getContext('2d'), pixels = ctx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const variation = ((i * 37 + Math.floor(i / 128) * 13) % 17) - 8;
      pixels.data.set([32 + variation, 78 + variation, 64 + variation, 255], i * 4);
    }
    ctx.putImageData(pixels, 0, 0);
    texture = new THREE.CanvasTexture(weave); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(12, 8); texture.colorSpace = THREE.SRGBColorSpace;
    function shape(w, h, r) {
      const s = new THREE.Shape(), l = -w / 2, b = -h / 2;
      s.moveTo(l + r, b); s.lineTo(l + w - r, b); s.quadraticCurveTo(l + w, b, l + w, b + r);
      s.lineTo(l + w, b + h - r); s.quadraticCurveTo(l + w, b + h, l + w - r, b + h);
      s.lineTo(l + r, b + h); s.quadraticCurveTo(l, b + h, l, b + h - r);
      s.lineTo(l, b + r); s.quadraticCurveTo(l, b, l + r, b); return s;
    }
    function surface(w, h, r, z, color, map = null, metalness = 0) {
      const geometry = new THREE.ExtrudeGeometry(shape(w, h, r), { depth: .06, steps: 1, bevelEnabled: true, bevelSegments: 3, bevelSize: .035, bevelThickness: .035, curveSegments: 20 });
      const material = new THREE.MeshStandardMaterial({ color, map, roughness: map ? .95 : .48, metalness });
      const mesh = new THREE.Mesh(geometry, material); mesh.position.z = z; group.add(mesh);
    }
    function resize() {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height || width === rect.width && height === rect.height) return;
      width = rect.width; height = rect.height; renderer.setSize(width, height);
      const aspect = width / height, w = 5.8 * aspect, h = 5.8;
      camera.left = -3 * aspect; camera.right = 3 * aspect; camera.updateProjectionMatrix();
      for (const child of [...group.children]) { child.geometry.dispose(); child.material.dispose(); group.remove(child); }
      surface(w, h, .96, 0, 0x362c25);
      surface(w - .10, h - .10, .90, .07, 0x967746, null, .5);
      surface(w - .19, h - .19, .85, .14, 0x3a3027);
      surface(w - .44, h - .44, .72, .19, 0xc0a569, null, .4);
      surface(w - .49, h - .49, .70, .24, 0xffffff, texture);
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(shape(w - .90, h - .90, .58).getPoints(28));
      const line = new THREE.LineLoop(lineGeometry, new THREE.LineBasicMaterial({ color: 0xb5be92, transparent: true, opacity: .18 }));
      line.position.z = .35; group.add(line); request();
    }
    canvas.setAttribute('aria-hidden', 'true'); host.replaceChildren(canvas); status('webgl');
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; cancel(); host.hidden = true; status('css'); });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; api.setEnabled(enabled); request(); });
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    table.addEventListener('pointermove', pointer, { passive: true }); table.addEventListener('pointerleave', center);
    document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', center);
    api.setEnabled(enabled);
  } catch {
    api.dispose(); status('css');
  }
  return api;
}
