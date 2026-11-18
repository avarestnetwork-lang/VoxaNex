import React, { useState, useEffect, useRef } from 'react';
import { getAuthToken } from '../../services/messagingService';
import { isSafeMediaUrl, normalizeMimeType } from '../../lib/mediaValidation';
import { Loader2, AlertCircle, Music, RefreshCw } from 'lucide-react';

interface SecureMediaRendererProps {
  mediaUrl: string;
  mediaType?: 'gif' | 'image' | 'audio';
  alt?: string;
  className?: string;
  isGuest?: boolean;
  userId?: string;
}

const SecureMediaRendererInner: React.FC<SecureMediaRendererProps> = ({
  mediaUrl,
  mediaType,
  alt = 'Shared media',
  className = 'w-full max-h-56 object-contain',
  isGuest,
  userId,
}) => {
  const [renderSrc, setRenderSrc] = useState<string | null>(null);
  const [detectedType, setDetectedType] = useState<'image' | 'audio'>(
    mediaType === 'audio' ? 'audio' : 'image'
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
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

  const safeUrl = isSafeMediaUrl(mediaUrl);

  // Determine whether this is an internal authenticated Worker media route
  const isInternalMedia =
    safeUrl &&
    (mediaUrl.startsWith('/api/media/') ||
      mediaUrl.includes('/api/media/') ||
      (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')));

  useEffect(() => {
    if (!safeUrl) {
      revokeActiveBlob();
      setRenderSrc(null);
      setError('Blocked unsafe or invalid media URL.');
      setLoading(false);
      return;
    }

    // External URLs (e.g. curated Giphy GIFs) render directly without custom auth headers
    if (!isInternalMedia) {
      revokeActiveBlob();
      setRenderSrc(mediaUrl);
      setDetectedType(mediaType === 'audio' ? 'audio' : 'image');
      setLoading(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();
    let isCancelled = false;

    async function fetchPrivateOrProtectedMedia() {
      setLoading(true);
      setError(null);
      revokeActiveBlob();
      setRenderSrc(null);

      try {
        const token = await getAuthToken({
          isGuest,
          senderType: isGuest ? 'guest' : 'registered',
          userId,
          allowPublicFallback: true,
        });

        if (isCancelled) return;

        if (!token) {
          setError('Authentication required to view media.');
          setLoading(false);
          return;
        }

        const res = await fetch(mediaUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
        });

        if (isCancelled) return;

        if (res.status === 401) {
          setError('Authentication required to view media.');
          setLoading(false);
          return;
        }

        if (res.status === 403) {
          setError('Forbidden: Unauthorized to access private media.');
          setLoading(false);
          return;
        }

        if (res.status === 404) {
          setError('Media object not found.');
          setLoading(false);
          return;
        }

        if (!res.ok) {
          setError(`Unable to load media (HTTP ${res.status}).`);
          setLoading(false);
          return;
        }

        const rawContentType = res.headers?.get?.('content-type') || '';
        const normalizedCt = normalizeMimeType(rawContentType);
        const isAllowedImage =
          normalizedCt.startsWith('image/') && normalizedCt !== 'image/svg+xml';
        const isAllowedAudio = normalizedCt.startsWith('audio/');

        if (!isAllowedImage && !isAllowedAudio) {
          setError('Blocked unsupported or unsafe media content type.');
          setLoading(false);
          return;
        }

        const blob = await res.blob();
        if (isCancelled) return;

        const createdUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = createdUrl;

        setRenderSrc(createdUrl);
        setDetectedType(isAllowedAudio || mediaType === 'audio' ? 'audio' : 'image');
        setLoading(false);
      } catch (err: any) {
        if (isCancelled || err?.name === 'AbortError') return;
        setError('Network error loading media.');
        setLoading(false);
      }
    }

    fetchPrivateOrProtectedMedia();

    return () => {
      isCancelled = true;
      abortController.abort();
      revokeActiveBlob();
    };
  }, [mediaUrl, safeUrl, isInternalMedia, mediaType, isGuest, userId, retryKey]);

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
        {safeUrl && isInternalMedia && (
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
