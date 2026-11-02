(function () {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const MAX_SEARCH_RESULTS = 25;
    let myId = '';
    let myName = 'Игрок';
    let balance = 0;
    let inventory = [];
    let currentTradeId = null;
    let currentTradeData = null;
    let tradePollTimer = null;
    let tradePollInProgress = false;
    let expiryTimer = null;
    let expiryTimerDeadline = 0;
    let expiryInProgress = false;
    let noticeTimer = null;
    let searchTimer = null;
    let searchSequence = 0;
    let counterInitialized = false;
    let counterItems = [];
    let counterStars = 0;
    const tradeParams = { targetUserId: null, targetUsername: '', selectedItems: [], stars: 0 };

    const $ = id => document.getElementById(id);

    /* A profile phone is represented by a virtual selector; the API converts it atomically. */
    const PHONE_KEY = '__phone__';

    function validPhone(p) {
        return !!p && typeof p === 'object' &&
            /^\d{1,3}$/.test(String(p.cc)) && /^\d{10}$/.test(String(p.tail));
    }

    function phoneValue(p) {
        const v = Number(p && p.value);
        return Number.isSafeInteger(v) && v > 0 ? v : 0;
    }

    function formatPhone(cc, tail) {
        return '+' + cc + ' ' + tail.slice(0, 3) + ' ' + tail.slice(3, 6) + ' ' + tail.slice(6, 8) + ' ' + tail.slice(8, 10);
    }

    function readMyPhone() {
        try {
            const p = JSON.parse(localStorage.getItem('userPhone'));
            return validPhone(p) ? p : null;
        } catch (error) {
            return null;
        }
    }

    // карточка номера (SVG data URI); данные чистим до цифр — они могли прийти от другого игрока
    function phoneImage(item) {
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

    function buildPhoneCard(phone, selectedIds, onToggle) {
        const selected = selectedIds.includes(PHONE_KEY);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `inv-item${selected ? ' selected' : ''}`;
        card.dataset.itemId = PHONE_KEY;
        card.setAttribute('aria-pressed', String(selected));
        card.addEventListener('click', () => onToggle(PHONE_KEY));

        const check = document.createElement('span');
        check.className = 'check';
        check.textContent = '✓';
        card.appendChild(check);
        addSafeImage(card, phoneImage({ phone }), '', '');

        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = formatPhone(String(phone.cc), String(phone.tail));
        card.appendChild(name);

        const price = document.createElement('div');
        price.className = 'price';
        price.textContent = `${window.formatStars(phoneValue(phone))} ⭐`;
        card.appendChild(price);
        return card;
    }

    function showNotice(message, isError) {
        const notice = $('tradeNotice');
        notice.textContent = message;
        notice.style.borderColor = isError ? 'var(--ruby)' : 'var(--jade)';
        notice.classList.add('show');
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => notice.classList.remove('show'), 3500);
    }

    function showPageError(message) {
        const step = $('stepSelectUser');
        step.style.display = 'block';
        step.replaceChildren();
        const text = document.createElement('div');
        text.style.cssText = 'text-align:center;padding:24px;color:var(--text-2);';
        text.textContent = message;
        step.appendChild(text);
    }

    function safeImageUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const url = new URL(value, location.origin);
            if (url.protocol === 'https:' || (url.origin === location.origin && value.startsWith('/') && !value.startsWith('//'))) {
                return url.href;
            }
        } catch (error) {
            console.warn('[trade] Invalid image URL:', error);
        }
        return '';
    }

    function getItemImage(item) {
        if (item && item.type === 'phone' && item.phone) return phoneImage(item);
        const gift = (window.GIFTS || []).find(entry =>
            entry.name === item.name && Number(entry.price) === Number(item.price)
        );
        return safeImageUrl(item.image) || safeImageUrl(gift?.image) || safeImageUrl(window.GIFT_FALLBACK) || '/shared/star.png';
    }

    function itemId(item) {
        return item && item.id != null ? String(item.id) : '';
    }

    function isTradable(item) {
        return window.TradeService.isTradable(item);
    }

    function isExpired(trade) {
        return Date.now() >= getTradeExpiry(trade);
    }

    function getTradeExpiry(trade) {
        const createdAt = Number.isSafeInteger(trade.createdAt) ? trade.createdAt : Date.now();
        return Number.isSafeInteger(trade.expiresAt) ? trade.expiresAt : createdAt + DAY_MS;
    }

    function errorMessage(error) {
        const messages = {
            INSUFFICIENT_FUNDS: 'Недостаточно звёзд.',
            TRADE_INVALID_RECIPIENT: 'Выберите другого игрока.',
            TRADE_EMPTY_OFFER: 'Добавьте предметы или звёзды в предложение.',
            TRADE_ITEM_UNAVAILABLE: 'Выбранный предмет больше недоступен. Обновите страницу.',
            TRADE_ITEM_NOT_TRADABLE: 'Этот предмет нельзя передать.',
            TRADE_NOT_PARTICIPANT: 'Вы не являетесь участником этого трейда.',
            TRADE_INVALID_PARTICIPANTS: 'У трейда некорректно указаны участники.',
            TRADE_NOT_ACCEPTED_BY_BOTH: 'Трейд должен быть подтверждён обеими сторонами.',
            TRADE_COUNTER_NOT_ESCROWED: 'Встречное предложение не зарезервировано. Отмените старый трейд и создайте новый.',
            TRADE_INVALID_ESCROW: 'Активы трейда уже возвращены или не были зарезервированы.',
            TRADE_SYNC_FAILED: 'Действие сохранено, но данные не обновились. Перезагрузите страницу.',
            TRADE_ALREADY_ACCEPTED: 'После принятия изменить предложение нельзя.',
            TRADE_EXPIRED: 'Срок трейда истёк.',
            TRADE_PARTICIPANT_NOT_FOUND: 'Не удалось найти аккаунт участника.',
            TRADE_DUPLICATE_ITEM: 'Обнаружен повторный ID предмета. Обновите инвентарь.',
            TRADE_INVALID_ITEMS: 'Данные предметов повреждены. Трейд нельзя завершить.',
            TRADE_INVALID_AMOUNT: 'Некорректная сумма звёзд.',
            TRADE_INVALID_BALANCE: 'Некорректный баланс аккаунта.',
            TRADE_UNAVAILABLE: 'Сервис трейдов временно недоступен.',
            TRADE_FIREBASE_UNAVAILABLE: 'Не удалось подключиться к Firebase.',
            TRADE_SENDER_NOT_FOUND: 'Не найден аккаунт отправителя.',
            TRADE_PHONE_UNAVAILABLE: 'Номер недоступен. Откройте профиль, чтобы он обновился, и попробуйте снова.',
            TRADE_PENDING_EXISTS: 'У вас уже есть активный трейд. Завершите или отмените его перед созданием нового.',
            TRADE_RECIPIENT_NOT_FOUND: 'Игрок не найден или недоступен.',
            TRADE_INVALID_SEARCH: 'Введите корректное имя игрока.',
            BALANCE_POOL_LIMIT: 'Превышен лимит получения активов.',
            BALANCE_POOL_EXHAUSTED: 'Лимит получения активов на сегодня исчерпан.',
            BALANCE_SEASON_LOCKED: 'Передача активов сейчас заблокирована.'
        };
        return messages[error?.message] || 'Не удалось выполнить действие. Попробуйте ещё раз.';
    }

    async function refreshMyData() {
        const user = await window.LootStarAPI.loadProfile();
        balance = Number(user.stars) || 0;
        inventory = Array.isArray(user.inventory) ? user.inventory : [];
        window.refreshCurrencyUI?.();
        return true;
    }

    async function ensureInventoryIds() {
        await window.LootStarAPI.prepareTradeInventory();
        await refreshMyData();
    }

    function addSafeImage(container, src, className, alt) {
        const image = document.createElement('img');
        image.className = className || '';
        image.alt = alt || '';
        image.src = src;
        image.onerror = () => {
            image.onerror = null;
            image.src = '/shared/star.png';
        };
        container.appendChild(image);
        return image;
    }

    function setStars(value, source) {
        const next = Number(value);
        const amount = Number.isSafeInteger(next) ? Math.min(balance, Math.max(0, next)) : 0;
        if (source !== 'slider') $('starsSlider').value = String(amount);
        if (source !== 'input') $('starsInput').value = String(amount);
        tradeParams.stars = amount;
        $('starsValue').textContent = window.formatStars(amount);
        if ($('btnSendTrade')) {
            $('btnSendTrade').disabled = tradeParams.selectedItems.length === 0 && amount === 0;
        }
    }

    function setCounterStars(value, source) {
        const next = Number(value);
        const amount = Number.isSafeInteger(next) ? Math.min(balance, Math.max(0, next)) : 0;
        if (source !== 'slider') $('counterStarsSlider').value = String(amount);
        if (source !== 'input') $('counterStarsInput').value = String(amount);
        counterStars = amount;
    }

    function configureStarInputs() {
        $('starsSlider').max = String(balance);
        $('starsInput').max = String(balance);
        $('counterStarsSlider').max = String(balance);
        $('counterStarsInput').max = String(balance);
        setStars(tradeParams.stars);
        setCounterStars(counterStars);
    }

    function renderInventory(containerId, selectedIds, onToggle, excludedIds, withPhone) {
        const container = $(containerId);
        container.replaceChildren();
        const excluded = new Set(excludedIds || []);
        const available = inventory.filter(item => isTradable(item) && !excluded.has(itemId(item)));
        const myPhone = withPhone ? readMyPhone() : null;
        const hasPhone = !!myPhone && phoneValue(myPhone) > 0;

        if (!available.length && !hasPhone) {
            const empty = document.createElement('div');
            empty.style.cssText = 'grid-column:1/-1;text-align:center;color:var(--text-2);font-size:12px;padding:10px;';
            empty.textContent = 'Нет доступных для обмена предметов';
            container.appendChild(empty);
            return;
        }

        if (hasPhone) container.appendChild(buildPhoneCard(myPhone, selectedIds, onToggle));

        available.forEach(item => {
            const id = itemId(item);
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `inv-item${selectedIds.includes(id) ? ' selected' : ''}`;
            card.dataset.itemId = id;
            card.setAttribute('aria-pressed', String(selectedIds.includes(id)));
            card.addEventListener('click', () => onToggle(id));

            const check = document.createElement('span');
            check.className = 'check';
            check.textContent = '✓';
            card.appendChild(check);
            addSafeImage(card, getItemImage(item), '', '');

            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = String(item.name || 'Предмет');
            card.appendChild(name);

            const price = document.createElement('div');
            price.className = 'price';
            price.textContent = `${window.formatStars(Number(item.price) || 0)} ⭐`;
            card.appendChild(price);
            container.appendChild(card);
        });
    }

    function renderMyInventory() {
        renderInventory('myInventory', tradeParams.selectedItems, toggleMyItem, undefined, true);
    }

    function toggleMyItem(id) {
        const index = tradeParams.selectedItems.indexOf(id);
        if (index >= 0) tradeParams.selectedItems.splice(index, 1);
        else tradeParams.selectedItems.push(id);
        renderMyInventory();
        $('btnSendTrade').disabled = tradeParams.selectedItems.length === 0 && tradeParams.stars === 0;
    }

    function renderCounterInventory() {
        if (!currentTradeData) return;
        const excluded = [
            ...(Array.isArray(currentTradeData.fromItems) ? currentTradeData.fromItems : []),
            ...(Array.isArray(currentTradeData.toItems) ? currentTradeData.toItems : [])
        ].map(itemId);
        renderInventory('myInventoryForCounter', counterItems, toggleCounterItem, excluded, true);
    }

    function toggleCounterItem(id) {
        if (currentTradeData?.acceptedTo) return;
        const index = counterItems.indexOf(id);
        if (index >= 0) counterItems.splice(index, 1);
        else counterItems.push(id);
        renderCounterInventory();
    }

    async function searchUsers(term) {
        const container = $('usersList');
        const sequence = ++searchSequence;
        const query = term.trim().replace(/^@/, '').trim();
        container.textContent = query ? 'Поиск игроков…' : 'Введите имя или @юзернейм для поиска.';
        if (!query) return;

        try {
            const result = await window.LootStarAPI.searchTradeUsers(query);
            if (sequence !== searchSequence) return;
            renderUsers((result.users || []).slice(0, MAX_SEARCH_RESULTS).map(user => ({
                ...user,
                username: String(user.username || user.id).replace(/^@/, ''),
                photo: safeImageUrl(user.photo)
            })));
        } catch (error) {
            console.error('[trade] Player search failed:', error);
            if (sequence === searchSequence) container.textContent = 'Ошибка поиска. Попробуйте ещё раз.';
        }
    }

    function renderUsers(users) {
        const container = $('usersList');
        container.replaceChildren();
        if (!users.length) {
            container.textContent = 'Игроки не найдены';
            return;
        }

        users.forEach(user => {
            const card = document.createElement('div');
            card.className = 'user-card';

            const person = document.createElement('div');
            person.style.cssText = 'display:flex;align-items:center;';
            if (user.photo) {
                addSafeImage(person, user.photo, 'user-avatar', user.name);
            } else {
                const avatar = document.createElement('div');
                avatar.className = 'user-avatar';
                avatar.textContent = Array.from(user.name)[0]?.toLocaleUpperCase() || 'И';
                person.appendChild(avatar);
            }

            const info = document.createElement('div');
            info.className = 'user-info';
            const name = document.createElement('div');
            name.className = 'user-name';
            name.textContent = user.name;
            const username = document.createElement('div');
            username.className = 'user-username';
            username.textContent = `@${user.username}`;
            info.append(name, username);
            person.appendChild(info);
            card.appendChild(person);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-trade';
            button.textContent = 'Трейд';
            button.addEventListener('click', () => selectUser(user.id, user.name));
            card.addEventListener('click', event => {
                if (event.target !== button) selectUser(user.id, user.name);
            });
            card.appendChild(button);
            container.appendChild(card);
        });
    }

    function selectUser(id, name) {
        tradeParams.targetUserId = id;
        tradeParams.targetUsername = name;
        tradeParams.selectedItems = [];
        tradeParams.stars = 0;
        $('stepSelectUser').style.display = 'none';
        $('stepCreateTrade').style.display = 'block';
        $('targetName').textContent = name;
        configureStarInputs();
        renderMyInventory();
        $('btnSendTrade').disabled = true;
    }

    function showHome() {
        location.href = '../index.html';
    }

    function createButton(label, color, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-primary';
        button.textContent = label;
        if (color) button.style.background = color;
        button.addEventListener('click', handler);
        return button;
    }

    function appendOfferItems(container, items) {
        container.replaceChildren();
        if (!items.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:var(--text-2);font-size:12px;';
            empty.textContent = 'Без предметов';
            container.appendChild(empty);
            return;
        }

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'offer-item';
            addSafeImage(row, getItemImage(item), '', '');
            const info = document.createElement('div');
            info.className = 'offer-item-info';
            const name = document.createElement('div');
            name.className = 'offer-item-name';
            name.textContent = String(item.name || 'Предмет');
            const price = document.createElement('div');
            price.className = 'offer-item-price';
            price.textContent = `${window.formatStars(Number(item.price) || 0)} ⭐`;
            info.append(name, price);
            row.appendChild(info);
            container.appendChild(row);
        });
    }

    function renderTradeView() {
        const trade = currentTradeData;
        const isFrom = trade.fromUserId === myId;
        const isTo = trade.toUserId === myId;
        if (!isFrom && !isTo) {
            $('viewStatus').textContent = 'У вас нет доступа к этому трейду.';
            $('viewActions').replaceChildren();
            return;
        }

        const fromItems = Array.isArray(trade.fromItems) ? trade.fromItems : [];
        const toItems = Array.isArray(trade.toItems) ? trade.toItems : [];
        const fromStars = Number(trade.fromStars) || 0;
        const toStars = Number(trade.toStars) || 0;
        $('viewFromName').textContent = String(trade.fromUsername || 'Игрок');
        appendOfferItems($('viewFromItems'), fromItems);
        const fromFee = Math.floor(fromStars * 0.1);
        const toFee = Math.floor(toStars * 0.1);
        $('viewFromStars').textContent = fromStars > 0
            ? `+ ${window.formatStars(fromStars)} ⭐ (получатель получит ${window.formatStars(fromStars - fromFee)}; комиссия ${window.formatStars(fromFee)})`
            : '';
        $('viewToBlock').style.display = toItems.length || toStars > 0 ? 'block' : 'none';
        appendOfferItems($('viewToItems'), toItems);
        $('viewToStars').textContent = toStars > 0
            ? `+ ${window.formatStars(toStars)} ⭐ (получатель получит ${window.formatStars(toStars - toFee)}; комиссия ${window.formatStars(toFee)})`
            : '';

        const status = $('viewStatus');
        const actions = $('viewActions');
        const counterBlock = $('addMyItemsBlock');
        actions.replaceChildren();
        counterBlock.style.display = 'none';
        status.style.color = 'var(--text-2)';

        if (trade.status === 'completed') {
            status.textContent = '✅ Трейд успешно завершён';
            status.style.color = 'var(--jade)';
            actions.appendChild(createButton('На главную', null, showHome));
            return;
        }
        if (trade.status === 'rejected' || trade.status === 'expired') {
            status.textContent = trade.status === 'expired' ? '⌛ Срок трейда истёк, активы возвращены.' : '❌ Трейд отменён';
            status.style.color = 'var(--ruby)';
            actions.appendChild(createButton('На главную', null, showHome));
            return;
        }
        if (trade.status !== 'pending') {
            status.textContent = 'Неизвестный статус трейда.';
            return;
        }

        if (isExpired(trade)) {
            status.textContent = '⌛ Срок трейда истёк. Возвращаем активы…';
            expireTrade(currentTradeId);
            return;
        }

        status.textContent = `Трейд действует до ${new Date(getTradeExpiry(trade)).toLocaleString('ru-RU')}.`;
        if (isTo && trade.acceptedTo !== true) {
            counterBlock.style.display = 'block';
            configureStarInputs();
            renderCounterInventory();
            if (trade.acceptedFrom === true) {
                status.textContent += ' Изменение предложения сбросит подтверждение отправителя.';
            }
        }

        const oldCounterNotEscrowed = trade.acceptedTo === true &&
            (toItems.length > 0 || toStars > 0) && trade.escrowTo !== true;
        if (oldCounterNotEscrowed) {
            status.textContent = 'Старое встречное предложение не было зарезервировано. Отмените этот трейд и создайте новый.';
            status.style.color = 'var(--ruby)';
        } else if (trade.acceptedFrom === true && trade.acceptedTo === true) {
            status.textContent = '🤝 Обе стороны подтвердили условия.';
            actions.appendChild(createButton('Завершить трейд', 'var(--jade)', completeTrade));
        } else if (isFrom && trade.acceptedFrom !== true) {
            status.textContent += ' Подтвердите встречное предложение, чтобы продолжить.';
            actions.appendChild(createButton('Подтвердить', 'var(--jade)', acceptTrade));
        } else if (isTo && trade.acceptedTo !== true) {
            actions.appendChild(createButton('Принять и зарезервировать предложение', 'var(--jade)', acceptTrade));
        } else {
            status.textContent += ' Ожидание подтверждения второй стороны.';
        }

        actions.appendChild(createButton('Отменить трейд', 'var(--ruby)', rejectTrade));
    }

    async function processExpiredTrades() {
        const result = await window.LootStarAPI.getMyTrades();
        let changed = false;
        for (const trade of result.trades || []) {
            if (isExpired(trade)) {
                const settled = await window.TradeService.expire(trade.id);
                changed = changed || settled.applied;
            }
        }
        if (changed) await refreshMyData();
    }

    async function expireTrade(tradeId) {
        if (expiryInProgress) return;
        expiryInProgress = true;
        try {
            const result = await window.TradeService.expire(tradeId);
            if (result.applied) await refreshMyData();
        } catch (error) {
            console.error('[trade] Auto-expiration failed:', error);
            showNotice(errorMessage(error), true);
        } finally {
            expiryInProgress = false;
        }
    }

    function loadExistingTrade(id) {
        currentTradeId = id;
        clearTimeout(expiryTimer);
        expiryTimer = null;
        expiryTimerDeadline = 0;
        $('stepViewTrade').style.display = 'block';
        const refresh = async () => {
            if (tradePollInProgress) return;
            tradePollInProgress = true;
            try {
                const result = await window.LootStarAPI.getTrade(id);
                currentTradeData = result.trade;
            } catch (error) {
                if (error?.code === 'TRADE_NOT_FOUND') {
                    $('viewStatus').textContent = 'Трейд не найден или удалён.';
                    return;
                }
                console.error('[trade] Trade load failed:', error);
                $('viewStatus').textContent = 'Не удалось загрузить трейд. Проверьте подключение и права доступа.';
                showNotice('Ошибка загрузки трейда.', true);
                return;
            } finally {
                tradePollInProgress = false;
            }
            if (currentTradeData.status === 'pending') {
                const deadline = getTradeExpiry(currentTradeData);
                if (expiryTimerDeadline !== deadline) {
                    clearTimeout(expiryTimer);
                    expiryTimer = null;
                    expiryTimerDeadline = deadline;
                    const remaining = deadline - Date.now();
                    expiryTimer = setTimeout(() => {
                        expiryTimer = null;
                        expiryTimerDeadline = 0;
                        expireTrade(id);
                    }, Math.max(0, remaining) + 50);
                }
            } else {
                clearTimeout(expiryTimer);
                expiryTimer = null;
                expiryTimerDeadline = 0;
            }
            if (!counterInitialized && currentTradeData.toUserId === myId) {
                counterItems = [];
                counterStars = 0;
                counterInitialized = true;
            }
            renderTradeView();
        };
        refresh();
        tradePollTimer = setInterval(refresh, 3000);
    }

    async function acceptTrade() {
        const buttons = $('viewActions').querySelectorAll('button');
        buttons.forEach(button => { button.disabled = true; });
        try {
            if (!currentTradeData || currentTradeData.status !== 'pending') throw new Error('TRADE_NOT_PENDING');
            let result;
            if (currentTradeData.fromUserId === myId) {
                result = await window.TradeService.acceptAsSender(currentTradeId);
            } else if (currentTradeData.toUserId === myId) {
                result = await window.TradeService.escrowCounterOffer(
                    currentTradeId,
                    myId,
                    counterItems.slice(),
                    counterStars
                );
                await refreshMyData();
            } else {
                throw new Error('TRADE_NOT_PARTICIPANT');
            }
            if (result.applied) {
                showNotice('Подтверждение сохранено.', false);
                await refreshTradeView();
            } else if (result.state !== 'already-accepted') showNotice('Трейд уже изменился.', true);
        } catch (error) {
            console.error('[trade] Accept failed:', error);
            showNotice(errorMessage(error), true);
        } finally {
            if (currentTradeData?.status === 'pending') renderTradeView();
        }
    }

    async function refreshTradeView() {
        const result = await window.LootStarAPI.getTrade(currentTradeId);
        currentTradeData = result.trade;
        renderTradeView();
    }

    async function rejectTrade() {
        const buttons = $('viewActions').querySelectorAll('button');
        buttons.forEach(button => { button.disabled = true; });
        try {
            const result = await window.TradeService.reject(currentTradeId, myId);
            if (result.applied) {
                const synced = await refreshMyData();
                const message = result.state === 'expired'
                    ? 'Срок истёк: активы возвращены владельцам.'
                    : 'Трейд отменён: активы возвращены владельцам.';
                showNotice(synced ? message : `${message} Перезагрузите страницу, чтобы обновить инвентарь.`, !synced);
            } else {
                showNotice('Трейд уже завершён или отменён.', true);
            }
        } catch (error) {
            console.error('[trade] Cancel failed:', error);
            showNotice(errorMessage(error), true);
            renderTradeView();
        }
    }

    async function completeTrade() {
        const buttons = $('viewActions').querySelectorAll('button');
        buttons.forEach(button => { button.disabled = true; });
        try {
            const result = await window.TradeService.complete(currentTradeId, myId);
            if (result.applied && result.state === 'completed') {
                const synced = await refreshMyData();
                showNotice(synced ? 'Трейд завершён. Средства получены.' : 'Трейд завершён, но данные не обновились. Перезагрузите страницу.', !synced);
            } else if (result.applied && result.state === 'expired') {
                const synced = await refreshMyData();
                showNotice(synced ? 'Срок трейда истёк: активы возвращены.' : 'Срок истёк. Перезагрузите страницу, чтобы обновить инвентарь.', true);
            } else {
                showNotice('Трейд уже изменился. Обновите страницу.', true);
            }
        } catch (error) {
            console.error('[trade] Completion failed:', error);
            showNotice(errorMessage(error), true);
            renderTradeView();
        }
    }

    async function sendTrade() {
        const button = $('btnSendTrade');
        button.disabled = true;
        button.textContent = 'Отправка…';
        try {
            if (!tradeParams.targetUserId || tradeParams.targetUserId === myId) {
                throw new Error('TRADE_INVALID_RECIPIENT');
            }
            const stars = Number(tradeParams.stars);
            if (!Number.isSafeInteger(stars) || stars < 0) throw new Error('TRADE_INVALID_AMOUNT');
            if (!tradeParams.selectedItems.length && stars === 0) throw new Error('TRADE_EMPTY_OFFER');

            const result = await window.LootStarAPI.createTradeOffer(
                tradeParams.targetUserId,
                tradeParams.selectedItems,
                stars
            );
            const synced = await refreshMyData();
            showNotice(synced ? 'Запрос отправлен. Активы зарезервированы на 24 часа.' : 'Запрос сохранён. Перезагрузите страницу, чтобы увидеть его.', !synced);
            setTimeout(() => { location.href = `?id=${encodeURIComponent(result.trade.id)}`; }, 700);
        } catch (error) {
            console.error('[trade] Send failed:', error);
            showNotice(errorMessage(error), true);
            button.disabled = false;
            button.textContent = 'Отправить запрос';
        }
    }

    async function initialize() {
        if (!window.LootStarAPI || !window.TradeService) {
            showPageError('Трейды доступны только авторизованным игрокам в Telegram.');
            return;
        }

        try {
            const user = await window.LootStarAPI.loadProfile();
            myId = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '');
            if (!myId || myId === 'undefined') throw new Error('TRADE_AUTH_REQUIRED');
            myName = String(user.first_name || window.TG?.getShortName?.() || 'Игрок');
            await window.BanCheck?.check?.();
            if (window.BanCheck?.isBanned?.()) {
                showPageError('Трейды недоступны для заблокированного аккаунта.');
                return;
            }

            await ensureInventoryIds();
            await refreshMyData();
            await processExpiredTrades();

            const tradeId = new URLSearchParams(location.search).get('id');
            if (tradeId) {
                loadExistingTrade(tradeId);
                return;
            }

            const pending = await window.LootStarAPI.getMyTrades();
            const outgoing = (pending.trades || []).find(trade => trade.fromUserId === myId);
            if (outgoing) {
                location.href = `?id=${encodeURIComponent(outgoing.id)}`;
                return;
            }

            $('stepSelectUser').style.display = 'block';
            $('usersList').textContent = 'Введите имя или @юзернейм для поиска.';
        } catch (error) {
            console.error('[trade] Initialization failed:', error);
            showPageError(errorMessage(error));
        }
    }

    $('searchUser').addEventListener('input', event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchUsers(event.target.value), 250);
    });
    $('resetTradeBtn').addEventListener('click', () => { location.href = 'index.html'; });
    $('starsSlider').addEventListener('input', event => setStars(event.target.value, 'slider'));
    $('starsInput').addEventListener('input', event => setStars(event.target.value, 'input'));
    $('counterStarsSlider').addEventListener('input', event => setCounterStars(event.target.value, 'slider'));
    $('counterStarsInput').addEventListener('input', event => setCounterStars(event.target.value, 'input'));
    $('btnSendTrade').addEventListener('click', sendTrade);
    window.addEventListener('beforeunload', () => {
        clearTimeout(expiryTimer);
        clearInterval(tradePollTimer);
    });
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();