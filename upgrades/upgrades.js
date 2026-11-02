// upgrades/upgrades.js — серверный результат апгрейда
const $ = id => document.getElementById(id);
const MIN_CHANCE = 5;
const MAX_CHANCE = 85;
const MAX_TARGET_PRICE_MULT = 20;
const MAX_TARGET_PRICE_STARS = 100_000_000;
const HOUSE_EDGE = 0.8;
const CDN = 'https://cdn.changes.tg/gifts/models';
const PENDING_UPGRADE_KEY = 'upgradePending';

let state = {
    stars: 0, inventory: [], selectedGift: null, targetGift: null,
    possibleTargets: [], isSpinning: false, currentChance: 0, activeSection: null
};
let pendingUpgrade = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();
    $('userName').textContent = window.TG.getShortName();

    window.addEventListener('profileDataLoaded', (e) => {
        if (typeof e.detail.stars === 'number') { state.stars = e.detail.stars; updateBalanceUI(); }
        if (Array.isArray(e.detail.inventory)) { state.inventory = e.detail.inventory; renderInventoryGrid(); }
    });
    try {
        const user = await window.LootStarAPI.loadProfile();
        state.stars = Number(user.stars) || 0;
        state.inventory = Array.isArray(user.inventory) ? user.inventory : [];
        updateBalanceUI();
        renderInventoryGrid();

        try {
            pendingUpgrade = JSON.parse(localStorage.getItem(PENDING_UPGRADE_KEY) || 'null');
        } catch (error) {
            console.error('[upgrades] pending operation state is invalid:', error);
            localStorage.removeItem(PENDING_UPGRADE_KEY);
        }
        if (pendingUpgrade) await recoverPendingUpgrade();
        if (!pendingUpgrade) restorePreselectedItem();
    } catch (error) {
        console.error('[upgrades] profile load failed:', error);
        showToast('Не удалось загрузить инвентарь с сервера', 'err');
        $('upgradeBtn').disabled = true;
    }
}

function restorePreselectedItem() {
    const preselected = localStorage.getItem('upgradeItemId');
    if (!preselected) return;
    const item = state.inventory.find(entry => entry.id === preselected);
    if (item) selectGift(item);
    localStorage.removeItem('upgradeItemId');
}
function updateBalanceUI() {
    $('balanceDisplay').textContent = state.stars.toLocaleString('ru-RU');
}

function getUpgradeChance(fromStars, targetStars) {
    return (fromStars / targetStars) * 100;
}

function getGiftImage(name, price) {
    if (window.ROOT_ITEMS.has(name) || price < 3) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return slug + '.png';
    }
    const m = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m) return `${CDN}/${window.encodePathPart(m[1].trim())}/png/${window.encodePathPart(m[2].trim())}.png`;
    return `${CDN}/${window.encodePathPart(name)}/png/Original.png`;
}
function getGiftLottieSafe(name, price) {
    if (window.ROOT_ITEMS.has(name) || price < 3) return null;
    const m = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m) return `${CDN}/${window.encodePathPart(m[1].trim())}/lottie/${window.encodePathPart(m[2].trim())}.json`;
    return `${CDN}/${window.encodePathPart(name)}/lottie/Original.json`;
}

function lockUpgradeUI(lock) {
    document.querySelectorAll('.upgrade-btn, .select-btn, .target-row, .inline-item, .card').forEach(el => {
        if (lock) { el.setAttribute('disabled', 'disabled'); el.style.pointerEvents = 'none'; el.style.opacity = '0.5'; }
        else { el.removeAttribute('disabled'); el.style.pointerEvents = ''; el.style.opacity = ''; }
    });
    document.querySelectorAll('.bnav button').forEach(el => {
        if (lock) { el.setAttribute('disabled', 'disabled'); el.style.pointerEvents = 'none'; el.style.opacity = '0.4'; }
        else { el.removeAttribute('disabled'); el.style.pointerEvents = ''; el.style.opacity = ''; }
    });
    document.querySelectorAll('header button, header .user-profile').forEach(el => {
        if (lock) { el.style.pointerEvents = 'none'; el.style.opacity = '0.6'; }
        else { el.style.pointerEvents = ''; el.style.opacity = ''; }
    });
    const btn = document.getElementById('upgradeBtn');
    if (btn && lock) btn.disabled = true;
}

function preventLeaveDuringSpin(e) { e.preventDefault(); e.returnValue = ''; return ''; }

