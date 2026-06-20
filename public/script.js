// --- LOGIC UTAMA GAME & SOCKET NETWORK ---
const socket = (typeof io !== 'undefined') ? io() : null;

// Parameter default balapan
let currentOnlineRoomId = null;
let clientUniqueSocketId = null;
let isCurrentPlayerHost = false;
let gameModeType = "words"; 
let isSinglePlayerMode = false;

let wordsList = [];
let currentWordIndex = 0;
let totalTypedCharacters = 0;
let totalTypingErrors = 0;
let totalCorrectWords = 0;
let raceStartTime = null;
let gameActive = false;
let gameTimerInterval = null;

let selectedCarEmoji = "🚗";
let myNickname = "dimas";
let playersRaceStateMap = {};
let urlRoomCode = null;

// Bot config untuk offline mode
let botActiveOpponents = [];
let botSimulationIntervals = [];

// Drag chat panel system variables
let isChatPanelDragging = false;
let chatDragStartX, chatDragStartY;
let chatPanelOffsetX = 0, chatPanelOffsetY = 0;

function checkDeveloperToken() {
    return localStorage.getItem('race_dev_token') === 'v10_secret_access';
}

function triggerDeveloperAuthPrompt() {
    const pin = prompt("Masukkan PIN Keamanan Developer:");
    if(pin === "1604") {
        localStorage.setItem('race_dev_token', 'v10_secret_access');
        alert("Akses Developer Diaktifkan!");
        if(document.getElementById('developer-exclusive-panel')) {
            document.getElementById('developer-exclusive-panel').style.display = 'block';
        }
    } else {
        alert("PIN Salah!");
    }
}

// Jaringan Socket.io Handlers (Hanya jalan kalau online)
if(socket) {
    socket.on('connect', () => {
        clientUniqueSocketId = socket.id;
        if(urlRoomCode) {
            // Biarkan popup sharelink mengaturnya
        }
    });

    socket.on('room_created', (data) => {
        currentOnlineRoomId = data.roomId;
        isCurrentPlayerHost = true;
        document.getElementById('lobby-panel').style.display = 'none';
        document.getElementById('main-arena').style.display = 'block';
        document.getElementById('room-id-badge').style.display = 'block';
        document.getElementById('room-code-txt').innerText = currentOnlineRoomId;
        document.getElementById('bot-management-row').style.display = 'none';
        
        applyUIRoleState();
        sendClientIdentityPayload();
    });

    socket.on('room_joined_success', (data) => {
        currentOnlineRoomId = data.roomId;
        isCurrentPlayerHost = false;
        document.getElementById('lobby-panel').style.display = 'none';
        document.getElementById('sharelink-join-modal').classList.remove('active');
        document.getElementById('main-arena').style.display = 'block';
        document.getElementById('room-id-badge').style.display = 'block';
        document.getElementById('room-code-txt').innerText = currentOnlineRoomId;
        document.getElementById('bot-management-row').style.display = 'none';
        
        applyUIRoleState();
        sendClientIdentityPayload();
    });

    socket.on('room_error', (msg) => {
        alert("Gagal masuk kamar: " + msg);
        window.location.href = window.location.origin;
    });

    socket.on('sync_players', (playersList) => {
        playersRaceStateMap = {};
        playersList.forEach(p => {
            playersRaceStateMap[p.id] = p;
            if(p.id === clientUniqueSocketId) {
                isCurrentPlayerHost = p.isHost;
            }
        });
        applyUIRoleState();
        renderRaceTracks();
        updateLivePodiumUI();
    });

    socket.on('update_settings', (settings) => {
        if(!isCurrentPlayerHost) {
            document.getElementById('game-mode').value = settings.mode;
            document.getElementById('time-select').value = settings.duration;
            document.getElementById('word-target-input').value = settings.wordTarget;
            document.getElementById('line-view-select').value = settings.lineView;
            document.getElementById('difficulty-select').value = settings.difficulty;
            document.getElementById('punctuation-toggle').checked = settings.punctuation;
            document.getElementById('capitalize-toggle').checked = settings.capitalize;
            toggleModeSettings();
        }
    });

    socket.on('chat_broadcast', (data) => {
        appendChatMessageNode(data.sender, data.text, data.isSelf, data.car);
    });

    socket.on('countdown_trigger', (data) => {
        wordsList = data.words;
        runVisualCountdownSequence(() => {
            triggerActualRaceStart();
        });
    });

    socket.on('race_progress_broadcast', (data) => {
        if(playersRaceStateMap[data.playerId]) {
            playersRaceStateMap[data.playerId].progress = data.progress;
            playersRaceStateMap[data.playerId].wpm = data.wpm;
            playersRaceStateMap[data.playerId].latestWord = data.latestWord;
            playersRaceStateMap[data.playerId].isFinished = data.isFinished;
            playersRaceStateMap[data.playerId].finishTime = data.finishTime;
        }
        updateCarNodePositionOnTrack(data.playerId, data.progress, data.latestWord);
        updateLivePodiumUI();
    });

    socket.on('game_over_broadcast', (leaderboard) => {
        showTournamentResultsModal(leaderboard);
    });

    socket.on('host_changed_alert', (newHostId) => {
        if(clientUniqueSocketId === newHostId) {
            isCurrentPlayerHost = true;
            alert("Host utama keluar, sekarang lo adalah Pemimpin Kamar Balap! 👑");
        }
        applyUIRoleState();
    });

    socket.on('force_kicked_disconnect', () => {
        alert("Lo telah ditendang dari kamar balap oleh admin/host! 💀");
        window.location.reload();
    });
}

