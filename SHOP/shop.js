(function () {
    'use strict';

    const products = {
        'luck-x4': { name: 'Удача ×4 — 5 минут', price: 100 },
        'luck-x2': { name: 'Удача ×2 — 5 минут', price: 75 },
        'halloween-pass': { name: 'Pro Pass Halloween', price: 500 },
        'luck-x6': { name: 'Удача ×6 — 3 минуты', price: 300 },
        'luck-x10': { name: 'Удача ×10 — 3 минуты', price: 950 },
        'leaderboard-prefix': { name: 'Любой префикс в топе', price: 100 },
        'custom-promo': { name: 'Свой промо', price: 50 }
    };

    const descriptions = {
        'luck-x4': 'Увеличенная удача на 5 минут.',
        'luck-x2': 'Увеличенная удача на 5 минут.',
        'halloween-pass': 'Pro Pass для события Halloween.',
        'luck-x6': 'Сильное усиление удачи на 3 минуты.',
        'luck-x10': 'Максимальное усиление удачи на 3 минуты.',
        'leaderboard-prefix': 'Выбери текст своего префикса в топе.',
        'custom-promo': 'Обсуди свой промокод и его оформление.'
    };

    const icons = {
        'luck-x4': '/shared/4luck.png',
        'luck-x2': '/shared/2luck.png',
        'halloween-pass': '/SHOP/assets/halloween-pass.svg',
        'luck-x6': '/shared/6luck.png',
        'luck-x10': '/shared/10luck.png',
        'leaderboard-prefix': '/SHOP/assets/leaderboard-prefix.svg',
        'custom-promo': '/SHOP/assets/custom-promo.svg'
    };

    const categories = [
        { title: 'Удача', productIds: ['luck-x2', 'luck-x4', 'luck-x6', 'luck-x10'] },
        { title: 'Промокоды', productIds: ['custom-promo'] },
        { title: 'Кастом', productIds: ['halloween-pass', 'leaderboard-prefix'] }
    ];

    const accents = {
        'luck-x2': '#7CCBF5',
        'luck-x4': '#4FBE8D',
        'luck-x6': '#9B86F0',
        'luck-x10': '#FFD84D',
        'halloween-pass': '#FF8A3D',
        'leaderboard-prefix': '#E8548A',
        'custom-promo': '#4FB8C4'
    };
    const badges = { 'luck-x10': 'MAX', 'halloween-pass': 'EVENT' };
    const category = id => id.startsWith('luck-') ? 'УСИЛЕНИЕ' :
        id === 'halloween-pass' ? 'ПРОПУСК' : 'ПЕРСОНАЛЬНОЕ';

    function renderProduct(id, index = 0) {
        const product = products[id];
        return `
            <article class="shop-card" style="--acc:${accents[id] || '#E8944A'};--i:${index}">
                <div class="shop-card-top">
                    <span class="shop-artwork"><img src="${icons[id]}" alt="" loading="lazy"></span>
                    <span class="shop-tags">
                        ${badges[id] ? `<span class="shop-badge">${badges[id]}</span>` : ''}
                        <span class="shop-category">${category(id)}</span>
                    </span>
                </div>
                <h3>${product.name}</h3>
                <p>${descriptions[id]}</p>
                <div class="shop-card-footer">
                    <span class="shop-price"><img src="/shared/star.png" alt="">${product.price}</span>
                    <a class="shop-buy-button" href="https://t.me/Hazed_q" data-shop-product="${id}" target="_blank" rel="noopener noreferrer">Купить<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></a>
                </div>
            </article>
        `;
    }

    function renderCatalog() {
        const catalog = document.getElementById('shopCatalog');
        if (!catalog) return;

        let n = 0;
        catalog.innerHTML = categories.map((group, index) => `
            <section class="shop-category-section" data-group="${index}" aria-labelledby="shopCategory-${index}">
                <div class="shop-section-heading">
                    <h2 id="shopCategory-${index}">${group.title}</h2>
                    <span class="shop-items-count">${group.productIds.length}</span>
                </div>
                <div class="shop-grid">${group.productIds.map(pid => renderProduct(pid, n++)).join('')}</div>
            </section>
        `).join('');

        renderFilters(catalog);

        catalog.addEventListener('click', event => {
            const link = event.target.closest('[data-shop-product]');
            if (!link) return;

            const product = products[link.dataset.shopProduct];
            if (!product) {
                console.error('[shop] Unknown product:', link.dataset.shopProduct);
                return;
            }

            const user = window.TG?.user;
            const userId = user?.id || 'не указан';
            const username = user?.username ? `@${user.username}` : 'не указан';
            const displayName = window.TG?.getName?.() || user?.first_name || 'не указан';
            const detailsPrompt = link.dataset.shopProduct === 'leaderboard-prefix'
                ? 'Желаемый префикс: '
                : link.dataset.shopProduct === 'custom-promo'
                    ? 'Пожелание по промо: '
                    : null;
            const messageLines = [
                'Здравствуйте! Хочу заказать товар в LootStar:',
                `${product.name} — ${product.price} ⭐`,
                `Мой Telegram ID: ${userId}`,
                `Username: ${username}`,
                `Имя: ${displayName}`,
                ...(detailsPrompt ? [detailsPrompt] : []),
                'Пожалуйста, уточните оплату и выдачу.'
            ];
            const message = messageLines.join('\n');
            const url = `https://t.me/Hazed_q?text=${encodeURIComponent(message)}`;
            const webApp = window.Telegram?.WebApp;

            if (typeof webApp?.openTelegramLink === 'function') {
                event.preventDefault();
                try {
                    webApp.openTelegramLink(url);
                } catch (error) {
                    console.error('[shop] Could not open Telegram link:', error);
                    window.open(url, '_blank', 'noopener,noreferrer');
                }
            } else {
                link.href = url;
            }
        });
    }

    function renderFilters(catalog) {
        const bar = document.getElementById('shopFilters');
        if (!bar) return;
        const total = categories.reduce((sum, group) => sum + group.productIds.length, 0);
        const plural = count => {
            const lastTwo = count % 100;
            const last = count % 10;
            return last === 1 && lastTwo !== 11 ? 'предложение'
                : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'предложения' : 'предложений';
        };
        const countEl = document.getElementById('shopItemsCount');

        bar.innerHTML = [{ title: 'Все', count: total, key: 'all' }]
            .concat(categories.map((group, index) => ({
                title: group.title, count: group.productIds.length, key: String(index)
            })))
            .map((filter, index) => `<button type="button" class="shop-filter${index === 0 ? ' active' : ''}" role="tab" aria-selected="${index === 0}" data-filter="${filter.key}">${filter.title}<em>${filter.count}</em></button>`)
            .join('');

        bar.addEventListener('click', event => {
            const button = event.target.closest('[data-filter]');
            if (!button) return;
            const key = button.dataset.filter;
            bar.querySelectorAll('.shop-filter').forEach(filter => {
                const active = filter === button;
                filter.classList.toggle('active', active);
                filter.setAttribute('aria-selected', String(active));
            });
            let visible = 0;
            catalog.querySelectorAll('.shop-category-section').forEach(section => {
                const show = key === 'all' || section.dataset.group === key;
                section.hidden = !show;
                if (show) {
                    visible += section.querySelectorAll('.shop-card').length;
                    section.classList.remove('reveal');
                    void section.offsetWidth;
                    section.classList.add('reveal');
                }
            });
            if (countEl) countEl.textContent = `${visible} ${plural(visible)}`;
        });
    }

    window.TG?.updateHeaderUI();
    window.refreshCurrencyUI?.();
    window.LootStarAPI.loadProfile().catch(error => {
        console.error('[shop] profile load failed:', error);
    });
    renderCatalog();
})();
