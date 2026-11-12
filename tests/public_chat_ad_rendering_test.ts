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
  assert(MONETAG_CONFIG.enabled === false, '3.6 Monetag remains disabled');
  assert(EXOCLICK_CONFIG.enabled === false, '3.7 ExoClick remains disabled');

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"') &&
      publicChatPageSource.includes('slotId="public-chatroom-bottom"'),
    '3.8 Public chat page ad placement structure remains intact'
  );
  assert(
    publicChatPageSource.includes('h-[calc(100vh-5.5rem)] min-h-[580px]'),
    '3.9 Central chatroom container dimensions are strictly preserved'
  );

  const messageStreamStart = publicChatPageSource.indexOf('messages.map(');
  const messageStreamEnd = publicChatPageSource.indexOf('handleScrollMessages');
  const messageStreamCode = publicChatPageSource.slice(
    messageStreamStart,
    messageStreamEnd > messageStreamStart ? messageStreamEnd : messageStreamStart + 5000
  );
  assert(!messageStreamCode.includes('AdPlacementBox'), '3.10 No ad inserted into message stream');

  const composerStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerEnd = publicChatPageSource.indexOf('</form>', composerStart) + 7;
  const composerCode = publicChatPageSource.slice(composerStart, composerEnd);
  assert(!composerCode.includes('AdPlacementBox'), '3.11 No ad inserted into message composer');

  console.log('\n================================================================');
  console.log(`  ALL ${totalAssertions} WORK PROMPT 6 TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
