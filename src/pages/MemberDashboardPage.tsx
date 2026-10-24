import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth, GUEST_AVATARS } from '../context/AuthContext';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SEOHead } from '../components/common/SEOHead';
import { BlockedUserEntry, UserConnection } from '../types';
import {
  User,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Bell,
  Save,
  CheckCircle,
  Sparkles,
  UserX,
  Users,
  Download,
  Trash2,
  Eye,
  EyeOff,
  Tag,
  AlertCircle,
  Lock,
  MessageSquare,
  Compass,
  Heart,
  LogOut,
  ArrowRight,
  Shield,
  Clock,
  ExternalLink,
} from 'lucide-react';

const INTERESTS_OPTIONS = [
  'Bangla Chat',
  'Desi Dating',
  'Flirting & Romance',
  'Tech & Code',
  'Cricket & Sports',
  'Music & Bands',
  'Bengali Literature',
  'Movies & Shows',
  'Travel & Food',
  'Gaming & Esports',
  'Freelance & Remote',
  'Photography',
];

export const MemberDashboardPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();
  const {
    user,
    hasActiveSession,
    is18Verified,
    setNickname,
    setAvatar,
    updatePreferences,
    logout,
    deleteAccount,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'overview' | 'identity' | 'privacy' | 'blocked' | 'connections' | 'data'>('overview');

  // Identity Form State
  const [nicknameInput, setNicknameInput] = useState(user.nickname);
  const [bioInput, setBioInput] = useState(user.bio || '');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    user.interests && user.interests.length > 0 ? user.interests : ['Bangla Chat', 'Flirting & Romance']
  );
  const [onlineVisibility, setOnlineVisibility] = useState<'online' | 'away' | 'stealth_invisible'>(
    user.onlineVisibility || 'online'
  );
  const [allowDiscoverability, setAllowDiscoverability] = useState<boolean>(user.allowDiscoverability !== false);
  const [dmPolicy, setDmPolicy] = useState<'everyone' | 'connections_only' | 'nobody'>(user.allowDirectMessages || 'everyone');
  const [safeFilter, setSafeFilter] = useState(user.safeFilterEnabled);
  const [sounds, setSounds] = useState(user.notificationSounds);

  // Status feedback
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Blocked users & connections
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserEntry[]>([]);
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [newBlockUsername, setNewBlockUsername] = useState('');
  const [blockActionMsg, setBlockActionMsg] = useState<string | null>(null);

  // Modals
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setNicknameInput(user.nickname);
    setBioInput(user.bio || '');
    if (user.interests && user.interests.length > 0) {
      setSelectedInterests(user.interests);
    }
  }, [user]);

  useEffect(() => {
    async function loadBlockedAndConnections() {
      if (!user.id) return;
      const blocks = await safetyService.getBlockedUsers(user.id);
      setBlockedUsers(blocks);

      const conns = await safetyService.getConnections(user.id);
      setConnections(conns);
    }
    loadBlockedAndConnections();
  }, [user.id]);

  // Auth Protection: If no active session, present clean authentication requirement
  if (!hasActiveSession) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center px-4 py-16">
        <SEOHead
          title="Sign In Required | ChatLustora Member Dashboard"
          description="Authentication required to access the ChatLustora member dashboard."
          canonicalPath="/dashboard"
        />
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-xl space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 flex items-center justify-center mx-auto text-rose-600 dark:text-rose-400 shadow-inner">
            <Lock className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {language === 'bn' ? 'সদস্য ড্যাশবোর্ডে প্রবেশাধিকার সংরক্ষিত' : 'Member Dashboard Access'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'আপনার সংরক্ষিত প্রোফাইল, ব্যক্তিগত চ্যাট, উপস্থিতি এবং গোপনীয়তা সেটিংস অ্যাক্সেস করতে অনুগ্রহ করে সাইন ইন করুন।'
                : 'Please sign in or create an account to access your member dashboard, saved preferences, and private conversations.'}
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => navigate('/')}
              className="bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 font-bold"
            >
              <Lock className="w-4 h-4 mr-2" />
              <span>{language === 'bn' ? 'সাইন ইন করুন (হোমপেজ)' : 'Sign In on Homepage'}</span>
            </Button>

            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => navigate('/register')}
              className="border-slate-200 dark:border-slate-700"
            >
              <User className="w-4 h-4 mr-2 text-orange-500" />
              <span>{language === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create Free Account'}</span>
            </Button>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
              <span>{language === 'bn' ? 'নিবন্ধন ছাড়াই চ্যাট করতে চান? ' : 'Prefer no account? '}</span>
              <button
                onClick={() => navigate('/guest-entry')}
                className="font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                {language === 'bn' ? 'গেস্ট হিসেবে প্রবেশ করুন' : 'Continue as Guest'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const toggleInterest = (interest: string) => {
    if (selectedInterests.includes(interest)) {
      setSelectedInterests(selectedInterests.filter((i) => i !== interest));
    } else {
      if (selectedInterests.length >= 6) return;
      setSelectedInterests([...selectedInterests, interest]);
    }
  };

  const validateNickname = (name: string): boolean => {
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 24) {
      setValidationError('Nickname must be between 3 and 24 characters.');
      return false;
    }
    const validChars = /^[a-zA-Z0-9_]+$/;
    if (!validChars.test(trimmed)) {
      setValidationError('Nickname may only contain letters, numbers, and underscores (no spaces).');
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateNickname(nicknameInput)) {
      return;
    }

    setNickname(nicknameInput.trim());
    updatePreferences({
      bio: bioInput.trim(),
      interests: selectedInterests,
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleSavePrivacy = (e: React.FormEvent) => {
    e.preventDefault();
    updatePreferences({
      onlineVisibility,
      allowDiscoverability,
      allowDirectMessages: dmPolicy,
      safeFilterEnabled: safeFilter,
      notificationSounds: sounds,
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleUnblock = async (targetId: string) => {
    await safetyService.toggleBlockUser({
      blockerId: user.id,
      targetId,
      blocked: false,
    });
    setBlockedUsers(blockedUsers.filter((b) => b.targetId !== targetId));
    setBlockActionMsg('User unblocked successfully.');
    setTimeout(() => setBlockActionMsg(null), 2000);
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockUsername.trim()) return;

    await safetyService.toggleBlockUser({
      blockerId: user.id,
      targetId: newBlockUsername.trim().toLowerCase(),
      targetNickname: newBlockUsername.trim(),
      blocked: true,
      reason: 'Manual user block via settings',
    });

    setBlockedUsers([
      ...blockedUsers,
      {
        targetId: newBlockUsername.trim().toLowerCase(),
        targetNickname: newBlockUsername.trim(),
        targetAvatar: '👤',
        blockedAt: new Date().toISOString(),
      },
    ]);
    setNewBlockUsername('');
    setBlockActionMsg('User added to block list.');
    setTimeout(() => setBlockActionMsg(null), 2000);
  };

  const handleExportData = async () => {
    setExporting(true);
    const data = await safetyService.exportUserData(user.id);
    setExporting(false);

    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chatlustora_member_export_${user.nickname.toLowerCase()}_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    await safetyService.deleteAccount(user.id);
    await deleteAccount();
    setDeleting(false);
    setDeleteModalOpen(false);
    navigate('/');
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 font-sans">
      <SEOHead
        title="Member Dashboard | ChatLustora"
        description="Manage your ChatLustora member profile, direct messages, privacy settings, blocked contacts, and security controls."
        canonicalPath="/dashboard"
      />

      {/* Guest Warning Banner if in Guest mode */}
      {user.isGuest && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                {language === 'bn' ? 'অস্থায়ী গেস্ট সেশন সক্রিয়' : 'Temporary Guest Session Active'}
              </h2>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                {language === 'bn'
                  ? `আপনি বর্তমানে গেস্ট হিসেবে (${user.nickname}) চ্যাট করছেন। স্থায়ী হ্যান্ডেল সংরক্ষণ ও পূর্ণ সদস্য সুবিধার জন্য নিবন্ধন করুন।`
                  : `You are currently browsing as guest ${user.nickname}. Create a permanent account to keep your nickname reserved, save conversation history, and access all member tools.`}
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/register')}
            className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 font-bold"
          >
            <span>{language === 'bn' ? 'স্থায়ী অ্যাকাউন্ট তৈরি করুন' : 'Create Member Account'}</span>
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      )}

      {/* Member Profile Header Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            {/* Avatar with click to change */}
            <div className="relative group">
              <div
                onClick={() => setAvatarModalOpen(true)}
                className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-rose-500 to-orange-400 flex items-center justify-center text-4xl shadow-md cursor-pointer group-hover:scale-105 transition-transform"
                title="Click to change avatar"
              >
                {user.avatar || '⚡'}
              </div>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(true)}
                className="absolute -bottom-1 -right-1 p-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shadow-sm cursor-pointer"
                title="Change Avatar"
              >
                <Sparkles className="w-3 h-3 text-orange-500" />
              </button>
            </div>

            {/* Member Details */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  {user.nickname}
                </h1>
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                    user.isGuest
                      ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                      : 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                  }`}
                >
                  {user.isGuest ? 'Guest Session' : 'Registered Member'}
                </span>

                {is18Verified && (
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                    <span>18+ Verified</span>
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {user.email ? user.email : `Temporary ID: ${user.id || 'N/A'}`} ·{' '}
                <span className="capitalize">{user.gender || 'Not specified'}</span>
              </p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex flex-wrap items-center gap-2.5 self-stretch md:self-auto justify-end">
            <Button variant="secondary" size="sm" onClick={() => navigate('/messages')} className="cursor-pointer">
              <MessageSquare className="w-4 h-4 mr-1.5 text-violet-500" />
              <span>{language === 'bn' ? 'মেসেজ বক্স' : 'Direct Messages'}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
              className="text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-1.5" />
              <span>{language === 'bn' ? 'সাইন আউট' : 'Sign Out'}</span>
            </Button>
          </div>
        </div>

        {/* Quick Hub Navigation Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => navigate('/rooms')}
            className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-orange-50 dark:hover:bg-orange-950/40 border border-slate-200/80 dark:border-slate-700 text-left transition-all group cursor-pointer"
          >
            <Compass className="w-5 h-5 text-orange-500 mb-2 group-hover:scale-110 transition-transform" />
            <div className="text-xs font-bold text-slate-900 dark:text-white">Public Rooms</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Explore 20+ live lobbies</div>
          </button>

          <button
            onClick={() => navigate('/dating')}
            className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200/80 dark:border-slate-700 text-left transition-all group cursor-pointer"
          >
            <Heart className="w-5 h-5 text-rose-500 mb-2 group-hover:scale-110 transition-transform fill-rose-500/20" />
            <div className="text-xs font-bold text-slate-900 dark:text-white">Dating & Flirt</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">18+ Desi adult singles</div>
          </button>

          <button
            onClick={() => navigate('/messages')}
            className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-violet-50 dark:hover:bg-violet-950/40 border border-slate-200/80 dark:border-slate-700 text-left transition-all group cursor-pointer"
          >
            <MessageSquare className="w-5 h-5 text-violet-500 mb-2 group-hover:scale-110 transition-transform" />
            <div className="text-xs font-bold text-slate-900 dark:text-white">Direct Chat</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">End-to-end private DMs</div>
          </button>

          <button
            onClick={() => navigate('/safety')}
            className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200/80 dark:border-slate-700 text-left transition-all group cursor-pointer"
          >
            <Shield className="w-5 h-5 text-emerald-500 mb-2 group-hover:scale-110 transition-transform" />
            <div className="text-xs font-bold text-slate-900 dark:text-white">Safety Center</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Rules, blocks & report</div>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex rounded-2xl bg-slate-100 dark:bg-slate-800/70 p-1 border border-slate-200 dark:border-slate-700 gap-1 overflow-x-auto">
        {[
          { id: 'overview', label: language === 'bn' ? 'সারসংক্ষেপ' : 'Overview & Profile', icon: User },
          { id: 'privacy', label: language === 'bn' ? 'গোপনীয়তা ও দৃশ্যমানতা' : 'Privacy & Visibility', icon: Eye },
          { id: 'blocked', label: `${language === 'bn' ? 'ব্লক তালিকা' : 'Blocked Users'} (${blockedUsers.length})`, icon: UserX },
          { id: 'connections', label: `${language === 'bn' ? 'বন্ধু সংযোগ' : 'Connections'} (${connections.length})`, icon: Users },
          { id: 'data', label: language === 'bn' ? 'ডাটা ও অ্যাকাউন্ট' : 'Data & Governance', icon: Download },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{language === 'bn' ? 'সেটিংস সফলভাবে সংরক্ষিত হয়েছে!' : 'Settings updated and saved successfully!'}</span>
        </div>
      )}

      {validationError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Tab 1: Overview & Identity */}
      {activeTab === 'overview' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Identity, Pseudonym & Bio</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize how other participants see you in public rooms, dating profiles, and private messaging.
            </p>
          </div>

          <form onSubmit={handleSaveIdentity} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Chat Nickname
                </label>
                <input
                  type="text"
                  required
                  value={nicknameInput}
                  onChange={(e) => setNicknameInput(e.target.value)}
                  placeholder="e.g. Dhaka_Explorer"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 font-semibold"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Letters, numbers, and underscores only. Max 24 chars.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Preferred Avatar
                </label>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950/60 flex items-center justify-center text-xl font-bold">
                    {user.avatar || '⚡'}
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setAvatarModalOpen(true)}>
                    Change Avatar
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Bio / About Me
              </label>
              <textarea
                rows={3}
                value={bioInput}
                onChange={(e) => setBioInput(e.target.value)}
                placeholder="Share your interests, hobbies, and conversation style..."
                maxLength={250}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500"
              />
              <div className="text-right text-[11px] text-slate-500">{bioInput.length} / 250</div>
            </div>

            {/* Interests Chips */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                Interests & Matching Tags (Up to 6)
              </label>
              <div className="flex flex-wrap gap-2">
                {INTERESTS_OPTIONS.map((interest) => {
                  const selected = selectedInterests.includes(interest);
                  return (
                    <button
                      type="button"
                      key={interest}
                      onClick={() => toggleInterest(interest)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                        selected
                          ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 text-rose-700 dark:text-rose-300 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      {interest}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" size="md" className="font-bold">
                <Save className="w-4 h-4 mr-1.5" />
                <span>Save Profile Changes</span>
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 2: Privacy & Visibility */}
      {activeTab === 'privacy' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Privacy, Visibility & Direct Messages</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Control your presence visibility in room participant lists and who can initiate private DMs with you.
            </p>
          </div>

          <form onSubmit={handleSavePrivacy} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Online Visibility
                </label>
                <select
                  value={onlineVisibility}
                  onChange={(e: any) => setOnlineVisibility(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 font-semibold"
                >
                  <option value="online">Online (Visible in rooms & matchmaking)</option>
                  <option value="away">Away (Idle status indicator)</option>
                  <option value="stealth_invisible">Stealth / Invisible (Hide from public rosters)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Private Direct Messages Policy
                </label>
                <select
                  value={dmPolicy}
                  onChange={(e: any) => setDmPolicy(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 font-semibold"
                >
                  <option value="everyone">Allow DMs from Everyone</option>
                  <option value="connections_only">Accepted Connections Only</option>
                  <option value="nobody">Disable All Incoming DMs</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowDiscoverability}
                  onChange={(e) => setAllowDiscoverability(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white block">
                    Allow Discoverability in Roulette & Dating Search
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    When enabled, other users can match with you in random roulette based on language and interest tags.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={safeFilter}
                  onChange={(e) => setSafeFilter(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white block">
                    Active Content Filter
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Automatically masks offensive words, profanity, and unwanted commercial spam.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sounds}
                  onChange={(e) => setSounds(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white block">
                    Audio Notifications & Call Chimes
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Plays sound alerts when receiving new private messages or WebRTC video calls.
                  </span>
                </div>
              </label>
            </div>

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" size="md" className="font-bold">
                <Save className="w-4 h-4 mr-1.5" />
                <span>Save Privacy Settings</span>
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: Blocked Users */}
      {activeTab === 'blocked' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Blocked Participants</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Blocked users cannot send you private direct messages, view your presence, or match with you in roulette.
            </p>
          </div>

          <form onSubmit={handleAddBlock} className="flex gap-2 max-w-md">
            <input
              type="text"
              value={newBlockUsername}
              onChange={(e) => setNewBlockUsername(e.target.value)}
              placeholder="Username to block..."
              className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 font-semibold"
            />
            <Button type="submit" variant="secondary" size="sm">
              <UserX className="w-3.5 h-3.5 mr-1 text-rose-500" />
              <span>Block</span>
            </Button>
          </form>

          {blockActionMsg && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">{blockActionMsg}</div>
          )}

          {blockedUsers.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <UserX className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <div className="text-xs font-semibold text-slate-500">Your block list is currently empty.</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {blockedUsers.map((b) => (
                <div key={b.targetId} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-sm">
                      {b.targetAvatar || '👤'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{b.targetNickname}</div>
                      <div className="text-[10px] text-slate-400">Blocked on {new Date(b.blockedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleUnblock(b.targetId)}>
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Connections */}
      {activeTab === 'connections' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Friend & Peer Connections</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Mutually accepted connections can always initiate direct messages and view when you are online.
            </p>
          </div>

          {connections.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <div className="text-xs font-semibold text-slate-500">No connections yet. Meet people in public chat rooms!</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {connections.map((c) => {
                const partnerName = c.requesterId === user.id ? c.recipientNickname : c.requesterNickname;
                const partnerAvatar = c.requesterId === user.id ? c.recipientAvatar : c.requesterAvatar;
                const partnerId = c.requesterId === user.id ? c.recipientId : c.requesterId;
                return (
                  <div key={c.id} className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 flex items-center justify-center font-bold text-sm">
                        {partnerAvatar || '👤'}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">{partnerName}</div>
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Connected</div>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate('/messages', { partnerId })}
                    >
                      <MessageSquare className="w-3.5 h-3.5 mr-1" />
                      Chat
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Data Governance & GDPR */}
      {activeTab === 'data' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Data Privacy, Export & Account Deletion</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Under GDPR, CCPA, and ChatLustora privacy policy, you maintain complete ownership of your data.
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">Export Personal Data (JSON)</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Download a machine-readable archive containing your account metadata, age declaration, and settings.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleExportData} disabled={exporting}>
                <Download className="w-3.5 h-3.5 mr-1.5 text-orange-500" />
                <span>{exporting ? 'Exporting...' : 'Download Archive'}</span>
              </Button>
            </div>

            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xs font-bold text-rose-900 dark:text-rose-300">Permanent Account Deletion</h3>
                <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-0.5">
                  Permanently purge your account, reserved pseudonym, connection records, and settings from our servers.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteModalOpen(true)}
                className="text-rose-600 border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-950"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                <span>Delete Account</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Change Avatar Modal */}
      {avatarModalOpen && (
        <Modal
          isOpen={avatarModalOpen}
          onClose={() => setAvatarModalOpen(false)}
          title="Choose Your Avatar"
          subtitle="Select an avatar icon for your profile and messages"
        >
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 py-4">
            {GUEST_AVATARS.map((av) => (
              <button
                type="button"
                key={av}
                onClick={() => {
                  setAvatar(av);
                  setAvatarModalOpen(false);
                }}
                className={`w-14 h-14 rounded-2xl text-2xl flex items-center justify-center transition-all cursor-pointer ${
                  user.avatar === av
                    ? 'bg-rose-100 dark:bg-rose-950 border-2 border-rose-500 scale-105 shadow-md'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {av}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <Modal
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          title="Confirm Permanent Deletion"
          subtitle="This action is irreversible."
        >
          <div className="space-y-4 py-2">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete your account and all associated data? This will immediately purge your registered nickname, preferences, and connections.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
              >
                {deleting ? 'Deleting...' : 'Yes, Delete My Account'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
