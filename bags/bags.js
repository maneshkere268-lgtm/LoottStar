// bags.js — Сумки (звёзды + серебро)
// 3 сумки, игрок открывает одну — выигрыш только с неё. Остальные 2 открываются
// сами через 3 секунды только для антуража; все реальные результаты приходят от API.
const $ = id => document.getElementById(id);
const MIN_BET = 10;
const GIFT_THRESHOLD = { star: 100, silver: 80 };
const AUTO_OPEN_DELAY = 3000;
const LOOT_BAG_IMG = 'https://cdn.changes.tg/gifts/models/Loot%20Bag/png/Original.png';
const PENDING_BAG_KEY = 'bagsPending';

// x0.75 — 30%, x1.0 — 20%, x1.1 — 40%, x1.5 — 5%, x5.0 — 5%
const TABLE = {
    mult:   [0.75, 1.0, 1.1, 1.5, 5.0],
    weight: [30,   20,  40,  5,   5]
};

let state = {
    currency: 'star',
    armed: false,
    submitting: false,
    opened: false,
    profileReady: false,
    betAmount: 0,
    betCurrency: 'star',
    pendingBag: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();

    setupCurrencySwitch();
    renderBags();
    updateMainBtn();

    window.addEventListener('profileDataLoaded', () => window.refreshCurrencyUI());
    try {
        await window.LootStarAPI.loadProfile();
        state.profileReady = true;
        const pending = localStorage.getItem(PENDING_BAG_KEY);
        if (pending) {
            try {
                state.pendingBag = JSON.parse(pending);
            } catch (error) {
                console.error('[bags] pending operation state is invalid:', error);
                localStorage.removeItem(PENDING_BAG_KEY);
            }
        }
        if (state.pendingBag && Number.isSafeInteger(state.pendingBag.amount) &&
            ['star', 'silver'].includes(state.pendingBag.currency) &&
            Number.isInteger(state.pendingBag.index) && state.pendingBag.index >= 0 &&
            state.pendingBag.index < 3 && typeof state.pendingBag.requestId === 'string') {
            state.armed = true;
            state.betAmount = state.pendingBag.amount;
            state.betCurrency = state.pendingBag.currency;
            state.opened = false;
            setCurSwitchDisabled(true);
            document.querySelectorAll('.bag-slot').forEach(el => { el.className = 'bag-slot active'; });
            await onBagClick(state.pendingBag.index);
        } else if (state.pendingBag) {
            console.error('[bags] pending operation state has invalid fields');
            localStorage.removeItem(PENDING_BAG_KEY);
            state.pendingBag = null;
        }
    } catch (error) {
        console.error('[bags] profile load failed:', error);
        $('bagsSubmit').disabled = true;
        showToast('Не удалось загрузить баланс с сервера', 'err');
    }
}

function setupCurrencySwitch() {
    window.renderCurrencySwitch($('curSwitch'), state.currency, (cur) => {
        state.currency = cur;
        updateMainBtn();
    });
    setCurSwitchDisabled(false);
}

function setCurSwitchDisabled(disabled) {
    const el = $('curSwitch');
    if (!el) return;
    el.classList.toggle('disabled', disabled);
}

