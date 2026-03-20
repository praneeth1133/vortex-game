/* ========= VORTEX Client Game Logic ========= */

class Game {
  constructor(renderer) {
    this.renderer = renderer;
    this.state = {
      players: {},
      food: [],
      powerups: [],
      leaderboard: [],
      world: { width: 6000, height: 6000 }
    };
    this.localPlayerId = null;
    this.running = false;
    this.lastFrame = 0;
    this.animFrameId = null;

    // Input
    this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0 };
    this.touch = { active: false, x: 0, y: 0 };
    this.keys = {};

    // Interpolation
    this.serverState = {};
    this.interpFactor = 0.15;

    // Sound
    this.sounds = {};
    this.sfxVolume = 0.7;
    this.musicVolume = 0.5;

    // Throttle timers
    this._lastHudUpdate = 0;
    this._lastMinimapUpdate = 0;
    this._lastLeaderboardHtml = '';

    this.setupInput();
  }

  // --- Input ---
  setupInput() {
    const canvas = this.renderer.canvas;

    // Mouse
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.updateWorldMouse();
    });

    // Touch
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touch.active = true;
      const t = e.touches[0];
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this.updateWorldMouse();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this.updateWorldMouse();
    }, { passive: false });

    canvas.addEventListener('touchend', () => { this.touch.active = false; });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); this.onBoost(); }
      if (e.code === 'KeyW') this.onSplit();
      if (e.code === 'KeyE') this.onShield();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Ability buttons
    document.getElementById('ability-boost')?.addEventListener('click', () => this.onBoost());
    document.getElementById('ability-split')?.addEventListener('click', () => this.onSplit());
    document.getElementById('ability-shield')?.addEventListener('click', () => this.onShield());
  }

  updateWorldMouse() {
    const cam = this.renderer.camera;
    const z = cam.zoom;
    this.mouse.worldX = (this.mouse.x - this.renderer.width / 2) / z + cam.x;
    this.mouse.worldY = (this.mouse.y - this.renderer.height / 2) / z + cam.y;
  }

  onBoost() { if (this.network) this.network.sendBoost(); }
  onSplit() { if (this.network) this.network.sendSplit(); }
  onShield() { if (this.network) this.network.sendShield(); }

  // --- Game Loop ---
  start(network) {
    this.network = network;
    this.running = true;
    this.lastFrame = performance.now();
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
  }

  loop() {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(() => this.loop());

    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05); // cap at 50ms
    this.lastFrame = now;

    this.update(dt);
    this.render(dt);
  }

  update(dt) {
    const localPlayer = this.state.players[this.localPlayerId];

    // Send input to server
    if (localPlayer && localPlayer.alive && this.network) {
      this.network.sendInput(this.mouse.worldX, this.mouse.worldY);
    }

    // Interpolate remote players
    for (const [id, p] of Object.entries(this.state.players)) {
      if (id === this.localPlayerId) continue;
      const server = this.serverState[id];
      if (server) {
        p.x += (server.x - p.x) * this.interpFactor;
        p.y += (server.y - p.y) * this.interpFactor;
        p.radius += (server.radius - p.radius) * this.interpFactor;
      }
    }

    // Update camera to follow local player
    if (localPlayer && localPlayer.alive) {
      this.renderer.setCameraTarget(localPlayer.x, localPlayer.y, localPlayer.radius);

      // Trail
      const colors = this.renderer.getSkinColors(localPlayer.skin);
      this.renderer.updateTrail(this.localPlayerId, localPlayer.x, localPlayer.y, colors[0]);

      // Boost particles
      if (localPlayer.boosting) {
        this.renderer.emitTrail(localPlayer.x, localPlayer.y, localPlayer.vx || 0, localPlayer.vy || 0, colors[0]);
      }
    }

    // Update remote player trails
    for (const [id, p] of Object.entries(this.state.players)) {
      if (id === this.localPlayerId || !p.alive) continue;
      const colors = this.renderer.getSkinColors(p.skin);
      this.renderer.updateTrail(id, p.x, p.y, colors[0]);
    }

    // Update HUD
    this.updateHUD(localPlayer);
  }

  render(dt) {
    this.renderer.render(this.state, this.localPlayerId, dt);

    // Minimap — throttle to ~10fps (every 100ms)
    const now = performance.now();
    if (now - this._lastMinimapUpdate > 100) {
      this._lastMinimapUpdate = now;
      const minimapCanvas = document.getElementById('minimap-canvas');
      if (minimapCanvas && document.getElementById('hud-minimap')?.style.display !== 'none') {
        this.renderer.renderMinimap(minimapCanvas, this.state, this.localPlayerId, this.state.world);
      }
    }
  }

  // --- State Updates from Server ---
  onGameJoined(data) {
    this.localPlayerId = data.player.id;
    this.state.world = data.world;
    this.state.food = data.food || [];
    this.state.powerups = data.powerups || [];
    this.state.players[data.player.id] = { ...data.player };

    // Center camera immediately
    this.renderer.camera.x = data.player.x;
    this.renderer.camera.y = data.player.y;
  }

  onStateUpdate(data) {
    // Store server state for interpolation
    this.serverState = data.players || {};

    // Update local player directly (authoritative)
    if (data.players[this.localPlayerId]) {
      const serverLocal = data.players[this.localPlayerId];
      const local = this.state.players[this.localPlayerId];
      if (local) {
        local.x += (serverLocal.x - local.x) * 0.3;
        local.y += (serverLocal.y - local.y) * 0.3;
        local.radius = serverLocal.radius;
        local.mass = serverLocal.mass;
        local.score = serverLocal.score;
        local.kills = serverLocal.kills;
        local.alive = serverLocal.alive;
        local.shieldActive = serverLocal.shieldActive;
        local.boosting = serverLocal.boosting;
      }
    }

    // Add/update remote players
    for (const [id, p] of Object.entries(data.players)) {
      if (id === this.localPlayerId) continue;
      if (!this.state.players[id]) {
        this.state.players[id] = { ...p };
      } else {
        // Keep current pos for interpolation, update other props
        this.state.players[id].alive = p.alive;
        this.state.players[id].mass = p.mass;
        this.state.players[id].score = p.score;
        this.state.players[id].kills = p.kills;
        this.state.players[id].skin = p.skin;
        this.state.players[id].username = p.username;
        this.state.players[id].shieldActive = p.shieldActive;
        this.state.players[id].boosting = p.boosting;
      }
    }

    // Remove players no longer in state
    for (const id of Object.keys(this.state.players)) {
      if (!data.players[id] && id !== this.localPlayerId) {
        this.renderer.removeTrail(id);
        delete this.state.players[id];
      }
    }

    // Update food and powerups
    this.state.food = data.food || this.state.food;
    this.state.powerups = data.powerups || this.state.powerups;
    this.state.leaderboard = data.leaderboard || this.state.leaderboard;
  }

  onPlayerJoined(player) {
    this.state.players[player.id] = { ...player };
  }

  onPlayerLeft(playerId) {
    this.renderer.removeTrail(playerId);
    delete this.state.players[playerId];
    delete this.serverState[playerId];
  }

  onPlayerKilled(data) {
    const victim = this.state.players[data.victimId];
    if (victim) {
      const colors = this.renderer.getSkinColors(victim.skin);
      this.renderer.emitDeath(data.position.x, data.position.y, colors);
    }

    // Kill feed
    this.addKillFeed(data.killerName, data.victimName);

    // Death screen for local player
    if (data.victimId === this.localPlayerId) {
      const local = this.state.players[this.localPlayerId];
      this.showDeathScreen(data.killerName, local?.score || 0, local?.kills || 0, local?.maxMass || 0);
    }
  }

  onRespawn(player) {
    this.state.players[player.id] = { ...player };
    this.hideDeathScreen();
    this.renderer.camera.x = player.x;
    this.renderer.camera.y = player.y;
  }

  onPowerupCollected(data) {
    if (data.playerId === this.localPlayerId) {
      const local = this.state.players[this.localPlayerId];
      if (local) this.renderer.emitPowerup(local.x, local.y);
    }
  }

  // --- HUD Updates ---
  updateHUD(localPlayer) {
    if (!localPlayer) return;

    // Throttle HUD text updates to ~5fps (every 200ms)
    const now = performance.now();
    if (now - this._lastHudUpdate < 200) return;
    this._lastHudUpdate = now;

    const scoreEl = document.getElementById('hud-score');
    const massEl = document.getElementById('hud-mass');
    const killsEl = document.getElementById('hud-kills');
    if (scoreEl) scoreEl.textContent = localPlayer.score || 0;
    if (massEl) massEl.textContent = Math.floor(localPlayer.mass || 0);
    if (killsEl) killsEl.textContent = localPlayer.kills || 0;

    // Leaderboard — only update innerHTML if data actually changed
    const lbEl = document.getElementById('live-leaderboard');
    if (lbEl && this.state.leaderboard) {
      const html = this.state.leaderboard.map((entry, i) => {
        const isSelf = entry.id === this.localPlayerId;
        return `<li class="${isSelf ? 'self' : ''}"><span>${i + 1}. ${this.escapeHtml(entry.name)}</span><span class="lb-score">${entry.score}</span></li>`;
      }).join('');
      if (html !== this._lastLeaderboardHtml) {
        this._lastLeaderboardHtml = html;
        lbEl.innerHTML = html;
      }
    }

    // FPS
    const fpsEl = document.getElementById('hud-fps');
    if (fpsEl && fpsEl.style.display !== 'none') {
      fpsEl.textContent = `FPS: ${this.renderer.fps}`;
    }
  }

  addKillFeed(killer, victim) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const msg = document.createElement('div');
    msg.className = 'kill-msg';
    msg.innerHTML = `<span class="killer">${this.escapeHtml(killer)}</span> consumed <span class="victim">${this.escapeHtml(victim)}</span>`;
    feed.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
    while (feed.children.length > 5) feed.firstChild.remove();
  }

  showDeathScreen(killer, score, kills, maxMass) {
    const overlay = document.getElementById('death-overlay');
    if (!overlay) return;
    document.getElementById('death-killer').textContent = killer;
    document.getElementById('death-score').textContent = score;
    document.getElementById('death-kills').textContent = kills;
    document.getElementById('death-mass').textContent = Math.floor(maxMass);
    overlay.style.display = 'flex';
  }

  hideDeathScreen() {
    const overlay = document.getElementById('death-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

window.Game = Game;
