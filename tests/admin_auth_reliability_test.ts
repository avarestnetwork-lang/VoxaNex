import bcrypt from 'bcryptjs';

// Mocking some of the worker logic for testing
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function signAdminToken(payload: any, secret: string): Promise<string> {
  const base64Payload = toBase64Url(JSON.stringify(payload));
  const encoder = new TextEncoder();
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

async function verifyAdminToken(
  token: string | undefined,
  secret: string | undefined
): Promise<{ valid: boolean; payload?: any; reason?: string }> {
  if (!secret || secret.trim().length === 0) {
    return { valid: false, reason: 'Server configuration error: JWT_SECRET missing.' };
  }
  if (!token || !token.startsWith('vx_adm_')) {
    return { valid: false, reason: 'Missing or invalid token prefix.' };
  }

  const raw = token.slice('vx_adm_'.length);
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return { valid: false, reason: 'Invalid token structure.' };

  const base64Payload = raw.slice(0, dotIdx);
  const signatureHex = raw.slice(dotIdx + 1);

  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) {
    return { valid: false, reason: 'Malformed signature.' };
  }

  const sigBytes = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(base64Payload));
    if (!valid) return { valid: false, reason: 'Invalid signature.' };

    const payload = JSON.parse(fromBase64Url(base64Payload));
    
    if (!payload.exp || Date.now() >= payload.exp) {
      return { valid: false, reason: 'Session expired.' };
    }
    
    if (payload.role !== 'admin') {
      return { valid: false, reason: 'Incorrect role.' };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'Token verification failed.' };
  }
}

async function runTests() {
  console.log('--- Running Admin Auth Reliability Tests ---');

  const TEST_USER = 'admin';
  const TEST_PASS = 'password123';
  const TEST_HASH = bcrypt.hashSync(TEST_PASS, 10);
  const TEST_SECRET = 'a_very_long_secret_that_is_at_least_32_chars_long';

  // 1. Valid authentication
  const isPassValid = bcrypt.compareSync(TEST_PASS, TEST_HASH);
  if (!isPassValid) throw new Error('Bcrypt compare failed');
  console.log('✅ [PASSED] Bcrypt password verification');

  // 2. Token signing and verification
  const now = Date.now();
  const payload = {
    sub: TEST_USER,
    role: 'admin',
    iat: now,
    exp: now + 3600000
  };

  const token = await signAdminToken(payload, TEST_SECRET);
  if (!token.startsWith('vx_adm_')) throw new Error('Token prefix missing');
  console.log('✅ [PASSED] Token signing');

  const verify = await verifyAdminToken(token, TEST_SECRET);
  if (!verify.valid || verify.payload.sub !== TEST_USER) throw new Error('Token verification failed');
  console.log('✅ [PASSED] Token verification');

  // 3. Expired token
  const expiredPayload = { ...payload, exp: now - 1000 };
  const expiredToken = await signAdminToken(expiredPayload, TEST_SECRET);
  const verifyExpired = await verifyAdminToken(expiredToken, TEST_SECRET);
  if (verifyExpired.valid) throw new Error('Expired token should be invalid');
  console.log('✅ [PASSED] Expired token rejection');

  // 4. Incorrect role
  const wrongRolePayload = { ...payload, role: 'moderator' };
  const wrongRoleToken = await signAdminToken(wrongRolePayload, TEST_SECRET);
  const verifyWrongRole = await verifyAdminToken(wrongRoleToken, TEST_SECRET);
  if (verifyWrongRole.valid) throw new Error('Wrong role token should be invalid');
  console.log('✅ [PASSED] Incorrect role rejection');

  // 5. Invalid signature
  const tamperedToken = token.slice(0, -5) + (token.endsWith('0') ? '1' : '0') + token.slice(-4);
  const verifyTampered = await verifyAdminToken(tamperedToken, TEST_SECRET);
  if (verifyTampered.valid) throw new Error('Tampered token should be invalid');
  console.log('✅ [PASSED] Tampered signature rejection');

  // 6. Missing secret
  const verifyNoSecret = await verifyAdminToken(token, '');
  if (verifyNoSecret.valid) throw new Error('Verification without secret should be invalid');
  console.log('✅ [PASSED] Missing secret rejection');

  console.log('\nAll Admin Auth tests passed!');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
