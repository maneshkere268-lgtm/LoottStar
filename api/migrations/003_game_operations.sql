CREATE TABLE game_operations (
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    request_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('case_open', 'item_sell')),
    request JSONB NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (telegram_id, request_id)
);

CREATE INDEX game_operations_created_idx ON game_operations (created_at DESC);
