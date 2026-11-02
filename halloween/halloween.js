/* ═══════════════════════════════════════════════════════════
   LootStar — Halloween Event (JS)
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const EVENT_END = new Date('2026-11-14T23:59:59');
const SPIN_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/* ── безопасные хелперы для внешних зависимостей ── */
const safeCall = (fn, ...args) => { try { return typeof fn === 'function' ? fn(...args) : undefined; } catch (e) { console.warn('[hw] safeCall error:', e); } };
const fallbackImg = () => window.GIFT_FALLBACK || '/shared/star.png';
const fmtStars = n => (typeof window.formatStars === 'function' ? window.formatStars(n) : Number(n || 0).toLocaleString('ru-RU'));
const esc = s => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s ?? ''));
const vibrate = mode => safeCall(window.vibrate, mode);
const refreshCurrency = () => safeCall(window.refreshCurrencyUI);
const tgHeader = () => safeCall(window.TG?.updateHeaderUI);
const pendingPassClaims = new Set();
let pendingHalloweenOps = new Map();
let treatSyncTimer = null;

try {
    const storedOperations = JSON.parse(localStorage.getItem('halloweenPendingOps') || '[]');
    if (Array.isArray(storedOperations) && storedOperations.every(entry =>
        Array.isArray(entry) && entry.length === 2 &&
        typeof entry[0] === 'string' && typeof entry[1] === 'string'
    )) pendingHalloweenOps = new Map(storedOperations);
} catch (error) {
    console.warn('[hw] Could not restore pending request IDs:', error);
}

function persistPendingHalloweenOps() {
    try {
        localStorage.setItem('halloweenPendingOps', JSON.stringify([...pendingHalloweenOps]));
    } catch (error) {
        console.error('[hw] Could not persist pending request IDs:', error);
    }
}

let state = {
    pumpkins: 0,
    tapsUsed: 0,
    maxTaps: 2500,
    spinLastUsed: 0,
    xp: 0,
    passClaims: [],
    brews: { slot1: null, slot2: null, slot3Unlocked: false, active: [] }
};

let HWConfig = null;

/* ═══════════ КОНФИГ ЗЕЛИЙ ═══════════ */
const BREWS = [
    { id: 'luck2', name: 'x2 Luck Brew', time: '01:00:00', price: 7500, icon: '2luck', type: 'luck2' },
    { id: 'luck4', name: 'x4 Luck Brew', time: '03:00:00', price: 25000, icon: '4luck', type: 'luck4' },
    { id: 'blessing', name: 'Blessing Brew', time: '02:00:00', price: 9500, icon: 'blessing', type: 'blessing' }
];

/* ═══════════ ГЕНЕРАЦИЯ ПАССА ═══════════ */
const PASS_REWARDS = [];
const PRO_PASS_REWARDS = [];

const BASE_REWARDS = [
    { type: 'silver', amount: 10000, icon: 'silver' },
    { type: 'pumpkins', amount: 250, icon: 'pumpkin' },
    { type: 'stars', amount: 1000000, icon: 'star' },
    { type: 'luck2', duration: 15, icon: '2luck' },
    { type: 'stars', amount: 2500000, icon: 'star' },
    { type: 'luck4', duration: 5, icon: '4luck' },
    { type: 'pumpkins', amount: 500, icon: 'pumpkin' },
    { type: 'blessing', duration: 15, icon: 'blessing' },
    { type: 'gift', name: 'Plush Pepe', price: 828750, icon: 'gift' },
    { type: 'silver', amount: 25000, icon: 'silver' },
];

for (let i = 0; i < 50; i++) {
    const xp = (i + 1) * 1500;
    const base = BASE_REWARDS[i % BASE_REWARDS.length];

    if (i === 49) {
        PASS_REWARDS.push({ xp: 100000, type: 'stars', amount: 150000000, icon: 'star', isMain: true });
        PRO_PASS_REWARDS.push({ xp: 100000, type: 'stars', amount: 500000000, icon: 'star', isMain: true });
    } else {
        PASS_REWARDS.push({
            ...base,
            xp,
            amount: base.amount ? Math.floor(base.amount * (1 + i * 0.2)) : undefined
        });
        PRO_PASS_REWARDS.push({
            ...base,
            xp,
            amount: base.amount ? Math.floor(base.amount * 3) : undefined
        });
    }
}

