-- Custom fields on contacts: any extra details (marks, department, due_amount...)
-- stored as a flat JSON object of text values, keyed by lower_snake_case names.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
