import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from '../../context/RouterContext';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  JUICYADS_CONFIG,
  MONETAG_CONFIG,
  ADSENSE_CONFIG,
  AdProvider,
  getProviderRotation,
  getSessionAdRotationParity,
  getPlacementOrientation,
  getReservedDimensionTarget,
  getVerifiedAdUnitSpec,
  getVerifiedVerticalUnitForProvider,
  getProviderRefreshPolicy,
  RefreshCapableProvider,
  isAdSenseExcludedRoute,
  isInternalHorizontalPlacement,
} from '../../config/adsConfig';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right' | 'footer' | 'sidebar-horizontal' | 'content-gap' | 'body-bottom';

export type CreativeValidationStatus =
  | 'empty'
  | 'script_only'
  | 'invalid'
  | 'unfilled'
  | 'request_attempted'
  | 'creative_detected'
  | 'confirmed_filled'
  | 'unverifiable';

export interface CreativeValidationOptions {
  expectedOrientation?: 'horizontal' | 'vertical';
  maxAllowedHeight?: number;
  maxAllowedWidth?: number;
}

export interface CreativeValidationResult {
  status: CreativeValidationStatus;
  isConfirmedFilled: boolean;
  isUnverifiable: boolean;
  creativeDetected: boolean;
  reason: string;
}

export type AdSlotStatus = 'idle' | 'loading' | 'filled' | 'unfilled' | 'error' | 'unverifiable';

export interface AdPlacementBoxProps {
  slotId: string;
  provider?: AdProvider;
  label?: string;
  className?: string;
  isVertical?: boolean;
  position?: AdSlotPosition;
  adUnitId?: string;
  onStatusChange?: (status: 'filled' | 'unfilled' | 'error' | 'unverifiable') => void;
  renderAd?: () => React.ReactNode;
  isLiveChatScreen?: boolean;
}

// Monotonic attempt validity guard to prevent stale async callbacks from modifying active slots
export function isAttemptCurrent(
  capturedAttemptId: number,
  activeAttemptId: number,
  isMounted: boolean
): boolean {
  return Boolean(isMounted) && capturedAttemptId === activeAttemptId;
}

// Single-owner placement instance registry to prevent duplicate placement instances for the same slotId
const activeSlotInstances = new Map<string, symbol>();

export function claimSlotInstance(slotId: string, token: symbol): boolean {
  const existing = activeSlotInstances.get(slotId);
  if (existing && existing !== token) {
    return false;
  }
  activeSlotInstances.set(slotId, token);
  return true;
}

export function releaseSlotInstance(slotId: string, token: symbol): void {
  if (activeSlotInstances.get(slotId) === token) {
    activeSlotInstances.delete(slotId);
  }
}

export function getActiveSlotInstanceCount(slotId?: string): number {
  if (slotId !== undefined) {
    return activeSlotInstances.has(slotId) ? 1 : 0;
  }
  return activeSlotInstances.size;
}

// Per-session rotation cap storage (enforces ExoClick max 10 rotations per user session)
const inMemorySessionRotations = new Map<string, number>();

export function getProviderSessionRotationCount(provider: RefreshCapableProvider): number {
  const key = `vx_ad_session_rotations_${provider}`;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(key);
      const parsed = raw ? Number(raw) : 0;
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback to in-memory map if storage is restricted
  }
  return inMemorySessionRotations.get(provider) ?? 0;
}

export function recordProviderSessionRotation(
  provider: RefreshCapableProvider,
  accountAuthorizedOverride?: boolean
): { recorded: boolean; count: number; maxSessionRotations: number | null } {
  const policy = getProviderRefreshPolicy(provider, { accountAuthorizedOverride });
  const current = getProviderSessionRotationCount(provider);
  if (!policy.supportsNativeRefresh || !policy.accountAuthorized) {
    return { recorded: false, count: current, maxSessionRotations: policy.maxSessionRotations };
  }
  if (policy.maxSessionRotations !== null && current >= policy.maxSessionRotations) {
    return { recorded: false, count: current, maxSessionRotations: policy.maxSessionRotations };
  }
  const next = current + 1;
  inMemorySessionRotations.set(provider, next);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`vx_ad_session_rotations_${provider}`, String(next));
    }
  } catch {
    // Ignore storage errors
  }
  return { recorded: true, count: next, maxSessionRotations: policy.maxSessionRotations };
}

export function resetProviderSessionRotations(provider?: RefreshCapableProvider): void {
  if (provider) {
    inMemorySessionRotations.delete(provider);
    try {
      sessionStorage?.removeItem?.(`vx_ad_session_rotations_${provider}`);
    } catch {
      // Ignore
    }
    return;
  }
  inMemorySessionRotations.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      for (const p of ['exoclick', 'trafficstars', 'adsterra', 'juicyads', 'monetag', 'adsense']) {
        sessionStorage.removeItem(`vx_ad_session_rotations_${p}`);
      }
    }
  } catch {
    // Ignore
  }
}

export interface VisibilityEligibilityParams {
  isPageVisible: boolean;
  isSlotVisible: boolean;
  isMounted: boolean;
  isSlotOwner: boolean;
}

export function isVisibilityEligibleForAdActivity({
  isPageVisible,
  isSlotVisible,
  isMounted,
  isSlotOwner,
}: VisibilityEligibilityParams): boolean {
  return Boolean(isPageVisible && isSlotVisible && isMounted && isSlotOwner);
}

export interface AuthorizedRefreshEvaluationParams {
  provider: RefreshCapableProvider;
  zoneId?: string | null;
  isPageVisible: boolean;
  isSlotVisible: boolean;
  isMounted: boolean;
  isChatroomActive: boolean;
  sessionRotationCount?: number;
  accountAuthorizedOverride?: boolean;
}

export interface AuthorizedRefreshDecision {
  allowed: boolean;
  intervalSec: number | null;
  usesCustomJsTimer: false;
  mechanism: 'provider_native_async' | 'none';
  reason: string;
}

/**
 * Mechanism 1: Evaluates whether provider-authorized native refresh is permitted.
 * Never permits a custom JS refresh timer (usesCustomJsTimer is always false).
 */
export function evaluateAuthorizedRefresh({
  provider,
  zoneId,
  isPageVisible,
  isSlotVisible,
  isMounted,
  isChatroomActive,
  sessionRotationCount,
  accountAuthorizedOverride,
}: AuthorizedRefreshEvaluationParams): AuthorizedRefreshDecision {
  const policy = getProviderRefreshPolicy(provider, {
    accountAuthorizedOverride,
    zoneIdOverride: zoneId,
  });

  if (!policy.supportsNativeRefresh || !policy.accountAuthorized || policy.chosenIntervalSec === null) {
    return {
      allowed: false,
      intervalSec: null,
      usesCustomJsTimer: false,
      mechanism: 'none',
      reason: policy.reason,
    };
  }

  if (!isMounted || !isChatroomActive || !isPageVisible || !isSlotVisible) {
    return {
      allowed: false,
      intervalSec: null,
      usesCustomJsTimer: false,
      mechanism: policy.mechanism,
      reason: 'Refresh paused: slot hidden, page backgrounded, inactive, or unmounted',
    };
  }

  const count =
    sessionRotationCount !== undefined
      ? sessionRotationCount
      : getProviderSessionRotationCount(provider);
  if (policy.maxSessionRotations !== null && count >= policy.maxSessionRotations) {
    return {
      allowed: false,
      intervalSec: null,
      usesCustomJsTimer: false,
      mechanism: policy.mechanism,
      reason: `Session cap reached (${count}/${policy.maxSessionRotations}) for ${provider}`,
    };
  }

  return {
    allowed: true,
    intervalSec: policy.chosenIntervalSec,
    usesCustomJsTimer: false,
    mechanism: policy.mechanism,
    reason: policy.reason,
  };
}

