(() => {
  const canvas = document.getElementById('gearCanvas');
  const ctx = canvas.getContext('2d');

  const menu = document.getElementById('menu');
  const titleSign = document.getElementById('titleSign');
  const feedback = document.getElementById('feedback');
  const predictControls = document.getElementById('predictControls');
  const discoverTray = document.getElementById('discoverTray');
  const teacherPanel = document.getElementById('teacherPanel');
  const soundBtn = document.getElementById('soundBtn');

  let W = 0, H = 0, DPR = 1;
  let mode = 'menu';
  let gears = [];
  let dragging = null;
  let pointer = { x: 0, y: 0 };
  let audioCtx = null;
  let soundOn = true;
  let teacherMode = false;
  let slowFactor = 1;
  let score = 0;
  let lastTime = performance.now();

  const COLORS = {
    green: '#78cc24',
    yellow: '#ffd52d',
    blue: '#2aa5ff',
    orange: '#ff8b19',
    purple: '#9b45e8',
    red: '#ef4444'
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function gear(id, x, y, r, color, opts = {}) {
    return {
      id, x, y, homeX: x, homeY: y, r,
      teeth: opts.teeth || 16,
      color,
      angle: opts.angle || 0,
      speed: opts.speed || 0,
      lockedTo: opts.lockedTo || null,
      fixed: !!opts.fixed,
      target: !!opts.target,
      unknown: !!opts.unknown,
      start: !!opts.start,
      connected: !!opts.connected,
      draggable: opts.draggable !== false,
      dir: opts.dir || 1
    };
  }

  function setupDiscover() {
    mode = 'discover';
    titleSign.textContent = 'Ontdek';
    menu.classList.add('hidden');
    predictControls.classList.add('hidden');
    discoverTray.classList.remove('hidden');
    feedback.classList.add('hidden');
    score = 0;

    const cy = H * 0.49;
    const r = Math.min(W, H) * 0.085;
    gears = [
      gear('motor', W * 0.22, cy, r, COLORS.green, {
        fixed: true, draggable: false, start: true, connected: true, speed: 0.42, dir: 1
      }),
      gear('loose1', W * 0.48, cy + r * 1.05, r * 0.88, COLORS.yellow),
      gear('loose2', W * 0.63, cy - r * 0.95, r * 0.78, COLORS.blue),
      gear('loose3', W * 0.75, cy + r * 0.65, r * 0.7, COLORS.orange)
    ];
  }

  function setupPredict() {
    mode = 'predict';
    titleSign.textContent = 'Kies!';
    menu.classList.add('hidden');
    discoverTray.classList.add('hidden');
    predictControls.classList.remove('hidden');
    feedback.classList.add('hidden');

    const cy = H * 0.48;
    const baseR = Math.min(W, H) * 0.078;
    const count = 2 + Math.min(5, Math.floor(score / 2) + 1);
    const startX = W * 0.24;
    const spacing = baseR * 1.72;

    gears = [];
    const startDir = Math.random() > 0.5 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const color = i === 0 ? COLORS.green : i === count - 1 ? COLORS.purple : [COLORS.yellow, COLORS.blue, COLORS.orange][(i - 1) % 3];
      gears.push(gear(`p${i}`, startX + i * spacing, cy + Math.sin(i * 1.1) * baseR * .18, baseR * (i % 2 ? .9 : 1), color, {
        fixed: true,
        draggable: false,
        connected: true,
        start: i === 0,
        target: i === count - 1,
        unknown: i === count - 1,
        speed: i === 0 ? 0.42 * startDir : 0,
        dir: i === 0 ? startDir : 0
      }));
    }
    solveConnections();
  }

  function solveConnections() {
    if (!gears.length) return;
    gears[0].connected = true;
    gears[0].dir = gears[0].dir || 1;
    gears[0].speed = Math.abs(gears[0].speed || 0.42) * gears[0].dir;

    for (let pass = 0; pass < gears.length; pass++) {
      for (const a of gears) {
        if (!a.connected) continue;
        for (const b of gears) {
          if (a === b || b.connected) continue;
          if (touching(a, b, 16)) {
            b.connected = true;
            b.lockedTo = a.id;
            b.dir = -Math.sign(a.speed || a.dir || 1);
            b.speed = Math.abs(a.speed || 0.42) * (a.r / b.r) * b.dir;
          }
        }
      }
    }
  }

  function touching(a, b, tolerance = 12) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return Math.abs(d - (a.r + b.r)) < tolerance;
  }

  function snapIfPossible(g) {
    const candidates = gears.filter(o => o !== g && o.connected);
    let best = null;
    let bestDelta = 99999;

    for (const o of candidates) {
      const dx = g.x - o.x;
      const dy = g.y - o.y;
      const dist = Math.hypot(dx, dy) || 1;
      const targetDist = g.r + o.r;
      const delta = Math.abs(dist - targetDist);
      if (delta < bestDelta && delta < Math.max(26, g.r * .32)) {
        best = o;
        bestDelta = delta;
      }
    }

    if (!best) return false;

    const dx = g.x - best.x;
    const dy = g.y - best.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    g.x = best.x + ux * (g.r + best.r);
    g.y = best.y + uy * (g.r + best.r);
    g.connected = true;
    g.lockedTo = best.id;
    g.dir = -Math.sign(best.speed || best.dir || 1);
    g.speed = Math.abs(best.speed || 0.42) * (best.r / g.r) * g.dir;
    g.draggable = true;
    playSuccess();
    showFeedback('Klik!');
    return true;
  }

  function addGear() {
    if (mode !== 'discover') return;
    const palette = [COLORS.yellow, COLORS.blue, COLORS.orange, COLORS.purple];
    const r = Math.min(W, H) * (0.06 + Math.random() * 0.025);
    gears.push(gear(`loose${Date.now()}`, W * (0.42 + Math.random() * .3), H * (0.34 + Math.random() * .28), r, palette[gears.length % palette.length]));
  }

  function resetDiscover() {
    if (mode === 'discover') setupDiscover();
    else if (mode === 'predict') setupPredict();
  }

  function nextPredict() {
    score++;
    showFeedback('Goed!');
    playSuccess();
    setTimeout(setupPredict, 700);
  }

  function answer(dir) {
    if (mode !== 'predict') return;
    const target = gears[gears.length - 1];
    const correct = Math.sign(target.speed) === dir;
    target.unknown = false;
    if (correct) {
      nextPredict();
    } else {
      showFeedback('Bijna!');
      playWrong();
      setTimeout(setupPredict, 900);
    }
  }

  function drawGear(g) {
    const teeth = g.teeth;
    const rootR = g.r * .88;
    const outerR = g.r;
    const innerR = g.r * .44;
    const hubR = g.r * .16;

    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);

    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = i * Math.PI / teeth;
      const r = i % 2 === 0 ? outerR : rootR;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const grad = ctx.createRadialGradient(-g.r * .3, -g.r * .35, g.r * .15, 0, 0, g.r);
    grad.addColorStop(0, lighten(g.color, .28));
    grad.addColorStop(.58, g.color);
    grad.addColorStop(1, darken(g.color, .24));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(4, g.r * .045);
    ctx.strokeStyle = darken(g.color, .32);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fillStyle = g.color;
    ctx.fill();
    ctx.lineWidth = Math.max(3, g.r * .025);
    ctx.strokeStyle = lighten(g.color, .18);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#2f3945';
    ctx.fill();
    ctx.lineWidth = Math.max(3, g.r * .025);
    ctx.strokeStyle = '#111827';
    ctx.stroke();

    ctx.restore();

    if (g.connected || g.start || mode === 'predict') drawArrow(g);
    if (g.unknown) drawQuestion(g);
    if (g.target && !g.unknown) drawGlow(g);
  }

  function drawArrow(g) {
    const visible = mode === 'discover' ? g.connected : (!g.unknown || g.start);
    if (!visible) return;
    const dir = Math.sign(g.speed || g.dir || 1);
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle * .35);

    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(8, g.r * .12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const start = dir > 0 ? -1.1 : 1.1;
    const end = dir > 0 ? 1.8 : -1.8;
    ctx.arc(0, 0, g.r * .52, start, end, dir < 0);
    ctx.stroke();

    const endAngle = end;
    const ax = Math.cos(endAngle) * g.r * .52;
    const ay = Math.sin(endAngle) * g.r * .52;
    ctx.translate(ax, ay);
    ctx.rotate(endAngle + (dir > 0 ? Math.PI / 2 : -Math.PI / 2));
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(0, -g.r * .16);
    ctx.lineTo(g.r * .18, g.r * .18);
    ctx.lineTo(-g.r * .18, g.r * .18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawQuestion(g) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.shadowColor = 'rgba(155,69,232,.8)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = 'white';
    ctx.font = `900 ${g.r * .92}px Trebuchet MS`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 2);
    ctx.restore();
  }

  function drawGlow(g) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, g.r * 1.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGhostLine() {
    if (!dragging) return;
    const g = dragging.gear;
    const candidates = gears.filter(o => o !== g && o.connected);
    for (const o of candidates) {
      const d = Math.hypot(g.x - o.x, g.y - o.y);
      if (Math.abs(d - (g.r + o.r)) < Math.max(34, g.r * .42)) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function loop(now) {
    const dt = Math.min(.05, (now - lastTime) / 1000);
    lastTime = now;

    ctx.clearRect(0, 0, W, H);
    for (const g of gears) {
      if (g.connected || mode === 'predict') {
        g.angle += (g.speed || 0) * dt * slowFactor;
      }
      drawGear(g);
    }
    drawGhostLine();
    requestAnimationFrame(loop);
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'discover') return;
    const p = pointerPos(e);
    const sorted = [...gears].reverse();
    const hit = sorted.find(g => g.draggable && Math.hypot(p.x - g.x, p.y - g.y) < g.r);
    if (!hit || hit.fixed) return;
    dragging = { gear: hit, dx: p.x - hit.x, dy: p.y - hit.y };
    hit.connected = false;
    hit.lockedTo = null;
    hit.speed = 0;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const p = pointerPos(e);
    dragging.gear.x = p.x - dragging.dx;
    dragging.gear.y = p.y - dragging.dy;
  });

  canvas.addEventListener('pointerup', e => {
    if (!dragging) return;
    const g = dragging.gear;
    dragging = null;
    if (!snapIfPossible(g)) {
      playTone(180, .08, 'triangle');
    }
  });

  function showFeedback(text) {
    feedback.textContent = text;
    feedback.classList.remove('hidden');
    clearTimeout(showFeedback.t);
    showFeedback.t = setTimeout(() => feedback.classList.add('hidden'), 800);
  }

  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, dur = .08, type = 'sine') {
    if (!soundOn) return;
    const ac = getAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(.001, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(.09, ac.currentTime + .01);
    gain.gain.exponentialRampToValueAtTime(.001, ac.currentTime + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur + .02);
  }

  function playSuccess() {
    playTone(520, .07);
    setTimeout(() => playTone(660, .08), 80);
  }

  function playWrong() {
    playTone(230, .10, 'triangle');
    setTimeout(() => playTone(190, .10, 'triangle'), 100);
  }

  function lighten(hex, amount) { return mix(hex, '#ffffff', amount); }
  function darken(hex, amount) { return mix(hex, '#000000', amount); }
  function mix(a, b, amount) {
    const ah = parseInt(a.replace('#',''), 16);
    const ar = ah >> 16, ag = ah >> 8 & 255, ab = ah & 255;
    const bh = parseInt(b.replace('#',''), 16);
    const br = bh >> 16, bg = bh >> 8 & 255, bb = bh & 255;
    const rr = Math.round(ar + (br - ar) * amount);
    const rg = Math.round(ag + (bg - ag) * amount);
    const rb = Math.round(ab + (bb - ab) * amount);
    return `rgb(${rr},${rg},${rb})`;
  }

  document.getElementById('discoverBtn').addEventListener('click', setupDiscover);
  document.getElementById('predictBtn').addEventListener('click', setupPredict);
  document.getElementById('homeBtn').addEventListener('click', () => {
    mode = 'menu';
    gears = [];
    titleSign.textContent = 'Tandwielen';
    menu.classList.remove('hidden');
    predictControls.classList.add('hidden');
    discoverTray.classList.add('hidden');
    feedback.classList.add('hidden');
  });
  document.getElementById('leftBtn').addEventListener('click', () => answer(-1));
  document.getElementById('rightBtn').addEventListener('click', () => answer(1));
  document.getElementById('addGearBtn').addEventListener('click', addGear);
  document.getElementById('resetBtn').addEventListener('click', resetDiscover);
  document.getElementById('newBtn').addEventListener('click', resetDiscover);
  document.getElementById('showBtn').addEventListener('click', () => {
    for (const g of gears) {
      g.unknown = false;
      g.connected = true;
    }
  });
  document.getElementById('slowBtn').addEventListener('click', () => {
    slowFactor = slowFactor === 1 ? .45 : 1;
    document.getElementById('slowBtn').textContent = slowFactor === 1 ? 'Langzaam' : 'Normaal';
  });
  document.getElementById('teacherBtn').addEventListener('click', () => {
    teacherMode = !teacherMode;
    teacherPanel.classList.toggle('hidden', !teacherMode);
  });
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔈' : '🔇';
  });
  document.getElementById('fullBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  window.addEventListener('resize', () => {
    resize();
    if (mode === 'discover') setupDiscover();
    if (mode === 'predict') setupPredict();
  });

  resize();
  requestAnimationFrame(loop);
})();
