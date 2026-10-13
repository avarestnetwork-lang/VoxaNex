import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth, GUEST_AVATARS, getRandomGuestNickname } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { AppLanguage } from '../types';
import { User, Shuffle, ShieldCheck, ArrowRight, Sparkles, Check } from 'lucide-react';

export const GuestEntryPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const { user, loginGuest, setAvatar } = useAuth();

  const [nickname, setNicknameState] = useState(user.nickname);
  const [selectedAvatar, setSelectedAvatar] = useState(user.avatar || GUEST_AVATARS[0]);
  const [selectedLang, setSelectedLang] = useState<AppLanguage>(language);
  const [pledgeAccepted, setPledgeAccepted] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRandomize = () => {
    const randomName = getRandomGuestNickname();
    setNicknameState(randomName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = nickname.trim();
    if (!clean) {
      setErrorMsg(language === 'bn' ? 'অনুগ্রহ করে একটি নিকনেম লিখুন।' : 'Please enter a nickname.');
      return;
    }
    if (clean.length < 3) {
      setErrorMsg(language === 'bn' ? 'নিকনেম কমপক্ষে ৩ অক্ষরের হতে হবে।' : 'Nickname must be at least 3 characters.');
      return;
    }
    if (!pledgeAccepted) {
      setErrorMsg(language === 'bn' ? 'আপনাকে সুরক্ষা প্রতিশ্রুতি গ্রহণ করতে হবে।' : 'Please accept the safety pledge.');
      return;
    }

    loginGuest(clean, selectedLang);
    setAvatar(selectedAvatar);
    setLanguage(selectedLang);
    navigate('/rooms');
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
      <div className="p-6 sm:p-8 rounded-2xl border border-slate-800 bg-[#0d1322] shadow-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-violet-950/60 border border-violet-800/40 flex items-center justify-center text-violet-400 mx-auto">
            <User className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {t.guest.title}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
            {t.guest.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
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
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
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
              {t.guest.nicknameLabel}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNicknameState(e.target.value);
                  setErrorMsg(null);
                }}
                maxLength={24}
                placeholder={t.guest.placeholder}
                className="flex-1 bg-[#101728] border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleRandomize}
                className="shrink-0"
                title="Generate another nickname"
              >
                <Shuffle className="w-4 h-4 mr-1 text-cyan-400" />
                <span>{t.guest.randomizeBtn}</span>
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {language === 'bn' ? 'সর্বোচ্চ ২৪ অক্ষর। কোনো ব্যক্তিগত তথ্য প্রকাশ করবেন না।' : 'Max 24 characters. Avoid using your real phone or full name.'}
            </p>
          </div>

          {/* Language Preference Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {t.guest.languagePref}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedLang('bn')}
                className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  selectedLang === 'bn'
                    ? 'border-violet-500 bg-violet-950/20 text-white shadow-sm'
                    : 'border-slate-800 bg-[#101728] text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-semibold text-sm">বাংলা (Bangla)</div>
                  <div className="text-[11px] text-slate-400">বাংলাদেশ ও আন্তর্জাতিক</div>
                </div>
                {selectedLang === 'bn' && <Check className="w-4 h-4 text-violet-400" />}
              </button>

              <button
                type="button"
                onClick={() => setSelectedLang('en')}
                className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  selectedLang === 'en'
                    ? 'border-cyan-500 bg-cyan-950/20 text-white shadow-sm'
                    : 'border-slate-800 bg-[#101728] text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-semibold text-sm">English</div>
                  <div className="text-[11px] text-slate-400">Global & Bilingual</div>
                </div>
                {selectedLang === 'en' && <Check className="w-4 h-4 text-cyan-400" />}
              </button>
            </div>
          </div>

          {/* Safety Pledge Checkbox */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#101728]/80 space-y-1.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pledgeAccepted}
                onChange={(e) => setPledgeAccepted(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                {t.guest.safetyPledge}
              </span>
            </label>
          </div>

          {errorMsg && (
            <div className="text-xs text-rose-400 font-medium">
              {errorMsg}
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" variant="primary" size="lg" fullWidth>
            <span>{t.guest.enterButton}</span>
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          {/* Account Upgrade Note */}
          <div className="pt-2 text-center text-xs text-slate-500">
            <span>{t.guest.registerHint} </span>
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="text-cyan-400 hover:underline cursor-pointer"
            >
              {language === 'bn' ? 'সাইন ইন / রেজিস্টার' : 'Sign In / Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
