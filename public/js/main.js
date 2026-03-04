/* ========= VORTEX Main Application ========= */

(function () {
  'use strict';

  // --- App State ---
  const app = {
    user: null,
    token: null,
    settings: {
      quality: 'medium',
      sfxVolume: 70,
      musicVolume: 50,
      showFps: false,
      showMinimap: true
    },
    equippedSkin: 'default',
    ownedSkins: ['default'],
    skins: [],
    renderer: null,
    game: null,
    network: null,
    api: new API(),
    menuAnimFrame: null,
    currentScreen: 'loading'
  };

  // --- Initialization ---
  async function init() {
    loadSettings();
    updateLoadingBar(10, 'Loading assets...');

    // Initialize renderer
    await sleep(300);
    updateLoadingBar(30, 'Initializing renderer...');

    // Check for saved session
    await sleep(200);
    updateLoadingBar(50, 'Checking session...');
    await tryRestoreSession();

    await sleep(200);
    updateLoadingBar(70, 'Preparing game...');

    await sleep(300);
    updateLoadingBar(90, 'Almost ready...');

    // Fetch online count
    fetchOnlineCount();

    await sleep(400);
    updateLoadingBar(100, 'Ready!');

    await sleep(500);
    showScreen('menu');
    startMenuBackground();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function updateLoadingBar(percent, text) {
    const fill = document.getElementById('loading-fill');
    const textEl = document.getElementById('loading-text');
    if (fill) fill.style.width = percent + '%';
    if (textEl) textEl.textContent = text;
  }

  // --- Session Management ---
  async function tryRestoreSession() {
    const token = app.api.getToken();
    if (!token) return;
    try {
      app.api.token = token;
      const data = await app.api.getProfile();
      app.user = data;
      app.token = token;
      app.ownedSkins = data.owned_skins || ['default'];
      app.equippedSkin = data.equipped_skin || 'default';
      updateMenuUser();
    } catch {
      app.api.clearToken();
    }
  }

  function updateMenuUser() {
    if (app.user) {
      document.getElementById('player-info').style.display = 'flex';
      document.getElementById('menu-player-name').textContent = app.user.username;
      document.getElementById('menu-player-level').textContent = `Lv. ${Math.floor((app.user.xp || 0) / 1000) + 1}`;
      document.getElementById('menu-coins').textContent = app.user.coins || 0;
      document.getElementById('username-input').value = app.user.username;
      document.getElementById('auth-buttons').style.display = 'none';
      document.getElementById('auth-logged-in').style.display = 'flex';
      document.getElementById('logged-in-name').textContent = app.user.username;
    } else {
      document.getElementById('player-info').style.display = 'none';
      document.getElementById('auth-buttons').style.display = 'flex';
      document.getElementById('auth-logged-in').style.display = 'none';
    }
  }

  async function fetchOnlineCount() {
    // Will show actual count once connected
    const el = document.getElementById('online-count');
    if (el) el.textContent = '...';
  }

  // --- Screen Management ---
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(name + '-screen');
    if (screen) screen.classList.add('active');
    app.currentScreen = name;

    if (name !== 'menu') stopMenuBackground();
  }

  function startMenuBackground() {
    const canvas = document.getElementById('menu-bg-canvas');
    if (!canvas) return;
    const tempRenderer = new Renderer(document.createElement('canvas'));
    function animateMenu() {
      app.menuAnimFrame = requestAnimationFrame(animateMenu);
      tempRenderer.renderMenuBg(canvas, performance.now());
    }
    animateMenu();
  }

  function stopMenuBackground() {
    if (app.menuAnimFrame) { cancelAnimationFrame(app.menuAnimFrame); app.menuAnimFrame = null; }
  }

  // --- Game Start ---
  async function startGame() {
    const username = document.getElementById('username-input').value.trim() || 'Player_' + Math.floor(Math.random() * 9999);

    // Get token (guest if not logged in)
    if (!app.token) {
      try {
        const data = await app.api.guestLogin();
        app.token = data.token;
        app.api.setToken(data.token);
      } catch (err) {
        alert('Could not connect to server. Make sure the server is running.');
        return;
      }
    }

    showScreen('game');

    // Init renderer
    const gameCanvas = document.getElementById('game-canvas');
    app.renderer = new Renderer(gameCanvas);
    app.renderer.setQuality(app.settings.quality);

    // Init game
    app.game = new Game(app.renderer);

    // Init network
    app.network = new Network();
    app.game.network = app.network;

    // Wire up network events
    app.network.onGameJoined = (data) => app.game.onGameJoined(data);
    app.network.onStateUpdate = (data) => app.game.onStateUpdate(data);
    app.network.onPlayerJoined = (data) => app.game.onPlayerJoined(data);
    app.network.onPlayerLeft = (id) => app.game.onPlayerLeft(id);
    app.network.onPlayerKilled = (data) => app.game.onPlayerKilled(data);
    app.network.onRespawn = (data) => app.game.onRespawn(data);
    app.network.onPowerupCollected = (data) => app.game.onPowerupCollected(data);

    app.network.onConnect = () => {
      app.network.joinGame(username, app.equippedSkin);
    };

    app.network.onDisconnect = () => {
      // Handle disconnect - show reconnecting message
    };

    // Connect and start
    app.network.connect(app.token);
    app.game.start(app.network);

    // Apply settings
    applyGameSettings();
  }

  function stopGame() {
    if (app.game) app.game.stop();
    if (app.network) app.network.disconnect();
    app.game = null;
    app.network = null;
    app.renderer = null;
    showScreen('menu');
    startMenuBackground();
  }

  // --- Auth Modal ---
  function showAuthModal(mode) {
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('auth-title');
    const emailField = document.getElementById('auth-email');
    const submitBtn = document.getElementById('auth-submit');
    const error = document.getElementById('auth-error');

    error.textContent = '';
    modal.style.display = 'flex';
    modal.dataset.mode = mode;

    if (mode === 'register') {
      title.textContent = 'SIGN UP';
      emailField.style.display = 'block';
      submitBtn.textContent = 'SIGN UP';
    } else {
      title.textContent = 'LOG IN';
      emailField.style.display = 'none';
      submitBtn.textContent = 'LOG IN';
    }
  }

  async function handleAuth(e) {
    e.preventDefault();
    const mode = document.getElementById('auth-modal').dataset.mode;
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const email = document.getElementById('auth-email').value.trim();
    const error = document.getElementById('auth-error');

    try {
      let data;
      if (mode === 'register') {
        data = await app.api.register(username, email, password);
      } else {
        data = await app.api.login(username, password);
      }
      app.token = data.token;
      app.user = data.user;
      app.api.setToken(data.token);
      app.ownedSkins = data.user.skins || ['default'];
      localStorage.setItem('vortex_user', JSON.stringify(data.user));
      updateMenuUser();
      document.getElementById('auth-modal').style.display = 'none';
    } catch (err) {
      error.textContent = err.message;
    }
  }

  // --- Shop ---
  async function openShop() {
    const modal = document.getElementById('shop-modal');
    modal.style.display = 'flex';
    document.getElementById('shop-coins').textContent = app.user?.coins || 0;

    try {
      const data = await app.api.getSkins();
      app.skins = data.skins;
      renderSkinsGrid();
    } catch {
      // If not logged in, show skins without buy ability
      renderSkinsGrid();
    }
  }

  function renderSkinsGrid() {
    const grid = document.getElementById('skins-grid');
    const skins = app.skins.length ? app.skins : getDefaultSkinsList();

    grid.innerHTML = skins.map(skin => {
      const owned = app.ownedSkins.includes(skin.id);
      const equipped = app.equippedSkin === skin.id;
      const colors = JSON.parse(skin.colors || '["#00fff2"]');
      const gradient = colors.length > 1
        ? `radial-gradient(circle at 35% 35%, ${colors.join(', ')})`
        : colors[0];

      return `
        <div class="skin-card ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}" data-skin-id="${skin.id}">
          ${equipped ? '<span class="skin-badge badge-equipped">EQUIPPED</span>' : owned ? '<span class="skin-badge badge-owned">OWNED</span>' : ''}
          <div class="skin-preview" style="background: ${gradient}"></div>
          <div class="skin-name">${escapeHtml(skin.name)}</div>
          <div class="skin-rarity ${skin.rarity}">${skin.rarity}</div>
          ${!owned ? `<div class="skin-price">&#9733; ${skin.price}</div>` : equipped ? '' : '<div class="skin-price" style="color: var(--neon-green)">TAP TO EQUIP</div>'}
        </div>
      `;
    }).join('');

    // Click handlers
    grid.querySelectorAll('.skin-card').forEach(card => {
      card.addEventListener('click', () => handleSkinClick(card.dataset.skinId));
    });
  }

  async function handleSkinClick(skinId) {
    const owned = app.ownedSkins.includes(skinId);
    if (owned) {
      // Equip
      try {
        if (app.user) await app.api.equipSkin(skinId);
        app.equippedSkin = skinId;
        renderSkinsGrid();
      } catch (err) {
        console.error('Equip failed:', err);
      }
    } else {
      // Buy
      if (!app.user) { alert('Log in to purchase skins!'); return; }
      const skin = app.skins.find(s => s.id === skinId);
      if (!skin) return;
      if ((app.user.coins || 0) < skin.price) { alert('Not enough coins!'); return; }
      try {
        const data = await app.api.buySkin(skinId);
        app.user.coins = data.coins;
        app.ownedSkins.push(skinId);
        document.getElementById('shop-coins').textContent = data.coins;
        document.getElementById('menu-coins').textContent = data.coins;
        renderSkinsGrid();
      } catch (err) {
        alert(err.message);
      }
    }
  }

  function getDefaultSkinsList() {
    return [
      { id: 'default', name: 'Nova', rarity: 'common', price: 0, colors: '["#00fff2","#0088ff"]' },
      { id: 'neon_pink', name: 'Neon Pink', rarity: 'common', price: 300, colors: '["#ff0080","#ff44aa"]' },
      { id: 'inferno', name: 'Inferno', rarity: 'rare', price: 500, colors: '["#ff4400","#ff8800","#ffcc00"]' },
      { id: 'toxic', name: 'Toxic', rarity: 'rare', price: 600, colors: '["#39ff14","#00cc00","#ccff00"]' },
      { id: 'ice', name: 'Frost', rarity: 'rare', price: 700, colors: '["#88ddff","#44aaff","#ffffff"]' },
      { id: 'phantom', name: 'Phantom', rarity: 'rare', price: 800, colors: '["#9944ff","#6600cc","#cc88ff"]' },
      { id: 'aurora', name: 'Aurora', rarity: 'epic', price: 1200, colors: '["#00ff88","#00ffcc","#0088ff","#8800ff"]' },
      { id: 'shadow', name: 'Shadow', rarity: 'epic', price: 1500, colors: '["#111111","#222222","#440044"]' },
      { id: 'void', name: 'Void', rarity: 'epic', price: 2000, colors: '["#1a0033","#330066","#660099"]' },
      { id: 'solar', name: 'Solar Flare', rarity: 'legendary', price: 3000, colors: '["#ffff00","#ff8800","#ff0000","#ffffff"]' },
      { id: 'rainbow', name: 'Prismatic', rarity: 'legendary', price: 4000, colors: '["#ff0000","#ff8800","#ffff00","#00ff00","#0088ff","#8800ff"]' },
      { id: 'galaxy', name: 'Galaxy', rarity: 'legendary', price: 5000, colors: '["#ff0080","#8000ff","#0040ff","#00ffff","#ffffff"]' }
    ];
  }

  // --- How to Play ---
  function openHowTo() {
    document.getElementById('howto-modal').style.display = 'flex';
  }

  // --- Coin Purchase ---
  function openCoinShop() {
    const modal = document.getElementById('coins-modal');
    modal.style.display = 'flex';
    document.getElementById('coins-balance').textContent = app.user?.coins || 0;
  }

  async function handleCoinPurchase(packId) {
    if (!app.user) { alert('Log in to purchase coins!'); return; }
    const packEl = document.querySelector(`.coin-pack[data-pack="${packId}"]`);
    if (packEl) packEl.classList.add('purchasing');
    try {
      const data = await app.api.request('POST', '/api/shop/buy-coins', { packId });

      if (data.mode === 'stripe' && data.checkoutUrl) {
        // Real Stripe: redirect to Stripe Checkout page
        window.location.href = data.checkoutUrl;
        return;
      }

      // Demo mode: coins granted instantly
      app.user.coins = data.coins;
      document.getElementById('coins-balance').textContent = data.coins;
      document.getElementById('menu-coins').textContent = data.coins;
      if (packEl) {
        packEl.classList.remove('purchasing');
        packEl.style.borderColor = 'var(--neon-green)';
        setTimeout(() => { packEl.style.borderColor = ''; }, 2000);
      }
    } catch (err) {
      alert(err.message);
      if (packEl) packEl.classList.remove('purchasing');
    }
  }

  // --- Leaderboard ---
  async function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    modal.style.display = 'flex';
    await loadLeaderboard('score');
  }

  async function loadLeaderboard(type) {
    const list = document.getElementById('leaderboard-list');
    try {
      const data = await app.api.getLeaderboard(type);
      list.innerHTML = data.leaderboard.map((entry, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${escapeHtml(entry.username)}</span>
          <span class="lb-value">${entry.value.toLocaleString()}</span>
        </div>
      `).join('') || '<p style="text-align:center;color:var(--text-secondary);padding:30px">No entries yet. Be the first!</p>';
    } catch {
      list.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:30px">Could not load leaderboard</p>';
    }
  }

  // --- Settings ---
  function loadSettings() {
    const saved = localStorage.getItem('vortex_settings');
    if (saved) {
      try { Object.assign(app.settings, JSON.parse(saved)); } catch {}
    }
    applySettingsUI();
  }

  function saveSettings() {
    localStorage.setItem('vortex_settings', JSON.stringify(app.settings));
  }

  function applySettingsUI() {
    const q = document.getElementById('setting-quality');
    const sfx = document.getElementById('setting-sfx');
    const music = document.getElementById('setting-music');
    const fps = document.getElementById('setting-fps');
    const minimap = document.getElementById('setting-minimap');
    if (q) q.value = app.settings.quality;
    if (sfx) sfx.value = app.settings.sfxVolume;
    if (music) music.value = app.settings.musicVolume;
    if (fps) fps.checked = app.settings.showFps;
    if (minimap) minimap.checked = app.settings.showMinimap;
  }

  function applyGameSettings() {
    if (app.renderer) app.renderer.setQuality(app.settings.quality);
    const fpsEl = document.getElementById('hud-fps');
    const minimapEl = document.getElementById('hud-minimap');
    if (fpsEl) fpsEl.style.display = app.settings.showFps ? 'block' : 'none';
    if (minimapEl) minimapEl.style.display = app.settings.showMinimap ? 'block' : 'none';
  }

  // --- Utility ---
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // --- Event Binding ---
  function bindEvents() {
    // Play button
    document.getElementById('btn-play').addEventListener('click', startGame);
    document.getElementById('username-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startGame();
    });

    // Auth
    document.getElementById('btn-login').addEventListener('click', () => showAuthModal('login'));
    document.getElementById('btn-register').addEventListener('click', () => showAuthModal('register'));
    document.getElementById('auth-close').addEventListener('click', () => document.getElementById('auth-modal').style.display = 'none');
    document.getElementById('auth-form').addEventListener('submit', handleAuth);
    document.getElementById('btn-logout').addEventListener('click', () => {
      app.api.clearToken();
      app.user = null;
      app.token = null;
      app.ownedSkins = ['default'];
      app.equippedSkin = 'default';
      updateMenuUser();
    });

    // Shop
    document.getElementById('btn-shop').addEventListener('click', openShop);
    document.getElementById('shop-close').addEventListener('click', () => document.getElementById('shop-modal').style.display = 'none');

    // Coin Shop
    document.getElementById('btn-coins').addEventListener('click', openCoinShop);
    document.getElementById('coins-close').addEventListener('click', () => document.getElementById('coins-modal').style.display = 'none');
    document.querySelectorAll('.coin-pack').forEach(pack => {
      pack.addEventListener('click', () => handleCoinPurchase(pack.dataset.pack));
    });

    // How to Play
    document.getElementById('btn-howto').addEventListener('click', openHowTo);
    document.getElementById('howto-close').addEventListener('click', () => document.getElementById('howto-modal').style.display = 'none');

    // Leaderboard
    document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
    document.getElementById('leaderboard-close').addEventListener('click', () => document.getElementById('leaderboard-modal').style.display = 'none');
    document.querySelectorAll('.tab-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadLeaderboard(tab.dataset.tab);
      });
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => document.getElementById('settings-modal').style.display = 'flex');
    document.getElementById('settings-close').addEventListener('click', () => document.getElementById('settings-modal').style.display = 'none');
    document.getElementById('setting-quality').addEventListener('change', (e) => {
      app.settings.quality = e.target.value;
      saveSettings();
      if (app.renderer) app.renderer.setQuality(app.settings.quality);
    });
    document.getElementById('setting-sfx').addEventListener('input', (e) => { app.settings.sfxVolume = parseInt(e.target.value); saveSettings(); });
    document.getElementById('setting-music').addEventListener('input', (e) => { app.settings.musicVolume = parseInt(e.target.value); saveSettings(); });
    document.getElementById('setting-fps').addEventListener('change', (e) => {
      app.settings.showFps = e.target.checked; saveSettings();
      const el = document.getElementById('hud-fps');
      if (el) el.style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('setting-minimap').addEventListener('change', (e) => {
      app.settings.showMinimap = e.target.checked; saveSettings();
      const el = document.getElementById('hud-minimap');
      if (el) el.style.display = e.target.checked ? 'block' : 'none';
    });

    // Death screen
    document.getElementById('btn-respawn')?.addEventListener('click', () => {
      document.getElementById('death-overlay').style.display = 'none';
      // Player auto-respawns server-side
    });
    document.getElementById('btn-menu')?.addEventListener('click', () => {
      document.getElementById('death-overlay').style.display = 'none';
      stopGame();
    });

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    });

    // Prevent context menu on game canvas
    document.addEventListener('contextmenu', (e) => {
      if (app.currentScreen === 'game') e.preventDefault();
    });
  }

  // --- Boot ---
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    init();
  });
})();
