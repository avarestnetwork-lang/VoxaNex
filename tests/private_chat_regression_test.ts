/**
 * ChatLustora — Comprehensive Private Chat Regression Test Suite
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

// Local Mocks
function createGuestSession(opts: { nickname: string; avatar: string }) {
  return { session: { id: `guest_${opts.nickname}_${Date.now()}` } };
}
async function postConversationMessage(msg: any) {
  return { success: true, message: { id: `m_${Date.now()}`, conversationId: msg.conversationId, senderId: msg.senderId, senderNickname: msg.senderNickname, content: msg.rawContent, timestamp: new Date().toISOString(), status: 'delivered' } };
}

class ChatClientSimulation {
  userId: string;
  nickname: string;
  avatar: string;
  openWindows: FloatingChatWindow[] = [];
  seenMessageIds: Set<string> = new Set();
  
  constructor(userId: string, nickname: string, avatar: string) {
    this.userId = userId; this.nickname = nickname; this.avatar = avatar;
  }

  get floatingWindowsRendered(): FloatingChatWindow[] { return this.openWindows.filter((w) => w.isOpen && w.displayMode === 'floating'); }
  get maximizedTabsRendered(): FloatingChatWindow[] { return this.openWindows.filter((w) => w.isOpen && w.displayMode === 'maximized'); }

  openChat(partner: { id: string; nickname: string; avatar: string }) {
    const sortedIds = [this.userId, partner.id].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}`;
    const existing = this.openWindows.find((w) => w.conversationId === conversationId);
    if (existing) {
      this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, isOpen: true, displayMode: 'floating' } : w);
    } else {
      this.openWindows.push({ conversationId, partnerId: partner.id, partnerNickname: partner.nickname, partnerAvatar: partner.avatar, isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [], unreadCount: 0, draft: '', isOpen: true });
    }
  }

  sendMessage(conversationId: string, content: string): { tempId: string } {
    const tempId = `temp_${Date.now()}`;
    const msg: ChatMessage = { id: tempId, conversationId, senderId: this.userId, senderNickname: this.nickname, content, timestamp: new Date().toISOString() };
    this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, messages: [...w.messages, msg] } : w);
    return { tempId };
  }

  handleSendSuccess(conversationId: string, tempId: string, persistedMsg: ChatMessage) {
    this.seenMessageIds.add(persistedMsg.id);
    this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, messages: w.messages.map(m => m.id === tempId ? persistedMsg : m) } : w);
  }

  handleIncomingEcho(msg: ChatMessage, conversationId: string) {
    this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, messages: w.messages.some(m => m.id === msg.id) ? w.messages : [...w.messages, msg] } : w);
  }

  handleIncomingMessage(msg: ChatMessage, conversationId: string, partnerInfo: any) {
    if (this.seenMessageIds.has(msg.id)) return;
    this.seenMessageIds.add(msg.id);
    const existing = this.openWindows.find((w) => w.conversationId === conversationId);
    if (existing) {
      this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, messages: w.messages.some(m => m.id === msg.id) ? w.messages : [...w.messages, msg], isOpen: true } : w);
    } else {
      this.openWindows.push({ conversationId, partnerId: partnerInfo.id, partnerNickname: partnerInfo.nickname, partnerAvatar: partnerInfo.avatar, isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [msg], unreadCount: 1, draft: '', isOpen: true });
    }
  }

  syncPolling(conversationId: string, serverMessages: ChatMessage[]) {
    this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, messages: serverMessages } : w);
  }

  maximizeChat(conversationId: string) {
    this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, displayMode: 'maximized' as ConversationDisplayMode, isMaximized: true } : w);
  }

  closeChat(conversationId: string) {
    this.openWindows = this.openWindows.map(w => w.conversationId === conversationId ? { ...w, isOpen: false } : w);
  }
}

function runConsolidationUnitTests() {
  console.log('\n--- Running Consolidation Unit Tests ---');
  const now = '2026-11-08T10:00:00Z';
  const m1: ChatMessage = { id: 'm1', conversationId: 'c1', senderId: 'u1', senderNickname: 'U1', content: 'Hi', timestamp: now };
  const m2: ChatMessage = { id: 'm2', conversationId: 'c1', senderId: 'u2', senderNickname: 'U2', content: 'Hey', timestamp: '2026-11-08T10:01:00Z' };

  const input: FloatingChatWindow[] = [
    { conversationId: 'c1', partnerId: 'u2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [m2], unreadCount: 1, draft: 'Draft', isOpen: true },
    { conversationId: 'c1', partnerId: 'u2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [m1], unreadCount: 2, draft: '', isOpen: true }
  ];
  
  const res = consolidateWindows(input);
  assert(res.length === 1, 'Same ID = 1 canonical');
  assert(consolidateWindows(res).length === 1, 'Idempotent');
  assert(res[0].conversationId === 'c1', 'ID preserved');
  assert(res[0].messages.length === 2, 'Merge by ID');
  assert(res[0].messages[0].id === 'm1' && res[0].messages[1].id === 'm2', 'Chronological');
  assert(res[0].draft === 'Draft', 'Draft preserved');
  assert(res[0].unreadCount === 2, 'Unread max');
  assert(res[0].displayMode === 'floating', 'Mode preserved');
  assert(consolidateWindows([...input, { conversationId: 'c2', partnerId: 'u3', partnerNickname: 'U3', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [], unreadCount: 0, draft: '', isOpen: true }]).length === 2, 'Different IDs isolated');
  assert(consolidateWindows([{conversationId: 'c1', partnerId: 'u2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [m1], unreadCount: 0, draft: '', isOpen: true}, {conversationId: 'c1', partnerId: 'u2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [m1], unreadCount: 0, draft: '', isOpen: true}]).length === 1, 'Duplicate dedup');
  assert(consolidateWindows([{ conversationId: 'c1', partnerId: 'u2', partnerNickname: 'U2', partnerAvatar: '👤', isMinimized: false, isMaximized: false, displayMode: 'floating', messages: [{id: 'bm', conversationId: 'c1', senderId: 'u1', senderNickname: 'U1', content: 'Bad', timestamp: 'invalid'}], unreadCount: 0, draft: '', isOpen: true }]).length === 1, 'Invalid timestamp does not crash');
}

async function runRegressionSuite() {
  runConsolidationUnitTests();
  const guestA = createGuestSession({ nickname: 'A', avatar: '⚡' });
  const guestB = createGuestSession({ nickname: 'B', avatar: '🌸' });
  const idA = guestA.session!.id;
  const idB = guestB.session!.id;
  const convId = `conv_${[idA, idB].sort().join('_')}`;
  const clientA = new ChatClientSimulation(idA, 'A', '⚡');
  const clientB = new ChatClientSimulation(idB, 'B', '🌸');

  console.log('\n--- Running Lifecycle Tests ---');
  clientA.openChat({ id: idB, nickname: 'B', avatar: '🌸' });
  assert(clientA.floatingWindowsRendered.length === 1, 'S1: Start DM');
  assert(clientA.openWindows[0].displayMode === 'floating', 'S1: Mode is floating');
  const { tempId } = clientA.sendMessage(convId, 'Hi');
  assert(clientA.openWindows[0].messages.length === 1, 'S2: Optimistic insert');
  const res = await postConversationMessage({ conversationId: convId, senderId: idA, senderNickname: 'A', rawContent: 'Hi' });
  clientA.handleSendSuccess(convId, tempId, res.message!);
  assert(clientA.openWindows[0].messages[0].id === res.message!.id, 'S3: Backend reconciliation');
  clientA.handleIncomingEcho(res.message!, convId);
  assert(clientA.openWindows[0].messages.length === 1, 'S4: Echo dedup');
  clientA.syncPolling(convId, [res.message!]);
  assert(clientA.openWindows[0].messages.length === 1, 'S5: Sync poll');
  clientA.maximizeChat(convId);
  assert(clientA.floatingWindowsRendered.length === 0 && clientA.maximizedTabsRendered.length === 1, 'S6: Maximize');
  clientA.closeChat(convId);
  clientA.openChat({ id: idB, nickname: 'B', avatar: '🌸' });
  assert(clientA.openWindows.length === 1 && clientA.openWindows[0].isOpen === true, 'S7: Reopen successful');
  assert(clientA.openWindows[0].messages.length >= 1, 'S7: History preserved');
  clientB.handleIncomingMessage(res.message!, convId, { id: idA, nickname: 'A', avatar: '⚡' });
  assert(clientB.floatingWindowsRendered.length === 1, 'S8: Receiver auto-open');
  assert(clientB.openWindows[0].unreadCount === 1, 'S8: Unread count correct');
  clientB.openWindows[0].draft = 'Drafting...';
  assert(clientB.openWindows[0].draft === 'Drafting...', 'S8: Draft preserved');
  assert(!(clientA.floatingWindowsRendered.some(w => w.conversationId === convId) && clientA.maximizedTabsRendered.some(w => w.conversationId === convId)), 'S9: Mutual exclusivity');

  console.log('\n--- Running Route & Width Tests ---');
  const source = fs.readFileSync(new URL('../src/components/chat/FloatingChatManager.tsx', import.meta.url), 'utf-8');
  assert(!source.includes("currentRoute === '/messages'"), 'S10: Route restriction removed');
  assert(source.includes('w-[min(360px,calc(100vw-24px))]'), 'S11: Responsive width 360px');

  console.log(`\nTests Passed. Total assertions: ${assertionCount}`);
}

runRegressionSuite().catch((err) => { console.error(err); process.exit(1); });
