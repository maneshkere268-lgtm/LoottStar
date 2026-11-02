CREATE TABLE live_wins (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    telegram_id TEXT REFERENCES app_users (telegram_id) ON DELETE SET NULL,
    item_name TEXT NOT NULL CHECK (length(item_name) BETWEEN 1 AND 160),
    item_price BIGINT NOT NULL CHECK (item_price >= 0),
    currency TEXT NOT NULL CHECK (currency IN ('star', 'silver')),
    case_name TEXT NOT NULL DEFAULT '' CHECK (length(case_name) <= 120),
    image_url TEXT NOT NULL DEFAULT '' CHECK (length(image_url) <= 2048),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX live_wins_created_idx ON live_wins (created_at DESC);