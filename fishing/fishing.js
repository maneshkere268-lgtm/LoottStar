const $ = id => document.getElementById(id);
const CDN = 'https://cdn.changes.tg/gifts/models';

/* 28-step multiplier ladder; the server controls all catches and payouts. */
const STEPS = [
    1.05, 1.12, 1.21, 1.3, 1.41, 1.51, 1.63, 1.75, 1.87, 2,     // шаги 1-10: до x2
    2.3, 2.65, 3, 3.5, 4, 4.6, 5.3, 6.1, 7.1, 8.1,              // шаги 11-20
    9.4, 11, 12, 14, 16, 19, 22, 25                              // шаги 21-28
];
const MAX_STEP = STEPS.length; // 28
const MAX_PAYOUT = 250_000_000;
const PENDING_KEY = 'fishingPending';

const KRAKEN_NAME = 'Plush Pepe (Kraken)';
const REVEAL_DELAY_MIN = 5000;   // первый заброс — как и просили, 5-10 сек
const REVEAL_DELAY_MAX = 10000;
const CONTINUE_DELAY_MIN = 2000; // «Продолжить» — новый улов должен клевать быстрее
const CONTINUE_DELAY_MAX = 4000;

let state = {
    currency: 'star',
    bet: 100,
    step: 0,          // 0 = раунд не начат
    busy: false,       // идёт заброс/ожидание
    actionInFlight: false,
    gameId: null,
    profileReady: false,
    pendingOperation: null,
    revealTimer: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG?.updateHeaderUI?.();
    window.refreshCurrencyUI?.();

    const avatarUrl = window.TG?.user?.photo_url;
    if (avatarUrl) $('fishAvatar').src = avatarUrl;

    renderCurrencyControl();
    syncBetUI();
    renderLadder();

    $('fishBetInput').addEventListener('input', () => {
        const v = $('fishBetInput').value.replace(/[^\d]/g, '');
        $('fishBetInput').value = v;
    });

    window.addEventListener('profileDataLoaded', () => window.refreshCurrencyUI?.());

    document.addEventListener('click', e => {
        const el = e.target.closest('button');
        if (el) window.vibrate?.('light');
    });
    try {
        await window.LootStarAPI.loadProfile();
        state.profileReady = true;
        try {
            state.pendingOperation = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
        } catch (error) {
            console.error('[fishing] pending operation state is invalid:', error);
            localStorage.removeItem(PENDING_KEY);
        }
        if (state.pendingOperation) {
            await recoverPendingOperation();
        } else {
            const { game } = await window.LootStarAPI.getCurrentFishing();
            if (game) restoreGame(game);
        }
    } catch (error) {
        console.error('[fishing] API initialization failed:', error);
        $('fishCastBtn').disabled = true;
        showToast('Не удалось подключиться к серверу игры', 'err');
    }
}

function syncBetUI() {
    $('fishBetIcon').src = window.getCurrencyIcon?.(state.currency) || '/shared/star.png';
}

function renderCurrencyControl() {
    window.renderCurrencySwitch?.($('curSwitchSlot'), state.currency, cur => {
        state.currency = cur;
        syncBetUI();
    });
}

function getCurBet() {
    return Math.max(1, parseInt($('fishBetInput').value) || 0);
}

function betMul(mul) {
    if (state.busy) return;
    const bal = window.getBalance?.(state.currency) || 0;
    const next = Math.max(1, Math.round(getCurBet() * mul));
    $('fishBetInput').value = Math.min(next, Math.max(1, bal));
}

function betMax() {
    if (state.busy) return;
    const bal = Math.floor(window.getBalance?.(state.currency) || 0);
    $('fishBetInput').value = Math.max(1, bal);
}

