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

io.on('connection', (socket) => {
    console.log(`⚡ Racer Terhubung: ${socket.id}`);

    // 1. MEMBUAT ROOM BARU
    socket.on('createRoom', ({ playerName }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        raceRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            isTableOpen: true,
            settings: {
                gameMode: 'words',
                wordTarget: 25,
                timeSelect: '60',
                difficulty: 'easy',
                rowsSelect: '2',
                punctuation: true
            },
            players: {
                [socket.id]: { 
                    id: socket.id, 
                    name: playerName || "Host_Racer", 
                    carEmoji: "🚗", 
                    isPlayer: true, 
                    currentWpm: 0, 
                    progressPercent: 0, 
                    isFinished: false 
                }
            },
            results: []
        };
        socket.join(roomId);
        socket.emit('joinSuccess', { roomId, isHost: true });
        io.to(roomId).emit('roomData', raceRooms[roomId]);
    });

    // 2. JOIN KE ROOM YANG SUDAH ADA
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = raceRooms[roomId];
        if (!room) {
            socket.emit('errorMsg', "❌ Kode Room tidak ditemukan, Bos!");
            return;
        }
        
        // carEmoji diset default awal, nanti akan di-sync via updateCar dari frontend
        room.players[socket.id] = { 
            id: socket.id, 
            name: playerName || "Guest_Racer", 
            carEmoji: "🏎️", 
            isPlayer: true, 
            currentWpm: 0, 
            progressPercent: 0, 
            isFinished: false 
        };
        
        socket.join(roomId);
        socket.emit('joinSuccess', { roomId, isHost: false });
        socket.emit('settingsUpdated', room.settings);
        socket.emit('tablePanelToggled', { isOpen: room.isTableOpen });
        io.to(roomId).emit('roomData', room);
        
        if (room.results.length > 0) {
            socket.emit('receiveFinalData', room.results);
        }
    });

    // 3. KICK PLAYER (HANYA UNTUK HOST)
    socket.on('kickPlayer', ({ roomId, targetPlayerId }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id && room.players[targetPlayerId]) {
            const kickedSocket = io.sockets.sockets.get(targetPlayerId);
            if (kickedSocket) {
                kickedSocket.emit('kickedMsg', "❌ Lo udah ditendang sama Host dari kamar balap!");
                kickedSocket.leave(roomId);
            }
            delete room.players[targetPlayerId]; 
            io.to(roomId).emit('roomData', room); 
        }
    });

    // 4. TOGGLE BUKA/TUTUP PANEL PENGATURAN
    socket.on('toggleTablePanel', ({ roomId, isOpen }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.isTableOpen = isOpen;
            socket.to(roomId).emit('tablePanelToggled', { isOpen });
        }
    });

    // 5. UPDATE SETTINGS GAME (MODE, KATA, DLL)
    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.settings = settings;
            socket.to(roomId).emit('settingsUpdated', settings);
        }
    });

    // 6. UPDATE KUSTOMISASI MOBIL PLAYER
    socket.on('updateCar', ({ roomId, carEmoji }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].carEmoji = carEmoji;
            io.to(roomId).emit('roomData', room);
        }
    });

    // 7. START GAME COUNTDOWN
    socket.on('triggerStart', ({ roomId, wordsList }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.results = [];
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
            });
            io.to(roomId).emit('gameCountdownStart', { wordsList });
            io.to(roomId).emit('receiveFinalData', []); 
        }
    });

    // 8. REPLAY MATCH
    socket.on('requestMatchReplay', ({ roomId }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.results = [];
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
            });
            io.to(roomId).emit('forceResetMatch');
            io.to(roomId).emit('roomData', room);
            io.to(roomId).emit('receiveFinalData', []); 
        }
    });

    // 9. EVENT LIVE CHAT (FIXED: SEKARANG WIRE EMIT SENDER ID UNTUK BUBBLE ANIMATION)
    socket.on('sendChatMessage', ({ roomId, sender, text }) => {
        const room = raceRooms[roomId];
        if (room) {
            // Kita parsing socket.id sebagai senderId agar UI tau mobil mana yang memunculkan bubble
            io.to(roomId).emit('incomingChatMessage', { sender, text, senderId: socket.id });
        }
    });

    // 10. LIVE UPDATE PROGRESS TRACK & WPM
    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progressPercent = progressPercent;
            room.players[socket.id].currentWpm = currentWpm;
            io.to(roomId).emit('roomData', room);
        }
    });

    // 11. SUBMIT DATA SELESAI BALAPAN (MASUK PODIUM)
    socket.on('submitFinalData', ({ roomId, name, wpm, isPlayer, emoji }) => {
        const room = raceRooms[roomId];
        if (room) {
            const sudahAda = room.results.some(r => r.name === name);
            if (!sudahAda) {
                room.results.push({ name, wpm, isPlayer, emoji });
                if (isPlayer && room.players[socket.id]) room.players[socket.id].isFinished = true;
                
                room.results.sort((a, b) => b.wpm - a.wpm);
                io.to(roomId).emit('receiveFinalData', room.results);
            }
        }
    });

    // 12. DISCONNECT HANDLING
    socket.on('disconnect', () => {
        Object.keys(raceRooms).forEach((roomId) => {
            const room = raceRooms[roomId];
            if (room && room.players[socket.id]) {
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) {
                    delete raceRooms[roomId];
                } else {
                    if (room.hostId === socket.id) {
                        room.hostId = Object.keys(room.players)[0];
                        io.to(roomId).emit('hostChanged', room.hostId);
                    }
                    io.to(roomId).emit('roomData', room);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sirkuit Balap di Port *:${PORT}`));
