/* ========= VORTEX Renderer - GPU-accelerated Canvas2D ========= */

class ParticlePool {
  constructor(max) {
    this.pool = [];
    this.active = [];
    this.max = max;
    for (let i = 0; i < max; i++) {
      this.pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, radius: 2, color: '#fff', alpha: 1, type: 'default' });
    }
  }
  spawn(x, y, vx, vy, life, radius, color, type = 'default') {
    let p = this.pool.pop();
    if (!p) { if (this.active.length > 0) { p = this.active.shift(); } else return; }
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.radius = radius;
    p.color = color; p.alpha = 1; p.type = type;
    this.active.push(p);
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.push(this.active.splice(i, 1)[0]); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.98; p.vy *= 0.98;
      p.alpha = Math.max(0, p.life / p.maxLife);
    }
  }
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // GPU acceleration: alpha:false avoids compositing, desynchronized reduces latency
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // Detect mobile/low-end devices
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    this.isLowEnd = this.isMobile && (navigator.hardwareConcurrency || 4) <= 4;
    // Cap DPR: 1 on low-end mobile, 1.5 on mobile, 2 on desktop
    this.dpr = this.isLowEnd ? 1 : (this.isMobile ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 2));
    this.width = 0;
    this.height = 0;

    // GPU compositing hint
    canvas.style.willChange = 'contents';

    // Camera
    this.camera = { x: 0, y: 0, zoom: 1, targetZoom: 1, shakeX: 0, shakeY: 0, shakeIntensity: 0 };

    // Particles - fewer on mobile
    this.particles = new ParticlePool(this.isMobile ? 500 : 2000);
    this.bgStars = [];
    this.trailPoints = new Map();

    // Auto-detect quality based on device
    this.quality = this.isLowEnd ? 'low' : (this.isMobile ? 'low' : 'medium');
    this.qualityConfig = {
      low:    { particles: 0.15, stars: 50,  trail: 3,  glow: false, gridAlpha: 0.03, bloom: false },
      medium: { particles: 0.4,  stars: 150, trail: 10, glow: false, gridAlpha: 0.05, bloom: false },
      high:   { particles: 0.7,  stars: 300, trail: 20, glow: true,  gridAlpha: 0.06, bloom: false },
      ultra:  { particles: 1.0,  stars: 500, trail: 30, glow: true,  gridAlpha: 0.08, bloom: true },
    };

    // Performance tracking + adaptive quality
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTime = 0;
    this.lastTime = 0;
    this.fpsHistory = [];
    this.autoQualityEnabled = true;

    // Colors
    this.bgColor = '#0a0a2e';
    this.gridColor = 'rgba(0, 255, 242, 0.04)';

    // Cached minimap context
    this._minimapCtx = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.initStars();
  }

  get config() { return this.qualityConfig[this.quality]; }

  setQuality(q) {
    this.quality = q;
    this.initStars();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Disable image smoothing for performance on mobile
    if (this.isMobile) {
      this.ctx.imageSmoothingEnabled = false;
    }
  }

  initStars() {
    this.bgStars = [];
    const count = this.config.stars;
    for (let i = 0; i < count; i++) {
      this.bgStars.push({
        x: Math.random() * 10000 - 5000,
        y: Math.random() * 10000 - 5000,
        radius: Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.6 + 0.2,
        twinkleSpeed: Math.random() * 2 + 1,
        twinkleOffset: Math.random() * Math.PI * 2
      });
    }
  }

  // --- Camera ---
  setCameraTarget(x, y, playerRadius) {
    this.camera.targetZoom = Math.max(0.3, Math.min(1.2, 40 / (playerRadius || 20)));
    this.camera.x += (x - this.camera.x) * 0.08;
    this.camera.y += (y - this.camera.y) * 0.08;
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.05;
  }

  screenShake(intensity) { this.camera.shakeIntensity = Math.max(this.camera.shakeIntensity, intensity); }

  worldToScreen(wx, wy) {
    const z = this.camera.zoom;
    return {
      x: (wx - this.camera.x) * z + this.width / 2 + this.camera.shakeX,
      y: (wy - this.camera.y) * z + this.height / 2 + this.camera.shakeY
    };
  }

  isVisible(wx, wy, radius) {
    const s = this.worldToScreen(wx, wy);
    const r = radius * this.camera.zoom;
    return s.x + r > -100 && s.x - r < this.width + 100 && s.y + r > -100 && s.y - r < this.height + 100;
  }

  // --- Particle Emitters ---
  emitBurst(x, y, count, color, speed, life) {
    count = Math.floor(count * this.config.particles);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const spd = speed * (0.5 + Math.random() * 0.5);
      this.particles.spawn(x, y, Math.cos(angle) * spd, Math.sin(angle) * spd, life * (0.5 + Math.random() * 0.5), 2 + Math.random() * 3, color);
    }
  }

  emitTrail(x, y, vx, vy, color) {
    if (Math.random() > this.config.particles * 0.5) return;
    this.particles.spawn(
      x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8,
      -vx * 0.1 + (Math.random() - 0.5) * 15, -vy * 0.1 + (Math.random() - 0.5) * 15,
      0.6 + Math.random() * 0.4, 1.5 + Math.random() * 2, color
    );
  }

  emitDeath(x, y, colors) {
    this.emitBurst(x, y, 40, colors[0] || '#ff4444', 200, 1.5);
    if (colors[1]) this.emitBurst(x, y, 25, colors[1], 150, 1.2);
    this.screenShake(8);
  }

  emitPowerup(x, y) {
    this.emitBurst(x, y, 20, '#ffff00', 100, 0.8);
    this.emitBurst(x, y, 15, '#ffffff', 80, 0.6);
  }

  // --- Trail System ---
  updateTrail(playerId, x, y, color) {
    if (!this.trailPoints.has(playerId)) this.trailPoints.set(playerId, []);
    const trail = this.trailPoints.get(playerId);
    trail.push({ x, y, color, alpha: 1 });
    while (trail.length > this.config.trail) trail.shift();
  }

  removeTrail(playerId) { this.trailPoints.delete(playerId); }

  // --- Main Render ---
  render(gameState, localPlayerId, dt) {
    const now = performance.now();
    this.frameCount++;
    if (now - this.fpsTime > 1000) {
      this.fps = this.frameCount; this.frameCount = 0; this.fpsTime = now;
      // Adaptive quality: auto-downgrade if FPS drops
      if (this.autoQualityEnabled) {
        this.fpsHistory.push(this.fps);
        if (this.fpsHistory.length > 5) this.fpsHistory.shift();
        const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
        if (avgFps < 25 && this.quality !== 'low') {
          this.setQuality('low');
        } else if (avgFps < 40 && this.quality === 'high') {
          this.setQuality('medium');
        }
      }
    }

    // Update particles
    this.particles.update(dt);

    // Camera shake decay
    if (this.camera.shakeIntensity > 0.1) {
      this.camera.shakeX = (Math.random() - 0.5) * this.camera.shakeIntensity;
      this.camera.shakeY = (Math.random() - 0.5) * this.camera.shakeIntensity;
      this.camera.shakeIntensity *= 0.9;
    } else {
      this.camera.shakeX = 0; this.camera.shakeY = 0; this.camera.shakeIntensity = 0;
    }

    const ctx = this.ctx;
    ctx.save();

    // Background
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.width, this.height);

    // Stars (parallax)
    this.renderStars(ctx, now);

    // Nebula clouds
    this.renderNebula(ctx, now);

    // Grid
    this.renderGrid(ctx);

    // World bounds
    this.renderWorldBounds(ctx, gameState.world);

    // Food
    this.renderFood(ctx, gameState.food);

    // Powerups
    this.renderPowerups(ctx, gameState.powerups, now);

    // Player trails
    this.renderTrails(ctx);

    // Other players (render behind local player)
    if (gameState.players) {
      for (const [id, p] of Object.entries(gameState.players)) {
        if (id !== localPlayerId && p.alive) this.renderPlayer(ctx, p, false, now);
      }
    }

    // Local player (render on top)
    if (gameState.players && gameState.players[localPlayerId]) {
      this.renderPlayer(ctx, gameState.players[localPlayerId], true, now);
    }

    // Particles (on top of everything)
    this.renderParticles(ctx);

    ctx.restore();
  }

  renderStars(ctx, now) {
    const z = this.camera.zoom;
    const parallax = 0.15;
    const camPX = this.camera.x * parallax;
    const camPY = this.camera.y * parallax;
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const w = this.width;
    const h = this.height;

    // On mobile/low quality, draw stars as simple rectangles (much faster than arc)
    const useSimple = this.isMobile || this.quality === 'low';
    ctx.fillStyle = '#ffffff';

    if (useSimple) {
      // Batch all stars into a single path with uniform alpha
      ctx.globalAlpha = 0.5;
      for (const star of this.bgStars) {
        const sx = (star.x - camPX) * z + halfW;
        const sy = (star.y - camPY) * z + halfH;
        if (sx < -5 || sx > w + 5 || sy < -5 || sy > h + 5) continue;
        const r = star.radius * z;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
    } else {
      for (const star of this.bgStars) {
        const sx = (star.x - camPX) * z + halfW;
        const sy = (star.y - camPY) * z + halfH;
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const twinkle = Math.sin(now * 0.001 * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7;
        ctx.globalAlpha = star.alpha * twinkle;
        ctx.beginPath();
        ctx.arc(sx, sy, star.radius * z, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  renderNebula(ctx, now) {
    // Skip on low/mobile — nebulas are purely cosmetic
    if (this.quality === 'low' || this.isMobile) return;
    const z = this.camera.zoom;
    const nebulaColors = [
      { x: 1500, y: 1500, r: 600, c: 'rgba(0, 100, 255, 0.015)' },
      { x: 4500, y: 2000, r: 800, c: 'rgba(180, 0, 255, 0.012)' },
      { x: 3000, y: 4500, r: 700, c: 'rgba(255, 0, 100, 0.01)' },
      { x: 1000, y: 4000, r: 500, c: 'rgba(0, 255, 180, 0.01)' },
    ];
    for (const n of nebulaColors) {
      const s = this.worldToScreen(n.x, n.y);
      const r = n.r * z;
      if (s.x + r < 0 || s.x - r > this.width || s.y + r < 0 || s.y - r > this.height) continue;
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, n.c);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
  }

  renderGrid(ctx) {
    const z = this.camera.zoom;
    const gridSize = 80;
    const alpha = this.config.gridAlpha;

    ctx.strokeStyle = `rgba(0, 255, 242, ${alpha})`;
    ctx.lineWidth = 0.5;

    const startX = Math.floor((this.camera.x - this.width / 2 / z) / gridSize) * gridSize;
    const startY = Math.floor((this.camera.y - this.height / 2 / z) / gridSize) * gridSize;
    const endX = this.camera.x + this.width / 2 / z;
    const endY = this.camera.y + this.height / 2 / z;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      const s = this.worldToScreen(x, 0);
      ctx.moveTo(s.x, 0); ctx.lineTo(s.x, this.height);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      const s = this.worldToScreen(0, y);
      ctx.moveTo(0, s.y); ctx.lineTo(this.width, s.y);
    }
    ctx.stroke();
  }

  renderWorldBounds(ctx, world) {
    if (!world) return;
    const tl = this.worldToScreen(0, 0);
    const br = this.worldToScreen(world.width, world.height);
    const w = br.x - tl.x, h = br.y - tl.y;

    ctx.strokeStyle = 'rgba(255, 0, 80, 0.4)';
    ctx.lineWidth = 3 * this.camera.zoom;
    if (!this.isMobile) {
      ctx.setLineDash([20, 10]);
      ctx.strokeRect(tl.x, tl.y, w, h);
      ctx.setLineDash([]);
      // Danger glow at edges (desktop only)
      const glowWidth = 60 * this.camera.zoom;
      const gradient = ctx.createLinearGradient(tl.x, 0, tl.x + glowWidth, 0);
      gradient.addColorStop(0, 'rgba(255, 0, 80, 0.1)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(tl.x, tl.y, glowWidth, h);
    } else {
      // Mobile: simple solid border, no dash, no glow gradient
      ctx.strokeRect(tl.x, tl.y, w, h);
    }
  }

  renderFood(ctx, food) {
    if (!food) return;
    const z = this.camera.zoom;
    const useGlow = this.config.glow && !this.isMobile;
    // Batch food by color for fewer state changes
    ctx.globalAlpha = 0.9;
    let lastColor = '';
    for (const f of food) {
      if (!this.isVisible(f.x, f.y, f.radius + 10)) continue;
      const s = this.worldToScreen(f.x, f.y);
      const r = f.radius * z;
      if (f.color !== lastColor) {
        ctx.fillStyle = f.color;
        lastColor = f.color;
      }
      if (f.type === 'death') ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (f.type === 'death') ctx.globalAlpha = 0.9;
    }
    ctx.globalAlpha = 1;
  }

  renderPowerups(ctx, powerups, now) {
    if (!powerups) return;
    const z = this.camera.zoom;
    const puColors = { speed: '#ffff00', mass: '#00ffff', magnet: '#ff4488', ghost: '#aa88ff' };
    const simple = this.isMobile || this.quality === 'low';

    for (const pu of powerups) {
      if (!this.isVisible(pu.x, pu.y, 30)) continue;
      const s = this.worldToScreen(pu.x, pu.y);
      const r = pu.radius * z;
      const pulse = Math.sin(now * 0.003) * 0.15 + 1;
      const color = puColors[pu.type] || '#ffffff';

      if (simple) {
        // Simple solid circle for mobile
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * pulse, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Rotating ring (no save/restore - manual transform)
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * z;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * pulse * 1.3, now * 0.002, now * 0.002 + Math.PI * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Core gradient
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * pulse);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.4, color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      // Icon
      ctx.fillStyle = '#000';
      ctx.font = `${Math.floor(14 * z)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pu.icon || '?', s.x, s.y);
    }
  }

  renderTrails(ctx) {
    const z = this.camera.zoom;
    ctx.lineCap = 'round';
    for (const [, trail] of this.trailPoints) {
      if (trail.length < 2) continue;
      // Batch entire trail as single path with uniform style
      const color = trail[trail.length - 1].color || '#00fff2';
      ctx.strokeStyle = color;
      ctx.lineWidth = 4 * z;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      const s0 = this.worldToScreen(trail[0].x, trail[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < trail.length; i++) {
        const s = this.worldToScreen(trail[i].x, trail[i].y);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  renderPlayer(ctx, player, isLocal, now) {
    if (!player || !player.alive) return;
    if (!this.isVisible(player.x, player.y, player.radius + 40)) return;

    const s = this.worldToScreen(player.x, player.y);
    const r = player.radius * this.camera.zoom;
    const z = this.camera.zoom;
    const skinColors = this.getSkinColors(player.skin);
    const baseColor = skinColors[0] || '#00fff2';
    const secondColor = skinColors[1] || '#0088ff';
    const simple = this.isMobile || this.quality === 'low';

    // Shield effect (simplified on mobile)
    if (player.shieldActive) {
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (simple) {
      // MOBILE: solid color fill, no gradients, no shadowBlur
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Simple inner circle for depth
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x - r * 0.2, s.y - r * 0.2, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // DESKTOP: gradients + glow
      if (this.config.glow) {
        // Fake glow: larger circle behind instead of shadowBlur
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      const bodyGrad = ctx.createRadialGradient(
        s.x - r * 0.2, s.y - r * 0.2, r * 0.1,
        s.x, s.y, r
      );
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.25, baseColor);
      bodyGrad.addColorStop(0.7, secondColor);
      bodyGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Inner highlight
      ctx.globalAlpha = 0.3;
      const highlightGrad = ctx.createRadialGradient(
        s.x - r * 0.25, s.y - r * 0.3, 0,
        s.x, s.y, r * 0.8
      );
      highlightGrad.addColorStop(0, 'rgba(255,255,255,0.8)');
      highlightGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = highlightGrad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Energy ring (desktop only, larger players)
      if (player.mass > 30) {
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1.5 * z;
        ctx.beginPath();
        const ringPhase = now * 0.002;
        ctx.arc(s.x, s.y, r * 1.15, ringPhase, ringPhase + Math.PI * 1.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Boost effect (simplified)
    if (player.boosting) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Name label
    const fontSize = Math.max(10, Math.min(16, r * 0.5));
    ctx.font = `600 ${fontSize}px Rajdhani, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(player.username || '???', s.x + 1, s.y + 1);
    ctx.fillStyle = isLocal ? '#ffffff' : 'rgba(255,255,255,0.9)';
    ctx.fillText(player.username || '???', s.x, s.y);

    // Mass number below name
    if (player.mass > 15) {
      const massSize = Math.max(8, fontSize * 0.7);
      ctx.font = `700 ${massSize}px Orbitron, sans-serif`;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = baseColor;
      ctx.fillText(Math.floor(player.mass), s.x, s.y + fontSize * 0.8);
      ctx.globalAlpha = 1;
    }

    // Local player indicator (no setLineDash - expensive on mobile)
    if (isLocal && !simple) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  renderParticles(ctx) {
    const z = this.camera.zoom;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles.active) {
      const s = this.worldToScreen(p.x, p.y);
      if (s.x < -20 || s.x > this.width + 20 || s.y < -20 || s.y > this.height + 20) continue;
      ctx.globalAlpha = p.alpha * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.radius * z * p.alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  renderMinimap(minimapCanvas, gameState, localPlayerId, world) {
    if (!world) return;
    // Cache minimap context
    if (!this._minimapCtx) this._minimapCtx = minimapCanvas.getContext('2d');
    const mctx = this._minimapCtx;
    const mw = minimapCanvas.width, mh = minimapCanvas.height;

    mctx.fillStyle = 'rgba(10, 10, 46, 0.9)';
    mctx.fillRect(0, 0, mw, mh);

    mctx.strokeStyle = 'rgba(0, 255, 242, 0.2)';
    mctx.lineWidth = 1;
    mctx.strokeRect(0, 0, mw, mh);

    // Skip food dots on minimap (hundreds of fillRect calls for minimal value)

    // Players
    if (gameState.players) {
      for (const [id, p] of Object.entries(gameState.players)) {
        if (!p.alive) continue;
        const mx = (p.x / world.width) * mw;
        const my = (p.y / world.height) * mh;
        const mr = Math.max(2, p.radius / world.width * mw * 2);
        const isLocal = id === localPlayerId;
        mctx.fillStyle = isLocal ? '#ffff00' : '#ff0080';
        mctx.globalAlpha = isLocal ? 1 : 0.6;
        mctx.beginPath();
        mctx.arc(mx, my, mr, 0, Math.PI * 2);
        mctx.fill();
      }
    }

    // Camera viewport
    mctx.globalAlpha = 0.3;
    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 1;
    const vx = ((this.camera.x - this.width / 2 / this.camera.zoom) / world.width) * mw;
    const vy = ((this.camera.y - this.height / 2 / this.camera.zoom) / world.height) * mh;
    const vw = (this.width / this.camera.zoom / world.width) * mw;
    const vh = (this.height / this.camera.zoom / world.height) * mh;
    mctx.strokeRect(vx, vy, vw, vh);
    mctx.globalAlpha = 1;
  }

  getSkinColors(skinId) {
    const skinMap = {
      default: ['#00fff2', '#0088ff'],
      inferno: ['#ff4400', '#ff8800', '#ffcc00'],
      phantom: ['#9944ff', '#6600cc', '#cc88ff'],
      aurora: ['#00ff88', '#00ffcc', '#0088ff', '#8800ff'],
      void: ['#1a0033', '#330066', '#660099'],
      solar: ['#ffff00', '#ff8800', '#ff0000', '#ffffff'],
      galaxy: ['#ff0080', '#8000ff', '#0040ff', '#00ffff'],
      neon_pink: ['#ff0080', '#ff44aa'],
      toxic: ['#39ff14', '#00cc00', '#ccff00'],
      ice: ['#88ddff', '#44aaff', '#ffffff'],
      rainbow: ['#ff0000', '#ff8800', '#ffff00', '#00ff00', '#0088ff', '#8800ff'],
      shadow: ['#111111', '#222222', '#440044']
    };
    return skinMap[skinId] || skinMap.default;
  }

  // --- Menu Background ---
  renderMenuBg(canvas, now) {
    // Cache context, only resize when window actually changes
    if (!this._menuCtx) this._menuCtx = canvas.getContext('2d');
    const ctx = this._menuCtx;
    const ww = window.innerWidth, wh = window.innerHeight;
    if (canvas.width !== ww || canvas.height !== wh) {
      canvas.width = ww; canvas.height = wh;
    }
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, w, h);

    // Fewer stars on mobile, use fillRect instead of arc
    const starCount = this.isMobile ? 60 : 150;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < starCount; i++) {
      const x = ((i * 137.508 + now * 0.005) % (w + 100)) - 50;
      const y = ((i * 89.237 + now * 0.003) % (h + 100)) - 50;
      ctx.globalAlpha = 0.4 + (i % 5) * 0.08;
      const sz = 0.8 + (i % 3) * 0.4;
      ctx.fillRect(x, y, sz, sz);
    }

    // Skip floating orb gradients on mobile
    if (!this.isMobile) {
      ctx.globalCompositeOperation = 'lighter';
      const orbData = [
        { cx: w * 0.25, cy: h * 0.35, r: 80, c1: 'rgba(0,255,242,0.04)', c2: 'rgba(0,100,255,0.02)' },
        { cx: w * 0.75, cy: h * 0.6, r: 120, c1: 'rgba(255,0,128,0.03)', c2: 'rgba(180,0,255,0.02)' },
        { cx: w * 0.5, cy: h * 0.8, r: 90, c1: 'rgba(57,255,20,0.03)', c2: 'rgba(0,200,100,0.01)' }
      ];
      for (const orb of orbData) {
        const ox = orb.cx + Math.sin(now * 0.0005) * 30;
        const oy = orb.cy + Math.cos(now * 0.0007) * 20;
        const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, orb.r);
        grad.addColorStop(0, orb.c1);
        grad.addColorStop(1, orb.c2);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ox, oy, orb.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
}

// Export for use in other files
window.Renderer = Renderer;
