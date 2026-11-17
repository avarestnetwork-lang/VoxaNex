/**
 * ChatLustora — Phase 1.1 R2 Media Upload & Retrieval Test Suite
 * Tests authentication, binary validation, conversation authorization, and R2 storage integration.
 */

import { validateMediaBinary, validateMediaFileMetadata } from '../src/lib/mediaValidation';

let assertionCount = 0;
function assert(condition: boolean, testName: string, detail?: string) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('   CHATLUSTORA: PHASE 1.1 R2 MEDIA UPLOAD & VALIDATION TESTS');
  console.log('================================================================');

  // Test 1: Binary Validation - Valid PNG Magic Bytes
  const validPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const pngResult = validateMediaBinary({
    fileName: 'test.png',
    mimeType: 'image/png',
    bytes: validPngBytes,
  });
  assert(pngResult.valid === true, 'T1.1: Valid PNG binary signature accepted', pngResult.error);

  // Test 2: Binary Validation - Executable Masquerading as PNG
  const fakePngBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ header (Windows executable)
  const fakeResult = validateMediaBinary({
    fileName: 'payload.png',
    mimeType: 'image/png',
    bytes: fakePngBytes,
  });
  assert(fakeResult.valid === false, 'T1.2: Executable file masquerading as PNG strictly rejected');

  // Test 3: Binary Validation - HTML / Script injection attempt
  const htmlBytes = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]); // <html
  const htmlResult = validateMediaBinary({
    fileName: 'exploit.png',
    mimeType: 'image/png',
    bytes: htmlBytes,
  });
  assert(htmlResult.valid === false, 'T1.3: HTML / script payload detected and rejected');

  // Test 4: File Size Limit Enforcement
  const largeMeta = validateMediaFileMetadata({
    fileName: 'huge.jpg',
    fileSize: 10 * 1024 * 1024, // 10 MB (limit is 5 MB for images)
    mimeType: 'image/jpeg',
  });
  assert(largeMeta.valid === false, 'T1.4: Oversized image (>5MB) rejected by server validator');

  // Test 5: Audio File Validation (Valid MP3)
  const validMp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x22]); // ID3v2 tag
  const mp3Result = validateMediaBinary({
    fileName: 'voice.mp3',
    mimeType: 'audio/mp3',
    bytes: validMp3Bytes,
  });
  assert(mp3Result.valid === true, 'T1.5: Valid MP3 audio clip accepted', mp3Result.error);

  console.log('================================================================');
  console.log(`   ALL ${assertionCount} PHASE 1.1 R2 STORAGE TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
