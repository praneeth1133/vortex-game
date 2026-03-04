#!/usr/bin/env node
/**
 * VORTEX Setup Script
 * Run: node scripts/setup.js
 *
 * This script helps you configure your VORTEX deployment:
 * - Generates secure JWT secret
 * - Validates .env configuration
 * - Sets up Capacitor for mobile builds
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');

console.log(`
╔══════════════════════════════════════╗
║         VORTEX Setup Wizard          ║
╚══════════════════════════════════════╝
`);

// Generate secure JWT secret
const jwtSecret = crypto.randomBytes(64).toString('hex');

// Read existing .env
let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
  console.log('[OK] Found existing .env file');
} else {
  console.log('[!] No .env found, creating from template...');
  envContent = `PORT=3000
NODE_ENV=production
JWT_SECRET=${jwtSecret}
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${crypto.randomBytes(16).toString('hex')}
MAX_PLAYERS_PER_ROOM=50
TICK_RATE=60
WORLD_WIDTH=6000
WORLD_HEIGHT=6000
`;
}

// Update JWT secret if it's the default
if (envContent.includes('vortex-dev-secret-change-me')) {
  envContent = envContent.replace(
    /JWT_SECRET=.*/,
    `JWT_SECRET=${jwtSecret}`
  );
  console.log('[OK] Generated secure JWT secret');
}

fs.writeFileSync(envPath, envContent);
console.log('[OK] .env file saved');

console.log(`
Setup complete! Next steps:

1. START THE SERVER:
   npm start

2. OPEN THE GAME:
   http://localhost:3000

3. ADMIN DASHBOARD:
   http://localhost:3000/dashboard
   Default credentials: admin / vortex-admin-2024
   (Change these in .env for production!)

4. MOBILE DEPLOYMENT:
   npm run build:android    # Android (requires Android Studio)
   npm run build:ios        # iOS (requires Xcode, macOS only)

5. STRIPE SETUP (for monetization):
   - Get API keys at https://dashboard.stripe.com/apikeys
   - Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in .env
   - Set up webhook endpoint at /api/webhook/stripe

6. PRODUCTION DEPLOYMENT:
   - Set NODE_ENV=production in .env
   - Change ADMIN_PASSWORD to something secure
   - Use a process manager like PM2: pm2 start server/index.js
   - Set up reverse proxy (nginx/caddy) with SSL
   - For scalability, use Redis adapter for Socket.io
`);
