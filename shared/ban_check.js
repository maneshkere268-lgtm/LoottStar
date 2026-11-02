// shared/ban_check.js — проверка бана + per-mode тех. работ
(function () {
    'use strict';

    const MODE_MAP = {
        '/cases': 'cases', '/mines': 'mines', '/crash': 'crash', '/plinko': 'plinko',
        '/bags': 'bags', '/slots': 'slots', '/craft': 'craft', '/upgrades': 'upgrades'
    };

    const LOTTIE_BAN = 'https://cdn.changes.tg/gifts/models/Stellar%20Rocket/lottie/Fireworks.json';
    const LOTTIE_TECH = 'https://cdn.changes.tg/gifts/models/Stellar%20Rocket/lottie/First%20Step.json';

    let shown = false;
    let mode = 'misc';

    function detectMode() {
        const path = location.pathname;
        for (const k of Object.keys(MODE_MAP)) {
            if (path.includes(k + '/')) return MODE_MAP[k];
        }
        return 'misc';
    }
    mode = detectMode();

    function fmtLeft(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h}ч ${m}м ${s}с`;
        if (m > 0) return `${m}м ${s}с`;
        return `${s}с`;
    }

    function showBanScreen(reason, until) {
        if (shown) return;
        shown = true;

        const timerHtml = until > 0
            ? `<div class="ban-timer" id="banTimer">До разблокировки: <b>${fmtLeft(until - Date.now())}</b></div>`
            : '';

        document.body.innerHTML = `
            <div class="ban-screen" style="position:fixed;inset:0;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:20px;text-align:center;background:radial-gradient(circle at 50% 40%,#4a0a0a 0%,#2a0a0a 60%,#0a0202 100%);">
                <div class="ban-lottie" id="banLottieBox" style="width:260px;height:260px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 40px rgba(228,83,107,.5));"></div>
                <div class="ban-title" style="font-size:32px;font-weight:700;color:#ff5555;letter-spacing:1px;text-shadow:0 0 30px rgba(228,83,107,.7);">ВЫ ЗАБАНЕНЫ</div>
                <div class="ban-reason" style="font-size:15px;color:rgba(255,255,255,.75);max-width:480px;line-height:1.5;padding:12px 20px;background:rgba(0,0,0,.35);border-radius:12px;border:1px solid rgba(255,255,255,.1);">${escapeHtml(reason || 'Нарушение правил')}</div>
                ${timerHtml}
            </div>`;

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        if (window.lottie) {
            const box = document.getElementById('banLottieBox');
            try {
                lottie.loadAnimation({ container: box, renderer: 'svg', loop: true, autoplay: true, path: LOTTIE_BAN });
            } catch (e) {}
        }

        if (until > 0) {
            setInterval(() => {
                const el = document.getElementById('banTimer');
                if (!el) return;
                const left = until - Date.now();
                if (left <= 0) { location.reload(); return; }
                el.innerHTML = `До разблокировки: <b>${fmtLeft(left)}</b>`;
            }, 1000);
        }
    }

    function showTechScreen() {
        if (shown) return;
        shown = true;

        document.body.innerHTML = `
            <div class="ban-screen tech" style="position:fixed;inset:0;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:20px;text-align:center;background:radial-gradient(circle at 50% 40%,#1a0d3a 0%,#0d0a18 60%,#050308 100%);">
                <div class="ban-lottie" id="techLottieBox" style="width:260px;height:260px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 40px rgba(155,134,240,.5));"></div>
                <div class="ban-title" style="font-size:32px;font-weight:700;color:#b8a6ff;letter-spacing:1px;text-shadow:0 0 30px rgba(155,134,240,.7);">РЕЖИМ НА ТЕХ. РАБОТАХ</div>
                <div class="ban-reason" style="font-size:15px;color:rgba(255,255,255,.75);max-width:480px;line-height:1.5;padding:12px 20px;background:rgba(0,0,0,.35);border-radius:12px;border:1px solid rgba(255,255,255,.1);">Скоро вернёмся. Спасибо за терпение!</div>
                <a class="ban-btn" href="/index.html" style="display:inline-block;padding:14px 32px;border-radius:14px;background:linear-gradient(135deg,#9B86F0,#7C5FE0);color:#fff;font-family:inherit;font-size:15px;font-weight:800;text-decoration:none;box-shadow:0 8px 24px rgba(155,134,240,.4);"></a>
            </div>`;

        if (window.lottie) {
            const box = document.getElementById('techLottieBox');
            try {
                lottie.loadAnimation({ container: box, renderer: 'svg', loop: true, autoplay: true, path: LOTTIE_TECH });
            } catch (e) {}
        }
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = String(s || '');
        return d.innerHTML;
    }

    /* ═══════════════════════════════════════════════════════════
     * CHECK — главная функция
     * ═══════════════════════════════════════════════════════════ */
    async function check() {
        if (window.TG?.isTelegram && window.LootStarAPI?.loadProfile) {
            try {
                await window.LootStarAPI.loadProfile();
            } catch (error) {
                console.error('[ban_check] API profile check failed:', error);
            }
        }

        const banned = localStorage.getItem('userBanned') === '1';
        const until = parseInt(localStorage.getItem('userBanUntil') || '0');
        if (banned) {
            if (until > 0 && until <= Date.now()) {
                localStorage.removeItem('userBanned');
                localStorage.removeItem('userBanReason');
                localStorage.removeItem('userBanUntil');
            } else {
                showBanScreen(localStorage.getItem('userBanReason') || 'Нарушение правил', until);
                return;
            }
        }

        if (mode !== 'misc') {
            try {
                const config = await window.LootStarAPI.getAppConfig('tech');
                if (config.tech?.[mode] === true) {
                    showTechScreen();
                    return;
                }
            } catch (error) {
                console.error('[ban_check] API maintenance check failed:', error);
            }
        }
    }

    /* ═══════════════════════════════════════════════════════════
     * Серверный профиль — единственный источник статуса блокировки
     * ═══════════════════════════════════════════════════════════ */
    window.addEventListener('playerBanned', (e) => {
        const { reason, until } = e.detail || {};
        showBanScreen(reason, until || 0);
    });

    window.BanCheck = {
        check,
        mode,
        isBanned: () => shown || localStorage.getItem('userBanned') === '1'
    };
    window.Manipulation = {
        get BAN_REASON() {
            return localStorage.getItem('userBanReason') || 'Нарушение правил';
        },
        isBanned: () => localStorage.getItem('userBanned') === '1',
        checkAndAutoUnban: () => window.LootStarAPI?.loadProfile()
    };

    // Load the authoritative status after Telegram WebApp initialization.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(check, 300));
    } else {
        setTimeout(check, 300);
    }
})();