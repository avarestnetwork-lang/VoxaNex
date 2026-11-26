import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  JUICYADS_CONFIG,
  EXOCLICK_CONFIG,
  VERIFIED_AD_UNITS,
  isEligibleRouteForGlobalAds,
  isAdSenseExcludedRoute,
  isRouteExcludedFromFooterAds,
} from '../src/config/adsConfig';
import { isSafeHttpUrl } from '../src/components/ads/HorizontalVastVideoAd';
import { ensureHeadScriptOnce } from '../src/components/ads/AdPlacementBox';
import {
  CentralizedAdCoordinator,
  evaluateJuicyAdsFloatingState,
} from '../src/components/ads/CentralizedAdCoordinator';
import { ConsentProvider } from '../src/context/ConsentContext';
import { RouterProvider } from '../src/context/RouterContext';

console.log('================================================================');
console.log('  FINAL PHASE ADS INTEGRATION & AUDIT REMEDIATION TEST SUITE');
console.log('================================================================');

function withMockBrowserEnv(
  pathname: string,
  storageEntries: Record<string, string>,
  fn: () => void
) {
  const prevWindow = (global as any).window;
  const prevDocument = (global as any).document;

  const store = new Map<string, string>(Object.entries(storageEntries));
  const mockLocalStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  };

  (global as any).window = {
    location: { pathname },
    localStorage: mockLocalStorage,
    history: { pushState: () => {}, back: () => {} },
    scrollTo: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  try {
    fn();
  } finally {
    (global as any).window = prevWindow;
    (global as any).document = prevDocument;
  }
}

