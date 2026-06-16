const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static('public'));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`🎮 Player Terhubung: ${socket.id}`);

  // Buat Room
  socket.on('create-room', (roomId, playerName) => {
    if (!roomId || !playerName) return;
    socket.join(roomId);
    const roomData = {
      id: roomId,
      players: [{ id: socket.id, name: playerName, progress: 0 }],
      isStarted: false
    };
    rooms.set(roomId, roomData);
    socket.emit('room-created', roomData);
  });

  // Gabung Room
  socket.on('join-room', (roomId, playerName) => {
    if (!roomId || !playerName) return;
    const room = rooms.get(roomId);
    
    if (!room) return socket.emit('error-msg', 'Room tidak ditemukan!');
    if (room.isStarted) return socket.emit('error-msg', 'Balapan sudah dimulai!');
    if (room.players.length >= 4) return socket.emit('error-msg', 'Room penuh! Maksimal 4 orang.');

    room.players.push({ id: socket.id, name: playerName, progress: 0 });
    socket.join(roomId);
    io.to(roomId).emit('room-updated', room);
  });

  // Update Progress Ketikan
  socket.on('update-progress', (roomId, progress) => {
    const room = rooms.get(roomId);
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.progress = progress;
        socket.to(roomId).emit('progress-updated', { playerId: socket.id, progress });
        
        if (progress >= 100) {
          io.to(roomId).emit('player-finished', { playerId: socket.id, name: player.name });
        }
      }
    }
  });

  // Player Keluar / DC
  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      const room = rooms.get(roomId);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('room-updated', room);
          io.to(roomId).emit('player-left', socket.id);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sirkuit Online di Port ${PORT}`);
});
