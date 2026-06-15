const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    
    // 1. Logika Pembuatan Room oleh Host
    socket.on('createRoom', ({ playerName }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            gameStarted: false,
            settings: { gameMode: 'words', wordTarget: 25, difficulty: 'easy', rowsSelect: '2', punctuation: true },
            players: {},
            results: [] // Menyimpan urutan finish pembalap secara adil
        };
        joinPlayer(socket, roomId, playerName);
    });

    // 2. Logika Guest Masuk ke Room
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const idUpper = roomId.toUpperCase();
        if (!rooms[idUpper]) {
            socket.emit('errorMsg', 'Kode Room tidak ditemukan, Bos!');
            return;
        }
        if (rooms[idUpper].gameStarted) {
            socket.emit('errorMsg', 'Waduh, balapan di room ini sudah dimulai!');
            return;
        }
        joinPlayer(socket, idUpper, playerName);
    });

    // 3. Sinkronisasi Pengaturan Room dari Host ke Guest
    socket.on('updateSettings', ({ roomId, settings }) => {
        if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
            rooms[roomId].settings = settings;
            socket.to(roomId).emit('settingsUpdated', settings);
        }
    });

    // 4. Menerima Progress Koordinat Mobil secara Realtime
    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            const p = rooms[roomId].players[socket.id];
            p.progressPercent = progressPercent;
            p.currentWpm = currentWpm;
            // Kirim pembaruan data sirkuit ke seluruh pemain di dalam room
            io.to(roomId).emit('roomData', rooms[roomId]);
        }
    });

    // 5. Host Memicu Lampu Countdown Balapan Dimulai
    socket.on('triggerStart', ({ roomId, wordsList }) => {
        if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
            rooms[roomId].gameStarted = true;
            rooms[roomId].results = []; // Reset papan skor sirkuit
            
            // Set semua progress pemain ke 0% sebelum start
            Object.keys(rooms[roomId].players).forEach(pId => {
                rooms[roomId].players[pId].progressPercent = 0;
                rooms[roomId].players[pId].currentWpm = 0;
                rooms[roomId].players[pId].isFinished = false;
            });

            io.to(roomId).emit('gameCountdownStart', { wordsList });
        }
    });

    // 6. Pencatatan Urutan Finish Pembalap di Server
    socket.on('submitFinalData', ({ roomId, name, wpm, isPlayer }) => {
        if (rooms[roomId]) {
            const exists = rooms[roomId].results.some(r => r.name === name);
            if (!exists) {
                rooms[roomId].results.push({ name, wpm, isPlayer });
            }
            // Distribusikan hasil peringkat balapan ke podium masing-masing client
            io.to(roomId).emit('receiveFinalData', rooms[roomId].results);
        }
    });

    // Handle Pembalap DC / Keluar dari Balapan
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                
                // Jika host keluar, alihkan jabatan host ke player berikutnya
                if (rooms[roomId].hostId === socket.id) {
                    const remaining = Object.keys(rooms[roomId].players);
                    if (remaining.length > 0) {
                        rooms[roomId].hostId = remaining[0];
                        io.to(roomId).emit('hostChanged', rooms[roomId].hostId);
                    } else {
                        delete rooms[roomId];
                        continue;
                    }
                }
                io.to(roomId).emit('roomData', rooms[roomId]);
            }
        }
    });
});

function joinPlayer(socket, roomId, playerName) {
    socket.join(roomId);
    rooms[roomId].players[socket.id] = {
        id: socket.id,
        name: playerName || 'Guest Racer',
        progressPercent: 0,
        currentWpm: 0,
        isFinished: false,
        carEmoji: '🚗'
    };
    socket.emit('joinSuccess', { roomId, isHost: rooms[roomId].hostId === socket.id });
    io.to(roomId).emit('roomData', rooms[roomId]);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sirkuit Online Aktif di Port ${PORT}`);
});