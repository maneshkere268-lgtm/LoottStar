// shared/events.js — Удача и Блессинг
(function () {
    'use strict';

    const EVENT_ICONS = {
        luck2: '/shared/2luck.png',
        luck4: '/shared/4luck.png',
        blessing: '/shared/blessing.png'
    };

    const BLESSING_CHANCE = 0.3;

    window.ActiveEvents = {
        luck: 1,
        blessing: false,
        luckEndTime: 0,
        blessingEndTime: 0,
        luckIcon: null,
        luckLabel: null
    };

    let timerInterval = null;
    let configInterval = null;
    let initialized = false;
    let widget = null;
    let widgetSignature = '';

    function readLocal() {
        try { return JSON.parse(localStorage.getItem('localEvents') || '{}'); }
        catch (e) { return {}; }
    }

    function writeLocal(data) {
        try { localStorage.setItem('localEvents', JSON.stringify(data || {})); }
        catch (e) {}
    }

    function init() {
        if (initialized) return;
        initialized = true;
        applyEvents(readLocal());
        if (window.TG?.isTelegram) {
            syncConfig();
            configInterval = window.setInterval(syncConfig, 30_000);
        }

        window.addEventListener('storage', (e) => {
            if (e.key === 'localEvents') {
                try { applyEvents(JSON.parse(e.newValue || '{}')); }
                catch (err) { console.warn('[events] local cache parse failed:', err); }
            }
        });

        document.addEventListener('visibilitychange', renderWidget);
        window.addEventListener('beforeunload', () => {
            if (timerInterval) clearInterval(timerInterval);
            if (configInterval) clearInterval(configInterval);
        });
    }

    async function syncConfig() {
        try {
            if (!window.LootStarAPI?.getEventConfig) throw new Error('EVENT_CONFIG_API_UNAVAILABLE');
            const config = await window.LootStarAPI.getEventConfig();
            const events = config.events && typeof config.events === 'object' ? config.events : {};
            const halloween = config.halloween && typeof config.halloween === 'object'
                ? config.halloween : {};
            writeLocal(events);
            applyEvents(events);
            window.dispatchEvent(new CustomEvent('eventsConfigLoaded', { detail: { halloween } }));
        } catch (error) {
            console.warn('[events] PostgreSQL config sync failed:', error);
        }
    }

    function applyEvents(data) {
        const now = Date.now();

        let activeLuck = 1;
        let luckEndTime = 0;
        let luckIcon = null;
        let luckLabel = null;

        // Кастомная удача (приоритет выше стандартных)
        if (data.customLuck && data.customLuck.endTime && now < data.customLuck.endTime) {
            const m = Number(data.customLuck.multiplier);
            if (Number.isFinite(m) && m > 1) {
                activeLuck = m;
                luckEndTime = data.customLuck.endTime;
                luckIcon = data.customLuck.icon || null;
                luckLabel = data.customLuck.label || `x${m} Luck`;
            }
        }

        if (activeLuck === 1) {
            const l2 = data.luck2EndTime && now < data.luck2EndTime;
            const l4 = data.luck4EndTime && now < data.luck4EndTime;
            if (l2) { activeLuck = 2; luckEndTime = data.luck2EndTime; luckIcon = EVENT_ICONS.luck2; luckLabel = 'x2 Luck'; }
            if (l4) { activeLuck = 4; luckEndTime = data.luck4EndTime; luckIcon = EVENT_ICONS.luck4; luckLabel = 'x4 Luck'; }
        }

        const blessingActive = !!(data.blessingEndTime && now < data.blessingEndTime);

        window.ActiveEvents.luck = activeLuck;
        window.ActiveEvents.luckEndTime = luckEndTime;
        window.ActiveEvents.luckIcon = luckIcon;
        window.ActiveEvents.luckLabel = luckLabel;
        window.ActiveEvents.blessing = blessingActive;
        window.ActiveEvents.blessingEndTime = blessingActive ? data.blessingEndTime : 0;

        renderWidget();
    }

    function renderWidget() {
        const now = Date.now();

        if (window.ActiveEvents.luck > 1 && window.ActiveEvents.luckEndTime <= now) {
            window.ActiveEvents.luck = 1;
            window.ActiveEvents.luckEndTime = 0;
            window.ActiveEvents.luckIcon = null;
            window.ActiveEvents.luckLabel = null;
        }
        if (window.ActiveEvents.blessing && window.ActiveEvents.blessingEndTime <= now) {
            window.ActiveEvents.blessing = false;
            window.ActiveEvents.blessingEndTime = 0;
        }

        const active = [];
        if (window.ActiveEvents.blessing) {
            active.push({
                id: 'blessing',
                icon: EVENT_ICONS.blessing,
                title: 'Blessing',
                endTime: window.ActiveEvents.blessingEndTime
            });
        }
        if (window.ActiveEvents.luck > 1) {
            active.push({
                id: 'luck',
                icon: window.ActiveEvents.luckIcon
                    || (window.ActiveEvents.luck === 4 ? EVENT_ICONS.luck4 : EVENT_ICONS.luck2),
                title: window.ActiveEvents.luckLabel || `x${window.ActiveEvents.luck}`,
                endTime: window.ActiveEvents.luckEndTime
            });
        }

        if (!widget && active.length) {
            widget = document.createElement('div');
            widget.id = 'eventsWidget';
            document.body.appendChild(widget);
        }
        if (!widget) {
            return;
        }

        if (!active.length) {
            widget.style.display = 'none';
            widgetSignature = '';
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            return;
        }

        const signature = active.map(event => `${event.id}:${event.icon}:${event.title}`).join('|');
        if (signature !== widgetSignature) {
            widget.replaceChildren();
            active.forEach(event => {
                const item = document.createElement('div');
                item.className = 'event-item';
                item.title = event.title;

                const icon = document.createElement('img');
                icon.src = event.icon;
                icon.alt = event.title;

                const time = document.createElement('span');
                time.className = 'event-time';

                item.append(icon, time);
                widget.appendChild(item);
            });
            widgetSignature = signature;
        }
        widget.style.display = 'flex';

        if (document.visibilityState === 'visible') {
            [...widget.querySelectorAll('.event-time')].forEach((time, index) => {
                time.textContent = formatTime(Math.max(0, active[index].endTime - now));
            });
        }

        if (document.visibilityState === 'visible' && !timerInterval) {
            timerInterval = setInterval(renderWidget, 1000);
        } else if (document.visibilityState !== 'visible' && timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    window.Events = {
        init,
        getLuck: () => window.ActiveEvents.luck,
        isBlessing: () => window.ActiveEvents.blessing,
        tryBlessing: function () {
            if (!window.ActiveEvents.blessing) return false;
            return Math.random() < BLESSING_CHANCE;
        }
    };

    document.addEventListener('DOMContentLoaded', init);
})();