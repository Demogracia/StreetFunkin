/* ===== CONFIGURACIÓN (edita aquí) ===== */
// src: ruta del audio de Daske (ej. 'audio/cancion1.mp3'). demo:true = pista generada por código.
const SONGS = [
  { id: 's1', title: 'Canción 1 (por definir)', artist: 'Daske Gaitán', src: 'audio/nivel1.mp3', bg: [ '#2b1055', '#ff3d81' ], bgImage: 'assets/nivel1_bg.jpg' },
  { id: 's2', title: 'Canción 2 (por definir)', artist: 'Daske Gaitán', src: 'audio/nivel2.mp3', bg: [ '#0f2027', '#2ee6d6' ], bgImage: 'assets/nivel2_bg.jpg' },
  { id: 's3', title: 'Canción 3 (por definir)', artist: 'Daske Gaitán', src: 'audio/nivel3.mp3', bg: [ '#232526', '#ffd23f' ], bgImage: 'assets/nivel3_bg.jpg' }
];
// Sprites de personajes (PNG con fondo transparente). Si no existen, se dibuja un placeholder.
const SPRITES = {
  player: { // Daske Gaitán: una imagen por estado. Si falta alguna, usa 'idle'.
    idle: 'assets/player_idle.png',
    perfect: 'assets/player_perfect.png',
    good: 'assets/player_good.png',
    bad: 'assets/player_bad.png',
    miss: 'assets/player_miss.png'
  },
  rival: { idle: 'assets/rival_idle.png' } // Retador
};
const NAMES = { player: 'Daske Gaitán', rival: 'Retador' };
// bgImage = imagen de fondo de ese nivel (se estira para cubrir toda la pantalla).
// Si el archivo no existe, se usa el degradado de 'bg'. El fondo de menús está en style.css (--fondo).

const LANES = [
  { keys: ['ArrowLeft', 'a'], color: '#2ee6d6', arrow: '◀' },
  { keys: ['ArrowDown', 's'], color: '#ff3d81', arrow: '▼' },
  { keys: ['ArrowUp', 'w'], color: '#7dff6a', arrow: '▲' },
  { keys: ['ArrowRight', 'd'], color: '#ffd23f', arrow: '▶' }
];
let W = 960, H = 540, LANE_W = 90, REC_Y = 430, SPEED = 400, R = 28, K = 1; // se recalculan al cambiar el tamaño de ventana
const WIN = { perfect: 0.08, good: 0.14, bad: 0.2 }; // márgenes de acierto (más amplios = más fácil)
const MIN_GAP = 0.38; // segundos mínimos entre notas (más alto = menos notas)

/* ===== UTILIDADES ===== */
const $ = (s) => document.querySelector(s);
const cv = $('#stage'), g = cv.getContext('2d');
let ctx; // AudioContext
const audioCtx = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  $('#hud').hidden = id !== null && id !== 'pause';
  if (id === 'menu' || id === 'songs' || id === 'credits' || id === 'results') stopSong();
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

const imgs = {};
Object.entries(SPRITES).forEach(([who, poses]) => Object.entries(poses).forEach(([pose, src]) => {
  const im = new Image(); im.onload = () => (imgs[who + '.' + pose] = im); im.src = src;
}));
let poseP = 'idle', poseUntil = 0; // pose actual del jugador
const setPose = (p) => { poseP = p; poseUntil = performance.now() + 450; };
const bgImgs = {}; // imágenes de fondo de cada nivel
SONGS.forEach((s) => { if (s.bgImage) { const im = new Image(); im.onload = () => (bgImgs[s.id] = im); im.src = s.bgImage; } });

/* ===== AUDIO DE EJEMPLO (sintetizado) ===== */
function makeDemo() {
  const sr = audioCtx().sampleRate, bpm = 110, beat = 60 / bpm, beats = 64;
  const buf = audioCtx().createBuffer(1, Math.floor(sr * beat * beats), sr), d = buf.getChannelData(0);
  const add = (t, len, fn) => { const s = Math.floor(t * sr); for (let i = 0; i < len * sr && s + i < d.length; i++) d[s + i] += fn(i / sr); };
  for (let b = 0; b < beats; b++) {
    const t = b * beat;
    add(t, 0.25, (x) => Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 12) * 0.8); // bombo
    add(t + beat / 2, 0.05, (x) => (Math.random() * 2 - 1) * Math.exp(-x * 90) * 0.25); // hi-hat
    if (b % 2 === 1) add(t, 0.15, (x) => (Math.random() * 2 - 1) * Math.exp(-x * 25) * 0.4); // caja
    const f = [110, 110, 146.8, 130.8][b % 4];
    add(t + beat / 2, 0.2, (x) => Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 9) * 0.3); // bajo
  }
  return buf;
}

