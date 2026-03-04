/* ========= VORTEX Admin Dashboard App ========= */
(function () {
  'use strict';

  const api = new API_Dashboard();
  let charts = {};
  let refreshInterval = null;
  let currentPage = 'overview';
  let playerPage = 1;

  // --- Lightweight API wrapper for dashboard ---
  function API_Dashboard() {
    this.token = null;
    this.request = async function (method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    };
  }

  // --- Login ---
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('admin-user').value;
    const pass = document.getElementById('admin-pass').value;
    const error = document.getElementById('login-error');
    try {
      const data = await api.request('POST', '/api/admin/login', { username: user, password: pass });
      api.token = data.token;
      sessionStorage.setItem('vortex_admin_token', data.token);
      showDashboard();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  // Check existing session
  const savedToken = sessionStorage.getItem('vortex_admin_token');
  if (savedToken) {
    api.token = savedToken;
    showDashboard();
  }

  function showDashboard() {
    document.getElementById('dash-login').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    loadOverview();
    refreshInterval = setInterval(loadCurrentPage, 10000);
  }

  // --- Navigation ---
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');
      currentPage = page;
      loadCurrentPage();
    });
  });

  document.getElementById('btn-refresh').addEventListener('click', loadCurrentPage);
  document.getElementById('btn-dash-logout').addEventListener('click', () => {
    sessionStorage.removeItem('vortex_admin_token');
    clearInterval(refreshInterval);
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('dash-login').style.display = 'flex';
  });

  function loadCurrentPage() {
    switch (currentPage) {
      case 'overview': loadOverview(); break;
      case 'players': loadPlayers(); break;
      case 'heatmap': loadHeatmap(); break;
      case 'revenue': loadRevenue(); break;
      case 'bots': loadBots(); break;
      case 'servers': loadServers(); break;
    }
  }

  // --- Overview ---
  async function loadOverview() {
    try {
      const [stats, activity] = await Promise.all([
        api.request('GET', '/api/admin/stats'),
        api.request('GET', '/api/admin/activity')
      ]);

      // KPIs
      document.getElementById('kpi-active-players').textContent = stats.activePlayers;
      document.getElementById('kpi-total-users').textContent = stats.totalUsers.toLocaleString();
      document.getElementById('kpi-new-today').textContent = '+' + stats.newUsersToday + ' today';
      document.getElementById('kpi-revenue').textContent = '$' + stats.totalRevenue.toFixed(2);
      document.getElementById('kpi-revenue-today').textContent = '$' + stats.revenueToday.toFixed(2) + ' today';
      document.getElementById('kpi-sessions').textContent = stats.totalSessions.toLocaleString();
      document.getElementById('kpi-sessions-today').textContent = stats.sessionsToday + ' today';

      // Health
      const uptime = formatUptime(stats.serverUptime);
      const heap = formatBytes(stats.memoryUsage.heapUsed);
      document.getElementById('health-uptime').textContent = uptime;
      document.getElementById('health-memory').textContent = heap;
      document.getElementById('health-rooms').textContent = stats.activeRooms;
      document.getElementById('health-connections').textContent = stats.totalConnectionsToday;

      // Rooms list
      const roomsEl = document.getElementById('rooms-list');
      roomsEl.innerHTML = stats.roomDetails.map(r => `
        <div class="room-row">
          <span class="room-id">${r.id.substring(0, 12)}</span>
          <span class="room-players">${r.players} players</span>
        </div>
      `).join('') || '<p style="color:var(--text-secondary);padding:20px;text-align:center">No active rooms</p>';

      // Activity chart
      renderActivityChart(activity.sessions);
      renderUsersChart(activity.users);
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  }

  function renderActivityChart(sessions) {
    const ctx = document.getElementById('chart-activity');
    if (charts.activity) charts.activity.destroy();
    charts.activity = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sessions.map(s => s.date.substring(5)),
        datasets: [{
          label: 'Sessions',
          data: sessions.map(s => s.sessions),
          borderColor: '#00fff2',
          backgroundColor: 'rgba(0, 255, 242, 0.05)',
          fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2
        }]
      },
      options: chartOptions('Sessions')
    });
  }

  function renderUsersChart(users) {
    const ctx = document.getElementById('chart-users');
    if (charts.users) charts.users.destroy();
    charts.users = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: users.map(u => u.date.substring(5)),
        datasets: [{
          label: 'New Users',
          data: users.map(u => u.new_users),
          backgroundColor: 'rgba(57, 255, 20, 0.3)',
          borderColor: '#39ff14',
          borderWidth: 1, borderRadius: 4
        }]
      },
      options: chartOptions('Users')
    });
  }

  // --- Players ---
  let searchTimeout;
  document.getElementById('player-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { playerPage = 1; loadPlayers(); }, 300);
  });

  async function loadPlayers() {
    const search = document.getElementById('player-search')?.value || '';
    try {
      const data = await api.request('GET', `/api/admin/users?page=${playerPage}&search=${encodeURIComponent(search)}`);
      document.getElementById('player-count').textContent = data.total + ' players';

      const tbody = document.getElementById('players-tbody');
      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td>${u.id}</td>
          <td style="color:var(--neon-cyan);font-weight:600">${escapeHtml(u.username)}</td>
          <td>Lv. ${Math.floor((u.xp || 0) / 1000) + 1}</td>
          <td style="color:var(--neon-yellow)">${u.coins}</td>
          <td>${u.games_played}</td>
          <td style="color:var(--neon-pink)">${u.highest_score.toLocaleString()}</td>
          <td>${u.total_kills}</td>
          <td><span class="status-badge ${u.banned ? 'status-banned' : 'status-active'}">${u.banned ? 'BANNED' : 'ACTIVE'}</span></td>
          <td style="font-size:12px;color:var(--text-secondary)">${u.created_at || '-'}</td>
        </tr>
      `).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:30px">No players found</td></tr>';

      // Pagination
      const pagEl = document.getElementById('players-pagination');
      pagEl.innerHTML = '';
      for (let p = 1; p <= data.totalPages; p++) {
        const btn = document.createElement('button');
        btn.textContent = p;
        if (p === data.page) btn.classList.add('active');
        btn.addEventListener('click', () => { playerPage = p; loadPlayers(); });
        pagEl.appendChild(btn);
      }
    } catch (err) {
      console.error('Failed to load players:', err);
    }
  }

  // --- Heatmap ---
  async function loadHeatmap() {
    try {
      const data = await api.request('GET', '/api/admin/heatmap');
      renderHeatmap(data.heatmap);
    } catch (err) {
      console.error('Failed to load heatmap:', err);
    }
  }

  function renderHeatmap(points) {
    const canvas = document.getElementById('heatmap-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Background
    ctx.fillStyle = '#0a0a2e';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(0, 255, 242, 0.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const pos = (i / 10) * w;
      ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(w, pos); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = 'rgba(255, 0, 80, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Heat points
    if (points && points.length > 0) {
      for (const p of points) {
        const x = p.x * w;
        const y = p.y * h;
        const r = Math.max(15, Math.sqrt(p.mass || 10) * 4);

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(255, 0, 80, 0.5)');
        grad.addColorStop(0.3, 'rgba(255, 100, 0, 0.3)');
        grad.addColorStop(0.6, 'rgba(255, 255, 0, 0.1)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Player dot
        ctx.fillStyle = '#00fff2';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '16px Rajdhani';
      ctx.textAlign = 'center';
      ctx.fillText('No active players. Heatmap updates in real-time.', w / 2, h / 2);
    }

    // Labels
    ctx.fillStyle = 'rgba(0, 255, 242, 0.4)';
    ctx.font = '10px Orbitron';
    ctx.textAlign = 'left';
    ctx.fillText('(0,0)', 6, 14);
    ctx.textAlign = 'right';
    ctx.fillText(`(${6000},${6000})`, w - 6, h - 6);
  }

  // --- Revenue ---
  async function loadRevenue() {
    try {
      const data = await api.request('GET', '/api/admin/revenue');
      document.getElementById('rev-total').textContent = '$' + (data.total || 0).toFixed(2);
      document.getElementById('rev-today').textContent = '$' + (data.today || 0).toFixed(2);

      const ctx = document.getElementById('chart-revenue');
      if (charts.revenue) charts.revenue.destroy();
      charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
          labels: (data.byDay || []).map(d => d.date.substring(5)),
          datasets: [{
            label: 'Revenue ($)',
            data: (data.byDay || []).map(d => d.revenue),
            borderColor: '#ffff00',
            backgroundColor: 'rgba(255, 255, 0, 0.05)',
            fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2
          }]
        },
        options: chartOptions('Revenue ($)')
      });
    } catch (err) {
      console.error('Failed to load revenue:', err);
    }
  }

  // --- Servers ---
  async function loadServers() {
    try {
      const stats = await api.request('GET', '/api/admin/stats');

      document.getElementById('srv-uptime').textContent = formatUptime(stats.serverUptime);
      document.getElementById('srv-heap').textContent = formatBytes(stats.memoryUsage.heapUsed);
      document.getElementById('srv-rss').textContent = formatBytes(stats.memoryUsage.rss);
      document.getElementById('srv-external').textContent = formatBytes(stats.memoryUsage.external);

      const roomsEl = document.getElementById('server-rooms');
      roomsEl.innerHTML = stats.roomDetails.map(r => `
        <div class="room-row">
          <div>
            <span class="room-id">${r.id}</span>
            <span style="color:var(--text-secondary);font-size:12px;margin-left:10px">Uptime: ${formatUptime(r.uptime)}</span>
          </div>
          <div>
            <span class="room-players">${r.players} players</span>
            <span style="color:var(--text-secondary);font-size:12px;margin-left:8px">${r.food} food</span>
          </div>
        </div>
      `).join('') || '<p style="color:var(--text-secondary);padding:20px;text-align:center">No active rooms</p>';
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
  }

  // --- Bots ---
  async function loadBots() {
    try {
      const data = await api.request('GET', '/api/admin/bots');
      document.getElementById('bot-total').textContent = data.total;
      document.getElementById('bot-easy').textContent = data.easy;
      document.getElementById('bot-medium').textContent = data.medium;
      document.getElementById('bot-hard').textContent = data.hard;
      document.getElementById('bot-expert').textContent = data.expert;

      const diffColors = { easy: '#39ff14', medium: '#ffff00', hard: '#ff6600', expert: '#ff0080' };
      const tbody = document.getElementById('bots-tbody');
      tbody.innerHTML = data.bots.map(b => `
        <tr>
          <td style="color:var(--neon-cyan);font-weight:600">${escapeHtml(b.name)}</td>
          <td><span style="color:${diffColors[b.difficulty]};font-weight:600;text-transform:uppercase">${b.difficulty}</span></td>
          <td style="text-transform:uppercase;font-size:12px;color:var(--text-secondary)">${b.state}</td>
          <td>${b.mass}</td>
          <td style="color:var(--neon-pink)">${b.score}</td>
          <td>${b.kills}</td>
          <td><span class="status-badge ${b.alive ? 'status-active' : 'status-banned'}">${b.alive ? 'ALIVE' : 'DEAD'}</span></td>
        </tr>
      `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:30px">No bots active</td></tr>';
    } catch (err) {
      console.error('Failed to load bots:', err);
    }
  }

  document.getElementById('btn-spawn-bots')?.addEventListener('click', async () => {
    const difficulty = document.getElementById('spawn-difficulty').value;
    const count = parseInt(document.getElementById('spawn-count').value);
    try {
      await api.request('POST', '/api/admin/bots/spawn', { roomId: 'main', count, difficulty });
      loadBots();
    } catch (err) { alert('Failed to spawn bots: ' + err.message); }
  });

  document.getElementById('btn-remove-bots')?.addEventListener('click', async () => {
    const difficulty = document.getElementById('remove-difficulty').value;
    const count = parseInt(document.getElementById('remove-count').value);
    try {
      await api.request('POST', '/api/admin/bots/remove', { roomId: 'main', count, difficulty });
      loadBots();
    } catch (err) { alert('Failed to remove bots: ' + err.message); }
  });

  document.getElementById('btn-remove-all-bots')?.addEventListener('click', async () => {
    if (!confirm('Remove ALL bots from all rooms?')) return;
    try {
      await api.request('POST', '/api/admin/bots/remove-all', {});
      loadBots();
    } catch (err) { alert('Failed: ' + err.message); }
  });

  // --- Chart Config ---
  function chartOptions(yLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,10,30,0.9)',
          borderColor: 'rgba(0,255,242,0.2)',
          borderWidth: 1,
          titleFont: { family: 'Orbitron', size: 11 },
          bodyFont: { family: 'Rajdhani', size: 13 }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#6a6a9a', font: { family: 'Rajdhani', size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#6a6a9a', font: { family: 'Rajdhani', size: 11 } },
          beginAtZero: true
        }
      }
    };
  }

  // --- Utilities ---
  function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${Math.floor(seconds % 60)}s`;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(1) + ' ' + units[i];
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();
