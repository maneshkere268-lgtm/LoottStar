CREATE TABLE app_users (
    telegram_id TEXT PRIMARY KEY CHECK (telegram_id ~ '^[1-9][0-9]{0,19}$'),
    firestore_doc_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    photo_url TEXT NOT NULL DEFAULT '',
    stars BIGINT NOT NULL DEFAULT 0 CHECK (stars >= 0),
    silver BIGINT NOT NULL DEFAULT 0 CHECK (silver >= 0),
    pearl BIGINT NOT NULL DEFAULT 0 CHECK (pearl >= 0),
    turnover BIGINT NOT NULL DEFAULT 0 CHECK (turnover >= 0),
    silver_turnover BIGINT NOT NULL DEFAULT 0 CHECK (silver_turnover >= 0),
    withdraw_cycles BIGINT NOT NULL DEFAULT 0 CHECK (withdraw_cycles >= 0),
    inventory JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inventory) = 'array'),
    collection_items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(collection_items) = 'array'),
    free_case_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason TEXT,
    ban_until BIGINT,
    legacy_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_users_username_idx ON app_users (LOWER(username)) WHERE username IS NOT NULL;
CREATE INDEX app_users_stars_leaderboard_idx ON app_users (stars DESC);

CREATE TABLE balance_ledger (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    request_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('spend', 'earn')),
    currency TEXT NOT NULL CHECK (currency IN ('star', 'silver')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (telegram_id, request_id)
);

CREATE INDEX balance_ledger_user_created_idx ON balance_ledger (telegram_id, created_at DESC);
