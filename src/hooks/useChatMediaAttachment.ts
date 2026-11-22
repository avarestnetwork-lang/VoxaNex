import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChatMediaType,
  validateMediaFileMetadata,
  sanitizeDisplayFileName,
} from '../lib/mediaValidation';
import { messagingService, UploadedMediaAsset } from '../services/messagingService';

export type MediaUploadState =
  | 'idle'
  | 'file_selected'
  | 'validating'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ComposerAttachmentSnapshot {
  status: MediaUploadState;
  source: 'upload' | 'gif' | null;
  file: File | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  mediaType: ChatMediaType | null;
  previewUrl: string | null;
  uploadedAsset: UploadedMediaAsset | null;
  progress: number;
  error: string | null;
  canRetry: boolean;
}

const INITIAL_ATTACHMENT_STATE: ComposerAttachmentSnapshot = {
  status: 'idle',
  source: null,
  file: null,
  fileName: '',
  fileSize: 0,
  mimeType: '',
  mediaType: null,
  previewUrl: null,
  uploadedAsset: null,
  progress: 0,
  error: null,
  canRetry: false,
};

export interface UseChatMediaAttachmentOptions {
  contextType: 'room' | 'conversation';
  contextId: string | null | undefined;
  isGuest?: boolean;
  userId?: string;
}