/* ===== DETECCIÓN AUTOMÁTICA DE RITMO =====
   Divide el audio en graves y agudos, mide el aumento de energía (flujo) y toma los picos. */
function detectNotes(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, hop = 512, n = Math.floor(d.length / hop);
  const lo = new Float32Array(n), hi = new Float32Array(n);
  let lp = 0, prev = 0;
  for (let f = 0; f < n; f++) {
    let a = 0, b = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      lp += 0.05 * (d[i] - lp);
      const h = d[i] - prev; prev = d[i];
      a += lp * lp; b += h * h;
    }
    lo[f] = Math.sqrt(a / hop); hi[f] = Math.sqrt(b / hop);
  }
  const flux = (x) => {
    const mx = Math.max(...x) || 1, fl = new Float32Array(n);
    for (let f = 1; f < n; f++) fl[f] = Math.max(0, x[f] - x[f - 1]) / mx;
    const pre = new Float32Array(n + 1);
    for (let f = 0; f < n; f++) pre[f + 1] = pre[f] + fl[f];
    const thr = new Float32Array(n), w = 43;
    for (let f = 0; f < n; f++) {
      const a = Math.max(0, f - w), b = Math.min(n, f + w);
      thr[f] = ((pre[b] - pre[a]) / (b - a)) * 2.2 + 0.05;
    }
    return { fl, thr };
  };
  const L = flux(lo), Hh = flux(hi), notes = [];
  let last = -1, tl = 0, th = 0;
  for (let f = 1; f < n - 1; f++) {
    const t = (f * hop) / sr;
    const rl = L.fl[f] / L.thr[f], rh = Hh.fl[f] / Hh.thr[f];
    const peakL = rl > 1 && L.fl[f] >= L.fl[f - 1] && L.fl[f] >= L.fl[f + 1];
    const peakH = rh > 1 && Hh.fl[f] >= Hh.fl[f - 1] && Hh.fl[f] >= Hh.fl[f + 1];
    if ((peakL || peakH) && t - last >= MIN_GAP) {
      const low = peakL && (!peakH || rl >= rh);
      const lane = low ? (tl++ % 2) : 2 + (th++ % 2);
      notes.push({ t: t + 0.02, lane, done: false });
      last = t;
    }
  }
  // Notas sostenidas ocasionales: solo donde hay un espacio largo hasta la siguiente nota
  for (let i = 0; i < notes.length - 1; i++) {
    const gap = notes[i + 1].t - notes[i].t;
    if (gap > 1.1 && i % 3 === 0) notes[i].len = Math.min(gap - 0.5, 1.3);
  }
  return notes;
}

/* ===== ESTADO DEL JUEGO ===== */
let song, buffer, notes, src, startAt, playing = false, paused = false, raf;
let st; // score, combo, health, counts
let rec = false, recDown = []; // modo grabación (admin)
let judgeTimer, pulse = { p: 0, r: 0 }, pressed = [0, 0, 0, 0];

/* ===== PATRONES GRABADOS (admin) =====
   Prioridad al jugar: 1) patrón grabado en este navegador, 2) archivo patterns/<id>.json, 3) detección automática. */
