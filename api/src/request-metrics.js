'use strict';

const { performance } = require('node:perf_hooks');

function createRequestMetrics({ capacity = 500, now = Date.now } = {}) {
    const requests = [];
    let totalRequests = 0;
    let startedAt = now();

    function middleware(req, res, next) {
        const started = performance.now();
        res.once('finish', () => {
            const routePath = req.route?.path;
            const rawPath = `${req.baseUrl || ''}${routePath || req.path}`;
            const path = rawPath
                .replace(/\/(?:[0-9]{6,}|[0-9a-f]{8}-[0-9a-f-]{27,})/gi, '/:id')
                .slice(0, 240);
            const entry = {
                timestamp: new Date(now()).toISOString(),
                method: String(req.method).slice(0, 12),
                path,
                status: res.statusCode,
                durationMs: Math.max(0, Math.round((performance.now() - started) * 100) / 100)
            };
            totalRequests++;
            requests.unshift(entry);
            if (requests.length > capacity) requests.length = capacity;
        });
        next();
    }

    function snapshot(limit = 100) {
        const boundedLimit = Math.min(capacity, Math.max(1, Math.floor(limit)));
        return {
            startedAt: new Date(startedAt).toISOString(),
            totalRequests,
            recent: requests.slice(0, boundedLimit)
        };
    }

    function reset() {
        requests.length = 0;
        totalRequests = 0;
        startedAt = now();
    }

    return { middleware, snapshot, reset };
}

module.exports = { createRequestMetrics };