function renderInventoryGrid() {
    const grid = $('inventoryGrid');
    if (!state.inventory.length) {
        grid.innerHTML = '<div class="empty-msg" style="grid-column:1/-1">Ничего нет<br><small style="opacity:.6">Открой кейс, чтобы получить</small></div>';
        return;
    }
    grid.innerHTML = state.inventory.map(it => {
        const isSel = state.selectedGift && state.selectedGift.id === it.id;
        const stars = it.stars || Math.round((it.price || 0) * 125);
        return `
            <div class="inline-item ${isSel ? 'selected' : ''}" onclick="selectGiftById('${it.id}')">
                <img src="${it.image}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                <div class="inline-item-name">${window.escapeHtml(it.name)}</div>
                <div class="inline-item-value"><img src="${window.STAR_ICON}" alt="">${stars.toLocaleString('ru-RU')}</div>
            </div>`;
    }).join('');
}

function toggleInventory() {
    if (state.isSpinning) return;
    const invSec = $('inventorySection'), tarSec = $('targetsSection');
    const btnInv = $('btnInventory'), btnTar = $('btnTargets');
    if (state.activeSection === 'inventory') {
        invSec.classList.remove('show'); btnInv.classList.remove('active'); state.activeSection = null;
    } else {
        invSec.classList.add('show'); tarSec.classList.remove('show');
        btnInv.classList.add('active'); btnTar.classList.remove('active');
        state.activeSection = 'inventory'; renderInventoryGrid();
    }
}

function toggleTargets() {
    if (state.isSpinning) return;
    if (!state.selectedGift) { showToast('Сначала выбери подарок для апгрейда', 'err'); return; }
    const invSec = $('inventorySection'), tarSec = $('targetsSection');
    const btnInv = $('btnInventory'), btnTar = $('btnTargets');
    if (state.activeSection === 'targets') {
        tarSec.classList.remove('show'); btnTar.classList.remove('active'); state.activeSection = null;
    } else {
        tarSec.classList.add('show'); invSec.classList.remove('show');
        btnTar.classList.add('active'); btnInv.classList.remove('active');
        state.activeSection = 'targets'; loadPossibleTargets();
    }
}

function selectGiftById(itemId) {
    if (state.isSpinning) return;
    const item = state.inventory.find(i => i.id === itemId);
    if (!item) return;
    selectGift(item);
}

function selectGift(g) {
    const stars = g.stars || Math.round((g.price || 0) * 125);
    state.selectedGift = { id: g.id, name: g.name, image: g.image, price: g.price || stars, stars };
    $('leftCard').classList.add('has-gift');
    $('leftCard').classList.remove('fail');
    $('leftGiftImg').src = g.image;
    $('leftGiftImg').onerror = function() { this.onerror = null; this.src = window.GIFT_FALLBACK; };
    $('leftGiftName').textContent = g.name;
    $('leftGiftValue').textContent = stars.toLocaleString('ru-RU');
    if (state.targetGift) resetTarget();
    renderInventoryGrid(); updateWheel();
    $('inventorySection').classList.remove('show');
    $('btnInventory').classList.remove('active');
    state.activeSection = null;
    window.vibrate();
}

function resetTarget() {
    state.targetGift = null; state.currentChance = 0;
    $('rightCard').classList.remove('has-gift', 'fail');
    $('wheelCenterImg').style.display = 'none';
    $('chancePct').style.display = 'block';
    drawGreenArc(0);
}

function loadPossibleTargets() {
    const list = $('targetsList');
    list.innerHTML = '<div class="empty-msg">Загрузка...</div>';
    const myStars = state.selectedGift.stars;
    state.possibleTargets = [];
    const seen = new Set();
    window.ALL_GIFTS.forEach(g => {
        if (seen.has(g.name)) return;
        seen.add(g.name);
        const priceStars = g.price < 200 ? Math.round(g.price * 125) : Math.round(g.price);
        if (priceStars <= myStars) return;
        if (priceStars > MAX_TARGET_PRICE_STARS) return;
        if (priceStars > myStars * MAX_TARGET_PRICE_MULT) return;
        const chance = getUpgradeChance(myStars, priceStars);
        if (chance < MIN_CHANCE) return;
        if (chance > MAX_CHANCE) return;
        const baseChance = Math.round(chance * 10) / 10;
        state.possibleTargets.push({
            name: g.name,
            price: g.price,
            stars: priceStars,
            image: g.image,
            chance: baseChance,
            effectiveChance: Math.round(baseChance * HOUSE_EDGE * 10) / 10
        });
    });
    state.possibleTargets.sort((a, b) => a.stars - b.stars);
    renderTargetsList();
}

