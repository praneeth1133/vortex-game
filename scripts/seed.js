#!/usr/bin/env node
/**
 * VORTEX Database Seeder
 * Run: npm run db:seed
 *
 * Seeds the database with sample data for development/demo
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../server/db');
const bcrypt = require('bcryptjs');

console.log('Seeding VORTEX database...\n');

// Create demo users
const users = [
  { username: 'CosmicKing', email: 'cosmic@demo.com', password: 'demo123' },
  { username: 'NebulaDancer', email: 'nebula@demo.com', password: 'demo123' },
  { username: 'StarEater99', email: 'star@demo.com', password: 'demo123' },
  { username: 'VoidWalker', email: 'void@demo.com', password: 'demo123' },
  { username: 'QuantumOrb', email: 'quantum@demo.com', password: 'demo123' },
  { username: 'SolarFlare_X', email: 'solar@demo.com', password: 'demo123' },
  { username: 'DarkMatter42', email: 'dark@demo.com', password: 'demo123' },
  { username: 'NovaHunter', email: 'nova@demo.com', password: 'demo123' },
];

let created = 0;
for (const u of users) {
  try {
    const hash = bcrypt.hashSync(u.password, 10);
    const user = db.createUser(u.username, u.email, hash);

    // Add random stats
    const score = Math.floor(Math.random() * 50000);
    const kills = Math.floor(Math.random() * 500);
    const games = Math.floor(Math.random() * 200) + 10;
    const coins = Math.floor(Math.random() * 5000);
    const xp = Math.floor(Math.random() * 20000);

    db.updatePlayerStats(user.id, kills, games * 120, score);
    db.addCoins(user.id, coins);

    // Record some fake sessions
    for (let i = 0; i < Math.min(games, 10); i++) {
      db.recordSession(
        user.id, u.username, 'main',
        Math.floor(Math.random() * 5000),
        Math.floor(Math.random() * 10),
        60 + Math.floor(Math.random() * 300),
        20 + Math.floor(Math.random() * 200)
      );
    }

    created++;
    console.log(`  Created: ${u.username} (coins: ${coins}, score: ${score})`);
  } catch (e) {
    console.log(`  Skipped: ${u.username} (already exists)`);
  }
}

db.forceSave();
console.log(`\nDone! Created ${created} users. Data saved.`);
console.log('All demo accounts use password: demo123\n');
