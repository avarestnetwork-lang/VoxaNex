-- ChatLustora Production & Staging Database Migration
-- Version: 01_chatlustora_schema.sql
-- Description: Persistent conversation membership, event broker queue, and RLS security policies.

-- 1. Persistent conversation membership
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id text NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conv ON conversation_participants(conversation_id);

-- Enable Row Level Security (RLS) on conversation_participants
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

-- Deny direct anonymous/authenticated public client access (server service-role access only)
DROP POLICY IF EXISTS "Service Role Only conversation_participants" ON conversation_participants;
CREATE POLICY "Service Role Only conversation_participants" ON conversation_participants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Secure event brokering
CREATE TABLE IF NOT EXISTS event_bus (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_bus_recipient ON event_bus(recipient_id);
CREATE INDEX IF NOT EXISTS idx_event_bus_created ON event_bus(created_at);

-- Enable Row Level Security (RLS) on event_bus
ALTER TABLE event_bus ENABLE ROW LEVEL SECURITY;

-- Deny direct public client access (server service-role access only)
DROP POLICY IF EXISTS "Service Role Only event_bus" ON event_bus;
CREATE POLICY "Service Role Only event_bus" ON event_bus
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Cleanup function to prevent event_bus table bloat
CREATE OR REPLACE FUNCTION clean_event_bus() RETURNS void AS $$
  DELETE FROM event_bus WHERE created_at < NOW() - INTERVAL '5 minutes';
$$ LANGUAGE sql;
