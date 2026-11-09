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

// Behavioral Model Persistence Layer
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

    const existingIndex = this.openWindows.findIndex((w) => w.conversationId === conversationId || w.partnerId === partner.id);
    
    if (existingIndex >= 0) {
      this.openWindows = this.openWindows.map((w, idx) =>
        idx === existingIndex || w.partnerId === partner.id
          ? {
              ...w,
              conversationId,
              isOpen: true,
              displayMode: 'floating' as ConversationDisplayMode,
              isMaximized: false,
              isMinimized: false,
              unreadCount: 0,
            }
          : w
      );
    } else {
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
    this.openWindows = this.openWindows.filter((w) => w.conversationId !== conversationId);
  }

  handleIncomingMessage(msg: ChatMessage, conversationId: string, partnerInfo?: any) {
    if (!msg || !msg.id) return;

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
                conversationId,
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
}

async function runRegressionSuite() {
  console.log('\n--- Running Detailed Private Message Lifecycle Tests ---');

  const idA = 'u_sender';
  const idB = 'u_partner';
  const convId = await mockDatabaseService.getDeterministicConvId(idA, idB);

  const clientA = new ChatClientSimulation(idA, 'Sender', '⚡');
  const clientB = new ChatClientSimulation(idB, 'Partner', '🌸');

  // L1-L2: Immediate Rendering Fix
  await clientA.openChat({ id: idB, nickname: 'Partner', avatar: '🌸' });
  assert(clientA.floatingWindowsRendered.length === 1, 'L1: Starting a DM creates exactly one conversation window');
  assert(clientA.floatingWindowsRendered[0].isOpen === true, 'L2: Window isOpen is true immediately');
  assert(clientA.floatingWindowsRendered[0].displayMode === 'floating', 'L3: Initial mode is floating');

  // L4: Close Behavior
  clientA.closeChat(convId);
  assert(clientA.openWindows.length === 0, 'L4: Close removes window from active collection');

  // L5: Deduplication & UUID Migration
  const legacyId = 'conv_A_B';
  clientA.openWindows.push({
    conversationId: legacyId,
    partnerId: idB,
    partnerNickname: 'Partner',
    partnerAvatar: '🌸',
    isMinimized: false,
    isMaximized: false,
    displayMode: 'floating',
    messages: [],
    unreadCount: 0,
    draft: '',
    isOpen: true,
  });
  await clientA.openChat({ id: idB, nickname: 'Partner', avatar: '🌸' });
  assert(clientA.openWindows.length === 1, 'L5: Legacy and UUID entries for the same partner are consolidated');
  assert(clientA.openWindows[0].conversationId === convId, 'L6: Window ID is migrated to canonical UUID');

  console.log('\n--- Running Source-Level Responsive & Accessibility Verification ---');
  const paneSource = fs.readFileSync(new URL('../src/components/chat/PrivateChatPane.tsx', import.meta.url), 'utf-8');
  const managerSource = fs.readFileSync(new URL('../src/components/chat/FloatingChatManager.tsx', import.meta.url), 'utf-8');
  
  // Responsive Constraints
  assert(managerSource.includes('w-[min(360px,calc(100vw-24px))]'), 'S1: Responsive width 360px max verified');
  assert(managerSource.includes('h-[82vh]'), 'S2: Desktop height constraint verified');
  
  // Header Responsiveness (Truncation & Flexible Containers)
  assert(paneSource.includes('truncate'), 'S3: Partner nickname uses truncation to handle long names');
  assert(paneSource.includes('min-w-0'), 'S4: Header containers use min-w-0 to prevent layout blow-out');
  
  // Close Button Accessibility & Sizing
  assert(paneSource.includes('aria-label="Close chat"'), 'S5: Close button has descriptive aria-label');
  assert(paneSource.includes('<X className="w-5 h-5" />'), 'S6: Close button icon size increased to w-5 for better visibility');
  
  // Visibility and Transitions
  assert(managerSource.includes('animate-in fade-in'), 'S7: Entry animations added for better immediate visibility perception');

  console.log(`\n================================================================================`);
  console.log(`   ALL REGRESSION TESTS PASSED (Total Assertions: ${assertionCount})`);
  console.log(`================================================================================\n`);
}

runRegressionSuite().catch((err) => {
  console.error('Regression suite failed:', err);
  process.exit(1);
});
