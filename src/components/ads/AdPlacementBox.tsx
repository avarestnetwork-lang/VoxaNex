import React, { useEffect, useMemo, useRef, useState } from 'react';
import { adProviderRegistry, getPlacementProviderConfig } from '../../services/ads/adProviderRegistry';
import { loadAdProviderScript } from '../../services/ads/providerScriptLoader';
import { acquireAdFill, AdFillLease, mountAdCreative, rejectAdLayout, toAdRenderState } from '../../services/ads/adRuntime';
import { fitsSidePlacement, fitsVerticalPlacement, hasUsableChatroomSize } from '../../services/ads/adLayout';
import { AdPlacementId, AdRenderState, isAdPlacementId } from '../../services/ads/adTypes';

interface AdPlacementBoxProps {
  slotId: AdPlacementId | string;
}

const disabledState: AdRenderState = { status: 'disabled' };
const invalidPlacementConfig = { enabled: false, providerPriority: [] as readonly string[] };

function isSidePlacement(slotId: string): boolean {
  return slotId === 'public-chatroom-left' || slotId === 'public-chatroom-right';
}

function oppositePlacement(slotId: AdPlacementId): AdPlacementId {
  const opposites: Record<AdPlacementId, AdPlacementId> = {
    'public-chatroom-top': 'public-chatroom-bottom',
    'public-chatroom-bottom': 'public-chatroom-top',
    'public-chatroom-left': 'public-chatroom-right',
    'public-chatroom-right': 'public-chatroom-left',
  };
  return opposites[slotId];
}

function placementFitsCurrentChatroom(slotId: AdPlacementId, width: number, height: number): boolean {
  if (typeof document === 'undefined') return false;
  const chatroom = document.querySelector<HTMLElement>('[data-chatroom-core]');
  if (!chatroom) return false;

  const otherSlot = oppositePlacement(slotId);
  const otherAlreadyPresent = Array.from(document.querySelectorAll<HTMLElement>('[data-ad-placement]'))
    .some((element) => element.dataset.adPlacement === otherSlot && element.getBoundingClientRect().width > 0);
  const otherConfig = getPlacementProviderConfig(otherSlot);
  const otherMayFill = otherConfig.enabled && adProviderRegistry.select(otherSlot, otherConfig).length > 0;

  return isSidePlacement(slotId)
    ? fitsSidePlacement(chatroom.clientWidth, width, otherAlreadyPresent, otherMayFill)
    : fitsVerticalPlacement(chatroom.clientHeight, height, otherAlreadyPresent, otherMayFill);
}

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({ slotId }) => {
  const supported = isAdPlacementId(slotId);
  const config = supported ? getPlacementProviderConfig(slotId as AdPlacementId) : invalidPlacementConfig;
  const adapters = useMemo(
    () => supported ? adProviderRegistry.select(slotId as AdPlacementId, config) : [],
    [slotId, supported, config],
  );
  const [state, setState] = useState<AdRenderState>(disabledState);
  const [layoutRetry, setLayoutRetry] = useState(0);
  const creativeHost = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const rejectedLayoutRef = useRef<{ width: number; height: number } | null>(null);
  const activeLeaseRef = useRef<AdFillLease | null>(null);
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    if (!supported || !config.enabled || adapters.length === 0) {
      setState({ status: 'disabled' });
      return () => { active = false; };
    }

    setState({ status: 'loading' });
    const lease = acquireAdFill(slotId as AdPlacementId, config, adapters, loadAdProviderScript);
    activeLeaseRef.current = lease;
    void lease.promise
      .then((result) => {
        if (result.status !== 'filled') {
          if (active) setState(toAdRenderState(result, config.enabled));
          return;
        }
        const layoutFits = placementFitsCurrentChatroom(slotId as AdPlacementId, result.width, result.height);
        if (rejectAdLayout(layoutFits)) {
          rejectedLayoutRef.current = { width: result.width, height: result.height };
          lease.release();
          if (activeLeaseRef.current === lease) activeLeaseRef.current = null;
          if (active) setState({ status: 'no-fill' });
          return;
        }
        rejectedLayoutRef.current = null;
        if (active) setState(toAdRenderState(result, config.enabled));
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => {
      active = false;
      lease.release();
      if (activeLeaseRef.current === lease) activeLeaseRef.current = null;
    };
  }, [slotId, supported, config, adapters, layoutRetry]);

  useEffect(() => {
    if (!supported || !config.enabled || typeof document === 'undefined') return;
    const chatroom = document.querySelector<HTMLElement>('[data-chatroom-core]');
    const workspace = document.querySelector<HTMLElement>('[data-ad-workspace]');
    if (!chatroom || !workspace) return;

    const checkLayout = () => {
      const current = stateRef.current;
      if (current.status === 'filled' && !hasUsableChatroomSize(chatroom.clientWidth, chatroom.clientHeight)) {
        rejectedLayoutRef.current = { width: current.width, height: current.height };
        activeLeaseRef.current?.release();
        activeLeaseRef.current = null;
        setState({ status: 'no-fill' });
        return;
      }

      const rejected = rejectedLayoutRef.current;
      if (current.status !== 'filled' && rejected
        && placementFitsCurrentChatroom(slotId as AdPlacementId, rejected.width, rejected.height)) {
        rejectedLayoutRef.current = null;
        setLayoutRetry((retry) => retry + 1);
      }
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkLayout) : null;
    observer?.observe(workspace);
    observer?.observe(chatroom);
    window.addEventListener('resize', checkLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', checkLayout);
    };
  }, [slotId, supported, config]);

  useEffect(() => {
    if (state.status !== 'filled' || !creativeHost.current) return;
    return mountAdCreative(creativeHost.current, state);
  }, [state]);

  if (!supported || state.status !== 'filled') return null;

  const sidePlacement = isSidePlacement(slotId);
  const isTop = slotId === 'public-chatroom-top';
  const fitClass = sidePlacement
    ? 'hidden min-[1440px]:flex'
    : isTop
      ? 'mb-2.5 shrink-0 justify-center'
      : 'mt-2.5 shrink-0 justify-center';

  return (
    <div
      className={`flex min-w-0 max-w-full overflow-hidden ${fitClass}`}
      data-ad-placement={slotId}
      style={{ width: state.width, height: state.height }}
      aria-label="Advertisement"
    >
      <div ref={creativeHost} className="flex min-w-0 max-w-full overflow-hidden" />
    </div>
  );
};