function sendClientIdentityPayload() {
    if(isSinglePlayerMode || !socket) return;
    socket.emit('register_identity', {
        nickname: myNickname,
        car: selectedCarEmoji
    });
}

function broadcastSettings() {
    if(!isCurrentPlayerHost || isSinglePlayerMode || !socket) return;
    socket.emit('modify_settings', {
        mode: document.getElementById('game-mode').value,
        duration: document.getElementById('time-select').value,
        wordTarget: document.getElementById('word-target-input').value,
        lineView: document.getElementById('line-view-select').value,
        difficulty: document.getElementById('difficulty-select').value,
        punctuation: document.getElementById('punctuation-toggle').checked,
        capitalize: document.getElementById('capitalize-toggle').checked
    });
}

function applyUIRoleState() {
    const btn = document.getElementById('ready-start-btn');
    const roleBadge = document.getElementById('role-text');
    
    if(checkDeveloperToken()) {
        document.getElementById('developer-exclusive-panel').style.display = 'block';
    }

    if(isSinglePlayerMode) {
        roleBadge.innerText = "SINGLEPLAYER MASTER";
        roleBadge.className = "role-badge role-join";
        btn.innerText = "MULAI BALAPAN 🏁";
        return;
    }

    if(isCurrentPlayerHost) {
        roleBadge.innerText = "PEMIMPIN SIRKUIT (HOST) 👑";
        roleBadge.className = "role-badge role-join";
        
        let anyoneNotReady = false;
        if(playersRaceStateMap) {
            Object.values(playersRaceStateMap).forEach(p => {
                if(!p.isHost && !p.isReady && !p.isSpectator) anyoneNotReady = true;
            });
        }
        
        if(anyoneNotReady) {
            btn.innerText = "START GAME 🏎️";
            btn.className = "btn btn-primary";
        } else {
            btn.innerText = "MULAI BALAPAN NOW! 🚀";
            btn.className = "btn btn-success";
        }
    } else {
        roleBadge.innerText = "RACING DRIVER 🏎️";
        roleBadge.className = "role-badge role-join";
        
        const me = playersRaceStateMap[clientUniqueSocketId];
        if(me && me.isSpectator) {
            roleBadge.innerText = "PENONTON (SPECTATOR) 👁️";
            btn.innerText = "SAYA MAU IKUT BALAPAN 🏎️";
            btn.className = "btn btn-primary";
        } else if(me && me.isReady) {
            btn.innerText = "SAYA SUDAH SIAP (READY) ✓";
            btn.className = "btn btn-secondary";
        } else {
            btn.innerText = "SIAP BALAPAN (READY) 🏁";
            btn.className = "btn btn-success";
        }
    }
}

function toggleModeSettings() {
    const mode = document.getElementById('game-mode').value;
    document.getElementById('row-duration').style.display = (mode === 'time') ? 'table-row' : 'none';
    document.getElementById('row-word-count').style.display = (mode === 'words') ? 'table-row' : 'none';
}

function createNewOnlineRoom() {
    const nick = document.getElementById('nickname-input').value.trim();
    if(!nick) return alert("Nickname gak boleh kosong!");
    myNickname = nick;
    isSinglePlayerMode = false;
    if(socket) socket.emit('create_room');
}

function joinOnlineRoom() {
    const nick = document.getElementById('nickname-input').value.trim();
    const code = document.getElementById('roomcode-input').value.trim().toUpperCase();
    if(!nick || !code) return alert("Isi Nickname dan Kode Room!");
    myNickname = nick;
    isSinglePlayerMode = false;
    if(socket) socket.emit('join_room', code);
}

function startSinglePlayerMode() {
    const nick = document.getElementById('nickname-input').value.trim();
    if(!nick) return alert("Isi Nickname lo!");
    myNickname = nick;
    isSinglePlayerMode = true;
    
    document.getElementById('lobby-panel').style.display = 'none';
    document.getElementById('main-arena').style.display = 'block';
    document.getElementById('room-id-badge').style.display = 'none';
    document.getElementById('bot-management-row').style.display = 'table-row';
    
    playersRaceStateMap = {};
    playersRaceStateMap['player_local'] = {
        id: 'player_local', nickname: myNickname, car: selectedCarEmoji, progress: 0, wpm: 0, isHost: true, isReady: true, isSpectator: false
    };
    
    botActiveOpponents = [
        { id: 'bot_1', nickname: "🤖 Kimi Raikkonen (Bot)", car: "🏎️", speedWpm: 50, progress: 0, wpm: 0, isBot: true },
        { id: 'bot_2', nickname: "🤖 Lewis Hamilton (Bot)", car: "🚓", speedWpm: 65, progress: 0, wpm: 0, isBot: true }
    ];
    
    applyUIRoleState();
    renderRaceTracks();
    updateLivePodiumUI();
}