/* ═══════════ КЕЙСЫ ═══════════ */
const HW_CASES = {
    'pumpkin': {
        id: 'pumpkin', name: 'Pumpkin King', price: 150, badge: 'hot',
        tier: '#E2793D',
        items: [
            { name: 'Mad Pumpkin (Pumpkin)',              price: 232417,   chance: 66.5 },
            { name: 'Hex Pot (Halloween Brew)',           price: 614591,   chance: 20 },
            { name: 'Voodoo Doll (Pumpkin)',              price: 34489,    chance: 10 },
            { name: 'Jack-in-the-Box (Haunted House)',    price: 3748095,  chance: 2.5 },
            { name: 'Skull Flower (Ghost Rider)',         price: 10587176, chance: 1 }
        ]
    },
    'witch': {
        id: 'witch', name: 'Witch Hour', price: 600, badge: 'hot',
        tier: '#9B86F0',
        items: [
            { name: 'Witch Hat (Cobweb)',                 price: 150705,   chance: 70.75 },
            { name: 'Scared Cat (Salem)',                 price: 989334,   chance: 20 },
            { name: 'Evil Eye (Monster Mash)',            price: 2556496,  chance: 7 },
            { name: 'Spy Agaric (Nosferatu)',             price: 9932278,  chance: 1.75 },
            { name: 'Crystal Ball (Samhain)',             price: 28301680, chance: 0.5 }
        ]
    },
    'graveyard': {
        id: 'graveyard', name: 'Graveyard', price: 2000, badge: '',
        tier: '#4FB8C4',
        items: [
            { name: 'Electric Skull (Graveyard)',         price: 1882093,   chance: 60 },
            { name: 'Voodoo Doll (Dark Side)',            price: 2857431,   chance: 30 },
            { name: 'Trapped Heart (Undead Beat)',        price: 6457349,   chance: 7 },
            { name: 'Jack-in-the-Box (Tombstone)',        price: 36082390,  chance: 2.5 },
            { name: 'Skull Flower (Nightshade)',          price: 269557495, chance: 0.5 }
        ]
    },
    'haunted': {
        id: 'haunted', name: 'Haunted House', price: 6666, badge: 'best',
        tier: '#E8548A',
        items: [
            { name: 'Jack-in-the-Box (Night Terror)',     price: 37093,      chance: 99.999 },
            { name: 'Sharp Tongue (Zombie Bite)',         price: 246944444, chance: 0.001 }
        ]
    }
};

let currentCase = null;
let isOpening = false;
let spinInterval = null;
let currentWinItems = [];

document.addEventListener('DOMContentLoaded', init);

function init() {
    try { tgHeader(); } catch (e) { console.warn(e); }
    try { refreshCurrency(); } catch (e) { console.warn(e); }

    try { renderCases(); } catch (e) { console.warn(e); }
    try { renderBrews(); } catch (e) { console.warn(e); }
    try { renderPass(); } catch (e) { console.warn(e); }
    try { startTimers(); } catch (e) { console.warn(e); }
    try { initTreat(); } catch (e) { console.warn(e); }
    try { drawWheel(); } catch (e) { console.warn(e); }
    try { initLeaves(); } catch (e) { console.warn(e); }
    try { initSpinButton(); } catch (e) { console.warn(e); }

    // ПРИНУДИТЕЛЬНОЕ ПОДКЛЮЧЕНИЕ КНОПКИ
    const spinBtn = $('spinBtn');
    if (spinBtn) {
        spinBtn.onclick = null;
        spinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            try { spinWheel(); } catch(err) { console.error('Ошибка в spinWheel:', err); }
        });
    }

    // Привязка кнопки CLAIM
    const treatBtn = $('treatClaim');
    if (treatBtn) {
        treatBtn.onclick = null;
        treatBtn.addEventListener('click', (e) => {
            e.preventDefault();
            try { claimTreat(); } catch(err) { console.error(err); }
        });
    }

    const modal = $('caseModal');
    if (modal) {
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    window.addEventListener('profileDataLoaded', event => {
        if (event.detail?.source === 'api' && event.detail.halloweenPumpkins !== undefined) {
            state.pumpkins = Number(event.detail.halloweenPumpkins) || 0;
            state.xp = Number(event.detail.halloweenXP) || state.xp;
            updateHeaderUI();
            renderPass();
        }
    });
    window.addEventListener('xpUpdated', syncHalloweenState);

    window.addEventListener('eventsConfigLoaded', event => {
        HWConfig = event.detail?.halloween || {};
        renderPass();
    });
}

function applyHalloweenSnapshot(result) {
    window.LootStarAPI.applyHalloweenResult(result);
    state.pumpkins = Number(result.pumpkins) || 0;
    state.xp = Number(result.halloweenXP) || 0;
    state.spinLastUsed = Number(result.state?.spinLastUsed) || 0;
    state.passClaims = Array.isArray(result.state?.passClaims) ? result.state.passClaims : [];
    treat.streakMs = Number(result.state?.treatStreakMs) || 0;
    treat.accrued = Number(result.state?.treatAccrued) || 0;
    treatHiddenSince = result.state?.treatHiddenSince ?? null;
    state.brews.active = Array.isArray(result.state?.activeBrews) ? result.state.activeBrews : [];
    updateHeaderUI();
    renderPass();
    renderTreat();
    updateSpinButton();
}

