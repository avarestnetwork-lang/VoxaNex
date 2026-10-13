import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface BanglishHelperBarProps {
  onInsertText?: (text: string) => void;
}

const COMMON_BANGLISH_PHRASES = [
  { phonetic: 'kmn achen?', bengali: 'কেমন আছেন?', english: 'How are you (formal)?' },
  { phonetic: 'kmn acho?', bengali: 'কেমন আছো?', english: 'How are you (casual)?' },
  { phonetic: 'valo achi', bengali: 'ভালো আছি', english: 'I am doing well' },
  { phonetic: 'ki khobor?', bengali: 'কী খবর?', english: 'What’s new?' },
  { phonetic: 'dhonnobad', bengali: 'ধন্যবাদ', english: 'Thank you' },
  { phonetic: 'shuvo shokal', bengali: 'শুভ সকাল', english: 'Good morning' },
  { phonetic: 'shuvo ratri', bengali: 'শুভ রাত্রি', english: 'Good night' },
  { phonetic: 'pore kotha hobe', bengali: 'পরে কথা হবে', english: 'Talk to you later' },
  { phonetic: 'apnar nam ki?', bengali: 'আপনার নাম কী?', english: 'What is your name?' },
  { phonetic: 'dekhe valo laglo', bengali: 'দেখে ভালো লাগলো', english: 'Nice meeting you' },
];

export const BanglishHelperBar: React.FC<BanglishHelperBarProps> = ({ onInsertText }) => {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleSelect = (text: string, index: number) => {
    if (onInsertText) {
      onInsertText(text);
    } else {
      navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  };

  return (
    <div className="border border-slate-800/80 bg-[#0d1424] rounded-lg overflow-hidden text-xs transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-medium text-slate-200">
            {language === 'bn' ? 'বাংলিশ টাইপিং সহায়িকা ও সাজেশন' : 'Banglish Phonetic Assistant & Quick Phrases'}
          </span>
          <span className="text-slate-500 hidden sm:inline">
            ({language === 'bn' ? 'ক্লিক করে সরাসরি ব্যবহার করুন' : 'Click to insert into input'})
          </span>
        </div>
        <div className="flex items-center gap-1 text-slate-400">
          <span>{isOpen ? (language === 'bn' ? 'লুকান' : 'Hide') : (language === 'bn' ? 'দেখান' : 'Show')}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-3 border-t border-slate-800 bg-[#0a0f1d] space-y-2.5">
          <p className="text-[11px] text-slate-400">
            {language === 'bn'
              ? 'ইংরেজি কীবোর্ডে বাংলা উচ্চারণ লিখে আড্ডা দিন। সাধারণ বাক্য সরাসরি মেসেজে যুক্ত করতে ক্লিক করুন:'
              : 'Write conversational Bangla using regular English letters. Click any phrase to insert directly into chat:'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
            {COMMON_BANGLISH_PHRASES.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelect(item.phonetic, idx)}
                className="flex items-center justify-between px-2.5 py-1.5 bg-[#121a2e] hover:bg-[#1a2542] border border-slate-800 hover:border-slate-700 text-left rounded transition-colors group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
              >
                <div className="truncate pr-2">
                  <div className="font-mono text-cyan-300 font-medium">{item.phonetic}</div>
                  <div className="text-[10px] text-slate-400 truncate">{item.bengali} · {item.english}</div>
                </div>
                <div className="text-slate-500 group-hover:text-slate-300 shrink-0">
                  {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </div>
              </button>
            ))}
          </div>

          <div className="pt-1 text-[11px] text-slate-400 border-t border-slate-800/60 flex items-center justify-between">
            <span>
              💡 {language === 'bn' ? 'নিয়ম: অশ্লীল গালিগালাজ বা হয়রানিমূলক ভাষা পরিহার করুন।' : 'Standard: Harassment and abusive Banglish slurs violate platform terms.'}
            </span>
            <span className="text-slate-500">Asia/Dhaka</span>
          </div>
        </div>
      )}
    </div>
  );
};
