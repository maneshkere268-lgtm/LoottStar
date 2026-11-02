// crash.js — Краш (звёзды + серебро)
const $ = id => document.getElementById(id);
const BET_PHASE_SECONDS = 7;
const MIN_BET = 25;

let state = {
    currency: 'star',
    ready: false,
    phase: 'waiting',
    multiplier: 1.00,
    crashPoint: 1.00,
    timer: BET_PHASE_SECONDS,
    myBet: null,
    bots: [],
    history: [],
    raf: null,
    bettingTimer: null,
    crashPollTimer: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();

    const historyRaw = localStorage.getItem('crashHistory');
    if (historyRaw) { try { state.history = JSON.parse(historyRaw) || []; } catch(e){} }

    setupCurrencySwitch();
    buildStars();
    renderHistory();
    updateMainBtn();
    try {
        await window.LootStarAPI.loadProfile();
        const { game } = await window.LootStarAPI.getCurrentCrash();
        state.ready = true;
        window.refreshCurrencyUI();
        if (game) restoreCrashGame(game);
        else startBettingPhase();
    } catch (error) {
        console.error('[crash] failed to initialize:', error);
        showToast('Не удалось подключиться к игровому серверу', 'err');
    }
}

function setupCurrencySwitch() {
    window.renderCurrencySwitch($('curSwitch'), state.currency, (cur) => {
        state.currency = cur;
        updateMainBtn();
    });
}

function saveHistory() {
    localStorage.setItem('crashHistory', JSON.stringify(state.history.slice(0, 20)));
}

function buildStars() {
    const f = $('starsField');
    if (!f) return;
    const colors = ['', 'gold', 'blue', 'green'];
    let h = '';
    for (let i = 0; i < 80; i++) {
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const d = Math.random() * 2 + 0.8;
        const c = colors[Math.floor(Math.random() * colors.length)];
        const dur = (2 + Math.random() * 3).toFixed(2);
        const delay = (Math.random() * 3).toFixed(2);
        const cls = [c, d > 2.2 ? 'big' : ''].filter(Boolean).join(' ');
        h += `<span class="${cls}" style="left:${x}%;top:${y}%;width:${d}px;height:${d}px;animation-duration:${dur}s;animation-delay:${delay}s;"></span>`;
    }
    for (let i = 0; i < 3; i++) {
        const x = 30 + Math.random() * 70;
        const y = Math.random() * 30;
        h += `<div class="shooting-star" style="left:${x}%;top:${y}%;animation-delay:${(Math.random() * 6).toFixed(2)}s;"></div>`;
    }
    f.innerHTML = h;
}

function generateDemoCrashPoint() {
    const roll = Math.random() * 100;
    if (roll < 2) return 1.00;
    if (roll < 40) return Math.round((1.01 + Math.random() * 0.5) * 100) / 100;
    if (roll < 70) return Math.round((1.5 + Math.random() * 1.5) * 100) / 100;
    if (roll < 90) return Math.round((3 + Math.random() * 7) * 100) / 100;
    if (roll < 98) return Math.round((10 + Math.random() * 40) * 100) / 100;
    return Math.round((50 + Math.random() * 200) * 100) / 100;
}

function speedFor(m) {
    if (m < 1.5) return 0.06;
    if (m < 2) return 0.12;
    if (m < 3) return 0.2;
    if (m < 5) return 0.3;
    if (m < 10) return 0.5;
    if (m < 50) return 0.8;
    return 1.2;
}

const BOT_NAMES = ['happiness', 'Whisperify', 'woof', 'Eternal Sunset', 'Медведев', 'xRocket', 'Яна', 'Артём', 'фаня', 'Winx', 'core', 'mod', 'AI', 'Pupik777', 'Коммух', 'Holder Ronaldo', 'Акбар', 'wselywx', 'Adry', 'Iris', 'Дмитрий', 'админ', 'молодой мошенник', 'Mr.Ronaldo', 'БОСС', 'Легенда', 'Олдара', 'pipisa', 'Swix', 'merci', 'ZOV ZOV', 'dormidontic', 'never', 'Маркет', 'zz', 'Ghost face', 'Knox', 'Sunan Khan', 'катёнак', 'Traxer', 'sippy', 'Уолтер', 'Рома', 'gg.next', 'dark moon'];

