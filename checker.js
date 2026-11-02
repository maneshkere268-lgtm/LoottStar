(function () {
    'use strict';

    const currencyLabels = {
        stars: { label: 'Звёзды', icon: '/shared/star.png' },
        star: { label: 'Звёзды', icon: '/shared/star.png' },
        silver: { label: 'Серебро', icon: '/shared/silver-star.svg' },
        pearl: { label: 'Pearl', icon: '/shared/pearl.png' }
    };

    function safeNumber(value) {
        const number = Number(value || 0);
        return Number.isFinite(number) ? Math.floor(number).toLocaleString('ru-RU') : '0';
    }

    function render(entries) {
        const container = document.getElementById('checkerEntries');
        if (!entries.length) {
            container.innerHTML = '<p class="checker-empty">Серверных записей пока нет.</p>';
            return;
        }

        container.innerHTML = entries.map(entry => {
            const currency = currencyLabels[entry.currency] || currencyLabels.stars;
            const incoming = entry.operation === 'earn';
            const sign = incoming ? '+' : '−';
            const after = Number(entry.balance_after) || 0;
            const amount = Number(entry.amount) || 0;
            const before = after + (incoming ? -amount : amount);
            const date = new Date(entry.created_at);
            const dateText = Number.isNaN(date.getTime()) ? 'Время неизвестно' : date.toLocaleString('ru-RU');
            return `
                <article class="checker-entry ${incoming ? 'in' : 'out'}">
                    <img src="${currency.icon}" alt="">
                    <span>${currency.label} · ${incoming ? 'поступление' : 'списание'}</span>
                    <strong>${sign}${safeNumber(amount)}</strong>
                    <time>${dateText}</time>
                    <small>Источник: ${window.escapeHtml(entry.source || 'не определён')}</small>
                    <small>Баланс: ${safeNumber(before)} → ${safeNumber(after)}</small>
                </article>
            `;
        }).join('');
    }

    async function refresh() {
        const container = document.getElementById('checkerEntries');
        container.innerHTML = '<p class="checker-empty">Загрузка истории…</p>';
        try {
            const [user, ledger] = await Promise.all([
                window.LootStarAPI.loadProfile(),
                window.LootStarAPI.getBalanceLedger()
            ]);
            document.getElementById('checkerStars').textContent = safeNumber(user.stars);
            document.getElementById('checkerSilver').textContent = safeNumber(user.silver);
            render(ledger.entries);
        } catch (error) {
            console.error('[checker] Could not load account data:', error);
            container.innerHTML = '<p class="checker-empty">Не удалось загрузить данные с сервера. Попробуйте обновить страницу.</p>';
        }
    }

    document.getElementById('checkerRefresh').addEventListener('click', refresh);
    refresh();
})();
