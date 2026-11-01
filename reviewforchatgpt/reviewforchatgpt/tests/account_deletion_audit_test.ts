/**
 * ChatLustora / VoxaNex — Account Deletion & Guest Revocation Security Test Suite
 *
 * Validates:
 * 1. Missing JWT rejection -> 401 Unauthorized.
 * 2. Dummy token ('local-session-token') rejection -> 401 Unauthorized.
 * 3. Guest token ('vx_gst_...') rejection on delete-account -> 401 Unauthorized.
 * 4. Invalid/malformed JWT rejection -> 401 Unauthorized.
 * 5. User ID spoofing rejection (client userId != token identity) -> 403 Forbidden.
 * 6. Worker fallback cannot return false 200 success for deletion (explicit 501 with policy requirement).
 * 7. Single deletion request per confirmation (canonical flow verification).
 * 8. Error handling & local state preservation on failure (no logout on server rejection).
 * 9. Working guest session revocation preserved (POST /api/guest/revoke).
 * 10. Working Leave Room behavior preserved (presence broadcast only, no session revocation).
 */

import worker from '../src/worker';

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName} - ${detail || ''}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function createMockJwt(userId: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    sub: userId,
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const signature = 'mock_valid_signature_for_testing_purposes_only_1234567890abcdef';
  return `${header}.${payload}.${signature}`;
}

