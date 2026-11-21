import crypto from 'crypto';
import {
  validateMediaFileMetadata,
  ALLOWED_MEDIA_SPECS,
} from '../lib/mediaValidation';

export interface YouTubeValidationResult {
  valid: boolean;
  videoId?: string;
  safeEmbedUrl?: string;
  thumbnailUrl?: string;
  requiresUserAction: boolean;
  autoplayAllowed: boolean;
  error?: string;
}

export interface MediaValidationResult {
  valid: boolean;
  uploadId?: string;
  sanitizedFileName?: string;
  sanitizedUrl?: string;
  fileSize?: number;
  mimeType?: string;
  error?: string;
}

export interface MediaRecord {
  id: string;
  uploaderId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  isFlagged: boolean;
  createdAt: string;
}

// In-memory store for tracked media uploads
const mediaStore = new Map<string, MediaRecord>();

/**
 * Validate supported YouTube URLs and produce safe privacy-enhanced embeds
 * Requires explicit user action before playback and forbids autoplay.
 */
export function validateYouTubeUrl(inputUrl: string): YouTubeValidationResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, requiresUserAction: true, autoplayAllowed: false, error: 'URL is required.' };
  }

  const trimmed = inputUrl.trim();

  // Basic format check
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, requiresUserAction: true, autoplayAllowed: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, requiresUserAction: true, autoplayAllowed: false, error: 'Only HTTP/HTTPS URLs are supported.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const validDomains = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
  ];

  if (!validDomains.includes(hostname)) {
    return {
      valid: false,
      requiresUserAction: true,
      autoplayAllowed: false,
      error: `Unsupported domain: ${hostname}. Only official YouTube domains are supported.`,
    };
  }

  let videoId: string | null = null;

  if (hostname === 'youtu.be') {
    // Format: https://youtu.be/VIDEO_ID
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      videoId = pathParts[0];
    }
  } else if (parsed.pathname.startsWith('/watch')) {
    // Format: https://www.youtube.com/watch?v=VIDEO_ID
    videoId = parsed.searchParams.get('v');
  } else if (parsed.pathname.startsWith('/embed/')) {
    // Format: https://www.youtube.com/embed/VIDEO_ID
    const parts = parsed.pathname.split('/embed/')[1]?.split('/');
    if (parts && parts.length > 0) {
      videoId = parts[0];
    }
  } else if (parsed.pathname.startsWith('/shorts/')) {
    // Format: https://www.youtube.com/shorts/VIDEO_ID
    const parts = parsed.pathname.split('/shorts/')[1]?.split('/');
    if (parts && parts.length > 0) {
      videoId = parts[0];
    }
  }

  // Strict YouTube 11-character video ID regex
  const videoIdRegex = /^[a-zA-Z0-9_-]{11}$/;
  if (!videoId || !videoIdRegex.test(videoId)) {
    return {
      valid: false,
      requiresUserAction: true,
      autoplayAllowed: false,
      error: 'Could not extract a valid 11-character YouTube video ID.',
    };
  }

  // YouTube privacy-enhanced mode (youtube-nocookie.com) with autoplay disabled
  const safeEmbedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=0`;
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return {
    valid: true,
    videoId,
    safeEmbedUrl,
    thumbnailUrl,
    requiresUserAction: true,
    autoplayAllowed: false,
  };
}

/**
 * Validate uploaded media files: file types, sizes, extension consistency, executable rejection
 */
export function validateMediaUpload(params: {
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderId: string;
}): MediaValidationResult {
  const { fileName, fileSize, mimeType, uploaderId } = params;

  const meta = validateMediaFileMetadata({
    fileName,
    fileSize,
    mimeType,
    inferMimeFromExtIfEmpty: false,
  });

  if (!meta.valid || !meta.canonicalMime || !meta.extension) {
    return { valid: false, error: meta.error || 'Invalid media upload.' };
  }

  const ext = meta.extension;
  const canonicalMime = meta.canonicalMime;
  const spec = ALLOWED_MEDIA_SPECS[canonicalMime];

  // Generate safe sanitized filename and ID
  const uploadId = `med_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sanitizedFileName = `${uploadId}.${ext}`;
  const sanitizedUrl = `/api/media/${uploadId}`;

  const record: MediaRecord = {
    id: uploadId,
    uploaderId: uploaderId || 'anon',
    fileName: sanitizedFileName,
    fileSize,
    mimeType: spec?.canonicalMime || canonicalMime,
    url: sanitizedUrl,
    isFlagged: false,
    createdAt: new Date().toISOString(),
  };

  mediaStore.set(uploadId, record);

  return {
    valid: true,
    uploadId,
    sanitizedFileName,
    sanitizedUrl,
    fileSize,
    mimeType: record.mimeType,
  };
}

/**
 * Flag or remove media content (moderator/admin control)
 */
export function removeMediaUpload(uploadId: string, requesterRole: string): boolean {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return false;
  }
  return mediaStore.delete(uploadId);
}

export function flagMediaUpload(uploadId: string): boolean {
  const item = mediaStore.get(uploadId);
  if (!item) return false;
  item.isFlagged = true;
  return true;
}

export function getMediaList(requesterRole: string): MediaRecord[] {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return [];
  }
  return Array.from(mediaStore.values());
}

/**
 * External Provider Documentation
 */
export const EXTERNAL_PROVIDERS_DOCUMENTATION = {
  youtube: {
    name: 'YouTube Privacy-Enhanced Embeds (youtube-nocookie.com)',
    credentialType: 'No API Key Required (Zero-Auth Embeds)',
    cost: 'Free tier / Public Embeds',
    quota: 'Unlimited public video embeds',
    termsSummary:
      'Complies with YouTube Developer Policies. Autoplay is disabled by default; cookies blocked prior to user playback.',
  },
  gifProvider: {
    name: 'ChatLustora Curated Safe GIF Service (Giphy / Internal Proxy)',
    credentialType: 'Server-Side API Proxy (Never exposed to client)',
    cost: 'Standard Developer Tier',
    quota: '10,000 API calls/day cached locally',
    termsSummary:
      'All search terms sanitized and filtered. NSFW or suggestive animations are quarantined.',
  },
  webrtcStunTurn: {
    name: 'Google STUN + Self-Hosted Coturn Relay',
    credentialType: 'Ephemeral HMAC-SHA1 Session Tokens',
    cost: 'Bandwidth dependent (Peer-to-peer 0$ direct mesh)',
    quota: 'Up to 500 concurrent mesh connections',
    termsSummary:
      'Zero-knowledge media relay. Audio and video streams are end-to-end encrypted; server does not decode payloads.',
  },
  contentStorage: {
    name: 'Cloudflare R2 Private Media Storage (Bucket: chatlustora-media)',
    credentialType: 'Cloudflare Worker Binding (CHAT_MEDIA) + Authenticated Worker Media Proxy (/api/media/*) + Supabase public.media_uploads metadata',
    cost: 'Cloudflare R2 Storage & Class A/B Operations (Zero Egress via Worker)',
    quota: '5MB images (JPEG, PNG, WebP, GIF) / 10MB audio clips (WebM, OGG, MP3, WAV)',
    termsSummary:
      'Private bucket with public access disabled. Worker enforces session authentication, magic-byte binary verification, strict MIME allowlist, executable blacklist (.exe, .sh, .bat, .svg), per-context access control (DM participants / verified adult rooms), and moderation flag checks.',
  },
};
