const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const players = new Map();
let nextId = 1;
const TICK_MS = 50;
const MAX_PLAYERS = 50;
const RESPAWN_TIME = 3000;

// Saldırı yapan oyuncudan saldırılan oyuncuya hasar gönder
// Güvenlik: menzil + cooldown server tarafında da kontrol edilir
const WEAPONS = {
  hammer:{damage:25,range:80,cd:400},
  axe:{damage:30,range:85,cd:450},
  sword:{damage:35,range:90,cd:350},
  pickaxe:{damage:20,range:80,cd:500},
  spear:{damage:45,range:140,cd:700},
  katana:{damage:50,range:100,cd:300},
  greatsword:{damage:60,range:120,cd:800},
  scythe:{damage:70,range:110,cd:600},
  hammer_gold:{damage:40,range:90,cd:500},
};

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      players: players.size,
      uptime: process.uptime(),
      ts: Date.now()
    }));
  }
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const full = path.join(__dirname, 'public', file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(full);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

// KILL FEED (son 5 kill)
let killFeed = [];

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }
  const id = nextId++;
  const spawn = findSpawn();
  players.set(id, {
    id, name: 'Oyuncu', x: spawn.x, y: spawn.y, angle: 0,
    health: 100, maxHealth: 100, age: 0, ageScore: 0, color: 0,
    weapon: 'hammer', kills: 0, deaths: 0,
    lastAttack: 0, lastMove: Date.now(), lastStats: Date.now(),
    spawnX: spawn.x, spawnY: spawn.y
  });

  console.log(`[+] #${id} bağlandı (toplam: ${players.size})`);
  ws.send(JSON.stringify({
    type: 'init',
    you: id,
    players: [...players.values()],
    killFeed
  }));
  broadcast({ type: 'join', player: players.get(id) }, id);

  ws.on('message', (raw) => {
    if (raw.length > 2000) return; // spam koruması
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const p = players.get(id);
    if (!p) return;

    switch (msg.type) {
      case 'move': {
        // Konum doğrulama
        if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
        if (isNaN(msg.x) || isNaN(msg.y)) return;
        if (msg.x < 0 || msg.x > 10000 || msg.y < 0 || msg.y > 10000) return;
        // Son konumdan çok uzaklaşamaz (speedhack koruması)
        const maxDist = 50; // 50 birim / tick
        const d = Math.hypot(msg.x - p.x, msg.y - p.y);
        if (d > maxDist) {
          // Geri püskürt
          ws.send(JSON.stringify({ type: 'forcepos', x: p.x, y: p.y }));
          return;
        }
        p.x = msg.x; p.y = msg.y;
        if (typeof msg.angle === 'number') p.angle = msg.angle;
        p.lastMove = Date.now();
        break;
      }
      case 'stats':
        p.age = msg.age || 0;
        p.ageScore = msg.ageScore || 0;
        if (msg.weapon && WEAPONS[msg.weapon]) p.weapon = msg.weapon;
        p.health = Math.min(100, Math.max(0, msg.health || 100));
        p.kills = msg.kills || 0;
        p.deaths = msg.deaths || 0;
        p.lastStats = Date.now();
        break;
      case 'profile':
        p.name = String(msg.name || 'Oyuncu').slice(0, 16);
        p.color = Math.max(0, Math.min(7, msg.color || 0));
        break;
      case 'attack': {
        // Hedef ID'sini al ve doğrula
        const target = players.get(msg.target);
        if (!target) return;
        const now = Date.now();
        const w = WEAPONS[p.weapon] || WEAPONS.hammer;
        // Cooldown
        if (now - p.lastAttack < w.cd - 50) return;
        // Menzil
        const d = Math.hypot(target.x - p.x, target.y - p.y);
        if (d > w.range + 40) return;
        // Hedef ölü mü?
        if (target.health <= 0) return;
        // Hasar
        p.lastAttack = now;
        const dmg = w.damage;
        const wasAlive = target.health > 0;
        target.health -= dmg;
        // Saldırı paketi
        broadcast({
          type: 'attack',
          attacker: id,
          target: target.id,
          damage: dmg,
          weapon: p.weapon
        });
        // Ölüm kontrolü
        if (wasAlive && target.health <= 0) {
          target.health = 0;
          target.deaths++;
          p.kills++;
          // Kill feed
          killFeed.unshift({
            killer: p.name, killerId: id,
            victim: target.name, victimId: target.id,
            ts: now
          });
          killFeed = killFeed.slice(0, 5);
          broadcast({
            type: 'kill',
            killer: p.name, killerId: id,
            victim: target.name, victimId: target.id
          });
          // Ölen oyuncuyu yeniden doğur
          setTimeout(() => {
            const t = players.get(target.id);
            if (t) {
              const sp = findSpawn();
              t.x = sp.x; t.y = sp.y;
              t.health = t.maxHealth;
              t.age = 0; t.ageScore = Math.floor(t.ageScore * 0.5);
              t.weapon = 'hammer';
              broadcast({ type: 'respawn', id: t.id, x: t.x, y: t.y });
            }
          }, RESPAWN_TIME);
        }
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 60).trim();
        if (!text) return;
        // Basit spam koruması
        const now = Date.now();
        if (p.lastChat && now - p.lastChat < 1000) return;
        p.lastChat = now;
        broadcast({
          type: 'chat',
          id,
          name: p.name,
          text
        });
        break;
      }
      case 'respawn':
        p.spawnX = p.x; p.spawnY = p.y;
        broadcast({ type: 'spawnSet', id, x: p.x, y: p.y });
        break;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
    console.log(`[-] #${id} ayrıldı (kalan: ${players.size})`);
  });
});

function findSpawn() {
  // Haritanın ortasında rastgele spawn (5000, 5000 ± 1000)
  return {
    x: 4000 + Math.random() * 2000,
    y: 4000 + Math.random() * 2000
  };
}

function broadcast(obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const [id, ws] of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && id !== exceptId) ws.send(data);
  }
}

// Tick: her 50ms'de bir tüm state + leaderboard yolla
setInterval(() => {
  const now = Date.now();
  const snapshot = [...players.values()];
  const leaderboard = snapshot
    .slice()
    .sort((a, b) => b.ageScore - a.ageScore)
    .slice(0, 10)
    .map(p => ({
      id: p.id, name: p.name,
      score: Math.floor(p.ageScore), age: Math.floor(p.age), color: p.color,
      kills: p.kills, deaths: p.deaths
    }));
  const packet = JSON.stringify({
    type: 'state',
    players: snapshot,
    leaderboard
  });
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(packet);
  }
}, TICK_MS);

// Boşta kalan oyuncuları temizle
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) {
    if (now - p.lastMove > 60000) {
      const ws = [...wss.clients].find(c => c.id === id);
      if (ws) ws.close();
      players.delete(id);
      broadcast({ type: 'leave', id });
    }
  }
}, 30000);

httpServer.listen(PORT, () => console.log(`Sunucu ${PORT} portunda hazır - Sploop Online`));