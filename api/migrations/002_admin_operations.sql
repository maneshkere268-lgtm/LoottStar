CREATE TABLE app_settings (
    setting_key TEXT PRIMARY KEY CHECK (setting_key ~ '^[a-zA-Z0-9._-]{1,120}$'),
    value JSONB NOT NULL,
    updated_by TEXT NOT NULL CHECK (updated_by ~ '^[1-9][0-9]{0,19}$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_telegram_id TEXT NOT NULL CHECK (admin_telegram_id ~ '^[1-9][0-9]{0,19}$'),
    action TEXT NOT NULL CHECK (length(action) <= 120),
    subject_type TEXT NOT NULL CHECK (length(subject_type) <= 80),
    subject_id TEXT CHECK (length(subject_id) <= 160),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC);
CREATE INDEX admin_audit_logs_admin_idx ON admin_audit_logs (admin_telegram_id, created_at DESC);

CREATE TABLE app_records (
    namespace TEXT NOT NULL CHECK (namespace ~ '^[a-zA-Z0-9._-]{1,80}$'),
    record_key TEXT NOT NULL CHECK (length(record_key) BETWEEN 1 AND 160),
    value JSONB NOT NULL,
    updated_by TEXT NOT NULL CHECK (updated_by ~ '^[1-9][0-9]{0,19}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (namespace, record_key)
);

CREATE INDEX app_records_updated_idx ON app_records (namespace, updated_at DESC);
