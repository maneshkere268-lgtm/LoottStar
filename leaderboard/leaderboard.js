// leaderboard.js — Лидерборд
const $ = id => document.getElementById(id);
let lbData = null;
let lbSort = 'stars';
const leaderboardRequests = new Map();
const LB_CACHE_KEY = 'lootstarLeaderboard';
const LB_CACHE_TTL_MS = 30_000;
const PRIZE_DEADLINE = Number(window.LOOTSTAR_CONFIG?.BALANCE_POOL_SEASON_DEADLINE) ||
    Date.parse('2026-12-01T00:00:00+03:00');
let prizeWinnerDocId = null;
let myDocId = null;
let countdownInterval = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();
    updatePrizeCountdown();
    countdownInterval = setInterval(updatePrizeCountdown, 1000);
    window.LootStarAPI.loadProfile()
        .then(() => window.refreshCurrencyUI())
        .catch(error => console.error('[leaderboard] profile load failed:', error));
    loadLeaderboard();
}

function updatePrizeCountdown() {
    const countdown = $('lbPrizeCountdown');
    if (!countdown) return;

    const remaining = PRIZE_DEADLINE - Date.now();
    if (remaining <= 0) {
        countdown.textContent = 'Итоги подведены';
        countdown.classList.add('finished');
        if (countdownInterval) clearInterval(countdownInterval);
        loadLeaderboard(true);
        return;
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    countdown.textContent = `До итогов: ${days} д ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} · 1 декабря, 00:00 МСК`;
}

async function loadLeaderboard(forceRefresh = false) {
    const sort = lbSort;
    if (leaderboardRequests.has(sort)) return leaderboardRequests.get(sort);

    const request = loadLeaderboardData(forceRefresh, sort);
    leaderboardRequests.set(sort, request);
    try {
        await request;
    } finally {
        if (leaderboardRequests.get(sort) === request) leaderboardRequests.delete(sort);
    }
}

async function loadLeaderboardData(forceRefresh, sort) {
    const box = $('lbContent');

    if (!window.Telegram?.WebApp?.initData) {
        box.innerHTML = `
            <div class="lb-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/></svg>
                <div>Открой приложение через Telegram,<br>чтобы участвовать в рейтинге игроков</div>
            </div>`;
        return;
    }

    let data = forceRefresh ? null : getCachedLeaderboard(sort);
    if (!data) {
        if (sort === lbSort) box.innerHTML = '<div class="lb-empty">Загрузка...</div>';
        try {
            data = await window.LootStarAPI.getLeaderboard(sort);
        } catch (error) {
            console.error('[leaderboard] API request failed:', error);
            if (sort === lbSort) {
                box.innerHTML = '<div class="lb-empty">Не удалось загрузить рейтинг. Попробуй позже.</div>';
            }
            return;
        }
        if (data) cacheLeaderboard(data, sort);
    }
    if (!data || !Array.isArray(data.users)) {
        if (sort === lbSort) {
            box.innerHTML = '<div class="lb-empty">Не удалось загрузить рейтинг. Попробуй позже.</div>';
        }
        return;
    }
    if (sort !== lbSort) return;
    lbData = data.users;
    myDocId = data.myDocId || null;
    prizeWinnerDocId = data.winnerDocId || null;
    renderLeaderboard();
}

function getCachedLeaderboard(sort) {
    try {
        const key = `${LB_CACHE_KEY}:${sort}`;
        const stored = sessionStorage.getItem(key)
            || (sort === 'stars' ? sessionStorage.getItem(LB_CACHE_KEY) : null);
        const cached = JSON.parse(stored || 'null');
        if (
            cached &&
            Date.now() - cached.savedAt < LB_CACHE_TTL_MS &&
            Array.isArray(cached.data?.users)
        ) {
            return cached.data;
        }
    } catch (e) {
        console.warn('[leaderboard] cache read failed:', e);
    }
    return null;
}

function cacheLeaderboard(data, sort) {
    try {
        sessionStorage.setItem(`${LB_CACHE_KEY}:${sort}`, JSON.stringify({
            savedAt: Date.now(),
            data
        }));
    } catch (e) {
        console.warn('[leaderboard] cache write failed:', e);
    }
}

function renderPrefix(prefix) {
    if (!prefix || typeof prefix !== 'object') return '';
    const text = String(prefix.text || '').trim();
    if (!text) return '';
    const color = prefix.color || '#FFB46B';
    const glow = prefix.glow === true;
    const style = `color:${color};${glow ? `text-shadow:0 0 10px ${color};` : ''}`;
    return `<span class="lb-prefix" style="${style}">${window.escapeHtml(text)}</span>`;
}

function renderLeaderboard() {
    const box = $('lbContent');
    if (!lbData || !lbData.length) {
        box.innerHTML = '<div class="lb-empty">Пока никого нет в рейтинге — стань первым!</div>';
        return;
    }

    const ROPEKO = window.LOOTSTAR_CONFIG?.ROPEKO_USERNAMES || new Set(['hazed_q', 'ropeko']);
    const ADMIN  = window.LOOTSTAR_CONFIG?.ADMIN_USERNAMES  || new Set(['hazed_q']);

    const isRopeko = u => ROPEKO.has((u.username || '').toLowerCase());
    const isAdmin  = u => ADMIN.has((u.username || '').toLowerCase());

    const normal = lbData.filter(u => !isRopeko(u));
    const premium = lbData.filter(u => isRopeko(u));

    const sorted = [...normal].sort((a, b) =>
        lbSort === 'silver' ? b.silver - a.silver : b.stars - a.stars
    );

    const icon = lbSort === 'silver' ? window.SILVER_ICON : window.STAR_ICON;

    let html = `<div class="lb-tabs">
        <button class="lb-tab ${lbSort === 'stars' ? 'active' : ''}" onclick="setLbSort('stars')">⭐ По звёздам</button>
        <button class="lb-tab silver ${lbSort === 'silver' ? 'active' : ''}" onclick="setLbSort('silver')">По серебру</button>
    </div>`;

    const top3 = sorted.slice(0, 3);
    if (top3.length === 3) {
        const order = [top3[1], top3[0], top3[2]];
        const classes = ['p2', 'p1', 'p3'];
        html += '<div class="lb-podium">';
        order.forEach((u, i) => {
            const val = lbSort === 'silver' ? u.silver : u.stars;
            const admin = isAdmin(u);
            const isPrizeWinner = lbSort === 'stars'
                && u.docId === (prizeWinnerDocId || sorted[0].docId);
            html += `
                <div class="lb-podium-item lb-podium ${classes[i]} ${admin ? 'lb-admin' : ''}">
                    <div class="lb-podium-avatar">${u.photoUrl ? `<img src="${u.photoUrl}" onerror="this.parentNode.textContent='${window.escapeHtml((u.name||'U')[0].toUpperCase())}'">` : window.escapeHtml((u.name || 'U')[0].toUpperCase())}${isPrizeWinner ? '<span class="lb-prize-badge"><img src="/shared/prize.png" alt="Приз"></span>' : ''}</div>
                    <div class="lb-podium-name">${renderPrefix(u.prefix)}${admin ? '<span class="lb-admin-badge">ADMIN</span>' : ''}${window.escapeHtml(u.name || 'Игрок')}</div>
                    <div class="lb-podium-val"><img src="${icon}">${window.formatStars(val)}</div>
                    <div class="lb-podium-bar">${classes[i] === 'p1' ? '🏆' : (classes[i] === 'p2' ? '2' : '3')}</div>
                </div>`;
        });
        html += '</div>';
    }

    const rest = sorted.slice(3);
    rest.forEach((u, i) => {
        const rank = i + 4;
        const val = lbSort === 'silver' ? u.silver : u.stars;
        const isMe = u.docId === myDocId;
        const admin = isAdmin(u);
        html += `
            <div class="lb-row ${isMe ? 'me' : ''} ${admin ? 'lb-admin' : ''}">
                <div class="lb-rank">${rank}</div>
                <div class="lb-avatar">${u.photoUrl ? `<img src="${u.photoUrl}" onerror="this.parentNode.textContent='${window.escapeHtml((u.name||'U')[0].toUpperCase())}'">` : window.escapeHtml((u.name || 'U')[0].toUpperCase())}</div>
                <div class="lb-info">
                    <div class="lb-name">${renderPrefix(u.prefix)}${admin ? '<span class="lb-admin-badge">ADMIN</span>' : ''}${window.escapeHtml(u.name || 'Игрок')}${isMe ? ' (вы)' : ''}</div>
                    <div class="lb-sub">${u.inventoryCount} предметов</div>
                </div>
                <div class="lb-value"><img src="${icon}">${window.formatCurrency(val)}</div>
            </div>`;
    });

    if (premium.length) {
        html += `
        <div class="lb-premium-section">
            <div class="lb-premium-title">💎 PREMIUM</div>
            ${premium.map(u => {
                const admin = isAdmin(u);
                return `
                <div class="lb-row lb-premium ${admin ? 'lb-admin' : ''}">
                    <div class="lb-rank">★</div>
                    <div class="lb-avatar">${u.photoUrl ? `<img src="${u.photoUrl}">` : window.escapeHtml((u.name || 'U')[0].toUpperCase())}</div>
                    <div class="lb-info">
                        <div class="lb-name">${renderPrefix(u.prefix)}${admin ? '<span class="lb-admin-badge">ADMIN</span>' : ''}${window.escapeHtml(u.name || 'Игрок')}</div>
                        <div class="lb-sub">Durov Figure (Ropeko) · Premium</div>
                    </div>
                    <div class="lb-value">🔒 Скрыт</div>
                </div>`;
            }).join('')}
        </div>`;
    }

    box.innerHTML = html;
}

function setLbSort(s) {
    if (s !== 'stars' && s !== 'silver') return;
    if (lbSort === s) return;
    lbSort = s;
    loadLeaderboard();
    window.vibrate?.('light');
}

window.loadLeaderboard = loadLeaderboard;
window.setLbSort = setLbSort;