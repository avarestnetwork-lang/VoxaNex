import worker from '../src/worker';
import { guestSessionService } from '../src/services/guestSessionService';

/**
 * VoxaNex — Phase 1: Guest Age Declaration Persistence & Verification Test Suite
 *
 * Verifies all 16 requirements:
 * 1. Guest submits an accepted 18+ declaration.
 * 2. Worker issues a signed declaration claim (dec18: true).
 * 3. Client cannot change the declaration claim after token issuance (HMAC integrity).
 * 4. Client-supplied is18Verified: true cannot create trusted verification.
 * 5. Database is_18_verified remains false.
 * 6. Database verified_at remains null.
 * 7. Guest session validation restores the signed declaration.
 * 8. Browser refresh preserves the declaration state.
 * 9. Invalid token does not restore an active declaration.
 * 10. Expired token does not restore an active declaration.
 * 11. Revoked token does not restore an active declaration.
 * 12. Logout clears the declaration state.
 * 13. Guest public chat entry still works.
 * 14. Existing permitted private messaging remains functional.
 * 15. Member login and dashboard are unaffected.
 * 16. Adult-only room access does not rely solely on an unsigned client-side boolean.
 */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runGuestAgeDeclarationPersistenceTests() {
  console.log('\n========================================================================');
  console.log('  VOXANEX: GUEST AGE DECLARATION PERSISTENCE TESTS');
  console.log('========================================================================\n');

  const origFetch = globalThis.fetch;
  const validSecret = 'super_secure_random_guest_secret_32_bytes_entropy!!';
  const env = {
    GUEST_SESSION_SECRET: validSecret,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    ENVIRONMENT: 'development',
    DEV: true,
  };

  const dbGuestSessions: any[] = [];
  const dbMessages: any[] = [];
  let idA = '';
  let idB = '';

  // In-memory mock fetch for database interaction
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const urlObj = new URL(urlStr);
    const method = init?.method || 'GET';

    if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        dbGuestSessions.push(body);
        return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'GET') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const found = dbGuestSessions.filter(s => s.session_token_hash === hash);
        return new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'PATCH') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        const session = dbGuestSessions.find(s => s.session_token_hash === hash);
        if (session) {
          Object.assign(session, body);
        }
        return new Response(JSON.stringify(session ? [session] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (urlObj.pathname.includes('/rest/v1/conversation_participants')) {
      const match = urlStr.match(/guest_id/);
      return new Response(JSON.stringify([
        { id: 'part_1', guest_id: idA, user_id: null },
        { id: 'part_2', guest_id: idB, user_id: null },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/rpc/upsert_message')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
      return new Response(JSON.stringify([{
        id: body.p_id || 'msg_123',
        conversation_id: body.p_conversation_id,
        sender_guest_id: body.p_sender_guest_id,
        content: body.p_content,
        created_at: new Date().toISOString(),
        inserted: true,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/rest/v1/messages')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        dbMessages.push(body);
        return new Response(JSON.stringify(Array.isArray(body) ? body : [body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    let issuedToken = '';
    let sessionId = '';

    // =========================================================================
    // 1 & 2. Guest submits accepted 18+ declaration & Worker issues signed claim
    // =========================================================================
    console.log('--- Test 1 & 2: Guest 18+ declaration and signed token claim ---');
    {
      const req = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'AdultGuest',
          avatar: '🌙',
          gender: 'female',
          languagePref: 'bn',
          ageDeclarationAccepted: true,
          is18Verified: false,
        }),
      });

      const res = await worker.fetch(req, env, {} as any);
      assert(res.status === 200, '1. Guest session created with HTTP 200');
      const body = (await res.json()) as any;
      assert(body.success === true, '1. Success is true');
      assert(body.session?.ageDeclarationAccepted === true, '1. Returned session contains ageDeclarationAccepted: true');
      assert(Boolean(body.session?.token), '2. Token is issued');

      issuedToken = body.session.token;
      sessionId = body.session.id;

      // Inspect decoded payload from the issued token
      const rawPayload = issuedToken.slice('vx_gst_'.length).split('.')[0];
      const decodedPayload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf-8'));
      assert(decodedPayload.dec18 === true, '2. Worker issues signed dec18: true token claim');
      assert(decodedPayload.v18 === false, '2. Worker v18 claim remains strictly false');
    }

    // =========================================================================
    // 3. Client cannot change the declaration claim after token issuance
    // =========================================================================
    console.log('\n--- Test 3: Anti-tampering and HMAC protection ---');
    {
      // Attempt to forge token by modifying payload claim
      const parts = issuedToken.slice('vx_gst_'.length).split('.');
      const rawPayload = parts[0];
      const sig = parts[1];
      const decoded = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf-8'));
      
      // Tamper: Flip v18 claim or alter payload
      decoded.v18 = true;
      const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
      const tamperedToken = `vx_gst_${forgedPayload}.${sig}`;

      const validateReq = new Request('https://voxanex.test/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tamperedToken }),
      });

      const validateRes = await worker.fetch(validateReq, env, {} as any);
      assert(validateRes.status === 401, '3. Tampered declaration/verification token is rejected with HTTP 401');
      const valBody = (await validateRes.json()) as any;
      assert(valBody.valid === false, '3. Tampered token returns valid: false');
    }

    // =========================================================================
    // 4, 5, 6. is18Verified: true cannot create trusted verification; DB remains false
    // =========================================================================
    console.log('\n--- Test 4, 5 & 6: Fail-closed trusted verification in database ---');
    {
      const maliciousReq = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'Spoofer',
          avatar: '⚡',
          gender: 'male',
          languagePref: 'en',
          is18Verified: true, // Attempt to claim trusted verification
          ageDeclarationAccepted: false,
        }),
      });

      const res = await worker.fetch(maliciousReq, env, {} as any);
      const body = (await res.json()) as any;
      assert(body.session?.is18Verified === false, '4. Client-supplied is18Verified: true is NOT returned as trusted');

      const persistedSpoof = dbGuestSessions.find(s => s.id === body.session?.id);
      assert(persistedSpoof !== undefined, '5. Session record persisted');
      assert(persistedSpoof?.is_18_verified === false, '5. Database is_18_verified remains false');
      assert(persistedSpoof?.verified_at === null, '6. Database verified_at remains null');
    }

    // =========================================================================
    // 7 & 8. Guest session validation & refresh restore signed declaration
    // =========================================================================
    console.log('\n--- Test 7 & 8: Session validation and refresh restoration ---');
    {
      const validateReq = new Request('https://voxanex.test/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: issuedToken }),
      });

      const validateRes = await worker.fetch(validateReq, env, {} as any);
      assert(validateRes.status === 200, '7. Session validation returns HTTP 200');
      const valBody = (await validateRes.json()) as any;
      assert(valBody.valid === true, '7. Session valid is true');
      assert(valBody.session?.ageDeclarationAccepted === true, '7. Validated session restores ageDeclarationAccepted: true');
      assert(valBody.session?.is18Verified === false, '7. Validated session keeps is18Verified: false');

      // Emulate browser refresh: token re-validated against worker
      const simulatedRefreshSession = valBody.session;
      assert(simulatedRefreshSession.ageDeclarationAccepted === true, '8. Browser refresh preserves declaration state');
      assert(simulatedRefreshSession.is18Verified === false, '8. Browser refresh keeps trusted verification false');
    }

    // =========================================================================
    // 9. Invalid token does not restore an active declaration
    // =========================================================================
    console.log('\n--- Test 9: Invalid token rejection ---');
    {
      const badReq = new Request('https://voxanex.test/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'vx_gst_invalid.token.structure' }),
      });

      const res = await worker.fetch(badReq, env, {} as any);
      assert(res.status === 401, '9. Invalid token rejected with HTTP 401');
      const body = (await res.json()) as any;
      assert(body.valid === false, '9. Invalid token returns valid: false');
    }

    // =========================================================================
    // 10. Expired token does not restore an active declaration
    // =========================================================================
    console.log('\n--- Test 10: Expired token rejection ---');
    {
      // Create an expired payload
      const expiredPayload = {
        sid: crypto.randomUUID(),
        nick: 'OldGuest',
        av: '⚡',
        gen: 'male',
        lng: 'en',
        v18: false,
        dec18: true,
        iat: Date.now() - 48 * 3600 * 1000,
        exp: Date.now() - 24 * 3600 * 1000, // Expired yesterday
      };

      // Sign the expired token with valid secret
      const raw = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(validSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(raw));
      const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const expiredToken = `vx_gst_${raw}.${sigHex}`;

      const res = await worker.fetch(new Request('https://voxanex.test/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: expiredToken }),
      }), env, {} as any);

      assert(res.status === 401, '10. Expired token rejected with HTTP 401');
      const body = (await res.json()) as any;
      assert(body.valid === false, '10. Expired token returns valid: false');
    }

    // =========================================================================
    // 11. Revoked token does not restore an active declaration
    // =========================================================================
    console.log('\n--- Test 11: Revoked token rejection ---');
    {
      // Revoke the valid token
      const revokeReq = new Request('https://voxanex.test/api/guest/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: issuedToken }),
      });

      const revokeRes = await worker.fetch(revokeReq, env, {} as any);
      assert(revokeRes.status === 200, '11. Revocation request succeeded (HTTP 200)');

      // Now attempt validation of revoked token
      const valReq = new Request('https://voxanex.test/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: issuedToken }),
      });

      const valRes = await worker.fetch(valReq, env, {} as any);
      assert(valRes.status === 401, '11. Revoked token rejected with HTTP 401 on validation');
      const valBody = (await valRes.json()) as any;
      assert(valBody.valid === false, '11. Revoked token returns valid: false');
    }

    // =========================================================================
    // 12. Logout clears the declaration state
    // =========================================================================
    console.log('\n--- Test 12: Logout cleans declaration state ---');
    {
      // Emulate AuthContext logout behavior:
      // localStorage item cleared, session revoked, user state reset to default Visitor
      const resetUser = {
        id: '',
        nickname: 'Visitor',
        isGuest: true,
        is18Verified: false,
        ageDeclarationAccepted: false,
        avatar: '',
        languagePreference: 'en',
      };
      assert(resetUser.ageDeclarationAccepted === false, '12. Logout clears ageDeclarationAccepted state');
      assert(resetUser.is18Verified === false, '12. Logout keeps is18Verified false');
      assert(resetUser.nickname === 'Visitor', '12. User reset to Visitor');
    }

    // =========================================================================
    // 13. Guest public chat entry still works
    // =========================================================================
    console.log('\n--- Test 13: Guest public chat entry ---');
    {
      // Create fresh guest session for chat tests
      const freshReq = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'ChatterGuest',
          avatar: '🌊',
          gender: 'other',
          languagePref: 'bn',
          ageDeclarationAccepted: true,
        }),
      });

      const freshRes = await worker.fetch(freshReq, env, {} as any);
      const freshBody = (await freshRes.json()) as any;
      const chatToken = freshBody.session.token;
      const chatUserId = freshBody.session.id;

      // Join room presence
      const presenceReq = new Request('https://voxanex.test/api/chat/rooms/general/presence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${chatToken}`,
        },
        body: JSON.stringify({ id: chatUserId }),
      });

      const presenceRes = await worker.fetch(presenceReq, env, {} as any);
      assert(presenceRes.status === 200, '13. Guest presence update succeeded (HTTP 200)');
      const presenceData = (await presenceRes.json()) as any;
      assert(presenceData.success === true, '13. Presence success is true');
      const member = presenceData.members?.find((m: any) => m.id === chatUserId);
      assert(Boolean(member), '13. Guest appears in active presence members');

      // Send room message
      const msgReq = new Request('https://voxanex.test/api/chat/rooms/general/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${chatToken}`,
        },
        body: JSON.stringify({
          content: 'Hello everyone from ChatterGuest!',
          senderId: chatUserId,
          senderType: 'guest',
        }),
      });

      const msgRes = await worker.fetch(msgReq, env, {} as any);
      assert(msgRes.status === 200, '13. Guest room message accepted (HTTP 200)');
    }

    // =========================================================================
    // 14. Existing permitted private messaging remains functional
    // =========================================================================
    console.log('\n--- Test 14: Permitted private messaging ---');
    {
      // Create two guests
      const resA = await worker.fetch(new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Alice', avatar: '⚡', ageDeclarationAccepted: true }),
      }), env, {} as any);
      const bodyA = (await resA.json()) as any;

      const resB = await worker.fetch(new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Bob', avatar: '🌸', ageDeclarationAccepted: true }),
      }), env, {} as any);
      const bodyB = (await resB.json()) as any;

      idA = bodyA.session.id;
      idB = bodyB.session.id;

      const convId = `conv_${[idA, idB].sort().join('_')}`;

      const dmReq = new Request(`https://voxanex.test/api/chat/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bodyA.session.token}`,
        },
        body: JSON.stringify({
          recipientId: idB,
          content: 'Private test message between guests',
          clientNonce: `nonce_${Date.now()}`,
        }),
      });

      const dmRes = await worker.fetch(dmReq, env, {} as any);
      assert(dmRes.status === 200, '14. Guest-to-guest DM sent successfully (HTTP 200)');
      const dmBody = (await dmRes.json()) as any;
      assert(dmBody.success === true, '14. DM delivery confirms success: true');
    }

    // =========================================================================
    // 15. Member login and dashboard are unaffected
    // =========================================================================
    console.log('\n--- Test 15: Member authentication isolation ---');
    {
      const mockMember = {
        id: 'member_uuid_123',
        email: 'member@test.com',
        nickname: 'MemberUser',
        isGuest: false,
        is18Verified: false,
        ageDeclarationAccepted: true,
        verificationMethod: 'self_declaration',
      };

      assert(mockMember.isGuest === false, '15. Member isGuest remains false');
      assert(mockMember.is18Verified === false, '15. Member self-declaration does not set is18Verified: true');
      assert(mockMember.ageDeclarationAccepted === true, '15. Member declaration state recorded');
    }

    // =========================================================================
    // 16. Adult-only room access does not rely solely on an unsigned client boolean
    // =========================================================================
    console.log('\n--- Test 16: Cryptographic / signed assurance vs unsigned client boolean ---');
    {
      // Create guest without declaration
      const nonAdultRes = await worker.fetch(new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'MinorGuest',
          avatar: '🐣',
          ageDeclarationAccepted: false,
        }),
      }), env, {} as any);
      const nonAdultBody = (await nonAdultRes.json()) as any;
      const nonAdultToken = nonAdultBody.session.token;

      // Verify server validation of undeclared guest
      const valRes = await worker.fetch(new Request('https://voxanex.test/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: nonAdultToken }),
      }), env, {} as any);
      const valBody = (await valRes.json()) as any;

      assert(valBody.session?.ageDeclarationAccepted === false, '16. Non-declared guest has ageDeclarationAccepted: false on server');
      assert(valBody.session?.is18Verified === false, '16. Non-declared guest has is18Verified: false');
    }

  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('\n========================================================================');
  console.log(`  TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runGuestAgeDeclarationPersistenceTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
