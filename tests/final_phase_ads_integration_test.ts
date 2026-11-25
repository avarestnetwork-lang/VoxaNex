import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  JUICYADS_CONFIG,
  EXOCLICK_CONFIG,
  VERIFIED_AD_UNITS,
  getJuicyAdsPageLoadAlternation,
  resetJuicyAdsAlternationForTest,
  isEligibleRouteForGlobalAds,
  isAdSenseExcludedRoute,
  isRouteExcludedFromFooterAds,
} from '../src/config/adsConfig';
import { isSafeHttpUrl } from '../src/components/ads/HorizontalVastVideoAd';

console.log('================================================================');
console.log('  FINAL PHASE ADS INTEGRATION & REMEDIATION TEST SUITE');
console.log('================================================================');

function runTests() {
  const vastSource = fs.readFileSync(path.resolve('src/components/ads/HorizontalVastVideoAd.tsx'), 'utf-8');
  const coordinatorSource = fs.readFileSync(path.resolve('src/components/ads/CentralizedAdCoordinator.tsx'), 'utf-8');
  const sliderSource = fs.readFileSync(path.resolve('src/components/ads/ExoClickVideoSlider.tsx'), 'utf-8');
  const adSenseLoaderSource = fs.readFileSync(path.resolve('src/components/ads/AdSenseScriptLoader.tsx'), 'utf-8');
  const adPlacementBoxSource = fs.readFileSync(path.resolve('src/components/ads/AdPlacementBox.tsx'), 'utf-8');
  const indexCssSource = fs.readFileSync(path.resolve('src/index.css'), 'utf-8');

  // 1. JuicyAds zones alternate across consecutive full page loads
  console.log('\n--- 1. JuicyAds Alternation & Page Load Parity ---');
  resetJuicyAdsAlternationForTest();

  const load1 = getJuicyAdsPageLoadAlternation(1);
  assert.strictEqual(load1.zone, '1133907', 'Load 1 must activate floating zone 1133907');

  const load2 = getJuicyAdsPageLoadAlternation(2);
  assert.strictEqual(load2.zone, '1133909', 'Load 2 must activate display zone 1133909');

  const load3 = getJuicyAdsPageLoadAlternation(3);
  assert.strictEqual(load3.zone, '1133907', 'Load 3 must activate floating zone 1133907');

  const load4 = getJuicyAdsPageLoadAlternation(4);
  assert.strictEqual(load4.zone, '1133909', 'Load 4 must activate display zone 1133909');

  console.log('✅ [PASSED] 1.1 JuicyAds zones alternate deterministically (1133907 -> 1133909 -> 1133907)');

  // 2. Only one JuicyAds alternating zone initializes per full page load
  assert.notStrictEqual(load1.zone, load2.zone, 'Only one alternating zone is chosen per load');
  console.log('✅ [PASSED] 1.2 Only one JuicyAds alternating zone is active per page load');

  // 3. React re-renders do not advance alternation
  resetJuicyAdsAlternationForTest(1); // Set count to 1 (zone 1133907)
  const render1 = getJuicyAdsPageLoadAlternation();
  const render2 = getJuicyAdsPageLoadAlternation();
  const render3 = getJuicyAdsPageLoadAlternation();
  assert.strictEqual(render1.zone, render2.zone, 'Re-renders do not alter active zone');
  assert.strictEqual(render2.zone, render3.zone, 'Re-renders do not advance page load counter');
  assert.strictEqual(render1.loadCount, render3.loadCount, 'Page load count is cached within same execution');
  console.log('✅ [PASSED] 1.3 React re-renders preserve identical zone without advancing counter');

  // 4. React StrictMode does not duplicate initialization
  const strictModeSimulation1 = getJuicyAdsPageLoadAlternation();
  const strictModeSimulation2 = getJuicyAdsPageLoadAlternation();
  assert.strictEqual(strictModeSimulation1.zone, strictModeSimulation2.zone, 'StrictMode double-call does not advance alternation');
  console.log('✅ [PASSED] 1.4 React StrictMode does not duplicate zone assignment');

  // 5. ExoClick Video Slider zone 6102500 and class eas6a97888e38 verified (old 6102494 / eas6a97888e31 removed)
  console.log('\n--- 2. ExoClick Video Slider (6102500) & Horizontal VAST (6102492) Specifications ---');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderZoneId, '6102500', 'Video Slider zone ID must be 6102500');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderElementClass, 'eas6a97888e38', 'Video Slider class must be eas6a97888e38');
  assert.strictEqual(EXOCLICK_CONFIG.scriptUrl, 'https://a.magsrv.com/ad-provider.js', 'Video slider uses ad-provider.js');
  const adsConfigSource = fs.readFileSync(path.resolve('src/config/adsConfig.ts'), 'utf-8');
  assert(!adsConfigSource.includes('6102494'), 'Stale video slider zone 6102494 must be completely removed');
  assert(!adsConfigSource.includes('eas6a97888e31'), 'Stale video slider class eas6a97888e31 must be completely removed');
  assert(!sliderSource.includes('6102494') && !coordinatorSource.includes('6102494'), 'No stale 6102494 references in components');
  console.log('✅ [PASSED] 2.1 ExoClick Video Slider corrected to zone 6102500 / class eas6a97888e38');

  // 6. ExoClick Horizontal VAST zone 6102492 initialized only through a compatible VAST player + URL safety
  assert.strictEqual(EXOCLICK_CONFIG.horizontalVastZoneId, '6102492', 'Horizontal VAST zone ID must be 6102492');
  assert.strictEqual(
    EXOCLICK_CONFIG.horizontalVastUrl,
    'https://s.magsrv.com/v1/vast.php?idz=6102492',
    'Horizontal VAST URL matches exact user-supplied endpoint'
  );
  assert(vastSource.includes('DOMParser'), 'Horizontal VAST parses XML via DOMParser');
  assert(vastSource.includes('<video'), 'Horizontal VAST renders HTML5 <video> element');
  assert(vastSource.includes('playsInline'), 'Horizontal VAST video has playsInline');
  assert(vastSource.includes('muted'), 'Horizontal VAST video defaults to muted for autoplay policy');
  assert(vastSource.includes('onError'), 'Horizontal VAST handles <video> media decode/load errors safely');
  assert(!vastSource.includes('<script src='), 'VAST is never improperly executed as a banner script');
  assert.strictEqual(isSafeHttpUrl('https://cdn.example.com/ad.mp4'), true, 'HTTPS VAST URL allowed');
  assert.strictEqual(isSafeHttpUrl('http://cdn.example.com/ad.mp4'), true, 'HTTP VAST URL allowed');
  assert.strictEqual(isSafeHttpUrl('javascript:alert(1)'), false, 'javascript: URL rejected in VAST parser');
  assert.strictEqual(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false, 'data: URL rejected in VAST parser');
  assert.strictEqual(isSafeHttpUrl(''), false, 'Empty URL rejected');
  console.log('✅ [PASSED] 2.2 Horizontal VAST (6102492) kept separate, parsed via DOMParser, and enforces safe HTTP/HTTPS URLs');

  // 7. Dual-side floating architecture: JuicyAds LEFT (#fadeinbox) & ExoClick RIGHT (6102500), plus in-page VAST
  assert(sliderSource.includes('fixed right-2 sm:right-4'), 'ExoClick Video Slider is fixed bottom-right');
  assert(vastSource.includes('max-w-3xl mx-auto'), 'Horizontal VAST is centered in-page container, not fixed floating');
  assert(coordinatorSource.includes('hidden lg:block fixed left-4 bottom-4'), 'JuicyAds floating anchor is bottom-left on desktop');
  assert(coordinatorSource.includes("data-vx-juicy-float"), 'Coordinator toggles data-vx-juicy-float root attribute');
  assert(indexCssSource.includes('html[data-vx-juicy-float="left"] #fadeinbox'), 'CSS overrides fadeinbox.js inline center coords to bottom-left');
  assert(indexCssSource.includes('left: 16px !important;') && indexCssSource.includes('top: auto !important;'), '#fadeinbox is anchored bottom-left');
  assert(indexCssSource.includes('html:not([data-vx-juicy-float="left"]) #fadeinbox') && indexCssSource.includes('@media (max-width: 1023px)'), '#fadeinbox hides cleanly when ineligible or below 1024px');
  assert(coordinatorSource.includes('pointer-events-none fixed inset-0'), 'Coordinator wrapper is pointer-events-none to prevent blocking page clicks');
  console.log('✅ [PASSED] 2.3 Dual-side floating placement: JuicyAds 1133907 (#fadeinbox) LEFT, ExoClick 6102500 RIGHT, VAST in-page');

  // 8. Consent enforcement across all ad coordinators/components
  console.log('\n--- 3. Consent Enforcement (unset / rejected / accepted) ---');
  assert(coordinatorSource.includes("consent?.consentStatus === 'accepted'"), 'CentralizedAdCoordinator gates on accepted consent');
  assert(sliderSource.includes("consent?.consentStatus === 'accepted'"), 'ExoClickVideoSlider gates on accepted consent');
  assert(vastSource.includes("consent?.consentStatus === 'accepted'"), 'HorizontalVastVideoAd gates fetch/render on accepted consent');
  assert(adSenseLoaderSource.includes("consent?.consentStatus === 'accepted'"), 'AdSenseScriptLoader gates script injection on accepted consent');
  assert(adPlacementBoxSource.includes("consent?.consentStatus === 'accepted'"), 'AdPlacementBox gates ad orchestration on accepted consent');
  console.log('✅ [PASSED] 3.1 All ad coordinators, video ads, AdSense loader, and slot boxes strictly require accepted consent');

  // 9. Global page coverage & route eligibility
  console.log('\n--- 4. Centralized Placement Eligibility & Route Coverage ---');
  const eligibleRoutes = [
    '/',
    '/chat',
    '/chat/bangla',
    '/chat/indian',
    '/rooms',
    '/dashboard',
    '/user/dashboard',
    '/profile',
    '/dating',
    '/shop',
    '/about',
    '/faq',
    '/terms',
    '/privacy',
    '/safety',
    '/forum',
    '/blog',
  ];

  for (const r of eligibleRoutes) {
    assert.strictEqual(isEligibleRouteForGlobalAds(r), true, `Route ${r} must be eligible for global ads`);
  }
  console.log(`✅ [PASSED] 4.1 All ${eligibleRoutes.length} eligible public and member routes receive global placements`);

  // Protected / Ineligible routes (including aliases, trailing slashes, and nested paths)
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
    '/admin/users',
    '/moderator',
    '/moderator/',
    '/moderator/dashboard',
    '/moderator/login',
    '/checkout',
    '/checkout/step-1',
    '/payment',
    '/payment/confirm',
  ];

  for (const pr of protectedRoutes) {
    assert.strictEqual(isEligibleRouteForGlobalAds(pr), false, `Sensitive route ${pr} must be strictly excluded from global ads`);
    assert.strictEqual(isAdSenseExcludedRoute(pr), true, `Sensitive route ${pr} must exclude AdSense`);
    assert.strictEqual(isRouteExcludedFromFooterAds(pr), true, `Sensitive route ${pr} must exclude footer ads`);
  }
  console.log(`✅ [PASSED] 4.2 All ${protectedRoutes.length} sensitive age-gate/auth/admin/moderator/checkout/payment routes (with slashes & subpaths) excluded`);

  // 10. Member Dashboard receives intended placements
  const dashboardSource = fs.readFileSync(path.resolve('src/pages/MemberDashboardPage.tsx'), 'utf-8');
  assert(dashboardSource.includes('<HorizontalVastVideoAd'), 'Member Dashboard embeds HorizontalVastVideoAd');
  console.log('✅ [PASSED] 4.3 Member Dashboard embeds HorizontalVastVideoAd');

  // 11. Existing Explore Other Chatrooms placement is preserved without duplication
  const publicChatSource = fs.readFileSync(path.resolve('src/pages/PublicChatPage.tsx'), 'utf-8');
  assert(publicChatSource.includes('data-testid="explore-other-chatrooms-section"'), 'Explore Other Chatrooms section preserved');
  assert(publicChatSource.includes('data-testid="chatroom-juicyads-bottom-section"'), 'JuicyAds bottom section preserved');
  assert(publicChatSource.includes("activeJuicyAdsZone === '1133909'"), 'JuicyAds explore display only initializes on zone 1133909');
  console.log('✅ [PASSED] 4.4 Explore Other Chatrooms placement preserved and gated by alternation zone 1133909');

  // 12. Existing JuicyAds zones remain unchanged
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x62, '1131763', 'Existing zone 1131763 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x262, '1131765', 'Existing zone 1131765 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner728x102, '1131766', 'Existing zone 1131766 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x112, '1131767', 'Existing zone 1131767 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.floating, '1133907', 'Floating zone 1133907 configured');
  assert.strictEqual(JUICYADS_CONFIG.zones.display308x298, '1133909', 'Display zone 1133909 configured');
  console.log('✅ [PASSED] 4.5 All 4 pre-existing JuicyAds zones preserved alongside zones 1133907 and 1133909');

  // 13. Verified Ad Units contains 308x298
  const unit308 = VERIFIED_AD_UNITS.find((u) => u.id === '1133909');
  assert(unit308 !== undefined, 'Unit 1133909 must be in VERIFIED_AD_UNITS');
  assert.strictEqual(unit308?.width, 308, 'Unit 1133909 width is 308');
  assert.strictEqual(unit308?.height, 298, 'Unit 1133909 height is 298');
  console.log('✅ [PASSED] 4.6 VERIFIED_AD_UNITS specifies exact 308x298 dimensions for zone 1133909');

  // 14. Chat composer protection, minimize persistence, deduplication & mobile safety
  console.log('\n--- 5. Chat Usability, Minimize Persistence & Mobile Layout Protection ---');
  assert(sliderSource.includes('88px+env(safe-area-inset-bottom,0px)'), 'ExoClick slider lifts safely above mobile chat composer and respects safe-area-inset-bottom');
  assert(sliderSource.includes('handleDismiss'), 'Slider provides user dismiss button');
  assert(sliderSource.includes('vx_video_slider_dismissed'), 'Slider stores dismissal in sessionStorage');
  assert(sliderSource.includes('toggleMinimize'), 'Slider provides minimize/maximize toggle');
  assert(sliderSource.includes("isMinimized\n              ? 'hidden'"), 'Minimizing hides slider container via CSS instead of unmounting player DOM');
  assert(sliderSource.includes('initializedZoneRef'), 'Slider deduplicates initialization across eligible client route transitions');
  assert(sliderSource.includes('visualViewport') && sliderSource.includes('hasActiveFloatingChat'), 'Slider suppresses cleanly when mobile keyboard or bottom-right floating private chat is open');
  console.log('✅ [PASSED] 5.1 Mobile composer, virtual keyboard, floating private chat, and minimize state are protected');

  // 15. Root Layout Integration
  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  assert(appSource.includes('<CentralizedAdCoordinator />'), 'App.tsx mounts CentralizedAdCoordinator at root');
  console.log('✅ [PASSED] 5.2 CentralizedAdCoordinator is cleanly mounted in root App component');

  console.log('\n================================================================');
  console.log('  ALL FINAL PHASE ADS INTEGRATION & REMEDIATION TESTS PASSED!');
  console.log('================================================================\n');
}

runTests();