function renderTargetsList() {
    const list = $('targetsList');
    if (!state.possibleTargets.length) {
        list.innerHTML = '<div class="empty-msg">Нет подходящих целей<br><small style="opacity:.6">Шанс от ' + MIN_CHANCE + '% до ' + MAX_CHANCE + '%</small></div>';
        return;
    }
    list.innerHTML = state.possibleTargets.map(g => {
        const isSel = state.targetGift && state.targetGift.name === g.name;
        const safeName = g.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `
            <div class="target-row ${isSel ? 'selected' : ''}" onclick="selectTargetByName('${safeName}')">
                <img src="${g.image}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                <div class="target-row-info">
                    <div class="target-row-name">${window.escapeHtml(g.name)}</div>
                    <div class="target-row-price"><img src="${window.STAR_ICON}" alt="">${g.stars.toLocaleString('ru-RU')}</div>
                </div>
                <div class="target-row-chance">${g.effectiveChance}%</div>
            </div>`;
    }).join('');
}

function selectTargetByName(name) {
    if (state.isSpinning) return;
    const g = state.possibleTargets.find(x => x.name === name);
    if (!g) return;
    state.targetGift = g; state.currentChance = g.chance;
    $('rightCard').classList.add('has-gift');
    $('rightCard').classList.remove('fail');
    $('rightGiftImg').src = g.image;
    $('rightGiftImg').onerror = function() { this.onerror = null; this.src = window.GIFT_FALLBACK; };
    $('rightGiftName').textContent = g.name;
    $('rightGiftValue').textContent = g.stars.toLocaleString('ru-RU');
    $('wheelCenterImg').src = g.image;
    $('wheelCenterImg').style.display = 'block';
    $('chancePct').style.display = 'none';
    drawGreenArc(state.currentChance);
    renderTargetsList(); updateWheel();
    $('targetsSection').classList.remove('show');
    $('btnTargets').classList.remove('active');
    state.activeSection = null;
    window.vibrate();
}

