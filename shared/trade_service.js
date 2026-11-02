(function () {
    'use strict';

    function api() {
        if (!window.LootStarAPI) throw new Error('TRADE_API_UNAVAILABLE');
        return window.LootStarAPI;
    }

    function isTradable(item) {
        if (!item || !item.id || !String(item.name || '').trim()) return false;
        if (item.currency && item.currency !== 'star') return false;
        if (item.saved || item.noSell || item.untradeable || item.limited || item.ropeko) return false;
        if (item.name === window.LOOTSTAR_CONFIG?.ROPEKO_ITEM_NAME) return false;
        return !['active', 'paused'].includes(item.staking?.status);
    }

    async function acceptAsSender(tradeId) {
        return api().operateTrade(tradeId, 'accept_sender');
    }

    async function escrowCounterOffer(tradeId, _actorId, selectedIds, stars) {
        return api().operateTrade(tradeId, 'counter', { itemIds: selectedIds, stars });
    }

    async function reject(tradeId) {
        return api().operateTrade(tradeId, 'reject');
    }

    async function complete(tradeId) {
        return api().operateTrade(tradeId, 'complete');
    }

    async function expire(tradeId) {
        return api().operateTrade(tradeId, 'expire');
    }

    window.TradeService = {
        isTradable,
        acceptAsSender,
        escrowCounterOffer,
        reject,
        complete,
        expire
    };
})();