async function syncHalloweenState() {
    const result = await window.LootStarAPI.getHalloweenState();
    applyHalloweenSnapshot(result);
    return result;
}

async function halloweenOperation(action, options = {}) {
    const key = `${action}:${JSON.stringify(options)}`;
    let requestId = pendingHalloweenOps.get(key);
    if (!requestId) {
        requestId = window.LootStarAPI.createRequestId();
        pendingHalloweenOps.set(key, requestId);
        persistPendingHalloweenOps();
    }
    try {
        const result = await window.LootStarAPI.operateHalloween(action, options, requestId);
        pendingHalloweenOps.delete(key);
        persistPendingHalloweenOps();
        applyHalloweenSnapshot(result);
        return result;
    } catch (error) {
        if (error.status >= 400 && error.status < 500) {
            pendingHalloweenOps.delete(key);
            persistPendingHalloweenOps();
        }
        throw error;
    }
}

/* ═══════════ ССЫЛКА НА КАРТИНКУ ПРЕДМЕТА ═══════════ */
function getHalloweenItemImage(gift) {
    if (!gift || !gift.name) return fallbackImg();
    const match = gift.name.match(/^(.+?)\s*\((.+)\)\s*$/);
    const giftName = match ? match[1].trim() : gift.name.trim();
    const modelName = match ? match[2].trim() : 'Original';
    const enc = s => encodeURIComponent(s);
    return `https://api.changes.tg/model/${enc(giftName)}/${enc(modelName)}.png`;
}

