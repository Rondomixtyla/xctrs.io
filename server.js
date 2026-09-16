const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const players = new Map();
let nextId = 1;

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', players: players.size }));
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

wss.on('connection', (ws) => {
  const id = nextId++;
  players.set(id, {
    id, name: 'Oyuncu', x: 5000, y: 5000, angle: 0,
    health: 100, age: 0, ageScore: 0, color: 0,
    weapon: 'hammer', kills: 0, deaths: 0
  });
  console.log('[+] #' + id + ' (toplam: ' + players.size + ')');
  ws.send(JSON.stringify({ type: 'init', you: id, players: [...players.values()] }));
  broadcast({ type: 'join', player: players.get(id) }, id);

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const p = players.get(id);
    if (!p) return;
    if (msg.type === 'move') { p.x = msg.x; p.y = msg.y; p.angle = msg.angle; }
    else if (msg.type === 'stats') {
      p.age = msg.age; p.ageScore = msg.ageScore;
      p.weapon = msg.weapon; p.health = msg.health;
      p.kills = msg.kills; p.deaths = msg.deaths;
    }
    else if (msg.type === 'profile') {
      p.name = String(msg.name || 'Oyuncu').slice(0, 16);
      p.color = msg.color || 0;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
    console.log('[-] #' + id + ' (kalan: ' + players.size + ')');
  });
});

function broadcast(obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const [id, ws] of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && id !== exceptId) ws.send(data);
  }
}

setInterval(() => {
  const snapshot = [...players.values()];
  const leaderboard = snapshot.slice()
    .sort((a, b) => b.ageScore - a.ageScore).slice(0, 10)
    .map(p => ({ id: p.id, name: p.name, score: Math.floor(p.ageScore), age: Math.floor(p.age), color: p.color }));
  const packet = JSON.stringify({ type: 'state', players: snapshot, leaderboard });
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(packet);
}, 50);

httpServer.listen(PORT, () => console.log('SUNUCU ' + PORT + ' PORTUNDA HAZIR'));