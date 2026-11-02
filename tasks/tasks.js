// tasks.js — ежедневные задания LootStar
// ВСЕ квесты привязаны к конкретной валюте: звёзды или серебро.
// Ставка в серебре не засчитывает звёздный квест и наоборот.
(function () {
    'use strict';

    function todayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    // reward.star: от 25 000 до 250 000 звёзд (по возрастанию сложности)
    // reward.silver: от 2 500 до 25 000 серебра (по возрастанию сложности)
    const TASK_DEFS = [
        // ═══════════════ ЗАДАНИЯ ЗА ЗВЁЗДЫ ═══════════════

        {
            id: 'star_bets_5',
            text: 'Сделай 5 ставок в любой игре за звёзды',
            currency: 'star',
            target: 5,
            reward: { currency: 'star', amount: 25000 },
            match: (e) => e.type === 'bet' && e.currency === 'star'
        },
        {
            id: 'star_mines_10',
            text: 'Сделай 10 ставок в Минах за звёзды',
            currency: 'star',
            target: 10,
            reward: { currency: 'star', amount: 50000 },
            match: (e) => e.game === 'mines' && e.type === 'bet' && e.currency === 'star'
        },
        {
            id: 'star_win_3x',
            text: 'Поймай x3 в любой игре за звёзды',
            currency: 'star',
            target: 1,
            reward: { currency: 'star', amount: 80000 },
            match: (e) => e.currency === 'star' && e.multiplier >= 3
        },
        {
            id: 'star_slots_15',
            text: 'Крути слоты 15 раз за звёзды',
            currency: 'star',
            target: 15,
            reward: { currency: 'star', amount: 120000 },
            match: (e) => e.game === 'slots' && e.type === 'bet' && e.currency === 'star'
        },
        {
            id: 'star_win_5x',
            text: 'Поймай x5 в любой игре за звёзды',
            currency: 'star',
            target: 1,
            reward: { currency: 'star', amount: 175000 },
            match: (e) => e.currency === 'star' && e.multiplier >= 5
        },
        {
            id: 'star_win_10x',
            text: 'Поймай x10 в любой игре за звёзды',
            currency: 'star',
            target: 1,
            reward: { currency: 'star', amount: 250000 },
            match: (e) => e.currency === 'star' && e.multiplier >= 10
        },

        // ═══════════════ ЗАДАНИЯ ЗА СЕРЕБРО ═══════════════

        {
            id: 'silver_bets_5',
            text: 'Сделай 5 ставок в любой игре за серебро',
            currency: 'silver',
            target: 5,
            reward: { currency: 'silver', amount: 2500 },
            match: (e) => e.type === 'bet' && e.currency === 'silver'
        },
        {
            id: 'silver_mines_10',
            text: 'Сделай 10 ставок в Минах за серебро',
            currency: 'silver',
            target: 10,
            reward: { currency: 'silver', amount: 5000 },
            match: (e) => e.game === 'mines' && e.type === 'bet' && e.currency === 'silver'
        },
        {
            id: 'silver_win_3x',
            text: 'Поймай x3 в любой игре за серебро',
            currency: 'silver',
            target: 1,
            reward: { currency: 'silver', amount: 8000 },
            match: (e) => e.currency === 'silver' && e.multiplier >= 3
        },
        {
            id: 'silver_slots_15',
            text: 'Крути слоты 15 раз за серебро',
            currency: 'silver',
            target: 15,
            reward: { currency: 'silver', amount: 12000 },
            match: (e) => e.game === 'slots' && e.type === 'bet' && e.currency === 'silver'
        },
        {
            id: 'silver_win_5x',
            text: 'Поймай x5 в любой игре за серебро',
            currency: 'silver',
            target: 1,
            reward: { currency: 'silver', amount: 18000 },
            match: (e) => e.currency === 'silver' && e.multiplier >= 5
        },
        {
            id: 'silver_win_10x',
            text: 'Поймай x10 в любой игре за серебро',
            currency: 'silver',
            target: 1,
            reward: { currency: 'silver', amount: 25000 },
            match: (e) => e.currency === 'silver' && e.multiplier >= 10
        }
    ];

    function loadState() {
        let st;
        try { st = JSON.parse(localStorage.getItem('dailyTasks') || 'null'); } catch (e) { st = null; }
        const key = todayKey();
        if (!st || st.day !== key) {
            st = { day: key, progress: {}, claimed: {} };
            TASK_DEFS.forEach(t => { st.progress[t.id] = 0; st.claimed[t.id] = false; });
            localStorage.setItem('dailyTasks', JSON.stringify(st));
        }
        // добиваем новые квесты, которых не было в старом состоянии
        TASK_DEFS.forEach(t => {
            if (typeof st.progress[t.id] !== 'number') st.progress[t.id] = 0;
            if (typeof st.claimed[t.id] !== 'boolean') st.claimed[t.id] = false;
        });
        return st;
    }
    function saveState(st) {
        localStorage.setItem('dailyTasks', JSON.stringify(st));
    }

    function trackGameEvent(e) {
        const st = loadState();
        let changed = false;

        TASK_DEFS.forEach(t => {
            if (st.claimed[t.id]) return;
            if (st.progress[t.id] >= t.target) return;

            // Если квест привязан к валюте — событие должно совпадать.
            if (t.currency && e.currency !== t.currency) return;

            if (t.match(e)) {
                st.progress[t.id] = Math.min(t.target, st.progress[t.id] + 1);
                changed = true;
                if (st.progress[t.id] >= t.target && !st.claimed[t.id]) {
                    st.claimed[t.id] = true;
                    window.earnCurrency(t.reward.currency, t.reward.amount);
                    window.refreshCurrencyUI?.();
                    window.dispatchEvent(new CustomEvent('taskCompleted', { detail: t }));
                    showTaskToast(t);
                }
            }
        });
        if (changed) saveState(st);
    }

    function showTaskToast(task) {
        const el = document.createElement('div');
        el.className = 'task-toast';
        const amount = task.reward.amount.toLocaleString('ru-RU');
        el.innerHTML = `<b>✅ Задание выполнено!</b><span>${task.text}</span><span class="task-toast-reward">+${amount} ${task.reward.currency === 'star' ? '⭐' : '🪙'}</span>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3200);
    }

    function getTasksWithState() {
        const st = loadState();
        return TASK_DEFS.map(t => ({
            ...t,
            progress: st.progress[t.id] || 0,
            claimed: !!st.claimed[t.id]
        }));
    }

    function countUnclaimed() {
        return getTasksWithState().filter(t => !t.claimed).length;
    }
    function countReadyToday() {
        return getTasksWithState().filter(t => t.claimed).length;
    }

    function paintNavBadge() {
        const btn = document.querySelector('.bnav button[data-page="tasks"]');
        if (!btn) return;
        let badge = btn.querySelector('.nav-badge');
        const doneToday = countReadyToday();
        const total = TASK_DEFS.length;
        if (doneToday < total) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'nav-badge';
                btn.appendChild(badge);
            }
            badge.textContent = total - doneToday;
        } else if (badge) {
            badge.remove();
        }
    }

    window.LootTasks = {
        TASK_DEFS,
        trackGameEvent,
        getTasksWithState,
        countUnclaimed,
        countReadyToday
    };

    document.addEventListener('DOMContentLoaded', paintNavBadge);
})();