// Global queue for Adsterra to prevent atOptions collisions across concurrent slots
interface QueueItem {
  id: string;
  attemptId: number;
  isValid: () => boolean;
  load: () => Promise<void>;
}
let adsterraLoadQueue: QueueItem[] = [];
let isAdsterraProcessing = false;

export const cancelQueuedAdsterraTasksForSlot = (slotId: string) => {
  adsterraLoadQueue = adsterraLoadQueue.filter((item) => item.id !== slotId);
};

const processAdsterraQueue = async () => {
  if (isAdsterraProcessing || adsterraLoadQueue.length === 0) return;
  isAdsterraProcessing = true;

  while (adsterraLoadQueue.length > 0) {
    const item = adsterraLoadQueue.shift();
    if (item && item.isValid()) {
      try {
        await item.load();
      } catch (err) {
        console.error(`[Adsterra] Load error for slot ${item.id}:`, err);
      }
    }
  }

  isAdsterraProcessing = false;
};

// Track single script injection per URL to prevent duplicate <script> tags
export function ensureHeadScriptOnce(
  src: string,
  options?: {
    attrs?: Record<string, string>;
    onReady?: () => void;
    onError?: () => void;
    isStillValid?: () => boolean;
  }
): HTMLScriptElement | null {
  if (typeof document === 'undefined' || !document.head) return null;

  let existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
  if (existing && existing.getAttribute('data-ad-script-error') === 'true') {
    existing.remove();
    existing = null;
  }

  if (existing) {
    if (existing.getAttribute('data-ad-script-loaded') === 'true') {
      options?.onReady?.();
    } else {
      const handleLoad = () => {
        existing?.setAttribute('data-ad-script-loaded', 'true');
        if (!options?.isStillValid || options.isStillValid()) options?.onReady?.();
      };
      const handleErr = () => {
        existing?.setAttribute('data-ad-script-error', 'true');
        if (!options?.isStillValid || options.isStillValid()) options?.onError?.();
      };
      existing.addEventListener?.('load', handleLoad, { once: true });
      existing.addEventListener?.('error', handleErr, { once: true });
    }
    return existing;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  if (options?.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      script.setAttribute(k, v);
    }
  }
  script.addEventListener?.(
    'load',
    () => {
      script.setAttribute('data-ad-script-loaded', 'true');
      if (!options?.isStillValid || options.isStillValid()) options?.onReady?.();
    },
    { once: true }
  );
  script.addEventListener?.(
    'error',
    () => {
      script.setAttribute('data-ad-script-error', 'true');
      if (!options?.isStillValid || options.isStillValid()) options?.onError?.();
    },
    { once: true }
  );
  document.head.appendChild(script);
  return script;
}

function violatesCreativeBounds(
  width: number,
  height: number,
  options?: CreativeValidationOptions,
  intrinsic?: { width: number; height: number }
): string | null {
  if (!options) return null;

  if (options.expectedOrientation === 'vertical') {
    if (width <= 0 || height <= 0) {
      return `Unknown or zero dimensions (${width}x${height}) rejected in strictly vertical placement`;
    }
    if (width >= height) {
      const kind = width === height ? 'Square' : 'Landscape';
      return `${kind} creative (${width}x${height}) rejected in strictly vertical placement`;
    }
    if (intrinsic) {
      if (intrinsic.width <= 0 || intrinsic.height <= 0) {
        return `Unknown intrinsic media dimensions (${intrinsic.width}x${intrinsic.height}) rejected in strictly vertical placement`;
      }
      if (intrinsic.width >= intrinsic.height) {
        const kind = intrinsic.width === intrinsic.height ? 'Square' : 'Landscape';
        return `${kind} intrinsic media (${intrinsic.width}x${intrinsic.height}) rejected in strictly vertical placement`;
      }
    }
    if (options.maxAllowedHeight !== undefined && options.maxAllowedHeight > 0 && height > options.maxAllowedHeight + 4) {
      return `Oversized creative height (${width}x${height} > max ${options.maxAllowedHeight}px) rejected in vertical placement`;
    }
  } else if (options.expectedOrientation === 'horizontal') {
    if (width <= 0 || height <= 0) {
      return `Unknown or zero dimensions (${width}x${height}) rejected in strictly horizontal placement`;
    }
    if (height >= width) {
      const kind = width === height ? 'Square' : 'Vertical/portrait';
      return `${kind} creative (${width}x${height}) rejected in strictly horizontal placement`;
    }
    if (intrinsic) {
      if (intrinsic.width <= 0 || intrinsic.height <= 0) {
        return `Unknown intrinsic media dimensions (${intrinsic.width}x${intrinsic.height}) rejected in strictly horizontal placement`;
      }
      if (intrinsic.height >= intrinsic.width) {
        const kind = intrinsic.width === intrinsic.height ? 'Square' : 'Vertical/portrait';
        return `${kind} intrinsic media (${intrinsic.width}x${intrinsic.height}) rejected in strictly horizontal placement`;
      }
    }
    if (options.maxAllowedHeight !== undefined && options.maxAllowedHeight > 0 && height > options.maxAllowedHeight) {
      return `Oversized creative height (${width}x${height} > max ${options.maxAllowedHeight}px) rejected in horizontal placement`;
    }
  }

  if (intrinsic && intrinsic.width > 0 && intrinsic.height > 0 && width > 0 && height > 0) {
    const naturalRatio = intrinsic.width / intrinsic.height;
    const renderedRatio = width / height;
    const distortion = Math.max(naturalRatio / renderedRatio, renderedRatio / naturalRatio);
    if (distortion > 1.15) {
      return `Creative aspect ratio distortion (${intrinsic.width}x${intrinsic.height} rendered as ${width}x${height}) rejected`;
    }
  }

  if (options.maxAllowedWidth !== undefined && options.maxAllowedWidth > 0 && width > options.maxAllowedWidth + 4) {
    return `Oversized creative width (${width}x${height} > max ${options.maxAllowedWidth}px) rejected`;
  }
  return null;
}

/**
 * Inspects a candidate container DOM element and performs strict, defensible creative validation.
 * Distinguishes confirmed filled, unverifiable, unfilled, empty, and script-only states.
 */
