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
  BFCacheValidationResult,
  createRoomPresenceLifecycle,
  PublicChatPage,
  revalidateRoomSessionAndAccess,
} from '../src/pages/PublicChatPage';
import { guestSessionService } from '../src/services/guestSessionService';
import {
  databaseService,
  extractActivePresenceMembers,
  extractAnonymousPresenceCount,
  RoomPresenceMember,
  RoomPresenceSyncStatus,
} from '../src/services/databaseService';
import {
  computeOverallPresenceStatus,
  resolveRoomPresenceBadge,
} from '../src/hooks/useRoomPresenceCounts';

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
  public trackPayloads: any[] = [];
  public untrackCount = 0;
  public subscribeCount = 0;
  private presenceHandlers = new Map<string, Array<() => void>>();
  private statusCallback?: (status: string, err?: any) => void;
  private server: MockRealtimePresenceServer;
  private refId: string;
  private initialStatus: string;

  constructor(
    topic: string,
    params: any,
    server: MockRealtimePresenceServer,
    refId: string,
    initialStatus = 'SUBSCRIBED'
  ) {
    this.topic = topic;
    this.params = params || {};
    this.server = server;
    this.refId = refId;
    this.initialStatus = initialStatus;
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
    this.trackPayloads.push(payload);
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
    this.statusCallback = cb;
    if (this.initialStatus === 'SUBSCRIBED') {
      this.subscribed = true;
      this.server.registerChannel(this);
      cb?.('SUBSCRIBED');
    } else if (this.initialStatus !== 'CONNECTING') {
      this.subscribed = false;
      cb?.(this.initialStatus, new Error(`Mock ${this.initialStatus}`));
    }
    return this;
  }

  simulateStatus(status: string, err?: any) {
    if (status === 'SUBSCRIBED') {
      this.subscribed = true;
      this.server.registerChannel(this);
      this.statusCallback?.('SUBSCRIBED');
    } else {
      this.subscribed = false;
      this.server.unregisterChannel(this);
      this.statusCallback?.(status, err || new Error(`Mock ${status}`));
    }
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
  private topicStatusOverrides: Map<string, string>;

  constructor(
    server: MockRealtimePresenceServer,
    clientTag: string,
    failWithStatus: string | null = null,
    topicStatusOverrides: Map<string, string> = new Map()
  ) {
    this.server = server;
    this.clientTag = clientTag;
    this.failWithStatus = failWithStatus;
    this.topicStatusOverrides = topicStatusOverrides;
  }

  channel(topic: string, params?: any): MockRealtimeChannel {
    const existing = this.activeByTopic.get(topic);
    if (existing && !existing.removed) {
      return existing;
    }
    const override = this.topicStatusOverrides.get(topic);
    const initialStatus = override || this.failWithStatus || 'SUBSCRIBED';
    const ch = new MockRealtimeChannel(
      topic,
      params,
      this.server,
      `${this.clientTag}-${topic}`,
      initialStatus
    );
    this.activeByTopic.set(topic, ch);
    this.channelsCreated.push(ch);
    return ch;
  }

  getChannelByTopic(topic: string): MockRealtimeChannel | undefined {
    return this.activeByTopic.get(topic);
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

class MockWindowEventTarget {
  private listeners = new Map<string, Set<(e: any) => void>>();

  addEventListener(event: string, listener: (e: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  removeEventListener(event: string, listener: (e: any) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  dispatch(event: string, payload?: any) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((fn) => fn(payload));
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
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
    publicChatSource.includes('grid grid-cols-1 grid-rows-[minmax(0,1fr)]') &&
      publicChatSource.includes('h-[clamp(520px,calc(100svh-11.125rem),780px)]') &&
      publicChatSource.includes('md:h-[clamp(600px,calc(100svh-13.625rem),980px)]') &&
      !publicChatSource.includes('10.25rem') &&
      !publicChatSource.includes('12.5rem') &&
      !publicChatSource.includes('min-h-[380px]') &&
      !publicChatSource.includes('max-h-[880px]') &&
      publicChatSource.includes('min-h-0'),
    '1.6 PublicChatPage enforces calculated clamp() viewport workspace height (520-780px mobile, 600-980px md+), grid-rows-[minmax(0,1fr)], and min-h-0 scroll safety without crushed 380px floor'
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
  assert(
    navbarSource.includes('--vx-header-bottom') &&
      navbarSource.includes('headerBarRef') &&
      navbarSource.includes('overscroll-contain'),
    '1.9 Navbar tracks visible top bar bottom offset via --vx-header-bottom and isolates mobile menu scrolling'
  );
  assert(
    navbarSource.includes("e.key === 'Escape'") &&
      navbarSource.includes('setMobileMenuOpen(false)') &&
      navbarSource.includes('[currentRoute]'),
    '1.10 Navbar closes mobile menu automatically on route navigation and Escape key'
  );
  assert(
    navbarSource.includes('min-w-0 shrink') &&
      navbarSource.includes('width={36}') &&
      navbarSource.includes('height={36}') &&
      navbarSource.includes('flex items-center gap-2 shrink-0'),
    '1.11 Navbar prevents narrow-viewport horizontal overflow while preserving 36x36 logo dimensions'
  );
  assert(
    publicChatSource.includes('overflow-x-clip') && !publicChatSource.includes('overflow-x-hidden'),
    '1.12 PublicChatPage outer wrapper uses overflow-x-clip instead of overflow-x-hidden'
  );
  assert(
    publicChatSource.includes('data-testid="central-chatroom-container"') &&
      publicChatSource.includes(
        'className="h-full w-full flex flex-col overflow-hidden border border-slate-800 rounded-2xl bg-[#090d18] relative shadow-2xl min-w-0 min-h-0 ring-1 ring-slate-800/50"'
      ) &&
      publicChatSource.includes('<div className="flex-1 min-h-0 flex overflow-hidden">'),
    '1.13 Central Chatroom Container establishes full-grid-cell relative + overflow-hidden + min-h-0 reference without blocking scroll or top/bottom border alignment'
  );
  assert(
    publicChatSource.includes('absolute inset-y-0 right-0 z-30 lg:static lg:inset-auto lg:z-auto') &&
      !publicChatSource.includes('inset-y-0 right-0 z-40') &&
      !publicChatSource.includes('fixed top-[var(--vx-header-bottom,65px)]'),
    '1.14 Mobile & tablet (<1024px) participant sidebar uses container-relative absolute inset-y-0 right-0 at z-30 and restores static inline layout on lg+ (1024px+)'
  );
  assert(
    publicChatSource.includes('className="absolute inset-0 bg-black/60 backdrop-blur-xs z-20 lg:hidden"') &&
      !publicChatSource.includes('fixed inset-0 bg-black/60') &&
      !publicChatSource.includes('fixed inset-x-0 top-[var(--vx-header-bottom,65px)]'),
    '1.15 Mobile & tablet (<1024px) backdrop uses container-relative absolute inset-0 at z-20 (< sidebar z-30), never covers global sticky navbar, and hides on lg+'
  );
  assert(
    (() => {
      const containerIdx = publicChatSource.indexOf('data-testid="central-chatroom-container"');
      const sidebarIdx = publicChatSource.indexOf('data-testid="public-chat-sidebar"');
      const backdropIdx = publicChatSource.indexOf('data-testid="public-chat-sidebar-backdrop"');
      const bottomAdIdx = publicChatSource.indexOf('slotId="public-chatroom-bottom"');
      return containerIdx > 0 && sidebarIdx > containerIdx && backdropIdx > sidebarIdx && backdropIdx < bottomAdIdx;
    })(),
    '1.16 Both mobile/tablet sidebar and backdrop render inside Central Chatroom Container boundaries (never overlapping outer ads or navbar)'
  );
  assert(
    publicChatSource.includes('translate-x-0') &&
      publicChatSource.includes('translate-x-full lg:translate-x-0') &&
      publicChatSource.includes('aria-label="Close participants sidebar"') &&
      publicChatSource.includes('overflow-y-auto overscroll-contain'),
    '1.17 PublicChatPage preserves slide-in transition, close controls, and independent participant list scrolling'
  );
  assert(
    publicChatSource.includes('w-80 sm:w-84 lg:w-[340px] xl:w-[344px]') &&
      publicChatSource.includes('max-w-full') &&
      publicChatSource.includes('onClick={() => setShowMobileSidebar(false)}'),
    '1.18 Responsive drawer widths (mobile <768px, tablet 768-1023px, desktop 1024px+) and backdrop click-to-close remain intact'
  );
  assert(
    publicChatSource.includes('slotId="public-chatroom-top"') &&
      publicChatSource.includes('slotId="public-chatroom-status-above"') &&
      publicChatSource.includes('slotId="public-chatroom-message-inline"') &&
      publicChatSource.includes('slotId="participant-box-horizontal"') &&
      publicChatSource.includes('slotId="public-chatroom-bottom"') &&
      !publicChatSource.includes('slotId="public-chatroom-body-bottom"') &&
      publicChatSource.includes('slotId="explore-chatrooms-inline"') &&
      publicChatSource.includes('slotId="chatroom-explore-bottom"') &&
      !publicChatSource.includes('slotId="public-chatroom-left"') &&
      !publicChatSource.includes('slotId="public-chatroom-right"'),
    '1.19 PublicChatPage renders all approved active chatroom ad slots and omits Monetag and empty left/right vertical rails'
  );
  assert(
    (() => {
      const topAdIdx = publicChatSource.indexOf('slotId="public-chatroom-top"');
      const chatIdx = publicChatSource.indexOf('data-testid="central-chatroom-container"');
      const bottomAdIdx = publicChatSource.indexOf('slotId="public-chatroom-bottom"');
      const exploreIdx = publicChatSource.indexOf('data-testid="explore-other-chatrooms-section"');
      const exploreBottomIdx = publicChatSource.indexOf('slotId="chatroom-explore-bottom"');
      return (
        publicChatSource.includes('className="relative w-full overflow-x-clip flex flex-col gap-4 py-4"') &&
        (publicChatSource.match(/className="!my-0"/g) || []).length >= 3 &&
        topAdIdx > 0 &&
        chatIdx > topAdIdx &&
        bottomAdIdx > chatIdx &&
        exploreIdx > bottomAdIdx &&
        exploreBottomIdx > exploreIdx
      );
    })(),
    '1.20 PublicChatPage enforces uniform 16px (gap-4 py-4 + !my-0) vertical spacing and strict Top Ad -> Chatroom -> Bottom Ad -> Explore -> Explore Bottom DOM order'
  );

  // -------------------------------------------------------------------------
  // PART 2: PRIVACY-PRESERVING ROOM PRESENCE & RELIABILITY SUITE
  // -------------------------------------------------------------------------
  console.log('\n--- Part 2: Privacy-Preserving Room Presence & Reliability ---');

  // 2.1 Pure extractors: in-room roster vs anonymous count-only extractor
  const extractedMembers = extractActivePresenceMembers({
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
    extractedMembers.length === 2 &&
      extractedMembers.some((m) => m.id === 'guest-1' && m.lastSeen === 200) &&
      extractedMembers.some((m) => m.id === 'member-3') &&
      !extractedMembers.some((m) => m.id === 'member-2'),
    '2.1 In-room roster extractor preserves full member metadata, deduplicates refs, and excludes stealth users'
  );

  const anonCount = extractAnonymousPresenceCount({
    'ephemeral-a': [{}, {}],
    'ephemeral-b': [{}],
    'stealth-bad': [{ onlineVisibility: 'stealth_invisible' }],
    '': [{}],
  });
  assert(
    anonCount === 2,
    '2.2 Anonymous count extractor counts distinct visible presence keys (ignoring duplicate refs & stealth entries)'
  );

  // 2.2 Passive observation on /rooms subscribes ONLY to count-only topics & ignores arbitrary IDs
  const server = new MockRealtimePresenceServer();
  const directoryClient = new MockSupabaseClient(server, 'dir-browser');
  let latestSnapshot: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } = {
    counts: {},
    statuses: {},
  };

  let invalidRoomStatus: RoomPresenceSyncStatus | null = null;
  let invalidRoomCountCalls = 0;
  const unsubInvalid = databaseService.observeRoomPresence(
    'arbitrary-unlisted-room',
    () => {
      invalidRoomCountCalls++;
    },
    (s) => {
      invalidRoomStatus = s;
    },
    directoryClient
  );
  unsubInvalid();
  assert(
    invalidRoomStatus === 'unavailable' &&
      invalidRoomCountCalls === 0 &&
      directoryClient.channelsCreated.length === 0,
    '2.3 observeRoomPresence rejects non-canonical/arbitrary room IDs without subscribing'
  );

  const allRoomIds = ROOMS_CONFIG.map((r) => r.id);
  const unsubDirectory = databaseService.observeRoomsPresence(
    [...allRoomIds, 'arbitrary-fake-room'],
    (snap) => {
      latestSnapshot = snap;
    },
    directoryClient
  );

  const anyTrackCalledOnDirectory = directoryClient.channelsCreated.some((c) => c.trackCount > 0);
  const allTopicsAreCountOnly = directoryClient.channelsCreated.every((c) =>
    c.topic.startsWith('public_room_presence_count:')
  );
  const anyRosterSubscribedByDirectory = directoryClient.channelsCreated.some((c) =>
    c.topic.startsWith('public_room_presence:')
  );
  assert(
    !anyTrackCalledOnDirectory &&
      allTopicsAreCountOnly &&
      !anyRosterSubscribedByDirectory &&
      directoryClient.channelsCreated.length === allRoomIds.length,
    '2.4 /rooms observes ONLY public_room_presence_count:* channels passively (no track(), no roster channel subscription)'
  );
  assert(
    latestSnapshot.statuses['room-bangla'] === 'synced' &&
      latestSnapshot.counts['room-bangla'] === 0 &&
      latestSnapshot.counts['room-sex'] === 0,
    '2.5 Empty synchronized rooms report status=synced and exact count 0 (never unavailable)'
  );

  // 2.3 Guest 1 enters room-bangla -> count=1, in-room roster keeps full member metadata, count topic stays metadata-free
  const guest1Client = new MockSupabaseClient(server, 'guest1-browser');
  let guest1Members: RoomPresenceMember[] = [];
  const unsubGuest1 = databaseService.trackPresence(
    'room-bangla',
    { id: 'guest-1', nickname: 'GuestOne', avatar: '⚡', isGuest: true, gender: 'male', onlineVisibility: 'online' },
    (m) => {
      guest1Members = m;
    },
    guest1Client
  );
  const guest1CountChannel = guest1Client.getChannelByTopic('public_room_presence_count:room-bangla');
  const banglaCountState = server.getState('public_room_presence_count:room-bangla');
  const countKeys = Object.keys(banglaCountState);
  const countEntriesHaveNoPII = countKeys.every((k) => {
    const entries = banglaCountState[k] || [];
    return (
      k !== 'guest-1' &&
      entries.every(
        (e) =>
          e.id === undefined &&
          e.nickname === undefined &&
          e.avatar === undefined &&
          e.gender === undefined &&
          e.isGuest === undefined &&
          e.user_id === undefined
      )
    );
  });
  assert(
    latestSnapshot.counts['room-bangla'] === 1 &&
      latestSnapshot.counts['room-sex'] === 0 &&
      guest1Members.length === 1 &&
      guest1Members[0].nickname === 'GuestOne' &&
      guest1Members[0].isGuest === true &&
      Boolean(guest1CountChannel) &&
      countEntriesHaveNoPII,
    '2.6 /rooms count updates to 1 via empty ephemeral payload (zero PII/userId/guestId) while in-room roster preserves full profile metadata'
  );

  // 2.4 Guest 2 & Guest 3 enter -> count becomes 3
  const guest2Client = new MockSupabaseClient(server, 'guest2-browser');
  const unsubGuest2 = databaseService.trackPresence(
    'room-bangla',
    { id: 'guest-2', nickname: 'GuestTwo', avatar: '🔥', isGuest: true, onlineVisibility: 'online' },
    () => {},
    guest2Client
  );
  const guest3Client = new MockSupabaseClient(server, 'guest3-browser');
  const unsubGuest3 = databaseService.trackPresence(
    'room-bangla',
    { id: 'guest-3', nickname: 'GuestThree', avatar: '🌟', isGuest: true, onlineVisibility: 'online' },
    () => {},
    guest3Client
  );
  assert(
    latestSnapshot.counts['room-bangla'] === 3,
    '2.7 Multiple visible guests entering same room accurately increment /rooms count to 3'
  );

  // 2.5 Guest 1 leaves -> count drops to 2
  unsubGuest1();
  assert(
    latestSnapshot.counts['room-bangla'] === 2,
    '2.8 Guest 1 leaving room-bangla decrements /rooms count immediately to 2'
  );

  // 2.6 Cross-room isolation + Guest & Member coexistence
  const member1Client = new MockSupabaseClient(server, 'member1-browser');
  const unsubMember1Sex = databaseService.trackPresence(
    'room-sex',
    { id: 'member-1', nickname: 'MemberOne', avatar: '💎', isGuest: false, onlineVisibility: 'online' },
    () => {},
    member1Client
  );
  const member2Client = new MockSupabaseClient(server, 'member2-browser');
  let member2Roster: RoomPresenceMember[] = [];
  const unsubMember2Bangla = databaseService.trackPresence(
    'room-bangla',
    { id: 'member-2', nickname: 'MemberTwo', avatar: '🎭', isGuest: false, onlineVisibility: 'online' },
    (m) => {
      member2Roster = m;
    },
    member2Client
  );
  assert(
    latestSnapshot.counts['room-sex'] === 1 &&
      latestSnapshot.counts['room-bangla'] === 3 &&
      member2Roster.length === 3,
    '2.9 Registered members & guests combine accurately per room without cross-room leakage'
  );

  // 2.7 Stealth user observes roster passively without calling track() on roster OR count channel
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
      !stealthClient.channelsCreated.some((c) => c.trackCount > 0) &&
      !stealthClient.channelsCreated.some((c) => c.topic.startsWith('public_room_presence_count:')),
    '2.10 Stealth/invisible user observes in-room roster without calling track() or joining count-only channel'
  );
  unsubStealth();

  // 2.8 Duplicate phx_ref & duplicate sync/join/leave events do not inflate count
  const member2CountChannel = member2Client.getChannelByTopic('public_room_presence_count:room-bangla')!;
  const member2EphemeralKey = member2CountChannel.params.config.presence.key;
  server.track('public_room_presence_count:room-bangla', member2EphemeralKey, {}, 'ref-reconnect-2');
  server.broadcastEvent('public_room_presence_count:room-bangla', 'sync');
  server.broadcastEvent('public_room_presence_count:room-bangla', 'join');
  server.broadcastEvent('public_room_presence_count:room-bangla', 'leave');
  assert(
    latestSnapshot.counts['room-bangla'] === 3,
    '2.11 Duplicate phx_refs and repeated sync/join/leave events keep count exact at 3'
  );

  // 2.9 Abrupt disconnect drops guest-2 -> count drops to 2
  const guest2EphemeralKey = guest2Client.getChannelByTopic('public_room_presence_count:room-bangla')!.params.config.presence.key;
  server.untrack('public_room_presence_count:room-bangla', guest2EphemeralKey);
  assert(
    latestSnapshot.counts['room-bangla'] === 2,
    '2.12 Abrupt socket expiry removes anonymous token and updates /rooms count to 2'
  );

  // 2.9b Multi-visitor cross-browser simulation & room isolation (Bangla Chat vs Indian Chat)
  const directoryVisitorB = new MockSupabaseClient(server, 'dir-visitor-b');
  let visitorBSnap: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } = {
    counts: {},
    statuses: {},
  };
  const unsubVisitorB = databaseService.observeRoomsPresence(
    allRoomIds,
    (snap) => {
      visitorBSnap = snap;
    },
    directoryVisitorB
  );
  assert(
    visitorBSnap.counts['room-bangla'] === 2 && visitorBSnap.counts['room-indian'] === 0,
    '2.12b Second independent /rooms visitor receives identical live synchronized counts without refresh'
  );
  const indianGuestClient = new MockSupabaseClient(server, 'indian-guest');
  const unsubIndianGuest = databaseService.trackPresence(
    'room-indian',
    { id: 'guest-indian-1', nickname: 'IndGuest', avatar: '🪷', isGuest: true, onlineVisibility: 'online' },
    () => {},
    indianGuestClient
  );
  assert(
    latestSnapshot.counts['room-indian'] === 1 &&
      visitorBSnap.counts['room-indian'] === 1 &&
      latestSnapshot.counts['room-bangla'] === 2 &&
      visitorBSnap.counts['room-bangla'] === 2,
    '2.12c Joining room-indian updates all directory visitors in real time while leaving room-bangla isolated'
  );
  unsubIndianGuest();
  assert(
    latestSnapshot.counts['room-indian'] === 0 &&
      visitorBSnap.counts['room-indian'] === 0 &&
      latestSnapshot.counts['room-bangla'] === 2 &&
      visitorBSnap.counts['room-bangla'] === 2,
    '2.12d Leaving room-indian decrements room-indian across both visitors without altering room-bangla'
  );
  unsubVisitorB();

  // 2.10 Stale Count Invalidation on Channel Failure + Recovery on Reconnect (REMEDIATION B)
  const dirBanglaChannel = directoryClient.getChannelByTopic('public_room_presence_count:room-bangla')!;
  const dirSexChannel = directoryClient.getChannelByTopic('public_room_presence_count:room-sex')!;
  assert(
    latestSnapshot.counts['room-bangla'] === 2 &&
      resolveRoomPresenceBadge({
        roomId: 'room-bangla',
        counts: latestSnapshot.counts,
        statuses: latestSnapshot.statuses,
        language: 'en',
      }).label === '2 Active',
    '2.13 Pre-failure badge shows live 2 Active on room-bangla'
  );

  dirBanglaChannel.simulateStatus('CHANNEL_ERROR');
  const staleInvalidatedBadge = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: latestSnapshot.counts,
    statuses: latestSnapshot.statuses,
    language: 'en',
  });
  const defensiveErrorBadge = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: { 'room-bangla': 99 },
    statuses: { 'room-bangla': 'error' },
    language: 'en',
  });
  const defensiveUnavailBadge = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: { 'room-bangla': 99 },
    statuses: { 'room-bangla': 'unavailable' },
    language: 'bn',
  });
  assert(
    latestSnapshot.statuses['room-bangla'] === 'error' &&
      !('room-bangla' in latestSnapshot.counts) &&
      staleInvalidatedBadge.kind === 'unavailable' &&
      staleInvalidatedBadge.count === null &&
      staleInvalidatedBadge.label === 'Live N/A' &&
      defensiveErrorBadge.kind === 'unavailable' &&
      defensiveErrorBadge.label === 'Live N/A' &&
      defensiveUnavailBadge.kind === 'unavailable' &&
      defensiveUnavailBadge.label === 'অনুপলব্ধ' &&
      latestSnapshot.statuses['room-sex'] === 'synced' &&
      latestSnapshot.counts['room-sex'] === 1,
    '2.14 Channel transition to CHANNEL_ERROR clears stale count immediately and refuses stale counts while unaffected rooms remain synced'
  );

  // While room-bangla failed, check overallStatus is 'partial'
  const partialDuringFailure = computeOverallPresenceStatus(allRoomIds, latestSnapshot.statuses);
  assert(
    partialDuringFailure === 'partial',
    '2.15 computeOverallPresenceStatus returns partial (never synced) when 1 room fails and others stay synced'
  );

  // Now simulate participant leaving while offline & channel reconnecting -> restores fresh count 1
  unsubGuest3();
  dirBanglaChannel.simulateStatus('SUBSCRIBED');
  const reconnectedBadge = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: latestSnapshot.counts,
    statuses: latestSnapshot.statuses,
    language: 'en',
  });
  assert(
    latestSnapshot.statuses['room-bangla'] === 'synced' &&
      latestSnapshot.counts['room-bangla'] === 1 &&
      reconnectedBadge.kind === 'synced' &&
      reconnectedBadge.label === '1 Active' &&
      computeOverallPresenceStatus(allRoomIds, latestSnapshot.statuses) === 'synced',
    '2.16 Channel reconnect restores fresh count (1 Active) and recovers overallStatus back to synced'
  );

  // Clean up remaining participants cleanly -> 0
  server.untrack('public_room_presence_count:room-bangla', member2EphemeralKey);
  unsubMember2Bangla();
  unsubGuest2();
  unsubMember1Sex();
  assert(
    latestSnapshot.counts['room-bangla'] === 0 && latestSnapshot.counts['room-sex'] === 0,
    '2.17 Empty synchronized rooms return 0 cleanly'
  );

  // 2.11 Overall Presence Status Matrix (REMEDIATION C)
  const partialOverrides = new Map<string, string>();
  allRoomIds.forEach((id) => {
    partialOverrides.set(`public_room_presence_count:${id}`, id === 'room-bangla' ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
  });
  const partialClient = new MockSupabaseClient(server, 'partial-dir', null, partialOverrides);
  let partialSnap: { counts: Record<string, number>; statuses: Record<string, RoomPresenceSyncStatus> } = {
    counts: {},
    statuses: {},
  };
  const unsubPartial = databaseService.observeRoomsPresence(
    allRoomIds,
    (s) => {
      partialSnap = s;
    },
    partialClient
  );
  const onlyOneSyncedStatus = computeOverallPresenceStatus(allRoomIds, partialSnap.statuses);
  const banglaBadgeInPartial = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: partialSnap.counts,
    statuses: partialSnap.statuses,
    language: 'en',
  });
  const sexBadgeInPartial = resolveRoomPresenceBadge({
    roomId: 'room-sex',
    counts: partialSnap.counts,
    statuses: partialSnap.statuses,
    language: 'en',
  });
  const connectingBadgeCheck = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: {},
    statuses: { 'room-bangla': 'connecting' },
    language: 'en',
  });
  const connectingBadgeBnCheck = resolveRoomPresenceBadge({
    roomId: 'room-bangla',
    counts: {},
    statuses: { 'room-bangla': 'connecting' },
    language: 'bn',
  });
  assert(
    onlyOneSyncedStatus === 'partial' &&
      banglaBadgeInPartial.kind === 'synced' &&
      banglaBadgeInPartial.isLive === false &&
      banglaBadgeInPartial.label === '0 Active' &&
      sexBadgeInPartial.kind === 'unavailable' &&
      sexBadgeInPartial.isLive === false &&
      sexBadgeInPartial.label === 'Live N/A' &&
      connectingBadgeCheck.kind === 'connecting' &&
      connectingBadgeCheck.isLive === false &&
      connectingBadgeCheck.label === 'Syncing...' &&
      connectingBadgeBnCheck.label === 'সিঙ্ক হচ্ছে...',
    '2.18 Badge resolver and overallStatus enforce Active (pos/zero), Syncing..., Live N/A, and partial states'
  );
  unsubPartial();

  const connectingMap: Record<string, RoomPresenceSyncStatus> = {
    'room-bangla': 'synced',
    'room-sex': 'connecting',
  };
  const allUnavailMap: Record<string, RoomPresenceSyncStatus> = {
    'room-bangla': 'unavailable',
    'room-sex': 'unavailable',
  };
  const allErrorMap: Record<string, RoomPresenceSyncStatus> = {
    'room-bangla': 'error',
    'room-sex': 'unavailable',
  };
  assert(
    computeOverallPresenceStatus(['room-bangla', 'room-sex'], connectingMap) === 'connecting' &&
      computeOverallPresenceStatus(['room-bangla', 'room-sex'], allUnavailMap) === 'unavailable' &&
      computeOverallPresenceStatus(['room-bangla', 'room-sex'], allErrorMap) === 'error' &&
      computeOverallPresenceStatus([], {}) === 'unavailable',
    '2.19 Overall status accurately distinguishes connecting, unavailable, error, partial, and synced states'
  );

  // 2.12 Strict Mode mount -> unmount -> remount cleanup & idempotent double-unsub protection
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
  strictUnsub1();
  strictUnsub1(); // repeated cleanup must be strictly idempotent
  assert(
    strictClient.removedChannels.length === 2,
    '2.20 Strict Mode unmount 1 removes all directory count channels idempotently'
  );
  const strictUnsub2 = databaseService.observeRoomsPresence(
    ['room-bangla', 'room-sex'],
    (s) => {
      strictSnap = s;
    },
    strictClient
  );
  const strictMemberClient = new MockSupabaseClient(server, 'strict-user');
  const unsubStrictUserA = databaseService.trackPresence(
    'room-bangla',
    { id: 'strict-u1', nickname: 'StrictUser', avatar: '⚡', isGuest: true },
    () => {},
    strictMemberClient
  );
  const unsubStrictUserB = databaseService.trackPresence(
    'room-bangla',
    { id: 'strict-u1', nickname: 'StrictUser', avatar: '⚡', isGuest: true },
    () => {},
    strictMemberClient
  );
  // Calling cleanup A twice must NOT remove channel while cleanup B is still active!
  unsubStrictUserA();
  unsubStrictUserA();
  assert(
    strictSnap.counts['room-bangla'] === 1 &&
      strictSnap.counts['room-sex'] === 0 &&
      strictMemberClient.removedChannels.length === 0,
    '2.21 Repeated unsubscribe calls do not underflow shared ref-counts while another ref remains active'
  );
  unsubStrictUserB();
  assert(
    strictMemberClient.removedChannels.some((c) => c.topic === 'public_room_presence:room-bangla') &&
      strictMemberClient.removedChannels.some((c) => c.topic === 'public_room_presence_count:room-bangla'),
    '2.22 Leaving chat room removes BOTH roster and count-only channels cleanly when last ref unsubscribes'
  );
  strictUnsub2();
  unsubDirectory();
  assert(
    directoryClient.removedChannels.length === allRoomIds.length,
    '2.23 Leaving /rooms removes all 25 directory channels cleanly'
  );

  // 2.13 BFCache Session Validation & Lifecycle Tests (`pagehide` / `pageshow` / async revalidation)
  console.log('\n--- Part 3: Secure BFCache Session & Room-Access Revalidation ---');

  const validGuestRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-bangla',
    roomIs18Plus: false,
    expectedUserId: 'guest-bf-1',
    isGuest: true,
    hasLocalAgeAccess: false,
    getStoredGuestTokenFn: () => 'vx_gst_valid_1',
    validateGuestTokenFn: async () => ({
      valid: true,
      status: 'valid',
      session: { id: 'guest-bf-1', expiresAt: Date.now() + 60000, is18Verified: false, ageDeclarationAccepted: false },
    }),
  });
  const revokedGuestRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-bangla',
    roomIs18Plus: false,
    expectedUserId: 'guest-bf-1',
    isGuest: true,
    hasLocalAgeAccess: false,
    getStoredGuestTokenFn: () => 'vx_gst_revoked_1',
    validateGuestTokenFn: async () => ({
      valid: false,
      status: 'invalid',
      error: 'Guest session revoked.',
    }),
  });
  const expiredGuestRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-bangla',
    roomIs18Plus: false,
    expectedUserId: 'guest-bf-1',
    isGuest: true,
    hasLocalAgeAccess: false,
    getStoredGuestTokenFn: () => 'vx_gst_expired_1',
    validateGuestTokenFn: async () => ({
      valid: true,
      status: 'valid',
      session: { id: 'guest-bf-1', expiresAt: Date.now() - 1000 },
    }),
  });
  const guestAdultDeniedRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-sex',
    roomIs18Plus: true,
    expectedUserId: 'guest-bf-1',
    isGuest: true,
    hasLocalAgeAccess: false,
    getStoredGuestTokenFn: () => 'vx_gst_no18',
    validateGuestTokenFn: async () => ({
      valid: true,
      status: 'valid',
      session: { id: 'guest-bf-1', expiresAt: Date.now() + 60000, is18Verified: false, ageDeclarationAccepted: false },
    }),
  });
  const nonCanonicalRoomRes = await revalidateRoomSessionAndAccess({
    roomId: 'not-a-real-room',
    roomIs18Plus: false,
    expectedUserId: 'guest-bf-1',
    isGuest: true,
    hasLocalAgeAccess: false,
  });
  assert(
    validGuestRes.status === 'valid' &&
      revokedGuestRes.status === 'invalid' &&
      expiredGuestRes.status === 'invalid' &&
      guestAdultDeniedRes.status === 'denied' &&
      nonCanonicalRoomRes.status === 'denied',
    '3.1 revalidateRoomSessionAndAccess enforces valid guest, revoked guest, expired guest, and adult/canonical room access'
  );

  // Real guestSessionService.validateSession HTTP 401 vs 503 vs fetch network error
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ valid: false }), { status: 401 })) as any;
    const http401Guest = await guestSessionService.validateSession('vx_gst_test_401');
    globalThis.fetch = (async () => new Response('Service Unavailable', { status: 503 })) as any;
    const http503Guest = await guestSessionService.validateSession('vx_gst_test_503');
    globalThis.fetch = (async () => {
      throw new Error('Failed to fetch');
    }) as any;
    const netErrGuest = await guestSessionService.validateSession('vx_gst_test_net');
    assert(
      http401Guest.status === 'invalid' &&
        http503Guest.status === 'network_error' &&
        netErrGuest.status === 'network_error',
      '3.2 guestSessionService.validateSession distinguishes HTTP 401 invalidation from HTTP 503/network errors'
    );
  } finally {
    globalThis.fetch = origFetch;
  }

  // Authenticated member Supabase revalidation: valid, revoked/401, mismatched user, and network error
  const validMemberRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-bangla',
    roomIs18Plus: false,
    expectedUserId: 'member-101',
    isGuest: false,
    hasLocalAgeAccess: true,
    isSupabaseConfiguredFn: () => true,
    getSupabaseClientFn: () => ({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'member-101' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: 'member-101' } }, error: null }),
      },
    }),
  });
  const expiredMemberRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-bangla',
    roomIs18Plus: false,
    expectedUserId: 'member-101',
    isGuest: false,
    hasLocalAgeAccess: true,
    isSupabaseConfiguredFn: () => true,
    getSupabaseClientFn: () => ({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'member-101' } } }, error: null }),
        getUser: async () => ({
          data: { user: null },
          error: { name: 'AuthApiError', message: 'JWT expired', status: 401 },
        }),
      },
    }),
  });
  const netErrMemberRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-bangla',
    roomIs18Plus: false,
    expectedUserId: 'member-101',
    isGuest: false,
    hasLocalAgeAccess: true,
    isSupabaseConfiguredFn: () => true,
    getSupabaseClientFn: () => ({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'member-101' } } }, error: null }),
        getUser: async () => ({
          data: { user: null },
          error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
        }),
      },
    }),
  });
  const deniedMemberAdultRes = await revalidateRoomSessionAndAccess({
    roomId: 'room-sex',
    roomIs18Plus: true,
    expectedUserId: 'member-101',
    isGuest: false,
    hasLocalAgeAccess: false,
    isSupabaseConfiguredFn: () => true,
    getSupabaseClientFn: () => ({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'member-101' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: 'member-101' } }, error: null }),
      },
    }),
  });
  assert(
    validMemberRes.status === 'valid' &&
      expiredMemberRes.status === 'invalid' &&
      netErrMemberRes.status === 'network_error' &&
      deniedMemberAdultRes.status === 'denied',
    '3.3 Member BFCache revalidation distinguishes valid Supabase Auth sessions, 401 expiry, network failures, and 18+ denial'
  );
  const fakeWindow = new MockWindowEventTarget();
  let bfValidSession = true;
  let bfStartCalls = 0;
  let bfCleanupCalls = 0;
  let bfHeartbeats = 0;
  let bfLeaves = 0;
  let bfValidationCalls = 0;
  let nextValidationResult: BFCacheValidationResult = { status: 'valid' };
  const failedResults: string[] = [];

  const bfLifecycle = createRoomPresenceLifecycle({
    isStealth: false,
    canTrack: () => bfValidSession,
    validateSessionAndAccess: async () => {
      bfValidationCalls++;
      return nextValidationResult;
    },
    onValidationFailed: (res) => {
      failedResults.push(res.status);
    },
    startRealtimePresence: () => {
      bfStartCalls++;
      return () => {
        bfCleanupCalls++;
      };
    },
    sendHeartbeat: () => {
      bfHeartbeats++;
    },
    sendLeave: () => {
      bfLeaves++;
    },
    heartbeatIntervalMs: 60000,
    eventTarget: fakeWindow,
  });

  assert(
    bfLifecycle.isActive() &&
      bfStartCalls === 1 &&
      bfHeartbeats === 1 &&
      fakeWindow.listenerCount('pagehide') === 1 &&
      fakeWindow.listenerCount('pageshow') === 1 &&
      fakeWindow.listenerCount('online') === 1,
    '3.4 BFCache lifecycle starts presence cleanly and attaches pagehide, pageshow, and online listeners'
  );

  // Dispatch non-persisted pageshow while active -> must NOT duplicate
  await bfLifecycle.handlePageShow({ persisted: false });
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    bfStartCalls === 1 && bfHeartbeats === 1 && bfValidationCalls === 0,
    '3.5 Duplicate or non-persisted pageshow while active does not duplicate subscriptions or validations'
  );

  // Simulate BFCache freeze (pagehide) -> untracks & leaves
  fakeWindow.dispatch('pagehide');
  assert(
    !bfLifecycle.isActive() && bfCleanupCalls === 1 && bfLeaves === 1,
    '3.6 pagehide stops presence cleanly and sends leave signal'
  );

  // Valid BFCache restore -> revalidates & restores once; repeated cycle works cleanly
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    bfLifecycle.isActive() && bfStartCalls === 2 && bfHeartbeats === 2 && bfValidationCalls === 1,
    '3.7 pageshow (persisted: true) revalidates and restores presence cleanly when session & access are valid'
  );

  fakeWindow.dispatch('pagehide');
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    bfLifecycle.isActive() && bfStartCalls === 3 && bfValidationCalls === 2,
    '3.8 Repeated BFCache hide/restore cycles revalidate cleanly without duplicate subscriptions'
  );

  // Network error keeps session unverified & Presence inactive (NOT reported as invalid/logout), and recovers when online fires
  fakeWindow.dispatch('pagehide');
  nextValidationResult = { status: 'network_error', reason: 'Offline' };
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    !bfLifecycle.isActive() &&
      bfStartCalls === 3 &&
      failedResults[failedResults.length - 1] === 'network_error' &&
      !failedResults.includes('invalid'),
    '3.9 Network failure during BFCache validation keeps Presence inactive without falsely reporting logout'
  );

  nextValidationResult = { status: 'valid' };
  fakeWindow.dispatch('online');
  await new Promise((r) => setTimeout(r, 0));
  assert(
    bfLifecycle.isActive() && bfStartCalls === 4,
    '3.10 Subsequent connectivity recovery (online event) safely completes deferred validation and restores Presence'
  );

  // Authoritative invalid session & adult denial keep Presence inactive
  fakeWindow.dispatch('pagehide');
  nextValidationResult = { status: 'invalid', reason: 'Revoked' };
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    !bfLifecycle.isActive() && bfStartCalls === 4 && failedResults[failedResults.length - 1] === 'invalid',
    '3.11 Authoritative invalid/revoked session keeps Presence inactive'
  );

  nextValidationResult = { status: 'denied', reason: '18+ required' };
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    !bfLifecycle.isActive() && bfStartCalls === 4 && failedResults[failedResults.length - 1] === 'denied',
    '3.12 Denied room access keeps Presence inactive'
  );

  // Concurrent duplicate pageshow + logout/unmount during in-flight async validation
  let resolveAsyncValidation!: (val: BFCacheValidationResult) => void;
  let asyncStarts = 0;
  let asyncFails = 0;
  let asyncValCalls = 0;
  let canTrackLogoutTest = true;
  const logoutRaceWindow = new MockWindowEventTarget();
  const logoutRaceLifecycle = createRoomPresenceLifecycle({
    isStealth: false,
    canTrack: () => canTrackLogoutTest,
    validateSessionAndAccess: () => {
      asyncValCalls++;
      return new Promise<BFCacheValidationResult>((resolve) => {
        resolveAsyncValidation = resolve;
      });
    },
    onValidationFailed: () => {
      asyncFails++;
    },
    startRealtimePresence: () => {
      asyncStarts++;
      return () => {};
    },
    sendHeartbeat: () => {},
    sendLeave: () => {},
    heartbeatIntervalMs: 60000,
    eventTarget: logoutRaceWindow,
  });
  logoutRaceWindow.dispatch('pagehide');
  const p1 = logoutRaceLifecycle.handlePageShow({ persisted: true });
  const p2 = logoutRaceLifecycle.handlePageShow({ persisted: true }); // concurrent duplicate pageshow!
  assert(
    logoutRaceLifecycle.isValidating() && asyncValCalls === 1,
    '3.13 Concurrent duplicate pageshow events trigger only a single in-flight validation'
  );
  // Logout happens while validation is in flight
  canTrackLogoutTest = false;
  resolveAsyncValidation({ status: 'valid' });
  await Promise.all([p1, p2]);
  assert(
    !logoutRaceLifecycle.isActive() && asyncStarts === 1 && asyncFails === 0,
    '3.14 Logout during in-flight validation blocks stale async restoration'
  );
  logoutRaceLifecycle.dispose();

  // Component unmount / room change during async validation
  let resolveUnmountValidation!: (val: BFCacheValidationResult) => void;
  let unmountStarts = 0;
  let unmountFails = 0;
  const unmountWindow = new MockWindowEventTarget();
  const unmountLifecycle = createRoomPresenceLifecycle({
    isStealth: false,
    canTrack: () => true,
    validateSessionAndAccess: () =>
      new Promise<BFCacheValidationResult>((resolve) => {
        resolveUnmountValidation = resolve;
      }),
    onValidationFailed: () => {
      unmountFails++;
    },
    startRealtimePresence: () => {
      unmountStarts++;
      return () => {};
    },
    sendHeartbeat: () => {},
    sendLeave: () => {},
    heartbeatIntervalMs: 60000,
    eventTarget: unmountWindow,
  });
  unmountWindow.dispatch('pagehide');
  const unmountPending = unmountLifecycle.handlePageShow({ persisted: true });
  unmountLifecycle.dispose(); // Simulates unmount or room change while async validation is pending
  resolveUnmountValidation({ status: 'valid' });
  await unmountPending;
  assert(
    !unmountLifecycle.isActive() && unmountStarts === 1 && unmountFails === 0,
    '3.15 Component unmount or room change during pending validation ignores stale async result'
  );

  // Dispose removes all listeners and blocks future BFCache events
  bfLifecycle.dispose();
  bfValidSession = true;
  await bfLifecycle.handlePageShow({ persisted: true });
  assert(
    fakeWindow.listenerCount('pagehide') === 0 &&
      fakeWindow.listenerCount('pageshow') === 0 &&
      fakeWindow.listenerCount('online') === 0 &&
      !bfLifecycle.isActive() &&
      bfStartCalls === 4,
    '3.16 dispose() detaches all event listeners and blocks subsequent restoration'
  );

  // Stealth BFCache test: validates session & re-observes roster without ever firing heartbeat or leave calls
  const stealthWindow = new MockWindowEventTarget();
  let stealthHeartbeats = 0;
  let stealthLeaves = 0;
  let stealthSubs = 0;
  let stealthValidations = 0;
  const stealthBf = createRoomPresenceLifecycle({
    isStealth: true,
    canTrack: () => true,
    validateSessionAndAccess: async () => {
      stealthValidations++;
      return { status: 'valid' };
    },
    startRealtimePresence: () => {
      stealthSubs++;
      return () => {};
    },
    sendHeartbeat: () => {
      stealthHeartbeats++;
    },
    sendLeave: () => {
      stealthLeaves++;
    },
    heartbeatIntervalMs: 60000,
    eventTarget: stealthWindow,
  });
  stealthWindow.dispatch('pagehide');
  await stealthBf.handlePageShow({ persisted: true });
  assert(
    stealthValidations === 1 && stealthSubs === 2 && stealthHeartbeats === 0 && stealthLeaves === 0,
    '3.17 Stealth BFCache restore validates session and re-observes roster without heartbeat or leave calls'
  );
  stealthBf.dispose();

  // -------------------------------------------------------------------------
  // PART 4: ACTIVE BADGE UI, DARK MODE, REDUCED MOTION & MOBILE SSR CHECKS
  // -------------------------------------------------------------------------
  console.log('\n--- Part 4: Active Badge UI Design, Accessibility & SSR Checks ---');

  const roomDirectorySource = fs.readFileSync(path.resolve('src/pages/RoomDirectoryPage.tsx'), 'utf-8');
  assert(
    roomDirectorySource.includes('bg-emerald-50 text-emerald-800') &&
      roomDirectorySource.includes('dark:bg-emerald-950/60 dark:text-emerald-200') &&
      roomDirectorySource.includes('rounded-full') &&
      roomDirectorySource.includes('font-bold tabular-nums') &&
      roomDirectorySource.includes('motion-safe:animate-pulse motion-reduce:animate-none'),
    '4.1 RoomDirectoryPage badge enforces bold pill typography, light/dark emerald contrast, and prefers-reduced-motion compliance'
  );
  assert(
    roomDirectorySource.includes('flex flex-wrap items-center justify-between gap-2') &&
      roomDirectorySource.includes('min-w-0 truncate') &&
      roomDirectorySource.includes('whitespace-nowrap shrink-0'),
    '4.2 RoomDirectoryPage card headers wrap cleanly without horizontal mobile overflow'
  );
  assert(
    roomDirectorySource.includes('(Live Presence Partially Available)') &&
      roomDirectorySource.includes('(আংশিক রিয়েল-টাইম উপস্থিতি সক্রিয়)'),
    '4.3 RoomDirectoryPage preserves partial availability notice in EN and BN'
  );

  // SSR render check for /rooms
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
      roomsHtml.includes('data-room-count-status=') &&
      roomsHtml.includes('rounded-full') &&
      roomsHtml.includes('PublicChatPage') === false,
    '4.4 RoomDirectoryPage SSR renders Main & Regional room grids with rounded pill count badges'
  );
  assert(typeof PublicChatPage === 'function', '4.5 PublicChatPage component exports cleanly');

  console.log(`\n🎉 ALL ${totalAssertions} STICKY HEADER, BF-CACHE & REAL-TIME PRESENCE ASSERTIONS PASSED!`);
}

runTests().catch((err) => {
  console.error('❌ Test suite threw unexpected error:', err);
  process.exit(1);
});
