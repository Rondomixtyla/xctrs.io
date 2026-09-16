const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', rooms: Object.keys(rooms).length });
});

// Room list
app.get('/rooms', (req, res) => {
    res.json(Object.keys(rooms).map(id => ({
        id,
        players: rooms[id].players.size,
        max: 8
    })));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = {}; // { roomId: { players: Map<ws, playerData> } }

wss.on('connection', (ws) => {
    let roomId = null;
    let playerId = null;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            switch (data.type) {
                case 'join':
                    roomId = data.room;
                    playerId = data.id;
                    if (!rooms[roomId]) rooms[roomId] = { players: new Map() };
                    if (rooms[roomId].players.size >= 8) {
                        ws.send(JSON.stringify({ type: 'error', msg: 'Room full' }));
                        return;
                    }
                    rooms[roomId].players.set(ws, {
                        id: playerId,
                        name: data.name,
                        x: 0, y: 0, hat: 0, health: 100
                    });
                    ws.send(JSON.stringify({ type: 'joined', room: roomId }));
                    broadcast(roomId, { type: 'player_join', id: playerId, name: data.name }, ws);
                    break;

                case 'sync':
                    if (!roomId) return;
                    const p = rooms[roomId]?.players.get(ws);
                    if (p) {
                        p.x = data.x;
                        p.y = data.y;
                        p.hat = data.hat;
                        p.health = data.health;
                    }
                    broadcast(roomId, {
                        type: 'sync',
                        id: playerId,
                        x: data.x,
                        y: data.y,
                        hat: data.hat,
                        health: data.health
                    }, ws);
                    break;

                case 'chat':
                    broadcast(roomId, {
                        type: 'chat',
                        id: playerId,
                        name: data.name,
                        msg: data.msg
                    });
                    break;
            }
        } catch (e) {
            console.error('Parse error:', e);
        }
    });

    ws.on('close', () => {
        if (roomId && rooms[roomId]) {
            rooms[roomId].players.delete(ws);
            broadcast(roomId, { type: 'player_leave', id: playerId });
            if (rooms[roomId].players.size === 0) delete rooms[roomId];
        }
    });
});

function broadcast(roomId, msg, except) {
    if (!rooms[roomId]) return;
    const str = JSON.stringify(msg);
    rooms[roomId].players.forEach((_, ws) => {
        if (ws !== except && ws.readyState === 1) ws.send(str);
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`SUNUCU ${PORT} PORTUNDA HAZIR`);
});