export const validateCreative = (
  el: HTMLElement | null,
  options?: CreativeValidationOptions
): CreativeValidationResult => {
  if (!el) {
    return {
      status: 'empty',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: 'Container element is null or undefined',
    };
  }

  // 1. Provider-Documented Signals (e.g. Google AdSense data-ad-status attribute on ins)
  const insAdSense = el.matches?.('ins[data-ad-status]')
    ? el
    : el.querySelector?.('ins[data-ad-status]');
  if (insAdSense) {
    const statusAttr = insAdSense.getAttribute('data-ad-status');
    if (statusAttr === 'filled') {
      const insW = (insAdSense as HTMLElement).offsetWidth || (insAdSense as HTMLElement).clientWidth || 0;
      const insH = (insAdSense as HTMLElement).offsetHeight || (insAdSense as HTMLElement).clientHeight || 0;
      const boundViolation = violatesCreativeBounds(insW, insH, options);
      if (boundViolation) {
        return {
          status: 'unfilled',
          isConfirmedFilled: false,
          isUnverifiable: false,
          creativeDetected: false,
          reason: boundViolation,
        };
      }
      return {
        status: 'confirmed_filled',
        isConfirmedFilled: true,
        isUnverifiable: false,
        creativeDetected: true,
        reason: 'Provider documented signal: data-ad-status is filled',
      };
    }
    if (statusAttr === 'unfilled') {
      return {
        status: 'unfilled',
        isConfirmedFilled: false,
        isUnverifiable: false,
        creativeDetected: false,
        reason: 'Provider documented signal: data-ad-status is unfilled',
      };
    }
  }

  // 2. Scan ALL candidate elements in the container (supports multiple creatives where earlier candidate is tracking/pixel)
  let rejectedOrientationReason: string | null = null;

  // 2A. Image Creatives (e.g., Native banner image inside anchor or direct img)
  const images = Array.from(el.querySelectorAll?.('img') || []) as HTMLImageElement[];
  for (const img of images) {
    const style = img.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      img.getAttribute('aria-hidden') === 'true' ||
      img.hidden === true;

    if (isHidden) continue;

    const src = img.getAttribute('src') || img.src || '';
    const hasValidSrc = Boolean(src && src !== 'about:blank' && !src.endsWith('/'));
    if (!hasValidSrc) continue;

    // Rule: offsetWidth / clientWidth alone does NOT qualify without successful image loading!
    // Positive naturalWidth and naturalHeight verify actual image decoding and loading.
    const isLoaded = (img.naturalWidth || 0) > 0 && (img.naturalHeight || 0) > 0;
    const renderW = img.offsetWidth || img.clientWidth || 0;
    const renderH = img.offsetHeight || img.clientHeight || 0;
    const hasRenderedDimensions = renderW > 0 && renderH > 0;

    if (isLoaded && hasRenderedDimensions) {
      const boundViolation = violatesCreativeBounds(renderW, renderH, options, {
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
      });
      if (boundViolation) {
        rejectedOrientationReason = boundViolation;
        continue;
      }
      return {
        status: 'confirmed_filled',
        isConfirmedFilled: true,
        isUnverifiable: false,
        creativeDetected: true,
        reason: 'Image creative loaded successfully with positive natural and rendered dimensions',
      };
    }
  }

  // 2B. Video Creatives (<video>)
  const videos = Array.from(el.querySelectorAll?.('video') || []) as HTMLVideoElement[];
  for (const video of videos) {
    const style = video.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      video.getAttribute('aria-hidden') === 'true' ||
      video.hidden === true;

    if (isHidden) continue;

    const renderW = video.offsetWidth || video.clientWidth || 0;
    const renderH = video.offsetHeight || video.clientHeight || 0;
    const hasRenderedDimensions = renderW > 0 && renderH > 0;

    if (!hasRenderedDimensions) continue;

    const src = video.getAttribute('src') || video.src || '';
    const hasSourceTag = Boolean(video.querySelector?.('source[src]'));
    const hasValidSrc = Boolean((src && src !== 'about:blank') || hasSourceTag);
    if (!hasValidSrc) continue;

    // Defensible check: Video must have actual media data (positive videoWidth/videoHeight and readyState >= 2)
    const hasMediaDimensions = (video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0;
    const isReady = typeof video.readyState === 'number' ? video.readyState >= 2 : hasMediaDimensions;

    if (hasMediaDimensions && isReady) {
      const boundViolation = violatesCreativeBounds(renderW, renderH, options, {
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
      });
      if (boundViolation) {
        rejectedOrientationReason = boundViolation;
        continue;
      }
      return {
        status: 'confirmed_filled',
        isConfirmedFilled: true,
        isUnverifiable: false,
        creativeDetected: true,
        reason: 'Video creative verified with active media data (positive videoWidth and readyState)',
      };
    }
  }

  // 2C. Embedded Media (<object>, <embed>)
  const embeddedMedia = Array.from(el.querySelectorAll?.('object, embed') || []) as HTMLElement[];
  for (const media of embeddedMedia) {
    const style = media.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      media.getAttribute('aria-hidden') === 'true';

    if (isHidden) continue;

    const renderW = media.offsetWidth || media.clientWidth || 0;
    const renderH = media.offsetHeight || media.clientHeight || 0;
    const hasRenderedDimensions = renderW > 0 && renderH > 0;

    if (!hasRenderedDimensions) continue;

    const data = media.getAttribute('data') || (media as any).data || '';
    const src = media.getAttribute('src') || (media as any).src || '';
    const hasValidSource = Boolean((data && data !== 'about:blank') || (src && src !== 'about:blank'));
    if (!hasValidSource) continue;

    const boundViolation = violatesCreativeBounds(renderW, renderH, options);
    if (boundViolation) {
      rejectedOrientationReason = boundViolation;
      continue;
    }

    return {
      status: 'unverifiable',
      isConfirmedFilled: false,
      isUnverifiable: true,
      creativeDetected: true,
      reason: 'Embedded object/embed media detected with dimensions, classified conservatively as unverifiable without native load proof',
    };
  }

  // 2D. Iframe Creatives (cross-origin and same-origin)
  let hasPendingLoadingIframe = false;
  const iframes = Array.from(el.querySelectorAll?.('iframe') || []) as HTMLIFrameElement[];
  for (const iframe of iframes) {
    const style = iframe.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      iframe.getAttribute('aria-hidden') === 'true' ||
      iframe.hidden === true;

    if (isHidden) continue;

    if (iframe.getAttribute('data-ad-error') === 'true' || (iframe as any)._adError === true) {
      continue;
    }

    const renderW = iframe.offsetWidth || iframe.clientWidth || 0;
    const renderH = iframe.offsetHeight || iframe.clientHeight || 0;
    const hasRenderedDimensions = renderW > 0 && renderH > 0;

    if (!hasRenderedDimensions) continue;

    const src = iframe.getAttribute('src') || iframe.src || '';
    const srcdoc = iframe.getAttribute('srcdoc') || (iframe as any).srcdoc || '';
    const hasValidSrc = Boolean(
      (src && src !== 'about:blank' && src.trim() !== '') ||
      (srcdoc && srcdoc.trim() !== '')
    );

    if (!hasValidSrc) continue;

    const boundViolation = violatesCreativeBounds(renderW, renderH, options);
    if (boundViolation) {
      rejectedOrientationReason = boundViolation;
      continue;
    }

    // Attach lifecycle listeners if not already present
    if (!iframe.getAttribute('data-ad-loaded') && !iframe.getAttribute('data-ad-error')) {
      try {
        iframe.addEventListener?.('load', () => {
          iframe.setAttribute('data-ad-loaded', 'true');
        }, { once: true });
        iframe.addEventListener?.('error', () => {
          iframe.setAttribute('data-ad-error', 'true');
        }, { once: true });
      } catch {
        // safe fallback
      }
    }

    // Attempt same-origin check without violating cross-origin browser security restrictions
    let isSameOrigin = false;
    let sameOriginDoc: Document | null = null;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        isSameOrigin = true;
        sameOriginDoc = doc;
      }
    } catch {
      isSameOrigin = false;
    }

    // Check observable load lifecycle
    const isLoaded =
      iframe.getAttribute('data-ad-loaded') === 'true' ||
      (iframe as any)._adLoaded === true ||
      (iframe as any).complete === true ||
      Boolean(isSameOrigin && sameOriginDoc?.readyState === 'complete');

    if (!isLoaded) {
      hasPendingLoadingIframe = true;
      continue;
    }

    if (isSameOrigin && sameOriginDoc) {
      const body = sameOriginDoc.body;
      if (body) {
        const innerImg = body.querySelector?.('img') as HTMLImageElement | null;
        const innerVideo = body.querySelector?.('video') as HTMLVideoElement | null;
        const innerAdCreative = body.querySelector?.('[data-ad-status="filled"], [data-ad-creative="true"]') as HTMLElement | null;
        const innerLink = body.querySelector?.('a[href]') as HTMLAnchorElement | null;

        const innerImgW = innerImg ? (innerImg.offsetWidth || innerImg.clientWidth || renderW) : 0;
        const innerImgH = innerImg ? (innerImg.offsetHeight || innerImg.clientHeight || renderH) : 0;
        const hasValidInnerImg = Boolean(
          innerImg &&
          (innerImg.naturalWidth || 0) > 0 &&
          (innerImg.naturalHeight || 0) > 0 &&
          (innerImg.offsetWidth || 0) > 0 &&
          (innerImg.offsetHeight || 0) > 0 &&
          innerImg.src && innerImg.src !== 'about:blank' &&
          !violatesCreativeBounds(innerImgW, innerImgH, options, {
            width: innerImg.naturalWidth || 0,
            height: innerImg.naturalHeight || 0,
          })
        );

        const innerVideoW = innerVideo ? (innerVideo.offsetWidth || innerVideo.clientWidth || renderW) : 0;
        const innerVideoH = innerVideo ? (innerVideo.offsetHeight || innerVideo.clientHeight || renderH) : 0;
        const hasValidInnerVideo = Boolean(
          innerVideo &&
          (innerVideo.videoWidth || 0) > 0 &&
          (typeof innerVideo.readyState === 'number' ? innerVideo.readyState >= 2 : true) &&
          !violatesCreativeBounds(innerVideoW, innerVideoH, options, {
            width: innerVideo.videoWidth || 0,
            height: innerVideo.videoHeight || 0,
          })
        );

        const hasValidInnerAdSignal = Boolean(
          innerAdCreative &&
          !violatesCreativeBounds(
            innerAdCreative.offsetWidth || renderW,
            innerAdCreative.offsetHeight || renderH,
            options
          )
        );

        const hasClickableBanner = Boolean(
          innerLink &&
          ((innerLink.offsetWidth || 0) > 0 && (innerLink.offsetHeight || 0) > 0) &&
          hasValidInnerImg
        );

        if (hasValidInnerImg || hasValidInnerVideo || hasValidInnerAdSignal || hasClickableBanner) {
          return {
            status: 'confirmed_filled',
            isConfirmedFilled: true,
            isUnverifiable: false,
            creativeDetected: true,
            reason: 'Same-origin iframe creative verified with defensible creative asset (loaded image, media, or ad creative signal)',
          };
        }
      }
      continue;
    }

    return {
      status: 'unverifiable',
      isConfirmedFilled: false,
      isUnverifiable: true,
      creativeDetected: true,
      reason: 'Cross-origin iframe completed load with valid URL and rendered dimensions; internal content unverifiable under browser security restrictions',
    };
  }

  if (hasPendingLoadingIframe) {
    return {
      status: 'request_attempted',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: true,
      reason: 'Iframe creative detected in DOM but observable load lifecycle is still pending',
    };
  }

  if (rejectedOrientationReason) {
    return {
      status: 'unfilled',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: rejectedOrientationReason,
    };
  }

  // 3. Fallback Classification for Non-Creative Containers
  const allChildren = Array.from(el.querySelectorAll?.('*') || []);
  const nonScriptChildren = allChildren.filter(c => c.tagName !== 'SCRIPT');

  if (allChildren.length > 0 && nonScriptChildren.length === 0) {
    return {
      status: 'script_only',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: 'Container contains only script elements',
    };
  }

  const textContent = el.textContent?.trim() || '';
  if (allChildren.length === 0 && !textContent) {
    return {
      status: 'empty',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: 'Container is completely empty',
    };
  }

  return {
    status: 'unfilled',
    isConfirmedFilled: false,
    isUnverifiable: false,
    creativeDetected: false,
    reason: 'Container contains no qualifying creative (broken images, zero-dimension frames, or arbitrary non-creative DOM)',
  };
};