function addBot() {
    if(!isSinglePlayerMode) return;
    const botCarOptions = ["🏎️","🚀","🛸","🚗","🚓","🛹"];
    const botNamesOptions = ["Max Verstappen", "Charles Leclerc", "Lando Norris", "Michael Schumacher", "Ayrton Senna", "Bot Kilat", "Kimi Mati Rasa"];
    const randomCar = botCarOptions[Math.floor(Math.random() * botCarOptions.length)];
    const randomName = botNamesOptions[Math.floor(Math.random() * botNamesOptions.length)];
    const botWpm = Math.floor(Math.random() * (85 - 40 + 1)) + 40;
    const botId = "bot_" + Date.now() + "_" + Math.floor(Math.random()*100);
    
    botActiveOpponents.push({
        id: botId, nickname: "🤖 " + randomName + " (Bot)", car: randomCar, speedWpm: botWpm, progress: 0, wpm: 0, isBot: true
    });
    renderRaceTracks();
}

function removeBot() {
    if(!isSinglePlayerMode || botActiveOpponents.length === 0) return;
    botActiveOpponents.pop();
    renderRaceTracks();
}

function renderRaceTracks() {
    const arena = document.getElementById('track-lanes-arena');
    const parkingLot = document.getElementById('spectator-cars-parking-lot');
    arena.innerHTML = "";
    parkingLot.innerHTML = "";
    
    let hasSpectators = false;
    let combinedPlayersArray = [...Object.values(playersRaceStateMap)];
    if(isSinglePlayerMode) {
        combinedPlayersArray = [...combinedPlayersArray, ...botActiveOpponents];
    }
    
    combinedPlayersArray.forEach(p => {
        if(p.isSpectator) {
            hasSpectators = true;
            const node = document.createElement('div');
            node.className = "spectator-car-node";
            node.innerHTML = `${p.car} <span>${p.nickname}</span>`;
            parkingLot.appendChild(node);
            return;
        }

        const lane = document.createElement('div');
        lane.className = "track-lane";
        lane.id = "lane-target-" + p.id;
        
        let hostCrown = p.isHost ? "👑 " : "";
        let readyStatusIndicator = "";
        if(!isSinglePlayerMode) {
            readyStatusIndicator = p.isReady ? `<span class="ready-badge badge-is-ready">READY</span>` : `<span class="ready-badge badge-not-ready">UNREADY</span>`;
            if(p.isHost) readyStatusIndicator = ""; 
        }
        
        let adminKickActionBtn = "";
        if(isCurrentPlayerHost && p.id !== clientUniqueSocketId && !p.isBot) {
            adminKickActionBtn = `<button class="kick-btn" onclick="kickPlayerFromCircuit('${p.id}')" title="Tendang Player Dari Sirkuit">💀 KICK</button>`;
        }
        
        lane.innerHTML = `
            <div class="lane-info">
                <span>${hostCrown}<strong>${p.nickname}</strong>${readyStatusIndicator}${adminKickActionBtn}</span>
                <span class="wpm-counter">WPM: <span id="wpm-txt-id-${p.id}">${p.wpm || 0}</span></span>
            </div>
            <div class="car-node-wrapper" id="wrapper-car-id-${p.id}" style="left: ${p.progress || 0}%;">
                <div class="car-bubble" id="bubble-car-id-${p.id}">Yo, Balapan Dimulai!</div>
                <div class="car">${p.car || '🚗'}</div>
            </div>
            <div style="font-size:1.8rem; color: #334155; font-weight:bold;">🏁</div>
        `;
        arena.appendChild(lane);
    });
    
    if(!hasSpectators) {
        parkingLot.innerHTML = `<em style="color: #475569; font-size: 0.8rem;">Tidak ada penonton di sirkuit saat ini...</em>`;
    }
}

function kickPlayerFromCircuit(targetId) {
    if(!isCurrentPlayerHost || !socket) return;
    if(confirm("Apakah lo yakin ingin menendang player ini dari sirkuit balap?")) {
        socket.emit('admin_kick_player', targetId);
    }
}

