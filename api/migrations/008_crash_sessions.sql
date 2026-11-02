ALTER TABLE game_operations
    DROP CONSTRAINT game_operations_operation_check,
    ADD CONSTRAINT game_operations_operation_check
        CHECK (operation IN (
            'case_open',
            'item_sell',
            'mines_start',
            'mines_reveal',
            'mines_cashout',
            'slots_spin',
            'plinko_drop',
            'crash_start',
            'crash_cashout'
        ));

CREATE TABLE crash_sessions (
    session_id UUID PRIMARY KEY,
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    bet_amount BIGINT NOT NULL CHECK (bet_amount BETWEEN 25 AND 50000000),
    currency TEXT NOT NULL CHECK (currency IN ('star', 'silver')),
    start_at BIGINT NOT NULL,
    crash_at BIGINT NOT NULL,
    crash_multiplier SMALLINT NOT NULL CHECK (crash_multiplier BETWEEN 100 AND 25000),
    status TEXT NOT NULL CHECK (status IN ('active', 'won', 'lost')),
    cashout_multiplier SMALLINT,
    payout BIGINT NOT NULL DEFAULT 0 CHECK (payout >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (crash_at >= start_at)
);

CREATE UNIQUE INDEX crash_sessions_one_active_per_user
    ON crash_sessions (telegram_id) WHERE status = 'active';
CREATE INDEX crash_sessions_created_idx ON crash_sessions (created_at DESC);
