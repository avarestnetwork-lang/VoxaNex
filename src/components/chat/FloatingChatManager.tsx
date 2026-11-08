import React from 'react';
import { usePrivateChat, FloatingChatWindow } from '../../context/PrivateChatContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useRouter } from '../../context/RouterContext';
import { PrivateChatPane } from './PrivateChatPane';
import {
  X,
  Maximize2,
} from 'lucide-react';

export const FloatingChatWindowView: React.FC<{ window: FloatingChatWindow }> = ({ window: win }) => {
  const { user } = useAuth();
  const { closeChat, minimizeChat, maximizeChat } = usePrivateChat();
  const { language } = useLanguage();
  const { currentRoute } = useRouter();

  // Rule 5 & 7: Only render when isOpen AND displayMode === 'floating'
  // Fix: Hide floating window if we are already viewing it on the /messages page
  if (!win.isOpen || win.displayMode !== 'floating' || currentRoute === '/messages') return null;

  // Minimized view: small tab at bottom-right
  if (win.isMinimized) {
    return (
      <div className="bg-[#0d1424] border border-slate-700 rounded-t-xl shadow-2xl flex items-center justify-between px-4 py-2.5 w-72 text-white cursor-pointer hover:bg-[#121b30] transition-colors pointer-events-auto">
        <div
          className="flex items-center gap-2.5 min-w-0 flex-1"
          onClick={() => minimizeChat(win.conversationId)}
        >
          <span className="text-lg select-none shrink-0">{win.partnerAvatar || '👤'}</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-xs truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{win.partnerNickname}</span>
            </div>
            {win.unreadCount > 0 && (
              <span className="text-[10px] text-rose-400 font-semibold">
                {win.unreadCount} new message{win.unreadCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {win.unreadCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
              {win.unreadCount}
            </span>
          )}
          <button
            onClick={() => minimizeChat(win.conversationId)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title="Restore"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => closeChat(win.conversationId)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const containerClasses =
    'w-[min(320px,calc(100vw-24px))] h-[82vh] sm:h-[480px] max-h-[calc(100vh-5rem)] supports-[height:100dvh]:max-h-[min(480px,82dvh,calc(100vh-5rem))] bg-[#0d1424] border border-slate-700/80 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50 pointer-events-auto';

  return (
    <div className={containerClasses}>
      <PrivateChatPane
        conversationId={win.conversationId}
        partner={{
          id: win.partnerId,
          nickname: win.partnerNickname,
          avatar: win.partnerAvatar,
          gender: win.partnerGender,
        }}
        currentUser={{
          id: user.id,
          nickname: user.nickname,
          avatar: user.avatar,
        }}
        onClose={() => closeChat(win.conversationId)}
        onMinimize={() => minimizeChat(win.conversationId)}
        onMaximize={() => maximizeChat(win.conversationId)}
        language={language}
      />
    </div>
  );
};

export const FloatingChatManager: React.FC = () => {
  const { openWindows, latestToast, clearToast, openChat } = usePrivateChat();
  const { currentRoute } = useRouter();

  // Rule 5 & 7: The floating manager must render ONLY conversations whose mode is 'floating'
  // Fix: Hide floating window if we are already viewing it on the /messages page
  const floatingWindows = openWindows.filter(
    (win) => win.isOpen && win.displayMode === 'floating' && currentRoute !== '/messages'
  );

  return (
    <>
      {/* Floating Toast Notification */}
      {latestToast && (
        <div className="fixed bottom-20 right-4 z-50 max-w-sm rounded-2xl bg-[#0d1424] border border-violet-500/50 shadow-2xl p-4 text-white animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-start gap-3">
            <span className="text-2xl select-none shrink-0">{latestToast.avatar}</span>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
              const targetPartnerId = latestToast.partnerId || (openWindows.find((w) => w.conversationId === latestToast.conversationId)?.partnerId);
              if (targetPartnerId) {
                openChat({ id: targetPartnerId, nickname: latestToast.title, avatar: latestToast.avatar });
              }
              clearToast();
            }}>
              <div className="text-xs font-bold text-violet-300 truncate">{latestToast.title} sent a message</div>
              <p className="text-xs text-slate-300 truncate mt-0.5">{latestToast.message}</p>
            </div>
            <button
              onClick={clearToast}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Chat Windows Stack at Bottom-Right */}
      <div className="fixed bottom-0 right-4 z-50 flex items-end gap-3 flex-wrap justify-end pointer-events-none">
        {floatingWindows.map((win) => (
          <div key={win.conversationId} className="pointer-events-auto">
            <FloatingChatWindowView window={win} />
          </div>
        ))}
      </div>
    </>
  );
};
