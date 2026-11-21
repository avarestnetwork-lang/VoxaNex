import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import {
  AdPlacementBox,
  hasValidCreative,
  validateCreative,
  resolveEffectiveUnitId,
  computeProviderTransition,
  isAttemptCurrent,
  cancelQueuedAdsterraTasksForSlot,
  ensureHeadScriptOnce,
  claimSlotInstance,
  releaseSlotInstance,
  getActiveSlotInstanceCount,
  isVisibilityEligibleForAdActivity,
  evaluateAuthorizedRefresh,
  getProviderSessionRotationCount,
  recordProviderSessionRotation,
  resetProviderSessionRotations,
} from '../src/components/ads/AdPlacementBox';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  JUICYADS_CONFIG,
  MONETAG_CONFIG,
  ADSENSE_CONFIG,
  TRAFFICSTARS_CONFIG,
  PROVIDER_REFRESH_POLICIES,
  getProviderRefreshPolicy,
  getProviderRotation,
  isAdSenseExcludedRoute,
  isInternalHorizontalPlacement,
  getPlacementOrientation,
  getReservedDimensionTarget,
  VERIFIED_AD_UNITS,
  getVerifiedAdUnitSpec,
  getVerifiedVerticalUnitForProvider,
} from '../src/config/adsConfig';
import { RouterProvider } from '../src/context/RouterContext';

let totalAssertions = 0;

