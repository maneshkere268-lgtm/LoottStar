// profile.js — Профиль + вывод в Telegram Stars + рефералка + Ropeko
const STORAGE = {
    userId: 'userId',
    userName: 'userName',
    balance: 'userStars',
    inventory: 'userInventory'
};

const NFT_BATTLE_MAX_TG = 100_000;   // защитный максимум TG Stars за раз
const REF_BASE_URL = 'https://t.me/NFT_Battle_Webot/startapp';
const PENDING_PROFILE_SALE_KEY = 'profilePendingSale';

let userId = null;
let userName = null;
let userStars = 0;
let inventory = [];
let currentItem = null;
let currentSort = 'time';
let currentSearch = '';
let topUpTargetId = null;
let _sellInProgress = false;
const savingItemIds = new Set();
let itemModalLottieAnimation = null;
let promoRewardLottieAnimation = null;
const knownInventoryItemIds = new Set();
const pendingLottieRewards = [];
const queuedLottieRewardIds = new Set();
let lastPoolLocked = null;

document.addEventListener('DOMContentLoaded', init);

function getBalancePoolStatus() {
    try {
        const status = JSON.parse(localStorage.getItem('balancePoolStatus') || 'null');
        return status && typeof status === 'object' ? status : null;
    } catch (error) {
        console.warn('[profile] Invalid cached balance-pool status:', error);
        return null;
    }
}

function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();

    userId = window.TG.id;
    userName = window.TG.getShortName();
    localStorage.setItem(STORAGE.userId, String(userId));
    localStorage.setItem(STORAGE.userName, userName);

    userStars = parseInt(localStorage.getItem(STORAGE.balance)) || 0;

    loadInventory();
    inventory.forEach(item => knownInventoryItemIds.add(String(item.id)));
    updateProfileUI();
    renderInventory();
    renderTotalAssets();
    renderBalancePool();
    document.getElementById('balancePoolHelp')?.addEventListener('click', event => {
        const button = event.currentTarget;
        const explanation = document.getElementById('balancePoolExplanation');
        if (!explanation) return;
        explanation.hidden = !explanation.hidden;
        button.setAttribute('aria-expanded', String(!explanation.hidden));
    });
    syncRefLink();
    checkBanBanner();
    refreshWithdrawLabels();

    const searchInput = document.getElementById('invSearch');
    if (searchInput) {
        searchInput.addEventListener('input', e => {
            currentSearch = e.target.value.toLowerCase().trim();
            renderInventory();
        });
    }

    const wdAmount = document.getElementById('withdrawAmount');
    if (wdAmount) wdAmount.addEventListener('input', updateWithdrawTPreview);

    window.addEventListener('profileDataLoaded', () => {
        userStars = parseInt(localStorage.getItem(STORAGE.balance)) || 0;
        window.refreshCurrencyUI();
        loadInventory();
        const newAnimatedItems = inventory.filter(item => {
            const id = String(item.id);
            const isNew = !knownInventoryItemIds.has(id);
            knownInventoryItemIds.add(id);
            return isNew && item.lottie;
        });
        newAnimatedItems.forEach(queueLottieReward);
        updateProfileUI();
        renderInventory();
        renderTotalAssets();
        renderBalancePool();
        syncRefLink();
        checkBanBanner();
        refreshWithdrawLabels();
    });

    window.addEventListener('ratesUpdated', () => {
        try {
            refreshWithdrawLabels();
            updateWithdrawTPreview();
            updateProfileUI();
        } catch (e) { }
    });

    window.addEventListener('playerBanned', () => {
        checkBanBanner();
        updateProfileUI();
    });
    window.addEventListener('playerUnbanned', () => {
        userStars = parseInt(localStorage.getItem(STORAGE.balance)) || 0;
        checkBanBanner();
        updateProfileUI();
        renderTotalAssets();
    });

    document.addEventListener('click', e => {
        const el = e.target.closest('button, .inv-card');
        if (el) window.vibrate?.();
    });

    setInterval(checkBanBanner, 60_000);
    setTimeout(refreshWithdrawLabels, 300);
    window.LootStarAPI.loadProfile().then(async () => {
        const pending = readPendingProfileSale();
        if (!pending) return;
        try {
            const result = await processProfileSaleQueue(pending);
            showToast(`Продажа завершена: ${result.soldCount} предметов`, 'ok');
        } catch (error) {
            console.error('[profile] pending sale recovery failed:', error);
            showToast('Не удалось подтвердить продажу. Повторите её позже.', 'err');
        }
    }).catch(error => {
        console.error('[profile] API profile load failed:', error);
    });

    setInterval(() => {
        document.querySelectorAll('.inv-card-timer').forEach(el => {
            const endTime = parseInt(el.dataset.endtime);
            if (!endTime) return;
            const left = Math.max(0, endTime - Date.now());
            if (left <= 0) { el.textContent = '0ч 0м 0с'; return; }
            const h = Math.floor(left / 3600000);
            const m = Math.floor((left % 3600000) / 60000);
            const s = Math.floor((left % 60000) / 1000);
            el.textContent = `${h}ч ${m}м ${s}с`;
        });

        document.querySelectorAll('.inv-card-lifetime').forEach(el => {
            const endTime = parseInt(el.dataset.endtime);
            if (!endTime) return;
            const left = Math.max(0, endTime - Date.now());
            if (left <= 0) { el.textContent = 'истёк'; return; }
            const d = Math.floor(left / 86400000);
            const h = Math.floor((left % 86400000) / 3600000);
            el.textContent = `${d}д ${h}ч`;
        });

        const freshStars = parseInt(localStorage.getItem(STORAGE.balance)) || 0;
        if (freshStars !== userStars) {
            userStars = freshStars;
            updateProfileUI();
            renderTotalAssets();
        }
        renderBalancePool();
    }, 1000);
}

/* ═══════════ КУРС ВЫВОДА ═══════════ */
function refreshWithdrawLabels() {
    const rates = window.Rates?.getRates?.();
    if (!rates) return;

    const rateEl = document.getElementById('wdRateLabel');
    if (rateEl) {
        const perStar = rates.lootStarPerTelegramStar;
        rateEl.textContent = `${window.formatStars(perStar)} ⭐ = 1 ⭐ Telegram`;
    }
    const minEl = document.getElementById('wdMinLabel');
    if (minEl) {
        const minLoot = window.Rates.minWithdrawLootStar();
        minEl.textContent = `${window.formatStars(minLoot)} ⭐ (${rates.minWithdrawTelegramStars} ⭐ TG)`;
    }
    const input = document.getElementById('withdrawAmount');
    if (input) {
        input.min = String(window.Rates.minWithdrawLootStar());
        input.placeholder = String(window.Rates.minWithdrawLootStar());
    }
}

/* ═══════════ РЕФЕРАЛКА ═══════════ */
function getRefLink() {
    const tgId = window.TG?.user?.id || userId || '';
    return tgId ? `${REF_BASE_URL}?startapp=${tgId}` : REF_BASE_URL;
}

function syncRefLink() {
    const input = document.getElementById('refLinkInput');
    if (input) input.value = getRefLink();
}

function copyRefLink() {
    const link = getRefLink();
    const input = document.getElementById('refLinkInput');
    if (input) input.value = link;

    const done = () => {
        showToast('Ссылка скопирована', 'ok');
        window.vibrate?.('success');
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
    } else {
        fallbackCopy(link, done);
    }
}

function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb(); }
    catch (e) { showToast('Не удалось скопировать', 'err'); }
    document.body.removeChild(ta);
}

function shareRefLink() {
    const link = getRefLink();
    const text = `Заходи в LootStar! Забирай звёзды и открывай кейсы: ${link}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Заходи в LootStar!')}`;
        window.Telegram.WebApp.openTelegramLink(shareUrl);
        window.vibrate?.('success');
        return;
    }
    if (navigator.share) {
        navigator.share({ title: 'LootStar', text, url: link }).catch(() => { });
        return;
    }
    copyRefLink();
}

function toggleRefTerms() {
    const terms = document.getElementById('refTerms');
    const toggle = document.getElementById('refTermsToggle');
    if (!terms || !toggle) return;
    const open = terms.classList.toggle('open');
    toggle.classList.toggle('open', open);
    window.vibrate?.();
}

/* ═══════════ БАН-БАННЕР ═══════════ */
function checkBanBanner() {
    let banner = document.getElementById('banBanner');
    const isBanned = window.Manipulation && window.Manipulation.isBanned();

    if (isBanned) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'banBanner';
            banner.style.cssText = 'background:#3a0a0a;border:1px solid #ef4444;color:#ff8080;padding:12px 16px;border-radius:14px;margin:0 0 14px;font-size:13px;font-weight:700;text-align:center;line-height:1.4;';
            const main = document.querySelector('.main');
            if (main) main.insertBefore(banner, main.firstChild);
        }

        const until = parseInt(localStorage.getItem('userBanUntil') || '0');
        const reason = localStorage.getItem('userBanReason') || 'Нарушение правил';

        if (until > 0) {
            const left = Math.max(0, until - Date.now());
            if (left <= 0) {
                window.Manipulation?.checkAndAutoUnban?.();
                banner.remove();
                return;
            }
            const h = Math.floor(left / 3600000);
            const m = Math.floor((left % 3600000) / 60000);
            const s = Math.floor((left % 60000) / 1000);
            banner.textContent = `🚫 ${reason} (осталось ${h}ч ${m}м ${s}с)`;
        } else {
            banner.textContent = `🚫 ${reason} (бессрочно)`;
        }
    } else if (banner) {
        banner.remove();
    }
}

function renderTotalAssets() {
    const invValue = inventory.reduce((s, it) => s + getItemValue(it), 0);
    const total = userStars + invValue;

    let el = document.getElementById('heroTotalNote');
    if (!el) {
        const heroBal = document.querySelector('.hero-balance');
        if (heroBal) {
            el = document.createElement('div');
            el.id = 'heroTotalNote';
            el.style.cssText = 'font-size:11px;color:var(--text-2);margin-top:6px;text-align:center;opacity:.85;';
            heroBal.appendChild(el);
        }
    }
    if (el) el.textContent = `Всего с инвентарём: ${window.formatStars(total)} ⭐`;
}

function renderBalancePool() {
    const status = getBalancePoolStatus();
    const amount = document.getElementById('balancePoolAmount');
    const label = document.getElementById('balancePoolStatus');
    const container = document.getElementById('balancePool');
    if (!amount || !label || !container) return;

    const limit = Number(status?.limit) || 750_000_000;
    const rawRemaining = Number(status?.remaining);
    const remaining = Math.max(0, Math.min(limit, Number.isFinite(rawRemaining) ? rawRemaining : limit));
    amount.textContent = window.formatStars(remaining);

    if (status?.seasonLocked) {
        label.textContent = 'Сезон завершён: траты и операции с инвентарём временно запрещены';
    } else if (remaining === 0) {
        const resetAt = Number(status?.resetAt) || Date.now();
        const seconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const leftSeconds = seconds % 60;
        label.textContent = `Суточный лимит исчерпан. Обновление через ${hours}ч ${minutes}м ${leftSeconds}с`;
    } else {
        label.textContent = 'Доступно к получению за день';
    }

    const locked = remaining === 0 || status?.seasonLocked === true;
    label.classList.toggle('is-locked', locked);
    container.classList.toggle('is-locked', locked);
    document.body.classList.toggle('balance-pool-locked', locked);
    if (lastPoolLocked !== locked) {
        lastPoolLocked = locked;
        updateProfileUI();
    }
}

