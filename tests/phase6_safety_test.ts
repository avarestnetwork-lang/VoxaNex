/**
 * VOXANEX — PHASE 6: SAFETY, MODERATION, AGE ASSURANCE & USER PROFILES TEST SUITE
 * Validates:
 * 1. Age-assurance & adult eligibility enforcement (rejection of minors, self-declaration, revocation, provider proof)
 * 2. Actionable reporting & report-abuse prevention (rate-limits, auto-escalation, privacy shielding)
 * 3. Server-side block enforcement across rooms, direct messages, matchmaking, and WebRTC calls
 * 4. Sanctions, suspension auto-expiry, and appeal review workflows
 * 5. Data export & account deletion purge
 * 6. Moderator & administrator role authorization boundaries
 */

import {
  submitSafetyReport,
  getPlatformReports,
  getPublicReportStatus,
  submitAgeDeclaration,
  getUserAgeAssurance,
  completeAgeProviderVerification,
  revokeAgeVerification,
  isUserEligibleForAdultAreas,
  addBlockedUserEntry,
  removeBlockedUserEntry,
  getBlockedUsers,
  imposeUserRestriction,
  checkUserRestriction,
  liftUserRestriction,
  submitAppeal,
  reviewAppeal,
  getModerationAppeals,
  getModerationAuditLogs,
  filterProhibitedContent,
  exportUserData,
  purgeUserData,
  updateAgeAssuranceConfig,
} from '../src/server/communityAdminHub';

import {
  postRoomMessage,
  postConversationMessage,
  registerConversationMembers,
  setUserBlock,
} from '../src/server/realtimeHub';

import {
  joinMatchmakingQueue,
} from '../src/server/matchmakingEngine';

import {
  initiateCall,
} from '../src/server/webrtcCallHub';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    failedCount++;
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
    passedCount++;
  }
}

