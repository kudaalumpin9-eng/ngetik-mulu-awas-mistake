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

// Fallback routing ke index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const raceRooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Join Room Handler
    socket.on('joinRoom', ({ roomId, name, emoji, isSpectator, mode }) => {
        const rId = roomId.toUpperCase();
        socket.join(rId);

        // Jika room belum ada di memory server, buat strukturnya
        if (!raceRooms[rId]) {
            raceRooms[rId] = {
                id: rId,
                hostId: socket.id,
                players: {},
                results: [], // Tempat penyimpanan hasil balapan persisten
                activeRaceResults: null,
                gameStarted: false,
                gameMode: mode || 'race', // 'race' atau 'time'
                text: "Teknologi masa depan berkembang sangat cepat membawa perubahan besar dalam kehidupan digital siber modern."
            };
        }

        const room = raceRooms[rId];
        
        // Proteksi jika host kosong, otomatis jadikan user ini sebagai host
        if (!room.hostId || !room.players[room.hostId]) {
            room.hostId = socket.id;
        }

        // Daftarkan data profile player ke objek room
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

        // Emit data room ke seluruh client di kamar tersebut
        io.to(rId).emit('roomData', room);
        
        // Kirim papan skor terakhir agar user yang baru masuk tetap bisa melihat hasil sebelumnya
        if (room.activeRaceResults && room.activeRaceResults.length > 0) {
            socket.emit('receiveFinalData', room.activeRaceResults);
        } else if (room.results && room.results.length > 0) {
            socket.emit('receiveFinalData', room.results);
        }
    });

    // 2. Update Status Online / Offline
    socket.on('updateStatus', ({ roomId, status }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isOnline = status;
            io.to(rId).emit('roomData', room);
        }
    });

    // 3. Request Reset Lintasan (Hasil pertandingan sebelumnya dipertahankan!)
    socket.on('requestReset', ({ roomId }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        
        // Validasi: Hanya bisa dipicu oleh Host resmi atau akun berstatus Developer
        if (room && (room.hostId === socket.id || room.players[socket.id]?.isDeveloper)) {
            room.gameStarted = false;
            
            Object.keys(room.players).forEach(pId => {
                room.players[pId].currentWpm = 0;
                room.players[pId].progressPercent = 0;
                room.players[pId].isFinished = false;
                if (!room.players[pId].isSpectator) room.players[pId].isReady = false; 
            });

            // Sesuai request: room.results dan room.activeRaceResults sengaja TIDAK dihapus
            // Supaya tampilan hasil balapan sebelumnya tidak hilang sampai balapan baru selesai.
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
            
            // Siapkan penampung hasil balapan yang baru
            room.activeRaceResults = []; 
            
            io.to(rId).emit('raceStarted', { text: room.text, gameMode: room.gameMode });
        }
    });

    // 5. Submit Hasil Skor Akhir Balapan
    socket.on('submitFinalData', ({ roomId, name, wpm, isPlayer, emoji }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room) {
            if (!room.activeRaceResults) {
                room.activeRaceResults = [];
            }
            
            // Bersihkan data lama dengan nama yang sama untuk mencegah duplikasi baris
            room.activeRaceResults = room.activeRaceResults.filter(r => r.name !== name);
            room.activeRaceResults.push({ name, wpm, isPlayer, emoji });
            room.activeRaceResults.sort((a, b) => b.wpm - a.wpm);
            
            // Simpan ke database lobi utama secara persisten
            room.results = [...room.activeRaceResults];

            if (isPlayer && room.players[socket.id]) {
                room.players[socket.id].isFinished = true;
            }
            
            // Broadcast hasil terupdate ke semua user
            io.to(rId).emit('receiveFinalData', room.results); 
        }
    });

    // 6. Live Progress Tracking & WPM Realtime
    socket.on('updateProgress', ({ roomId, progressPercent, currentWpm }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progressPercent = progressPercent;
            room.players[socket.id].currentWpm = currentWpm;
            io.to(rId).emit('roomData', room);
        }
    });

    // 7. Sistem Chatting Kamar Mabar
    socket.on('sendChatMessage', ({ roomId, sender, text, senderId }) => {
        const rId = roomId.toUpperCase();
        if (raceRooms[rId]) {
            io.to(rId).emit('incomingChatMessage', { sender, text, senderId });
        }
    });

    // 8. Otoritas Otentikasi Mode Developer Pencipta
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

    // 9. Aksi Khusus Developer: Kick Player / Kick Host
    socket.on('devKickPlayer', ({ roomId, targetPlayerId }) => {
        const rId = roomId.toUpperCase();
        const room = raceRooms[rId];
        if (room && room.players[socket.id]?.isDeveloper) {
            if (room.players[targetPlayerId]) {
                io.to(targetPlayerId).emit('kickedFromRoom');
                delete room.players[targetPlayerId];
                
                // Jika yang dikick kebetulan adalah host, pindahkan peran host secara instan
                if (room.hostId === targetPlayerId) {
                    const remainingIds = Object.keys(room.players);
                    room.hostId = remainingIds.length > 0 ? remainingIds[0] : null;
                }
                io.to(rId).emit('roomData', room);
            }
        }
    });

    // 10. Aksi Khusus Developer: Ganti / Transfer Jabatan Host
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

    // 11. Handle User Disconnect & Serah Terima Host Otomatis
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        Object.keys(raceRooms).forEach((rId) => {
            const room = raceRooms[rId];
            if (room && room.players[socket.id]) {
                delete room.players[socket.id];
                
                // JIKA HOST KELUAR -> Serahkan langsung secara otomatis ke player berikutnya
                if (room.hostId === socket.id) {
                    const nextPlayers = Object.keys(room.players);
                    if (nextPlayers.length > 0) {
                        room.hostId = nextPlayers[0];
                        console.log(`Host lama keluar. Host Kamar ${rId} dialihkan otomatis ke: ${room.hostId}`);
                    } else {
                        room.hostId = null;
                    }
                }
                
                // Jika kamar sudah kosong total tanpa sisa, bersihkan memory room
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
    console.log(`Server Cyber Typing v10 berjalan aktif di port ${PORT}`);
});