function drawGreenArc(chance) {
    const path = $('greenPath');
    if (!chance || chance <= 0) { path.setAttribute('d', ''); return; }
    const cx = 110, cy = 110, r = 100;
    const endAngle = (chance / 100) * 360;
    const start = polarToCartesian(cx, cy, r, 0);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArc = endAngle > 180 ? 1 : 0;
    path.setAttribute('d', `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`);
}
function polarToCartesian(cx, cy, r, angle) {
    const rad = (angle - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function updateWheel() {
    const btn = $('upgradeBtn');
    const chancePct = $('chancePct');
    if (!state.targetGift || !state.selectedGift) {
        chancePct.textContent = '0%'; btn.disabled = true; drawGreenArc(0); return;
    }
    const chance = getUpgradeChance(state.selectedGift.stars, state.targetGift.stars);
    state.currentChance = Math.round(chance * 10) / 10;
    const effectiveChance = state.currentChance * HOUSE_EDGE;
    chancePct.textContent = effectiveChance.toFixed(1) + '%';
    drawGreenArc(effectiveChance);
    btn.disabled = !(state.currentChance >= MIN_CHANCE && state.currentChance <= MAX_CHANCE);
    btn.classList.remove('win', 'fail');
    $('upgradeBtnText').textContent = 'Апгрейд';
}

async function doUpgrade() {
    if (state.isSpinning || !state.targetGift || !state.selectedGift) return;

    const fromId = state.selectedGift.id;
    const targetGift = { ...state.targetGift };
    if (pendingUpgrade &&
        (pendingUpgrade.itemId !== fromId || pendingUpgrade.targetName !== targetGift.name)) {
        showToast('Завершите предыдущую операцию апгрейда', 'err');
        return;
    }
    pendingUpgrade = pendingUpgrade || {
        itemId: fromId,
        targetName: targetGift.name,
        requestId: window.LootStarAPI.createRequestId()
    };
    localStorage.setItem(PENDING_UPGRADE_KEY, JSON.stringify(pendingUpgrade));

    state.isSpinning = true;
    lockUpgradeUI(true);
    window.addEventListener('beforeunload', preventLeaveDuringSpin);

    $('inventorySection').classList.remove('show');
    $('targetsSection').classList.remove('show');
    $('btnInventory').classList.remove('active');
    $('btnTargets').classList.remove('active');
    state.activeSection = null;

    const btn = $('upgradeBtn');
    btn.disabled = true;
    $('upgradeBtnText').textContent = 'Крутим...';
    $('resultSad').classList.remove('show');
    $('resultHappy').classList.remove('show');
    $('leftCard').classList.remove('fail');
    $('rightCard').classList.remove('fail');
    $('wheelGlow').classList.add('spinning');
    $('wheelCenterImg').style.display = 'none';
    $('chancePct').style.display = 'block';
    $('chancePct').textContent = (state.currentChance * HOUSE_EDGE).toFixed(1) + '%';

    try {
        const result = await window.LootStarAPI.upgradeItem(
            fromId, targetGift.name, pendingUpgrade.requestId
        );
        window.LootStarAPI.applyInventoryResult(result);
        state.inventory = result.inventory;
        state.stars = Number(result.stars) || 0;
        localStorage.removeItem(PENDING_UPGRADE_KEY);
        pendingUpgrade = null;
        animateUpgradeResult(result.success, targetGift, result.effectiveChance);
    } catch (error) {
        console.error('[upgrades] server operation failed:', error);
        if (error.status) {
            localStorage.removeItem(PENDING_UPGRADE_KEY);
            pendingUpgrade = null;
        }
        try {
            const user = await window.LootStarAPI.loadProfile();
            state.stars = Number(user.stars) || 0;
            state.inventory = Array.isArray(user.inventory) ? user.inventory : [];
            updateBalanceUI();
            renderInventoryGrid();
        } catch (profileError) {
            console.error('[upgrades] profile refresh failed:', profileError);
        }
        state.isSpinning = false;
        lockUpgradeUI(false);
        window.removeEventListener('beforeunload', preventLeaveDuringSpin);
        $('wheelGlow').classList.remove('spinning');
        updateWheel();
        showToast(error.status ? 'Апгрейд не выполнен: ' + error.code : 'Нет связи с сервером. Повторите операцию', 'err');
    }
}

async function recoverPendingUpgrade() {
    if (typeof pendingUpgrade?.itemId !== 'string' ||
        typeof pendingUpgrade?.targetName !== 'string' ||
        typeof pendingUpgrade?.requestId !== 'string') {
        localStorage.removeItem(PENDING_UPGRADE_KEY);
        pendingUpgrade = null;
        return;
    }
    try {
        const result = await window.LootStarAPI.upgradeItem(
            pendingUpgrade.itemId, pendingUpgrade.targetName, pendingUpgrade.requestId
        );
        window.LootStarAPI.applyInventoryResult(result);
        state.inventory = result.inventory;
        state.stars = Number(result.stars) || 0;
        pendingUpgrade = null;
        localStorage.removeItem(PENDING_UPGRADE_KEY);
        showToast(result.success ? 'Предыдущий апгрейд завершился успехом' : 'Предыдущий апгрейд не удался', result.success ? 'ok' : 'err');
    } catch (error) {
        console.error('[upgrades] pending operation recovery failed:', error);
        if (error.status) {
            pendingUpgrade = null;
            localStorage.removeItem(PENDING_UPGRADE_KEY);
            showToast('Не удалось восстановить апгрейд: ' + error.code, 'err');
            return;
        }
        const source = state.inventory.find(item => item.id === pendingUpgrade.itemId);
        if (source) {
            selectGift(source);
            loadPossibleTargets();
            if (state.possibleTargets.some(item => item.name === pendingUpgrade.targetName)) {
                selectTargetByName(pendingUpgrade.targetName);
            }
        }
        showToast('Не удалось проверить прошлую операцию. Нажмите «Апгрейд», чтобы повторить', 'err');
    }
}

function animateUpgradeResult(success, targetGift, effectiveChance) {
    const pointerWrap = $('pointerWrap');
    pointerWrap.style.transition = 'none';
    pointerWrap.style.transform = 'rotate(0deg)';
    $('wheelCenterImg').style.display = 'none';
    $('chancePct').style.display = 'block';
    $('chancePct').textContent = Number(effectiveChance).toFixed(1) + '%';

    const greenAngle = (Number(effectiveChance) / 100) * 360;
    let landAngle;
    if (success) {
        landAngle = Math.random() * greenAngle * 0.6 + greenAngle * 0.2;
    } else {
        const redSize = 360 - greenAngle;
        landAngle = greenAngle + Math.random() * redSize * 0.3 + redSize * 0.05;
    }
    const totalSpin = 360 * (8 + Math.floor(Math.random() * 5)) + landAngle;
    const spinDuration = 5000 + Math.random() * 2000;

    void pointerWrap.offsetWidth;
    pointerWrap.style.transition = `transform ${spinDuration}ms cubic-bezier(0.3, 0, 0.15, 1.05)`;
    pointerWrap.style.transform = `rotate(${totalSpin}deg)`;

    setTimeout(() => {
        $('wheelGlow').classList.remove('spinning');
        showResult(success, targetGift);
    }, spinDuration);
}

function showResult(success, targetGift) {
    const center = $('wheelCenter');
    const btn = $('upgradeBtn');
    $('chancePct').style.display = 'none';

    if (success) {
        center.classList.add('flash-green');
        $('resultHappy').classList.add('show');
        btn.classList.add('win');
        $('upgradeBtnText').textContent = 'Победа!';
        launchConfetti(40);
        playWinLottie(targetGift);
        showToast(`Успех! Получено: ${targetGift.name}`, 'ok');
        window.vibrate('success');
    } else {
        center.classList.add('flash-red');
        $('resultSad').classList.add('show');
        btn.classList.add('fail');
        $('upgradeBtnText').textContent = 'Неудача';
        $('leftCard').classList.add('fail');
        $('rightCard').classList.add('fail');
        showToast(`Не повезло. ${targetGift.name} не получен`, 'err');
        window.vibrate('error');
    }

    setTimeout(() => {
        center.classList.remove('flash-red', 'flash-green', 'flash-blessing');
        resetAfterSpin();
    }, 3500);
}

function resetAfterSpin() {
    state.isSpinning = false;
    state.selectedGift = null;
    state.targetGift = null;
    state.currentChance = 0;
    $('leftCard').classList.remove('has-gift', 'fail');
    $('rightCard').classList.remove('has-gift', 'fail');
    $('wheelCenterImg').style.display = 'none';
    $('chancePct').style.display = 'block';
    $('chancePct').textContent = '0%';
    $('resultSad').classList.remove('show');
    $('resultHappy').classList.remove('show');
    const pointerWrap = $('pointerWrap');
    pointerWrap.style.transition = 'none';
    pointerWrap.style.transform = 'rotate(0deg)';
    drawGreenArc(0);
    updateWheel();
    renderInventoryGrid();
    lockUpgradeUI(false);
    window.removeEventListener('beforeunload', preventLeaveDuringSpin);
}

function playWinLottie(gift) {
    if (!gift || !gift.name) return;
    const url = getGiftLottieSafe(gift.name, gift.price);
    if (!url) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);pointer-events:none;opacity:1;transition:opacity .4s';
    overlay.innerHTML = '<div style="width:220px;height:220px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 40px rgba(245,197,24,.5))"></div>';
    document.body.appendChild(overlay);
    fetch(url, { method: 'HEAD' }).then(r => {
        if (!r.ok) { overlay.remove(); return; }
        lottie.loadAnimation({ container: overlay.firstChild, renderer: 'svg', loop: true, autoplay: true, path: url });
    }).catch(() => overlay.remove());
    setTimeout(() => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 400); }, 3000);
}

function launchConfetti(count = 40) {
    const canvas = $('confettiCanvas');
    if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const colors = ['#F5C518', '#FFD84D', '#fff', '#C7C7CC', '#8a6a0c'];
    for (let i = 0; i < count; i++) {
        particles.push({
            x: canvas.width / 2 + (Math.random() - .5) * 100,
            y: canvas.height / 2,
            vx: (Math.random() - .5) * 10, vy: -Math.random() * 12 - 3,
            w: Math.random() * 8 + 3, h: Math.random() * 6 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360, rv: (Math.random() - .5) * 10, life: 1
        });
    }
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        particles.forEach(p => {
            if (p.life <= 0) return;
            alive = true;
            p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.rot += p.rv; p.life -= 0.012;
            ctx.save();
            ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (alive) requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    draw();
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

window.toggleInventory = toggleInventory;
window.toggleTargets = toggleTargets;
window.selectGiftById = selectGiftById;
window.selectTargetByName = selectTargetByName;
window.doUpgrade = doUpgrade;