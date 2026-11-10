import { AD_PLACEMENT_CONFIG } from './adConfig';
import { AdPlacementId, AdPlacementProviderConfig, AdProviderAdapter } from './adTypes';

export function createAdProviderRegistry(adapters: readonly AdProviderAdapter[]) {
  const byId = new Map<string, AdProviderAdapter>();
  for (const adapter of adapters) {
    if (byId.has(adapter.id)) throw new Error(`Duplicate ad provider adapter: ${adapter.id}`);
    byId.set(adapter.id, adapter);
  }

  return {
    select(placementId: AdPlacementId, config = AD_PLACEMENT_CONFIG[placementId]): AdProviderAdapter[] {
      if (!config.enabled) return [];
      return config.providerPriority
        .map((providerId) => byId.get(providerId))
        .filter((adapter): adapter is AdProviderAdapter => Boolean(adapter?.supportsPlacement(placementId)));
    },
  };
}

// Real adapters are added only after the network and its inventory are verified.
export const adProviderRegistry = createAdProviderRegistry([]);

export function getPlacementProviderConfig(placementId: AdPlacementId): AdPlacementProviderConfig {
  return AD_PLACEMENT_CONFIG[placementId];
}
