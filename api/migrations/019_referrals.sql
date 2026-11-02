CREATE TABLE referral_joins (
    referred_telegram_id TEXT PRIMARY KEY REFERENCES app_users (telegram_id),
    referrer_telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (referred_telegram_id <> referrer_telegram_id)
);

CREATE INDEX referral_joins_referrer_created_idx
    ON referral_joins (referrer_telegram_id, created_at DESC);
