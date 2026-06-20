// MODUL INTERFACES, ANIMASI DAN ACCORDION PANEL UTILITAS

function toggleAccordionAction() {
    const body = document.getElementById('accordion-content-body');
    const btn = document.getElementById('accordion-toggle-btn');
    const badge = document.getElementById('accordion-status-badge');
    
    if (body.classList.contains('collapsed')) {
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
    if (p.classList.contains('podium-collapsed')) {
        p.classList.remove('podium-collapsed');
    } else {
        p.classList.add('podium-collapsed');
    }
}

function openGarageModal() {
    document.getElementById('garage-modal-view').classList.add('active');
}

function closeGarageModal() {
    document.getElementById('garage-modal-view').classList.remove('active');
}

function selectCarFromGarageMenu(emoji, elemId) {
    document.querySelectorAll('#garage-modal-view .garage-item').forEach(el => el.classList.remove('selected-car'));
    document.getElementById(elemId).classList.add('selected-car');
    chosenCarEmoji = emoji;
    document.getElementById('current-car-preview').innerText = emoji;
    
    if (isOnlineMode && socket) {
        socket.emit('update_car_skin', { carEmoji: emoji });
    } else if (!isOnlineMode) {
        updateTrackUI();
    }
}

function selectCarFromSharePopup(emoji, elemId) {
    document.querySelectorAll('#sharelink-join-modal .garage-item').forEach(el => el.classList.remove('selected-car'));
    document.getElementById(elemId).classList.add('selected-car');
    chosenCarEmoji = emoji;
}

function triggerShakeTrackEffect() {
    const card = document.getElementById('race-track-card');
    card.classList.add('shake-active');
    setTimeout(() => card.classList.remove('shake-active'), 150);
}

function playLocalSound(elementId) {
    if (isSoundMuted) return;
    const sfx = document.getElementById(elementId);
    if (sfx) {
        sfx.currentTime = 0;
        sfx.play().catch(() => {});
    }
}