/* ═══════════ РЕНДЕР КЕЙСОВ ═══════════ */
function renderCases() {
    const container = $('hwCasesGrid');
    if (!container) return;

    let html = '';
    Object.values(HW_CASES).forEach((c, idx) => {
        const preview = [...c.items].sort((a, b) => b.price - a.price)[0];
        const previewImg = getHalloweenItemImage(preview);
        const fb = fallbackImg();

        let badgeHtml = '';
        if (c.badge === 'hot') badgeHtml = `<div class="hw-case-badge hot">HOT!</div>`;
        if (c.badge === 'best') badgeHtml = `<div class="hw-case-badge best">BEST!</div>`;

        html += `
            <div class="case-card" style="--tier:${c.tier}; animation-delay:${Math.min(idx * 35, 400)}ms" onclick="openCaseModal('${c.id}')">
                ${badgeHtml}
                <div class="case-image">
                    <img src="/images/cases/${c.id}.png" alt="" onerror="this.onerror=function(){this.onerror=null;this.src='${fb}'};this.src='${previewImg}'">
                </div>
                <div class="case-name">${esc(c.name)}</div>
                <div class="case-price">
                    <img src="/shared/pumpkin.png" alt="" onerror="this.style.display='none'">
                    ${c.price.toLocaleString('ru-RU')}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

/* ═══════════ МОДАЛКА И ЛОГИКА ОТКРЫТИЯ ═══════════ */
function openCaseModal(caseKey) {
    if (isOpening) return;
    const found = HW_CASES[caseKey];
    if (!found) return;
    currentCase = found;

    $('modalName').textContent = currentCase.name;
    const priceIcon = '/shared/pumpkin.png';
    $('modalPrice').querySelector('img').src = priceIcon;
    $('modalPrice').querySelector('span').textContent = currentCase.price.toLocaleString('ru-RU');

    $('modalWin').style.display = 'none';
    $('modalWin').innerHTML = '';
    $('modalWin').classList.remove('modal-win');
    $('rouletteWrap').style.display = 'block';
    $('rouletteWrap').classList.remove('won');
    $('contentsSection').style.display = 'block';
    $('openBtnWrap').style.display = 'block';

    const gifts = [...currentCase.items].sort((a, b) => b.price - a.price);
    const rouletteItems = [];
    for (let i = 0; i < 30; i++) {
        const g = gifts[i % gifts.length];
        const isPumpkin = g.name.toLowerCase().includes('pumpkin') || g.name.toLowerCase().includes('halloween');
        const icon = isPumpkin ? '/shared/pumpkin.png' : '/shared/star.png';
        rouletteItems.push(
            `<div class="roulette-item">` +
                `<div class="ri-price"><img src="${icon}" alt="">${fmtStars(g.price)}</div>` +
                `<img class="ri-img" src="${getHalloweenItemImage(g)}" alt="" onerror="this.onerror=null;this.src='${fallbackImg()}'">` +
            `</div>`
        );
    }
    const track = $('rouletteTrack');
    track.innerHTML = rouletteItems.join('') + rouletteItems.join('');
    track.classList.add('idle');
    track.classList.remove('spinning');
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';

    $('contentsGrid').innerHTML = gifts.map((g, i) => {
        const isPumpkin = g.name.toLowerCase().includes('pumpkin') || g.name.toLowerCase().includes('halloween');
        const icon = isPumpkin ? '/shared/pumpkin.png' : '/shared/star.png';
        return (
            `<div class="content-item" style="animation-delay:${i * 30}ms">` +
                `<div class="content-item-name">${esc(g.name)}</div>` +
                `<div class="content-item-media"><img src="${getHalloweenItemImage(g)}" alt="" onerror="this.onerror=null;this.src='${fallbackImg()}'"></div>` +
                `<div class="content-price"><img src="${icon}" alt=""> ${fmtStars(g.price)}</div>` +
            `</div>`
        );
    }).join('');

    $('caseModal').classList.add('open', 'modal-open');
}

function openCase() {
    if (!currentCase || isOpening) return;
    isOpening = true;
    $('openBtnWrap').style.display = 'none';
    $('contentsSection').style.display = 'none';
    halloweenOperation('case_open', { caseId: currentCase.id }).then(result => {
        const wonGift = { name: result.reward.name, price: result.reward.price };
        currentWinItems = [result.reward];
        runSpinRoulette(wonGift);
    }).catch(error => {
        isOpening = false;
        $('openBtnWrap').style.display = 'block';
        $('contentsSection').style.display = 'block';
        showToast(error.message === 'HALLOWEEN_NOT_ENOUGH_PUMPKINS'
            ? 'Недостаточно тыкв!' : 'Не удалось открыть кейс. Повторите попытку.', 'err');
        console.error('[hw] case operation failed:', error);
    });
}

function runSpinRoulette(wonGift) {
    const track = $('rouletteTrack');
    track.classList.remove('idle');
    track.classList.add('spinning');

    const pool = currentCase.items;
    const items = [];
    for (let i = 0; i < 50; i++) items.push(pool[Math.floor(Math.random() * pool.length)]);
    items[42] = wonGift;

    track.innerHTML = items.map(g => {
        const isPumpkin = g.name.toLowerCase().includes('pumpkin') || g.name.toLowerCase().includes('halloween');
        const icon = isPumpkin ? '/shared/pumpkin.png' : '/shared/star.png';
        return (
            `<div class="roulette-item">` +
                `<div class="ri-price"><img src="${icon}" alt="">${fmtStars(g.price)}</div>` +
                `<img class="ri-img" src="${getHalloweenItemImage(g)}" alt="" onerror="this.onerror=null;this.src='${fallbackImg()}'">` +
            `</div>`
        );
    }).join('');

    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    void track.offsetWidth;

    requestAnimationFrame(() => {
        const firstItem = track.querySelector('.roulette-item');
        if (!firstItem) return;
        const itemRect = firstItem.getBoundingClientRect();
        const wrapRect = $('rouletteWrap').getBoundingClientRect();
        const step = itemRect.width + 8;
        const targetCenter = 6 + step * 42 + itemRect.width / 2;
        const offset = wrapRect.width / 2 - targetCenter;

        track.style.transition = 'transform 4s cubic-bezier(0.15, 0.85, 0.15, 1)';
        track.style.transform = `translateX(${offset}px)`;
    });

    let vc = 0;
    if (spinInterval) clearInterval(spinInterval);
    spinInterval = setInterval(() => {
        vibrate('light');
        vc++;
        if (vc > 8) { clearInterval(spinInterval); spinInterval = null; }
    }, 450);

    setTimeout(() => {
        if (spinInterval) { clearInterval(spinInterval); spinInterval = null; }
        vibrate('success');
        showWinResult(wonGift);
    }, 4500);
}

function showWinResult(gift) {
    $('rouletteWrap').classList.add('won');
    isOpening = false;

    const priceIcon = '/shared/pumpkin.png';

    $('modalWin').innerHTML = `
        <div class="modal-win-badge">Вы выиграли!</div>
        <div class="modal-win-media">
            <img class="modal-win-img" src="${getHalloweenItemImage(gift)}" alt="" onerror="this.onerror=null;this.src='${fallbackImg()}'">
        </div>
        <div class="modal-win-name">${esc(gift.name)}</div>
        <div class="modal-win-value">
            <img src="${priceIcon}" alt=""><span>${fmtStars(gift.price)}</span>
        </div>
        <div class="modal-win-btns">
            <button class="modal-win-btn" onclick="closeModalAndReset()">Забрать</button>
        </div>
    `;

    $('modalWin').style.display = 'block';
    $('modalWin').classList.add('modal-win');
}

function closeModalAndReset() {
    if (isOpening) return;
    $('caseModal').classList.remove('open', 'modal-open');
    currentCase = null;
    currentWinItems = [];
}

function closeModal() {
    if (isOpening) return;
    closeModalAndReset();
}

function updateHeaderUI() {
    const el = $('pumpkinDisplay');
    if (el) el.textContent = state.pumpkins.toLocaleString('ru-RU');
}

/* ═══════════ МАГАЗИН ═══════════ */
let brewIdx = [0, 1, 2];

function brewCard(slot) {
    const b = BREWS[brewIdx[slot]];
    return `<div class="hw-brew-card">
        <div class="hw-brew-nav">
            <button onclick="changeBrew(${slot}, -1)">❮</button>
            <div class="hw-potion"><img src="/shared/${b.icon}.png" alt="${b.name}" onerror="this.src='/shared/star.png'"></div>
            <button onclick="changeBrew(${slot}, 1)">❯</button>
        </div>
        <div class="hw-brew-name">${b.name}</div>
        <div class="hw-brew-time">Brew time ${b.time}</div>
        <button class="hw-brew-btn" onclick="buyBrew(${slot})">BREW <img src="/shared/pumpkin.png" alt=""> ${b.price.toLocaleString('ru-RU')}</button>
    </div>`;
}

function renderBrews() {
    const list = $('brewList');
    if (!list) return;
    let html = brewCard(0) + brewCard(1);
    html += state.brews.slot3Unlocked ? brewCard(2) : `
        <div class="hw-brew-card locked" onclick="unlockSlot3()">
            <div class="hw-lock-icon">🔒</div>
            <div class="hw-brew-name" style="margin-bottom:12px">Extra slot · ⚡ 149</div>
            <button class="hw-brew-btn unlock-btn">UNLOCK</button>
        </div>`;
    list.innerHTML = html;
}

function changeBrew(slot, dir) {
    brewIdx[slot] = (brewIdx[slot] + dir + BREWS.length) % BREWS.length;
    renderBrews();
}

async function buyBrew(slot) {
    const b = BREWS[brewIdx[slot]];
    try {
        await halloweenOperation('brew_buy', { brewId: b.type });
        showToast(`Зелье ${b.name} активировано!`, 'ok');
    } catch (error) {
        console.error('[hw] brew purchase failed:', error);
        showToast(error.message === 'HALLOWEEN_NOT_ENOUGH_PUMPKINS'
            ? 'Недостаточно тыкв!' : 'Не удалось купить зелье.', 'err');
    }
}

function unlockSlot3() {
    showToast('Слоты покупаются у @hazed_q', 'err');
}

/* ═══════════ КОЛЕСО ═══════════ */
const WHEEL_SECTORS = [
    { percent: 22, type: 'candy', val: 250 },
    { percent: 62, type: 'candy', val: 100 },
    { percent: 0.5, type: 'stars', val: 10000000, name: '10M ⭐' },
    { percent: 1.5, type: 'candy', val: 2500 },
    { percent: 4, type: 'candy', val: 1000 },
    { percent: 10, type: 'candy', val: 500 },
];

function drawWheel() {
    const spinner = $('wheelSpinner');
    if (!spinner) return;
    const C = 150, R = 138, step = 360 / WHEEL_SECTORS.length;
    const pt = (a, r) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
    const fills = ['#7C46C9', '#6B38B3', '#7C46C9', '#6B38B3', '#7C46C9', '#6B38B3'];
    let s = `<svg viewBox="0 0 300 300"><defs><radialGradient id="wg"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient></defs>
        <circle cx="${C}" cy="${C}" r="148" fill="#3A1D75" stroke="#A66BFF" stroke-width="3"/>`;
    WHEEL_SECTORS.forEach((x, i) => {
        const a0 = i * step, a1 = a0 + step, mid = a0 + step / 2;
        const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
        const star = x.type === 'stars';
        s += `<path d="M${C} ${C}L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z" fill="${star ? '#3B1A12' : fills[i]}" stroke="${star ? '#FFB347' : '#2A1257'}" stroke-width="${star ? 2.5 : 2}"/>
            <path d="M${C} ${C}L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z" fill="url(#wg)"/>`;
        const flip = mid > 90 && mid < 270 ? ` rotate(180 ${C} ${(C - 108)})` : '';
        const label = star ? '10M ⭐' : `Candy ×${x.val.toLocaleString('en-US')}`;
        const icon = star ? '💀' : '🍬';
        s += `<g transform="rotate(${mid} ${C} ${C})">
            <g transform="${flip.trim()}"><text x="${C}" y="${C - 104}" text-anchor="middle" font-size="13" fill="${star ? '#FFD75A' : '#fff'}" stroke="#1A0B2E" stroke-width="3" paint-order="stroke">${label}</text></g>
            <text x="${C}" y="${C - 68}" text-anchor="middle" font-size="26" transform="rotate(${mid > 90 && mid < 270 ? 180 : 0} ${C} ${C - 76})">${icon}</text>
            <text x="${C}" y="${C - 42}" text-anchor="middle" font-size="11" fill="#E4D7FF" stroke="#1A0B2E" stroke-width="2.5" paint-order="stroke" transform="rotate(${mid > 90 && mid < 270 ? 180 : 0} ${C} ${C - 46})">${x.percent}%</text></g>`;
    });
    s += `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#A66BFF" stroke-width="3"/>`;
    for (let k = 0; k < 12; k++) {
        const [px, py] = pt(k * 30 + 15, 143);
        s += `<text x="${px}" y="${py + 4}" text-anchor="middle" font-size="10">🎃</text>`;
    }
    spinner.innerHTML = s + '</svg>';
}

let wheelRot = 0, spinning = false;

function spinCooldownLeft() {
    if (!state.spinLastUsed) return 0;
    const left = SPIN_COOLDOWN_MS - (Date.now() - state.spinLastUsed);
    return left > 0 ? left : 0;
}

function updateSpinButton() {
    const btn = $('spinBtn');
    const timer = $('spinTimer');
    if (!btn) return;
    const left = spinCooldownLeft();

    if (left > 0) {
        btn.disabled = true;
        btn.textContent = 'WAIT';
        if (timer) timer.textContent = `Next free in ${formatTime(left)}`;
    } else {
        btn.disabled = false;
        btn.textContent = 'SPIN (Free)';
        if (timer) timer.textContent = '';
    }
}

function initSpinButton() {
    const btn = $('spinBtn');
    if (btn) btn.disabled = false;
    spinning = false;
    updateSpinButton();
}

async function spinWheel() {
    if (spinning) {
        console.warn('[hw] spinning was true, resetting to false');
        spinning = false;
    }

    const cooldown = spinCooldownLeft();

    if (cooldown > 0) {
        showToast(`Спин восстановится через ${formatTime(cooldown)}`, 'err');
        return;
    }

    spinning = true;
    $('spinBtn').disabled = true;
    try {
        const result = await halloweenOperation('wheel_spin');
        const reward = result.reward;
        const idx = WHEEL_SECTORS.findIndex(sector =>
            (sector.type === 'candy' ? 'pumpkins' : sector.type) === reward.type &&
            sector.val === reward.amount
        );
        if (idx < 0) throw new Error('HALLOWEEN_INVALID_WHEEL_RESULT');
        const step = 360 / WHEEL_SECTORS.length;
        wheelRot = Math.ceil(wheelRot / 360) * 360 + 360 * 6 -
            (idx * step + step / 2) + (Math.random() * 36 - 18);
        const spinner = $('wheelSpinner');
        if (spinner) {
            spinner.style.transition = 'transform 4.2s cubic-bezier(.12, .7, .1, 1)';
            spinner.style.transform = `rotate(${wheelRot}deg)`;
        }
        setTimeout(() => {
            spinning = false;
            const amount = Number(reward.amount).toLocaleString('ru-RU');
            showToast(reward.type === 'pumpkins' ? `Выпало ${amount} тыкв!` : `Выпало ${amount} ⭐!`, 'ok');
            refreshCurrency();
            updateSpinButton();
        }, 4300);
    } catch (error) {
        spinning = false;
        updateSpinButton();
        console.error('[hw] wheel spin failed:', error);
        showToast(error.message === 'HALLOWEEN_WHEEL_COOLDOWN'
            ? `Спин восстановится через ${formatTime(SPIN_COOLDOWN_MS)}`
            : 'Не удалось прокрутить колесо.', 'err');
    }
}

/* ═══════════ ПАСС ═══════════ */
function renderPass() {
    const freeTrack = $('passTrackFree');
    const proTrack = $('passTrackPro');
    if (!freeTrack || !proTrack) return;

    let freeHtml = '';
    PASS_REWARDS.forEach((r, i) => {
        const isUnlocked = state.xp >= r.xp;
        const isClaimed = state.passClaims.includes(`free:${i}`);
        const iconHtml = getRewardIcon(r);
        freeHtml += `
            <div class="hw-pass-item ${isUnlocked ? 'unlocked' : ''} ${isClaimed ? 'claimed' : ''} ${r.isMain ? 'main-prize' : ''}" onclick="claimPass('free', ${i})">
                <div class="hw-pass-xp">${r.xp.toLocaleString('ru-RU')} XP</div>
                <div class="hw-pass-icon">${iconHtml}</div>
                <div class="hw-pass-amount">${r.type === 'stars' || r.type === 'silver' ? r.amount.toLocaleString('ru-RU') : (r.type === 'pumpkins' ? r.amount : '')}</div>
                ${isClaimed ? '<div class="hw-pass-check">✓</div>' : ''}
            </div>
        `;
    });
    freeTrack.innerHTML = freeHtml;

    const proEnabled = HWConfig?.proPassEnabled === true;
    let proHtml = '';
    PRO_PASS_REWARDS.forEach((r, i) => {
        const iconHtml = getRewardIcon(r);
        const isUnlocked = proEnabled && state.xp >= r.xp;
        proHtml += `
            <div class="hw-pass-item pro-item ${r.isMain ? 'main-prize' : ''} ${isUnlocked ? 'unlocked' : ''}"
                 onclick="${proEnabled ? `claimPass('pro', ${i})` : 'showProMessage()'}">
                <div class="hw-pass-xp">${r.xp.toLocaleString('ru-RU')} XP</div>
                <div class="hw-pass-icon">${iconHtml}</div>
                <div class="hw-pass-amount">${r.type === 'stars' || r.type === 'silver' ? r.amount.toLocaleString('ru-RU') : (r.type === 'pumpkins' ? r.amount : '')}</div>
                ${proEnabled ? '' : '<div class="hw-pass-lock">🔒</div>'}
            </div>
        `;
    });
    proTrack.innerHTML = proHtml;
}

function getRewardIcon(r) {
    if (r.icon === 'star') return '<img src="/shared/star.png">';
    if (r.icon === 'silver') return '<img src="/shared/silver-star.svg">';
    if (r.icon === 'pumpkin') return '<img src="/shared/pumpkin.png" onerror="this.style.display=\'none\'">';
    return `<img src="/shared/${r.icon}.png" onerror="this.src='/shared/star.png'">`;
}

async function claimPass(type, idx) {
    const arr = type === 'free' ? PASS_REWARDS : PRO_PASS_REWARDS;
    const r = arr[idx];
    if (!r) return;
    if (state.xp < r.xp) return showToast('Недостаточно XP', 'err');
    const claimKey = `hwPassClaim_${type}_${idx}`;
    if (state.passClaims.includes(`${type}:${idx}`) || pendingPassClaims.has(claimKey)) return;
    pendingPassClaims.add(claimKey);

    try {
        await halloweenOperation('pass_claim', { passType: type, rewardIndex: idx });
        showToast('Награда получена!', 'ok');
        refreshCurrency();
    } catch (error) {
        console.error('[hw] pass reward failed:', error);
        showToast(error.message === 'HALLOWEEN_NOT_ENOUGH_XP'
            ? 'Недостаточно XP' : 'Не удалось выдать награду. Попробуйте ещё раз.', 'err');
    } finally {
        pendingPassClaims.delete(claimKey);
    }
}

function switchPassTab(tab) {
    document.querySelectorAll('.hw-pass-tab').forEach(t => t.classList.remove('active'));
    const freeTrack = $('passTrackFree');
    const proTrack = $('passTrackPro');
    const tabs = document.querySelectorAll('.hw-pass-tab');
    if (tab === 'free') {
        tabs[0]?.classList.add('active');
        if (freeTrack) freeTrack.style.display = 'flex';
        if (proTrack) proTrack.style.display = 'none';
    } else {
        tabs[1]?.classList.add('active');
        if (freeTrack) freeTrack.style.display = 'none';
        if (proTrack) proTrack.style.display = 'flex';
        if (HWConfig?.proPassEnabled !== true) showProMessage();
    }
}

function showProMessage() {
    const note = HWConfig?.proPassNote
        || 'Купить Pass можете у @hazed_q или на FunPay по ссылке: https://funpay.com/users/17563883/';
    showToast(note, 'ok');
}

/* ═══════════ ТАЙМЕРЫ ═══════════ */
function startTimers() {
    tickTimers();
    setInterval(tickTimers, 1000);
}

function tickTimers() {
    const timerEl = $('hwTimer');
    if (timerEl) {
        const left = EVENT_END - Date.now();
        timerEl.textContent = left > 0 ? `ENDS IN ${formatTime(left)}` : 'EVENT ENDED';
    }
    updateSpinButton();
}

function formatTime(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

/* ═══════════ ВИЗУАЛ ═══════════ */
function initLeaves() {
    const box = $('leaves');
    if (!box) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const L = ['🍁', '🍂', '🍁', '🍃', '🍂'];
    for (let i = 0; i < 22; i++) {
        const e = document.createElement('span');
        e.textContent = L[i % L.length];
        e.style.cssText = `left:${Math.random() * 100}%;font-size:${14 + Math.random() * 18}px;opacity:${.35 + Math.random() * .5};` +
            `animation-duration:${9 + Math.random() * 10}s,${2.5 + Math.random() * 3}s;animation-delay:${-Math.random() * 18}s,${-Math.random() * 4}s`;
        box.appendChild(e);
    }
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    if (!t) { console.log('[toast]', type, msg); return; }
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

/* ═══════════ ЭКСПОРТ ═══════════ */
window.openCaseModal = openCaseModal;
window.closeModal = closeModal;
window.closeModalAndReset = closeModalAndReset;
window.openCase = openCase;
window.spinWheel = spinWheel;
window.changeBrew = changeBrew;
window.buyBrew = buyBrew;
window.unlockSlot3 = unlockSlot3;
window.claimPass = claimPass;
window.switchPassTab = switchPassTab;
window.showProMessage = showProMessage;
window.getHalloweenItemImage = getHalloweenItemImage;

/* ═══════════ TRICK OR TREAT ═══════════ */
const TREAT_TIERS = [
    { from: 0, mult: 1, rate: 15 },
    { from: 30 * 60000, mult: 1.5, rate: 22 },
    { from: 60 * 60000, mult: 2, rate: 30 }
];
const TREAT_BATCH = 15;
let treat = { streakMs: 0, accrued: 0 };
let treatHiddenSince = null;
let treatPrevP = 0;

function treatTier(ms) {
    return ms >= TREAT_TIERS[2].from ? TREAT_TIERS[2] : ms >= TREAT_TIERS[1].from ? TREAT_TIERS[1] : TREAT_TIERS[0];
}

function initTreat() {
    syncHalloweenState().then(() => setTreatVisibility(document.hidden)).catch(error => {
        console.error('[hw] treat state sync failed:', error);
    });
    document.addEventListener('visibilitychange', handleTreatVisibilityChange);
}

function handleTreatVisibilityChange() {
    setTreatVisibility(document.hidden).catch(error => {
        console.error('[hw] treat visibility update failed:', error);
    });
}

async function setTreatVisibility(hidden) {
    if (treatSyncTimer) clearTimeout(treatSyncTimer);
    try {
        await halloweenOperation(hidden ? 'treat_start' : 'treat_stop');
        renderTreat();
    } finally {
        if (hidden) treatSyncTimer = setTimeout(() => {
            syncHalloweenState().catch(error => console.error('[hw] treat refresh failed:', error));
        }, 60_000);
    }
}

function renderTreat() {
    const activeElapsed = treatHiddenSince === null ? 0 : Math.min(
        12 * 60 * 60 * 1000, Math.max(0, Date.now() - treatHiddenSince)
    );
    const displayedStreak = treat.streakMs + activeElapsed;
    const displayedAccrued = treat.accrued + activeElapsed * (treatTier(displayedStreak).rate / 60_000);
    const tier = treatTier(displayedStreak);
    const batches = Math.floor(displayedAccrued / TREAT_BATCH);
    const p = (displayedAccrued % TREAT_BATCH) / TREAT_BATCH;
    const bar = $('treatBar');
    if (!bar) return;
    if (p < treatPrevP) {
        bar.classList.add('reset');
        bar.style.setProperty('--p', p);
        void bar.offsetWidth;
        bar.classList.remove('reset');
    } else {
        bar.style.setProperty('--p', p);
    }
    treatPrevP = p;

    const nextEl = $('treatNext');
    if (nextEl) {
        const left = Math.ceil((1 - p) * TREAT_BATCH / tier.rate * 60);
        nextEl.textContent = `Next +${TREAT_BATCH} in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }
    const rateEl = $('treatRate');
    if (rateEl) rateEl.innerHTML = `<img src="/shared/pumpkin.png" alt=""> +${tier.rate} per min <b>•</b> <em>x${tier.mult} rate</em>`;
    const onlineEl = $('treatOnline');
    if (onlineEl) onlineEl.innerHTML = `<em>Accumulated</em> ${Math.floor(displayedStreak / 60000)} min <b>•</b> <em>x${tier.mult}</em>`;
    const btn = $('treatClaim');
    if (btn) {
        btn.disabled = batches < 1;
        btn.innerHTML = `CLAIM <img src="/shared/pumpkin.png" alt=""> ${(batches * TREAT_BATCH).toLocaleString('ru-RU')}`;
    }
}

async function claimTreat() {
    try {
        const result = await halloweenOperation('treat_claim');
        const amount = Number(result.amount) || 0;
        if (amount < TREAT_BATCH) throw new Error('HALLOWEEN_INVALID_TREAT_RESULT');
        showToast(`Получено ${amount.toLocaleString('ru-RU')} тыкв!`, 'ok');
        vibrate('light');
    } catch (error) {
        console.error('[hw] treat claim failed:', error);
        showToast(error.message === 'HALLOWEEN_TREAT_NOT_READY'
            ? 'Первая партия ещё не готова' : 'Не удалось получить тыквы.', 'err');
    }
}
window.claimTreat = claimTreat;