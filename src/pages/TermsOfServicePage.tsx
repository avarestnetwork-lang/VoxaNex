import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { Scale, ShieldAlert, AlertTriangle, FileText, ArrowLeft, CheckCircle } from 'lucide-react';

export const TermsOfServicePage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SEOHead
        title={
          language === 'bn'
            ? 'ব্যবহারের শর্তাবলী – ChatLustora'
            : 'Terms of Service & Adult User Agreement – ChatLustora'
        }
        description={
          language === 'bn'
            ? 'চ্যাটলাস্টোরা (ChatLustora.com) প্ল্যাটফর্ম ব্যবহারের নিয়মাবলী ও আইনি শর্ত। ১৮+ প্রাপ্তবয়স্কদের আচরণবিধি, মিউচুয়াল কনসেন্ট এবং নীতি লঙ্ঘন প্রতিরোধ।'
            : 'ChatLustora Terms of Service and adult user conduct agreement. 18+ access requirements, mutual consent, content policies, and dispute terms.'
        }
        canonicalPath="/terms"
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
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400 tracking-wider uppercase">
            <Scale className="w-4 h-4" />
            <span>ChatLustora Legal & Conduct Agreement</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            ChatLustora Terms of Service
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Platform: ChatLustora.com · Last Revised: March 2026 · Adults Only (18+)
          </p>
        </div>

        <div className="space-y-6 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-rose-500" />
              <span>1. Acceptance of Terms</span>
            </h2>
            <p>
              By accessing or using ChatLustora (ChatLustora.com), whether via anonymous guest sessions or registered user accounts, you agree to comply with and be bound by these Terms of Service. If you do not agree to all terms, you must discontinue platform use immediately.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <span>2. Mandatory 18+ Access Gate & Adult Content</span>
            </h2>
            <p>
              ChatLustora is exclusively an adult community for individuals aged 18 and older (or the legal age of majority in your jurisdiction). By entering this platform, you solemnly affirm your adult eligibility. Falsifying age or attempting to facilitate minor access constitutes a direct breach of contract and will result in an immediate permanent ban.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>3. Prohibited Conduct & Criminal Violations</span>
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-600 dark:text-slate-400">
              <li>Zero tolerance for Child Sexual Abuse Material (CSAM). Immediate escalation to law enforcement and NCMEC.</li>
              <li>Non-consensual sharing or recording of intimate images or live webcam streams.</li>
              <li>Cyberbullying, extortion, or demanding financial payments (bKash/Nagad/crypto) under threat of blackmail.</li>
              <li>Hate speech, harassment, communal incitement, or threatening violence.</li>
              <li>Automated spamming, bot scraping, or commercial advertising without explicit platform consent.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" />
              <span>4. Language & Communication Standards</span>
            </h2>
            <p>
              Participants are welcome to communicate in Bangla, Banglish, Hindi, and English. Derogatory slurs, harassment, or abusive attacks in any language or phonetic script are strictly prohibited.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-slate-500" />
              <span>5. Limitation of Liability</span>
            </h2>
            <p>
              ChatLustora is provided on an "as-is" and "as-available" basis. The platform disclaims liability for individual peer conduct occurring between users. Users are urged to exercise vigilance, protect their personal financial and identification data, and use the built-in instant Report and Block controls.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