export function useChatMediaAttachment({
  contextType,
  contextId,
  isGuest,
  userId,
}: UseChatMediaAttachmentOptions) {
  const [state, setState] = useState<ComposerAttachmentSnapshot>(INITIAL_ATTACHMENT_STATE);

  const abortFnRef = useRef<(() => void) | null>(null);
  const localBlobUrlRef = useRef<string | null>(null);
  const activeAttemptIdRef = useRef<number>(0);
  const uploadingLockRef = useRef<boolean>(false);
  const isUnmountedRef = useRef<boolean>(false);
  const lastModeRef = useRef<'image' | 'audio'>('image');
  const activeIdempotencyKeyRef = useRef<string | null>(null);

  const createIdempotencyKey = useCallback((): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `upl_${crypto.randomUUID().replace(/-/g, '')}`;
    }
    return `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }, []);

  const revokePreviewBlob = useCallback(() => {
    if (localBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(localBlobUrlRef.current);
      } catch {
        // ignore
      }
      localBlobUrlRef.current = null;
    }
  }, []);

  const abortActiveUpload = useCallback(() => {
    if (abortFnRef.current) {
      try {
        abortFnRef.current();
      } catch {
        // ignore
      }
      abortFnRef.current = null;
    }
    uploadingLockRef.current = false;
  }, []);

  // Reset and isolate state strictly whenever conversationId or roomId changes
  useEffect(() => {
    activeAttemptIdRef.current += 1;
    activeIdempotencyKeyRef.current = null;
    abortActiveUpload();
    revokePreviewBlob();
    setState(INITIAL_ATTACHMENT_STATE);
  }, [contextType, contextId, abortActiveUpload, revokePreviewBlob]);

  // Abort only this instance's active upload and revoke Blob URL on unmount
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      activeAttemptIdRef.current += 1;
      abortActiveUpload();
      revokePreviewBlob();
    };
  }, [abortActiveUpload, revokePreviewBlob]);

  const executeUpload = useCallback(
    async (file: File, attemptId: number, resolvedType: ChatMediaType) => {
      if (!contextId) {
        uploadingLockRef.current = false;
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: 'Active chat context is not ready yet.',
          canRetry: true,
        }));
        return;
      }

      uploadingLockRef.current = true;
      setState((prev) => ({
        ...prev,
        status: 'uploading',
        mediaType: resolvedType,
        progress: 0,
        error: null,
        uploadedAsset: null,
      }));

      const idempotencyKey = activeIdempotencyKeyRef.current || createIdempotencyKey();
      activeIdempotencyKeyRef.current = idempotencyKey;

      const res = await messagingService.uploadChatMedia({
        file,
        contextType,
        contextId,
        isGuest,
        userId,
        idempotencyKey,
        onProgress: (pct) => {
          if (isUnmountedRef.current || activeAttemptIdRef.current !== attemptId) return;
          setState((prev) =>
            prev.status === 'uploading' ? { ...prev, progress: pct } : prev
          );
        },
        registerAbort: (fn) => {
          if (isUnmountedRef.current || activeAttemptIdRef.current !== attemptId) {
            try {
              fn();
            } catch {
              // ignore
            }
            return;
          }
          abortFnRef.current = fn;
        },
      });

      if (isUnmountedRef.current || activeAttemptIdRef.current !== attemptId) {
        return;
      }

      abortFnRef.current = null;
      uploadingLockRef.current = false;

      if (res.aborted) {
        setState((prev) => ({
          ...prev,
          status: 'cancelled',
          progress: 0,
          uploadedAsset: null,
          error: 'Upload cancelled.',
          canRetry: true,
        }));
        return;
      }

      if (res.success && res.media) {
        setState((prev) => ({
          ...prev,
          status: 'completed',
          progress: 100,
          mediaType: res.media!.mediaType,
          uploadedAsset: res.media!,
          error: null,
          canRetry: false,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        status: 'failed',
        progress: 0,
        uploadedAsset: null,
        error: res.error || 'Upload failed. Please retry.',
        canRetry: true,
      }));
    },
    [contextType, contextId, isGuest, userId]
  );

  const selectFile = useCallback(
    async (file: File, mode: 'image' | 'audio') => {
      if (!file) return;

      // Cancel any prior upload attempt cleanly before starting a new selection
      activeAttemptIdRef.current += 1;
      const attemptId = activeAttemptIdRef.current;
      activeIdempotencyKeyRef.current = createIdempotencyKey();
      abortActiveUpload();
      revokePreviewBlob();
      lastModeRef.current = mode;

      const cleanName = sanitizeDisplayFileName(file.name);

      // 1. file_selected -> 2. validating
      setState({
        status: 'file_selected',
        source: 'upload',
        file,
        fileName: cleanName,
        fileSize: file.size,
        mimeType: file.type || '',
        mediaType: mode === 'audio' ? 'audio' : 'image',
        previewUrl: null,
        uploadedAsset: null,
        progress: 0,
        error: null,
        canRetry: false,
      });

      setState((prev) => ({
        ...prev,
        status: 'validating',
      }));

      const meta = validateMediaFileMetadata({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        imageOnly: mode === 'image',
        audioOnly: mode === 'audio',
        inferMimeFromExtIfEmpty: true,
      });

      if (!meta.valid || !meta.chatMediaType) {
        setState({
          status: 'failed',
          source: 'upload',
          file: null,
          fileName: cleanName,
          fileSize: file.size,
          mimeType: file.type || '',
          mediaType: mode === 'audio' ? 'audio' : 'image',
          previewUrl: null,
          uploadedAsset: null,
          progress: 0,
          error: meta.error || 'Unsupported or invalid attachment.',
          canRetry: false,
        });
        return;
      }

      // Create safe local object URL preview with guaranteed cleanup
      let objectUrl: string | null = null;
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try {
          objectUrl = URL.createObjectURL(file);
          localBlobUrlRef.current = objectUrl;
        } catch {
          objectUrl = null;
        }
      }

      setState((prev) => ({
        ...prev,
        mimeType: meta.canonicalMime || prev.mimeType,
        mediaType: meta.chatMediaType || prev.mediaType,
        previewUrl: objectUrl,
      }));

      await executeUpload(file, attemptId, meta.chatMediaType);
    },
    [abortActiveUpload, revokePreviewBlob, executeUpload]
  );

  const selectGif = useCallback(
    (gif: { url: string; title?: string }) => {
      activeAttemptIdRef.current += 1;
      activeIdempotencyKeyRef.current = null;
      abortActiveUpload();
      revokePreviewBlob();

      setState({
        status: 'completed',
        source: 'gif',
        file: null,
        fileName: gif.title || 'Animated GIF',
        fileSize: 0,
        mimeType: 'image/gif',
        mediaType: 'gif',
        previewUrl: gif.url,
        uploadedAsset: {
          uploadId: gif.url,
          url: gif.url,
          mediaType: 'gif',
          mimeType: 'image/gif',
          fileName: gif.title || 'gif',
          fileSize: 0,
        },
        progress: 100,
        error: null,
        canRetry: false,
      });
    },
    [abortActiveUpload, revokePreviewBlob]
  );

  const cancelUpload = useCallback(() => {
    activeAttemptIdRef.current += 1;
    abortActiveUpload();
    setState((prev) =>
      prev.status === 'uploading' || prev.status === 'validating' || prev.status === 'file_selected'
        ? {
            ...prev,
            status: 'cancelled',
            progress: 0,
            uploadedAsset: null,
            error: 'Upload cancelled.',
            canRetry: Boolean(prev.file),
          }
        : prev
    );
  }, [abortActiveUpload]);

  const retryUpload = useCallback(async () => {
    if (uploadingLockRef.current) return;
    if (!state.file || (state.status !== 'failed' && state.status !== 'cancelled')) return;

    activeAttemptIdRef.current += 1;
    const attemptId = activeAttemptIdRef.current;
    const targetType: ChatMediaType =
      state.mediaType || (lastModeRef.current === 'audio' ? 'audio' : 'image');

    await executeUpload(state.file, attemptId, targetType);
  }, [state.file, state.status, state.mediaType, executeUpload]);

  const removeAttachment = useCallback(() => {
    activeAttemptIdRef.current += 1;
    activeIdempotencyKeyRef.current = null;
    abortActiveUpload();
    revokePreviewBlob();
    setState(INITIAL_ATTACHMENT_STATE);
  }, [abortActiveUpload, revokePreviewBlob]);

  const markSent = useCallback(() => {
    activeAttemptIdRef.current += 1;
    activeIdempotencyKeyRef.current = null;
    abortActiveUpload();
    revokePreviewBlob();
    setState(INITIAL_ATTACHMENT_STATE);
  }, [abortActiveUpload, revokePreviewBlob]);

  const isBusy =
    state.status === 'file_selected' ||
    state.status === 'validating' ||
    state.status === 'uploading';

  const stagedMedia =
    state.status === 'completed' && state.uploadedAsset
      ? {
          url: state.uploadedAsset.url,
          type: state.uploadedAsset.mediaType,
          title: state.fileName,
        }
      : null;

  const canSendMessage = (trimmedText: string): boolean => {
    if (isBusy) return false;
    // Block sending while a non-idle upload hasn't completed (failed/cancelled must be retried or removed)
    if (state.status === 'failed' || state.status === 'cancelled') return false;
    return Boolean(trimmedText) || Boolean(stagedMedia);
  };

  return {
    attachment: state,
    stagedMedia,
    isBusy,
    canSendMessage,
    selectFile,
    selectGif,
    cancelUpload,
    retryUpload,
    removeAttachment,
    markSent,
  };
}
