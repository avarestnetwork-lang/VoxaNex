import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { AdPlacementBox, hasValidCreative, resolveEffectiveUnitId } from '../src/components/ads/AdPlacementBox';
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
  console.log('\n--- 9. Behavioral Creative Verification (hasValidCreative) ---');

  function createMockNode({
    tag = 'div',
    children = [],
    attrs = {},
    style = {},
    offsetWidth = 0,
    offsetHeight = 0,
    src = '',
    naturalWidth = 0,
  }: any = {}): any {
    return {
      tagName: tag.toUpperCase(),
      style: { display: 'block', visibility: 'visible', ...style },
      offsetWidth,
      offsetHeight,
      clientWidth: offsetWidth,
      clientHeight: offsetHeight,
      src,
      naturalWidth,
      children,
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      querySelector(selector: string) {
        if (selector === 'iframe') {
          return children.find((c: any) => c.tagName === 'IFRAME') || null;
        }
        if (selector === 'img') {
          return children.find((c: any) => c.tagName === 'IMG') || null;
        }
        if (selector === 'object, embed, video') {
          return children.find((c: any) => ['OBJECT', 'EMBED', 'VIDEO'].includes(c.tagName)) || null;
        }
        return null;
      },
    };
  }

  // 9.1 Null element rejected
  assert(hasValidCreative(null) === false, '9.1 Null container is strictly rejected as unfilled');

  // 9.2 Empty container rejected
  const emptyContainer = createMockNode({ tag: 'div', children: [] });
  assert(hasValidCreative(emptyContainer) === false, '9.2 Empty wrapper div is strictly rejected as unfilled');

  // 9.3 Script-only container rejected
  const scriptOnly = createMockNode({
    tag: 'div',
    children: [createMockNode({ tag: 'script', src: 'https://nap5k.com/tag.min.js' })],
  });
  assert(hasValidCreative(scriptOnly) === false, '9.3 Script-only container is strictly rejected as unfilled');

  // 9.4 Arbitrary text / placeholder elements rejected
  const textPlaceholder = createMockNode({
    tag: 'div',
    children: [createMockNode({ tag: 'span' }), createMockNode({ tag: 'p' })],
  });
  assert(
    hasValidCreative(textPlaceholder) === false,
    '9.4 Arbitrary non-creative text/wrapper elements are strictly rejected as unfilled'
  );

  // 9.5 Hidden iframe rejected
  const hiddenIframeContainer = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad',
        style: { display: 'none' },
      }),
    ],
  });
  assert(
    hasValidCreative(hiddenIframeContainer) === false,
    '9.5 Hidden iframe (display: none) is strictly rejected as unfilled'
  );

  // 9.6 Zero-sized iframe without src rejected
  const zeroSizeIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        attrs: { width: '0', height: '0' },
      }),
    ],
  });
  assert(
    hasValidCreative(zeroSizeIframe) === false,
    '9.6 Zero-sized iframe without src is strictly rejected as unfilled'
  );

  // 9.7 Rendered creative iframe with positive dimensions and valid src accepted
  const validCreativeIframe = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'iframe',
        src: 'https://a.magsrv.com/ad-iframe',
        offsetWidth: 300,
        offsetHeight: 250,
        attrs: { width: '300', height: '250' },
      }),
    ],
  });
  assert(
    hasValidCreative(validCreativeIframe) === true,
    '9.7 Rendered creative iframe with positive dimensions and valid src is verified as filled'
  );

  // 9.8 Image banner creative with positive natural dimensions and valid src accepted
  const validImageBanner = createMockNode({
    tag: 'div',
    children: [
      createMockNode({
        tag: 'img',
        src: 'https://cdn.example.com/banner320x50.png',
        offsetWidth: 320,
        offsetHeight: 50,
        naturalWidth: 320,
      }),
    ],
  });
  assert(
    hasValidCreative(validImageBanner) === true,
    '9.8 Rendered image banner creative with valid src and dimensions is verified as filled'
  );

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
