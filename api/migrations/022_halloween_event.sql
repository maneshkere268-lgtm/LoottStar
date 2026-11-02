ALTER TABLE app_users
    ADD COLUMN halloween_pumpkins BIGINT NOT NULL DEFAULT 0 CHECK (halloween_pumpkins >= 0),
    ADD COLUMN halloween_state JSONB NOT NULL DEFAULT
        '{"spinLastUsed":0,"treatStreakMs":0,"treatAccrued":0,"treatHiddenSince":null,"passClaims":[],"activeBrews":[]}'::jsonb
        CHECK (jsonb_typeof(halloween_state) = 'object');

CREATE TABLE halloween_operations (
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    request_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN (
        'case_open', 'wheel_spin', 'pass_claim', 'treat_start', 'treat_stop', 'treat_claim', 'brew_buy'
    )),
    request JSONB NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (telegram_id, request_id)
);

CREATE INDEX halloween_operations_created_idx ON halloween_operations (created_at DESC);
