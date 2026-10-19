import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { Shield, Lock, EyeOff, FileText, ArrowLeft, Globe } from 'lucide-react';

export const PrivacyPolicyPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SEOHead
        title={
          language === 'bn'
            ? 'গোপনীয়তা নীতি – ChatLustora'
            : 'Privacy Policy & Data Protection – ChatLustora'
        }
        description={
          language === 'bn'
            ? 'চ্যাটলাস্টোরা (ChatLustora.com) এর গোপনীয়তা নীতি। বেনামী গেস্ট সেশন, ডেটা মিনিমাইজেশন, এনক্রিপশন এবং ব্যক্তিগত তথ্যের সুরক্ষা।'
            : 'ChatLustora Privacy Policy and data protection practices. Anonymous guest sessions, strict data minimization, and user privacy guarantees.'
        }
        canonicalPath="/privacy"
      />

      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{language === 'bn' ? 'হোমে ফিরে যান' : 'Back to Home'}</span>
      </button>

      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0d1322] rounded-2xl p-6 sm:p-10 space-y-6 shadow-sm">
        <div className="space-y-2 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 tracking-wider uppercase">
            <Lock className="w-4 h-4" />
            <span>ChatLustora Privacy & Data Protection</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            ChatLustora Privacy Policy
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Platform: ChatLustora.com · Effective: March 2026 · Adults Only (18+)
          </p>
        </div>

        <div className="space-y-6 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-rose-500" />
              <span>1. Zero Precise Geolocation Harvesting</span>
            </h2>
            <p>
              ChatLustora does NOT harvest, track, record, or disclose your precise physical GPS coordinates or pinpoint address. When regional communities (such as Bangladesh or India) are browsed, selection is purely user-driven. Your IP address is never exposed to other random chat participants.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              <span>2. Guest Identity & Data Minimization</span>
            </h2>
            <p>
              Anonymous guest sessions operate without requesting phone numbers, national identification numbers, or social media handles. Guest nicknames, preferred avatars, and interface languages are stored locally on your own client device. You can wipe your guest session data anytime via the Profile Settings page.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-violet-500" />
              <span>3. Private Messaging Confidentiality</span>
            </h2>
            <p>
              Private 1-on-1 direct conversations are strictly isolated to authorized participants. Third parties cannot inspect private chat rooms. ChatLustora does not commercialize or sell user conversation data to advertisers.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-amber-500" />
              <span>4. Age Gate Declarations</span>
            </h2>
            <p>
              When entering the 18+ adult community, self-declaration consent records are stored locally with an ISO timestamp. In compliance with data minimization standards, no unnecessary government identity documents are retained on public servers.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              <span>5. Law Enforcement Cooperation for Severe Crimes</span>
            </h2>
            <p>
              In cases involving Child Sexual Abuse Material (CSAM), severe extortion, blackmail, or violent threats, ChatLustora maintains an unyielding obligation to report offending incident artifacts to law enforcement authorities and international protection organizations (NCMEC).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