function updateCarNodePositionOnTrack(id, progress, msg) {
    const wrapper = document.getElementById(`wrapper-car-id-${id}`);
    if(wrapper) {
        wrapper.style.left = `calc(${progress}% - 50px)`;
        if(progress < 5) wrapper.style.left = "0%";
        if(progress >= 100) wrapper.style.left = "calc(100% - 90px)";
    }
    const wpmTxt = document.getElementById(`wpm-txt-id-${id}`);
    if(wpmTxt && playersRaceStateMap[id]) {
        wpmTxt.innerText = Math.round(playersRaceStateMap[id].wpm || 0);
    }
    
    if(msg) {
        const bubble = document.getElementById(`bubble-car-id-${id}`);
        if(bubble) {
            bubble.innerText = msg;
            bubble.classList.add('active');
            clearTimeout(bubble.timeoutTracker);
            bubble.timeoutTracker = setTimeout(() => {
                bubble.classList.remove('active');
            }, 2500);
        }
    }
}

function updateLivePodiumUI() {
    let allRacers = [];
    if(isSinglePlayerMode) {
        allRacers = [playersRaceStateMap['player_local'], ...botActiveOpponents];
    } else {
        allRacers = Object.values(playersRaceStateMap).filter(p => !p.isSpectator);
    }

    allRacers.sort((a,b) => {
        if(a.isFinished && b.isFinished) return a.finishTime - b.finishTime;
        if(a.isFinished) return -1;
        if(b.isFinished) return 1;
        return b.progress - a.progress;
    });

    for(let rank = 1; rank <= 3; rank++) {
        const p = allRacers[rank-1];
        const metaNode = document.getElementById(`podium-${rank}-meta`);
        const carNode = document.getElementById(`podium-${rank}-car`);
        
        if(p) {
            let info = `${p.nickname}\n${Math.round(p.wpm || 0)} WPM`;
            if(p.progress >= 100 || p.isFinished) info += `\n(FINISH!)`;
            else info += `\n(${Math.round(p.progress || 0)}%)`;
            
            metaNode.innerText = info;
            carNode.innerText = p.car;
        } else {
            metaNode.innerText = "Menunggu...";
            carNode.innerText = "🏁";
        }
    }
}

function readyOrStartClickAction() {
    if(isSinglePlayerMode) {
        if(gameActive) return;
        requestSinglePlayerWordsList();
        return;
    }
    
    if(!socket) return;
    const me = playersRaceStateMap[clientUniqueSocketId];
    if(me && me.isSpectator) {
        socket.emit('change_to_player_role');
        return;
    }

    if(isCurrentPlayerHost) {
        let anyoneNotReady = false;
        Object.values(playersRaceStateMap).forEach(p => {
            if(!p.isHost && !p.isReady && !p.isSpectator) anyoneNotReady = true;
        });
        
        if(anyoneNotReady) {
            const forceStart = confirm("Beberapa driver belum siap balapan. Paksa mulai balapan sekarang, Bos?");
            if(!forceStart) return;
        }
        socket.emit('host_request_start');
    } else {
        socket.emit('toggle_ready');
    }
}

function requestSinglePlayerWordsList() {
    const diff = document.getElementById('difficulty-select').value;
    const punc = document.getElementById('punctuation-toggle').checked;
    const cap = document.getElementById('capitalize-toggle').checked;
    const targetCount = parseInt(document.getElementById('word-target-input').value) || 25;
    
    const easyPool = ["saya", "kamu", "dia", "mereka", "kita", "bisa", "ngetik", "balapan", "sirkuit", "mobil", "cepat", "kecepatan", "juara", "waktu", "kata", "detik", "menit", "fokus", "belajar", "coding", "game", "keyboard", "jari", "latihan", "hebat", "mantap", "gas", "rem", "tikungan", "lurus"];
    const hardPool = ["implementasi", "sinkronisasi", "asinkron", "konfigurasi", "infrastruktur", "karakteristik", "transformasi", "spesifikasi", "dokumentasi", "optimalisasi", "fleksibilitas", "aksesibilitas", "akuntabilitas", "profesionalisme", "interoperabilitas", "kriptografi", "algoritma", "restrukturisasi"];
    const symbolPool = ["!","@","#","$","%","^","&","*","(",")","_","+","=","{","}","[","]",";",":","?",".",","];
    
    let basePool = (diff === 'hard') ? hardPool : easyPool;
    let generated = [];
    
    for(let i=0; i < targetCount; i++) {
        let w = basePool[Math.floor(Math.random() * basePool.length)];
        if(cap && Math.random() > 0.5) {
            w = w.charAt(0).toUpperCase() + w.slice(1);
        }
        if(punc && Math.random() > 0.7) {
            w += symbolPool[Math.floor(Math.random() * symbolPool.length)];
        }
        generated.push(w);
    }
    
    wordsList = generated;
    runVisualCountdownSequence(() => {
        triggerActualRaceStart();
    });
}

