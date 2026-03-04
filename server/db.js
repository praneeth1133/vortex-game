const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'vortex-data.json');

// --- In-Memory Database with JSON Persistence ---
const defaultData = {
  users: [],
  skins: [],
  transactions: [],
  gameSessions: [],
  nextUserId: 1
};

let data;
try {
  if (fs.existsSync(DB_PATH)) {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    // Ensure all fields exist
    data = { ...defaultData, ...data };
  } else {
    data = { ...defaultData };
  }
} catch {
  data = { ...defaultData };
}

function save() {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch {}
}

// Debounced save (don't write on every tiny change)
let saveTimer = null;
function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 2000);
}

// Auto-save periodically
setInterval(save, 30000);
process.on('exit', save);
process.on('SIGINT', () => { save(); process.exit(); });

// --- Seed Default Skins ---
if (data.skins.length === 0) {
  data.skins = [
    { id: 'default', name: 'Nova', description: 'Standard cosmic orb', price: 0, rarity: 'common', colors: '["#00fff2","#0088ff"]', trail_color: '#00fff2', glow_intensity: 1.0, particle_effect: 'default', available: 1 },
    { id: 'inferno', name: 'Inferno', description: 'Blazing fire orb', price: 500, rarity: 'rare', colors: '["#ff4400","#ff8800","#ffcc00"]', trail_color: '#ff6600', glow_intensity: 1.3, particle_effect: 'fire', available: 1 },
    { id: 'phantom', name: 'Phantom', description: 'Ghostly ethereal orb', price: 800, rarity: 'rare', colors: '["#9944ff","#6600cc","#cc88ff"]', trail_color: '#9944ff', glow_intensity: 1.2, particle_effect: 'ghost', available: 1 },
    { id: 'aurora', name: 'Aurora', description: 'Northern lights shimmer', price: 1200, rarity: 'epic', colors: '["#00ff88","#00ffcc","#0088ff","#8800ff"]', trail_color: '#00ff88', glow_intensity: 1.5, particle_effect: 'aurora', available: 1 },
    { id: 'void', name: 'Void', description: 'Dark matter entity', price: 2000, rarity: 'epic', colors: '["#1a0033","#330066","#660099"]', trail_color: '#330066', glow_intensity: 0.8, particle_effect: 'void', available: 1 },
    { id: 'solar', name: 'Solar Flare', description: 'Raw stellar energy', price: 3000, rarity: 'legendary', colors: '["#ffff00","#ff8800","#ff0000","#ffffff"]', trail_color: '#ffff00', glow_intensity: 2.0, particle_effect: 'solar', available: 1 },
    { id: 'galaxy', name: 'Galaxy', description: 'Entire galaxy in an orb', price: 5000, rarity: 'legendary', colors: '["#ff0080","#8000ff","#0040ff","#00ffff","#ffffff"]', trail_color: '#ff0080', glow_intensity: 2.0, particle_effect: 'galaxy', available: 1 },
    { id: 'neon_pink', name: 'Neon Pink', description: 'Hot pink neon glow', price: 300, rarity: 'common', colors: '["#ff0080","#ff44aa"]', trail_color: '#ff0080', glow_intensity: 1.1, particle_effect: 'default', available: 1 },
    { id: 'toxic', name: 'Toxic', description: 'Radioactive green', price: 600, rarity: 'rare', colors: '["#39ff14","#00cc00","#ccff00"]', trail_color: '#39ff14', glow_intensity: 1.3, particle_effect: 'toxic', available: 1 },
    { id: 'ice', name: 'Frost', description: 'Frozen crystal orb', price: 700, rarity: 'rare', colors: '["#88ddff","#44aaff","#ffffff"]', trail_color: '#88ddff', glow_intensity: 1.2, particle_effect: 'ice', available: 1 },
    { id: 'rainbow', name: 'Prismatic', description: 'All the colors', price: 4000, rarity: 'legendary', colors: '["#ff0000","#ff8800","#ffff00","#00ff00","#0088ff","#8800ff"]', trail_color: '#ffffff', glow_intensity: 1.8, particle_effect: 'rainbow', available: 1 },
    { id: 'shadow', name: 'Shadow', description: 'Living darkness', price: 1500, rarity: 'epic', colors: '["#111111","#222222","#440044"]', trail_color: '#440044', glow_intensity: 0.5, particle_effect: 'shadow', available: 1 }
  ];
  save();
}

// --- Helper ---
function today() { return new Date().toISOString().split('T')[0]; }
function now() { return new Date().toISOString(); }

