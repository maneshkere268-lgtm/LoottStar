// plinko.js — Плинко (звёзды + серебро)
const $ = id => document.getElementById(id);
const MIN_BET = 10;

const DIFFS = {
    easy: {
        label: 'Легко',
        mult:   [5.2, 1.6, 1.2, 1, 0.4, 1, 1.2, 1.6, 5.2]
    },
    medium: {
        label: 'Средне',
        mult:   [18, 9.2, 3.2, 1.6, 1.2, 0.6, 0.4, 0.6, 1.2, 1.6, 3.2, 9.2, 18]
    },
    hard: {
        label: 'Сложно',
        mult:   [81, 24.4, 12.8, 6.6, 3.8, 1.8, 0.6, 0.4, 0.2, 0.4, 0.6, 1.8, 3.8, 6.6, 12.8, 24.4, 81]
    }
};

let state = {
    currency: 'star',
    difficulty: 'easy',
    dropping: false,
    ready: false,
    history: []
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();

    const raw = localStorage.getItem('plinkoHistory');
    if (raw) { try { state.history = JSON.parse(raw) || []; } catch (e) {} }

    setupCurrencySwitch();
    renderDifficultyTabs();
    renderBoard();
    renderHistory();
    updateSubmitBtn();
    try {
        await window.LootStarAPI.loadProfile();
        state.ready = true;
        window.refreshCurrencyUI();
        updateSubmitBtn();
    } catch (error) {
        console.error('[plinko] failed to initialize:', error);
        showToast('Не удалось подключиться к игровому серверу', 'err');
    }
}

function setupCurrencySwitch() {
    window.renderCurrencySwitch($('curSwitch'), state.currency, (cur) => {
        state.currency = cur;
        updateSubmitBtn();
    });
}

function setCurSwitchDisabled(disabled) {
    const el = $('curSwitch');
    if (el) el.classList.toggle('disabled', disabled);
}

function renderDifficultyTabs() {
    const wrap = $('diffTabs');
    wrap.innerHTML = Object.keys(DIFFS).map(key =>
        `<button class="plinko-diff-btn ${key === state.difficulty ? 'active' : ''}" ${state.dropping ? 'disabled' : ''} onclick="setDifficulty('${key}')">${DIFFS[key].label}</button>`
    ).join('');
}

function setDifficulty(key) {
    if (state.dropping || !DIFFS[key]) return;
    state.difficulty = key;
    renderDifficultyTabs();
    renderBoard();
}

function currentTable() { return DIFFS[state.difficulty]; }

function multColor(m) {
    if (m >= 5) return 'red';
    if (m >= 1.2) return 'orange';
    if (m >= 0.8) return 'green';
    return 'gold';
}

function renderBoard() {
    const table = currentTable();
    const bins = table.mult.length;
    const rows = bins - 1;

    const pinsWrap = $('plinkoPins');
    let pinsHtml = '';
    for (let r = 0; r < rows; r++) {
        const count = r + 1;
        pinsHtml += `<div class="plinko-row" data-row="${r}">`;
        for (let i = 0; i < count; i++) pinsHtml += `<span class="plinko-pin"></span>`;
        pinsHtml += `</div>`;
    }
    pinsWrap.innerHTML = pinsHtml;
    pinsWrap.dataset.rows = rows;

    const binsWrap = $('plinkoBins');
    binsWrap.innerHTML = table.mult.map(m =>
        `<div class="plinko-bin ${multColor(m)}">${m}</div>`
    ).join('');

    $('plinkoBall').style.display = 'none';
}

function renderHistory() {
    const wrap = $('plinkoHistoryTrack');
    if (!wrap) return;
    wrap.innerHTML = state.history.slice(0, 15).map(h =>
        `<div class="plinko-hist-item ${multColor(h)}">x${h}</div>`
    ).join('');
}

function buildPath(rows, rights) {
    const path = new Array(rows).fill(false);
    for (let i = 0; i < rights; i++) path[i] = true;
    for (let i = path.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [path[i], path[j]] = [path[j], path[i]];
    }
    return path;
}

function updateSubmitBtn() {
    const b = $('plinkoSubmit');
    if (!b) return;
    if (!state.ready || state.dropping) {
        b.disabled = true;
        b.textContent = state.dropping ? 'Шарик летит...' : 'Загрузка...';
    } else {
        b.disabled = false;
        b.textContent = `Бросить шар (${window.getCurrencyName(state.currency)})`;
    }
}