function generateBots() {
    const c = 2 + Math.floor(Math.random() * 3);
    const s = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const r = [];
    for (let i = 0; i < c; i++) {
        const n = s[i % s.length];
        const b = Math.floor(Math.random() * 150) + 50;
        const w = Math.random() < 0.55;
        let m = w ? (Math.random() < 0.8 ? +(1.01 + Math.random() * 8.99).toFixed(2) : +(10 + Math.random() * 40).toFixed(2)) : 0;
        r.push({ name: n, bet: b, willCashout: w, cashoutMult: m, cashedOut: false, lost: false });
    }
    return r;
}

function pushHistory(v) {
    state.history.unshift(v);
    state.history = state.history.slice(0, 20);
    saveHistory();
    renderHistory();
}
function renderHistory() {
    const t = $('historyTrack');
    t.innerHTML = state.history.map(v => {
        let c = 'history-item';
        if (v >= 10) c += ' mega';
        else if (v >= 2) c += ' high';
        return `<div class="${c}">x${v.toFixed(2)}</div>`;
    }).join('');
}

function renderBets() {
    const l = $('betsList');
    let h = '';
    if (state.myBet) {
        const b = state.myBet;
        const icon = window.getCurrencyIcon(b.currency);
        let mh = b.cashedOut ? `<span class="bet-mult won">x${b.cashoutMult.toFixed(2)} ✓</span>` : state.phase === 'crashed' ? `<span class="bet-mult lost">x${state.crashPoint.toFixed(2)}</span>` : state.phase === 'flying' ? `<span class="bet-mult live">x${state.multiplier.toFixed(2)}</span>` : '<span class="bet-mult pending">—</span>';
        const da = b.cashedOut ? Math.floor(b.amount * b.cashoutMult) : Math.floor(b.amount * (state.phase === 'flying' ? state.multiplier : 1));
        const ph = '';
        h += `<div class="bet-item me"><div class="bet-left"><div class="bet-avatar">Я</div><div><div class="bet-name">Вы</div><div class="bet-amount"><img src="${icon}"> ${da}</div></div></div><div class="bet-right">${mh}</div><div class="bet-prize">${ph}</div></div>`;
    }
    state.bots.forEach(b => {
        let mh = b.cashedOut ? `<span class="bet-mult won">x${b.cashoutMult.toFixed(2)} ✓</span>` : (b.lost || state.phase === 'crashed') ? `<span class="bet-mult lost">x${state.crashPoint.toFixed(2)}</span>` : state.phase === 'flying' ? `<span class="bet-mult live">x${state.multiplier.toFixed(2)}</span>` : '<span class="bet-mult pending">—</span>';
        const da = b.cashedOut ? Math.floor(b.bet * b.cashoutMult) : Math.floor(b.bet * (state.phase === 'flying' ? state.multiplier : 1));
        const ph = '';
        let ic = 'bet-item' + (b.cashedOut ? ' won' : (b.lost || state.phase === 'crashed') ? ' lost' : '');
        h += `<div class="${ic}"><div class="bet-left"><div class="bet-avatar">${b.name[0]}</div><div><div class="bet-name">${b.name}</div><div class="bet-amount"><img src="${window.STAR_ICON}"> ${da}</div></div></div><div class="bet-right">${mh}</div><div class="bet-prize">${ph}</div></div>`;
    });
    l.innerHTML = h;
}

