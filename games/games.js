document.addEventListener('DOMContentLoaded', () => {
    window.TG?.updateHeaderUI();
    window.refreshCurrencyUI?.();
    window.LootStarAPI.loadProfile().catch(error => {
        console.error('[games] profile load failed:', error);
    });
});

// vibrate() теперь общая функция из config.js (раньше здесь было дублирующее,
// более простое определение, которое перекрывало общее только на этой странице)
document.addEventListener('click', e => {
    const el = e.target.closest('.game-card, .bnav button');
    if (el) vibrate();
});