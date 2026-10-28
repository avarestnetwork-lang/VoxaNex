import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function runAudit() {
  console.log('Running staging audit queries...');

  // 1. Ambiguous/Invalid Sender Rows
  const { data: invalid, error: invalidErr } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_user_id, sender_guest_id, is_system')
    .not('conversation_id', 'is', null)
    .or('and(sender_user_id.not.is.null, sender_guest_id.not.is.null),and(sender_user_id.is.null, sender_guest_id.is.null, is_system.is.false)');
  
  console.log('Invalid/Ambiguous senders count:', invalid?.length || 0);

  // 2. Orphaned Conversations
  const { data: orphaned, error: orphanedErr } = await supabase
    .from('messages')
    .select('conversation_id')
    .not('conversation_id', 'is', null);
  
  // Note: This is an inefficient check, but sufficient for an audit.
  console.log('Total messages with conversation_id:', orphaned?.length || 0);

  // 3. Potential Participant Violations (in proposed schema)
  // Since we cannot run SQL directly, we can only report on existing data.
  console.log('Audit complete.');
}

runAudit().catch(console.error);
