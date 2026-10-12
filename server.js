const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true }));
const rooms = new Map();
const MAX_PLAYERS = 6;
const SPINS_PER_PLAYER = 3;
const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '🍉', '7️⃣'];
function cleanName(v) { return String(v || '').trim().slice(0, 16) || '玩家'; }
function state(room) {
  return { code: room.code, status: room.status,
    players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, team:p.team, spinsLeft:SPINS_PER_PLAYER-p.spins, spinsUsed:p.spins, connected:p.connected })),
    scores:room.scores, history:room.history.slice(-12), maxPlayers:MAX_PLAYERS, spinsPerPlayer:SPINS_PER_PLAYER };
}
function broadcast(room) { io.to(room.code).emit('state', state(room)); }
function newCode() { let c; do { c = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(c)); return c; }
function err(socket, msg) { socket.emit('gameError', msg); }
function attach(socket, room, name, team) {
  const p = { id:socket.id, name:cleanName(name), team:team === 'red' ? 'red' : 'blue', spins:0, connected:true };
  room.players.set(socket.id, p); socket.data.roomCode = room.code; socket.join(room.code); return p;
}
io.on('connection', socket => {
  socket.on('createRoom', ({name,team} = {}, cb) => {
    const room = { code:newCode(), status:'playing', players:new Map(), scores:{blue:0,red:0}, history:[] };
    rooms.set(room.code, room); attach(socket, room, name, team);
    if (typeof cb === 'function') cb({ok:true,code:room.code,playerId:socket.id}); broadcast(room);
  });
  socket.on('joinRoom', ({code,name,team} = {}, cb) => {
    code = String(code || '').trim().toUpperCase(); const room = rooms.get(code);
    if (!room) return typeof cb === 'function' ? cb({ok:false,error:'找不到房間，請確認房間碼。'}) : null;
    if (room.status !== 'playing') return typeof cb === 'function' ? cb({ok:false,error:'這場遊戲已結束。'}) : null;
    if (room.players.size >= MAX_PLAYERS) return typeof cb === 'function' ? cb({ok:false,error:'房間已滿，最多 6 位玩家。'}) : null;
    attach(socket, room, name, team);
    if (typeof cb === 'function') cb({ok:true,code:room.code,playerId:socket.id}); broadcast(room);
  });
  socket.on('spin', () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.status !== 'playing') return err(socket,'目前沒有進行中的遊戲。');
    const p = room.players.get(socket.id); if (!p) return err(socket,'找不到玩家資料，請重新加入房間。');
    if (room.players.size < MAX_PLAYERS) return err(socket,'請等 6 位玩家全部加入後再開始拉霸。');
    if (p.spins >= SPINS_PER_PLAYER) return err(socket,'你的拉霸次數已用完。');
    p.spins++;
    const reels = Array.from({length:3}, () => SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)]);
    let points = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) points = reels[0] === '7️⃣' ? 100 : 50;
    else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) points = 10;
    room.scores[p.team] += points;
    room.history.push({id:crypto.randomUUID(),playerName:p.name,team:p.team,reels,points,spinNumber:p.spins,at:Date.now()});
    if ([...room.players.values()].every(x => x.spins >= SPINS_PER_PLAYER)) room.status = 'finished';
    broadcast(room);
  });
  socket.on('resetGame', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    room.status='playing'; room.scores={blue:0,red:0}; room.history=[];
    for (const p of room.players.values()) p.spins=0; broadcast(room);
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const p = room.players.get(socket.id); if (p) { p.connected=false; broadcast(room); }
  });
});
server.listen(PORT,'0.0.0.0',() => console.log(`Party Slot listening on ${PORT}`));
