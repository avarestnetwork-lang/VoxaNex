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
import { createRoomPresenceLifecycle, PublicChatPage } from '../src/pages/PublicChatPage';
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
      }).label === '2 active',
    '2.13 Pre-failure badge shows live 2 active on room-bangla'
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
      reconnectedBadge.label === '1 active' &&
      computeOverallPresenceStatus(allRoomIds, latestSnapshot.statuses) === 'synced',
    '2.16 Channel reconnect restores fresh count (1 active) and recovers overallStatus back to synced'
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
  assert(
    onlyOneSyncedStatus === 'partial' &&
      banglaBadgeInPartial.kind === 'synced' &&
      banglaBadgeInPartial.label === '0 active' &&
      sexBadgeInPartial.kind === 'unavailable' &&
      sexBadgeInPartial.label === 'Live N/A',
    '2.18 1 synced room + remaining error rooms computes overallStatus=partial while preserving independent per-room badges'
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

  // 2.12 Strict Mode mount -> unmount -> remount cleanup for both roster & count channels
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
  assert(
    strictClient.removedChannels.length === 2,
    '2.20 Strict Mode unmount 1 removes all directory count channels'
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
    '2.21 Strict Mode remount receives accurate live presence updates without duplicate listeners'
  );
  unsubStrictUser();
  assert(
    strictMemberClient.removedChannels.some((c) => c.topic === 'public_room_presence:room-bangla') &&
      strictMemberClient.removedChannels.some((c) => c.topic === 'public_room_presence_count:room-bangla'),
    '2.22 Leaving chat room removes BOTH roster and count-only channels cleanly'
  );
  strictUnsub2();
  unsubDirectory();
  assert(
    directoryClient.removedChannels.length === allRoomIds.length,
    '2.23 Leaving /rooms removes all directory channels cleanly'
  );

  // 2.13 BFCache Lifecycle Tests (`pagehide` & `pageshow` recovery in PublicChatPage)
  const fakeWindow = new MockWindowEventTarget();
  let bfValidSession = true;
  let bfStartCalls = 0;
  let bfCleanupCalls = 0;
  let bfHeartbeats = 0;
  let bfLeaves = 0;

  const bfLifecycle = createRoomPresenceLifecycle({
    isStealth: false,
    canTrack: () => bfValidSession,
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
      fakeWindow.listenerCount('pageshow') === 1,
    '2.24 BFCache lifecycle starts presence cleanly and attaches pagehide + pageshow listeners'
  );

  // Dispatch non-persisted pageshow while active -> must NOT duplicate
  fakeWindow.dispatch('pageshow', { persisted: false });
  fakeWindow.dispatch('pageshow', { persisted: true });
  assert(
    bfStartCalls === 1 && bfHeartbeats === 1,
    '2.25 Duplicate or non-persisted pageshow while active does not duplicate subscriptions or heartbeats'
  );

  // Simulate BFCache freeze (pagehide) -> untracks & leaves
  fakeWindow.dispatch('pagehide');
  assert(
    !bfLifecycle.isActive() && bfCleanupCalls === 1 && bfLeaves === 1,
    '2.26 pagehide stops presence cleanly and sends leave signal'
  );

  // Simulate BFCache restore (pageshow { persisted: true }) -> restores cleanly once
  fakeWindow.dispatch('pageshow', { persisted: true });
  assert(
    bfLifecycle.isActive() && bfStartCalls === 2 && bfHeartbeats === 2,
    '2.27 pageshow (persisted: true) restores presence cleanly when session remains valid'
  );

  // Invalid session guard on restore after pagehide
  fakeWindow.dispatch('pagehide');
  bfValidSession = false;
  fakeWindow.dispatch('pageshow', { persisted: true });
  assert(
    !bfLifecycle.isActive() && bfStartCalls === 2,
    '2.28 pageshow refuses to restore presence when session validity check returns false'
  );

  // Dispose removes listeners and blocks future BFCache events
  bfLifecycle.dispose();
  bfValidSession = true;
  fakeWindow.dispatch('pageshow', { persisted: true });
  assert(
    fakeWindow.listenerCount('pagehide') === 0 &&
      fakeWindow.listenerCount('pageshow') === 0 &&
      !bfLifecycle.isActive() &&
      bfStartCalls === 2,
    '2.29 dispose() detaches pagehide/pageshow listeners and blocks subsequent restoration'
  );

  // Stealth BFCache test: never sends heartbeat or leave across pagehide/pageshow
  const stealthWindow = new MockWindowEventTarget();
  let stealthHeartbeats = 0;
  let stealthLeaves = 0;
  let stealthSubs = 0;
  const stealthBf = createRoomPresenceLifecycle({
    isStealth: true,
    canTrack: () => true,
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
  stealthWindow.dispatch('pageshow', { persisted: true });
  assert(
    stealthSubs === 2 && stealthHeartbeats === 0 && stealthLeaves === 0,
    '2.30 Stealth BFCache restore re-observes roster without ever firing heartbeat or leave calls'
  );
  stealthBf.dispose();

  // 2.14 SSR render check for /rooms including partial & connecting UI labels
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
      roomsHtml.includes('PublicChatPage') === false,
    '2.31 RoomDirectoryPage renders Main & Regional room grids with count status badges'
  );
  assert(typeof PublicChatPage === 'function', '2.32 PublicChatPage component exports cleanly');

  console.log(`\n🎉 ALL ${totalAssertions} STICKY HEADER & REAL-TIME PRESENCE ASSERTIONS PASSED!`);
}

runTests().catch((err) => {
  console.error('❌ Test suite threw unexpected error:', err);
  process.exit(1);
});
