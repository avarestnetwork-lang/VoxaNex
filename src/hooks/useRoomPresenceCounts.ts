import { useEffect, useMemo, useState } from 'react';
import {
  databaseService,
  RoomPresenceSyncStatus,
} from '../services/databaseService';
import { AppLanguage } from '../types';

export interface RoomPresenceSnapshot {
  counts: Record<string, number>;
  statuses: Record<string, RoomPresenceSyncStatus>;
}

export interface RoomPresenceBadgeDisplay {
  kind: 'synced' | 'connecting' | 'unavailable';
  count: number | null;
  label: string;
  isLive: boolean;
  title: string;
}

export function resolveRoomPresenceBadge(params: {
  roomId: string;
  fallbackCount?: number;
  counts: Record<string, number>;
  statuses: Record<string, RoomPresenceSyncStatus>;
  language: AppLanguage;
}): RoomPresenceBadgeDisplay {
  const { roomId, fallbackCount, counts, statuses, language } = params;
  const status = statuses[roomId];
  const liveCount = counts[roomId];

  if (typeof liveCount === 'number' && Number.isFinite(liveCount)) {
    const safeCount = Math.max(0, Math.floor(liveCount));
    return {
      kind: 'synced',
      count: safeCount,
      label: `${safeCount} ${language === 'bn' ? 'সক্রিয়' : 'active'}`,
      isLive: safeCount > 0,
      title:
        language === 'bn'
          ? `এই মুহূর্তে ${safeCount} জন সক্রিয়`
          : `${safeCount} active in this room`,
    };
  }

  if (status === 'synced') {
    return {
      kind: 'synced',
      count: 0,
      label: `0 ${language === 'bn' ? 'সক্রিয়' : 'active'}`,
      isLive: false,
      title: language === 'bn' ? 'এই মুহূর্তে ০ জন সক্রিয়' : '0 active in this room',
    };
  }

  if (status === 'connecting') {
    return {
      kind: 'connecting',
      count: null,
      label: language === 'bn' ? '... সক্রিয়' : '... active',
      isLive: false,
      title:
        language === 'bn'
          ? 'লাইভ উপস্থিতি সিঙ্ক হচ্ছে...'
          : 'Syncing live presence...',
    };
  }

  if (typeof fallbackCount === 'number' && Number.isFinite(fallbackCount) && fallbackCount >= 0) {
    const safeFallback = Math.floor(fallbackCount);
    return {
      kind: 'synced',
      count: safeFallback,
      label: `${safeFallback} ${language === 'bn' ? 'সক্রিয়' : 'active'}`,
      isLive: safeFallback > 0,
      title:
        language === 'bn'
          ? `সার্ভার থেকে ${safeFallback} জন সক্রিয়`
          : `${safeFallback} active from server catalog`,
    };
  }

  return {
    kind: 'unavailable',
    count: null,
    label: language === 'bn' ? 'অনুপলব্ধ' : 'Live N/A',
    isLive: false,
    title:
      language === 'bn'
        ? 'রিয়েল-টাইম উপস্থিতি সংযোগ অনুপলব্ধ'
        : 'Real-time presence unavailable',
  };
}

export function useRoomPresenceCounts(
  roomIds: string[],
  overrideClient?: any
): RoomPresenceSnapshot & {
  overallStatus: RoomPresenceSyncStatus;
} {
  const roomIdsKey = useMemo(() => {
    const unique = Array.from(
      new Set(roomIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
    ).sort();
    return unique.join('|');
  }, [roomIds]);

  const normalizedRoomIds = useMemo(
    () => (roomIdsKey ? roomIdsKey.split('|') : []),
    [roomIdsKey]
  );

  const [snapshot, setSnapshot] = useState<RoomPresenceSnapshot>({
    counts: {},
    statuses: {},
  });

  useEffect(() => {
    if (normalizedRoomIds.length === 0) {
      setSnapshot({ counts: {}, statuses: {} });
      return;
    }

    let active = true;
    const unsubscribe = databaseService.observeRoomsPresence(
      normalizedRoomIds,
      (nextSnapshot) => {
        if (!active) return;
        setSnapshot(nextSnapshot);
      },
      overrideClient
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [normalizedRoomIds, overrideClient]);

  const overallStatus = useMemo<RoomPresenceSyncStatus>(() => {
    const statusValues = Object.values(snapshot.statuses);
    if (statusValues.length === 0) return 'connecting';
    if (statusValues.some((s) => s === 'synced')) return 'synced';
    if (statusValues.some((s) => s === 'connecting')) return 'connecting';
    if (statusValues.every((s) => s === 'unavailable')) return 'unavailable';
    return 'error';
  }, [snapshot.statuses]);

  return {
    counts: snapshot.counts,
    statuses: snapshot.statuses,
    overallStatus,
  };
}