function runVisualCountdownSequence(callback) {
    const box = document.getElementById('countdown-widget-box');
    const lights = [document.getElementById('light-r'), document.getElementById('light-y'), document.getElementById('light-g')];
    const numTxt = document.getElementById('countdown-number-txt');
    
    box.style.display = 'flex';
    lights.forEach(l => l.className = "light");
    
    let step = 3;
    numTxt.innerText = step;
    lights[0].classList.add('light-red-active');
    
    let interval = setInterval(() => {
        step--;
        if(step === 2) {
            numTxt.innerText = step;
            lights[1].classList.add('light-yellow-active');
        } else if(step === 1) {
            numTxt.innerText = step;
            lights[2].classList.add('light-green-active');
        } else {
            clearInterval(interval);
            box.style.display = 'none';
            callback();
        }
    }, 1000);
}

function triggerActualRaceStart() {
    gameActive = true;
    currentWordIndex = 0;
    totalTypedCharacters = 0;
    totalTypingErrors = 0;
    totalCorrectWords = 0;
    raceStartTime = Date.now();
    
    if(isSinglePlayerMode) {
        playersRaceStateMap['player_local'].progress = 0;
        playersRaceStateMap['player_local'].wpm = 0;
        playersRaceStateMap['player_local'].isFinished = false;
        botActiveOpponents.forEach(b => {
            b.progress = 0; b.wpm = 0; b.isFinished = false;
        });
    } else {
        if(playersRaceStateMap && playersRaceStateMap[clientUniqueSocketId]) {
            playersRaceStateMap[clientUniqueSocketId].progress = 0;
            playersRaceStateMap[clientUniqueSocketId].wpm = 0;
            playersRaceStateMap[clientUniqueSocketId].isFinished = false;
        }
    }
    
    renderRaceTracks();
    renderWords();
    
    const inp = document.getElementById('input-box');
    inp.disabled = false;
    inp.value = "";
    inp.className = "";
    inp.focus();
    
    gameModeType = document.getElementById('game-mode').value;
    if(gameModeType === 'time') {
        let timeLeft = parseInt(document.getElementById('time-select').value) || 60;
        document.getElementById('live-timer-banner').style.display = 'block';
        document.getElementById('live-seconds-countdown').innerText = timeLeft;
        
        gameTimerInterval = setInterval(() => {
            timeLeft--;
            document.getElementById('live-seconds-countdown').innerText = timeLeft;
            calculateLiveWpmStats();
            
            if(isSinglePlayerMode) simulateOfflineBotProgressStep();
            
            if(timeLeft <= 0) {
                endRaceSequence();
            }
        }, 1000);
    } else {
        document.getElementById('live-timer-banner').style.display = 'none';
        gameTimerInterval = setInterval(() => {
            calculateLiveWpmStats();
            if(isSinglePlayerMode) simulateOfflineBotProgressStep();
        }, 1000);
    }
    
    document.getElementById('ready-start-btn').disabled = true;
    document.getElementById('ready-start-btn').innerText = "RACING NOW!! 🔥";
}

function renderWords() {
    const wrapper = document.getElementById('words-wrapper');
    wrapper.innerHTML = "";
    
    const viewOpt = document.getElementById('line-view-select').value;
    
    let lineContainer = document.createElement('div');
    lineContainer.style.whiteSpace = "normal";
    lineContainer.style.display = "block";
    
    wordsList.forEach((wordStr, index) => {
        const span = document.createElement('span');
        span.className = "word";
        if(index === currentWordIndex) span.classList.add('current');
        span.id = "word-idx-" + index;
        
        for(let i=0; i<wordStr.length; i++) {
            const charSpan = document.createElement('span');
            charSpan.className = "letter";
            charSpan.innerText = wordStr[i];
            span.appendChild(charSpan);
        }
        
        lineContainer.appendChild(span);
    });
    
    wrapper.appendChild(lineContainer);
    adjustWordsScrollPosition();
}

function handleInputProcess() {
    if(!gameActive) return;
    const inp = document.getElementById('input-box');
    const currentWordStr = wordsList[currentWordIndex];
    let typedVal = inp.value;
    
    const currentWordSpan = document.getElementById("word-idx-" + currentWordIndex);
    if(currentWordSpan) {
        currentWordSpan.className = "word current";
        const letters = currentWordSpan.getElementsByClassName('letter');
        
        for(let i=0; i < letters.length; i++) {
            letters[i].className = "letter";
        }
        
        let localErrorDetected = false;
        for(let i=0; i < typedVal.length; i++) {
            if(i >= currentWordStr.length) {
                localErrorDetected = true;
                break;
            }
            if(typedVal[i] === currentWordStr[i]) {
                // Betul
            } else {
                if(letters[i]) letters[i].classList.add('char-wrong');
                localErrorDetected = true;
            }
        }
        
        if(localErrorDetected) {
            inp.classList.add('input-error');
            currentWordSpan.classList.add('error');
            if(typedVal.endsWith(' ')) {
                // Getar layar kalau salah spasi
                triggerScreenShakeEffect();
            }
        } else {
            inp.classList.remove('input-error');
        }
    }
    
    if(typedVal.endsWith(' ')) {
        const coreValue = typedVal.slice(0, -1);
        if(coreValue.length > 0) {
            processCompletedWord(coreValue);
        } else {
            inp.value = "";
        }
    }
}