function pickWeightedIndex(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function renderBags() {
    const wrap = $('bagsGrid');
    let h = '';
    for (let i = 0; i < 3; i++) {
        h += `
            <div class="bag-slot" id="bagSlot${i}" onclick="onBagClick(${i})">
                <div class="bag-closed">
                    <img class="bag-img" src="${LOOT_BAG_IMG}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                </div>
                <div class="bag-reveal" id="bagReveal${i}">
                    <img class="bag-reveal-img" id="bagRevealImg${i}" src="" alt="">
                    <div class="bag-reveal-price" id="bagRevealPrice${i}">
                        <img class="bag-reveal-cur" id="bagRevealCur${i}" src="" alt="">
                        <span id="bagRevealAmount${i}"></span>
                    </div>
                </div>
            </div>`;
    }
    wrap.innerHTML = h;
}

function updateMainBtn() {
    const b = $('bagsSubmit');
    if (state.armed || state.submitting) {
        b.disabled = true;
        b.textContent = state.opened ? 'Раунд завершён...' : 'Выберите сумку';
    } else {
        b.disabled = false;
        b.textContent = `Открыть (${window.getCurrencyName(state.currency)})`;
    }
}

async function onSubmit() {
    if (state.armed || state.submitting) return;
    if (!state.profileReady) {
        showToast('Нет связи с сервером', 'err');
        return;
    }
    const amount = parseInt($('betAmount').value) || 0;
    if (amount < MIN_BET) {
        showToast(`Минимум ${MIN_BET} ${window.getCurrencyShortName(state.currency)}`, 'err');
        return;
    }
    if (amount > window.GameLimits.MAX_BET) {
        showToast('Максимальная ставка — 50 000 000', 'err');
        return;
    }
    if (amount > window.getBalance(state.currency)) {
        showToast(`Недостаточно ${window.getCurrencyName(state.currency)}`, 'err');
        return;
    }

    state.armed = true;
    state.opened = false;
    state.betAmount = amount;
    state.betCurrency = state.currency;

    document.querySelectorAll('.bag-slot').forEach(el => {
        el.className = 'bag-slot active';
    });

    setCurSwitchDisabled(true);
    updateMainBtn();
    vibrate('light');
}

// Что показать в открытой сумке: подарок (если «наскрёб») или иконку валюты
function resolveDrop(win, cur, awardGift) {
    const r = window.pickGiftForWin(win, cur);
    const threshold = GIFT_THRESHOLD[cur] || 100;
    if (r.gift && r.gift.price >= threshold) {
        return {
            gift: awardGift ? r.gift : null,
            remainder: r.remainder,
            display: { img: r.gift.image, priceIcon: window.getCurrencyIcon(cur), amount: r.gift.price }
        };
    }
    return {
        gift: null,
        remainder: win,
        display: { img: window.getCurrencyIcon(cur), priceIcon: window.getCurrencyIcon(cur), amount: win }
    };
}

async function onBagClick(index) {
    if (!state.armed || state.submitting || (state.opened && !state.pendingBag)) return;
    if (state.pendingBag && index !== state.pendingBag.index) {
        showToast('Повторите открытие той же сумки', 'err');
        return;
    }
    if (!state.pendingBag) {
        state.pendingBag = {
            index,
            amount: state.betAmount,
            currency: state.betCurrency,
            requestId: window.LootStarAPI.createRequestId()
        };
        localStorage.setItem(PENDING_BAG_KEY, JSON.stringify(state.pendingBag));
    }
    state.opened = true;
    state.submitting = true;
    updateMainBtn();

    try {
        const result = await window.LootStarAPI.playBags(
            state.pendingBag.amount, state.pendingBag.currency, state.pendingBag.requestId
        );
        window.LootStarAPI.applyInventoryResult(result);
        const cur = result.currency;
        const mult = result.multiplier;
        const drop = result.gift
            ? {
                gift: result.gift,
                remainder: result.remainder,
                display: {
                    img: result.gift.image,
                    priceIcon: window.getCurrencyIcon(cur),
                    amount: result.gift.price
                }
            }
            : {
                gift: null,
                remainder: result.remainder,
                display: {
                    img: window.getCurrencyIcon(cur),
                    priceIcon: window.getCurrencyIcon(cur),
                    amount: result.remainder
                }
            };
        revealBag(index, drop.display, true);
        document.querySelectorAll('.bag-slot').forEach((el, i) => {
            if (i !== index) el.classList.add('faded');
            el.classList.remove('active');
        });
        state.pendingBag = null;
        localStorage.removeItem(PENDING_BAG_KEY);
        state.submitting = false;

        if (drop.gift) {
            showToast(
                `🎁 ${drop.gift.name}${drop.remainder > 0 ? ` + ${drop.remainder.toLocaleString('ru-RU')}` : ''}`,
                mult >= 1 ? 'ok' : 'err'
            );
        } else {
            showToast(
                `+${drop.remainder.toLocaleString('ru-RU')} ${window.getCurrencyShortName(cur)}`,
                mult >= 1 ? 'ok' : 'err'
            );
        }

        vibrate(mult >= 1 ? 'success' : 'error');
        setTimeout(() => autoOpenRest(index), AUTO_OPEN_DELAY);
    } catch (error) {
        console.error('[bags] API operation failed:', error);
        state.submitting = false;
        state.opened = false;
        if (error.status && error.status < 500) {
            state.pendingBag = null;
            localStorage.removeItem(PENDING_BAG_KEY);
            state.armed = false;
            setCurSwitchDisabled(false);
            renderBags();
        }
        updateMainBtn();
        try {
            await window.LootStarAPI.loadProfile();
        } catch (profileError) {
            console.error('[bags] profile refresh failed:', profileError);
        }
        showToast(error.status && error.status < 500
            ? 'Раунд не выполнен: ' + error.code
            : 'Нет связи с сервером. Повторите открытие той же сумки', 'err');
    }
}

function autoOpenRest(chosenIndex) {
    // The two unchosen bags are decorative and never affect account state.
    const cur = state.betCurrency;
    const amount = state.betAmount;
    for (let i = 0; i < 3; i++) {
        if (i === chosenIndex) continue;
        const idx = pickWeightedIndex(TABLE.weight);
        const mult = TABLE.mult[idx];
        const win = Math.floor(amount * mult);
        const drop = resolveDrop(win, cur, false); // только для показа
        revealBag(i, drop.display, false);
    }
    setTimeout(resetRound, 1400);
}

function revealBag(index, display, isMine) {
    const slot = $('bagSlot' + index);
    slot.classList.add('opened');
    slot.classList.remove('active');
    if (!isMine) slot.classList.add('cosmetic');

    $('bagRevealImg' + index).src = display.img;
    $('bagRevealImg' + index).onerror = function () { this.onerror = null; this.src = window.GIFT_FALLBACK; };
    $('bagRevealCur' + index).src = display.priceIcon;
    $('bagRevealAmount' + index).textContent = display.amount.toLocaleString('ru-RU');
}

function resetRound() {
    state.armed = false;
    state.opened = false;
    setCurSwitchDisabled(false);
    updateMainBtn();
    renderBags();
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

window.onSubmit = onSubmit;
window.onBagClick = onBagClick;