/* ═══════════ ИНВЕНТАРЬ ═══════════ */
function loadInventory() {
    try {
        const raw = localStorage.getItem(STORAGE.inventory);
        inventory = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(inventory)) inventory = [];
    } catch (e) { inventory = []; }
}

function saveInventory() {
    localStorage.setItem(STORAGE.inventory, JSON.stringify(inventory));
}

function saveBalance() {
    localStorage.setItem(STORAGE.balance, userStars.toString());
}

function readPendingProfileSale() {
    try {
        const pending = JSON.parse(localStorage.getItem(PENDING_PROFILE_SALE_KEY) || 'null');
        if (!pending) return null;
        if (!Array.isArray(pending.batches) ||
            !Number.isInteger(pending.index) ||
            pending.index < 0 ||
            pending.index > pending.batches.length ||
            pending.batches.some(batch =>
                !Array.isArray(batch.itemIds) ||
                batch.itemIds.length < 1 ||
                batch.itemIds.length > 50 ||
                typeof batch.requestId !== 'string'
            )) {
            throw new Error('INVALID_PENDING_PROFILE_SALE');
        }
        return pending;
    } catch (error) {
        console.error('[profile] pending sale state is invalid:', error);
        localStorage.removeItem(PENDING_PROFILE_SALE_KEY);
        return null;
    }
}

function createProfileSaleQueue(itemIds) {
    const batches = [];
    for (let index = 0; index < itemIds.length; index += 50) {
        batches.push({
            itemIds: itemIds.slice(index, index + 50),
            requestId: window.LootStarAPI.createRequestId()
        });
    }
    return { batches, index: 0, soldCount: 0, starsEarned: 0, silverEarned: 0 };
}

async function processProfileSaleQueue(queue) {
    while (queue.index < queue.batches.length) {
        const batch = queue.batches[queue.index];
        try {
            const result = await window.LootStarAPI.sellItems(batch.itemIds, batch.requestId);
            window.LootStarAPI.applyInventoryResult(result);
            queue.soldCount += result.soldItemIds.length;
            queue.starsEarned += Number(result.starsEarned) || 0;
            queue.silverEarned += Number(result.silverEarned) || 0;
            queue.index += 1;
            localStorage.setItem(PENDING_PROFILE_SALE_KEY, JSON.stringify(queue));
        } catch (error) {
            if (error.status >= 400 && error.status < 500) {
                localStorage.removeItem(PENDING_PROFILE_SALE_KEY);
                try {
                    const user = await window.LootStarAPI.loadProfile();
                    inventory = Array.isArray(user.inventory) ? user.inventory : [];
                    userStars = Number(user.stars) || 0;
                    renderInventory();
                    renderTotalAssets();
                } catch (profileError) {
                    console.error('[profile] profile refresh after sale rejection failed:', profileError);
                }
            }
            throw error;
        }
    }
    localStorage.removeItem(PENDING_PROFILE_SALE_KEY);
    loadInventory();
    userStars = Number(localStorage.getItem(STORAGE.balance)) || 0;
    updateProfileUI();
    renderInventory();
    renderTotalAssets();
    window.refreshCurrencyUI?.();
    return queue;
}

async function sellProfileItems(itemIds) {
    let queue = readPendingProfileSale();
    if (queue) {
        const queuedIds = queue.batches.slice(queue.index).flatMap(batch => batch.itemIds);
        if (itemIds && (queuedIds.length !== itemIds.length ||
            queuedIds.some((id, index) => id !== itemIds[index]))) {
            throw new Error('PENDING_PROFILE_SALE');
        }
    } else {
        queue = createProfileSaleQueue(itemIds);
        localStorage.setItem(PENDING_PROFILE_SALE_KEY, JSON.stringify(queue));
    }
    return processProfileSaleQueue(queue);
}

function getItemValue(item) {
    return item.stars || item.value || Math.round((item.price || 0) * 125);
}

function getItemImage(item) {
    if (!item) return window.GIFT_FALLBACK || '/shared/star.png';
    if (isPhoneItem(item)) return phoneItemImage(item);
    let src = item.image;
    if (!src) return window.GIFT_FALLBACK || '/shared/star.png';
    if (src.startsWith('images/')) src = '/' + src;
    return src;
}

/* ═══ Номера как предметы инвентаря (появляются после трейда или «Установить») ═══ */
function isPhoneItem(item) {
    return !!item && item.type === 'phone' && !!item.phone;
}

