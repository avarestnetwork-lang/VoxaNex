import React, { useState } from 'react';
import { Smile, X } from 'lucide-react';

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys & Emotion',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳'],
  },
  {
    name: 'Gestures & People',
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '🤟', '🤙', '👋', '🙏', '💪', '🙋‍♂️', '🙋‍♀️', '🧑‍💻', '🕵️‍♂️', '🫂'],
  },
  {
    name: 'Hearts & Symbols',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '✨', '🔥', '⚡', '⭐'],
  },
  {
    name: 'Culture & Nature',
    emojis: ['☕', '🍵', '🍛', '🍲', '🏏', '⚽', '🐅', '🦌', '🌿', '🍃', '🌊', '🌙', '☀️', '🌧️', '🥭', '🐟', '🌸', '🪷'],
  },
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelectEmoji, onClose }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="absolute bottom-14 right-2 sm:right-12 z-50 w-72 sm:w-80 bg-[#0d1322] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      <div className="p-3 border-b border-slate-800 bg-[#101729] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Smile className="w-4 h-4 text-cyan-400" />
          <span>Select Emoji / স্টিকার</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex border-b border-slate-800/80 bg-[#090d18] px-2 py-1 gap-1 overflow-x-auto text-[11px]">
        {EMOJI_CATEGORIES.map((cat, idx) => (
          <button
            key={cat.name}
            onClick={() => setActiveTab(idx)}
            className={`px-2 py-1 rounded text-xs whitespace-nowrap cursor-pointer ${
              activeTab === idx ? 'bg-violet-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {cat.name.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="p-3 max-h-52 overflow-y-auto grid grid-cols-7 gap-1.5 bg-[#0d1322]">
        {EMOJI_CATEGORIES[activeTab].emojis.map((em, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectEmoji(em)}
            className="w-8 h-8 rounded hover:bg-slate-800 flex items-center justify-center text-lg transition-transform active:scale-125 cursor-pointer"
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );
};