/* ═══════════════ ЛЕСТНИЦА (визуал прогресса) ═══════════════ */
function renderLadder() {
    const wrap = $('fishLadder');
    wrap.innerHTML = STEPS.map((m, i) => {
        const n = i + 1;
        let cls = 'fish-step';
        if (n < state.step) cls += ' passed';
        else if (n === state.step) cls += ' current';
        if (n === MAX_STEP) cls += ' max';
        return `<div class="${cls}" data-step="${n}">x${m}</div>`;
    }).join('');

    // длинная лестница: держим текущий шаг в центре
    const cur = wrap.querySelector('.fish-step.current');
    const target = cur
        ? wrap.scrollLeft + (cur.getBoundingClientRect().left - wrap.getBoundingClientRect().left)
            - wrap.clientWidth / 2 + cur.offsetWidth / 2
        : 0;
    wrap.scrollTo({ left: Math.max(0, target), behavior: cur ? 'smooth' : 'auto' });
}

/* ═══════════════ СТАРТ ЗАБРОСА ═══════════════ */
async function castRod() {
    if (state.busy || state.actionInFlight) return;
    if (!state.profileReady) {
        showToast('Нет связи с сервером', 'err');
        return;
    }
    const bet = getCurBet();
    const bal = window.getBalance?.(state.currency) || 0;
    if (bet <= 0) { showToast('Введите ставку', 'err'); return; }
    const retryStart = state.pendingOperation?.action === 'start' &&
        state.pendingOperation.amount === bet &&
        state.pendingOperation.currency === state.currency;
    if (state.pendingOperation && !retryStart) {
        showToast('Сначала завершите предыдущую операцию', 'err');
        return;
    }
    if (!retryStart && bet > bal) {
        showToast(`Недостаточно ${state.currency === 'silver' ? 'серебра' : 'звёзд'}`, 'err');
        return;
    }

    state.pendingOperation = state.pendingOperation || {
        action: 'start',
        amount: bet,
        currency: state.currency,
        requestId: window.LootStarAPI.createRequestId()
    };
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pendingOperation));
    state.actionInFlight = true;
    state.bet = bet;
    state.currency = state.pendingOperation.currency;
    showCastingState();
    try {
        const result = await window.LootStarAPI.startFishing(
            state.pendingOperation.amount,
            state.pendingOperation.currency,
            state.pendingOperation.requestId
        );
        window.LootStarAPI.applyBalanceResult(result);
        clearPendingOperation();
        state.actionInFlight = false;
        activateGame(result.game);
    } catch (error) {
        console.error('[fishing] start request failed:', error);
        handleStartFailure(error);
    }
}

function continueFishing() {
    if (!state.busy || state.actionInFlight || state.step >= MAX_STEP) return;
    if (state.pendingOperation?.action === 'cashout') {
        showToast('Повторите сбор выигрыша', 'err');
        return;
    }
    $('fishResultRow').style.display = 'none';
    $('fishReveal').style.display = 'none';
    $('fishHook').classList.add('bite');
    revealNext(true);
}

/* ═══════════════ ОЖИДАНИЕ + РЕВЕАЛ ═══════════════
   fast = true — вызвано после «Продолжить»: новый улов клюёт быстрее (2-4 сек),
   иначе (первый заброс) — как и просили, 5-10 сек. */
function revealNext(fast = false) {
    const min = fast ? CONTINUE_DELAY_MIN : REVEAL_DELAY_MIN;
    const max = fast ? CONTINUE_DELAY_MAX : REVEAL_DELAY_MAX;
    const delay = min + Math.random() * (max - min);
    $('fishHook').classList.add('bite');

    state.revealTimer = setTimeout(() => {
        $('fishHook').classList.remove('bite');
        $('fishBoat').classList.remove('casting');
        performContinue();
    }, delay);
}

function showCastingState() {
    state.step = 0;
    state.busy = true;
    lockPanel(true);
    $('fishIdleHint').style.display = 'none';
    $('fishResultRow').style.display = 'none';
    $('fishReveal').style.display = 'none';
    $('fishKraken').style.display = 'none';
    $('fishBoat').classList.add('casting');
    $('fishLine').classList.add('visible');
    $('fishHook').classList.add('visible');
    renderLadder();
}

