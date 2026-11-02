(function () {
    'use strict';

    const soundFiles = {
        error: '/sounds/error.mp3',
        sell: '/sounds/sell.wav'
    };
    const playing = new Map();
    let soundErrorLogged = false;

    function stopLootSound(name) {
        const audio = playing.get(name);
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        playing.delete(name);
    }

    function playLootSound(name) {
        const src = soundFiles[name];
        if (!src) return;

        stopLootSound(name);
        const audio = new Audio(src);
        audio.volume = 0.65;
        playing.set(name, audio);
        audio.addEventListener('ended', () => {
            if (playing.get(name) === audio) playing.delete(name);
        }, { once: true });
        audio.play().catch(error => {
            if (!soundErrorLogged) {
                console.warn('[sounds] Could not play sound. Check that the sound files exist in /sounds/.', error);
                soundErrorLogged = true;
            }
            if (playing.get(name) === audio) playing.delete(name);
        });
    }

    window.playLootSound = playLootSound;
    window.stopLootSound = stopLootSound;
    if (typeof window.showToast === 'function') {
        const originalShowToast = window.showToast;
        window.showToast = function (message, type, ...args) {
            const text = String(message || '');
            const toastType = type || 'ok';
            if (toastType === 'err') playLootSound('error');
            else if (/продан|продано|продана|sold/i.test(text)) playLootSound('sell');
            return originalShowToast.call(this, message, type, ...args);
        };
    }

})();
