import { useEffect, useMemo, useState } from 'react';
import {
  databaseService,
  isCanonicalRoomId,
  RoomPresenceSyncStatus,
} from '../services/databaseService';
import { AppLanguage } from '../types';

export type OverallPresenceStatus =
  | 'connecting'
  | 'synced'
  | 'partial'
  | 'unavailable'
  | 'error';

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

/**
 * Resolve the individual room badge display strictly from verified channel status.
 * Stale counts from an earlier sync are NEVER displayed once status transitions to error/unavailable/connecting.
 */
export function resolveRoomPresenceBadge(params: {
  roomId: string;
  counts: Record<string, number>;
  statuses: Record<string, RoomPresenceSyncStatus>;
  language: AppLanguage;
}): RoomPresenceBadgeDisplay {
  const { roomId, counts, statuses, language } = params;
  const status = statuses[roomId];

  if (status === 'error' || status === 'unavailable') {
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

  if (status === 'connecting' || !status) {
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

  // Only reached when status === 'synced'
  const rawCount = counts[roomId];
  const safeCount =
    typeof rawCount === 'number' && Number.isFinite(rawCount)
      ? Math.max(0, Math.floor(rawCount))
      : 0;

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

/**
 * Compute accurate directory-wide synchronization status across all configured rooms.
 */
export function computeOverallPresenceStatus(
  roomIds: string[],
  statuses: Record<string, RoomPresenceSyncStatus>
): OverallPresenceStatus {
  const canonicalIds = Array.from(
    new Set(
      roomIds
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => isCanonicalRoomId(id))
    )
  );

  if (canonicalIds.length === 0) {
    return 'unavailable';
  }

  const values = canonicalIds.map((id) => statuses[id] ?? 'connecting');
  const syncedCount = values.filter((s) => s === 'synced').length;
  const connectingCount = values.filter((s) => s === 'connecting').length;
  const failedCount = values.filter((s) => s === 'error' || s === 'unavailable').length;

  if (syncedCount === canonicalIds.length) {
    return 'synced';
  }

  if (syncedCount > 0) {
    return failedCount > 0 ? 'partial' : 'connecting';
  }

  if (connectingCount > 0) {
    return 'connecting';
  }

  if (values.every((s) => s === 'unavailable')) {
    return 'unavailable';
  }

  return 'error';
}

export function useRoomPresenceCounts(
  roomIds: string[],
  overrideClient?: any
): RoomPresenceSnapshot & {
  overallStatus: OverallPresenceStatus;
} {
  const roomIdsKey = useMemo(() => {
    const unique = Array.from(
      new Set(
        roomIds
          .filter((id) => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => isCanonicalRoomId(id))
      )
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

  const overallStatus = useMemo<OverallPresenceStatus>(
    () => computeOverallPresenceStatus(normalizedRoomIds, snapshot.statuses),
    [normalizedRoomIds, snapshot.statuses]
  );

  return {
    counts: snapshot.counts,
    statuses: snapshot.statuses,
    overallStatus,
  };
}