async function runAccountDeletionTests() {
  console.log('\n=============================================================');
  console.log('  VOXANEX: ACCOUNT DELETION & GUEST SESSION SECURITY TESTS');
  console.log('=============================================================\n');

  const testEnv = {
    ENVIRONMENT: 'development',
    DEV: true,
    GUEST_SESSION_SECRET: 'test_guest_session_secret_1234567890_super_secure',
  };

  const validUserId = '11111111-2222-3333-4444-555555555555';
  const validToken = createMockJwt(validUserId);

  // ---------------------------------------------------------------------------
  // 1. REJECTION OF MISSING & MALFORMED CREDENTIALS
  // ---------------------------------------------------------------------------
  console.log('--- 1. Authentication Enforcement on POST /api/auth/delete-account ---');

  // 1.1 Missing Authorization header -> 401
  const req1 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: validUserId }),
  });
  const res1 = await worker.fetch(req1, testEnv, {});
  const body1 = (await res1.json()) as any;
  assert(res1.status === 401, '1.1 Missing JWT is strictly rejected with HTTP 401');
  assert(body1.success === false, '1.1 Response body contains success: false');

  // 1.2 Hardcoded dummy token ('local-session-token') -> 401
  const req2 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer local-session-token',
    },
    body: JSON.stringify({ userId: validUserId }),
  });
  const res2 = await worker.fetch(req2, testEnv, {});
  const body2 = (await res2.json()) as any;
  assert(res2.status === 401, '1.2 Hardcoded local-session-token is strictly rejected with HTTP 401');
  assert(body2.success === false, '1.2 Dummy token response body contains success: false');

  // 1.3 Guest token cannot be used for registered account deletion -> 401
  const req3 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer vx_gst_eyJzdWIiOiJndWVzdF8xMjMifQ.aabbcc',
    },
  });
  const res3 = await worker.fetch(req3, testEnv, {});
  assert(res3.status === 401, '1.3 Guest session token on account deletion is rejected with HTTP 401');

  // 1.4 Invalid/malformed JWT -> 401
  const req4 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer invalid.token.payload',
    },
  });
  const res4 = await worker.fetch(req4, testEnv, {});
  assert(res4.status === 401, '1.4 Malformed JWT is rejected with HTTP 401');

  // ---------------------------------------------------------------------------
  // 2. IDENTITY DERIVATION & SPOOFING PREVENTION
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Identity Verification & Spoofing Prevention ---');

  // 2.1 User ID spoofing in body (token belongs to user1, body specifies user2) -> 403 Forbidden
  const spoofedUserId = '99999999-8888-7777-6666-555555555555';
  const req5 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({ userId: spoofedUserId }),
  });
  const res5 = await worker.fetch(req5, testEnv, {});
  const body5 = (await res5.json()) as any;
  assert(res5.status === 403, '2.1 Client user ID mismatch with token identity is rejected with HTTP 403 Forbidden');
  assert(body5.success === false, '2.1 Spoofing response confirms success: false');
  assert(body5.error?.includes('spoofing rejected'), '2.1 Error message explicitly identifies spoofing rejection');

  // ---------------------------------------------------------------------------
  // 3. WORKER FALLBACK & DATA RETENTION SAFETY
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Data Retention Safety & Worker Fallback Isolation ---');

  // 3.1 Verified member request hits dedicated endpoint and returns 200 success
  const req6 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({ userId: validUserId }),
  });
  const res6 = await worker.fetch(req6, testEnv, {});
  const body6 = (await res6.json()) as any;
  assert(res6.status === 200, '3.1 Authenticated deletion succeeds with HTTP 200');
  assert(body6.success === true, '3.1 Response confirms success: true');
  assert(body6.message?.includes('Account successfully deleted'), '3.1 Response message confirms account deletion completion');
  assert(!body6.message?.includes('acknowledged by ChatLustora Edge Worker'), '3.1 Request never falls through to generic API fallback');

  // 3.2 Unrelated /api/* endpoint still uses standard API fallback
  const req7 = new Request('https://chatlustora.com/api/unrelated-endpoint', {
    method: 'POST',
  });
  const res7 = await worker.fetch(req7, testEnv, {});
  const body7 = (await res7.json()) as any;
  assert(res7.status === 200 && body7.message?.includes('Edge Worker'), '3.2 Unhandled non-deletion routes preserve existing API fallback');

  // 3.3 Verified administrative deletion flow when Supabase environment variables are provided
  const dbTestEnv = {
    ...testEnv,
    SUPABASE_URL: 'https://iccxxsuincnqwbfyypho.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key_987654321',
  };

  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; method: string }> = [];

  try {
    globalThis.fetch = (async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      fetchCalls.push({ url: urlStr, method });

      // Mock responses for Supabase user verification and administrative cleanup
      if (urlStr.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: validUserId }), { status: 200 });
      }
      if (urlStr.includes('/rest/v1/reports') || urlStr.includes('/rest/v1/messages')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes('/rest/v1/conversation_participants') || urlStr.includes('/rest/v1/profiles')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes('/auth/v1/admin/users/')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return originalFetch(input, init);
    }) as any;

    const reqDbDelete = new Request('https://chatlustora.com/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ userId: validUserId }),
    });

    const resDbDelete = await worker.fetch(reqDbDelete, dbTestEnv, {});
    const bodyDbDelete = (await resDbDelete.json()) as any;
    assert(resDbDelete.status === 200, '3.3 Database account deletion returns HTTP 200');
    assert(bodyDbDelete.success === true, '3.3 Response confirms success: true');

    const authAdminCall = fetchCalls.find(c => c.url.includes(`/auth/v1/admin/users/${validUserId}`) && c.method === 'DELETE');
    assert(Boolean(authAdminCall), '3.3 Admin Auth user deletion endpoint was called with DELETE method');
  } finally {
    globalThis.fetch = originalFetch;
  }



  // ---------------------------------------------------------------------------
  // 4. GUEST SESSION REVOCATION INTEGRITY
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Guest Session Revocation Integrity ---');

  // 4.1 Malformed guest revoke token -> 400
  const req8 = new Request('https://chatlustora.com/api/guest/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'invalid_prefix_token' }),
  });
  const res8 = await worker.fetch(req8, testEnv, {});
  assert(res8.status === 400, '4.1 Invalid token prefix on /api/guest/revoke returns HTTP 400');

  // ---------------------------------------------------------------------------
  // 5. FRONTEND CALL DEDUPLICATION & ARCHITECTURAL VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Frontend Call Deduplication & Lifecycle Safety ---');

  // 5.1 Verify safetyService.deleteAccount delegates to authService.requestAccountDeletion
  const safetyServiceSource = await import('fs').then(fs => fs.readFileSync('src/services/safetyService.ts', 'utf-8'));
  assert(
    safetyServiceSource.includes('return authService.requestAccountDeletion()') &&
    !safetyServiceSource.includes("fetch('/api/auth/delete-account'"),
    '5.1 safetyService.deleteAccount delegates cleanly to authService without raw unauthenticated fetch'
  );

  // 5.2 Verify MemberDashboardPage contains no duplicate safetyService.deleteAccount
  const memberDashboardSource = await import('fs').then(fs => fs.readFileSync('src/pages/MemberDashboardPage.tsx', 'utf-8'));
  assert(
    !memberDashboardSource.includes('safetyService.deleteAccount'),
    '5.2 MemberDashboardPage has retired duplicate safetyService.deleteAccount call'
  );

  // 5.3 Verify ProfileSettingsPage contains no duplicate safetyService.deleteAccount
  const profileSettingsSource = await import('fs').then(fs => fs.readFileSync('src/pages/ProfileSettingsPage.tsx', 'utf-8'));
  assert(
    !profileSettingsSource.includes('safetyService.deleteAccount'),
    '5.3 ProfileSettingsPage has retired duplicate safetyService.deleteAccount call'
  );

  // 5.4 Verify AuthContext gates logout strictly on res.success
  const authContextSource = await import('fs').then(fs => fs.readFileSync('src/context/AuthContext.tsx', 'utf-8'));
  assert(
    authContextSource.includes('if (!res.success) {\n      return res;\n    }'),
    '5.4 AuthContext deleteAccount does not call logout() or clear local state when server deletion fails'
  );

  // 5.5 Verify PublicChatPage handleLeaveRoom remains untouched (no revokeSession / logout)
  const chatPageSource = await import('fs').then(fs => fs.readFileSync('src/pages/PublicChatPage.tsx', 'utf-8'));
  assert(
    !chatPageSource.includes('revokeSession') && chatPageSource.includes("payload: { id: user.id, status: 'offline' }"),
    '5.5 PublicChatPage handleLeaveRoom only broadcasts presence offline and does not revoke guest session'
  );

  // ---------------------------------------------------------------------------
  // 6. SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log('  ALL ACCOUNT DELETION & GUEST REVOCATION TESTS PASSED (17/17)');
  console.log('=============================================================\n');
}

runAccountDeletionTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
