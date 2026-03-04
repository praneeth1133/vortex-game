const { v4: uuidv4 } = require('uuid');

const TICK_RATE = parseInt(process.env.TICK_RATE) || 60;
const WORLD_W = parseInt(process.env.WORLD_WIDTH) || 6000;
const WORLD_H = parseInt(process.env.WORLD_HEIGHT) || 6000;
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS_PER_ROOM) || 50;
const FOOD_COUNT = 600;
const POWERUP_COUNT = 8;
const FOOD_VALUE = 1;
const BASE_SPEED = 6;
const BASE_RADIUS = 20;
const BOOST_COST = 5;
const BOOST_MULTIPLIER = 2.2;
const SPLIT_MIN_MASS = 40;
const SHIELD_DURATION = 3000;
const SHIELD_COOLDOWN = 15000;

// --- Bot Names & Skins ---
const BOT_NAMES = [
  'NovaCrusher', 'StarDust_X', 'CosmicWolf', 'NebulaByte', 'VoidRipper',
  'QuantumAce', 'GalacticFox', 'SolarNinja', 'DarkPulse', 'AstroBlitz',
  'LunarStrike', 'PhotonKing', 'PlasmaGhost', 'IonStorm', 'CometTail',
  'ZeroGrav', 'BlackHole99', 'Supernova_', 'OrbMaster', 'WarpDrive'
];
const BOT_SKINS = ['default', 'inferno', 'phantom', 'aurora', 'toxic', 'ice', 'neon_pink', 'solar', 'void', 'shadow'];

// Bot difficulty configs: reaction time, aim accuracy, decision quality
const BOT_DIFFICULTIES = {
  easy:   { reactionMs: 800, aimJitter: 120, fleeThreshold: 1.3, chaseThreshold: 1.5, boostChance: 0.002, shieldChance: 0.001, foodRange: 300, playerRange: 250 },
  medium: { reactionMs: 400, aimJitter: 60,  fleeThreshold: 1.15, chaseThreshold: 1.3, boostChance: 0.008, shieldChance: 0.005, foodRange: 500, playerRange: 400 },
  hard:   { reactionMs: 200, aimJitter: 25,  fleeThreshold: 1.1, chaseThreshold: 1.2, boostChance: 0.015, shieldChance: 0.01, foodRange: 700, playerRange: 600 },
  expert: { reactionMs: 100, aimJitter: 10,  fleeThreshold: 1.05, chaseThreshold: 1.15, boostChance: 0.025, shieldChance: 0.02, foodRange: 1000, playerRange: 800 }
};

class GameEngine {
  constructor(io, db) {
    this.io = io;
    this.db = db;
    this.rooms = new Map();
    this.playerRooms = new Map();
    this.totalConnections = 0;
    this.heatmapData = [];
    this.tickInterval = null;
    this.bots = new Map(); // botId -> { player, difficulty, state, ... }
    this.botIdCounter = 0;
  }

  start() {
    this.createRoom('main');
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    setInterval(() => this.cleanup(), 30000);
    setInterval(() => this.recordHeatmap(), 5000);

    // Spawn default bots (3 easy, 2 medium, 1 hard)
    this.spawnBots('main', 3, 'easy');
    this.spawnBots('main', 2, 'medium');
    this.spawnBots('main', 1, 'hard');

    console.log(`Game engine started | Tick rate: ${TICK_RATE}Hz | World: ${WORLD_W}x${WORLD_H} | Bots: 6`);
  }

  createRoom(id) {
    const room = {
      id: id || uuidv4(),
      players: new Map(),
      food: [],
      powerups: [],
      leaderboard: [],
      created: Date.now()
    };
    this.spawnFood(room, FOOD_COUNT);
    this.spawnPowerups(room, POWERUP_COUNT);
    this.rooms.set(room.id, room);
    return room;
  }

  findAvailableRoom() {
    for (const [id, room] of this.rooms) {
      if (room.players.size < MAX_PLAYERS) return room;
    }
    return this.createRoom();
  }

  // ===================== BOT SYSTEM =====================

