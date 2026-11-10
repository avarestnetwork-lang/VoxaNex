import bcrypt from 'bcryptjs';
import worker, { verifyAdminToken } from '../src/worker';

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
  console.log('--- Running Final Admin Auth Acceptance Tests ---');

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

  // 1. Missing/Weak Secrets
  console.log('Test 1: Missing or Weak Secrets fails closed (503)');
  const t1_1 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, ADMIN_USER: '' }, {});
  assert(t1_1.status === 503, 'Missing ADMIN_USER should return 503');
  
  const t1_2 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, ADMIN_PASS_HASH: '' }, {});
  assert(t1_2.status === 503, 'Missing ADMIN_PASS_HASH should return 503');
  
  const t1_3 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, JWT_SECRET: '' }, {});
  assert(t1_3.status === 503, 'Missing JWT_SECRET should return 503');
  
  const t1_4 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), { ...mockEnv, JWT_SECRET: 'too_short' }, {});
  assert(t1_4.status === 503, 'Weak JWT_SECRET (< 32 chars) should return 503');
  console.log('✅ [PASSED] Missing/Weak secrets handled correctly');

  // 2. Invalid Credentials
  console.log('Test 2: Invalid Username/Password returns 401');
  const t2_1 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: 'wrong', password: TEST_PASS }), mockEnv, {});
  assert(t2_1.status === 401, 'Invalid username should return 401');
  
  const t2_2 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'wrong_password' }), mockEnv, {});
  assert(t2_2.status === 401, 'Invalid password should return 401');
  console.log('✅ [PASSED] Invalid credentials rejection');

  // 3. Cookie Attributes
  console.log('Test 3: Login response cookie attributes');
  const t3_res = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, {});
  const cookie = t3_res.headers.get('Set-Cookie') || '';
  assert(cookie.includes('HttpOnly'), 'Cookie missing HttpOnly');
  assert(cookie.includes('Secure'), 'Cookie missing Secure');
  assert(cookie.includes('SameSite=Strict'), 'Cookie missing SameSite=Strict');
  assert(cookie.includes('Path=/'), 'Cookie missing Path=/');
  assert(cookie.includes('Max-Age=28800'), 'Cookie missing Max-Age=28800');
  console.log('✅ [PASSED] Cookie attributes are strictly enforced');

  const validToken = cookie.split(';')[0].split('=')[1];

  // 4. Logout verification
  console.log('Test 4: Logout returns clearing cookie');
  const t4_res = await worker.fetch(createRequest('/api/admin/logout', 'POST'), mockEnv, {});
  const logoutCookie = t4_res.headers.get('Set-Cookie') || '';
  assert(logoutCookie.includes('Max-Age=0'), 'Logout cookie missing Max-Age=0');
  assert(logoutCookie.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'), 'Logout cookie missing Expired Expires attribute');
  console.log('✅ [PASSED] Logout clears session correctly');

  // 5. Generic unauthorized response
  console.log('Test 5: Generic unauthorized response (exactly "Unauthorized")');
  const t5_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': 'admin_token=invalid' }), mockEnv, {});
  const t5_data = await t5_res.json() as any;
  assert(t5_res.status === 401, 'Invalid session should return 401');
  assert(t5_data.error === 'Unauthorized', 'Error message should be exactly "Unauthorized"');
  console.log('✅ [PASSED] Unauthorized responses are generic');

  // 6. Empty/Whitespace Subject rejection
  console.log('Test 6: Reject empty or whitespace sub');
  const t6_token = await signTestToken({ sub: '   ', role: 'admin', iat: Date.now(), exp: Date.now() + 10000, iss: 'chatlustora-admin-auth', aud: 'chatlustora-admin-console' }, TEST_SECRET);
  const t6_res = await worker.fetch(createRequest('/api/admin/me', 'GET', null, { 'Cookie': `admin_token=${t6_token}` }), mockEnv, {});
  assert(t6_res.status === 401, 'Whitespace subject should return 401');
  console.log('✅ [PASSED] Whitespace sub rejected');

  // 7. Rate-Limit Reset Test
  console.log('Test 7: Rate-limit reset on successful login');
  const IP_1 = { 'CF-Connecting-IP': '1.1.1.1' };
  // 4 failed attempts
  for (let i = 0; i < 4; i++) {
    await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, IP_1);
  }
  // 1 successful login
  const t7_res = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, IP_1);
  assert(t7_res.status === 200, 'Login should succeed after 4 failures');
  
  // 1 more failure should NOT trigger 429 yet if counter was reset
  await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, IP_1);
  const t7_res2 = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, IP_1);
  assert(t7_res2.status === 200, 'Login should succeed after 1 more failure if counter was reset');
  console.log('✅ [PASSED] Successful login resets failure counter');

  // 8. Rate-Limit Lockout Test
  console.log('Test 8: Rate-limit lockout (5 attempts)');
  const IP_2 = { 'CF-Connecting-IP': '2.2.2.2' };
  for (let i = 0; i < 5; i++) {
    await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: 'bad' }), mockEnv, IP_2);
  }
  const t8_res = await worker.fetch(createRequest('/api/admin/login', 'POST', { username: TEST_USER, password: TEST_PASS }), mockEnv, IP_2);
  assert(t8_res.status === 429, 'Expected 429 after 5 failures');
  console.log('✅ [PASSED] Lockout enforced after 5 failures');

  console.log(`\n--- All ${totalAssertions} assertions PASSED! ---`);
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
