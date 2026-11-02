// shared/trade_notifier.js
(function() {
    'use strict';

    let tradeServicePromise = null;

    function notify(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else if (type === 'err') {
            window.alert(message);
        } else {
            console.info('[TradeNotifier]', message);
        }
    }

    function initNotifier() {
        if (!window.LootStarAPI) {
            return setTimeout(initNotifier, 500);
        }
        const myDocId = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '');
        if (!myDocId) return;
        let currentTradeId = null;
        let expiryTimer = null;
        let polling = false;
        const refresh = async () => {
            if (polling) return;
            polling = true;
            try {
                const result = await window.LootStarAPI.getMyTrades();
                const trades = (result.trades || [])
                    .filter(trade => trade.toUserId === myDocId && trade.status === 'pending')
                    .sort((a, b) => b.createdAt - a.createdAt);
                clearTimeout(expiryTimer);
                const now = Date.now();
                const expiryOf = trade => Number(trade.expiresAt) ||
                    (Number(trade.createdAt) || now) + 24 * 60 * 60 * 1000;
                const expired = trades.filter(trade => expiryOf(trade) <= now);
                const active = trades.filter(trade => expiryOf(trade) > now);
                if (expired.length) {
                    const service = await loadTradeService();
                    await Promise.all(expired.map(trade => service.expire(trade.id)));
                }
                if (!active.length) {
                    removeBanner();
                    currentTradeId = null;
                    return;
                }
                const nextExpiry = Math.min(...active.map(expiryOf));
                expiryTimer = setTimeout(async () => {
                    try {
                        const service = await loadTradeService();
                        await Promise.all(active.filter(trade => expiryOf(trade) <= Date.now())
                            .map(trade => service.expire(trade.id)));
                        await refresh();
                    } catch (error) {
                        console.error('[TradeNotifier] Не удалось автоматически закрыть просроченный трейд:', error);
                        notify('Не удалось автоматически закрыть просроченный трейд.', 'err');
                    }
                }, Math.max(1, nextExpiry - now + 50));
                const trade = active[0];
                if (currentTradeId !== trade.id) {
                    currentTradeId = trade.id;
                    showBanner(trade, myDocId);
                }
            } catch (error) {
                console.error('[TradeNotifier] Не удалось загрузить входящие трейды:', error);
            } finally {
                polling = false;
            }
        };
        refresh();
        setInterval(refresh, 15000);
    }

    function loadTradeService() {
        if (window.TradeService) return Promise.resolve(window.TradeService);
        if (tradeServicePromise) return tradeServicePromise;

        tradeServicePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/shared/trade_service.js';
            script.onload = () => resolve(window.TradeService);
            script.onerror = () => reject(new Error('TRADE_SERVICE_LOAD_FAILED'));
            document.head.appendChild(script);
        });
        return tradeServicePromise;
    }

    function showBanner(trade, actorId) {
        removeBanner();

        const banner = document.createElement('div');
        banner.id = 'tradeNotificationBanner';
        banner.style.cssText = `
            position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
            width: calc(100% - 28px); max-width: 500px; background: var(--panel-2);
            border: 1px solid var(--amber); border-radius: 16px; padding: 10px 14px;
            display: flex; align-items: center; gap: 12px; z-index: 10000;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6), 0 0 20px rgba(232,148,74,0.2);
            animation: slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        banner.innerHTML = `
            <div id="tradeLottie" style="width: 44px; height: 44px; flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(232,148,74,0.5));"></div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 13px; font-weight: 800; color: #fff; margin-bottom: 2px;">Запрос на трейд</div>
                <div style="font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    От <b>${window.escapeHtml(trade.fromUsername || 'Игрок')}</b>
                </div>
            </div>
            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <button id="tradeBtnAccept" style="background: var(--jade); color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-weight: 800; font-size: 11px; cursor: pointer; transition: 0.2s;">Принять</button>
                <button id="tradeBtnReject" style="background: rgba(228,83,107,0.15); color: #FFB0BC; border: 1px solid rgba(228,83,107,0.3); border-radius: 8px; padding: 8px 12px; font-weight: 800; font-size: 11px; cursor: pointer; transition: 0.2s;">✕</button>
            </div>
        `;

        document.body.appendChild(banner);

        if (window.lottie) {
            lottie.loadAnimation({
                container: document.getElementById('tradeLottie'),
                renderer: 'svg', loop: true, autoplay: true,
                path: 'https://cdn.changes.tg/gifts/models/Resistance%20Dog/lottie/Original.json'
            });
        }

        document.getElementById('tradeBtnAccept').onclick = () => {
            window.location.href = `/trade/index.html?id=${encodeURIComponent(trade.id)}`;
        };

        document.getElementById('tradeBtnReject').onclick = async () => {
            const btn = document.getElementById('tradeBtnReject');
            btn.textContent = '...';
            try {
                const service = await loadTradeService();
                if (!service) throw new Error('TRADE_SERVICE_UNAVAILABLE');
                const result = await service.reject(trade.id, actorId);
                if (result.applied) {
                    await window.LootStarAPI.loadProfile();
                    currentTradeId = null;
                    removeBanner();
                    notify(result.state === 'expired' ? 'Срок трейда истёк; активы возвращены владельцам.' : 'Трейд отклонён; активы возвращены владельцам.', 'ok');
                } else {
                    window.location.href = `/trade/index.html?id=${encodeURIComponent(trade.id)}`;
                }
            } catch (e) {
                console.error('[TradeNotifier] Ошибка при отклонении:', e);
                notify('Не удалось отменить трейд', 'err');
                btn.textContent = '✕';
            }
        };
    }

    function removeBanner() {
        const existing = document.getElementById('tradeNotificationBanner');
        if (existing) existing.remove();
    }

    if (!document.getElementById('tradeAnimStyles')) {
        const style = document.createElement('style');
        style.id = 'tradeAnimStyles';
        style.textContent = `@keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }`;
        document.head.appendChild(style);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNotifier);
    } else {
        initNotifier();
    }
})();