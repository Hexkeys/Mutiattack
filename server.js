import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 10000;

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const makeRoom = () => ({
  players: new Map(),
  towers: new Map(),
  enemies: [],
  wave: 1,
  gold: 100,
  started: false,
  lastTick: Date.now()
});

function state(room) {
  return {
    players: [...room.players.values()],
    towers: [...room.towers.values()],
    enemies: room.enemies,
    wave: room.wave,
    gold: room.gold,
    started: room.started
  };
}

function broadcast(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit("state", state(room));
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId = "lobby", name = "Player" } = {}) => {
    if (socket.data.roomId) socket.leave(socket.data.roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, makeRoom());
    const room = rooms.get(roomId);
    socket.join(roomId);
    socket.data.roomId = roomId;
    room.players.set(socket.id, { id: socket.id, name: String(name).slice(0, 20), x: 0, y: 0 });
    socket.emit("joined", { roomId, id: socket.id });
    broadcast(roomId);
  });

  socket.on("playerMove", ({ x, y }) => {
    const room = rooms.get(socket.data.roomId);
    const player = room?.players.get(socket.id);
    if (!player) return;
    player.x = Number.isFinite(x) ? x : player.x;
    player.y = Number.isFinite(y) ? y : player.y;
    broadcast(socket.data.roomId);
  });

  socket.on("placeTower", ({ x, y, type = "basic" }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.gold < 25) return;
    room.gold -= 25;
    const id = crypto.randomUUID();
    room.towers.set(id, { id, owner: socket.id, x, y, type });
    broadcast(socket.data.roomId);
  });

  socket.on("startWave", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    room.started = true;
    broadcast(socket.data.roomId);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) rooms.delete(roomId);
    else broadcast(roomId);
  });
});

setInterval(() => {
  for (const [roomId, room] of rooms) {
    if (!room.started) continue;
    const now = Date.now();
    if (now - room.lastTick < 1000) continue;
    room.lastTick = now;
    if (room.enemies.length < room.wave * 3) {
      room.enemies.push({
        id: crypto.randomUUID(),
        x: 0,
        y: Math.random() * 400,
        hp: 100,
        speed: 35
      });
    }
    room.enemies = room.enemies
      .map(e => ({ ...e, x: e.x + e.speed }))
      .filter(e => e.x < 900);
    if (room.enemies.length === 0) {
      room.wave += 1;
      room.gold += 50;
    }
    broadcast(roomId);
  }
}, 100);

server.listen(PORT, () => console.log(`Mutiattack server listening on ${PORT}`));
