import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { getGenderInfo } from '../../pages/PublicChatPage';
import { MessageSquare, AtSign, UserX, ShieldCheck, Clock } from 'lucide-react';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: {
    id: string;
    nickname: string;
    avatar: string;
    isGuest?: boolean;
    gender?: string;
  } | null;
  onOpenPrivateChat: (member: { id: string; nickname: string; avatar: string }) => void;
  onMention: (nickname: string) => void;
  onBlockUser: (targetId: string, targetNickname: string) => void;
  isCurrentUser?: boolean;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  member,
  onOpenPrivateChat,
  onMention,
  onBlockUser,
  isCurrentUser = false,
}) => {
  if (!member) return null;

  const genderInfo = getGenderInfo(member.gender);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Participant Profile">
      <div className="space-y-4">
        {/* Profile Card Header */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-[#121b30] border border-slate-700/80 flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-3xl shadow-inner select-none shrink-0">
            {member.avatar || '👤'}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`text-lg font-bold truncate ${genderInfo.textColor}`}>
              {member.nickname}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-xs px-2 py-0.5 rounded-md border font-medium inline-flex items-center gap-1"
                style={{
                  color: genderInfo.colorHex,
                  borderColor: `${genderInfo.colorHex}50`,
                  backgroundColor: `${genderInfo.colorHex}20`,
                }}
              >
                <span>{genderInfo.icon}</span>
                <span>{genderInfo.label}</span>
              </span>
              <span className="text-xs text-slate-400 border border-slate-700 px-2 py-0.5 rounded-md bg-slate-800/60">
                {member.isGuest ? 'Guest Session' : 'Registered Member'}
              </span>
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-3 rounded-lg bg-[#0c1220] border border-slate-800">
            <span className="text-[10px] text-slate-400 block font-mono">Status</span>
            <span className="text-emerald-400 font-semibold inline-flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Online in Room
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#0c1220] border border-slate-800">
            <span className="text-[10px] text-slate-400 block font-mono">Safety Verification</span>
            <span className="text-cyan-300 font-semibold inline-flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              Community Checked
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        {!isCurrentUser && (
          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              onClick={() => {
                onOpenPrivateChat(member);
                onClose();
              }}
            >
              <MessageSquare className="w-4 h-4 mr-1.5" />
              <span>Private Chat</span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => {
                onMention(member.nickname);
                onClose();
              }}
            >
              <AtSign className="w-4 h-4 mr-1.5 text-cyan-400" />
              <span>Mention in Group</span>
            </Button>

            <Button
              variant="outline"
              size="md"
              className="text-amber-400 border-amber-900/60 hover:bg-amber-950/30"
              onClick={() => {
                onBlockUser(member.id, member.nickname);
                onClose();
              }}
            >
              <UserX className="w-4 h-4 mr-1.5" />
              <span>Block</span>
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
