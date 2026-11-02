// craft.js — Крафт (раздельные вкладки: Звёзды / Серебро, смешивать нельзя)
const $ = id => document.getElementById(id);
const MAX_SLOTS = 9;
const PENDING_CRAFT_KEY = 'craftPending';

let state = {
    currency: 'star',
    inventory: [],
    selected: { star: new Array(MAX_SLOTS).fill(null), silver: new Array(MAX_SLOTS).fill(null) },
    selectingSlot: null
};
let crafting = false;
let pendingCraft = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();

    setupCurrencySwitch();
    renderSlots();

    window.addEventListener('profileDataLoaded', event => {
        if (event.detail?.source !== 'api') return;
        if (Array.isArray(event.detail.inventory)) state.inventory = event.detail.inventory;
        window.refreshCurrencyUI();
        renderSlots();
    });

    try {
        const user = await window.LootStarAPI.loadProfile();
        state.inventory = Array.isArray(user.inventory) ? user.inventory : [];
        try {
            pendingCraft = JSON.parse(localStorage.getItem(PENDING_CRAFT_KEY) || 'null');
        } catch (error) {
            console.error('[craft] pending operation state is invalid:', error);
            localStorage.removeItem(PENDING_CRAFT_KEY);
        }
        if (pendingCraft && (
            !Array.isArray(pendingCraft.itemIds) ||
            pendingCraft.itemIds.length < 3 ||
            pendingCraft.itemIds.length > MAX_SLOTS ||
            new Set(pendingCraft.itemIds).size !== pendingCraft.itemIds.length ||
            !['star', 'silver'].includes(pendingCraft.currency) ||
            typeof pendingCraft.currency !== 'string' ||
            typeof pendingCraft.requestId !== 'string'
        )) {
            console.error('[craft] pending operation state is invalid');
            pendingCraft = null;
            localStorage.removeItem(PENDING_CRAFT_KEY);
        }
        renderSlots();
        if (pendingCraft) await submitCraft(pendingCraft);
    } catch (error) {
        console.error('[craft] initialization failed:', error);
        showToast('Не удалось загрузить инвентарь с сервера', 'err');
        $('craftBtn').disabled = true;
    }
}

function setupCurrencySwitch() {
    window.renderCurrencySwitch($('curSwitch'), state.currency, (cur) => {
        if (crafting || pendingCraft) return;
        state.currency = cur;
        renderSlots();
    });
}

function currentSelected() { return state.selected[state.currency]; }

function renderSlots() {
    const c = $('craftSlots');
    c.classList.remove('star-mode', 'silver-mode');
    c.classList.add(state.currency + '-mode');

    const sel = currentSelected();
    let h = '';
    for (let i = 0; i < MAX_SLOTS; i++) {
        const item = sel[i];
        if (item) {
            const val = item.stars || Math.round((item.price || 0) * (state.currency === 'star' ? 125 : 1));
            h += `
                <div class="craft-slot filled" onclick="openSelector(${i})">
                    <span class="slot-index">${i + 1}</span>
                    <img src="${item.image}" alt="${item.name}" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                    <div class="slot-price"><img src="${window.getCurrencyIcon(state.currency)}" alt="">${val.toLocaleString('ru-RU')}</div>
                    <button class="slot-remove" onclick="event.stopPropagation();removeSlot(${i})">✕</button>
                </div>
            `;
        } else {
            h += `
                <div class="craft-slot" onclick="openSelector(${i})">
                    <span class="slot-index">${i + 1}</span>
                    <span style="font-size:24px;opacity:.4">+</span>
                </div>
            `;
        }
    }
    c.innerHTML = h;
    updateInfo();
}

function itemValue(item) {
    return item.stars || Math.round((item.price || 0) * (state.currency === 'star' ? 125 : 1));
}

