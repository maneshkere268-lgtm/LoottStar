CREATE TABLE ropeko_operations (
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    request_id UUID NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (telegram_id, request_id)
);

CREATE INDEX ropeko_operations_created_idx ON ropeko_operations (created_at DESC);
