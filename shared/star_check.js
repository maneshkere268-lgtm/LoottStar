// shared/star_check.js — единая точка определения типа выигрыша
// Подключать ВЕЗДЕ после config.js/currency.js, но ДО локальных скриптов.
//
// Логика:
//   • Если ставка в серебре — подарок НЕ выдаётся, модалка выигрыша НЕ показывается.
//     Игрок получает выигрыш СЕРЕБРОМ, баланс обновляется молча.
//   • Если ставка в звёздах — выдаётся подарок, показывается модалка, как обычно.
//
// Экспорт: window.StarCheck

(function () {
    const STAR   = 'star';
    const SILVER = 'silver';

    /* ═══════════════════════════════════════════════════════════
     * ОПРЕДЕЛЕНИЕ ВАЛЮТЫ
     * ═══════════════════════════════════════════════════════════ */
    function detectCurrency(gift, source) {
        if (gift && gift.currency === SILVER) return SILVER;
        if (gift && gift.currency === STAR)   return STAR;
        if (source && source.currency === SILVER) return SILVER;
        if (source && source.currency === STAR)   return STAR;
        return STAR;
    }

    function getRate(currency) {
        return currency === SILVER ? 125 : 125;
    }

    function getValue(gift, currency) {
        const c = currency || detectCurrency(gift);
        return Math.round((gift.price || 0) * getRate(c));
    }

    function getIcon(currency) {
        if (currency === SILVER) return window.SILVER_ICON || '/shared/silver-star.svg';
        return window.STAR_ICON || '/shared/star.png';
    }

    /* ═══════════════════════════════════════════════════════════
     * ПОКАЗЫВАТЬ ЛИ МОДАЛКУ ВЫИГРЫША?
     * ═══════════════════════════════════════════════════════════
     * Если выигрыш серебряный (ставка была в серебре) — НЕ показываем.
     * Если выигрыш — предмет (за звёзды) — показываем.
     *
     * Можно передать массив выигрышей — вернёт true, только если
     * ХОТЯ БЫ ОДИН выигрыш является подарком (есть что показывать).
     */
    function shouldShowWinModal(giftOrResults, source) {
        // Массив результатов
        if (Array.isArray(giftOrResults)) {
            return giftOrResults.some(r => {
                if (!r) return false;
                if (r.type === 'gift') return true;
                if (r.type === 'silver') return false;
                // Сырой gift
                return detectCurrency(r, source) !== SILVER;
            });
        }

        // Объект-результат от resolveWin
        if (giftOrResults && giftOrResults.type) {
            return giftOrResults.type === 'gift';
        }

        // Сырой подарок
        return detectCurrency(giftOrResults, source) !== SILVER;
    }

    /* ═══════════════════════════════════════════════════════════
     * ГЛАВНАЯ ФУНКЦИЯ: что выдавать за выигрыш?
     * ═══════════════════════════════════════════════════════════
     * Возвращает:
     *   { type: 'gift',   currency, value, item }       — выдать предмет, показать модалку
     *   { type: 'silver', currency, value, multiplier } — начислить серебро, БЕЗ модалки
     */
    function resolveWin(gift, source) {
        const currency = detectCurrency(gift, source);

        if (currency === SILVER) {
            const value = getValue(gift, SILVER);
            return {
                type: 'silver',
                currency: SILVER,
                value: value,
                multiplier: 1,
                showModal: false,
                giftName: gift.name,
                giftPrice: gift.price
            };
        }

        const value = getValue(gift, STAR);
        return {
            type: 'gift',
            currency: STAR,
            value: value,
            showModal: true,
            item: {
                id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                name: gift.name,
                price: gift.price,
                stars: value,
                value: value,
                currency: STAR,
                image: gift.image || (window.getGiftImageByName
                    ? window.getGiftImageByName(gift.name, gift.price)
                    : '/shared/star.png'),
                source: source?.id || source?.name || null,
                timestamp: Date.now()
            }
        };
    }

    /* ═══════════════════════════════════════════════════════════
     * ВЫДАЧА ВЫИГРЫША
     * ═══════════════════════════════════════════════════════════
     * Применяет resolveWin:
     *   • gift   → кладёт предмет в инвентарь, возвращает { type, currency, value, item, showModal: true }
     *   • silver → начисляет серебро молча, возвращает { type, currency, value, item: null, showModal: false }
     */
    async function grantWin(gift, source) {
        const result = resolveWin(gift, source);

        if (result.type === 'silver') {
            const saved = await window.awardGamePayout('silver', result.value);
            if (!saved) throw new Error('Failed to persist silver reward');
            window.refreshCurrencyUI?.();

            pushWinHistory({
                type: 'silver',
                value: result.value,
                giftName: gift.name,
                ts: Date.now()
            });

            // Показываем тост вместо модалки
            if (window.showToast) {
                window.showToast(
                    `+${window.formatStars ? window.formatStars(result.value) : result.value} серебра`,
                    'ok'
                );
            }

            return {
                type: 'silver',
                currency: SILVER,
                value: result.value,
                item: null,
                showModal: false
            };
        }

        const saved = await window.awardGamePayout('star', 0, result.item);
        if (!saved) throw new Error('Failed to persist inventory reward');

        pushWinHistory({
            type: 'gift',
            value: result.value,
            itemId: result.item.id,
            giftName: result.item.name,
            ts: Date.now()
        });

        return {
            type: 'gift',
            currency: STAR,
            value: result.value,
            item: result.item,
            showModal: true
        };
    }

    /* ═══════════════════════════════════════════════════════════
     * ВСПОМОГАТЕЛЬНЫЕ
     * ═══════════════════════════════════════════════════════════ */
    function getInventory() {
        try {
            const inv = JSON.parse(localStorage.getItem('userInventory') || '[]');
            return Array.isArray(inv) ? inv : [];
        } catch (e) { return []; }
    }

    function pushWinHistory(record) {
        try {
            const history = JSON.parse(localStorage.getItem('winHistory') || '[]');
            history.push(record);
            if (history.length > 200) history.splice(0, history.length - 200);
            localStorage.setItem('winHistory', JSON.stringify(history));
        } catch (e) {}
    }

    function currencyName(currency) {
        return currency === SILVER ? 'серебра' : 'звёзд';
    }

    function formatValue(value, currency) {
        const formatted = window.formatStars ? window.formatStars(value) : value.toLocaleString('ru-RU');
        return `${formatted} ${currencyName(currency)}`;
    }

    /* ═══════════════════════════════════════════════════════════
     * ЭКСПОРТ
     * ═══════════════════════════════════════════════════════════ */
    window.StarCheck = {
        STAR,
        SILVER,
        detectCurrency,
        getRate,
        getValue,
        getIcon,
        shouldShowWinModal,
        resolveWin,
        grantWin,
        getInventory,
        pushWinHistory,
        currencyName,
        formatValue
    };
})();