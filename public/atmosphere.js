// Original procedural ink, rendered behind the accessible HTML table. The
// drawing buffer is bounded, with real elapsed-time gating independent of Hz.
// No textures, downloads, game observations or third-party renderer are needed.
const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float energy;
mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.)*2.3;
  float t=time*.055;
  p*=turn(.18*sin(t*.7));
  vec2 q=p;
  for(int i=0;i<4;i++){
    float f=float(i)+1.;
    q+=.24/f*vec2(sin(q.y*f*2.2+t*(1.+f*.12)),cos(q.x*f*2.0-t*.8));
    q*=turn(.32);
  }
  float curl=sin(q.x*3.8+q.y*2.1+sin(q.y*3.-t)*1.35+t);
  float bands=sin(curl*5.+q.x*2.2-t);
  float flow=smoothstep(-.8,.9,curl);
  float ridge=pow(.5+.5*bands,8.);
  vec3 ink=vec3(.025,.063,.094);
  vec3 teal=vec3(.105,.315,.285);
  vec3 wine=vec3(.30,.12,.22);
  float warmth=smoothstep(-.5,1.3,q.x-q.y*.55+sin(t*.6));
  vec3 color=mix(ink,mix(teal,wine,warmth),flow*.78+.12);
  color+=ridge*mix(vec3(.035,.07,.055),vec3(.10,.047,.029),warmth);
  float grain=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
  color+=(grain-.5)*.018;
  float vignette=1.-smoothstep(.25,1.1,length((uv-.5)*vec2(1.,.85)));
  color*=.64+.5*vignette;
  color=mix(ink,color,energy);
  gl_FragColor=vec4(color,1.);
}`;

export function createAtmosphere(canvas) {
  let gl, program, buffer, uniforms, frame = 0, last = -Infinity, elapsed = 0;
  let previous = null, options = {}, disposed = false, failed = false;
  const shaders = [];
  const moving = () => !disposed && !failed && !document.hidden && options.motion && options.effects !== 'off'
    && ['menu', 'game'].includes(options.screen) && !options.paused;

  function initialize() {
    if (gl || failed || disposed) return;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL unavailable');
      program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader unavailable');
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader unavailable');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['resolution','time','energy'].map(name => [name, gl.getUniformLocation(program, name)]));
      canvas.dataset.ready = 'true';
    } catch { failed = true; canvas.hidden = true; release(); }
  }
  function size() {
    if (!gl) return;
    const max = options.effects === 'soft' ? 640 : 960;
    const scale = Math.min(1, max / innerWidth, 600 / innerHeight);
    const width = Math.max(1, Math.round(innerWidth * scale)), height = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
  }
  function draw() {
    if (!gl || failed || gl.isContextLost()) return;
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, elapsed / 1000);
    gl.uniform1f(uniforms.energy, options.effects === 'soft' ? .55 : 1.);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function tick(now) {
    frame = 0;
    if (!moving()) { previous = null; return; }
    const interval = options.effects === 'soft' ? 50 : 1000 / 30;
    if (now - last >= interval - .5) {
      if (previous !== null) elapsed += Math.min(100, now - previous);
      previous = now; last = now; draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; previous = null; }
  function update(next) {
    const old = options; options = next;
    if (options.effects === 'off') { stop(); canvas.hidden = true; return; }
    initialize();
    if (failed || disposed) return;
    canvas.hidden = false;
    const changed = old.effects !== next.effects || old.motion !== next.motion || old.screen !== next.screen || old.paused !== next.paused;
    if (changed || !canvas.width) { size(); if (!document.hidden) draw(); }
    if (moving()) { if (!frame) frame = requestAnimationFrame(tick); }
    else stop();
  }
  function resize() { size(); if (!document.hidden && options.effects !== 'off') draw(); }
  function release() {
    if (!gl) return;
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    shaders.splice(0).forEach(shader => gl.deleteShader(shader));
    gl = null; program = null; buffer = null;
  }
  function lost(event) { event.preventDefault(); stop(); failed = true; canvas.hidden = true; }
  function restored() { release(); failed = false; update(options); resize(); }
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  window.addEventListener('resize', resize);
  return { update, destroy() { disposed = true; stop(); release(); window.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored); } };
}
