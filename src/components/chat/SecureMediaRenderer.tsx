import React, { useState, useEffect, useRef } from 'react';
import { getAuthToken } from '../../services/messagingService';
import {
  classifyMediaUrl,
  MediaUrlClassification,
  normalizeMimeType,
} from '../../lib/mediaValidation';
import { Loader2, AlertCircle, Music, RefreshCw } from 'lucide-react';

interface SecureMediaRendererProps {
  mediaUrl: string;
  mediaType?: 'gif' | 'image' | 'audio';
  alt?: string;
  className?: string;
  isGuest?: boolean;
  userId?: string;
}

export type SecureMediaLoadResult =
  | { kind: 'external'; src: string; detectedType: 'image' | 'audio' }
  | { kind: 'blob'; blobUrl: string; detectedType: 'image' | 'audio' }
  | { kind: 'error'; error: string; retryable: boolean };

export async function loadSecureMediaAsset(params: {
  mediaUrl: string;
  mediaType?: 'gif' | 'image' | 'audio';
  currentOrigin?: string | null;
  isGuest?: boolean;
  userId?: string;
  signal?: AbortSignal;
}): Promise<SecureMediaLoadResult> {
  const { mediaUrl, mediaType, currentOrigin, isGuest, userId, signal } = params;
  const classified: MediaUrlClassification = classifyMediaUrl(mediaUrl, currentOrigin);

  if (classified.status === 'rejected') {
    return {
      kind: 'error',
      error: 'Blocked unsafe or invalid media URL.',
      retryable: false,
    };
  }

  // External HTTP(S) URLs (e.g. curated Giphy GIFs) MUST NEVER receive getAuthToken() or Authorization headers.
  if (classified.status === 'external') {
    return {
      kind: 'external',
      src: classified.resolvedUrl,
      detectedType: mediaType === 'audio' ? 'audio' : 'image',
    };
  }

  // Defense-in-depth: re-verify resolved URL strictly matches current application origin before fetching credentials
  const resolvedOrigin =
    currentOrigin !== undefined
      ? currentOrigin
      : typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  let expectedOrigin = '';
  try {
    expectedOrigin = resolvedOrigin ? new URL(resolvedOrigin).origin : '';
  } catch {
    expectedOrigin = '';
  }

  let parsedFetchUrl: URL;
  try {
    parsedFetchUrl = new URL(classified.resolvedUrl);
  } catch {
    return { kind: 'error', error: 'Blocked unsafe or invalid media URL.', retryable: false };
  }

  if (!expectedOrigin || parsedFetchUrl.origin !== expectedOrigin) {
    return { kind: 'error', error: 'Blocked cross-origin credentialed media request.', retryable: false };
  }

  const token = await getAuthToken({
    isGuest,
    senderType: isGuest ? 'guest' : 'registered',
    userId,
    allowPublicFallback: true,
  });

  if (signal?.aborted) {
    return { kind: 'error', error: 'Media request cancelled.', retryable: true };
  }

  if (!token) {
    return { kind: 'error', error: 'Authentication required to view media.', retryable: true };
  }

  const res = await fetch(classified.resolvedUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: 'omit',
    redirect: 'error',
    signal,
  });

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    return { kind: 'error', error: 'Blocked redirect on authenticated media request.', retryable: false };
  }

  if (res.status === 401) {
    return { kind: 'error', error: 'Authentication required to view media.', retryable: true };
  }

  if (res.status === 403) {
    return { kind: 'error', error: 'Forbidden: Unauthorized to access private media.', retryable: false };
  }

  if (res.status === 404) {
    return { kind: 'error', error: 'Media object not found.', retryable: false };
  }

  if (!res.ok) {
    return { kind: 'error', error: `Unable to load media (HTTP ${res.status}).`, retryable: true };
  }

  const rawContentType = res.headers?.get?.('content-type') || '';
  const normalizedCt = normalizeMimeType(rawContentType);
  const isAllowedImage =
    normalizedCt.startsWith('image/') && normalizedCt !== 'image/svg+xml';
  const isAllowedAudio = normalizedCt.startsWith('audio/');

  if (!isAllowedImage && !isAllowedAudio) {
    return { kind: 'error', error: 'Blocked unsupported or unsafe media content type.', retryable: false };
  }

  const blob = await res.blob();
  const createdUrl = URL.createObjectURL(blob);

  return {
    kind: 'blob',
    blobUrl: createdUrl,
    detectedType: isAllowedAudio || mediaType === 'audio' ? 'audio' : 'image',
  };
}

