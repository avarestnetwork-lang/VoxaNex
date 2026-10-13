import React, { useState, useEffect } from 'react';
import { Search, X, Image as ImageIcon } from 'lucide-react';
import { messagingService, GifItem } from '../../services/messagingService';

interface GifPickerProps {
  onSelectGif: (gif: GifItem) => void;
  onClose: () => void;
}

export const GifPicker: React.FC<GifPickerProps> = ({ onSelectGif, onClose }) => {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      const items = await messagingService.searchGifs(query);
      if (!cancel) {
        setGifs(items);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [query]);

  return (
    <div className="absolute bottom-14 right-2 sm:right-16 z-50 w-72 sm:w-88 bg-[#0d1322] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      <div className="p-3 border-b border-slate-800 bg-[#101729] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <ImageIcon className="w-4 h-4 text-fuchsia-400" />
          <span>Curated Safe GIFs / অ্যানিমেশন</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-slate-800 bg-[#090d18]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GIFs (e.g. hello, tea, celebrate)..."
            className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* GIF Grid */}
      <div className="p-3 max-h-60 overflow-y-auto grid grid-cols-2 gap-2 bg-[#0d1322]">
        {loading ? (
          <div className="col-span-2 text-center py-8 text-xs text-slate-500">
            Loading GIFs...
          </div>
        ) : gifs.length === 0 ? (
          <div className="col-span-2 text-center py-8 text-xs text-slate-500">
            No GIFs found matching "{query}"
          </div>
        ) : (
          gifs.map((gif) => (
            <button
              key={gif.id}
              type="button"
              onClick={() => onSelectGif(gif)}
              className="group relative rounded-lg overflow-hidden border border-slate-800 hover:border-violet-500 transition-all text-left bg-black/40 cursor-pointer"
            >
              <img
                src={gif.url}
                alt={gif.title}
                className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
                loading="lazy"
              />
              <div className="p-1.5 bg-[#0a0f1d] text-[10px] text-slate-300 truncate font-medium">
                {gif.title}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
