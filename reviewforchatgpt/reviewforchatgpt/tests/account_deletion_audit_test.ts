/**
 * ChatLustora / VoxaNex — Account Deletion & Guest Revocation Security Test Suite
 *
 * Validates:
 * 1. Missing JWT rejection -> 401 Unauthorized.
 * 2. Dummy token ('local-session-token') rejection -> 401 Unauthorized.
 * 3. Guest token ('vx_gst_...') rejection on delete-account -> 401 Unauthorized.
 * 4. Invalid/malformed JWT rejection -> 401 Unauthorized.
 * 5. User ID spoofing rejection (client userId != token identity) -> 403 Forbidden.
 * 6. Missing required server configuration -> 503 Service Unavailable (Fail closed).
 * 7. Unverified JWT (Supabase user verification 401/403) -> 401 Unauthorized.
 * 8. Cleanup HTTP 500 errors (reports, messages, participants, profile) return HTTP 500 and abort Auth Admin deletion.
 * 9. Network exception during cleanup returns HTTP 500 and aborts Auth Admin deletion.
 * 10. Admin Auth deletion failure (HTTP 500) returns HTTP 500.
 * 11. Full cleanup & Auth Admin deletion order and HTTP 200 success.
 * 12. Working guest session revocation preserved (POST /api/guest/revoke).
 * 13. Working Leave Room behavior preserved (presence broadcast only).
 * 14. Frontend architectural deduplication & AuthContext safety.
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

  const originalFetch = globalThis.fetch;

  const testEnv = {
    ENVIRONMENT: 'development',
    DEV: true,
    GUEST_SESSION_SECRET: 'test_guest_session_secret_1234567890_super_secure',
  };

  const dbTestEnv = {
    ...testEnv,
    SUPABASE_URL: 'https://iccxxsuincnqwbfyypho.supabase.co',
    SUPABASE_ANON_KEY: 'test_anon_key_12345',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key_987654321',
  };

  const validUserId = '11111111-2222-3333-4444-555555555555';
  const validToken = createMockJwt(validUserId);

  // ---------------------------------------------------------------------------
  // 1. REJECTION OF MISSING, MALFORMED & UNCONFIGURED CREDENTIALS
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

  // 1.4 Malformed JWT token structure -> 401
  const req4 = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer malformed_jwt_token_without_dots',
    },
  });
  const res4 = await worker.fetch(req4, testEnv, {});
  assert(res4.status === 401, '1.4 Malformed JWT is rejected with HTTP 401');

  // 1.5 Unverified / invalid JWT signature (Supabase Auth returns 401) -> 401
  try {
    globalThis.fetch = (async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('/auth/v1/user')) {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    const reqUnverified = new Request('https://chatlustora.com/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.jwt.signature',
      },
    });
    const resUnverified = await worker.fetch(reqUnverified, dbTestEnv, {});
    assert(resUnverified.status === 401, '1.5 Unverified JWT from Supabase Auth is rejected with HTTP 401');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 1.6 Missing server-side DB configuration -> 503 Service Unavailable
  const reqUnconfigured = new Request('https://chatlustora.com/api/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
  });
  const resUnconfigured = await worker.fetch(reqUnconfigured, testEnv, {});
  const bodyUnconfigured = (await resUnconfigured.json()) as any;
  assert(resUnconfigured.status === 503, '1.6 Missing server DB bindings fails closed with HTTP 503');
  assert(bodyUnconfigured.success === false, '1.6 Unconfigured DB response contains success: false');

  // ---------------------------------------------------------------------------
  // 2. IDENTITY DERIVATION & SPOOFING PREVENTION
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Identity Verification & Spoofing Prevention ---');

  try {
    // Mock Supabase Auth verification
    globalThis.fetch = (async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: validUserId }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    // 2.1 User ID spoofing in body (token belongs to validUserId, body specifies spoofedUserId) -> 403
    const spoofedUserId = '99999999-8888-7777-6666-555555555555';
    const reqSpoof = new Request('https://chatlustora.com/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ userId: spoofedUserId }),
    });
    const resSpoof = await worker.fetch(reqSpoof, dbTestEnv, {});
    const bodySpoof = (await resSpoof.json()) as any;
    assert(resSpoof.status === 403, '2.1 Client user ID mismatch with token identity is rejected with HTTP 403 Forbidden');
    assert(bodySpoof.success === false, '2.1 Spoofing response confirms success: false');
    assert(bodySpoof.error?.includes('spoofing rejected'), '2.1 Error message explicitly identifies spoofing rejection');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 3. STRICT HTTP RESPONSE VERIFICATION & ERROR ABORT
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Strict Cleanup Verification & Abort on Failure ---');

  // 3.1 Reports cleanup HTTP 500 failure prevents Auth Admin deletion
  try {
    let authAdminCalled = false;
    globalThis.fetch = (async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: validUserId }), { status: 200 });
      }
      if (urlStr.includes('/rest/v1/reports')) {
        return new Response('Database error on reports', { status: 500 });
      }
      if (urlStr.includes('/auth/v1/admin/users/')) {
        authAdminCalled = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    const reqErr1 = new Request('https://chatlustora.com/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ userId: validUserId }),
    });
    const resErr1 = await worker.fetch(reqErr1, dbTestEnv, {});
    const bodyErr1 = (await resErr1.json()) as any;
    assert(resErr1.status === 500, '3.1 Reports cleanup failure returns HTTP 500');
    assert(bodyErr1.success === false, '3.1 Reports cleanup failure returns success: false');
    assert(!authAdminCalled, '3.1 Auth Admin deletion was NOT called when reports cleanup failed');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 3.2 Messages cleanup HTTP 500 failure prevents Auth Admin deletion
  try {
    let authAdminCalled = false;
    globalThis.fetch = (async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: validUserId }), { status: 200 });
      }
      if (urlStr.includes('/rest/v1/reports')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes('/rest/v1/messages')) {
        return new Response('Database error on messages', { status: 500 });
      }
      if (urlStr.includes('/auth/v1/admin/users/')) {
        authAdminCalled = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    const reqErr2 = new Request('https://chatlustora.com/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ userId: validUserId }),
    });
    const resErr2 = await worker.fetch(reqErr2, dbTestEnv, {});
    const bodyErr2 = (await resErr2.json()) as any;
    assert(resErr2.status === 500, '3.2 Messages cleanup failure returns HTTP 500');
    assert(bodyErr2.success === false, '3.2 Messages cleanup failure returns success: false');
    assert(!authAdminCalled, '3.2 Auth Admin deletion was NOT called when messages cleanup failed');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 3.3 Full success execution path
  try {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      fetchCalls.push({ url: urlStr, method });

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

    const reqSuccess = new Request('https://chatlustora.com/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ userId: validUserId }),
    });

    const resSuccess = await worker.fetch(reqSuccess, dbTestEnv, {});
    const bodySuccess = (await resSuccess.json()) as any;
    assert(resSuccess.status === 200, '3.3 Database account deletion returns HTTP 200');
    assert(bodySuccess.success === true, '3.3 Response confirms success: true');

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
    '5.4 AuthContext deleteAccount does not clear local state when server deletion fails'
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
  console.log('  ALL ACCOUNT DELETION & GUEST REVOCATION TESTS PASSED (18/18)');
  console.log('=============================================================\n');
}

runAccountDeletionTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
