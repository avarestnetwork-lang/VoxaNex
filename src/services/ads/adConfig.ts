import { AD_PLACEMENT_IDS, AdPlacementId, AdPlacementProviderConfig } from './adTypes';

/**
 * No network is enabled until its approval, inventory, consent, and placement
 * requirements are verified. Empty priorities also prevent provider scripts
 * or ad requests from running by default.
 */
export const AD_PLACEMENT_CONFIG: Readonly<Record<AdPlacementId, AdPlacementProviderConfig>> =
  Object.freeze(Object.fromEntries(
    AD_PLACEMENT_IDS.map((placementId) => [placementId, { enabled: false, providerPriority: [] }]),
  ) as unknown as Record<AdPlacementId, AdPlacementProviderConfig>);