function setLottie(activeId) {
    const players = { wait: $('waitLottie'), round: $('roundLottie'), crash: $('crashLottie') };
    Object.keys(players).forEach(k => {
        const p = players[k];
        if (p) { p.classList.remove('active'); try { if (k === 'crash') p.stop(); } catch(e){} }
    });
    if (activeId && players[activeId]) {
        const p = players[activeId];
        p.classList.add('active');
        try { if (activeId === 'crash') { p.stop(); setTimeout(() => p.play(), 100); } else p.play(); } catch(e){}
    }
}

function startBettingPhase() {
    scheduleBettingRound(Date.now() + BET_PHASE_SECONDS * 1000, false);
}

function scheduleBettingRound(startsAt, keepBet) {
    clearInterval(state.bettingTimer);
    state.phase = 'waiting';
    if (!keepBet) state.myBet = null;
    state.roundStartsAt = startsAt;
    state.bots = generateBots();
    state.multiplier = 1.00;
    $('statusLabel').textContent = 'Ожидание раунда';
    $('statusLabel').style.display = 'block';
    $('timerNumber').style.display = 'block';
    state.timer = Math.max(0, Math.ceil((startsAt - Date.now()) / 1000));
    $('timerNumber').textContent = state.timer;
    $('currentMult').style.display = 'none';
    setLottie('wait');
    renderBets();
    updateMainBtn();
    setCurSwitchDisabled(Boolean(state.myBet));

    state.bettingTimer = setInterval(() => {
        state.timer = Math.max(0, Math.ceil((startsAt - Date.now()) / 1000));
        $('timerNumber').textContent = state.timer;
        if (state.timer <= 0) {
            clearInterval(state.bettingTimer);
            startRound();
        }
    }, 1000);
}

function setCurSwitchDisabled(disabled) {
    const el = $('curSwitch');
    if (!el) return;
    el.classList.toggle('disabled', disabled);
    el.querySelectorAll('button').forEach(b => b.disabled = disabled);
}

function startRound() {
    state.phase = 'flying';
    state.crashPoint = state.myBet ? Number.POSITIVE_INFINITY : generateDemoCrashPoint();
    state.multiplier = 1.00;
    $('statusLabel').style.display = 'none';
    $('timerNumber').style.display = 'none';
    $('currentMult').style.display = 'block';
    $('currentMult').classList.remove('crashed');
    $('currentMult').textContent = 'x1.00';
    setLottie('round');
    updateMainBtn();
    setCurSwitchDisabled(true);

    let last = performance.now();
    let acc = 0;

    function tick(now) {
        if (state.phase !== 'flying') return;
        const dt = (now - last) / 1000;
        last = now;
        acc += dt * speedFor(state.multiplier);
        while (acc >= 0.01) {
            state.multiplier = Math.min(state.crashPoint, state.multiplier + 0.01);
            acc -= 0.01;
        }
        $('currentMult').textContent = 'x' + state.multiplier.toFixed(2);
        state.bots.forEach(b => { if (!b.cashedOut && !b.lost && b.willCashout && state.multiplier >= b.cashoutMult) b.cashedOut = true; });
        if (!tick._last || now - tick._last > 120) { renderBets(); tick._last = now; }
        if (!state.myBet && state.multiplier >= state.crashPoint) { crashRound(); return; }
        state.raf = requestAnimationFrame(tick);
    }
    state.raf = requestAnimationFrame(tick);
    if (state.myBet) pollCrashRound();
}

function pollCrashRound() {
    clearTimeout(state.crashPollTimer);
    if (state.phase !== 'flying' || !state.myBet?.gameId || state.myBet.cashedOut) return;
    state.crashPollTimer = setTimeout(async () => {
        try {
            const { game } = await window.LootStarAPI.getCurrentCrash();
            if (game && game.gameId === state.myBet?.gameId) {
                if (game.status === 'lost') {
                    crashRound(game.crashMultiplier);
                    return;
                }
                if (game.status === 'active') {
                    state.multiplier = Math.max(state.multiplier, game.multiplier);
                }
            }
        } catch (error) {
            console.error('[crash] failed to sync round:', error);
        }
        pollCrashRound();
    }, 900);
}

