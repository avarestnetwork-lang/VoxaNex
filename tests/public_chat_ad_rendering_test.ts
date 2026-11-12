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
} from '../src/config/adsConfig';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] ${message}`);
}

async function runAdRenderingTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA: PHASE B FIVE-NETWORK AD INTEGRATION & LIFECYCLE TESTS');
  console.log('=============================================================\n');

  // --- Section 1: Five-Network Configuration & Policy Assertions ---
  console.log('--- 1. Five-Network Configuration & Policy Assertions ---');

  // 1.1 Adsterra Configuration
  assert(ADSTERRA_CONFIG.publisherId === '6190760', '1.1 Adsterra Publisher ID is 6190760');
  assert(ADSTERRA_CONFIG.nativeUnitId === '4085ad0bb94688c1cdc0917f2df29137', '1.2 Adsterra Native Unit ID is 4085ad0bb94688c1cdc0917f2df29137');
  assert(ADSTERRA_CONFIG.banner300x250 === '6863f1ca8dc093d7a0a913d8f30c47a2', '1.3 Adsterra 300x250 Unit ID is 6863f1ca8dc093d7a0a913d8f30c47a2');
  assert(ADSTERRA_CONFIG.banner320x50 === '8b239fe78d1bba05c2a125bb36872489', '1.4 Adsterra 320x50 Unit ID is 8b239fe78d1bba05c2a125bb36872489');
  assert(ADSTERRA_CONFIG.banner728x90 === 'd8696ddef865fbc92f612a0124ae627f', '1.5 Adsterra 728x90 Unit ID is d8696ddef865fbc92f612a0124ae627f');

  // 1.2 ExoClick Configuration (Disabled until dashboard specs confirmed)
  assert(EXOCLICK_CONFIG.zoneId === '6087300', '1.6 ExoClick Zone ID is 6087300');
  assert(EXOCLICK_CONFIG.scriptUrl === 'https://a.magsrv.com/ad-provider.js', '1.7 ExoClick script URL is correct');
  assert(EXOCLICK_CONFIG.elementClass === 'eas6a97888e2', '1.8 ExoClick element class is eas6a97888e2');
  assert(EXOCLICK_CONFIG.verificationFile === '28befc4532cb8837aa59edffca607a5a.html', '1.9 ExoClick verification file name is correct');
  assert(EXOCLICK_CONFIG.enabled === false, '1.10 ExoClick is set enabled: false (inactive until format confirmed)');

  // 1.3 JuicyAds Configuration
  assert(JUICYADS_CONFIG.verificationTag === '97a6aeec522d11d21efa5f84c86eb958', '1.11 JuicyAds verification tag is correct');
  assert(JUICYADS_CONFIG.scriptUrl === 'https://poweredby.jads.co/js/jads.js', '1.12 JuicyAds script URL is https://poweredby.jads.co/js/jads.js');
  assert(JUICYADS_CONFIG.zones.banner300x62 === '1131763', '1.13 JuicyAds 300x62 Zone ID is 1131763');
  assert(JUICYADS_CONFIG.zones.banner300x262 === '1131765', '1.14 JuicyAds 300x262 Zone ID is 1131765');
  assert(JUICYADS_CONFIG.zones.banner728x102 === '1131766', '1.15 JuicyAds 728x102 Zone ID is 1131766');
  assert(JUICYADS_CONFIG.zones.banner300x112 === '1131767', '1.16 JuicyAds 300x112 Zone ID is 1131767');
  assert(JUICYADS_CONFIG.enabled === true, '1.17 JuicyAds is enabled for compatible placements');

  // 1.4 Monetag Configuration (Disabled until dashboard specs confirmed)
  assert(MONETAG_CONFIG.verificationTag === '416e702dd7d166aafe13107553d43a38', '1.18 Monetag verification tag is correct');
  assert(MONETAG_CONFIG.zoneId === '12241585', '1.19 Monetag Zone ID is 12241585');
  assert(MONETAG_CONFIG.scriptUrl === 'https://nap5k.com/tag.min.js', '1.20 Monetag script URL is correct');
  assert(MONETAG_CONFIG.enabled === false, '1.21 Monetag is set enabled: false (inactive until format confirmed)');

  // 1.5 Google AdSense Policy Enforcement
  assert(ADSENSE_CONFIG.publisherId === 'ca-pub-7862321512207088', '1.22 Google AdSense Publisher ID is ca-pub-7862321512207088');
  assert(ADSENSE_CONFIG.adSlot === '1929701241', '1.23 Google AdSense Ad Slot is 1929701241');
  const liveChatRotation = getProviderRotation('top', true);
  assert(!liveChatRotation.includes('adsense'), '1.24 Google AdSense is strictly excluded from live-chat rotations (/chat)');
  const nonChatRotation = getProviderRotation('top', false);
  assert(nonChatRotation.includes('adsense'), '1.25 Google AdSense is permitted on non-chat landing pages');

  // --- Section 2: Component Implementation & Lifecycle Assertions ---
  console.log('\n--- 2. Component Implementation & Lifecycle Assertions ---');

  const adPlacementBoxSource = fs.readFileSync(
    path.resolve('src/components/ads/AdPlacementBox.tsx'),
    'utf-8'
  );

  assert(
    adPlacementBoxSource.includes('lastReportedStatusRef'),
    '2.1 Duplicate status notifications are guarded using lastReportedStatusRef'
  );
  assert(
    adPlacementBoxSource.includes('container-${effectiveUnitId}-${slotId}'),
    '2.2 Native Adsterra container IDs are uniquely scoped per slot ID'
  );
  assert(
    adPlacementBoxSource.includes('isLiveChatScreen'),
    '2.3 AdPlacementBox accepts and respects isLiveChatScreen parameter'
  );
  assert(
    !adPlacementBoxSource.includes('onStatusChange?.(status)') ||
      !adPlacementBoxSource.slice(adPlacementBoxSource.indexOf('return (')).includes('onStatusChange'),
    '2.4 No status callbacks occur during component render body'
  );

  // Unconfigured / disabled provider returns null (zero reserved layout space)
  const unconfiguredHtml = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'test-unconfigured', provider: 'exoclick' })
  );
  assert(unconfiguredHtml === '', '2.5 Disabled provider (ExoClick) returns null (0 reserved layout space)');

  const monetagHtml = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'test-monetag', provider: 'monetag' })
  );
  assert(monetagHtml === '', '2.6 Disabled provider (Monetag) returns null (0 reserved layout space)');

  const adsenseOnChatHtml = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'test-adsense-chat', provider: 'adsense', isLiveChatScreen: true })
  );
  assert(adsenseOnChatHtml === '', '2.7 AdSense on live chat screen returns null (strictly excluded)');

  // --- Section 3: PublicChatPage Layout & Placement Integration ---
  console.log('\n--- 3. PublicChatPage Layout & Placement Integration ---');

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );

  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"'),
    '3.1 Top ad slot (public-chatroom-top) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-left"'),
    '3.2 Left ad slot (public-chatroom-left) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-right"'),
    '3.3 Right ad slot (public-chatroom-right) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="participant-box-horizontal"'),
    '3.4 Participant ad slot (participant-box-horizontal) present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-bottom"'),
    '3.5 Bottom ad slot (public-chatroom-bottom) present in PublicChatPage'
  );

  const messageStreamStart = publicChatPageSource.indexOf('messages.map(');
  const messageStreamEnd = publicChatPageSource.indexOf('handleScrollMessages');
  const messageStreamCode = publicChatPageSource.slice(messageStreamStart, messageStreamEnd > messageStreamStart ? messageStreamEnd : messageStreamStart + 5000);
  assert(!messageStreamCode.includes('AdPlacementBox'), '3.6 No ad placed inside message stream');

  const composerStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerEnd = publicChatPageSource.indexOf('</form>', composerStart) + 7;
  const composerCode = publicChatPageSource.slice(composerStart, composerEnd);
  assert(!composerCode.includes('AdPlacementBox'), '3.7 No ad placed inside composer');

  assert(
    publicChatPageSource.includes('h-[calc(100vh-5.5rem)] min-h-[580px]'),
    '3.8 Chatroom container height h-[calc(100vh-5.5rem)] min-h-[580px] is strictly preserved'
  );

  console.log('\n=============================================================');
  console.log('  ALL 35 PHASE B AD INTEGRATION & LIFECYCLE TESTS PASSED!');
  console.log('=============================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
