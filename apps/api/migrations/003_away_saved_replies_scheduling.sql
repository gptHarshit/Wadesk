-- Office hours with an away message, saved replies for the inbox, and scheduled campaigns.
-- Only adds columns, a table and a status value; existing rows keep working unchanged.

-- Away message: sent once in a while to people who write outside office hours.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS away_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS away_message text;
-- Seven entries, Sunday first: {"open": true, "start": "10:00", "end": "19:00"}. Null until saved once.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS office_hours jsonb;

-- Saved replies: answers the team sends often, shared by the whole workspace.
CREATE TABLE IF NOT EXISTS saved_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body          text NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_replies_workspace_idx ON saved_replies (workspace_id, title);

-- Scheduled campaigns: a draft can wait for a time, then it is launched like "Send now".
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'queued', 'sending', 'completed', 'cancelled', 'failed'));
CREATE INDEX IF NOT EXISTS campaigns_due_idx ON campaigns (scheduled_at) WHERE status = 'scheduled';
