const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const GameEngine = require('./gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vortex-dev-secret';

// --- Stripe Setup ---
const stripe = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('your_stripe')
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const STRIPE_MODE = !!stripe;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const COIN_PACKS = {
  starter:  { coins: 500,  priceUsd: 99,   label: 'Starter Pack — 500 Coins' },
  popular:  { coins: 1200, priceUsd: 199,  label: 'Popular Pack — 1,200 Coins' },
  mega:     { coins: 3000, priceUsd: 499,  label: 'Mega Pack — 3,000 Coins' },
  ultimate: { coins: 8000, priceUsd: 999,  label: 'Ultimate Pack — 8,000 Coins' }
};

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'allow' }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many auth attempts' } });

// --- Auth Helpers ---
function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role || 'player' }, JWT_SECRET, { expiresIn: '7d' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// --- Auth Routes ---
app.post('/api/auth/register', authLimiter, (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = db.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username taken' });

    const hash = bcrypt.hashSync(password, 10);
    const user = db.createUser(username, email || '', hash);
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, username: user.username, coins: user.coins, xp: user.xp } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    db.updateLastLogin(user.id);
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, username: user.username, coins: user.coins, xp: user.xp, skins: JSON.parse(user.owned_skins || '["default"]') } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/guest', apiLimiter, (req, res) => {
  const guestName = 'Guest_' + Math.random().toString(36).substring(2, 8);
  const guestUser = { id: 'guest_' + Date.now(), username: guestName, role: 'guest' };
  const token = generateToken(guestUser);
  res.json({ token, user: { id: guestUser.id, username: guestName, coins: 0, xp: 0 } });
});

// --- Player Routes ---
app.get('/api/player/profile', apiLimiter, authenticateToken, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id, username: user.username, coins: user.coins, xp: user.xp,
    level: Math.floor(user.xp / 1000) + 1,
    games_played: user.games_played, highest_score: user.highest_score,
    total_kills: user.total_kills, total_time_played: user.total_time_played,
    owned_skins: JSON.parse(user.owned_skins || '["default"]'),
    equipped_skin: user.equipped_skin || 'default',
    created_at: user.created_at
  });
});

app.post('/api/player/equip-skin', apiLimiter, authenticateToken, (req, res) => {
  const { skinId } = req.body;
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const owned = JSON.parse(user.owned_skins || '["default"]');
  if (!owned.includes(skinId)) return res.status(403).json({ error: 'Skin not owned' });
  db.equipSkin(req.user.id, skinId);
  res.json({ success: true, equipped: skinId });
});

// --- Shop Routes ---
app.get('/api/shop/skins', apiLimiter, (req, res) => {
  res.json({ skins: db.getAllSkins() });
});

app.post('/api/shop/buy', apiLimiter, authenticateToken, (req, res) => {
  const { skinId } = req.body;
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const skin = db.getSkin(skinId);
  if (!skin) return res.status(404).json({ error: 'Skin not found' });

  const owned = JSON.parse(user.owned_skins || '["default"]');
  if (owned.includes(skinId)) return res.status(409).json({ error: 'Already owned' });
  if (user.coins < skin.price) return res.status(400).json({ error: 'Not enough coins' });

  db.purchaseSkin(req.user.id, skinId, skin.price, owned);
  res.json({ success: true, coins: user.coins - skin.price });
});

// --- Leaderboard Routes ---
app.get('/api/leaderboard', apiLimiter, (req, res) => {
  const type = req.query.type || 'score';
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  res.json({ leaderboard: db.getLeaderboard(type, limit) });
});

// --- Admin Routes ---
app.post('/api/admin/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = generateToken({ id: 'admin', username: 'admin', role: 'admin' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid admin credentials' });
});

app.get('/api/admin/stats', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  const engine = gameEngine;
  const stats = db.getAdminStats();
  const gameStats = engine.getStats();
  res.json({
    ...stats,
    activePlayers: gameStats.activePlayers,
    activeRooms: gameStats.activeRooms,
    totalConnectionsToday: gameStats.totalConnections,
    serverUptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    roomDetails: gameStats.rooms
  });
});

app.get('/api/admin/users', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const search = req.query.search || '';
  res.json(db.getUsers(page, limit, search));
});

app.get('/api/admin/revenue', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  res.json(db.getRevenueStats());
});

app.get('/api/admin/heatmap', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  const engine = gameEngine;
  res.json({ heatmap: engine.getHeatmapData() });
});

app.get('/api/admin/activity', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  res.json(db.getActivityTimeline());
});

