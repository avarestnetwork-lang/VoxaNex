import React, { useEffect, useRef } from 'react';
import {
  MessageSquare,
  AtSign,
  User,
  Copy,
  UserX,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { RealtimePresenceMember } from '../../services/messagingService';
import { getGenderInfo } from '../../pages/PublicChatPage';

export interface UserActionMenuProps {
  member: {
    id: string;
    nickname: string;
    avatar: string;
    isGuest?: boolean;
    gender?: string;
  };
  position: { x: number; y: number };
  onClose: () => void;
  onOpenPrivateChat: (member: { id: string; nickname: string; avatar: string }) => void;
  onMention: (nickname: string) => void;
  onViewProfile: (member: any) => void;
  onBlockUser: (targetId: string, targetNickname: string) => void;
  onReportUser: (targetId: string, targetNickname: string) => void;
  isCurrentUser?: boolean;
}

export const UserActionMenu: React.FC<UserActionMenuProps> = ({
  member,
  position,
  onClose,
  onOpenPrivateChat,
  onMention,
  onViewProfile,
  onBlockUser,
  onReportUser,
  isCurrentUser = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const genderInfo = getGenderInfo(member.gender);

  // Position adjustments to ensure menu stays within viewport
  const adjustedX = Math.min(position.x, window.innerWidth - 240);
  const adjustedY = Math.min(position.y, window.innerHeight - 300);

  const handleCopyUsername = () => {
    navigator.clipboard?.writeText?.(`@${member.nickname}`);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 1000);
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${Math.max(12, adjustedX)}px`, top: `${Math.max(12, adjustedY)}px` }}
      className="fixed z-50 w-56 rounded-xl border border-slate-700/80 bg-[#0d1424] shadow-2xl backdrop-blur-md overflow-hidden text-xs animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Header with avatar, nickname & gender */}
      <div className="p-3 bg-gradient-to-r from-slate-900 to-[#10192e] border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xl select-none shrink-0">{member.avatar || '👤'}</span>
          <div className="min-w-0">
            <div className={`font-bold truncate text-sm ${genderInfo.textColor}`}>
              {member.nickname}
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <span>{member.isGuest ? 'Guest' : 'Member'}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5" style={{ color: genderInfo.colorHex }}>
                <span>{genderInfo.icon}</span>
                <span>{genderInfo.label}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action items */}
      <div className="p-1.5 space-y-0.5">
        {!isCurrentUser && (
          <>
            <button
              onClick={() => {
                onOpenPrivateChat(member);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-200 hover:text-white hover:bg-violet-600/20 hover:border-violet-500/30 border border-transparent transition-colors text-left cursor-pointer group"
            >
              <MessageSquare className="w-4 h-4 text-violet-400 group-hover:text-violet-300" />
              <div>
                <div className="font-semibold text-white">Private Message</div>
                <div className="text-[10px] text-slate-400">Open 1-on-1 private chat</div>
              </div>
            </button>

            <button
              onClick={() => {
                onMention(member.nickname);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-200 hover:text-white hover:bg-cyan-600/20 hover:border-cyan-500/30 border border-transparent transition-colors text-left cursor-pointer group"
            >
              <AtSign className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300" />
              <div>
                <div className="font-semibold text-white">Mention in Group</div>
                <div className="text-[10px] text-slate-400">Insert @{member.nickname}</div>
              </div>
            </button>
          </>
        )}

        <button
          onClick={() => {
            onViewProfile(member);
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-200 hover:text-white hover:bg-slate-800 transition-colors text-left cursor-pointer"
        >
          <User className="w-4 h-4 text-slate-400" />
          <span>View Profile</span>
        </button>

        <button
          onClick={handleCopyUsername}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-200 hover:text-white hover:bg-slate-800 transition-colors text-left cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 font-semibold">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 text-slate-400" />
              <span>Copy Username</span>
            </>
          )}
        </button>

        {!isCurrentUser && (
          <>
            <div className="my-1 border-t border-slate-800/80" />

            <button
              onClick={() => {
                onBlockUser(member.id, member.nickname);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-950/30 transition-colors text-left cursor-pointer"
            >
              <UserX className="w-4 h-4 text-amber-400" />
              <span>Block / Mute</span>
            </button>

            <button
              onClick={() => {
                onReportUser(member.id, member.nickname);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition-colors text-left cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>Report User</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
