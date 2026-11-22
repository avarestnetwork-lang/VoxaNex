/**
 * Shared Media Validation & Binary Content Verification
 * Single source of truth for both client composers and server endpoints (Worker & Express).
 * Strictly enforces backend-supported formats:
 * - Images    (max 5 MB):  JPEG, PNG, WebP, GIF
 * - Video     (max 10 MB): MP4, WebM, MOV
 * - Audio     (max 10 MB): WebM, OGG, MP3, WAV
 * - Documents (max 10 MB): PDF, TXT, CSV, DOCX, XLSX, PPTX
 */

export type ChatMediaType = 'gif' | 'image' | 'audio' | 'video' | 'document';
export type MediaCategory = 'image' | 'audio' | 'video' | 'document';

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (fits cleanly inside 15 MB Worker ceiling & 10 MB DB limit)
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const EXECUTABLE_AND_UNSAFE_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'bash', 'ps1', 'msi', 'jar', 'js', 'mjs', 'cjs',
  'ts', 'tsx', 'jsx', 'html', 'htm', 'xhtml', 'shtml', 'mhtml', 'php', 'phtml',
  'py', 'rb', 'pl', 'cgi', 'vbs', 'vbe', 'scr', 'com', 'svg', 'svgz', 'xml',
  'dll', 'bin', 'app', 'dmg', 'apk', 'iso', 'deb', 'rpm', 'elf', 'wsf', 'cpl',
  'lnk', 'hta', 'reg', 'docm', 'xlsm', 'pptm', 'dotm', 'xlam', 'xltm', 'potm',
  'swf', 'zip', 'rar', '7z', 'tar', 'gz',
]);

