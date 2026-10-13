import React, { useState } from 'react';
import { Play, Shield, ExternalLink, Flag, AlertCircle } from 'lucide-react';
import { communityService } from '../../services/communityService';

interface SafeYouTubeEmbedProps {
  url: string;
  onReport?: (url: string) => void;
}

export const SafeYouTubeEmbed: React.FC<SafeYouTubeEmbedProps> = ({ url, onReport }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [embedData, setEmbedData] = useState<{
    valid: boolean;
    videoId?: string;
    safeEmbedUrl?: string;
    thumbnailUrl?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  // Fast client-side regex check first
  const extractVideoId = (u: string): string | null => {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      if (host === 'youtu.be') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts[0] || null;
      }
      if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
        if (parsed.pathname.startsWith('/watch')) return parsed.searchParams.get('v');
        if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/embed/')[1]?.split('/')[0] || null;
        if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/shorts/')[1]?.split('/')[0] || null;
      }
    } catch {
      return null;
    }
    return null;
  };

  const clientVideoId = extractVideoId(url);

  const handlePlayClick = async () => {
    if (!hasChecked) {
      setLoading(true);
      const res = await communityService.validateYouTube(url);
      setLoading(false);
      setHasChecked(true);
      if (res.valid && res.videoId) {
        setEmbedData(res);
        setIsPlaying(true);
      }
    } else if (embedData?.valid) {
      setIsPlaying(true);
    }
  };

  if (!clientVideoId) {
    return null;
  }

  const thumbUrl = embedData?.thumbnailUrl || `https://img.youtube.com/vi/${clientVideoId}/hqdefault.jpg`;
  const safeSrc = embedData?.safeEmbedUrl || `https://www.youtube-nocookie.com/embed/${clientVideoId}?rel=0&modestbranding=1&autoplay=1`;

  return (
    <div className="mt-2.5 max-w-md w-full rounded-xl overflow-hidden border border-slate-800 bg-[#0a0f1d] shadow-lg">
      <div className="px-3 py-1.5 bg-[#0f172a] border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5 font-mono text-cyan-400">
          <Shield className="w-3.5 h-3.5 text-cyan-400" />
          <span>YouTube Privacy-Enhanced Embed</span>
        </div>
        {onReport && (
          <button
            onClick={() => onReport(url)}
            className="flex items-center gap-1 text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
            title="Report this video embed"
          >
            <Flag className="w-3 h-3" />
            <span>Report</span>
          </button>
        )}
      </div>

      {isPlaying ? (
        <div className="relative w-full aspect-video bg-black">
          <iframe
            src={safeSrc}
            title="YouTube video player"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      ) : (
        <div className="relative w-full aspect-video bg-slate-950 group cursor-pointer" onClick={handlePlayClick}>
          <img
            src={thumbUrl}
            alt="YouTube Video Thumbnail"
            className="w-full h-full object-cover opacity-85 group-hover:opacity-95 transition-opacity"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2 group-hover:bg-black/30 transition-all">
            <div className="w-12 h-12 rounded-full bg-red-600/90 group-hover:bg-red-600 text-white flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-all">
              <Play className="w-5 h-5 ml-0.5 fill-white" />
            </div>
            <span className="text-xs font-medium text-white px-2.5 py-1 rounded bg-black/60 backdrop-blur-sm border border-white/10">
              {loading ? 'Verifying privacy embed...' : 'Click to Load Video'}
            </span>
          </div>
          <div className="absolute bottom-2 left-2 text-[10px] text-slate-400 bg-black/70 px-2 py-0.5 rounded font-mono">
            User click required (Autoplay blocked)
          </div>
        </div>
      )}
    </div>
  );
};
