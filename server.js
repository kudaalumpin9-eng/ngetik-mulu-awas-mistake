const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Sajikan file statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Database temporary untuk menyimpan status kamar balapan
const raceRooms = {};

io.on('connection', (socket) => {
    console.log(`⚡ Racer Terhubung: ${socket.id}`);

    // 1. EVENT: BUAT KAMAR BARU
    socket.on('createRoom', ({ playerName }) => {
        // Generate kode room 4 digit acak (Contoh: AX7E)
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        raceRooms[roomId] = {
            id: roomId,
            hostId: socket.id,
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
        console.log(`🏠 Room ${roomId} berhasil dibuat oleh ${playerName}`);
    });

    // 2. EVENT: JOIN KAMAR YANG SUDAH ADA
    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = raceRooms[roomId];
        if (!room) {
            socket.emit('errorMsg', "❌ Kode Room tidak ditemukan, Bos!");
            return;
        }

        // Daftarkan player baru ke dalam room
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
        // Kirim setingan room yang sudah diatur host ke player yang baru join
        socket.emit('settingsUpdated', room.settings);
        io.to(roomId).emit('roomData', room);
        console.log(`🚗 ${playerName} bergabung ke Room ${roomId}`);
    });

    // 3. EVENT: UPDATE SETTINGAN GAME (Hanya bisa dipicu oleh Host)
    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.settings = settings;
            // Siarkan setingan baru ke semua player di dalam room tersebut
            socket.to(roomId).emit('settingsUpdated', settings);
        }
    });

    // 4. EVENT: UPDATE EMOTICON MOBIL KUSTOM
    socket.on('updateCar', ({ roomId, carEmoji }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].carEmoji = carEmoji;
            io.to(roomId).emit('roomData', room);
        }
    });

    // 5. EVENT: UPDATE ROLE (PLAYER / SPECTATOR)
    socket.on('updateRole', ({ roomId, isPlayer }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isPlayer = isPlayer;
            io.to(roomId).emit('roomData', room);
        }
    });

    // 6. EVENT: HOST MEMULAI BALAPAN (TRIGGER START)
    socket.on('triggerStart', ({ roomId, wordsList }) => {
        const room = raceRooms[roomId];
        if (room && room.hostId === socket.id) {
            room.results = []; // Reset papan skor turnamen lama
            // Perintahkan semua client di room untuk memulai sequence countdown bersamaan
            io.to(roomId).emit('gameCountdownStart', { wordsList });
        }
    });

    // 7. EVENT: UPDATE PROGRESS PERGERAKAN MOBIL LIVE
    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        const room = raceRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progressPercent = progressPercent;
            room.players[socket.id].currentWpm = currentWpm;
            // Kirim data koordinat terbaru ke seluruh player agar mobil terlihat maju di layar mereka
            io.to(roomId).emit('roomData', room);
        }
    });

    // 8. EVENT: SUBMIT DATA FINISH (DARI PLAYER & BOT HOST)
    socket.on('submitFinalData', ({ roomId, name, wpm, isPlayer }) => {
        const room = raceRooms[roomId];
        if (room) {
            // Cek biar nama yang sama ga masuk double ke database podium
            const sudahAda = room.results.some(r => r.name === name);
            if (!sudahAda) {
                room.results.push({ name, wpm, isPlayer });
                if (isPlayer && room.players[socket.id]) {
                    room.players[socket.id].isFinished = true;
                }
                // Siarkan papan skor ter-update ke semua peserta mabar
                io.to(roomId).emit('receiveFinalData', room.results);
            }
        }
    });

    // 9. EVENT: REFRESH ROOM REQUEST (Sinkronisasi Ulang UI)
    socket.on('refreshRoomRequest', ({ roomId }) => {
        const room = raceRooms[roomId];
        if (room) {
            io.to(roomId).emit('roomData', room);
        }
    });

    // 10. EVENT: RACER DISCONNECT / LEAVE
    socket.on('disconnect', () => {
        console.log(`🔌 Racer Terputus: ${socket.id}`);
        
        // Cari di room mana player tersebut berada, lalu hapus kodenya
        Object.keys(raceRooms).forEach((roomId) => {
            const room = raceRooms[roomId];
            if (room.players[socket.id]) {
                const leftPlayerName = room.players[socket.id].name;
                delete room.players[socket.id];
                
                // Jika room kosong melompong, hapus room dari memori server
                if (Object.keys(room.players).length === 0) {
                    delete raceRooms[roomId];
                    console.log(`🗑️ Room ${roomId} dihapus karena sudah kosong.`);
                } else {
                    // Jika yang keluar adalah Host, oper jabatan Host ke player lain yang tersisa
                    if (room.hostId === socket.id) {
                        const remainingPlayerIds = Object.keys(room.players);
                        room.hostId = remainingPlayerIds[0];
                        io.to(roomId).emit('hostChanged', room.hostId);
                        console.log(`👑 Host Room ${roomId} dialihkan ke Player Baru.`);
                    }
                    io.to(roomId).emit('roomData', room);
                    console.log(`🏃 ${leftPlayerName} keluar dari Room ${roomId}.`);
                }
            }
        });
    });
});

// Jalankan server di port 3000 (Atau port bawaan cloud Render)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sirkuit Balap Mengudara di Port *:${PORT}`);
});