function activateGame(game) {
    state.gameId = game.gameId;
    state.currency = game.currency;
    state.bet = Number(game.amount);
    state.step = Number(game.step);
    state.busy = true;
    state.actionInFlight = false;
    renderCurrencyControl();
    syncBetUI();
    if (state.step === 0) {
        showCastingState();
    } else {
        lockPanel(true);
        $('fishIdleHint').style.display = 'none';
        $('fishResultRow').style.display = 'none';
        $('fishReveal').style.display = 'none';
        $('fishKraken').style.display = 'none';
        $('fishBoat').classList.remove('casting');
        $('fishLine').classList.add('visible');
        $('fishHook').classList.add('visible');
    }
    renderLadder();
    if (state.step > 0) {
        showReveal(STEPS[state.step - 1], state.step);
    } else {
        revealNext();
    }
}

async function recoverPendingOperation() {
    const pending = state.pendingOperation;
    if (!pending || typeof pending.requestId !== 'string') {
        clearPendingOperation();
        return;
    }
    try {
        if (pending.action === 'start') {
            const result = await window.LootStarAPI.startFishing(
                pending.amount, pending.currency, pending.requestId
            );
            window.LootStarAPI.applyBalanceResult(result);
            clearPendingOperation();
            activateGame(result.game);
            return;
        }
        if (pending.action === 'continue') {
            const result = await window.LootStarAPI.continueFishing(pending.gameId, pending.requestId);
            clearPendingOperation();
            applyStepResult(result.game);
            return;
        }
        if (pending.action === 'cashout') {
            const result = await window.LootStarAPI.cashoutFishing(pending.gameId, pending.requestId);
            clearPendingOperation();
            finishCashout(result);
            return;
        }
        clearPendingOperation();
    } catch (error) {
        console.error('[fishing] pending operation recovery failed:', error);
        if (error.status && error.status < 500) clearPendingOperation();
        if (pending.action === 'start') {
            state.currency = pending.currency;
            $('fishBetInput').value = String(pending.amount);
            renderCurrencyControl();
            syncBetUI();
        }
        if (pending.gameId) {
            try {
                const { game } = await window.LootStarAPI.getCurrentFishing();
                if (game) activateGame(game);
            } catch (profileError) {
                console.error('[fishing] active round recovery failed:', profileError);
            }
        }
        showToast(error.status && error.status < 500
            ? 'Не удалось восстановить раунд: ' + error.code
            : 'Нет связи с сервером. Повторите действие', 'err');
    }
}

function clearPendingOperation() {
    state.pendingOperation = null;
    localStorage.removeItem(PENDING_KEY);
}

function handleStartFailure(error) {
    state.actionInFlight = false;
    state.busy = false;
    lockPanel(false);
    $('fishBoat').classList.remove('casting');
    $('fishLine').classList.remove('visible');
    $('fishHook').classList.remove('visible', 'bite');
    $('fishIdleHint').style.display = 'block';
    if (error.status && error.status < 500) clearPendingOperation();
    showToast(error.status && error.status < 500
        ? 'Не удалось начать раунд: ' + error.code
        : 'Нет связи с сервером. Повторите заброс', 'err');
}

async function performContinue() {
    if (state.actionInFlight || !state.gameId) return;
    state.pendingOperation = state.pendingOperation?.action === 'continue'
        ? state.pendingOperation
        : {
            action: 'continue',
            gameId: state.gameId,
            requestId: window.LootStarAPI.createRequestId()
        };
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pendingOperation));
    state.actionInFlight = true;
    try {
        const result = await window.LootStarAPI.continueFishing(
            state.gameId, state.pendingOperation.requestId
        );
        clearPendingOperation();
        state.actionInFlight = false;
        applyStepResult(result.game);
    } catch (error) {
        console.error('[fishing] continue request failed:', error);
        state.actionInFlight = false;
        if (error.status && error.status < 500) clearPendingOperation();
        if (state.step > 0) {
            showReveal(STEPS[state.step - 1], state.step);
        } else {
            showRetryCast();
        }
        showToast(error.status && error.status < 500
            ? 'Не удалось продолжить: ' + error.code
            : 'Нет связи с сервером. Повторите попытку', 'err');
    }
}