function addBet(v) {
    const input = $('betAmount');
    input.value = window.GameLimits.capBet((parseInt(input.value) || 0) + v);
}

async function onSubmit() {
    if (!state.ready || state.dropping) return;
    const amount = parseInt($('betAmount').value) || 0;
    if (amount < MIN_BET) { showToast(`Минимум ${MIN_BET} ${window.getCurrencyShortName(state.currency)}`, 'err'); return; }
    if (amount > window.GameLimits.MAX_BET) { showToast('Максимальная ставка — 50 000 000', 'err'); return; }
    state.dropping = true;
    setCurSwitchDisabled(true);
    updateSubmitBtn();
    const currency = state.currency;
    const difficulty = state.difficulty;
    let result;
    try {
        result = await window.LootStarAPI.dropPlinko(amount, currency, difficulty);
        window.LootStarAPI.applyBalanceResult(result);
    } catch (error) {
        console.error('[plinko] drop failed:', error);
        try {
            await window.LootStarAPI.loadProfile();
        } catch (refreshError) {
            console.error('[plinko] profile refresh after failed drop failed:', refreshError);
        }
        state.dropping = false;
        setCurSwitchDisabled(false);
        updateSubmitBtn();
        renderDifficultyTabs();
        showToast(error.code === 'INSUFFICIENT_FUNDS'
            ? `Недостаточно ${window.getCurrencyName(currency)}`
            : 'Не удалось выполнить бросок. Баланс обновлён с сервера.', 'err');
        return;
    }
    window.LootTasks?.trackGameEvent({ game: 'plinko', type: 'bet', currency, bet: amount });

    renderDifficultyTabs();

    const bins = currentTable().mult.length;
    const rows = bins - 1;
    const path = buildPath(rows, result.binIndex);
    animateBall(path, rows, bins, () => finishDrop(result));
}

function animateBall(path, rows, bins, onDone) {
    const board = $('plinkoBoard');
    const ball = $('plinkoBall');
    const boardW = board.clientWidth;
    const boardH = $('plinkoPins').clientHeight;
    const rowH = boardH / rows;
    const spacing = boardW / (bins + 1);

    let rights = 0;
    ball.style.display = 'block';
    ball.style.left = (boardW / 2 - 6) + 'px';
    ball.style.top = '0px';
    vibrate('light');

    let i = 0;
    function step() {
        if (i >= path.length) { onDone(); return; }
        if (path[i]) rights++;
        const x = boardW / 2 + (rights - (i + 1) / 2) * spacing;
        const y = (i + 1) * rowH;
        ball.style.left = (x - 6) + 'px';
        ball.style.top = y + 'px';
        i++;
        setTimeout(step, 90);
    }
    step();
}

function finishDrop(result) {
    const { binIndex, multiplier, payout, displayMultiplier, amount, currency, difficulty } = result;
    state.history.unshift(multiplier);
    state.history = state.history.slice(0, 20);
    localStorage.setItem('plinkoHistory', JSON.stringify(state.history));
    renderHistory();

    highlightBin(binIndex);

    if (payout > 0) {
        showToast(`x${displayMultiplier} → +${payout.toLocaleString('ru-RU')} ${window.getCurrencyShortName(currency)}`, displayMultiplier >= 1 ? 'ok' : 'err');
    } else {
        showToast(`x${multiplier} — не повезло`, 'err');
    }

    window.refreshCurrencyUI();
    window.LootTasks?.trackGameEvent({
        game: 'plinko', type: 'result', currency, bet: amount,
        multiplier: displayMultiplier, difficulty
    });
    vibrate(displayMultiplier >= 1 ? 'success' : 'error');

    state.dropping = false;
    setCurSwitchDisabled(false);
    updateSubmitBtn();
    renderDifficultyTabs();
    setTimeout(() => { $('plinkoBall').style.display = 'none'; }, 900);
}

function highlightBin(index) {
    const bins = document.querySelectorAll('.plinko-bin');
    bins.forEach((el, i) => el.classList.toggle('landed', i === index));
    setTimeout(() => bins.forEach(el => el.classList.remove('landed')), 1600);
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

window.setDifficulty = setDifficulty;
window.addBet = addBet;
window.onSubmit = onSubmit;