export interface AllowedMimeSpec {
  canonicalMime: string;
  category: MediaCategory;
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
  'video/mp4': {
    canonicalMime: 'video/mp4',
    category: 'video',
    chatMediaType: 'video',
    maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
    allowedExts: ['mp4'],
    label: 'MP4 Video',
  },
  'video/webm': {
    canonicalMime: 'video/webm',
    category: 'video',
    chatMediaType: 'video',
    maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
    allowedExts: ['webm'],
    label: 'WebM Video',
  },
  'video/quicktime': {
    canonicalMime: 'video/quicktime',
    category: 'video',
    chatMediaType: 'video',
    maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
    allowedExts: ['mov'],
    label: 'QuickTime Video',
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
  'application/pdf': {
    canonicalMime: 'application/pdf',
    category: 'document',
    chatMediaType: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    allowedExts: ['pdf'],
    label: 'PDF Document',
  },
  'text/plain': {
    canonicalMime: 'text/plain',
    category: 'document',
    chatMediaType: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    allowedExts: ['txt'],
    label: 'Text Document',
  },
  'text/csv': {
    canonicalMime: 'text/csv',
    category: 'document',
    chatMediaType: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    allowedExts: ['csv'],
    label: 'CSV Spreadsheet',
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    canonicalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'document',
    chatMediaType: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    allowedExts: ['docx'],
    label: 'Word Document',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    canonicalMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'document',
    chatMediaType: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    allowedExts: ['xlsx'],
    label: 'Excel Spreadsheet',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    canonicalMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    category: 'document',
    chatMediaType: 'document',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
    allowedExts: ['pptx'],
    label: 'PowerPoint Presentation',
  },
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'audio/mpeg': 'audio/mp3',
  'audio/x-mpeg': 'audio/mp3',
  'audio/x-mp3': 'audio/mp3',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'application/ogg': 'audio/ogg',
  'video/x-quicktime': 'video/quicktime',
  'application/x-pdf': 'application/pdf',
  'text/x-csv': 'text/csv',
  'application/csv': 'text/csv',
};

const EXT_TO_CANONICAL_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp3: 'audio/mp3',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const IMAGE_ACCEPT_ATTRIBUTE =
  '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif';

export const AUDIO_ACCEPT_ATTRIBUTE =
  '.mp3,.wav,.ogg,.oga,.webm,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm';

export const VIDEO_ACCEPT_ATTRIBUTE =
  '.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime';

export const DOCUMENT_ACCEPT_ATTRIBUTE =
  '.pdf,.txt,.csv,.docx,.xlsx,.pptx,application/pdf,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const ATTACHMENT_ACCEPT_ATTRIBUTE = [
  '.jpg,.jpeg,.png,.webp,.gif',
  '.mp4,.webm,.mov',
  '.mp3,.wav,.ogg,.oga',
  '.pdf,.txt,.csv,.docx,.xlsx,.pptx',
  'image/jpeg,image/png,image/webp,image/gif',
  'video/mp4,video/webm,video/quicktime',
  'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm',
  'application/pdf,text/plain,text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',');

export const SUPPORTED_IMAGE_FORMATS_TEXT = 'JPG, PNG, WebP, GIF (max 5 MB)';
export const SUPPORTED_AUDIO_FORMATS_TEXT = 'MP3, WAV, OGG, WebM (max 10 MB)';
export const SUPPORTED_VIDEO_FORMATS_TEXT = 'MP4, WebM, MOV (max 10 MB)';
export const SUPPORTED_DOCUMENT_FORMATS_TEXT = 'PDF, TXT, CSV, DOCX, XLSX, PPTX (max 10 MB)';
export const SUPPORTED_ALL_FORMATS_TEXT =
  'Images (max 5 MB), Video/Audio/Docs: MP4, MOV, WebM, MP3, WAV, OGG, PDF, TXT, CSV, DOCX, XLSX, PPTX (max 10 MB)';

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
  category?: MediaCategory;
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
        error: `Security violation: File extensions of type (.${seg}) are not allowed.`,
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
      error: `Unsupported file format (${normalizedMime}). Supported: ${SUPPORTED_ALL_FORMATS_TEXT}.`,
    };
  }

  if (imageOnly && spec.category !== 'image') {
    return {
      valid: false,
      error: `Only image uploads are allowed here (${SUPPORTED_IMAGE_FORMATS_TEXT}). Use the attachment button for video, audio, or document files.`,
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
      error: `File type (${normalizedMime}) does not match file extension (.${ext}).`,
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

function bytesContainAscii(haystack: Uint8Array, needle: string, maxOffset?: number): boolean {
  const end = maxOffset !== undefined ? Math.min(haystack.byteLength, maxOffset) : haystack.byteLength;
  if (needle.length === 0 || end < needle.length) return false;
  const target = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= end - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

function readAsciiRange(bytes: Uint8Array, start: number, len: number): string {
  if (start + len > bytes.byteLength) return '';
  let out = '';
  for (let i = start; i < start + len; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

const VALID_MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'avc1', 'mp71', 'msnv', 'dash', 'm4v ',
]);

function extractZipEntryNames(bytes: Uint8Array): string[] | null {
  if (!bytes || bytes.byteLength < 30) return null;
  // Require PK\x03\x04 local file header at offset 0
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return null;
  }

  const names: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate End of Central Directory (PK\x05\x06) searching backwards within last 66KB
  const minEocdOffset = Math.max(0, bytes.byteLength - 65557);
  let eocdOffset = -1;
  for (let i = bytes.byteLength - 22; i >= minEocdOffset; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    if (cdOffset + cdSize <= eocdOffset) {
      let ptr = cdOffset;
      let count = 0;
      while (ptr + 46 <= cdOffset + cdSize && count < 2000) {
        if (bytes[ptr] !== 0x50 || bytes[ptr + 1] !== 0x4b || bytes[ptr + 2] !== 0x01 || bytes[ptr + 3] !== 0x02) {
          break;
        }
        const nameLen = view.getUint16(ptr + 28, true);
        const extraLen = view.getUint16(ptr + 30, true);
        const commentLen = view.getUint16(ptr + 32, true);
        if (ptr + 46 + nameLen > bytes.byteLength) break;
        const rawName = new TextDecoder('utf-8', { fatal: false }).decode(
          bytes.subarray(ptr + 46, ptr + 46 + nameLen)
        );
        names.push(rawName.toLowerCase());
        ptr += 46 + nameLen + extraLen + commentLen;
        count += 1;
      }
      if (names.length > 0) return names;
    }
  }

  // Fallback: scan local file headers sequentially from offset 0 (supports data-descriptor or stripped EOCD minimal fixtures)
  let offset = 0;
  let count = 0;
  while (offset + 30 <= bytes.byteLength && count < 2000) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b || bytes[offset + 2] !== 0x03 || bytes[offset + 3] !== 0x04) {
      break;
    }
    const flags = view.getUint16(offset + 6, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    if (offset + 30 + nameLen > bytes.byteLength) break;
    const rawName = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(offset + 30, offset + 30 + nameLen)
    );
    names.push(rawName.toLowerCase());
    // If bit 3 (data descriptor) is set with size 0, we can't skip compressedSize safely unless small; continue cleanly if non-zero
    if ((flags & 0x08) !== 0 && compressedSize === 0) break;
    offset += 30 + nameLen + extraLen + compressedSize;
    count += 1;
  }

  return names.length > 0 ? names : null;
}

