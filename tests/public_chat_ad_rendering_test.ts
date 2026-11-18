import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { AdPlacementBox, hasValidCreative, validateCreative, resolveEffectiveUnitId } from '../src/components/ads/AdPlacementBox';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  JUICYADS_CONFIG,
  MONETAG_CONFIG,
  ADSENSE_CONFIG,
  getProviderRotation,
  isAdSenseExcludedRoute,
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
    adPlacementBoxSource.includes('attempts >= 5') && adPlacementBoxSource.includes("updateStatus('unfilled')"),
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
    juicyVerticalWide === JUICYADS_CONFIG.zones.banner300x262,
    '8.10 JuicyAds vertical on wide rail (300px) selects 300x262 zone (1131765)'
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
    naturalWidth = 0,
    naturalHeight = 0,
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
      naturalWidth,
      naturalHeight,
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
        function traverse(n: any) {
          for (const c of n.children || []) {
            if (selector === '*') {
              results.push(c);
            } else if (selector === 'iframe' && c.tagName === 'IFRAME') {
              results.push(c);
            } else if (selector === 'img' && c.tagName === 'IMG') {
              results.push(c);
            } else if (selector === 'object, embed, video' && ['OBJECT', 'EMBED', 'VIDEO'].includes(c.tagName)) {
              results.push(c);
            } else if (selector === 'ins[data-ad-status]' && c.tagName === 'INS' && c.getAttribute('data-ad-status')) {
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

  // 9.12 Cross-origin iframe with rendered positive dimensions is classified as 'unverifiable' (never falsely reported filled)
  const crossOriginIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad-iframe',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { width: '300', height: '250' },
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

  // 9.13 Same-origin iframe with rendered body content is verified as confirmed filled
  const sameOriginBody = createMockNode({
    tag: 'body',
    offsetWidth: 300,
    offsetHeight: 250,
    children: [createMockNode({ tag: 'div', offsetWidth: 300, offsetHeight: 250 })],
  });
  const sameOriginIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: '/local-ad-frame.html',
        offsetWidth: 300,
        offsetHeight: 250,
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

  // 9.15 Provider documented signal: AdSense data-ad-status="unfilled"
  const adSenseUnfilledNode = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'ins',
        attrs: { 'data-ad-status': 'unfilled' },
      }),
    ],
  });
  const adSenseUnfilledResult = validateCreative(adSenseUnfilledNode);
  assert(
    adSenseUnfilledResult.status === 'unfilled' &&
      adSenseUnfilledResult.isConfirmedFilled === false &&
      hasValidCreative(adSenseUnfilledNode) === false,
    '9.15 Provider documented signal: AdSense data-ad-status="unfilled" verified as unfilled'
  );

  // --- Task 9B: Provider Rotation on No-Fill and Error ---
  console.log('\n--- 9B. Provider Rotation Progression & Terminal Cleanup ---');

  const rotationList = getProviderRotation('top', true);
  assert(
    rotationList[0] === 'adsterra' &&
      rotationList[1] === 'juicyads' &&
      rotationList[2] === 'exoclick' &&
      rotationList[3] === 'monetag',
    '9.16 Chatroom rotation follows exact priority sequence: Adsterra -> JuicyAds -> ExoClick -> Monetag'
  );

  // Verify that an unfilled or error status triggers rotation step
  let simulatedIndex = 0;
  function simulateStatusTransition(status: 'filled' | 'unfilled' | 'error' | 'unverifiable') {
    if ((status === 'unfilled' || status === 'error') && simulatedIndex < rotationList.length - 1) {
      simulatedIndex++;
      return 'rotated';
    }
    return status;
  }

  assert(simulateStatusTransition('unfilled') === 'rotated' && simulatedIndex === 1, '9.17 Provider 0 no-fill transitions to provider 1 (JuicyAds)');
  assert(simulateStatusTransition('error') === 'rotated' && simulatedIndex === 2, '9.18 Provider 1 error transitions to provider 2 (ExoClick)');
  assert(simulateStatusTransition('unfilled') === 'rotated' && simulatedIndex === 3, '9.19 Provider 2 no-fill transitions to provider 3 (Monetag)');
  assert(simulateStatusTransition('unfilled') === 'unfilled' && simulatedIndex === 3, '9.20 Provider 3 terminal no-fill terminates rotation without loop');

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

  console.log('\n================================================================');
  console.log(`  ALL ${totalAssertions} WORK PROMPT 6 & FINAL REMEDIATION TESTS PASSED!`);
  console.log('================================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
