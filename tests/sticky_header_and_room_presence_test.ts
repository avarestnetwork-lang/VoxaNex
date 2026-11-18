import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { Navbar } from '../src/components/layout/Navbar';
import { RoomDirectoryPage } from '../src/pages/RoomDirectoryPage';
import { LanguageProvider } from '../src/context/LanguageContext';
import { AuthProvider } from '../src/context/AuthContext';
import { RouterProvider } from '../src/context/RouterContext';
import { ROOMS_CONFIG } from '../src/config/voxanexConfig';
import {
  databaseService,
  extractActivePresenceMembers,
  RoomPresenceMember,
  RoomPresenceSyncStatus,
} from '../src/services/databaseService';
import { resolveRoomPresenceBadge } from '../src/hooks/useRoomPresenceCounts';

let totalAssertions = 0;

if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

function assert(condition: boolean, message: string) {
  totalAssertions++;
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] ${message}`);
}

/**
 * Deterministic stateful mock for Supabase Realtime Client & Presence channels
 */
class MockRealtimePresenceServer {
  // channelName -> presenceKey -> array of payloads
  private roomStates = new Map<string, Map<string, any[]>>();
  private activeChannelsByTopic = new Map<string, Set<MockRealtimeChannel>>();

  getState(channelName: string): Record<string, any[]> {
    const map = this.roomStates.get(channelName);
    if (!map) return {};
    const out: Record<string, any[]> = {};
    map.forEach((arr, k) => {
      if (arr.length > 0) out[k] = arr.map((x) => ({ ...x }));
    });
    return out;
  }

  registerChannel(channel: MockRealtimeChannel) {
    if (!this.activeChannelsByTopic.has(channel.topic)) {
      this.activeChannelsByTopic.set(channel.topic, new Set());
    }
    this.activeChannelsByTopic.get(channel.topic)!.add(channel);
  }

  unregisterChannel(channel: MockRealtimeChannel) {
    this.activeChannelsByTopic.get(channel.topic)?.delete(channel);
  }

  track(channelName: string, key: string, payload: any, refTag = 'ref-1') {
    if (!this.roomStates.has(channelName)) {
      this.roomStates.set(channelName, new Map());
    }
    const map = this.roomStates.get(channelName)!;
    const existing = map.get(key) || [];
    const filtered = existing.filter((x) => x.__ref !== refTag);
    filtered.push({ ...payload, __ref: refTag });
    map.set(key, filtered);
    this.broadcastSync(channelName);
  }

  untrack(channelName: string, key: string, refTag?: string) {
    const map = this.roomStates.get(channelName);
    if (!map) return;
    if (!refTag) {
      map.delete(key);
    } else {
      const remaining = (map.get(key) || []).filter((x) => x.__ref !== refTag);
      if (remaining.length === 0) map.delete(key);
      else map.set(key, remaining);
    }
    this.broadcastSync(channelName);
  }

  broadcastSync(channelName: string) {
    const listeners = this.activeChannelsByTopic.get(channelName);
    if (!listeners) return;
    listeners.forEach((ch) => {
      if (ch.subscribed) {
        ch.triggerPresence('sync');
      }
    });
  }

  broadcastEvent(channelName: string, event: 'sync' | 'join' | 'leave') {
    const listeners = this.activeChannelsByTopic.get(channelName);
    if (!listeners) return;
    listeners.forEach((ch) => {
      if (ch.subscribed) {
        ch.triggerPresence(event);
      }
    });
  }
}

class MockRealtimeChannel {
  public topic: string;
  public params: any;
  public subscribed = false;
  public removed = false;
  public trackCount = 0;
  public untrackCount = 0;
  public subscribeCount = 0;
  private presenceHandlers = new Map<string, Array<() => void>>();
  private server: MockRealtimePresenceServer;
  private refId: string;

  constructor(topic: string, params: any, server: MockRealtimePresenceServer, refId: string) {
    this.topic = topic;
    this.params = params || {};
    this.server = server;
    this.refId = refId;
  }

  on(type: string, filter: { event: string }, cb: (...args: any[]) => void) {
    if (type === 'presence') {
      const ev = filter.event;
      if (!this.presenceHandlers.has(ev)) this.presenceHandlers.set(ev, []);
      this.presenceHandlers.get(ev)!.push(cb);
    }
    return this;
  }

  presenceState() {
    return this.server.getState(this.topic);
  }

  async track(payload: any) {
    this.trackCount++;
    const key = this.params?.config?.presence?.key || payload?.id || this.refId;
    this.server.track(this.topic, key, payload, this.refId);
    return 'ok';
  }

  async untrack() {
    this.untrackCount++;
    const key = this.params?.config?.presence?.key || this.refId;
    this.server.untrack(this.topic, key, this.refId);
    return 'ok';
  }

  subscribe(cb?: (status: string, err?: any) => void) {
    this.subscribeCount++;
    this.subscribed = true;
    this.server.registerChannel(this);
    cb?.('SUBSCRIBED');
    return this;
  }

  emitStatus(status: string, err?: any, cb?: (s: string, e?: any) => void) {
    cb?.(status, err);
  }

  triggerPresence(event: string) {
    const handlers = this.presenceHandlers.get(event) || [];
    handlers.forEach((h) => h());
  }
}

class MockSupabaseClient {
  public channelsCreated: MockRealtimeChannel[] = [];
  public removedChannels: MockRealtimeChannel[] = [];
  private activeByTopic = new Map<string, MockRealtimeChannel>();
  private server: MockRealtimePresenceServer;
  private clientTag: string;
  private failWithStatus: string | null = null;

  constructor(server: MockRealtimePresenceServer, clientTag: string, failWithStatus: string | null = null) {
    this.server = server;
    this.clientTag = clientTag;
    this.failWithStatus = failWithStatus;
  }

  channel(topic: string, params?: any): MockRealtimeChannel {
    const existing = this.activeByTopic.get(topic);
    if (existing && !existing.removed) {
      return existing;
    }
    const ch = new MockRealtimeChannel(topic, params, this.server, `${this.clientTag}-${topic}`);
    if (this.failWithStatus) {
      const failStatus = this.failWithStatus;
      ch.subscribe = ((cb?: (status: string, err?: any) => void) => {
        ch.subscribeCount++;
        cb?.(failStatus, new Error(`Mock ${failStatus}`));
        return ch;
      }) as any;
    }
    this.activeByTopic.set(topic, ch);
    this.channelsCreated.push(ch);
    return ch;
  }

  removeChannel(channel: MockRealtimeChannel) {
    channel.removed = true;
    channel.subscribed = false;
    this.server.unregisterChannel(channel);
    this.activeByTopic.delete(channel.topic);
    this.removedChannels.push(channel);
    return Promise.resolve('ok');
  }
}

async function runTests() {
  console.log('\n====================================================================');
  console.log('  CHATLUSTORA: STICKY HEADER & REAL-TIME ROOM PRESENCE TEST SUITE');
  console.log('====================================================================\n');

  // -------------------------------------------------------------------------
  // PART 1: TASK A — STICKY HEADER & CSS OVERFLOW ARCHITECTURE
  // -------------------------------------------------------------------------
  console.log('--- Part 1: Global Sticky Header Architecture & Render Checks ---');

  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  const navbarSource = fs.readFileSync(path.resolve('src/components/layout/Navbar.tsx'), 'utf-8');
  const modalSource = fs.readFileSync(path.resolve('src/components/ui/Modal.tsx'), 'utf-8');
  const indexCssSource = fs.readFileSync(path.resolve('src/index.css'), 'utf-8');
  const publicChatSource = fs.readFileSync(path.resolve('src/pages/PublicChatPage.tsx'), 'utf-8');

  assert(
    appSource.includes('overflow-x-clip') && !appSource.includes('overflow-x-hidden'),
    '1.1 App.tsx root container uses overflow-x-clip instead of overflow-x-hidden (preserving position: sticky)'
  );
  assert(
    !indexCssSource.includes('overflow-x: hidden') && !indexCssSource.includes('overflow: hidden'),
    '1.2 index.css does not break sticky positioning on html/body'
  );
  assert(
    navbarSource.includes('<header className="sticky top-0 z-40'),
    '1.3 Navbar.tsx renders a sticky top-0 z-40 global <header>'
  );
  assert(
    navbarSource.includes('max-h-[calc(100vh-4.25rem)] overflow-y-auto'),
    '1.4 Navbar.tsx mobile menu dropdown is viewport-bounded and scrollable inside sticky header'
  );
  assert(
    modalSource.includes('z-50'),
    '1.5 Modal overlay uses z-50 so modals layer cleanly above sticky header (z-40)'
  );
  assert(
    publicChatSource.includes('h-[calc(100vh-5.5rem)]'),
    '1.6 PublicChatPage maintains its responsive workspace height calculation below sticky header'
  );

  const navbarHtml = renderToString(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(RouterProvider, null, React.createElement(Navbar, null))
      )
    )
  );
  const headerMatches = navbarHtml.match(/<header\b/g) || [];
  assert(headerMatches.length === 1, '1.7 Navbar renders exactly one <header> element (no duplicate header)');
  assert(
    navbarHtml.includes('sticky top-0 z-40') &&
      navbarHtml.includes('Home') &&
      navbarHtml.includes('Rooms') &&
      navbarHtml.includes('Dating') &&
      navbarHtml.includes('Register'),
    '1.8 Navbar SSR output retains sticky positioning and all navigation controls'
  );

  // -------------------------------------------------------------------------
  // PART 2: TASK B — REAL-TIME SUPABASE ROOM PRESENCE & DIRECTORY COUNTS
  // -------------------------------------------------------------------------
  console.log('\n--- Part 2: Real-Time Room Presence & Directory Count Scenarios ---');

  // 2.1 Pure extractor deduplication, malformed identity & stealth filtering
  const extracted = extractActivePresenceMembers({
    'guest-1': [
      { id: 'guest-1', nickname: 'GuestOne', avatar: '⚡', isGuest: true, lastSeen: 100 },
      { id: 'guest-1', nickname: 'GuestOne', avatar: '⚡', isGuest: true, lastSeen: 200 },
    ],
    'member-2': [
      { id: 'member-2', nickname: 'StealthUser', isGuest: false, onlineVisibility: 'stealth_invisible', lastSeen: 150 },
    ],
    'member-3': [
      { id: 'member-3', nickname: 'VisibleMember', isGuest: false, onlineVisibility: 'online', lastSeen: 180 },
    ],
    '': [{ id: '', nickname: 'Broken' }],
  });
  assert(
    extracted.length === 2 &&
      extracted.some((m) => m.id === 'guest-1' && m.lastSeen === 200) &&
      extracted.some((m) => m.id === 'member-3') &&
      !extracted.some((m) => m.id === 'member-2'),
    '2.1 extractActivePresenceMembers deduplicates duplicate presence_refs, drops invalid IDs, and excludes stealth_invisible users'
  );

  // 2.2 Passive observation on /rooms never calls track() and initializes empty rooms at 0
  const server = new MockRealtimePresenceServer();
  const directoryClient = new MockSupabaseClient(server, 'dir-browser');
  let latestSnapshot: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } = {
    counts: {},
    statuses: {},
  };

  const allRoomIds = ROOMS_CONFIG.map((r) => r.id);
  const unsubDirectory = databaseService.observeRoomsPresence(
    allRoomIds,
    (snap) => {
      latestSnapshot = snap;
    },
    directoryClient
  );

  const anyTrackCalledOnDirectory = directoryClient.channelsCreated.some((c) => c.trackCount > 0);
  assert(
    !anyTrackCalledOnDirectory && directoryClient.channelsCreated.length === allRoomIds.length,
    '2.2 Visiting /rooms observes all canonical room channels passively without calling channel.track()'
  );
  assert(
    latestSnapshot.statuses['room-bangla'] === 'synced' &&
      latestSnapshot.counts['room-bangla'] === 0 &&
      latestSnapshot.counts['room-sex'] === 0,
    '2.3 Empty rooms report synced status and exact 0 count (never negative or hardcoded)'
  );

  // 2.3 Guest 1 enters room-bangla -> count becomes 1
  const guest1Client = new MockSupabaseClient(server, 'guest1-browser');
  let guest1Members: RoomPresenceMember[] = [];
  const unsubGuest1 = databaseService.trackPresence(
    'room-bangla',
    { id: 'guest-1', nickname: 'GuestOne', avatar: '⚡', isGuest: true, onlineVisibility: 'online' },
    (m) => {
      guest1Members = m;
    },
    guest1Client
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 1 &&
      latestSnapshot.counts['room-sex'] === 0 &&
      guest1Members.length === 1,
    '2.4 Guest 1 joining room-bangla updates /rooms count to 1 while unrelated rooms stay 0'
  );

  // 2.4 Guest 2 enters same room -> count becomes 2
  const guest2Client = new MockSupabaseClient(server, 'guest2-browser');
  const unsubGuest2 = databaseService.trackPresence(
    'room-bangla',
    { id: 'guest-2', nickname: 'GuestTwo', avatar: '🔥', isGuest: true, onlineVisibility: 'online' },
    () => {},
    guest2Client
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 2,
    '2.5 Guest 2 joining room-bangla updates /rooms count to 2'
  );

  // 2.5 Guest 3 enters same room -> count becomes 3
  const guest3Client = new MockSupabaseClient(server, 'guest3-browser');
  const unsubGuest3 = databaseService.trackPresence(
    'room-bangla',
    { id: 'guest-3', nickname: 'GuestThree', avatar: '🌟', isGuest: true, onlineVisibility: 'online' },
    () => {},
    guest3Client
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 3,
    '2.6 Guest 3 joining room-bangla updates /rooms count to 3'
  );

  // 2.6 Guest 1 leaves -> count drops to 2
  unsubGuest1();
  assert(
    latestSnapshot.counts['room-bangla'] === 2,
    '2.7 Guest 1 leaving room-bangla decrements /rooms count immediately to 2'
  );

  // 2.7 Cross-room isolation: Member enters room-sex
  const member1Client = new MockSupabaseClient(server, 'member1-browser');
  const unsubMember1Sex = databaseService.trackPresence(
    'room-sex',
    { id: 'member-1', nickname: 'MemberOne', avatar: '💎', isGuest: false, onlineVisibility: 'online' },
    () => {},
    member1Client
  );
  assert(
    latestSnapshot.counts['room-sex'] === 1 && latestSnapshot.counts['room-bangla'] === 2,
    '2.8 Member joining room-sex updates room-sex to 1 without altering room-bangla (2)'
  );

  // 2.8 Guest + Registered Member coexist in room-bangla
  const member2Client = new MockSupabaseClient(server, 'member2-browser');
  const unsubMember2Bangla = databaseService.trackPresence(
    'room-bangla',
    { id: 'member-2', nickname: 'MemberTwo', avatar: '🎭', isGuest: false, onlineVisibility: 'online' },
    () => {},
    member2Client
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 3,
    '2.9 Guest and registered member in same room combine accurately (2 guests + 1 member = 3)'
  );

  // 2.9 Stealth / Invisible user enters room-bangla -> does NOT increment count
  const stealthClient = new MockSupabaseClient(server, 'stealth-browser');
  let stealthObserved: RoomPresenceMember[] = [];
  const unsubStealth = databaseService.trackPresence(
    'room-bangla',
    {
      id: 'member-stealth',
      nickname: 'HiddenUser',
      avatar: '🕶️',
      isGuest: false,
      onlineVisibility: 'stealth_invisible',
    },
    (m) => {
      stealthObserved = m;
    },
    stealthClient
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 3 &&
      stealthObserved.length === 3 &&
      !stealthClient.channelsCreated.some((c) => c.trackCount > 0),
    '2.10 Stealth/invisible user can observe room roster without calling track() or inflating active counts'
  );
  unsubStealth();

  // 2.10 Reconnect / multi-ref for same user ID does NOT double-count
  server.track(
    'public_room_presence:room-bangla',
    'member-2',
    { id: 'member-2', nickname: 'MemberTwo', avatar: '🎭', isGuest: false, onlineVisibility: 'online', lastSeen: 999 },
    'ref-reconnect-2'
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 3,
    '2.11 Duplicate presence_ref during reconnect for same member.id does not double-count (remains 3)'
  );

  // 2.11 Duplicate sync events do not drift count
  server.broadcastEvent('public_room_presence:room-bangla', 'sync');
  server.broadcastEvent('public_room_presence:room-bangla', 'sync');
  assert(
    latestSnapshot.counts['room-bangla'] === 3,
    '2.12 Duplicate sync events keep room count exact at 3'
  );

  // 2.12 Abrupt disconnect drop (e.g. WebSocket heartbeat expiry removing guest-2)
  server.untrack('public_room_presence:room-bangla', 'guest-2');
  assert(
    latestSnapshot.counts['room-bangla'] === 2,
    '2.13 Abrupt socket drop / presence expiry removes departed guest and updates count to 2'
  );

  // 2.13 Remaining users leave -> count drops to 0 cleanly
  server.untrack('public_room_presence:room-bangla', 'member-2');
  unsubMember2Bangla();
  unsubGuest2();
  unsubGuest3();
  unsubMember1Sex();
  assert(
    latestSnapshot.counts['room-bangla'] === 0 && latestSnapshot.counts['room-sex'] === 0,
    '2.14 When all participants leave or log out, counts drop cleanly to 0 and never go negative'
  );

  // 2.14 React Strict Mode mount -> unmount -> remount cleanup
  const strictClient = new MockSupabaseClient(server, 'strict-dir');
  let strictSnap: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } = {
    counts: {},
    statuses: {},
  };
  const strictUnsub1 = databaseService.observeRoomsPresence(
    ['room-bangla', 'room-sex'],
    (s) => {
      strictSnap = s;
    },
    strictClient
  );
  strictUnsub1(); // Strict Mode simulated unmount 1
  assert(
    strictClient.removedChannels.length === 2,
    '2.15 Strict Mode unmount 1 cleans up and removes all subscribed room channels'
  );
  const strictUnsub2 = databaseService.observeRoomsPresence(
    ['room-bangla', 'room-sex'],
    (s) => {
      strictSnap = s;
    },
    strictClient
  );
  const strictMemberClient = new MockSupabaseClient(server, 'strict-user');
  const unsubStrictUser = databaseService.trackPresence(
    'room-bangla',
    { id: 'strict-u1', nickname: 'StrictUser', avatar: '⚡', isGuest: true },
    () => {},
    strictMemberClient
  );
  assert(
    strictSnap.counts['room-bangla'] === 1 && strictSnap.counts['room-sex'] === 0,
    '2.16 Strict Mode remount receives accurate live presence updates without duplicate listeners'
  );
  unsubStrictUser();
  strictUnsub2();
  unsubDirectory();
  assert(
    directoryClient.removedChannels.length === allRoomIds.length,
    '2.17 Leaving /rooms removes all room presence channels cleanly'
  );

  // 2.15 Offline / Error / Unconfigured Supabase handling (no fake numbers)
  let unavailableSnapshot: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } | null = null;
  const unsubUnavail = databaseService.observeRoomsPresence(
    ['room-bangla'],
    (s) => {
      unavailableSnapshot = s;
    },
    null
  );
  unsubUnavail();
  const errorClient = new MockSupabaseClient(server, 'err-dir', 'CHANNEL_ERROR');
  let errorSnapshot: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } | null = null;
  const unsubErr = databaseService.observeRoomsPresence(
    ['room-bangla'],
    (s) => {
      errorSnapshot = s;
    },
    errorClient
  );
  unsubErr();

  const errBadge = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: errorSnapshot?.counts || {},
    statuses: errorSnapshot?.statuses || { 'room-bangla': 'error' },
    language: 'en',
  });
  const connectingBadge = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: {},
    statuses: { 'room-bangla': 'connecting' },
    language: 'en',
  });
  const liveBadgeEn = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: { 'room-bangla': 4 },
    statuses: { 'room-bangla': 'synced' },
    language: 'en',
  });
  const liveBadgeBn = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: { 'room-bangla': 4 },
    statuses: { 'room-bangla': 'synced' },
    language: 'bn',
  });
  assert(
    errBadge.kind === 'unavailable' &&
      errBadge.label === 'Live N/A' &&
      connectingBadge.kind === 'connecting' &&
      connectingBadge.label === '... active' &&
      liveBadgeEn.kind === 'synced' &&
      liveBadgeEn.label === '4 active' &&
      liveBadgeBn.label === '4 সক্রিয়' &&
      unavailableSnapshot !== null,
    '2.18 Badge resolver handles synced (EN/BN), connecting, and unavailable/error states honestly without fake counts'
  );

  // 2.16 RoomDirectoryPage SSR render check
  const roomsHtml = renderToString(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(
        AuthProvider,
        null,
        React.createElement(RouterProvider, null, React.createElement(RoomDirectoryPage, null))
      )
    )
  );
  assert(
    roomsHtml.includes('Main Chatrooms') &&
      roomsHtml.includes('Regional Chatrooms') &&
      roomsHtml.includes('data-room-count-status='),
    '2.19 RoomDirectoryPage renders Main & Regional room grids with live count status badges'
  );

  console.log(`\n🎉 ALL ${totalAssertions} STICKY HEADER & REAL-TIME PRESENCE ASSERTIONS PASSED!`);
}

runTests().catch((err) => {
  console.error('❌ Test suite threw unexpected error:', err);
  process.exit(1);
});