function updateInfo() {
    const items = currentSelected().filter(x => x !== null);
    const cnt = items.length;
    const b = $('craftBtn');
    const curName = window.getCurrencyName(state.currency);

    if (pendingCraft) {
        $('craftInfo').textContent = 'Результат ожидает подтверждения сервера';
        b.textContent = 'Повторить запрос';
        b.disabled = crafting;
        return;
    }

    if (cnt < 3) {
        $('craftInfo').innerHTML = `Выбрано (${curName}): <span>${cnt}</span>/3 · выберите ещё ${3 - cnt}`;
        b.textContent = 'Выберите предметы';
        b.disabled = true;
    } else {
        const total = items.reduce((s, x) => s + itemValue(x), 0);
        const minD = Math.floor(total * 0.5);
        const maxD = Math.floor(total * 2.5);
        const icon = `<img src="${window.getCurrencyIcon(state.currency)}" style="width:11px;height:11px;vertical-align:-1px">`;
        $('craftInfo').innerHTML = `Дроп от <span>${minD.toLocaleString('ru-RU')}</span> до <span>${maxD.toLocaleString('ru-RU')}</span> ${icon} · предметов: ${cnt}`;
        b.textContent = 'Крафт';
        b.disabled = false;
    }
}

function openSelector(slotIdx) {
    if (crafting || pendingCraft) return;
    state.selectingSlot = slotIdx;
    renderSelectGrid();
    $('selectModal').classList.add('open');
    vibrate();
}

function closeSelector() {
    $('selectModal').classList.remove('open');
    state.selectingSlot = null;
}

function renderSelectGrid() {
    const g = $('selectGrid');
    const inv = state.inventory.filter(item => (item.currency || 'star') === state.currency);
    if (!inv.length) {
        const curName = window.getCurrencyName(state.currency);
        g.innerHTML = `<div class="inv-select-empty">Нет предметов за ${curName} в инвентаре<br><small style="opacity:.6">Играй в игры за ${curName}, чтобы получить</small></div>`;
        return;
    }

    const usedIds = new Set(currentSelected().filter(x => x).map(x => x.id));

    g.innerHTML = inv.map(item => {
        const isUsed = usedIds.has(item.id);
        const val = itemValue(item);
        return `
            <div class="inv-select-item" style="${isUsed ? 'opacity:.35;pointer-events:none;' : ''}" onclick="selectItem('${item.id}')">
                <img src="${item.image}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                <div class="inv-item-name">${window.escapeHtml(item.name)}</div>
                <div class="inv-item-price"><img src="${window.getCurrencyIcon(state.currency)}" alt="">${val.toLocaleString('ru-RU')}</div>
            </div>
        `;
    }).join('');
}

function selectItem(itemId) {
    if (crafting || pendingCraft) return;
    const slotIdx = state.selectingSlot;
    if (slotIdx === null) return;

    const item = state.inventory.find(i => i.id === itemId);
    if (!item) return;
    if ((item.currency || 'star') !== state.currency) return; // защита от смешивания валют

    const sel = currentSelected();
    sel[slotIdx] = item;

    closeSelector();
    renderSlots();
}

function removeSlot(slotIdx) {
    if (crafting || pendingCraft) return;
    const sel = currentSelected();
    const item = sel[slotIdx];
    if (!item) return;
    sel[slotIdx] = null;
    renderSlots();
    vibrate();
}

async function onCraft() {
    if (crafting) return;
    if (pendingCraft) {
        await submitCraft(pendingCraft);
        return;
    }
    const cur = state.currency;
    const sel = currentSelected();
    const items = sel.filter(i => i !== null);
    if (items.length < 3) { showToast('Выберите минимум 3 предмета', 'err'); return; }

    pendingCraft = {
        itemIds: items.map(item => item.id),
        currency: cur,
        requestId: window.LootStarAPI.createRequestId()
    };
    try {
        localStorage.setItem(PENDING_CRAFT_KEY, JSON.stringify(pendingCraft));
    } catch (error) {
        console.error('[craft] could not persist pending operation:', error);
        pendingCraft = null;
        showToast('Не удалось сохранить запрос. Повторите попытку.', 'err');
        return;
    }
    await submitCraft(pendingCraft);
}

