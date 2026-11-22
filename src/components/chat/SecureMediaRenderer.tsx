import React, { useState, useEffect, useRef } from 'react';
import { getAuthToken } from '../../services/messagingService';
import {
  ChatMediaType,
  classifyMediaUrl,
  extractSafeFileExtension,
  MediaUrlClassification,
  normalizeMimeType,
  sanitizeDisplayFileName,
} from '../../lib/mediaValidation';
import {
  Loader2,
  AlertCircle,
  Music,
  Film,
  FileText,
  Download,
  RefreshCw,
} from 'lucide-react';

export type RenderableMediaKind = 'image' | 'audio' | 'video' | 'document';

interface SecureMediaRendererProps {
  mediaUrl: string;
  mediaType?: ChatMediaType;
  alt?: string;
  className?: string;
  isGuest?: boolean;
  userId?: string;
}

export type SecureMediaLoadResult =
  | {
      kind: 'external';
      src: string;
      detectedType: RenderableMediaKind;
      fileName?: string;
      mimeType?: string;
    }
  | {
      kind: 'blob';
      blobUrl: string;
      detectedType: RenderableMediaKind;
      fileName?: string;
      mimeType?: string;
    }
  | { kind: 'error'; error: string; retryable: boolean };

const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_DOCUMENT_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const DOCUMENT_MIME_TO_LABEL: Record<string, { badge: string; defaultExt: string }> = {
  'application/pdf': { badge: 'PDF', defaultExt: 'pdf' },
  'text/plain': { badge: 'TXT', defaultExt: 'txt' },
  'text/csv': { badge: 'CSV', defaultExt: 'csv' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    badge: 'DOCX',
    defaultExt: 'docx',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    badge: 'XLSX',
    defaultExt: 'xlsx',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    badge: 'PPTX',
    defaultExt: 'pptx',
  },
};

function normalizeInitialRenderKind(mediaType?: ChatMediaType): RenderableMediaKind {
  if (mediaType === 'audio') return 'audio';
  if (mediaType === 'video') return 'video';
  if (mediaType === 'document') return 'document';
  return 'image';
}

export function extractFileNameFromContentDisposition(
  headerValue?: string | null
): string | undefined {
  if (!headerValue || typeof headerValue !== 'string') return undefined;
  const starMatch = headerValue.match(/filename\*\s*=\s*(?:utf-8''|)([^;]+)/i);
  if (starMatch && starMatch[1]) {
    try {
      const decoded = decodeURIComponent(starMatch[1].trim().replace(/^["']|["']$/g, ''));
      const clean = sanitizeDisplayFileName(decoded);
      if (clean) return clean;
    } catch {
      // fallback below
    }
  }
  const plainMatch = headerValue.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  const raw = plainMatch?.[1] || plainMatch?.[2];
  if (raw) {
    const clean = sanitizeDisplayFileName(raw.trim().replace(/^["']|["']$/g, ''));
    if (clean) return clean;
  }
  return undefined;
}

export async function loadSecureMediaAsset(params: {
  mediaUrl: string;
  mediaType?: ChatMediaType;
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
      detectedType: normalizeInitialRenderKind(mediaType),
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
  const isAllowedVideo = ALLOWED_VIDEO_MIMES.has(normalizedCt);
  const isAllowedAudio = normalizedCt.startsWith('audio/');
  const isAllowedDocument = ALLOWED_DOCUMENT_MIMES.has(normalizedCt);

  if (!isAllowedImage && !isAllowedVideo && !isAllowedAudio && !isAllowedDocument) {
    return { kind: 'error', error: 'Blocked unsupported or unsafe media content type.', retryable: false };
  }

  let detectedType: RenderableMediaKind = 'image';
  if (isAllowedVideo || (normalizedCt === 'audio/webm' && mediaType === 'video')) {
    detectedType = 'video';
  } else if (isAllowedAudio) {
    detectedType = 'audio';
  } else if (isAllowedDocument) {
    detectedType = 'document';
  }

  const contentDisposition = res.headers?.get?.('content-disposition');
  const fileName = extractFileNameFromContentDisposition(contentDisposition);

  const blob = await res.blob();
  const createdUrl = URL.createObjectURL(blob);

  return {
    kind: 'blob',
    blobUrl: createdUrl,
    detectedType,
    fileName,
    mimeType: normalizedCt,
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
  const [detectedType, setDetectedType] = useState<RenderableMediaKind>(
    normalizeInitialRenderKind(mediaType)
  );
  const [resolvedFileName, setResolvedFileName] = useState<string | undefined>(undefined);
  const [resolvedMimeType, setResolvedMimeType] = useState<string | undefined>(undefined);
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
      setResolvedFileName(undefined);
      setResolvedMimeType(undefined);
      setError('Blocked unsafe or invalid media URL.');
      setLoading(false);
      return;
    }

    // External URLs (e.g. curated Giphy GIFs or third-party hosts) render directly without auth tokens
    if (classification.status === 'external') {
      revokeActiveBlob();
      setRenderSrc(classification.resolvedUrl);
      setDetectedType(normalizeInitialRenderKind(mediaType));
      setResolvedFileName(undefined);
      setResolvedMimeType(undefined);
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
          setResolvedFileName(result.fileName);
          setResolvedMimeType(result.mimeType);
          setLoading(false);
          return;
        }

        if (result.kind === 'external') {
          setRenderSrc(result.src);
          setDetectedType(result.detectedType);
          setResolvedFileName(result.fileName);
          setResolvedMimeType(result.mimeType);
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
          <span className="truncate">{resolvedFileName || alt || 'Audio Clip'}</span>
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

  if (detectedType === 'video') {
    return (
      <div className="p-2 bg-[#0b101e] border border-slate-700/60 rounded-xl shadow-md max-w-md flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[11px] text-violet-300 font-medium px-1">
          <Film className="w-3.5 h-3.5 shrink-0 text-violet-400" />
          <span className="truncate">{resolvedFileName || alt || 'Video Clip'}</span>
        </div>
        <video
          controls
          playsInline
          src={renderSrc}
          preload="metadata"
          className={className || 'w-full max-h-64 rounded-lg bg-black/60'}
          onError={() => setError('Video failed to play in this browser.')}
        >
          Your browser does not support video playback.
        </video>
      </div>
    );
  }

  if (detectedType === 'document') {
    const docMeta = resolvedMimeType ? DOCUMENT_MIME_TO_LABEL[resolvedMimeType] : undefined;
    const extBadge =
      (resolvedFileName ? extractSafeFileExtension(resolvedFileName) : '').toUpperCase() ||
      docMeta?.badge ||
      'DOC';
    const downloadName =
      resolvedFileName ||
      `attachment.${docMeta?.defaultExt || extBadge.toLowerCase()}`;
    const displayName = resolvedFileName || (alt !== 'Shared attachment' && alt !== 'Shared media' ? alt : downloadName);

    return (
      <div
        data-testid="secure-document-card"
        className="p-3 bg-[#0b101e] border border-slate-700/70 rounded-xl shadow-md max-w-sm flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-100 truncate">
              {displayName}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                {extBadge}
              </span>
              <span className="text-[10px] text-slate-400">Document</span>
            </div>
          </div>
        </div>
        <a
          href={renderSrc}
          download={downloadName}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-[11px] font-semibold text-cyan-300 hover:text-white transition-colors shrink-0"
          title={`Download ${downloadName}`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download</span>
        </a>
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
