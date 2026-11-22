import React from 'react';
import { ComposerAttachmentSnapshot } from '../../hooks/useChatMediaAttachment';
import { extractSafeFileExtension, formatBytes } from '../../lib/mediaValidation';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Film,
  Loader2,
  Music,
  RefreshCw,
  X,
  Image as ImageIcon,
} from 'lucide-react';

interface ComposerAttachmentPreviewProps {
  attachment: ComposerAttachmentSnapshot;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  compact?: boolean;
}

export const ComposerAttachmentPreview: React.FC<ComposerAttachmentPreviewProps> = ({
  attachment,
  onCancel,
  onRetry,
  onRemove,
  compact = false,
}) => {
  if (attachment.status === 'idle') return null;

  const isBusy =
    attachment.status === 'file_selected' ||
    attachment.status === 'validating' ||
    attachment.status === 'uploading';
  const isCompleted = attachment.status === 'completed';
  const isFailed = attachment.status === 'failed';
  const isCancelled = attachment.status === 'cancelled';

  const isAudio = attachment.mediaType === 'audio';
  const isVideo = attachment.mediaType === 'video';
  const isDocument = attachment.mediaType === 'document';
  const isGif = attachment.source === 'gif' || attachment.mediaType === 'gif';
  const isImage = !isAudio && !isVideo && !isDocument && !isGif;

  const docBadge = isDocument
    ? (extractSafeFileExtension(attachment.fileName || '') || 'DOC').toUpperCase()
    : '';

  return (
    <div
      data-testid="composer-attachment-preview"
      data-upload-state={attachment.status}
      className={`${
        compact ? 'px-2.5 py-2' : 'px-4 py-2.5'
      } bg-[#0c1222] border-t border-slate-800 flex flex-col gap-2`}
    >
      <div className="flex items-center justify-between gap-2.5">
        {/* Left: Preview & Metadata */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Thumbnail / Icon */}
          {(isImage || isGif) && attachment.previewUrl ? (
            <img
              src={attachment.previewUrl}
              alt={attachment.fileName || 'Attachment preview'}
              className="w-10 h-10 object-cover rounded-lg border border-slate-700 shrink-0 bg-black/30"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg border border-slate-700 bg-slate-900/90 flex items-center justify-center shrink-0 text-cyan-400">
              {isAudio ? (
                <Music className="w-5 h-5 text-cyan-400" />
              ) : isVideo ? (
                <Film className="w-5 h-5 text-violet-400" />
              ) : isDocument ? (
                <FileText className="w-5 h-5 text-amber-400" />
              ) : (
                <ImageIcon className="w-5 h-5" />
              )}
            </div>
          )}

          {/* File details + Status */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {docBadge && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 shrink-0">
                  {docBadge}
                </span>
              )}
              <span className="text-xs font-semibold text-slate-200 truncate">
                {attachment.fileName || (isGif ? 'Animated GIF' : 'Attachment')}
              </span>
              {attachment.fileSize > 0 && (
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  ({formatBytes(attachment.fileSize)})
                </span>
              )}
            </div>

            {/* Status row */}
            <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
              {isBusy && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-cyan-400 shrink-0" />
                  <span className="text-cyan-300 font-medium truncate">
                    {attachment.status === 'uploading'
                      ? `Uploading ${attachment.progress}%`
                      : attachment.status === 'validating'
                      ? 'Validating file...'
                      : 'Preparing upload...'}
                  </span>
                </>
              )}
              {isCompleted && (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 font-medium truncate">
                    {isGif
                      ? 'GIF ready to send'
                      : isAudio
                      ? 'Audio uploaded (100%)'
                      : isVideo
                      ? 'Video uploaded (100%)'
                      : isDocument
                      ? 'Document uploaded (100%)'
                      : 'Image uploaded (100%)'}
                  </span>
                </>
              )}
              {(isFailed || isCancelled) && (
                <>
                  <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                  <span className="text-rose-300 truncate">
                    {attachment.error || (isCancelled ? 'Upload cancelled.' : 'Upload failed.')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isBusy && (
            <button
              type="button"
              onClick={onCancel}
              data-testid="attachment-cancel-btn"
              className="px-2 py-1 rounded-lg bg-amber-950/50 hover:bg-amber-900/60 border border-amber-700/50 text-[11px] font-medium text-amber-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
          {(isFailed || isCancelled) && attachment.canRetry && (
            <button
              type="button"
              onClick={onRetry}
              data-testid="attachment-retry-btn"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-700/50 text-[11px] font-medium text-cyan-300 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            data-testid="attachment-remove-btn"
            aria-label="Remove attachment"
            title="Remove attachment"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-[11px] font-medium text-rose-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
            {!compact && <span>Remove</span>}
          </button>
        </div>
      </div>

      {/* Upload Progress Bar */}
      {attachment.status === 'uploading' && (
        <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-150"
            style={{ width: `${Math.max(4, Math.min(100, attachment.progress))}%` }}
          />
        </div>
      )}

      {/* Local Audio Preview Player */}
      {isAudio && attachment.previewUrl && !isFailed && (
        <audio
          controls
          src={attachment.previewUrl}
          preload="metadata"
          className="w-full h-8 max-w-sm rounded"
        >
          Your browser does not support audio playback.
        </audio>
      )}

      {/* Local Video Preview Player */}
      {isVideo && attachment.previewUrl && !isFailed && (
        <video
          controls
          playsInline
          src={attachment.previewUrl}
          preload="metadata"
          className="w-full max-h-40 max-w-sm rounded-lg bg-black/60 border border-slate-700/60"
        >
          Your browser does not support video playback.
        </video>
      )}
    </div>
  );
};
