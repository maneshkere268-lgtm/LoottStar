'use strict';

const { randomInt } = require('node:crypto');

const COST = 5000;
const START = Object.freeze({ cc: '7', tail: '0000000000' });
const countries = [
    ['7', 20, 0.85], ['91', 14, 0.85], ['66', 10, 0.9], ['62', 8, 0.9],
    ['84', 8, 0.9], ['90', 8, 0.95], ['380', 7, 0.95], ['55', 6, 1],
    ['49', 5, 1.15], ['33', 4, 1.2], ['86', 4, 1.25], ['44', 3, 1.4],
    ['81', 3, 1.5], ['971', 2, 2], ['1', 2, 2.2]
];
const countryWeight = countries.reduce((total, [, weight]) => total + weight, 0);
const countryMean = countries.reduce((total, [, weight, multiplier]) => total + weight * multiplier, 0) / countryWeight;
const countryByCode = new Map(countries.map(([cc, weight, multiplier]) => [
    cc, { p: weight / countryWeight, mult: multiplier / countryMean }
]));
countryByCode.set('888', { p: 0, mult: 1 });
const tiers = [
    { min: 1000, max: 2400, step: 10, weight: 1 - 0.313401 },
    { min: 3500, max: 6000, step: 10, weight: 0.22 },
    { min: 9000, max: 15000, step: 100, weight: 0.08 },
    { min: 30000, max: 50000, step: 100, weight: 0.012 },
    { min: 150000, max: 300000, step: 1000, weight: 0.0012 },
    { min: 1000000, max: 1500000, step: 10000, weight: 0.0002 },
    { min: 100000000, max: 100000000, step: 1, weight: 0.000001 }
];

function random() {
    return randomInt(1_000_000) / 1_000_000;
}

function integer(max) {
    return randomInt(max);
}

function digits(count) {
    return Array.from({ length: count }, () => String(integer(10))).join('');
}

function analyze(tail) {
    const values = [...tail].map(Number);
    let run = 1, maxRun = 1, ascending = 1, descending = 1, stairs = 1;
    for (let index = 1; index < 10; index++) {
        run = values[index] === values[index - 1] ? run + 1 : 1;
        ascending = values[index] - values[index - 1] === 1 ? ascending + 1 : 1;
        descending = values[index - 1] - values[index] === 1 ? descending + 1 : 1;
        maxRun = Math.max(maxRun, run);
        stairs = Math.max(stairs, ascending, descending);
    }
    const counts = Array(10).fill(0);
    values.forEach(value => counts[value]++);
    let trailingZeros = 0;
    for (let index = 9; index >= 0 && values[index] === 0; index--) trailingZeros++;
    return {
        maxRun,
        stairs,
        trailingZeros,
        maxCount: Math.max(...counts),
        distinct: counts.filter(Boolean).length,
        palindrome: tail === [...tail].reverse().join(''),
        groups: [tail.slice(0, 3), tail.slice(3, 6), tail.slice(6, 8), tail.slice(8, 10)],
        sum: values.reduce((total, value) => total + value, 0),
        last: values[9]
    };
}

function tailTierIndex(info) {
    if (info.distinct === 1) return 5;
    if (info.maxCount >= 8 || info.stairs >= 8) return 4;
    if (info.maxCount >= 6 || info.stairs >= 6 || info.distinct <= 2 || info.trailingZeros >= 6) return 3;
    if (info.maxRun >= 4 || info.stairs >= 4 || info.trailingZeros >= 3 ||
        info.groups[0] === info.groups[1] || info.palindrome) return 2;
    if (info.maxRun >= 3 || info.stairs >= 3 || info.trailingZeros >= 2 ||
        info.groups[2] === info.groups[3] ||
        (info.groups[2][0] === info.groups[2][1] && info.groups[3][0] === info.groups[3][1])) return 1;
    return 0;
}

