import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { Shield, Lock, EyeOff, FileText, ArrowLeft, Globe } from 'lucide-react';

export const PrivacyPolicyPage: React.FC = () => {
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
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 tracking-wider uppercase">
            <Lock className="w-4 h-4" />
            <span>Privacy & Data Sovereignty</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            VoxaNex Privacy Policy
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Effective Date: March 2026 · Standard: Bangladesh & Global Privacy Principles
          </p>
        </div>

        <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-cyan-400" />
              <span>1. Zero Precise Geolocation Harvest</span>
            </h2>
            <p>
              VoxaNex does NOT harvest, track, record, or disclose your precise physical GPS coordinates or pinpoint street address. When regional communities (such as Dhaka, Chittagong, or Sylhet) are browsed, selection is purely user-driven. Your IP address is never exposed to other random chat participants.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>2. Guest Identity & Session Persistence</span>
            </h2>
            <p>
              Anonymous guest sessions operate without requesting phone numbers, national identity numbers, or social media handles. Guest nicknames, preferred avatars, and interface languages are stored locally on your own client device within browser storage. You can wipe your guest data anytime via the Profile Settings page.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-violet-400" />
              <span>3. Voice, Webcam, and Media Streaming Privacy</span>
            </h2>
            <p>
              Audio and video communication is designed to be transmitted peer-to-peer or via ephemeral WebRTC relay servers. VoxaNex does NOT record, store, or sell private video calls or voice conversations. Camera and microphone hardware access is requested strictly through standard HTML5 browser permission dialogs and can be revoked by you at any time.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-amber-400" />
              <span>4. Age Gate Declarations</span>
            </h2>
            <p>
              When entering 18+ designated lounges, self-declaration consent records are stored locally with an ISO timestamp. In Phase 2, third-party age verification providers (such as Persona, Yoti, or Veriff) may process zero-knowledge proofs where legal frameworks mandate cryptographic age verification.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <span>5. Law Enforcement Cooperation for Serious Crimes</span>
            </h2>
            <p>
              In cases involving Child Sexual Abuse Material (CSAM), severe extortion, terrorist threats, or violent criminal blackmail, VoxaNex maintains an unyielding obligation to report offending incident artifacts to Bangladesh law enforcement (CID Cyber Police Centre) and international organizations (NCMEC).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
