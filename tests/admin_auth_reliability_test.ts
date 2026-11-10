import bcrypt from 'bcryptjs';
import worker, { verifyAdminToken } from '../src/worker';

/**
 * Custom signer for tests to allow generating tokens with invalid claims
 * (The production signAdminToken overwrites iss/aud, preventing negative testing)
 */
async function signTestToken(payload: any, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const toBase64Url = (str: string) => {
    const bytes = encoder.encode(str);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const base64Payload = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigBytes = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_adm_${base64Payload}.${sigHex}`;
}

async function runTests() {
  console.log('--- Running Enhanced Admin Auth Reliability Tests ---');

  const TEST_USER = 'admin_test';
  const TEST_PASS = 'secure_password_123';
  const TEST_HASH = bcrypt.hashSync(TEST_PASS, 10);
  const TEST_SECRET = 'a_very_long_secret_that_is_at_least_32_chars_long_and_secure';

  const mockEnv = {
    ADMIN_USER: TEST_USER,
    ADMIN_PASS_HASH: TEST_HASH,
    JWT_SECRET: TEST_SECRET,
    ENVIRONMENT: 'development'
  };

  const createRequest = (path: string, method: string = 'GET', body: any = null, headers: any = {}) => {
    const url = `https://chatlustora.com${path}`;
    return new Request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : null
    });
  };

  // 1. Valid login & session check
  console.log('Test 1: Valid credentials login & verification');
  const loginReq = createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS });
  const loginRes = await worker.fetch(loginReq, mockEnv, {});
  if (loginRes.status !== 200) throw new Error(`Login failed with status ${loginRes.status}`);
  
  const setCookie = loginRes.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('Login did not set Set-Cookie header');
  const token = setCookie.split(';')[0].split('=')[1];

  const meRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${token}` }), mockEnv, {});
  if (meRes.status !== 200) throw new Error('Session verification failed for valid token');
  console.log('✅ [PASSED] Valid session lifecycle');

  // 2. Generic error response check
  console.log('Test 2: Generic error response (No leak of verify.reason)');
  const badToken = 'vx_adm_eyJzdWIiOiJhZG1pbiIsImV4cCI6MH0.wrong_signature';
  const genericRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${badToken}` }), mockEnv, {});
  const genericData = await genericRes.json() as { error: string };
  if (genericData.error !== 'Unauthorized') throw new Error(`Expected generic 'Unauthorized' error, got: ${genericData.error}`);
  console.log('✅ [PASSED] Error responses are generic');

  // 3. Claim Validation: Incorrect Issuer
  console.log('Test 3: Reject incorrect issuer');
  const badIssToken = await signTestToken({
    sub: TEST_USER,
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + 10000,
    iss: 'untrusted-issuer',
    aud: 'chatlustora-admin-console'
  }, TEST_SECRET);
  const badIssRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${badIssToken}` }), mockEnv, {});
  if (badIssRes.status !== 401) throw new Error('Expected 401 for bad issuer');
  console.log('✅ [PASSED] Incorrect issuer rejected');

  // 4. Claim Validation: Incorrect Audience
  console.log('Test 4: Reject incorrect audience');
  const badAudToken = await signTestToken({
    sub: TEST_USER,
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + 10000,
    iss: 'chatlustora-admin-auth',
    aud: 'wrong-audience'
  }, TEST_SECRET);
  const badAudRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${badAudToken}` }), mockEnv, {});
  if (badAudRes.status !== 401) throw new Error('Expected 401 for bad audience');
  console.log('✅ [PASSED] Incorrect audience rejected');

  // 5. Claim Validation: Incorrect Role
  console.log('Test 5: Reject incorrect role');
  const badRoleToken = await signTestToken({
    sub: TEST_USER,
    role: 'moderator',
    iat: Date.now(),
    exp: Date.now() + 10000,
    iss: 'chatlustora-admin-auth',
    aud: 'chatlustora-admin-console'
  }, TEST_SECRET);
  const badRoleRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${badRoleToken}` }), mockEnv, {});
  if (badRoleRes.status !== 401) throw new Error('Expected 401 for bad role');
  console.log('✅ [PASSED] Incorrect role rejected');

  // 6. Security: Session Lifetime Enforcement (> 8h)
  console.log('Test 6: Reject tokens with excessive lifetime');
  const longLifeToken = await signTestToken({
    sub: TEST_USER,
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + (9 * 60 * 60 * 1000), // 9 hours
    iss: 'chatlustora-admin-auth',
    aud: 'chatlustora-admin-console'
  }, TEST_SECRET);
  const longLifeRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${longLifeToken}` }), mockEnv, {});
  if (longLifeRes.status !== 401) throw new Error('Expected 401 for session > 8h');
  console.log('✅ [PASSED] Max session life enforced');

  // 7. Security: Future iat
  console.log('Test 7: Reject future iat');
  const futureIatToken = await signTestToken({
    sub: TEST_USER,
    role: 'admin',
    iat: Date.now() + (10 * 60 * 1000), // 10 mins in future
    exp: Date.now() + (60 * 60 * 1000),
    iss: 'chatlustora-admin-auth',
    aud: 'chatlustora-admin-console'
  }, TEST_SECRET);
  const futureRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${futureIatToken}` }), mockEnv, {});
  if (futureRes.status !== 401) throw new Error('Expected 401 for future iat');
  console.log('✅ [PASSED] Future iat rejected');

  // 8. Security: Expired exp
  console.log('Test 8: Reject expired token');
  const expiredToken = await signTestToken({
    sub: TEST_USER,
    role: 'admin',
    iat: Date.now() - 20000,
    exp: Date.now() - 10000,
    iss: 'chatlustora-admin-auth',
    aud: 'chatlustora-admin-console'
  }, TEST_SECRET);
  const expiredRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${expiredToken}` }), mockEnv, {});
  if (expiredRes.status !== 401) throw new Error('Expected 401 for expired token');
  console.log('✅ [PASSED] Expired token rejected');

  // 9. Integrity: Signature Tampering
  console.log('Test 9: Reject tampered signature');
  const tamperedToken = token.slice(0, -5) + 'abcde';
  const tamperedRes = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${tamperedToken}` }), mockEnv, {});
  if (tamperedRes.status !== 401) throw new Error('Expected 401 for tampered signature');
  console.log('✅ [PASSED] Tampered signature rejected');

  // 10. Rate Limiting Check (Isolation level)
  console.log('Test 10: Per-isolate rate limiting (5 attempts)');
  const ipHeaders = { 'CF-Connecting-IP': '10.0.0.1' };
  for (let i = 0; i < 5; i++) {
    await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, ipHeaders);
  }
  const rateLimitedRes = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, ipHeaders);
  if (rateLimitedRes.status !== 429) throw new Error(`Expected 429, got ${rateLimitedRes.status}`);
  console.log('✅ [PASSED] Rate limiting enforced');

  console.log('\n--- All Enhanced Admin Auth Reliability Tests Passed! ---');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

