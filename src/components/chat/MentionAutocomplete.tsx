import React, { useEffect, useRef } from 'react';
import { RealtimePresenceMember } from '../../services/messagingService';
import { getGenderInfo } from '../../pages/PublicChatPage';
import { AtSign } from 'lucide-react';

interface MentionAutocompleteProps {
  query: string;
  members: RealtimePresenceMember[];
  onSelect: (nickname: string) => void;
  onClose: () => void;
  selectedIndex: number;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  query,
  members,
  onSelect,
  onClose,
  selectedIndex,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = members
    .filter((m) => m.nickname.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  useEffect(() => {
    if (filtered.length === 0) {
      onClose();
    }
  }, [filtered.length, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-slate-700 bg-[#0c1322] shadow-2xl overflow-hidden z-40 text-xs backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-100"
    >
      <div className="px-3 py-1.5 bg-[#090d18] border-b border-slate-800 text-[10px] text-slate-400 font-medium flex items-center justify-between">
        <span className="flex items-center gap-1 text-cyan-400 font-semibold">
          <AtSign className="w-3 h-3" />
          <span>Mention a participant</span>
        </span>
        <span className="text-slate-500 font-mono">Tab/Enter to select</span>
      </div>

      <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
        {filtered.map((member, idx) => {
          const isSelected = idx === selectedIndex;
          const genderInfo = getGenderInfo(member.gender);

          return (
            <button
              key={member.id}
              type="button"
              onClick={() => onSelect(member.nickname)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-cyan-950/60 border border-cyan-800/60 text-white'
                  : 'hover:bg-slate-800/60 text-slate-200 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base select-none shrink-0">{member.avatar || '👤'}</span>
                <span className={`font-semibold truncate text-xs ${genderInfo.textColor}`}>
                  @{member.nickname}
                </span>
              </div>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                style={{
                  color: genderInfo.colorHex,
                  borderColor: `${genderInfo.colorHex}40`,
                  backgroundColor: `${genderInfo.colorHex}15`,
                }}
              >
                {genderInfo.icon} {genderInfo.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