function inspectOoxmlZipMime(bytes: Uint8Array): string | null {
  const entries = extractZipEntryNames(bytes);
  if (!entries || entries.length === 0) return null;

  // Reject macro-enabled documents, Android APKs, Java JARs, and suspicious active archive entries
  const hasUnsafeEntry = entries.some(
    (name) =>
      name.includes('vbaproject.bin') ||
      name === 'androidmanifest.xml' ||
      name === 'meta-inf/manifest.mf' ||
      name.endsWith('.exe') ||
      name.endsWith('.dll') ||
      name.endsWith('.js')
  );
  if (hasUnsafeEntry) return null;

  const hasContentTypes = entries.some((name) => name === '[content_types].xml');
  if (!hasContentTypes) return null;

  if (entries.some((name) => name === 'word/document.xml' || name.startsWith('word/'))) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (entries.some((name) => name === 'xl/workbook.xml' || name.startsWith('xl/'))) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (entries.some((name) => name === 'ppt/presentation.xml' || name.startsWith('ppt/'))) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  return null;
}

const ACTIVE_MARKUP_OR_SCRIPT_PATTERN =
  /(?:<!doctype\s+html|<html[\s>]|<script[\s>]|<svg[\s>]|<\?xml|<\?php|<iframe[\s>]|<object[\s>]|<embed[\s>]|<body[\s>]|<head[\s>]|javascript:|vbscript:|\bon(?:load|error|click|mouseover|focus)\s*=)/i;

function isSafeUtf8PlainTextPayload(bytes: Uint8Array): boolean {
  if (!bytes || bytes.byteLength === 0) return false;

  // Strip optional UTF-8 BOM
  let payload = bytes;
  if (payload.byteLength >= 3 && payload[0] === 0xef && payload[1] === 0xbb && payload[2] === 0xbf) {
    payload = payload.subarray(3);
  }
  if (payload.byteLength === 0) return false;

  // Reject NUL bytes and disallowed ASCII binary control chars (allow \t=0x09, \n=0x0A, \r=0x0D)
  for (let i = 0; i < payload.byteLength; i++) {
    const b = payload[i];
    if (b === 0x00) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      return false;
    }
    if (b === 0x7f) return false;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    return false;
  }

  if (decoded.trim().length === 0) return false;
  if (ACTIVE_MARKUP_OR_SCRIPT_PATTERN.test(decoded)) return false;

  return true;
}

/**
 * Inspect actual binary magic bytes / container structure / UTF-8 text safety to defeat spoofing.
 */
export function detectMediaMimeFromBytes(
  bytes: Uint8Array,
  declaredMimeHint?: string
): string | null {
  if (!bytes || bytes.byteLength === 0) return null;

  const normalizedHint = normalizeMimeType(declaredMimeHint);

  // Quickly reject leading active markup or script shebangs
  const headSlice = bytes.subarray(0, Math.min(128, bytes.byteLength));
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
    trimmedHead.startsWith('<?php') ||
    trimmedHead.startsWith('#!')
  ) {
    return null;
  }

  // Reject PE/MZ & ELF executables immediately
  if (bytes.byteLength >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return null;
  if (bytes.byteLength >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return null;

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
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
    if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
      return 'audio/wav';
    }
  }

  // PDF: %PDF-
  if (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // ISO BMFF Video Container: MP4 & QuickTime MOV (bytes [4..7] === 'ftyp')
  if (
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const majorBrand = readAsciiRange(bytes, 8, 4).toLowerCase();
    if (majorBrand === 'qt  ') {
      return 'video/quicktime';
    }
    if (VALID_MP4_BRANDS.has(majorBrand)) {
      return 'video/mp4';
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

  // WebM / EBML: 1A 45 DF A3 (shared between video/webm & audio/webm)
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    const hasVideoCodec =
      bytesContainAscii(bytes, 'V_VP8', 8192) ||
      bytesContainAscii(bytes, 'V_VP9', 8192) ||
      bytesContainAscii(bytes, 'V_AV1', 8192) ||
      bytesContainAscii(bytes, 'V_MPEG', 8192);
    if (hasVideoCodec) {
      return 'video/webm';
    }
    if (normalizedHint === 'video/webm') {
      return 'video/webm';
    }
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

  // Office OpenXML ZIP documents (.docx, .xlsx, .pptx)
  if (
    bytes.byteLength >= 30 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return inspectOoxmlZipMime(bytes);
  }

  // Plain Text / CSV UTF-8 validation (only when explicitly expected as text/plain or text/csv)
  if (normalizedHint === 'text/plain' || normalizedHint === 'text/csv') {
    if (isSafeUtf8PlainTextPayload(bytes)) {
      return normalizedHint;
    }
    return null;
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

  const detectedMime = detectMediaMimeFromBytes(bytes, meta.canonicalMime);
  if (!detectedMime) {
    return {
      valid: false,
      error: 'Unrecognized, corrupted, or unsafe file content. File signature does not match any supported attachment format.',
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
  return (
    mediaType === 'gif' ||
    mediaType === 'image' ||
    mediaType === 'audio' ||
    mediaType === 'video' ||
    mediaType === 'document'
  );
}
