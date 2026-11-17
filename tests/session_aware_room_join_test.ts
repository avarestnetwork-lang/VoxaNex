import * as fs from 'fs';
import * as path from 'path';

// Minimal Node browser shims before importing React contexts/services
const storageMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => {
    storageMap.set(k, String(v));
  },
  removeItem: (k: string) => {
    storageMap.delete(k);
  },
  clear: () => {
    storageMap.clear();
  },
};

const popstateListeners: Array<(e: any) => void> = [];
let currentPathname = '/';
let currentState: unknown = null;

(globalThis as any).window = {
  location: {
    origin: 'https://chatlustora.test',
    get pathname() {
      return currentPathname;
    },
    set pathname(v: string) {
      currentPathname = v;
    },
    get href() {
      return `https://chatlustora.test${currentPathname}`;
    },
  },
  history: {
    pushState: (state: unknown, _title: string, url: string) => {
      currentState = state;
      currentPathname = url;
    },
    replaceState: (state: unknown, _title: string, url: string) => {
      currentState = state;
      currentPathname = url;
    },
    back: () => {},
  },
  scrollTo: () => {},
  addEventListener: (ev: string, fn: (e: any) => void) => {
    if (ev === 'popstate') popstateListeners.push(fn);
  },
  removeEventListener: (ev: string, fn: (e: any) => void) => {
    if (ev === 'popstate') {
      const idx = popstateListeners.indexOf(fn);
      if (idx >= 0) popstateListeners.splice(idx, 1);
    }
  },
  dispatchEvent: (ev: any) => {
    if (ev?.type === 'popstate') {
      popstateListeners.forEach((fn) => fn(ev));
    }
    return true;
  },
};

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import worker from '../src/worker';
import { guestSessionService } from '../src/services/guestSessionService';
import { resolveRoomJoinNavigation, RoomDirectoryPage } from '../src/pages/RoomDirectoryPage';
import { RoomLandingPage } from '../src/pages/RoomLandingPage';
import { GuestEntryPage } from '../src/pages/GuestEntryPage';
import { PublicChatPage } from '../src/pages/PublicChatPage';
import { LanguageProvider } from '../src/context/LanguageContext';
import { AuthContext } from '../src/context/AuthContext';
import { UserProfile } from '../src/types';

// Update SSR test block with real post-restore AuthContext states

import { RouterProvider } from '../src/context/RouterContext';
import { PrivateChatProvider } from '../src/context/PrivateChatContext';
import { CallProvider } from '../src/context/CallContext';

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

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function createMockMemberJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url');
  return `${header}.${payload}.mock_sig`;
}

