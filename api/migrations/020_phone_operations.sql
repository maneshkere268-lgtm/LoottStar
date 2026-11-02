ALTER TABLE app_users
    ADD COLUMN profile_phone JSONB NOT NULL DEFAULT '{"cc":"7","tail":"0000000000","rolls":0,"best":0}'::jsonb;

UPDATE app_users
SET profile_phone = jsonb_build_object(
    'cc', legacy_data #>> '{phone,cc}',
    'tail', legacy_data #>> '{phone,tail}',
    'rolls', CASE WHEN legacy_data #>> '{phone,rolls}' ~ '^[0-9]{1,9}$'
        THEN (legacy_data #>> '{phone,rolls}')::integer ELSE 0 END,
    'best', CASE WHEN legacy_data #>> '{phone,best}' ~ '^[0-9]{1,9}$'
        THEN (legacy_data #>> '{phone,best}')::integer ELSE 0 END
)
WHERE legacy_data #>> '{phone,cc}' ~ '^(7|91|66|62|84|90|380|55|49|33|86|44|81|971|1|888)$'
  AND legacy_data #>> '{phone,tail}' ~ '^[0-9]{10}$';

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
            'promo_redeem',
            'daily_task_claim',
            'staking_activate',
            'staking_stop',
            'staking_top_up',
            'staking_claim',
            'phone_roll',
            'phone_resolve',
            'phone_sell',
            'phone_install'
        ));
