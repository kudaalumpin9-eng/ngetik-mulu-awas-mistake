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
    socket.on('updateStatus', ({ roomId, status }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isOnline = status;
            io.to(roomId).emit('roomData', room);
        }
    });

    socket.on('requestReset', ({ roomId }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.results = [];
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
            });
            io.to(roomId).emit('performReset'); 
            io.to(roomId).emit('roomData', room); 
            io.to(roomId).emit('receiveFinalData', []); 
        }
    });

    // LISTENER EVENT BARU: AKSI RESET DARURAT DI TENGAH MATCH OLEH HOST
    socket.on('abortMatchMidWay', ({ roomId }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.results = [];
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
            });
            io.to(roomId).emit('forceResetMatch');
            io.to(roomId).emit('performReset');
            io.to(roomId).emit('roomData', room);
        }
    });

    console.log(`⚡ Racer Terhubung: ${socket.id}`);

    socket.on('createRoom', ({ playerName }) => {
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        raceRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
            isTableOpen: true, 
            settings: { gameMode: 'words', wordTarget: 25, timeSelect: '60', lineView: '2', difficulty: 'easy', punctuation: true },
            players: { [socket.id]: { id: socket.id, name: playerName || "Host_Racer", carEmoji: "🚗", currentWpm: 0, progressPercent: 0, isFinished: false } },
            results: []
        };
        socket.join(roomId);
        socket.emit('joinSuccess', { roomId, isHost: true });
        io.to(roomId).emit('roomData', raceRooms[roomId]);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = raceRooms[roomId];
        if (!room) return socket.emit('errorMsg', "❌ Kode Room tidak ditemukan, Bos!");
        
        room.players[socket.id] = { id: socket.id, name: playerName || "Guest_Racer", carEmoji: "🏎️", currentWpm: 0, progressPercent: 0, isFinished: false };
        socket.join(roomId);
        socket.emit('joinSuccess', { roomId, isHost: false });
        socket.emit('settingsUpdated', room.settings);
        socket.emit('tablePanelToggled', { isOpen: room.isTableOpen });
        io.to(roomId).emit('roomData', room);
    });

    socket.on('kickPlayerAction', ({ roomId, targetId }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            if (room.players[targetId]) {
                delete room.players[targetId];
                io.to(targetId).emit('kickedMsg', "🔒 Lo telah dikeluarkan (Kick) dari sikit balap oleh Host!");
                io.to(roomId).emit('roomData', room);
            }
        }
    });

    socket.on('toggleTablePanel', ({ roomId, isOpen }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.isTableOpen = isOpen; 
            socket.to(roomId).emit('tablePanelToggled', { isOpen: isOpen }); 
        }
    });

    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.settings = settings;
            socket.to(roomId).emit('settingsUpdated', settings);
        }
    });

    socket.on('updateCar', ({ roomId, carEmoji }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].carEmoji = carEmoji;
            io.to(roomId).emit('roomData', room);
        }
    });

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

    socket.on('submitFinalData', ({ roomId, name, wpm, isPlayer, emoji }) => {
        const room = raceRooms[roomId];
        if (room) {
            room.results = room.results.filter(r => r.name !== name);
            room.results.push({ name, wpm, isPlayer, emoji });
            if (isPlayer && room.players[socket.id]) room.players[socket.id].isFinished = true;
            room.results.sort((a, b) => b.wpm - a.wpm);
            io.to(roomId).emit('receiveFinalData', room.results); 
        }
    });

    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progressPercent = progressPercent;
            room.players[socket.id].currentWpm = currentWpm;
            io.to(roomId).emit('roomData', room);
        }
    });

    socket.on('sendChatMessage', ({ roomId, sender, text, senderId }) => {
        if (raceRooms[roomId]) {
            io.to(roomId).emit('incomingChatMessage', { sender, text, senderId });
        }
    });

    socket.on('disconnect', () => {
        Object.keys(raceRooms).forEach((roomId) => {
            const room = raceRooms[roomId];
            if (room && room.players[socket.id]) {
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) delete raceRooms[roomId];
                else io.to(roomId).emit('roomData', room);
            }
        });
    });
});

server.listen(3000, () => console.log(`🚀 Sirkuit Balap di Port *:3000`));