function triggerScreenShakeEffect() {
    const card = document.getElementById('race-track-card');
    card.classList.add('shake-active');
    setTimeout(() => card.classList.remove('shake-active'), 150);
}

function processCompletedWord(typedWord) {
    const targetWord = wordsList[currentWordIndex];
    const span = document.getElementById("word-idx-" + currentWordIndex);
    
    let isCorrect = (typedWord === targetWord);
    if(isCorrect) {
        if(span) span.className = "word completed";
        totalTypedCharacters += targetWord.length + 1;
        totalCorrectWords++;
    } else {
        if(span) span.className = "word completed-wrong";
        totalTypingErrors++;
    }
    
    currentWordIndex++;
    
    let progressPercentage = (currentWordIndex / wordsList.length) * 100;
    if(progressPercentage > 100) progressPercentage = 100;
    
    let currentLiveWpm = calculateLiveWpmStats();
    
    if(isSinglePlayerMode) {
        playersRaceStateMap['player_local'].progress = progressPercentage;
        playersRaceStateMap['player_local'].wpm = currentLiveWpm;
        if(currentWordIndex >= wordsList.length) {
            playersRaceStateMap['player_local'].isFinished = true;
            playersRaceStateMap['player_local'].finishTime = Date.now() - raceStartTime;
        }
        updateCarNodePositionOnTrack('player_local', progressPercentage, typedWord);
        updateLivePodiumUI();
        
        let allFinished = true;
        if(!playersRaceStateMap['player_local'].isFinished) allFinished = false;
        botActiveOpponents.forEach(b => { if(!b.isFinished) allFinished = false; });
        if(allFinished || gameModeType === 'words' && playersRaceStateMap['player_local'].isFinished) {
            endRaceSequence();
        }
    } else {
        if(socket) {
            socket.emit('race_progress_update', {
                progress: progressPercentage,
                wpm: currentLiveWpm,
                latestWord: typedWord,
                isFinished: (currentWordIndex >= wordsList.length),
                finishTime: Date.now() - raceStartTime
            });
        }
    }
    
    if(currentWordIndex < wordsList.length) {
        document.getElementById('input-box').value = "";
        renderWords();
    } else {
        document.getElementById('input-box').value = "";
        document.getElementById('input-box').disabled = true;
        if(!isSinglePlayerMode && gameModeType === 'words') {
            // Kamar mabar beres otomatis di-handle server
        }
    }
}

function calculateLiveWpmStats() {
    const elapsedMinutes = (Date.now() - raceStartTime) / 60000;
    if(elapsedMinutes <= 0) return 0;
    
    let calculatedWpm = (totalTypedCharacters / 5) / elapsedMinutes;
    if(calculatedWpm < 0 || !calculatedWpm) calculatedWpm = 0;
    
    if(isSinglePlayerMode) {
        playersRaceStateMap['player_local'].wpm = calculatedWpm;
        const txt = document.getElementById('wpm-txt-id-player_local');
        if(txt) txt.innerText = Math.round(calculatedWpm);
    } else {
        const txt = document.getElementById(`wpm-txt-id-${clientUniqueSocketId}`);
        if(txt) txt.innerText = Math.round(calculatedWpm);
    }
    return calculatedWpm;
}

function adjustWordsScrollPosition() {
    const currentSpan = document.getElementById("word-idx-" + currentWordIndex);
    if(!currentSpan) return;
    const wrapper = document.getElementById('text-display-box');
    
    const viewOpt = document.getElementById('line-view-select').value;
    if(viewOpt === 'all') {
        wrapper.style.maxHeight = "none";
        wrapper.style.overflow = "visible";
        return;
    }
    
    wrapper.style.maxHeight = "130px";
    wrapper.style.overflow = "hidden";
    
    const spanTop = currentSpan.offsetTop;
    const spanHeight = currentSpan.offsetHeight;
    const containerHeight = wrapper.clientHeight;
    
    const idealScrollTop = spanTop - (containerHeight / 2) + (spanHeight / 2);
    document.getElementById('words-wrapper').style.transform = `translateY(${-idealScrollTop}px)`;
    document.getElementById('words-wrapper').style.transition = "transform 0.2s ease";
}

function simulateOfflineBotProgressStep() {
    const elapsedSeconds = (Date.now() - raceStartTime) / 1000;
    botActiveOpponents.forEach(bot => {
        if(bot.isFinished) return;
        
        let expectedTotalWords = (bot.speedWpm / 60) * elapsedSeconds;
        let botProgress = (expectedTotalWords / wordsList.length) * 100;
        
        if(botProgress >= 100) {
            botProgress = 100;
            bot.isFinished = true;
            bot.finishTime = Date.now() - raceStartTime;
        }
        
        bot.progress = botProgress;
        bot.wpm = bot.speedWpm + (Math.sin(elapsedSeconds) * 3); 
        
        let pseudoWordsArr = ["Vroom!","Laju!","Gaspol","Ngebut","BotLari","Ggwp"];
        let randomWordStr = pseudoWordsArr[Math.floor(Math.random()*pseudoWordsArr.length)];
        
        updateCarNodePositionOnTrack(bot.id, botProgress, randomWordStr);
    });
    updateLivePodiumUI();
}

