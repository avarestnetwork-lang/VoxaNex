import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  VERIFIED_AD_UNITS,
  getAdsterraUnitForWidth,
  getProviderRotation,
  isEligibleRouteForGlobalAds,
  isAdSenseExcludedRoute,
  isRouteExcludedFromFooterAds,
} from '../src/config/adsConfig';
import { isSafeHttpUrl } from '../src/components/ads/HorizontalVastVideoAd';
import {
  ensureHeadScriptOnce,
  loadExoClickProviderScript,
  resetExoClickLoaderForTesting,
  resolveEffectiveUnitId,
  serveExoClickZones,
} from '../src/components/ads/AdPlacementBox';
import { CentralizedAdCoordinator } from '../src/components/ads/CentralizedAdCoordinator';
import { ConsentProvider } from '../src/context/ConsentContext';
import { RouterProvider } from '../src/context/RouterContext';

console.log('================================================================');
console.log('  EXOCLICK MIGRATION, RESPONSIVE VIDEO SLIDER & AD POLICY TESTS');
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

function collectFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      results.push(...collectFilesRecursive(full));
    } else if (/\.(ts|tsx|js|jsx|css|html)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

async function runTests() {
  const adsConfigSource = fs.readFileSync(path.resolve('src/config/adsConfig.ts'), 'utf-8');
  const vastSource = fs.readFileSync(path.resolve('src/components/ads/HorizontalVastVideoAd.tsx'), 'utf-8');
  const coordinatorSource = fs.readFileSync(path.resolve('src/components/ads/CentralizedAdCoordinator.tsx'), 'utf-8');
  const sliderSource = fs.readFileSync(path.resolve('src/components/ads/ExoClickVideoSlider.tsx'), 'utf-8');
  const stickySource = fs.readFileSync(path.resolve('src/components/ads/ExoClickStickyBanner.tsx'), 'utf-8');
  const adSenseLoaderSource = fs.readFileSync(path.resolve('src/components/ads/AdSenseScriptLoader.tsx'), 'utf-8');
  const adPlacementBoxSource = fs.readFileSync(path.resolve('src/components/ads/AdPlacementBox.tsx'), 'utf-8');
  const consentContextSource = fs.readFileSync(path.resolve('src/context/ConsentContext.tsx'), 'utf-8');
  const publicChatSource = fs.readFileSync(path.resolve('src/pages/PublicChatPage.tsx'), 'utf-8');
  const footerSource = fs.readFileSync(path.resolve('src/components/layout/Footer.tsx'), 'utf-8');
  const indexCssSource = fs.readFileSync(path.resolve('src/index.css'), 'utf-8');
  const indexHtmlSource = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const swSource = fs.readFileSync(path.resolve('public/sw.js'), 'utf-8');
  const mainTsxSource = fs.readFileSync(path.resolve('src/main.tsx'), 'utf-8');

  // -------------------------------------------------------------------------
  // 1. Complete Monetag & JuicyAds Removal + PWA Service Worker Preservation
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Complete Monetag & JuicyAds Removal + PWA Preservation ---');

  assert(
    !fs.existsSync(path.resolve('src/components/ads/MonetagScript.tsx')),
    'MonetagScript.tsx must be completely deleted'
  );
  assert(
    !indexHtmlSource.toLowerCase().includes('monetag') &&
      !indexHtmlSource.toLowerCase().includes('juicyads') &&
      !indexHtmlSource.includes('97a6aeec522d11d21efa5f84c86eb958') &&
      !indexHtmlSource.includes('416e702dd7d166aafe13107553d43a38'),
    'index.html has zero Monetag or JuicyAds meta tags'
  );
  assert(
    !indexCssSource.includes('fadeinbox') && !indexCssSource.toLowerCase().includes('juicyads'),
    'src/index.css has zero #fadeinbox or JuicyAds CSS rules'
  );

  // Verify Service Worker Monetag removal while strictly preserving PWA install/activate lifecycle
  assert(
    !swSource.toLowerCase().includes('monetag') &&
      !swSource.includes('5gvci.com') &&
      !swSource.includes('12241124') &&
      !swSource.includes('importScripts') &&
      swSource.includes("addEventListener('install'") &&
      swSource.includes('skipWaiting()') &&
      swSource.includes("addEventListener('activate'") &&
      swSource.includes('clients.claim()'),
    'public/sw.js removes Monetag integration while preserving PWA install, activate, skipWaiting, and clients.claim'
  );
  assert(
    !mainTsxSource.toLowerCase().includes('monetag') &&
      mainTsxSource.includes("navigator.serviceWorker.register('/sw.js'"),
    'src/main.tsx preserves PWA service worker registration without Monetag references'
  );

  const bannedPattern =
    /\b(monetag|juicyads|adsbyjuicy|juicy_adzone|fadeinbox|5gvci\.com|nap5k\.com|poweredby\.jads\.co|12241124|12241585|1133907|1133909|1131763|1131765|1131766|1131767)\b/i;
  for (const filePath of [...collectFilesRecursive(path.resolve('src')), path.resolve('index.html'), path.resolve('public/sw.js')]) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(bannedPattern);
    assert(!match, `Found prohibited Monetag/JuicyAds reference "${match?.[0]}" in ${path.relative(process.cwd(), filePath)}`);
  }
  console.log('✅ [PASSED] 1.1 Zero Monetag/JuicyAds references remain across src, index.html, and public/sw.js; PWA intact');

  // -------------------------------------------------------------------------
  // 2. Adsterra Footer-Only Preservation
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Adsterra Footer-Only Enforcement ---');

  assert(
    footerSource.includes('slotId="global-footer-responsive"') &&
      footerSource.includes("getAdsterraUnitForWidth(footerWidth, 'footer')") &&
      footerSource.includes('adUnitId={responsiveAdUnit}') &&
      getAdsterraUnitForWidth(375, 'footer') === ADSTERRA_CONFIG.banner320x50 &&
      getAdsterraUnitForWidth(1024, 'footer') === ADSTERRA_CONFIG.banner728x90 &&
      getProviderRotation('footer', false, 'global-footer-responsive').join(',') === 'adsterra' &&
      getProviderRotation('footer', true, 'global-footer-responsive').join(',') === 'adsterra',
    'Footer exclusively uses Adsterra global-footer-responsive'
  );
  for (const pageFile of ['PublicChatPage.tsx', 'BlogPage.tsx', 'ForumPage.tsx', 'MemberDashboardPage.tsx']) {
    const pageSrc = fs.readFileSync(path.resolve('src/pages', pageFile), 'utf-8');
    assert(!pageSrc.includes('ADSTERRA_CONFIG'), `${pageFile} must not reference ADSTERRA_CONFIG outside Footer`);
  }
  assert(
    resolveEffectiveUnitId({
      provider: 'adsterra',
      position: 'content-gap',
      slotId: 'blog-article-gap',
      containerWidth: 768,
      isLiveChatScreen: false,
    }) === null,
    'Adsterra is rejected in non-footer content-gap slots'
  );
  console.log('✅ [PASSED] 2.1 Adsterra remains strictly Footer-only across codebase');

  // -------------------------------------------------------------------------
  // 3. Verified ExoClick Zones (6087300, 6109952, 6102500, 6110028, 6109970, 6102494)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. ExoClick 6-Zone Configuration & Class Compatibility ---');

  assert.strictEqual(EXOCLICK_CONFIG.zoneId, '6087300');
  assert.strictEqual(EXOCLICK_CONFIG.elementClass, 'eas6a97888e2');
  assert.strictEqual(EXOCLICK_CONFIG.responsiveBannerZoneId, '6109952');
  assert.strictEqual(EXOCLICK_CONFIG.responsiveBannerElementClass, 'eas6a97888e38');
  assert.strictEqual(EXOCLICK_CONFIG.multiFormatZoneId, '6102500');
  assert.strictEqual(EXOCLICK_CONFIG.multiFormatElementClass, 'eas6a97888e38');
  assert.strictEqual(EXOCLICK_CONFIG.stickyBannerZoneId, '6110028');
  assert.strictEqual(EXOCLICK_CONFIG.stickyBannerElementClass, 'eas6a97888e17');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderZoneId, '6102494');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderElementClass, 'eas6a97888e31');
  assert.strictEqual(EXOCLICK_CONFIG.horizontalVastZoneId, '6109970');
  assert.strictEqual(EXOCLICK_CONFIG.horizontalVastUrl, 'https://s.magsrv.com/v1/vast.php?idz=6109970');
  assert.strictEqual(EXOCLICK_CONFIG.scriptUrl, 'https://a.magsrv.com/ad-provider.js');

  // Old stale VAST ID 6102492 removed
  assert(!adsConfigSource.includes('6102492'));

  // 6087300 (300x250) used for Explore Bottom & registered at 300x250; never forced into compact bars
  const unit6087300 = VERIFIED_AD_UNITS.find((u) => u.id === '6087300');
  assert(unit6087300 && unit6087300.width === 300 && unit6087300.height === 250);
  assert.strictEqual(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'bottom',
      slotId: 'chatroom-explore-bottom',
      containerWidth: 320,
      isLiveChatScreen: true,
    }),
    '6087300'
  );
  assert.strictEqual(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'sidebar-horizontal',
      slotId: 'participant-box-horizontal',
      containerWidth: 324,
      isLiveChatScreen: true,
    }),
    '6109952'
  );
  assert.strictEqual(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'top',
      slotId: 'public-chatroom-top',
      containerWidth: 768,
      isLiveChatScreen: true,
    }),
    '6109952'
  );
  assert.strictEqual(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'bottom',
      slotId: 'public-chatroom-bottom',
      containerWidth: 375,
      isLiveChatScreen: true,
    }),
    '6109952'
  );
  assert.strictEqual(
    resolveEffectiveUnitId({
      provider: 'exoclick',
      position: 'content-gap',
      slotId: 'blog-article-gap',
      containerWidth: 728,
      isLiveChatScreen: false,
    }),
    '6102500'
  );

  // VAST parser + safe HTTP URL validation
  assert(
    vastSource.includes('DOMParser') &&
      vastSource.includes('<video') &&
      vastSource.includes('playsInline') &&
      vastSource.includes('muted') &&
      vastSource.includes('onError') &&
      !vastSource.includes('<script src='),
    'Horizontal VAST safely parses XML and uses isolated HTML5 video'
  );
  assert.strictEqual(isSafeHttpUrl('https://cdn.example.com/ad.mp4'), true);
  assert.strictEqual(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.strictEqual(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);

  // Verify DOM verification file for ExoClick domain ownership remains intact
  assert(fs.existsSync(path.resolve('public/28befc4532cb8837aa59edffca607a5a.html')));
  console.log('✅ [PASSED] 3.1 All 6 ExoClick zones (6102494, 6102500, 6109952, 6110028, 6109970, 6087300) verified');

  // -------------------------------------------------------------------------
  // 4. SSR Render: CentralizedAdCoordinator (Slider 6102494 + Sticky 6110028) & Consent
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Consent Gating, Coordinator SSR & Route Exclusions ---');

  assert(
    sliderSource.includes("consent?.consentStatus === 'accepted'") &&
      stickySource.includes("consent?.consentStatus === 'accepted'") &&
      vastSource.includes("consent?.consentStatus === 'accepted'") &&
      adSenseLoaderSource.includes("consent?.consentStatus === 'accepted'") &&
      adPlacementBoxSource.includes("consent?.consentStatus === 'accepted'"),
    'All ad components require accepted consent'
  );
  assert(consentContextSource.includes('readInitialConsentState'), 'Synchronous persisted consent initialization preserved');

  for (const state of [{}, { cookie_consent_status: 'rejected' }] as Array<Record<string, string>>) {
    withMockBrowserEnv('/chat', state, () => {
      const html = renderToString(
        React.createElement(
          RouterProvider,
          null,
          React.createElement(ConsentProvider, null, React.createElement(CentralizedAdCoordinator))
        )
      );
      assert.strictEqual(html, '', 'Unset or rejected consent renders zero global ad DOM');
    });
  }

  for (const route of ['/chat', '/']) {
    withMockBrowserEnv(route, { cookie_consent_status: 'accepted' }, () => {
      const html = renderToString(
        React.createElement(
          RouterProvider,
          null,
          React.createElement(ConsentProvider, null, React.createElement(CentralizedAdCoordinator))
        )
      );
      assert(
        html.includes('data-testid="centralized-ad-coordinator"') &&
          html.includes('data-testid="exoclick-video-slider-container"') &&
          html.includes('data-exoclick-zone="6102494"') &&
          html.includes('data-exoclick-class="eas6a97888e31"') &&
          html.includes('data-testid="exoclick-sticky-banner-container"') &&
          html.includes('data-exoclick-zone="6110028"'),
        `Consented ${route} mounts ExoClick Video Slider (6102494) and Sticky Banner (6110028)`
      );
    });
  }

  // Video-call routes (/av-chat, /chat/video) must suppress floating Slider & Sticky Banner for strict player isolation
  for (const videoRoute of ['/av-chat', '/chat/video']) {
    withMockBrowserEnv(videoRoute, { cookie_consent_status: 'accepted' }, () => {
      const html = renderToString(
        React.createElement(
          RouterProvider,
          null,
          React.createElement(ConsentProvider, null, React.createElement(CentralizedAdCoordinator))
        )
      );
      assert(
        !html.includes('exoclick-video-slider-container') &&
          !html.includes('exoclick-sticky-banner-container'),
        `Video call route ${videoRoute} suppresses floating video slider and sticky banner to isolate user webcam player`
      );
    });
  }

  // Protected & private account routes suppress global coordinator
  for (const excluded of ['/dashboard', '/user/dashboard', '/profile', '/login', '/admin', '/checkout']) {
    assert.strictEqual(isEligibleRouteForGlobalAds(excluded), false);
    withMockBrowserEnv(excluded, { cookie_consent_status: 'accepted' }, () => {
      const html = renderToString(
        React.createElement(
          RouterProvider,
          null,
          React.createElement(ConsentProvider, null, React.createElement(CentralizedAdCoordinator))
        )
      );
      assert.strictEqual(html, '', `Excluded route ${excluded} renders zero coordinator DOM`);
    });
  }

  assert.strictEqual(isAdSenseExcludedRoute('/chat'), true);
  assert.strictEqual(isAdSenseExcludedRoute('/'), false);
  assert.strictEqual(isRouteExcludedFromFooterAds('/login'), true);
  assert.strictEqual(isRouteExcludedFromFooterAds('/chat'), false);
  console.log('✅ [PASSED] 4.1 Consent gating, route exclusions, and SSR isolation verified');

  // -------------------------------------------------------------------------
  // 5. Responsive Video Slider (6102494), Sticky Banner (6110028) & User Video Isolation
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Responsive Video Slider, Sticky Banner & Call Player Isolation ---');

  assert(
    sliderSource.includes('88px+env(safe-area-inset-bottom,0px)') &&
      sliderSource.includes('w-[min(288px,calc(100vw-16px))] sm:w-[300px] lg:w-[320px]') &&
      !sliderSource.includes('min-h-[160px] h-[180px]') &&
      sliderSource.includes('hasFilledCreative') &&
      sliderSource.includes('isVisuallyCollapsed') &&
      sliderSource.includes('serveExoClickZones') &&
      sliderSource.includes('orientationchange') &&
      sliderSource.includes('visualViewport') &&
      sliderSource.includes('hasLiveCall') &&
      sliderSource.includes('hasActiveFloatingChat') &&
      sliderSource.includes('handleDismiss') &&
      sliderSource.includes('vx_video_slider_dismissed') &&
      sliderSource.includes('toggleMinimize') &&
      sliderSource.includes('initializedZoneRef') &&
      indexCssSource.includes('[data-testid="exoclick-video-slider-host"] [id*="-msg-video-slider-content"]'),
    'ExoClick Video Slider (6102494 / eas6a97888e31) adapts across 320px-1920px, collapses when unfilled, and maintains call/chat/keyboard isolation'
  );

  assert(
    stickySource.includes('vx_sticky_banner_dismissed') &&
      stickySource.includes('handleDismiss') &&
      stickySource.includes('winW < 1024 || winH < 580') &&
      stickySource.includes('hasLiveCall') &&
      indexCssSource.includes('[data-testid="exoclick-sticky-banner-container"] [id*="msg-sticky-container"]') &&
      indexCssSource.includes('z-index: 38 !important') &&
      indexCssSource.includes('@media (max-width: 1023px), (max-height: 579px)'),
    'ExoClick Sticky Banner (6110028) is safe-area anchored, dismissible, capped below modals/calls, and suppressed on compact/mobile viewports'
  );

  // Verify CallContext, VoiceWebcamPage, SecureMediaRenderer, ComposerAttachmentPreview contain zero ad injections
  for (const playerFile of [
    'src/pages/VoiceWebcamPage.tsx',
    'src/components/chat/SecureMediaRenderer.tsx',
    'src/components/chat/ComposerAttachmentPreview.tsx',
  ]) {
    const src = fs.readFileSync(path.resolve(playerFile), 'utf-8');
    assert(!src.includes('magsrv') && !src.includes('AdPlacementBox') && !src.includes('vast.php'), `${playerFile} must have zero ad/VAST injection`);
  }
  const callContextSrc = fs.readFileSync(path.resolve('src/context/CallContext.tsx'), 'utf-8');
  assert(
    callContextSrc.includes('data-vx-call-active') &&
      callContextSrc.includes('z-[80]') &&
      !callContextSrc.includes('vast.php'),
    'CallContext elevates live WebRTC call modal above ads and broadcasts data-vx-call-active'
  );

  // -------------------------------------------------------------------------
  // 6. Single-Flight ExoClick Loader Concurrency, Multi-Zone & Error Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 6. ExoClick Single-Flight Loader Concurrency & Remount Safety ---');

  const createMockDomHarness = (initialAdProvider: any = []) => {
    const appendedScripts: any[] = [];
    const registeredIns: any[] = [];
    const listenerCounts = new WeakMap<any, Record<string, number>>();
    const dispatchedPayloads: any[] = [];

    const createIns = (zoneId: string, elementClass: string, connected = true) => {
      const attrs: Record<string, string> = {
        class: elementClass,
        'data-zoneid': zoneId,
      };
      const node: any = {
        tagName: 'INS',
        isConnected: connected,
        setAttribute(k: string, v: string) {
          attrs[k] = String(v);
        },
        getAttribute(k: string) {
          return attrs[k] ?? null;
        },
        hasAttribute(k: string) {
          return Object.prototype.hasOwnProperty.call(attrs, k);
        },
      };
      registeredIns.push(node);
      return node;
    };

    const doc: any = {
      head: {
        appendChild(node: any) {
          appendedScripts.push(node);
          return node;
        },
      },
      querySelector(selector: string) {
        return appendedScripts.find((s) => `script[src="${s.src}"]` === selector) || null;
      },
      querySelectorAll(selector: string) {
        if (selector === 'ins[data-zoneid]') {
          return registeredIns.filter((n) => n.isConnected !== false);
        }
        return [];
      },
      createElement(tag: string) {
        const attrs: Record<string, string> = {};
        const listeners: Record<string, Array<() => void>> = {};
        const counts: Record<string, number> = { load: 0, error: 0 };
        const el: any = {
          tagName: tag.toUpperCase(),
          async: false,
          src: '',
          setAttribute(k: string, v: string) {
            attrs[k] = String(v);
          },
          getAttribute(k: string) {
            return attrs[k] ?? null;
          },
          addEventListener(type: string, cb: () => void) {
            listeners[type] = listeners[type] || [];
            listeners[type].push(cb);
            counts[type] = (counts[type] || 0) + 1;
          },
          trigger(type: 'load' | 'error') {
            for (const cb of listeners[type] || []) cb();
          },
          remove() {
            const idx = appendedScripts.indexOf(el);
            if (idx !== -1) appendedScripts.splice(idx, 1);
          },
        };
        listenerCounts.set(el, counts);
        return el;
      },
    };

    const win: any = {
      AdProvider: initialAdProvider,
    };

    const installExoClickRuntimeOnWindow = () => {
      win.AdProvider = {
        push(payload: any) {
          dispatchedPayloads.push(payload);
          for (const node of registeredIns) {
            if (node.isConnected !== false && !node.hasAttribute('data-processed')) {
              node.setAttribute('data-processed', 'true');
            }
          }
        },
      };
    };

    return {
      win,
      doc,
      appendedScripts,
      registeredIns,
      listenerCounts,
      dispatchedPayloads,
      createIns,
      installExoClickRuntimeOnWindow,
    };
  };

  // 6.1 Concurrent cold-load mounts share ONE <script>, ONE load/error listener pair,
  //     NEVER double-push before+after load, and coalesce into ONE serve batch for multiple zones
  {
    const prevDoc = (global as any).document;
    const prevWin = (global as any).window;
    const h = createMockDomHarness([]);
    (global as any).window = h.win;
    (global as any).document = h.doc;
    resetExoClickLoaderForTesting();

    try {
      const insSlider = h.createIns('6102494', 'eas6a97888e31');
      const insSticky = h.createIns('6110028', 'eas6a97888e17');
      const insTopBanner = h.createIns('6109952', 'eas6a97888e38');

      // Concurrent shared script loader promises must be the exact same in-flight promise
      const pLoad1 = loadExoClickProviderScript();
      const pLoad2 = loadExoClickProviderScript();
      assert.strictEqual(pLoad1, pLoad2, 'Concurrent callers share identical in-flight script Promise');
      assert.strictEqual(h.appendedScripts.length, 1, 'Provider script inserted only once');

      // Nothing blindly pushed to pre-load array before script load completes
      assert.strictEqual(h.win.AdProvider.length, 0, 'Zero blind pre-load { serve: {} } pushes queued before load');

      const s1 = ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl);
      const s2 = ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl);
      assert.strictEqual(s1, s2);
      assert.strictEqual(h.appendedScripts.length, 1);

      const pServe1 = serveExoClickZones({ element: insSlider, isStillValid: () => true });
      const pServe2 = serveExoClickZones({ element: insSticky, isStillValid: () => true });
      const pServe3 = serveExoClickZones({ element: insTopBanner, isStillValid: () => true });

      const counts = h.listenerCounts.get(h.appendedScripts[0])!;
      assert.strictEqual(counts.load, 1, 'Only ONE load listener attached to provider script');
      assert.strictEqual(counts.error, 1, 'Only ONE error listener attached to provider script');

      h.installExoClickRuntimeOnWindow();
      h.appendedScripts[0].trigger('load');

      const results = await Promise.all([pLoad1, pLoad2, pServe1, pServe2, pServe3]);
      assert.deepStrictEqual(results, [true, true, true, true, true]);
      assert.strictEqual(h.dispatchedPayloads.length, 1, 'Concurrent batch served cleanly in ONE AdProvider.push call');
      assert.strictEqual(insSlider.getAttribute('data-processed'), 'true');
      assert.strictEqual(insSticky.getAttribute('data-processed'), 'true');
      assert.strictEqual(insTopBanner.getAttribute('data-processed'), 'true');

      // 6.2 Subsequent legitimate zone mounts later while earlier zones stay valid
      const insMultiFormat = h.createIns('6102500', 'eas6a97888e38');
      const lateServed = await serveExoClickZones({ element: insMultiFormat, isStillValid: () => true });
      assert.strictEqual(lateServed, true);
      assert.strictEqual(h.dispatchedPayloads.length, 2, 'Subsequent legitimate zone initializes cleanly');
      assert.strictEqual(insMultiFormat.getAttribute('data-processed'), 'true');
      assert.strictEqual(h.appendedScripts.length, 1, 'Script tag still appears only once');

      // 6.3 Duplicate serve call on already-processed zone does not re-fire
      const dupServed = await serveExoClickZones({ element: insSlider, isStillValid: () => true });
      assert.strictEqual(dupServed, false);
      assert.strictEqual(h.dispatchedPayloads.length, 2, 'Already-processed zone is not re-served');
    } finally {
      resetExoClickLoaderForTesting();
      (global as any).document = prevDoc;
      (global as any).window = prevWin;
    }
  }

  // 6.4 React StrictMode / unmounted & remounted safety
  {
    const prevDoc = (global as any).document;
    const prevWin = (global as any).window;
    const h = createMockDomHarness();
    h.installExoClickRuntimeOnWindow();
    (global as any).window = h.win;
    (global as any).document = h.doc;
    resetExoClickLoaderForTesting();

    try {
      // Pre-loaded runtime before component mounts -> zero <script> insertion
      const staleIns = h.createIns('6109952', 'eas6a97888e38', false); // detached on StrictMode cleanup
      let attemptValid1 = false;
      const freshIns = h.createIns('6109952', 'eas6a97888e38', true);

      const r1 = serveExoClickZones({ element: staleIns, isStillValid: () => attemptValid1 });
      const r2 = serveExoClickZones({ element: freshIns, isStillValid: () => true });
      const [res1, res2] = await Promise.all([r1, r2]);

      assert.strictEqual(res1, false, 'Invalidated/detached StrictMode mount is skipped');
      assert.strictEqual(res2, true, 'Active remount is served cleanly');
      assert.strictEqual(h.appendedScripts.length, 0, 'Pre-loaded runtime does not insert redundant script');
      assert.strictEqual(h.dispatchedPayloads.length, 1, 'Only ONE serve dispatched across StrictMode double-mount');
    } finally {
      resetExoClickLoaderForTesting();
      (global as any).document = prevDoc;
      (global as any).window = prevWin;
    }
  }

  // 6.5 Script load failure & blocked AdProvider stub handling
  {
    const prevDoc = (global as any).document;
    const prevWin = (global as any).window;
    const h = createMockDomHarness([]);
    (global as any).window = h.win;
    (global as any).document = h.doc;
    resetExoClickLoaderForTesting();

    try {
      const insEl = h.createIns('6102494', 'eas6a97888e31');
      let errorCount = 0;
      const pErr = serveExoClickZones({
        element: insEl,
        isStillValid: () => true,
        onScriptError: () => {
          errorCount += 1;
        },
      });
      h.appendedScripts[0].trigger('error');
      const servedAfterError = await pErr;
      assert.strictEqual(servedAfterError, false);
      assert.strictEqual(errorCount, 1, 'Script error invokes onScriptError safely once');
      assert.strictEqual(h.dispatchedPayloads.length, 0);

      // Simulate blocked/empty 200 script (load fires, but window.AdProvider remains an Array)
      const pBlocked = serveExoClickZones({
        element: insEl,
        isStillValid: () => true,
        onScriptError: () => {
          errorCount += 1;
        },
      });
      assert.strictEqual(h.appendedScripts.length, 1, 'Errored script replaced cleanly on explicit next mount');
      h.appendedScripts[0].trigger('load'); // AdProvider still uninitialized Array!
      const servedAfterBlock = await pBlocked;
      assert.strictEqual(servedAfterBlock, false);
      assert.strictEqual(errorCount, 2, 'Blocked/empty script stub triggers onScriptError instead of fake success');
    } finally {
      resetExoClickLoaderForTesting();
      (global as any).document = prevDoc;
      (global as any).window = prevWin;
    }
  }

  const dashboardSource = fs.readFileSync(path.resolve('src/pages/MemberDashboardPage.tsx'), 'utf-8');
  assert(dashboardSource.includes('<HorizontalVastVideoAd'), 'Member Dashboard retains explicit HorizontalVastVideoAd');

  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  assert(appSource.includes('<CentralizedAdCoordinator />'), 'App.tsx mounts CentralizedAdCoordinator at root');

  console.log('✅ [PASSED] 5.1 Responsive slider/sticky rules, user video isolation, and script deduplication verified');
  console.log('✅ [PASSED] 6.1 ExoClick single-flight concurrency, StrictMode remounts, multi-zone, and error tests verified');
  console.log('\n================================================================');
  console.log('  ALL EXOCLICK MIGRATION & RESPONSIVE SLIDER TESTS PASSED!');
  console.log('================================================================\n');
}

void runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
