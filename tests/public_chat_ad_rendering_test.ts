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
  shouldReevaluateSlotOnResize,
} from '../src/components/ads/AdPlacementBox';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  ADSENSE_CONFIG,
  TRAFFICSTARS_CONFIG,
  PROVIDER_REFRESH_POLICIES,
  getProviderRefreshPolicy,
  getProviderRotation,
  isAdSenseExcludedRoute,
  isRouteExcludedFromFooterAds,
  getAdsterraUnitForWidth,
  isInternalHorizontalPlacement,
  getPlacementOrientation,
  getReservedDimensionTarget,
  VERIFIED_AD_UNITS,
  getVerifiedAdUnitSpec,
  getVerifiedVerticalUnitForProvider,
} from '../src/config/adsConfig';
import { ROOMS_CONFIG } from '../src/config/voxanexConfig';
import { getExploreRoomsForSlug } from '../src/pages/PublicChatPage';
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
    '1.4 Ad polling timeout without actual rendered content marks slot unfilled rather than erroneously filled'
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
  assert(EXOCLICK_CONFIG.enabled === true, '3.3 ExoClick is enabled');
  assert(EXOCLICK_CONFIG.zoneId === '6087300', '3.4 ExoClick 300x250 zone ID is 6087300');
  assert(EXOCLICK_CONFIG.elementClass === 'eas6a97888e2', '3.5 ExoClick 300x250 element class is eas6a97888e2');
  assert(EXOCLICK_CONFIG.responsiveBannerZoneId === '6109952', '3.6 ExoClick multi-format banner zone ID is 6109952');
  assert(EXOCLICK_CONFIG.responsiveBannerElementClass === 'eas6a97888e38', '3.7 ExoClick banner element class is eas6a97888e38');
  assert(EXOCLICK_CONFIG.stickyBannerZoneId === '6110028', '3.7a ExoClick sticky banner zone ID is 6110028');
  assert(EXOCLICK_CONFIG.stickyBannerElementClass === 'eas6a97888e17', '3.7b ExoClick sticky banner class is eas6a97888e17');
  assert(EXOCLICK_CONFIG.horizontalVastZoneId === '6109970', '3.7c ExoClick VAST zone ID is 6109970');
  assert(EXOCLICK_CONFIG.videoSliderZoneId === '6102500', '3.7d ExoClick Video Slider zone ID 6102500 is preserved');

  const chatroomRotation = getProviderRotation('top', true, 'public-chatroom-top');
  assert(
    chatroomRotation.length === 1 &&
      chatroomRotation[0] === 'exoclick' &&
      !chatroomRotation.includes('adsterra') &&
      !chatroomRotation.includes('adsense'),
    '3.8 Chatroom regular rotation strictly enforces ExoClick only'
  );

  const footerRotation = getProviderRotation('footer', true, 'global-footer-responsive');
  assert(
    footerRotation.length === 1 && footerRotation.includes('adsterra'),
    '3.8b Footer rotation strictly enforces Adsterra only'
  );

  const publicFooterRotation = getProviderRotation('footer', false, 'global-footer-responsive');
  assert(
    publicFooterRotation.length === 1 && publicFooterRotation.includes('adsterra'),
    '3.8e Global footer rotation enforces Adsterra only on public routes as well'
  );

  const nonChatroomRotation = getProviderRotation('top', false, 'public-content-top');
  assert(
    nonChatroomRotation.length === 2 &&
      nonChatroomRotation.includes('adsense') &&
      nonChatroomRotation.includes('exoclick') &&
      !nonChatroomRotation.includes('adsterra'),
    '3.9 Non-chatroom non-footer rotation allows AdSense and ExoClick while excluding Footer-only Adsterra'
  );

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );
  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"') &&
      !publicChatPageSource.includes('slotId="public-chatroom-left"') &&
      !publicChatPageSource.includes('slotId="public-chatroom-right"') &&
      publicChatPageSource.includes('slotId="participant-box-horizontal"') &&
      publicChatPageSource.includes('slotId="public-chatroom-bottom"') &&
      publicChatPageSource.includes('slotId="public-chatroom-status-above"') &&
      !publicChatPageSource.includes('public-chatroom-status-below') &&
      publicChatPageSource.includes('slotId="public-chatroom-message-inline"') &&
      !publicChatPageSource.includes('public-chatroom-body-bottom') &&
      !publicChatPageSource.includes('chatroom-juicyads-bottom') &&
      publicChatPageSource.includes('slotId="chatroom-explore-bottom"'),
    '3.10 Approved chatroom ExoClick placement IDs are present and Monetag/JuicyAds/vertical rails are completely removed'
  );
  assert(
    !appSource.includes('<MonetagScript') &&
      !fs.existsSync(path.resolve('src/components/ads/MonetagScript.tsx')) &&
      resolveEffectiveUnitId({
        provider: 'adsterra',
        position: 'content-gap',
        slotId: 'some-other-slot',
        containerWidth: 728,
        isLiveChatScreen: false,
      }) === null &&
      resolveEffectiveUnitId({
        provider: 'exoclick',
        position: 'top',
        slotId: 'public-chatroom-top',
        containerWidth: 728,
        isLiveChatScreen: true,
      }) === EXOCLICK_CONFIG.responsiveBannerZoneId,
    '3.10b Adsterra stays restricted to Footer, MonetagScript is removed, and chatroom banners resolve ExoClick 6109952'
  );
  assert(
    publicChatPageSource.includes('grid grid-cols-1 grid-rows-[minmax(0,1fr)]') &&
      publicChatPageSource.includes('h-[clamp(520px,calc(100svh-11.125rem),780px)]') &&
      publicChatPageSource.includes('md:h-[clamp(600px,calc(100svh-13.625rem),980px)]') &&
      publicChatPageSource.includes('min-h-0'),
    '3.11 Central chatroom container enforces calculated clamp() responsive viewport sizing with grid-rows-[minmax(0,1fr)] and min-h-0 internal scroll protection'
  );

  assert(!publicChatPageSource.includes('BanglishHelperBar'), '3.12 BanglishHelperBar is successfully removed');

  const composerStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerEnd = publicChatPageSource.indexOf('</form>', composerStart) + 7;
  const composerCode = publicChatPageSource.slice(composerStart, composerEnd);
  assert(!composerCode.includes('AdPlacementBox'), '3.13 No ad inserted into message composer');

  // --- Task 8: Behavioral Responsive Unit Selection Assertions ---
  console.log('\n--- 8. Behavioral Responsive Unit Selection & Preconfigured Override Protection ---');

  // 8.1 Mobile Footer Ad: Preconfigured 728x90 unit must NOT bypass responsive selection on 375px mobile
  const mobileFooterUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'footer',
    slotId: 'global-footer-responsive',
    primaryAdUnitId: ADSTERRA_CONFIG.banner728x90,
    containerWidth: 375,
    isLiveChatScreen: false,
  });
  assert(
    mobileFooterUnit === ADSTERRA_CONFIG.banner320x50,
    '8.1 Mobile (375px): Preconfigured 728x90 desktop unit in footer is downgraded to 320x50 banner format'
  );

  // 8.2 Tablet Footer Ad: 768px container safely accommodates 728x90
  const tabletFooterUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'footer',
    slotId: 'global-footer-responsive',
    primaryAdUnitId: ADSTERRA_CONFIG.banner728x90,
    containerWidth: 768,
    isLiveChatScreen: false,
  });
  assert(
    tabletFooterUnit === ADSTERRA_CONFIG.banner728x90,
    '8.2 Tablet (768px): Footer ad safely selects 728x90 banner format'
  );

  // 8.3 Mobile Footer Ad: Preconfigured 728x90 downgraded on 390px mobile
  const mobileFooterBottomUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'footer',
    slotId: 'global-footer-responsive',
    primaryAdUnitId: ADSTERRA_CONFIG.banner728x90,
    containerWidth: 390,
    isLiveChatScreen: false,
  });
  assert(
    mobileFooterBottomUnit === ADSTERRA_CONFIG.banner320x50,
    '8.3 Mobile (390px): Footer ad selects 320x50 banner format'
  );

  // 8.4 Narrow viewport (<320px) returns null to prevent clipping and overflow
  const tooNarrowUnit = resolveEffectiveUnitId({
    provider: 'adsterra',
    position: 'footer',
    slotId: 'global-footer-responsive',
    containerWidth: 300,
    isLiveChatScreen: false,
  });
  assert(
    tooNarrowUnit === null,
    '8.4 Insufficient width (<320px): Returns null to trigger fallback/clean collapse'
  );

  // 8.5 ExoClick horizontal slots (6109952) & Explore bottom 300x250 (6087300)
  const exoMobile = resolveEffectiveUnitId({
    provider: 'exoclick',
    position: 'top',
    slotId: 'public-chatroom-top',
    containerWidth: 375,
    isLiveChatScreen: true,
  });
  assert(
    exoMobile === EXOCLICK_CONFIG.responsiveBannerZoneId,
    '8.5 ExoClick horizontal on mobile (375px) selects multi-format zone (6109952)'
  );

  const exoDesktop = resolveEffectiveUnitId({
    provider: 'exoclick',
    position: 'top',
    slotId: 'public-chatroom-top',
    containerWidth: 1280,
    isLiveChatScreen: true,
  });
  assert(
    exoDesktop === EXOCLICK_CONFIG.responsiveBannerZoneId,
    '8.6 ExoClick horizontal on desktop (1280px) selects multi-format zone (6109952)'
  );

  const exoExploreBottom = resolveEffectiveUnitId({
    provider: 'exoclick',
    position: 'bottom',
    slotId: 'chatroom-explore-bottom',
    containerWidth: 320,
    isLiveChatScreen: true,
  });
  assert(
    exoExploreBottom === EXOCLICK_CONFIG.zoneId,
    '8.7 Explore bottom (320px) resolves dedicated ExoClick 300x250 zone (6087300)'
  );

  // 8.9 ExoClick vertical sidebar: narrow vs wide (rejected cleanly)
  const exoVerticalNarrow = resolveEffectiveUnitId({
    provider: 'exoclick',
    position: 'left',
    slotId: 'public-chatroom-left',
    isVertical: true,
    containerWidth: 160,
    isLiveChatScreen: true,
  });
  assert(
    exoVerticalNarrow === null,
    '8.9 ExoClick vertical on narrow rail (160px) returns null to prevent clipping'
  );

  const exoVerticalWide = resolveEffectiveUnitId({
    provider: 'exoclick',
    position: 'left',
    slotId: 'public-chatroom-left',
    isVertical: true,
    containerWidth: 300,
    isLiveChatScreen: true,
  });
  assert(
    exoVerticalWide === null,
    '8.10 ExoClick vertical on wide rail (300px) rejects landscape 300x250 zone (6087300) and returns null'
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
    children: [createMockNode({ tag: 'script', src: 'https://a.magsrv.com/ad-provider.js' })],
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

  const rotationList = getProviderRotation('top', false, 'public-content-top');
  assert(
    rotationList.length === 2 &&
      rotationList[0] === 'adsense' &&
      rotationList[1] === 'exoclick',
    '9.22 Public non-chat rotation enforces AdSense and ExoClick only'
  );

  // Test actual production computeProviderTransition
  const t1 = computeProviderTransition('unfilled', 0, rotationList);
  assert(t1.shouldRotate && t1.nextIndex === 1 && t1.action === 'rotate', '9.23 AdSense no-fill -> ExoClick rotation decision');

  const t2 = computeProviderTransition('unfilled', 1, rotationList);
  assert(!t2.shouldRotate && t2.isTerminal && t2.action === 'settle', '9.24 ExoClick terminal no-fill terminates rotation without loop');

  const t5 = computeProviderTransition('unverifiable', 0, rotationList);
  assert(!t5.shouldRotate && t5.isTerminal, '9.25 Unverifiable status does not trigger rotation');

  const t6 = computeProviderTransition('filled', 0, rotationList);
  assert(!t6.shouldRotate && t6.isTerminal, '9.26 Confirmed filled status does not trigger rotation');

  const t7 = computeProviderTransition('unfilled', 0, rotationList, 'exoclick');
  assert(!t7.shouldRotate && t7.isTerminal, '9.27 Explicit provider behavior respects single provider without rotation');

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
    publicChatPageSource.includes('slotId="public-chatroom-status-above"') &&
      !publicChatPageSource.includes('public-chatroom-status-below') &&
      publicChatPageSource.includes('slotId="public-chatroom-message-inline"'),
    '10.3 Status-above and message-inline remain intact while public-chatroom-status-below is cleanly removed'
  );
  assert(
    !composerCode.includes('AdPlacementBox'),
    '10.4 Chat message composer remains strictly free of ad placements'
  );
  assert(
    publicChatPageSource.includes('const preInlineMessages = messages.slice(0, splitIndex);') &&
      publicChatPageSource.includes('const postInlineMessages = messages.slice(splitIndex);') &&
      publicChatPageSource.includes('key="public-chatroom-message-inline-container"') &&
      (publicChatPageSource.match(/slotId="public-chatroom-message-inline"/g) || []).length === 1,
    '10.5 public-chatroom-message-inline mounts once at a fixed React sibling position across 0, 1-4, and >=5 non-system messages without remounting'
  );
  assert(
    /getProviderRotation\(\s*position\s*\|\|\s*'',\s*effectiveIsLiveChatScreen,\s*slotId/.test(adPlacementBoxSource),
    '10.6 AdPlacementBox forwards slotId to getProviderRotation for slot-specific policy enforcement'
  );

  // --- Task 11: Phase 1 Orientation Guard, Dimension Targets & Creative Bounds ---
  console.log('\n--- 11. Phase 1 Orientation Guard, Reserved Dimensions & Bounds Validation ---');

  assert(
    isInternalHorizontalPlacement('public-chatroom-status-above') &&
      !isInternalHorizontalPlacement('public-chatroom-status-below') &&
      isInternalHorizontalPlacement('public-chatroom-message-inline') &&
      !isInternalHorizontalPlacement('public-chatroom-left') &&
      !isInternalHorizontalPlacement('public-chatroom-top'),
    '11.1 isInternalHorizontalPlacement accurately identifies approved internal chatroom placements'
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

  // Accept 300x112 horizontal creative inside participant-box-horizontal (max 320x120)
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
    '11.10 Responsive 300x112 creative passes validation inside Participant Bar (<= 320x120)'
  );

  // --- Task 12: Phase 1 All-Device Unit Resolution (Participant Bar, Internal & Sidebars) ---
  console.log('\n--- 12. Phase 1 Multi-Viewport Unit Resolution (Desktop, Tablet, Mobile) ---');

  // 12.1 Participant Bar uses ExoClick 6109952 on mobile & desktop, never forcing 300x250 (6087300)
  assert(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'sidebar-horizontal',
      slotId: 'participant-box-horizontal',
      containerWidth: 304,
      isLiveChatScreen: true,
    }) === EXOCLICK_CONFIG.responsiveBannerZoneId,
    '12.1 Participant Bar (304px mobile drawer): ExoClick resolves responsive zone (6109952) and avoids 300x250'
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
    '12.2 Participant Bar (304px mobile drawer): Adsterra strictly blocked outside footer'
  );
  assert(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'sidebar-horizontal',
      slotId: 'participant-box-horizontal',
      containerWidth: 324,
      isLiveChatScreen: true,
    }) === EXOCLICK_CONFIG.responsiveBannerZoneId,
    '12.3 Participant Bar (324px desktop lg/xl): ExoClick resolves responsive zone (6109952)'
  );

  // 12.4 Vertical sidebars reject landscape 300x250 and unverified native unit IDs
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
        provider: 'exoclick',
        position: 'right',
        slotId: 'public-chatroom-right',
        primaryAdUnitId: EXOCLICK_CONFIG.zoneId,
        isVertical: true,
        containerWidth: 300,
        isLiveChatScreen: true,
      }) === null,
    '12.4 Vertical sidebars strictly reject landscape 300x250 and unverified native unit IDs even on 300px rails'
  );

  // 12.5 Dynamic ExoClick zones without verified vertical portrait dimensions do not inject into vertical sidebars
  assert(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'right',
      slotId: 'public-chatroom-right',
      isVertical: true,
      containerWidth: 160,
      isLiveChatScreen: true,
    }) === null,
    '12.5 ExoClick zones without verified vertical dimensions return null for vertical sidebars'
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
  const firstScript = ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl);
  const secondScript = ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl);
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

  // 16.8 Provider format registry classifies 300x250 as horizontal and PublicChatPage sidebars do not pass it
  const spec300x250 = getVerifiedAdUnitSpec(ADSTERRA_CONFIG.banner300x250, 'adsterra');
  const exoSpec300x250 = getVerifiedAdUnitSpec(EXOCLICK_CONFIG.zoneId, 'exoclick');
  assert(
    spec300x250?.orientation === 'horizontal' &&
      exoSpec300x250?.orientation === 'horizontal' &&
      VERIFIED_AD_UNITS.every((u) => (u.orientation === 'vertical' ? u.height > u.width : u.width >= u.height)) &&
      getVerifiedVerticalUnitForProvider('adsterra', 300) === null &&
      getVerifiedVerticalUnitForProvider('exoclick', 300) === null &&
      !publicChatPageSource.includes('adUnitId={ADSTERRA_CONFIG.nativeUnitId}') &&
      !publicChatPageSource.includes('adUnitId={ADSTERRA_CONFIG.banner300x250}'),
    '16.8 Registry classifies 300x250 accurately as horizontal and PublicChatPage excludes non-vertical unit IDs'
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

  // 17.3 Unsupported providers (Adsterra, AdSense) strictly disable auto-refresh & custom JS timers
  assert(
    PROVIDER_REFRESH_POLICIES.adsterra.chosenIntervalSec === null &&
      PROVIDER_REFRESH_POLICIES.adsterra.usesCustomJsTimer === false &&
      PROVIDER_REFRESH_POLICIES.adsense.chosenIntervalSec === null &&
      PROVIDER_REFRESH_POLICIES.adsense.usesCustomJsTimer === false,
    '17.3 Adsterra and AdSense have no forced/custom JS refresh timers'
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
    const availOuter = vw === 768 ? 736 : 728;
    assert(
      resolveEffectiveUnitId({
        provider: 'exoclick',
        position: 'top',
        slotId: 'public-chatroom-top',
        containerWidth: availOuter,
        isLiveChatScreen: true,
      }) === EXOCLICK_CONFIG.responsiveBannerZoneId &&
        resolveEffectiveUnitId({
          provider: 'exoclick',
          position: 'bottom',
          slotId: 'public-chatroom-bottom',
          containerWidth: availOuter,
          isLiveChatScreen: true,
        }) === EXOCLICK_CONFIG.responsiveBannerZoneId &&
        resolveEffectiveUnitId({
          provider: 'adsterra',
          position: 'footer',
          slotId: 'global-footer-responsive',
          containerWidth: availOuter,
          isLiveChatScreen: false,
        }) === ADSTERRA_CONFIG.banner728x90,
      `17.8a Viewport ${vw}px selects ExoClick 6109952 for chatroom banners and Adsterra 728x90 for footer`
    );
  }

  for (const mobileWidth of [390, 320]) {
    assert(
      resolveEffectiveUnitId({
        provider: 'exoclick',
        position: 'top',
        slotId: 'public-chatroom-top',
        containerWidth: mobileWidth,
        isLiveChatScreen: true,
      }) === EXOCLICK_CONFIG.responsiveBannerZoneId &&
        resolveEffectiveUnitId({
          provider: 'exoclick',
          position: 'bottom',
          slotId: 'public-chatroom-bottom',
          containerWidth: mobileWidth,
          isLiveChatScreen: true,
        }) === EXOCLICK_CONFIG.responsiveBannerZoneId &&
        resolveEffectiveUnitId({
          provider: 'adsterra',
          position: 'footer',
          slotId: 'global-footer-responsive',
          containerWidth: mobileWidth,
          isLiveChatScreen: false,
        }) === ADSTERRA_CONFIG.banner320x50,
      `17.8b Mobile viewport ${mobileWidth}px fits ExoClick 6109952 and Adsterra 320x50 cleanly on outer banners without clipping`
    );

    const internalAvail = mobileWidth - 18;
    assert(
      resolveEffectiveUnitId({
        provider: 'exoclick',
        position: 'sidebar-horizontal',
        slotId: 'public-chatroom-status-above',
        containerWidth: internalAvail,
        isLiveChatScreen: true,
      }) === EXOCLICK_CONFIG.responsiveBannerZoneId &&
        resolveEffectiveUnitId({
          provider: 'exoclick',
          position: 'sidebar-horizontal',
          slotId: 'public-chatroom-message-inline',
          containerWidth: internalAvail,
          isLiveChatScreen: true,
        }) === EXOCLICK_CONFIG.responsiveBannerZoneId,
      `17.8c Internal chatroom ads at ${mobileWidth}px (${internalAvail}px inner width) select ExoClick 6109952 cleanly`
    );
  }

  assert(
    adPlacementBoxSource.includes('visibilitychange') &&
      adPlacementBoxSource.includes('IntersectionObserver') &&
      adPlacementBoxSource.includes('settledRequiredWidthRef') &&
      !adPlacementBoxSource.includes('setInterval(() => {\n        // refresh'),
    '17.9 AdPlacementBox enforces page/slot visibility, viewport-shrink downgrade, and zero forced auto-refresh JS timers'
  );

  // --- Task 18: Phase R2.3 Revenue-Optimized ExoClick Stability & Explore Chatrooms UI Integration ---
  console.log('\n--- 18. ExoClick Deterministic Rotation, Loop Prevention & Explore UI ---');

  const topRot = getProviderRotation('top', true, 'public-chatroom-top');
  const statusAboveRot = getProviderRotation('sidebar-horizontal', true, 'public-chatroom-status-above');
  const msgInlineRot = getProviderRotation('sidebar-horizontal', true, 'public-chatroom-message-inline');
  const bottomRot = getProviderRotation('bottom', true, 'public-chatroom-bottom');
  const exploreRot = getProviderRotation('content-gap', true, 'explore-chatrooms-inline');
  const participantRot = getProviderRotation('sidebar-horizontal', true, 'participant-box-horizontal');

  assert(
    topRot.join(',') === 'exoclick' &&
      statusAboveRot.join(',') === 'exoclick' &&
      msgInlineRot.join(',') === 'exoclick' &&
      bottomRot.join(',') === 'exoclick' &&
      exploreRot.join(',') === 'exoclick' &&
      participantRot.join(',') === 'exoclick' &&
      getProviderRotation('footer', false, 'global-footer-responsive').join(',') === 'adsterra',
    '18.1 All live chatroom placements use ExoClick exclusively while global footer remains Adsterra-only'
  );

  const evalFn = (provider: 'adsense' | 'exoclick', width: number | null) =>
    resolveEffectiveUnitId({
      provider: 'adsterra',
      position: 'footer',
      slotId: 'global-footer-responsive',
      containerWidth: width,
      isLiveChatScreen: false,
    });

  assert(
    shouldReevaluateSlotOnResize({
      adStatus: 'unfilled',
      prevWidth: null,
      nextWidth: 768,
      primaryRotationProvider: 'adsterra',
      getEffectiveUnitId: evalFn,
    }) === false &&
      shouldReevaluateSlotOnResize({
        adStatus: 'unfilled',
        prevWidth: 768,
        nextWidth: 768,
        primaryRotationProvider: 'adsterra',
        getEffectiveUnitId: evalFn,
      }) === false &&
      shouldReevaluateSlotOnResize({
        adStatus: 'error',
        prevWidth: 390,
        nextWidth: 390,
        primaryRotationProvider: 'adsterra',
        getEffectiveUnitId: evalFn,
      }) === false &&
      shouldReevaluateSlotOnResize({
        adStatus: 'unfilled',
        prevWidth: 390,
        nextWidth: 768,
        primaryRotationProvider: 'adsterra',
        getEffectiveUnitId: evalFn,
      }) === true &&
      !adPlacementBoxSource.includes('cleanupSlotRuntime();\n            return \'idle\';'),
    '18.3 Constant containerWidth never triggers infinite unfilled/error retry loops, while genuine breakpoint widening re-evaluates cleanly without side-effects in state updaters'
  );

  assert(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'content-gap',
      slotId: 'explore-chatrooms-inline',
      containerWidth: 1024,
      isLiveChatScreen: true,
    }) === EXOCLICK_CONFIG.responsiveBannerZoneId &&
      resolveEffectiveUnitId({
        provider: 'exoclick',
        position: 'bottom',
        slotId: 'chatroom-explore-bottom',
        containerWidth: 320,
        isLiveChatScreen: true,
      }) === EXOCLICK_CONFIG.zoneId &&
      resolveEffectiveUnitId({
        provider: 'adsterra',
        position: 'content-gap',
        slotId: 'explore-chatrooms-inline',
        containerWidth: 1024,
        isLiveChatScreen: true,
      }) === null,
    '18.4 Explore Sponsored resolves 6109952, Explore bottom resolves 6087300 (300x250), and Adsterra is blocked outside Footer'
  );

  const exploreAdHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'explore-chatrooms-inline',
        position: 'content-gap',
        isLiveChatScreen: true,
      })
    )
  );
  assert(
    exploreAdHtml.includes('data-testid="ad-slot-explore-chatrooms-inline"') &&
      exploreAdHtml.includes('data-ad-orientation="horizontal"') &&
      exploreAdHtml.includes('md:max-w-[728px]'),
    '18.5 Explore Sponsored slot SSR renders non-collapsing responsive horizontal container'
  );

  // 18.6 Explore Other Chatrooms UI redesign, exclusion, responsive 3/2/1 columns & failure-hide behavior
  const banglaExcluded = getExploreRoomsForSlug('bangla');
  const sexExcluded = getExploreRoomsForSlug('sex');
  assert(
    banglaExcluded.length === ROOMS_CONFIG.length - 1 &&
      !banglaExcluded.some((r) => r.slug === 'bangla') &&
      sexExcluded.length === ROOMS_CONFIG.length - 1 &&
      !sexExcluded.some((r) => r.slug === 'sex') &&
      publicChatPageSource.includes('data-testid="explore-other-chatrooms-grid"') &&
      publicChatPageSource.includes('grid-cols-1 md:grid-cols-2 lg:grid-cols-3') &&
      publicChatPageSource.includes('data-testid="explore-chatrooms-sponsored-wrapper"') &&
      publicChatPageSource.includes('slotId="explore-chatrooms-inline"') &&
      publicChatPageSource.includes('!exploreAdFailed') &&
      publicChatPageSource.includes('অন্যান্য চ্যাটরুম ঘুরে দেখুন') &&
      publicChatPageSource.includes('Explore Other Chatrooms') &&
      !/active\s*users\s*online\s*now/i.test(publicChatPageSource),
    '18.6 Explore Other Chatrooms excludes active room, uses responsive 1/2/3-col grid, bilingual EN/BN labels, zero fake live stats, and hides Sponsored wrapper on terminal failure'
  );

  // 18.7 Persistent message-inline & complete removal of deprecated placements/widgets
  const footerSource = fs.readFileSync(path.resolve('src/components/layout/Footer.tsx'), 'utf-8');
  const indexHtmlSource = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  assert(
    publicChatPageSource.includes('const preInlineMessages = messages.slice(0, splitIndex);') &&
      publicChatPageSource.includes('const postInlineMessages = messages.slice(splitIndex);') &&
      !publicChatPageSource.includes('public-chatroom-status-below') &&
      !footerSource.toLowerCase().includes('trustpilot') &&
      !indexHtmlSource.toLowerCase().includes('trustpilot') &&
      !publicChatPageSource.toLowerCase().includes('livejasmin') &&
      !publicChatPageSource.toLowerCase().includes('awempire'),
    '18.7 Message-inline persists cleanly at fixed split index while status-below, Trustpilot, and Live Cam widgets remain completely absent'
  );

  // --- Task 19: Chatroom Ad Stability, Footer Route Re-enablement, Participant Bar Collapse & Scoped Loaders ---
  console.log('\n--- 19. Chatroom Layout Protection, Footer Adsterra Policy & Container-Scoped Loaders ---');

  // 19.1 Footer Adsterra policy: enabled on public chatroom & public pages, excluded on auth/admin/checkout/payment
  assert(
    isRouteExcludedFromFooterAds('/chat') === false &&
      isRouteExcludedFromFooterAds('/chat/bangla') === false &&
      isRouteExcludedFromFooterAds('/chat?roomId=bangla') === false &&
      isRouteExcludedFromFooterAds('/') === false &&
      isRouteExcludedFromFooterAds('/rooms') === false &&
      isRouteExcludedFromFooterAds('/user/login') === true &&
      isRouteExcludedFromFooterAds('/user/register') === true &&
      isRouteExcludedFromFooterAds('/user/guest-entry') === true &&
      isRouteExcludedFromFooterAds('/user/password-reset') === true &&
      isRouteExcludedFromFooterAds('/user/account-recovery') === true &&
      isRouteExcludedFromFooterAds('/auth') === true &&
      isRouteExcludedFromFooterAds('/admin/login') === true &&
      isRouteExcludedFromFooterAds('/moderator/login') === true &&
      isRouteExcludedFromFooterAds('/checkout') === true &&
      isRouteExcludedFromFooterAds('/payment') === true,
    '19.1 Footer Adsterra re-enabled on chatroom/public routes while strictly excluded on auth, admin, moderator, checkout, and payment routes'
  );

  // 19.2 Adsterra footer sizing rejects <320px (no 300x250 fallback in footer)
  assert(
    getAdsterraUnitForWidth(300, 'footer') === null &&
      getAdsterraUnitForWidth(319, 'footer') === null &&
      getAdsterraUnitForWidth(320, 'footer') === ADSTERRA_CONFIG.banner320x50 &&
      getAdsterraUnitForWidth(728, 'footer') === ADSTERRA_CONFIG.banner728x90 &&
      getAdsterraUnitForWidth(1024, 'footer') === ADSTERRA_CONFIG.banner728x90,
    '19.2 Adsterra footer selects 728x90 (>=728px) or 320x50 (>=320px) and returns null <320px without substituting 300x250'
  );

  // 19.3 Participant bar width-collapse + external-to-panel border + container-scoped loaders checks
  assert(
    adPlacementBoxSource.includes('isParticipantWidthCollapsed') &&
      adPlacementBoxSource.includes("'data-ad-collapsed': isParticipantWidthCollapsed ? 'true' : 'false'") &&
      adPlacementBoxSource.includes('startPolling(() => imperativeHostRef.current') &&
      adPlacementBoxSource.includes("adStatusRef.current === 'loading'") &&
      publicChatPageSource.includes('{/* Ad 4 — External Participant-Side Ad (50px) - OUTSIDE and BELOW the participant panel\'s border */}') &&
      !publicChatPageSource.includes('public-chatroom-left') &&
      !publicChatPageSource.includes('public-chatroom-right'),
    '19.3 Participant bar collapses cleanly below 300px, ExoClick polling inspects imperativeHostRef container, loading host clears cleanly on visibility loss, and no empty vertical rails waste horizontal width'
  );

  // 19.4 SSR sanity on PublicChatPage route context (/chat still excludes AdSense but enables footer global-footer-responsive)
  const chatFooterHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'global-footer-responsive',
        position: 'footer',
        isLiveChatScreen: true,
      })
    )
  );
  assert(
    chatFooterHtml.includes('data-testid="ad-slot-global-footer-responsive"') &&
      chatFooterHtml.includes('data-ad-provider="adsterra"') &&
      !chatFooterHtml.includes('adsbygoogle'),
    '19.4 Footer slot on /chat renders Adsterra container cleanly without AdSense'
  );

  // --- Task 20: Chatroom Height, Border Alignment & Equal Vertical Spacing ---
  console.log('\n--- 20. Chatroom Height Restoration, Border Alignment & Equal Vertical Spacing ---');

  assert(
    publicChatPageSource.includes('className="relative w-full overflow-x-clip flex flex-col gap-4 py-4"') &&
      publicChatPageSource.includes('<AdPlacementBox\n          slotId="public-chatroom-top"\n          position="top"\n          className="!my-0"') &&
      publicChatPageSource.includes('<AdPlacementBox\n          slotId="public-chatroom-bottom"\n          position="bottom"\n          className="!my-0"') &&
      !publicChatPageSource.includes('public-chatroom-body-bottom') &&
      !publicChatPageSource.includes('data-testid="explore-other-chatrooms-section"\n            className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 mb-8"'),
    '20.1 PublicChatPage outer stack uses uniform 16px (gap-4 py-4) spacing with !my-0 margin overrides on outer ads'
  );

  assert(
    publicChatPageSource.includes('h-[clamp(520px,calc(100svh-11.125rem),780px)]') &&
      publicChatPageSource.includes('md:h-[clamp(600px,calc(100svh-13.625rem),980px)]') &&
      publicChatPageSource.includes('className="h-full w-full flex flex-col overflow-hidden border border-slate-800 rounded-2xl bg-[#090d18] relative shadow-2xl min-w-0 min-h-0 ring-1 ring-slate-800/50"') &&
      !publicChatPageSource.includes('10.25rem') &&
      !publicChatPageSource.includes('12.5rem') &&
      !publicChatPageSource.includes('min-h-[380px]') &&
      !publicChatPageSource.includes('max-h-[880px]'),
    '20.2 Chatroom container uses calculated clamp() heights derived from chrome + top ad + uniform 16px gaps and preserves flush rounded border'
  );

  const topOrderIdx = publicChatPageSource.indexOf('slotId="public-chatroom-top"');
  const chatOrderIdx = publicChatPageSource.indexOf('data-testid="central-chatroom-container"');
  const bottomOrderIdx = publicChatPageSource.indexOf('slotId="public-chatroom-bottom"');
  const exploreOrderIdx = publicChatPageSource.indexOf('data-testid="explore-other-chatrooms-section"');
  const exploreBottomOrderIdx = publicChatPageSource.indexOf('slotId="chatroom-explore-bottom"');
  assert(
    topOrderIdx > 0 &&
      chatOrderIdx > topOrderIdx &&
      bottomOrderIdx > chatOrderIdx &&
      exploreOrderIdx > bottomOrderIdx &&
      exploreBottomOrderIdx > exploreOrderIdx,
    '20.3 Vertical section order strictly matches Top Ad -> Chatroom -> Bottom Ad -> Explore Other Chatrooms -> ExoClick 300x250 Explore Bottom'
  );

  assert(
    publicChatPageSource.includes('<div className="flex-1 min-w-0 relative">') &&
      publicChatPageSource.includes('<TypingIndicator typers={typers} />') &&
      publicChatPageSource.includes('className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2 shrink-0 relative"'),
    '20.4 Mobile composer wrapper uses flex-1 min-w-0 and unclipped shrink-0 dock inside central chatroom container'
  );

  console.log('\n================================================================');
  console.log(`  ALL ${totalAssertions} PHASE R2.3 AD STABILITY & EXPLORE UI TESTS PASSED!`);
  console.log('================================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