async function runTests() {
  console.log('\n========================================================================');
  console.log('  CHATLUSTORA: SESSION-AWARE CHAT ROOM JOIN FLOW REGRESSION SUITE');
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
  let guestAId = '';
  let guestBId = '';

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();

    // Forward relative Worker endpoints directly to Worker
    if (urlStr.startsWith('/api/')) {
      const req = new Request(`https://chatlustora.test${urlStr}`, init);
      return worker.fetch(req, env, {} as any);
    }

    const urlObj = new URL(urlStr);
    const method = init?.method || 'GET';

    if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body || {};
        dbGuestSessions.push(body);
        return new Response(JSON.stringify([body]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const found = dbGuestSessions.filter((s) => s.session_token_hash === hash);
        return new Response(JSON.stringify(found), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'PATCH') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body || {};
        const session = dbGuestSessions.find((s) => s.session_token_hash === hash);
        if (session) Object.assign(session, body);
        return new Response(JSON.stringify(session ? [session] : []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (urlObj.pathname.includes('/rest/v1/conversation_participants')) {
      return new Response(
        JSON.stringify([
          { id: 'part_1', guest_id: guestAId, user_id: null },
          { id: 'part_2', guest_id: guestBId, user_id: null },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (urlObj.pathname.includes('/rpc/upsert_message')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body || {};
      return new Response(
        JSON.stringify([
          {
            id: body.p_id || 'msg_dm_1',
            conversation_id: body.p_conversation_id,
            sender_guest_id: body.p_sender_guest_id,
            content: body.p_content,
            created_at: new Date().toISOString(),
            inserted: true,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (urlObj.pathname.includes('/rest/v1/messages')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body || {};
        dbMessages.push(body);
        return new Response(JSON.stringify(Array.isArray(body) ? body : [body]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/auth/v1/user')) {
      const auth = (init?.headers as any)?.['Authorization'] || (init?.headers as any)?.['authorization'] || '';
      if (auth.includes('mock_sig')) {
        return new Response(JSON.stringify({ id: 'member_uuid_101', email: 'member@chatlustora.test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    // =========================================================================
    // TEST CASES 1–3 & 8: DECISION HELPER FOR JOIN / ENTER ROOM ROUTING
    // =========================================================================
    console.log('--- 1. Session-aware Room Join decision routing ---');
    {
      // 1. Active guest session (with 18+ declaration) joins public or 18+ room -> /chat directly
      const guestPublic = resolveRoomJoinNavigation({
        roomSlug: 'bangla',
        roomIs18Plus: false,
        hasActiveSession: true,
        isLoading: false,
        hasAgeAccess: true,
      });
      assert(
        guestPublic?.route === '/chat' && guestPublic.params.roomId === 'bangla',
        '1a. Active guest joins public room -> navigates directly to /chat (no guest-entry)'
      );

      const guestAdult = resolveRoomJoinNavigation({
        roomSlug: 'sex',
        roomIs18Plus: true,
        hasActiveSession: true,
        isLoading: false,
        hasAgeAccess: true,
      });
      assert(
        guestAdult?.route === '/chat' && guestAdult.params.roomId === 'sex',
        '1b. Active age-declared guest joins 18+ room -> navigates directly to /chat'
      );

      // 2. Active registered member session -> navigates directly to /chat
      const memberGeneral = resolveRoomJoinNavigation({
        roomSlug: 'english',
        roomIs18Plus: false,
        hasActiveSession: true,
        isLoading: false,
        hasAgeAccess: false,
      });
      assert(
        memberGeneral?.route === '/chat' && memberGeneral.params.roomId === 'english',
        '2a. Active member joins general room -> navigates directly to /chat without guest-entry'
      );

      const memberVerifiedAdult = resolveRoomJoinNavigation({
        roomSlug: 'adult',
        roomIs18Plus: true,
        hasActiveSession: true,
        isLoading: false,
        hasAgeAccess: true,
      });
      assert(
        memberVerifiedAdult?.route === '/chat' && memberVerifiedAdult.params.roomId === 'adult',
        '2b. Active 18+-confirmed member joins 18+ room -> navigates directly to /chat'
      );

      // 8. Authenticated user lacking required 18+ confirmation -> routes to /age-gate (NOT re-login)
      const memberNeeds18 = resolveRoomJoinNavigation({
        roomSlug: 'mature',
        roomIs18Plus: true,
        hasActiveSession: true,
        isLoading: false,
        hasAgeAccess: false,
      });
      assert(
        memberNeeds18?.route === '/age-gate' && memberNeeds18.params.targetRoom === 'mature',
        '8a. Authenticated user lacking 18+ confirmation routes to /age-gate with targetRoom'
      );

      // 3. No active session -> routes to /user/guest-entry with targetRoom
      const visitorJoin = resolveRoomJoinNavigation({
        roomSlug: 'bangla',
        roomIs18Plus: false,
        hasActiveSession: false,
        isLoading: false,
        hasAgeAccess: false,
      });
      assert(
        visitorJoin?.route === '/user/guest-entry' && visitorJoin.params.targetRoom === 'bangla',
        '3. Unauthenticated visitor clicking Join routes to /user/guest-entry with targetRoom'
      );

      // Loading state -> defers navigation safely
      const loadingJoin = resolveRoomJoinNavigation({
        roomSlug: 'bangla',
        roomIs18Plus: false,
        hasActiveSession: false,
        isLoading: true,
        hasAgeAccess: false,
      });
      assert(loadingJoin === null, '3b. Join action defers safely while auth restoration is loading');
    }

    // =========================================================================
    // RENDER & COMPONENT VERIFICATION (Real React SSR under AuthContext)
    // =========================================================================
    console.log('\n--- 2. Real React component rendering across session states ---');
    {
      const makeAuthValue = (overrides: {
        user?: Partial<UserProfile>;
        hasActiveSession?: boolean;
        isLoading?: boolean;
      }) => {
        const user: UserProfile = {
          id: '',
          nickname: 'Visitor',
          isGuest: true,
          is18Verified: false,
          ageDeclarationAccepted: false,
          avatar: '⚡',
          languagePreference: 'en',
          safeFilterEnabled: true,
          notificationSounds: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          ...overrides.user,
        };
        return {
          user,
          hasActiveSession: overrides.hasActiveSession ?? false,
          isLoading: overrides.isLoading ?? false,
          is18Verified: Boolean(user.is18Verified),
          ageDeclarationAccepted: Boolean(user.ageDeclarationAccepted),
          verify18: () => {},
          revoke18: () => {},
          setNickname: async () => ({ success: true }),
          setAvatar: async () => ({ success: true }),
          loginGuest: async () => ({ success: true }),
          loginWithAccount: async () => ({ success: true }),
          registerWithAccount: async () => ({ success: true }),
          requestPasswordReset: async () => ({ success: true }),
          passwordRecoveryStatus: 'idle' as const,
          passwordRecoveryError: null,
          completePasswordReset: async () => ({ success: true }),
          deleteAccount: async () => ({ success: true, message: 'ok' }),
          logout: async () => ({ success: true }),
          updatePreferences: async () => ({ success: true }),
          isSupabaseActive: false,
          hasPermission: () => Boolean(overrides.hasActiveSession),
        };
      };

      const wrapWithAuth = (
        authVal: ReturnType<typeof makeAuthValue>,
        node: React.ReactElement
      ) =>
        renderToStaticMarkup(
          React.createElement(
            LanguageProvider,
            null,
            React.createElement(
              AuthContext.Provider,
              { value: authVal },
              React.createElement(
                CallProvider,
                null,
                React.createElement(
                  RouterProvider,
                  null,
                  React.createElement(PrivateChatProvider, null, node)
                )
              )
            )
          )
        );

      const visitorAuth = makeAuthValue({ hasActiveSession: false, isLoading: false });
      const memberWithout18 = makeAuthValue({
        hasActiveSession: true,
        isLoading: false,
        user: {
          id: 'member_uuid_101',
          nickname: 'DhakaMember',
          isGuest: false,
          is18Verified: false,
          ageDeclarationAccepted: false,
          avatar: '🛡️',
        },
      });
      const guestWith18 = makeAuthValue({
        hasActiveSession: true,
        isLoading: false,
        user: {
          id: 'guest_uuid_202',
          nickname: 'PadmaGuest',
          isGuest: true,
          is18Verified: false,
          ageDeclarationAccepted: true,
          avatar: '⚡',
        },
      });

      // Clean unauthenticated visitor on /rooms
      currentPathname = '/rooms';
      const roomsHtml = wrapWithAuth(visitorAuth, React.createElement(RoomDirectoryPage));
      assert(
        roomsHtml.includes('Bangla Chat') && roomsHtml.includes('Enter Room'),
        'SSR 2a. RoomDirectoryPage renders room catalog and Enter Room actions cleanly'
      );

      // Clean unauthenticated visitor on RoomLandingPage
      currentPathname = '/chat/mature';
      const landingHtml = wrapWithAuth(
        visitorAuth,
        React.createElement(RoomLandingPage, { roomSlug: 'mature' })
      );
      assert(
        landingHtml.includes('Mature Chat') && landingHtml.includes('Enter Mature Chat'),
        'SSR 2b. RoomLandingPage renders room CTA cleanly'
      );

      // Unauthenticated visitor on /user/guest-entry sees tabs
      currentPathname = '/user/guest-entry';
      const guestEntryHtml = wrapWithAuth(visitorAuth, React.createElement(GuestEntryPage));
      assert(
        guestEntryHtml.includes('Login as Guest') &&
          guestEntryHtml.includes('Member Login') &&
          guestEntryHtml.includes('Create Account'),
        'SSR 3c. Unauthenticated /user/guest-entry renders Guest, Member Login, and Register tabs'
      );

      // Authenticated user lacking 18+ confirmation on /age-gate -> renders Authenticated 18+ Age Confirmation view
      currentPathname = '/age-gate';
      const ageGateHtml = wrapWithAuth(memberWithout18, React.createElement(GuestEntryPage));
      assert(
        ageGateHtml.includes('DhakaMember') &&
          ageGateHtml.includes('18+ Age Confirmation Required') &&
          ageGateHtml.includes('Signed In Member Session') &&
          !ageGateHtml.includes('Login as Guest'),
        'SSR 8b. Authenticated user on /age-gate renders 18+ confirmation view preserving identity (no duplicate login/guest form)'
      );

      // Authenticated user lacking 18+ access on PublicChatPage (/chat/sex) -> does NOT expose chat composer
      currentPathname = '/chat/sex';
      const unverifiedAdultChatHtml = wrapWithAuth(
        memberWithout18,
        React.createElement(PublicChatPage)
      );
      assert(
        unverifiedAdultChatHtml.includes('Redirecting to 18+ age confirmation') &&
          !unverifiedAdultChatHtml.includes('Type message or @ to mention participant'),
        'SSR 8f. Authenticated user missing 18+ confirmation cannot see 18+ room composer'
      );

      // Unauthorized access to PublicChatPage without active session -> never renders chat room messages/composer
      currentPathname = '/chat/sex';
      const blockedChatHtml = wrapWithAuth(visitorAuth, React.createElement(PublicChatPage));
      assert(
        blockedChatHtml.includes('Redirecting to room entry') &&
          !blockedChatHtml.includes('Type message or @ to mention participant'),
        'SSR 9a. Unauthenticated PublicChatPage does not expose chat composer'
      );

      // Active guest with 18+ declaration opening /chat/sex renders full chat room directly
      currentPathname = '/chat/sex';
      const authorizedGuestChatHtml = wrapWithAuth(
        guestWith18,
        React.createElement(PublicChatPage)
      );
      assert(
        authorizedGuestChatHtml.includes('Sex Chat') &&
          authorizedGuestChatHtml.includes('Type message or @ to mention participant'),
        'SSR 1e. Active 18+-declared guest renders PublicChatPage room UI directly'
      );
    }

    // =========================================================================
    // TEST CASES 4–7 & 10: SOURCE INVARIANTS IN TARGET FILES
    // =========================================================================
    console.log('\n--- 3. Source invariants: targetRoom across tabs, Router popstate, PublicChat, Leave Room ---');
    {
      const roomDirSrc = readSource('src/pages/RoomDirectoryPage.tsx');
      const roomLandingSrc = readSource('src/pages/RoomLandingPage.tsx');
      const guestEntrySrc = readSource('src/pages/GuestEntryPage.tsx');
      const publicChatSrc = readSource('src/pages/PublicChatPage.tsx');
      const routerSrc = readSource('src/context/RouterContext.tsx');

      // RoomDirectory & RoomLanding reuse resolveRoomJoinNavigation
      assert(roomDirSrc.includes('resolveRoomJoinNavigation('), 'RoomDirectoryPage delegates join to resolveRoomJoinNavigation');
      assert(roomLandingSrc.includes('resolveRoomJoinNavigation('), 'RoomLandingPage delegates enter button to resolveRoomJoinNavigation');

      // Test cases 4 & 5: GuestEntryPage preserves targetRoom across Guest -> Login -> Register tab switches
      assert(
        guestEntrySrc.includes("const nextParams = targetRoomSlug ? { targetRoom: targetRoomSlug } : undefined;") &&
          guestEntrySrc.includes("navigate('/user/register', nextParams)") &&
          guestEntrySrc.includes("navigate('/user/login', nextParams)") &&
          guestEntrySrc.includes("navigate('/user/guest-entry', nextParams)"),
        '4 & 5. GuestEntryPage preserves targetRoomSlug when switching between Guest, Member Login, and Register tabs'
      );

      // RouterContext restores event.state params on popstate
      assert(
        routerSrc.includes('handlePopState = (event: PopStateEvent)') &&
          routerSrc.includes('historyParams') &&
          routerSrc.includes('params: { ...parsed.params, ...historyParams }'),
        '4b. RouterContext preserves history state params (e.g. targetRoom) on browser back/forward popstate'
      );

      // Test cases 6 & 7: Guest login & Member login redirect to targetRoom or /user/dashboard fallback
      assert(
        guestEntrySrc.includes("navigate('/chat', { roomId: targetRoom?.slug || targetRoomSlug })") &&
          guestEntrySrc.includes("navigate('/user/dashboard')"),
        '6 & 7. Guest and Member auth flows redirect to targetRoom (/chat) when set and /user/dashboard otherwise'
      );

      // Test case 8: Login requires explicit adultConfirmed for 18+ target room instead of unconditionally calling verify18()
      assert(
        guestEntrySrc.includes('else if (effectiveTargetIs18Plus && !adultConfirmed)') &&
          !guestEntrySrc.includes('if (targetRoom?.is18Plus || adultConfirmed)'),
        '8c. Login to 18+ room enforces adultConfirmed checkbox and only calls verify18() when explicitly confirmed'
      );

      // PublicChatPage guards effects with isLoading & canAccessRoom and routes missing 18+ to /age-gate
      assert(
        publicChatSrc.includes('if (isLoading) return;') &&
          publicChatSrc.includes("navigate('/age-gate', { targetRoom: activeRoom.slug })") &&
          publicChatSrc.includes('if (!canAccessRoom) return;'),
        '8d. PublicChatPage guards room effects and redirects authenticated non-18+ sessions to /age-gate'
      );

      // Test case 10: Leave Room exits to /rooms without revoking guest or logging out member
      const leaveFnMatch = publicChatSrc.match(/const handleLeaveRoom = \(\) => \{[\s\S]*?\};/);
      const leaveFnBody = leaveFnMatch ? leaveFnMatch[0] : '';
      assert(
        leaveFnBody.includes("navigate('/rooms')") &&
          !leaveFnBody.includes('logout') &&
          !leaveFnBody.includes('revokeSession'),
        '10. PublicChatPage.handleLeaveRoom navigates to /rooms without revoking guest session or logging out member'
      );
    }

    // =========================================================================
    // TEST CASES 9 & 11 & SERVER AUTH: REAL WORKER API VERIFICATION
    // =========================================================================
    console.log('\n--- 4. Real Worker session validation, 18+ server auth, invalid/expired sessions, Public/DM ---');
    {
      // Create valid 18+-declared guest session via guestSessionService
      storageMap.clear();
      const guestCreateRes = await guestSessionService.createSession({
        nickname: 'PadmaGuest',
        avatar: '⚡',
        gender: 'female',
        languagePref: 'bn',
        is18Verified: false,
        ageDeclarationAccepted: true,
      });
      assert(
        guestCreateRes.success && Boolean(guestCreateRes.session?.token),
        '1c. Valid guest session created and persisted via Worker API'
      );
      const validGuestToken = guestCreateRes.session!.token;
      guestAId = guestCreateRes.session!.id;

      // Create valid undeclared guest session (ageDeclarationAccepted: false)
      const undeclaredRes = await worker.fetch(
        new Request('https://chatlustora.test/api/guest/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nickname: 'NoAgeGuest',
            avatar: '🌊',
            languagePref: 'en',
            ageDeclarationAccepted: false,
          }),
        }),
        env,
        {} as any
      );
      const undeclaredBody = (await undeclaredRes.json()) as any;
      const undeclaredToken = undeclaredBody.session.token;

      // Server authorization still rejects undeclared guest in adult room (403) even if client flips a boolean
      const blockedAdultRes = await worker.fetch(
        new Request('https://chatlustora.test/api/chat/rooms/sex/messages', {
          method: 'GET',
          headers: { Authorization: `Bearer ${undeclaredToken}` },
        }),
        env,
        {} as any
      );
      assert(
        blockedAdultRes.status === 403,
        '8e. Worker rejects undeclared guest in 18+ room with HTTP 403 (client boolean never bypasses server)'
      );

      storageMap.set('vx_guest_token', undeclaredToken);
      const ageDeclarationRes = await guestSessionService.declareAge18();
      const rotatedToken = ageDeclarationRes.session?.token || '';
      const oldTokenValidation = await guestSessionService.validateSession(undeclaredToken);
      const rotatedValidation = await guestSessionService.validateSession(rotatedToken);
      assert(
        ageDeclarationRes.success &&
          Boolean(rotatedToken) &&
          ageDeclarationRes.session?.id === undeclaredBody.session.id &&
          ageDeclarationRes.session?.ageDeclarationAccepted === true,
        '8f. Guest 18+ declaration rotates token without changing guest session identity'
      );
      assert(
        oldTokenValidation.valid === false && rotatedValidation.valid === true,
        '8g. Previous guest token is invalidated and the updated token is server-valid'
      );
      assert(
        storageMap.get('vx_guest_token') === rotatedToken,
        '8h. Rotated guest token replaces the browser-stored token'
      );
      const recoveredDeclarationRes = await worker.fetch(
        new Request('https://chatlustora.test/api/guest/age-declaration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: undeclaredToken }),
        }),
        env,
        {} as any
      );
      const recoveredDeclarationBody = await recoveredDeclarationRes.json() as any;
      assert(
        recoveredDeclarationRes.status === 200 &&
          recoveredDeclarationBody.success === true &&
          recoveredDeclarationBody.session?.token === rotatedToken &&
          recoveredDeclarationBody.session?.id === undeclaredBody.session.id,
        '8h.1 Retrying after a lost response recovers the same rotated guest token'
      );
      const declaredAdultRes = await worker.fetch(
        new Request('https://chatlustora.test/api/chat/rooms/sex/messages', {
          method: 'GET',
          headers: { Authorization: `Bearer ${rotatedToken}` },
        }),
        env,
        {} as any
      );
      assert(
        declaredAdultRes.status === 200,
        '8i. Persisted guest declaration unlocks server-authorized 18+ room access'
      );

      // Declared guest succeeds in both public (bangla) and adult (sex) room
      const okAdultRes = await worker.fetch(
        new Request('https://chatlustora.test/api/chat/rooms/sex/messages', {
          method: 'GET',
          headers: { Authorization: `Bearer ${validGuestToken}` },
        }),
        env,
        {} as any
      );
      assert(okAdultRes.status === 200, '1d. Declared guest accesses 18+ room messages with HTTP 200');

      const publicMsgRes = await worker.fetch(
        new Request('https://chatlustora.test/api/chat/rooms/bangla/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validGuestToken}`,
          },
          body: JSON.stringify({
            content: 'Hello Bangla room',
            senderId: guestAId,
            senderType: 'guest',
          }),
        }),
        env,
        {} as any
      );
      assert(publicMsgRes.status === 200, '11a. Public room messaging remains functional for valid guest');

      // Registered member JWT accesses adult room cleanly
      const memberJwt = createMockMemberJwt('member_uuid_101');
      const memberAdultRes = await worker.fetch(
        new Request('https://chatlustora.test/api/chat/rooms/adult/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${memberJwt}`,
          },
          body: JSON.stringify({
            content: 'Member greeting',
            senderId: 'member_uuid_101',
            senderType: 'registered',
          }),
        }),
        env,
        {} as any
      );
      assert(memberAdultRes.status === 200, '2c. Registered member accesses adult room with HTTP 200');

      // Private messaging remains functional between two guests
      const guestBRes = await worker.fetch(
        new Request('https://chatlustora.test/api/guest/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: 'FriendB', avatar: '🌙', ageDeclarationAccepted: true }),
        }),
        env,
        {} as any
      );
      const guestBData = (await guestBRes.json()) as any;
      guestBId = guestBData.session.id;
      const convId = `conv_${[guestAId, guestBId].sort().join('_')}`;
      const dmRes = await worker.fetch(
        new Request(`https://chatlustora.test/api/chat/conversations/${convId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validGuestToken}`,
          },
          body: JSON.stringify({
            recipientId: guestBId,
            content: 'Private DM still works',
            clientNonce: `nonce_${Date.now()}`,
          }),
        }),
        env,
        {} as any
      );
      assert(dmRes.status === 200, '11b. Private DM sending remains functional with HTTP 200');

      // Test Case 9: Invalid & revoked guest tokens fail closed on client validation + Worker rejects with 401
      const invalidValidate = await guestSessionService.validateSession('vx_gst_invalid.token');
      assert(invalidValidate.valid === false, '9b. Invalid guest token fails validation (hasActiveSession -> false)');

      // Revoke active guest session (simulating explicit Logout/End Session, distinct from Leave Room)
      storageMap.set('vx_guest_token', validGuestToken);
      const revokeRes = await guestSessionService.revokeSession();
      assert(revokeRes.success === true, '10b. Explicit session revocation clears server & storage token');

      const postRevokeValidate = await guestSessionService.validateSession(validGuestToken);
      assert(postRevokeValidate.valid === false, '9c. Revoked guest token is rejected by validation (HTTP 401)');

      const invalidMemberRes = await worker.fetch(
        new Request('https://chatlustora.test/api/chat/rooms/bangla/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer bad.jwt.token',
          },
          body: JSON.stringify({ content: 'Unauthorized', senderType: 'registered', senderId: 'member_uuid_101' }),
        }),
        env,
        {} as any
      );
      assert(invalidMemberRes.status === 401, '9d. Invalid member JWT is rejected with HTTP 401');
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('\n========================================================================');
  console.log(`  SESSION-AWARE JOIN FLOW RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