function applyStepResult(game) {
    state.gameId = game.gameId;
    state.currency = game.currency;
    state.bet = Number(game.amount);
    state.step = Number(game.step);
    state.busy = true;
    lockPanel(true);
    if (game.status === 'lost') {
        endRoundBust();
        return;
    }
    showReveal(STEPS[state.step - 1], state.step);
    renderLadder();
}

function showRetryCast() {
    $('fishIdleHint').style.display = 'none';
    $('fishReveal').style.display = 'none';
    $('fishResultRow').style.display = 'flex';
    $('fishContinueBtn').disabled = false;
    $('fishContinueBtn').textContent = 'Повторить заброс';
    $('fishCollectBtn').disabled = true;
}

function showReveal(mult, step) {
    const payout = Math.min(MAX_PAYOUT, Math.round(state.bet * mult));
    const item = pickFlavorItem(payout);
    state.lastItem = item;
    $('fishRevealImg').src = giftImg(item);
    $('fishRevealImg').onerror = function () { this.onerror = null; this.src = window.GIFT_FALLBACK || '/shared/star.png'; };
    $('fishRevealMult').textContent = `x${mult}`;
    $('fishRevealName').textContent = item.name;

    // Реальная цена модели из shared/gifts.js — для ориентира, не влияет на выплату.
    const priceEl = $('fishRevealPrice');
    if (typeof item.price === 'number') {
        priceEl.innerHTML = `<img src="${window.STAR_ICON || '/shared/star.png'}" alt="">Модель: ${window.formatStars(item.price)}`;
        priceEl.style.display = 'flex';
    } else {
        priceEl.style.display = 'none';
    }

    $('fishReveal').style.display = 'flex';

    const isMax = step === MAX_STEP;
    $('fishResultRow').style.display = 'flex';
    $('fishContinueBtn').disabled = isMax;
    $('fishContinueBtn').textContent = isMax ? 'Максимум достигнут' : 'Продолжить';
    $('fishCollectBtn').disabled = false;
    $('fishCollectBtn').textContent = `Забрать · ${window.formatStars(payout)}`;

    if (isMax) {
        showToast('Достигнут максимум x25!', 'ok');
    }
}

// Берёт реальные предметы и их цены из shared/gifts.js (window.ALL_GIFTS_STAR,
// собранный там из GIFTS + SPECIAL_GIFTS). Подбирает модель, чья каталожная
// цена ближе всего к текущей потенциальной выплате — улов выглядит осмысленно,
// а не случайным предметом произвольной ценности.
function pickFlavorItem(targetValue) {
    const pool = window.ALL_GIFTS_STAR;
    if (!Array.isArray(pool) || !pool.length) return { name: 'Улов' };

    const sorted = [...pool].sort((a, b) =>
        Math.abs((a.price || 0) - targetValue) - Math.abs((b.price || 0) - targetValue)
    );
    const candidates = sorted.slice(0, Math.min(8, sorted.length));
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Принимает либо объект подарка из gifts.js (есть готовое поле .image — берём
// его как есть, это касается и SPECIAL_GIFTS с локальными путями вроде
// /shared/bear.png), либо просто имя (для Кракена, которого в gifts.js нет) —
// тогда достраиваем URL по той же схеме, что и в shared/gifts.js/index.js.
function giftImg(itemOrName) {
    const item = typeof itemOrName === 'string' ? null : itemOrName;
    const name = item ? item.name : itemOrName;
    if (item && item.image) return item.image;
    if (!name) return window.GIFT_FALLBACK || '/shared/star.png';
    const modelMatch = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (modelMatch && window.encodePathPart) {
        return `${CDN}/${window.encodePathPart(modelMatch[1].trim())}/png/${window.encodePathPart(modelMatch[2].trim())}.png`;
    }
    if (window.encodePathPart) return `${CDN}/${window.encodePathPart(name)}/png/Original.png`;
    return window.GIFT_FALLBACK || '/shared/star.png';
}

/* ═══════════════ ЗАБРАТЬ ВЫИГРЫШ ═══════════════ */
async function collectWin() {
    if (!state.busy || state.actionInFlight || state.step < 1 || !state.gameId) return;
    if (state.pendingOperation?.action === 'continue') {
        showToast('Повторите проверку улова', 'err');
        return;
    }
    state.pendingOperation = state.pendingOperation?.action === 'cashout'
        ? state.pendingOperation
        : {
            action: 'cashout',
            gameId: state.gameId,
            requestId: window.LootStarAPI.createRequestId()
        };
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pendingOperation));
    state.actionInFlight = true;
    try {
        const result = await window.LootStarAPI.cashoutFishing(
            state.gameId, state.pendingOperation.requestId
        );
        clearPendingOperation();
        finishCashout(result);
    } catch (error) {
        console.error('[fishing] cashout request failed:', error);
        state.actionInFlight = false;
        if (error.status && error.status < 500) clearPendingOperation();
        if (state.step > 0) showReveal(STEPS[state.step - 1], state.step);
        showToast(error.status && error.status < 500
            ? 'Не удалось забрать выигрыш: ' + error.code
            : 'Нет связи с сервером. Нажмите «Забрать» ещё раз', 'err');
    }
}

