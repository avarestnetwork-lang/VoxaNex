import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { AdPlacementBox } from '../src/components/ads/AdPlacementBox';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] ${message}`);
}

async function runAdRenderingTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA: PUBLIC CHATROOM AD RENDERING & LAYOUT TESTS');
  console.log('=============================================================\n');

  // --- 1. AdPlacementBox Conditional Rendering & Placeholder Removal ---
  console.log('--- 1. AdPlacementBox Conditional Rendering & Static Placeholder Removal ---');

  const adPlacementBoxSource = fs.readFileSync(
    path.resolve('src/components/ads/AdPlacementBox.tsx'),
    'utf-8'
  );

  // 1.1 Verify static placeholders are completely eliminated
  assert(
    !adPlacementBoxSource.includes('Google AdSense Placement'),
    '1.1 "Google AdSense Placement" static label is completely removed'
  );
  assert(
    !adPlacementBoxSource.includes('Inactive pending unit ID'),
    '1.2 "Inactive pending unit ID" label is completely removed'
  );
  assert(
    !adPlacementBoxSource.includes('border-dashed'),
    '1.3 Static dashed placeholder styling (border-dashed) is removed'
  );
  assert(
    !adPlacementBoxSource.includes('min-h-[450px]'),
    '1.4 Arbitrary vertical empty height (min-h-[450px]) placeholder is removed'
  );
  assert(
    !adPlacementBoxSource.includes('min-h-[90px]'),
    '1.5 Arbitrary horizontal empty height (min-h-[90px]) placeholder is removed'
  );

  // 1.2 Unconfigured Provider / No Fill
  const topAdHtmlUnconfigured = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'unconfigured-top-slot' })
  );
  assert(
    topAdHtmlUnconfigured === '',
    '1.6 Unconfigured top ad renders null (exact empty string in HTML, no empty div/wrapper)'
  );

  const leftAdHtmlUnconfigured = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'unconfigured-left-slot', isVertical: true })
  );
  assert(
    leftAdHtmlUnconfigured === '',
    '1.7 Unconfigured left ad renders null (exact empty string in HTML, zero layout space)'
  );

  const rightAdHtmlUnconfigured = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'unconfigured-right-slot', isVertical: true })
  );
  assert(
    rightAdHtmlUnconfigured === '',
    '1.8 Unconfigured right ad renders null (exact empty string in HTML, zero layout space)'
  );

  const bottomAdHtmlUnconfigured = renderToString(
    React.createElement(AdPlacementBox, { slotId: 'unconfigured-bottom-slot' })
  );
  assert(
    bottomAdHtmlUnconfigured === '',
    '1.9 Unconfigured bottom ad renders null (exact empty string in HTML, zero layout space)'
  );

  // 1.3 Provider returns no fill
  let reportedStatus = '';
  const noFillHtml = renderToString(
    React.createElement(AdPlacementBox, {
      slotId: 'public-chatroom-top',
      position: 'top',
      renderAd: () => null,
      onStatusChange: (status) => {
        reportedStatus = status;
      },
    })
  );
  assert(
    noFillHtml === '',
    '1.10 Provider returns no fill renders null (0 reserved space)'
  );
  assert(
    reportedStatus === 'unfilled',
    '1.11 Provider unfilled status callback fired with "unfilled"'
  );

  // 1.4 Successful real ad rendering in assigned placement
  let reportedFilledStatus = '';
  const filledTopHtml = renderToString(
    React.createElement(AdPlacementBox, {
      slotId: 'public-chatroom-top',
      position: 'top',
      renderAd: () => React.createElement('div', { id: 'real-ad-content' }, 'Sponsored Announcement'),
      onStatusChange: (status) => {
        reportedFilledStatus = status;
      },
    })
  );
  assert(
    filledTopHtml.includes('data-testid="ad-slot-public-chatroom-top"'),
    '1.12 Successful ad renders in its assigned top placement slot'
  );
  assert(
    filledTopHtml.includes('Sponsored Announcement'),
    '1.13 Successful ad contains the rendered advertisement content'
  );
  assert(
    filledTopHtml.includes('mb-2.5'),
    '1.14 Filled top ad includes proper spacing margin (mb-2.5)'
  );
  assert(
    reportedFilledStatus === 'filled',
    '1.15 Filled status callback fired with "filled"'
  );

  // 1.5 Side ad responsive classes (Desktop-only, constrained width)
  const filledLeftHtml = renderToString(
    React.createElement(AdPlacementBox, {
      slotId: 'public-chatroom-left',
      position: 'left',
      isVertical: true,
      renderAd: () => React.createElement('div', null, 'Left Banner'),
    })
  );
  assert(
    filledLeftHtml.includes('hidden lg:flex') || filledLeftHtml.includes('hidden xl:flex'),
    '1.16 Side ad uses hidden xl:flex/lg:flex to ensure it remains hidden on tablet and mobile'
  );
  assert(
    filledLeftHtml.includes('w-[160px]') && filledLeftHtml.includes('max-w-[200px]'),
    '1.17 Side ad width is strictly constrained (160px / max 200px) so chatroom is not crowded'
  );

  // --- 2. PublicChatPage Layout & Placement Integration ---
  console.log('\n--- 2. PublicChatPage Layout & Placement Integration ---');

  const publicChatPageSource = fs.readFileSync(
    path.resolve('src/pages/PublicChatPage.tsx'),
    'utf-8'
  );

  // 2.1 Verify all four placement slots are present
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-top"'),
    '2.1 Top ad slot (public-chatroom-top) is present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-bottom"'),
    '2.2 Bottom ad slot (public-chatroom-bottom) is present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-left"'),
    '2.3 Left ad slot (public-chatroom-left) is present in PublicChatPage'
  );
  assert(
    publicChatPageSource.includes('slotId="public-chatroom-right"'),
    '2.4 Right ad slot (public-chatroom-right) is present in PublicChatPage'
  );

  // 2.2 Verify no ads inside message stream or composer
  const messageStreamSection = publicChatPageSource.slice(
    publicChatPageSource.indexOf('messages.map('),
    publicChatPageSource.indexOf('handleScrollMessages') > publicChatPageSource.indexOf('messages.map(')
      ? publicChatPageSource.indexOf('handleScrollMessages')
      : publicChatPageSource.indexOf('BanglishHelperBar')
  );
  assert(
    !messageStreamSection.includes('AdPlacementBox'),
    '2.5 No ad appears inside the chat message stream'
  );

  const composerFormStart = publicChatPageSource.indexOf('<form onSubmit={handleSendMessage}');
  const composerFormEnd = publicChatPageSource.indexOf('</form>', composerFormStart) + 7;
  const composerSection = publicChatPageSource.slice(composerFormStart, composerFormEnd);
  assert(
    !composerSection.includes('AdPlacementBox'),
    '2.6 No ad appears inside the message composer form or input bar'
  );

  // 2.3 Verify no empty static wrappers with margins left around top/bottom slots
  assert(
    !publicChatPageSource.includes('<div className="mb-2.5 shrink-0">\n        <AdPlacementBox'),
    '2.7 Top ad slot does not leave an empty div with mb-2.5 when ad returns null'
  );
  assert(
    !publicChatPageSource.includes('<div className="mt-2.5 shrink-0">\n        <AdPlacementBox'),
    '2.8 Bottom ad slot does not leave an empty div with mt-2.5 when ad returns null'
  );

  // 2.4 Verify central chatroom layout preservation
  assert(
    publicChatPageSource.includes('flex-1 flex flex-col overflow-hidden border border-slate-800 rounded-2xl bg-[#090d18] relative shadow-2xl min-w-0'),
    '2.9 Central chatroom is unified with flex-1 min-w-0 to flexibly occupy available width'
  );
  assert(
    publicChatPageSource.includes('h-[calc(100vh-5.5rem)] min-h-[580px]'),
    '2.10 Viewport-based layout height is preserved to prevent page overflow'
  );

  // --- 3. Preservation of Existing Chatroom Core Functionality ---
  console.log('\n--- 3. Preservation of Existing Chatroom Core Functionality ---');

  assert(
    publicChatPageSource.includes('fetchRoomHistory') && publicChatPageSource.includes('subscribeToRoom'),
    '3.1 Room message history loading and realtime subscription logic are intact'
  );
  assert(
    publicChatPageSource.includes('clientNonce') && publicChatPageSource.includes('optimisticMsg'),
    '3.2 Optimistic messaging and clientNonce deduplication are intact'
  );
  assert(
    publicChatPageSource.includes('trackPresence') && publicChatPageSource.includes('sendPresence'),
    '3.3 Dual realtime presence tracking with HTTP heartbeat fallback is intact'
  );
  assert(
    publicChatPageSource.includes('PrivateChatPane') && publicChatPageSource.includes('activeMaximizedWindow'),
    '3.4 Private 1-on-1 chat pane and maximized tab mode are intact'
  );
  assert(
    publicChatPageSource.includes('BanglishHelperBar') && publicChatPageSource.includes('EmojiPicker'),
    '3.5 Banglish helper bar and emoji/GIF picker controls are intact'
  );
  assert(
    publicChatPageSource.includes('showMobileSidebar') && publicChatPageSource.includes('fixed inset-y-0 right-0 z-40 lg:static'),
    '3.6 Mobile participant drawer and backdrop behavior are intact'
  );

  console.log('\n=============================================================');
  console.log('  ALL 23 AD RENDERING & LAYOUT TESTS PASSED SUCCESSFULLY');
  console.log('=============================================================\n');
}

runAdRenderingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
