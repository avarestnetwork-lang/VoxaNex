export const AD_PLACEMENT_IDS = [
  'public-chatroom-top',
  'public-chatroom-left',
  'public-chatroom-right',
  'public-chatroom-bottom',
] as const;

export type AdPlacementId = typeof AD_PLACEMENT_IDS[number];

export function isAdPlacementId(value: string): value is AdPlacementId {
  return (AD_PLACEMENT_IDS as readonly string[]).includes(value);
}

export type AdRenderState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | AdProviderResult;

export type AdProviderResult =
  | { status: 'no-fill'; cleanup?: () => void }
  | { status: 'error'; error?: unknown; cleanup?: () => void }
  | { status: 'filled'; creative: HTMLElement; width: number; height: number; cleanup?: () => void };

export interface AdProviderMountRequest {
  placementId: AdPlacementId;
  signal: AbortSignal;
  loadScript: (src: string) => Promise<void>;
}

export interface AdProviderAdapter {
  readonly id: string;
  supportsPlacement(placementId: AdPlacementId): boolean;
  /** Return `filled` only after a provider-specific genuine-fill signal. */
  mount(request: AdProviderMountRequest): Promise<AdProviderResult>;
}

export interface AdPlacementProviderConfig {
  enabled: boolean;
  /** Provider IDs in preferred order; fallback is attempted only after no-fill/error. */
  providerPriority: readonly string[];
}
