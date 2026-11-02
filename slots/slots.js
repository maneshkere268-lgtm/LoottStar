// slots.js — Слоты (звёзды + серебро)
const $ = id => document.getElementById(id);
const MIN_BET = 10;

const REEL_ITEM_H = 84;
const REEL_VISIBLE = 3;
const STRIP_LEN = 24;

let state = {
    currency: 'star',
    spinning: false,
    ready: false
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();
    setupCurrencySwitch();
    buildEmptyReels();
    updateSubmitBtn();
    try {
        await window.LootStarAPI.loadProfile();
        state.ready = true;
        window.refreshCurrencyUI();
        updateSubmitBtn();
    } catch (error) {
        console.error('[slots] failed to initialize:', error);
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

function setBet(v) { $('betAmount').value = window.GameLimits.capBet(v); }
function setBetMax() { $('betAmount').value = Math.min(window.GameLimits.MAX_BET, Math.max(MIN_BET, window.getBalance(state.currency))); }

function updateSubmitBtn() {
    const b = $('slotsSubmit');
    if (!b) return;
    if (!state.ready || state.spinning) {
        b.disabled = true;
        b.textContent = state.spinning ? 'Крутим...' : 'Загрузка...';
    } else {
        b.disabled = false;
        b.textContent = `Крутить за (${window.getCurrencyName(state.currency)})`;
    }
}

function buildEmptyReels() {
    for (let r = 0; r < 3; r++) {
        const strip = $('reelStrip' + r);
        strip.style.transform = 'translateY(0px)';
        strip.innerHTML = `<div class="slot-item empty-slot"></div>`.repeat(REEL_VISIBLE);
    }
    const firstItem = document.querySelector('.slot-item');
    state.itemH = firstItem ? firstItem.getBoundingClientRect().height : REEL_ITEM_H;
}

function symbolMarkup(imgSrc, isEmpty) {
    if (isEmpty) return `<div class="slot-item empty-slot"><span>—</span></div>`;
    return `<div class="slot-item"><img src="${imgSrc}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'"></div>`;
}

function buildStrip(targetImg, isEmpty) {
    const symbols = [window.STAR_ICON, window.SILVER_ICON, window.GIFT_FALLBACK];
    let html = '';
    for (let i = 0; i < STRIP_LEN - 2; i++) {
        const image = symbols[Math.floor(Math.random() * symbols.length)];
        html += symbolMarkup(image, false);
    }
    html += symbolMarkup(null, true);
    html += symbolMarkup(targetImg, isEmpty);
    html += symbolMarkup(null, true);
    return html;
}

async function onSubmit() {
    if (!state.ready || state.spinning) return;

    const amount = parseInt($('betAmount').value) || 0;
    if (amount < MIN_BET) {
        showToast(`Минимум ${MIN_BET} ${window.getCurrencyShortName(state.currency)}`, 'err');
        return;
    }
    if (amount > window.GameLimits.MAX_BET) {
        showToast('Максимальная ставка — 50 000 000', 'err');
        return;
    }
    state.spinning = true;
    setCurSwitchDisabled(true);
    updateSubmitBtn();
    const cur = state.currency;
    let result;
    try {
        result = await window.LootStarAPI.spinSlots(amount, cur);
        window.LootStarAPI.applyBalanceResult(result);
    } catch (error) {
        console.error('[slots] spin failed:', error);
        try {
            await window.LootStarAPI.loadProfile();
        } catch (refreshError) {
            console.error('[slots] profile refresh after failed spin failed:', refreshError);
        }
        state.spinning = false;
        setCurSwitchDisabled(false);
        updateSubmitBtn();
        showToast(error.code === 'INSUFFICIENT_FUNDS'
            ? `Недостаточно ${window.getCurrencyName(cur)}`
            : 'Не удалось выполнить прокрутку. Баланс обновлён с сервера.', 'err');
        return;
    }

    window.LootTasks?.trackGameEvent({
        game: 'slots', type: 'bet', currency: cur, bet: amount
    });

    vibrate('light');

    for (let r = 0; r < 3; r++) {
        const strip = $('reelStrip' + r);
        strip.style.transition = 'none';
        strip.style.transform = 'translateY(0px)';
        strip.innerHTML = buildStrip(
            result.payout > 0 ? window.getCurrencyIcon(cur) : null,
            result.payout <= 0
        );
        void strip.offsetHeight;
    }

    let stopped = 0;
    for (let r = 0; r < 3; r++) {
        setTimeout(() => {
            const strip = $('reelStrip' + r);
            const finalY = -(STRIP_LEN - 2) * state.itemH;
            strip.style.transition = `transform ${0.6 + r * 0.15}s cubic-bezier(.17,.67,.32,1.1)`;
            strip.style.transform = `translateY(${finalY}px)`;
            vibrate('light');
            stopped++;
            if (stopped === 3) {
                setTimeout(() => finishSpin(result), 700);
            }
        }, 250 + r * 380);
    }
}

function finishSpin(result) {
    const { amount, currency, payout, displayMultiplier } = result;
    if (payout > 0) {
        showToast(
            `x${displayMultiplier.toFixed(2)} → +${payout.toLocaleString('ru-RU')} ${window.getCurrencyShortName(currency)}`,
            displayMultiplier >= 1 ? 'ok' : 'err'
        );
    } else {
        showToast(`x0 — пусто`, 'err');
    }

    window.LootTasks?.trackGameEvent({
        game: 'slots',
        type: 'result',
        currency,
        bet: amount,
        multiplier: displayMultiplier
    });

    vibrate(payout >= amount ? 'success' : 'error');
    window.refreshCurrencyUI();

    state.spinning = false;
    setCurSwitchDisabled(false);
    updateSubmitBtn();
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2800);
}

window.setBet = setBet;
window.setBetMax = setBetMax;
window.onSubmit = onSubmit;