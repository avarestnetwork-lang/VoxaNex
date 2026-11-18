/**
 * Shared Media Validation & Magic-Byte Verification
 * Single source of truth for both client composers and server endpoints (Worker & Express).
 * Strictly enforces backend-supported formats:
 * - Images (max 5 MB): JPEG, PNG, WebP, GIF
 * - Audio  (max 10 MB): WebM, OGG, MP3, WAV
 */

export type ChatMediaType = 'gif' | 'image' | 'audio';

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const EXECUTABLE_AND_UNSAFE_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'bash', 'ps1', 'msi', 'jar', 'js', 'mjs', 'cjs',
  'ts', 'tsx', 'jsx', 'html', 'htm', 'xhtml', 'php', 'phtml', 'py', 'rb', 'pl',
  'cgi', 'vbs', 'vbe', 'scr', 'com', 'svg', 'svgz', 'xml', 'dll', 'bin', 'app',
  'dmg', 'apk', 'iso', 'deb', 'rpm', 'elf', 'wsf', 'cpl', 'lnk', 'hta', 'reg',
  'docm', 'xlsm',
]);

export interface AllowedMimeSpec {
  canonicalMime: string;
  category: 'image' | 'audio';
  chatMediaType: ChatMediaType;
  maxSizeBytes: number;
  allowedExts: string[];
  label: string;
}

export const ALLOWED_MEDIA_SPECS: Record<string, AllowedMimeSpec> = {
  'image/jpeg': {
    canonicalMime: 'image/jpeg',
    category: 'image',
    chatMediaType: 'image',
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    allowedExts: ['jpg', 'jpeg'],
    label: 'JPEG Image',
  },
  'image/png': {
    canonicalMime: 'image/png',
    category: 'image',
    chatMediaType: 'image',
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    allowedExts: ['png'],
    label: 'PNG Image',
  },
  'image/webp': {
    canonicalMime: 'image/webp',
    category: 'image',
    chatMediaType: 'image',
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    allowedExts: ['webp'],
    label: 'WebP Image',
  },
  'image/gif': {
    canonicalMime: 'image/gif',
    category: 'image',
    chatMediaType: 'gif',
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
    allowedExts: ['gif'],
    label: 'GIF Animation',
  },
  'audio/webm': {
    canonicalMime: 'audio/webm',
    category: 'audio',
    chatMediaType: 'audio',
    maxSizeBytes: MAX_AUDIO_SIZE_BYTES,
    allowedExts: ['webm'],
    label: 'WebM Audio',
  },
  'audio/ogg': {
    canonicalMime: 'audio/ogg',
    category: 'audio',
    chatMediaType: 'audio',
    maxSizeBytes: MAX_AUDIO_SIZE_BYTES,
    allowedExts: ['ogg', 'oga'],
    label: 'OGG Audio',
  },
  'audio/mp3': {
    canonicalMime: 'audio/mp3',
    category: 'audio',
    chatMediaType: 'audio',
    maxSizeBytes: MAX_AUDIO_SIZE_BYTES,
    allowedExts: ['mp3'],
    label: 'MP3 Audio',
  },
  'audio/wav': {
    canonicalMime: 'audio/wav',
    category: 'audio',
    chatMediaType: 'audio',
    maxSizeBytes: MAX_AUDIO_SIZE_BYTES,
    allowedExts: ['wav'],
    label: 'WAV Audio',
  },
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'audio/mpeg': 'audio/mp3',
  'audio/x-mp3': 'audio/mp3',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'application/ogg': 'audio/ogg',
};

const EXT_TO_CANONICAL_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp3: 'audio/mp3',
  wav: 'audio/wav',
};

export const IMAGE_ACCEPT_ATTRIBUTE =
  '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif';

export const AUDIO_ACCEPT_ATTRIBUTE =
  '.mp3,.wav,.ogg,.oga,.webm,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm';

export const ATTACHMENT_ACCEPT_ATTRIBUTE =
  '.jpg,.jpeg,.png,.webp,.gif,.mp3,.wav,.ogg,.oga,.webm,image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm';

export const SUPPORTED_IMAGE_FORMATS_TEXT = 'JPG, PNG, WebP, GIF (max 5 MB)';
export const SUPPORTED_AUDIO_FORMATS_TEXT = 'MP3, WAV, OGG, WebM (max 10 MB)';
export const SUPPORTED_ALL_FORMATS_TEXT =
  'Images: JPG, PNG, WebP, GIF (max 5 MB) · Audio: MP3, WAV, OGG, WebM (max 10 MB)';

