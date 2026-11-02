// shared/currency.js — отображение серверного кэша балансов и форматирование валют.
(function () {
    'use strict';

    // ─── Состояние (только кэш, не источник истины) ───
    let currency = localStorage.getItem('activeCurrency') || 'star';

    function getBalance(cur = currency) {
        const key = cur === 'silver' ? 'userSilver' : 'userStars';
        const value = Number(localStorage.getItem(key) || '0');
        return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }

    // ─── Запись в кэш после подтверждённой сервером операции ───
    function _cacheBalance(cur, value) {
        const key = cur === 'silver' ? 'userSilver' : 'userStars';
        const after = Math.max(0, Math.floor(value));
        localStorage.setItem(key, String(after));
        refreshCurrencyUI();
    }

    // ─── Валюта ───
    function getCurrency() { return currency; }
    function setCurrency(cur) {
        currency = cur === 'silver' ? 'silver' : 'star';
        localStorage.setItem('activeCurrency', currency);
    }

    // ─── Оборот серебра ───
    function addSilverTurnover(amount) {
        const delta = Math.max(0, Math.floor(amount));
        const cur = parseInt(localStorage.getItem('silverTurnover') || '0');
        window.dispatchEvent(new CustomEvent('silverTurnover', {
            detail: { amount: delta, total: cur }
        }));
        return cur;
    }
    function getSilverTurnover() {
        return parseInt(localStorage.getItem('silverTurnover') || '0');
    }

    // ─── Отображение ───
    function refreshCurrencyUI() {
        const starsEl  = document.getElementById('balanceDisplay');
        const silverEl = document.getElementById('silverDisplay');
        if (starsEl)  starsEl.textContent  = getBalance('star').toLocaleString('ru-RU');
        if (silverEl) silverEl.textContent = getBalance('silver').toLocaleString('ru-RU');
    }

    // ─── Названия ───
    function getCurrencyName(cur = currency) {
        return cur === 'silver' ? 'серебро' : 'звёзды';
    }
    function getCurrencyShortName(cur = currency) {
        return cur === 'silver' ? 'сер.' : '★';
    }
    function getCurrencyIcon(cur = currency) {
        return cur === 'silver' ? '/shared/silver-star.svg' : '/shared/star.png';
    }

    // ─── Переключатель валют ───
    function renderCurrencySwitch(container, current, onChange) {
        if (!container) return;
        container.innerHTML = '';
        container.classList.add('cur-switch');

        const mk = (cur, label, icon) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cur-switch-btn' + (cur === current ? ' active' : '');
            btn.dataset.cur = cur;
            btn.innerHTML = `<img src="${icon}" alt=""><span>${label}</span>`;
            btn.addEventListener('click', () => {
                if (container.classList.contains('disabled')) return;
                container.querySelectorAll('.cur-switch-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setCurrency(cur);
                onChange?.(cur);
            });
            return btn;
        };

        container.appendChild(mk('star', 'Звёзды', '/shared/star.png'));
        container.appendChild(mk('silver', 'Серебро', '/shared/silver-star.svg'));
    }

    // ─── Реакция на обновления с сервера ───
    window.addEventListener('profileDataLoaded', () => {
        refreshCurrencyUI();
    });

    // ─── Экспорт ───
    window.getBalance = getBalance;
    window.getCurrency = getCurrency;
    window.setCurrency = setCurrency;
    window.addSilverTurnover = addSilverTurnover;
    window.getSilverTurnover = getSilverTurnover;
    window.refreshCurrencyUI = refreshCurrencyUI;
    window.getCurrencyName = getCurrencyName;
    window.getCurrencyShortName = getCurrencyShortName;
    window.getCurrencyIcon = getCurrencyIcon;
    window.renderCurrencySwitch = renderCurrencySwitch;
})();