ALTER TABLE game_operations
    DROP CONSTRAINT game_operations_operation_check,
    ADD CONSTRAINT game_operations_operation_check
        CHECK (operation IN ('case_open', 'item_sell', 'mines_start', 'mines_reveal', 'mines_cashout'));

CREATE TABLE mines_sessions (
    session_id UUID PRIMARY KEY,
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    mines_count SMALLINT NOT NULL CHECK (mines_count IN (2, 4, 10, 15)),
    bet_amount BIGINT NOT NULL CHECK (bet_amount BETWEEN 15 AND 50000000),
    currency TEXT NOT NULL CHECK (currency IN ('star', 'silver')),
    mine_positions JSONB NOT NULL CHECK (jsonb_typeof(mine_positions) = 'array'),
    revealed_cells JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(revealed_cells) = 'array'),
    status TEXT NOT NULL CHECK (status IN ('active', 'won', 'lost')),
    payout BIGINT NOT NULL DEFAULT 0 CHECK (payout >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mines_sessions_one_active_per_user
    ON mines_sessions (telegram_id) WHERE status = 'active';
CREATE INDEX mines_sessions_user_created_idx
    ON mines_sessions (telegram_id, created_at DESC);
