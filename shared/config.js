// config.js — общие константы LootStar
// Подключать ПЕРВЫМ на всех страницах.

window.LOOTSTAR_CONFIG = {
    API_BASE_URL: 'https://api.immortals-market.ru',
    BALANCE_POOL_LIMIT: 750_000_000,
    BALANCE_POOL_WINDOW_MS: 24 * 60 * 60 * 1000,
    BALANCE_POOL_SEASON_DEADLINE: Date.parse('2026-12-01T00:00:00+03:00'), // обновлять при запуске нового сезона
    /* ═══ Базовые ═══ */
    TON_TO_STARS: 125,
    STAR_ICON: '/shared/star.png',
    SILVER_ICON: '/shared/silver-star.svg',
    GIFT_FALLBACK: '/shared/star.png',
    ROOT_ITEMS: new Set(['Bear', 'Gift', 'Cake', 'Trophy']),
    MIN_PRICES: {
        'Bear': 15,
        'Gift': 25,
        'Cake': 50,
        'Trophy': 100
    },

    /* ═══ LIMITED / Ropeko ═══ */
    ROPEKO_USERNAMES: new Set(['hazed_q', 'ropeko']),
    ADMIN_USERNAMES:  new Set(['hazed_q']),
    ROPEKO_ITEM_NAME: 'Durov Figure (Ropeko)',
    ROPEKO_ITEM_PRICE: 50_000_000,
    ROPEKO_ITEM_IMAGE: '/images/DurovFigureRopeko.png',
    ROPEKO_DAILY_PERCENT: 0.10,
    ROPEKO_LIFETIME_MS: 3 * 30 * 24 * 60 * 60 * 1000 // ~90 дней
};

window.TON_TO_STARS   = window.LOOTSTAR_CONFIG.TON_TO_STARS;
window.STAR_ICON      = window.LOOTSTAR_CONFIG.STAR_ICON;
window.SILVER_ICON    = window.LOOTSTAR_CONFIG.SILVER_ICON;
window.GIFT_FALLBACK  = window.LOOTSTAR_CONFIG.GIFT_FALLBACK;
window.ROOT_ITEMS     = window.LOOTSTAR_CONFIG.ROOT_ITEMS;
window.MIN_PRICES     = window.LOOTSTAR_CONFIG.MIN_PRICES;

const GAME_MAX_BET = 50_000_000;
const GAME_MAX_PAYOUT = 250_000_000;
window.GameLimits = Object.freeze({
    MAX_BET: GAME_MAX_BET,
    MAX_PAYOUT: GAME_MAX_PAYOUT,
    capBet(amount) {
        const value = Number(amount);
        return Number.isFinite(value) ? Math.min(GAME_MAX_BET, Math.max(0, Math.floor(value))) : 0;
    },
    capPayout(amount) {
        const value = Number(amount);
        return Number.isFinite(value) ? Math.min(GAME_MAX_PAYOUT, Math.max(0, Math.floor(value))) : 0;
    },
    maxMultiplier(amount) {
        const bet = this.capBet(amount);
        return bet > 0 ? Math.floor((GAME_MAX_PAYOUT / bet) * 100) / 100 : 0;
    }
});

/* ═══════════ УТИЛИТЫ ═══════════ */

window.normalizeApostrophes = function (str) {
    return String(str || '').replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'");
};

window.encodePathPart = function (str) {
    return encodeURIComponent(window.normalizeApostrophes(String(str).trim()));
};

window.formatStars = function (stars) {
    return Math.round(stars).toLocaleString('ru-RU');
};

window.escapeHtml = function (str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
};

window.vibrate = function (style) {
    try {
        if (navigator.vibrate) {
            navigator.vibrate(
                style === 'success' ? [30, 20, 50] :
                style === 'error'   ? [60, 30, 60] :
                15
            );
        }
    } catch (e) {}
};

window.formatCurrency = function (value) {
    return Math.round(value || 0).toLocaleString('ru-RU');
};

window.formatCurrency = window.formatStars;