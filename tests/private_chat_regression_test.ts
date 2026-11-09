/**
 * ChatLustora — Comprehensive Private Chat Regression Test Suite (Behavioral Model)
 *
 * This test suite models the behavioral logic of the PrivateChatContext and FloatingChatManager
 * to verify core invariants, deduplication, and responsive constraints.
 *
 * NOTE: This is a behavioral model simulation and source-level verification.
 * It does NOT execute actual Production React components or real backend services.
 */

import { ConversationDisplayMode, FloatingChatWindow, consolidateWindows } from '../src/context/PrivateChatContext';
import { ChatMessage } from '../src/types';
import * as fs from 'fs';

let assertionCount = 0;
function assert(condition: boolean, testName: string, detail?: string) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

// Behavioral Model Persistence Layer (Mocking basic history behavior)
// Note: Drafts are NOT persistent in this behavioral model for close/reopen cycles,
// matching the actual Production implementation in PrivateChatContext.tsx.
class MockPersistence {
  messages: Map<string, ChatMessage[]> = new Map();
  knownConversations: Set<string> = new Set();

  saveMessage(msg: ChatMessage) {
    const conv = this.messages.get(msg.conversationId) || [];
    if (!conv.some(m => m.id === msg.id)) {
      conv.push(msg);
      this.messages.set(msg.conversationId, conv);
    }
    this.knownConversations.add(msg.conversationId);
  }

  getMessages(conversationId: string): ChatMessage[] {
    return [...(this.messages.get(conversationId) || [])];
  }
}

const persistence = new MockPersistence();

// Mock for databaseService.getDeterministicConvId
const mockDatabaseService = {
  getDeterministicConvId: async (u1: string, u2: string) => {
    // Return a string that matches the production UUID regex: /^[0-9a-f]{8}-[0-9a-f]{4}/
    return `dec0ded1-0000-0000-0000-000000000000`;
  }
};

/**
 * State container replicating the exact behavior implemented in
 * PrivateChatContext.tsx
 */
class ChatClientSimulation {
  userId: string;
  nickname: string;
  avatar: string;
  openWindows: FloatingChatWindow[] = [];
  seenMessageIds: Set<string> = new Set();
  closedConversationIds: Set<string> = new Set();
  
  constructor(userId: string, nickname: string, avatar: string) {
    this.userId = userId;
    this.nickname = nickname;
    this.avatar = avatar;
  }

  // Authoritative render paths matching production component filter logic
  get floatingWindowsRendered(): FloatingChatWindow[] {
    return this.openWindows.filter((w) => w.isOpen && w.displayMode === 'floating');
  }

  get maximizedTabsRendered(): FloatingChatWindow[] {
    return this.openWindows.filter((w) => w.isOpen && w.displayMode === 'maximized');
  }

  async openChat(partner: { id: string; nickname: string; avatar: string; gender?: string }) {
    if (!this.userId || partner.id === this.userId) return;

    const conversationId = await mockDatabaseService.getDeterministicConvId(this.userId, partner.id);
    this.closedConversationIds.delete(conversationId);

    // Search by both ID and partnerId to match production reconciliation
    const existingIndex = this.openWindows.findIndex((w) => w.conversationId === conversationId || w.partnerId === partner.id);
    
    if (existingIndex >= 0) {
      this.openWindows = this.openWindows.map((w, idx) =>
        idx === existingIndex || w.partnerId === partner.id
          ? {
              ...w,
              conversationId, // Migrate to UUID if it was legacy
              isOpen: true,
              displayMode: 'floating' as ConversationDisplayMode,
              isMaximized: false,
              isMinimized: false,
              unreadCount: 0,
            }
          : w
      );
    } else {
      // Restore history from behavioral model persistence
      const history = persistence.getMessages(conversationId);
      this.openWindows.push({
        conversationId,
        partnerId: partner.id,
        partnerNickname: partner.nickname,
        partnerAvatar: partner.avatar,
        partnerGender: partner.gender,
        isMinimized: false,
        isMaximized: false,
        displayMode: 'floating',
        messages: history,
        unreadCount: 0,
        draft: '', 
        isOpen: true,
      });
    }
    this.openWindows = consolidateWindows(this.openWindows);
  }

  closeChat(conversationId: string) {
    this.closedConversationIds.add(conversationId);
    // Production behavior: Remove from openWindows array (filtering)
    this.openWindows = this.openWindows.filter((w) => w.conversationId !== conversationId);
  }

