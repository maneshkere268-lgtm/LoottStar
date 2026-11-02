// mines.js — Мины (звёзды + серебро)
const $ = id => document.getElementById(id);
const GRID_SIZE = 25;
const MODES = [2, 4, 10, 15];
const MULT_PER_CELL = 0.05; // каждая открытая клетка = +0.05x к ставке
const MIN_BET = 15;

let state = {
    currency: 'star',
    active: false,
    ready: false,
    busy: false,
    gameId: null,
    minesCount: 2,
    betAmount: 50,
    minePositions: [],
    cellsRevealed: new Array(GRID_SIZE).fill(false),
    openedCount: 0,
    gameOver: false,
    revealAll: false
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();
    setupCurrencySwitch();
    renderModes();
    renderGrid();
    try {
        await window.LootStarAPI.loadProfile();
        const { game } = await window.LootStarAPI.getCurrentMines();
        if (game) restoreGame(game);
        state.ready = true;
        window.refreshCurrencyUI();
        renderGrid();
    } catch (error) {
        console.error('[mines] failed to initialize:', error);
        showToast('Не удалось подключиться к игровому серверу', 'err');
    }
}

function setupCurrencySwitch() {
    window.renderCurrencySwitch($('curSwitch'), state.currency, (cur) => {
        state.currency = cur;
    });
}
function setCurSwitchDisabled(disabled) {
    const el = $('curSwitch');
    if (!el) return;
    el.classList.toggle('disabled', disabled);
}

/* ═══════════ МНОЖИТЕЛЬ ═══════════ */
// Линейная иксовка: каждая открытая клетка даёт +0.05x к ставке.
// 0 клеток → x1.0, 1 → x1.05, 10 → x1.5, 20 → x2.0, 25 → x2.25
function multiplierFor(mc, p) {
    if (p <= 0) return 1;
    return Math.round((1 + MULT_PER_CELL * p) * 100) / 100;
}

function currentWin() {
    return Math.min(window.GameLimits.MAX_PAYOUT, Math.floor(state.betAmount * multiplierFor(state.minesCount, state.openedCount)));
}

function applyGame(game) {
    state.gameId = game.gameId;
    state.active = game.status === 'active';
    state.gameOver = !state.active;
    state.minesCount = game.minesCount;
    state.betAmount = game.betAmount;
    state.betCurrency = game.currency;
    state.currency = game.currency;
    state.openedCount = game.openedCount;
    state.cellsRevealed = new Array(GRID_SIZE).fill(false);
    game.revealedCells.forEach(cell => { state.cellsRevealed[cell] = true; });
    state.minePositions = game.minePositions || [];
    state.revealAll = !state.active;
    setCurSwitchDisabled(state.active);
    renderModes();
}

function restoreGame(game) {
    applyGame(game);
    if (state.active) showToast('Продолжен незавершённый раунд', 'ok');
}

async function refreshGameState() {
    try {
        const { game } = await window.LootStarAPI.getCurrentMines();
        if (game) {
            applyGame(game);
        } else if (state.active) {
            state.active = false;
            state.gameOver = false;
            state.gameId = null;
            state.minePositions = [];
            state.cellsRevealed = new Array(GRID_SIZE).fill(false);
            state.openedCount = 0;
            setCurSwitchDisabled(false);
            await window.LootStarAPI.loadProfile();
        }
    } catch (error) {
        console.error('[mines] failed to refresh round:', error);
    }
}

/* ═══════════ РЕНДЕР ═══════════ */
function renderModes() {
    $('minesModes').innerHTML = MODES.map(m =>
        `<button class="mines-mode-btn ${m === state.minesCount ? 'active' : ''}" onclick="setMinesCount(${m})" ${state.active ? 'disabled' : ''}>${m} мин</button>`
    ).join('');
}

function setMinesCount(m) {
    if (state.active) return;
    state.minesCount = m;
    renderModes();
    updateInfo();
}

function renderGrid() {
    const g = $('minesGrid');
    let h = '';
    for (let i = 0; i < GRID_SIZE; i++) {
        let c = 'mine-cell';
        let co = '';
        const r = state.cellsRevealed[i];
        const isMine = state.minePositions.includes(i);
        if (r) {
            if (isMine) { c += ' mine'; co = '💥'; }
            else { c += ' safe'; co = `<img class="star-icon-cell" src="${window.getCurrencyIcon(state.currency)}" alt="star">`; }
        } else if (state.revealAll && isMine) {
            c += ' mine';
            co = '💥';
        }
        const disabled = r || !state.active || state.gameOver || state.busy;
        h += `<button class="${c}" onclick="onCellClick(${i})" ${disabled ? 'disabled' : ''}>${co}</button>`;
    }
    g.innerHTML = h;
    updateInfo();
    updateMainBtn();
}

function updateInfo() {
    if (!state.active) {
        $('minesInfo').textContent = `Мин: ${state.minesCount} · нажмите «Сделать ставку»`;
    } else if (state.gameOver) {
        $('minesInfo').textContent = 'Раунд завершён';
    } else if (state.openedCount === 0) {
        const nm = multiplierFor(state.minesCount, 1);
        $('minesInfo').textContent = `Откройте клетку · x${nm.toFixed(2)} за первую`;
    } else {
        const nm = multiplierFor(state.minesCount, state.openedCount + 1);
        $('minesInfo').textContent = `Открыто: ${state.openedCount} · следующая клетка x${nm.toFixed(2)}`;
    }
}