function restoreCrashGame(game) {
    state.myBet = {
        gameId: game.gameId,
        amount: game.amount,
        currency: game.currency,
        cashedOut: false,
        cashoutMult: 0
    };
    state.currency = game.currency;
    if (game.phase === 'waiting') {
        scheduleBettingRound(game.startsAt, true);
    } else if (game.status === 'active') {
        state.phase = 'waiting';
        state.bots = [];
        state.multiplier = game.multiplier;
        startRound();
        state.multiplier = game.multiplier;
    } else {
        crashRound(game.crashMultiplier);
    }
}

function crashRound(crashMultiplier) {
    state.phase = 'crashed';
    cancelAnimationFrame(state.raf);
    clearTimeout(state.crashPollTimer);
    if (Number.isFinite(crashMultiplier)) state.crashPoint = crashMultiplier;
    state.multiplier = state.crashPoint;
    $('currentMult').textContent = 'x' + state.crashPoint.toFixed(2);
    $('currentMult').classList.add('crashed');
    setLottie('crash');
    state.bots.forEach(b => { if (!b.cashedOut) b.lost = true; });
    updateMainBtn();
    pushHistory(state.crashPoint);
    renderBets();

    if (state.myBet && !state.myBet.cashedOut) {
        showToast(`💥 Краш на x${state.crashPoint.toFixed(2)} — ставка сгорела`, 'err');
        window.LootTasks?.trackGameEvent({
            game: 'crash', type: 'result', currency: state.myBet.currency,
            bet: state.myBet.amount, multiplier: 0, win: false
        });
    }

    setTimeout(startBettingPhase, 2500);
}

function updateMainBtn() {
    const b = $('mainBtn');
    b.className = 'place-btn';
    b.disabled = !state.ready;

    if (state.phase === 'waiting') {
        if (state.myBet) { b.textContent = 'Ставка принята, ждите'; b.disabled = true; }
        else { b.textContent = `Сделать ставку (${window.getCurrencyName(state.currency)})`; }
    } else if (state.phase === 'flying') {
        if (!state.myBet) { b.textContent = 'Раунд уже идёт'; b.disabled = true; }
        else if (state.myBet.cashedOut) { b.textContent = `Забрано x${state.myBet.cashoutMult.toFixed(2)} ✓`; b.disabled = true; }
        else {
            const win = Math.floor(state.myBet.amount * state.multiplier);
            b.textContent = `Забрать ${win.toLocaleString('ru-RU')} ${window.getCurrencyShortName(state.myBet.currency)}`;
            b.classList.add('cashout');
        }
    } else if (state.phase === 'crashed') {
        if (state.myBet && !state.myBet.cashedOut) { b.textContent = 'Ставка сгорела 💥'; b.classList.add('lost'); }
        else { b.textContent = 'Раунд завершён'; }
        b.disabled = true;
    }
}

let betProcessing = false;
let cashoutProcessing = false;

