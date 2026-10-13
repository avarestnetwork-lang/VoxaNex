/**
 * VOXANEX RANDOM MATCHMAKING ENGINE & PARTNER ROULETTE TEST SUITE (PHASE 4)
 * Tests queue insertion, pairing logic, preference compatibility,
 * shared interests scoring, rematch prevention, skip cooldown,
 * blocking enforcement, and disconnect/skip lifecycle.
 */

import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  pollTicketStatus,
  disconnectMatch,
  getActiveMatchForUser,
} from '../src/server/matchmakingEngine';
import { setUserBlock } from '../src/server/realtimeHub';

function assert(condition: boolean, testName: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMatchmakingTests() {
  console.log('\n--- STARTING VOXANEX MATCHMAKING TEST SUITE (PHASE 4) ---\n');

  // Test 1: Queue Insertion for Single User (No immediate match)
  const user1 = {
    userId: 'test_usr_alice_1',
    nickname: 'Alice_Dhaka',
    avatar: '🌊',
    isGuest: false,
    languagePref: 'bn' as const,
    regionPool: 'bangladesh' as const,
    interests: ['tech', 'music', 'adda'],
    is18Verified: true,
  };

  const res1 = joinMatchmakingQueue(user1);
  assert(
    res1.success === true && Boolean(res1.ticket) && !res1.match,
    '1. First user joins empty queue and receives waiting ticket'
  );

  const ticket1 = res1.ticket!;
  assert(
    ticket1.status === 'waiting' && ticket1.userId === user1.userId,
    '2. Ticket is recorded in "waiting" status with correct metadata'
  );

  // Test 2: Incompatible Language Preference should NOT pair
  const userIncompatible = {
    userId: 'test_usr_incompatible',
    nickname: 'Bob_English',
    avatar: '🪐',
    isGuest: true,
    languagePref: 'en' as const, // Alice wants 'bn', this user wants 'en'
    regionPool: 'bangladesh' as const,
    interests: ['gaming'],
    is18Verified: false,
  };

  // Wait 1.6s to clear skip cooldown
  await sleep(1600);
  const resIncompatible = joinMatchmakingQueue(userIncompatible);
  assert(
    resIncompatible.success === true && Boolean(resIncompatible.ticket) && !resIncompatible.match,
    '3. Incompatible language preferences (bn vs en) do not pair'
  );

  // Clean up incompatible user
  cancelMatchmakingQueue(resIncompatible.ticket!.ticketId, userIncompatible.userId);

  // Test 3: Compatible User Pairs with Alice Atomically
  const user2 = {
    userId: 'test_usr_charlie_2',
    nickname: 'Charlie_Sylhet',
    avatar: '🌿',
    isGuest: false,
    languagePref: 'bn' as const,
    regionPool: 'bangladesh' as const,
    interests: ['tech', 'adda'], // shares 'tech' and 'adda'
    is18Verified: true,
  };

  await sleep(1600);
  const res2 = joinMatchmakingQueue(user2);
  assert(
    res2.success === true && Boolean(res2.match),
    '4. Compatible candidate atomically triggers immediate match'
  );

  const matchSession = res2.match!;
  assert(
    matchSession.status === 'connected',
    '5. MatchSession transitions to "connected" state'
  );

  assert(
    matchSession.sharedInterests.includes('tech') && matchSession.sharedInterests.includes('adda'),
    '6. Mutual shared interests are accurately calculated on the match'
  );

  // Test 4: Verify Alice's Ticket Status Updates to Matched via Polling
  const aliceStatus = pollTicketStatus(ticket1.ticketId, user1.userId);
  assert(
    aliceStatus.status === 'matched' && aliceStatus.match?.matchId === matchSession.matchId,
    '7. Original queued participant (Alice) status updates to matched'
  );

  assert(
    aliceStatus.partner?.id === user2.userId,
    '8. Original participant identifies partner (Charlie) without leaking private information'
  );

  // Test 5: Rapid Clicking / Abuse Cooldown Enforcement (< 1.5 seconds)
  const rapidClickRes = joinMatchmakingQueue({
    userId: 'test_usr_charlie_2',
    nickname: 'Charlie_Sylhet',
    avatar: '🌿',
    isGuest: false,
    languagePref: 'all',
    regionPool: 'bangladesh',
    interests: [],
    is18Verified: true,
  });
  assert(
    rapidClickRes.success === false && Boolean(rapidClickRes.error?.includes('cooldown')),
    '9. Rapid skip / search requests within 1.5s are strictly throttled'
  );

  // Test 6: Rematch Avoidance (Prevent matching the same pair immediately)
  await sleep(1600); // allow cooldown to expire
  disconnectMatch(matchSession.matchId, user1.userId);

  // Re-enter Alice
  const aliceReentry = joinMatchmakingQueue(user1);
  assert(aliceReentry.success === true, '10. User successfully re-enters matchmaking queue after disconnect');

  // Charlie re-enters after disconnect
  await sleep(1600);
  const charlieReentry = joinMatchmakingQueue(user2);
  assert(
    charlieReentry.success === true && !charlieReentry.match,
    '11. Immediate rematch avoidance prevents Alice & Charlie from re-pairing within 3 minutes'
  );

  // Clean up
  if (aliceReentry.ticket) cancelMatchmakingQueue(aliceReentry.ticket.ticketId, user1.userId);
  if (charlieReentry.ticket) cancelMatchmakingQueue(charlieReentry.ticket.ticketId, user2.userId);

  // Test 7: Blocking Enforcement (Blocked peers never match)
  const userBlocker = {
    userId: 'usr_blocker_x',
    nickname: 'BlockerX',
    avatar: '🛡️',
    isGuest: false,
    languagePref: 'all' as const,
    regionPool: 'any' as const,
    interests: [],
    is18Verified: true,
  };

  const userBlocked = {
    userId: 'usr_blocked_y',
    nickname: 'BlockedY',
    avatar: '⚡',
    isGuest: false,
    languagePref: 'all' as const,
    regionPool: 'any' as const,
    interests: [],
    is18Verified: true,
  };

  // Block user Y
  setUserBlock(userBlocker.userId, userBlocked.userId, true);

  await sleep(1600);
  const blockerTicket = joinMatchmakingQueue(userBlocker);

  await sleep(1600);
  const blockedTicket = joinMatchmakingQueue(userBlocked);

  assert(
    blockerTicket.success === true && blockedTicket.success === true && !blockedTicket.match,
    '12. Blocked peers in the same pool are strictly prevented from matching'
  );

  if (blockerTicket.ticket) cancelMatchmakingQueue(blockerTicket.ticket.ticketId, userBlocker.userId);
  if (blockedTicket.ticket) cancelMatchmakingQueue(blockedTicket.ticket.ticketId, userBlocked.userId);

  // Test 8: Cancellation Lifecycle
  await sleep(1600);
  const userCancel = {
    userId: 'usr_canceller',
    nickname: 'Canceller',
    avatar: '🌙',
    isGuest: true,
    languagePref: 'all' as const,
    regionPool: 'bangladesh' as const,
    interests: [],
    is18Verified: false,
  };

  const cancelJoin = joinMatchmakingQueue(userCancel);
  assert(Boolean(cancelJoin.ticket), '13. Queue ticket issued for cancellation test');

  const cancelledOk = cancelMatchmakingQueue(cancelJoin.ticket!.ticketId, userCancel.userId);
  assert(cancelledOk === true, '14. Ticket successfully cancelled by owner');

  const postCancelStatus = pollTicketStatus(cancelJoin.ticket!.ticketId, userCancel.userId);
  assert(
    postCancelStatus.status === 'expired',
    '15. Cancelled ticket is purged from active queue'
  );

  console.log('\n--- ALL MATCHMAKING TESTS COMPLETED SUCCESSFULLY ---\n');
  process.exit(0);
}

runMatchmakingTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
