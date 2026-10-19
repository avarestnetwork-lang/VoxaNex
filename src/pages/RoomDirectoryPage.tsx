import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { Room, RoomCategory, CommunicationMode } from '../types';
import { communityService } from '../services/communityService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SEOHead } from '../components/common/SEOHead';
import {
  Compass,
  Search,
  SlidersHorizontal,
  ShieldAlert,
  ShieldCheck,
  MessageSquare,
  Mic,
  Video,
  FileText,
  Lock,
  ArrowRight,
  Info,
  Globe,
  Users,
} from 'lucide-react';

export const RoomDirectoryPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();
  const { is18Verified } = useAuth();

  const [rooms, setRooms] = useState<Room[]>(ROOMS_CONFIG);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [inspectingRoom, setInspectingRoom] = useState<Room | null>(null);

  // Load catalog with actual participant counts from server presence
  useEffect(() => {
    let mounted = true;
    const fetchRooms = async () => {
      const catalog = await communityService.getCatalogRooms();
      if (mounted && catalog && catalog.length > 0) {
        setRooms(catalog);
      }
    };
    fetchRooms();
    const timer = setInterval(fetchRooms, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const categories = [
    { id: 'all', label: t.rooms.categoryAll },
    { id: 'bangla-adult', label: t.rooms.categoryBanglaAdult },
    { id: 'bangladesh-random', label: t.rooms.categoryBangladeshRandom },
    { id: 'banglish-chat', label: t.rooms.categoryBanglish },
    { id: 'regional', label: t.rooms.categoryRegional },
    { id: 'international', label: t.rooms.categoryInternational },
    { id: 'gaming-tech', label: t.rooms.categoryTech },
  ];

  const languagesList = [
    { id: 'all', label: language === 'bn' ? 'সকল ভাষা' : 'All Languages' },
    { id: 'bn', label: 'বাংলা (Bangla)' },
    { id: 'en', label: 'English' },
    { id: 'hi', label: 'हिन्दी (Hindi)' },
    { id: 'ur', label: 'اردو (Urdu)' },
    { id: 'de', label: 'Deutsch (German)' },
  ];

  const regionsList = [
    { id: 'all', label: language === 'bn' ? 'সকল অঞ্চল' : 'All Regions' },
    { id: 'Bangladesh', label: 'Bangladesh' },
    { id: 'India', label: 'India / South Asia' },
    { id: 'Pakistan', label: 'Pakistan / South Asia' },
    { id: 'Germany', label: 'Germany / DACH / Europe' },
    { id: 'Global', label: 'Global / Worldwide' },
  ];

  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      // Search
      const name = (room.name[language] || room.name.en || '').toLowerCase();
      const desc = (room.description[language] || room.description.en || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      if (q && !name.includes(q) && !desc.includes(q) && !room.slug.includes(q)) {
        return false;
      }
      // Category
      if (selectedCategory !== 'all' && room.category !== selectedCategory) {
        return false;
      }
      // Mode
      if (selectedMode !== 'all' && !room.modes.includes(selectedMode as CommunicationMode)) {
        return false;
      }
      // Language
      if (selectedLanguage !== 'all' && room.language !== selectedLanguage && room.language !== 'mixed') {
        return false;
      }
      // Region
      if (selectedRegion !== 'all') {
        const country = (room.country || '').toLowerCase();
        const reg = (room.region || '').toLowerCase();
        const target = selectedRegion.toLowerCase();
        if (!country.includes(target) && !reg.includes(target)) {
          return false;
        }
      }
      return true;
    });
  }, [rooms, searchQuery, selectedCategory, selectedMode, selectedLanguage, selectedRegion, language]);

  const handleJoin = (room: Room) => {
    navigate('/guest-entry', { targetRoom: room.slug });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          language === 'bn'
            ? 'বাংলা ও দেশি চ্যাট রুম ডিরেক্টরি – ChatLustora'
            : 'Bengali & Desi Chat Rooms – Adult Community Directory | ChatLustora'
        }
        description={
          language === 'bn'
            ? 'চ্যাটলাস্টোরার উন্মুক্ত চ্যাট রুম ডিরেক্টরি। বাংলা চ্যাট রুম, সেক্স চ্যাট, প্রাপ্তবয়স্ক আড্ডা, হিন্দি চ্যাট ও বাংলাদেশি আঞ্চলিক কমিউনিটি।'
            : 'Explore public adult chat rooms on ChatLustora. Join Bengali chat room, Bangla chat community, Desi chat rooms, Hindi chat, and online chat in Bangladesh.'
        }
        canonicalPath="/rooms"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'ChatLustora Public Chat Rooms',
          description: 'Catalog of 18+ adult chatrooms and language lounges.',
          numberOfItems: rooms.length,
        }}
      />
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Directory Header */}
        <div className="text-center sm:text-left space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-600 to-orange-500 text-white shadow-xl shadow-rose-500/20 mb-1">
            <Compass className="w-7 h-7 text-white" />
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-orange-600 dark:text-orange-400 tracking-wider uppercase">
            <span>{language === 'bn' ? 'উন্মুক্ত কমিউনিটি ও আন্তর্জাতিক চ্যানেল' : 'Public & International Lounges'}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {t.rooms.title}
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            {t.rooms.subtitle}
          </p>
        </div>

      {/* Search and Filters Bar */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.rooms.searchPlaceholder}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Category Tabs */}
          <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Language Selector */}
          <div className="flex items-center gap-1.5 ml-auto text-xs text-slate-600">
            <Globe className="w-3.5 h-3.5 text-orange-500" />
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-orange-500"
            >
              {languagesList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Region Selector */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>{language === 'bn' ? 'অঞ্চল:' : 'Region:'}</span>
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-orange-500"
            >
              {regionsList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>{language === 'bn' ? 'মাধ্যম:' : 'Mode:'}</span>
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value)}
              className="bg-[#101729] border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="all">{t.rooms.filterMode}</option>
              <option value="text">{t.rooms.modeText}</option>
              <option value="voice">{t.rooms.modeVoice}</option>
              <option value="video">{t.rooms.modeVideo}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Live Counter Discloser */}
      <div className="p-3 rounded-lg border border-slate-800/80 bg-[#0a0f1d] flex items-center justify-between text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{t.rooms.liveCountNotice} (Honest Active Session Telemetry)</span>
        </div>
        <span className="text-slate-500 hidden sm:inline">
          {filteredRooms.length} {language === 'bn' ? 'টি চ্যানেল উপলব্ধ' : 'channels available'}
        </span>
      </div>

      {/* Main Room Cards Grid */}
      <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Main Chatrooms</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredRooms.filter(r => r.category !== 'regional').map((room) => {
          const isAdult = room.is18Plus;
          const participants = room.activeParticipants || 0;
          return (
            <div key={room.id} className={'p-5 rounded-xl border flex flex-col justify-between transition-all shadow-sm bg-white ' + (isAdult ? 'border-rose-200 hover:border-rose-300' : 'border-slate-200 hover:border-orange-300')}>
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 text-xs">
                  <span className="text-slate-500 font-medium">{room.categoryLabel[language] || room.categoryLabel.en}</span>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="flex items-center gap-1 font-mono text-[10px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-700">
                      <span className={'w-1.5 h-1.5 rounded-full ' + (participants > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
                      <span>{participants} {language === 'bn' ? 'সক্রিয়' : 'active'}</span>
                    </span>
                    <span className={'uppercase font-mono text-[10px] bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5 rounded'}>{room.language}</span>
                  </div>
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">{room.name[language] || room.name.en}</h3>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-2">{room.description[language] || room.description.en}</p>
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <Button variant={isAdult ? (is18Verified ? 'primary' : 'danger') : 'primary'} size="md" fullWidth onClick={() => handleJoin(room)}>
                  <span>{t.rooms.joinBtn}</span>
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Regional Room Cards Grid */}
      <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Regional Chatrooms</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredRooms.filter(r => r.category === 'regional').map((room) => {
          const isAdult = room.is18Plus;
          const participants = room.activeParticipants || 0;
          return (
            <div key={room.id} className={'p-5 rounded-xl border flex flex-col justify-between transition-all shadow-sm bg-white ' + (isAdult ? 'border-rose-200 hover:border-rose-300' : 'border-slate-200 hover:border-orange-300')}>
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 text-xs">
                  <span className="text-slate-500 font-medium">{room.categoryLabel[language] || room.categoryLabel.en}</span>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="flex items-center gap-1 font-mono text-[10px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-700">
                      <span className={'w-1.5 h-1.5 rounded-full ' + (participants > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
                      <span>{participants} {language === 'bn' ? 'সক্রিয়' : 'active'}</span>
                    </span>
                  </div>
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">{room.name[language] || room.name.en}</h3>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-2">{room.description[language] || room.description.en}</p>
                {(room as any).flagUrl && (
                  <div className="mb-4">
                    <img src={(room as any).flagUrl} alt={room.name.en} className="w-8 h-8 rounded-sm object-cover" />
                  </div>
                )}
                {room.country && <div className="text-[10px] text-orange-600 font-mono mb-4 flex items-center gap-1"><Globe className="w-3 h-3" /><span>{room.country}</span></div>}
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <Button variant={isAdult ? (is18Verified ? 'primary' : 'danger') : 'primary'} size="md" fullWidth onClick={() => handleJoin(room)}>
                  <span>{t.rooms.joinBtn}</span>
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredRooms.length === 0 && (
        <div className="text-center py-16 border border-slate-800 rounded-xl bg-[#0c1220] p-8 space-y-3">
          <p className="text-slate-400 text-sm">
            {language === 'bn' ? 'কোনো রুম খুঁজে পাওয়া যায়নি।' : 'No rooms matching your search filter.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setSelectedMode('all');
              setSelectedLanguage('all');
              setSelectedRegion('all');
            }}
          >
            {language === 'bn' ? 'ফিল্টার রিসেট করুন' : 'Reset Filters'}
          </Button>
        </div>
      )}

      {/* Room Rules & Guidelines Inspection Modal */}
      {inspectingRoom && (
        <Modal
          isOpen={!!inspectingRoom}
          onClose={() => setInspectingRoom(null)}
          title={inspectingRoom.name[language] || inspectingRoom.name.en}
          subtitle={`${inspectingRoom.categoryLabel[language] || inspectingRoom.categoryLabel.en} · ${inspectingRoom.language.toUpperCase()}`}
        >
          <div className="space-y-5">
            <div>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                {language === 'bn' ? 'চ্যানেলের উদ্দেশ্য' : 'Channel Purpose'}
              </h4>
              <p className="text-sm text-slate-400 leading-relaxed">
                {inspectingRoom.description[language] || inspectingRoom.description.en}
              </p>
            </div>

            {inspectingRoom.country && (
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  {language === 'bn' ? 'অনুমোদিত অঞ্চল' : 'Regional Community'}
                </h4>
                <p className="text-sm text-cyan-400 font-mono">
                  {inspectingRoom.country}
                </p>
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                {language === 'bn' ? 'কমিউনিটি আচরণবিধি' : 'Channel Rules & Expectations'}
              </h4>
              <ul className="space-y-2 text-xs text-slate-400">
                {((inspectingRoom.rules && (inspectingRoom.rules[language] || inspectingRoom.rules.en)) || [
                  language === 'bn' ? 'কমিউনিটি আচরণবিধি মেনে চলুন।' : 'Respect community conduct standards.',
                ]).map((rule, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-cyan-400 font-mono select-none">#{idx + 1}</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
              <Button size="sm" variant="outline" onClick={() => setInspectingRoom(null)}>
                {language === 'bn' ? 'বন্ধ করুন' : 'Close'}
              </Button>
              <Button size="sm" variant="primary" onClick={() => handleJoin(inspectingRoom)}>
                <span>{t.rooms.joinBtn}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
};
