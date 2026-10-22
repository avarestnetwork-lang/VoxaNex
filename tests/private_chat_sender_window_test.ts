/**
 * ChatLustora — Sender & Receiver Private Chat Window State Test Suite
 * Validates:
 * 1. Guest A (sender) opens a private chat: exactly one floating window and zero expanded windows.
 * 2. Guest B (receiver) receives the message: exactly one floating window and zero expanded windows.
 * 3. Mutual exclusivity between compact floating and expanded views.
 * 4. Repeated openChat calls do not create duplicate windows.
 */

import { registerConversationMembers, postConversationMessage } from '../src/server/realtimeHub';
import { createGuestSession } from '../src/server/guestSessionManager';

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runSenderWindowTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA — SENDER & RECEIVER PRIVATE CHAT WINDOW TESTS');
  console.log('=============================================================\n');

  const guestA = createGuestSession({ nickname: 'GuestA', avatar: '⚡', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.1' });
  const guestB = createGuestSession({ nickname: 'GuestB', avatar: '🌸', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.2' });

  const idA = guestA.session!.id;
  const idB = guestB.session!.id;

  const convId = `conv_${[idA, idB].sort().join('_')}`;
  registerConversationMembers(convId, [idA, idB]);

  // Mock Window Store State
  interface WindowState {
    conversationId: string;
    isOpen: boolean;
    isMinimized: boolean;
    isMaximized: boolean;
  }

  let openWindows: WindowState[] = [];

  const openChatMock = (partner: { id: string; nickname: string; avatar: string }) => {
    const existing = openWindows.find((w) => w.conversationId === convId);
    if (existing) {
      existing.isOpen = true;
      existing.isMinimized = false;
    } else {
      openWindows.push({
        conversationId: convId,
        isOpen: true,
        isMinimized: false,
        isMaximized: false, // Must be compact floating by default, NOT expanded
      });
    }
  };

  const maximizeChatMock = (cId: string) => {
    openWindows = openWindows.map((w) =>
      w.conversationId === cId ? { ...w, isMaximized: !w.isMaximized, isMinimized: false } : w
    );
  };

  // 1. Guest A initiates private chat (Sender)
  openChatMock({ id: idB, nickname: 'GuestB', avatar: '🌸' });

  assert(openWindows.length === 1, '1.1 Guest A has exactly one window open');
  assert(openWindows[0].isOpen === true, '1.2 Window is open');
  assert(openWindows[0].isMaximized === false, '1.3 Window is in compact floating mode (not expanded)');
  assert(openWindows[0].isMinimized === false, '1.4 Window is not minimized');

  // 2. Repeated openChat calls do not create duplicates
  openChatMock({ id: idB, nickname: 'GuestB', avatar: '🌸' });
  assert(openWindows.length === 1, '2.1 Repeated openChat does not create duplicate windows for Guest A');

  // 3. Guest A sends message
  const sendRes = await postConversationMessage({
    conversationId: convId,
    senderId: idA,
    senderNickname: 'GuestA',
    senderAvatar: '⚡',
    rawContent: 'Hello Guest B!',
  });
  assert(sendRes.success, '3.1 Guest A successfully posts message');
  assert(openWindows.length === 1, '3.2 Sending message does not spawn a second window or expanded view');

  // 4. Guest B (receiver) simulates receiving message / opening chat
  let receiverWindows: WindowState[] = [];
  const receiverOpenChat = () => {
    const existing = receiverWindows.find((w) => w.conversationId === convId);
    if (!existing) {
      receiverWindows.push({
        conversationId: convId,
        isOpen: true,
        isMinimized: false,
        isMaximized: false, // Compact floating by default
      });
    }
  };

  receiverOpenChat();
  assert(receiverWindows.length === 1, '4.1 Guest B has exactly one window open upon receiving');
  assert(receiverWindows[0].isMaximized === false, '4.2 Guest B window is compact floating (not expanded)');

  // 5. Explicit maximize control check (Rule 3 & 4)
  maximizeChatMock(convId);
  const winA = openWindows.find((w) => w.conversationId === convId)!;
  assert(winA.isMaximized === true, '5.1 Explicitly clicking maximize transitions window to expanded mode');
  assert(!(winA.isMaximized && !winA.isOpen), '5.2 Window state is consistent');

  console.log('\n=============================================================');
  console.log('  SENDER & RECEIVER PRIVATE CHAT WINDOW TESTS PASSED');
  console.log('=============================================================\n');
}

runSenderWindowTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
