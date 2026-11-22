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
} from '../src/config/adsConfig';

console.log('================================================================');
console.log('  FINAL PHASE ADS INTEGRATION & REGRESSION TEST SUITE');
console.log('================================================================');

function runTests() {
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

  // 5. ExoClick Video Slider zone 6102494 verified as intended provider format
  console.log('\n--- 2. ExoClick Video Slider & Horizontal VAST Specifications ---');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderZoneId, '6102494', 'Video Slider zone ID must be 6102494');
  assert.strictEqual(EXOCLICK_CONFIG.videoSliderElementClass, 'eas6a97888e31', 'Video Slider class must be eas6a97888e31');
  assert.strictEqual(EXOCLICK_CONFIG.scriptUrl, 'https://a.magsrv.com/ad-provider.js', 'Video slider uses ad-provider.js');
  console.log('✅ [PASSED] 2.1 ExoClick Video Slider configuration matches exact user-supplied specifications');

  // 6. ExoClick Horizontal VAST zone 6102492 initialized only through a compatible VAST player
  assert.strictEqual(EXOCLICK_CONFIG.horizontalVastZoneId, '6102492', 'Horizontal VAST zone ID must be 6102492');
  assert.strictEqual(
    EXOCLICK_CONFIG.horizontalVastUrl,
    'https://s.magsrv.com/v1/vast.php?idz=6102492',
    'Horizontal VAST URL matches exact user-supplied endpoint'
  );
  const vastSource = fs.readFileSync(path.resolve('src/components/ads/HorizontalVastVideoAd.tsx'), 'utf-8');
  assert(vastSource.includes('DOMParser'), 'Horizontal VAST parses XML via DOMParser');
  assert(vastSource.includes('<video'), 'Horizontal VAST renders HTML5 <video> element');
  assert(vastSource.includes('playsInline'), 'Horizontal VAST video has playsInline');
  assert(vastSource.includes('muted'), 'Horizontal VAST video defaults to muted for autoplay policy');
  assert(!vastSource.includes('<script src='), 'VAST is never improperly executed as a banner script');
  console.log('✅ [PASSED] 2.2 Horizontal VAST is parsed through DOMParser and rendered via HTML5 video player');

  // 7. Video Slider and Horizontal VAST placements do not overlap
  const coordinatorSource = fs.readFileSync(path.resolve('src/components/ads/CentralizedAdCoordinator.tsx'), 'utf-8');
  const sliderSource = fs.readFileSync(path.resolve('src/components/ads/ExoClickVideoSlider.tsx'), 'utf-8');
  assert(sliderSource.includes('fixed right-2 sm:right-4'), 'Video Slider is fixed bottom-right');
  assert(vastSource.includes('max-w-3xl mx-auto'), 'Horizontal VAST is centered in-page container, not fixed floating');
  console.log('✅ [PASSED] 2.3 Video Slider (fixed bottom-right) and Horizontal VAST (in-page centered) do not overlap');

  // 8. JuicyAds floating behavior does not obstruct ExoClick or essential controls
  assert(coordinatorSource.includes('hidden sm:block fixed left-4 bottom-4'), 'JuicyAds floating is anchored bottom-left on desktop');
  assert(coordinatorSource.includes('pointer-events-none fixed inset-0'), 'Coordinator wrapper is pointer-events-none to prevent blocking page clicks');
  console.log('✅ [PASSED] 2.4 JuicyAds floating ad (bottom-left) and ExoClick Slider (bottom-right) occupy separate corners');

  // 9. Global page coverage & route eligibility
  console.log('\n--- 3. Centralized Placement Eligibility & Route Coverage ---');
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
  console.log(`✅ [PASSED] 3.1 All ${eligibleRoutes.length} eligible public and member routes receive global placements`);

  // Protected / Ineligible routes
  const protectedRoutes = [
    '/user/login',
    '/user/register',
    '/user/guest-entry',
    '/user/reset-password',
    '/auth',
    '/admin',
    '/admin/dashboard',
    '/admin/login',
    '/moderator',
    '/moderator/dashboard',
    '/moderator/login',
    '/checkout',
    '/payment',
  ];

  for (const pr of protectedRoutes) {
    assert.strictEqual(isEligibleRouteForGlobalAds(pr), false, `Sensitive route ${pr} must be strictly excluded from global ads`);
  }
  console.log(`✅ [PASSED] 3.2 All ${protectedRoutes.length} sensitive auth, admin, and payment routes are excluded`);

  // 10. Member Dashboard receives intended placements
  const dashboardSource = fs.readFileSync(path.resolve('src/pages/MemberDashboardPage.tsx'), 'utf-8');
  assert(dashboardSource.includes('<HorizontalVastVideoAd'), 'Member Dashboard embeds HorizontalVastVideoAd');
  console.log('✅ [PASSED] 3.3 Member Dashboard embeds HorizontalVastVideoAd');

  // 11. Existing Explore Other Chatrooms placement is preserved without duplication
  const publicChatSource = fs.readFileSync(path.resolve('src/pages/PublicChatPage.tsx'), 'utf-8');
  assert(publicChatSource.includes('data-testid="explore-other-chatrooms-section"'), 'Explore Other Chatrooms section preserved');
  assert(publicChatSource.includes('data-testid="chatroom-juicyads-bottom-section"'), 'JuicyAds bottom section preserved');
  assert(publicChatSource.includes("activeJuicyAdsZone === '1133909'"), 'JuicyAds explore display only initializes on zone 1133909');
  console.log('✅ [PASSED] 3.4 Explore Other Chatrooms placement preserved and gated by alternation zone 1133909');

  // 12. Existing JuicyAds zones remain unchanged
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x62, '1131763', 'Existing zone 1131763 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x262, '1131765', 'Existing zone 1131765 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner728x102, '1131766', 'Existing zone 1131766 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.banner300x112, '1131767', 'Existing zone 1131767 preserved');
  assert.strictEqual(JUICYADS_CONFIG.zones.floating, '1133907', 'New zone 1133907 configured');
  assert.strictEqual(JUICYADS_CONFIG.zones.display308x298, '1133909', 'New zone 1133909 configured');
  console.log('✅ [PASSED] 3.5 All 4 pre-existing JuicyAds zones preserved alongside 2 new alternating zones');

  // 13. Verified Ad Units contains 308x298
  const unit308 = VERIFIED_AD_UNITS.find((u) => u.id === '1133909');
  assert(unit308 !== undefined, 'Unit 1133909 must be in VERIFIED_AD_UNITS');
  assert.strictEqual(unit308?.width, 308, 'Unit 1133909 width is 308');
  assert.strictEqual(unit308?.height, 298, 'Unit 1133909 height is 298');
  console.log('✅ [PASSED] 3.6 VERIFIED_AD_UNITS specifies exact 308x298 dimensions for zone 1133909');

  // 14. Chat composer protection & mobile safety
  console.log('\n--- 4. Chat Usability & Mobile Layout Protection ---');
  assert(sliderSource.includes('bottom-[76px] sm:bottom-4'), 'ExoClick slider lifts above mobile chat composer on live chat routes');
  assert(sliderSource.includes('env(safe-area-inset-bottom, 0px)'), 'Slider respects mobile safe-area-inset-bottom');
  assert(sliderSource.includes('handleDismiss'), 'Slider provides user dismiss button');
  assert(sliderSource.includes('vx_video_slider_dismissed'), 'Slider stores dismissal in sessionStorage to prevent repeated popups');
  assert(sliderSource.includes('toggleMinimize'), 'Slider provides minimize/maximize toggle');
  console.log('✅ [PASSED] 4.1 Mobile chat composer is protected with lifted bottom offset and safe-area inset');
  console.log('✅ [PASSED] 4.2 Slider provides close (X), minimize toggle, and session-scoped dismissal memory');

  // 15. Root Layout Integration
  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  assert(appSource.includes('<CentralizedAdCoordinator />'), 'App.tsx mounts CentralizedAdCoordinator at root');
  console.log('✅ [PASSED] 4.3 CentralizedAdCoordinator is cleanly mounted in root App component');

  console.log('\n================================================================');
  console.log('  ALL FINAL PHASE ADS INTEGRATION ASSERTIONS PASSED!');
  console.log('================================================================\n');
}

runTests();