function runTests() {
  const vastSource = fs.readFileSync(path.resolve('src/components/ads/HorizontalVastVideoAd.tsx'), 'utf-8');
  const coordinatorSource = fs.readFileSync(path.resolve('src/components/ads/CentralizedAdCoordinator.tsx'), 'utf-8');
  const sliderSource = fs.readFileSync(path.resolve('src/components/ads/ExoClickVideoSlider.tsx'), 'utf-8');
  const adSenseLoaderSource = fs.readFileSync(path.resolve('src/components/ads/AdSenseScriptLoader.tsx'), 'utf-8');
  const adPlacementBoxSource = fs.readFileSync(path.resolve('src/components/ads/AdPlacementBox.tsx'), 'utf-8');
  const consentContextSource = fs.readFileSync(path.resolve('src/context/ConsentContext.tsx'), 'utf-8');
  const publicChatSource = fs.readFileSync(path.resolve('src/pages/PublicChatPage.tsx'), 'utf-8');
  const indexCssSource = fs.readFileSync(path.resolve('src/index.css'), 'utf-8');

  // -------------------------------------------------------------------------
  // 1. JuicyAds Decoupling: 1133907 Floating + 1133909 Explore Display Both Eligible
  // -------------------------------------------------------------------------
  console.log('\n--- 1. JuicyAds Zone Decoupling (1133907 & 1133909 Independently Eligible) ---');

  assert(
    !coordinatorSource.includes('getJuicyAdsPageLoadAlternation'),
    'CentralizedAdCoordinator must not import or use getJuicyAdsPageLoadAlternation'
  );
  assert(
    !publicChatSource.includes('getJuicyAdsPageLoadAlternation') &&
      !publicChatSource.includes("activeJuicyAdsZone === '1133909'"),
    'PublicChatPage must not import getJuicyAdsPageLoadAlternation or gate 1133909 behind alternation'
  );
  assert(
    publicChatSource.includes('data-testid="explore-other-chatrooms-section"') &&
      publicChatSource.includes('data-testid="chatroom-juicyads-bottom-section"') &&
      publicChatSource.includes('slotId="chatroom-juicyads-bottom"'),
    'Explore Other Chatrooms display placement (1133909) renders unconditionally below Explore Other Chatrooms'
  );
  assert.notStrictEqual(
    JUICYADS_CONFIG.floatingScriptUrl,
    JUICYADS_CONFIG.scriptUrl,
    'Floating zone 1133907 (jfc.js) and display zone 1133909 (jads.js) use distinct scripts'
  );
  console.log('✅ [PASSED] 1.1 JuicyAds floating (1133907) and display (1133909) are independently eligible on every page load');

  // Verify SSR render of CentralizedAdCoordinator renders both JuicyAds 1133907 anchor and ExoClick 6102500 on consented eligible routes
  withMockBrowserEnv('/chat', { cookie_consent_status: 'accepted' }, () => {
    const html = renderToString(
      React.createElement(
        RouterProvider,
        null,
        React.createElement(
          ConsentProvider,
          null,
          React.createElement(CentralizedAdCoordinator)
        )
      )
    );
    assert(
      html.includes('data-testid="centralized-ad-coordinator"') &&
        html.includes('data-testid="juicyads-floating-anchor"') &&
        html.includes('data-juicyads-zone="1133907"') &&
        html.includes('data-testid="exoclick-video-slider-container"'),
      'Consented /chat route mounts both JuicyAds 1133907 left anchor and ExoClick 6102500 right slider'
    );
  });

  withMockBrowserEnv('/', { cookie_consent_status: 'accepted' }, () => {
    const html = renderToString(
      React.createElement(
        RouterProvider,
        null,
        React.createElement(
          ConsentProvider,
          null,
          React.createElement(CentralizedAdCoordinator)
        )
      )
    );
    assert(
      html.includes('data-juicyads-zone="1133907"') &&
        html.includes('data-testid="exoclick-video-slider-container"'),
      'Consented / route mounts both JuicyAds 1133907 left anchor and ExoClick 6102500 right slider'
    );
  });
  console.log('✅ [PASSED] 1.2 Returning accepted visitor receives synchronous initial consent and dual-side floating coordinator');

  // -------------------------------------------------------------------------
  // 2. ExoClick Video Slider (6102500) & Horizontal VAST (6102492)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. ExoClick Video Slider (6102500) & Horizontal VAST (6102492) ---');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderZoneId, '6102500', 'Video Slider zone ID must be 6102500');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderElementClass, 'eas6a97888e38', 'Video Slider class must be eas6a97888e38');
  assert.strictEqual(EXOCLICK_CONFIG.scriptUrl, 'https://a.magsrv.com/ad-provider.js', 'Video slider uses ad-provider.js');
  const adsConfigSource = fs.readFileSync(path.resolve('src/config/adsConfig.ts'), 'utf-8');
  assert(!adsConfigSource.includes('6102494') && !adsConfigSource.includes('eas6a97888e31'), 'Stale 6102494 / eas6a97888e31 removed');
  assert(!sliderSource.includes('6102494') && !coordinatorSource.includes('6102494'), 'No stale 6102494 references in components');

  assert.strictEqual(EXOCLICK_CONFIG.horizontalVastZoneId, '6102492', 'Horizontal VAST zone ID must be 6102492');
  assert.strictEqual(
    EXOCLICK_CONFIG.horizontalVastUrl,
    'https://s.magsrv.com/v1/vast.php?idz=6102492',
    'Horizontal VAST URL matches endpoint'
  );
  assert(
    vastSource.includes('DOMParser') &&
      vastSource.includes('<video') &&
      vastSource.includes('playsInline') &&
      vastSource.includes('muted') &&
      vastSource.includes('onError') &&
      !vastSource.includes('<script src='),
    'Horizontal VAST safely parses XML and uses HTML5 video'
  );
  assert.strictEqual(isSafeHttpUrl('https://cdn.example.com/ad.mp4'), true);
  assert.strictEqual(isSafeHttpUrl('http://cdn.example.com/ad.mp4'), true);
  assert.strictEqual(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.strictEqual(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.strictEqual(isSafeHttpUrl(''), false);
  console.log('✅ [PASSED] 2.1 ExoClick 6102500 / eas6a97888e38 and Horizontal VAST 6102492 verified');

  assert(
    sliderSource.includes('fixed right-2 sm:right-4') &&
      vastSource.includes('max-w-3xl mx-auto') &&
      coordinatorSource.includes('hidden lg:block fixed left-4 bottom-4') &&
      coordinatorSource.includes('data-vx-juicy-float') &&
      indexCssSource.includes('html[data-vx-juicy-float="left"] #fadeinbox') &&
      indexCssSource.includes('left: 16px !important;') &&
      indexCssSource.includes('top: auto !important;') &&
      indexCssSource.includes('html:not([data-vx-juicy-float="left"]) #fadeinbox') &&
      indexCssSource.includes('@media (max-width: 1023px)'),
    'Dual-side CSS positioning rules for JuicyAds 1133907 LEFT and ExoClick 6102500 RIGHT intact'
  );
  console.log('✅ [PASSED] 2.2 Dual-side positioning CSS and desktop/mobile breakpoints configured');

  // -------------------------------------------------------------------------
  // 3. Consent Lifecycle: Unset / Rejected / Pre-Load / Post-Load / Withdrawal / Re-Accept / Deduplication
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Consent Initialization, Post-Load Deferral, Withdrawal & Non-Duplication ---');

  assert(
    coordinatorSource.includes("consent?.consentStatus === 'accepted'") &&
      sliderSource.includes("consent?.consentStatus === 'accepted'") &&
      vastSource.includes("consent?.consentStatus === 'accepted'") &&
      adSenseLoaderSource.includes("consent?.consentStatus === 'accepted'") &&
      adPlacementBoxSource.includes("consent?.consentStatus === 'accepted'"),
    'All ad components require accepted consent'
  );
  assert(
    consentContextSource.includes('readInitialConsentState'),
    'ConsentProvider synchronously reads persisted consent before initial paint/effects'
  );
  assert(
    !coordinatorSource.includes("new Event('load')") &&
      !coordinatorSource.includes('dispatchEvent(') &&
      !coordinatorSource.includes('location.reload'),
    'Coordinator must never dispatch synthetic window.load or force-reload the page'
  );

  // SSR checks for unset and rejected consent
  for (const state of [{}, { cookie_consent_status: 'rejected' }] as Array<Record<string, string>>) {
    withMockBrowserEnv('/chat', state, () => {
      const html = renderToString(
        React.createElement(
          RouterProvider,
          null,
          React.createElement(
            ConsentProvider,
            null,
            React.createElement(CentralizedAdCoordinator)
          )
        )
      );
      assert.strictEqual(html, '', 'Unset or rejected consent must render zero global ad DOM');
    });
  }
  // Legacy granted migration also initializes synchronously
  withMockBrowserEnv('/chat', { cookie_consent: 'granted' }, () => {
    const html = renderToString(
      React.createElement(
        RouterProvider,
        null,
        React.createElement(
          ConsentProvider,
          null,
          React.createElement(CentralizedAdCoordinator)
        )
      )
    );
    assert(html.includes('data-juicyads-zone="1133907"'), 'Legacy cookie_consent=granted initializes synchronously');
  });
  console.log('✅ [PASSED] 3.1 SSR consent gating verified for unset, rejected, accepted, and legacy granted');

  // Behavioral state machine tests for evaluateJuicyAdsFloatingState()
  const unsetDecision = evaluateJuicyAdsFloatingState({
    hasAcceptedConsent: false,
    isEligibleRoute: true,
    documentReadyState: 'loading',
  });
  assert.strictEqual(unsetDecision.shouldInjectScript, false);
  assert.strictEqual(unsetDecision.shouldSetRootLeftAttr, false);
  assert.strictEqual(unsetDecision.shouldExposeLeftAnchor, false);

  const ineligibleDecision = evaluateJuicyAdsFloatingState({
    hasAcceptedConsent: true,
    isEligibleRoute: false,
    documentReadyState: 'loading',
  });
  assert.strictEqual(ineligibleDecision.shouldInjectScript, false);
  assert.strictEqual(ineligibleDecision.shouldSetRootLeftAttr, false);
  assert.strictEqual(ineligibleDecision.shouldExposeLeftAnchor, false);

  const preLoadAccepted = evaluateJuicyAdsFloatingState({
    hasAcceptedConsent: true,
    isEligibleRoute: true,
    documentReadyState: 'interactive',
    hasExistingFadeInBox: false,
    hasExistingFloatingScript: false,
  });
  assert.strictEqual(preLoadAccepted.shouldInjectScript, true, 'Pre-load accepted initializes jfc.js');
  assert.strictEqual(preLoadAccepted.shouldSetRootLeftAttr, true);
  assert.strictEqual(preLoadAccepted.isPostLoadDeferred, false);

  const postLoadAccepted = evaluateJuicyAdsFloatingState({
    hasAcceptedConsent: true,
    isEligibleRoute: true,
    documentReadyState: 'complete',
    hasExistingFadeInBox: false,
    hasExistingFloatingScript: false,
  });
  assert.strictEqual(
    postLoadAccepted.isPostLoadDeferred,
    true,
    'Post-window.load fresh acceptance defers jfc.js cleanly instead of consuming juicy_fadedin with a broken hidden element'
  );
  assert.strictEqual(postLoadAccepted.shouldInjectScript, false);
  assert.strictEqual(postLoadAccepted.shouldSetRootLeftAttr, false);

  const reAcceptedDecision = evaluateJuicyAdsFloatingState({
    hasAcceptedConsent: true,
    isEligibleRoute: true,
    documentReadyState: 'complete',
    hasExistingFadeInBox: true,
    hasExistingFloatingScript: true,
  });
  assert.strictEqual(reAcceptedDecision.shouldExposeLeftAnchor, true);
  assert.strictEqual(reAcceptedDecision.shouldSetRootLeftAttr, true, 'Re-acceptance restores left #fadeinbox visibility');
  assert.strictEqual(reAcceptedDecision.shouldInjectScript, false, 'Re-acceptance never injects duplicate jfc.js');
  assert.strictEqual(reAcceptedDecision.isPostLoadDeferred, false);
  console.log('✅ [PASSED] 3.2 JuicyAds floating consent state transitions (pre-load, post-load deferral, withdrawal, re-accept) verified');

  // Behavioral script non-duplication check with mock document
  (() => {
    const prevDoc = (global as any).document;
    const appendedScripts: any[] = [];
    (global as any).document = {
      head: {
        appendChild: (node: any) => {
          appendedScripts.push(node);
          return node;
        },
      },
      querySelector: (selector: string) => {
        const match = appendedScripts.find((s) => `script[src="${s.src}"]` === selector);
        return match || null;
      },
      createElement: (tag: string) => ({
        tagName: tag.toUpperCase(),
        async: false,
        src: '',
        attrs: {} as Record<string, string>,
        setAttribute(k: string, v: string) {
          this.attrs[k] = v;
        },
        getAttribute(k: string) {
          return this.attrs[k] ?? null;
        },
        addEventListener() {},
        remove() {},
      }),
    };
    try {
      const s1 = ensureHeadScriptOnce(JUICYADS_CONFIG.floatingScriptUrl);
      const s2 = ensureHeadScriptOnce(JUICYADS_CONFIG.floatingScriptUrl);
      assert.strictEqual(appendedScripts.length, 1, 'ensureHeadScriptOnce must inject jfc.js at most once');
      assert.strictEqual(s1, s2, 'Repeated ensureHeadScriptOnce calls return the existing script element');
    } finally {
      (global as any).document = prevDoc;
    }
  })();
  console.log('✅ [PASSED] 3.3 ensureHeadScriptOnce prevents duplicate script injection');

  // -------------------------------------------------------------------------
  // 4. Route Exclusions: Public/Chat Eligible vs Private Account & Protected Excluded
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Global Ad Route Exclusions & AdSense Policy Separation ---');

  const eligibleRoutes = [
    '/',
    '/rooms',
    '/rooms/',
    '/chat',
    '/chat?roomId=bangla',
    '/chat/bangla',
    '/chat/indian',
    '/dating',
    '/shop',
    '/about',
    '/faq',
    '/terms',
    '/privacy',
    '/safety',
    '/forum',
    '/blog',
    '/user/public-guide', // Not all /user/* routes are excluded — only explicit private/auth routes
  ];
  for (const r of eligibleRoutes) {
    assert.strictEqual(isEligibleRouteForGlobalAds(r), true, `Eligible route ${r} must permit global ads`);
  }

  const excludedPrivateAccountRoutes = [
    '/dashboard',
    '/dashboard/',
    '/dashboard/overview',
    '/dashboard/settings?tab=privacy',
    '/user/dashboard',
    '/user/dashboard/',
    '/user/dashboard/activity#recent',
    '/profile',
    '/profile/',
    '/profile/edit?x=1',
  ];
  for (const pr of excludedPrivateAccountRoutes) {
    assert.strictEqual(
      isEligibleRouteForGlobalAds(pr),
      false,
      `Private account route ${pr} must be excluded from global ads`
    );
    withMockBrowserEnv(pr.split(/[?#]/)[0], { cookie_consent_status: 'accepted' }, () => {
      const html = renderToString(
        React.createElement(
          RouterProvider,
          null,
          React.createElement(
            ConsentProvider,
            null,
            React.createElement(CentralizedAdCoordinator)
          )
        )
      );
      assert.strictEqual(html, '', `Coordinator SSR on ${pr} must render nothing even with accepted consent`);
    });
  }

  const protectedRoutes = [
    '/age-gate',
    '/age-gate/',
    '/guest-entry',
    '/guest-entry/',
    '/register',
    '/register/',
    '/login',
    '/auth',
    '/auth/callback',
    '/user/login',
    '/user/login/',
    '/user/register',
    '/user/guest-entry',
    '/user/reset-password',
    '/user/password-reset',
    '/user/account-recovery',
    '/admin',
    '/admin/',
    '/admin/dashboard',
    '/admin/login',
    '/admin/users?page=2',
    '/moderator',
    '/moderator/',
    '/moderator/dashboard',
    '/moderator/login',
    '/checkout',
    '/checkout/step-1',
    '/payment',
    '/payment/confirm?tx=1',
  ];
  for (const pr of protectedRoutes) {
    assert.strictEqual(isEligibleRouteForGlobalAds(pr), false, `Protected route ${pr} must exclude global ads`);
    assert.strictEqual(isAdSenseExcludedRoute(pr), true, `Protected route ${pr} must exclude AdSense`);
    assert.strictEqual(isRouteExcludedFromFooterAds(pr), true, `Protected route ${pr} must exclude footer ads`);
  }

  // AdSense policy remains intact and distinct
  assert.strictEqual(isAdSenseExcludedRoute('/chat'), true);
  assert.strictEqual(isAdSenseExcludedRoute('/messages'), true);
  assert.strictEqual(isAdSenseExcludedRoute('/'), false);
  assert.strictEqual(isAdSenseExcludedRoute('/dashboard'), false, 'AdSense route exclusion list stays independent');

  console.log(
    `✅ [PASSED] 4.1 Verified ${eligibleRoutes.length} eligible routes, ${excludedPrivateAccountRoutes.length} private account routes, and ${protectedRoutes.length} protected routes`
  );

  // Member Dashboard explicit embed preserved
  const dashboardSource = fs.readFileSync(path.resolve('src/pages/MemberDashboardPage.tsx'), 'utf-8');
  assert(dashboardSource.includes('<HorizontalVastVideoAd'), 'Member Dashboard retains explicit HorizontalVastVideoAd');

  // Existing JuicyAds zones preserved
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x62, '1131763');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x262, '1131765');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner728x102, '1131766');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x112, '1131767');
  assert.strictEqual(JUICYADS_CONFIG.zones.floating, '1133907');
  assert.strictEqual(JUICYADS_CONFIG.zones.display308x298, '1133909');

  const unit308 = VERIFIED_AD_UNITS.find((u) => u.id === '1133909');
  assert(unit308 !== undefined && unit308.width === 308 && unit308.height === 298, 'Unit 1133909 registered at 308x298');
  console.log('✅ [PASSED] 4.2 All existing JuicyAds zones (1131763/1131765/1131766/1131767) and 1133907/1133909 verified');

  // -------------------------------------------------------------------------
  // 5. Chat Usability, Minimize, Dismiss, Keyboard/Private-Chat Suppression
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Chat Usability & Responsive Suppression Controls ---');
  assert(
    sliderSource.includes('88px+env(safe-area-inset-bottom,0px)') &&
      sliderSource.includes('handleDismiss') &&
      sliderSource.includes('vx_video_slider_dismissed') &&
      sliderSource.includes('toggleMinimize') &&
      sliderSource.includes("isMinimized\n              ? 'hidden'") &&
      sliderSource.includes('initializedZoneRef') &&
      sliderSource.includes('visualViewport') &&
      sliderSource.includes('hasActiveFloatingChat'),
    'ExoClick slider keeps composer lift, dismiss, minimize, deduplication, and keyboard/floating-chat suppression'
  );

  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  assert(appSource.includes('<CentralizedAdCoordinator />'), 'App.tsx mounts CentralizedAdCoordinator at root');
  console.log('✅ [PASSED] 5.1 Responsive suppression rules and App.tsx root mounting verified (code/SSR level)');

  console.log('\n================================================================');
  console.log('  ALL FINAL PHASE ADS AUDIT REMEDIATION TESTS PASSED!');
  console.log('================================================================\n');
}

runTests();
