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
            'fishing_cashout',
            'item_craft',
            'item_save',
            'promo_redeem'
        ));

CREATE TABLE redeemed_promos (
    telegram_id TEXT NOT NULL REFERENCES app_users (telegram_id),
    code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,64}$'),
    currency TEXT NOT NULL CHECK (currency IN ('star', 'silver')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (telegram_id, code)
);
