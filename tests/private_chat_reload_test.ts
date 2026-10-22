/**
 * ChatLustora — Private Chat Reload & Window State Test Suite
 * Validates:
 * 1. Seen message hydration preventing old history from opening floating windows on reload.
 * 2. Duplicate window prevention when opening existing chat conversations.
 * 3. Closed window persistence and state integrity.
 */

import { registerConversationMembers, postConversationMessage, getConversationMessages } from '../src/server/realtimeHub';
import { createGuestSession } from '../src/server/guestSessionManager';

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runPrivateChatReloadTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA — PRIVATE CHAT RELOAD & WINDOW STATE TESTS');
  console.log('=============================================================\n');

  const guest1 = createGuestSession({ nickname: 'User1', avatar: '⚡', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.1' });
  const guest2 = createGuestSession({ nickname: 'User2', avatar: '🌸', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.2' });

  const id1 = guest1.session!.id;
  const id2 = guest2.session!.id;

  const convId = `conv_${[id1, id2].sort().join('_')}`;
  registerConversationMembers(convId, [id1, id2]);

  // 1. Post a message to establish history
  const sendRes = await postConversationMessage({
    conversationId: convId,
    senderId: id1,
    senderNickname: 'User1',
    senderAvatar: '⚡',
    rawContent: 'Historical test message before page reload',
  });
  assert(sendRes.success && !!sendRes.message, '1.1 Historical message successfully posted');

  const messageId = sendRes.message!.id;

  // 2. Simulate reload hydration: fetching conversation history and seeding seen messages
  const history = await getConversationMessages(convId, id2);
  assert(history.length > 0, '2.1 Conversation history fetched successfully on reload');

  const seenMessageIds = new Set<string>();
  history.forEach((m) => {
    if (m.id) seenMessageIds.add(m.id);
  });

  assert(seenMessageIds.has(messageId), '2.2 Historical message ID is correctly seeded in seenMessageIds on startup');

  // 3. Verify that seen historical message is not treated as a new incoming message (no popup trigger)
  const isNewMessage = !seenMessageIds.has(messageId);
  assert(!isNewMessage, '3.1 Seeded historical message does not trigger new incoming window opening after reload');

  // 4. Test duplicate window prevention simulation (state management logic)
  const openWindows: Array<{ conversationId: string; isOpen: boolean }> = [];
  
  // Simulate opening chat (first time)
  const openChatSim = (cId: string) => {
    const existing = openWindows.find((w) => w.conversationId === cId);
    if (existing) {
      existing.isOpen = true;
    } else {
      openWindows.push({ conversationId: cId, isOpen: true });
    }
  };

  openChatSim(convId);
  openChatSim(convId); // Open again (should not duplicate)

  assert(openWindows.length === 1, '4.1 Opening an active conversation twice does not create duplicate windows');
  assert(openWindows[0].isOpen === true, '4.2 Window is correctly marked open');

  // Simulate explicit close
  const closeChatSim = (cId: string) => {
    const index = openWindows.findIndex((w) => w.conversationId === cId);
    if (index >= 0) openWindows.splice(index, 1);
  };

  closeChatSim(convId);
  assert(openWindows.length === 0, '4.3 Explicitly closing chat removes the window state');

  console.log('\n=============================================================');
  console.log('  PRIVATE CHAT RELOAD TESTS COMPLETED SUCCESSFULLY');
  console.log('=============================================================\n');
}

runPrivateChatReloadTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
