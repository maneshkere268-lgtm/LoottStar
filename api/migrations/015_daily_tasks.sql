ALTER TABLE app_users
    ADD COLUMN halloween_xp BIGINT NOT NULL DEFAULT 0 CHECK (halloween_xp >= 0);

CREATE TABLE daily_task_claims (
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    day DATE NOT NULL,
    task_id TEXT NOT NULL CHECK (task_id IN (
        'star_bets_5',
        'star_mines_10',
        'star_win_3x',
        'star_slots_15',
        'star_win_5x',
        'star_win_10x',
        'silver_bets_5',
        'silver_mines_10',
        'silver_win_3x',
        'silver_slots_15',
        'silver_win_5x',
        'silver_win_10x'
    )),
    request_id UUID NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (telegram_id, day, task_id),
    UNIQUE (telegram_id, request_id)
);

CREATE INDEX daily_task_claims_day_idx ON daily_task_claims (day DESC);
