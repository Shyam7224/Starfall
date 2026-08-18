(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const W = canvas.width;   // logical game width  (800)
  const H = canvas.height;  // logical game height (600)

  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const highscoreEl = document.getElementById('highscore');

  const menuOverlay = document.getElementById('menu-overlay');
  const howtoOverlay = document.getElementById('howto-overlay');
  const pauseOverlay = document.getElementById('pause-overlay');
  const gameoverOverlay = document.getElementById('gameover-overlay');

  const startBtn = document.getElementById('start-btn');
  const howtoBtn = document.getElementById('howto-btn');
  const howtoBackBtn = document.getElementById('howto-back-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const restartBtn = document.getElementById('restart-btn');
  const gameoverMenuBtn = document.getElementById('gameover-menu-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const menuBtn = document.getElementById('menu-btn');
  const pauseMenuBtn = document.getElementById('pause-menu-btn');
  const difficultyRow = document.getElementById('difficulty-row');

  const finalScoreEl = document.getElementById('final-score');
  const newBestLineEl = document.getElementById('new-best-line');
  const gameoverHeading = document.getElementById('gameover-heading');

  // Run stats elements
  const statCaught = document.getElementById('stat-caught');
  const statMissed = document.getElementById('stat-missed');
  const statDodged = document.getElementById('stat-dodged');
  const statGrade = document.getElementById('stat-grade');

  // Save/Export elements
  const exportBtn = document.getElementById('export-save-btn');
  const importBtn = document.getElementById('import-save-btn');
  const importInput = document.getElementById('import-save-input');

  const HIGH_SCORE_KEY = 'starfall_highscore';
  const DIFFICULTY_KEY = 'starfall_difficulty';

  // ---------------------------------------------------------------------
  // Persistent high score with IndexedDB fallback
  // ---------------------------------------------------------------------

  const Storage = {
    _useIndexedDB: false,
    _db: null,
    _storeName: 'starfall_saves',

    async init() {
      try {
        const req = indexedDB.open('StarfallDB', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this._storeName)) {
            db.createObjectStore(this._storeName);
          }
        };
        this._db = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        this._useIndexedDB = true;
        return true;
      } catch (e) {
        console.warn('IndexedDB unavailable, falling back to localStorage');
        this._useIndexedDB = false;
        return false;
      }
    },

    async get(key) {
      if (this._useIndexedDB) {
        const tx = this._db.transaction(this._storeName, 'readonly');
        const store = tx.objectStore(this._storeName);
        return new Promise((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
      }
      try {
        return localStorage.getItem(key);
      } catch { return null; }
    },

    async set(key, value) {
      if (this._useIndexedDB) {
        const tx = this._db.transaction(this._storeName, 'readwrite');
        const store = tx.objectStore(this._storeName);
        return new Promise((resolve) => {
          const req = store.put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        });
      }
      try {
        localStorage.setItem(key, value);
      } catch { /* ignore */ }
    }
  };

  let storageReady = false;

  async function loadHighScore() {
    const val = await Storage.get(HIGH_SCORE_KEY);
    const parsed = val ? parseInt(val, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function saveHighScore(val) {
    await Storage.set(HIGH_SCORE_KEY, String(val));
  }

  let highScore = 0;

  // ---------------------------------------------------------------------
  // Difficulty presets
  // ---------------------------------------------------------------------

  const DIFFICULTIES = {
    easy: { lives: 4, spawnStart: 1.4, spawnFloor: 0.55, spawnDecay: 0.008, speedBase: 70, speedRamp: 2.2 },
    normal: { lives: 3, spawnStart: 1.1, spawnFloor: 0.35, spawnDecay: 0.012, speedBase: 90, speedRamp: 3.2 },
    hard: { lives: 3, spawnStart: 0.8, spawnFloor: 0.25, spawnDecay: 0.018, speedBase: 120, speedRamp: 4.4 },
  };

  async function loadDifficulty() {
    const raw = await Storage.get(DIFFICULTY_KEY);
    return DIFFICULTIES[raw] ? raw : 'normal';
  }

  async function saveDifficulty(name) {
    await Storage.set(DIFFICULTY_KEY, name);
  }

  let difficultyName = 'normal';
  let difficulty = DIFFICULTIES[difficultyName];

  function setDifficulty(name) {
    if (!DIFFICULTIES[name]) return;
    difficultyName = name;
    difficulty = DIFFICULTIES[name];
    saveDifficulty(name);
    for (const btn of difficultyRow.querySelectorAll('.diff-btn')) {
      btn.classList.toggle('active', btn.dataset.difficulty === name);
    }
  }

  difficultyRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.diff-btn');
    if (btn) setDifficulty(btn.dataset.difficulty);
  });

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------

  const STATE = { MENU: 'menu', HOWTO: 'howto', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
  let state = STATE.MENU;

  let score = 0;
  let lives = 3;
  let MAX_LIVES = 3;

  let elapsed = 0;
  let spawnTimer = 0;
  let spawnInterval = 1.1;

  let shakeTime = 0;
  let shakeMag = 0;

  let lastTime = null;
  let animationFrameId = null;
  let idleFrameId = null;

  // Run stats
  let runStats = {
    caught: 0,
    missed: 0,
    dodged: 0,
    bombsHit: 0
  };

  // Invincibility
  let invincibleTimer = 0;
  const INVINCIBILITY_DURATION = 0.4;

  // ---------------------------------------------------------------------
  // Player (the catcher)
  // ---------------------------------------------------------------------

  const player = {
    x: W / 2,
    y: H - 46,
    width: 84,
    height: 30,
    speed: 480,
    vx: 0,
  };

  const keys = { left: false, right: false };

  function resetPlayer() {
    player.x = W / 2;
    player.vx = 0;
  }

  // ---------------------------------------------------------------------
  // Background starfield (parallax, purely decorative)
  // ---------------------------------------------------------------------

  const bgStars = [];
  const BG_STAR_COUNT = 90;

  function initBgStars() {
    bgStars.length = 0;
    for (let i = 0; i < BG_STAR_COUNT; i++) {
      bgStars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.6 + 0.4,
        baseAlpha: Math.random() * 0.5 + 0.3,
        twinkleSpeed: Math.random() * 2 + 0.5,
        twinklePhase: Math.random() * Math.PI * 2,
        drift: Math.random() * 8 + 4,
      });
    }
  }
  initBgStars();

  // ---------------------------------------------------------------------
  // Falling items
  // ---------------------------------------------------------------------

  /** @type {Array<Object>} */
  let items = [];

  const ITEM_TYPES = {
    star: { points: 10, radius: 14, color: '#f4c542', glow: 'rgba(244,197,66,0.55)', weight: 68, shape: 'star' },
    gold: { points: 50, radius: 18, color: '#fff3b0', glow: 'rgba(255,243,176,0.7)', weight: 12, shape: 'diamond' },
    bomb: { points: 0, radius: 15, color: '#ff5f5f', glow: 'rgba(255,95,95,0.55)', weight: 20, shape: 'bomb' },
  };

  function pickItemType() {
    const totalWeight = Object.values(ITEM_TYPES).reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * totalWeight;
    for (const [name, def] of Object.entries(ITEM_TYPES)) {
      if (r < def.weight) return name;
      r -= def.weight;
    }
    return 'star';
  }

  function spawnItem() {
    const type = pickItemType();
    const def = ITEM_TYPES[type];
    const speedBase = difficulty.speedBase + elapsed * difficulty.speedRamp;
    items.push({
      type,
      x: def.radius + Math.random() * (W - def.radius * 2),
      y: -def.radius,
      radius: def.radius,
      speed: speedBase + Math.random() * 40,
      rotation: 0,
      rotSpeed: (Math.random() - 0.5) * 2.4,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }

  // ---------------------------------------------------------------------
  // Particles (catch bursts / hit flashes)
  // ---------------------------------------------------------------------

  let particles = [];

  function burst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.4,
        age: 0,
        r: 1.5 + Math.random() * 2.5,
        color,
      });
    }
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

  // Prevent arrow keys from scrolling the page
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === ' ' && state === STATE.MENU) startGame();
    if (e.key === 'Escape') {
      if (state === STATE.PLAYING) togglePause();
      else if (state === STATE.PAUSED) togglePause();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });

  function canvasXFromEvent(clientX) {
    const rect = canvas.getBoundingClientRect();
    const scale = W / rect.width;
    return (clientX - rect.left) * scale;
  }

  let dragging = false;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    if (state === STATE.PLAYING) {
      player.x = clamp(canvasXFromEvent(e.clientX), player.width / 2, W - player.width / 2);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || state !== STATE.PLAYING) return;
    player.x = clamp(canvasXFromEvent(e.clientX), player.width / 2, W - player.width / 2);
  });

  window.addEventListener('pointerup', () => { dragging = false; });

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', togglePause);
  pauseBtn.addEventListener('click', togglePause);
  menuBtn.addEventListener('click', () => {
    if (state === STATE.PLAYING) {
      goToMenu();
    }
  });
  pauseMenuBtn.addEventListener('click', goToMenu);
  howtoBtn.addEventListener('click', showHowTo);
  howtoBackBtn.addEventListener('click', showMenu);
  gameoverMenuBtn.addEventListener('click', showMenu);

  exportBtn.addEventListener('click', exportSave);
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', importSave);

  function showHowTo() {
    state = STATE.HOWTO;
    menuOverlay.classList.add('hidden');
    howtoOverlay.classList.remove('hidden');
  }

  function showMenu() {
    state = STATE.MENU;
    howtoOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
    lastTime = null;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (idleFrameId) {
      cancelAnimationFrame(idleFrameId);
    }
    idleFrameId = requestAnimationFrame(idleLoop);
  }

  function goToMenu() {
    // Cancel any ongoing game loop
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    state = STATE.MENU;
    pauseOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
    lastTime = null;
    if (idleFrameId) {
      cancelAnimationFrame(idleFrameId);
    }
    idleFrameId = requestAnimationFrame(idleLoop);
  }

  function togglePause() {
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      pauseOverlay.classList.remove('hidden');
      // Cancel the animation frame when paused
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      pauseOverlay.classList.add('hidden');
      lastTime = null; // avoid a big delta-time jump after resuming
      // Restart the game loop
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = requestAnimationFrame(loop);
    }
  }

  function startGame() {
    MAX_LIVES = difficulty.lives;
    score = 0;
    lives = MAX_LIVES;
    elapsed = 0;
    spawnTimer = 0;
    spawnInterval = difficulty.spawnStart;
    items = [];
    particles = [];
    shakeTime = 0;
    invincibleTimer = 0;
    runStats = { caught: 0, missed: 0, dodged: 0, bombsHit: 0 };
    resetPlayer();

    updateHud();

    menuOverlay.classList.add('hidden');
    howtoOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');

    state = STATE.PLAYING;
    lastTime = null;

    // Cancel any existing loops
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (idleFrameId) {
      cancelAnimationFrame(idleFrameId);
      idleFrameId = null;
    }

    animationFrameId = requestAnimationFrame(loop);
  }

  function endGame() {
    state = STATE.OVER;
    const isNewBest = score > highScore;
    if (isNewBest) {
      highScore = score;
      saveHighScore(highScore);
    }
    finalScoreEl.textContent = score;
    highscoreEl.textContent = highScore;
    gameoverHeading.textContent = 'Game Over';
    newBestLineEl.textContent = isNewBest ? '★ New best! ★' : `Best: ${highScore}`;
    newBestLineEl.style.opacity = isNewBest ? '1' : '0.7';

    const totalStars = runStats.caught + runStats.missed;
    statCaught.textContent = runStats.caught;
    statMissed.textContent = runStats.missed;
    statDodged.textContent = runStats.dodged;

    let grade = 'D';
    if (totalStars > 0) {
      const accuracy = runStats.caught / totalStars;
      const bombBonus = Math.min(runStats.dodged * 0.03, 0.25);
      const totalGrade = accuracy + bombBonus;
      if (totalGrade >= 0.95) grade = 'S';
      else if (totalGrade >= 0.80) grade = 'A';
      else if (totalGrade >= 0.65) grade = 'B';
      else if (totalGrade >= 0.50) grade = 'C';
      else grade = 'D';
    }
    statGrade.textContent = grade;

    gameoverOverlay.classList.remove('hidden');

    // Cancel the game loop
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function updateHud() {
    scoreEl.textContent = score;
    livesEl.textContent = '❤'.repeat(Math.max(lives, 0)) + '♡'.repeat(MAX_LIVES - Math.max(lives, 0));
    highscoreEl.textContent = highScore;
  }

  // ---------------------------------------------------------------------
  // Save Export / Import
  // ---------------------------------------------------------------------

  async function exportSave() {
    const data = {
      highScore: await loadHighScore(),
      difficulty: await loadDifficulty(),
      exported: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starfall_save_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function importSave(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.highScore !== undefined && Number.isFinite(data.highScore)) {
        await saveHighScore(data.highScore);
        highScore = data.highScore;
        highscoreEl.textContent = highScore;
      }
      if (data.difficulty && DIFFICULTIES[data.difficulty]) {
        setDifficulty(data.difficulty);
      }
      const originalText = importBtn.textContent;
      importBtn.textContent = '✅ Imported!';
      importBtn.style.borderColor = '#3fe0c5';
      setTimeout(() => {
        importBtn.textContent = originalText;
        importBtn.style.borderColor = '';
      }, 2000);
    } catch (err) {
      alert('Invalid save file. Please select a valid Starfall export.');
    }
    importInput.value = '';
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------

  function update(dt) {
    elapsed += dt;

    spawnInterval = Math.max(difficulty.spawnFloor, difficulty.spawnStart - elapsed * difficulty.spawnDecay);

    player.vx = 0;
    if (keys.left) player.vx -= player.speed;
    if (keys.right) player.vx += player.speed;
    player.x = clamp(player.x + player.vx * dt, player.width / 2, W - player.width / 2);

    // Spawn
    spawnTimer += dt;
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      spawnItem();
    }

    // Background stars drift
    for (const s of bgStars) {
      s.y += s.drift * dt;
      if (s.y > H) {
        s.y = -2;
        s.x = Math.random() * W;
      }
    }

    // Update invincibility
    if (invincibleTimer > 0) {
      invincibleTimer = Math.max(0, invincibleTimer - dt);
    }

    // Falling items
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.speed * dt;
      it.rotation += it.rotSpeed * dt;

      // Tighter collision - reduced from 0.3 to 0.15 for more skill-based catching
      const withinX = it.x > player.x - player.width / 2 - it.radius * 0.15 &&
        it.x < player.x + player.width / 2 + it.radius * 0.15;
      const withinY = it.y + it.radius >= player.y - player.height / 2 &&
        it.y - it.radius <= player.y + player.height / 2;

      if (withinX && withinY) {
        const def = ITEM_TYPES[it.type];
        if (it.type === 'bomb') {
          if (invincibleTimer <= 0) {
            lives -= 1;
            runStats.bombsHit += 1;
            shakeTime = 0.28;
            shakeMag = 10;
            burst(it.x, it.y, def.color, 20);
            invincibleTimer = INVINCIBILITY_DURATION;
            if (lives <= 0) {
              updateHud();
              items.splice(i, 1);
              endGame();
              return;
            }
          }
        } else {
          score += def.points;
          runStats.caught += 1;
          burst(it.x, it.y, def.color, 14);
        }
        updateHud();
        items.splice(i, 1);
        continue;
      }

      // Missed star/gold - punish with faster spawns
      if (it.y - it.radius > H) {
        if (it.type === 'star' || it.type === 'gold') {
          runStats.missed += 1;
          // Punishment: temporarily increase spawn rate (make it harder)
          spawnInterval = Math.max(difficulty.spawnFloor + 0.05, spawnInterval - 0.015);
        }
        items.splice(i, 1);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
    }

    // Count dodged bombs (bombs that fell safely past the player)
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'bomb' && it.y - it.radius > player.y + player.height / 2 + 20) {
        runStats.dodged += 1;
        items.splice(i, 1);
      }
    }

    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
  }

  // ---------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------

  function draw() {
    ctx.save();

    if (shakeTime > 0) {
      const mag = shakeMag * (shakeTime / 0.28);
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    ctx.clearRect(-20, -20, W + 40, H + 40);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0e0f2b');
    grad.addColorStop(1, '#05060f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    for (const s of bgStars) {
      const twinkle = 0.5 + 0.5 * Math.sin(elapsed * s.twinkleSpeed + s.twinklePhase);
      ctx.globalAlpha = s.baseAlpha * (0.5 + 0.5 * twinkle);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const it of items) {
      drawItem(it);
    }

    for (const p of particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawPlayer();

    ctx.restore();
  }

  function drawItem(it) {
    const def = ITEM_TYPES[it.type];
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rotation);

    ctx.shadowColor = def.glow;
    ctx.shadowBlur = 16;
    ctx.fillStyle = def.color;

    if (it.type === 'bomb') {
      const spikes = 8;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? it.radius : it.radius * 0.5;
        const a = (Math.PI / spikes) * i;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a0d0d';
      ctx.beginPath();
      ctx.arc(0, 0, it.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (it.type === 'gold') {
      // Diamond shape for gold (colorblind friendly)
      const r = it.radius;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      // Inner glow
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.4);
      ctx.lineTo(r * 0.3, 0);
      ctx.lineTo(0, r * 0.4);
      ctx.lineTo(-r * 0.3, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      // Regular star shape
      drawStarShape(ctx, 0, 0, it.radius, 5, 0.42);
    }

    ctx.restore();
  }

  function drawStarShape(context, cx, cy, outerR, points, innerRatio) {
    const innerR = outerR * innerRatio;
    context.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (Math.PI / points) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
  }

  function drawPlayer() {
    const { x, y, width, height } = player;
    ctx.save();
    ctx.translate(x, y);

    // Flash when invincible (blink every 0.1s)
    if (invincibleTimer > 0 && Math.floor(invincibleTimer * 10) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    ctx.shadowColor = 'rgba(63,224,197,0.6)';
    ctx.shadowBlur = 18;

    ctx.fillStyle = '#2a2f6b';
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#3fe0c5';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, -2, width / 2 - 2, height / 2 - 4, 0, Math.PI, 0, false);
    ctx.stroke();

    ctx.fillStyle = 'rgba(63,224,197,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, -height / 2 + 4, width / 4.2, height / 2.6, 0, Math.PI, 0, false);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  function loop(timestamp) {
    if (state !== STATE.PLAYING) {
      animationFrameId = null;
      return;
    }

    if (lastTime === null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    dt = Math.min(dt, 1 / 30);
    lastTime = timestamp;

    update(dt);
    draw();

    animationFrameId = requestAnimationFrame(loop);
  }

  // Idle animation on the start screen so it doesn't look static
  function idleLoop(timestamp) {
    if (state === STATE.PLAYING) {
      idleFrameId = null;
      return;
    }
    if (lastTime === null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    dt = Math.min(dt, 1 / 30);
    lastTime = timestamp;

    elapsed += dt;
    for (const s of bgStars) {
      s.y += s.drift * dt * 0.4;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
    }
    draw();
    idleFrameId = requestAnimationFrame(idleLoop);
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  async function init() {
    await Storage.init();
    highScore = await loadHighScore();
    highscoreEl.textContent = highScore;
    difficultyName = await loadDifficulty();
    setDifficulty(difficultyName);
    updateHud();
    lastTime = null;
    idleFrameId = requestAnimationFrame(idleLoop);
  }

  init();

})();