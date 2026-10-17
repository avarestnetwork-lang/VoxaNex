import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Lock, Mail, User, ArrowRight, ShieldCheck, Github, Globe, KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';

export const AuthPage: React.FC = () => {
  const { navigate, params } = useRouter();
  const { language, t } = useLanguage();
  const { loginWithAccount, registerWithAccount, requestPasswordReset, isSupabaseActive, verify18 } = useAuth();

  const targetRoomSlug = params.targetRoom || params.roomId;
  const isTargetAdult = targetRoomSlug && (targetRoomSlug.includes('adult') || targetRoomSlug.includes('sex') || targetRoomSlug.includes('mature') || targetRoomSlug.includes('video') || targetRoomSlug.includes('roulette') || targetRoomSlug.includes('bdsm'));

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [selfReportedAge, setSelfReportedAge] = useState<string>('21');
  const [adultConfirmed, setAdultConfirmed] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email || !password) {
      setErrorMsg(language === 'bn' ? 'অনুগ্রহ করে ইমেইল ও পাসওয়ার্ড প্রদান করুন।' : 'Please fill in all required fields.');
      return;
    }

    if (mode === 'register' && !nickname.trim()) {
      setErrorMsg(language === 'bn' ? 'অনুগ্রহ করে একটি নিকনেম লিখুন।' : 'Please choose a permanent nickname.');
      return;
    }

    if (isTargetAdult && mode === 'register') {
      const ageNum = parseInt(selfReportedAge, 10);
      if (isNaN(ageNum) || ageNum < 18) {
        setErrorMsg('Self-reported age is required. You must be 18 or older to join adult chatrooms. Minors are strictly prohibited.');
        return;
      }
      if (!adultConfirmed) {
        setErrorMsg('You must confirm under penalty of platform ban that you are 18 years of age or older.');
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'register') {
        const res = await registerWithAccount(email, password, nickname.trim());
        if (!res.success) {
          setErrorMsg(res.error || 'Registration failed');
          setLoading(false);
          return;
        }
      } else {
        const res = await loginWithAccount(email, password);
        if (!res.success) {
          setErrorMsg(res.error || 'Authentication failed');
          setLoading(false);
          return;
        }
      }

      if (isTargetAdult || adultConfirmed) {
        verify18();
      }

      setLoading(false);
      if (targetRoomSlug) {
        navigate('/chat', { roomId: targetRoomSlug });
      } else {
        navigate('/profile');
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMsg(err.message || 'An unexpected authentication error occurred.');
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
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="p-6 sm:p-8 rounded-2xl border border-slate-800 bg-[#0d1322] shadow-2xl space-y-6">
        {/* Top brand icon */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-violet-950/60 border border-violet-800/40 flex items-center justify-center text-violet-400 mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {mode === 'login'
              ? (language === 'bn' ? 'ভক্সানেক্সে সাইন ইন করুন' : 'Sign in to VoxaNex')
              : (language === 'bn' ? 'স্থায়ী অ্যাকাউন্ট তৈরি করুন' : 'Create Free Account')}
          </h1>
          <p className="text-xs text-slate-400">
            {mode === 'login'
              ? (language === 'bn' ? 'আপনার সংরক্ষিত পরিচয় ও ব্যাজ ব্যবহার করুন' : 'Access your persistent identity, badges, and settings')
              : (language === 'bn' ? 'একটি স্থায়ী হ্যান্ডেল নিবন্ধন করুন' : 'Register a permanent handle for regular community access')}
          </p>

          <div className="pt-1 flex items-center justify-center gap-1.5 text-[11px] font-mono text-cyan-400">
            <span className={`w-2 h-2 rounded-full ${isSupabaseActive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{isSupabaseActive ? 'Supabase Auth Online' : 'Supabase Client Staged (Phase 2)'}</span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex p-1 bg-[#101729] rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              mode === 'login' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'bn' ? 'সাইন ইন' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              mode === 'register' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'bn' ? 'রেজিস্ট্রেশন' : 'Register'}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Permanent Nickname
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Dhaka_Explorer"
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Password
              </label>
              {mode === 'login' && (
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
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {isTargetAdult && (
            <div className="p-3.5 rounded-xl border border-rose-950 bg-rose-950/20 space-y-2.5">
              <div className="flex items-center justify-between text-rose-300 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>18+ Age Eligibility Requirement</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900/40 border border-rose-800 text-rose-300 font-mono">
                  18+ Verified
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Self-reported age is required. You must be 18 or older to join adult chatrooms. Minors are strictly prohibited.
              </p>

              {mode === 'register' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Self-Reported Age (Years)
                  </label>
                  <input
                    type="number"
                    min={18}
                    max={120}
                    required
                    value={selfReportedAge}
                    onChange={(e) => setSelfReportedAge(e.target.value)}
                    className="w-full bg-[#101729] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
                    placeholder="18+"
                  />
                </div>
              )}

              <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={adultConfirmed}
                  onChange={(e) => setAdultConfirmed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500"
                />
                <span className="text-xs text-slate-200">
                  I confirm under penalty of platform ban that I am 18 years of age or older.
                </span>
              </label>
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-rose-400 font-medium p-2.5 rounded-lg bg-rose-950/30 border border-rose-900/50">
              {errorMsg}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
            <span>{loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Free Account'}</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>

          {/* Social login placeholders for Phase 2 */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <div className="text-center text-[10px] text-slate-500 uppercase tracking-wider">
              Supabase OAuth Providers
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled
                className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-500 text-xs flex items-center justify-center gap-1.5 opacity-60 cursor-not-allowed"
                title="Phase 2 Supabase Google OAuth"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Google</span>
              </button>
              <button
                type="button"
                disabled
                className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-500 text-xs flex items-center justify-center gap-1.5 opacity-60 cursor-not-allowed"
                title="Phase 2 Supabase GitHub OAuth"
              >
                <Github className="w-3.5 h-3.5" />
                <span>GitHub</span>
              </button>
            </div>
          </div>

          {/* Anonymous Guest Link */}
          <div className="pt-2 text-center text-xs text-slate-400">
            <span>{language === 'bn' ? 'অ্যাকাউন্ট ছাড়াই চ্যাট করতে চান? ' : 'Prefer no email? '}</span>
            <button
              type="button"
              onClick={() => navigate('/guest-entry')}
              className="text-cyan-400 hover:underline font-medium cursor-pointer"
            >
              {language === 'bn' ? 'গেস্ট হিসেবে প্রবেশ করুন' : 'Continue as Guest'}
            </button>
          </div>
        </form>
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
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
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
