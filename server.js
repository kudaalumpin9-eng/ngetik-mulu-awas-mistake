const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const raceRooms = {};

const mockWordsPool = ["kecepatan", "sirkuit", "keyboard", "pemrograman", "balapan", "teknologi", "komputer", "internet", "modern", "gradasi", "neon", "kejuaraan", "juara", "akurat", "fokus", "mesin", "transmisi", "kecepatan", "racer", "dunia", "digital", "cyberpunk", "robot", "otomatis", "sistem", "kendaraan", "skateboard", "sepatu", "roda"];

function generateRoomWords(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
        arr.push(mockWordsPool[Math.floor(Math.random() * mockWordsPool.length)]);
    }
    return arr;
}

io.on('connection', (socket) => {
    console.log(`⚡ Racer Terhubung: ${socket.id}`);

    socket.on('createRoom', ({ playerName }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        raceRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            settings: { gameMode: 'words', wordTarget: 25, timeSelect: '60' },
            players: { 
                [socket.id]: { 
                    id: socket.id, 
                    name: playerName || "Host_Racer", 
                    carEmoji: "🚗", 
                    currentWpm: 0, 
                    progressPercent: 0, 
                    isFinished: false, 
                    isReady: true,
                    isSpectator: false 
                } 
            },
            textWords: generateRoomWords(25),
            results: []
        };
        socket.join(roomId);
        socket.emit('joinSuccess', { roomId, isHost: true });
        io.to(roomId).emit('roomData', raceRooms[roomId]);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = raceRooms[roomId];
        if (!room) return socket.emit('errorMsg', "❌ Kode Room tidak ditemukan, Bos!");
        
        room.players[socket.id] = { 
            id: socket.id, 
            name: playerName || "Guest_Racer", 
            carEmoji: "🏎️", 
            currentWpm: 0, 
            progressPercent: 0, 
            isFinished: false, 
            isReady: false,
            isSpectator: false
        };
        
        socket.join(roomId);
        socket.emit('joinSuccess', { roomId, isHost: false });
        socket.emit('settingsUpdated', room.settings);
        io.to(roomId).emit('roomData', room);
    });

    socket.on('changeVehicle', ({ roomId, emoji }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].carEmoji = emoji;
            io.to(roomId).emit('roomData', room);
        }
    });

    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.settings = settings;
            room.textWords = generateRoomWords(settings.wordTarget || 25);
            socket.to(roomId).emit('settingsUpdated', settings);
            io.to(roomId).emit('roomData', room);
        }
    });

    socket.on('toggleReady', ({ roomId, isReady }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isReady = isReady;
            io.to(roomId).emit('roomData', room);

            // Cek jika seluruh pemain aktif (bukan spectator) sudah klik READY
            const activePlayers = Object.values(room.players).filter(p => !p.isSpectator);
            const allReady = activePlayers.every(p => p.isReady);
            
            if (allReady && activePlayers.length > 0) {
                io.to(roomId).emit('startCountdown');
            }
        }
    });

    socket.on('toggleSpectator', ({ roomId, isSpectator }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isSpectator = isSpectator;
            
            if (isSpectator) {
                // Jika masuk mode spectator, otomatis buat statusnya ready & progress dikunci ke 0
                room.players[socket.id].isReady = true;
                room.players[socket.id].currentWpm = 0;
                room.players[socket.id].progressPercent = 0;
            } else {
                // Jika kembali bermain, reset ready status kecuali dia adalah Host
                if (socket.id !== room.hostId) {
                    room.players[socket.id].isReady = false;
                }
            }
            io.to(roomId).emit('roomData', room);

            // Cek ulang kondisi mulai otomatis setelah perpindahan mode menonton
            const activePlayers = Object.values(room.players).filter(p => !p.isSpectator);
            const allReady = activePlayers.every(p => p.isReady);
            if (allReady && activePlayers.length > 0) {
                io.to(roomId).emit('startCountdown');
            }
        }
    });

    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            // Mencegah penonton mengirimkan progress ilegal
            if (room.players[socket.id].isSpectator) return;

            room.players[socket.id].progressPercent = progressPercent;
            room.players[socket.id].currentWpm = currentWpm;
            
            if (progressPercent >= 100 && !room.players[socket.id].isFinished) {
                room.players[socket.id].isFinished = true;
                
                // Tambahkan ke papan klasemen hasil akhir
                const existence = room.results.find(r => r.id === socket.id);
                if (!existence) {
                    room.results.push({
                        id: socket.id,
                        name: room.players[socket.id].name,
                        emoji: room.players[socket.id].carEmoji,
                        wpm: currentWpm
                    });
                }
                io.to(roomId).emit('receiveFinalData', room.results);
            }
            io.to(roomId).emit('roomData', room);
        }
    });

    socket.on('requestReset', ({ roomId }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.results = [];
            room.textWords = generateRoomWords(room.settings.wordTarget || 25);
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
                // Spectator tetap dikondisikan siap, player biasa di-reset ke unready
                room.players[pId].isReady = room.players[pId].isSpectator ? true : (pId === room.hostId);
            });
            io.to(roomId).emit('performReset');
            io.to(roomId).emit('roomData', room);
        }
    });

    socket.on('sendChatMessage', ({ roomId, sender, text, senderId }) => {
        if (raceRooms[roomId]) {
            io.to(roomId).emit('incomingChatMessage', { sender, text, senderId });
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Racer Terputus: ${socket.id}`);
        Object.keys(raceRooms).forEach((roomId) => {
            const room = raceRooms[roomId];
            if (room && room.players[socket.id]) {
                delete room.players[socket.id];
                
                // Jika kamar kosong, hapus total room-nya dari memory server
                if (Object.keys(room.players).length === 0) {
                    delete raceRooms[roomId];
                } else {
                    // Jika host keluar, alihkan jabatan host ke player berikutnya yang aktif
                    if (room.hostId === socket.id) {
                        room.hostId = Object.keys(room.players)[0];
                        if (room.players[room.hostId]) {
                            room.players[room.hostId].isReady = true;
                        }
                    }
                    io.to(roomId).emit('roomData', room);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sirkuit Cyber Ready di http://localhost:${PORT}`);
});