function finishCashout(result) {
    window.LootStarAPI.applyBalanceResult(result);
    const payout = Number(result.payout) || 0;
    const mult = Number(result.game?.multiplier) || STEPS[state.step - 1];
    window.vibrate?.('success');
    showToast(`Поймано: +${window.formatStars(payout)} (x${mult})`, 'ok');
    resetRound();
}

/* ═══════════════ КРАКЕН — ПРОИГРЫШ ═══════════════ */
function endRoundBust() {
    $('fishReveal').style.display = 'none';
    $('fishKrakenImg').src = giftImg(KRAKEN_NAME);
    $('fishKrakenImg').onerror = function () { this.onerror = null; this.src = window.GIFT_FALLBACK || '/shared/star.png'; };
    $('fishKraken').style.display = 'flex';
    $('fishResultRow').style.display = 'none';
    window.vibrate?.('error');

    setTimeout(() => {
        showToast('Кракен утащил удочку — ставка потеряна', 'err');
        resetRound();
    }, 1600);
}

/* ═══════════════ СБРОС РАУНДА ═══════════════ */
function resetRound() {
    if (state.revealTimer) { clearTimeout(state.revealTimer); state.revealTimer = null; }
    state.step = 0;
    state.busy = false;
    state.actionInFlight = false;
    state.gameId = null;
    clearPendingOperation();
    lockPanel(false);

    $('fishLine').classList.remove('visible');
    $('fishHook').classList.remove('visible', 'bite');
    $('fishBoat').classList.remove('casting');
    $('fishReveal').style.display = 'none';
    $('fishKraken').style.display = 'none';
    $('fishResultRow').style.display = 'none';
    $('fishIdleHint').style.display = 'block';
    renderLadder();
}

function lockPanel(lock) {
    $('fishCastBtn').disabled = lock;
    $('fishBetInput').disabled = lock;
    document.querySelectorAll('.fish-bet-quick button').forEach(b => b.disabled = lock);
    const sw = $('curSwitchSlot').querySelector('.cur-switch');
    if (sw) sw.classList.toggle('disabled', lock);
}

function showRetryCast() {
    $('fishIdleHint').style.display = 'none';
    $('fishReveal').style.display = 'none';
    $('fishResultRow').style.display = 'flex';
    $('fishContinueBtn').disabled = false;
    $('fishContinueBtn').textContent = 'Повторить заброс';
    $('fishCollectBtn').disabled = true;
}

function showToast(msg, type = 'ok') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

window.betMul = betMul;
window.betMax = betMax;
window.castRod = castRod;
window.continueFishing = continueFishing;
window.collectWin = collectWin;