// картинка-карточка номера (SVG data URI); данные чистим до цифр — они могли прийти из трейда
function phoneItemImage(item) {
    const p = item.phone || {};
    const cc = String(p.cc || '').replace(/\D/g, '').slice(0, 3);
    const t = String(p.tail || '').replace(/\D/g, '').slice(0, 10);
    const color = /^#[0-9a-f]{6}$/i.test(String(p.tierColor)) ? p.tierColor : '#7B8194';
    const l2 = t.slice(0, 3) + ' ' + t.slice(3, 6);
    const l3 = t.slice(6, 8) + ' ' + t.slice(8, 10);
    const txt = (y, size, fill, s) =>
        `<text x="100" y="${y}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${size}" fill="${fill}">${s}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
        `<defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${color}" stop-opacity=".4"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity=".05"/></radialGradient></defs>` +
        `<rect x="12" y="12" width="176" height="176" rx="32" fill="#11141C"/>` +
        `<rect x="12" y="12" width="176" height="176" rx="32" fill="url(#g)" stroke="${color}" stroke-opacity=".75" stroke-width="3"/>` +
        txt(66, 26, color, '+' + cc) + txt(112, 36, '#F6F3EC', l2) + txt(154, 36, '#F6F3EC', l3) +
        `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function installPhoneFromItem(itemId) {
    if (typeof window.installPhoneItem === 'function') window.installPhoneItem(itemId);
}

function isDurovFigure(item) {
    return item && item.name && item.name.toLowerCase().includes('durov figure');
}

function isRopekoItem(item) {
    if (!item) return false;
    const name = window.LOOTSTAR_CONFIG?.ROPEKO_ITEM_NAME || 'Durov Figure (Ropeko)';
    return item.name === name || item.ropeko === true;
}

/**
 * Что нельзя продавать:
 *  - Ropeko — всегда limited
 *  - обычные limited (не owned)
 *  - noSell / untradeable
 * OWNED продаётся как обычный предмет (в том числе через «Sell All»).
 */
function isNoSellItem(item) {
    if (!item) return false;
    if (item.owned === true) return false; // owned продаётся точечно
    if (item.noSell === true || item.untradeable === true || item.limited === true) return true;
    if (isRopekoItem(item)) return true;
    return false;
}

/** Для «Sell All» действуют те же правила, что и для обычной продажи (OWNED продаётся как все) */
function isNoSellAllItem(item) {
    if (!item) return false;
    if (isPhoneItem(item)) return true; // номера не уходят в «Продать всё» случайно
    return isNoSellItem(item);
}

/** Предмет реально в стейкинге (активен или на паузе) — такие продавать нельзя. Остановленные/завершённые — можно. */
function isStakedItem(item) {
    const st = item && item.staking && item.staking.status;
    return st === 'active' || st === 'paused';
}

/** Что попадает в «Sell All» */
function getSellAllList() {
    return inventory.filter(it => it.saved !== true && !isStakedItem(it) && !isNoSellAllItem(it));
}

/** Причины, по которым предметы не попали в «Sell All» */
function getSellAllBreakdown() {
    const r = { total: inventory.length, sellable: 0, saved: 0, staked: 0, limited: 0, phones: 0 };
    inventory.forEach(it => {
        if (it.saved === true) r.saved++;
        else if (isStakedItem(it)) r.staked++;
        else if (isPhoneItem(it)) r.phones++;
        else if (isNoSellItem(it)) r.limited++;
        else r.sellable++;
    });
    return r;
}

function explainNothingToSell() {
    const b = getSellAllBreakdown();
    if (!b.total) return 'Инвентарь пуст';
    const parts = [];
    if (b.saved) parts.push(`сохранены звёздочкой: ${b.saved}`);
    if (b.staked) parts.push(`в стейкинге: ${b.staked}`);
    if (b.phones) parts.push(`номера (продаются по одному): ${b.phones}`);
    if (b.limited) parts.push(`LIMITED/не для продажи: ${b.limited}`);
    return 'Нечего продавать — ' + (parts.join(', ') || 'нет подходящих предметов');
}

/* ═══════════ UI ПРОФИЛЯ ═══════════ */
function updateProfileUI() {
    const initial = userName.charAt(0).toUpperCase() || 'U';
    const avatarEl = document.getElementById('profileAvatar');
    if (avatarEl) {
        const photo = window.TG.getPhoto();
        if (photo) {
            avatarEl.innerHTML = `<img src="${photo}" alt="" onerror="this.onerror=null;this.parentNode.textContent='${initial}'">`;
        } else {
            avatarEl.textContent = initial;
        }
    }

    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = userName;
    const idEl = document.getElementById('profileId');
    if (idEl) idEl.textContent = 'ID: ' + userId;

    const balEl = document.getElementById('balanceDisplay');
    if (balEl) balEl.textContent = window.formatStars(userStars);

    const silverEl = document.getElementById('silverDisplay');
    const silver = parseInt(localStorage.getItem('userSilver')) || 0;
    if (silverEl) silverEl.textContent = window.formatStars(silver);

    const heroBalEl = document.getElementById('heroBalance');
    if (heroBalEl) heroBalEl.textContent = window.formatStars(userStars);

    const wdBtn = document.getElementById('withdrawBtn');
    if (wdBtn) {
        const isBanned = window.Manipulation && window.Manipulation.isBanned();
        const pool = getBalancePoolStatus();
        const minLootStar = window.Rates?.minWithdrawLootStar?.() || 10_000_000;
        const minTg = window.Rates?.getRates?.().minWithdrawTelegramStars || 25;
        if (isBanned) {
            wdBtn.disabled = true;
            wdBtn.title = 'Аккаунт заблокирован';
        } else if (pool?.seasonLocked || pool?.remaining === 0) {
            wdBtn.disabled = true;
            wdBtn.title = pool.seasonLocked
                ? 'Сезон завершён: траты временно запрещены'
                : 'Суточный Balance Pool исчерпан';
        } else if (userStars < minLootStar) {
            wdBtn.disabled = true;
            wdBtn.title = `Минимум ${window.formatStars(minLootStar)} ⭐ (${minTg} ⭐ TG)`;
        } else {
            wdBtn.disabled = false;
            wdBtn.title = '';
        }
    }
}

/* ═══════════ СОРТИРОВКА ═══════════ */
function setSort(sort) {
    currentSort = sort;
    document.querySelectorAll('.inv-tab').forEach(t => t.classList.toggle('active', t.dataset.sort === sort));
    renderInventory();
    window.vibrate?.();
}

function sortInventory(arr) {
    const a = [...arr];
    switch (currentSort) {
        case 'default':
            return a.sort((x, y) => getItemValue(y) - getItemValue(x));
        case 'unique': {
            const map = new Map();
            a.forEach(it => {
                const key = it.name;
                if (!map.has(key) || getItemValue(it) > getItemValue(map.get(key))) map.set(key, it);
            });
            return [...map.values()].sort((x, y) => getItemValue(y) - getItemValue(x));
        }
        case 'time':
        default:
            return a.sort((x, y) => {
                const xS = x.staking && x.staking.status !== 'expired' ? 1 : 0;
                const yS = y.staking && y.staking.status !== 'expired' ? 1 : 0;
                return yS - xS || (y.timestamp || 0) - (x.timestamp || 0);
            });
    }
}

/* ═══════════ РЕНДЕР ИНВЕНТАРЯ ═══════════ */
function renderInventory() {
    const container = document.getElementById('inventoryContainer');
    if (!container) return;

    if (!inventory.length) {
        container.innerHTML = `
            <div class="inv-empty">
                <div class="inv-empty-icon">🎁</div>
                <div class="inv-empty-text">Инвентарь пуст</div>
                <div style="font-size:12px;margin-top:8px;color:var(--text-2)">Открой кейс, чтобы получить предметы</div>
            </div>`;
        updateSellAllTotal();
        return;
    }

    let list = sortInventory(inventory);
    if (currentSearch) {
        list = list.filter(it => (it.name || '').toLowerCase().includes(currentSearch));
    }

    if (!list.length) {
        container.innerHTML = `<div class="inv-empty"><div class="inv-empty-icon">🔍</div><div class="inv-empty-text">Ничего не найдено</div></div>`;
        updateSellAllTotal();
        return;
    }

    container.innerHTML = `<div class="inv-grid">${list.map((it, i) => renderCard(it, i)).join('')}</div>`;
    updateSellAllTotal();
}

function renderCard(item, idx = 0) {
    const value = getItemValue(item);
    const isStaking = item.staking?.status === 'active';
    const isPaused = item.staking?.status === 'paused';
    const isStaked = isStaking || isPaused;
    const canStake = !isPhoneItem(item) && window.Staking?.isStakeable?.(item);
    const isDurov = isDurovFigure(item);
    const isRopeko = isRopekoItem(item);
    const hasLifetime = !!item.expiresAt;
    const isOwned = item.owned === true;
    const isSaved = item.saved === true;
    const isSaving = savingItemIds.has(item.id);

    let timerHtml = '';
    if (isStaked && !isRopeko) {
        const left = Math.max(0, item.staking.endTime - Date.now());
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        const s = Math.floor((left % 60000) / 1000);
        const color = isStaking ? 'var(--jade)' : 'var(--text-2)';
        const border = isStaking ? 'var(--jade)' : 'var(--text-3)';
        timerHtml = `<div class="inv-card-timer" data-endtime="${item.staking.endTime}"
            style="color:${color};border:1px solid ${border};">${h}ч ${m}м ${s}с</div>`;
    }

    let lifetimeHtml = '';
    if (hasLifetime && !isStaked) {
        const left = Math.max(0, item.expiresAt - Date.now());
        const d = Math.floor(left / 86400000);
        const h = Math.floor((left % 86400000) / 3600000);
        lifetimeHtml = `<div class="inv-card-lifetime" data-endtime="${item.expiresAt}">${d}д ${h}ч</div>`;
    }

    const limitedHtml = isDurov && !isOwned ? `<div class="inv-card-limited">LIMITED</div>` : '';

    let actionBtn = '';
    if (isRopeko) {
        actionBtn = `<button class="inv-card-sell"
            style="background:rgba(255,216,77,.12);color:#FFD84D;border-color:rgba(255,216,77,.35);cursor:default;"
            disabled>LIMITED · ${window.formatStars(item.price)} ⭐</button>`;
    } else if (isStaked) {
        actionBtn = `<button class="inv-card-sell"
            style="background:rgba(232,148,74,.15);color:var(--amber-2);border-color:rgba(232,148,74,.3);"
            onclick="event.stopPropagation();openIncomeModal('${item.id}')">Доход: ${window.formatStars(item.staking.earned || 0)}</button>`;
    } else if (canStake) {
        actionBtn = `<button class="inv-card-sell"
            style="background:rgba(79,190,141,.15);color:var(--jade);border-color:rgba(79,190,141,.3);"
            onclick="event.stopPropagation();activateStakeDirect('${item.id}')">Активировать</button>`;
    } else if (isPhoneItem(item)) {
        actionBtn = `
            <div style="display:flex;gap:6px;width:100%;margin-top:7px;">
                <button class="inv-card-sell"
                    style="flex:1;margin-top:0;background:rgba(228,83,107,.14);color:#FFB0BC;border-color:rgba(228,83,107,.26);"
                    onclick="event.stopPropagation();quickSell('${item.id}')">Sell</button>
                <button class="inv-card-sell"
                    style="flex:1;margin-top:0;background:linear-gradient(180deg,var(--accent-light) -40%,var(--accent-a) 45%,var(--accent-b) 130%);color:#fff;border-color:transparent;"
                    onclick="event.stopPropagation();installPhoneFromItem('${item.id}')">Установить</button>
            </div>`;
    } else {
        // OWNED и обычные предметы — Sell + Upgrade
        actionBtn = `
            <div style="display:flex;gap:6px;width:100%;margin-top:7px;">
                <button class="inv-card-sell"
                    style="flex:1;margin-top:0;background:rgba(228,83,107,.14);color:#FFB0BC;border-color:rgba(228,83,107,.26);"
                    onclick="event.stopPropagation();quickSell('${item.id}')">Sell</button>
                <button class="inv-card-sell"
                    style="flex:1;margin-top:0;background:linear-gradient(180deg,var(--accent-light) -40%,var(--accent-a) 45%,var(--accent-b) 130%);color:#fff;border-color:transparent;"
                    onclick="event.stopPropagation();upgradeFromInventory('${item.id}')">Upgrade</button>
            </div>`;
    }

    return `
        <div class="inv-card ${isDurov && !isOwned ? 'inv-card-limited-gold' : ''}" data-gift-id="${item.id}" style="--i:${idx}">
            <button class="inv-card-save${isSaved ? ' is-saved' : ''}" type="button"
                aria-label="${isSaved ? 'Убрать из сохранённых' : 'Сохранить предмет'}"
                aria-pressed="${isSaved}" title="${isSaved ? 'Сохранён — не попадёт в «Продать всё»' : 'Сохранить от продажи всех предметов'}"
                ${isSaving ? 'disabled' : ''}
                onclick="event.stopPropagation();toggleItemSaved('${item.id}')">★</button>
            ${timerHtml}
            ${lifetimeHtml}
            ${limitedHtml}
            <div class="inv-card-img" onclick="openItemModal('${item.id}')">
                <img src="${getItemImage(item)}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK || '/shared/star.png'}'">
            </div>
            <div class="inv-card-name" onclick="openItemModal('${item.id}')">${window.escapeHtml(item.name || '')}</div>
            <div class="inv-card-price" onclick="openItemModal('${item.id}')">
                <img src="${window.STAR_ICON || '/shared/star.png'}" alt="">
                ${window.formatStars(value)}
            </div>
            ${actionBtn}
        </div>`;
}

function updateSellAllTotal() {
    const list = getSellAllList();
    const total = list.reduce((s, it) => s + getItemValue(it), 0);
    const el = document.getElementById('sellAllTotal');
    if (el) el.textContent = window.formatStars(total);
    const btn = document.getElementById('sellAllBtn');
    if (btn) {
        btn.disabled = false; // всегда кликабельна: если продавать нечего, объясняем почему
        btn.classList.toggle('is-empty', list.length === 0);
        btn.dataset.count = String(list.length);
        btn.title = list.length ? `Продать ${list.length} шт.` : explainNothingToSell();
    }
}

async function toggleItemSaved(itemId) {
    if (savingItemIds.has(itemId)) return;
    const item = inventory.find(it => it.id === itemId);
    if (!item) return;

    const saved = item.saved !== true;
    savingItemIds.add(itemId);
    renderInventory();
    try {
        const result = await window.LootStarAPI.setItemSaved(itemId, saved);
        window.LootStarAPI.applyInventoryResult(result);
        loadInventory();
        window.vibrate?.('light');
    } catch (e) {
        console.error('toggleItemSaved failed:', e);
        showToast(e?.code === 'ITEMS_NOT_FOUND'
            ? 'Предмет больше не найден'
            : 'Не удалось сохранить предмет', 'err');
    } finally {
        savingItemIds.delete(itemId);
        renderInventory();
    }
}

/* ═══════════ АКТИВАЦИЯ НАПРЯМУЮ ═══════════ */
window.activateStakeDirect = async function (itemId) {
    if (!window.Staking) {
        showToast('Staking не загружен', 'err');
        return;
    }
    const item = inventory.find(i => i.id === itemId);
    if (item && isRopekoItem(item)) {
        showToast('Durov Figure (Ropeko) не требует активации', 'err');
        return;
    }
    const activated = await window.Staking.activate(itemId);
    if (!activated) return;
    loadInventory();
    renderInventory();
    renderTotalAssets();
};

/* ═══════════ МОДАЛКА ПРЕДМЕТА ═══════════ */
function isValidLottieJsonSource(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > 500 || source.includes('\\')) {
        return false;
    }
    try {
        const url = new URL(source, location.origin);
        if (!/\.json$/i.test(url.pathname) || url.username || url.password) return false;
        if (url.origin === location.origin) return !url.pathname.split('/').includes('..');
        return url.protocol === 'https:';
    } catch {
        return false;
    }
}

function playLottieOnce(container, source, onFailure) {
    if (!window.lottie || !isValidLottieJsonSource(source)) {
        console.error('[profile] Lottie player unavailable or JSON URL is invalid');
        onFailure();
        return null;
    }
    try {
        container.replaceChildren();
        const animation = window.lottie.loadAnimation({
            container,
            renderer: 'svg',
            loop: false,
            autoplay: true,
            path: source
        });
        animation.addEventListener('data_failed', () => {
            console.error('[profile] Lottie JSON failed to load:', source);
            animation.destroy();
            onFailure();
        });
        return animation;
    } catch (error) {
        console.error('[profile] Could not start Lottie animation:', error);
        onFailure();
        return null;
    }
}

function showPromoRewardAnimation(item) {
    if (!item?.lottie) return;
    const modal = document.getElementById('promoRewardModal');
    const container = document.getElementById('promoRewardLottie');
    const image = document.getElementById('promoRewardImg');
    const name = document.getElementById('promoRewardName');
    if (!modal || !container || !image || !name) return;

    promoRewardLottieAnimation?.destroy();
    promoRewardLottieAnimation = null;
    name.textContent = item.name || 'Предмет получен';
    image.src = getItemImage(item);
    image.onerror = function () {
        this.onerror = null;
        this.src = window.GIFT_FALLBACK || '/shared/star.png';
    };
    image.hidden = true;
    container.hidden = false;
    modal.classList.add('open');
    promoRewardLottieAnimation = playLottieOnce(container, item.lottie, () => {
        container.hidden = true;
        image.hidden = false;
    });
}

function queueLottieReward(item) {
    if (!item?.lottie || item.id == null) return;
    const id = String(item.id);
    if (queuedLottieRewardIds.has(id)) return;

    const storageKey = `seenLottieRewards_${userId || 'guest'}`;
    let seenIds = [];
    try {
        seenIds = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (!Array.isArray(seenIds)) seenIds = [];
    } catch (error) {
        console.warn('[profile] Could not read played Lottie reward IDs:', error);
    }
    if (seenIds.includes(id)) {
        queuedLottieRewardIds.add(id);
        return;
    }

    queuedLottieRewardIds.add(id);
    pendingLottieRewards.push(item);
    try {
        localStorage.setItem(storageKey, JSON.stringify([...seenIds, id].slice(-500)));
    } catch (error) {
        console.warn('[profile] Could not persist played Lottie reward IDs:', error);
    }
    if (!document.getElementById('promoRewardModal')?.classList.contains('open')) {
        showNextLottieReward();
    }
}

function showNextLottieReward() {
    if (document.getElementById('promoRewardModal')?.classList.contains('open')) return;
    const item = pendingLottieRewards.shift();
    if (item) showPromoRewardAnimation(item);
}

function closePromoRewardModal() {
    document.getElementById('promoRewardModal')?.classList.remove('open');
    promoRewardLottieAnimation?.destroy();
    promoRewardLottieAnimation = null;
    document.getElementById('promoRewardLottie')?.replaceChildren();
    showNextLottieReward();
}

function openItemModal(itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;
    currentItem = item;

    const img = document.getElementById('itemModalImg');
    const lottieContainer = document.getElementById('itemModalLottie');
    itemModalLottieAnimation?.destroy();
    itemModalLottieAnimation = null;
    lottieContainer?.replaceChildren();
    if (img) {
        img.src = getItemImage(item);
        img.onerror = function () { this.onerror = null; this.src = window.GIFT_FALLBACK || '/shared/star.png'; };
    }
    if (lottieContainer && img && item.lottie) {
        lottieContainer.hidden = false;
        img.hidden = true;
        itemModalLottieAnimation = playLottieOnce(lottieContainer, item.lottie, () => {
            lottieContainer.hidden = true;
            img.hidden = false;
        });
    } else {
        if (lottieContainer) lottieContainer.hidden = true;
        if (img) img.hidden = false;
    }

    const nameEl = document.getElementById('itemModalName');
    if (nameEl) nameEl.textContent = item.name || '';

    const priceEl = document.getElementById('itemModalPrice');
    if (priceEl) {
        const span = priceEl.querySelector('span');
        if (span) span.textContent = window.formatStars(getItemValue(item));
    }

    const isStaking = item.staking?.status === 'active';
    const isPaused = item.staking?.status === 'paused';
    const isStaked = isStaking || isPaused;
    const canStake = !isPhoneItem(item) && window.Staking?.isStakeable?.(item);
    const isRopeko = isRopekoItem(item);
    const isOwned = item.owned === true;

    const btns = document.querySelector('#itemModal .item-btns');
    if (btns) {
        if (isRopeko) {
            btns.innerHTML = `
                <button class="item-btn item-btn-upgrade"
                    style="background:linear-gradient(135deg,#FFD84D,#F5A623);color:#1a1204;"
                    onclick="closeItemModal()">LIMITED · ${window.formatStars(item.price)} ⭐</button>
            `;
        } else if (isStaked) {
            btns.innerHTML = `
                <button class="item-btn item-btn-sell" onclick="closeItemModal();openIncomeModal('${item.id}')">Доход</button>
                ${isStaking
                    ? `<button class="item-btn item-btn-upgrade"
                        style="background:transparent;border:1px solid var(--ruby);color:var(--ruby);box-shadow:none;"
                        onclick="stopStake('${item.id}')">Остановить</button>`
                    : `<button class="item-btn item-btn-upgrade"
                        style="background:var(--jade);"
                        onclick="continueStake('${item.id}')">Продолжить</button>`
                }
            `;
        } else if (canStake && !isOwned) {
            btns.innerHTML = `
                <button class="item-btn item-btn-sell" onclick="sellItem()">Продать</button>
                <button class="item-btn item-btn-upgrade" onclick="closeItemModal();activateStakeDirect('${item.id}')">Активировать</button>
            `;
        } else if (isPhoneItem(item)) {
            btns.innerHTML = `
                <button class="item-btn item-btn-sell" onclick="sellItem()">Sell</button>
                <button class="item-btn item-btn-upgrade" onclick="closeItemModal();installPhoneFromItem('${item.id}')">Установить</button>
            `;
        } else {
            // OWNED и обычные — Sell + Upgrade
            btns.innerHTML = `
                <button class="item-btn item-btn-sell" onclick="sellItem()">Sell</button>
                <button class="item-btn item-btn-upgrade" onclick="upgradeItem()">Upgrade</button>
            `;
        }
    }

    const modal = document.getElementById('itemModal');
    if (modal) modal.classList.add('open');
    window.vibrate?.();
}

function closeItemModal() {
    const modal = document.getElementById('itemModal');
    if (modal) modal.classList.remove('open');
    itemModalLottieAnimation?.destroy();
    itemModalLottieAnimation = null;
    document.getElementById('itemModalLottie')?.replaceChildren();
    document.getElementById('itemModalLottie')?.setAttribute('hidden', '');
    document.getElementById('itemModalImg')?.removeAttribute('hidden');
    currentItem = null;
}

/* ═══════════ СТЕЙКИНГ ═══════════ */
window.stopStake = async function (itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (item && isRopekoItem(item)) {
        showToast('Durov Figure (Ropeko) всегда приносит доход', 'err');
        return;
    }
    const stopped = await window.Staking.stop(itemId);
    if (!stopped) return;
    loadInventory();
    closeItemModal();
    closeIncomeModal();
    renderInventory();
};

window.continueStake = async function (itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (item && isRopekoItem(item)) {
        showToast('Durov Figure (Ropeko) не требует активации', 'err');
        return;
    }
    const activated = await window.Staking.activate(itemId);
    if (!activated) return;
    loadInventory();
    closeItemModal();
    renderInventory();
};

window.openIncomeModal = function (itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (!item || !item.staking) return;
    if (isRopekoItem(item)) return;

    const modal = document.getElementById('incomeModal');
    if (!modal) { showToast('Модалка дохода не найдена', 'err'); return; }

    const img = document.getElementById('incomeItemImg');
    if (img) img.src = getItemImage(item);
    const nameEl = document.getElementById('incomeItemName');
    if (nameEl) nameEl.textContent = item.name || '';

    const totalEl = document.getElementById('incomeTotal');
    if (totalEl) totalEl.textContent = window.formatStars(item.staking.earned || 0) + ' ⭐';
    const poolEl = document.getElementById('incomePoolLeft');
    if (poolEl) poolEl.textContent = window.formatStars(item.staking.pool) + ' ⭐';
    const rateEl = document.getElementById('incomeRate');
    if (rateEl) rateEl.textContent = '+' + ((item.staking.basePrice * 3 * 0.001).toFixed(2)) + ' ⭐/сек';
    const statusEl = document.getElementById('incomeStatus');
    if (statusEl) statusEl.textContent = item.staking.status === 'active' ? 'Активен' : 'На паузе';

    const stopBtn = document.getElementById('incomeStopBtn');
    if (stopBtn) stopBtn.onclick = () => stopStake(item.id);
    const topUpBtn = document.getElementById('incomeTopUpBtn');
    if (topUpBtn) topUpBtn.onclick = () => {
        closeIncomeModal();
        openTopUp(item.id);
    };

    modal.classList.add('open');
};

window.closeIncomeModal = function () {
    document.getElementById('incomeModal')?.classList.remove('open');
};

function openTopUp(itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (!item || !item.staking) return;
    if (isRopekoItem(item)) return;

    const modal = document.getElementById('topUpModal');
    if (!modal) return;

    topUpTargetId = itemId;
    const nameEl = document.getElementById('topUpItemName');
    if (nameEl) nameEl.textContent = item.name || '';
    const poolEl = document.getElementById('topUpCurrentPool');
    if (poolEl) poolEl.textContent = window.formatStars(item.staking.pool) + ' ⭐';
    const amountEl = document.getElementById('topUpAmount');
    if (amountEl) amountEl.value = '';
    const confirmBtn = document.getElementById('topUpConfirmBtn');
    if (confirmBtn) confirmBtn.onclick = () => submitTopUp(item.id);

    modal.classList.add('open');
}

window.closeTopUpModal = function () {
    document.getElementById('topUpModal')?.classList.remove('open');
    topUpTargetId = null;
};

async function submitTopUp(itemId) {
    const amountEl = document.getElementById('topUpAmount');
    const amt = parseInt(amountEl?.value);
    if (!amt || amt <= 0) { showToast('Введите корректную сумму', 'err'); return; }
    const toppedUp = await window.Staking.topUp(itemId, amt);
    if (!toppedUp) return;
    loadInventory();
    userStars = parseInt(localStorage.getItem(STORAGE.balance)) || 0;
    closeTopUpModal();
    renderInventory();
    renderTotalAssets();
    updateProfileUI();
}

/* ═══════════ ПРОДАЖА — через транзакцию ═══════════ */
function quickSell(itemId) {
    if (_sellInProgress) return;
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;
    if (item.staking && item.staking.status === 'active') {
        showToast('Нельзя продать активный подарок. Сначала остановите его.', 'err');
        return;
    }
    if (isNoSellItem(item)) {
        showToast('Этот предмет нельзя продать', 'err');
        return;
    }
    currentItem = item;
    sellItem();
}

async function sellItem() {
    if (!currentItem) return;
    if (_sellInProgress) return;

    const itemId = currentItem.id;

    loadInventory();
    const fresh = inventory.find(i => i.id === itemId);
    if (!fresh) {
        closeItemModal();
        showToast('Предмет уже продан', 'err');
        return;
    }
    if (fresh.staking && fresh.staking.status === 'active') {
        showToast('Нельзя продать активный подарок. Сначала остановите его.', 'err');
        return;
    }
    if (isNoSellItem(fresh)) {
        showToast('Этот предмет нельзя продать', 'err');
        return;
    }
    const saleValue = getItemValue(fresh);
    if (saleValue >= 1_000_000 &&
        !confirm(`Продать этот дорогой предмет за ${window.formatStars(saleValue)} ⭐?`)) {
        return;
    }

    _sellInProgress = true;
    const modalBtns = document.querySelectorAll('#itemModal .item-btn');
    modalBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    try {
        const result = await sellProfileItems([itemId]);

        if (document.getElementById('itemModal')?.classList.contains('open')) {
            closeItemModal();
        }

        const proceeds = [];
        if (result.starsEarned > 0) proceeds.push(`${window.formatStars(result.starsEarned)} ⭐`);
        if (result.silverEarned > 0) proceeds.push(`${window.formatStars(result.silverEarned)} 🪙`);
        showToast(`Продано за ${proceeds.join(' и ')}`, 'ok');
        window.vibrate?.('success');
    } catch (e) {
        const code = e?.code || e?.message;
        if (code === 'ITEMS_NOT_FOUND') {
            showToast('Предмет уже продан', 'err');
            loadInventory();
            renderInventory();
            renderTotalAssets();
        } else if (code === 'ITEMS_NOT_SELLABLE' && fresh.staking?.status === 'active') {
            showToast('Предмет в стейкинге — сначала остановите', 'err');
        } else if (code === 'ITEMS_NOT_SELLABLE') {
            showToast('Этот предмет нельзя продать', 'err');
        } else {
            console.error('sellItem failed:', e);
            showToast(e?.message === 'PENDING_PROFILE_SALE'
                ? 'Сначала повторите предыдущую незавершённую продажу.'
                : 'Продажа не подтверждена сервером. Повторите запрос.', 'err');
        }
    } finally {
        _sellInProgress = false;
        modalBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    }
}

/* ═══════════ ПРОДАТЬ ВСЁ ═══════════ */
function openSellAllModal() {
    if (_sellInProgress) return;
    loadInventory(); // берём актуальный инвентарь, а не копию из памяти
    const sellable = getSellAllList();
    if (!sellable.length) {
        console.warn('[SellAll] нечего продавать:', getSellAllBreakdown(), inventory.map(i => ({ id: i.id, name: i.name, owned: i.owned, limited: i.limited, noSell: i.noSell, untradeable: i.untradeable, staking: i.staking && i.staking.status })));
        showToast(explainNothingToSell(), 'err');
        updateSellAllTotal();
        return;
    }
    const total = sellable.reduce((s, it) => s + getItemValue(it), 0);
    const el = document.getElementById('sellAllValue');
    if (el) el.textContent = window.formatStars(total);
    const cnt = document.getElementById('sellAllCount');
    if (cnt) cnt.textContent = String(sellable.length);
    const skipped = inventory.length - sellable.length;
    const skipEl = document.getElementById('sellAllSkip');
    if (skipEl) {
        skipEl.hidden = skipped <= 0;
        const breakdown = getSellAllBreakdown();
        const reasons = [];
        if (breakdown.saved) reasons.push(`сохранены: ${breakdown.saved}`);
        if (breakdown.staked) reasons.push(`в стейкинге: ${breakdown.staked}`);
        if (breakdown.limited) reasons.push(`LIMITED: ${breakdown.limited}`);
        if (breakdown.phones) reasons.push(`номера: ${breakdown.phones}`);
        skipEl.textContent = skipped > 0 ? `Не будут проданы: ${skipped} (${reasons.join(', ')})` : '';
    }
    document.getElementById('sellAllModal')?.classList.add('open');
}

function closeSellAllModal() {
    document.getElementById('sellAllModal')?.classList.remove('open');
}

async function confirmSellAll() {
    if (_sellInProgress) return;

    loadInventory(); // актуальный список перед продажей
    const sellable = getSellAllList();
    if (!sellable.length) {
        closeSellAllModal();
        updateSellAllTotal();
        showToast(explainNothingToSell(), 'err');
        return;
    }

    const okBtn = document.getElementById('sellAllConfirmBtn');
    const okLabel = okBtn ? okBtn.textContent : '';
    _sellInProgress = true;
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'Продаём…'; }

    try {
        const result = await sellProfileItems(sellable.map(item => item.id));
        closeSellAllModal();

        if (result.soldCount > 0) {
            const proceeds = [];
            if (result.starsEarned > 0) proceeds.push(`${window.formatStars(result.starsEarned)} ⭐`);
            if (result.silverEarned > 0) proceeds.push(`${window.formatStars(result.silverEarned)} 🪙`);
            showToast(`Продано ${result.soldCount} предметов за ${proceeds.join(' и ')}`, 'ok');
            window.vibrate?.('success');
        } else {
            showToast('Предметы уже проданы или недоступны', 'err');
        }
    } catch (e) {
        console.error('confirmSellAll failed:', e);
        showToast(e?.code === 'ITEMS_NOT_SELLABLE'
            ? 'Некоторые предметы больше нельзя продать'
            : 'Продажа не подтверждена сервером. Нажмите «Продать всё» ещё раз.', 'err');
        loadInventory();
        renderInventory();
    } finally {
        _sellInProgress = false;
        if (okBtn) { okBtn.disabled = false; okBtn.textContent = okLabel || 'Продать'; }
    }
}

/* ═══════════ ПРОМОКОДЫ ═══════════ */
async function redeemPromo() {
    if (window.Manipulation && window.Manipulation.isBanned()) {
        showToast('Аккаунт заблокирован: ' + window.Manipulation.BAN_REASON, 'err');
        return;
    }

    const input = document.getElementById('promoInput');
    const code = (input?.value || '').trim().toUpperCase();
    if (!code) { showToast('Введи промокод', 'err'); return; }

    try {
        if (!window.LootStarAPI?.redeemPromo || !window.LootStarAPI?.applyInventoryResult) {
            throw new Error('API_NOT_AVAILABLE');
        }
        const pendingKey = 'profilePendingPromo';
        let pending;
        try {
            pending = JSON.parse(localStorage.getItem(pendingKey) || 'null');
        } catch (error) {
            console.warn('[profile] Could not read pending promo request:', error);
        }
        if (!pending || pending.code !== code || !pending.requestId) {
            pending = { code, requestId: window.LootStarAPI.createRequestId() };
            localStorage.setItem(pendingKey, JSON.stringify(pending));
        }
        const result = await window.LootStarAPI.redeemPromo(code, pending.requestId);
        localStorage.removeItem(pendingKey);
        window.LootStarAPI.applyInventoryResult(result);
        loadInventory();
        userStars = parseInt(localStorage.getItem(STORAGE.balance)) || 0;
        window.refreshCurrencyUI?.();
        updateProfileUI();
        renderInventory();
        renderTotalAssets();
        if (input) input.value = '';
        if (!result.duplicate && result.item?.lottie) queueLottieReward(result.item);
        showToast(result.duplicate
            ? 'Награда по промокоду уже была начислена'
            : `Промокод активирован: ${result.rewardSummary || 'Награда получена'}`, 'ok');
        window.vibrate?.('success');
    } catch (e) {
        const message = String(e?.code || e?.message || e);
        if (message.includes('PROMO_ALREADY_USED')) {
            localStorage.removeItem('profilePendingPromo');
            showToast('Этот промокод уже использован', 'err');
        } else if (message.includes('PROMO_INACTIVE')) {
            localStorage.removeItem('profilePendingPromo');
            showToast('Этот промокод больше не доступен', 'err');
        } else if (message.includes('PROMO_NOT_FOUND')) {
            showToast('Неверный промокод', 'err');
        } else if (message.includes('PROMO_INVALID_REWARD')) {
            showToast('У промокода некорректно настроена награда', 'err');
        } else if (message.includes('INVALID_PROMO_CODE')) {
            showToast('Некорректный формат промокода', 'err');
        } else if (message.includes('BALANCE_POOL')) {
            showToast('Награду нельзя получить из-за ограничений баланса', 'err');
        } else {
            console.error('redeemPromo failed:', e);
            showToast('Не удалось подтвердить промокод. Повтори попытку.', 'err');
        }
    }
}

/* ═══════════ АПГРЕЙД ═══════════ */
function upgradeItem() {
    if (!currentItem) return;
    if (isRopekoItem(currentItem)) {
        showToast('Durov Figure (Ropeko) нельзя улучшить', 'err');
        return;
    }
    localStorage.setItem('upgradeItemId', currentItem.id);
    window.location.href = '../upgrades/index.html';
}

function upgradeFromInventory(itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;
    if (isRopekoItem(item)) {
        showToast('Durov Figure (Ropeko) нельзя улучшить', 'err');
        return;
    }
    localStorage.setItem('upgradeItemId', itemId);
    window.location.href = '../upgrades/index.html';
}

/* ═══════════ ВЫВОД В TELEGRAM STARS ═══════════ */
function openWithdrawModal() {
    if (window.Manipulation && window.Manipulation.isBanned()) {
        showToast('Аккаунт заблокирован: ' + window.Manipulation.BAN_REASON, 'err');
        return;
    }
    const minLootStar = window.Rates?.minWithdrawLootStar?.() || 10_000_000;
    if (userStars < minLootStar) {
        const tg = window.Rates?.getRates?.().minWithdrawTelegramStars || 25;
        showToast(`Минимум для вывода — ${window.formatStars(minLootStar)} ⭐ (${tg} ⭐ TG)`, 'err');
        return;
    }

    updateWithdrawBalance();
    refreshWithdrawLabels();
    const amountEl = document.getElementById('withdrawAmount');
    if (amountEl) amountEl.value = '';
    updateWithdrawTPreview();
    document.getElementById('withdrawModal')?.classList.add('open');
    window.vibrate?.();
}

function updateWithdrawBalance() {
    const el = document.getElementById('wdBalanceValue');
    if (el) el.textContent = window.formatStars(userStars);
}

function updateWithdrawTPreview() {
    const el = document.getElementById('wdTPreview');
    if (!el) return;
    const amount = parseInt(document.getElementById('withdrawAmount')?.value) || 0;
    if (amount <= 0) { el.textContent = '≈ 0 ⭐ Telegram'; return; }
    const tg = window.Rates?.lootStarToTelegramStars?.(amount) || 0;
    el.textContent = `≈ ${tg.toLocaleString('ru-RU')} ⭐ Telegram`;
}

function setMaxWithdraw() {
    const maxLoot = window.Rates?.telegramStarsToLootStar?.(NFT_BATTLE_MAX_TG) || userStars;
    const max = Math.min(userStars, maxLoot);
    const el = document.getElementById('withdrawAmount');
    if (el) el.value = max;
    updateWithdrawTPreview();
}

async function submitWithdraw() {
    if (window.Manipulation && window.Manipulation.isBanned()) {
        showToast('Аккаунт заблокирован: ' + window.Manipulation.BAN_REASON, 'err');
        return;
    }

    const input = document.getElementById('withdrawAmount');
    const amount = parseInt(input?.value) || 0;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        showToast('Укажи корректную сумму вывода', 'err');
        return;
    }

    try {
        if (!window.LootStarAPI?.submitWithdrawal) throw new Error('API_NOT_AVAILABLE');
        const pendingKey = 'profilePendingWithdrawal';
        let pending;
        try {
            pending = JSON.parse(localStorage.getItem(pendingKey) || 'null');
        } catch (error) {
            console.warn('[profile] Could not read pending withdrawal:', error);
        }
        if (!pending || pending.amount !== amount || !pending.requestId) {
            pending = { amount, requestId: window.LootStarAPI.createRequestId() };
            localStorage.setItem(pendingKey, JSON.stringify(pending));
        }
        const request = await window.LootStarAPI.submitWithdrawal(amount, pending.requestId);
        localStorage.removeItem(pendingKey);
        window.LootStarAPI.applyBalanceResult(request);
        userStars = Number(request.stars) || 0;
        updateProfileUI();
        renderTotalAssets();
        closeWithdrawModal();
        showToast(`Заявка: ${window.formatStars(amount)} ⭐ → ${Number(request.amountTelegramStars).toLocaleString('ru-RU')} ⭐ Telegram`, 'ok');
        window.vibrate?.('success');
    } catch (e) {
        const message = String(e?.code || e?.message || e);
        if (message.includes('WITHDRAWAL_BELOW_MINIMUM')) {
            showToast('Сумма меньше минимальной для вывода', 'err');
        } else if (message.includes('WITHDRAWAL_ABOVE_MAXIMUM')) {
            showToast('Сумма превышает максимум за одну заявку', 'err');
        } else if (message.includes('INSUFFICIENT_FUNDS')) {
            showToast('Недостаточно звёзд', 'err');
        } else if (message.includes('BALANCE_POOL') || message.includes('BALANCE_SEASON_LOCKED')) {
            showToast('Вывод временно недоступен из-за ограничений баланса', 'err');
        } else {
            console.error('submitWithdraw failed:', e);
            showToast('Не удалось подтвердить вывод. Повтори попытку.', 'err');
        }
    }
}

function closeWithdrawModal() {
    document.getElementById('withdrawModal')?.classList.remove('open');
}

/* ═══════════ ТОСТ ═══════════ */
function showToast(msg, type = 'ok') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ═══════════ ОВЕРЛЕЙ ═══════════ */
document.getElementById('itemModal')?.addEventListener('click', e => {
    if (e.target.id === 'itemModal') closeItemModal();
});
document.getElementById('sellAllModal')?.addEventListener('click', e => {
    if (e.target.id === 'sellAllModal') closeSellAllModal();
});
document.getElementById('withdrawModal')?.addEventListener('click', e => {
    if (e.target.id === 'withdrawModal') closeWithdrawModal();
});
document.getElementById('incomeModal')?.addEventListener('click', e => {
    if (e.target.id === 'incomeModal') closeIncomeModal();
});
document.getElementById('topUpModal')?.addEventListener('click', e => {
    if (e.target.id === 'topUpModal') closeTopUpModal();
});

/* ═══════════ ЭКСПОРТ ═══════════ */
window.openItemModal = openItemModal;
window.closeItemModal = closeItemModal;
window.sellItem = sellItem;
window.upgradeItem = upgradeItem;
window.upgradeFromInventory = upgradeFromInventory;
window.openSellAllModal = openSellAllModal;
window.closeSellAllModal = closeSellAllModal;
window.confirmSellAll = confirmSellAll;
window.quickSell = quickSell;
window.setSort = setSort;
window.redeemPromo = redeemPromo;
window.openWithdrawModal = openWithdrawModal;
window.closeWithdrawModal = closeWithdrawModal;
window.setMaxWithdraw = setMaxWithdraw;
window.submitWithdraw = submitWithdraw;
window.updateWithdrawTPreview = updateWithdrawTPreview;
window.refreshWithdrawLabels = refreshWithdrawLabels;
window.openTopUp = openTopUp;
window.copyRefLink = copyRefLink;
window.shareRefLink = shareRefLink;
window.toggleRefTerms = toggleRefTerms;

/* ═══════════════════════════════════════════════════════════
   СИСТЕМА НОМЕРОВ — рулетка номеров (раньше phone.js)
   ═══════════════════════════════════════════════════════════ */
// phone.js — Система номеров: рулетка номеров на странице «Профиль»
// Подключать ПОСЛЕ profile.js:  <script src="phone.js"></script>
// Зависит от глобалов profile.js: userStars, showToast, updateProfileUI, renderTotalAssets
(function () {
    'use strict';

    /* ═══════════ НАСТРОЙКИ (шансы и цены правятся здесь) ═══════════ */
    const CFG = {
        COST: 5000,            // цена одной крутки, ⭐
        BUMP_CHANCE: 0.12,     // шанс, что редкий+ номер получит префикс +888
        HYPE_MIN: 4,           // сколько цифр подряд (одинаковых или «лесенка») включают золотую подсветку
        GOLD_TIER_IDX: 3,      // с какой ступени (эпический+) номер остаётся золотым после выпадения
        START: { cc: '7', tail: '0000000000' },
        // w — относительный шанс страны, m — множитель цены (после запуска нормализуется,
        // так что средний множитель = 1 и возврат рулетки не меняется)
        COUNTRIES: [
            { cc: '7',   name: 'Россия',         flag: '🇷🇺', w: 20, m: 0.85 },
            { cc: '91',  name: 'Индия',          flag: '🇮🇳', w: 14, m: 0.85 },
            { cc: '66',  name: 'Таиланд',        flag: '🇹🇭', w: 10, m: 0.9 },
            { cc: '62',  name: 'Индонезия',      flag: '🇮🇩', w: 8,  m: 0.9 },
            { cc: '84',  name: 'Вьетнам',        flag: '🇻🇳', w: 8,  m: 0.9 },
            { cc: '90',  name: 'Турция',         flag: '🇹🇷', w: 8,  m: 0.95 },
            { cc: '380', name: 'Украина',        flag: '🇺🇦', w: 7,  m: 0.95 },
            { cc: '55',  name: 'Бразилия',       flag: '🇧🇷', w: 6,  m: 1.0 },
            { cc: '49',  name: 'Германия',       flag: '🇩🇪', w: 5,  m: 1.15 },
            { cc: '33',  name: 'Франция',        flag: '🇫🇷', w: 4,  m: 1.2 },
            { cc: '86',  name: 'Китай',          flag: '🇨🇳', w: 4,  m: 1.25 },
            { cc: '44',  name: 'Великобритания', flag: '🇬🇧', w: 3,  m: 1.4 },
            { cc: '81',  name: 'Япония',         flag: '🇯🇵', w: 3,  m: 1.5 },
            { cc: '971', name: 'ОАЭ',            flag: '🇦🇪', w: 2,  m: 2.0 },
            { cc: '1',   name: 'США',            flag: '🇺🇸', w: 2,  m: 2.2 }
        ],
        ANON: { cc: '888', name: 'Анонимный номер', flag: '💎', m: 1 },
        // weight: итоговый шанс тира (у common — остаток до 100%)
        TIERS: [
            { id: 'common',    name: 'Обычный',     color: '#9AA3BA', weight: null,     min: 1000,      max: 2400,      step: 10 },
            { id: 'good',      name: 'Красивый',    color: '#5FD6A2', weight: 0.22,     min: 3500,      max: 6000,      step: 10 },
            { id: 'rare',      name: 'Редкий',      color: '#62AEFF', weight: 0.08,     min: 9000,      max: 15000,     step: 100 },
            { id: 'epic',      name: 'Эпический',   color: '#B68CFF', weight: 0.012,    min: 30000,     max: 50000,     step: 100 },
            { id: 'legendary', name: 'Легендарный', color: '#FFB84A', weight: 0.0012,   min: 150000,    max: 300000,    step: 1000 },
            { id: 'mythic',    name: 'Мифический',  color: '#FF6B8E', weight: 0.0002,   min: 1000000,   max: 1500000,   step: 10000 },
            { id: 'jackpot',   name: 'ДЖЕКПОТ',     color: '#FFD76A', weight: 0.000001, min: 100000000, max: 100000000, step: 1 }
        ]
    };
    const START_TIER = { id: 'start', name: 'Стартовый', color: '#7B8194' };

    const LS_PHONE = 'userPhone';
    const LS_PENDING = 'userPhonePending';

    // итоговые вероятности (common = остаток)
    (function normalize() {
        const rest = CFG.TIERS.slice(1).reduce((a, t) => a + t.weight, 0);
        CFG.TIERS[0].weight = 1 - rest;
    })();

    // страны: нормализуем шансы и множители (средний множитель = 1)
    const COUNTRY_BY_CC = {};
    (function normalizeCountries() {
        const sw = CFG.COUNTRIES.reduce((a, c) => a + c.w, 0);
        const mean = CFG.COUNTRIES.reduce((a, c) => a + c.w * c.m, 0) / sw;
        CFG.COUNTRIES.forEach(c => {
            c.p = c.w / sw;
            c.mult = c.m / mean;
            COUNTRY_BY_CC[c.cc] = c;
        });
        CFG.ANON.p = 0; CFG.ANON.mult = 1;
        COUNTRY_BY_CC[CFG.ANON.cc] = CFG.ANON;
    })();
    const getCountry = cc => COUNTRY_BY_CC[cc] || COUNTRY_BY_CC['7'];

    /* ═══════════ RNG ═══════════ */
    function rndf() {
        try {
            const a = new Uint32Array(1);
            (globalThis.crypto || window.crypto).getRandomValues(a);
            return a[0] / 4294967296;
        } catch (e) { return Math.random(); }
    }
    const rnd = n => Math.floor(rndf() * n);
    const rd = () => rnd(10);
    const rs = n => Array.from({ length: n }, rd).join('');

    /* ═══════════ АНАЛИЗ НОМЕРА ═══════════ */
    function analyze(tail) {
        const d = [...tail].map(Number);
        let run = 1, maxRun = 1, asc = 1, desc = 1, stairs = 1;
        for (let i = 1; i < 10; i++) {
            run = d[i] === d[i - 1] ? run + 1 : 1;
            asc = d[i] - d[i - 1] === 1 ? asc + 1 : 1;
            desc = d[i - 1] - d[i] === 1 ? desc + 1 : 1;
            maxRun = Math.max(maxRun, run);
            stairs = Math.max(stairs, asc, desc);
        }
        const cnt = Array(10).fill(0);
        d.forEach(x => cnt[x]++);
        let tz = 0;
        for (let i = 9; i >= 0 && d[i] === 0; i--) tz++;
        return {
            d, maxRun, stairs, tz,
            maxCount: Math.max(...cnt),
            distinct: cnt.filter(Boolean).length,
            pal: tail === [...tail].reverse().join(''),
            g: [tail.slice(0, 3), tail.slice(3, 6), tail.slice(6, 8), tail.slice(8, 10)],
            sum: d.reduce((s, x) => s + x, 0)
        };
    }

    function tailTierIdx(a) {
        if (a.distinct === 1) return 5;
        if (a.maxCount >= 8 || a.stairs >= 8) return 4;
        if (a.maxCount >= 6 || a.stairs >= 6 || a.distinct <= 2 || a.tz >= 6) return 3;
        if (a.maxRun >= 4 || a.stairs >= 4 || a.tz >= 3 || a.g[0] === a.g[1] || a.pal) return 2;
        if (a.maxRun >= 3 || a.stairs >= 3 || a.tz >= 2 || a.g[2] === a.g[3] ||
            (a.g[2][0] === a.g[2][1] && a.g[3][0] === a.g[3][1])) return 1;
        return 0;
    }

    function evaluate(cc, tail) {
        const country = getCountry(cc);
        if (/^0+$/.test(tail)) return { tier: START_TIER, value: 0, reasons: [], idx: -1, country };
        const a = analyze(tail);
        const reasons = [];
        if (cc === '888') reasons.push('Префикс +888');

        if (cc === '888' && /^8+$/.test(tail)) {
            const t = CFG.TIERS[6];
            return { tier: t, value: t.min, reasons: ['Префикс +888', 'Все цифры — восьмёрки'], idx: 6, country };
        }

        let idx = tailTierIdx(a);
        if (cc === '888') idx = Math.min(5, idx + 1);
        const tier = CFG.TIERS[idx];

        if (a.distinct === 1) reasons.push('Все цифры одинаковые');
        else if (a.maxCount >= 6) reasons.push(a.maxCount + ' одинаковых цифр');
        else if (a.maxRun >= 3) reasons.push('Серия из ' + a.maxRun + ' цифр');
        if (a.stairs >= 3) reasons.push('Лесенка из ' + a.stairs + ' цифр');
        if (a.tz >= 2) reasons.push('Круглое окончание');
        if (a.pal) reasons.push('Зеркальный номер');
        if (a.g[0] === a.g[1]) reasons.push('Повтор групп');
        if (a.g[2] === a.g[3]) reasons.push('Парная концовка');
        else if (a.g[2][0] === a.g[2][1] && a.g[3][0] === a.g[3][1]) reasons.push('Двойные пары в конце');
        if (a.distinct === 2) reasons.push('Только две цифры');

        const f = ((a.sum * 7 + a.d[9] * 13 + (cc === '888' ? 50 : 0)) % 100) / 100;
        const raw = tier.min + (tier.max - tier.min) * f;
        const value = Math.max(tier.step, Math.round(raw * country.mult / tier.step) * tier.step);
        return { tier, value, reasons: reasons.slice(0, 4), idx, country };
    }

    /* ═══════════ ГЕНЕРАТОР ═══════════ */
    function fillRun(len, digit) {
        const arr = rs(10).split('');
        const pos = rnd(10 - len + 1);
        for (let i = 0; i < len; i++) arr[pos + i] = String(digit);
        return arr.join('');
    }
    function fillStairs(len) {
        const asc = rnd(2) === 0;
        const start = asc ? rnd(10 - len + 1) : len - 1 + rnd(10 - len + 1);
        const arr = rs(10).split('');
        const pos = rnd(10 - len + 1);
        for (let i = 0; i < len; i++) arr[pos + i] = String(asc ? start + i : start - i);
        return arr.join('');
    }
    const PATTERNS = [
        null,
        [ // good
            () => { const x = rd(), y = rd(); return rs(6) + x + x + y + y; },
            () => { const x = rd(), y = rd(); return rs(6) + x + y + x + y; },
            () => fillRun(3, rd()),
            () => rs(8) + '00',
            () => fillStairs(3)
        ],
        [ // rare
            () => fillRun(4, rd()),
            () => fillStairs(4 + rnd(2)),
            () => rs(7) + '000',
            () => { const g = rs(3); return g + g + rs(4); },
            () => { const h = rs(5); return h + [...h].reverse().join(''); }
        ],
        [ // epic
            () => fillRun(6 + rnd(2), rd()),
            () => fillStairs(6 + rnd(2)),
            () => { const x = rd(); let y = rd(); if (y === x) y = (y + 1) % 10; return (String(x) + y).repeat(5); },
            () => String(1 + rnd(9)) + rs(3) + '000000'
        ],
        [ // legendary
            () => fillRun(8 + rnd(2), rd()),
            () => fillStairs(8 + rnd(2))
        ],
        [ // mythic
            () => String(1 + rnd(9)).repeat(10)
        ]
    ];

    function genTail(wantIdx) {
        let last = rs(10);
        for (let i = 0; i < 120; i++) {
            const t = wantIdx === 0 ? rs(10) : PATTERNS[wantIdx][rnd(PATTERNS[wantIdx].length)]();
            last = t;
            if (!/^0+$/.test(t) && tailTierIdx(analyze(t)) === wantIdx) return t;
        }
        return last;
    }

    function pickTierIdx() {
        const r = rndf();
        let acc = 0;
        for (let i = 0; i < CFG.TIERS.length; i++) {
            acc += CFG.TIERS[i].weight;
            if (r < acc) return i;
        }
        return 0;
    }

    function pickCountry() {
        const r = rndf();
        let acc = 0;
        for (const c of CFG.COUNTRIES) {
            acc += c.p;
            if (r < acc) return c;
        }
        return CFG.COUNTRIES[0];
    }

    function generate(idx) {
        if (idx === 6) return { cc: '888', tail: '8888888888' };
        for (let i = 0; i < 80; i++) {
            const bump = idx >= 2 && rndf() < CFG.BUMP_CHANCE;
            const cc = bump ? '888' : pickCountry().cc;
            const tail = genTail(bump ? idx - 1 : idx);
            if (evaluate(cc, tail).idx === idx) return { cc, tail };
        }
        const tail = rs(10);
        return { cc: pickCountry().cc, tail };
    }

    function rollNumber() { return generate(pickTierIdx()); }

    /* ═══════════ ФОРМАТ ═══════════ */
    function fmt(cc, tail) {
        return '+' + cc + ' ' + tail.slice(0, 3) + ' ' + tail.slice(3, 6) + ' ' + tail.slice(6, 8) + ' ' + tail.slice(8, 10);
    }
    function fmtStars(n) {
        return typeof window !== 'undefined' && window.formatStars ? window.formatStars(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    function fmtChance(p) {
        if (p >= 0.01) return (p * 100).toFixed(p >= 0.1 ? 0 : 1).replace(/\.0$/, '') + '%';
        return '1 из ' + fmtStars(Math.round(1 / p));
    }
    function expectedReturn() {
        const ev = CFG.TIERS.reduce((s, t) => s + t.weight * (t.min + t.max) / 2, 0);
        return { ev, rtp: ev / CFG.COST };
    }

    /* ═══════════ ДВИЖОК ДЛЯ ТЕСТОВ ═══════════ */
    const engine = { CFG, analyze, evaluate, generate, rollNumber, pickTierIdx, fmt, expectedReturn, getCountry };
    if (typeof document === 'undefined') {
        if (typeof module !== 'undefined') module.exports = engine;
        return;
    }
    window.PhoneRoulette = engine;

    /* ═══════════ СОСТОЯНИЕ ═══════════ */
    const validNum = (cc, tail) => !!COUNTRY_BY_CC[cc] && /^\d{10}$/.test(String(tail));
    let state = loadState();
    let busy = false;
    let pending = null;      // { cc, tail } — выпавший, но не выбранный номер
    let resolving = false;

    function loadState() {
        try {
            const o = JSON.parse(localStorage.getItem(LS_PHONE));
            if (o && validNum(o.cc, o.tail)) {
                return { cc: o.cc, tail: o.tail, rolls: +o.rolls || 0, best: +o.best || 0 };
            }
        } catch (e) { }
        return { cc: CFG.START.cc, tail: CFG.START.tail, rolls: 0, best: 0 };
    }
    // что хранится в localStorage/Firestore: номер + оценка (чтобы страница трейдов
    // могла показать цену, не таща движок рулетки)
    function phonePayload(st) {
        const ev = evaluate(st.cc, st.tail);
        return {
            cc: st.cc, tail: st.tail, rolls: st.rolls | 0, best: st.best | 0,
            value: ev.value, tierId: ev.tier.id, tierName: ev.tier.name,
            tierColor: ev.tier.color, flag: ev.country.flag
        };
    }
    function saveState() {
        const payload = phonePayload(state);
        localStorage.setItem(LS_PHONE, JSON.stringify(payload));
    }
    function loadPending() {
        try {
            const o = JSON.parse(localStorage.getItem(LS_PENDING));
            if (o && validNum(o.cc, o.tail)) return { cc: o.cc, tail: o.tail };
        } catch (e) { }
        return null;
    }

    /* ═══════════ БАЛАНС ═══════════ */
    function readStars() { return parseInt(localStorage.getItem('userStars')) || 0; }
    function toast(msg, type) { try { showToast(msg, type || 'ok'); } catch (e) { } }
    function isBanned() { return !!(window.Manipulation && window.Manipulation.isBanned && window.Manipulation.isBanned()); }
    const $ = id => document.getElementById(id);

    /* ═══════════ ОТРИСОВКА КАРТОЧКИ ═══════════ */
    function setTierClass(el, tier) {
        if (!el) return;
        [...el.classList].filter(c => c.startsWith('t-')).forEach(c => el.classList.remove(c));
        el.classList.add('t-' + tier.id);
    }

    function render() {
        const ev = evaluate(state.cc, state.tail);
        const card = $('phoneCard');
        setTierClass(card, ev.tier);
        card?.classList.toggle('shine', ev.idx >= 3);
        $('phoneNum').textContent = fmt(state.cc, state.tail);
        const ctry = $('phoneCountry');
        if (ctry) ctry.textContent = ev.country.flag + ' ' + ev.country.name;
        $('phoneTier').textContent = ev.tier.name;
        $('phonePriceVal').textContent = fmtStars(ev.value);
        $('phoneRolls').textContent = state.rolls
            ? 'Круток: ' + fmtStars(state.rolls) + (state.best ? ' · рекорд ' + fmtStars(state.best) + ' ⭐' : '')
            : 'Ещё не крутил';
        const sell = $('phoneSellBtn');
        if (sell) sell.hidden = ev.value <= 0;

        const hero = $('heroPhone');
        if (hero) {
            setTierClass(hero, ev.tier);
            hero.textContent = ev.country.flag + ' ' + fmt(state.cc, state.tail);
        }
        const btn = $('phoneRollBtn');
        if (btn) btn.disabled = busy;
        const cost = $('phoneRollCost');
        if (cost) cost.textContent = fmtStars(CFG.COST);
    }

    function renderOdds() {
        const box = $('phoneOdds');
        if (!box) return;
        const { rtp } = expectedReturn();
        const rows = CFG.TIERS.map(t => {
            const price = t.min === t.max ? fmtStars(t.min) : fmtStars(t.min) + ' – ' + fmtStars(t.max);
            return `<div class="po-row t-${t.id}">
                <span class="po-dot"></span>
                <span class="po-name">${t.name}</span>
                <span class="po-chance">${fmtChance(t.weight)}</span>
                <span class="po-price">${price} ⭐</span>
            </div>`;
        }).join('');
        const countryRows = CFG.COUNTRIES.map(c =>
            `<span class="po-country"><i>${c.flag}</i><b>+${c.cc}</b><em>×${c.mult.toFixed(2).replace(/0$/, '')}</em></span>`
        ).join('');
        box.innerHTML = rows +
            `<div class="po-sub">Страна номера — множитель цены</div>
             <div class="po-countries">${countryRows}</div>
             <div class="po-note">Страна выбирается случайно: редкие страны (США, ОАЭ, Япония) дороже, но выпадают реже. Среднее по всем странам — ×1.</div>
             <div class="po-note">Красивые номера — серии одинаковых цифр, «лесенки», круглые и зеркальные. Префикс <b>+888</b> поднимает номер на ступень выше. Джекпот: <b>+888 888 888 88 88</b>.</div>
             <div class="po-note">Средний возврат за крутку ≈ ${Math.round(rtp * 100)}%. Лишний номер всегда можно продать.</div>`;
    }

    /* ═══════════ МОДАЛКА РУЛЕТКИ ═══════════ */
    function openModal() { $('phoneRollModal')?.classList.add('open'); }
    function closeModal() { $('phoneRollModal')?.classList.remove('open'); }

    function buildSlots(el) {
        const g = (n) => '<span class="pg">' + '<i class="pd">0</i>'.repeat(n) + '</span>';
        el.innerHTML = '<span class="pp">+</span><span class="pcc">7</span>' + g(3) + g(3) + g(2) + g(2);
        return { cc: el.querySelector('.pcc'), digits: [...el.querySelectorAll('.pd')] };
    }

    function spin(res, idx) {
        return new Promise(resolve => {
            const screen = $('prScreen');
            const num = $('prNum');
            screen.className = 'pr-screen spinning';
            const slots = buildSlots(num);
            const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

            const FLICK = CFG.COUNTRIES.map(c => c.cc).concat(['888', '888']);
            let locked = 0;
            const iv = setInterval(() => {
                if (!slots.cc.classList.contains('locked')) slots.cc.textContent = FLICK[rnd(FLICK.length)];
                for (let i = locked; i < 10; i++) slots.digits[i].textContent = rd();
            }, 55);

            // задержки между фиксациями: сначала код страны, затем цифры слева направо
            const suspense = idx >= 5 ? [800, 1100, 1600] : idx >= 3 ? [600, 800, 1100] : [420, 560, 760];
            const delays = [700, 230, 230, 230, 240, 250, 260, 280, ...suspense];
            const k = reduced ? 0.25 : 1;
            let step = 0;

            // золотая подсветка: пока «линия» (одинаковые цифры / лесенка) растёт — горит;
            // оборвалась — лопается; если номер в итоге дорогой — останется золотым в showResult
            let hype = false;
            function updateHype(streak) {
                const on = streak >= CFG.HYPE_MIN;
                if (on && !hype) {
                    hype = true;
                    screen.classList.add('hype');
                } else if (!on && hype) {
                    hype = false;
                    screen.classList.remove('hype', 'hype-hot');
                    popHype(screen);
                }
                screen.classList.toggle('hype-hot', hype && streak >= CFG.HYPE_MIN + 2);
            }

            function next() {
                if (step === 0) {
                    slots.cc.textContent = res.cc;
                    slots.cc.classList.add('locked');
                } else {
                    const i = step - 1;
                    slots.digits[i].textContent = res.tail[i];
                    slots.digits[i].classList.add('locked');
                    locked = step;
                    updateHype(trailingStreak(res.tail.slice(0, locked)));
                }
                window.vibrate?.();
                step++;
                if (step > 10) {
                    clearInterval(iv);
                    // линия дошла до конца, но номер не дорогой — подсветка лопается
                    if (hype && idx < CFG.GOLD_TIER_IDX) {
                        hype = false;
                        screen.classList.remove('hype', 'hype-hot');
                        popHype(screen);
                    }
                    setTimeout(resolve, 350 * k);
                    return;
                }
                setTimeout(next, delays[step] * k);
            }
            setTimeout(next, delays[0] * k);
        });
    }

    // длина «линии» в конце набранных цифр: одинаковые подряд или лесенка ±1
    function trailingStreak(s) {
        const d = [...s].map(Number);
        const n = d.length;
        if (n < 2) return n;
        let eq = 1, asc = 1, desc = 1;
        for (let i = n - 1; i > 0 && d[i] === d[i - 1]; i--) eq++;
        for (let i = n - 1; i > 0 && d[i] - d[i - 1] === 1; i--) asc++;
        for (let i = n - 1; i > 0 && d[i - 1] - d[i] === 1; i--) desc++;
        return Math.max(eq, asc, desc);
    }

    // «лопание» золотой подсветки: кольцо + осколки
    function popHype(screen) {
        const burst = document.createElement('span');
        burst.className = 'pr-pop';
        let html = '<i class="pr-pop-ring"></i>';
        const N = 12;
        for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2 + rndf() * 0.4;
            const dist = 0.65 + rndf() * 0.35;
            html += '<i class="pr-pop-shard" style="--dx:' + Math.round(Math.cos(a) * 130 * dist) +
                'px;--dy:' + Math.round(Math.sin(a) * 38 * dist) + 'px"></i>';
        }
        burst.innerHTML = html;
        screen.appendChild(burst);
        screen.classList.add('popped');
        setTimeout(() => { burst.remove(); screen.classList.remove('popped'); }, 700);
        window.vibrate?.('error');
    }

    function countUp(el, to, ms) {
        const t0 = performance.now();
        function frame(t) {
            const p = Math.min(1, (t - t0) / ms);
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = fmtStars(Math.round(to * e));
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function showResult(res) {
        const ev = evaluate(res.cc, res.tail);
        const cur = evaluate(state.cc, state.tail);
        const sheet = $('phoneRollSheet');
        const screen = $('prScreen');
        $('prNum').textContent = fmt(res.cc, res.tail);
        screen.className = 'pr-screen done';
        setTierClass(sheet, ev.tier);
        setTierClass(screen, ev.tier);
        if (ev.idx >= 3) screen.classList.add('shine');
        // дорогой номер остаётся золотым
        const gold = ev.idx >= CFG.GOLD_TIER_IDX;
        screen.classList.toggle('gold', gold);
        sheet.classList.toggle('gold', gold);

        $('prStatus').hidden = true;
        $('prTitle').textContent = ev.idx >= 5 ? 'Невероятно!' : ev.idx >= 3 ? 'Отличный номер!' : 'Номер выпал';
        $('prTier').textContent = ev.tier.name;
        const pc = $('prCountry');
        if (pc) pc.textContent = ev.country.flag + ' ' + ev.country.name + (ev.country.mult !== 1 ? ' · ×' + ev.country.mult.toFixed(2).replace(/0$/, '') : '');
        countUp($('prValue'), ev.value, 800);
        $('prReasons').innerHTML = ev.reasons.map(r => `<span>${r}</span>`).join('');

        const better = ev.value > cur.value;
        $('prCompare').innerHTML = cur.value > 0
            ? `Сейчас у тебя <b>${fmt(state.cc, state.tail)}</b> · ${fmtStars(cur.value)} ⭐ — новый ${better ? '<em class="up">дороже</em>' : ev.value === cur.value ? 'стоит столько же' : '<em class="down">дешевле</em>'}`
            : 'Сейчас у тебя стартовый номер без цены';

        const keepNew = $('prKeepNew'), keepOld = $('prKeepOld');
        keepNew.querySelector('small').textContent = cur.value > 0
            ? 'прежний продастся за ' + fmtStars(cur.value) + ' ⭐'
            : 'станет твоим номером';
        keepOld.querySelector('small').textContent = 'новый продастся за ' + fmtStars(ev.value) + ' ⭐';
        keepNew.classList.toggle('primary', better || ev.value === cur.value);
        keepOld.classList.toggle('primary', !better && ev.value !== cur.value);
        keepNew.disabled = keepOld.disabled = false;
        $('prResult').hidden = false;

        if (ev.value > state.best) { state.best = ev.value; saveState(); render(); }
        window.vibrate?.(ev.idx >= 2 ? 'success' : undefined);
    }

    /* ═══════════ ДЕЙСТВИЯ ═══════════ */
    async function startRoll() {
        if (busy || pending) return;
        if (isBanned()) { toast('Аккаунт заблокирован', 'err'); return; }
        if (readStars() < CFG.COST) {
            toast('Нужно ' + fmtStars(CFG.COST) + ' ⭐ для крутки', 'err');
            return;
        }
        busy = true; render();
        let res;
        try {
            const result = await window.LootStarAPI.operatePhone('roll');
            window.LootStarAPI.applyPhoneResult(result);
            state = loadState();
            res = result.result;
            pending = res;
            saveState();
        } catch (e) {
            busy = false; render();
            toast(e?.code === 'INSUFFICIENT_FUNDS' ? 'Недостаточно звёзд' : 'Ошибка, попробуйте снова', 'err');
            return;
        }

        $('prResult').hidden = true;
        $('prStatus').hidden = false;
        $('prTitle').textContent = 'Рулетка номеров';
        setTierClass($('phoneRollSheet'), START_TIER);
        $('phoneRollSheet')?.classList.remove('gold');
        openModal();
        await spin(res, evaluate(res.cc, res.tail).idx);
        showResult(res);
        busy = false; render();
    }

    async function resolve(keepNewNumber) {
        if (!pending || resolving) return;
        resolving = true;
        const keepNew = $('prKeepNew'), keepOld = $('prKeepOld');
        keepNew.disabled = keepOld.disabled = true;
        let payout;
        try {
            const result = await window.LootStarAPI.operatePhone('resolve', { keepNew: keepNewNumber });
            window.LootStarAPI.applyPhoneResult(result);
            payout = Number(result.payout) || 0;
            state = loadState();
        } catch (e) {
            console.error('phone resolve failed', e);
            toast('Ошибка начисления, попробуйте снова', 'err');
            keepNew.disabled = keepOld.disabled = false;
            resolving = false;
            return;
        }
        pending = null;
        localStorage.removeItem(LS_PENDING);
        closeModal();
        render();
        resolving = false;
        toast(keepNewNumber
            ? (payout > 0 ? 'Новый номер твой · прежний продан за ' + fmtStars(payout) + ' ⭐' : 'Новый номер установлен')
            : 'Номер продан за ' + fmtStars(payout) + ' ⭐', 'ok');
        window.vibrate?.('success');
    }

    async function sellCurrent() {
        if (busy || pending) return;
        const ev = evaluate(state.cc, state.tail);
        if (ev.value <= 0) return;
        if (!confirm('Продать номер ' + fmt(state.cc, state.tail) + ' за ' + fmtStars(ev.value) + ' ⭐?\nВернётся стартовый номер.')) return;
        let payout = 0;
        try {
            const result = await window.LootStarAPI.operatePhone('sell');
            window.LootStarAPI.applyPhoneResult(result);
            state = loadState();
            payout = Number(result.payout) || 0;
        } catch (e) {
            toast('Ошибка продажи, попробуйте снова', 'err');
            return;
        }
        toast('Номер продан за ' + fmtStars(payout) + ' ⭐', 'ok');
        window.vibrate?.('success');
    }

    /* ═══════════ НОМЕР ИЗ ИНВЕНТАРЯ → ТЕКУЩИЙ ═══════════ */
    async function installItem(itemId) {
        if (busy || pending || resolving) { toast('Сначала завершите рулетку номеров', 'err'); return; }
        if (isBanned()) { toast('Аккаунт заблокирован', 'err'); return; }

        let invNow = [];
        try { invNow = JSON.parse(localStorage.getItem('userInventory') || '[]'); } catch (e) { }
        const item = Array.isArray(invNow) ? invNow.find(i => i && i.id === itemId && i.type === 'phone') : null;
        const ph = item && item.phone;
        if (!ph || !validNum(String(ph.cc), String(ph.tail))) { toast('Номер не найден', 'err'); return; }

        busy = true;
        try {
            const result = await window.LootStarAPI.operatePhone('install', { itemId });
            window.LootStarAPI.applyPhoneResult(result);
            state = loadState();
            try { loadInventory(); renderInventory(); renderTotalAssets(); } catch (e) { }
            busy = false;
            render();
            toast(evaluate(String(ph.cc), String(ph.tail)).value
                ? 'Номер установлен · прежний лежит в инвентаре' : 'Номер установлен', 'ok');
            window.vibrate?.('success');
        } catch (e) {
            busy = false;
            render();
            toast(['ITEM_GONE', 'ITEMS_NOT_FOUND'].includes(e?.code || e?.message)
                ? 'Номер уже недоступен' : 'Ошибка, попробуйте снова', 'err');
        }
    }
    window.installPhoneItem = installItem;

    /* ═══════════ INIT ═══════════ */
    function init() {
        // старые сохранения без оценки: дописываем цену/тир, чтобы номер можно было трейдить
        try {
            const raw = JSON.parse(localStorage.getItem(LS_PHONE));
            if (!raw || raw.value === undefined) {
                if (evaluate(state.cc, state.tail).value > 0) saveState();
            }
        } catch (e) { }
        renderOdds();
        render();

        $('phoneRollBtn')?.addEventListener('click', startRoll);
        $('phoneSellBtn')?.addEventListener('click', sellCurrent);
        $('prKeepNew')?.addEventListener('click', () => resolve(true));
        $('prKeepOld')?.addEventListener('click', () => resolve(false));
        $('phoneOddsToggle')?.addEventListener('click', () => {
            const box = $('phoneOdds');
            const open = box.hidden;
            box.hidden = !open;
            $('phoneOddsToggle').classList.toggle('open', open);
        });
        $('heroPhone')?.addEventListener('click', () => {
            $('phoneBlock')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        // номер, выпавший до перезагрузки, но не выбранный
        pending = loadPending();
        if (pending) {
            $('prStatus').hidden = true;
            openModal();
            showResult(pending);
        }

        window.addEventListener('profileDataLoaded', () => {
            if (!busy && !pending) { state = loadState(); render(); }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();