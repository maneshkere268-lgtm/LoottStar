// shared/tasks.js — ежедневные задания LootStar
// ВСЕ квесты привязаны к конкретной валюте: звёзды или серебро.
// Ставка в серебре не засчитывает звёздный квест и наоборот.
// Награда теперь включает в себя не только валюту, но и XP для Halloween Pass.
(function () {
    'use strict';

    // reward.star: от 25 000 до 250 000 звёзд (по возрастанию сложности)
    // reward.silver: от 2 500 до 25 000 серебра (по возрастанию сложности)
    // xp: количество опыта для Halloween Pass
    const TASK_DEFS = [
        // ═══════════════ ЗАДАНИЯ ЗА ЗВЁЗДЫ ═══════════════

        {
            id: 'star_bets_5',
            text: 'Сделай 5 ставок в любой игре за звёзды',
            currency: 'star',
            target: 5,
            reward: { currency: 'star', amount: 25000 },
            xp: 100,
            match: (e) => e.type === 'bet' && e.currency === 'star'
        },
        {
            id: 'star_mines_10',
            text: 'Сделай 10 ставок в Минах за звёзды',
            currency: 'star',
            target: 10,
            reward: { currency: 'star', amount: 50000 },
            xp: 250,
            match: (e) => e.game === 'mines' && e.type === 'bet' && e.currency === 'star'
        },
        {
            id: 'star_win_3x',
            text: 'Поймай x3 в любой игре за звёзды',
            currency: 'star',
            target: 1,
            reward: { currency: 'star', amount: 80000 },
            xp: 500,
            match: (e) => e.currency === 'star' && e.multiplier >= 3
        },
        {
            id: 'star_slots_15',
            text: 'Крути слоты 15 раз за звёзды',
            currency: 'star',
            target: 15,
            reward: { currency: 'star', amount: 120000 },
            xp: 750,
            match: (e) => e.game === 'slots' && e.type === 'bet' && e.currency === 'star'
        },
        {
            id: 'star_win_5x',
            text: 'Поймай x5 в любой игре за звёзды',
            currency: 'star',
            target: 1,
            reward: { currency: 'star', amount: 175000 },
            xp: 1000,
            match: (e) => e.currency === 'star' && e.multiplier >= 5
        },
        {
            id: 'star_win_10x',
            text: 'Поймай x10 в любой игре за звёзды',
            currency: 'star',
            target: 1,
            reward: { currency: 'star', amount: 250000 },
            xp: 1500,
            match: (e) => e.currency === 'star' && e.multiplier >= 10
        },

        // ═══════════════ ЗАДАНИЯ ЗА СЕРЕБРО ═══════════════

        {
            id: 'silver_bets_5',
            text: 'Сделай 5 ставок в любой игре за серебро',
            currency: 'silver',
            target: 5,
            reward: { currency: 'silver', amount: 2500 },
            xp: 100,
            match: (e) => e.type === 'bet' && e.currency === 'silver'
        },
        {
            id: 'silver_mines_10',
            text: 'Сделай 10 ставок в Минах за серебро',
            currency: 'silver',
            target: 10,
            reward: { currency: 'silver', amount: 5000 },
            xp: 250,
            match: (e) => e.game === 'mines' && e.type === 'bet' && e.currency === 'silver'
        },
        {
            id: 'silver_win_3x',
            text: 'Поймай x3 в любой игре за серебро',
            currency: 'silver',
            target: 1,
            reward: { currency: 'silver', amount: 8000 },
            xp: 500,
            match: (e) => e.currency === 'silver' && e.multiplier >= 3
        },
        {
            id: 'silver_slots_15',
            text: 'Крути слоты 15 раз за серебро',
            currency: 'silver',
            target: 15,
            reward: { currency: 'silver', amount: 12000 },
            xp: 750,
            match: (e) => e.game === 'slots' && e.type === 'bet' && e.currency === 'silver'
        },
        {
            id: 'silver_win_5x',
            text: 'Поймай x5 в любой игре за серебро',
            currency: 'silver',
            target: 1,
            reward: { currency: 'silver', amount: 18000 },
            xp: 1000,
            match: (e) => e.currency === 'silver' && e.multiplier >= 5
        },
        {
            id: 'silver_win_10x',
            text: 'Поймай x10 в любой игре за серебро',
            currency: 'silver',
            target: 1,
            reward: { currency: 'silver', amount: 25000 },
            xp: 1500,
            match: (e) => e.currency === 'silver' && e.multiplier >= 10
        }
    ];

    function loadState() {
        try {
            const state = JSON.parse(localStorage.getItem('dailyTasks') || 'null');
            if (state && typeof state.day === 'string') return state;
        } catch (error) {
            console.warn('[tasks] Could not read cached task state:', error);
        }
        return { day: '', progress: {}, claimed: {} };
    }

    function saveState(st) {
        localStorage.setItem('dailyTasks', JSON.stringify(st));
    }

    const pendingClaims = new Set();
    let refreshPromise = null;
    let refreshAgain = false;

    function trackGameEvent() {
        refreshAgain = true;
        refreshTasks().catch(error => {
            console.error('[tasks] Could not refresh server progress:', error);
        });
    }

    async function fetchTaskState() {
        if (!window.LootStarAPI?.getDailyTasks) throw new Error('DAILY_TASK_API_UNAVAILABLE');
        const result = await window.LootStarAPI.getDailyTasks();
        const state = { day: result.day, progress: {}, claimed: {} };
        for (const task of TASK_DEFS) {
            const serverTask = result.tasks?.find(item => item.id === task.id);
            state.progress[task.id] = Math.min(task.target, Number(serverTask?.progress) || 0);
            state.claimed[task.id] = serverTask?.claimed === true;
        }
        saveState(state);
        localStorage.setItem('halloweenXP', String(Number(result.halloweenXP) || 0));
        window.dispatchEvent(new CustomEvent('xpUpdated'));
        window.dispatchEvent(new CustomEvent('dailyTasksUpdated'));
        return state;
    }

    async function claimReadyTasks() {
        const state = loadState();
        const pendingKey = 'dailyTaskPendingClaims';
        let pending = {};
        try {
            const stored = JSON.parse(localStorage.getItem(pendingKey) || 'null');
            if (stored?.day === state.day && stored.requests && typeof stored.requests === 'object') {
                pending = stored.requests;
            }
        } catch (error) {
            console.warn('[tasks] Could not read pending task claims:', error);
        }

        for (const task of TASK_DEFS) {
            if (state.claimed[task.id] || Number(state.progress[task.id]) < task.target ||
                pendingClaims.has(task.id)) continue;
            pendingClaims.add(task.id);
            try {
                if (!window.LootStarAPI?.claimDailyTask || !window.LootStarAPI?.createRequestId) {
                    throw new Error('DAILY_TASK_API_UNAVAILABLE');
                }
                if (!pending[task.id]) pending[task.id] = window.LootStarAPI.createRequestId();
                localStorage.setItem(pendingKey, JSON.stringify({ day: state.day, requests: pending }));
                const result = await window.LootStarAPI.claimDailyTask(task.id, pending[task.id]);
                delete pending[task.id];
                localStorage.setItem(pendingKey, JSON.stringify({ day: state.day, requests: pending }));
                window.LootStarAPI.applyBalanceResult(result);
                localStorage.setItem('halloweenXP', String(Number(result.halloweenXP) || 0));
                window.dispatchEvent(new CustomEvent('xpUpdated'));
                state.claimed[task.id] = true;
                saveState(state);
                window.dispatchEvent(new CustomEvent('dailyTasksUpdated'));
                window.dispatchEvent(new CustomEvent('taskCompleted', { detail: task }));
                showTaskToast(task);
            } catch (error) {
                if (error?.code === 'TASK_ALREADY_CLAIMED') {
                    delete pending[task.id];
                    localStorage.setItem(pendingKey, JSON.stringify({ day: state.day, requests: pending }));
                    await fetchTaskState();
                } else {
                    console.error(`[tasks] Reward failed for ${task.id}:`, error);
                }
            } finally {
                pendingClaims.delete(task.id);
            }
        }
    }

    function refreshTasks() {
        if (refreshPromise) {
            refreshAgain = true;
            return refreshPromise;
        }
        refreshPromise = (async () => {
            let state;
            do {
                refreshAgain = false;
                state = await fetchTaskState();
                await claimReadyTasks();
            } while (refreshAgain);
            return state;
        })().finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    function showTaskToast(task) {
        const el = document.createElement('div');
        el.className = 'task-toast';
        const amount = task.reward.amount.toLocaleString('ru-RU');
        
        // Показываем и валюту, и XP
        let rewardText = `+${amount} ${task.reward.currency === 'star' ? '⭐' : '🪙'}`;
        if (task.xp) rewardText += ` · +${task.xp} XP`;

        el.innerHTML = `
            <b>✅ Задание выполнено!</b>
            <span>${task.text}</span>
            <span class="task-toast-reward">${rewardText}</span>
        `;
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
        refreshTasks,
        getTasksWithState,
        countUnclaimed,
        countReadyToday
    };

    document.addEventListener('DOMContentLoaded', () => {
        refreshTasks().catch(error => {
            console.error('[tasks] Could not load server task state:', error);
        }).finally(paintNavBadge);
    });
    window.addEventListener('dailyTasksUpdated', paintNavBadge);
})();