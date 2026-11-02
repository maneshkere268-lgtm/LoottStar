ALTER TABLE redeemed_promos
    ALTER COLUMN currency DROP NOT NULL,
    ALTER COLUMN amount DROP NOT NULL;

ALTER TABLE redeemed_promos
    DROP CONSTRAINT redeemed_promos_currency_check,
    DROP CONSTRAINT redeemed_promos_amount_check,
    ADD CONSTRAINT redeemed_promos_reward_check CHECK (
        (currency IS NULL AND amount IS NULL) OR
        (currency IN ('star', 'silver') AND amount > 0)
    ),
    ADD COLUMN request_id UUID,
    ADD COLUMN reward JSONB;

CREATE UNIQUE INDEX redeemed_promos_request_idx
    ON redeemed_promos (telegram_id, request_id)
    WHERE request_id IS NOT NULL;
