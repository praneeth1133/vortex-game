/* ========= VORTEX Network Layer ========= */

class Network {
  constructor() {
    this.socket = null;
    this.token = null;
    this.connected = false;
    this.latency = 0;
    this.inputThrottle = 1000 / 60; // 60 inputs/sec — match server tick rate
    this.lastInputTime = 0;
    this.onGameJoined = null;
    this.onStateUpdate = null;
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onPlayerKilled = null;
    this.onRespawn = null;
    this.onPowerupCollected = null;
    this.onDisconnect = null;
    this.onConnect = null;
  }

  connect(token) {
    this.token = token;
    this.socket = io({ auth: { token }, reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 5 });

    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[VORTEX] Connected to server');
      if (this.onConnect) this.onConnect();
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      console.log('[VORTEX] Disconnected:', reason);
      if (this.onDisconnect) this.onDisconnect(reason);
    });

    this.socket.on('connect_error', (err) => {
      console.error('[VORTEX] Connection error:', err.message);
    });

    // Game events
    this.socket.on('game_joined', (data) => { if (this.onGameJoined) this.onGameJoined(data); });
    this.socket.on('state', (data) => { if (this.onStateUpdate) this.onStateUpdate(data); });
    this.socket.on('player_joined', (data) => { if (this.onPlayerJoined) this.onPlayerJoined(data); });
    this.socket.on('player_left', (id) => { if (this.onPlayerLeft) this.onPlayerLeft(id); });
    this.socket.on('player_killed', (data) => { if (this.onPlayerKilled) this.onPlayerKilled(data); });
    this.socket.on('respawn', (data) => { if (this.onRespawn) this.onRespawn(data); });
    this.socket.on('powerup_collected', (data) => { if (this.onPowerupCollected) this.onPowerupCollected(data); });

    // Latency measurement
    this.socket.on('pong_check', (ts) => { this.latency = Date.now() - ts; });
    setInterval(() => { if (this.connected) this.socket.emit('ping_check', Date.now()); }, 3000);
  }

  joinGame(username, skin) {
    if (!this.connected) return;
    this.socket.emit('join_game', { username, skin });
  }

  sendInput(x, y) {
    const now = Date.now();
    if (now - this.lastInputTime < this.inputThrottle) return;
    this.lastInputTime = now;
    if (this.connected) this.socket.emit('input', { x, y });
  }

  sendBoost() { if (this.connected) this.socket.emit('boost'); }
  sendSplit() { if (this.connected) this.socket.emit('split'); }
  sendShield() { if (this.connected) this.socket.emit('shield'); }

  disconnect() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    this.connected = false;
  }
}

// --- API Client ---
class API {
  constructor() {
    this.baseUrl = '';
    this.token = null;
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('vortex_token', token);
  }

  getToken() {
    if (!this.token) this.token = localStorage.getItem('vortex_token');
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('vortex_token');
    localStorage.removeItem('vortex_user');
  }

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.baseUrl + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // Auth
  async register(username, email, password) { return this.request('POST', '/api/auth/register', { username, email, password }); }
  async login(username, password) { return this.request('POST', '/api/auth/login', { username, password }); }
  async guestLogin() { return this.request('POST', '/api/auth/guest'); }

  // Player
  async getProfile() { return this.request('GET', '/api/player/profile'); }
  async equipSkin(skinId) { return this.request('POST', '/api/player/equip-skin', { skinId }); }

  // Shop
  async getSkins() { return this.request('GET', '/api/shop/skins'); }
  async buySkin(skinId) { return this.request('POST', '/api/shop/buy', { skinId }); }

  // Leaderboard
  async getLeaderboard(type = 'score') { return this.request('GET', `/api/leaderboard?type=${type}`); }

  // Admin
  async adminLogin(username, password) { return this.request('POST', '/api/admin/login', { username, password }); }
  async getAdminStats() { return this.request('GET', '/api/admin/stats'); }
  async getAdminUsers(page = 1, search = '') { return this.request('GET', `/api/admin/users?page=${page}&search=${encodeURIComponent(search)}`); }
  async getAdminRevenue() { return this.request('GET', '/api/admin/revenue'); }
  async getAdminHeatmap() { return this.request('GET', '/api/admin/heatmap'); }
  async getAdminActivity() { return this.request('GET', '/api/admin/activity'); }
}

window.Network = Network;
window.API = API;