  sendMessage(conversationId: string, content: string): { tempId: string } {
    const target = this.openWindows.find((w) => w.conversationId === conversationId);
    if (!target) throw new Error('Cannot send message to unopened window');

    const tempId = `temp_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId,
      senderId: this.userId,
      senderNickname: this.nickname,
      senderAvatar: this.avatar,
      recipientId: target.partnerId,
      content,
      timestamp: new Date().toISOString(),
      status: 'sending'
    };

    this.openWindows = consolidateWindows(
      this.openWindows.map((w) =>
        w.conversationId === conversationId ? { ...w, messages: [...w.messages, optimisticMsg], draft: '' } : w
      )
    );

    return { tempId };
  }

  handleSendSuccess(conversationId: string, tempId: string, persistedMsg: ChatMessage) {
    this.seenMessageIds.add(persistedMsg.id);
    persistence.saveMessage(persistedMsg);
    this.openWindows = consolidateWindows(
      this.openWindows.map((w) =>
        w.conversationId === conversationId
          ? {
              ...w,
              messages: w.messages.map((m) => (m.id === tempId ? persistedMsg : m)),
              displayMode: (w.displayMode === 'maximized' ? 'maximized' : 'floating') as ConversationDisplayMode,
              isMaximized: w.displayMode === 'maximized',
            }
          : w
      )
    );
  }

  handleIncomingEcho(msg: ChatMessage, conversationId: string) {
    this.handleIncomingMessage(msg, conversationId);
  }

  handleIncomingMessage(msg: ChatMessage, conversationId: string, partnerInfo?: any) {
    if (!msg || !msg.id) return;

    // Rule 4: Sender Echo
    if (msg.senderId === this.userId) {
      this.openWindows = consolidateWindows(
        this.openWindows.map((w) => {
          if (w.conversationId !== conversationId && w.partnerId !== (partnerInfo?.id || msg.recipientId)) return w;
          if (w.messages.some(m => m.id === msg.id)) return w;
          const hasTemp = w.messages.some(m => m.id.startsWith('temp_') && m.content === msg.content);
          if (hasTemp) {
            return { ...w, messages: w.messages.map(m => (m.id.startsWith('temp_') && m.content === msg.content ? msg : m)) };
          }
          return { ...w, messages: [...w.messages, msg] };
        })
      );
      return;
    }

    if (this.seenMessageIds.has(msg.id)) return;
    this.seenMessageIds.add(msg.id);
    persistence.saveMessage(msg);

    const partnerId = partnerInfo?.id || msg.senderId;
    const existingIndex = this.openWindows.findIndex((w) => w.conversationId === conversationId || w.partnerId === partnerId);
    const partnerNickname = partnerInfo?.nickname || msg.senderNickname || 'Partner';
    const partnerAvatar = partnerInfo?.avatar || msg.senderAvatar || '👤';

    if (existingIndex >= 0) {
      const isFocused = this.openWindows[existingIndex].isOpen && !this.openWindows[existingIndex].isMinimized;
      this.openWindows = consolidateWindows(
        this.openWindows.map((w, idx) =>
          idx === existingIndex || w.partnerId === partnerId
            ? {
                ...w,
                conversationId, // Adopt canonical incoming ID
                messages: w.messages.some(m => m.id === msg.id) ? w.messages : [...w.messages, msg],
                unreadCount: isFocused ? 0 : w.unreadCount + 1,
                isOpen: true,
                isMinimized: false,
                displayMode: (w.displayMode === 'maximized' ? 'maximized' : 'floating') as ConversationDisplayMode,
              }
            : w
        )
      );
    } else {
      this.openWindows.push({
        conversationId,
        partnerId,
        partnerNickname,
        partnerAvatar,
        isMinimized: false,
        isMaximized: false,
        displayMode: 'floating',
        messages: persistence.getMessages(conversationId),
        unreadCount: 1,
        draft: '', 
        isOpen: true,
      });
      this.openWindows = consolidateWindows(this.openWindows);
    }
  }

  syncPolling(conversationId: string, serverMessages: ChatMessage[]) {
    this.openWindows = consolidateWindows(
      this.openWindows.map((w) => {
        if (w.conversationId !== conversationId) return w;
        const existingIds = new Set(w.messages.map(m => m.id));
        const newMessages = serverMessages.filter(m => !existingIds.has(m.id));
        return {
          ...w,
          messages: [...w.messages, ...newMessages].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()),
        };
      })
    );
  }

  maximizeChat(conversationId: string) {
    this.openWindows = consolidateWindows(
      this.openWindows.map((w) =>
        w.conversationId === conversationId ? { ...w, displayMode: 'maximized', isMaximized: true, isMinimized: false } : w
      )
    );
  }

  minimizeChat(conversationId: string) {
    this.openWindows = consolidateWindows(
      this.openWindows.map((w) => {
        if (w.conversationId !== conversationId) return w;
        if (w.displayMode === 'maximized') {
          return { ...w, displayMode: 'floating', isMaximized: false, isMinimized: false };
        }
        return { ...w, isMinimized: !w.isMinimized };
      })
    );
  }
}

function runConsolidationUnitTests() {
  console.log('\n--- Running Production consolidateWindows() Unit Tests (15 Assertions) ---');

  const now = '2026-11-08T10:00:00Z';
  const later = '2026-11-08T10:01:00Z';

  const m1: ChatMessage = { id: 'm1', conversationId: 'conv_1_2', senderId: 'u1', senderNickname: 'User1', content: 'Hello', timestamp: now };
  const m2: ChatMessage = { id: 'm2', conversationId: 'conv_1_2', senderId: 'u2', senderNickname: 'User2', content: 'World', timestamp: later };
  const mDup: ChatMessage = { id: 'm1', conversationId: 'conv_1_2', senderId: 'u1', senderNickname: 'User1', content: 'Hello (dup)', timestamp: now };

  const input: FloatingChatWindow[] = [
    { conversationId: 'conv_1_2', partnerId: 'u2', partnerNickname: 'User2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [m2], unreadCount: 1, draft: 'Draft A', isOpen: true },
    { conversationId: 'conv_1_2', partnerId: 'u2', partnerNickname: 'User2', partnerAvatar: '👤', isMinimized: true, isMaximized: false, displayMode: 'floating', messages: [m1, mDup], unreadCount: 2, draft: '', isOpen: true }
  ];

  const consolidated = consolidateWindows(input);

  assert(consolidated.length === 1, 'Assertion 1: Same conversation ID produces one canonical window');
  assert(consolidateWindows(consolidated).length === 1, 'Assertion 2: Repeated consolidation is idempotent');
  assert(consolidated[0].conversationId === 'conv_1_2', 'Assertion 3: Conversation ID preservation');
  
  const winOther: FloatingChatWindow = { conversationId: 'conv_1_3', partnerId: 'u3', partnerNickname: 'User3', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [], unreadCount: 0, draft: '', isOpen: true };
  assert(consolidateWindows([...input, winOther]).length === 2, 'Assertion 4: Different conversations remain separate');
  
  assert(consolidateWindows([
    { ...winOther, conversationId: 'A', partnerId: 'B' },
    { ...winOther, conversationId: 'B', partnerId: 'C' }
  ]).length === 2, 'Assertion 5: Conversation identity collision safety');

  assert(consolidated[0].messages.length === 2, 'Assertion 6: Message ID deduplication (exactly 2 unique)');
  assert(consolidated[0].messages.some(m => m.id === 'm1') && consolidated[0].messages.some(m => m.id === 'm2'), 'Assertion 7: No message loss during merge');
  assert(consolidated[0].messages[0].id === 'm1' && consolidated[0].messages[1].id === 'm2', 'Assertion 8: Messages are sorted chronologically');

  const badMsg: ChatMessage = { id: 'bm1', conversationId: 'conv_1_2', senderId: 'u1', content: 'Bad time', timestamp: 'invalid-date' };
  assert(consolidateWindows([{ ...input[0], messages: [badMsg, m2] }])[0].messages.length === 2, 'Assertion 9: Invalid timestamps do not crash consolidation');

  assert(consolidated[0].draft === 'Draft A', 'Assertion 10: Draft content preservation');
  assert(consolidated[0].unreadCount === 2, 'Assertion 11: Unread count preservation (max behavior)');
  assert(consolidated[0].displayMode === 'floating', 'Assertion 12: Display mode preservation');
  assert(consolidated[0].isOpen === true, 'Assertion 13: Open state preservation');
  assert(consolidated[0].isMinimized === false, 'Assertion 14: Minimized state preservation (preferring restored)');

  const repeatedOpen = consolidateWindows([...consolidated, consolidated[0]]);
  assert(repeatedOpen.length === 1, 'Assertion 15: Repeated open/consolidation calls do not duplicate windows');

  console.log('--- ID Migration & Legacy Support Unit Tests ---');
  const legacyId = 'conv_1_2';
  const uuidId = '12345678-1234-1234-1234-1234567890ab';
  const legacyWin: FloatingChatWindow = { conversationId: legacyId, partnerId: '2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [], unreadCount: 0, draft: '', isOpen: true };
  const uuidWin: FloatingChatWindow = { conversationId: uuidId, partnerId: '2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [], unreadCount: 0, draft: '', isOpen: true };
  
  const merged = consolidateWindows([legacyWin, uuidWin]);
  assert(merged.length === 1, 'Assertion 16: Legacy and UUID windows for same partnerId consolidate');
  assert(merged[0].conversationId === uuidId, 'Assertion 17: Consolidation prefers UUID format over legacy');
}

async function runRegressionSuite() {
  runConsolidationUnitTests();

  console.log('\n--- Running Detailed Private Message Lifecycle Tests (21 Assertions) ---');

  const idA = 'u_sender';
  const idB = 'u_partner';
  const convId = await mockDatabaseService.getDeterministicConvId(idA, idB);

  const clientA = new ChatClientSimulation(idA, 'Sender', '⚡');
  const clientB = new ChatClientSimulation(idB, 'Partner', '🌸');

  // L1-L2: Start DM
  await clientA.openChat({ id: idB, nickname: 'Partner', avatar: '🌸' });
  assert(clientA.floatingWindowsRendered.length === 1, 'L1: Starting a DM creates exactly one conversation window');
  assert(clientA.floatingWindowsRendered[0].displayMode === 'floating', 'L2: Initial mode is floating');

  // L3-L5: Optimistic & Reconciliation
  const { tempId } = clientA.sendMessage(convId, 'Test');
  assert(clientA.openWindows[0].messages.length === 1, 'L3: Optimistic message insertion');
  const persisted: ChatMessage = { id: 'm_real_1', conversationId: convId, senderId: idA, senderNickname: 'Sender', content: 'Test', timestamp: new Date().toISOString(), status: 'delivered' };
  clientA.handleSendSuccess(convId, tempId, persisted);
  assert(clientA.openWindows[0].messages[0].id === 'm_real_1', 'L4: Backend message ID reconciliation');
  assert(!clientA.openWindows[0].messages[0].id.startsWith('temp_'), 'L5: Temp ID replaced');

  // L6: Sender Echo
  clientA.handleIncomingEcho(persisted, convId);
  assert(clientA.openWindows[0].messages.length === 1, 'L6: Sender\'s own realtime echo deduplication');

  // L7: Realtime/Polling Sync
  clientA.syncPolling(convId, [persisted]);
  assert(clientA.openWindows[0].messages.length === 1, 'L7: Realtime/Polling sync deduplication');

  // L8-L10: Maximize transition & Mutual Exclusivity (Forward)
  assert(clientA.floatingWindowsRendered.some(w => w.conversationId === convId), 'Pre-Maximize: Conversation is floating');
  clientA.maximizeChat(convId);
  assert(clientA.floatingWindowsRendered.length === 0, 'L8: Maximize: Floating renderer count is zero');
  assert(clientA.maximizedTabsRendered.length === 1, 'L9: Maximize: Maximized renderer count is exactly one');
  assert(clientA.maximizedTabsRendered.some(w => w.conversationId === convId), 'L10: Correct conversation maximized');
  assert(!clientA.floatingWindowsRendered.some(w => w.conversationId === convId), 'L10.1: Maximized conversation removed from floating renderer');

  // L11-L12: Minimize transition & Mutual Exclusivity (Backward)
  clientA.minimizeChat(convId);
  assert(clientA.floatingWindowsRendered.length === 1, 'L11: Minimize from maximized: returns to floating mode');
  assert(clientA.maximizedTabsRendered.length === 0, 'L12: Minimize from maximized: Maximized renderer count is zero');
  assert(clientA.floatingWindowsRendered.some(w => w.conversationId === convId), 'L12.1: Conversation returned to floating renderer');

  // L13-L14: Restore from minimized
  clientA.minimizeChat(convId); // Set minimized (true)
  assert(clientA.openWindows[0].isMinimized === true, 'L13: Window is minimized');
  await clientA.openChat({ id: idB, nickname: 'Partner', avatar: '🌸' }); // Restore (re-open focuses it)
  assert(clientA.openWindows[0].isMinimized === false, 'L14: Restore from minimized state upon focusing');
  assert(clientA.floatingWindowsRendered.some(w => w.conversationId === convId), 'L14.1: Restored window visible in floating renderer');

  // L15-L17: Close and Reopen (History Restoration modeling)
  clientA.closeChat(convId);
  assert(clientA.openWindows.length === 0, 'L15: Close removes window from active collection (Matches Production)');
  await clientA.openChat({ id: idB, nickname: 'Partner', avatar: '🌸' });
  assert(clientA.openWindows.length === 1, 'L16: Reopen creates window');
  assert(clientA.openWindows[0].messages.length === 1 && clientA.openWindows[0].messages[0].id === 'm_real_1', 'L17: History restored from behavioral model persistence layer');

  // L18-L19: Receiver Auto-open
  clientB.handleIncomingMessage(persisted, convId, { id: idA, nickname: 'Sender', avatar: '⚡' });
  assert(clientB.floatingWindowsRendered.length === 1, 'L18: Incoming DM automatically opens floating window');
  assert(clientB.openWindows[0].unreadCount === 1, 'L19: Unread count correct for non-focused incoming');

  // L20: Draft Behavior (Matches Production Implementation)
  // Verification: Drafts are NOT preserved across close/reopen cycle in Production.
  clientB.openWindows[0].draft = 'Unfinished thoughts';
  clientB.closeChat(convId);
  assert(clientB.openWindows.length === 0, 'L20.1: Window removed on close (Draft wiped from active state)');
  await clientB.openChat({ id: idA, nickname: 'Sender', avatar: '⚡' });
  assert(clientB.openWindows[0].draft === '', 'L20.2: Draft is empty upon reopening (Matches Production openChat logic)');

  // L21: Dual State Invariant (Global cross-check)
  const isBoth = clientA.floatingWindowsRendered.some(w => clientA.maximizedTabsRendered.some(mw => mw.conversationId === w.conversationId));
  assert(!isBoth, 'L21: Mutual exclusivity global invariant holds (No conversation in both collections simultaneously)');

  console.log('\n--- Running Deduplication & ID Migration Regression Tests (3 Assertions) ---');
  // L22: Legacy Open -> Incoming UUID DM
  const clientC = new ChatClientSimulation('u_c', 'ClientC', 'C');
  const partnerD = { id: 'u_d', nickname: 'PartnerD', avatar: 'D' };
  const legacyConvId = `conv_${['u_c', 'u_d'].sort().join('_')}`;
  const uuidConvId = await mockDatabaseService.getDeterministicConvId('u_c', 'u_d');

  // Simulate manual open with legacy ID (e.g. from old state)
  clientC.openWindows.push({
    conversationId: legacyConvId,
    partnerId: partnerD.id,
    partnerNickname: partnerD.nickname,
    partnerAvatar: partnerD.avatar,
    isMinimized: false,
    isMaximized: false,
    displayMode: 'floating',
    messages: [],
    unreadCount: 0,
    draft: 'Legacy draft',
    isOpen: true,
  });

  // Receive DM with UUID
  const msgD: ChatMessage = { id: 'msg_d_1', conversationId: uuidConvId, senderId: partnerD.id, senderNickname: partnerD.nickname, content: 'Hi from UUID', timestamp: new Date().toISOString() };
  clientC.handleIncomingMessage(msgD, uuidConvId, partnerD);
  
  assert(clientC.openWindows.length === 1, 'L22: Legacy and UUID entries for the same partner are consolidated into one window');
  assert(clientC.openWindows[0].conversationId === uuidConvId, 'L23: Window ID is migrated to canonical UUID');
  assert(clientC.openWindows[0].messages.length === 1 && clientC.openWindows[0].messages[0].id === 'msg_d_1', 'L24: Messages are preserved during ID migration');

  console.log('\n--- Running Route & Source Regression Tests (4 Assertions) ---');
  // Reading actual production component source code for verification
  const source = fs.readFileSync(new URL('../src/components/chat/FloatingChatManager.tsx', import.meta.url), 'utf-8');
  
  assert(!source.includes("import { useRouter } from '../../context/RouterContext'"), 'S1: Source Verification: useRouter import removed');
  assert(!source.includes("currentRoute === '/messages'"), 'S2: Source Verification: Route gate removed from rendering conditions');
  assert(source.includes('w-[min(360px,calc(100vw-24px))]'), 'S3: Responsive width 360px verified in source');
  assert(source.includes('sm:h-[480px]'), 'S4: Responsive height constraints verified in source');

  console.log(`\n================================================================================`);
  console.log(`   ALL REGRESSION TESTS PASSED (Total Assertions: ${assertionCount})`);
  console.log(`================================================================================\n`);
}

runRegressionSuite().catch((err) => {
  console.error('Regression suite failed:', err);
  process.exit(1);
});
