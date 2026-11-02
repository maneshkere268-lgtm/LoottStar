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
            'crash_cashout',
            'item_upgrade',
            'bags_play',
            'fishing_start',
            'fishing_continue',
            'fishing_cashout'
        ));

CREATE TABLE fishing_sessions (
    session_id UUID PRIMARY KEY,
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    bet_amount BIGINT NOT NULL CHECK (bet_amount BETWEEN 1 AND 50000000),
    currency TEXT NOT NULL CHECK (currency IN ('star', 'silver')),
    step SMALLINT NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 28),
    status TEXT NOT NULL CHECK (status IN ('active', 'won', 'lost')),
    payout BIGINT NOT NULL DEFAULT 0 CHECK (payout >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX fishing_sessions_one_active_per_user
    ON fishing_sessions (telegram_id) WHERE status = 'active';
CREATE INDEX fishing_sessions_created_idx ON fishing_sessions (created_at DESC);
