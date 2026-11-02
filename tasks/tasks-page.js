// tasks-page.js — отрисовка страницы ежедневных заданий
const $ = id => document.getElementById(id);

const TASK_ICONS = {
    // звёздные
    star_bets_5: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path>',
    star_mines_10: '<circle cx="12" cy="12" r="7"></circle><path d="M12 2v3M5 5l2 2M2 12h3M5 19l2-2M12 22v-3M19 19l-2-2M22 12h-3M19 5l-2 2"></path>',
    star_win_3x: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path>',
    star_slots_15: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 9h.01M12 9h.01M17 9h.01M7 15h.01M12 15h.01M17 15h.01"></path>',
    star_win_5x: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path>',
    star_win_10x: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path>',
    // серебряные
    silver_bets_5: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9 10h4a2 2 0 0 1 0 4H9"></path>',
    silver_mines_10: '<circle cx="12" cy="12" r="7"></circle><path d="M12 2v3M5 5l2 2M2 12h3M5 19l2-2M12 22v-3M19 19l-2-2M22 12h-3M19 5l-2 2"></path>',
    silver_win_3x: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9 10h4a2 2 0 0 1 0 4H9"></path>',
    silver_slots_15: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 9h.01M12 9h.01M17 9h.01M7 15h.01M12 15h.01M17 15h.01"></path>',
    silver_win_5x: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9 10h4a2 2 0 0 1 0 4H9"></path>',
    silver_win_10x: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9 10h4a2 2 0 0 1 0 4H9"></path>'
};

document.addEventListener('DOMContentLoaded', init);

function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();
    render();
    window.LootStarAPI.loadProfile().catch(error => {
        console.error('[tasks] Could not load profile from API:', error);
    });
}

function taskCardHtml(t) {
    const pct = Math.min(100, Math.round((t.progress / t.target) * 100));
    const icon = TASK_ICONS[t.id] || '<circle cx="12" cy="12" r="9"></circle>';
    const rewardIcon = window.getCurrencyIcon(t.reward.currency);
    const amount = t.reward.amount.toLocaleString('ru-RU');
    return `
        <div class="task-card ${t.claimed ? 'done' : ''}">
            <div class="task-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
            </div>
            <div class="task-body">
                <div class="task-text">${window.escapeHtml(t.text)}</div>
                <div class="task-progress-bar"><div style="width:${pct}%"></div></div>
                <div class="task-foot">
                    <span>${t.progress}/${t.target}</span>
                    ${t.claimed
                        ? '<span class="task-status-done">✓ Получено</span>'
                        : `<span class="task-reward ${t.reward.currency}"><img src="${rewardIcon}">+${amount}</span>`}
                </div>
            </div>
        </div>`;
}

function sectionHtml(title, subtitle, tasks, cls) {
    if (!tasks.length) return '';
    const done = tasks.filter(t => t.claimed).length;
    return `
        <div class="tasks-section ${cls}">
            <div class="tasks-section-head">
                <div class="tasks-section-title">${title}</div>
                <div class="tasks-section-count">${done}/${tasks.length}</div>
            </div>
            <div class="tasks-section-sub">${subtitle}</div>
            <div class="tasks-section-list">
                ${tasks.map(taskCardHtml).join('')}
            </div>
        </div>`;
}

function render() {
    const list = $('tasksList');
    const tasks = window.LootTasks.getTasksWithState();
    const starTasks = tasks.filter(t => t.reward.currency === 'star');
    const silverTasks = tasks.filter(t => t.reward.currency === 'silver');

    list.innerHTML =
        sectionHtml('⭐ Задания за звёзды', 'Награда: 25 000 — 250 000 звёзд', starTasks, 'star-section') +
        sectionHtml('🪙 Задания за серебро', 'Награда: 2 500 — 25 000 серебра', silverTasks, 'silver-section');
}

window.addEventListener('taskCompleted', render);
window.addEventListener('dailyTasksUpdated', render);