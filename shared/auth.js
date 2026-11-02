// auth.js — Telegram WebApp авторизация
// Подключать ВТОРЫМ (после config.js).

(function () {
    'use strict';

    const STORAGE_KEYS = {
        userId: 'userId',
        userName: 'userName',
        userPhoto: 'userPhoto'
    };

    let tgUser = null;
    let tgWebApp = null;

    // ── Инициализация Telegram WebApp ──
    if (window.Telegram && window.Telegram.WebApp) {
        tgWebApp = window.Telegram.WebApp;
        tgUser = tgWebApp.initDataUnsafe?.user || null;

        try {
            tgWebApp.expand();
            tgWebApp.ready();
            if (tgWebApp.isVersionAtLeast?.('6.1')) {
                tgWebApp.setHeaderColor?.('#0A0A0C');
                tgWebApp.setBackgroundColor?.('#0A0A0C');
            }
        } catch (e) {}
    }

    // ── Fallback для отладки вне Telegram ──
    // TODO: server-side validation — заменить на Cloud Function при продакшене
    if (!tgUser) {
        const savedId = localStorage.getItem(STORAGE_KEYS.userId);
        if (savedId && savedId !== 'guest' && !savedId.startsWith('guest_')) {
            tgUser = {
                id: savedId,
                username: '',
                first_name: localStorage.getItem(STORAGE_KEYS.userName) || 'Игрок',
                photo_url: localStorage.getItem(STORAGE_KEYS.userPhoto) || ''
            };
        } else {
            tgUser = {
                id: 'guest_' + Math.random().toString(36).slice(2, 10),
                username: '',
                first_name: 'Гость',
                photo_url: ''
            };
            console.debug('[auth] Telegram unavailable; using guest mode');
        }
    }

    function getUserDisplayName() {
        if (!tgUser) return 'Username';
        let n = tgUser.first_name || 'Игрок';
        if (tgUser.last_name) n += ' ' + tgUser.last_name;
        return n;
    }

    function getUserShortName() {
        if (!tgUser) return 'Username';
        return tgUser.first_name || tgUser.username || 'Игрок';
    }

    function getUserInitial() {
        return (getUserShortName()[0] || 'U').toUpperCase();
    }

    function getUserPhoto() {
        return tgUser?.photo_url || null;
    }

    function persistUser() {
        localStorage.setItem(STORAGE_KEYS.userId, String(tgUser.id));
        localStorage.setItem(STORAGE_KEYS.userName, getUserDisplayName());
        if (tgUser.photo_url) {
            localStorage.setItem(STORAGE_KEYS.userPhoto, tgUser.photo_url);
        }
    }

    // ── Обновление UI в хедере и профиле ──
    function updateHeaderUI() {
        const nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = getUserShortName();

        const avatarEl = document.getElementById('userAvatar');
        if (avatarEl) {
            const photo = getUserPhoto();
            if (photo) {
                avatarEl.src = photo;
                avatarEl.alt = getUserShortName();
                avatarEl.onerror = function () {
                    this.onerror = null;
                    this.src = window.STAR_ICON;
                };
            } else {
                avatarEl.src = window.STAR_ICON;
            }
        }

        const profileAvatar = document.getElementById('profileAvatar');
        if (profileAvatar) {
            const photo = getUserPhoto();
            if (photo) {
                profileAvatar.innerHTML = `<img src="${photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.onerror=null;this.parentNode.textContent='${getUserInitial()}'">`;
            } else {
                profileAvatar.textContent = getUserInitial();
            }
        }
        const profileName = document.getElementById('profileName');
        if (profileName) profileName.textContent = getUserDisplayName();

        const profileId = document.getElementById('profileId');
        if (profileId) profileId.textContent = 'ID: ' + tgUser.id;
    }

    function pinSiteHeader() {
        const header = document.querySelector('body > header, body > .idx-header');
        if (!header || header.dataset.pinned === 'true') return;

        const spacer = document.createElement('div');
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.flex = '0 0 auto';
        header.parentNode.insertBefore(spacer, header);
        header.dataset.pinned = 'true';

        const syncHeight = () => {
            const marginTop = parseFloat(getComputedStyle(header).marginTop) || 0;
            spacer.style.height = `${header.getBoundingClientRect().height + marginTop}px`;
        };
        syncHeight();

        if ('ResizeObserver' in window) {
            new ResizeObserver(syncHeight).observe(header);
        } else {
            window.addEventListener('resize', syncHeight);
        }
    }

    persistUser();

    window.TG = {
        user: tgUser,
        webApp: tgWebApp,
        id: tgUser.id,
        isTelegram: !!tgWebApp,
        getName: getUserDisplayName,
        getShortName: getUserShortName,
        getInitial: getUserInitial,
        getPhoto: getUserPhoto,
        updateHeaderUI
    };

    document.addEventListener('DOMContentLoaded', () => {
        updateHeaderUI();
        pinSiteHeader();
    });
})();