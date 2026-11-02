(function () {
    'use strict';

    const icons = {
        games: '<rect x="2" y="6" width="20" height="12" rx="3"></rect><path d="M6 12h4M8 10v4"></path><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"></circle><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"></circle>',
        cases: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>',
        upgrades: '<path d="M12 19V5M5 12l7-7 7 7"></path>',
        profile: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
        tasks: '<rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M8 8h8M8 12l2 2 4-4M8 17h5"></path>',
        leaderboard: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"></path><path d="M7 6H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4M17 6h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4"></path>'
    };

    const primaryItems = [
        { id: 'games', label: 'Игры', href: '/games/index.html' },
        { id: 'cases', label: 'Кейсы', href: '/index.html' },
        { id: 'upgrades', label: 'Апгрейд', href: '/upgrades/index.html' },
        { id: 'profile', label: 'Профиль', href: '/profile/index.html' },
        { id: 'tasks', label: 'Задания', href: '/tasks/index.html' },
        { id: 'leaderboard', label: 'Лидеры', href: '/leaderboard/index.html' }
    ];

    const modeItems = [
        { id: 'trade', label: 'Трейд', href: '/trade/index.html', icon: '<path d="M7 7h13l-3-3M17 17H4l3 3"></path><path d="M20 7v4M4 17v-4"></path>' },
        { id: 'index', label: 'Индекс', href: '/index/index.html', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>' },
        { id: 'shop', label: 'Магазин', href: '/SHOP/index.html', icon: '<path d="M4 8h16l-1 13H5L4 8z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path>' }
    ];

    function currentPage() {
        const path = location.pathname.toLowerCase().replace(/\/+$/, '');
        if (path === '' || path === '/index.html') return 'cases';
        const page = path.split('/').pop();
        if (page === 'index.html') return path.split('/').slice(-2, -1)[0] || '';
        return page;
    }

    function makeIcon(markup, className) {
        return `<svg class="${className || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;
    }

    function renderNavigation() {
        const nav = document.querySelector('.bnav') || document.body.appendChild(document.createElement('nav'));
        nav.className = 'bnav';
        nav.setAttribute('aria-label', 'Основная навигация');

        const active = currentPage();
        const makeItem = item =>
            `<button class="nav-item${active === item.id ? ' active' : ''}" type="button" data-page="${item.id}" onclick="location.href='${item.href}'"${active === item.id ? ' aria-current="page"' : ''}>${makeIcon(icons[item.id])}<span>${item.label}</span></button>`;
        nav.innerHTML =
            `<div class="nav-group nav-group-left">${primaryItems.slice(0, 3).map(makeItem).join('')}</div>` +
            '<button class="nav-plus" type="button" aria-label="Открыть режимы" aria-haspopup="dialog" aria-expanded="false"><span>+</span></button>' +
            `<div class="nav-group nav-group-right">${primaryItems.slice(3).map(makeItem).join('')}</div>`;

        const menu = document.createElement('div');
        menu.className = 'mode-menu';
        menu.id = 'modeMenu';
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-labelledby', 'modeMenuTitle');
        menu.innerHTML = `<section class="mode-menu-panel">
            <header class="mode-menu-header"><h2 id="modeMenuTitle">Режимы</h2><button class="mode-menu-close" type="button" aria-label="Закрыть меню">×</button></header>
            <div class="mode-menu-grid">${modeItems.map(item =>
                `<a class="mode-card${active === item.id ? ' active' : ''}" href="${item.href}"${active === item.id ? ' aria-current="page"' : ''}>${makeIcon(item.icon, 'mode-card-icon')}<span>${item.label}</span></a>`
            ).join('')}</div>
        </section>`;
        document.body.appendChild(menu);

        const plus = nav.querySelector('.nav-plus');
        const close = menu.querySelector('.mode-menu-close');
        const setMenuOpen = open => {
            menu.classList.toggle('open', open);
            plus.setAttribute('aria-expanded', String(open));
            document.body.classList.toggle('mode-menu-open', open);
            if (open) close.focus();
            else plus.focus();
        };

        plus.addEventListener('click', () => setMenuOpen(!menu.classList.contains('open')));
        close.addEventListener('click', () => setMenuOpen(false));
        menu.addEventListener('click', event => {
            if (event.target === menu) setMenuOpen(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && menu.classList.contains('open')) setMenuOpen(false);
        });
    }

    function loadStyles() {
        if (document.querySelector('link[data-navigation-styles]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/shared/navigation.css';
        link.dataset.navigationStyles = 'true';
        document.head.appendChild(link);
    }

    loadStyles();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderNavigation, { once: true });
    } else {
        renderNavigation();
    }
})();
