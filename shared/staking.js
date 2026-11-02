// Server-authoritative staking operations for Durov figure gifts.
(function () {
    'use strict';

    const SETTLE_INTERVAL_MS = 60_000;
    const inFlight = new Set();

    function isStakeable(item) {
        if (!item || !item.name) return false;
        if (item.noSell === true || item.untradeable === true || item.limited === true) return false;
        if (item.noStake === true) return false;
        return item.name.toLowerCase().includes('durov figure');
    }

    function getRatePerSec(basePrice) {
        return (basePrice * 3) / (3 * 24 * 60 * 60);
    }

    function readInventory() {
        try {
            const raw = localStorage.getItem('userInventory');
            const inventory = raw ? JSON.parse(raw) : [];
            return Array.isArray(inventory) ? inventory : [];
        } catch (error) {
            console.error('[staking] invalid local inventory:', error);
            return [];
        }
    }

    function showOperationError(error) {
        const messages = {
            ACCOUNT_BANNED: 'Операции недоступны для заблокированного аккаунта.',
            BALANCE_POOL_EXHAUSTED: 'Лимит операций временно исчерпан.',
            BALANCE_POOL_LIMIT: 'Операция превышает доступный лимит.',
            BALANCE_SEASON_LOCKED: 'Операции с балансом сейчас заблокированы.',
            INSUFFICIENT_FUNDS: 'Недостаточно звёзд для пополнения.',
            ITEM_NOT_STAKEABLE: 'Этот подарок нельзя активировать.',
            ITEMS_NOT_FOUND: 'Предмет больше не найден в инвентаре.',
            STAKE_NOT_ACTIVE: 'Стейкинг уже остановлен.',
            TELEGRAM_AUTH_REQUIRED: 'Откройте профиль через Telegram, чтобы продолжить.'
        };
        window.showToast?.(messages[error?.code] || 'Не удалось выполнить операцию стейкинга.', 'err');
    }

    async function operate(action, itemId, amount) {
        if (inFlight.has(itemId)) return null;
        inFlight.add(itemId);
        try {
            const result = await window.LootStarAPI.operateStaking(action, itemId, amount);
            window.LootStarAPI.applyInventoryResult(result);
            return result;
        } catch (error) {
            console.error(`[staking] ${action} failed:`, error);
            showOperationError(error);
            return null;
        } finally {
            inFlight.delete(itemId);
        }
    }

    async function settleActiveStakes() {
        const activeItems = readInventory().filter(item =>
            item?.staking?.status === 'active' && typeof item.id === 'string'
        );
        for (const item of activeItems) {
            await operate('claim', item.id);
        }
    }

    window.Staking = {
        isStakeable,
        getRatePerSec,

        async activate(itemId) {
            const item = readInventory().find(candidate => candidate.id === itemId);
            if (!item) {
                window.showToast?.('Предмет не найден в инвентаре', 'err');
                return false;
            }
            if (!isStakeable(item)) {
                window.showToast?.('Этот предмет нельзя активировать', 'err');
                return false;
            }
            const result = await operate('activate', itemId);
            if (!result) return false;
            window.showToast?.(result.expired ? 'Срок стейкинга истёк, остаток начислен' : 'Подарок активирован!', 'ok');
            return true;
        },

        async stop(itemId) {
            const result = await operate('stop', itemId);
            if (!result) return false;
            window.showToast?.(result.expired ? 'Срок стейкинга завершён, остаток начислен' : 'Подарок остановлен', 'ok');
            return true;
        },

        async topUp(itemId, amount) {
            if (!Number.isSafeInteger(amount) || amount <= 0) {
                window.showToast?.('Введите корректную сумму', 'err');
                return false;
            }
            const result = await operate('top_up', itemId, amount);
            if (!result) return false;
            window.showToast?.(
                result.expired
                    ? 'Срок стейкинга завершён, остаток начислен'
                    : `Добавлено ${window.formatStars(result.amountAdded)} ⭐`,
                'ok'
            );
            return true;
        }
    };

    window.setInterval(settleActiveStakes, SETTLE_INTERVAL_MS);
})();
