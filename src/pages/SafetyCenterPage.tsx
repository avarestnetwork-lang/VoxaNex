import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { EMERGENCY_CONTACTS } from '../config/voxanexConfig';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { ReportModal } from '../components/chat/ReportModal';
import {
  ShieldAlert,
  ShieldCheck,
  PhoneCall,
  Lock,
  AlertTriangle,
  UserX,
  FileCheck2,
  ExternalLink,
  HeartHandshake,
  Search,
  CheckCircle2,
  Clock,
  Info,
} from 'lucide-react';

export const SafetyCenterPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupId.trim()) return;

    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);

    const res = await safetyService.checkReportStatus(lookupId.trim());
    setLookupLoading(false);

    if (res.success && res.report) {
      setLookupResult(res.report);
    } else {
      setLookupError(
        language === 'bn'
          ? 'এই নম্বরের কোনো রিপোর্ট খুঁজে পাওয়া যায়নি।'
          : 'No report found with this reference ID. Please check the code.'
      );
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mx-auto">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          {t.safety.title}
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
          {t.safety.subtitle}
        </p>
        <div className="pt-2 flex flex-wrap justify-center gap-3">
          <Button variant="danger" size="md" onClick={() => setReportModalOpen(true)}>
            <AlertTriangle className="w-4 h-4 mr-2" />
            <span>{language === 'bn' ? 'গোপনীয় রিপোর্ট দাখিল করুন' : 'File a Confidential Report'}</span>
          </Button>
          <Button variant="outline" size="md" onClick={() => navigate('/age-gate')}>
            <Lock className="w-4 h-4 mr-2" />
            <span>{language === 'bn' ? 'বয়স যাচাই ও আইনি নিয়ন্ত্রণ' : 'Age Assurance Controls'}</span>
          </Button>
        </div>
      </div>

      {/* Honest Operational Notice */}
      <div className="p-4 rounded-xl border border-cyan-200 bg-cyan-50/80 text-xs text-slate-700 flex items-start gap-3 shadow-sm">
        <Info className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-slate-900 text-sm">
            {language === 'bn' ? 'সততাপূর্ণ মডারেশন ও পরিচালন বিবৃতি' : 'Trust, Safety & Moderation Operations Standard'}
          </span>
          <p className="text-slate-600 leading-relaxed">
            {language === 'bn'
              ? 'ভক্সানেক্স স্বয়ংক্রিয় ফিল্টারিং এবং প্রশিক্ষিত মানব মডারেটরদের সম্মিলিত প্রক্রিয়ায় কাজ করে। স্বয়ংক্রিয় অ্যালগরিদম কখনোই অভ্রান্ত নয়, তাই প্রতিটি গুরুতর সিদ্ধান্ত মানবীয় পর্যালোচনার অধীন থাকে। আমরা কোনো অযৌক্তিক ২৪/৭ তাৎক্ষণিক দাবি করি না; অগ্রাধিকারভিত্তিতে রিপোর্টগুলো দ্রুততম সময়ে সমাধান করা হয়।'
              : 'VoxaNex operates transparently: automated filters assist in rapid screening, but serious sanctions and disputed decisions are reviewed by human trust-and-safety personnel. We do not claim infallible 24/7 staffing; reports are triaged continuously with child protection and threat cases prioritized immediately.'}
          </p>
        </div>
      </div>

      {/* Report Lookup Section */}
      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Search className="w-4 h-4 text-cyan-600" />
            <span>{language === 'bn' ? 'দাখিলকৃত রিপোর্টের অবস্থা পর্যবেক্ষণ' : 'Track Existing Safety Report'}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {language === 'bn'
              ? 'আপনার রিপোর্ট সাবমিশনের সময় প্রাপ্ত রেফারেন্স আইডি দিয়ে স্ট্যাটাস দেখুন।'
              : 'Enter your incident reference code to view ongoing investigation or resolution status.'}
          </p>
        </div>

        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="e.g. rep_1776092000_abc"
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-cyan-500"
          />
          <Button type="submit" variant="primary" size="sm" disabled={lookupLoading}>
            {lookupLoading ? 'Checking...' : (language === 'bn' ? 'অনুসন্ধান' : 'Lookup Status')}
          </Button>
        </form>

        {lookupError && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {lookupError}
          </div>
        )}

        {lookupResult && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono text-cyan-700 font-semibold">{lookupResult.id}</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase bg-violet-50 text-violet-700 border border-violet-200">
                Status: {lookupResult.status}
              </span>
            </div>
            <div className="text-slate-700 grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div>Target: <span className="font-semibold text-slate-900">{lookupResult.reportedTarget}</span></div>
              <div>Category: <span className="font-semibold text-slate-900">{lookupResult.category}</span></div>
              <div>Action Taken: <span className="font-semibold text-emerald-600">{lookupResult.actionTaken || 'Under Review'}</span></div>
              <div>Logged: <span className="font-mono text-slate-500">{new Date(lookupResult.timestamp).toLocaleDateString()}</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Emergency Helplines Bangladesh & Global Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <PhoneCall className="w-5 h-5 text-cyan-600" />
          <span>{t.safety.emergencyTitle}</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {EMERGENCY_CONTACTS.map((contact, idx) => (
            <div
              key={`${contact.number}-${idx}`}
              className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors flex flex-col justify-between space-y-3"
            >
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-500 font-mono">{contact.badge}</span>
                </div>
                <h3 className="text-sm font-bold text-slate-900">{contact.name}</h3>
                <p className="text-xs text-slate-600 mt-1">{contact.purpose}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="font-mono text-cyan-600 text-sm font-semibold">
                  {contact.number}
                </span>
                <span className="text-[11px] text-slate-400">Toll-Free / Verified</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Community Conduct & Standards */}
      <div className="p-6 sm:p-8 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">{t.safety.guidelinesTitle}</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            {t.safety.guidelinesDesc}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <UserX className="w-4 h-4 text-rose-600" />
              <span>Harassment & Extortion Policy</span>
            </span>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              We maintain absolute zero tolerance for threats, doxxing, non-consensual sexual exhibition, or financial blackmail. Violators are banned server-side immediately and reported to CID Cyber Police.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-cyan-600" />
              <span>Privacy & Camera Protection</span>
            </span>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Never display identifiable student IDs, office uniforms, or phone numbers on camera. If an unfamiliar caller acts suspiciously, tap Report and end the call immediately.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Report Modal */}
      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetType="user"
      />
    </div>
  );
};