/**
 * Backward-compatible helper. Returns true ONLY for confirmed filled creatives.
 * Unverifiable cross-origin iframes, broken images, and empty wrappers evaluate to false.
 */
export const hasValidCreative = (
  el: HTMLElement | null,
  options?: CreativeValidationOptions
): boolean => {
  return validateCreative(el, options).isConfirmedFilled;
};

export interface UnitResolutionParams {
  provider: AdProvider;
  position?: AdSlotPosition;
  slotId: string;
  isVertical?: boolean;
  containerWidth: number | null;
  primaryAdUnitId?: string;
  isLiveChatScreen: boolean;
}

export function resolveEffectiveUnitId({
  provider,
  position,
  slotId,
  isVertical = false,
  containerWidth,
  primaryAdUnitId,
  isLiveChatScreen,
}: UnitResolutionParams): string | null {
  // 1. Google AdSense is STRICTLY & NON-OVERRIDABLY EXCLUDED from chat/private screens
  if (provider === 'adsense' && isLiveChatScreen) {
    return null;
  }
  // Adsterra is strictly Footer-only
  if (provider === 'adsterra' && position !== 'footer' && !slotId?.includes('footer')) {
    return null;
  }
  // Monetag is strictly restricted to the single dedicated public-chatroom-body-bottom slot
  if (provider === 'monetag' && slotId !== 'public-chatroom-body-bottom') {
    return null;
  }

  // 2. Check if provider is enabled in system configuration
  if (provider === 'exoclick' && !EXOCLICK_CONFIG.enabled) return null;
  if (provider === 'monetag' && !MONETAG_CONFIG.enabled) return null;
  if (provider === 'juicyads' && !JUICYADS_CONFIG.enabled) return null;
  if (provider === 'adsterra' && !ADSTERRA_CONFIG.enabled) return null;
  if (provider === 'adsense' && !ADSENSE_CONFIG.enabled) return null;

  // 3. Reject Publisher ID if accidentally passed as a unit ID
  const sanitizedPrimaryUnit =
    primaryAdUnitId && primaryAdUnitId !== ADSTERRA_CONFIG.publisherId
      ? primaryAdUnitId
      : undefined;

  const posStr = String(position || '');
  const isInternalInline = isInternalHorizontalPlacement(slotId);
  const isParticipantBar = slotId === 'participant-box-horizontal';
  const isVerticalSlot = !isInternalInline && !isParticipantBar && (isVertical || posStr === 'left' || posStr === 'right');

  const isHorizontalBanner =
    !isVerticalSlot &&
    (posStr === 'top' ||
      posStr === 'bottom' ||
      posStr === 'footer' ||
      posStr === 'content-gap' ||
      posStr === 'sidebar-horizontal' ||
      posStr === 'status-inline' ||
      posStr === 'message-inline' ||
      isInternalInline ||
      isParticipantBar ||
      slotId.includes('top') ||
      slotId.includes('bottom'));

  // 4. Strict Vertical Sidebar Enforcement
  // Vertical sidebars must ONLY resolve provider formats with verified vertical (height > width) dimensions.
  // Never substitute landscape (300x250, 300x262, 320x50, 728x90), square, native widget, or un-dimensioned zones.
  if (isVerticalSlot) {
    if (containerWidth !== null && containerWidth < 160) {
      return null;
    }
    if (sanitizedPrimaryUnit) {
      const verifiedSpec = getVerifiedAdUnitSpec(sanitizedPrimaryUnit, provider);
      if (
        verifiedSpec &&
        verifiedSpec.orientation === 'vertical' &&
        verifiedSpec.height > verifiedSpec.width &&
        (containerWidth === null || verifiedSpec.width <= containerWidth)
      ) {
        return verifiedSpec.id;
      }
    }
    const verifiedVertical = getVerifiedVerticalUnitForProvider(provider, containerWidth);
    return verifiedVertical ? verifiedVertical.id : null;
  }

  // 5. Horizontal Provider-Specific Unit Resolution
  if (provider === 'adsterra') {
    if (isHorizontalBanner) {
      if (containerWidth !== null) {
        if (containerWidth < 320) {
          // Cannot safely accommodate a 320x50 banner without clipping or overflow
          return null;
        }
        if (containerWidth < 728) {
          // Narrow viewport (mobile or tablet): always select 320x50
          return ADSTERRA_CONFIG.banner320x50;
        }
        // Inline / participant placements remain strictly compact (320x50 landscape)
        if (posStr === 'sidebar-horizontal' || isInternalInline || isParticipantBar || slotId.includes('inline') || slotId.includes('participant')) {
          return ADSTERRA_CONFIG.banner320x50;
        }
        return ADSTERRA_CONFIG.banner728x90;
      }

      if (posStr === 'sidebar-horizontal' || isInternalInline || isParticipantBar || slotId.includes('inline') || slotId.includes('participant')) {
        return ADSTERRA_CONFIG.banner320x50;
      }
      return sanitizedPrimaryUnit || ADSTERRA_CONFIG.banner728x90;
    }

    return null;
  }

  if (provider === 'juicyads') {
    // Horizontal JuicyAds
    if (containerWidth !== null && containerWidth < 300) {
      return null;
    }

    // Participant Bar: dedicated 300x112 zone (fits 300x120 target cleanly on mobile & desktop)
    if (isParticipantBar) {
      return JUICYADS_CONFIG.zones.banner300x112; // 1131767
    }

    // Internal inline placements: ALWAYS compact horizontal 300x62
    if (isInternalInline) {
      return JUICYADS_CONFIG.zones.banner300x62; // 1131763
    }

    if (posStr === 'top' || posStr === 'bottom' || posStr === 'footer' || posStr === 'content-gap') {
      if (containerWidth !== null && containerWidth >= 728) {
        return JUICYADS_CONFIG.zones.banner728x102; // 1131766
      }
      return JUICYADS_CONFIG.zones.banner300x62; // 1131763
    }

    return JUICYADS_CONFIG.zones.banner300x62; // 1131763
  }

  if (provider === 'exoclick') {
    if (isHorizontalBanner && containerWidth !== null && containerWidth < 300) {
      return null;
    }
    return EXOCLICK_CONFIG.zoneId; // 6087300
  }

  if (provider === 'monetag') {
    if (isHorizontalBanner && containerWidth !== null && containerWidth < 300) {
      return null;
    }
    return MONETAG_CONFIG.zoneId; // 12241585
  }

  if (provider === 'adsense') {
    return ADSENSE_CONFIG.adSlot; // 1929701241
  }

  return sanitizedPrimaryUnit || null;
}

