const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MAP_SIZE = 4000;

const players = {};
const resources = [];
const structures = [];

// Haritaya kaynak türetme (Çalı, Ağaç, Taş, Altın)
for (let i = 0; i < 150; i++) {
    let type = 'tree';
    let rand = Math.random();
    if (rand < 0.3) type = 'bush';
    else if (rand < 0.65) type = 'tree';
    else if (rand < 0.85) type = 'stone';
    else type = 'gold';

    resources.push({
        id: 'res_' + i,
        x: Math.random() * (MAP_SIZE - 400) + 200,
        y: Math.random() * (MAP_SIZE - 400) + 200,
        type: type,
        radius: type === 'bush' ? 32 : (type === 'tree' ? 45 : 38),
        health: 100
    });
}

// Değirmen Altın Üretimi & Skor Katlanması
setInterval(() => {
    for (let id in players) {
        let p = players[id];
        if (!p.spawned) continue;
        let myWindmills = structures.filter(s => s.ownerId === id && s.type === 'windmill');
        p.resources.gold += myWindmills.length * 2;
        p.score += myWindmills.length * 5;
    }
}, 1000);

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        const name = (data && data.name && data.name.trim() !== '') ? data.name.trim() : 'Sploop.io#' + Math.floor(100 + Math.random() * 900);
        players[socket.id] = {
            id: socket.id,
            name: name,
            x: Math.random() * (MAP_SIZE - 400) + 200,
            y: Math.random() * (MAP_SIZE - 400) + 200,
            radius: 35,
            angle: 0,
            speed: 5.5,
            health: 100,
            maxHealth: 100,
            age: 0,
            xp: 0,
            score: 0,
            spawned: true,
            inputs: { up: false, down: false, left: false, right: false, moveAngle: null, isMoving: false },
            resources: { wood: 100, stone: 100, gold: 0, food: 100 },
            selectedSlot: 0,
            isAttacking: false
        };

        socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, resources, structures });
    });

    socket.on('playerInput', (data) => {
        const p = players[socket.id];
        if (!p || !p.spawned) return;
        p.inputs = data.inputs;
        p.angle = data.angle;
        if (data.selectedSlot !== undefined) p.selectedSlot = data.selectedSlot;
    });

    socket.on('quickHeal', () => {
        const p = players[socket.id];
        if (p && p.spawned && p.resources.food >= 10 && p.health < p.maxHealth) {
            p.resources.food -= 10;
            p.health = Math.min(p.maxHealth, p.health + 20);
        }
    });

    socket.on('attackAction', () => {
        const p = players[socket.id];
        if (!p || !p.spawned) return;

        p.isAttacking = true;
        setTimeout(() => { p.isAttacking = false; }, 150);

        if (p.selectedSlot === 0) {
            resources.forEach(res => {
                let dist = Math.hypot(res.x - p.x, res.y - p.y);
                if (dist < p.radius + res.radius + 30) {
                    res.health -= 25;
                    if (res.type === 'tree') { p.resources.wood += 15; p.score += 10; }
                    else if (res.type === 'stone') { p.resources.stone += 15; p.score += 15; }
                    else if (res.type === 'gold') { p.resources.gold += 10; p.score += 25; }
                    else if (res.type === 'bush') { p.resources.food += 15; p.score += 5; }

                    p.xp += 10;
                    if (p.xp >= 100) {
                        p.age += 1;
                        p.xp = 0;
                    }

                    if (res.health <= 0) {
                        res.x = Math.random() * (MAP_SIZE - 400) + 200;
                        res.y = Math.random() * (MAP_SIZE - 400) + 200;
                        res.health = 100;
                    }
                }
            });

            for (let id in players) {
                if (id !== socket.id && players[id].spawned) {
                    let target = players[id];
                    let dist = Math.hypot(target.x - p.x, target.y - p.y);
                    if (dist < p.radius + target.radius + 20) {
                        target.health -= 25;
                        p.score += 50;
                        if (target.health <= 0) {
                            p.score += 200;
                            target.health = target.maxHealth;
                            target.x = Math.random() * (MAP_SIZE - 400) + 200;
                            target.y = Math.random() * (MAP_SIZE - 400) + 200;
                        }
                    }
                }
            }
        } else if (p.selectedSlot === 1) {
            if (p.resources.food >= 10 && p.health < p.maxHealth) {
                p.resources.food -= 10;
                p.health = Math.min(p.maxHealth, p.health + 20);
            }
        } else if (p.selectedSlot >= 2) {
            const costs = [
                {}, {},
                { wood: 20 },
                { wood: 25, stone: 15 },
                { wood: 15, stone: 20 },
                { wood: 50, stone: 30 }
            ];
            const types = ['', '', 'wall', 'trap', 'spike', 'windmill'];
            const cost = costs[p.selectedSlot];
            const type = types[p.selectedSlot];

            let canAfford = true;
            for (let res in cost) {
                if (p.resources[res] < cost[res]) canAfford = false;
            }

            if (canAfford) {
                for (let res in cost) p.resources[res] -= cost[res];

                const placeX = p.x + Math.cos(p.angle) * 75;
                const placeY = p.y + Math.sin(p.angle) * 75;

                structures.push({
                    id: 'st_' + Math.random().toString(36).substr(2, 9),
                    ownerId: socket.id,
                    x: placeX,
                    y: placeY,
                    type: type,
                    radius: 30,
                    health: 150
                });
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

setInterval(() => {
    for (let id in players) {
        const p = players[id];
        if (!p.spawned) continue;
        let moveX = 0, moveY = 0;

        if (p.inputs.isMoving && p.inputs.moveAngle !== null) {
            moveX = Math.cos(p.inputs.moveAngle);
            moveY = Math.sin(p.inputs.moveAngle);
        } else {
            if (p.inputs.up) moveY -= 1;
            if (p.inputs.down) moveY += 1;
            if (p.inputs.left) moveX -= 1;
            if (p.inputs.right) moveX += 1;

            if (moveX !== 0 && moveY !== 0) {
                moveX *= Math.SQRT1_2;
                moveY *= Math.SQRT1_2;
            }
        }

        p.x = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.x + moveX * p.speed));
        p.y = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.y + moveY * p.speed));
    }

    // Skor Sıralaması (Leaderboard) Hazırla
    const leaderboard = Object.values(players)
        .filter(p => p.spawned)
        .map(p => ({ name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    io.emit('gameState', { players, resources, structures, leaderboard });
}, 1000 / 60);

server.listen(PORT, () => console.log(`Sploop Sunucu Aktif: http://localhost:${PORT}`));
