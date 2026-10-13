import crypto from 'crypto';

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

// Disallowed executable extensions
const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'bash', 'ps1', 'msi', 'jar', 'js', 'ts', 'jsx', 'tsx',
  'html', 'htm', 'php', 'phtml', 'py', 'vbs', 'scr', 'com', 'svg', 'dll', 'bin',
  'app', 'dmg', 'apk', 'iso', 'deb', 'rpm', 'elf', 'wsf', 'cpl',
]);

const ALLOWED_MIME_TYPES: Record<string, { maxSizeBytes: number; allowedExts: string[] }> = {
  'image/jpeg': { maxSizeBytes: 5 * 1024 * 1024, allowedExts: ['jpg', 'jpeg'] },
  'image/png': { maxSizeBytes: 5 * 1024 * 1024, allowedExts: ['png'] },
  'image/webp': { maxSizeBytes: 5 * 1024 * 1024, allowedExts: ['webp'] },
  'image/gif': { maxSizeBytes: 5 * 1024 * 1024, allowedExts: ['gif'] },
  'audio/webm': { maxSizeBytes: 10 * 1024 * 1024, allowedExts: ['webm'] },
  'audio/ogg': { maxSizeBytes: 10 * 1024 * 1024, allowedExts: ['ogg', 'oga'] },
  'audio/mp3': { maxSizeBytes: 10 * 1024 * 1024, allowedExts: ['mp3'] },
  'audio/wav': { maxSizeBytes: 10 * 1024 * 1024, allowedExts: ['wav'] },
};

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

  if (!fileName || typeof fileName !== 'string') {
    return { valid: false, error: 'File name is required.' };
  }

  // Path traversal and forbidden pattern check
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return { valid: false, error: 'File name contains prohibited path traversal characters.' };
  }

  // Extract extension
  const extMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : '';

  if (!ext) {
    return { valid: false, error: 'File must have a valid extension.' };
  }

  // Prohibit executable files
  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Security violation: Executable and script file extensions (.${ext}) are strictly forbidden.`,
    };
  }

  // Validate MIME type
  const mimeConfig = ALLOWED_MIME_TYPES[mimeType.toLowerCase()];
  if (!mimeConfig) {
    return {
      valid: false,
      error: `Unsupported media format (${mimeType}). Allowed formats: JPG, PNG, WebP, GIF, WebM, OGG, MP3, WAV.`,
    };
  }

  // Verify extension matches MIME type
  if (!mimeConfig.allowedExts.includes(ext)) {
    return {
      valid: false,
      error: `MIME type (${mimeType}) does not match file extension (.${ext}).`,
    };
  }

  // Verify file size limit
  if (fileSize <= 0) {
    return { valid: false, error: 'File size must be greater than 0 bytes.' };
  }

  if (fileSize > mimeConfig.maxSizeBytes) {
    const limitMb = mimeConfig.maxSizeBytes / (1024 * 1024);
    return {
      valid: false,
      error: `File size exceeds maximum permitted limit of ${limitMb}MB.`,
    };
  }

  // Generate safe sanitized filename and ID
  const uploadId = `med_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sanitizedFileName = `${uploadId}.${ext}`;
  const sanitizedUrl = `/uploads/${sanitizedFileName}`;

  const record: MediaRecord = {
    id: uploadId,
    uploaderId: uploaderId || 'anon',
    fileName: sanitizedFileName,
    fileSize,
    mimeType,
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
    mimeType,
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
    name: 'VoxaNex Curated Safe GIF Service (Giphy / Internal Proxy)',
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
    name: 'Ephemeral Local Buffer / Supabase Storage S3-Compatible',
    credentialType: 'Signed Upload URL with MIME Enforcement',
    cost: 'Configured per Supabase plan',
    quota: '5MB images / 10MB audio clips',
    termsSummary:
      'Strict executable blacklist (.exe, .sh, .bat, .svg). Inactive guest files purged automatically after 24 hours.',
  },
};