export interface ProviderTransitionDecision {
  shouldRotate: boolean;
  nextIndex: number;
  nextStatus: AdSlotStatus;
  isTerminal: boolean;
  action: 'rotate' | 'settle';
}

/**
 * Computes deterministic provider rotation transition.
 * Encapsulates the production transition logic used by AdPlacementBox and unit tests.
 */
export function computeProviderTransition(
  status: 'filled' | 'unfilled' | 'error' | 'unverifiable',
  currentIndex: number,
  rotation: readonly AdProvider[],
  explicitProvider?: AdProvider
): ProviderTransitionDecision {
  const isFailure = status === 'unfilled' || status === 'error';
  const hasNext = !explicitProvider && currentIndex < rotation.length - 1;

  if (isFailure && hasNext) {
    return {
      shouldRotate: true,
      nextIndex: currentIndex + 1,
      nextStatus: 'idle',
      isTerminal: false,
      action: 'rotate',
    };
  }

  return {
    shouldRotate: false,
    nextIndex: currentIndex,
    nextStatus: status,
    isTerminal: true,
    action: 'settle',
  };
}

export interface ResizeReevaluationParams {
  adStatus: AdSlotStatus;
  prevWidth: number | null;
  nextWidth: number | null;
  explicitProvider?: AdProvider;
  primaryRotationProvider: AdProvider;
  getEffectiveUnitId: (provider: AdProvider, width: number | null) => string | null;
}

/**
 * Prevents infinite retry loops when all providers are unfilled/errored at an
 * unchanged container width. Only resets a failed/unfilled slot to idle when a
 * genuine viewport resize changes the eligible unit for the primary provider.
 */
