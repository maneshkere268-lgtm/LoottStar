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
            'item_craft'
        ));
