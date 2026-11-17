-- WaDesk initial schema.
-- Every tenant-owned table carries workspace_id, and every query filters on it.

CREATE TABLE workspaces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  default_country_code  text,
  webhook_verify_token  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email              text NOT NULL,
  name               text NOT NULL,
  password_hash      text,
  role               text NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  invite_token_hash  text,
  invite_expires_at  timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_workspace_idx ON users (workspace_id);
CREATE UNIQUE INDEX users_invite_token_key ON users (invite_token_hash) WHERE invite_token_hash IS NOT NULL;

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One WhatsApp Cloud API number per workspace. Secrets are AES-256-GCM encrypted.
CREATE TABLE whatsapp_accounts (
  workspace_id          uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  phone_number_id       text NOT NULL UNIQUE,
  waba_id               text NOT NULL,
  access_token_enc      text NOT NULL,
  app_secret_enc        text NOT NULL,
  display_phone_number  text,
  verified_name         text,
  connected_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- A contact is identified by phone number, by WhatsApp business-scoped user ID
-- (BSUID, sent when a user hides their number behind a username), or both.
CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phone         text,
  wa_user_id    text,
  wa_username   text,
  name          text,
  email         text,
  notes         text,
  opted_out     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_identity_chk CHECK (phone IS NOT NULL OR wa_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX contacts_phone_key ON contacts (workspace_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX contacts_wa_user_key ON contacts (workspace_id, wa_user_id) WHERE wa_user_id IS NOT NULL;
CREATE INDEX contacts_workspace_created_idx ON contacts (workspace_id, created_at DESC, id DESC);

CREATE TABLE tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text NOT NULL DEFAULT 'slate',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_name_key ON tags (workspace_id, lower(name));

CREATE TABLE contact_tags (
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX contact_tags_tag_idx ON contact_tags (tag_id);

CREATE TABLE conversations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id              uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to             uuid REFERENCES users(id) ON DELETE SET NULL,
  unread_count            integer NOT NULL DEFAULT 0,
  last_message_at         timestamptz NOT NULL DEFAULT now(),
  last_message_preview    text,
  last_message_direction  text,
  last_inbound_at         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, contact_id)
);
CREATE INDEX conversations_list_idx ON conversations (workspace_id, status, last_message_at DESC, id DESC);
CREATE INDEX conversations_assignee_idx ON conversations (workspace_id, assigned_to);

CREATE TABLE templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  wa_template_id    text NOT NULL,
  name              text NOT NULL,
  language          text NOT NULL,
  category          text,
  status            text NOT NULL,
  parameter_format  text NOT NULL DEFAULT 'POSITIONAL',
  components        jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, wa_template_id)
);
CREATE INDEX templates_workspace_idx ON templates (workspace_id, name);

CREATE TABLE campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name               text NOT NULL,
  template_id        uuid REFERENCES templates(id) ON DELETE SET NULL,
  template_name      text NOT NULL,
  template_language  text NOT NULL,
  variables          jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience           jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'cancelled', 'failed')),
  total_recipients   integer NOT NULL DEFAULT 0,
  error_message      text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz
);
CREATE INDEX campaigns_workspace_idx ON campaigns (workspace_id, created_at DESC);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  type             text NOT NULL,
  body             text,
  media            jsonb,
  template_name    text,
  wa_message_id    text,
  status           text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error_code       text,
  error_message    text,
  sent_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  source           text CHECK (source IN ('agent', 'campaign', 'auto_reply')),
  campaign_id      uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz
);
CREATE UNIQUE INDEX messages_wa_id_key ON messages (workspace_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX messages_thread_idx ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX messages_workspace_created_idx ON messages (workspace_id, created_at);

CREATE TABLE campaign_recipients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  wa_message_id  text,
  message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,
  error_code     text,
  error_message  text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX campaign_recipients_status_idx ON campaign_recipients (campaign_id, status);
CREATE INDEX campaign_recipients_wa_id_idx ON campaign_recipients (wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE TABLE auto_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword       text NOT NULL,
  match_type    text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('exact', 'contains', 'starts_with')),
  reply_text    text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_replies_workspace_idx ON auto_replies (workspace_id, created_at);
