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
  console.log('  CHATLUSTORA: WORK PROMPT 4 AD LIFECYCLE & ROUTE ISOLATION TESTS');
  console.log('================================================================\n');

  // --- Task 1 & 2: Static Removal & Route Isolation Assertions ---
  console.log('--- 1. Static AdSense Script Removal & Route Isolation ---');

  const indexHtmlSource = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  assert(
    !indexHtmlSource.includes('adsbygoogle.js'),
    '1.1 No static AdSense script loader remains in index.html'
  );
  assert(
    indexHtmlSource.includes('gtm.js') && indexHtmlSource.includes('dataLayer'),
    '1.2 Google Tag Manager and Analytics scripts remain intact in index.html'
  );

  const adSenseLoaderSource = fs.readFileSync(
    path.resolve('src/components/ads/AdSenseScriptLoader.tsx'),
    'utf-8'
  );
  assert(
    adSenseLoaderSource.includes('isAdSenseExcludedRoute'),
    '1.3 AdSense script loader component is route-aware'
  );

  // Route Exclusion Assertions
  assert(isAdSenseExcludedRoute('/chat'), '1.4 /chat route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/bangla'), '1.5 /chat/bangla route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/indian'), '1.6 /chat/indian route excludes AdSense');
  assert(isAdSenseExcludedRoute('/messages'), '1.7 /messages private route excludes AdSense');
  assert(isAdSenseExcludedRoute('/av-chat'), '1.8 /av-chat video route excludes AdSense');
  assert(isAdSenseExcludedRoute('/chat/video'), '1.9 /chat/video route excludes AdSense');
  assert(isAdSenseExcludedRoute('/random'), '1.10 /random route excludes AdSense');
  assert(isAdSenseExcludedRoute('/user/guest-entry'), '1.11 /user/guest-entry route excludes AdSense');

  // Route Eligibility Assertions
  assert(!isAdSenseExcludedRoute('/'), '1.12 Landing page / is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/rooms'), '1.13 Room directory /rooms is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/about'), '1.14 About page /about is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/blog'), '1.15 Blog page /blog is eligible for AdSense');
  assert(!isAdSenseExcludedRoute('/faq'), '1.16 FAQ page /faq is eligible for AdSense');

  // --- Task 3 & 4: Network Configs & Monetag Script URL Assertions ---
  console.log('\n--- 2. Network Configurations & Monetag Correction ---');

  // Adsterra ID Preservation
  assert(ADSTERRA_CONFIG.publisherId === '6190760', '2.1 Adsterra Publisher ID is 6190760');
  assert(ADSTERRA_CONFIG.nativeUnitId === '4085ad0bb94688c1cdc0917f2df29137', '2.2 Adsterra Native Unit ID is 4085ad0bb94688c1cdc0917f2df29137');
  assert(ADSTERRA_CONFIG.banner300x250 === '6863f1ca8dc093d7a0a913d8f30c47a2', '2.3 Adsterra 300x250 Unit ID is 6863f1ca8dc093d7a0a913d8f30c47a2');
  assert(ADSTERRA_CONFIG.banner320x50 === '8b239fe78d1bba05c2a125bb36872489', '2.4 Adsterra 320x50 Unit ID is 8b239fe78d1bba05c2a125bb36872489');
  assert(ADSTERRA_CONFIG.banner728x90 === 'd8696ddef865fbc92f612a0124ae627f', '2.5 Adsterra 728x90 Unit ID is d8696ddef865fbc92f612a0124ae627f');

  // JuicyAds Zone IDs & Dimensions
  assert(JUICYADS_CONFIG.zones.banner300x62 === '1131763', '2.6 JuicyAds 300x62 Zone ID is 1131763');
  assert(JUICYADS_CONFIG.zones.banner300x262 === '1131765', '2.7 JuicyAds 300x262 Zone ID is 1131765');
  assert(JUICYADS_CONFIG.zones.banner728x102 === '1131766', '2.8 JuicyAds 728x102 Zone ID is 1131766');
  assert(JUICYADS_CONFIG.zones.banner300x112 === '1131767', '2.9 JuicyAds 300x112 Zone ID is 1131767');
  assert(JUICYADS_CONFIG.scriptUrl === 'https://poweredby.jads.co/js/jads.js', '2.10 JuicyAds script URL is correct');

  // Monetag Script URL Correction
  assert(MONETAG_CONFIG.scriptUrl === 'https://nap5k.com/tag.min.js', '2.11 Monetag script URL is https://nap5k.com/tag.min.js');
  assert(MONETAG_CONFIG.zoneId === '12241585', '2.12 Monetag Zone ID is 12241585');
  assert(MONETAG_CONFIG.enabled === false, '2.13 Monetag is set enabled: false (disabled until format confirmed)');

  const monetagScriptSource = fs.readFileSync(
    path.resolve('src/components/ads/MonetagScript.tsx'),
    'utf-8'
  );
  assert(
    monetagScriptSource.includes('MONETAG_CONFIG.scriptUrl'),
    '2.14 MonetagScript component uses MONETAG_CONFIG.scriptUrl'
  );

  // --- Task 5: Component Safety & Unique DOM ID Assertions ---
  console.log('\n--- 3. AdPlacementBox Safety & Unique DOM IDs ---');

  const adPlacementBoxSource = fs.readFileSync(
    path.resolve('src/components/ads/AdPlacementBox.tsx'),
    'utf-8'
  );

  assert(
    adPlacementBoxSource.includes('juicyads-ins-${effectiveUnitId}-${slotId}'),
    '3.1 JuicyAds DOM IDs are unique per placement slot'
  );
  assert(
    adPlacementBoxSource.includes('lastReportedStatusRef'),
    '3.2 Duplicate status notifications are guarded using lastReportedStatusRef'
  );
  assert(
    !adPlacementBoxSource.includes('onStatusChange?.(status)') ||
      !adPlacementBoxSource.slice(adPlacementBoxSource.indexOf('return (')).includes('onStatusChange'),
    '3.3 No status callbacks occur during component render body'
  );

  // HTML rendering test inside RouterProvider context
  const topAdHtml = renderToString(
    React.createElement(
      RouterProvider,
      null,
      React.createElement(AdPlacementBox, { slotId: 'test-chat-top', isLiveChatScreen: true })
    )
  );
  assert(
    !topAdHtml.includes('adsbygoogle'),
    '3.4 Rendered top ad on live chat screen does NOT include AdSense ins container'
  );

  // --- Task 7: PublicChatPage Layout & Placement Integration ---
  console.log('\n--- 4. PublicChatPage Layout & Placement Preservation ---');

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );

  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"'),
    '4.1 Top ad slot (public-chatroom-top) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-left"'),
    '4.2 Left ad slot (public-chatroom-left) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-right"'),
    '4.3 Right ad slot (public-chatroom-right) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="participant-box-horizontal"'),
    '4.4 Participant ad slot (participant-box-horizontal) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-bottom"'),
    '4.5 Bottom ad slot (public-chatroom-bottom) present in PublicChatPage'
  );

  const messageStreamStart = publicChatPageSource.indexOf('messages.map(');
  const messageStreamEnd = publicChatPageSource.indexOf('handleScrollMessages');
  const messageStreamCode = publicChatPageSource.slice(
    messageStreamStart,
    messageStreamEnd > messageStreamStart ? messageStreamEnd : messageStreamStart + 5000
  );
  assert(!messageStreamCode.includes('AdPlacementBox'), '4.6 No ad placed inside message stream');

  const composerStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerEnd = publicChatPageSource.indexOf('</form>', composerStart) + 7;
  const composerCode = publicChatPageSource.slice(composerStart, composerEnd);
  assert(!composerCode.includes('AdPlacementBox'), '4.7 No ad placed inside message composer');

  assert(
    publicChatPageSource.includes('h-[calc(100vh-5.5rem)] min-h-[580px]'),
    '4.8 Chatroom container height h-[calc(100vh-5.5rem)] min-h-[580px] is strictly preserved'
  );

  console.log('\n================================================================');
  console.log('  ALL 38 WORK PROMPT 4 AD LIFECYCLE & ROUTE ISOLATION TESTS PASSED!');
  console.log('================================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
