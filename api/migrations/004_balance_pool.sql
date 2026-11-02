ALTER TABLE app_users
    ADD COLUMN balance_pool_started_at BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN balance_pool_start_value BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN balance_pool_escrow_value BIGINT NOT NULL DEFAULT 0;
