import React, { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { safetyService } from '../../services/safetyService';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ReportCategory, ReportTargetType } from '../../types';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Eye,
  Info,
} from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType?: ReportTargetType;
  targetId?: string;
  reportedTargetName?: string;
  evidenceSnippet?: string;
  roomId?: string;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  targetType = 'user',
  targetId = '',
  reportedTargetName = '',
  evidenceSnippet = '',
  roomId = '',
}) => {
  const { language } = useLanguage();
  const { user } = useAuth();

  const [targetNameInput, setTargetNameInput] = useState(reportedTargetName);
  const [category, setCategory] = useState<ReportCategory>('harassment');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (reportedTargetName) setTargetNameInput(reportedTargetName);
  }, [reportedTargetName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonText.trim()) {
      setErrorMessage(
        language === 'bn' ? 'অনুগ্রহ করে অভিযোগের বিস্তারিত বিবরণ লিখুন।' : 'Please describe the incident details.'
      );
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const res = await safetyService.submitReport({
      targetType,
      targetId: targetId || targetNameInput.trim(),
      reportedTarget: targetNameInput.trim() || 'Reported Target',
      reportedUserId: targetId || undefined,
      reporterId: user.id,
      reporterNickname: user.nickname,
      category,
      reasonText: reasonText.trim(),
      evidenceSnapshot: evidenceSnippet || roomId ? {
        textSnippet: evidenceSnippet || undefined,
        roomId: roomId || undefined,
        timestamp: new Date().toISOString(),
      } : undefined,
    });

    setSubmitting(false);

    if (res.success && res.reportId) {
      setSubmittedReportId(res.reportId);
    } else {
      setErrorMessage(res.error || (language === 'bn' ? 'রিপোর্ট পাঠাতে ব্যর্থ হয়েছে।' : 'Failed to submit report.'));
    }
  };

  const handleClose = () => {
    setSubmittedReportId(null);
    setErrorMessage(null);
    setReasonText('');
    onClose();
  };

  const categories: { value: ReportCategory; labelEn: string; labelBn: string; urgent?: boolean }[] = [
    { value: 'harassment', labelEn: 'Harassment & Bullying', labelBn: 'হয়রানি ও উত্ত্যক্তকরণ' },
    { value: 'threats', labelEn: 'Threats & Physical Violence', labelBn: 'হুমকি ও শারীরিক সহিংসতার ভয়ভীতি', urgent: true },
    { value: 'exploitation', labelEn: 'Child Exploitation / CSAM (Zero Tolerance)', labelBn: 'শিশু শোষণ / আপত্তিকর কনটেন্ট (জিরো টলারেন্স)', urgent: true },
    { value: 'non_consensual_imagery', labelEn: 'Non-Consensual Imagery / Extortion', labelBn: 'অসম্মতিমূলক ছবি / ব্ল্যাকমেইল', urgent: true },
    { value: 'underage_suspicion', labelEn: 'Suspected Minor in 18+ Area', labelBn: '১৮+ বিভাগে অপ্রাপ্তবয়স্ক সন্দেহ' },
    { value: 'hate_speech', labelEn: 'Hate Speech & Discrimination', labelBn: 'ঘৃণাত্মক বক্তব্য ও বিদ্বেষ' },
    { value: 'scam', labelEn: 'Financial Fraud & Scams', labelBn: 'আর্থিক প্রতারণা ও জুয়ার ফাঁদ' },
    { value: 'spam', labelEn: 'Spam & Automated Bots', labelBn: 'স্প্যাম ও স্বয়ংক্রিয় বট' },
    { value: 'other', labelEn: 'Other Community Violations', labelBn: 'অন্যান্য নীতি লঙ্ঘন' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="" size="md">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-800/40 flex items-center justify-center text-rose-400 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              {language === 'bn' ? 'নিরাপত্তা রিপোর্ট দায়ের করুন' : 'File a Confidential Safety Report'}
            </h2>
            <p className="text-xs text-slate-400">
              {language === 'bn'
                ? 'আপনার অভিযোগটি মডারেশন দলের নিকট সরাসরি পর্যালোচনার জন্য জমা হবে।'
                : 'Incident evidence is routed to moderators. Reporter identities remain private.'}
            </p>
          </div>
        </div>

        {submittedReportId ? (
          <div className="p-6 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-emerald-300">
                {language === 'bn' ? 'রিপোর্ট সফলভাবে জমা হয়েছে' : 'Report Received Successfully'}
              </h3>
              <p className="text-xs text-slate-300">
                {language === 'bn'
                  ? 'আমাদের ট্রাস্ট অ্যান্ড সেফটি দল ঘটনাটি তদন্ত করছে। আপনার রিপোর্ট নম্বর:'
                  : 'Our Trust & Safety triage queue has registered your report. Reference ID:'}
              </p>
              <div className="font-mono text-xs text-emerald-400 font-semibold mt-1">
                {submittedReportId}
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              {language === 'bn'
                ? 'আপনি সেফটি সেন্টারে এই রেফারেন্স নম্বর দিয়ে স্ট্যাটাস পর্যবেক্ষণ করতে পারবেন।'
                : 'You can check report resolution status anytime in the Safety Center.'}
            </p>
            <Button variant="outline" size="sm" onClick={handleClose} className="w-full">
              {language === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Target */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                {language === 'bn' ? 'অভিযুক্ত ব্যবহারকারী বা রুম' : 'Reported Target (User, Message, Room)'}
              </label>
              <input
                type="text"
                value={targetNameInput}
                onChange={(e) => setTargetNameInput(e.target.value)}
                placeholder="e.g. Padma_Rider or room-bangla-adult"
                className="w-full bg-[#101726] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                required
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                {language === 'bn' ? 'লঙ্ঘনের ধরন (ক্যাটাগরি)' : 'Violation Category'}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                className="w-full bg-[#101726] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-rose-500 transition-colors"
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value} className="bg-[#101726] text-white">
                    {language === 'bn' ? c.labelBn : c.labelEn} {c.urgent ? '🚨' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Evidence preview if pre-attached */}
            {evidenceSnippet && (
              <div className="p-2.5 rounded-lg bg-[#0e1424] border border-slate-800/80 text-[11px] text-slate-300">
                <span className="text-slate-500 font-semibold block mb-0.5">Attached Message Context:</span>
                <span className="italic text-slate-300">"{evidenceSnippet.slice(0, 160)}"</span>
              </div>
            )}

            {/* Reason details */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                {language === 'bn' ? 'ঘটনার বিবরণ ও প্রমাণ' : 'Detailed Incident Description'}
              </label>
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder={
                  language === 'bn'
                    ? 'কী ঘটেছে বিস্তারিত লিখুন। যেমন: চ্যাটে কী বলা হয়েছিল, কোন রুমে ঘটেছে...'
                    : 'Provide factual context. E.g. what was stated, timestamp, or pattern of abusive behavior...'
                }
                rows={3}
                className="w-full bg-[#101726] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                required
              />
            </div>

            {/* Staffing & Legal disclaimer notice */}
            <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                <span>Notice on Moderation Operations</span>
              </div>
              <p>
                {language === 'bn'
                  ? 'ভক্সানেক্স অভিযোগসমূহ মডারেটরদের সক্রিয় ডিউটি শিডিউল অনুযায়ী মানবীয় পর্যালোচনার মাধ্যমে সমাধান করে। মিথ্যা বা আক্রোশমূলক অভিযোগ দায়ের প্ল্যাটফর্মের নীতিমালা লঙ্ঘন।'
                  : 'VoxaNex investigates reports with human moderators during active operational hours. For urgent physical threats in Bangladesh, contact 999 or CID Cyber Police (+880 1769691522).'}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                {language === 'bn' ? 'বাতিল' : 'Cancel'}
              </Button>
              <Button type="submit" variant="danger" size="sm" disabled={submitting}>
                {submitting
                  ? (language === 'bn' ? 'পাঠানো হচ্ছে...' : 'Submitting...')
                  : (language === 'bn' ? 'রিপোর্ট দাখিল করুন' : 'Submit Confidential Report')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
