/**
 * VOXANEX WEBRTC CALLING & SIGNALING TEST SUITE (PHASE 5)
 * Verifies STUN/TURN configuration, authenticated call initiation,
 * incoming call dispatch, acceptance, rejection, ending,
 * rate limiting, and block enforcement.
 */

import {
  getIceServers,
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,
  postSignal,
  getCallSession,
  getActiveCallForUser,
  checkCallRateLimit,
} from '../src/server/webrtcCallHub';
import { setUserBlock } from '../src/server/realtimeHub';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`✅ ${message}`);
}

async function runWebRTCTests() {
  console.log('--- STARTING VOXANEX WEBRTC & MEDIA CALLING TESTS (PHASE 5) ---\n');

  // 1. ICE Servers configuration
  console.log('Test 1: STUN & TURN server resolution...');
  const iceServers = getIceServers();
  assert(iceServers.length > 0, '1. ICE servers array is populated');
  assert(
    Boolean(iceServers.some((s) => JSON.stringify(s.urls).includes('stun:stun.l.google.com'))),
    '1. STUN server includes standard Google STUN'
  );

  // 2. Call rate limiting
  console.log('\nTest 2: Call initiation rate limiting...');
  const u1 = 'test_user_webrtc_1';
  const u2 = 'test_user_webrtc_2';
  const rate1 = checkCallRateLimit(u1);
  assert(rate1.allowed === true, '2. Initial call attempt is permitted');
  const rate2 = checkCallRateLimit(u1);
  assert(rate2.allowed === false, '2. Rapid call within 4s cooldown is blocked');

  // Wait 4.1s for cooldown to clear
  console.log('Waiting 4.1s for rate limit cooldown...');
  await new Promise((r) => setTimeout(r, 4100));

  // 3. Initiate 1-on-1 Audio/Video Call
  console.log('\nTest 3: Initiating authorized 1-on-1 call session...');
  const initRes = initiateCall({
    initiatorId: u1,
    initiatorNickname: 'Call_Initiator',
    initiatorAvatar: '📞',
    calleeId: u2,
    calleeNickname: 'Call_Recipient',
    calleeAvatar: '🎧',
    mediaKind: 'video',
    conversationId: 'conv_webrtc_test',
  });

  assert(initRes.success === true && Boolean(initRes.call), '3. Call initiated successfully with callId');
  const callId = initRes.call!.callId;
  assert(initRes.call!.status === 'ringing', '3. Initial state is ringing');

  // 4. Duplicate concurrent call prevention
  console.log('\nTest 4: Duplicate concurrent call prevention...');
  const dupRes = initiateCall({
    initiatorId: u1,
    initiatorNickname: 'Call_Initiator',
    initiatorAvatar: '📞',
    calleeId: 'test_user_webrtc_3',
    calleeNickname: 'Third_Party',
    calleeAvatar: '👤',
    mediaKind: 'audio',
  });
  assert(dupRes.success === false, '4. Initiator cannot place second concurrent call while in a call');

  // 5. Accept Call
  console.log('\nTest 5: Recipient accepts call...');
  const acceptRes = acceptCall(callId, u2);
  assert(acceptRes.success === true && Boolean(acceptRes.call), '5. Recipient accepts call session');
  assert(acceptRes.call!.status === 'connecting', '5. Call state transitions to connecting');

  // 6. Signal Relay (SDP Offer, Answer, ICE Candidate)
  console.log('\nTest 6: WebRTC signal dispatch...');
  const offerRes = postSignal({
    callId,
    senderId: u1,
    type: 'offer',
    payload: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1...' },
  });
  assert(offerRes.success === true, '6. Offer relayed from initiator');

  const answerRes = postSignal({
    callId,
    senderId: u2,
    type: 'answer',
    payload: { type: 'answer', sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1...' },
  });
  assert(answerRes.success === true, '6. Answer relayed from recipient');

  const iceRes = postSignal({
    callId,
    senderId: u1,
    type: 'ice_candidate',
    payload: { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host' },
  });
  assert(iceRes.success === true, '6. ICE candidate relayed');

  // 7. Verify Active Call Query
  console.log('\nTest 7: Active call verification...');
  const activeCall1 = getActiveCallForUser(u1);
  assert(Boolean(activeCall1) && activeCall1!.callId === callId, '7. Initiator has registered active call');
  const activeCall2 = getActiveCallForUser(u2);
  assert(Boolean(activeCall2) && activeCall2!.callId === callId, '7. Recipient has registered active call');

  // 8. End Call
  console.log('\nTest 8: Ending call...');
  const endRes = endCall(callId, u1, 'Normal hangup');
  assert(endRes.success === true, '8. Call ended cleanly');
  assert(getActiveCallForUser(u1) === null, '8. User 1 has no active call after hangup');
  assert(getActiveCallForUser(u2) === null, '8. User 2 has no active call after hangup');

  // 9. Blocked user cannot initiate call
  console.log('\nTest 9: Block enforcement on calling...');
  const uBlocker = 'user_blocker_5';
  const uBlocked = 'user_blocked_5';
  setUserBlock(uBlocker, uBlocked, true);

  const blockedCallRes = initiateCall({
    initiatorId: uBlocked,
    initiatorNickname: 'BlockedUser',
    initiatorAvatar: '🚫',
    calleeId: uBlocker,
    calleeNickname: 'BlockerUser',
    calleeAvatar: '🛡️',
    mediaKind: 'audio',
  });
  assert(
    blockedCallRes.success === false && Boolean(blockedCallRes.error?.includes('blocked')),
    '9. Blocked users cannot place calls to blocker'
  );

  console.log('\n--- ALL PHASE 5 WEBRTC CALLING TESTS COMPLETED SUCCESSFULLY ---\n');
  process.exit(0);
}

runWebRTCTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