module.exports = {
  getUserByUsername(username) { return data.users.find(u => u.username === username) || null; },

  getUserById(id) { return data.users.find(u => u.id === id) || null; },

  createUser(username, email, hash) {
    const user = {
      id: data.nextUserId++,
      username, email, password_hash: hash, role: 'player',
      coins: 0, xp: 0, games_played: 0, highest_score: 0,
      total_kills: 0, total_time_played: 0,
      owned_skins: '["default"]', equipped_skin: 'default',
      last_login: now(), created_at: now(), banned: 0
    };
    data.users.push(user);
    debouncedSave();
    return { id: user.id, username, coins: 0, xp: 0 };
  },

  updateLastLogin(id) {
    const u = data.users.find(u => u.id === id);
    if (u) u.last_login = now();
  },

  equipSkin(id, skinId) {
    const u = data.users.find(u => u.id === id);
    if (u) { u.equipped_skin = skinId; debouncedSave(); }
  },

  addCoins(id, amount) {
    const u = data.users.find(u => u.id === id);
    if (u) { u.coins += amount; debouncedSave(); }
  },

  purchaseSkin(id, skinId, price, currentSkins) {
    const u = data.users.find(u => u.id === id);
    if (u) {
      u.coins -= price;
      u.owned_skins = JSON.stringify([...currentSkins, skinId]);
      debouncedSave();
    }
  },

  getAllSkins() { return data.skins.filter(s => s.available); },

  getSkin(id) { return data.skins.find(s => s.id === id) || null; },

  recordTransaction(userId, coins, usd, provider, providerId) {
    data.transactions.push({ id: data.transactions.length + 1, user_id: userId, type: 'purchase', amount_coins: coins, amount_usd: usd, provider, provider_id: providerId, created_at: now() });
    debouncedSave();
  },

  recordSession(userId, username, roomId, score, kills, duration, maxMass) {
    data.gameSessions.push({ id: data.gameSessions.length + 1, user_id: userId, username, room_id: roomId, score, kills, duration, max_mass: maxMass, created_at: now() });
    debouncedSave();
  },

  updatePlayerStats(userId, kills, duration, score) {
    const u = data.users.find(u => u.id === userId);
    if (!u) return;
    u.games_played++;
    u.total_kills += kills;
    u.total_time_played += duration;
    u.highest_score = Math.max(u.highest_score, score);
    const xpGain = Math.floor(score / 10) + kills * 50 + Math.floor(duration / 60) * 10;
    const coinGain = Math.floor(score / 50) + kills * 10;
    u.xp += xpGain;
    u.coins += coinGain;
    debouncedSave();
  },

  getLeaderboard(type, limit) {
    const sortKey = type === 'kills' ? 'total_kills' : type === 'xp' ? 'xp' : 'highest_score';
    return data.users
      .filter(u => !u.banned)
      .sort((a, b) => b[sortKey] - a[sortKey])
      .slice(0, limit)
      .map(u => ({ username: u.username, value: u[sortKey] }));
  },

  getAdminStats() {
    const todayStr = today();
    return {
      totalUsers: data.users.length,
      totalSessions: data.gameSessions.length,
      totalRevenue: data.transactions.reduce((s, t) => s + (t.amount_usd || 0), 0),
      newUsersToday: data.users.filter(u => u.created_at && u.created_at.startsWith(todayStr)).length,
      sessionsToday: data.gameSessions.filter(s => s.created_at && s.created_at.startsWith(todayStr)).length,
      revenueToday: data.transactions.filter(t => t.created_at && t.created_at.startsWith(todayStr)).reduce((s, t) => s + (t.amount_usd || 0), 0),
    };
  },

  getUsers(page, limit, search) {
    let filtered = data.users;
    if (search) filtered = filtered.filter(u => u.username.toLowerCase().includes(search.toLowerCase()));
    const total = filtered.length;
    const sorted = filtered.sort((a, b) => b.id - a.id);
    const offset = (page - 1) * limit;
    const users = sorted.slice(offset, offset + limit).map(u => ({
      id: u.id, username: u.username, email: u.email, coins: u.coins,
      xp: u.xp, games_played: u.games_played, highest_score: u.highest_score,
      total_kills: u.total_kills, role: u.role, banned: u.banned,
      last_login: u.last_login, created_at: u.created_at
    }));
    return { users, total, page, totalPages: Math.ceil(total / limit) };
  },

  getRevenueStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = data.transactions.filter(t => t.created_at >= thirtyDaysAgo);
    const byDay = {};
    for (const t of recent) {
      const day = t.created_at.split('T')[0];
      if (!byDay[day]) byDay[day] = { date: day, revenue: 0, count: 0 };
      byDay[day].revenue += t.amount_usd || 0;
      byDay[day].count++;
    }
    return {
      byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      total: data.transactions.reduce((s, t) => s + (t.amount_usd || 0), 0),
      today: data.transactions.filter(t => t.created_at && t.created_at.startsWith(today())).reduce((s, t) => s + (t.amount_usd || 0), 0)
    };
  },

  getActivityTimeline() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    // Sessions by day
    const sessionsByDay = {};
    for (const s of data.gameSessions.filter(s => s.created_at >= thirtyDaysAgo)) {
      const day = s.created_at.split('T')[0];
      if (!sessionsByDay[day]) sessionsByDay[day] = { date: day, sessions: 0, avg_duration: 0, totalDur: 0 };
      sessionsByDay[day].sessions++;
      sessionsByDay[day].totalDur += s.duration || 0;
    }
    for (const d of Object.values(sessionsByDay)) d.avg_duration = d.sessions ? d.totalDur / d.sessions : 0;

    // Users by day
    const usersByDay = {};
    for (const u of data.users.filter(u => u.created_at >= thirtyDaysAgo)) {
      const day = u.created_at.split('T')[0];
      if (!usersByDay[day]) usersByDay[day] = { date: day, new_users: 0 };
      usersByDay[day].new_users++;
    }

    // Revenue by day
    const revByDay = {};
    for (const t of data.transactions.filter(t => t.created_at >= thirtyDaysAgo)) {
      const day = t.created_at.split('T')[0];
      if (!revByDay[day]) revByDay[day] = { date: day, revenue: 0, count: 0 };
      revByDay[day].revenue += t.amount_usd || 0;
      revByDay[day].count++;
    }

    return {
      sessions: Object.values(sessionsByDay).sort((a, b) => a.date.localeCompare(b.date)),
      users: Object.values(usersByDay).sort((a, b) => a.date.localeCompare(b.date)),
      revenue: Object.values(revByDay).sort((a, b) => a.date.localeCompare(b.date))
    };
  },

  forceSave() { save(); }
};
