import { AdPlacementProviderConfig, AdProviderAdapter, AdProviderResult, AdRenderState, AdPlacementId } from './adTypes';

interface AdRequestEntry {
  promise: Promise<AdProviderResult>;
  subscribers: Set<symbol>;
  managed: boolean;
  settled: boolean;
  result?: AdProviderResult;
  cleanupDone: boolean;
}

export interface AdFillLease {
  promise: Promise<AdProviderResult>;
  release: () => void;
}

const inFlightRequests = new Map<string, AdRequestEntry>();
export const DEFAULT_ADAPTER_TIMEOUT_MS = 15_000;

function isConfirmedFill(result: AdProviderResult): boolean {
  return result.status === 'filled'
    && typeof HTMLElement !== 'undefined'
    && result.creative instanceof HTMLElement
    && Number.isFinite(result.width)
    && Number.isFinite(result.height)
    && result.width > 0
    && result.height > 0;
}

/**
 * Tries configured adapters in priority order. A fill is accepted only when
 * the adapter supplies a real element and positive dimensions; script load is
 * never considered a fill signal.
 */
function getOrCreateRequest(
  placementId: AdPlacementId,
  config: AdPlacementProviderConfig,
  adapters: readonly AdProviderAdapter[],
  loadScript: (providerId: string, src: string) => Promise<void>,
  timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS,
): AdRequestEntry {
  const key = `${placementId}:${config.providerPriority.join(',')}`;
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = (async (): Promise<AdProviderResult> => {
    if (!config.enabled) return { status: 'no-fill' };
    let hadProviderError = false;
    for (const providerId of config.providerPriority) {
      const adapter = adapters.find((candidate) => candidate.id === providerId && candidate.supportsPlacement(placementId));
      if (!adapter) continue;
      const controller = new AbortController();
      try {
        const mounting = Promise.resolve().then(() => adapter.mount({
          placementId,
          signal: controller.signal,
          loadScript: (src) => loadScript(adapter.id, src),
        }));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutResult = Symbol('ad-adapter-timeout');
        const resultOrTimeout = await Promise.race([
          mounting,
          new Promise<typeof timeoutResult>((resolve) => {
            timer = setTimeout(() => resolve(timeoutResult), timeoutMs);
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        if (resultOrTimeout === timeoutResult) {
          hadProviderError = true;
          controller.abort();
          void mounting.then(cleanupAdResult, () => {});
          continue;
        }
        const result = resultOrTimeout;
        if (result.status === 'filled') {
          if (isConfirmedFill(result)) return result;
          cleanupAdResult(result);
          hadProviderError = true;
          continue;
        }
        if (result.status === 'error') hadProviderError = true;
        cleanupAdResult(result);
      } catch {
        // A provider failure permits the next explicitly configured adapter.
        controller.abort();
        hadProviderError = true;
      }
    }
    return hadProviderError ? { status: 'error' } : { status: 'no-fill' };
  })();

  const entry: AdRequestEntry = {
    promise: request,
    subscribers: new Set(),
    managed: false,
    settled: false,
    cleanupDone: false,
  };
  inFlightRequests.set(key, entry);
  void request.then((result) => {
    entry.result = result;
    entry.settled = true;
    if (entry.managed && entry.subscribers.size === 0) disposeEntry(entry);
    if (inFlightRequests.get(key) === entry) inFlightRequests.delete(key);
  }, () => {
    entry.settled = true;
    if (inFlightRequests.get(key) === entry) inFlightRequests.delete(key);
  });
  return entry;
}

function disposeEntry(entry: AdRequestEntry): void {
  if (entry.cleanupDone) return;
  entry.cleanupDone = true;
  if (entry.result) cleanupAdResult(entry.result);
}

export function requestAdFill(
  placementId: AdPlacementId,
  config: AdPlacementProviderConfig,
  adapters: readonly AdProviderAdapter[],
  loadScript: (providerId: string, src: string) => Promise<void>,
  timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS,
): Promise<AdProviderResult> {
  return getOrCreateRequest(placementId, config, adapters, loadScript, timeoutMs).promise;
}

export function acquireAdFill(
  placementId: AdPlacementId,
  config: AdPlacementProviderConfig,
  adapters: readonly AdProviderAdapter[],
  loadScript: (providerId: string, src: string) => Promise<void>,
  timeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS,
): AdFillLease {
  const entry = getOrCreateRequest(placementId, config, adapters, loadScript, timeoutMs);
  entry.managed = true;
  const subscriber = Symbol(placementId);
  entry.subscribers.add(subscriber);
  let released = false;

  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.subscribers.delete(subscriber);
      if (entry.settled && entry.subscribers.size === 0) disposeEntry(entry);
    },
  };
}

/** Keep state derivation deterministic and independently testable. */
export function toAdRenderState(result: AdProviderResult, enabled: boolean): AdRenderState {
  if (!enabled) return { status: 'disabled' };
  if (result.status === 'filled' && isConfirmedFill(result)) return result;
  return result.status === 'error' ? result : { status: 'no-fill' };
}

export function cleanupAdResult(result: AdProviderResult): void {
  try { result.cleanup?.(); } catch { /* Cleanup failure must not mount or block a fallback. */ }
}

export function rejectAdLayout(layoutFits: boolean): boolean {
  return !layoutFits;
}

export function mountAdCreative(
  host: HTMLElement,
  result: Extract<AdProviderResult, { status: 'filled' }>,
): () => void {
  host.replaceChildren(result.creative);
  return () => {
    result.creative.remove();
  };
}