const PKEY = 'streetfunkin.pattern.';
const setStatus = (m) => { $('#status').textContent = m; $('#adminStatus').textContent = m; };
function getPattern(id) {
  try { const v = localStorage.getItem(PKEY + id); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function savePattern(id, list) {
  const data = list.map((n) => (n.len ? { t: n.t, lane: n.lane, len: n.len } : { t: n.t, lane: n.lane }));
  try { localStorage.setItem(PKEY + id, JSON.stringify(data)); return true; } catch (e) { return false; }
}

async function loadSong(s, file, recMode) {
  setStatus('Cargando el audio…');
  try {
    audioCtx();
    if (s.demo) buffer = makeDemo();
    else {
      const ab = file ? await file.arrayBuffer() : await (await fetch(s.src)).arrayBuffer();
      buffer = await ctx.decodeAudioData(ab);
    }
    if (recMode) notes = [];
    else {
      let pat = getPattern(s.id);
      if (!pat && !file) {
        try { const r = await fetch('patterns/' + s.id + '.json'); if (r.ok) pat = await r.json(); } catch (e) {}
      }
      if (pat && pat.length) notes = pat.map((n) => ({ t: n.t, lane: n.lane, len: n.len, done: false }));
      else {
        notes = detectNotes(buffer); // detección automática
        if (notes.length < 5) throw new Error('No se detectó ritmo suficiente.');
      }
    }
    setStatus('');
    song = s; rec = !!recMode; start();
  } catch (e) {
    setStatus('No se pudo cargar el audio (' + (e.message || 'error') + '). Revisa la ruta en SONGS o carga un archivo.');
  }
}

/* ===== GRABACIÓN ===== */
function recordPress(lane) {
  const t = now();
  if (t < -0.1) return;
  const n = { t: Math.round(Math.max(0, t) * 1000) / 1000, lane, done: true };
  notes.push(n); recDown[lane] = n; pulse.p = 1; setPose('perfect');
}
function endHold(lane) { // si mantienes la tecla más de 0.4 s se graba como nota sostenida
  const n = recDown[lane]; if (!n) return;
  const d = now() - n.t;
  if (d > 0.4) n.len = Math.round(d * 1000) / 1000;
  recDown[lane] = null;
}
function release(lane) { pressed[lane] = 0; if (rec) endHold(lane); }
function endRec() {
  LANES.forEach((_, i) => endHold(i));
  stopSong(); rec = false;
  const list = notes.slice().sort((a, b) => a.t - b.t);
  if (list.length && confirm('¿Guardar el patrón con ' + list.length + ' notas?')) {
    setStatus(savePattern(song.id, list) ? 'Patrón guardado (' + list.length + ' notas).' : 'No se pudo guardar en este navegador.');
  } else setStatus('Grabación descartada.');
  show('admin'); refreshAdmin();
}

/* ===== MENÚ ADMIN ===== */
function exportPattern(s) {
  const pat = getPattern(s.id);
  if (!pat) return setStatus('No hay patrón grabado para exportar.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(pat)], { type: 'application/json' }));
  a.download = s.id + '.json'; a.click();
  setStatus('Guarda ' + s.id + '.json en la carpeta patterns/ para que el patrón quede permanente para todos los visitantes.');
}
function refreshAdmin() {
  const ul = $('#adminList'); ul.innerHTML = '';
  SONGS.forEach((s, i) => {
    const pat = getPattern(s.id), li = document.createElement('li');
    li.innerHTML = `<div class="arow"><strong>Nivel ${i + 1} · ${s.title}</strong><small>${pat ? 'Patrón grabado: ' + pat.length + ' notas' : 'Sin patrón grabado (se detecta automático)'}</small></div>`;
    const bar = document.createElement('div'); bar.className = 'abtns';
    [
      ['● Grabar', () => { if (!pat || confirm('Ya hay un patrón. Se reemplazará al guardar. ¿Continuar?')) loadSong(s, null, true); }],
      ['Probar', () => loadSong(s)],
      ['Exportar', () => exportPattern(s)],
      ['Eliminar', () => {
        if (!pat) return setStatus('Este nivel no tiene patrón grabado.');
        if (!confirm('¿Eliminar el patrón del nivel ' + (i + 1) + '?')) return;
        try { localStorage.removeItem(PKEY + s.id); } catch (e) {}
        setStatus('Patrón eliminado. El nivel vuelve a usar la detección automática.'); refreshAdmin();
      }]
    ].forEach(([label, fn]) => { const b = document.createElement('button'); b.textContent = label; b.className = 'alt'; b.onclick = fn; bar.appendChild(b); });
    li.appendChild(bar); ul.appendChild(li);
  });
}
$('#btnAdmin').onclick = () => {
  const pw = prompt('Contraseña de administrador:');
  if (pw === '2110') { setStatus(''); show('admin'); refreshAdmin(); }
  else if (pw !== null) alert('Contraseña incorrecta');
};

function start() {
  stopSong();
  notes.forEach((n) => { n.done = false; n.holding = false; n.rival = false; });
  pressed = [0, 0, 0, 0]; poseP = 'idle';
  st = { score: 0, combo: 0, maxCombo: 0, health: 60, perfect: 0, good: 0, bad: 0, miss: 0, wrong: 0 };
  recDown = [];
  show(null);
  $('#hud').hidden = rec;
  src = ctx.createBufferSource(); src.buffer = buffer; src.connect(ctx.destination);
  startAt = ctx.currentTime + 2.5; src.start(startAt);
  playing = true; paused = false;
  judge('', '');
  loop();
}
function stopSong() {
  playing = false; cancelAnimationFrame(raf);
  if (src) { try { src.stop(); } catch (e) {} src = null; }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
const now = () => ctx.currentTime - startAt;

function pause(on) {
  if (!playing) return;
  paused = on;
  if (on) { ctx.suspend(); show('pause'); $('#hud').hidden = false; }
  else { ctx.resume(); show(null); $('#hud').hidden = false; }
}
$('#btnResume').onclick = () => pause(false);
$('#btnRestart').onclick = () => { ctx.resume(); start(); };
$('#btnQuit').onclick = () => { stopSong(); show('songs'); };
$('#btnAgain').onclick = () => start();

function judge(text, color) {
  const el = $('#hudJudge'); el.textContent = text; el.style.color = color || '';
  clearTimeout(judgeTimer); judgeTimer = setTimeout(() => (el.textContent = ''), 500);
}
function hud() {
  $('#hudScore').textContent = st.score;
  $('#hudCombo').textContent = st.combo > 1 ? 'Combo x' + st.combo : '';
  $('#healthBar').style.width = st.health + '%';
}

/* ===== ENTRADA ===== */
function press(lane) {
  pressed[lane] = 1;
  if (rec) { recordPress(lane); return; }
  const t = now();
  const n = notes.find((x) => !x.done && !x.holding && x.lane === lane && Math.abs(x.t - t) <= WIN.bad);
  if (!n) { // tecla sin nota: penalización anti-spam
    if (t < 0) return;
    st.wrong++; st.combo = 0; st.health = Math.max(0, st.health - 3);
    judge('¡Sin nota!', '#ff3d81'); setPose('miss'); hud(); return;
  }
  if (n.len) n.holding = true; else n.done = true; // sostenida: se completa al mantener la tecla
  const dt = Math.abs(n.t - t);
  const k = dt <= WIN.perfect ? 'perfect' : dt <= WIN.good ? 'good' : 'bad';
  st[k]++; st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo);
  st.score += { perfect: 300, good: 150, bad: 50 }[k] + st.combo * 2;
  st.health = Math.min(100, st.health + { perfect: 2.5, good: 1.5, bad: 0 }[k]);
  judge({ perfect: 'Perfect', good: 'Good', bad: 'Bad' }[k], { perfect: '#ffd23f', good: '#2ee6d6', bad: '#f2efe6' }[k]);
  pulse.p = 1; setPose(k); hud();
}
const laneOfKey = (e) => LANES.findIndex((l) => l.keys.includes(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (rec && playing) endRec(); else if (playing) pause(!paused); return; }
  if (!playing || paused || e.repeat) return;
  const lane = laneOfKey(e);
  if (lane < 0) return;
  e.preventDefault(); press(lane);
});
addEventListener('keyup', (e) => { const lane = laneOfKey(e); if (lane >= 0) release(lane); });

// Táctil / ratón: toca el carril correspondiente
const pointers = {};
const laneOfX = (x) => Math.max(0, Math.min(3, Math.floor((x - (W / 2 - LANE_W * 2)) / LANE_W)));
cv.addEventListener('pointerdown', (e) => {
  if (!playing || paused) return;
  const lane = laneOfX(e.clientX); pointers[e.pointerId] = lane; press(lane);
});
['pointerup', 'pointercancel'].forEach((ev) => addEventListener(ev, (e) => {
  if (e.pointerId in pointers) { release(pointers[e.pointerId]); delete pointers[e.pointerId]; }
}));

/* ===== BUCLE ===== */
function loop() {
  raf = requestAnimationFrame(loop);
  if (paused) return;
  const t = now();
  for (const n of notes) {
    if (n.holding) {
      const end = n.t + n.len; poseUntil = performance.now() + 250;
      if (t >= end) { n.holding = false; n.done = true; st.score += 100; st.health = Math.min(100, st.health + 2); judge('¡Sostenida!', '#7dff6a'); hud(); }
      else if (!pressed[n.lane] && t < end - 0.15) { n.holding = false; n.done = true; st.combo = 0; st.health = Math.max(0, st.health - 4); judge('Soltaste', '#ff3d81'); setPose('miss'); hud(); }
    } else if (!n.done && t - n.t > WIN.bad) {
      n.done = true; st.miss++; st.combo = 0; st.health = Math.max(0, st.health - 4);
      judge('Miss', '#ff3d81'); setPose('miss'); hud();
    }
    if (!n.rival && t >= n.t) { n.rival = true; pulse.r = 1; }
  }
  draw(t);
  if (rec) { if (t > buffer.duration + 0.5) endRec(); return; }
  if (st.health <= 0) return finish(true);
  if (t > buffer.duration + 0.5) finish(false);
}

function rankFor(acc, failed) {
  if (failed) return 'F';
  return acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 70 ? 'B' : acc >= 55 ? 'C' : acc >= 40 ? 'D' : 'F';
}
function finish(failed) {
  stopSong();
  const total = notes.length, hits = st.perfect + st.good + st.bad;
  const acc = Math.max(0, ((st.perfect + st.good * 0.7 + st.bad * 0.35) / total) * 100 - st.wrong * 0.5);
  const rank = rankFor(acc, failed);
  $('#resTitle').textContent = failed ? 'Te quedaste sin energía' : '¡Canción completada!';
  $('#resRank').textContent = rank; $('#resRank').dataset.rank = rank;
  $('#resList').innerHTML = [
    ['Puntaje', st.score], ['Precisión', acc.toFixed(1) + '%'], ['Mejor combo', st.maxCombo],
    ['Perfect', st.perfect], ['Good', st.good], ['Bad', st.bad], ['Miss', st.miss],
    ['Teclas sin nota', st.wrong], ['Notas acertadas', hits + ' / ' + total]
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  show('results');
}

/* ===== DIBUJO ===== */
function drawStage() {
  const gh = H * 0.13, bi = bgImgs[song.id];
  if (bi) { // imagen de fondo del nivel, ajustada para cubrir la pantalla
    const sc = Math.max(W / bi.width, H / bi.height), w = bi.width * sc, h = bi.height * sc;
    g.drawImage(bi, (W - w) / 2, (H - h) / 2, w, h);
    return;
  }
  const [c1, c2] = song.bg;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,.45)'; // siluetas de ciudad (placeholder)
  for (let i = 0, x = 0; x < W; i++) { const w = (60 + ((i * 37) % 50)) * K, h = (120 + ((i * 71) % 160)) * K; g.fillRect(x, H - gh - h, w, h); x += w + 6 * K; }
  g.fillStyle = '#15131a'; g.fillRect(0, H - gh, W, gh);
}
const POSE_COLOR = { perfect: '#ffd23f', good: '#2ee6d6', bad: '#f2efe6', miss: '#ff3d81' };
function rr(x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// Etiqueta con el nombre del personaje, estilo cartel de graffiti
function nameTag(text, x, bottom, color) {
  g.save();
  const fs = Math.max(15, 24 * K), ph = fs * 1.8;
  g.font = fs + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const pw = g.measureText(text).width + 38 * K, cy = Math.max(ph / 2 + 6, bottom - ph / 2), o = 4 * K;
  g.translate(x, cy); g.rotate(-0.04);
  g.fillStyle = color; rr(-pw / 2 + o, -ph / 2 + o, pw, ph, 10 * K); g.fill(); // sombra de color
  g.fillStyle = '#15131a'; rr(-pw / 2, -ph / 2, pw, ph, 10 * K); g.fill();
  g.lineWidth = Math.max(2, 3 * K); g.strokeStyle = color; g.stroke();
  g.fillStyle = '#f2efe6'; g.fillText(text, 0, 2 * K);
  g.restore();
}
function drawChar(who, pose, x, color, p) {
  const y = H - H * 0.13 - p * 18 * K, bob = Math.sin(performance.now() / 400) * 3 * K;
  const im = imgs[who + '.' + pose] || imgs[who + '.idle'];
  let top;
  if (im) { const h = H * 0.45, w = (im.width / im.height) * h; g.drawImage(im, x - w / 2, y - h, w, h); top = y - h; }
  else { // placeholder: cambia de color según el estado
    g.fillStyle = POSE_COLOR[pose] || color; g.fillRect(x - 30 * K, y - 150 * K, 60 * K, 110 * K);
    g.beginPath(); g.arc(x, y - 175 * K, 28 * K, 0, 7); g.fill();
    top = y - 203 * K;
    if (pose !== 'idle') { g.fillStyle = '#f2efe6'; g.font = Math.max(11, 14 * K) + 'px Rubik'; g.textAlign = 'center'; g.fillText(pose.toUpperCase(), x, y + 20 * K); }
  }
  nameTag(NAMES[who], x, top - 10 * K + bob, color);
}
function draw(t) {
  drawStage();
  pulse.p *= 0.88; pulse.r *= 0.88;
  if (W / H > 1.2) { // en pantallas verticales se ocultan los personajes para dar espacio a los carriles
    if (performance.now() > poseUntil) poseP = 'idle';
    drawChar('rival', 'idle', W * 0.14, '#ff3d81', pulse.r);
    drawChar('player', poseP, W * 0.86, '#2ee6d6', pulse.p);
  }
  const x0 = W / 2 - (LANE_W * 4) / 2;
  g.fillStyle = 'rgba(10,8,14,.55)'; g.fillRect(x0 - 8 * K, 0, LANE_W * 4 + 16 * K, H);
  LANES.forEach((l, i) => { // receptores
    const x = x0 + i * LANE_W + LANE_W / 2;
    g.lineWidth = Math.max(2, 4 * K); g.strokeStyle = l.color; g.fillStyle = pressed[i] ? l.color : 'rgba(255,255,255,.08)';
    g.beginPath(); g.arc(x, REC_Y, R * 1.1, 0, 7); g.fill(); g.stroke();
  });
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold ' + Math.round(R * 0.95) + 'px Rubik';
  for (const n of notes) {
    if (n.done) continue;
    const yh = REC_Y - (n.t - t) * SPEED; // las notas caen desde arriba
    if (yh < -R * 2) break;
    const l = LANES[n.lane], x = x0 + n.lane * LANE_W + LANE_W / 2, y = n.holding ? REC_Y : yh;
    if (n.len) { // cola de la nota sostenida
      const yt = REC_Y - (n.t + n.len - t) * SPEED;
      g.globalAlpha = n.holding ? 0.9 : 0.5; g.fillStyle = l.color;
      g.fillRect(x - R * 0.4, yt, R * 0.8, y - yt); g.globalAlpha = 1;
    }
    g.fillStyle = l.color; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
    g.fillStyle = '#1c1a22'; g.fillText(l.arrow, x, y + 1);
  }
  if (t < 0) { g.fillStyle = '#f2efe6'; g.font = Math.round(H * 0.12) + 'px "Permanent Marker"'; g.fillText(Math.ceil(-t), W / 2, H / 2); }
  if (rec) { // indicador de grabación
    g.fillStyle = '#ff3d81'; g.beginPath(); g.arc(24 * K, 24 * K, 8 * K, 0, 7); g.fill();
    g.fillStyle = '#f2efe6'; g.font = 'bold ' + Math.max(12, 16 * K) + 'px Rubik'; g.textAlign = 'left';
    g.fillText('GRABANDO · ' + notes.length + ' notas · Esc para terminar', 42 * K, 25 * K);
  }
  g.textBaseline = 'alphabetic';
}

/* ===== SELECTOR ===== */
SONGS.forEach((s) => {
  const li = document.createElement('li'), b = document.createElement('button');
  b.innerHTML = `${s.title}<small>${s.artist}</small>`;
  b.onclick = () => loadSong(s);
  li.appendChild(b); $('#songList').appendChild(li);
});
$('#fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadSong({ id: 'custom', title: f.name, artist: 'Audio cargado', bg: ['#1b1b3a', '#ff3d81'] }, f);
});
function resize() {
  const d = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * d); cv.height = Math.round(H * d);
  g.setTransform(d, 0, 0, d, 0, 0);
  K = Math.max(0.5, Math.min(W / 960, H / 540, 1.6));
  LANE_W = Math.min(W / 5.5, H * 0.2, 130); R = LANE_W * 0.32;
  REC_Y = H * 0.8; SPEED = H * 0.7;
  if (!playing) drawStage();
}
song = SONGS[0];
addEventListener('resize', resize);
resize();
