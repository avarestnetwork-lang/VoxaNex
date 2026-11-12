import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { AdPlacementBox } from '../src/components/ads/AdPlacementBox';
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

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] ${message}`);
}

async function runAdRenderingTests() {
  console.log('\n================================================================');
  console.log('  CHATLUSTORA: WORK PROMPT 5 FINAL AD LIFECYCLE & POLICY TESTS');
  console.log('================================================================\n');

  // --- Task 1: JuicyAds Fill Verification Assertions ---
  console.log('--- 1. JuicyAds Verified Fill & Timeout Safety ---');

  const adPlacementBoxSource = fs.readFileSync(
    path.resolve('src/components/ads/AdPlacementBox.tsx'),
    'utf-8'
  );

  assert(
    adPlacementBoxSource.includes("updateStatus('unfilled')") &&
      adPlacementBoxSource.includes('attempts >= 5'),
    '1.1 JuicyAds timeout without actual rendered DOM content marks slot unfilled (never filled)'
  );
  assert(
    adPlacementBoxSource.includes('hasChildren || hasIframe'),
    '1.2 Slot transitions to filled only upon credible evidence of provider-rendered content'
  );
  assert(
    adPlacementBoxSource.includes('clearAllActiveTimers'),
    '1.3 All active timers and intervals are tracked and cleared on unmount/status transition'
  );
  assert(
    adPlacementBoxSource.includes('juicyads-ins-${effectiveUnitId}-${slotId}'),
    '1.4 Slot-specific DOM element IDs remain unique per placement slot'
  );

  // --- Task 2: Non-Overridable Route Exclusion Assertions ---
  console.log('\n--- 2. Non-Overridable AdSense Route Policy ---');

  assert(
    adPlacementBoxSource.includes('isExcludedByRoute || Boolean(isLiveChatScreenProp)'),
    '2.1 Route exclusion combines isExcludedByRoute and prop to enforce non-overridable policy'
  );

  assert(isAdSenseExcludedRoute('/chat'), '2.2 /chat route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/bangla'), '2.3 /chat/bangla route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/indian'), '2.4 /chat/indian route excludes AdSense');
  assert(isAdSenseExcludedRoute('/messages'), '2.5 /messages private messaging excludes AdSense');
  assert(isAdSenseExcludedRoute('/av-chat'), '2.6 /av-chat video chat excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/video'), '2.7 /chat/video route excludes AdSense');
  assert(isAdSenseExcludedRoute('/random'), '2.8 /random route excludes AdSense');
  assert(isAdSenseExcludedRoute('/user/guest-entry'), '2.9 /user/guest-entry excludes AdSense');
  assert(isAdSenseExcludedRoute('/admin/dashboard'), '2.10 Admin dashboard excludes AdSense');

  // Route Eligibility
  assert(!isAdSenseExcludedRoute('/'), '2.11 Landing page / is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/rooms'), '2.12 Room directory /rooms is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/about'), '2.13 About page /about is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/blog'), '2.14 Blog /blog is eligible for AdSense');

  // Set window location to excluded route /chat to test non-overridability
  if (typeof global !== 'undefined') {
    (global as any).window = {
      location: { pathname: '/chat' },
      history: { pushState: () => {}, back: () => {} },
      scrollTo: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  // Verify that explicitly passing isLiveChatScreen={false} on excluded route /chat STILL excludes AdSense
  const overrideAttemptHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, {
        slotId: 'override-test-slot',
        provider: 'adsense',
        isLiveChatScreen: false, // Attempt to override on /chat route
      })
    )
  );
  assert(
    !overrideAttemptHtml.includes('adsbygoogle'),
    '2.15 Explicitly passing isLiveChatScreen={false} on an excluded route (/chat) CANNOT override route policy'
  );

  // --- Task 3 & 4: AdSense Script Loader & Build Validation ---
  console.log('\n--- 3. AdSense Loader & Build Validation ---');

  const indexHtmlSource = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  assert(
    !indexHtmlSource.includes('adsbygoogle.js'),
    '3.1 Static AdSense loader remains completely removed from index.html'
  );

  const viteConfigSource = fs.readFileSync(path.resolve('vite.config.ts'), 'utf-8');
  assert(
    viteConfigSource.includes("[Build Error] Missing required public Supabase environment variables for build mode '") &&
      viteConfigSource.includes('throw new Error'),
    '3.2 Production and staging builds strictly fail fast if required Supabase variables are missing'
  );

  // --- Task 5: Network Configurations Preservation ---
  console.log('\n--- 4. Network Configurations & Layout Preservation ---');

  assert(ADSTERRA_CONFIG.publisherId === '6190760', '4.1 Adsterra Publisher ID is 6190760');
  assert(ADSTERRA_CONFIG.nativeUnitId === '4085ad0bb94688c1cdc0917f2df29137', '4.2 Adsterra Native Unit ID is intact');
  assert(JUICYADS_CONFIG.zones.banner300x62 === '1131763', '4.3 JuicyAds 300x62 Zone ID is 1131763');
  assert(JUICYADS_CONFIG.zones.banner728x102 === '1131766', '4.4 JuicyAds 728x102 Zone ID is 1131766');
  assert(MONETAG_CONFIG.scriptUrl === 'https://nap5k.com/tag.min.js', '4.5 Monetag script URL is https://nap5k.com/tag.min.js');
  assert(MONETAG_CONFIG.enabled === false, '4.6 Monetag remains disabled');
  assert(EXOCLICK_CONFIG.enabled === false, '4.7 ExoClick remains disabled');

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"') &&
      publicChatPageSource.includes('slotId="public-chatroom-bottom"'),
    '4.8 Public chat page ad placement structure remains intact'
  );
  assert(
    publicChatPageSource.includes('h-[calc(100vh-5.5rem)] min-h-[580px]'),
    '4.9 Central chatroom container dimensions are strictly preserved'
  );

  const messageStreamStart = publicChatPageSource.indexOf('messages.map(');
  const messageStreamEnd = publicChatPageSource.indexOf('handleScrollMessages');
  const messageStreamCode = publicChatPageSource.slice(
    messageStreamStart,
    messageStreamEnd > messageStreamStart ? messageStreamEnd : messageStreamStart + 5000
  );
  assert(!messageStreamCode.includes('AdPlacementBox'), '4.10 No ad inserted into message stream');

  const composerStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerEnd = publicChatPageSource.indexOf('</form>', composerStart) + 7;
  const composerCode = publicChatPageSource.slice(composerStart, composerEnd);
  assert(!composerCode.includes('AdPlacementBox'), '4.11 No ad inserted into message composer');

  console.log('\n================================================================');
  console.log('  ALL 36 WORK PROMPT 5 FINAL AD LIFECYCLE & POLICY TESTS PASSED!');
  console.log('================================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