function evaluate(cc, tail) {
    if (!countryByCode.has(cc) || !/^\d{10}$/.test(tail)) throw new Error('INVALID_PHONE');
    if (/^0+$/.test(tail)) return { value: 0, index: -1 };
    const info = analyze(tail);
    if (cc === '888' && /^8+$/.test(tail)) return { value: tiers[6].min, index: 6 };
    let index = tailTierIndex(info);
    if (cc === '888') index = Math.min(5, index + 1);
    const tier = tiers[index];
    const fraction = ((info.sum * 7 + info.last * 13 + (cc === '888' ? 50 : 0)) % 100) / 100;
    const raw = tier.min + (tier.max - tier.min) * fraction;
    const value = Math.max(tier.step, Math.round(raw * countryByCode.get(cc).mult / tier.step) * tier.step);
    return { value, index };
}

function fillRun(length, digit) {
    const result = digits(10).split('');
    const start = integer(11 - length);
    for (let index = 0; index < length; index++) result[start + index] = String(digit);
    return result.join('');
}

function fillStairs(length) {
    const ascending = integer(2) === 0;
    const startValue = ascending ? integer(11 - length) : length - 1 + integer(11 - length);
    const result = digits(10).split('');
    const start = integer(11 - length);
    for (let index = 0; index < length; index++) {
        result[start + index] = String(ascending ? startValue + index : startValue - index);
    }
    return result.join('');
}

function generatedTail(index) {
    const patterns = [
        () => digits(10),
        () => {
            const x = integer(10), y = integer(10);
            return [digits(6) + x + x + y + y, digits(6) + x + y + x + y,
                fillRun(3, integer(10)), digits(8) + '00', fillStairs(3)][integer(5)];
        },
        () => [fillRun(4, integer(10)), fillStairs(4 + integer(2)), digits(7) + '000',
            (() => { const group = digits(3); return group + group + digits(4); })(),
            (() => { const half = digits(5); return half + [...half].reverse().join(''); })()][integer(5)],
        () => [fillRun(6 + integer(2), integer(10)), fillStairs(6 + integer(2)),
            (() => { const x = integer(10); let y = integer(10); if (y === x) y = (y + 1) % 10; return `${x}${y}`.repeat(5); })(),
            `${1 + integer(9)}${digits(3)}000000`][integer(4)],
        () => [fillRun(8 + integer(2), integer(10)), fillStairs(8 + integer(2))][integer(2)],
        () => `${1 + integer(9)}`.repeat(10)
    ][index]();
    return patterns;
}

function pickCountry() {
    let choice = random();
    for (const [cc, weight] of countries) {
        choice -= weight / countryWeight;
        if (choice < 0) return cc;
    }
    return countries[0][0];
}

function generate() {
    let choice = random();
    let target = 0;
    for (let index = 0; index < tiers.length; index++) {
        choice -= tiers[index].weight;
        if (choice < 0) { target = index; break; }
    }
    if (target === 6) return { cc: '888', tail: '8888888888' };
    for (let attempt = 0; attempt < 80; attempt++) {
        const bumped = target >= 2 && random() < 0.12;
        const cc = bumped ? '888' : pickCountry();
        let tail = digits(10);
        for (let tailAttempt = 0; tailAttempt < 120; tailAttempt++) {
            tail = generatedTail(bumped ? target - 1 : target);
            if (!/^0+$/.test(tail) && tailTierIndex(analyze(tail)) === (bumped ? target - 1 : target)) break;
        }
        if (evaluate(cc, tail).index === target) return { cc, tail };
    }
    throw new Error('PHONE_GENERATION_FAILED');
}

function normalizeState(value) {
    if (!value || typeof value !== 'object' ||
        !countryByCode.has(String(value.cc)) || !/^\d{10}$/.test(String(value.tail))) {
        return { ...START, rolls: 0, best: 0 };
    }
    const state = {
        cc: String(value.cc),
        tail: String(value.tail),
        rolls: Number.isSafeInteger(Number(value.rolls)) ? Math.max(0, Number(value.rolls)) : 0,
        best: Number.isSafeInteger(Number(value.best)) ? Math.max(0, Number(value.best)) : 0,
        value: evaluate(String(value.cc), String(value.tail)).value
    };
    if (value.pending && countryByCode.has(String(value.pending.cc)) &&
        /^\d{10}$/.test(String(value.pending.tail))) {
        state.pending = { cc: String(value.pending.cc), tail: String(value.pending.tail) };
    }
    return state;
}

module.exports = { COST, START, evaluate, generate, normalizeState };
