/* shared/loading.js
 * Подключать ПЕРВЫМ скриптом в <body>, ДО остальных модулей и скриптов страницы:
 *
 *   <body>
 *     <script src="/shared/loading.js"></script>
 *     ... остальная разметка страницы ...
 *
 * Что делает:
 *  1) Сразу (синхронно, в момент выполнения) рисует чёрный оверлей на весь
 *     экран с логотипом (/shared/logo.png) поверх всего остального контента,
 *     чтобы пользователь не видел "недогруженную" страницу.
 *  2) Разворачивает Telegram Mini App на весь экран (expand + requestFullscreen,
 *     если бот-платформа их поддерживает).
 *  3) Держит оверлей ровно 5 секунд, затем плавно скрывает (fade-out 400мс)
 *     и удаляет из DOM.
 *
 * Никакой разметки в HTML добавлять не нужно — всё создаётся этим скриптом.
 */
(function () {
    const SPLASH_MS = 750;   // время показа заставки
    const FADE_MS = 350;      // длительность затухания

    function expandTelegram() {
        try {
            const tg = window.Telegram && window.Telegram.WebApp;
            if (!tg) return;
            tg.ready?.();
            tg.expand?.();
            if (tg.isVersionAtLeast?.('8.0')) tg.requestFullscreen?.();
            if (tg.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes?.();
        } catch (e) { /* платформа не поддерживает — просто игнорируем */ }
    }

    function buildOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'appLoadingOverlay';
        overlay.innerHTML = `
            <style>
                #appLoadingOverlay {
                    position: fixed;
                    inset: 0;
                    z-index: 999999;
                    background: #000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-direction: column;
                    gap: 18px;
                    transition: opacity ${FADE_MS}ms ease;
                }
                #appLoadingOverlay.fade-out { opacity: 0; pointer-events: none; }
                #appLoadingOverlay img {
                    width: 96px;
                    height: 96px;
                    object-fit: contain;
                    border-radius: 24px;
                    animation: appLoadingPulse 1.4s ease-in-out infinite;
                }
                #appLoadingOverlay .app-loading-spinner {
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    border: 3px solid rgba(245,197,24,.18);
                    border-top-color: #F5C518;
                    animation: appLoadingSpin .8s linear infinite;
                }
                @keyframes appLoadingPulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50%      { transform: scale(1.08); opacity: .85; }
                }
                @keyframes appLoadingSpin {
                    to { transform: rotate(360deg); }
                }
            </style>
            <img src="/shared/logo.png" alt="LootStar" onerror="this.style.display='none'">
            <div class="app-loading-spinner"></div>
        `;
        return overlay;
    }

    function mountOverlay() {
        const overlay = buildOverlay();
        // Вставляем как можно раньше — если <body> ещё не существует
        // (скрипт в <head>), ждём его появления через MutationObserver.
        if (document.body) {
            document.body.appendChild(overlay);
        } else {
            document.documentElement.appendChild(overlay);
        }
        return overlay;
    }

    function removeOverlay(overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), FADE_MS + 50);
    }

    // Разворачиваем Mini App сразу, не дожидаясь окончания заставки.
    expandTelegram();
    // На случай, если Telegram WebApp скрипт подключается позже — пробуем ещё раз
    // после полной загрузки страницы.
    window.addEventListener('load', expandTelegram);

    const overlay = mountOverlay();
    setTimeout(() => removeOverlay(overlay), SPLASH_MS);
})();