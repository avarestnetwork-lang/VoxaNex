
// Simulated Consent Logic for testing
type ConsentStatus = 'unset' | 'accepted' | 'rejected';

function migrateConsent(newStatus: string | null, legacyStatus: string | null): ConsentStatus {
  if (newStatus === 'accepted' || newStatus === 'rejected') {
    return newStatus as ConsentStatus;
  } else if (legacyStatus === 'granted') {
    return 'accepted';
  } else if (legacyStatus === 'denied') {
    return 'rejected';
  }
  return 'unset';
}

function runCookieConsentTests() {
  console.log('\n--- Running Cookie Consent Reliability Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`✅ [PASSED] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAILED] ${msg}`);
      failed++;
    }
  }

  // 1. Migration Tests
  assert(migrateConsent('accepted', null) === 'accepted', 'Migrate new status: accepted');
  assert(migrateConsent('rejected', null) === 'rejected', 'Migrate new status: rejected');
  assert(migrateConsent(null, 'granted') === 'accepted', 'Migrate legacy status: granted');
  assert(migrateConsent(null, 'denied') === 'rejected', 'Migrate legacy status: denied');
  assert(migrateConsent(null, null) === 'unset', 'No status');
  assert(migrateConsent('invalid', null) === 'unset', 'Invalid new status');

  console.log(`\nTests completed: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

runCookieConsentTests();
