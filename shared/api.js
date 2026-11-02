// API transport for authenticated Telegram WebApp requests.
(function () {
    'use strict';

    const BASE_URL = window.LOOTSTAR_CONFIG?.API_BASE_URL || 'https://api.immortals-market.ru';

    class ApiError extends Error {
        constructor(status, code) {
            super(code || `HTTP_${status}`);
            this.name = 'ApiError';
            this.status = status;
            this.code = code || `HTTP_${status}`;
        }
    }

    function getInitData() {
        const initData = window.Telegram?.WebApp?.initData;
        if (typeof initData !== 'string' || !initData) {
            throw new ApiError(401, 'TELEGRAM_AUTH_REQUIRED');
        }
        return initData;
    }

    function createRequestId() {
        if (!window.crypto?.randomUUID) throw new Error('SECURE_UUID_UNAVAILABLE');
        return window.crypto.randomUUID();
    }

    async function request(path, { method = 'GET', body, requestId } = {}) {
        const headers = { Authorization: `tma ${getInitData()}` };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (requestId) headers['Idempotency-Key'] = requestId;

        const response = await window.fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        });
        let payload = null;
        if (response.status !== 204) {
            try {
                payload = await response.json();
            } catch (error) {
                throw new Error(`INVALID_API_RESPONSE:${response.status}`);
            }
        }
        if (!response.ok) {
            throw new ApiError(response.status, payload?.error);
        }
        return payload;
    }

    function dispatchProfile(user) {
        const stars = Number(user.stars) || 0;
        const silver = Number(user.silver) || 0;
        const inventory = Array.isArray(user.inventory) ? user.inventory : [];
        const collectionItems = Array.isArray(user.collection_items)
            ? user.collection_items
            : Array.isArray(user.collectionItems) ? user.collectionItems : [];
        const freeCaseUsage = user.free_case_usage || user.freeCaseUsage || {};
        const balancePool = user.balance_pool || user.balancePool || null;

        localStorage.setItem('userStars', String(stars));
        localStorage.setItem('userSilver', String(silver));
        localStorage.setItem('userPearl', String(Number(user.pearl) || 0));
        localStorage.setItem('userTurnover', String(Number(user.turnover) || 0));
        localStorage.setItem('silverTurnover', String(Number(user.silver_turnover ?? user.silverTurnover) || 0));
        localStorage.setItem('withdrawCycles', String(Number(user.withdraw_cycles ?? user.withdrawCycles) || 0));
        localStorage.setItem('userInventory', JSON.stringify(inventory));
        localStorage.setItem('userCollectionItems', JSON.stringify(collectionItems));
        localStorage.setItem('freeCaseUsage', JSON.stringify(freeCaseUsage));
        if (balancePool) localStorage.setItem('balancePoolStatus', JSON.stringify(balancePool));
        if (user.phone && typeof user.phone === 'object') {
            localStorage.setItem('userPhone', JSON.stringify(user.phone));
            if (user.phone.pending) localStorage.setItem('userPhonePending', JSON.stringify(user.phone.pending));
            else localStorage.removeItem('userPhonePending');
        }

        const banned = user.banned === true;
        if (banned) {
            localStorage.setItem('userBanned', '1');
            localStorage.setItem('userBanReason', String(user.ban_reason ?? user.banReason ?? 'Нарушение правил'));
            if (user.ban_until ?? user.banUntil) {
                localStorage.setItem('userBanUntil', String(user.ban_until ?? user.banUntil));
            } else {
                localStorage.removeItem('userBanUntil');
            }
            window.dispatchEvent(new CustomEvent('playerBanned', {
                detail: {
                    reason: user.ban_reason ?? user.banReason ?? 'Нарушение правил',
                    until: Number(user.ban_until ?? user.banUntil) || 0
                }
            }));
        } else {
            localStorage.removeItem('userBanned');
            localStorage.removeItem('userBanReason');
            localStorage.removeItem('userBanUntil');
            window.dispatchEvent(new CustomEvent('playerUnbanned', { detail: {} }));
        }

        window.dispatchEvent(new CustomEvent('profileDataLoaded', {
            detail: {
                source: 'api',
                stars,
                silver,
                turnover: Number(user.turnover) || 0,
                silverTurnover: Number(user.silver_turnover ?? user.silverTurnover) || 0,
                inventory,
                collectionItems,
                phone: user.phone,
                balancePool,
                banned,
                banReason: user.ban_reason ?? user.banReason ?? null
            }
        }));
        return user;
    }

    async function loadProfile() {
        const result = await request('/api/v1/me');
        dispatchProfile(result.user);
        return result.user;
    }

    async function getLeaderboard(sort = 'stars') {
        if (!['stars', 'silver'].includes(sort)) throw new Error('INVALID_LEADERBOARD_SORT');
        return request(`/api/v1/leaderboard?sort=${encodeURIComponent(sort)}`);
    }

    async function getLiveWins(limit = 20) {
        const safeLimit = Number.isSafeInteger(limit) ? Math.min(30, Math.max(1, limit)) : 20;
        return request(`/api/v1/live-wins?limit=${safeLimit}`);
    }

    async function getBalanceLedger(limit = 100) {
        const safeLimit = Number.isSafeInteger(limit) ? Math.min(200, Math.max(1, limit)) : 100;
        return request(`/api/v1/balance/ledger?limit=${safeLimit}`);
    }

    async function getAppConfig(key) {
        if (!['rates', 'rtp', 'tech'].includes(key)) throw new Error('INVALID_APP_CONFIG_KEY');
        return request(`/api/v1/app-config/${encodeURIComponent(key)}`);
    }

    async function buyIndexItem(itemName, requestId) {
        return request('/api/v1/shop/buy', {
            method: 'POST',
            body: { itemName },
            requestId: requestId || createRequestId()
        });
    }

    async function settleRopeko(requestId) {
        return request('/api/v1/profile/ropeko/settle', {
            method: 'POST',
            body: {},
            requestId: requestId || createRequestId()
        });
    }

    async function openCase(caseId, quantity, requestId) {
        return request('/api/v1/cases/open', {
            method: 'POST',
            body: { caseId, quantity },
            requestId: requestId || createRequestId()
        });
    }

    async function sellItems(itemIds, requestId) {
        return request('/api/v1/inventory/sell', {
            method: 'POST',
            body: { itemIds },
            requestId: requestId || createRequestId()
        });
    }

    async function setItemSaved(itemId, saved, requestId) {
        return request('/api/v1/inventory/save', {
            method: 'POST',
            body: { itemId, saved },
            requestId: requestId || createRequestId()
        });
    }

    async function redeemPromo(code, requestId) {
        return request('/api/v1/promos/redeem', {
            method: 'POST',
            body: { code },
            requestId: requestId || createRequestId()
        });
    }

    async function getDailyTasks() {
        return request('/api/v1/tasks/daily');
    }

    async function claimDailyTask(taskId, requestId) {
        return request('/api/v1/tasks/daily/claim', {
            method: 'POST',
            body: { taskId },
            requestId: requestId || createRequestId()
        });
    }

    async function submitWithdrawal(amount, requestId) {
        return request('/api/v1/withdrawals', {
            method: 'POST',
            body: { amount },
            requestId: requestId || createRequestId()
        });
    }

    async function operateStaking(action, itemId, amount, requestId) {
        if (!['activate', 'stop', 'top_up', 'claim'].includes(action)) {
            throw new Error('INVALID_STAKING_ACTION');
        }
        return request('/api/v1/staking/operate', {
            method: 'POST',
            body: { action, itemId, ...(amount !== undefined ? { amount } : {}) },
            requestId: requestId || createRequestId()
        });
    }

    async function operatePhone(action, options = {}, requestId) {
        if (!['roll', 'resolve', 'sell', 'install'].includes(action)) {
            throw new Error('INVALID_PHONE_ACTION');
        }
        return request('/api/v1/profile/phone/operate', {
            method: 'POST',
            body: { action, ...options },
            requestId: requestId || createRequestId()
        });
    }

    async function searchTradeUsers(query) {
        return request(`/api/v1/trades/users?q=${encodeURIComponent(query)}`);
    }

    async function prepareTradeInventory() {
        return request('/api/v1/trades/prepare', { method: 'POST', body: {} });
    }

    async function getMyTrades(status = 'pending') {
        return request(`/api/v1/trades/me?status=${encodeURIComponent(status)}`);
    }

    async function getTrade(tradeId) {
        return request(`/api/v1/trades/${encodeURIComponent(tradeId)}`);
    }

    async function createTradeOffer(targetUserId, itemIds, stars, requestId) {
        return request('/api/v1/trades', {
            method: 'POST',
            body: { targetUserId: String(targetUserId), itemIds, stars },
            requestId: requestId || createRequestId()
        });
    }

    async function operateTrade(tradeId, action, options = {}, requestId) {
        if (!['counter', 'accept_sender', 'complete', 'reject', 'expire'].includes(action)) {
            throw new Error('INVALID_TRADE_ACTION');
        }
        return request(`/api/v1/trades/${encodeURIComponent(tradeId)}/operate`, {
            method: 'POST',
            body: { action, ...options },
            requestId: requestId || createRequestId()
        });
    }

    async function getReferralProfile() {
        return request('/api/v1/referrals/me');
    }

    async function getEventConfig() {
        return request('/api/v1/app-config/events');
    }

    async function getHalloweenState() {
        return request('/api/v1/halloween/state');
    }

    async function operateHalloween(action, options = {}, requestId) {
        if (!['case_open', 'wheel_spin', 'pass_claim', 'treat_start',
            'treat_stop', 'treat_claim', 'brew_buy'].includes(action)) {
            throw new Error('INVALID_HALLOWEEN_ACTION');
        }
        return request('/api/v1/halloween/operate', {
            method: 'POST',
            body: { action, ...options },
            requestId: requestId || createRequestId()
        });
    }

    async function joinReferral(referrerId, requestId) {
        return request('/api/v1/referrals/join', {
            method: 'POST',
            body: { referrerId: String(referrerId) },
            requestId: requestId || createRequestId()
        });
    }

    async function upgradeItem(itemId, targetName, requestId) {
        return request('/api/v1/inventory/upgrade', {
            method: 'POST',
            body: { itemId, targetName },
            requestId: requestId || createRequestId()
        });
    }

    async function craftItems(itemIds, currency, requestId) {
        return request('/api/v1/inventory/craft', {
            method: 'POST',
            body: { itemIds, currency },
            requestId: requestId || createRequestId()
        });
    }

    async function playBags(amount, currency, requestId) {
        return request('/api/v1/games/bags/open', {
            method: 'POST',
            body: { amount, currency },
            requestId: requestId || createRequestId()
        });
    }

    async function getCurrentFishing() {
        return request('/api/v1/games/fishing/current');
    }

    async function startFishing(amount, currency, requestId) {
        return request('/api/v1/games/fishing/start', {
            method: 'POST',
            body: { amount, currency },
            requestId: requestId || createRequestId()
        });
    }

    async function continueFishing(gameId, requestId) {
        return request('/api/v1/games/fishing/continue', {
            method: 'POST',
            body: { gameId },
            requestId: requestId || createRequestId()
        });
    }

    async function cashoutFishing(gameId, requestId) {
        return request('/api/v1/games/fishing/cashout', {
            method: 'POST',
            body: { gameId },
            requestId: requestId || createRequestId()
        });
    }

    async function getCurrentMines() {
        return request('/api/v1/games/mines/current');
    }

    async function startMines(amount, currency, minesCount, requestId) {
        return request('/api/v1/games/mines/start', {
            method: 'POST',
            body: { amount, currency, minesCount },
            requestId: requestId || createRequestId()
        });
    }

    async function minesAction(action, gameId, cell, requestId) {
        if (!['reveal', 'cashout'].includes(action)) throw new Error('INVALID_MINES_ACTION');
        return request(`/api/v1/games/mines/${action}`, {
            method: 'POST',
            body: action === 'reveal' ? { gameId, cell } : { gameId },
            requestId: requestId || createRequestId()
        });
    }

    async function spinSlots(amount, currency, requestId) {
        return request('/api/v1/games/slots/spin', {
            method: 'POST',
            body: { amount, currency },
            requestId: requestId || createRequestId()
        });
    }

    async function dropPlinko(amount, currency, difficulty, requestId) {
        return request('/api/v1/games/plinko/drop', {
            method: 'POST',
            body: { amount, currency, difficulty },
            requestId: requestId || createRequestId()
        });
    }

    async function getCurrentCrash() {
        return request('/api/v1/games/crash/current');
    }

    async function startCrash(amount, currency, requestId) {
        return request('/api/v1/games/crash/start', {
            method: 'POST',
            body: { amount, currency },
            requestId: requestId || createRequestId()
        });
    }

    async function cashoutCrash(gameId, requestId) {
        return request('/api/v1/games/crash/cashout', {
            method: 'POST',
            body: { gameId },
            requestId: requestId || createRequestId()
        });
    }

    function applyBalanceResult(result) {
        if (result.stars !== undefined) localStorage.setItem('userStars', String(Number(result.stars) || 0));
        if (result.silver !== undefined) localStorage.setItem('userSilver', String(Number(result.silver) || 0));
        if (result.silverTurnover !== undefined) {
            localStorage.setItem('silverTurnover', String(Number(result.silverTurnover) || 0));
        }
        window.dispatchEvent(new CustomEvent('profileDataLoaded', {
            detail: {
                source: 'api',
                stars: Number(localStorage.getItem('userStars')) || 0,
                silver: Number(localStorage.getItem('userSilver')) || 0,
                silverTurnover: Number(localStorage.getItem('silverTurnover')) || 0
            }
        }));
    }

    function applyCaseResult(result) {
        const currencyKey = result.currency === 'silver' ? 'userSilver' : 'userStars';
        localStorage.setItem(currencyKey, String(Number(result.balance) || 0));
        localStorage.setItem('userInventory', JSON.stringify(result.inventory || []));
        localStorage.setItem('userCollectionItems', JSON.stringify(result.collectionItems || []));
        localStorage.setItem('freeCaseUsage', JSON.stringify(result.freeCaseUsage || {}));
        window.dispatchEvent(new CustomEvent('profileDataLoaded', {
            detail: {
                source: 'api',
                stars: Number(localStorage.getItem('userStars')) || 0,
                silver: Number(localStorage.getItem('userSilver')) || 0,
                inventory: result.inventory || [],
                collectionItems: result.collectionItems || []
            }
        }));
    }

    function applyInventoryResult(result) {
        localStorage.setItem('userStars', String(Number(result.stars) || 0));
        localStorage.setItem('userSilver', String(Number(result.silver) || 0));
        localStorage.setItem('userInventory', JSON.stringify(result.inventory || []));
        window.dispatchEvent(new CustomEvent('profileDataLoaded', {
            detail: {
                source: 'api',
                stars: Number(result.stars) || 0,
                silver: Number(result.silver) || 0,
                inventory: result.inventory || []
            }
        }));
    }

    function applyPhoneResult(result) {
        localStorage.setItem('userStars', String(Number(result.stars) || 0));
        localStorage.setItem('userInventory', JSON.stringify(result.inventory || []));
        localStorage.setItem('userPhone', JSON.stringify(result.phone));
        if (result.phone?.pending) localStorage.setItem('userPhonePending', JSON.stringify(result.phone.pending));
        else localStorage.removeItem('userPhonePending');
        window.dispatchEvent(new CustomEvent('profileDataLoaded', {
            detail: {
                source: 'api',
                stars: Number(result.stars) || 0,
                inventory: result.inventory || [],
                phone: result.phone
            }
        }));
    }

    function applyHalloweenResult(result) {
        localStorage.setItem('halloweenPumpkins', String(Number(result.pumpkins) || 0));
        localStorage.setItem('halloweenXP', String(Number(result.halloweenXP) || 0));
        if (result.state) localStorage.setItem('halloweenState', JSON.stringify(result.state));
        if (result.stars !== undefined) localStorage.setItem('userStars', String(Number(result.stars) || 0));
        if (result.silver !== undefined) localStorage.setItem('userSilver', String(Number(result.silver) || 0));
        if (Array.isArray(result.inventory)) localStorage.setItem('userInventory', JSON.stringify(result.inventory));
        window.dispatchEvent(new CustomEvent('profileDataLoaded', {
            detail: {
                source: 'api',
                stars: Number(result.stars) || 0,
                silver: Number(result.silver) || 0,
                inventory: result.inventory || [],
                halloweenPumpkins: Number(result.pumpkins) || 0,
                halloweenXP: Number(result.halloweenXP) || 0
            }
        }));
        return result;
    }

    window.LootStarAPI = {
        ApiError,
        createRequestId,
        request,
        loadProfile,
        getLeaderboard,
        getLiveWins,
        getBalanceLedger,
        getAppConfig,
        buyIndexItem,
        settleRopeko,
        openCase,
        sellItems,
        setItemSaved,
        redeemPromo,
        getDailyTasks,
        claimDailyTask,
        submitWithdrawal,
        operateStaking,
        operatePhone,
        searchTradeUsers,
        prepareTradeInventory,
        getMyTrades,
        getTrade,
        createTradeOffer,
        operateTrade,
        getReferralProfile,
        joinReferral,
        getEventConfig,
        getHalloweenState,
        operateHalloween,
        upgradeItem,
        craftItems,
        playBags,
        getCurrentFishing,
        startFishing,
        continueFishing,
        cashoutFishing,
        getCurrentMines,
        startMines,
        minesAction,
        spinSlots,
        dropPlinko,
        getCurrentCrash,
        startCrash,
        cashoutCrash,
        applyBalanceResult,
        dispatchProfile,
        applyCaseResult,
        applyInventoryResult,
        applyPhoneResult,
        applyHalloweenResult
    };
})();