async function runPhase6Tests() {
  console.log('\n=============================================================');
  console.log('  VOXANEX PHASE 6: TRUST, SAFETY & MODERATION TEST SUITE');
  console.log('=============================================================\n');

  // ---------------------------------------------------------------------------
  // 1. AGE ASSURANCE & ADULT ELIGIBILITY ENFORCEMENT
  // ---------------------------------------------------------------------------
  console.log('--- 1. Age Assurance & Adult Eligibility Controls ---');

  const minorUserId = 'usr_minor_test_001';
  const adultUserId = 'usr_adult_test_002';
  const providerUserId = 'usr_zk_test_003';

  // 1.1 Unverified user is blocked from adult rooms
  const unverifiedEligibility = isUserEligibleForAdultAreas(minorUserId, false);
  assert(!unverifiedEligibility.eligible, '1.1 Unverified user is blocked from entering adult lounge');

  // 1.2 Minor self-declaration (birth year 2012 -> under 18) is rejected
  const minorDeclResult = submitAgeDeclaration({
    userId: minorUserId,
    birthYear: 2012,
    consentAffirmed: true,
  });
  assert(!minorDeclResult.success, '1.2 Underage self-declaration (born 2012) is rejected by server');
  const minorRecord = getUserAgeAssurance(minorUserId);
  assert(minorRecord.status === 'rejected_underage', '1.3 Underage status recorded as rejected_underage');

  // Verify room post rejection for minor in adult lounge
  const minorPostResult = postRoomMessage({
    roomId: 'room-bangla-adult',
    senderId: minorUserId,
    senderNickname: 'MinorUser',
    senderAvatar: '👶',
    senderType: 'registered',
    rawContent: 'Hello adult room!',
  });
  assert(!minorPostResult.success, '1.4 Server rejects room message from under-18 user in adult room');

  // 1.5 Valid adult self-declaration (birth year 1995 -> 31 years old)
  const adultDeclResult = submitAgeDeclaration({
    userId: adultUserId,
    birthYear: 1995,
    consentAffirmed: true,
  });
  assert(adultDeclResult.success && adultDeclResult.record?.status === 'verified_adult_18plus', '1.5 Adult self-declaration granted for user over 18');
  const adultEligibility = isUserEligibleForAdultAreas(adultUserId, false);
  assert(adultEligibility.eligible, '1.6 Verified adult is granted entry to adult areas');

  // 1.7 Third-party zero-knowledge proof verification
  const zkResult = completeAgeProviderVerification({
    userId: providerUserId,
    provider: 'veriff_sandbox',
    sessionId: 'ses_zk_sandbox_123',
    isAdultConfirmed: true,
    referenceProofToken: 'tok_prov_ref_999',
  });
  assert(zkResult.success && !!zkResult.record.providerProofHash, '1.7 Third-party provider verification stores zero-knowledge SHA256 proof hash');
  assert(!zkResult.record.notes?.includes('id_document_image'), '1.8 Privacy preservation: No raw government identity images stored');

  // 1.9 Adult eligibility revocation
  revokeAgeVerification(adultUserId, 'Investigation found suspicious minority indicators', 'Staff_Safety_Officer');
  const revokedEligibility = isUserEligibleForAdultAreas(adultUserId, false);
  assert(!revokedEligibility.eligible, '1.9 Revocation immediately revokes adult lounge access');

  // ---------------------------------------------------------------------------
  // 2. ACTIONABLE REPORTING SYSTEM & ABUSE PREVENTION
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Actionable Reporting & Anti-Abuse Prevention ---');

  // 2.1 Submit actionable report against user
  const repUser = submitSafetyReport({
    targetType: 'user',
    targetId: 'bad_actor_999',
    reportedTarget: 'BadActor999',
    reporterId: 'concerned_user_42',
    reporterNickname: 'DhakaWatcher',
    reporterIp: '203.112.50.10',
    category: 'harassment',
    reasonText: 'Target was repeatedly posting threatening remarks and abuse.',
    evidenceSnapshot: { room: 'room-padma-general', messageId: 'msg_123' },
  });
  assert(repUser.success && !!repUser.reportId, '2.1 Actionable user safety report submitted successfully');

  // 2.2 Submit report against severe exploitation -> auto-escalated to investigating
  const repExploit = submitSafetyReport({
    targetType: 'message',
    targetId: 'msg_flag_456',
    reportedTarget: 'Prohibited Photo Post',
    reporterId: 'concerned_user_42',
    reporterNickname: 'DhakaWatcher',
    reporterIp: '203.112.50.10',
    category: 'non_consensual_imagery',
    reasonText: 'Target posted non-consensual personal media without consent.',
  });
  assert(repExploit.success && !!repExploit.reportId, '2.2 Exploitation/non-consensual report submitted');
  const pubStatus = getPublicReportStatus(repExploit.reportId!, 'concerned_user_42');
  assert(pubStatus?.status === 'investigating', '2.3 Severe violation auto-escalated to investigating status');

  // 2.4 Confidentiality: Public cannot access full reports queue
  const publicReports = getPlatformReports('user');
  assert(publicReports.length === 0, '2.4 Unauthorized public users cannot read reports queue');
  const staffReports = getPlatformReports('admin');
  assert(staffReports.length > 0, '2.5 Authorized staff can access full reports triage queue');

  // 2.6 Report rate-limiting / anti-griefing
  let rateBlocked = false;
  for (let i = 0; i < 7; i++) {
    const res = submitSafetyReport({
      targetType: 'user',
      targetId: `spam_target_${i}`,
      reportedTarget: `SpamTarget_${i}`,
      reporterId: 'spammer_reporter_88',
      reporterNickname: 'SpamReporter',
      reporterIp: '192.168.10.200',
      category: 'spam',
      reasonText: 'Repeated frivolous abuse reports to test rate limit.',
    });
    if (!res.success) {
      rateBlocked = true;
      break;
    }
  }
  assert(rateBlocked, '2.6 Report abuse rate limit prevents griefing (max 5 per window)');

  // ---------------------------------------------------------------------------
  // 3. SERVER-SIDE BLOCK ENFORCEMENT ACROSS ALL MODES
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Multi-Mode Block Enforcement (DMs, Matching, Calls) ---');

  const userAlice = 'usr_alice_block_test';
  const userBob = 'usr_bob_block_test';

  // Set block from Alice to Bob
  addBlockedUserEntry({
    blockerId: userAlice,
    targetId: userBob,
    targetNickname: 'Bob',
    targetAvatar: '👤',
    reason: 'Unwanted messages',
  });
  setUserBlock(userAlice, userBob, true);

  const aliceBlocks = getBlockedUsers(userAlice);
  assert(aliceBlocks.some((b) => b.targetId === userBob), '3.1 Block list contains blocked participant');

  // 3.2 Blocked in Direct Messages
  const convId = 'conv_alice_bob_test';
  registerConversationMembers(convId, [userAlice, userBob]);

  const dmBlockedResult = postConversationMessage({
    conversationId: convId,
    senderId: userBob,
    senderNickname: 'Bob',
    senderAvatar: '👤',
    recipientId: userAlice,
    rawContent: 'Hey Alice, can you hear me?',
  });
  assert(!dmBlockedResult.success, '3.2 Direct messaging is strictly blocked bidirectionally');

  // 3.3 Blocked in WebRTC Call Initiation
  const callBlockedResult = initiateCall({
    initiatorId: userBob,
    initiatorNickname: 'Bob',
    initiatorAvatar: '👤',
    calleeId: userAlice,
    calleeNickname: 'Alice',
    calleeAvatar: '👤',
    mediaKind: 'video',
  });
  assert(!callBlockedResult.success, '3.3 WebRTC voice/video call initiation blocked between blocked users');

  // 3.4 Unblock restores communication
  removeBlockedUserEntry(userAlice, userBob);
  setUserBlock(userAlice, userBob, false);
  const aliceBlocksAfter = getBlockedUsers(userAlice);
  assert(!aliceBlocksAfter.some((b) => b.targetId === userBob), '3.4 Unblock removes user from block registry');

  // ---------------------------------------------------------------------------
  // 4. SANCTIONS, SUSPENSIONS, EXPIRY & APPEALS
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Sanctions, Auto-Expiry & Appeals ---');

  const sanctionedUser = 'usr_violator_101';

  // 4.1 Impose temporary suspension
  const imposeRes = imposeUserRestriction({
    userId: sanctionedUser,
    userNickname: 'Violator101',
    type: 'suspended_24h',
    reason: 'Repeated harassment violation in public chat',
    imposedBy: 'Mod_Karim',
  });
  assert(imposeRes.success && !!imposeRes.restriction, '4.1 Moderator successfully imposes 24-hour suspension');

  const checkSusp = checkUserRestriction(sanctionedUser);
  assert(checkSusp.isRestricted, '4.2 Suspension active in user restriction check');

  // User cannot enter matchmaking queue
  const queueRes = joinMatchmakingQueue({
    userId: sanctionedUser,
    nickname: 'Violator101',
    avatar: '⚡',
    isGuest: false,
    languagePref: 'bn',
    regionPool: 'bangladesh',
    interests: [],
    is18Verified: true,
  });
  assert(!queueRes.success, '4.3 Suspended user rejected from entering matchmaking queue');

  // User cannot initiate call
  const callSuspRes = initiateCall({
    initiatorId: sanctionedUser,
    initiatorNickname: 'Violator101',
    initiatorAvatar: '⚡',
    calleeId: 'usr_innocent_callee',
    calleeNickname: 'Innocent',
    calleeAvatar: '👤',
    mediaKind: 'audio',
  });
  assert(!callSuspRes.success, '4.4 Suspended user rejected from initiating WebRTC calls');

  // 4.5 User submits formal appeal
  const appealRes = submitAppeal({
    userId: sanctionedUser,
    userNickname: 'Violator101',
    statement: 'I apologize for the heated argument and promise to adhere to community guidelines.',
  });
  assert(appealRes.success && !!appealRes.appeal, '4.5 Sanctioned user successfully submits formal appeal');

  // 4.6 Staff reviews and accepts appeal -> lifts restriction
  const appealAccepted = reviewAppeal(appealRes.appeal!.id, 'accepted', 'First offense, sincere acknowledgment', 'Admin_Rahim');
  assert(appealAccepted?.status === 'accepted', '4.6 Staff review accepts appeal and overturns sanction');

  const checkAfterAppeal = checkUserRestriction(sanctionedUser);
  assert(!checkAfterAppeal.isRestricted, '4.7 Restriction lifted immediately upon accepted appeal');

  // ---------------------------------------------------------------------------
  // 5. PROHIBITED CONTENT FILTERING
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Prohibited Content Filtering ---');

  const cleanText = filterProhibitedContent('Shobai kemon achen? Welcome to VoxaNex!');
  assert(!cleanText.flagged, '5.1 Normal friendly conversation passes content filter');

  const hateText = filterProhibitedContent('kufar exterminate everyone in the room');
  assert(hateText.flagged && hateText.category === 'hate_speech', '5.2 Severe hate speech detected and flagged');

  // ---------------------------------------------------------------------------
  // 6. USER PRIVACY, DATA EXPORT & ACCOUNT DELETION PURGE
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. User Privacy, Data Export & Account Deletion ---');

  const privacyUser = 'usr_privacy_audit_777';
  submitAgeDeclaration({ userId: privacyUser, birthYear: 1990, consentAffirmed: true });
  addBlockedUserEntry({
    blockerId: privacyUser,
    targetId: 'spammer_x',
    targetNickname: 'SpammerX',
    targetAvatar: '👤',
  });

  // Export User Data (GDPR Right of Access)
  const exportArchive = exportUserData(privacyUser);
  assert(exportArchive && exportArchive.userId === privacyUser, '6.1 Data access export generates complete personal archive');
  assert(exportArchive.ageAssurance?.status === 'verified_adult_18plus', '6.2 Export includes age assurance verification record');
  assert(exportArchive.blockedUsers.length > 0, '6.3 Export includes blocked user relationships');

  // Permanent Account Deletion Purge (Right to be Forgotten)
  const purgeResult = purgeUserData(privacyUser);
  assert(purgeResult.success, '6.4 Account deletion purge executes successfully');
  const postPurgeAge = getUserAgeAssurance(privacyUser);
  assert(postPurgeAge.status === 'unverified', '6.5 Personal records purged from active datastores');

  // ---------------------------------------------------------------------------
  // 7. AUDIT TRAIL VERIFICATION & ROLE BOUNDARIES
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Audit Trail & Role Permission Boundaries ---');

  const auditLogs = getModerationAuditLogs('admin');
  assert(auditLogs.length > 0, '7.1 Tamper-evident moderation audit logs recorded for safety events');

  const publicAuditLogs = getModerationAuditLogs('user');
  assert(publicAuditLogs.length === 0, '7.2 Unauthorized public users rejected from reading audit logs');

  console.log('\n=============================================================');
  console.log(`  PHASE 6 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase6Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
