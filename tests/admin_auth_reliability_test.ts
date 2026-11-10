import bcrypt from 'bcryptjs';
import worker from '../src/worker';

/**
 * Custom signer for tests to allow generating tokens with invalid claims
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
  console.log('--- Running Final Admin Auth Reliability & Acceptance Tests ---');

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

  let totalAssertions = 0;
  const assert = (condition: boolean, message: string) => {
    totalAssertions++;
    if (!condition) throw new Error(`Assertion failed: ${message}`);
  };

  // 1. Missing/Weak Secrets (Acceptance)
  console.log('Scenario 1: Missing or Weak Secrets fails closed (503)');
  const s1_1 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, ADMIN_USER: '' }, {});
  assert(s1_1.status === 503, 'Missing ADMIN_USER should return 503');
  
  const s1_2 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, ADMIN_PASS_HASH: '' }, {});
  assert(s1_2.status === 503, 'Missing ADMIN_PASS_HASH should return 503');
  
  const s1_3 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, JWT_SECRET: '' }, {});
  assert(s1_3.status === 503, 'Missing JWT_SECRET should return 503');
  
  const s1_4 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, JWT_SECRET: 'too_short' }, {});
  assert(s1_4.status === 503, 'Weak JWT_SECRET (< 32 chars) should return 503');
  console.log('✅ [PASSED] Missing/Weak secrets handled correctly');

  // 2. Invalid Credentials (Acceptance)
  console.log('Scenario 2: Invalid Username/Password returns 401');
  const s2_1 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: 'wrong', password: TEST_PASS }), mockEnv, {});
  assert(s2_1.status === 401, 'Invalid username should return 401');
  
  const s2_2 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'wrong_password' }), mockEnv, {});
  assert(s2_2.status === 401, 'Invalid password should return 401');
  console.log('✅ [PASSED] Invalid credentials rejection');

  // 3. Cookie Attributes (Acceptance)
  console.log('Scenario 3: Login response cookie attributes');
  const s3_res = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, {});
  const cookie = s3_res.headers.get('Set-Cookie') || '';
  assert(cookie.includes('HttpOnly'), 'Cookie missing HttpOnly');
  assert(cookie.includes('Secure'), 'Cookie missing Secure');
  assert(cookie.includes('SameSite=Strict'), 'Cookie missing SameSite=Strict');
  assert(cookie.includes('Path=/'), 'Cookie missing Path=/');
  assert(cookie.includes('Max-Age=28800'), 'Cookie missing Max-Age=28800');
  console.log('✅ [PASSED] Cookie attributes are strictly enforced');

  const validToken = cookie.split(';')[0].split('=')[1];

  // 4. Successful Session Verification (Restored)
  console.log('Scenario 4: Successful login and session verification');
  const s4_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${validToken}` }), mockEnv, {});
  assert(s4_res.status === 200, 'Session verification failed for valid token');
  const s4_data = await s4_res.json() as any;
  assert(s4_data.success === true && s4_data.user.username === TEST_USER, 'Session data mismatch');
  console.log('✅ [PASSED] Valid session lifecycle');

  // 5. Logout verification (Acceptance)
  console.log('Scenario 5: Logout returns clearing cookie');
  const s5_res = await worker.fetch(createRequest('/api/admin/logout', 'POST'), mockEnv, {});
  const logoutCookie = s5_res.headers.get('Set-Cookie') || '';
  assert(logoutCookie.includes('Max-Age=0'), 'Logout cookie missing Max-Age=0');
  assert(logoutCookie.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'), 'Logout cookie missing Expired Expires attribute');
  console.log('✅ [PASSED] Logout clears session correctly');

  // 6. Generic unauthorized response (Acceptance + Strengthened)
  console.log('Scenario 6: Generic unauthorized response (Full JSON Match)');
  const s6_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': 'admin_token=invalid' }), mockEnv, {});
  const s6_text = await s6_res.text();
  assert(s6_res.status === 401, 'Invalid session should return 401');
  assert(s6_text === JSON.stringify({ success: false, error: 'Unauthorized' }), 'Response body must be exact generic JSON');
  console.log('✅ [PASSED] Unauthorized responses are generic and exact');

  // 7. Empty/Whitespace Subject rejection (Acceptance)
  console.log('Scenario 7: Reject empty or whitespace sub');
  const s7_token = await signTestToken({ sub: '   ', role: 'admin', iat: Date.now(), exp: Date.now() + 10000, iss: 'chatlustora-admin-auth', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const s7_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s7_token}` }), mockEnv, {});
  assert(s7_res.status === 401, 'Whitespace subject should return 401');
  console.log('✅ [PASSED] Whitespace sub rejected');

  // 8. Invalid Issuer Rejection (Restored)
  console.log('Scenario 8: Reject invalid issuer');
  const s8_token = await signTestToken({ sub: TEST_USER, role: 'admin', iat: Date.now(), exp: Date.now() + 10000, iss: 'evil-iss', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const s8_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s8_token}` }), mockEnv, {});
  assert(s8_res.status === 401, 'Invalid issuer should return 401');
  console.log('✅ [PASSED] Invalid issuer rejected');

  // 9. Invalid Audience Rejection (Restored)
  console.log('Scenario 9: Reject invalid audience');
  const s9_token = await signTestToken({ sub: TEST_USER, role: 'admin', iat: Date.now(), exp: Date.now() + 10000, iss: 'chatlustora-admin-auth', aud: 'wrong-aud' }, TEST_SECRET);
  const s9_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s9_token}` }), mockEnv, {});
  assert(s9_res.status === 401, 'Invalid audience should return 401');
  console.log('✅ [PASSED] Invalid audience rejected');

  // 10. Invalid Role Rejection (Restored)
  console.log('Scenario 10: Reject invalid role (including moderator)');
  const s10_token = await signTestToken({ sub: TEST_USER, role: 'moderator', iat: Date.now(), exp: Date.now() + 10000, iss: 'chatlustora-admin-auth', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const s10_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s10_token}` }), mockEnv, {});
  assert(s10_res.status === 401, 'Moderator role should return 401 for admin API');
  console.log('✅ [PASSED] Invalid role rejected');

  // 11. Lifetime Enforcement Rejection (Restored)
  console.log('Scenario 11: Reject token lifetime > 8 hours');
  const s11_token = await signTestToken({ sub: TEST_USER, role: 'admin', iat: Date.now(), exp: Date.now() + (9 * 60 * 60 * 1000), iss: 'chatlustora-admin-auth', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const s11_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s11_token}` }), mockEnv, {});
  assert(s11_res.status === 401, 'Excessive lifetime should return 401');
  console.log('✅ [PASSED] Excessive lifetime rejected');

  // 12. Future iat Rejection (Restored)
  console.log('Scenario 12: Reject future iat');
  const s12_token = await signTestToken({ sub: TEST_USER, role: 'admin', iat: Date.now() + 120000, exp: Date.now() + 300000, iss: 'chatlustora-admin-auth', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const s12_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s12_token}` }), mockEnv, {});
  assert(s12_res.status === 401, 'Future iat should return 401');
  console.log('✅ [PASSED] Future iat rejected');

  // 13. Expired Token Rejection (Restored)
  console.log('Scenario 13: Reject expired token');
  const s13_token = await signTestToken({ sub: TEST_USER, role: 'admin', iat: Date.now() - 20000, exp: Date.now() - 10000, iss: 'chatlustora-admin-auth', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const s13_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s13_token}` }), mockEnv, {});
  assert(s13_res.status === 401, 'Expired token should return 401');
  console.log('✅ [PASSED] Expired token rejected');

  // 14. Tampered Signature Rejection (Restored)
  console.log('Scenario 14: Reject tampered signature');
  const s14_tampered = validToken.slice(0, -5) + 'abcde';
  const s14_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${s14_tampered}` }), mockEnv, {});
  assert(s14_res.status === 401, 'Tampered signature should return 401');
  console.log('✅ [PASSED] Tampered signature rejected');

  // 15. Rate-Limit Reset Test (Acceptance)
  console.log('Scenario 15: Rate-limit reset on successful login');
  const IP_RESET = { 'CF-Connecting-IP': '192.168.1.1' };
  for (let i = 0; i < 4; i++) {
    await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, IP_RESET);
  }
  const s15_res1 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, IP_RESET);
  assert(s15_res1.status === 200, 'Login should succeed after 4 failures');
  
  await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, IP_RESET);
  const s15_res2 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, IP_RESET);
  assert(s15_res2.status === 200, 'Counter should have reset, allowing another failure without 429');
  console.log('✅ [PASSED] Successful login resets failure counter');

  // 16. Rate-Limit Lockout Test (Acceptance)
  console.log('Scenario 16: Rate-limit lockout (5 attempts)');
  const IP_LOCKOUT = { 'CF-Connecting-IP': '192.168.1.2' };
  for (let i = 0; i < 5; i++) {
    await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, IP_LOCKOUT);
  }
  const s16_res = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, IP_LOCKOUT);
  assert(s16_res.status === 429, 'Expected 429 after 5 failures');
  console.log('✅ [PASSED] Lockout enforced after 5 failures');

  console.log(`\n--- All ${totalAssertions} assertions PASSED! ---`);
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

