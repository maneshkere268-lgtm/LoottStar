// shared/referral.js — реферальная система LootStar
// Подключать ПОСЛЕ config.js, auth.js и api.js, но ДО скриптов страниц.
//
// ⚠️ Перед использованием впиши сюда username своего бота и short_name
//    мини-аппы — без них реферальная ссылка не будет открывать именно
//    вашу Mini App.
(function () {
    const BOT_USERNAME = 'lootstar_gamebot';   // ЗАМЕНИ на username бота без @
    const APP_SHORT_NAME = 'app';             // ЗАМЕНИ на short_name Mini App

    const LS_MY_CODE = 'lootref_myCode';
    const LS_REFERRED_BY = 'lootref_referredBy';
    const LS_REFERRAL_JOINS = 'lootref_myJoinsCount';   // cached count before the API response
    const LS_SHARE_TOKEN = 'lootref_lastShareAt';        // когда последний раз жали "отправить другу"

    function tg() { return window.Telegram && window.Telegram.WebApp; }

    function randomCode(len = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    function getMyId() {
        try {
            const u = tg()?.initDataUnsafe?.user;
            if (u && u.id) return String(u.id);
        } catch (e) {}
        return null;
    }

    // Стабильный реф-код для текущего пользователя: если известен Telegram id —
    // используем его напрямую (проще всего сопоставлять на бэкенде), иначе
    // генерируем и запоминаем случайный код в localStorage.
    function getMyCode() {
        const tgId = getMyId();
        if (tgId) return tgId;
        let code = localStorage.getItem(LS_MY_CODE);
        if (!code) {
            code = randomCode();
            localStorage.setItem(LS_MY_CODE, code);
        }
        return code;
    }

    function getMyLink() {
        return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=ref_${getMyCode()}`;
    }

    // ── Приём реферала при заходе по ссылке друга ──
    // Telegram кладёт параметр запуска в initDataUnsafe.start_param.
    // Для локальной отладки в обычном браузере поддерживаем ?startapp=ref_XXX в URL.
    function getStartParam() {
        try {
            const sp = tg()?.initDataUnsafe?.start_param;
            if (sp) return sp;
        } catch (e) {}
        const url = new URLSearchParams(location.search);
        return url.get('startapp') || url.get('tgWebAppStartParam') || null;
    }

    async function captureReferralFromStart() {
        const start = getStartParam();
        if (!start || !start.startsWith('ref_')) return;
        const refCode = start.slice(4);
        const myCode = getMyCode();
        if (refCode === myCode) return; // сам себя не реферишь
        if (!/^[1-9]\d{0,19}$/.test(refCode)) return;
        try {
            if (!window.LootStarAPI?.joinReferral) throw new Error('REFERRAL_API_UNAVAILABLE');
            const result = await window.LootStarAPI.joinReferral(refCode);
            localStorage.setItem(LS_REFERRED_BY, result.referredBy);
        } catch (error) {
            console.warn('[referral] failed to register referred user:', error);
        }
    }

    // ── Кнопка "Отправить другу" ──
    // Открывает системный шаринг Telegram с готовой ссылкой и текстом.
    // Telegram не даёт колбэк "друг реально получил сообщение", поэтому
    // разблокировка Free Case происходит оптимистично — по факту нажатия
    // на отправку (см. freecase.js), а реальные переходы по ссылке
    // учитываются сервером отдельно.
    function shareToFriend(text) {
        const link = getMyLink();
        const shareText = text || '🎁 Залетай в LootStar — там крутые кейсы и подарки! Забирай бонус по моей ссылке:';
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;

        localStorage.setItem(LS_SHARE_TOKEN, String(Date.now()));

        const t = tg();
        if (t?.openTelegramLink) {
            t.openTelegramLink(shareUrl);
        } else if (navigator.share) {
            navigator.share({ title: 'LootStar', text: shareText, url: link }).catch(() => {});
        } else {
            navigator.clipboard?.writeText(link);
            window.open(shareUrl, '_blank');
        }
    }

    function hasSharedRecently(withinMs) {
        const t = parseInt(localStorage.getItem(LS_SHARE_TOKEN) || '0', 10);
        if (!t) return false;
        return withinMs ? (Date.now() - t) <= withinMs : true;
    }

    function getLocalJoinsCount() {
        return parseInt(localStorage.getItem(LS_REFERRAL_JOINS) || '0', 10);
    }

    function watchJoinsCount(cb) {
        let active = true;
        const refresh = async () => {
            try {
                if (!window.LootStarAPI?.getReferralProfile) throw new Error('REFERRAL_API_UNAVAILABLE');
                const profile = await window.LootStarAPI.getReferralProfile();
                if (!active) return;
                cb(Number(profile.joinedCount) || 0);
                if (profile.referredBy) localStorage.setItem(LS_REFERRED_BY, profile.referredBy);
            } catch (error) {
                console.warn('[referral] failed to load referral profile:', error);
                if (active) cb(getLocalJoinsCount());
            }
        }
        refresh();
        const interval = window.setInterval(refresh, 30_000);
        return () => {
            active = false;
            window.clearInterval(interval);
        };
    }

    captureReferralFromStart();

    window.LootRef = {
        getMyCode,
        getMyLink,
        shareToFriend,
        hasSharedRecently,
        getLocalJoinsCount,
        watchJoinsCount,
        getReferredBy: () => localStorage.getItem(LS_REFERRED_BY)
    };
})();