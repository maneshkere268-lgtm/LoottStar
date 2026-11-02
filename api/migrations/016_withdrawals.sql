CREATE TABLE withdrawal_requests (
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    request_id UUID NOT NULL,
    amount_loot_star BIGINT NOT NULL CHECK (amount_loot_star > 0),
    amount_telegram_stars BIGINT NOT NULL CHECK (amount_telegram_stars > 0),
    rate_loot_star_per_telegram_star BIGINT NOT NULL CHECK (rate_loot_star_per_telegram_star > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    request JSONB NOT NULL,
    admin_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (telegram_id, request_id)
);

CREATE INDEX withdrawal_requests_status_created_idx
    ON withdrawal_requests (status, created_at DESC);
