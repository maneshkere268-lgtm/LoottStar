'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequestMetrics } = require('./request-metrics');

test('records bounded, query-free HTTP metrics without IP or request data', () => {
    let now = 1000;
    const metrics = createRequestMetrics({ capacity: 2, now: () => now++ });

    function record(path, query = '') {
        const req = { method: 'GET', path, originalUrl: `${path}${query}`, baseUrl: '', route: undefined };
        const res = new EventEmitter();
        res.statusCode = 200;
        metrics.middleware(req, res, () => {});
        res.emit('finish');
    }

    record('/api/v1/admin/users/7534292347', '?token=secret');
    record('/api/v1/admin/users/9876543210', '?private=1');
    record('/api/v1/admin/requests');
    const snapshot = metrics.snapshot(10);
    assert.equal(snapshot.totalRequests, 3);
    assert.equal(snapshot.recent.length, 2);
    assert.equal(snapshot.recent[0].path, '/api/v1/admin/requests');
    assert.equal(snapshot.recent[1].path, '/api/v1/admin/users/:id');
    assert.equal(JSON.stringify(snapshot).includes('secret'), false);
    assert.equal(Object.hasOwn(snapshot.recent[0], 'ip'), false);
});