export function normalizeMimeType(rawMime?: string | null): string {
  const clean = (rawMime || '').split(';')[0].trim().toLowerCase();
  if (!clean) return '';
  return MIME_ALIASES[clean] || clean;
}

export function extractSafeFileExtension(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return '';
  const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function sanitizeDisplayFileName(fileName: string): string {
  const cleaned = (fileName || 'attachment')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/\.\.+/g, '.')
    .trim();
  return (cleaned || 'attachment').slice(0, 120);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export interface MediaMetadataValidationResult {
  valid: boolean;
  canonicalMime?: string;
  extension?: string;
  category?: 'image' | 'audio';
  chatMediaType?: ChatMediaType;
  maxSizeBytes?: number;
  sanitizedOriginalName?: string;
  error?: string;
}

export function validateMediaFileMetadata(params: {
  fileName: string;
  fileSize: number;
  mimeType?: string;
  imageOnly?: boolean;
  audioOnly?: boolean;
  inferMimeFromExtIfEmpty?: boolean;
}): MediaMetadataValidationResult {
  const { fileName, fileSize, mimeType, imageOnly = false, audioOnly = false, inferMimeFromExtIfEmpty = false } = params;

  if (!fileName || typeof fileName !== 'string' || fileName.trim().length === 0) {
    return { valid: false, error: 'File name is required.' };
  }

  if (/[\u0000-\u001F]/.test(fileName) || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return { valid: false, error: 'File name contains prohibited path traversal or control characters.' };
  }

  const ext = extractSafeFileExtension(fileName);
  if (!ext) {
    return { valid: false, error: 'File must have a valid extension.' };
  }

  // Reject executable / active script / HTML / SVG extensions anywhere in filename segments (e.g. payload.exe.png)
  const segments = fileName.trim().toLowerCase().split('.').slice(1);
  for (const seg of segments) {
    if (EXECUTABLE_AND_UNSAFE_EXTENSIONS.has(seg)) {
      return {
        valid: false,
        error: `Security violation: Executable and script file extensions (.${seg}) are strictly forbidden.`,
      };
    }
  }

  let normalizedMime = normalizeMimeType(mimeType);
  if (
    inferMimeFromExtIfEmpty &&
    (!normalizedMime || normalizedMime === 'application/octet-stream') &&
    EXT_TO_CANONICAL_MIME[ext]
  ) {
    normalizedMime = EXT_TO_CANONICAL_MIME[ext];
  }

  if (!normalizedMime) {
    return {
      valid: false,
      error: `Missing media MIME type. Supported formats: ${SUPPORTED_ALL_FORMATS_TEXT}.`,
    };
  }

  const spec = ALLOWED_MEDIA_SPECS[normalizedMime];
  if (!spec) {
    return {
      valid: false,
      error: `Unsupported media format (${normalizedMime}). Supported: ${SUPPORTED_ALL_FORMATS_TEXT}.`,
    };
  }

  if (imageOnly && spec.category !== 'image') {
    return {
      valid: false,
      error: `Only image uploads are allowed here (${SUPPORTED_IMAGE_FORMATS_TEXT}). Use New Attachment for audio clips.`,
    };
  }

  if (audioOnly && spec.category !== 'audio') {
    return {
      valid: false,
      error: `Only audio attachments are allowed here (${SUPPORTED_AUDIO_FORMATS_TEXT}). Use the Image button for images.`,
    };
  }

  if (!spec.allowedExts.includes(ext)) {
    return {
      valid: false,
      error: `MIME type (${normalizedMime}) does not match file extension (.${ext}).`,
    };
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { valid: false, error: 'File size must be greater than 0 bytes.' };
  }

  if (fileSize > spec.maxSizeBytes) {
    const limitMb = Math.round(spec.maxSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File size (${formatBytes(fileSize)}) exceeds the ${limitMb} MB limit for ${spec.label}.`,
    };
  }

  return {
    valid: true,
    canonicalMime: spec.canonicalMime,
    extension: ext,
    category: spec.category,
    chatMediaType: spec.chatMediaType,
    maxSizeBytes: spec.maxSizeBytes,
    sanitizedOriginalName: sanitizeDisplayFileName(fileName),
  };
}

/**
 * Inspect actual binary magic bytes to defeat Content-Type / extension spoofing.
 */
export function detectMediaMimeFromBytes(bytes: Uint8Array): string | null {
  if (!bytes || bytes.byteLength < 4) return null;

  // Quickly reject leading text/markup payloads (<html, <svg, <?xml, <script, #!)
  const headSlice = bytes.subarray(0, Math.min(64, bytes.byteLength));
  let headText = '';
  for (let i = 0; i < headSlice.length; i++) {
    headText += String.fromCharCode(headSlice[i]);
  }
  const trimmedHead = headText.trimStart().toLowerCase();
  if (
    trimmedHead.startsWith('<html') ||
    trimmedHead.startsWith('<!doctype') ||
    trimmedHead.startsWith('<script') ||
    trimmedHead.startsWith('<svg') ||
    trimmedHead.startsWith('<?xml') ||
    trimmedHead.startsWith('#!')
  ) {
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }

  // RIFF container: WEBP or WAV
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    // WEBP
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
    // WAVE
    if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
      return 'audio/wav';
    }
  }

  // OGG: OggS
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return 'audio/ogg';
  }

  // WebM / EBML: 1A 45 DF A3
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'audio/webm';
  }

  // MP3: ID3 tag or raw MPEG Audio frame sync (FF Fx where layer bits != 00)
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    return 'audio/mp3';
  }
  if (
    bytes.byteLength >= 2 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    (bytes[1] & 0x06) !== 0x00 &&
    (bytes[1] & 0x18) !== 0x08
  ) {
    return 'audio/mp3';
  }

  return null;
}

export function validateMediaBinary(params: {
  fileName: string;
  mimeType?: string;
  bytes: Uint8Array;
  imageOnly?: boolean;
  audioOnly?: boolean;
}): MediaMetadataValidationResult {
  const { fileName, mimeType, bytes, imageOnly, audioOnly } = params;
  const meta = validateMediaFileMetadata({
    fileName,
    fileSize: bytes ? bytes.byteLength : 0,
    mimeType,
    imageOnly,
    audioOnly,
    inferMimeFromExtIfEmpty: true,
  });
  if (!meta.valid || !meta.canonicalMime) {
    return meta;
  }

  const detectedMime = detectMediaMimeFromBytes(bytes);
  if (!detectedMime) {
    return {
      valid: false,
      error: 'Unrecognized or corrupted binary signature. File content does not match any supported image or audio format.',
    };
  }

  if (detectedMime !== meta.canonicalMime) {
    return {
      valid: false,
      error: `Security violation: File content signature (${detectedMime}) does not match declared type (${meta.canonicalMime}).`,
    };
  }

  return meta;
}

export type MediaUrlClassification =
  | { status: 'internal'; resolvedUrl: string; pathname: string; assetId: string }
  | { status: 'external'; resolvedUrl: string }
  | { status: 'rejected'; reason: string };

const SAFE_MEDIA_ASSET_PATH_REGEX = /^\/api\/media\/([a-zA-Z0-9._-]+)$/;

function hasUnsafePathTraversal(rawInput: string): boolean {
  const lower = rawInput.toLowerCase();
  if (lower.includes('\\')) return true;

  // Extract raw path portion before query/hash (after scheme://authority if absolute)
  let rawPath = rawInput;
  const schemeMatch = rawInput.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*(.*)$/);
  if (schemeMatch) {
    rawPath = schemeMatch[1] || '/';
  }
  const pathOnly = rawPath.split(/[?#]/)[0];
  const lowerPath = pathOnly.toLowerCase();
  if (lowerPath.includes('%2e') || lowerPath.includes('%2f') || lowerPath.includes('%5c')) {
    return true;
  }
  const segments = pathOnly.split('/');
  if (segments.some((seg) => seg === '.' || seg === '..')) {
    return true;
  }
  if (pathOnly.includes('..')) {
    return true;
  }
  return false;
}

/**
 * Strictly classify a media URL into:
 * - 'internal': exact same-origin /api/media/{assetId} endpoint (eligible for Bearer auth fetch)
 * - 'external': valid HTTP(S) URL on a different origin or non-media-API route (MUST NOT receive auth headers)
 * - 'rejected': unsafe, malformed, protocol-relative, or path-traversal URL
 */
export function classifyMediaUrl(
  rawUrl?: string | null,
  currentOrigin?: string | null
): MediaUrlClassification {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { status: 'rejected', reason: 'Missing media URL.' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    return { status: 'rejected', reason: 'Invalid or overly long media URL.' };
  }

  if (/[\u0000-\u001F\u007F\s<>"]/.test(trimmed) || trimmed.includes('\\')) {
    return { status: 'rejected', reason: 'Media URL contains prohibited characters.' };
  }

  // Strictly block protocol-relative URLs (e.g. //attacker.example/api/media/asset-123)
  if (trimmed.startsWith('//')) {
    return { status: 'rejected', reason: 'Protocol-relative media URLs are rejected.' };
  }

  const rawOrigin =
    currentOrigin !== undefined
      ? currentOrigin
      : typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';

  let normalizedOrigin = '';
  if (rawOrigin && typeof rawOrigin === 'string') {
    try {
      const originParsed = new URL(rawOrigin);
      if (originParsed.protocol === 'http:' || originParsed.protocol === 'https:') {
        normalizedOrigin = originParsed.origin;
      }
    } catch {
      normalizedOrigin = '';
    }
  }

  // Relative paths: permit ONLY exact /api/media/{assetId} on valid application origin
  if (trimmed.startsWith('/')) {
    if (hasUnsafePathTraversal(trimmed)) {
      return { status: 'rejected', reason: 'Path traversal in media URL is rejected.' };
    }

    const [rawPathOnly] = trimmed.split(/[?#]/);
    const pathMatch = rawPathOnly.match(SAFE_MEDIA_ASSET_PATH_REGEX);
    if (!pathMatch) {
      return { status: 'rejected', reason: 'Unsupported relative media path.' };
    }

    const assetId = pathMatch[1];
    if (!assetId || assetId === '.' || assetId === '..') {
      return { status: 'rejected', reason: 'Invalid media asset identifier.' };
    }

    if (!normalizedOrigin) {
      return { status: 'rejected', reason: 'Application origin is required for internal media URL.' };
    }

    try {
      const parsed = new URL(trimmed, normalizedOrigin);
      if (parsed.origin !== normalizedOrigin) {
        return { status: 'rejected', reason: 'Origin mismatch for relative media URL.' };
      }
      if (parsed.pathname !== rawPathOnly || !SAFE_MEDIA_ASSET_PATH_REGEX.test(parsed.pathname)) {
        return { status: 'rejected', reason: 'Normalized pathname mismatch for internal media URL.' };
      }
      return {
        status: 'internal',
        resolvedUrl: parsed.toString(),
        pathname: parsed.pathname,
        assetId,
      };
    } catch {
      return { status: 'rejected', reason: 'Malformed relative media URL.' };
    }
  }

  // Require explicit scheme:// for non-relative URLs
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return { status: 'rejected', reason: 'Malformed or unsupported media URL scheme.' };
  }

  if (hasUnsafePathTraversal(trimmed)) {
    return { status: 'rejected', reason: 'Path traversal in media URL is rejected.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { status: 'rejected', reason: 'Malformed absolute media URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { status: 'rejected', reason: 'Unsupported media URL protocol.' };
  }

  if (parsed.username || parsed.password) {
    return { status: 'rejected', reason: 'Embedded credentials in media URL are rejected.' };
  }

  // Internal classification requires EXACT origin equality AND exact /api/media/{assetId} pathname match
  if (normalizedOrigin && parsed.origin === normalizedOrigin) {
    const pathMatch = parsed.pathname.match(SAFE_MEDIA_ASSET_PATH_REGEX);
    if (pathMatch) {
      const assetId = pathMatch[1];
      if (!assetId || assetId === '.' || assetId === '..') {
        return { status: 'rejected', reason: 'Invalid media asset identifier.' };
      }
      return {
        status: 'internal',
        resolvedUrl: parsed.toString(),
        pathname: parsed.pathname,
        assetId,
      };
    }
  }

  return {
    status: 'external',
    resolvedUrl: parsed.toString(),
  };
}

/**
 * Validate that a chat message mediaUrl is safe to store and render.
 * Permits same-origin authenticated media routes (/api/media/...) and HTTP(S) URLs;
 * strictly blocks javascript:, vbscript:, data:, blob:, file:, protocol-relative //, path traversal, and control characters.
 */
export function isSafeMediaUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (/[\u0000-\u001F\u007F\s<>"]/.test(trimmed) || trimmed.includes('\\')) return false;
  if (trimmed.startsWith('//')) return false;
  if (hasUnsafePathTraversal(trimmed)) return false;

  if (trimmed.startsWith('/api/media/')) {
    const [rawPathOnly] = trimmed.split(/[?#]/);
    const match = rawPathOnly.match(SAFE_MEDIA_ASSET_PATH_REGEX);
    return Boolean(match && match[1] !== '.' && match[1] !== '..');
  }

  if (trimmed.startsWith('/')) {
    return false;
  }

  const classified = classifyMediaUrl(trimmed, null);
  return classified.status === 'external';
}

export function isValidChatMediaType(mediaType?: string | null): mediaType is ChatMediaType {
  return mediaType === 'gif' || mediaType === 'image' || mediaType === 'audio';
}