function assert(condition: boolean, message: string) {
  totalAssertions++;
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] ${message}`);
}

async function runAdRenderingTests() {
  console.log('\n================================================================');
  console.log('  CHATLUSTORA: WORK PROMPT 6 AD TIMER, OBSERVER & POLICY TESTS');
  console.log('================================================================\n');

  // --- Task 1: Timer Cleanup & Observer Lifecycle Assertions ---
  console.log('--- 1. Reliable Timer & MutationObserver Cleanup ---');

  const adPlacementBoxSource = fs.readFileSync(
    path.resolve('src/components/ads/AdPlacementBox.tsx'),
    'utf-8'
  );

  assert(
    adPlacementBoxSource.includes('clearAllActiveTimers'),
    '1.1 clearAllActiveTimers function is defined and invoked on status transition and unmount'
  );
  assert(
    adPlacementBoxSource.includes('disconnectObserver'),
    '1.2 disconnectObserver function is defined and invoked on route changes and unmount'
  );
  assert(
    adPlacementBoxSource.includes('currentRoute') && adPlacementBoxSource.includes('providerIndex'),
    '1.3 Route changes and provider changes trigger observer and timer cleanup'
  );
  assert(
    adPlacementBoxSource.includes('ticks >= baseTimeoutTicks') &&
      adPlacementBoxSource.includes("updateStatus('unfilled', attemptId)"),
    '1.4 JuicyAds timeout without actual rendered content marks slot unfilled rather than erroneously filled'
  );

  // --- Task 2: Non-Overridable Route Exclusion & AdSense Safety ---
  console.log('\n--- 2. Non-Overridable Route Exclusion & AdSense Safety ---');

  assert(
    adPlacementBoxSource.includes('isExcludedByRoute || Boolean(isLiveChatScreenProp)'),
    '2.1 Route exclusion strictly overrides explicit component props'
  );

  assert(isAdSenseExcludedRoute('/chat'), '2.2 /chat route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/bangla'), '2.3 /chat/bangla route excludes AdSense');
  assert(isAdSenseExcludedRoute('/messages'), '2.4 /messages route excludes AdSense');
  assert(isAdSenseExcludedRoute('/av-chat'), '2.5 /av-chat route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/video'), '2.6 /chat/video route excludes AdSense');
  assert(isAdSenseExcludedRoute('/random'), '2.7 /random route excludes AdSense');
  assert(isAdSenseExcludedRoute('/user/guest-entry'), '2.8 /user/guest-entry route excludes AdSense');

  // Eligible public routes
  assert(!isAdSenseExcludedRoute('/'), '2.9 Landing page / is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/rooms'), '2.10 Room directory /rooms is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/about'), '2.11 About page /about is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/blog'), '2.12 Blog page /blog is eligible for AdSense');

  // Set window location to excluded route /chat
  if (typeof global !== 'undefined') {
    (global as any).window = {
      location: { pathname: '/chat' },
      history: { pushState: () => {}, back: () => {} },
      scrollTo: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  const excludedRouteHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'excluded-route-slot',
        provider: 'adsense',
        isLiveChatScreen: false, // Attempt override
      })
    )
  );
  assert(
    !excludedRouteHtml.includes('adsbygoogle'),
    '2.13 Excluded route cannot render AdSense slot container even with prop override attempt'
  );

  // --- Task 3: Network Configs & Layout Preservation ---
  console.log('\n--- 3. Network Configurations & Layout Preservation ---');

  assert(ADSTERRA_CONFIG.publisherId === '6190760', '3.1 Adsterra Publisher ID is 6190760');
  assert(ADSTERRA_CONFIG.nativeUnitId === '4085ad0bb94688c1cdc0917f2df29137', '3.2 Adsterra Native Unit ID is intact');
  assert(JUICYADS_CONFIG.zones.banner300x62 === '1131763', '3.3 JuicyAds 300x62 Zone ID is 1131763');
  assert(JUICYADS_CONFIG.zones.banner728x102 === '1131766', '3.4 JuicyAds 728x102 Zone ID is 1131766');
  assert(MONETAG_CONFIG.scriptUrl === 'https://nap5k.com/tag.min.js', '3.5 Monetag script URL is correct');
  assert(MONETAG_CONFIG.enabled === true, '3.6 Monetag is enabled');
  assert(EXOCLICK_CONFIG.enabled === true, '3.7 ExoClick is enabled');
  assert(EXOCLICK_CONFIG.zoneId === '6087300', '3.7a ExoClick zone ID is 6087300');
  assert(EXOCLICK_CONFIG.elementClass === 'eas6a97888e2', '3.7b ExoClick element class is eas6a97888e2');
  assert(MONETAG_CONFIG.zoneId === '12241585', '3.7c Monetag zone ID is 12241585');

  const chatroomRotation = getProviderRotation('top', true);
  assert(
    chatroomRotation.length === 4 &&
      chatroomRotation.includes('adsterra') &&
      chatroomRotation.includes('juicyads') &&
      chatroomRotation.includes('exoclick') &&
      chatroomRotation.includes('monetag') &&
      !chatroomRotation.includes('adsense'),
    '3.8 Chatroom rotation strictly enforces exactly 4 networks without AdSense'
  );

  const nonChatroomRotation = getProviderRotation('top', false);
  assert(
    nonChatroomRotation.length === 5 &&
      nonChatroomRotation.includes('adsense') &&
      nonChatroomRotation.includes('adsterra') &&
      nonChatroomRotation.includes('juicyads') &&
      nonChatroomRotation.includes('exoclick') &&
      nonChatroomRotation.includes('monetag'),
    '3.9 Non-chatroom rotation includes all 5 networks including AdSense'
  );

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"') &&
      publicChatPageSource.includes('slotId="public-chatroom-left"') &&
      publicChatPageSource.includes('slotId="public-chatroom-right"') &&
      publicChatPageSource.includes('slotId="participant-box-horizontal"') &&
      publicChatPageSource.includes('slotId="public-chatroom-bottom"') &&
      publicChatPageSource.includes('slotId="public-chatroom-status-inline"') &&
      publicChatPageSource.includes('slotId="public-chatroom-message-inline"'),
    '3.10 All 7 chatroom ad placement IDs (original 5 plus status-inline and message-inline) are present'
  );
  assert(
    publicChatPageSource.includes('h-[calc(100vh-5.5rem)] min-h-[580px]'),
    '3.11 Central chatroom container dimensions are strictly preserved'
  );

  assert(!publicChatPageSource.includes('BanglishHelperBar'), '3.12 BanglishHelperBar is successfully removed');

  const composerStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerEnd = publicChatPageSource.indexOf('</form>', composerStart) + 7;
  const composerCode = publicChatPageSource.slice(composerStart, composerEnd);
  assert(!composerCode.includes('AdPlacementBox'), '3.13 No ad inserted into message composer');

  // --- Task 8: Behavioral Responsive Unit Selection Assertions ---
  console.log('\n--- 8. Behavioral Responsive Unit Selection & Preconfigured Override Protection ---');

  // 8.1 Mobile Top Ad: Preconfigured 728x90 unit must NOT bypass responsive selection on 375px mobile
  const mobileTopUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'top',
    slotId: 'public-chatroom-top',
    primaryAdUnitId: ADSTERRA_CONFIG.banner728x90,
    containerWidth: 375,
    isLiveChatScreen: true,
  });
  assert(
    mobileTopUnit === ADSTERRA_CONFIG.banner320x50,
    '8.1 Mobile (375px): Preconfigured 728x90 desktop unit is downgraded to 320x50 banner format'
  );

  // 8.2 Tablet Top Ad: 768px container safely accommodates 728x90
  const tabletTopUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'top',
    slotId: 'public-chatroom-top',
    primaryAdUnitId: ADSTERRA_CONFIG.banner728x90,
    containerWidth: 768,
    isLiveChatScreen: true,
  });
  assert(
    tabletTopUnit === ADSTERRA_CONFIG.banner728x90,
    '8.2 Tablet (768px): Top ad safely selects 728x90 banner format'
  );

  // 8.3 Mobile Bottom Ad: Preconfigured 728x90 downgraded on 390px mobile
  const mobileBottomUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'bottom',
    slotId: 'public-chatroom-bottom',
    primaryAdUnitId: ADSTERRA_CONFIG.banner728x90,
    containerWidth: 390,
    isLiveChatScreen: true,
  });
  assert(
    mobileBottomUnit === ADSTERRA_CONFIG.banner320x50,
    '8.3 Mobile (390px): Bottom ad selects 320x50 banner format'
  );

  // 8.4 Narrow viewport (<320px) returns null to prevent clipping and overflow
  const tooNarrowUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'top',
    slotId: 'public-chatroom-top',
    containerWidth: 300,
    isLiveChatScreen: true,
  });
  assert(
    tooNarrowUnit === null,
    '8.4 Insufficient width (<320px): Returns null to trigger fallback/clean collapse'
  );

  // 8.5 Internal status-inline ad on mobile
  const statusInlineUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'sidebar-horizontal',
    slotId: 'public-chatroom-status-inline',
    primaryAdUnitId: ADSTERRA_CONFIG.banner320x50,
    containerWidth: 430,
    isLiveChatScreen: true,
  });
  assert(
    statusInlineUnit === ADSTERRA_CONFIG.banner320x50,
    '8.5 Status-inline ad on mobile (430px) selects 320x50 banner'
  );

  // 8.6 Internal message-inline ad on desktop
  const messageInlineUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'sidebar-horizontal',
    slotId: 'public-chatroom-message-inline',
    primaryAdUnitId: ADSTERRA_CONFIG.banner320x50,
    containerWidth: 850,
    isLiveChatScreen: true,
  });
  assert(
    messageInlineUnit === ADSTERRA_CONFIG.banner320x50,
    '8.6 Message-inline ad on desktop (850px) maintains compact 320x50 height'
  );

  // 8.7 JuicyAds horizontal mobile vs desktop
  const juicyMobile = resolveEffectiveUnitId({
    provider: 'juicyads',
    position: 'top',
    slotId: 'public-chatroom-top',
    containerWidth: 375,
    isLiveChatScreen: true,
  });
  assert(
    juicyMobile === JUICYADS_CONFIG.zones.banner300x62,
    '8.7 JuicyAds horizontal on mobile (375px) selects 300x62 zone (1131763)'
  );

  const juicyDesktop = resolveEffectiveUnitId({
    provider: 'juicyads',
    position: 'top',
    slotId: 'public-chatroom-top',
    containerWidth: 1280,
    isLiveChatScreen: true,
  });
  assert(
    juicyDesktop === JUICYADS_CONFIG.zones.banner728x102,
    '8.8 JuicyAds horizontal on desktop (1280px) selects 728x102 zone (1131766)'
  );

  // 8.9 JuicyAds vertical sidebar: narrow vs wide
  const juicyVerticalNarrow = resolveEffectiveUnitId({
    provider: 'juicyads',
    position: 'left',
    slotId: 'public-chatroom-left',
    isVertical: true,
    containerWidth: 160,
    isLiveChatScreen: true,
  });
  assert(
    juicyVerticalNarrow === null,
    '8.9 JuicyAds vertical on narrow rail (160px) returns null to prevent clipping'
  );

  const juicyVerticalWide = resolveEffectiveUnitId({
    provider: 'juicyads',
    position: 'left',
    slotId: 'public-chatroom-left',
    isVertical: true,
    containerWidth: 300,
    isLiveChatScreen: true,
  });
  assert(
    juicyVerticalWide === null,
    '8.10 JuicyAds vertical on wide rail (300px) rejects landscape 300x262 zone (1131765) and returns null'
  );

  // --- Task 9: Behavioral Creative Verification & DOM Integrity Assertions ---
  console.log('\n--- 9. Behavioral Creative Verification (validateCreative & hasValidCreative) ---');

  function createMockNode({
    tag = 'div',
    children = [],
    attrs = {},
    style = {},
    offsetWidth = 0,
    offsetHeight = 0,
    src = '',
    data = '',
    naturalWidth = 0,
    naturalHeight = 0,
    videoWidth = 0,
    videoHeight = 0,
    readyState = 0,
    contentDocument = null,
  }: any = {}): any {
    const node: any = {
      tagName: tag.toUpperCase(),
      style: { display: 'block', visibility: 'visible', ...style },
      offsetWidth,
      offsetHeight,
      clientWidth: offsetWidth,
      clientHeight: offsetHeight,
      src,
      data,
      naturalWidth,
      naturalHeight,
      videoWidth,
      videoHeight,
      readyState,
      children,
      contentDocument,
      contentWindow: contentDocument ? { document: contentDocument } : null,
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      matches(selector: string) {
        if (selector === 'ins[data-ad-status]') {
          return node.tagName === 'INS' && attrs['data-ad-status'] !== undefined;
        }
        return false;
      },
      querySelector(selector: string) {
        const matches = node.querySelectorAll(selector);
        return matches.length > 0 ? matches[0] : null;
      },
      querySelectorAll(selector: string) {
        const results: any[] = [];
        const selectors = selector.split(',').map(s => s.trim().toUpperCase());
        function traverse(n: any) {
          for (const c of n.children || []) {
            if (selector === '*') {
              results.push(c);
            } else if (selectors.includes(c.tagName)) {
              results.push(c);
            } else if (selector.includes('ins[data-ad-status]') && c.tagName === 'INS' && c.getAttribute('data-ad-status')) {
              results.push(c);
            }
            traverse(c);
          }
        }
        traverse(node);
        return results;
      },
    };
    return node;
  }

  // 9.1 Null element rejected as empty
  const nullResult = validateCreative(null);
  assert(nullResult.status === 'empty' && hasValidCreative(null) === false, '9.1 Null container is strictly rejected as empty and unfilled');

  // 9.2 Empty wrapper div rejected as empty
  const emptyContainer = createMockNode({ tag: 'div', children: [] });
  const emptyResult = validateCreative(emptyContainer);
  assert(emptyResult.status === 'empty' && hasValidCreative(emptyContainer) === false, '9.2 Empty wrapper div is strictly rejected as empty');

  // 9.3 Script-only container rejected as script_only
  const scriptOnly = createMockNode({
    tag: 'div',
    children: [createMockNode({ tag: 'script', src: 'https://nap5k.com/tag.min.js' })],
  });
  const scriptResult = validateCreative(scriptOnly);
  assert(scriptResult.status === 'script_only' && hasValidCreative(scriptOnly) === false, '9.3 Script-only container is strictly rejected as script_only');

  // 9.4 Arbitrary non-creative text/placeholder elements rejected
  const textPlaceholder = createMockNode({
    tag: 'div',
    children: [createMockNode({ tag: 'span' }), createMockNode({ tag: 'p' })],
  });
  const textResult = validateCreative(textPlaceholder);
  assert(
    textResult.status === 'unfilled' && hasValidCreative(textPlaceholder) === false,
    '9.4 Arbitrary non-creative text/wrapper elements are strictly rejected as unfilled'
  );

  // 9.5 Hidden iframe rejected
  const hiddenIframeContainer = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad',
        offsetWidth: 300,
        offsetHeight: 250,
        style: { display: 'none' },
      }),
    ],
  });
  assert(
    validateCreative(hiddenIframeContainer).status === 'unfilled' && hasValidCreative(hiddenIframeContainer) === false,
    '9.5 Hidden iframe (display: none) is strictly rejected as unfilled'
  );

  // 9.6 Zero-sized iframe without src rejected
  const zeroSizeIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        attrs: { width: '0', height: '0' },
        offsetWidth: 0,
        offsetHeight: 0,
      }),
    ],
  });
  assert(
    validateCreative(zeroSizeIframe).status === 'unfilled' && hasValidCreative(zeroSizeIframe) === false,
    '9.6 Zero-sized iframe without src is strictly rejected as unfilled'
  );

  // 9.7 Iframe with a URL but zero rendered dimensions must NOT qualify as filled
  const iframeWithUrlZeroDimensions = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://www.highrevenueformat.com/banner.html',
        offsetWidth: 0,
        offsetHeight: 0,
      }),
    ],
  });
  const iframeZeroDimsResult = validateCreative(iframeWithUrlZeroDimensions);
  assert(
    iframeZeroDimsResult.status === 'unfilled' && hasValidCreative(iframeWithUrlZeroDimensions) === false,
    '9.7 Iframe with a URL but zero rendered dimensions is strictly rejected as unfilled'
  );

  // 9.8 Iframe with width/height attributes without actual rendered dimensions must NOT qualify
  const iframeWithAttrsZeroRendered = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        attrs: { width: '728', height: '90' },
        src: 'https://www.highrevenueformat.com/banner.html',
        offsetWidth: 0,
        offsetHeight: 0,
      }),
    ],
  });
  assert(
    validateCreative(iframeWithAttrsZeroRendered).status === 'unfilled' && hasValidCreative(iframeWithAttrsZeroRendered) === false,
    '9.8 Iframe with width/height attributes without actual rendered dimensions is strictly rejected as unfilled'
  );

  // 9.9 Broken image with zero natural dimensions must NOT qualify despite positive offsetWidth/clientWidth
  const brokenImageContainer = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/broken-ad.png',
        offsetWidth: 300,
        offsetHeight: 250,
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ],
  });
  const brokenImageResult = validateCreative(brokenImageContainer);
  assert(
    brokenImageResult.status === 'unfilled' && hasValidCreative(brokenImageContainer) === false,
    '9.9 Broken image with zero natural dimensions is strictly rejected as unfilled'
  );

  // 9.10 Successfully loaded image creative with positive natural and rendered dimensions is confirmed filled
  const validLoadedImage = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/banner320x50.png',
        offsetWidth: 320,
        offsetHeight: 50,
        naturalWidth: 320,
        naturalHeight: 50,
      }),
    ],
  });
  const loadedImageResult = validateCreative(validLoadedImage);
  assert(
    loadedImageResult.status === 'confirmed_filled' &&
      loadedImageResult.isConfirmedFilled === true &&
      hasValidCreative(validLoadedImage) === true,
    '9.10 Successfully loaded image with positive natural dimensions is verified as confirmed filled'
  );

  // 9.11 Multiple creatives where first candidate is invalid tracking pixel but later candidate is valid
  const multipleCreativesContainer = createMockNode({
    tag: 'div',
    children: [
      // Candidate 1: 0x0 hidden iframe / tracking pixel
      createMockNode({
        tag: 'iframe',
        src: 'https://track.example.com/pixel',
        offsetWidth: 0,
        offsetHeight: 0,
      }),
      // Candidate 2: Valid rendered image banner
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/native-ad.jpg',
        offsetWidth: 300,
        offsetHeight: 250,
        naturalWidth: 300,
        naturalHeight: 250,
      }),
    ],
  });
  const multipleResult = validateCreative(multipleCreativesContainer);
  assert(
    multipleResult.status === 'confirmed_filled' &&
      multipleResult.isConfirmedFilled === true &&
      hasValidCreative(multipleCreativesContainer) === true,
    '9.11 Multiple creatives: first candidate invalid, later candidate successfully verified as confirmed filled'
  );

  // 9.12 Cross-origin iframe with rendered positive dimensions after load is classified as 'unverifiable' (never falsely reported filled)
  const crossOriginIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad-iframe',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { width: '300', height: '250', 'data-ad-loaded': 'true' },
        contentDocument: null, // Cross-origin throws or returns null
      }),
    ],
  });
  const crossOriginResult = validateCreative(crossOriginIframe);
  assert(
    crossOriginResult.status === 'unverifiable' &&
      crossOriginResult.isUnverifiable === true &&
      crossOriginResult.creativeDetected === true &&
      crossOriginResult.isConfirmedFilled === false &&
      hasValidCreative(crossOriginIframe) === false,
    '9.12 Cross-origin iframe with rendered dimensions is classified as unverifiable (never falsely reported filled)'
  );

  // 9.13 Same-origin iframe with verified document body content and creative asset is verified as confirmed filled
  const sameOriginBody = createMockNode({
    tag: 'body',
    offsetWidth: 300,
    offsetHeight: 250,
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/banner.png',
        offsetWidth: 300,
        offsetHeight: 250,
        naturalWidth: 300,
        naturalHeight: 250,
      }),
    ],
  });
  const sameOriginIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: '/local-ad-frame.html',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { width: '300', height: '250', 'data-ad-loaded': 'true' },
        contentDocument: { body: sameOriginBody },
      }),
    ],
  });
  const sameOriginResult = validateCreative(sameOriginIframe);
  assert(
    sameOriginResult.status === 'confirmed_filled' &&
      sameOriginResult.isConfirmedFilled === true &&
      hasValidCreative(sameOriginIframe) === true,
    '9.13 Same-origin iframe with verified document body content is verified as confirmed filled'
  );

  // 9.14 Provider documented signal: AdSense data-ad-status="filled"
  const adSenseFilledNode = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'ins',
        attrs: { 'data-ad-status': 'filled' },
        offsetWidth: 728,
        offsetHeight: 90,
      }),
    ],
  });
  const adSenseFilledResult = validateCreative(adSenseFilledNode);
  assert(
    adSenseFilledResult.status === 'confirmed_filled' &&
      adSenseFilledResult.isConfirmedFilled === true &&
      hasValidCreative(adSenseFilledNode) === true,
    '9.14 Provider documented signal: AdSense data-ad-status="filled" verified as confirmed filled'
  );

  // 9.16 Blank video with positive dimensions rejected as unfilled
  const blankVideo = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'video',
        src: 'https://cdn.example.com/ad.mp4',
        offsetWidth: 300,
        offsetHeight: 250,
        videoWidth: 0,
        videoHeight: 0,
        readyState: 0,
      }),
    ],
  });
  assert(
    validateCreative(blankVideo).status === 'unfilled' && hasValidCreative(blankVideo) === false,
    '9.16 Blank video with positive dimensions but zero videoWidth/readyState is strictly rejected as unfilled'
  );

  // 9.17 Video with actual media data and readyState >= 2 verified as confirmed filled
  const validVideo = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'video',
        src: 'https://cdn.example.com/ad.mp4',
        offsetWidth: 300,
        offsetHeight: 250,
        videoWidth: 300,
        videoHeight: 250,
        readyState: 4,
      }),
    ],
  });
  const validVideoResult = validateCreative(validVideo);
  assert(
    validVideoResult.status === 'confirmed_filled' && validVideoResult.isConfirmedFilled === true && hasValidCreative(validVideo) === true,
    '9.17 Video with positive videoWidth and readyState >= 2 is verified as confirmed filled'
  );

  // 9.18 Empty object/embed with positive dimensions classified as unverifiable
  const objectMedia = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'object',
        data: 'https://cdn.example.com/ad.swf',
        offsetWidth: 300,
        offsetHeight: 250,
      }),
    ],
  });
  const objectResult = validateCreative(objectMedia);
  assert(
    objectResult.status === 'unverifiable' && objectResult.isUnverifiable === true && hasValidCreative(objectMedia) === false,
    '9.18 Empty object/embed with positive dimensions is classified conservatively as unverifiable'
  );

  // 9.19 Cross-origin iframe before load event (request_attempted)
  const crossOriginBeforeLoad = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad',
        offsetWidth: 300,
        offsetHeight: 250,
      }),
    ],
  });
  assert(
    validateCreative(crossOriginBeforeLoad).status === 'request_attempted',
    '9.19 Cross-origin iframe before load event is classified as request_attempted (pending lifecycle)'
  );

  // 9.20 Cross-origin iframe after observable load event
  const crossOriginAfterLoad = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { 'data-ad-loaded': 'true' },
      }),
    ],
  });
  assert(
    validateCreative(crossOriginAfterLoad).status === 'unverifiable' && validateCreative(crossOriginAfterLoad).isUnverifiable === true,
    '9.20 Cross-origin iframe after observable load event is classified as unverifiable'
  );

  // 9.21 Same-origin iframe with arbitrary placeholder text/wrapper content rejected
  const sameOriginPlaceholderBody = createMockNode({
    tag: 'body',
    offsetWidth: 300,
    offsetHeight: 250,
    children: [createMockNode({ tag: 'p', textContent: 'Loading advertisement...' })],
  });
  const sameOriginPlaceholderIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: '/placeholder.html',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { 'data-ad-loaded': 'true' },
        contentDocument: { body: sameOriginPlaceholderBody },
      }),
    ],
  });
  assert(
    validateCreative(sameOriginPlaceholderIframe).status === 'unfilled',
    '9.21 Same-origin iframe with arbitrary placeholder content without creative asset is rejected as unfilled'
  );

  // --- Task 9B: Provider Rotation on No-Fill and Error via computeProviderTransition ---
  console.log('\n--- 9B. Provider Rotation Progression & Terminal Cleanup ---');

  const rotationList = getProviderRotation('top', true);
  assert(
    rotationList[0] === 'adsterra' &&
      rotationList[1] === 'juicyads' &&
      rotationList[2] === 'exoclick' &&
      rotationList[3] === 'monetag',
    '9.22 Chatroom rotation follows exact priority sequence: Adsterra -> JuicyAds -> ExoClick -> Monetag'
  );

  // Test actual production computeProviderTransition
  const t1 = computeProviderTransition('unfilled', 0, rotationList);
  assert(t1.shouldRotate && t1.nextIndex === 1 && t1.action === 'rotate', '9.23 Adsterra no-fill -> JuicyAds rotation decision');

  const t2 = computeProviderTransition('error', 1, rotationList);
  assert(t2.shouldRotate && t2.nextIndex === 2 && t2.action === 'rotate', '9.24 JuicyAds error -> ExoClick rotation decision');

  const t3 = computeProviderTransition('unfilled', 2, rotationList);
  assert(t3.shouldRotate && t3.nextIndex === 3 && t3.action === 'rotate', '9.25 ExoClick no-fill -> Monetag rotation decision');

  const t4 = computeProviderTransition('unfilled', 3, rotationList);
  assert(!t4.shouldRotate && t4.isTerminal && t4.action === 'settle', '9.26 Monetag terminal no-fill terminates rotation without loop');

  const t5 = computeProviderTransition('unverifiable', 0, rotationList);
  assert(!t5.shouldRotate && t5.isTerminal, '9.27 Unverifiable status does not trigger rotation');

  const t6 = computeProviderTransition('filled', 0, rotationList);
  assert(!t6.shouldRotate && t6.isTerminal, '9.28 Confirmed filled status does not trigger rotation');

  const t7 = computeProviderTransition('unfilled', 0, rotationList, 'adsterra');
  assert(!t7.shouldRotate && t7.isTerminal, '9.29 Explicit provider behavior respects single provider without rotation');

  // --- Task 10: Strict Participant Sidebar & Composer Preservation ---
  console.log('\n--- 10. Chatroom Layout & Participant Sidebar Preservation ---');
  assert(
    publicChatPageSource.includes('lg:w-[340px] xl:w-[344px]'),
    '10.1 Participant Sidebar desktop width (lg:w-[340px] xl:w-[344px]) is strictly preserved'
  );
  assert(
    publicChatPageSource.includes('slotId="participant-box-horizontal"'),
    '10.2 External participant horizontal ad placement remains intact'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-status-inline"') &&
      publicChatPageSource.includes('slotId="public-chatroom-message-inline"'),
    '10.3 Both internal chatroom placements (status-inline and message-inline) remain intact'
  );
  assert(
    !composerCode.includes('AdPlacementBox'),
    '10.4 Chat message composer remains strictly free of ad placements'
  );

  // --- Task 11: Phase 1 Orientation Guard, Dimension Targets & Creative Bounds ---
  console.log('\n--- 11. Phase 1 Orientation Guard, Reserved Dimensions & Bounds Validation ---');

  assert(
    isInternalHorizontalPlacement('public-chatroom-status-inline') &&
      isInternalHorizontalPlacement('public-chatroom-message-inline') &&
      !isInternalHorizontalPlacement('public-chatroom-left') &&
      !isInternalHorizontalPlacement('public-chatroom-top'),
    '11.1 isInternalHorizontalPlacement accurately identifies both internal chatroom placements'
  );

  assert(
    getPlacementOrientation('public-chatroom-status-inline', 'sidebar-horizontal') === 'horizontal' &&
      getPlacementOrientation('public-chatroom-message-inline', 'sidebar-horizontal') === 'horizontal' &&
      getPlacementOrientation('participant-box-horizontal', 'sidebar-horizontal') === 'horizontal' &&
      getPlacementOrientation('public-chatroom-top', 'top') === 'horizontal' &&
      getPlacementOrientation('public-chatroom-bottom', 'bottom') === 'horizontal' &&
      getPlacementOrientation('public-chatroom-left', 'left', true) === 'vertical' &&
      getPlacementOrientation('public-chatroom-right', 'right', true) === 'vertical',
    '11.2 Orientation classification strictly separates vertical sidebars from horizontal banners and internal ads'
  );

  const participantTarget = getReservedDimensionTarget('participant-box-horizontal', 'sidebar-horizontal', false);
  const statusTarget = getReservedDimensionTarget('public-chatroom-status-inline', 'sidebar-horizontal', false);
  const messageTarget = getReservedDimensionTarget('public-chatroom-message-inline', 'sidebar-horizontal', false);
  const topTarget = getReservedDimensionTarget('public-chatroom-top', 'top', false);
  const leftTarget = getReservedDimensionTarget('public-chatroom-left', 'left', true);

  assert(
    participantTarget.maxWidth === 320 && participantTarget.maxHeight === 120 && !participantTarget.allowPortraitCreative,
    '11.3 Participant Bar reserved dimension target enforces landscape max 320x120'
  );
  assert(
    statusTarget.maxHeight === 68 &&
      messageTarget.maxHeight === 68 &&
      !statusTarget.allowPortraitCreative &&
      !messageTarget.allowPortraitCreative,
    '11.4 Internal status-inline and message-inline reserved targets enforce compact landscape height (<=68px)'
  );
  assert(
    topTarget.maxWidth === 728 && topTarget.maxHeight === 102 && leftTarget.orientation === 'vertical',
    '11.5 Top/bottom targets enforce max 728x102 and sidebars enforce vertical orientation'
  );

  // Reject portrait/vertical creative (e.g. 160x600 or 240x400) inside internal horizontal placements
  const portraitImgInHorizontal = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/vertical-160x600.png',
        offsetWidth: 160,
        offsetHeight: 600,
        naturalWidth: 160,
        naturalHeight: 600,
      }),
    ],
  });
  const portraitRejected = validateCreative(portraitImgInHorizontal, {
    expectedOrientation: 'horizontal',
    maxAllowedHeight: statusTarget.maxHeight,
    maxAllowedWidth: 320,
  });
  assert(
    portraitRejected.status === 'unfilled' &&
      portraitRejected.isConfirmedFilled === false &&
      portraitRejected.reason.includes('Vertical/portrait'),
    '11.6 Portrait/vertical creative (160x600) is strictly rejected inside horizontal placement'
  );

  // Reject oversized tall box (300x250) inside compact internal horizontal slot (maxHeight 68)
  const tallBoxInCompactSlot = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/box-300x250.png',
        offsetWidth: 300,
        offsetHeight: 250,
        naturalWidth: 300,
        naturalHeight: 250,
      }),
    ],
  });
  const tallBoxRejected = validateCreative(tallBoxInCompactSlot, {
    expectedOrientation: 'horizontal',
    maxAllowedHeight: messageTarget.maxHeight,
    maxAllowedWidth: 320,
  });
  assert(
    tallBoxRejected.status === 'unfilled' &&
      tallBoxRejected.isConfirmedFilled === false &&
      tallBoxRejected.reason.includes('Oversized creative height'),
    '11.7 Oversized tall box (300x250) is strictly rejected inside compact internal horizontal placement'
  );

  // Reject oversized cross-origin iframe height in internal horizontal placement
  const tallIframeInHorizontal = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/tall-widget',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { 'data-ad-loaded': 'true' },
      }),
    ],
  });
  assert(
    validateCreative(tallIframeInHorizontal, {
      expectedOrientation: 'horizontal',
      maxAllowedHeight: statusTarget.maxHeight,
      maxAllowedWidth: 320,
    }).status === 'unfilled',
    '11.8 Vertical/oversized iframe in internal horizontal slot is rejected as unfilled to force clean rotation'
  );

  // Accept valid horizontal creatives inside both internal placements (320x50 & 300x62)
  const valid320x50 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/ad-320x50.png',
        offsetWidth: 320,
        offsetHeight: 50,
        naturalWidth: 320,
        naturalHeight: 50,
      }),
    ],
  });
  const valid300x62 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/ad-300x62.png',
        offsetWidth: 300,
        offsetHeight: 62,
        naturalWidth: 300,
        naturalHeight: 62,
      }),
    ],
  });
  assert(
    validateCreative(valid320x50, {
      expectedOrientation: 'horizontal',
      maxAllowedHeight: statusTarget.maxHeight,
      maxAllowedWidth: 320,
    }).isConfirmedFilled === true &&
      validateCreative(valid300x62, {
        expectedOrientation: 'horizontal',
        maxAllowedHeight: messageTarget.maxHeight,
        maxAllowedWidth: 320,
      }).isConfirmedFilled === true,
    '11.9 Landscape 320x50 and 300x62 creatives pass validation inside compact internal horizontal placements'
  );

  // Accept 300x112 JuicyAds inside participant-box-horizontal (max 320x120)
  const valid300x112 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/participant-300x112.png',
        offsetWidth: 300,
        offsetHeight: 112,
        naturalWidth: 300,
        naturalHeight: 112,
      }),
    ],
  });
  assert(
    validateCreative(valid300x112, {
      expectedOrientation: 'horizontal',
      maxAllowedHeight: participantTarget.maxHeight,
      maxAllowedWidth: 320,
    }).isConfirmedFilled === true,
    '11.10 JuicyAds 300x112 creative passes validation inside Participant Bar (<= 320x120)'
  );

  // --- Task 12: Phase 1 All-Device Unit Resolution (Participant Bar, Internal & Sidebars) ---
  console.log('\n--- 12. Phase 1 Multi-Viewport Unit Resolution (Desktop, Tablet, Mobile) ---');

  // 12.1 Participant Bar uses 300x112 on JuicyAds and 320x50 only when container width >= 320
  assert(
    resolveEffectiveUnitId({
      provider: 'juicyads',
      position: 'sidebar-horizontal',
      slotId: 'participant-box-horizontal',
      containerWidth: 304,
      isLiveChatScreen: true,
    }) === JUICYADS_CONFIG.zones.banner300x112,
    '12.1 Participant Bar (304px mobile drawer): JuicyAds resolves dedicated 300x112 zone (1131767)'
  );
  assert(
    resolveEffectiveUnitId({
      provider: 'adsterra',
      position: 'sidebar-horizontal',
      slotId: 'participant-box-horizontal',
      primaryAdUnitId: ADSTERRA_CONFIG.banner320x50,
      containerWidth: 304,
      isLiveChatScreen: true,
    }) === null,
    '12.2 Participant Bar (304px mobile drawer): Adsterra 320x50 cleanly skips so JuicyAds 300x112 takes over without clipping'
  );
  assert(
    resolveEffectiveUnitId({
      provider: 'adsterra',
      position: 'sidebar-horizontal',
      slotId: 'participant-box-horizontal',
      primaryAdUnitId: ADSTERRA_CONFIG.banner320x50,
      containerWidth: 324,
      isLiveChatScreen: true,
    }) === ADSTERRA_CONFIG.banner320x50,
    '12.3 Participant Bar (324px desktop lg/xl): Adsterra 320x50 fits cleanly without overflow'
  );

  // 12.4 Vertical sidebars reject landscape 300x250, 300x262, unverified nativeWidget, and unverified generic zones
  assert(
    resolveEffectiveUnitId({
      provider: 'adsterra',
      position: 'right',
      slotId: 'public-chatroom-right',
      primaryAdUnitId: ADSTERRA_CONFIG.banner300x250,
      isVertical: true,
      containerWidth: 300,
      isLiveChatScreen: true,
    }) === null &&
      resolveEffectiveUnitId({
        provider: 'adsterra',
        position: 'left',
        slotId: 'public-chatroom-left',
        primaryAdUnitId: ADSTERRA_CONFIG.nativeUnitId,
        isVertical: true,
        containerWidth: 300,
        isLiveChatScreen: true,
      }) === null &&
      resolveEffectiveUnitId({
        provider: 'juicyads',
        position: 'right',
        slotId: 'public-chatroom-right',
        primaryAdUnitId: JUICYADS_CONFIG.zones.banner300x262,
        isVertical: true,
        containerWidth: 300,
        isLiveChatScreen: true,
      }) === null,
    '12.4 Vertical sidebars strictly reject landscape 300x250, 300x262, and unverified native unit IDs even on 300px rails'
  );

  // 12.5 Un-dimensioned generic zones (ExoClick 6087300, Monetag 12241585) do not inject into vertical sidebars
  assert(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'right',
      slotId: 'public-chatroom-right',
      isVertical: true,
      containerWidth: 160,
      isLiveChatScreen: true,
    }) === null &&
      resolveEffectiveUnitId({
        provider: 'monetag',
        position: 'left',
        slotId: 'public-chatroom-left',
        isVertical: true,
        containerWidth: 300,
        isLiveChatScreen: true,
      }) === null,
    '12.5 ExoClick and Monetag generic zones without verified vertical dimensions return null for vertical sidebars'
  );

  // --- Task 13: Monotonic Attempt Token, Queue Cancel & Duplicate Script Protection ---
  console.log('\n--- 13. Stale Callback Guard, Queue Cleanup & Single Script Injection ---');

  assert(
    isAttemptCurrent(4, 4, true) === true &&
      isAttemptCurrent(3, 4, true) === false &&
      isAttemptCurrent(4, 4, false) === false,
    '13.1 isAttemptCurrent strictly rejects stale attempt IDs and unmounted callbacks'
  );

  assert(
    typeof cancelQueuedAdsterraTasksForSlot === 'function' &&
      typeof ensureHeadScriptOnce === 'function',
    '13.2 Queue cancellation and duplicate script injection helpers are exported and callable'
  );

  // Test ensureHeadScriptOnce against minimal mock document.head
  const appendedScripts: any[] = [];
  const headChildren: Record<string, any> = {};
  (global as any).document = {
    head: {
      appendChild(node: any) {
        appendedScripts.push(node);
        headChildren[node.src] = node;
      },
    },
    querySelector(sel: string) {
      const m = sel.match(/script\[src="([^"]+)"\]/);
      return m ? headChildren[m[1]] || null : null;
    },
    createElement() {
      const attrs: Record<string, string> = {};
      return {
        async: false,
        src: '',
        setAttribute(k: string, v: string) {
          attrs[k] = v;
        },
        getAttribute(k: string) {
          return attrs[k] ?? null;
        },
        remove() {
          delete headChildren[this.src];
        },
      };
    },
  };
  const firstScript = ensureHeadScriptOnce('https://poweredby.jads.co/js/jads.js');
  const secondScript = ensureHeadScriptOnce('https://poweredby.jads.co/js/jads.js');
  assert(
    appendedScripts.length === 1 && firstScript === secondScript,
    '13.3 ensureHeadScriptOnce injects only one <script> element per shared provider URL across concurrent slots'
  );
  delete (global as any).document;

  // --- Task 14: Reserved Non-Collapsing Container SSR Verification ---
  console.log('\n--- 14. Reserved Container Non-Collapse, Contain Isolation & Chat Layout ---');

  const topSlotHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'public-chatroom-top',
        position: 'top',
        isLiveChatScreen: true,
      })
    )
  );
  const statusInlineHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'public-chatroom-status-inline',
        position: 'sidebar-horizontal',
        isLiveChatScreen: true,
      })
    )
  );
  const leftVerticalHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'public-chatroom-left',
        position: 'left',
        isVertical: true,
        isLiveChatScreen: true,
      })
    )
  );
  const participantHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'participant-box-horizontal',
        position: 'sidebar-horizontal',
        isLiveChatScreen: true,
      })
    )
  );

  assert(
    topSlotHtml.includes('data-testid="ad-slot-public-chatroom-top"') &&
      topSlotHtml.includes('data-ad-orientation="horizontal"') &&
      topSlotHtml.includes('[contain:layout_style]') &&
      topSlotHtml.includes('md:max-w-[728px]'),
    '14.1 Top banner SSR renders pre-allocated non-collapsing horizontal reserved container (max 728x102)'
  );
  assert(
    statusInlineHtml.includes('data-testid="ad-slot-public-chatroom-status-inline"') &&
      statusInlineHtml.includes('data-ad-orientation="horizontal"') &&
      statusInlineHtml.includes('max-h-[68px]') &&
      statusInlineHtml.includes('[contain:layout_style]'),
    '14.2 Status-inline ad renders pre-allocated compact horizontal container (max-h-[68px])'
  );
  assert(
    leftVerticalHtml.includes('data-testid="ad-slot-public-chatroom-left"') &&
      leftVerticalHtml.includes('data-ad-orientation="vertical"') &&
      leftVerticalHtml.includes('min-h-[520px]'),
    '14.3 Left vertical rail renders dedicated vertical reserved container (min-h-[520px])'
  );
  assert(
    participantHtml.includes('data-testid="ad-slot-participant-box-horizontal"') &&
      participantHtml.includes('data-ad-orientation="horizontal"') &&
      participantHtml.includes('max-h-[120px]'),
    '14.4 Participant Bar ad renders reserved horizontal container (max-h-[120px])'
  );

  // Ensure AdPlacementBox never short-circuits away container on error/unfilled
  assert(
    !adPlacementBoxSource.includes("adStatus === 'unfilled'") ||
      !adPlacementBoxSource.includes('return null;\n  }\n\n  return <div'),
    '14.5 AdPlacementBox never returns null to collapse reserved container on unfilled/error'
  );

  // --- Task 15: ads.txt & Theme Breakpoint Verification ---
  console.log('\n--- 15. ads.txt TrafficStars Entry & 3xl Breakpoint Configuration ---');

  const adsTxtContent = fs.readFileSync(path.resolve('public/ads.txt'), 'utf-8');
  const adsTxtLines = adsTxtContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  assert(
    adsTxtLines.includes('google.com, pub-7862321512207088, DIRECT, f08c47fec0942fa0') &&
      adsTxtLines.includes('tsyndicate.com 354866'),
    '15.1 public/ads.txt preserves Google AdSense line and contains exact TrafficStars entry: tsyndicate.com 354866'
  );

  const indexCssContent = fs.readFileSync(path.resolve('src/index.css'), 'utf-8');
  assert(
    indexCssContent.includes('--breakpoint-3xl: 100rem;'),
    '15.2 src/index.css defines --breakpoint-3xl (1600px) so 3xl:w-[300px] side rails activate cleanly'
  );

  assert(
    publicChatPageSource.includes('data-testid="public-chatroom-message-inline-container"') &&
      (publicChatPageSource.includes('>Sponsored<') || publicChatPageSource.includes('Sponsored\n')),
    '15.3 public-chatroom-message-inline has distinct Sponsored visual separation from chat messages'
  );

  assert(
    !adPlacementBoxSource.includes('adRef.current.innerHTML') &&
      !adPlacementBoxSource.includes('adRef.current.appendChild') &&
      adPlacementBoxSource.includes('key="adsense-react-host"') &&
      adPlacementBoxSource.includes('key="imperative-ad-host"'),
    '15.4 AdPlacementBox strictly isolates imperative innerHTML/appendChild inside imperativeHostRef separate from React AdSense JSX'
  );

  // --- Task 16: Strict Vertical Sidebar Creative Enforcement ---
  console.log('\n--- 16. Strict Vertical Sidebar Creative Enforcement & Orientation Guarantees ---');

  const verticalValidationOpts = {
    expectedOrientation: 'vertical' as const,
    maxAllowedHeight: 540,
    maxAllowedWidth: 300,
  };
  const horizontalValidationOpts = {
    expectedOrientation: 'horizontal' as const,
    maxAllowedHeight: 68,
    maxAllowedWidth: 320,
  };

  // 16.1 Valid portrait creative (height > width, within 300x540 bounds) accepted for vertical placement
  const validPortrait160x400 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/vertical-160x400.png',
        offsetWidth: 160,
        offsetHeight: 400,
        naturalWidth: 160,
        naturalHeight: 400,
      }),
    ],
  });
  assert(
    validateCreative(validPortrait160x400, verticalValidationOpts).isConfirmedFilled === true &&
      hasValidCreative(validPortrait160x400, verticalValidationOpts) === true,
    '16.1 Portrait creative (160x400) with matching aspect ratio and within bounds is accepted in vertical placement'
  );

  // 16.2 Landscape creatives (300x250, 300x262) rejected in vertical placement
  const landscape300x250 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/rect-300x250.png',
        offsetWidth: 300,
        offsetHeight: 250,
        naturalWidth: 300,
        naturalHeight: 250,
      }),
    ],
  });
  const landscape300x250Res = validateCreative(landscape300x250, verticalValidationOpts);
  assert(
    landscape300x250Res.status === 'unfilled' &&
      landscape300x250Res.isConfirmedFilled === false &&
      landscape300x250Res.reason.includes('Landscape creative'),
    '16.2 Landscape 300x250 creative is strictly rejected inside vertical placement'
  );

  // 16.3 Square creatives (250x250) rejected in BOTH vertical AND horizontal placements
  const square250x250 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/square-250x250.png',
        offsetWidth: 250,
        offsetHeight: 250,
        naturalWidth: 250,
        naturalHeight: 250,
      }),
    ],
  });
  const squareVerticalRes = validateCreative(square250x250, verticalValidationOpts);
  const squareHorizontalRes = validateCreative(square250x250, {
    expectedOrientation: 'horizontal',
    maxAllowedHeight: 300,
    maxAllowedWidth: 320,
  });
  assert(
    squareVerticalRes.status === 'unfilled' &&
      squareVerticalRes.reason.includes('Square creative') &&
      squareHorizontalRes.status === 'unfilled' &&
      squareHorizontalRes.reason.includes('Square creative'),
    '16.3 Square creative (250x250) is strictly rejected in both vertical and horizontal placements'
  );

  // 16.4 Landscape creative (320x50) accepted for horizontal placement within bounds
  assert(
    hasValidCreative(valid320x50, horizontalValidationOpts) === true,
    '16.4 Landscape 320x50 creative is accepted in horizontal placement within bounds'
  );

  // 16.5 Portrait creative rejected for horizontal placement
  assert(
    validateCreative(validPortrait160x400, horizontalValidationOpts).status === 'unfilled' &&
      hasValidCreative(validPortrait160x400, horizontalValidationOpts) === false,
    '16.5 Portrait 160x400 creative is rejected in horizontal placement'
  );

  // 16.6 Oversized height/width and distorted aspect ratio rejected in vertical placement
  const oversizedPortrait160x600 = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/skyscraper-160x600.png',
        offsetWidth: 160,
        offsetHeight: 600,
        naturalWidth: 160,
        naturalHeight: 600,
      }),
    ],
  });
  const stretchedLandscapeAsPortrait = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/stretched-300x250.png',
        offsetWidth: 160,
        offsetHeight: 400,
        naturalWidth: 300,
        naturalHeight: 250,
      }),
    ],
  });
  const stretchedPortraitAspectMismatch = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/distorted-160x200.png',
        offsetWidth: 160,
        offsetHeight: 500,
        naturalWidth: 160,
        naturalHeight: 200,
      }),
    ],
  });
  assert(
    validateCreative(oversizedPortrait160x600, verticalValidationOpts).status === 'unfilled' &&
      validateCreative(stretchedLandscapeAsPortrait, verticalValidationOpts).status === 'unfilled' &&
      validateCreative(stretchedPortraitAspectMismatch, verticalValidationOpts).status === 'unfilled',
    '16.6 Oversized (160x600 > 540px height), landscape-natural stretched portrait, and aspect-distorted creatives are rejected'
  );

  // 16.7 Unknown / zero dimensions CANNOT bypass orientation validation
  const unknownInsVertical = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'ins',
        attrs: { 'data-ad-status': 'filled' },
        offsetWidth: 0,
        offsetHeight: 0,
      }),
    ],
  });
  const unknownIframeVertical = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/unknown-dims',
        attrs: { 'data-ad-loaded': 'true' },
        offsetWidth: 0,
        offsetHeight: 0,
      }),
    ],
  });
  assert(
    validateCreative(unknownInsVertical, verticalValidationOpts).status === 'unfilled' &&
      validateCreative(unknownIframeVertical, verticalValidationOpts).status === 'unfilled' &&
      validateCreative(unknownInsVertical, horizontalValidationOpts).status === 'unfilled',
    '16.7 Unknown/zero dimensions cannot bypass vertical or horizontal orientation validation'
  );

  // 16.8 Provider format registry classifies 300x250 & 300x262 as horizontal and PublicChatPage sidebars do not pass them
  const spec300x250 = getVerifiedAdUnitSpec(ADSTERRA_CONFIG.banner300x250, 'adsterra');
  const spec300x262 = getVerifiedAdUnitSpec(JUICYADS_CONFIG.zones.banner300x262, 'juicyads');
  assert(
    spec300x250?.orientation === 'horizontal' &&
      spec300x262?.orientation === 'horizontal' &&
      VERIFIED_AD_UNITS.every((u) => (u.orientation === 'vertical' ? u.height > u.width : u.width >= u.height)) &&
      getVerifiedVerticalUnitForProvider('adsterra', 300) === null &&
      getVerifiedVerticalUnitForProvider('juicyads', 300) === null &&
      !publicChatPageSource.includes('adUnitId={ADSTERRA_CONFIG.nativeUnitId}') &&
      !publicChatPageSource.includes('adUnitId={ADSTERRA_CONFIG.banner300x250}'),
    '16.8 Registry classifies 300x250 & 300x262 accurately as horizontal and PublicChatPage removes non-vertical unit IDs from sidebars'
  );

  // 16.9 & 16.10 Right and left reserved vertical containers remain intact and uncollapsed in SSR
  const rightVerticalHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'public-chatroom-right',
        position: 'right',
        isVertical: true,
        isLiveChatScreen: true,
      })
    )
  );
  assert(
    leftVerticalHtml.includes('data-testid="ad-slot-public-chatroom-left"') &&
      leftVerticalHtml.includes('data-ad-orientation="vertical"') &&
      leftVerticalHtml.includes('min-h-[520px]') &&
      rightVerticalHtml.includes('data-testid="ad-slot-public-chatroom-right"') &&
      rightVerticalHtml.includes('data-ad-orientation="vertical"') &&
      rightVerticalHtml.includes('min-h-[520px]') &&
      statusInlineHtml.includes('data-ad-orientation="horizontal"'),
    '16.9 Reserved vertical sidebar containers remain stable and uncollapsed when unfilled while internal placements stay horizontal'
  );

  // --- Task 17: Provider-Compliant Refresh Policies, Visibility & Multi-Viewport Sizing ---
  console.log('\n--- 17. Provider-Compliant Ad Rotation & Maximum Responsive Ad Space ---');

  // 17.1 ExoClick longest 120s native refresh & 10 session cap (disabled by default until dashboard authorization verified)
  const exoCurrent = getProviderRefreshPolicy('exoclick');
  const exoAuthorized = getProviderRefreshPolicy('exoclick', { accountAuthorizedOverride: true });
  assert(
    exoCurrent.supportsNativeRefresh === true &&
      exoCurrent.chosenIntervalSec === null &&
      exoCurrent.usesCustomJsTimer === false &&
      exoCurrent.maxSessionRotations === 10 &&
      exoAuthorized.chosenIntervalSec === 120 &&
      exoAuthorized.supportedIntervalsSec.includes(120) &&
      exoAuthorized.usesCustomJsTimer === false,
    '17.1 ExoClick enforces native 120s max interval + 10-rotation cap when authorized, and stays disabled when dashboard auth is unverified'
  );

  // 17.2 TrafficStars 120s MasterSpot refresh ONLY when zone & account-authorized
  const tsCurrent = getProviderRefreshPolicy('trafficstars');
  const tsAuthorizedNoZone = getProviderRefreshPolicy('trafficstars', {
    accountAuthorizedOverride: true,
    zoneIdOverride: null,
  });
  const tsAuthorizedWithZone = getProviderRefreshPolicy('trafficstars', {
    accountAuthorizedOverride: true,
    zoneIdOverride: 'ts-master-zone-1',
  });
  assert(
    TRAFFICSTARS_CONFIG.adsTxtPublisherId === '354866' &&
      tsCurrent.chosenIntervalSec === null &&
      tsCurrent.accountAuthorized === false &&
      tsAuthorizedNoZone.chosenIntervalSec === null &&
      tsAuthorizedWithZone.chosenIntervalSec === 120 &&
      tsAuthorizedWithZone.usesCustomJsTimer === false,
    '17.2 TrafficStars MasterSpot enforces 120s ONLY when both zone and account authorization are verified'
  );

  // 17.3 Unsupported providers (Adsterra, JuicyAds, Monetag, AdSense) strictly disable auto-refresh & custom JS timers
  assert(
    PROVIDER_REFRESH_POLICIES.adsterra.chosenIntervalSec === null &&
      PROVIDER_REFRESH_POLICIES.adsterra.usesCustomJsTimer === false &&
      PROVIDER_REFRESH_POLICIES.juicyads.chosenIntervalSec === null &&
      PROVIDER_REFRESH_POLICIES.juicyads.usesCustomJsTimer === false &&
      PROVIDER_REFRESH_POLICIES.monetag.chosenIntervalSec === null &&
      PROVIDER_REFRESH_POLICIES.monetag.usesCustomJsTimer === false &&
      PROVIDER_REFRESH_POLICIES.adsense.chosenIntervalSec === null &&
      PROVIDER_REFRESH_POLICIES.adsense.usesCustomJsTimer === false,
    '17.3 Adsterra, JuicyAds, Monetag, and AdSense have no forced/custom JS refresh timers'
  );

  // 17.4 ExoClick 10-rotation session cap & visibility/pagehide/unmount refresh gating
  resetProviderSessionRotations();
  assert(
    getProviderSessionRotationCount('exoclick') === 0,
    '17.4a Session rotation counter initializes cleanly at 0'
  );
  for (let i = 0; i < 10; i++) {
    const rec = recordProviderSessionRotation('exoclick', true);
    assert(rec.recorded === true && rec.count === i + 1, `17.4b ExoClick authorized rotation #${i + 1} recorded within 10-rotation cap`);
  }
  const eleventh = recordProviderSessionRotation('exoclick', true);
  const blockedAtCap = evaluateAuthorizedRefresh({
    provider: 'exoclick',
    isPageVisible: true,
    isSlotVisible: true,
    isMounted: true,
    isChatroomActive: true,
    accountAuthorizedOverride: true,
  });
  assert(
    eleventh.recorded === false &&
      eleventh.count === 10 &&
      blockedAtCap.allowed === false &&
      blockedAtCap.reason.includes('10/10'),
    '17.4c ExoClick 11th session rotation is strictly blocked at max 10 rotations/session'
  );
  resetProviderSessionRotations();

  // 17.5 Visibility, page-hidden, inactive chatroom, and unmount stop authorized refresh immediately
  assert(
    evaluateAuthorizedRefresh({
      provider: 'exoclick',
      isPageVisible: true,
      isSlotVisible: true,
      isMounted: true,
      isChatroomActive: true,
      sessionRotationCount: 0,
      accountAuthorizedOverride: true,
    }).allowed === true &&
      evaluateAuthorizedRefresh({
        provider: 'exoclick',
        isPageVisible: false,
        isSlotVisible: true,
        isMounted: true,
        isChatroomActive: true,
        sessionRotationCount: 0,
        accountAuthorizedOverride: true,
      }).allowed === false &&
      evaluateAuthorizedRefresh({
        provider: 'exoclick',
        isPageVisible: true,
        isSlotVisible: false,
        isMounted: true,
        isChatroomActive: true,
        sessionRotationCount: 0,
        accountAuthorizedOverride: true,
      }).allowed === false &&
      evaluateAuthorizedRefresh({
        provider: 'exoclick',
        isPageVisible: true,
        isSlotVisible: true,
        isMounted: false,
        isChatroomActive: true,
        sessionRotationCount: 0,
        accountAuthorizedOverride: true,
      }).allowed === false &&
      evaluateAuthorizedRefresh({
        provider: 'exoclick',
        isPageVisible: true,
        isSlotVisible: true,
        isMounted: true,
        isChatroomActive: false,
        sessionRotationCount: 0,
        accountAuthorizedOverride: true,
      }).allowed === false,
    '17.5 Authorized refresh strictly pauses when page is hidden, slot is invisible, chatroom is inactive, or slot is unmounted'
  );

  // 17.6 Duplicate placement instance ownership & cleanup
  const tokA = Symbol('slotA');
  const tokB = Symbol('slotB');
  assert(
    claimSlotInstance('public-chatroom-top', tokA) === true &&
      claimSlotInstance('public-chatroom-top', tokB) === false &&
      getActiveSlotInstanceCount('public-chatroom-top') === 1 &&
      isVisibilityEligibleForAdActivity({
        isPageVisible: true,
        isSlotVisible: true,
        isMounted: true,
        isSlotOwner: false,
      }) === false,
    '17.6 Duplicate simultaneous placement instances for the same slotId are prevented'
  );
  releaseSlotInstance('public-chatroom-top', tokA);
  assert(
    getActiveSlotInstanceCount('public-chatroom-top') === 0 &&
      claimSlotInstance('public-chatroom-top', tokB) === true,
    '17.7 Unmounting releases slot ownership cleanly for subsequent navigation remount'
  );
  releaseSlotInstance('public-chatroom-top', tokB);

  // 17.8 All 6 verification widths (1920, 1440, 1366, 768, 390, 320): maximum compatible creative selection & zero 320px clipping
  const desktopWidths = [1920, 1440, 1366, 768];
  for (const vw of desktopWidths) {
    // At >=768px with sm:px-4 (32px), outer banner container >= 736px -> fits 728x90 & 728x102
    const availOuter = vw === 768 ? 736 : 728;
    assert(
      resolveEffectiveUnitId({
        provider: 'adsterra',
        position: 'top',
        slotId: 'public-chatroom-top',
        containerWidth: availOuter,
        isLiveChatScreen: true,
      }) === ADSTERRA_CONFIG.banner728x90 &&
        resolveEffectiveUnitId({
          provider: 'juicyads',
          position: 'bottom',
          slotId: 'public-chatroom-bottom',
          containerWidth: availOuter,
          isLiveChatScreen: true,
        }) === JUICYADS_CONFIG.zones.banner728x102,
      `17.8a Viewport ${vw}px selects maximum compatible 728x90 / 728x102 outer horizontal creatives`
    );
  }

  for (const mobileWidth of [390, 320]) {
    // PublicChatPage uses px-0 sm:px-4 on top/bottom -> full 320px/390px available
    assert(
      resolveEffectiveUnitId({
        provider: 'adsterra',
        position: 'top',
        slotId: 'public-chatroom-top',
        containerWidth: mobileWidth,
        isLiveChatScreen: true,
      }) === ADSTERRA_CONFIG.banner320x50 &&
        resolveEffectiveUnitId({
          provider: 'juicyads',
          position: 'bottom',
          slotId: 'public-chatroom-bottom',
          containerWidth: mobileWidth,
          isLiveChatScreen: true,
        }) === JUICYADS_CONFIG.zones.banner300x62,
      `17.8b Mobile viewport ${mobileWidth}px fits 320x50 and 300x62 cleanly on outer banners without clipping`
    );

    // Internal inline width at 320px: 320 - 16 (px-2) - 2 (border) = 302px (JuicyAds 300x62 fits; Adsterra 320x50 skips cleanly!)
    // At 390px: 390 - 16 - 2 = 372px (both 320x50 and 300x62 fit)
    const internalAvail = mobileWidth - 18;
    const expectedAdsterraInternal = mobileWidth === 320 ? null : ADSTERRA_CONFIG.banner320x50;
    assert(
      resolveEffectiveUnitId({
        provider: 'adsterra',
        position: 'sidebar-horizontal',
        slotId: 'public-chatroom-status-inline',
        containerWidth: internalAvail,
        isLiveChatScreen: true,
      }) === expectedAdsterraInternal &&
        resolveEffectiveUnitId({
          provider: 'juicyads',
          position: 'sidebar-horizontal',
          slotId: 'public-chatroom-message-inline',
          containerWidth: internalAvail,
          isLiveChatScreen: true,
        }) === JUICYADS_CONFIG.zones.banner300x62,
      `17.8c Internal chatroom ads at ${mobileWidth}px (${internalAvail}px inner width) prevent 320px overflow and fall back cleanly to 300x62`
    );
  }

  assert(
    adPlacementBoxSource.includes('visibilitychange') &&
      adPlacementBoxSource.includes('IntersectionObserver') &&
      adPlacementBoxSource.includes('settledRequiredWidthRef') &&
      !adPlacementBoxSource.includes('setInterval(() => {\n        // refresh'),
    '17.9 AdPlacementBox enforces page/slot visibility, viewport-shrink downgrade, and zero forced auto-refresh JS timers'
  );

  console.log('\n================================================================');
  console.log(`  ALL ${totalAssertions} PHASE 1 AD STABILITY & LAYOUT REGRESSION TESTS PASSED!`);
  console.log('================================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
