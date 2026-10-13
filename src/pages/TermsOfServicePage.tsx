import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { Scale, ShieldAlert, AlertTriangle, FileText, ArrowLeft, CheckCircle } from 'lucide-react';

export const TermsOfServicePage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Home</span>
      </button>

      <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-6 sm:p-10 space-y-6">
        <div className="space-y-2 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-400 tracking-wider uppercase">
            <Scale className="w-4 h-4" />
            <span>Legal & Conduct Agreement</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            VoxaNex Terms of Service
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Version 1.0 · Last Revised: March 2026
          </p>
        </div>

        <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyan-400" />
              <span>1. Acceptance of Terms</span>
            </h2>
            <p>
              By accessing or using VoxaNex, whether as an anonymous guest or registered user, you agree to comply with and be bound by these Terms of Service. If you do not agree to all terms, you must discontinue platform use immediately.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>2. 18+ Access Gate & Mature Content</span>
            </h2>
            <p>
              Access to mature discussion areas (including Bangla Adult Lounge) is restricted exclusively to individuals who are at least 18 years of age or the age of majority in their jurisdiction. By entering 18+ spaces, you affirm your adult eligibility. Falsifying age or attempting to bypass access controls constitutes a direct breach of contract.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>3. Prohibited Conduct & Criminal Violations</span>
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
              <li>Zero tolerance for Child Sexual Abuse Material (CSAM). Immediate escalation to law enforcement.</li>
              <li>Non-consensual sharing or recording of intimate images or live webcam streams.</li>
              <li>Cyberbullying, extortion, or demanding financial payments (bKash/Nagad/crypto) under threat of blackmail.</li>
              <li>Communal hate speech, blasphemous incitement, or threatening violence against any community.</li>
              <li>Automated spamming, bot scraping, or commercial advertising without explicit platform consent.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-400" />
              <span>4. Language & Banglish Communication Standard</span>
            </h2>
            <p>
              Participants are welcome to communicate in Bangla, Banglish, and English. However, writing derogatory slurs or harassment using phonetic English characters (Banglish) is subject to identical disciplinary measures as vernacular abuse.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-slate-400" />
              <span>5. Limitation of Liability</span>
            </h2>
            <p>
              VoxaNex is provided on an "as-is" and "as-available" basis. Phase 1 provides client-side architectural and communication scaffolding. The platform disclaims liability for individual peer conduct occurring between users. Users are urged to exercise vigilance, safeguard their personal identities, and use the instant Report and Block controls.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