const SecureMediaRendererInner: React.FC<SecureMediaRendererProps> = ({
  mediaUrl,
  mediaType,
  alt = 'Shared media',
  className = 'w-full max-h-56 object-contain',
  isGuest,
  userId,
}) => {
  const initialClassification = classifyMediaUrl(mediaUrl);

  const [renderSrc, setRenderSrc] = useState<string | null>(() =>
    initialClassification.status === 'external' ? initialClassification.resolvedUrl : null
  );
  const [detectedType, setDetectedType] = useState<'image' | 'audio'>(
    mediaType === 'audio' ? 'audio' : 'image'
  );
  const [loading, setLoading] = useState<boolean>(
    initialClassification.status === 'internal'
  );
  const [error, setError] = useState<string | null>(() =>
    initialClassification.status === 'rejected'
      ? 'Blocked unsafe or invalid media URL.'
      : null
  );
  const [retryKey, setRetryKey] = useState(0);

  const activeBlobUrlRef = useRef<string | null>(null);

  const revokeActiveBlob = () => {
    if (activeBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      } catch {
        // ignore
      }
      activeBlobUrlRef.current = null;
    }
  };

  const classification = classifyMediaUrl(mediaUrl);
  const isInternalMedia = classification.status === 'internal';

  useEffect(() => {
    if (classification.status === 'rejected') {
      revokeActiveBlob();
      setRenderSrc(null);
      setError('Blocked unsafe or invalid media URL.');
      setLoading(false);
      return;
    }

    // External URLs (e.g. curated Giphy GIFs or third-party hosts) render directly without auth tokens
    if (classification.status === 'external') {
      revokeActiveBlob();
      setRenderSrc(classification.resolvedUrl);
      setDetectedType(mediaType === 'audio' ? 'audio' : 'image');
      setLoading(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();
    let isCancelled = false;

    async function fetchProtectedMedia() {
      setLoading(true);
      setError(null);
      revokeActiveBlob();
      setRenderSrc(null);

      try {
        const result = await loadSecureMediaAsset({
          mediaUrl,
          mediaType,
          isGuest,
          userId,
          signal: abortController.signal,
        });

        if (isCancelled) {
          if (result.kind === 'blob') {
            try {
              URL.revokeObjectURL(result.blobUrl);
            } catch {
              // ignore
            }
          }
          return;
        }

        if (result.kind === 'blob') {
          activeBlobUrlRef.current = result.blobUrl;
          setRenderSrc(result.blobUrl);
          setDetectedType(result.detectedType);
          setLoading(false);
          return;
        }

        if (result.kind === 'external') {
          setRenderSrc(result.src);
          setDetectedType(result.detectedType);
          setLoading(false);
          return;
        }

        setError(result.error);
        setLoading(false);
      } catch (err: any) {
        if (isCancelled || err?.name === 'AbortError') return;
        setError('Network error loading media.');
        setLoading(false);
      }
    }

    fetchProtectedMedia();

    return () => {
      isCancelled = true;
      abortController.abort();
      revokeActiveBlob();
    };
  }, [mediaUrl, classification.status, mediaType, isGuest, userId, retryKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-xs text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
        <span className="truncate">Loading {mediaType || 'attachment'}...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 p-2.5 bg-rose-950/25 rounded-xl border border-rose-900/30 text-xs text-rose-300">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
        {isInternalMedia && (
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            className="p-1 rounded hover:bg-rose-900/40 text-rose-300 transition-colors shrink-0 cursor-pointer"
            title="Retry loading media"
            aria-label="Retry loading media"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (!renderSrc) {
    return null;
  }

  if (detectedType === 'audio') {
    return (
      <div className="p-2.5 bg-[#0b101e] border border-slate-700/60 rounded-xl shadow-md max-w-sm flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[11px] text-cyan-400 font-medium">
          <Music className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{alt || 'Audio Clip'}</span>
        </div>
        <audio
          controls
          src={renderSrc}
          preload="metadata"
          className="w-full h-8 max-w-full rounded"
        >
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }

  return (
    <img
      src={renderSrc}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setError('Image failed to render.')}
    />
  );
};

export const SecureMediaRenderer = React.memo(SecureMediaRendererInner);