async function onMainBtn() {
    if (state.phase === 'waiting') {
        if (!state.ready || state.myBet || betProcessing) return;
        const amount = parseInt($('betAmount').value) || MIN_BET;
        if (amount < MIN_BET) { showToast(`Минимум ${MIN_BET} ${window.getCurrencyShortName(state.currency)}`, 'err'); return; }
        if (amount > window.GameLimits.MAX_BET) { showToast('Максимальная ставка — 50 000 000', 'err'); return; }
        betProcessing = true;
        setCurSwitchDisabled(true);
        updateMainBtn();
        try {
            state.pendingStartRequestId ||= window.LootStarAPI.createRequestId();
            const result = await window.LootStarAPI.startCrash(
                amount, state.currency, state.pendingStartRequestId
            );
            state.pendingStartRequestId = null;
            window.LootStarAPI.applyBalanceResult(result);
            state.myBet = {
                gameId: result.game.gameId,
                amount: result.game.amount,
                currency: result.game.currency,
                cashedOut: false,
                cashoutMult: 0
            };
            window.LootTasks?.trackGameEvent({
                game: 'crash', type: 'bet', currency: state.myBet.currency, bet: amount
            });
            scheduleBettingRound(result.game.startsAt, true);
            vibrate('light');
        } catch (error) {
            console.error('[crash] bet failed:', error);
            try {
                const [{ game }] = await Promise.all([
                    window.LootStarAPI.getCurrentCrash(),
                    window.LootStarAPI.loadProfile()
                ]);
                if (game) restoreCrashGame(game);
                else state.pendingStartRequestId = null;
            } catch (refreshError) {
                console.error('[crash] profile refresh after failed bet failed:', refreshError);
            }
            setCurSwitchDisabled(false);
            showToast(error.code === 'INSUFFICIENT_FUNDS'
                ? `Недостаточно ${window.getCurrencyName(state.currency)}`
                : 'Не удалось сделать ставку. Баланс обновлён с сервера.', 'err');
        } finally {
            betProcessing = false;
            updateMainBtn();
        }
    } else if (state.phase === 'flying') {
        if (!state.ready || !state.myBet || state.myBet.cashedOut || cashoutProcessing) return;
        cashoutProcessing = true;
        updateMainBtn();
        try {
            state.myBet.cashoutRequestId ||= window.LootStarAPI.createRequestId();
            const result = await window.LootStarAPI.cashoutCrash(
                state.myBet.gameId, state.myBet.cashoutRequestId
            );
            applyCashoutResult(result);
        } catch (error) {
            console.error('[crash] cashout failed:', error);
            showToast('Не удалось забрать выигрыш. Проверяю состояние раунда.', 'err');
            try {
                const { game } = await window.LootStarAPI.getCurrentCrash();
                if (game?.status === 'lost') crashRound(game.crashMultiplier);
                else if (game?.status === 'active') state.multiplier = game.multiplier;
                else if (state.myBet?.cashoutRequestId) {
                    const replay = await window.LootStarAPI.cashoutCrash(
                        state.myBet.gameId, state.myBet.cashoutRequestId
                    );
                    applyCashoutResult(replay);
                }
            } catch (syncError) {
                console.error('[crash] state refresh after cashout failed:', syncError);
            }
            updateMainBtn();
        } finally {
            cashoutProcessing = false;
        }
    }
}

function applyCashoutResult(result) {
    window.LootStarAPI.applyBalanceResult(result);
    if (result.game.status === 'lost') {
        crashRound(result.game.crashMultiplier);
        return;
    }
    state.myBet.cashedOut = true;
    state.myBet.cashoutMult = result.game.cashoutMultiplier;
    state.multiplier = result.game.cashoutMultiplier;
    showToast(
        `Забрано ${result.game.payout.toLocaleString('ru-RU')} ${window.getCurrencyShortName(state.myBet.currency)} (x${state.myBet.cashoutMult.toFixed(2)})`,
        'ok'
    );
    window.LootTasks?.trackGameEvent({
        game: 'crash',
        type: 'result',
        currency: state.myBet.currency,
        bet: state.myBet.amount,
        multiplier: state.myBet.cashoutMult,
        win: true
    });
    window.refreshCurrencyUI();
    state.phase = 'crashed';
    cancelAnimationFrame(state.raf);
    clearTimeout(state.crashPollTimer);
    $('statusLabel').textContent = 'Раунд завершён';
    $('statusLabel').style.display = 'block';
    updateMainBtn();
    renderBets();
    setTimeout(startBettingPhase, 2500);
    vibrate('success');
}

function setBet(v) { $('betAmount').value = window.GameLimits.capBet(v); }
function setBetMax() { $('betAmount').value = Math.min(window.GameLimits.MAX_BET, Math.max(MIN_BET, window.getBalance(state.currency))); }

function showToast(msg, type = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2500);
}

window.setBet = setBet;
window.setBetMax = setBetMax;
window.onMainBtn = onMainBtn;