function updateMainBtn() {
    const b = $('mainBtn');
    b.className = 'place-btn';
    b.disabled = !state.ready || state.busy;

    if (!state.active) {
        b.textContent = `Сделать ставку (${window.getCurrencyName(state.currency)})`;
    } else if (state.gameOver) {
        b.textContent = 'Раунд завершён';
        b.disabled = true;
    } else if (state.openedCount === 0) {
        b.textContent = 'Откройте клетку';
        b.disabled = true;
    } else {
        const m = multiplierFor(state.minesCount, state.openedCount);
        const win = currentWin();
        b.innerHTML = `Забрать x${m.toFixed(2)} · ${win.toLocaleString('ru-RU')} ${window.getCurrencyShortName(state.currency)}`;
        b.classList.add('cashout');
    }
}

/* ═══════════ ОСНОВНАЯ КНОПКА ═══════════ */
async function onMainBtn() {
    if (!state.ready || state.busy || state.gameOver) return;
    state.busy = true;
    renderGrid();
    try {
        if (!state.active) {
            const amount = parseInt($('betAmount').value, 10) || MIN_BET;
            const result = await window.LootStarAPI.startMines(amount, state.currency, state.minesCount);
            window.LootStarAPI.applyBalanceResult(result);
            applyGame(result.game);
            window.LootTasks?.trackGameEvent({
                game: 'mines', type: 'bet', currency: state.betCurrency, bet: state.betAmount
            });
        } else if (state.openedCount > 0) {
            const result = await window.LootStarAPI.minesAction('cashout', state.gameId);
            window.LootStarAPI.applyBalanceResult(result);
            await finishRound(result.game, result.game.payout);
        }
    } catch (error) {
        console.error('[mines] operation failed:', error);
        showToast(error.code === 'INSUFFICIENT_FUNDS'
            ? `Недостаточно ${window.getCurrencyName(state.currency)}`
            : 'Не удалось выполнить операцию. Состояние раунда обновлено с сервера.', 'err');
        await refreshGameState();
    } finally {
        state.busy = false;
        renderGrid();
    }
}

/* ═══════════ КЛИК ПО КЛЕТКЕ ═══════════ */
async function onCellClick(i) {
    if (!state.active || state.busy || state.gameOver || state.cellsRevealed[i]) return;
    state.busy = true;
    renderGrid();
    try {
        const result = await window.LootStarAPI.minesAction('reveal', state.gameId, i);
        window.LootStarAPI.applyBalanceResult(result);
        applyGame(result.game);
        vibrate(result.game.hitMine ? 'error' : 'light');
        if (result.game.status === 'lost') {
            showToast(`💥 Мина! Ставка ${state.betAmount.toLocaleString('ru-RU')} ${window.getCurrencyShortName(state.betCurrency)} сгорела`, 'err');
            window.LootTasks?.trackGameEvent({
                game: 'mines', type: 'result', currency: state.betCurrency, bet: state.betAmount, win: false
            });
            setTimeout(resetRound, 3000);
        } else if (result.game.status === 'won') {
            finishRound(result.game, result.game.payout);
        }
    } catch (error) {
        console.error('[mines] reveal failed:', error);
        showToast('Не удалось открыть клетку. Состояние раунда обновлено с сервера.', 'err');
        await refreshGameState();
    } finally {
        state.busy = false;
        renderGrid();
    }
}

/* ═══════════ ЗАВЕРШЕНИЕ РАУНДА ═══════════ */
function finishRound(game, win) {
    applyGame(game);
    state.gameOver = true;
    state.revealAll = true;
    const currency = state.betCurrency;
    window.refreshCurrencyUI();
    renderGrid();
    vibrate('success');
    showToast(`Выигрыш: ${Number(win).toLocaleString('ru-RU')} ${window.getCurrencyShortName(currency)}`, 'ok');
    window.LootTasks?.trackGameEvent({
        game: 'mines',
        type: 'result',
        currency,
        bet: state.betAmount,
        win: true,
        multiplier: Number(win) / state.betAmount
    });
    setTimeout(resetRound, 4000);
}

function resetRound() {
    state.active = false;
    state.gameOver = false;
    state.gameId = null;
    state.openedCount = 0;
    state.revealAll = false;
    state.cellsRevealed = new Array(GRID_SIZE).fill(false);
    state.minePositions = [];
    setCurSwitchDisabled(false);
    renderModes();
    renderGrid();
}

/* ═══════════ СТАВКА ═══════════ */
function setBet(v) { $('betAmount').value = window.GameLimits.capBet(v); }
function setBetMax() { $('betAmount').value = Math.min(window.GameLimits.MAX_BET, Math.max(MIN_BET, window.getBalance(state.currency))); }

/* ═══════════ ТОСТ ═══════════ */
function showToast(msg, type = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

/* ═══════════ ЭКСПОРТ ═══════════ */
window.setMinesCount = setMinesCount;
window.onCellClick = onCellClick;
window.onMainBtn = onMainBtn;
window.setBet = setBet;
window.setBetMax = setBetMax;