function endRaceSequence() {
    gameActive = false;
    clearInterval(gameTimerInterval);
    document.getElementById('input-box').disabled = true;
    
    if(isSinglePlayerMode) {
        let finalStandings = [playersRaceStateMap['player_local'], ...botActiveOpponents];
        finalStandings.sort((a,b) => {
            if(a.isFinished && b.isFinished) return a.finishTime - b.finishTime;
            if(a.isFinished) return -1;
            if(b.isFinished) return 1;
            return b.progress - a.progress;
        });
        showTournamentResultsModal(finalStandings);
    } else {
        if(isCurrentPlayerHost && socket) {
            socket.emit('host_trigger_game_over');
        }
    }
}

function showTournamentResultsModal(leaderboard) {
    const overlay = document.getElementById('results-modal');
    const tableBody = document.getElementById('leaderboard-rows-target');
    tableBody.innerHTML = "";
    
    leaderboard.forEach((p, index) => {
        const row = document.createElement('tr');
        let rankBadge = index + 1;
        if(index === 0) rankBadge = "👑 1st";
        if(index === 1) rankBadge = "🥈 2nd";
        if(index === 2) rankBadge = "🥉 3rd";
        
        let durationInfo = "DNF (Belum Finish)";
        if(p.isFinished && p.finishTime) {
            durationInfo = (p.finishTime / 1000).toFixed(2) + " detik";
        }
        
        row.innerHTML = `
            <td style="font-weight:bold; color:var(--accent-color);">${rankBadge}</td>
            <td>${p.car} <strong>${p.nickname}</strong></td>
            <td style="font-weight:bold; color:var(--correct-color);">${Math.round(p.wpm)} WPM</td>
            <td>${durationInfo}</td>
        `;
        tableBody.appendChild(row);
    });
    
    overlay.classList.add('active');
    document.getElementById('view-scores-btn').style.display = 'inline-block';
    
    document.getElementById('ready-start-btn').disabled = false;
    document.getElementById('ready-start-btn').className = "btn btn-success";
    applyUIRoleState();
}

function restartRaceCircuitLobby() {
    if(isSinglePlayerMode) {
        gameActive = false;
        clearInterval(gameTimerInterval);
        playersRaceStateMap['player_local'].progress = 0;
        playersRaceStateMap['player_local'].wpm = 0;
        playersRaceStateMap['player_local'].isFinished = false;
        botActiveOpponents.forEach(b => { b.progress = 0; b.wpm = 0; b.isFinished = false; });
        
        document.getElementById('words-wrapper').style.transform = "translateY(0px)";
        document.getElementById('live-timer-banner').style.display = 'none';
        document.getElementById('view-scores-btn').style.display = 'none';
        closeModalOnly();
        renderRaceTracks();
        updateLivePodiumUI();
        applyUIRoleState();
    } else {
        if(!isCurrentPlayerHost) return alert("Hanya Pemimpin Kamar (Host) yang bisa merestart balapan!");
        if(socket) socket.emit('host_restart_game');
    }
}

function toggleAccordionAction() {
    const body = document.getElementById('accordion-content-body');
    const btn = document.getElementById('accordion-toggle-btn');
    const badge = document.getElementById('accordion-status-badge');
    
    if(body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        btn.innerText = "Tutup Pengaturan ▲";
        badge.innerText = "(Terbuka)";
    } else {
        body.classList.add('collapsed');
        btn.innerText = "Buka Pengaturan ▼";
        badge.innerText = "(Tertutup)";
    }
}

function togglePodiumView() {
    const p = document.getElementById('live-podium-widget');
    p.classList.toggle('podium-collapsed');
}

// System Floating Chat & Emoji
function toggleChatPanelAction() {
    const wrapper = document.getElementById('chat-collapsible-wrapper');
    const container = document.getElementById('chat-sidebar-panel');
    const btn = document.getElementById('chat-toggle-btn');
    
    if(container.classList.contains('chat-minimized')) {
        container.classList.remove('chat-minimized');
        wrapper.style.display = 'flex';
        btn.innerText = "Minimize";
    } else {
        container.classList.add('chat-minimized');
        wrapper.style.display = 'none';
        btn.innerText = "Maximize";
    }
}

function sendChatMessageAction() {
    const inp = document.getElementById('chat-input-box');
    const text = inp.value.trim();
    if(!text) return;
    
    if(isSinglePlayerMode) {
        appendChatMessageNode(myNickname, text, true, selectedCarEmoji);
        // Simulasi balasan bot bodoh opsional
        setTimeout(() => {
            appendChatMessageNode("🤖 Bot Lawan", "Gua fokus balapan dulu ya bos! 🔥", false, "🏎️");
        }, 1000);
    } else {
        if(socket) socket.emit('chat_message_send', text);
    }
    inp.value = "";
}

