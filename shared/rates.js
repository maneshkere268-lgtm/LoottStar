// shared/rates.js — курс LootStar ⭐ → Telegram Stars
(function () {
    'use strict';

    const DEFAULTS = {
        lootStarPerTelegramStar: 2_000_000,   // 10kk = 5 TG Stars
        minWithdrawTelegramStars: 25,
        starsPerTon: 2_000_000
    };

    let _rates = { ...DEFAULTS };
    let _loaded = false;
    let _loading = null;

    function applyRates(data) {
        if (!data) return;
        if (Number.isFinite(data.lootStarPerTelegramStar) && data.lootStarPerTelegramStar > 0) {
            _rates.lootStarPerTelegramStar = data.lootStarPerTelegramStar;
        }
        if (Number.isFinite(data.minWithdrawTelegramStars) && data.minWithdrawTelegramStars > 0) {
            _rates.minWithdrawTelegramStars = data.minWithdrawTelegramStars;
        }
        if (Number.isFinite(data.starsPerTon) && data.starsPerTon > 0) {
            _rates.starsPerTon = data.starsPerTon;
        }
        _loaded = true;
        window.dispatchEvent(new CustomEvent('ratesUpdated', { detail: { ..._rates } }));
    }

    async function loadRates() {
        if (_loading) return _loading;
        _loading = (async () => {
            try {
                const config = await window.LootStarAPI.getAppConfig('rates');
                applyRates(config.rates || {});
            } catch (e) {
                console.warn('[rates] load failed:', e);
                _loaded = true;
            }
            return _rates;
        })();
        const r = await _loading;
        _loading = null;
        return r;
    }

    function subscribeRates() {
        return loadRates();
    }

    function getRates() {
        return { ..._rates };
    }

    /** Сколько TG Stars получит игрок за N LootStar ⭐ (округление вниз). */
    function lootStarToTelegramStars(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        return Math.floor(amount / _rates.lootStarPerTelegramStar);
    }

    /** Сколько LootStar ⭐ нужно для N TG Stars. */
    function telegramStarsToLootStar(tg) {
        if (!Number.isFinite(tg) || tg <= 0) return 0;
        return Math.ceil(tg * _rates.lootStarPerTelegramStar);
    }

    /** Минимум к выводу в LootStar ⭐. */
    function minWithdrawLootStar() {
        return telegramStarsToLootStar(_rates.minWithdrawTelegramStars);
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!window.TG?.isTelegram) return;
        loadRates();
        subscribeRates();
    });

    window.Rates = {
        loadRates,
        subscribeRates,
        getRates,
        lootStarToTelegramStars,
        telegramStarsToLootStar,
        minWithdrawLootStar,
        isLoaded: () => _loaded
    };

    window.addEventListener('profileDataLoaded', () => {
        if (window.TG?.isTelegram && !_loaded) loadRates();
    });
})();