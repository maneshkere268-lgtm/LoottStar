// Ropeko rewards are calculated and persisted by the API.
(function () {
    'use strict';

    const ITEM_NAME = 'Durov Figure (Ropeko)';
    const PENDING_KEY = 'pendingRopekoSettlement';
    const allowedUsers = window.LOOTSTAR_CONFIG?.ROPEKO_USERNAMES;
    let settlementInFlight = false;

    function isEligible() {
        const username = String(window.TG?.user?.username || '').replace(/^@/, '').toLowerCase();
        return allowedUsers?.has(username) === true;
    }

    function applyResult(result) {
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
        window.updateProfileUI?.();
        window.refreshCurrencyUI?.();
    }

    async function settle() {
        if (!isEligible() || !window.TG?.isTelegram || settlementInFlight) return;
        if (!window.LootStarAPI?.settleRopeko || !window.LootStarAPI?.createRequestId) {
            console.error('[ropeko] API client is unavailable');
            return;
        }
        settlementInFlight = true;
        let requestId = sessionStorage.getItem(PENDING_KEY);
        if (!requestId) {
            requestId = window.LootStarAPI.createRequestId();
            sessionStorage.setItem(PENDING_KEY, requestId);
        }
        try {
            const result = await window.LootStarAPI.settleRopeko(requestId);
            sessionStorage.removeItem(PENDING_KEY);
            applyResult(result);
        } catch (error) {
            if (error.status && error.status < 500) sessionStorage.removeItem(PENDING_KEY);
            console.error('[ropeko] Server settlement failed:', error);
        } finally {
            settlementInFlight = false;
        }
    }

    window.Ropeko = { ITEM_NAME, settle };
    document.addEventListener('DOMContentLoaded', settle);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) settle();
    });
    window.setInterval(settle, 30_000);
})();