// --- Bot Management Routes (Admin Only) ---
app.get('/api/admin/bots', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  res.json(gameEngine.getBotStats());
});

app.post('/api/admin/bots/spawn', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  const { roomId = 'main', count = 1, difficulty = 'medium' } = req.body;
  if (!['easy', 'medium', 'hard', 'expert'].includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty. Use: easy, medium, hard, expert' });
  }
  const num = Math.min(Math.max(1, parseInt(count)), 10);
  const spawned = gameEngine.spawnBots(roomId, num, difficulty);
  res.json({ success: true, spawned: spawned.length, botStats: gameEngine.getBotStats() });
});

app.post('/api/admin/bots/remove', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  const { roomId = 'main', count = 1, difficulty } = req.body;
  if (difficulty && !['easy', 'medium', 'hard', 'expert'].includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty' });
  }
  const num = Math.min(Math.max(1, parseInt(count)), 20);
  let removed;
  if (difficulty) {
    removed = gameEngine.removeBotsByDifficulty(roomId, difficulty, num);
  } else {
    removed = gameEngine.removeAllBots(roomId);
  }
  res.json({ success: true, removed, botStats: gameEngine.getBotStats() });
});

app.post('/api/admin/bots/remove-all', apiLimiter, authenticateToken, requireAdmin, (req, res) => {
  const { roomId } = req.body;
  const removed = gameEngine.removeAllBots(roomId || undefined);
  res.json({ success: true, removed, botStats: gameEngine.getBotStats() });
});

// --- Coin Purchase (Real Stripe Checkout or Demo Fallback) ---
app.post('/api/shop/buy-coins', apiLimiter, authenticateToken, async (req, res) => {
  const { packId } = req.body;
  const pack = COIN_PACKS[packId];
  if (!pack) return res.status(400).json({ error: 'Invalid pack' });

  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // --- Real Stripe Checkout ---
  if (STRIPE_MODE) {
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: pack.label,
              description: `${pack.coins} coins for VORTEX`,
              images: [`${BASE_URL}/icons/icon-512.svg`]
            },
            unit_amount: pack.priceUsd  // in cents
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${BASE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&coins=${pack.coins}`,
        cancel_url: `${BASE_URL}/payment-cancel.html`,
        metadata: {
          userId: String(req.user.id),
          coins: String(pack.coins),
          packId
        }
      });
      return res.json({ success: true, mode: 'stripe', checkoutUrl: session.url });
    } catch (err) {
      console.error('Stripe error:', err.message);
      return res.status(500).json({ error: 'Payment service error. Try again.' });
    }
  }

  // --- Demo Mode Fallback (no Stripe keys) ---
  db.addCoins(req.user.id, pack.coins);
  db.recordTransaction(req.user.id, pack.coins, pack.priceUsd / 100, 'demo', 'demo_' + Date.now());
  res.json({ success: true, mode: 'demo', coins: user.coins + pack.coins, purchased: pack.coins });
});

// --- Payment Status Check ---
app.get('/api/shop/payment-status', apiLimiter, authenticateToken, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  if (STRIPE_MODE) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        const user = db.getUserById(req.user.id);
        return res.json({ paid: true, coins: user ? user.coins : 0 });
      }
      return res.json({ paid: false });
    } catch {
      return res.status(400).json({ error: 'Invalid session' });
    }
  }
  res.json({ paid: true });
});

// --- Stripe Webhook (Fulfillment — grants coins after real payment) ---
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!STRIPE_MODE) return res.json({ received: true });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      const userId = session.metadata.userId;
      const coins = parseInt(session.metadata.coins);
      const packId = session.metadata.packId;
      if (userId && coins) {
        db.addCoins(userId, coins);
        db.recordTransaction(userId, coins, session.amount_total / 100, 'stripe', session.id);
        console.log(`[STRIPE] Fulfilled ${coins} coins for user ${userId} (pack: ${packId})`);
      }
    }
  }
  res.json({ received: true });
});

// --- Dashboard route ---
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'));
});
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'));
});

// --- Catch-all for SPA ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- Game Engine ---
const gameEngine = new GameEngine(io, db);
gameEngine.start();

// --- Socket.IO Auth Middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// --- Socket.IO Connection ---
io.on('connection', (socket) => {
  gameEngine.handleConnection(socket);
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         🌀 VORTEX SERVER 🌀          ║
  ╠══════════════════════════════════════╣
  ║  Game:      http://localhost:${PORT}     ║
  ║  Dashboard: http://localhost:${PORT}/dashboard ║
  ║  Status:    ONLINE                   ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
