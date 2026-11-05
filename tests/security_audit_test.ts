// Set mandatory secret for tests
process.env.GUEST_SESSION_SECRET = 'test_secret_for_audit_only';

import {
  createGuestSession,
  validateGuestToken,
  revokeGuestSession,
} from '../src/server/guestSessionManager';

function assert(condition: boolean, testName: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runSecurityTests() {
  console.log('\n--- STARTING VOXANEX SECURITY AUDIT TESTS ---\n');

  // Test 1: Valid Guest Token Generation
  const issueResult = createGuestSession({
    nickname: 'Test_Guest_Padma',
    avatar: '🌊',
    languagePref: 'bn',
    is18Verified: false,
    ipAddress: '192.168.1.10',
  });

  assert(issueResult.success === true && !!issueResult.session, '1. Server issues valid cryptographic guest token');
  const token = issueResult.session!.token;
  assert(token.startsWith('vx_gst_'), '2. Token format conforms to vx_gst_ namespace standard');

  // Test 2: Token Validation
  const validCheck = validateGuestToken(token);
  assert(validCheck.valid === true, '3. Cryptographic token signature successfully verifies');
  assert(validCheck.session?.nickname === 'Test_Guest_Padma', '4. Validated session payload matches issued identity');

  // Test 3: Anti-Tampering Protection (altering payload bytes)
  const parts = token.slice('vx_gst_'.length).split('.');
  const tamperedBase64 = parts[0] + 'x'; // Corrupt payload
  const tamperedToken = `vx_gst_${tamperedBase64}.${parts[1]}`;
  const tamperedCheck = validateGuestToken(tamperedToken);
  assert(tamperedCheck.valid === false, '5. Tampered token payload is strictly rejected by signature check');

  // Test 4: Missing/Empty Token Rejection
  const missingCheck = validateGuestToken('');
  assert(missingCheck.valid === false, '6. Empty/missing token is strictly rejected');

  // Test 5: Session Revocation
  revokeGuestSession(token);
  const checkAfterRevoke = validateGuestToken(token);
  assert(checkAfterRevoke.valid === false, '7. Revoked token is immediately rejected');

  // Test 6: Rate Limiting Enforcement
  const spamIp = '10.0.0.99';
  let rejected = false;
  for (let i = 0; i < 25; i++) {
    const res = createGuestSession({
      nickname: `SpamUser_${i}`,
      avatar: '⚡',
      languagePref: 'en',
      is18Verified: false,
      ipAddress: spamIp,
    });
    if (!res.success) {
      rejected = true;
      break;
    }
  }
  assert(rejected === true, '8. Excessive session requests trigger rate limit threshold rejection');
  
  // Test 7: Verify Identity Mapping
  assert(validCheck.session?.id === issueResult.session?.id, '9. Session identity is strictly mapped from issued token');

  console.log('\n--- ALL SECURITY TESTS COMPLETED SUCCESSFULLY ---\n');
}

runSecurityTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
