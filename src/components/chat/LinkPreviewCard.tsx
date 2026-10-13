import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { LinkPreviewData } from '../../services/messagingService';

interface LinkPreviewCardProps {
  preview: LinkPreviewData;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ preview }) => {
  let hostname = '';
  try {
    hostname = new URL(preview.url).hostname;
  } catch {
    hostname = preview.url;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block rounded-lg overflow-hidden border border-slate-700/80 bg-[#090e1c] hover:border-cyan-500/80 transition-all text-left group max-w-sm"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt={preview.title || 'Link Preview'}
          className="w-full h-32 object-cover bg-slate-900"
          loading="lazy"
        />
      )}
      <div className="p-2.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-mono">
          <Globe className="w-3 h-3" />
          <span className="truncate">{hostname}</span>
          <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-70 group-hover:opacity-100" />
        </div>
        {preview.title && (
          <h4 className="text-xs font-semibold text-slate-100 line-clamp-1 group-hover:text-cyan-300 transition-colors">
            {preview.title}
          </h4>
        )}
        {preview.description && (
          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
            {preview.description}
          </p>
        )}
      </div>
    </a>
  );
};
