import { createServer } from 'http';
import express from 'express';
import {
  postRoomMessage,
  getRoomMessages,
  updateRoomPresence,
  getRoomPresence,
  removeRoomPresence,
  postConversationMessage,
  getConversationMessages,
  registerConversationMembers,
  isConversationMember,
} from '../src/server/realtimeHub.js';

async function runRegressionSuite() {
  console.log('====================================================');
  console.log('   CHATLUSTORA PRODUCTION REGRESSION TEST SUITE    ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // TEST 1: Public Room Presence Registration & Count
  const roomId = 'room-bangla-test';
  updateRoomPresence(roomId, {
    id: 'guest_user_1',
    nickname: 'Guest_A',
    avatar: '⚡',
    isGuest: true,
    gender: 'male',
    lastSeen: Date.now(),
  });
  updateRoomPresence(roomId, {
    id: 'guest_user_2',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    gender: 'female',
    lastSeen: Date.now(),
  });

  const activeMembers = getRoomPresence(roomId);
  assert(activeMembers.length === 2, 'Test 1: Multi-session room presence tracking', `Expected 2 members, got ${activeMembers.length}`);

  // TEST 2: Single Member Departure Updates Presence Count
  removeRoomPresence(roomId, 'guest_user_1');
  const remainingMembers = getRoomPresence(roomId);
  assert(remainingMembers.length === 1 && remainingMembers[0].id === 'guest_user_2', 'Test 2: Single member departure updates active count correctly');

  // TEST 3: Stale Member Pruning (>45s)
  updateRoomPresence(roomId, {
    id: 'guest_user_3_stale',
    nickname: 'StaleUser',
    avatar: '👻',
    isGuest: true,
    lastSeen: Date.now() - 50000, // 50 seconds old
  });
  const prunedMembers = getRoomPresence(roomId);
  assert(!prunedMembers.some((m) => m.id === 'guest_user_3_stale'), 'Test 3: Stale presence members pruned after 45s');

  // TEST 4: Post Public Room Messages
  const msg1 = postRoomMessage({
    roomId,
    senderId: 'guest_user_2',
    senderNickname: 'Guest_B',
    senderAvatar: '🌸',
    senderType: 'guest',
    rawContent: 'Hello Bangla Room!',
    clientNonce: 'nonce_test_1',
  });
  assert(msg1.success && Boolean(msg1.message), 'Test 4: Send public room message');

  // TEST 5: Public Room Messages Duplicate Client Nonce Handling
  const msg1Duplicate = postRoomMessage({
    roomId,
    senderId: 'guest_user_2',
    senderNickname: 'Guest_B',
    senderAvatar: '🌸',
    senderType: 'guest',
    rawContent: 'Hello Bangla Room!',
    clientNonce: 'nonce_test_1',
  });
  assert(msg1Duplicate.success && msg1Duplicate.message?.id === msg1.message?.id, 'Test 5: Duplicate client nonce returns existing message without duplication');

  // TEST 6: Public Room History Persistence On Leave
  removeRoomPresence(roomId, 'guest_user_2'); // Guest B leaves
  const historyAfterLeave = getRoomMessages(roomId, 50);
  assert(historyAfterLeave.length > 0 && historyAfterLeave.some((m) => m.content === 'Hello Bangla Room!'), 'Test 6: Room chat history persists after member leaves room');

  // TEST 7: Re-joining Member Sees Preserved History
  updateRoomPresence(roomId, {
    id: 'guest_user_2',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  const historyOnRejoin = getRoomMessages(roomId, 50);
  assert(historyOnRejoin.some((m) => m.id === msg1.message?.id), 'Test 7: Re-joining guest receives preserved chronological history');

  // TEST 8: Private Conversation Initialization & Deterministic ID
  const convId = 'conv_guest_A_guest_B';
  registerConversationMembers(convId, ['guest_A', 'guest_B']);
  const isMemberA = await isConversationMember(convId, 'guest_A');
  const isMemberB = await isConversationMember(convId, 'guest_B');
  assert(isMemberA && isMemberB, 'Test 8: Deterministic private conversation membership initialization');

  // TEST 9: Non-member Access Denied to Private Conversation
  const isMemberC = await isConversationMember(convId, 'guest_unauthorized_C');
  assert(!isMemberC, 'Test 9: Unauthorized user blocked from private conversation');

  // TEST 10: Private Message Delivery
  const dmMsg1 = await postConversationMessage({
    conversationId: convId,
    senderId: 'guest_A',
    senderNickname: 'Guest_A',
    senderAvatar: '⚡',
    rawContent: 'Private DM from A to B',
    clientNonce: 'dm_nonce_1',
  });
  assert(dmMsg1.success && dmMsg1.message?.content === 'Private DM from A to B', 'Test 10: Direct message delivery between guests');

  // TEST 11: Private Message Duplicate Nonce Resilience
  const dmMsg1Dup = await postConversationMessage({
    conversationId: convId,
    senderId: 'guest_A',
    senderNickname: 'Guest_A',
    senderAvatar: '⚡',
    rawContent: 'Private DM from A to B',
    clientNonce: 'dm_nonce_1',
  });
  assert(dmMsg1Dup.success && dmMsg1Dup.message?.id === dmMsg1.message?.id, 'Test 11: Duplicate private message nonce returns existing message');

  // TEST 12: Private Conversation History Retrieval
  const dmMessages = await getConversationMessages(convId, 'guest_B');
  assert(dmMessages.length === 1 && dmMessages[0].content === 'Private DM from A to B', 'Test 12: Recipient fetches private conversation history');

  // TEST 13: Private Reply Delivery
  const dmMsg2 = await postConversationMessage({
    conversationId: convId,
    senderId: 'guest_B',
    senderNickname: 'Guest_B',
    senderAvatar: '🌸',
    rawContent: 'Reply from B to A!',
    clientNonce: 'dm_nonce_2',
  });
  const updatedDmMessages = await getConversationMessages(convId, 'guest_A');
  assert(updatedDmMessages.length === 2 && updatedDmMessages[1].content === 'Reply from B to A!', 'Test 13: Private reply delivered and saved in history');

  // TEST 14: Rate Limiting / Spam Protection
  let rateThrottled = false;
  for (let i = 0; i < 35; i++) {
    const res = postRoomMessage({
      roomId: 'room-spam-test',
      senderId: 'spammer_user',
      senderNickname: 'Spammer',
      senderAvatar: '🤖',
      senderType: 'guest',
      rawContent: `Spam text iteration ${i}`,
    });
    if (!res.success && res.error && (res.error.includes('Rate limit') || res.error.includes('quickly') || res.error.includes('throttled'))) {
      rateThrottled = true;
      break;
    }
  }
  assert(rateThrottled, 'Test 14: Rate-limiting and anti-spam protection triggers after excess messages');

  // ---------------------------------------------------------------------------
  // COMPREHENSIVE PRESENCE & ROOM STATE REGRESSION TESTS (1-10)
  // ---------------------------------------------------------------------------
  const pRoomId = 'room-bangla';

  // Test 1: Guest A joins: count is 1 in both client views.
  updateRoomPresence(pRoomId, {
    id: 'guest_A_id',
    nickname: 'Guest_A',
    avatar: '⚡',
    isGuest: true,
    lastSeen: Date.now(),
  });
  let presA = getRoomPresence(pRoomId);
  assert(presA.length === 1 && presA[0].id === 'guest_A_id', 'Test 1: Guest A joins, count is 1');

  // Test 2: Guest B joins the same room from another session: count becomes 2 in both views.
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  let presAB = getRoomPresence(pRoomId);
  assert(presAB.length === 2 && presAB.some(m => m.id === 'guest_A_id') && presAB.some(m => m.id === 'guest_B_id'), 'Test 2: Guest B joins, count becomes 2');

  // Test 3: Guest B sends multiple heartbeats: count remains 2.
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  let presHeartbeat = getRoomPresence(pRoomId);
  assert(presHeartbeat.length === 2, 'Test 3: Guest B heartbeats do not increase participant count (remains 2)');

  // Test 4: Guest A leaves: both views converge to count 1.
  removeRoomPresence(pRoomId, 'guest_A_id');
  let presLeave = getRoomPresence(pRoomId);
  assert(presLeave.length === 1 && presLeave[0].id === 'guest_B_id', 'Test 4: Guest A leaves, count converges to 1');

  // Test 5: Guest B remains connected after A leaves.
  assert(getRoomPresence(pRoomId).some(m => m.id === 'guest_B_id'), 'Test 5: Guest B remains connected after A leaves');

  // Test 6: Reconnect does not duplicate the same guest.
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  assert(getRoomPresence(pRoomId).length === 1, 'Test 6: Reconnect does not duplicate the same guest');

  // Test 7: Two different public rooms remain isolated.
  const otherRoomId = 'room-tech';
  updateRoomPresence(otherRoomId, {
    id: 'guest_C_id',
    nickname: 'Guest_C',
    avatar: '💻',
    isGuest: true,
    lastSeen: Date.now(),
  });
  assert(getRoomPresence(pRoomId).length === 1 && getRoomPresence(otherRoomId).length === 1, 'Test 7: Two different public rooms remain isolated');

  // Test 8: Stale-session cleanup does not remove an active guest.
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now() - 10000, // 10s ago (within 45s TTL)
  });
  assert(getRoomPresence(pRoomId).length === 1 && getRoomPresence(pRoomId)[0].id === 'guest_B_id', 'Test 8: Recent heartbeat prevents stale-session cleanup of active guest');

  // Test 9: Clients receive initial participant list and subsequent updates.
  const initialList = getRoomPresence(pRoomId);
  updateRoomPresence(pRoomId, {
    id: 'guest_D_id',
    nickname: 'Guest_D',
    avatar: '⚡',
    isGuest: true,
    lastSeen: Date.now(),
  });
  const updatedList = getRoomPresence(pRoomId);
  assert(initialList.length === 1 && updatedList.length === 2, 'Test 10: Clients receive initial participant list and subsequent updates');

  // Test 10: Public chat history remains intact after leave and rejoin.
  const msgRes = postRoomMessage({
    roomId: pRoomId,
    senderId: 'guest_B_id',
    senderNickname: 'Guest_B',
    senderAvatar: '🌸',
    senderType: 'guest',
    rawContent: 'Persistent message test',
  });
  removeRoomPresence(pRoomId, 'guest_B_id');
  updateRoomPresence(pRoomId, {
    id: 'guest_B_id',
    nickname: 'Guest_B',
    avatar: '🌸',
    isGuest: true,
    lastSeen: Date.now(),
  });
  const history = getRoomMessages(pRoomId);
  assert(history.some(m => m.content === 'Persistent message test'), 'Test 10: Public chat history remains intact after leave and rejoin');

  console.log('\n====================================================');
  console.log(` RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error('Fatal error running regression suite:', err);
  process.exit(1);
});