  spawnBots(roomId, count, difficulty) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const botId = 'bot_' + (++this.botIdCounter) + '_' + Date.now().toString(36);
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      const skin = BOT_SKINS[Math.floor(Math.random() * BOT_SKINS.length)];
      const spawn = this.getSafeSpawn(room);

      const player = {
        id: botId,
        odx: botId,
        username: name,
        x: spawn.x, y: spawn.y, vx: 0, vy: 0,
        mass: 10 + Math.random() * 10,
        radius: BASE_RADIUS,
        score: 0, kills: 0,
        skin,
        shieldActive: false, shieldEnd: 0, visibleShieldCooldown: 0,
        boosting: false, alive: true,
        joinTime: Date.now(), maxMass: 10,
        targetX: spawn.x, targetY: spawn.y,
        isBot: true
      };

      const bot = {
        id: botId,
        player,
        difficulty,
        config: BOT_DIFFICULTIES[difficulty],
        roomId,
        state: 'roam', // roam, chase, flee, eat
        stateTimer: 0,
        targetEntity: null,
        lastDecision: 0,
        wanderAngle: Math.random() * Math.PI * 2
      };

      room.players.set(botId, player);
      this.bots.set(botId, bot);
      this.playerRooms.set(botId, roomId);
      spawned.push(botId);
    }
    return spawned;
  }

  removeBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return false;
    const room = this.rooms.get(bot.roomId);
    if (room) room.players.delete(botId);
    this.bots.delete(botId);
    this.playerRooms.delete(botId);
    return true;
  }

  removeBotsByDifficulty(roomId, difficulty, count) {
    let removed = 0;
    for (const [id, bot] of this.bots) {
      if (removed >= count) break;
      if (bot.roomId === roomId && bot.difficulty === difficulty) {
        this.removeBot(id);
        removed++;
      }
    }
    return removed;
  }

  removeAllBots(roomId) {
    const toRemove = [];
    for (const [id, bot] of this.bots) {
      if (!roomId || bot.roomId === roomId) toRemove.push(id);
    }
    toRemove.forEach(id => this.removeBot(id));
    return toRemove.length;
  }

  getBotStats() {
    const stats = { total: 0, easy: 0, medium: 0, hard: 0, expert: 0, bots: [] };
    for (const [id, bot] of this.bots) {
      stats.total++;
      stats[bot.difficulty]++;
      stats.bots.push({
        id, name: bot.player.username, difficulty: bot.difficulty,
        mass: Math.floor(bot.player.mass), score: bot.player.score,
        kills: bot.player.kills, alive: bot.player.alive, state: bot.state
      });
    }
    return stats;
  }

  updateBots() {
    const now = Date.now();
    for (const [botId, bot] of this.bots) {
      const p = bot.player;
      if (!p.alive) continue;

      const cfg = bot.config;
      if (now - bot.lastDecision < cfg.reactionMs) continue;
      bot.lastDecision = now;

      const room = this.rooms.get(bot.roomId);
      if (!room) continue;

      // Find nearby threats and prey
      let nearestThreat = null, nearestThreatDist = Infinity;
      let nearestPrey = null, nearestPreyDist = Infinity;

      for (const [otherId, other] of room.players) {
        if (otherId === botId || !other.alive) continue;
        const dx = other.x - p.x, dy = other.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (other.mass > p.mass * cfg.fleeThreshold && dist < cfg.playerRange) {
          if (dist < nearestThreatDist) { nearestThreat = other; nearestThreatDist = dist; }
        }
        if (p.mass > other.mass * cfg.chaseThreshold && dist < cfg.playerRange) {
          if (dist < nearestPreyDist) { nearestPrey = other; nearestPreyDist = dist; }
        }
      }

      // Find nearest food
      let nearestFood = null, nearestFoodDist = Infinity;
      for (const f of room.food) {
        const dx = f.x - p.x, dy = f.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < cfg.foodRange && dist < nearestFoodDist) {
          nearestFood = f; nearestFoodDist = dist;
        }
      }

      // Decision making (priority: flee > chase > eat > roam)
      if (nearestThreat) {
        bot.state = 'flee';
        // Move away from threat
        const dx = p.x - nearestThreat.x, dy = p.y - nearestThreat.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        p.targetX = p.x + (dx / dist) * 500 + (Math.random() - 0.5) * cfg.aimJitter;
        p.targetY = p.y + (dy / dist) * 500 + (Math.random() - 0.5) * cfg.aimJitter;

        // Boost to escape if close
        if (nearestThreatDist < 200 && p.mass > BOOST_COST + 5 && Math.random() < cfg.boostChance * 5) {
          p.boosting = true;
          p.mass -= BOOST_COST;
          setTimeout(() => { p.boosting = false; }, 300);
        }
        // Shield if very close
        if (nearestThreatDist < 120 && now > p.visibleShieldCooldown && Math.random() < cfg.shieldChance * 10) {
          p.shieldActive = true;
          p.shieldEnd = now + SHIELD_DURATION;
          p.visibleShieldCooldown = now + SHIELD_COOLDOWN;
        }
      } else if (nearestPrey) {
        bot.state = 'chase';
        p.targetX = nearestPrey.x + (Math.random() - 0.5) * cfg.aimJitter;
        p.targetY = nearestPrey.y + (Math.random() - 0.5) * cfg.aimJitter;

        // Boost to catch prey
        if (nearestPreyDist < 150 && p.mass > BOOST_COST + 8 && Math.random() < cfg.boostChance * 3) {
          p.boosting = true;
          p.mass -= BOOST_COST;
          setTimeout(() => { p.boosting = false; }, 300);
        }
      } else if (nearestFood) {
        bot.state = 'eat';
        p.targetX = nearestFood.x + (Math.random() - 0.5) * cfg.aimJitter * 0.5;
        p.targetY = nearestFood.y + (Math.random() - 0.5) * cfg.aimJitter * 0.5;
      } else {
        bot.state = 'roam';
        // Wander randomly, change direction occasionally
        bot.wanderAngle += (Math.random() - 0.5) * 0.8;
        p.targetX = p.x + Math.cos(bot.wanderAngle) * 400;
        p.targetY = p.y + Math.sin(bot.wanderAngle) * 400;
      }

      // Keep targets within world bounds
      p.targetX = Math.max(100, Math.min(WORLD_W - 100, p.targetX));
      p.targetY = Math.max(100, Math.min(WORLD_H - 100, p.targetY));

      // Random boost for fun
      if (Math.random() < cfg.boostChance && p.mass > BOOST_COST + 10 && !p.boosting) {
        p.boosting = true;
        p.mass -= BOOST_COST;
        setTimeout(() => { p.boosting = false; }, 300);
      }
    }
  }

  respawnBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) return;
    const room = this.rooms.get(bot.roomId);
    if (!room) return;
    const spawn = this.getSafeSpawn(room);
    const p = bot.player;
    p.x = spawn.x; p.y = spawn.y;
    p.mass = 10 + Math.random() * 10;
    p.radius = BASE_RADIUS;
    p.score = 0; p.kills = 0;
    p.alive = true;
    p.shieldActive = true;
    p.shieldEnd = Date.now() + 3000;
    p.joinTime = Date.now();
    p.maxMass = p.mass;
    p.targetX = spawn.x; p.targetY = spawn.y;
    bot.state = 'roam';
  }

  // ===================== CONNECTION HANDLERS =====================

  handleConnection(socket) {
    this.totalConnections++;
    const user = socket.user;

    socket.on('join_game', (data) => this.handleJoin(socket, user, data));
    socket.on('input', (data) => this.handleInput(socket, data));
    socket.on('boost', () => this.handleBoost(socket));
    socket.on('split', () => this.handleSplit(socket));
    socket.on('shield', () => this.handleShield(socket));
    socket.on('ping_check', (ts) => socket.emit('pong_check', ts));
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }

  handleJoin(socket, user, data) {
    const room = this.findAvailableRoom();
    const skinData = data?.skin || 'default';
    const spawnPos = this.getSafeSpawn(room);

    const player = {
      id: socket.id,
      odx: user.id,
      username: data?.username || user.username,
      x: spawnPos.x, y: spawnPos.y, vx: 0, vy: 0,
      mass: 10, radius: BASE_RADIUS,
      score: 0, kills: 0, skin: skinData,
      shieldActive: false, shieldEnd: 0, visibleShieldCooldown: 0,
      boosting: false, alive: true,
      joinTime: Date.now(), maxMass: 10,
      targetX: spawnPos.x, targetY: spawnPos.y,
      isBot: false
    };

    room.players.set(socket.id, player);
    this.playerRooms.set(socket.id, room.id);
    socket.join(room.id);

    socket.emit('game_joined', {
      roomId: room.id,
      player: this.serializePlayer(player),
      world: { width: WORLD_W, height: WORLD_H },
      food: room.food,
      powerups: room.powerups
    });

    socket.to(room.id).emit('player_joined', this.serializePlayer(player));
  }

  handleInput(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;

    if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
    player.targetX = Math.max(0, Math.min(WORLD_W, data.x));
    player.targetY = Math.max(0, Math.min(WORLD_H, data.y));
  }

  handleBoost(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.mass < BOOST_COST + 5) return;
    player.boosting = true;
    player.mass -= BOOST_COST;
    setTimeout(() => { if (player) player.boosting = false; }, 300);
  }

  handleSplit(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.mass < SPLIT_MIN_MASS) return;

    const halfMass = player.mass * 0.35;
    player.mass -= halfMass;
    const angle = Math.atan2(player.targetY - player.y, player.targetX - player.x);
    room.food.push({
      id: 'food_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      x: player.x + Math.cos(angle) * (player.radius + 20),
      y: player.y + Math.sin(angle) * (player.radius + 20),
      radius: Math.sqrt(halfMass) * 3,
      color: '#ffffff', value: halfMass, type: 'ejected'
    });
  }

  handleShield(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;
    if (Date.now() < player.visibleShieldCooldown) return;
    player.shieldActive = true;
    player.shieldEnd = Date.now() + SHIELD_DURATION;
    player.visibleShieldCooldown = Date.now() + SHIELD_COOLDOWN;
  }

  handleDisconnect(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      const duration = Math.floor((Date.now() - player.joinTime) / 1000);
      this.db.recordSession(player.odx, player.username, roomId, player.score, player.kills, duration, player.maxMass);
      if (typeof player.odx === 'number') {
        this.db.updatePlayerStats(player.odx, player.kills, duration, player.score);
      }
      room.players.delete(socket.id);
      this.io.to(roomId).emit('player_left', socket.id);
    }
    this.playerRooms.delete(socket.id);
  }

  // ===================== GAME LOOP =====================

  tick() {
    this.updateBots();
    for (const [roomId, room] of this.rooms) {
      this.updatePlayers(room);
      this.checkFoodCollisions(room);
      this.checkPowerupCollisions(room);
      this.checkPlayerCollisions(room);
      this.updateShields(room);
      this.maintainFood(room);
      this.maintainPowerups(room);
      this.updateLeaderboard(room);
      this.broadcastState(room);
    }
  }

  updatePlayers(room) {
    for (const [id, p] of room.players) {
      if (!p.alive) continue;
      const speed = BASE_SPEED * (BASE_RADIUS / (p.radius * 0.5 + BASE_RADIUS * 0.5));
      const actualSpeed = p.boosting ? speed * BOOST_MULTIPLIER : speed;

      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        p.vx = (dx / dist) * actualSpeed;
        p.vy = (dy / dist) * actualSpeed;
      } else {
        p.vx *= 0.9;
        p.vy *= 0.9;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(p.radius, Math.min(WORLD_W - p.radius, p.x));
      p.y = Math.max(p.radius, Math.min(WORLD_H - p.radius, p.y));
      p.radius = BASE_RADIUS + Math.sqrt(p.mass) * 3;

      if (p.mass > 50) p.mass *= 0.9998;
      p.maxMass = Math.max(p.maxMass, p.mass);
    }
  }

  checkFoodCollisions(room) {
    const eaten = [];
    for (const [id, p] of room.players) {
      if (!p.alive) continue;
      for (let i = room.food.length - 1; i >= 0; i--) {
        const f = room.food[i];
        const dx = p.x - f.x, dy = p.y - f.y;
        if (Math.sqrt(dx * dx + dy * dy) < p.radius) {
          p.mass += f.value || FOOD_VALUE;
          p.score += Math.floor(f.value || FOOD_VALUE);
          eaten.push(i);
        }
      }
    }
    const uniqueEaten = [...new Set(eaten)].sort((a, b) => b - a);
    for (const idx of uniqueEaten) room.food.splice(idx, 1);
  }

  checkPowerupCollisions(room) {
    for (const [id, p] of room.players) {
      if (!p.alive) continue;
      for (let i = room.powerups.length - 1; i >= 0; i--) {
        const pu = room.powerups[i];
        const dx = p.x - pu.x, dy = p.y - pu.y;
        if (Math.sqrt(dx * dx + dy * dy) < p.radius + pu.radius) {
          this.applyPowerup(p, pu);
          room.powerups.splice(i, 1);
          this.io.to(room.id).emit('powerup_collected', { playerId: id, powerupId: pu.id, type: pu.type });
        }
      }
    }
  }

  applyPowerup(player, powerup) {
    switch (powerup.type) {
      case 'speed':
        player.boosting = true;
        setTimeout(() => { player.boosting = false; }, 5000);
        break;
      case 'mass':
        player.mass += 30; player.score += 30;
        break;
      case 'magnet':
        player._magnet = Date.now() + 5000;
        break;
      case 'ghost':
        player.shieldActive = true;
        player.shieldEnd = Date.now() + 4000;
        break;
    }
  }

  checkPlayerCollisions(room) {
    const players = Array.from(room.players.values()).filter(p => p.alive);
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < (a.radius + b.radius) * 0.6) {
          if (a.shieldActive || b.shieldActive) continue;
          if (a.mass > b.mass * 1.15) this.killPlayer(room, b, a);
          else if (b.mass > a.mass * 1.15) this.killPlayer(room, a, b);
        }
      }
    }
  }

  killPlayer(room, victim, killer) {
    victim.alive = false;
    killer.mass += victim.mass * 0.7;
    killer.score += Math.floor(victim.mass * 2);
    killer.kills++;

    const foodCount = Math.min(Math.floor(victim.mass * 0.3), 20);
    for (let i = 0; i < foodCount; i++) {
      const angle = (Math.PI * 2 * i) / foodCount;
      const dist = victim.radius + Math.random() * 60;
      room.food.push({
        id: 'death_' + Date.now() + '_' + i,
        x: victim.x + Math.cos(angle) * dist,
        y: victim.y + Math.sin(angle) * dist,
        radius: 4 + Math.random() * 4,
        color: '#ff4444', value: 2, type: 'death'
      });
    }

    this.io.to(room.id).emit('player_killed', {
      victimId: victim.id, killerId: killer.id,
      killerName: killer.username, victimName: victim.username,
      position: { x: victim.x, y: victim.y }
    });

    const duration = Math.floor((Date.now() - victim.joinTime) / 1000);
    if (!victim.isBot) {
      this.db.recordSession(victim.odx, victim.username, room.id, victim.score, victim.kills, duration, victim.maxMass);
      if (typeof victim.odx === 'number') {
        this.db.updatePlayerStats(victim.odx, victim.kills, duration, victim.score);
      }
    }

    // Respawn after delay
    setTimeout(() => {
      if (victim.isBot) {
        this.respawnBot(victim.id);
      } else {
        if (!room.players.has(victim.id)) return;
        const spawn = this.getSafeSpawn(room);
        victim.x = spawn.x; victim.y = spawn.y;
        victim.mass = 10; victim.radius = BASE_RADIUS;
        victim.score = 0; victim.kills = 0;
        victim.alive = true;
        victim.shieldActive = true;
        victim.shieldEnd = Date.now() + 3000;
        victim.joinTime = Date.now();
        victim.maxMass = 10;
        this.io.to(victim.id).emit('respawn', this.serializePlayer(victim));
      }
    }, 2000);
  }

  updateShields(room) {
    const now = Date.now();
    for (const [id, p] of room.players) {
      if (p.shieldActive && now > p.shieldEnd) p.shieldActive = false;
    }
  }

  maintainFood(room) {
    if (room.food.length < FOOD_COUNT * 0.7) this.spawnFood(room, FOOD_COUNT - room.food.length);
  }

  maintainPowerups(room) {
    if (room.powerups.length < POWERUP_COUNT) this.spawnPowerups(room, POWERUP_COUNT - room.powerups.length);
  }

  spawnFood(room, count) {
    const colors = ['#00fff2', '#ff0080', '#39ff14', '#ffff00', '#ff6600', '#bf00ff', '#0088ff', '#ff4444'];
    for (let i = 0; i < count; i++) {
      room.food.push({
        id: 'f_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4),
        x: Math.random() * WORLD_W, y: Math.random() * WORLD_H,
        radius: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        value: FOOD_VALUE, type: 'food'
      });
    }
  }

  spawnPowerups(room, count) {
    const types = ['speed', 'mass', 'magnet', 'ghost'];
    const icons = { speed: '⚡', mass: '💎', magnet: '🧲', ghost: '👻' };
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      room.powerups.push({
        id: 'pu_' + Date.now() + '_' + i,
        x: 200 + Math.random() * (WORLD_W - 400), y: 200 + Math.random() * (WORLD_H - 400),
        radius: 18, type, icon: icons[type]
      });
    }
  }

  getSafeSpawn(room) {
    for (let attempts = 0; attempts < 20; attempts++) {
      const x = 200 + Math.random() * (WORLD_W - 400);
      const y = 200 + Math.random() * (WORLD_H - 400);
      let safe = true;
      for (const [, p] of room.players) {
        if (!p.alive) continue;
        const dx = p.x - x, dy = p.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < p.radius + 200) { safe = false; break; }
      }
      if (safe) return { x, y };
    }
    return { x: Math.random() * WORLD_W, y: Math.random() * WORLD_H };
  }

  updateLeaderboard(room) {
    room.leaderboard = Array.from(room.players.values())
      .filter(p => p.alive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(p => ({ id: p.id, name: p.username, score: p.score, mass: Math.floor(p.mass) }));
  }

  broadcastState(room) {
    const players = {};
    for (const [id, p] of room.players) {
      players[id] = this.serializePlayer(p);
    }
    this.io.to(room.id).emit('state', {
      players, food: room.food, powerups: room.powerups, leaderboard: room.leaderboard
    });
  }

  serializePlayer(p) {
    return {
      id: p.id, username: p.username,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      radius: Math.round(p.radius * 10) / 10, mass: Math.round(p.mass * 10) / 10,
      score: p.score, kills: p.kills, skin: p.skin,
      shieldActive: p.shieldActive, boosting: p.boosting, alive: p.alive
    };
  }

  recordHeatmap() {
    const data = [];
    for (const [, room] of this.rooms) {
      for (const [, p] of room.players) {
        if (p.alive) data.push({ x: p.x / WORLD_W, y: p.y / WORLD_H, mass: p.mass });
      }
    }
    this.heatmapData = data;
  }

  cleanup() {
    for (const [id, room] of this.rooms) {
      if (id !== 'main' && room.players.size === 0 && Date.now() - room.created > 60000) {
        this.rooms.delete(id);
      }
    }
  }

  getStats() {
    let activePlayers = 0;
    const rooms = [];
    for (const [id, room] of this.rooms) {
      const playerCount = room.players.size;
      const botCount = Array.from(room.players.values()).filter(p => p.isBot).length;
      activePlayers += playerCount;
      rooms.push({ id, players: playerCount, bots: botCount, humans: playerCount - botCount, food: room.food.length, uptime: Math.floor((Date.now() - room.created) / 1000) });
    }
    return { activePlayers, activeRooms: this.rooms.size, totalConnections: this.totalConnections, rooms, botStats: this.getBotStats() };
  }

  getHeatmapData() { return this.heatmapData; }
}

module.exports = GameEngine;
