import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth, GUEST_AVATARS } from '../context/AuthContext';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { BlockedUserEntry, UserConnection } from '../types';
import {
  User,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Bell,
  Sliders,
  LogOut,
  Save,
  CheckCircle,
  Clock,
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
} from 'lucide-react';

const INTERESTS_OPTIONS = [
  'Tech & AI',
  'Cricket & Football',
  'Music & Bands',
  'Bengali Literature',
  'Movies & Shows',
  'Travel & Food',
  'Gaming & Esports',
  'Freelance & Remote',
  'Photography',
  'Startups',
];

export const ProfileSettingsPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const { user, is18Verified, setNickname, setAvatar, updatePreferences, logout, deleteAccount } = useAuth();

  const [activeTab, setActiveTab] = useState<'profile' | 'privacy' | 'blocked' | 'connections'>('profile');

  // Form states
  const [nicknameInput, setNicknameInput] = useState(user.nickname);
  const [bioInput, setBioInput] = useState(user.bio || '');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(user.interests || ['Tech & AI', 'Music & Bands']);
  const [onlineVisibility, setOnlineVisibility] = useState<'online' | 'away' | 'stealth_invisible'>(user.onlineVisibility || 'online');
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
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function loadBlockedAndConnections() {
      const blocks = await safetyService.getBlockedUsers(user.id);
      setBlockedUsers(blocks);

      const conns = await safetyService.getConnections(user.id);
      setConnections(conns);
    }
    loadBlockedAndConnections();
  }, [user.id]);

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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateNickname(nicknameInput)) {
      return;
    }

    setNickname(nicknameInput.trim());
    updatePreferences({
      bio: bioInput.trim(),
      interests: selectedInterests,
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
      link.download = `voxanex_privacy_export_${user.nickname.toLowerCase()}_${Date.now()}.json`;
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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400 tracking-wider uppercase mb-1">
            <Settings className="w-4 h-4" />
            <span>Profile & Privacy Governance</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {language === 'bn' ? 'ব্যবহারকারী প্রোফাইল ও সেটিংস' : 'Profile, Privacy & Safety Settings'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            {language === 'bn'
              ? 'আপনার ছদ্মনাম, উপস্থিতি, ব্লক তালিকা ও গোপনীয়তা নিয়ন্ত্রণ করুন।'
              : 'Configure your pseudonym, interests, presence visibility, blocked list, and personal data.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={handleExportData} disabled={exporting}>
            <Download className="w-4 h-4 mr-1.5 text-cyan-400" />
            <span>{exporting ? 'Exporting...' : 'Export Data (JSON)'}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="text-rose-400 hover:border-rose-800"
          >
            <LogOut className="w-4 h-4 mr-1.5" />
            <span>{language === 'bn' ? 'লগআউট' : 'Reset Session'}</span>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-[#0c1222] p-1 border border-slate-800 gap-1 overflow-x-auto">
        {[
          { id: 'profile', label: 'Identity & Interests', icon: User },
          { id: 'privacy', label: 'Privacy & Visibility', icon: Eye },
          { id: 'blocked', label: `Blocked Users (${blockedUsers.length})`, icon: UserX },
          { id: 'connections', label: `Connections (${connections.length})`, icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{language === 'bn' ? 'সেটিংস সফলভাবে সংরক্ষিত হয়েছে!' : 'Settings updated successfully!'}</span>
        </div>
      )}

      {validationError && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* TAB 1: Profile & Interests */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Identity Badge */}
          <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1322] space-y-6">
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 p-1 mx-auto shadow-xl">
                <div className="w-full h-full bg-[#0a0f1d] rounded-[14px] flex items-center justify-center text-3xl select-none">
                  {user.avatar}
                </div>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{user.nickname}</h2>
                <div className="text-xs text-slate-400 font-mono mt-0.5">
                  {user.isGuest ? 'Temporary Guest Handle' : 'Registered Member'}
                </div>
              </div>
            </div>

            {/* Change Avatar */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 text-center">
                Choose Avatar
              </label>
              <div className="grid grid-cols-4 gap-2">
                {GUEST_AVATARS.map((av) => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => setAvatar(av)}
                    className={`h-9 rounded-lg flex items-center justify-center text-base border transition-all ${
                      user.avatar === av
                        ? 'border-cyan-400 bg-cyan-950/40 text-cyan-300'
                        : 'border-slate-800 bg-[#101729] hover:bg-slate-800'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* 18+ Status in Profile */}
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">Adult (18+) Gate:</span>
                {is18Verified ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-mono">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Verified</span>
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1 font-mono">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Unverified</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => navigate('/age-gate')}
                className="text-[11px] text-cyan-400 hover:underline block text-left"
              >
                {is18Verified ? 'Review or Revoke 18+ Access' : 'Verify Adult Access'}
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="md:col-span-2 space-y-6">
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1322] space-y-5">
              <h3 className="text-sm font-bold text-white tracking-tight pb-3 border-b border-slate-800 flex items-center gap-2">
                <User className="w-4 h-4 text-violet-400" />
                <span>Pseudonym & Bio</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Unique Username
                  </label>
                  <input
                    type="text"
                    value={nicknameInput}
                    onChange={(e) => {
                      setNicknameInput(e.target.value);
                      validateNickname(e.target.value);
                    }}
                    maxLength={24}
                    placeholder="letters_numbers_only"
                    className="w-full bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">3-24 characters, alphanumeric and underscores</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Interface Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as any)}
                    className="w-full bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="en">English (Global)</option>
                    <option value="bn">বাংলা (Bengali)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Bio / Status (Optional)
                  </label>
                  <span className="text-[10px] text-slate-500">{bioInput.length}/250</span>
                </div>
                <textarea
                  rows={2}
                  maxLength={250}
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  placeholder="e.g. Dhaka explorer · Music listener & tech enthusiast"
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Optional Interests Chips */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Optional Interests (Select up to 6 for partner matching)
                </label>
                <div className="flex flex-wrap gap-2">
                  {INTERESTS_OPTIONS.map((item) => {
                    const isSelected = selectedInterests.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleInterest(item)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-violet-600/30 border-violet-500 text-violet-200'
                            : 'bg-[#101729] border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end">
                <Button type="submit" variant="primary" size="md">
                  <Save className="w-4 h-4 mr-1.5" />
                  <span>Save Profile Changes</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: Privacy & Visibility Controls */}
      {activeTab === 'privacy' && (
        <form onSubmit={handleSave} className="max-w-3xl space-y-6">
          <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1322] space-y-5">
            <h3 className="text-sm font-bold text-white tracking-tight pb-3 border-b border-slate-800 flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-400" />
              <span>Presence & Discoverability</span>
            </h3>

            <div className="space-y-4">
              {/* Online Visibility Mode */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Online Status Visibility
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'online', label: 'Visible (Online)', desc: 'Broadcasts active status to room members.' },
                    { id: 'away', label: 'Away / Idle', desc: 'Shows as idle in participant lists.' },
                    { id: 'stealth_invisible', label: 'Stealth / Invisible', desc: 'Hides presence completely while browsing.' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setOnlineVisibility(mode.id as any)}
                      className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                        onlineVisibility === mode.id
                          ? 'border-cyan-500 bg-cyan-950/30 text-white'
                          : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">{mode.label}</div>
                      <div className="text-[11px] text-slate-400 leading-tight">{mode.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Direct Messages Policy */}
              <div className="pt-3 border-t border-slate-800">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Who Can Send You Direct Messages
                </label>
                <select
                  value={dmPolicy}
                  onChange={(e) => setDmPolicy(e.target.value as any)}
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="everyone">Everyone (Open communication)</option>
                  <option value="connections_only">Connections / Friends Only</option>
                  <option value="nobody">Nobody (Private mode)</option>
                </select>
              </div>

              {/* Matching Discoverability Toggle */}
              <div className="pt-3 border-t border-slate-800">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-white">Random Matching Discoverability</div>
                    <div className="text-[11px] text-slate-400">
                      Allow other users in matching queue to find and connect with you
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowDiscoverability}
                    onChange={(e) => setAllowDiscoverability(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500"
                  />
                </label>
              </div>

              {/* Content Safety Filter */}
              <div className="pt-3 border-t border-slate-800">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-white">Automated Hate Speech & Abuse Filter</div>
                    <div className="text-[11px] text-slate-400">
                      Masks known insults, threats, and spam links before display
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={safeFilter}
                    onChange={(e) => setSafeFilter(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500"
                  />
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(true)}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Account & Purge Data</span>
              </button>

              <Button type="submit" variant="primary" size="md">
                <Save className="w-4 h-4 mr-1.5" />
                <span>Save Privacy Settings</span>
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 3: Blocked Users Manager */}
      {activeTab === 'blocked' && (
        <div className="max-w-3xl space-y-6">
          <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1322] space-y-5">
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-400" />
                <span>Blocked Accounts & Silenced Peers</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Blocked users cannot send you direct messages, match with you in roulette, or initiate WebRTC calls.
              </p>
            </div>

            {blockActionMsg && (
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-xs text-emerald-300">
                {blockActionMsg}
              </div>
            )}

            {/* Manual block input */}
            <form onSubmit={handleAddBlock} className="flex gap-2">
              <input
                type="text"
                value={newBlockUsername}
                onChange={(e) => setNewBlockUsername(e.target.value)}
                placeholder="Enter username to block..."
                className="flex-1 bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
              <Button type="submit" variant="danger" size="sm">
                Block User
              </Button>
            </form>

            {/* List */}
            <div className="space-y-2 pt-2">
              {blockedUsers.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-[#090e18] border border-slate-800/80 text-xs text-slate-500">
                  No blocked users. You can block peers from chat, calls, or this manager.
                </div>
              ) : (
                blockedUsers.map((item) => (
                  <div
                    key={item.targetId}
                    className="p-3.5 rounded-xl border border-slate-800 bg-[#101729] flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-sm">
                        {item.targetAvatar || '👤'}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{item.targetNickname}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Blocked on {new Date(item.blockedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnblock(item.targetId)}
                      className="text-slate-300 hover:text-white"
                    >
                      Unblock
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Connections & Friends */}
      {activeTab === 'connections' && (
        <div className="max-w-3xl space-y-6">
          <div className="p-6 rounded-2xl border border-slate-800 bg-[#0d1322] space-y-5">
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" />
                <span>Connected Friends</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Friends who you have connected with for direct calling and messaging privileges.
              </p>
            </div>

            <div className="space-y-2">
              {connections.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-[#090e18] border border-slate-800/80 text-xs text-slate-500">
                  No accepted friend connections yet. Connect with partners during random matches or direct chats!
                </div>
              ) : (
                connections.map((c) => {
                  const partnerName = c.requesterId === user.id ? c.recipientNickname : c.requesterNickname;
                  const partnerAvatar = c.requesterId === user.id ? c.recipientAvatar : c.requesterAvatar;
                  return (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-xl border border-slate-800 bg-[#101729] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-violet-950/60 border border-violet-800/40 flex items-center justify-center text-sm">
                          {partnerAvatar || '👤'}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{partnerName}</div>
                          <div className="text-[10px] text-emerald-400 font-mono">Connected Peer</div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate('/messages')}
                      >
                        Send Message
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Account Deletion Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-[#0d1322] border border-rose-900/60 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2 text-rose-400">
              <Trash2 className="w-5 h-5" />
              <span>Confirm Permanent Account Deletion</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              In compliance with data privacy standards, this action purges your profile, guest credentials, connection records, and moderation histories permanently.
            </p>
            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-[11px] text-rose-300">
              Notice: This action is immediate and non-reversible.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleteModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Purging Data...' : 'Confirm Account Purge'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