function appendChatMessageNode(sender, text, isSelf, car) {
    const box = document.getElementById('chat-messages-target');
    const row = document.createElement('div');
    row.className = "chat-row " + (isSelf ? "row-self" : "row-other");
    
    row.innerHTML = `
        <div class="chat-msg-item">
            <strong>${car} ${sender}</strong>
            ${text}
        </div>
    `;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    
    // Bunyi notifikasi chat kalau tidak di-mute
    if(!isSelf && document.getElementById('chat-mute-btn').innerText === "🔊") {
        playSystemBeepAudioNotification();
    }
}

function insertEmojiToInput(emoji) {
    if(emoji === 'GG') {
        document.getElementById('chat-input-box').value += "GG WP! ";
    } else {
        document.getElementById('chat-input-box').value += emoji;
    }
    document.getElementById('chat-input-box').focus();
}

function toggleMuteSoundAction(e) {
    e.stopPropagation();
    const btn = document.getElementById('chat-mute-btn');
    btn.innerText = (btn.innerText === "🔊") ? "🔇" : "🔊";
}

function playSystemBeepAudioNotification() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // Nada D5
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } catch(err) {}
}

// Drag & Drop Floating Chat System 
const chatHeader = document.getElementById('chat-draggable-header');
const chatContainer = document.getElementById('chat-sidebar-panel');

if(chatHeader) {
    chatHeader.addEventListener('mousedown', (e) => {
        if(e.target.tagName === 'BUTTON') return;
        isChatPanelDragging = true;
        chatDragStartX = e.clientX;
        chatDragStartY = e.clientY;
        const rect = chatContainer.getBoundingClientRect();
        chatPanelOffsetX = rect.left;
        chatPanelOffsetY = rect.top;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if(!isChatPanelDragging) return;
        let deltaX = e.clientX - chatDragStartX;
        let deltaY = e.clientY - chatDragStartY;
        
        let newLeft = chatPanelOffsetX + deltaX;
        let newTop = chatPanelOffsetY + deltaY;
        
        chatContainer.style.position = "fixed";
        chatContainer.style.left = newLeft + "px";
        chatContainer.style.top = newTop + "px";
        chatContainer.style.bottom = "auto";
        chatContainer.style.right = "auto";
    });

    document.addEventListener('mouseup', () => {
        isChatPanelDragging = false;
        document.body.style.userSelect = 'auto';
    });
}

// Manajemen Garasi Kendaraan
function openGarageModal() {
    alert("Silahkan klik 'Keluar Kamar' dan gunakan Popup Sharelink untuk ganti mobil sementara, atau lo bisa gunakan garasi pop-up di menu utama.");
}

function selectCarFromSharePopup(emoji, elementId) {
    selectedCarEmoji = emoji;
    const items = document.querySelectorAll('#sharelink-garage-grid .garage-item');
    items.forEach(i => i.classList.remove('selected-car'));
    document.getElementById(elementId).classList.add('selected-car');
    document.getElementById('current-car-preview').innerText = emoji;
}

function confirmJoinViaShareLink() {
    const nick = document.getElementById('sharelink-nickname-input').value.trim();
    if(!nick) return alert("Masukkan Nama Balap lo!");
    myNickname = nick;
    
    document.getElementById('sharelink-join-modal').classList.remove('active');
    isSinglePlayerMode = false;
    if(socket && urlRoomCode) {
        socket.emit('join_room', urlRoomCode);
    }
}

// Developer Hacks
function devActionKickHost() {
    if(!checkDeveloperToken()) return;
    if(socket) socket.emit('dev_action_kick_host', currentOnlineRoomId);
}

function devActionChangeHost() {
    if(!checkDeveloperToken()) return;
    const target = document.getElementById('dev-target-host-id').value.trim();
    if(!target) return alert("Isi ID Target!");
    if(socket) socket.emit('dev_action_change_host', { roomId: currentOnlineRoomId, targetId: target });
}

function copyRoomShareLink() {
    const dummy = document.createElement('input'); 
    dummy.value = window.location.origin + "?room=" + (currentOnlineRoomId || "");
    document.body.appendChild(dummy); 
    dummy.select(); 
    document.execCommand('copy'); 
    document.body.removeChild(dummy);
    alert("Link Kamar Mabar berhasil disalin! Kirim ke temen lo biar bisa tanding.");
}

function leaveRoomAction() { window.location.reload(); }
function openScoresModal() { document.getElementById('results-modal').classList.add('active'); }
// Alias penunjang data lama
function closeModalOnly() { document.getElementById('results-modal').classList.remove('active'); }

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search); 
    const rParam = urlParams.get('room');
    if(rParam) {
        urlRoomCode = rParam.toUpperCase();
        document.getElementById('lobby-panel').style.display = 'none';
        document.getElementById('sharelink-join-modal').classList.add('active');
    }
}
