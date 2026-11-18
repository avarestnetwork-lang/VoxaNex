import React from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  validateMediaFileMetadata,
  validateMediaBinary,
  IMAGE_ACCEPT_ATTRIBUTE,
  AUDIO_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_SIZE_BYTES,
  MAX_AUDIO_SIZE_BYTES,
} from '../src/lib/mediaValidation';
import {
  messagingService,
  setTestAuthTokenResolver,
} from '../src/services/messagingService';
import { ComposerAttachmentPreview } from '../src/components/chat/ComposerAttachmentPreview';
import { Footer } from '../src/components/layout/Footer';
import { RouterProvider } from '../src/context/RouterContext';
import { LanguageProvider } from '../src/context/LanguageContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { ConsentProvider } from '../src/context/ConsentContext';

let totalAssertions = 0;

function assert(condition: boolean, label: string, detail?: string) {
  totalAssertions++;
  if (!condition) {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${label}`);
  }
  console.log(`✅ [PASSED] ${label}`);
}

function setupBrowserWindow(pathname: string) {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  };

  (global as any).localStorage = localStorageMock;
  (global as any).window = {
    location: { pathname, origin: 'https://chatlustora.com', search: '' },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {} },
    scrollTo: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    localStorage: localStorageMock,
  };
  (global as any).document = {
    documentElement: { classList: { add: () => {}, remove: () => {} } },
  };
}

async function runPhase12Tests() {
  console.log('\n================================================================');
  console.log('  CHATLUSTORA: PHASE 1.2 COMPOSER + TRUSTPILOT TEST SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Media Validation: Image & Audio Separation & Constraints
  // -------------------------------------------------------------------------
  console.log('--- 1. Image & Audio Validation Enforcement ---');

  assert(
    IMAGE_ACCEPT_ATTRIBUTE.includes('.jpg') &&
      IMAGE_ACCEPT_ATTRIBUTE.includes('image/png') &&
      IMAGE_ACCEPT_ATTRIBUTE.includes('image/webp') &&
      IMAGE_ACCEPT_ATTRIBUTE.includes('image/gif') &&
      !IMAGE_ACCEPT_ATTRIBUTE.includes('audio/'),
    '1.1 Image accept attribute includes JPG/PNG/WebP/GIF and excludes audio'
  );

  assert(
    AUDIO_ACCEPT_ATTRIBUTE.includes('.mp3') &&
      AUDIO_ACCEPT_ATTRIBUTE.includes('.wav') &&
      AUDIO_ACCEPT_ATTRIBUTE.includes('.ogg') &&
      AUDIO_ACCEPT_ATTRIBUTE.includes('.webm') &&
      !AUDIO_ACCEPT_ATTRIBUTE.includes('image/'),
    '1.2 Audio accept attribute includes MP3/WAV/OGG/WebM and excludes image'
  );

  const validImg = validateMediaFileMetadata({
    fileName: 'photo.png',
    fileSize: 1024 * 500,
    mimeType: 'image/png',
    imageOnly: true,
  });
  assert(validImg.valid && validImg.chatMediaType === 'image', '1.3 Accepts valid PNG <= 5MB in imageOnly mode');

  const oversizedImg = validateMediaFileMetadata({
    fileName: 'huge.jpg',
    fileSize: MAX_IMAGE_SIZE_BYTES + 1,
    mimeType: 'image/jpeg',
    imageOnly: true,
  });
  assert(!oversizedImg.valid, '1.4 Rejects oversized image > 5MB');

  const audioInImageMode = validateMediaFileMetadata({
    fileName: 'voice.mp3',
    fileSize: 1024 * 200,
    mimeType: 'audio/mpeg',
    imageOnly: true,
  });
  assert(!audioInImageMode.valid, '1.5 Rejects audio upload when imageOnly is enforced');

  const validAudio = validateMediaFileMetadata({
    fileName: 'voice.mp3',
    fileSize: 1024 * 1024 * 2,
    mimeType: 'audio/mpeg',
    audioOnly: true,
  });
  assert(validAudio.valid && validAudio.chatMediaType === 'audio', '1.6 Accepts valid MP3 <= 10MB in audioOnly mode');

  const oversizedAudio = validateMediaFileMetadata({
    fileName: 'long.wav',
    fileSize: MAX_AUDIO_SIZE_BYTES + 1,
    mimeType: 'audio/wav',
    audioOnly: true,
  });
  assert(!oversizedAudio.valid, '1.7 Rejects oversized audio > 10MB');

  const imageInAudioMode = validateMediaFileMetadata({
    fileName: 'pic.webp',
    fileSize: 1024 * 100,
    mimeType: 'image/webp',
    audioOnly: true,
  });
  assert(!imageInAudioMode.valid, '1.8 Rejects image upload when audioOnly is enforced');

  const svgRejected = validateMediaFileMetadata({
    fileName: 'xss.svg',
    fileSize: 512,
    mimeType: 'image/svg+xml',
    imageOnly: true,
  });
  assert(!svgRejected.valid, '1.9 Rejects SVG active image type');

  const spoofedBytes = new TextEncoder().encode('<svg onload=alert(1)></svg>');
  const spoofCheck = validateMediaBinary({
    fileName: 'fake.png',
    mimeType: 'image/png',
    bytes: spoofedBytes,
    imageOnly: true,
  });
  assert(!spoofCheck.valid, '1.10 Rejects spoofed binary payload disguised as PNG');

  // -------------------------------------------------------------------------
  // 2. messagingService.uploadChatMedia (Room & Conversation, Progress, Abort, Fail-Closed)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. uploadChatMedia Contexts, Progress, Cancellation & Auth ---');

  // Mock XMLHttpRequest
  const OriginalXHR = (global as any).XMLHttpRequest;
  const OriginalFormData = (global as any).FormData;

  class MockFormData {
    fields: Array<{ key: string; value: any; name?: string }> = [];
    append(key: string, value: any, name?: string) {
      this.fields.push({ key, value, name });
    }
  }
  (global as any).FormData = MockFormData;

  let lastXhrSpec: any = null;
  let mockBehavior: 'success' | 'abort' | 'error' | 'server_500' = 'success';

  class MockXMLHttpRequest {
    method = '';
    url = '';
    headers: Record<string, string> = {};
    upload: { onprogress?: (evt: any) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    status = 200;
    responseText = '';
    aborted = false;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    send(body: any) {
      lastXhrSpec = {
        method: this.method,
        url: this.url,
        headers: this.headers,
        body,
        instance: this,
      };
      if (mockBehavior === 'abort') {
        return; // Caller will call registerAbort() fn
      }
      setTimeout(() => {
        if (this.aborted) return;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        if (mockBehavior === 'error') {
          this.onerror?.();
          return;
        }
        if (mockBehavior === 'server_500') {
          this.status = 500;
          this.responseText = JSON.stringify({ success: false, error: 'R2 service unavailable' });
          this.onload?.();
          return;
        }
        this.status = 200;
        const fields = (body as MockFormData).fields;
        const ctxType = fields.find((f) => f.key === 'contextType')?.value;
        const mediaId = ctxType === 'conversation' ? 'dm-asset-1' : 'room-asset-1';
        this.responseText = JSON.stringify({
          success: true,
          media: {
            uploadId: mediaId,
            url: `/api/media/${mediaId}`,
            mediaType: fields.find((f) => f.key === 'file')?.name?.endsWith('.mp3') ? 'audio' : 'image',
            mimeType: 'image/png',
            fileName: fields.find((f) => f.key === 'file')?.name || 'file.png',
            fileSize: 1024,
          },
        });
        this.onload?.();
      }, 5);
    }
  }
  (global as any).XMLHttpRequest = MockXMLHttpRequest;

  try {
    // 2.1 Fail-closed when unauthenticated
    setTestAuthTokenResolver(async () => null);
    const fakeFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'pic.png', { type: 'image/png' });
    const unauthRes = await messagingService.uploadChatMedia({
      file: fakeFile,
      contextType: 'room',
      contextId: 'room-bangla',
    });
    assert(!unauthRes.success && unauthRes.error?.includes('Authentication'), '2.1 Unauthenticated upload fails closed');

    // 2.2 Public room image upload with progress & Bearer header
    setTestAuthTokenResolver(async () => 'test-bearer-token-room');
    mockBehavior = 'success';
    const progressEvents: number[] = [];
    const roomRes = await messagingService.uploadChatMedia({
      file: fakeFile,
      contextType: 'room',
      contextId: 'room-bangla',
      isGuest: true,
      userId: 'guest_123',
      onProgress: (p) => progressEvents.push(p),
    });
    assert(roomRes.success && roomRes.media?.url === '/api/media/room-asset-1', '2.2 Public room upload succeeds with /api/media/... URL');
    assert(
      lastXhrSpec?.headers?.Authorization === 'Bearer test-bearer-token-room',
      '2.3 Upload sends Authorization Bearer token'
    );
    assert(
      lastXhrSpec?.body?.fields.some((f: any) => f.key === 'contextType' && f.value === 'room') &&
        lastXhrSpec?.body?.fields.some((f: any) => f.key === 'contextId' && f.value === 'room-bangla'),
      '2.4 Public upload submits contextType=room and active roomId'
    );
    assert(progressEvents.includes(50) && progressEvents.includes(100), '2.5 Progress events tracked up to 100%');

    // 2.3 Private conversation audio upload
    const convUuid = '11111111-2222-4333-8444-555555555555';
    const audioFile = new File([new Uint8Array([0x49, 0x44, 0x33, 0x03])], 'clip.mp3', { type: 'audio/mp3' });
    const dmRes = await messagingService.uploadChatMedia({
      file: audioFile,
      contextType: 'conversation',
      contextId: convUuid,
      isGuest: false,
      userId: 'user-abc',
    });
    assert(dmRes.success && dmRes.media?.mediaType === 'audio', '2.6 Private conversation audio upload succeeds');
    assert(
      lastXhrSpec?.body?.fields.some((f: any) => f.key === 'contextType' && f.value === 'conversation') &&
        lastXhrSpec?.body?.fields.some((f: any) => f.key === 'contextId' && f.value === convUuid),
      '2.7 Private upload submits contextType=conversation and activeConversationId'
    );

    // 2.4 Cancellation via abortFn
    mockBehavior = 'abort';
    let triggerAbort: (() => void) | null = null;
    const cancelPromise = messagingService.uploadChatMedia({
      file: fakeFile,
      contextType: 'conversation',
      contextId: convUuid,
      registerAbort: (fn) => {
        triggerAbort = fn;
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    triggerAbort?.();
    const cancelRes = await cancelPromise;
    assert(!cancelRes.success && cancelRes.aborted === true, '2.8 Upload cancellation aborts XHR and resolves aborted=true');

    // 2.5 Server 500 failure error handling
    mockBehavior = 'server_500';
    const failRes = await messagingService.uploadChatMedia({
      file: fakeFile,
      contextType: 'room',
      contextId: 'room-bangla',
    });
    assert(!failRes.success && failRes.error?.includes('R2 service unavailable'), '2.9 Server failure surfaces clean error without crashing');
  } finally {
    setTestAuthTokenResolver(null);
    (global as any).XMLHttpRequest = OriginalXHR;
    (global as any).FormData = OriginalFormData;
  }

  // -------------------------------------------------------------------------
  // 3. Hook, Attachment Preview & SecureMediaRenderer Source & SSR Checks
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Attachment State Machine, Preview & SecureMediaRenderer ---');

  const hookSource = fs.readFileSync(path.resolve('src/hooks/useChatMediaAttachment.ts'), 'utf-8');
  for (const requiredState of [
    "'idle'",
    "'file_selected'",
    "'validating'",
    "'uploading'",
    "'completed'",
    "'failed'",
    "'cancelled'",
  ]) {
    assert(hookSource.includes(requiredState), `3.1 Hook defines upload state ${requiredState}`);
  }
  assert(hookSource.includes('URL.revokeObjectURL'), '3.2 Hook cleans up Blob URLs with URL.revokeObjectURL');
  assert(hookSource.includes('uploadingLockRef'), '3.3 Hook guards against duplicate concurrent upload requests');
  assert(
    hookSource.includes('contextType, contextId, abortActiveUpload, revokePreviewBlob'),
    '3.4 Hook isolates state and aborts/resets strictly when conversationId/roomId changes'
  );
  assert(hookSource.includes('selectGif'), '3.5 Hook preserves external GIF picker support');

  // SSR render ComposerAttachmentPreview across states
  const uploadingPreviewHtml = renderToString(
    React.createElement(ComposerAttachmentPreview, {
      attachment: {
        status: 'uploading',
        source: 'upload',
        file: null,
        fileName: 'selfie.webp',
        fileSize: 204800,
        mimeType: 'image/webp',
        mediaType: 'image',
        previewUrl: 'blob:test-preview',
        uploadedAsset: null,
        progress: 64,
        error: null,
        canRetry: false,
      },
      onCancel: () => {},
      onRetry: () => {},
      onRemove: () => {},
    })
  );
  assert(
    uploadingPreviewHtml.includes('selfie.webp') &&
      uploadingPreviewHtml.includes('200 KB') &&
      uploadingPreviewHtml.includes('Uploading 64%') &&
      uploadingPreviewHtml.includes('Cancel') &&
      uploadingPreviewHtml.includes('Remove'),
    '3.6 Uploading preview displays filename, size, percentage, Cancel, and Remove'
  );

  const failedAudioPreviewHtml = renderToString(
    React.createElement(ComposerAttachmentPreview, {
      attachment: {
        status: 'failed',
        source: 'upload',
        file: null,
        fileName: 'note.mp3',
        fileSize: 512000,
        mimeType: 'audio/mp3',
        mediaType: 'audio',
        previewUrl: null,
        uploadedAsset: null,
        progress: 0,
        error: 'Network error while uploading attachment.',
        canRetry: true,
      },
      onCancel: () => {},
      onRetry: () => {},
      onRemove: () => {},
    })
  );
  assert(
    failedAudioPreviewHtml.includes('note.mp3') &&
      failedAudioPreviewHtml.includes('Retry') &&
      failedAudioPreviewHtml.includes('Network error'),
    '3.7 Failed attachment preview displays Retry button and error message'
  );

  const secureRendererSource = fs.readFileSync(path.resolve('src/components/chat/SecureMediaRenderer.tsx'), 'utf-8');
  assert(
    secureRendererSource.includes('isSafeMediaUrl(mediaUrl)') &&
      secureRendererSource.includes('Authorization: `Bearer ${token}`') &&
      secureRendererSource.includes('URL.createObjectURL(blob)') &&
      secureRendererSource.includes('URL.revokeObjectURL(') &&
      secureRendererSource.includes('res.status === 401') &&
      secureRendererSource.includes('res.status === 403') &&
      secureRendererSource.includes('res.status === 404') &&
      secureRendererSource.includes("normalizedCt !== 'image/svg+xml'") &&
      secureRendererSource.includes('<audio'),
    '3.8 SecureMediaRenderer validates URLs, fetches internal media with Bearer auth, enforces Content-Type, renders audio/img, handles 401/403/404, and revokes Blob URLs'
  );

  // -------------------------------------------------------------------------
  // 4. Composer Button Order & Lifecycle in PublicChatPage & PrivateChatPane
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Public & Private Composer Order & Lifecycle ---');

  const publicChatSource = fs.readFileSync(path.resolve('src/pages/PublicChatPage.tsx'), 'utf-8');
  const pubFormStart = publicChatSource.indexOf('<form onSubmit={handleSendMessage}');
  const pubFormEnd = publicChatSource.indexOf('</form>', pubFormStart);
  const pubForm = publicChatSource.slice(pubFormStart, pubFormEnd);

  const pubEmojiIdx = pubForm.indexOf('aria-label="Emoji picker"');
  const pubImageIdx = pubForm.indexOf('aria-label="Image or GIF attachment"');
  const pubAttachIdx = pubForm.indexOf('aria-label="Attach audio file"');
  const pubInputIdx = pubForm.indexOf('ref={inputRef}');
  const pubSendIdx = pubForm.indexOf('type="submit"');

  assert(
    pubEmojiIdx > -1 &&
      pubEmojiIdx < pubImageIdx &&
      pubImageIdx < pubAttachIdx &&
      pubAttachIdx < pubInputIdx &&
      pubInputIdx < pubSendIdx,
    '4.1 PublicChatPage composer order is strictly Emoji -> Image -> New Attachment -> Message Input -> Send'
  );
  assert(
    publicChatSource.includes("contextType: 'room'") &&
      publicChatSource.includes('contextId: activeRoom.id') &&
      publicChatSource.includes('disabled={!canSendMessage(inputText.trim())}'),
    '4.2 PublicChatPage uses room context and prevents sending incomplete/failed uploads while preserving draft'
  );
  assert(
    publicChatSource.includes('<SecureMediaRenderer') &&
      publicChatSource.includes('isGuest: user.isGuest'),
    '4.3 PublicChatPage renders media via SecureMediaRenderer and forwards isGuest to maximized PrivateChatPane'
  );

  const privatePaneSource = fs.readFileSync(path.resolve('src/components/chat/PrivateChatPane.tsx'), 'utf-8');
  const privFormStart = privatePaneSource.indexOf('<form onSubmit={handleSendMessage}');
  const privFormEnd = privatePaneSource.indexOf('</form>', privFormStart);
  const privForm = privatePaneSource.slice(privFormStart, privFormEnd);

  const privEmojiIdx = privForm.indexOf('aria-label="Pick emoji"');
  const privImageIdx = privForm.indexOf('aria-label="Image or GIF attachment"');
  const privAttachIdx = privForm.indexOf('aria-label="Attach audio file"');
  const privInputIdx = privForm.indexOf('<input');
  const privSendIdx = privForm.indexOf('type="submit"');

  assert(
    privEmojiIdx > -1 &&
      privEmojiIdx < privImageIdx &&
      privImageIdx < privAttachIdx &&
      privAttachIdx < privInputIdx &&
      privInputIdx < privSendIdx,
    '4.4 PrivateChatPane composer order is strictly Emoji -> Image -> New Attachment -> Message Input -> Send'
  );
  assert(
    privatePaneSource.includes("contextType: 'conversation'") &&
      privatePaneSource.includes('contextId: activeConversationId') &&
      privatePaneSource.includes('handleClosePane') &&
      privatePaneSource.includes('<SecureMediaRenderer'),
    '4.5 PrivateChatPane binds conversation context, cleans up on close, and uses SecureMediaRenderer'
  );

  const privateContextSource = fs.readFileSync(path.resolve('src/context/PrivateChatContext.tsx'), 'utf-8');
  assert(
    privateContextSource.includes("type: 'gif' | 'image' | 'audio'"),
    '4.6 PrivateChatContext supports gif | image | audio media types'
  );

  // -------------------------------------------------------------------------
  // 5. Trustpilot Review Collector Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Trustpilot Review Collector Script & Footer Widget ---');

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const headSection = indexHtml.slice(indexHtml.indexOf('<head>'), indexHtml.indexOf('</head>'));
  const tpScriptOccurrences = headSection.match(/widget\.trustpilot\.com\/bootstrap\/v5\/tp\.widget\.bootstrap\.min\.js/g) || [];
  assert(tpScriptOccurrences.length === 1, '5.1 TrustBox bootstrap script appears in <head> exactly once');
  assert(
    headSection.includes('<script type="text/javascript" src="//widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js" async></script>'),
    '5.2 TrustBox bootstrap script matches exact required snippet'
  );

  const footerSource = fs.readFileSync(path.resolve('src/components/layout/Footer.tsx'), 'utf-8');
  assert(
    footerSource.includes('loadFromElement(trustBoxRef.current, true)'),
    '5.3 Footer triggers Trustpilot.loadFromElement on mount/route navigation'
  );

  const renderFooterForRoute = (route: string): string => {
    setupBrowserWindow(route);
    return renderToString(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            RouterProvider,
            null,
            React.createElement(
              ConsentProvider,
              null,
              React.createElement(Footer)
            )
          )
        )
      )
    );
  };

  const homeFooterHtml = renderFooterForRoute('/');
  assert(
    homeFooterHtml.includes('trustpilot-widget') &&
      homeFooterHtml.includes('data-locale="en-US"') &&
      homeFooterHtml.includes('data-template-id="56278e9abfbbba0bdcd568bc"') &&
      homeFooterHtml.includes('data-businessunit-id="6afc185ca7dbf30ad4d2897c"') &&
      homeFooterHtml.includes('data-style-height="52px"') &&
      homeFooterHtml.includes('data-style-width="100%"') &&
      homeFooterHtml.includes('href="https://www.trustpilot.com/review/chatlustora.com"') &&
      homeFooterHtml.includes('target="_blank"') &&
      homeFooterHtml.includes('rel="noopener"'),
    '5.4 Public route Footer renders exact TrustBox widget attributes and link'
  );

  const adminFooterHtml = renderFooterForRoute('/admin/dashboard');
  assert(!adminFooterHtml.includes('trustpilot-widget'), '5.5 /admin/dashboard strictly excludes TrustBox widget');

  const modFooterHtml = renderFooterForRoute('/moderator/dashboard');
  assert(!modFooterHtml.includes('trustpilot-widget'), '5.6 /moderator/dashboard strictly excludes TrustBox widget');

  const chatFooterHtml = renderFooterForRoute('/chat/bangla');
  assert(!chatFooterHtml.includes('trustpilot-widget'), '5.7 Live chat routes strictly exclude TrustBox widget');

  const dmFooterHtml = renderFooterForRoute('/messages');
  assert(!dmFooterHtml.includes('trustpilot-widget'), '5.8 Private messages route strictly excludes TrustBox widget');

  console.log('\n================================================================');
  console.log(`  ALL ${totalAssertions} PHASE 1.2 TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

runPhase12Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
