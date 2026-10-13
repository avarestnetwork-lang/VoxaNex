/**
 * VOXANEX REAL-TIME MESSAGING, CONTENT SAFETY & ABUSE PREVENTION TEST SUITE
 * Tests server-authoritative message validation, XSS sanitization, rate limits,
 * guest authorization, private conversation isolation, and peer blocking.
 */

import {
  sanitizeContent,
  extractSafeUrl,
  checkRateLimitAndSpam,
  postRoomMessage,
  getRoomMessages,
  registerConversationMembers,
  postConversationMessage,
  getConversationMessages,
  setUserBlock,
  fetchSafeLinkPreview,
  searchGifs,
} from '../src/server/realtimeHub';
import { createGuestSession } from '../src/server/guestSessionManager';

function assert(condition: boolean, testName: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runMessagingTests() {
  console.log('\n--- STARTING VOXANEX REAL-TIME MESSAGING TEST SUITE ---\n');

  // Test 1: XSS Sanitization & HTML Entity Encoding
  const dirtyPayload = '<script>alert("XSS")</script>&"\'test';
  const clean = sanitizeContent(dirtyPayload);
  assert(
    clean === '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&amp;&quot;&#x27;test',
    '1. XSS injection strings are safely converted to escaped HTML entities'
  );

  // Test 2: Message Length Validation
  const emptyRes = postRoomMessage({
    roomId: 'test-room',
    senderId: 'usr-1',
    senderNickname: 'User1',
    senderAvatar: '⚡',
    senderType: 'registered',
    rawContent: '   ',
  });
  assert(emptyRes.success === false, '2. Empty/whitespace messages are rejected by server validation');

  const longText = 'a'.repeat(2500);
  const longRes = postRoomMessage({
    roomId: 'test-room',
    senderId: 'usr-1',
    senderNickname: 'User1',
    senderAvatar: '⚡',
    senderType: 'registered',
    rawContent: longText,
  });
  assert(longRes.success === false, '3. Messages exceeding 2000 characters are strictly rejected');

  // Test 3: Spam & Repeated Message Throttling
  const userSpamId = 'spammer_123';
  const msg1 = postRoomMessage({
    roomId: 'test-room',
    senderId: userSpamId,
    senderNickname: 'Spammer',
    senderAvatar: '⚡',
    senderType: 'registered',
    rawContent: 'Repeated spam text',
  });
  assert(msg1.success === true, '4. Initial message delivery succeeds');

  const msg2 = postRoomMessage({
    roomId: 'test-room',
    senderId: userSpamId,
    senderNickname: 'Spammer',
    senderAvatar: '⚡',
    senderType: 'registered',
    rawContent: 'Repeated spam text', // identical within 4s
  });
  assert(msg2.success === false, '5. Immediate repeated identical message is blocked by spam filter');

  // Test 4: Private Conversation Membership Verification
  const convId = 'conv_alice_bob';
  registerConversationMembers(convId, ['alice', 'bob']);

  // Alice sends message to Bob
  const dmRes = postConversationMessage({
    conversationId: convId,
    senderId: 'alice',
    senderNickname: 'Alice',
    senderAvatar: '🌸',
    recipientId: 'bob',
    rawContent: 'Hello Bob! Secret meeting at Dhaka lounge.',
  });
  assert(dmRes.success === true, '6. Authorized member (Alice) successfully sends direct message');

  // Unauthorized third party (Charlie) attempts to send into conv_alice_bob
  const charlieSend = postConversationMessage({
    conversationId: convId,
    senderId: 'charlie',
    senderNickname: 'Charlie',
    senderAvatar: '🕵️',
    recipientId: 'bob',
    rawContent: 'Hacking into conversation',
  });
  assert(charlieSend.success === false, '7. Unauthorized third-party (Charlie) cannot post to conversation');

  // Charlie attempts to read conv_alice_bob messages
  const charlieRead = getConversationMessages(convId, 'charlie');
  assert(charlieRead.length === 0, '8. Unauthorized third-party cannot read private conversation messages');

  // Bob reads conversation
  const bobRead = getConversationMessages(convId, 'bob');
  assert(bobRead.length > 0 && bobRead[0].senderId === 'alice', '9. Authorized participant (Bob) reads message');

  // Test 5: Peer Blocking Enforcement
  setUserBlock('bob', 'alice', true); // Bob blocks Alice
  const blockedSend = postConversationMessage({
    conversationId: convId,
    senderId: 'alice',
    senderNickname: 'Alice',
    senderAvatar: '🌸',
    recipientId: 'bob',
    rawContent: 'Can you hear me now?',
  });
  assert(blockedSend.success === false, '10. Blocked peer (Alice) is rejected when attempting to message Bob');

  setUserBlock('bob', 'alice', false); // Bob unblocks Alice

  // Test 6: SSRF Protection on Link Previews
  const internalPreview = await fetchSafeLinkPreview('http://127.0.0.1:8080/admin/secrets');
  assert(internalPreview === null, '11. SSRF attempts to 127.0.0.1 loopback are strictly blocked');

  const privateSubnet = await fetchSafeLinkPreview('http://192.168.1.1/router-login');
  assert(privateSubnet === null, '12. SSRF attempts to 192.168.x.x private subnets are blocked');

  // Test 7: Safe GIF Search Lookup
  const gifs = searchGifs('tea');
  assert(gifs.length > 0 && gifs[0].title.toLowerCase().includes('tea'), '13. Curated safe GIF lookup succeeds');

  console.log('\n--- ALL REAL-TIME MESSAGING TESTS COMPLETED SUCCESSFULLY ---\n');
}

runMessagingTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
