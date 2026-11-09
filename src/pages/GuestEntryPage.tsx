import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth, GUEST_AVATARS, getRandomGuestNickname } from '../context/AuthContext';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AppLanguage, Room, UserGender } from '../types';
import { User, Shuffle, ArrowRight, Check, Lock, Mail, ShieldAlert, AlertTriangle, Sparkles, CheckCircle2 } from 'lucide-react';
import { SEOHead } from '../components/common/SEOHead';

export const GuestEntryPage: React.FC = () => {
  const { navigate, params, currentRoute } = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const { user, loginGuest, setAvatar, loginWithAccount, registerWithAccount, requestPasswordReset, isSupabaseActive, verify18 } = useAuth();

  // Determine target room from params
  const targetRoomSlug = params.targetRoom || params.roomId;
  const targetRoom: Room | undefined = ROOMS_CONFIG.find((r) => r.slug === targetRoomSlug);

  // Mode tabs: 'guest' | 'login' | 'register'
  const initialTab = (params.mode as any) || (currentRoute === '/register' ? 'register' : currentRoute === '/auth' ? 'login' : 'guest');
  const [activeTab, setActiveTab] = useState<'guest' | 'login' | 'register'>(initialTab);

  // Guest form state
  const [nickname, setNicknameState] = useState(user.nickname);
  const [selectedAvatar, setSelectedAvatar] = useState(user.avatar || GUEST_AVATARS[0]);
  const [gender, setGender] = useState<string>('prefer_not_to_say');
  const [age, setAge] = useState<string>('21');
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [safetyPledge, setSafetyPledge] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);

  // Account login/register state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountNickname, setAccountNickname] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleRandomize = () => {
    setNicknameState(getRandomGuestNickname());
  };

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNick = nickname.trim();
    const parsedAge = parseInt(age, 10);

    if (!cleanNick) {
      setGuestError(language === 'bn' ? 'অনুগ্রহ করে একটি নিকনেম লিখুন।' : 'Please enter a valid nickname.');
      return;
    }
    if (cleanNick.length < 3 || cleanNick.length > 24) {
      setGuestError(language === 'bn' ? 'নিকনেম ৩ থেকে ২৪ অক্ষরের মধ্যে হতে হবে।' : 'Nickname must be between 3 and 24 characters.');
      return;
    }
    if (isNaN(parsedAge) || parsedAge < 13 || parsedAge > 120) {
      setGuestError(language === 'bn' ? 'অনুগ্রহ করে একটি বৈধ বয়স প্রদান করুন।' : 'Please provide a valid age.');
      return;
    }

    // Strict 18+ enforcement across ChatLustora adult community
    if (parsedAge < 18) {
      setGuestError(
        language === 'bn'
          ? 'চ্যাটলাস্টোরা (ChatLustora) শুধুমাত্র ১৮+ প্রাপ্তবয়স্কদের জন্য। আপনার ঘোষিত বয়স ১৮ বছরের কম হওয়ায় প্রবেশাধিকার সম্পূর্ণরূপে নিষিদ্ধ।'
          : 'ChatLustora is strictly an adult community for users aged 18 and older. Minors are strictly prohibited from entering.'
      );
      return;
    }

    if (!adultConfirmed) {
      setGuestError(
        language === 'bn'
          ? 'চ্যাটলাস্টোরায় প্রবেশের পূর্বে আপনার বয়স ১৮ বা তার বেশি নিশ্চিত করে ঘোষণা দিন।'
          : 'You must confirm you are 18 years of age or older to enter ChatLustora.'
      );
      return;
    }

    if (!safetyPledge) {
      setGuestError(language === 'bn' ? 'আপনাকে কমিউনিটি আচরণবিধি মেনে চলতে হবে।' : 'Please accept the safety pledge.');
      return;
    }

    // Perform guest login with verified age & gender
    const loginRes = await loginGuest(cleanNick, language, gender);
    if (loginRes && !loginRes.success) {
      setGuestError(loginRes.error || (language === 'bn' ? 'অতিথি সেশন তৈরি করতে ব্যর্থ হয়েছে।' : 'Failed to create guest session on server.'));
      return;
    }
    setAvatar(selectedAvatar);

    if (targetRoom?.is18Plus || adultConfirmed) {
      verify18();
    }

    // Navigate to target room or room directory
    if (targetRoom) {
      navigate('/chat', { roomId: targetRoom.slug });
    } else {
      navigate('/rooms');
    }
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError(null);

    if (!email || !password) {
      setAccountError(language === 'bn' ? 'ইমেইল ও পাসওয়ার্ড দিন।' : 'Please provide email and password.');
      return;
    }

    if (activeTab === 'register') {
      if (!accountNickname.trim()) {
        setAccountError(language === 'bn' ? 'নিকনেম আবশ্যক।' : 'Permanent nickname is required.');
        return;
      }
      
      const parsedAge = parseInt(age, 10);
      if (isNaN(parsedAge) || parsedAge < 18) {
        setAccountError(language === 'bn' ? 'রেজিস্ট্রেশনের জন্য আপনার বয়স কমপক্ষে ১৮ হতে হবে।' : 'You must be at least 18 years old to register.');
        return;
      }

      if (!adultConfirmed) {
        setAccountError(
          language === 'bn'
            ? 'চ্যাটলাস্টোরায় প্রবেশের পূর্বে আপনার বয়স ১৮ বা তার বেশি নিশ্চিত করে ঘোষণা দিন।'
            : 'You must confirm you are 18 years of age or older to enter ChatLustora.'
        );
        return;
      }

      if (!safetyPledge) {
        setAccountError(language === 'bn' ? 'আপনাকে কমিউনিটি আচরণবিধি মেনে চলতে হবে।' : 'Please accept the safety pledge.');
        return;
      }
    }

    setLoading(true);
    try {
      if (activeTab === 'register') {
        const res = await registerWithAccount(email, password, accountNickname.trim(), gender);
        if (!res.success) {
          setAccountError(res.error || 'Registration failed');
          setLoading(false);
          return;
        }
      } else {
        const res = await loginWithAccount(email, password);
        if (!res.success) {
          setAccountError(res.error || 'Authentication failed');
          setLoading(false);
          return;
        }
      }

      if (targetRoom?.is18Plus || adultConfirmed) {
        verify18();
      }

      setLoading(false);
      if (targetRoom) {
        navigate('/chat', { roomId: targetRoom.slug });
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setLoading(false);
      setAccountError(err.message || 'Authentication error occurred.');
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;

    setResetError(null);
    const res = await requestPasswordReset(resetEmail.trim());
    if (res.success) {
      setResetSuccess(true);
      setTimeout(() => {
        setResetSuccess(false);
        setResetModalOpen(false);
        setResetEmail('');
      }, 2500);
    } else {
      setResetError(res.error || 'Failed to send recovery email');
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
      <div className="p-6 sm:p-8 rounded-2xl border border-slate-800 bg-[#0d1322] shadow-2xl space-y-6">
        
        {/* Target Room Destination Banner if joining a specific room */}
        {targetRoom && (
          <div className="p-3.5 rounded-xl bg-orange-950/30 border border-orange-800/50 flex items-center justify-between text-xs text-orange-200">
            <div className="flex items-center gap-2">
              <span className="text-base select-none">💬</span>
              <div>
                <span className="font-bold text-white block">
                  {language === 'bn' ? `রুম: ${targetRoom.name.bn}` : `Joining: ${targetRoom.name.en}`}
                </span>
                <span className="text-[11px] text-orange-300">
                  {targetRoom.is18Plus ? '18+ Adult Gated Lounge' : 'General Community Lounge'}
                </span>
              </div>
            </div>
            {targetRoom.is18Plus && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300">
                18+ Only
              </span>
            )}
          </div>
        )}

        {/* SEO & Header */}
        <SEOHead
          title={
            activeTab === 'register' ? (language === 'bn' ? 'অ্যাকাউন্ট তৈরি করুন – ChatLustora' : 'Create Account – ChatLustora') :
            activeTab === 'login' ? (language === 'bn' ? 'সাইন ইন – ChatLustora' : 'Sign In – ChatLustora') :
            (language === 'bn' ? 'প্রবেশ ও ১৮+ নিশ্চিতকরণ – ChatLustora' : 'Entry & 18+ Age Gate – ChatLustora')
          }
          description="Enter ChatLustora Bangla & Desi adult chatrooms with instant guest access or user account."
          canonicalPath={activeTab === 'register' ? '/register' : activeTab === 'login' ? '/auth' : '/guest-entry'}
          noindex={true}
        />
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-rose-950/60 border border-rose-800/40 flex items-center justify-center text-rose-400 mx-auto">
            <User className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {language === 'bn' ? 'চ্যাটলাস্টোরায় স্বাগতম' : 'Welcome to ChatLustora'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
            {language === 'bn'
              ? 'চ্যাটরুমে যোগ দিতে ১৮+ গেস্ট হিসেবে প্রবেশ করুন অথবা আপনার অ্যাকাউন্টে সাইন ইন করুন।'
              : 'Choose 18+ guest access for instant privacy or sign in with your registered account.'}
          </p>
        </div>

        {/* 3 Entry Choice Tabs */}
        <div className="flex p-1 bg-[#101728] rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('guest')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'guest'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'bn' ? 'গেস্ট প্রবেশ' : 'Continue as Guest'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('login')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'login'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'bn' ? 'সাইন ইন' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'register'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'bn' ? 'রেজিস্ট্রেশন' : 'Create Account'}
          </button>
        </div>

        {/* TAB 1: GUEST ACCESS */}
        {activeTab === 'guest' && (
          <form onSubmit={handleGuestSubmit} className="space-y-5">
            {/* Avatar Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                {language === 'bn' ? 'গেস্ট অবতার নির্বাচন করুন' : 'Select Guest Icon'}
              </label>
              <div className="flex flex-wrap gap-2 justify-center p-3 rounded-xl bg-[#101728] border border-slate-800">
                {GUEST_AVATARS.map((av) => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => setSelectedAvatar(av)}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-transform cursor-pointer ${
                      selectedAvatar === av
                        ? 'bg-violet-600/40 border border-violet-400 scale-110 shadow-sm'
                        : 'bg-slate-900/60 border border-slate-800 hover:bg-slate-800/60'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* Nickname Input & Randomize */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                {language === 'bn' ? 'নিকনেম (নাম)' : 'Nickname'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => {
                    setNicknameState(e.target.value);
                    setGuestError(null);
                  }}
                  maxLength={24}
                  placeholder="e.g. Dhaka_Rider"
                  className="flex-1 bg-[#101728] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleRandomize}
                  className="shrink-0"
                  title="Randomize nickname"
                >
                  <Shuffle className="w-4 h-4 mr-1 text-cyan-400" />
                  <span>Random</span>
                </Button>
              </div>
            </div>

            {/* Gender Selector */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  {language === 'bn' ? 'লিঙ্গ' : 'Gender'}
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other / Non-binary</option>
                  <option value="couple">Couple</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>

              {/* Age Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  {language === 'bn' ? 'বয়স' : 'Age (Years)'}
                </label>
                <input
                  type="number"
                  required
                  min={13}
                  max={110}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            {/* Adult Confirmation Checkbox (Always required for ChatLustora 18+ adult community) */}
            <div className="p-3.5 rounded-xl border border-rose-950 bg-rose-950/20 space-y-2">
              <div className="flex items-center gap-1.5 text-rose-300 text-xs font-semibold">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>18+ Age Eligibility Requirement</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Self-reported age is required. You must be 18 or older to join ChatLustora adult community and chatrooms. Minors are strictly prohibited.
              </p>
              <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={adultConfirmed}
                  onChange={(e) => {
                    setAdultConfirmed(e.target.checked);
                    setGuestError(null);
                  }}
                  className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500"
                />
                <span className="text-xs text-slate-200">
                  I confirm under penalty of platform ban that I am 18 years of age or older.
                </span>
              </label>
            </div>

            {/* Safety Pledge */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#101728]/80 space-y-1.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={safetyPledge}
                  onChange={(e) => setSafetyPledge(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-xs text-slate-300 leading-relaxed">
                  I agree to community safety guidelines, respectful conduct, and zero harassment rules.
                </span>
              </label>
            </div>

            {guestError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-xs text-rose-300">
                {guestError}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth>
              <span>{targetRoom ? `Join ${targetRoom.name.en}` : 'Enter Chat Lounge'}</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>
        )}

        {/* TAB 2 & 3: SIGN IN / REGISTER ACCOUNT */}
        {(activeTab === 'login' || activeTab === 'register') && (
          <form onSubmit={handleAccountSubmit} className="space-y-4">
            {activeTab === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Permanent Nickname
                  </label>
                  <input
                    type="text"
                    required
                    value={accountNickname}
                    onChange={(e) => setAccountNickname(e.target.value)}
                    placeholder="e.g. Dhaka_Citizen"
                    className="w-full bg-[#101728] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                {/* Gender and Age for Registration */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      {language === 'bn' ? 'লিঙ্গ' : 'Gender'}
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full bg-[#101728] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other / Non-binary</option>
                      <option value="couple">Couple</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      {language === 'bn' ? 'বয়স' : 'Age (Years)'}
                    </label>
                    <input
                      type="number"
                      required
                      min={18}
                      max={110}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className="w-full bg-[#101728] border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Email Address
                </label>
                {activeTab === 'login' && (
                  <button
                    type="button"
                    onClick={() => setResetModalOpen(true)}
                    className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            {/* Adult Confirmation Checkbox (Always required for ChatLustora 18+ adult community / Registration) */}
            {(activeTab === 'register' || targetRoom?.is18Plus) && (
              <div className="p-3.5 rounded-xl border border-rose-950 bg-rose-950/20 space-y-2">
                <div className="flex items-center gap-1.5 text-rose-300 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>18+ Age Eligibility Requirement</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Self-reported age is required. You must be 18 or older to join ChatLustora adult community and chatrooms. Minors are strictly prohibited.
                </p>
                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={adultConfirmed}
                    onChange={(e) => {
                      setAdultConfirmed(e.target.checked);
                      setAccountError(null);
                    }}
                    className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-xs text-slate-200">
                    I confirm under penalty of platform ban that I am 18 years of age or older.
                  </span>
                </label>
              </div>
            )}

            {/* Safety Pledge for Registration */}
            {activeTab === 'register' && (
              <div className="p-3.5 rounded-xl border border-slate-800 bg-[#101728]/80 space-y-1.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={safetyPledge}
                    onChange={(e) => {
                      setSafetyPledge(e.target.checked);
                      setAccountError(null);
                    }}
                    className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-xs text-slate-300 leading-relaxed">
                    I agree to community safety guidelines, respectful conduct, and zero harassment rules.
                  </span>
                </label>
              </div>
            )}

            {accountError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-xs text-rose-300">
                {accountError}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
              <span>{loading ? 'Processing...' : activeTab === 'login' ? 'Sign In' : 'Create Account'}</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>
        )}

      </div>

      {/* Password Reset Modal */}
      {resetModalOpen && (
        <Modal
          isOpen={resetModalOpen}
          onClose={() => setResetModalOpen(false)}
          title="Password Recovery"
          subtitle="Send password reset link via Supabase Auth"
        >
          {resetSuccess ? (
            <div className="p-6 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h3 className="font-bold text-white text-sm">Recovery Link Dispatched</h3>
              <p className="text-xs text-slate-400">
                If an account exists for {resetEmail}, instructions have been sent.
              </p>
            </div>
          ) : (
            <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
              <p className="text-xs text-slate-300">
                Enter your registered account email to receive a secure recovery link.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {resetError && <div className="text-xs text-rose-400">{resetError}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setResetModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Send Recovery Link
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
