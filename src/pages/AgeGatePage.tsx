import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { AgeVerificationStatus, AgeAssuranceProvider } from '../types';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Lock,
  ArrowLeft,
  CheckCircle2,
  Scale,
  FileText,
  ExternalLink,
  Cpu,
  RefreshCw,
  BadgeAlert,
  Fingerprint,
} from 'lucide-react';

export const AgeGatePage: React.FC = () => {
  const { navigate, params } = useRouter();
  const { language, t } = useLanguage();
  const { user, is18Verified, verify18, revoke18 } = useAuth();

  const [activeMode, setActiveMode] = useState<'declare' | 'third_party'>('declare');
  const [birthYear, setBirthYear] = useState<number>(2000);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rulesAffirmed, setRulesAffirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Server state
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<AgeVerificationStatus>('unverified');
  const [providerProofHash, setProviderProofHash] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AgeAssuranceProvider>('veriff_sandbox');
  const [sandboxSession, setSandboxSession] = useState<{ sessionId: string; redirectUrl: string } | null>(null);

  useEffect(() => {
    async function loadStatus() {
      const res = await safetyService.checkAgeStatus(user.id);
      if (res.success && res.record) {
        setServerStatus(res.record.status);
        if (res.record.providerProofHash) {
          setProviderProofHash(res.record.providerProofHash);
        }
      }
    }
    loadStatus();
  }, [user.id]);

  const handleSelfDeclaration = async () => {
    if (!acknowledged || !rulesAffirmed) {
      setErrorMsg(
        language === 'bn'
          ? 'অনুগ্রহ করে বয়স ও সম্মতির সকল শর্তাবলী নিশ্চিত করুন।'
          : 'You must affirm the age declaration and community conduct rules.'
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const res = await safetyService.submitAgeDeclaration(user.id, birthYear, true);
    setLoading(false);

    if (res.success && res.record) {
      verify18();
      setServerStatus(res.record.status);
      setStatusMessage(
        language === 'bn'
          ? 'বয়স ঘোষণা সফলভাবে গৃহীত হয়েছে!'
          : 'Self-declaration verified. Adult lounge access granted.'
      );
      setTimeout(() => {
        navigate(params.targetRoom ? `/chat/${params.targetRoom}` : '/rooms');
      }, 1200);
    } else {
      setErrorMsg(res.error || (language === 'bn' ? 'বয়স যাচাইকরণ ব্যর্থ হয়েছে।' : 'Age assurance rejected: Under 18 prohibited.'));
      if (res.record?.status) setServerStatus(res.record.status);
    }
  };

  const handleStartSandboxProvider = async () => {
    setLoading(true);
    setErrorMsg(null);

    const sessionRes = await safetyService.startProviderVerification(user.id, selectedProvider);
    if (sessionRes.success && sessionRes.sessionId && sessionRes.redirectUrl) {
      setSandboxSession({ sessionId: sessionRes.sessionId, redirectUrl: sessionRes.redirectUrl });
    } else {
      setErrorMsg(sessionRes.error || 'Failed to initialize verification session.');
    }
    setLoading(false);
  };

  const handleCompleteSandboxProvider = async (isAdult: boolean) => {
    if (!sandboxSession) return;
    setLoading(true);
    setErrorMsg(null);

    const res = await safetyService.completeProviderVerification({
      userId: user.id,
      provider: selectedProvider,
      sessionId: sandboxSession.sessionId,
      isAdultConfirmed: isAdult,
      referenceProofToken: `zk_proof_${Date.now()}_sandbox`,
    });

    setLoading(false);

    if (res.success && res.record) {
      setServerStatus(res.record.status);
      setSandboxSession(null);
      if (res.record.status === 'verified_adult_18plus') {
        verify18();
        setProviderProofHash(res.record.providerProofHash || null);
        setStatusMessage(
          language === 'bn'
            ? 'তৃতীয় পক্ষীয় এজ-অ্যাসুরেন্স সফলভাবে যাচাইকৃত হয়েছে!'
            : 'Third-party cryptographic age proof verified successfully.'
        );
      } else {
        revoke18();
        setErrorMsg(
          language === 'bn'
            ? 'পরিচয় যাচাইয়ে অপ্রাপ্তবয়স্ক সনাক্ত হয়েছে। প্রাপ্তবয়স্ক বিভাগে প্রবেশাধিকার প্রত্যাখ্যাত।'
            : 'Provider verification failed: Identity indicates under 18 years old. Adult access denied.'
        );
      }
    }
  };

  const handleRevoke = async () => {
    setLoading(true);
    revoke18();
    await safetyService.revokeAgeVerification(user.id, 'User self-revoked adult eligibility declaration');
    setServerStatus('revoked');
    setProviderProofHash(null);
    setAcknowledged(false);
    setRulesAffirmed(false);
    setLoading(false);
    setStatusMessage(
      language === 'bn' ? 'প্রাপ্তবয়স্ক প্রবেশাধিকার প্রত্যাহার করা হয়েছে।' : 'Adult access eligibility revoked.'
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <button
        onClick={() => navigate('/rooms')}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{language === 'bn' ? 'সাধারণ রুম ডিরেক্টরিতে ফিরুন' : 'Back to Room Directory'}</span>
      </button>

      <div className="border border-rose-950/70 bg-[#0d101a] rounded-2xl overflow-hidden shadow-2xl">
        {/* Header Banner */}
        <div className="p-6 bg-gradient-to-r from-rose-950/50 via-purple-950/30 to-[#0d101a] border-b border-rose-900/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-rose-950/80 border border-rose-700/50 flex items-center justify-center text-rose-400 shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs font-mono font-semibold text-rose-400 tracking-wider uppercase">
                  {t.ageGate.badge}
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                  {t.ageGate.title}
                </h1>
              </div>
            </div>

            {/* Current Status Pill */}
            <div className="flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-lg border text-xs font-mono">
              {serverStatus === 'verified_adult_18plus' || is18Verified ? (
                <span className="text-emerald-400 flex items-center gap-1.5 border-emerald-800/60 bg-emerald-950/30">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Status: Verified Adult (18+)</span>
                </span>
              ) : serverStatus === 'rejected_underage' ? (
                <span className="text-rose-400 flex items-center gap-1.5 border-rose-800/60 bg-rose-950/30">
                  <BadgeAlert className="w-4 h-4" />
                  <span>Status: Rejected (Minor Under 18)</span>
                </span>
              ) : serverStatus === 'revoked' ? (
                <span className="text-amber-400 flex items-center gap-1.5 border-amber-800/60 bg-amber-950/30">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Status: Eligibility Revoked</span>
                </span>
              ) : (
                <span className="text-slate-400 flex items-center gap-1.5 border-slate-800 bg-slate-900/40">
                  <Lock className="w-4 h-4" />
                  <span>Status: Unverified</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Body content */}
        <div className="p-6 sm:p-8 space-y-6">
          {/* Statutory warning notice */}
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/60 text-xs text-rose-200/90 leading-relaxed space-y-1.5">
            <p className="font-bold text-rose-300 flex items-center gap-1.5 text-sm">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                {language === 'bn'
                  ? 'সংবিধিবদ্ধ আইনি সতর্কতা: নাবালকদের প্রবেশ সম্পূর্ণ নিষিদ্ধ'
                  : 'Statutory Legal Notice & Mandatory Age-Assurance Standard'}
              </span>
            </p>
            <p>
              {language === 'bn'
                ? 'একটি চেকবাক্স নির্বাচন করা কখনোই স্বয়ংসম্পূর্ণ বয়সের চূড়ান্ত প্রমাণ হিসেবে গণ্য হবে না। ১৮ বছরের নিচে কোনো অপ্রাপ্তবয়স্ককে প্রাপ্তবয়স্ক রুমে বা যৌন আলোচনায় অনুমতি দেওয়া হয় না। মিথ্যা বয়স ঘোষণা শাস্তিযোগ্য অপরাধ।'
                : 'An age-confirmation checkbox alone must not be represented as proof of age. Never permit minors into adult-oriented rooms or sexual conversations. Submitting fraudulent declarations violates platform terms and applicable telecommunications law.'}
            </p>
          </div>

          {statusMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* If already verified, show revocation & proof summary */}
          {(serverStatus === 'verified_adult_18plus' || is18Verified) ? (
            <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span>
                    {language === 'bn'
                      ? 'প্রাপ্তবয়স্ক হিসেবে আপনার যোগ্যতা সক্রিয় রয়েছে'
                      : 'Adult Eligibility Active & Confirmed'}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevoke}
                  disabled={loading}
                  className="text-rose-400 hover:border-rose-800"
                >
                  {language === 'bn' ? 'যোগ্যতা প্রত্যাহার করুন' : 'Revoke Eligibility'}
                </Button>
              </div>

              <div className="text-xs text-slate-300 space-y-1">
                <p>
                  {language === 'bn'
                    ? 'আপনার আইডি বাংলা প্রাপ্তবয়স্ক লাউঞ্জে যোগদানের অনুমতি পেয়েছে।'
                    : 'Your session has valid clearance to participate in the Bangla Adult Lounge (18+).'}
                </p>
                {providerProofHash && (
                  <div className="pt-2">
                    <span className="text-slate-500 font-mono text-[11px] block">Cryptographic Zero-Knowledge Proof:</span>
                    <span className="font-mono text-cyan-400 text-[11px] break-all">{providerProofHash}</span>
                  </div>
                )}
              </div>

              <div className="pt-2 flex gap-3">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => navigate('/chat', { roomId: params.targetRoom || 'bangla' })}
                >
                  {language === 'bn' ? 'চ্যাটে প্রবেশ করুন' : 'Enter Chat Lounge'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Method Selector Tabs */}
              <div className="flex rounded-xl bg-[#090e18] p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveMode('declare')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                    activeMode === 'declare'
                      ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{language === 'bn' ? '১. স্ব-ঘোষণা ও জন্মবর্ষ' : '1. Self-Affirmation with Birth Year'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMode('third_party')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                    activeMode === 'third_party'
                      ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Fingerprint className="w-3.5 h-3.5" />
                  <span>{language === 'bn' ? '২. তৃতীয়-পক্ষ আইডি অ্যাসুরেন্স (স্যান্ডবক্স)' : '2. 3P Age Provider (Persona / Veriff)'}</span>
                </button>
              </div>

              {activeMode === 'declare' && (
                <div className="p-5 rounded-xl border border-slate-800 bg-[#0f1524] space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      {language === 'bn' ? 'আপনার জন্মসাল নির্বাচন করুন' : 'Birth Year (Must be 18 or older)'}
                    </label>
                    <select
                      value={birthYear}
                      onChange={(e) => setBirthYear(parseInt(e.target.value, 10))}
                      className="w-full bg-[#131b2e] border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                    >
                      {Array.from({ length: 70 }, (_, i) => 2012 - i).map((yr) => (
                        <option key={yr} value={yr}>
                          {yr} ({2026 - yr} years old in 2026)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-3 pt-2 text-xs text-slate-300">
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-[#121929] hover:bg-[#151f33] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500 cursor-pointer"
                      />
                      <span>
                        {language === 'bn'
                          ? 'আমি সাক্ষ্য দিচ্ছি যে আমি ১৮ বছর বা তার বেশি বয়সী একজন প্রাপ্তবয়স্ক নাগরিক এবং এই বিভাগে প্রবেশের পূর্ণ আইনি সম্মতি প্রদান করছি।'
                          : 'I legally attest that I am 18 years of age or older, and I consent to adult-oriented conversational areas.'}
                      </span>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-[#121929] hover:bg-[#151f33] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rulesAffirmed}
                        onChange={(e) => setRulesAffirmed(e.target.checked)}
                        className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500 cursor-pointer"
                      />
                      <span>
                        {language === 'bn'
                          ? 'আমি সম্মতিহীন ছবি, ব্ল্যাকমেইল বা উত্যক্তকরণ নীতিমালার জিরো টলারেন্স নীতি মেনে চলতে অঙ্গীকারবদ্ধ।'
                          : 'I agree to platform rules prohibiting non-consensual imagery, blackmail, or unlawful sexual harassment.'}
                      </span>
                    </label>
                  </div>

                  <div className="pt-2">
                    <Button
                      variant="danger"
                      size="md"
                      onClick={handleSelfDeclaration}
                      disabled={loading}
                      className="w-full sm:w-auto"
                    >
                      {loading
                        ? (language === 'bn' ? 'যাচাই করা হচ্ছে...' : 'Verifying...')
                        : (language === 'bn' ? 'ঘোষণা নিশ্চিত করুন ও প্রবেশ করুন' : 'Confirm Declaration & Access Adult Lounge')}
                    </Button>
                  </div>
                </div>
              )}

              {activeMode === 'third_party' && (
                <div className="p-5 rounded-xl border border-slate-800 bg-[#0f1524] space-y-4">
                  <div className="text-xs text-slate-300 space-y-1">
                    <h3 className="font-bold text-white flex items-center gap-1.5">
                      <Fingerprint className="w-4 h-4 text-purple-400" />
                      <span>{language === 'bn' ? 'তৃতীয় পক্ষীয় এজ-অ্যাসুরেন্স প্ল্যাটফর্ম' : 'Third-Party Age Assurance Sandbox'}</span>
                    </h3>
                    <p className="text-slate-400">
                      {language === 'bn'
                        ? 'ভক্সানেক্স ব্যবহারকারীর কোনো পাসপোর্ট বা জাতীয় পরিচয়পত্রের ছবি সার্ভারে সংরক্ষণ করে না। শুধুমাত্র ক্রিপ্টোগ্রাফিক প্রুফ হ্যাশ গ্রহণ করা হয়।'
                        : 'VoxaNex practices zero-knowledge verification: Government IDs and biometric data are never retained on our servers.'}
                    </p>
                  </div>

                  {!sandboxSession ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                          Select Provider Integration Sandbox
                        </label>
                        <select
                          value={selectedProvider}
                          onChange={(e) => setSelectedProvider(e.target.value as AgeAssuranceProvider)}
                          className="w-full bg-[#131b2e] border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                        >
                          <option value="veriff_sandbox">Veriff Sandbox (Document & Facial Liveness)</option>
                          <option value="yoti_sandbox">Yoti Sandbox (Biometric Age Estimation)</option>
                          <option value="persona_sandbox">Persona Sandbox (Government ID Verification)</option>
                        </select>
                      </div>

                      <Button
                        variant="primary"
                        size="md"
                        onClick={handleStartSandboxProvider}
                        disabled={loading}
                        className="w-full sm:w-auto"
                      >
                        {loading ? 'Initializing Session...' : 'Start Sandbox Provider Flow'}
                      </Button>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/40 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-purple-300 font-semibold">Active Session: {sandboxSession.sessionId}</span>
                        <span className="text-slate-400 font-mono">{selectedProvider}</span>
                      </div>
                      <p className="text-slate-300">
                        Simulating provider webhook result for development & compliance testing:
                      </p>
                      <div className="flex gap-2.5 pt-1">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleCompleteSandboxProvider(true)}
                          disabled={loading}
                        >
                          Simulate Provider Approval (Adult 18+)
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleCompleteSandboxProvider(false)}
                          disabled={loading}
                        >
                          Simulate Provider Rejection (Minor)
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Legal architecture details */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {language === 'bn' ? 'আইনি কাঠামো ও প্রবিধানিক সম্মতি' : 'Applicable Legal Framework & International Standards'}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-lg bg-[#0c1220] border border-slate-800 space-y-1">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Scale className="w-4 h-4 text-cyan-400" />
                  <span>Bangladesh Laws (BD Jurisdiction)</span>
                </span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Compliance review under the Pornography Control Act 2012, Cyber Security Act 2023, and Penal Code. Strict prohibition of commercial exploitation, blackmail, and unconsented sexual material.
                </p>
              </div>

              <div className="p-3.5 rounded-lg bg-[#0c1220] border border-slate-800 space-y-1">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-violet-400" />
                  <span>Global Market Standards</span>
                </span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Meets AVMSD (Audiovisual Media Services Directive) standards for adult services, UK Online Safety Act age-assurance duties, and strict US COPPA protections against minor access.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