export function shouldReevaluateSlotOnResize({
  adStatus,
  prevWidth,
  nextWidth,
  explicitProvider,
  primaryRotationProvider,
  getEffectiveUnitId,
}: ResizeReevaluationParams): boolean {
  if (nextWidth === null || prevWidth === null || prevWidth === nextWidth) {
    return false;
  }
  if (adStatus !== 'unfilled' && adStatus !== 'error') {
    return false;
  }
  const targetProvider = explicitProvider || primaryRotationProvider;
  const prevUnit = getEffectiveUnitId(targetProvider, prevWidth);
  const nextUnit = getEffectiveUnitId(targetProvider, nextWidth);
  return Boolean(nextUnit && nextUnit !== prevUnit);
}

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({
  slotId,
  provider: explicitProvider,
  className = '',
  isVertical = false,
  position,
  adUnitId: primaryAdUnitId,
  onStatusChange,
  renderAd,
  isLiveChatScreen: isLiveChatScreenProp,
}) => {
  const { currentRoute } = useRouter();

  // Non-Overridable AdSense Route Exclusion Policy
  const isExcludedByRoute = isAdSenseExcludedRoute(currentRoute);
  const effectiveIsLiveChatScreen = isExcludedByRoute || Boolean(isLiveChatScreenProp);

  // Reserved Dimension & Orientation Target
  const orientation = getPlacementOrientation(slotId, position, isVertical);
  const reservedTarget = useMemo(
    () => getReservedDimensionTarget(slotId, position, isVertical),
    [slotId, position, isVertical]
  );

  // 1. Mandatory Stable Hook Declarations
  const [adStatus, setAdStatus] = useState<AdSlotStatus>('idle');
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [providerIndex, setProviderIndex] = useState(0);
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  const [isSlotVisible, setIsSlotVisible] = useState<boolean>(
    () => typeof IntersectionObserver === 'undefined'
  );

  const adRef = useRef<HTMLDivElement | null>(null);
  const imperativeHostRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const slotInstanceTokenRef = useRef<symbol>(Symbol(`ad-slot-${slotId}`));
  const isSlotOwnerRef = useRef(false);
  const attemptIdRef = useRef(0);
  const observerRef = useRef<MutationObserver | null>(null);
  const lastReportedStatusRef = useRef<'filled' | 'unfilled' | 'error' | 'unverifiable' | null>(null);
  const activeTimersRef = useRef<Array<number | NodeJS.Timeout>>([]);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const ownedNativeScriptRef = useRef<HTMLScriptElement | null>(null);
  const prevChatExclusionRef = useRef<boolean>(effectiveIsLiveChatScreen);
  const settledUnitSignatureRef = useRef<string | null>(null);
  const settledRequiredWidthRef = useRef<number | null>(null);
  const prevContainerWidthRef = useRef<number | null>(null);
  const adStatusRef = useRef<AdSlotStatus>(adStatus);
  adStatusRef.current = adStatus;
  const sessionRotationParityRef = useRef<number>(getSessionAdRotationParity());

  const clearAllActiveTimers = useCallback(() => {
    activeTimersRef.current.forEach((t) => {
      clearInterval(t as any);
      clearTimeout(t as any);
    });
    activeTimersRef.current = [];
  }, []);

  const disconnectObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  const cleanupSlotRuntime = useCallback(() => {
    attemptIdRef.current += 1;
    cancelQueuedAdsterraTasksForSlot(slotId);
    clearAllActiveTimers();
    disconnectObserver();
    if (ownedNativeScriptRef.current && ownedNativeScriptRef.current.parentNode) {
      ownedNativeScriptRef.current.parentNode.removeChild(ownedNativeScriptRef.current);
    }
    ownedNativeScriptRef.current = null;
  }, [slotId, clearAllActiveTimers, disconnectObserver]);

  const rotationKey = effectiveIsLiveChatScreen ? 'chat' : 'public';
  const rotation = useMemo(
    () =>
      getProviderRotation(
        position || '',
        effectiveIsLiveChatScreen,
        slotId,
        sessionRotationParityRef.current
      ),
    [position, rotationKey, slotId]
  );
  const currentProvider = explicitProvider || rotation[providerIndex] || rotation[0];

  const getEffectiveUnitId = useCallback(
    (p: AdProvider, widthOverride?: number | null): string | null => {
      return resolveEffectiveUnitId({
        provider: p,
        position,
        slotId,
        isVertical,
        containerWidth: widthOverride !== undefined ? widthOverride : containerWidth,
        primaryAdUnitId,
        isLiveChatScreen: effectiveIsLiveChatScreen,
      });
    },
    [position, slotId, isVertical, containerWidth, primaryAdUnitId, effectiveIsLiveChatScreen]
  );

  const effectiveUnitId = getEffectiveUnitId(currentProvider);

  // Cleanly reset only if route-level AdSense exclusion status changes
  useEffect(() => {
    if (prevChatExclusionRef.current !== effectiveIsLiveChatScreen) {
      prevChatExclusionRef.current = effectiveIsLiveChatScreen;
      cleanupSlotRuntime();
      settledUnitSignatureRef.current = null;
      settledRequiredWidthRef.current = null;
      if (imperativeHostRef.current && !renderAd) {
        imperativeHostRef.current.innerHTML = '';
      }
      setProviderIndex(0);
      setAdStatus('idle');
    }
  }, [effectiveIsLiveChatScreen, cleanupSlotRuntime, renderAd]);

  // Clean up on provider rotation change
  useEffect(() => {
    return () => {
      cleanupSlotRuntime();
    };
  }, [providerIndex, cleanupSlotRuntime]);

  const validationOptions: CreativeValidationOptions = useMemo(
    () => ({
      expectedOrientation: reservedTarget.orientation,
      maxAllowedHeight: reservedTarget.maxHeight,
      maxAllowedWidth:
        containerWidth !== null
          ? Math.min(Math.max(containerWidth, reservedTarget.minWidth), reservedTarget.maxWidth)
          : reservedTarget.maxWidth,
    }),
    [reservedTarget, containerWidth]
  );

  const updateStatus = useCallback(
    (status: 'filled' | 'unfilled' | 'error' | 'unverifiable', capturedAttemptId?: number) => {
      if (!isMountedRef.current) return;
      if (capturedAttemptId !== undefined && capturedAttemptId !== attemptIdRef.current) {
        return; // Stale async callback rejected safely
      }

      clearAllActiveTimers();
      disconnectObserver();

      const decision = computeProviderTransition(status, providerIndex, rotation, explicitProvider);

      if (decision.shouldRotate) {
        attemptIdRef.current += 1;
        cancelQueuedAdsterraTasksForSlot(slotId);
        if (imperativeHostRef.current && !renderAd) {
          imperativeHostRef.current.innerHTML = '';
        }
        settledUnitSignatureRef.current = null;
        settledRequiredWidthRef.current = null;
        setProviderIndex(decision.nextIndex);
        setAdStatus(decision.nextStatus);
      } else {
        if (decision.nextStatus === 'filled' || decision.nextStatus === 'unverifiable') {
          settledUnitSignatureRef.current = `${currentProvider}:${effectiveUnitId}:${rotationKey}`;
          const verifiedSpec = effectiveUnitId
            ? getVerifiedAdUnitSpec(effectiveUnitId, currentProvider)
            : null;
          settledRequiredWidthRef.current = verifiedSpec ? verifiedSpec.width : null;
        } else {
          settledUnitSignatureRef.current = null;
          settledRequiredWidthRef.current = null;
        }
        setAdStatus(decision.nextStatus);
        if (lastReportedStatusRef.current !== status) {
          lastReportedStatusRef.current = status;
          onStatusChangeRef.current?.(status);
        }
      }
    },
    [
      explicitProvider,
      providerIndex,
      rotation,
      slotId,
      renderAd,
      currentProvider,
      effectiveUnitId,
      rotationKey,
      clearAllActiveTimers,
      disconnectObserver,
    ]
  );

  // 2. Lifecycle, Single-Instance Ownership, Visibility & Measurement
  useEffect(() => {
    isMountedRef.current = true;
    const token = slotInstanceTokenRef.current;
    isSlotOwnerRef.current = claimSlotInstance(slotId, token);
    const container = adRef.current;

    const handleCaptureLoad = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'IFRAME') {
        target.setAttribute('data-ad-loaded', 'true');
      }
    };

    const handleCaptureError = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'IFRAME') {
        target.setAttribute('data-ad-error', 'true');
      }
    };

    if (container) {
      container.addEventListener('load', handleCaptureLoad, true);
      container.addEventListener('error', handleCaptureError, true);
    }

    const handleVisibilityChange = () => {
      const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
      setIsPageVisible(visible);
      if (!visible && adStatusRef.current === 'loading') {
        cleanupSlotRuntime();
        setAdStatus('idle');
      }
    };

    const handlePageHide = () => {
      setIsPageVisible(false);
      if (adStatusRef.current === 'loading') {
        cleanupSlotRuntime();
        setAdStatus('idle');
      }
    };

    const handlePageShow = () => {
      const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
      setIsPageVisible(visible);
    };

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', handlePageHide);
      window.addEventListener('pageshow', handlePageShow);
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && adRef.current) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          const intersecting = Boolean(entry && (entry.isIntersecting || entry.intersectionRatio > 0));
          setIsSlotVisible(intersecting);
          if (!intersecting && adStatusRef.current === 'loading') {
            cleanupSlotRuntime();
            setAdStatus('idle');
          }
        },
        { threshold: 0.01 }
      );
      intersectionObserver.observe(adRef.current);
    } else {
      setIsSlotVisible(true);
    }

    const updateWidth = () => {
      if (adRef.current) {
        const w = adRef.current.offsetWidth;
        // Never emit 0 width when container is hidden via display:none (e.g. responsive breakpoint)
        if (w > 0) {
          setContainerWidth((prev) => (prev === w ? prev : w));
        }
      }
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    if (adRef.current) resizeObserver.observe(adRef.current);

    return () => {
      isMountedRef.current = false;
      isSlotOwnerRef.current = false;
      releaseSlotInstance(slotId, token);
      if (container) {
        container.removeEventListener('load', handleCaptureLoad, true);
        container.removeEventListener('error', handleCaptureError, true);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', handlePageHide);
        window.removeEventListener('pageshow', handlePageShow);
      }
      if (intersectionObserver) {
        intersectionObserver.disconnect();
      }
      cleanupSlotRuntime();
      resizeObserver.disconnect();
    };
  }, [slotId, cleanupSlotRuntime]);

  // Re-evaluate ONLY when viewport width genuinely crossed a breakpoint threshold while unfilled
  // OR shrank below a settled fixed unit width (never loop infinitely on constant width)
  useEffect(() => {
    if (containerWidth === null || renderAd) return;
    const prevWidth = prevContainerWidthRef.current;
    prevContainerWidthRef.current = containerWidth;

    if (
      shouldReevaluateSlotOnResize({
        adStatus,
        prevWidth,
        nextWidth: containerWidth,
        explicitProvider,
        primaryRotationProvider: rotation[0],
        getEffectiveUnitId,
      })
    ) {
      settledUnitSignatureRef.current = null;
      settledRequiredWidthRef.current = null;
      setProviderIndex(0);
      setAdStatus('idle');
      return;
    }

    if (
      (adStatus === 'filled' || adStatus === 'unverifiable') &&
      settledRequiredWidthRef.current !== null &&
      containerWidth < settledRequiredWidthRef.current
    ) {
      cleanupSlotRuntime();
      if (imperativeHostRef.current) {
        imperativeHostRef.current.innerHTML = '';
      }
      settledUnitSignatureRef.current = null;
      settledRequiredWidthRef.current = null;
      setProviderIndex(0);
      setAdStatus('idle');
    }
  }, [
    containerWidth,
    adStatus,
    renderAd,
    explicitProvider,
    rotation,
    getEffectiveUnitId,
    cleanupSlotRuntime,
  ]);

  // 3. Orchestration Effect
  useEffect(() => {
    if (adStatus !== 'idle') return;
    if (containerWidth === null || containerWidth <= 0) return;
    if (
      !isVisibilityEligibleForAdActivity({
        isPageVisible,
        isSlotVisible,
        isMounted: isMountedRef.current,
        isSlotOwner: isSlotOwnerRef.current,
      })
    ) {
      return;
    }

    const signature = `${currentProvider}:${effectiveUnitId}:${rotationKey}`;
    if (settledUnitSignatureRef.current === signature) {
      return;
    }

    const attemptId = ++attemptIdRef.current;

    if (renderAd) {
      const content = renderAd();
      updateStatus(content ? 'filled' : 'unfilled', attemptId);
      return;
    }

    if (!effectiveUnitId) {
      updateStatus('unfilled', attemptId);
      return;
    }

    // Strict Dimension & Width Constraints
    if (currentProvider === 'adsterra') {
      if (effectiveUnitId === ADSTERRA_CONFIG.banner320x50 && containerWidth < 320) {
        updateStatus('unfilled', attemptId);
        return;
      }
      if (effectiveUnitId === ADSTERRA_CONFIG.banner728x90 && containerWidth < 728) {
        updateStatus('unfilled', attemptId);
        return;
      }
      if (effectiveUnitId === ADSTERRA_CONFIG.banner300x250 && containerWidth < 300) {
        updateStatus('unfilled', attemptId);
        return;
      }
    }

    if (currentProvider === 'juicyads') {
      if (effectiveUnitId === JUICYADS_CONFIG.zones.banner728x102 && containerWidth < 728) {
        updateStatus('unfilled', attemptId);
        return;
      }
      if (
        (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x62 ||
          effectiveUnitId === JUICYADS_CONFIG.zones.banner300x112 ||
          effectiveUnitId === JUICYADS_CONFIG.zones.banner300x262) &&
        containerWidth < 300
      ) {
        updateStatus('unfilled', attemptId);
        return;
      }
    }

    setAdStatus('loading');

    const startPolling = (
      getTargetEl: () => HTMLElement | null,
      baseTimeoutTicks: number,
      maxGraceTicks: number,
      onComplete?: () => void
    ) => {
      let ticks = 0;
      const timer = setInterval(() => {
        if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
          clearInterval(timer);
          onComplete?.();
          return;
        }
        const target = getTargetEl();
        const val = validateCreative(target, validationOptions);
        if (val.isConfirmedFilled) {
          clearInterval(timer);
          updateStatus('filled', attemptId);
          onComplete?.();
          return;
        }
        if (val.isUnverifiable) {
          clearInterval(timer);
          updateStatus('unverifiable', attemptId);
          onComplete?.();
          return;
        }
        ticks++;
        if (val.status === 'request_attempted') {
          if (ticks >= maxGraceTicks) {
            clearInterval(timer);
            updateStatus('unfilled', attemptId);
            onComplete?.();
          }
          return;
        }
        if (ticks >= baseTimeoutTicks) {
          clearInterval(timer);
          updateStatus('unfilled', attemptId);
          onComplete?.();
        }
      }, 300);
      activeTimersRef.current.push(timer);
    };

    if (currentProvider === 'juicyads') {
      try {
        if (!imperativeHostRef.current) {
          updateStatus('error', attemptId);
          return;
        }

        let width = 300;
        let height = 250;
        if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x62) {
          width = 300;
          height = 62;
        } else if (effectiveUnitId === JUICYADS_CONFIG.zones.banner728x102) {
          width = 728;
          height = 102;
        } else if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x262) {
          width = 300;
          height = 262;
        } else if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x112) {
          width = 300;
          height = 112;
        }

        const domId = `juicyads-ins-${effectiveUnitId}-${slotId}`;
        imperativeHostRef.current.innerHTML = `<ins id="${domId}" data-width="${width}" data-height="${height}"></ins>`;

        ensureHeadScriptOnce(JUICYADS_CONFIG.scriptUrl, {
          isStillValid: () => isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current),
          onError: () => updateStatus('error', attemptId),
        });

        const win = window as any;
        win.adsbyjuicy = win.adsbyjuicy || [];
        win.adsbyjuicy.push({ adzone: effectiveUnitId, id: domId });

        startPolling(() => document.getElementById(domId), 12, 18);
      } catch {
        updateStatus('error', attemptId);
      }
    } else if (currentProvider === 'adsense') {
      if (effectiveIsLiveChatScreen) {
        updateStatus('unfilled', attemptId);
        return;
      }
      try {
        const win = window as any;
        if (win.adsbygoogle) {
          win.adsbygoogle.push({});

          if (adRef.current) {
            const obs = new MutationObserver(() => {
              if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) return;
              const ins = adRef.current?.querySelector('ins') as HTMLElement | null;
              const val = validateCreative(ins, validationOptions);
              if (val.isConfirmedFilled) updateStatus('filled', attemptId);
              else if (val.status === 'unfilled') updateStatus('unfilled', attemptId);
            });
            obs.observe(adRef.current, { attributes: true, subtree: true });
            observerRef.current = obs;
          }

          const adsenseTimeout = setTimeout(() => {
            if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) return;
            const ins = adRef.current?.querySelector('ins') as HTMLElement | null;
            const val = validateCreative(ins, validationOptions);
            if (!val.isConfirmedFilled) {
              updateStatus('unfilled', attemptId);
            }
          }, 4000);
          activeTimersRef.current.push(adsenseTimeout);
        } else {
          const unavailableTimeout = setTimeout(() => {
            if (isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
              updateStatus('unfilled', attemptId);
            }
          }, 1200);
          activeTimersRef.current.push(unavailableTimeout);
        }
      } catch {
        updateStatus('error', attemptId);
      }
    } else if (currentProvider === 'adsterra') {
      const isNative = effectiveUnitId === ADSTERRA_CONFIG.nativeUnitId;

      const loadTask = () =>
        new Promise<void>((resolve) => {
          if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
            resolve();
            return;
          }

          if (isNative) {
            const containerId = `container-${effectiveUnitId}`;
            const existing = document.getElementById(containerId);

            // Prevent multiple slots from sharing the single-instance native DOM container ID
            if (existing && !imperativeHostRef.current?.contains(existing)) {
              updateStatus('unfilled', attemptId);
              resolve();
              return;
            }

            if (imperativeHostRef.current) {
              imperativeHostRef.current.innerHTML = `<div id="${containerId}" class="w-full h-full flex flex-col items-center justify-center overflow-hidden"></div>`;
            }

            const scriptSrc = `https://${ADSTERRA_CONFIG.nativeDomain}/${ADSTERRA_CONFIG.nativeUnitId}/invoke.js`;
            const existingNativeScript = document.querySelector(
              `script[src="${scriptSrc}"]`
            ) as HTMLScriptElement | null;
            if (existingNativeScript) {
              existingNativeScript.remove();
            }

            const script = document.createElement('script');
            script.async = true;
            script.setAttribute('data-cfasync', 'false');
            script.setAttribute('data-ad-slot-script', slotId);
            script.src = scriptSrc;
            ownedNativeScriptRef.current = script;

            script.onload = () => {
              if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
                resolve();
                return;
              }
              let attempts = 0;
              const checkNativeFill = setInterval(() => {
                if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
                  clearInterval(checkNativeFill);
                  resolve();
                  return;
                }
                const el = document.getElementById(containerId);
                const val = validateCreative(el, validationOptions);
                if (val.isConfirmedFilled) {
                  clearInterval(checkNativeFill);
                  updateStatus('filled', attemptId);
                  resolve();
                  return;
                }
                if (val.isUnverifiable) {
                  clearInterval(checkNativeFill);
                  updateStatus('unverifiable', attemptId);
                  resolve();
                  return;
                }
                attempts++;
                if (val.status === 'request_attempted') {
                  if (attempts >= 15) {
                    clearInterval(checkNativeFill);
                    updateStatus('unfilled', attemptId);
                    resolve();
                  }
                  return;
                }
                if (attempts >= 5 && val.status === 'empty') {
                  clearInterval(checkNativeFill);
                  updateStatus('unfilled', attemptId);
                  resolve();
                  return;
                }
                if (attempts >= 12) {
                  clearInterval(checkNativeFill);
                  updateStatus('unfilled', attemptId);
                  resolve();
                }
              }, 300);
              activeTimersRef.current.push(checkNativeFill);
            };
            script.onerror = () => {
              if (isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
                updateStatus('error', attemptId);
              }
              resolve();
            };
            document.head.appendChild(script);
          } else {
            // Adsterra Iframe Banner (320x50, 728x90, 300x250)
            let h = 250;
            let w = 300;
            if (effectiveUnitId === ADSTERRA_CONFIG.banner320x50) {
              h = 50;
              w = 320;
            } else if (effectiveUnitId === ADSTERRA_CONFIG.banner728x90) {
              h = 90;
              w = 728;
            }

            if (!imperativeHostRef.current) {
              resolve();
              return;
            }

            imperativeHostRef.current.innerHTML = '';

            (window as any).atOptions = {
              key: effectiveUnitId,
              format: 'iframe',
              height: h,
              width: w,
              params: {},
            };

            const scriptSrc = `https://${ADSTERRA_CONFIG.bannerDomain}/${effectiveUnitId}/invoke.js`;
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.src = scriptSrc;

            script.onload = () => {
              if (!isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
                resolve();
                return;
              }
              // Poll robustly after script onload so pending cross-origin iframes (request_attempted) can complete loading
              startPolling(() => imperativeHostRef.current, 12, 18, resolve);
            };
            script.onerror = () => {
              if (isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current)) {
                updateStatus('error', attemptId);
              }
              resolve();
            };

            imperativeHostRef.current.appendChild(script);
          }
        });

      cancelQueuedAdsterraTasksForSlot(slotId);
      adsterraLoadQueue.push({
        id: slotId,
        attemptId,
        isValid: () => isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current),
        load: loadTask,
      });
      processAdsterraQueue();
    } else if (currentProvider === 'exoclick') {
      try {
        if (!imperativeHostRef.current) {
          updateStatus('error', attemptId);
          return;
        }
        const domId = `exoclick-ins-${EXOCLICK_CONFIG.zoneId}-${slotId}`;
        imperativeHostRef.current.innerHTML = `<ins id="${domId}" class="${EXOCLICK_CONFIG.elementClass}" data-zoneid="${EXOCLICK_CONFIG.zoneId}" data-keywords="chat,bangla,desi,dating,social,friendship,community,online,international,south-asia,bangladesh,india,usa,united-states,uk,united-kingdom,canada,australia,new-zealand,ireland,germany,france,netherlands,sweden,norway,denmark,switzerland"></ins>`;

        ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl, {
          isStillValid: () => isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current),
          onError: () => updateStatus('error', attemptId),
        });

        const win = window as any;
        win.AdProvider = win.AdProvider || [];
        if (typeof win.AdProvider.push === 'function') {
          win.AdProvider.push({ serve: {} });
        }

        startPolling(() => document.getElementById(domId), 12, 18);
      } catch {
        updateStatus('error', attemptId);
      }
    } else if (currentProvider === 'monetag') {
      try {
        if (!imperativeHostRef.current) {
          updateStatus('error', attemptId);
          return;
        }
        const domId = `monetag-wrap-${MONETAG_CONFIG.zoneId}-${slotId}`;
        imperativeHostRef.current.innerHTML = `<div id="${domId}" class="w-full h-full flex items-center justify-center overflow-hidden"></div>`;

        ensureHeadScriptOnce(MONETAG_CONFIG.scriptUrl, {
          attrs: { 'data-zone': MONETAG_CONFIG.zoneId, 'data-cfasync': 'false' },
          isStillValid: () => isAttemptCurrent(attemptId, attemptIdRef.current, isMountedRef.current),
          onError: () => updateStatus('error', attemptId),
        });

        startPolling(() => document.getElementById(domId), 10, 15);
      } catch {
        updateStatus('error', attemptId);
      }
    } else {
      updateStatus('unfilled', attemptId);
    }
  }, [
    currentProvider,
    effectiveUnitId,
    renderAd,
    updateStatus,
    position,
    slotId,
    containerWidth,
    adStatus,
    effectiveIsLiveChatScreen,
    rotationKey,
    validationOptions,
    isPageVisible,
    isSlotVisible,
  ]);

  // 4. Isolated, Reserved Container Rendering (NEVER disappear on slow response, rotation, or unfilled)
  let posClasses =
    'w-full max-w-[320px] md:max-w-[728px] min-h-[62px] h-[62px] md:min-h-[102px] md:h-[102px] max-h-[62px] md:max-h-[102px] mx-auto flex items-center justify-center overflow-hidden [contain:layout_style] shrink-0 transition-colors duration-200';

  if (orientation === 'vertical') {
    posClasses =
      'hidden xl:flex shrink-0 w-[160px] 2xl:w-[240px] 3xl:w-[300px] max-w-[300px] min-h-[520px] h-[520px] xl:h-[540px] max-h-full items-center justify-center overflow-hidden [contain:layout_style]';
  } else if (slotId === 'participant-box-horizontal') {
    posClasses =
      'w-full max-w-[300px] lg:max-w-[320px] min-h-[112px] h-[112px] max-h-[120px] mx-auto flex items-center justify-center overflow-hidden [contain:layout_style] shrink-0';
  } else if (isInternalHorizontalPlacement(slotId) || position === 'sidebar-horizontal') {
    posClasses =
      'w-full max-w-[320px] min-h-[62px] h-[62px] max-h-[68px] mx-auto flex items-center justify-center overflow-hidden [contain:layout_style] shrink-0';
  } else if (position === 'top') {
    posClasses += ' mb-2.5';
  } else if (position === 'bottom' || position === 'footer') {
    posClasses += ' mt-1';
  } else if (position === 'content-gap') {
    posClasses += ' my-8';
  }

  const containerProps = {
    'data-testid': `ad-slot-${slotId}`,
    'data-ad-status': adStatus,
    'data-ad-orientation': orientation,
    'data-ad-provider': currentProvider,
    className: `${posClasses} ${className}`.trim(),
    ref: adRef,
  };

  const showAdSenseIns =
    !renderAd &&
    currentProvider === 'adsense' &&
    !effectiveIsLiveChatScreen &&
    Boolean(effectiveUnitId) &&
    adStatus !== 'unfilled' &&
    adStatus !== 'error';

  if (renderAd) {
    return <div {...containerProps}>{renderAd()}</div>;
  }

  if (showAdSenseIns) {
    return (
      <div {...containerProps}>
        <div
          key="adsense-react-host"
          className="w-full h-full flex items-center justify-center overflow-hidden"
        >
          <ins
            className="adsbygoogle block overflow-hidden max-w-full max-h-full"
            data-ad-client={ADSENSE_CONFIG.publisherId}
            data-ad-slot={effectiveUnitId}
            data-ad-format={orientation === 'vertical' ? 'vertical' : 'horizontal'}
            data-full-width-responsive="true"
          />
        </div>
      </div>
    );
  }

  return (
    <div {...containerProps}>
      <div
        key="imperative-ad-host"
        ref={imperativeHostRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
      />
    </div>
  );
};

