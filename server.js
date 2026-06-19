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

// Fallback routing untuk single page application
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const raceRooms = {};

io.on('connection', (socket) => {
    console.log('User terhubung:', socket.id);

    // 1. Join Room Handler
    socket.on('joinRoom', ({ roomId, name, emoji, isSpectator, mode }) => {
        const rId = roomId.toUpperCase();
        socket.join(rId);

        // Jika room belum ada, buat baru
        if (!raceRooms[rId]) {
            raceRooms[rId] = {
                id: rId,
                hostId: socket.id,
                players: {},
                results: [], // Hasil balapan persisten (tidak dihilangkan saat reset)
                activeRaceResults: null,
                gameStarted: false,
                gameMode: mode || 'race', // 'race' atau 'time'
                text: "Teknologi masa depan berkembang sangat cepat membawa perubahan besar dalam kehidupan digital siber modern."
            };
        }

        const room = raceRooms[rId];
        
        // Proteksi jika host kosong, serahkan ke yang baru masuk
        if (!room.hostId || !room.players[room.hostId]) {
            room.hostId = socket.id;
        }

        // Daftarkan data player
        room.players[socket.id] = {
            id: socket.id,
            name: name || 'Anonim',
            emoji: emoji || '🚗',
            isSpectator: !!isSpectator,
            isOnline: true,
            isReady: false,
            isFinished: false,
            progressPercent: 0,
            currentWpm: 0,
            isDeveloper: false
        };

        // Kirim data terupdate ke semua orang di room
        io.to(rId).emit('roomData', room);
        
        // Kirim papan skor terakhir agar penonton/pemain baru bisa langsung melihat hasil sebelumnya
        if (room.activeRaceResults) {
            socket.emit('receiveFinalData', room.activeRaceResults);
        } else if (room.results.length > 0) {
            socket.emit('receiveFinalData', room.results);
        }
    });

    // 2. Update Status Online/Offline
    socket.on('updateStatus', ({ roomId, status }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isOnline = status;
            io.to(rId).emit('roomData', room);
        }
    });

    // 3. Request Reset (Hasil pertandingan sebelumnya TIDAK dihilangkan)
    socket.on('requestReset', ({ roomId }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        
        // Hanya boleh dipicu oleh Host atau akun berstatus Developer
        if (room && (room.hostId === socket.id || room.players[socket.id]?.isDeveloper)) {
            room.gameStarted = false;
            
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
                if (!room.players[pId].isSpectator) room.players[pId].isReady = false; 
            });

            // Catatan: room.results & room.activeRaceResults sengaja TIDAK dihapus di sini
            // agar pemain tetap bisa melihat hasil balapan terakhir sampai balapan berikutnya selesai.
            io.to(rId).emit('roomReset', room);
            io.to(rId).emit('roomData', room);
        }
    });

    // 4. Start Race Game
    socket.on('startRace', ({ roomId, text, mode }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        
        if (room && (room.hostId === socket.id || room.players[socket.id]?.isDeveloper)) {
            room.gameStarted = true;
            if (text) room.text = text;
            if (mode) room.gameMode = mode;
            
            // Siapkan slot data balapan baru (skor lama masih tayang sampai ada yang finish baru)
            room.activeRaceResults = []; 
            
            io.to(rId).emit('raceStarted', { text: room.text, gameMode: room.gameMode });
        }
    });

    // 5. Submit Skor Akhir Balapan (Mengisi Leaderboard Persisten)
    socket.on('submitFinalData', ({ roomId, name, wpm, isPlayer, emoji }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room) {
            if (!room.activeRaceResults) {
                room.activeRaceResults = [];
            }
            
            // Filter agar tidak ada nama duplikat dalam list skor
            room.activeRaceResults = room.activeRaceResults.filter(r => r.name !== name);
            room.activeRaceResults.push({ name, wpm, isPlayer, emoji });
            room.activeRaceResults.sort((a, b) => b.wpm - a.wpm);
            
            // Timpa data hasil utama agar tersimpan persisten secara permanen di server lobi
            room.results = [...room.activeRaceResults];

            if (isPlayer && room.players[socket.id]) {
                room.players[socket.id].isFinished = true;
            }
            // Kirim papan skor terupdate ke seluruh client
            io.to(rId).emit('receiveFinalData', room.results); 
        }
    });

    // 6. Live Progress Tracking & Realtime WPM Update
    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progressPercent = progressPercent;
            room.players[socket.id].currentWpm = currentWpm;
            io.to(rId).emit('roomData', room);
        }
    });

    // 7. Sistem Chatting Kamar
    socket.on('sendChatMessage', ({ roomId, sender, text, senderId }) => {
        const rId = roomId.toUpperCase();
        if (raceRooms[rId]) {
            io.to(rId).emit('incomingChatMessage', { sender, text, senderId });
        }
    });

    // 8. Otoritas Otentikasi Mode Developer
    socket.on('authDeveloper', ({ roomId, username }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isDeveloper = true;
            room.players[socket.id].name = `[DEV] ${username}`;
            socket.emit('developerAuthed', { success: true });
            io.to(rId).emit('roomData', room);
        }
    });

    // 9. Aksi Developer: Kick Player / Kick Host
    socket.on('devKickPlayer', ({ roomId, targetPlayerId }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]?.isDeveloper) {
            if (room.players[targetPlayerId]) {
                io.to(targetPlayerId).emit('kickedFromRoom');
                delete room.players[targetPlayerId];
                
                // Jika developer men-kick host, jalankan serah terima host otomatis saat itu juga
                if (room.hostId === targetPlayerId) {
                    const remainingIds = Object.keys(room.players);
                    room.hostId = remainingIds.length > 0 ? remainingIds[0] : null;
                }
                io.to(rId).emit('roomData', room);
            }
        }
    });

    // 10. Aksi Developer: Ganti / Transfer Jabatan Host Paksa
    socket.on('devTransferHost', ({ roomId, newHostId }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]?.isDeveloper) {
            if (room.players[newHostId]) {
                room.hostId = newHostId;
                io.to(rId).emit('roomData', room);
            }
        }
    });

    // 11. Handle Disconnect & Serah Terima Host Otomatis ke Player Berikutnya
    socket.on('disconnect', () => {
        console.log('User terputus:', socket.id);
        Object.keys(raceRooms).forEach((rId) => {
            const room = raceRooms[rId];
            if (room && room.players[socket.id]) {
                delete room.players[socket.id];
                
                // JIKA HOST KELUAR -> Serahkan jabatan host secara otomatis pada player berikutnya
                if (room.hostId === socket.id) {
                    const nextPlayers = Object.keys(room.players);
                    if (nextPlayers.length > 0) {
                        room.hostId = nextPlayers[0];
                        console.log(`Host keluar! Jabatan dipindahkan di Room ${rId} ke Player ID: ${room.hostId}`);
                    } else {
                        room.hostId = null;
                    }
                }
                
                // Bersihkan kamar jika benar-benar kosong total
                const remainingCount = Object.keys(room.players).length;
                if (remainingCount === 0) {
                    delete raceRooms[rId];
                } else {
                    io.to(rId).emit('roomData', room);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Cyber Typing berjalan lancar di port ${PORT}`);
});