async function submitCraft(operation) {
    if (crafting) return;
    crafting = true;
    updateInfo();
    try {
        const result = await window.LootStarAPI.craftItems(
            operation.itemIds, operation.currency, operation.requestId
        );
        pendingCraft = null;
        localStorage.removeItem(PENDING_CRAFT_KEY);
        state.inventory = Array.isArray(result.inventory) ? result.inventory : [];
        state.selected[operation.currency] = new Array(MAX_SLOTS).fill(null);
        window.LootStarAPI.applyInventoryResult(result);
        window.refreshCurrencyUI();
        showResult(
            result.multiplier, result.payout, result.total,
            result.gift, result.remainder, result.currency
        );
        renderSlots();
        vibrate(result.multiplier >= 1 ? 'success' : 'light');
    } catch (error) {
        console.error('[craft] server operation failed:', error);
        if (error.status >= 400 && error.status < 500) {
            pendingCraft = null;
            localStorage.removeItem(PENDING_CRAFT_KEY);
            state.selected[operation.currency] = new Array(MAX_SLOTS).fill(null);
            try {
                const user = await window.LootStarAPI.loadProfile();
                state.inventory = Array.isArray(user.inventory) ? user.inventory : [];
            } catch (profileError) {
                console.error('[craft] profile refresh after operation failure failed:', profileError);
            }
        }
        showToast('Крафт не подтверждён сервером. Повторите запрос.', 'err');
    } finally {
        crafting = false;
        updateInfo();
        renderSlots();
    }
}

function showResult(mult, winAmount, total, gift, remainder, currency) {
    const icon = window.getCurrencyIcon(currency);
    const shortName = window.getCurrencyShortName(currency);

    $('resultMult').textContent = 'x' + mult.toFixed(2);
    $('resultDetail').textContent = `Крафт на ${total.toLocaleString('ru-RU')} ${shortName}`;

    const box = $('resultBox');
    box.style.borderColor = '';

    if (mult >= 1 && gift) {
        $('resultImg').src = gift.image;
        $('resultImg').onerror = function() { this.onerror = null; this.src = window.GIFT_FALLBACK; };
        $('resultImg').style.display = 'block';
        $('resultName').textContent = gift.name;
        let balText = `+${gift.price.toLocaleString('ru-RU')} ${shortName} (предмет)`;
        if (remainder > 0) balText += ` + ${remainder.toLocaleString('ru-RU')}`;
        $('resultBalance').innerHTML = `<img src="${icon}" alt=""> ${balText}`;
        $('resultBalance').style.color = 'var(--star)';
        $('resultMult').style.color = 'var(--accent)';
        box.style.borderColor = 'var(--accent)';
    } else if (mult >= 1) {
        $('resultImg').src = icon;
        $('resultImg').style.display = 'block';
        $('resultName').textContent = 'Награда за крафт';
        $('resultBalance').innerHTML = `<img src="${icon}" alt=""> +${winAmount.toLocaleString('ru-RU')}`;
        $('resultBalance').style.color = 'var(--star)';
        $('resultMult').style.color = 'var(--accent)';
        box.style.borderColor = 'var(--accent)';
    } else if (mult >= 0.5) {
        $('resultImg').src = icon;
        $('resultImg').style.display = 'block';
        $('resultName').textContent = 'Частичный возврат';
        $('resultBalance').innerHTML = `<img src="${icon}" alt=""> +${winAmount.toLocaleString('ru-RU')} (было ${total.toLocaleString('ru-RU')})`;
        $('resultBalance').style.color = 'var(--gold)';
        $('resultMult').style.color = 'var(--gold)';
        box.style.borderColor = 'var(--gold)';
    } else {
        $('resultImg').src = window.GIFT_FALLBACK;
        $('resultImg').style.display = 'block';
        $('resultName').textContent = 'Не повезло';
        $('resultBalance').innerHTML = `−${total.toLocaleString('ru-RU')} ${shortName}`;
        $('resultBalance').style.color = 'var(--red)';
        $('resultMult').style.color = 'var(--red)';
        box.style.borderColor = 'var(--red)';
    }

    $('resultOverlay').classList.add('show');
    renderSlots();
}

function closeResult() {
    $('resultOverlay').classList.remove('show');
    $('resultBalance').style.color = '';
    $('resultMult').style.color = 'var(--star)';
    $('resultBox').style.borderColor = '';
}

function showToast(msg, type = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

window.openSelector = openSelector;
window.closeSelector = closeSelector;
window.selectItem = selectItem;
window.removeSlot = removeSlot;
window.onCraft = onCraft;
window.closeResult = closeResult;
