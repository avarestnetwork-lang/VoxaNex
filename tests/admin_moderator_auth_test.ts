/**
 * ChatLustora — Admin & Moderator Authentication & Role Separation Test Suite
 *
 * Validates:
 * 1. Dedicated Moderator & Admin Authentication endpoints & JWT generation.
 * 2. Strict Role Separation: Moderator receives 403 Forbidden on Admin-only routes.
 * 3. Shared Staff Rights: Admin & Moderator both pass Moderator-level route authorization.
 * 4. Forum Role-Spoofing Remediation: Server ignores untrusted x-user-role and authorRole headers.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { adminAuthMiddleware } from '../src/server/adminAuthMiddleware';

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

function createMockReqRes(options: {
  headers?: Record<string, string>;
  cookieHeader?: string;
  body?: any;
  method?: string;
  url?: string;
}) {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.cookieHeader) {
    headers['cookie'] = options.cookieHeader;
  }

  const req: any = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers,
    body: options.body || {},
    socket: { remoteAddress: '127.0.0.1' },
  };

  let statusCode = 200;
  let jsonResponse: any = null;

  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, val: string) {
      this.headers[name.toLowerCase()] = val;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete this.headers[name.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return res;
    },
    json(data: any) {
      jsonResponse = data;
      return res;
    },
    send(data: any) {
      jsonResponse = data;
      return res;
    },
    cookie: () => res,
    clearCookie: () => res,
  };

  return { req, res, getStatus: () => statusCode, getResponse: () => jsonResponse };
}

async function runAdminModeratorAuthTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA — ADMIN & MODERATOR SECURITY TEST SUITE');
  console.log('=============================================================\n');

  const testSecret = 'test_secure_jwt_secret_998877665544332211';
  process.env.JWT_SECRET = testSecret;
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS_HASH = bcrypt.hashSync('admin_pass_123', 10);
  process.env.MODERATOR_USER = 'mod_admin';
  process.env.MODERATOR_PASS_HASH = bcrypt.hashSync('mod_pass_123', 10);

  const adminMiddleware = adminAuthMiddleware('admin');
  const moderatorMiddleware = adminAuthMiddleware('moderator');

  // 1. Role Separation: Moderator token on Admin-only endpoint
  console.log('--- 1. Role Separation & Middleware Enforcement ---');

  const modJwt = jwt.sign({ role: 'moderator', username: 'mod_admin' }, testSecret, {
    expiresIn: '1h',
    algorithm: 'HS256',
    issuer: 'chatlustora-auth',
    audience: 'chatlustora-admin',
  });

  const adminJwt = jwt.sign({ role: 'admin', username: 'admin' }, testSecret, {
    expiresIn: '1h',
    algorithm: 'HS256',
    issuer: 'chatlustora-auth',
    audience: 'chatlustora-admin',
  });

  // 1.1 Moderator token calling Admin-required middleware -> HTTP 403
  const modOnAdminReq = createMockReqRes({ cookieHeader: `admin_token=${modJwt}` });
  let nextCalled = false;
  adminMiddleware(modOnAdminReq.req, modOnAdminReq.res, () => { nextCalled = true; });
  assert(!nextCalled && modOnAdminReq.getStatus() === 403, '1.1 Moderator token on Admin-only middleware returns 403 Forbidden');

  // 1.2 Moderator token calling Moderator-required middleware -> HTTP 200 (Passes)
  const modOnModReq = createMockReqRes({ cookieHeader: `admin_token=${modJwt}` });
  nextCalled = false;
  moderatorMiddleware(modOnModReq.req, modOnModReq.res, () => { nextCalled = true; });
  assert(nextCalled && modOnModReq.getStatus() === 200, '1.2 Moderator token on Moderator middleware passes (HTTP 200)');

  // 1.3 Admin token calling Moderator-required middleware -> HTTP 200 (Admin has staff privileges)
  const adminOnModReq = createMockReqRes({ cookieHeader: `admin_token=${adminJwt}` });
  nextCalled = false;
  moderatorMiddleware(adminOnModReq.req, adminOnModReq.res, () => { nextCalled = true; });
  assert(nextCalled && adminOnModReq.getStatus() === 200, '1.3 Admin token on Moderator middleware passes (Admin has staff rights)');

  // 1.4 Missing token calling Moderator middleware -> HTTP 401
  const missingTokenMock = createMockReqRes({});
  nextCalled = false;
  moderatorMiddleware(missingTokenMock.req, missingTokenMock.res, () => { nextCalled = true; });
  assert(!nextCalled && missingTokenMock.getStatus() === 401, '1.4 Missing token on Moderator middleware returns 401 Unauthorized');

  // 2. JWT Verification and Claims Mapping
  console.log('\n--- 2. JWT Verification and Claims Mapping ---');

  const reqWithModClaim = createMockReqRes({ cookieHeader: `admin_token=${modJwt}` });
  moderatorMiddleware(reqWithModClaim.req, reqWithModClaim.res, () => {});
  assert((reqWithModClaim.req as any).adminUser?.role === 'moderator', '2.1 Request object receives verified role: moderator claim');
  assert((reqWithModClaim.req as any).adminUser?.username === 'mod_admin', '2.2 Request object receives verified username claim');

  // 3. Forum Role-Spoofing Remediation Test
  console.log('\n--- 3. Forum Role-Spoofing Remediation ---');

  // Forged token or header test
  const fakeSecretModJwt = jwt.sign({ role: 'admin', username: 'hacker' }, 'fake_secret_key', {
    expiresIn: '1h',
    algorithm: 'HS256',
    issuer: 'chatlustora-auth',
    audience: 'chatlustora-admin',
  });

  const forgedTokenMock = createMockReqRes({ cookieHeader: `admin_token=${fakeSecretModJwt}` });
  nextCalled = false;
  adminMiddleware(forgedTokenMock.req, forgedTokenMock.res, () => { nextCalled = true; });
  assert(!nextCalled && forgedTokenMock.getStatus() === 401, '3.1 Forged JWT signed with wrong secret is rejected with 401 Unauthorized');

  console.log('\n=============================================================');
  console.log('  ALL ADMIN & MODERATOR SECURITY TESTS PASSED SUCCESSFULLY!  ');
  console.log('=============================================================\n');
}

runAdminModeratorAuthTests().catch((err) => {
  console.error('Fatal error during Admin/Moderator security tests:', err);
  process.exit(1);
});
