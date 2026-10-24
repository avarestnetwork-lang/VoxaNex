import { Room, AgeAssuranceConfig, Phase2BackendConfig } from '../types';

export const ROOMS_CONFIG: Room[] = [
  { id: 'room-bangla', slug: 'bangla', name: { en: 'Bangla Chat', bn: 'বাংলা চ্যাট' }, description: { en: 'General Bangla community chatroom for open conversations.', bn: 'মুক্ত আলোচনার জন্য সাধারণ বাংলা কমিউনিটি চ্যাটরুম।' }, category: 'bangladesh-random', categoryLabel: { en: 'General', bn: 'সাধারণ' }, language: 'bn', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/bd.png' },
  { id: 'room-sex', slug: 'sex', name: { en: 'Sex Chat', bn: 'সেক্স চ্যাট' }, description: { en: 'A main adult group chatroom for conversations with other adults.', bn: 'প্রাপ্তবয়স্কদের জন্য মূল গ্রুপ চ্যাটরুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-adult', slug: 'adult', name: { en: 'Adult Chat', bn: 'এডাল্ট চ্যাট' }, description: { en: 'A general room for adult conversations and social interaction.', bn: 'প্রাপ্তবয়স্কদের কথোপকথন এবং সামাজিক মিথস্ক্রিয়ার জন্য একটি সাধারণ রুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-video', slug: 'video', name: { en: 'Video Chat', bn: 'ভিডিও চ্যাট' }, description: { en: 'A video-focused room for adults who want to connect through webcam.', bn: 'ওয়েবক্যামের মাধ্যমে সংযোগ স্থাপনকারী প্রাপ্তবয়স্কদের জন্য ভিডিও-কেন্দ্রিক রুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text', 'video'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-roulette', slug: 'roulette', name: { en: 'Roulette Chat', bn: 'রুলেট চ্যাট' }, description: { en: 'One-to-one random matching between consenting adult users.', bn: 'সম্মতিপ্রাপ্ত প্রাপ্তবয়স্ক ব্যবহারকারীদের মধ্যে ওয়ান-টু-ওয়ান র‍্যান্ডম ম্যাচিং।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-gay', slug: 'gay', name: { en: 'Gay Chat', bn: 'গে চ্যাট' }, description: { en: 'An inclusive space for gay and bisexual adult men.', bn: 'গে এবং বাইসেক্সুয়াল প্রাপ্তবয়স্ক পুরুষদের জন্য একটি অন্তর্ভুক্তিমূলক স্থান।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-lesbian', slug: 'lesbian', name: { en: 'Lesbian Chat', bn: 'লেসবিয়ান চ্যাট' }, description: { en: 'A dedicated space for lesbian and bisexual adult women.', bn: 'লেসবিয়ান এবং বাইসেক্সুয়াল প্রাপ্তবয়স্ক নারীদের জন্য একটি নিবেদিত স্থান।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-couples', slug: 'couples', name: { en: 'Couples Chat', bn: 'দম্পতি চ্যাট' }, description: { en: 'A social room for adult couples and singles.', bn: 'প্রাপ্তবয়স্ক দম্পতি এবং সিঙ্গলদের জন্য একটি সামাজিক রুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-roleplay', slug: 'roleplay', name: { en: 'Roleplay Chat', bn: 'রোলপ্লে চ্যাট' }, description: { en: 'A room for consensual adult roleplay and storytelling.', bn: 'সম্মতিসূচক প্রাপ্তবয়স্ক রোলপ্লে এবং গল্প বলার জন্য একটি রুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-bdsm', slug: 'bdsm', name: { en: 'BDSM Chat', bn: 'বিডিএসএম চ্যাট' }, description: { en: 'A room for adults to discuss consensual kink and fetish interests.', bn: 'সম্মতিসূচক বিডিএসএম এবং ফেটিশ আগ্রহ নিয়ে আলোচনার জন্য প্রাপ্তবয়স্কদের একটি রুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-english', slug: 'english', name: { en: 'English Chat', bn: 'ইংরেজি চ্যাট' }, description: { en: 'An English-language chatroom.', bn: 'একটি ইংরেজি-ভাষার চ্যাটরুম।' }, category: 'international', categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' }, language: 'en', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-asian', slug: 'asian', name: { en: 'Asian Chat', bn: 'এশিয়ান চ্যাট' }, description: { en: 'A general chatroom for people interested in connecting across Asia.', bn: 'সারা এশিয়া জুড়ে সংযোগ স্থাপনে আগ্রহী ব্যক্তিদের জন্য একটি সাধারণ চ্যাটরুম।' }, category: 'international', categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' }, language: 'mixed', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-international', slug: 'international', name: { en: 'International Chat', bn: 'আন্তর্জাতিক চ্যাট' }, description: { en: 'A global room for conversations between people from different countries.', bn: 'বিভিন্ন দেশের মানুষের মধ্যে কথোপকথনের জন্য একটি গ্লোবাল রুম।' }, category: 'international', categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' }, language: 'mixed', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-friendship', slug: 'friendship', name: { en: 'Friendship Chat', bn: 'বন্ধুত্ব চ্যাট' }, description: { en: 'A room for making friends and having friendly conversations.', bn: 'বন্ধু তৈরি এবং বন্ধুত্বপূর্ণ কথোপকথনের জন্য একটি রুম।' }, category: 'social', categoryLabel: { en: 'Social', bn: 'সামাজিক' }, language: 'mixed', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-mature', slug: 'mature', name: { en: 'Mature Chat', bn: 'ম্যাচিউর চ্যাট' }, description: { en: 'A dedicated social chatroom for verified adult users aged 18 and older.', bn: '১৮ বছর বা তার বেশি বয়সী যাচাইকৃত প্রাপ্তবয়স্ক ব্যবহারকারীদের জন্য একটি নিবেদিত সামাজিক চ্যাটরুম।' }, category: 'adult', categoryLabel: { en: 'Adult', bn: 'প্রাপ্তবয়স্ক' }, language: 'mixed', modes: ['text'], is18Plus: true, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-usa', slug: 'usa', name: { en: 'USA Chat', bn: 'ইউএসএ চ্যাট' }, description: { en: 'A regional chatroom for users interested in connecting with people from the United States.', bn: 'মার্কিন যুক্তরাষ্ট্রের মানুষের সাথে সংযোগ স্থাপনে আগ্রহী ব্যবহারকারীদের জন্য একটি আঞ্চলিক চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'en', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/us.png' },
  { id: 'room-canada', slug: 'canada', name: { en: 'Canadian Chat', bn: 'কানাডিয়ান চ্যাট' }, description: { en: 'A regional chatroom for users interested in connecting with people from Canada.', bn: 'কানাডার মানুষের সাথে সংযোগ স্থাপনে আগ্রহী ব্যবহারকারীদের জন্য একটি আঞ্চলিক চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'en', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/ca.png' },
  { id: 'room-australia', slug: 'australia', name: { en: 'Australian Chat', bn: 'অস্ট্রেলিয়ান চ্যাট' }, description: { en: 'A regional chatroom for users interested in connecting with people from Australia.', bn: 'অস্ট্রেলিয়ার মানুষের সাথে সংযোগ স্থাপনে আগ্রহী ব্যবহারকারীদের জন্য একটি আঞ্চলিক চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'en', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/au.png' },
  { id: 'room-indian', slug: 'indian', name: { en: 'Indian Chat', bn: 'ভারতীয় চ্যাট' }, description: { en: 'An Indian-language chatroom.', bn: 'একটি ভারতীয় ভাষার চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'hi', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/in.png' },
  { id: 'room-bangladeshi', slug: 'bangladeshi', name: { en: 'Bangladeshi Chat', bn: 'বাংলাদেশি চ্যাট' }, description: { en: 'A Bangladeshi-language chatroom.', bn: 'একটি বাংলাদেশি-ভাষার চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'bn', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/bd.png' },
  { id: 'room-pakistani', slug: 'pakistani', name: { en: 'Pakistani Chat', bn: 'পাকিস্তানি চ্যাট' }, description: { en: 'A Pakistani-language chatroom.', bn: 'একটি পাকিস্তানি-ভাষার চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'ur', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/pk.png' },
  { id: 'room-german', slug: 'german', name: { en: 'German Chat', bn: 'জার্মান চ্যাট' }, description: { en: 'A German-language chatroom.', bn: 'একটি জার্মান-ভাষার চ্যাটরুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'de', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo', flagUrl: 'https://flagcdn.com/w40/de.png' },
  { id: 'room-indian-hindi', slug: 'indian/hindi', name: { en: 'Hindi Chat', bn: 'হিন্দি চ্যাট' }, description: { en: 'A dedicated room for Hindi-language conversations.', bn: 'হিন্দি-ভাষার কথোপকথনের জন্য একটি নিবেদিত রুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'hi', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-indian-tamil', slug: 'indian/tamil', name: { en: 'Tamil Chat', bn: 'তামিল চ্যাট' }, description: { en: 'A dedicated room for Tamil-language conversations.', bn: 'তামিল-ভাষার কথোপকথনের জন্য একটি নিবেদিত রুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'ta', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
  { id: 'room-indian-west-bengal', slug: 'indian/west-bengal', name: { en: 'West Bengal Chat', bn: 'পশ্চিমবঙ্গ চ্যাট' }, description: { en: 'A regional room for people interested in connecting around West Bengal and Bengali-language conversations.', bn: 'পশ্চিমবঙ্গ এবং বাংলা-ভাষার কথোপকথনের আশেপাশে সংযোগ স্থাপনে আগ্রহী ব্যক্তিদের জন্য একটি আঞ্চলিক রুম।' }, category: 'regional', categoryLabel: { en: 'Regional', bn: 'আঞ্চলিক' }, language: 'bn', modes: ['text'], is18Plus: false, requiresAccount: false, backendStatus: 'ready_local_demo' },
];

export const AGE_ASSURANCE_CONFIG: AgeAssuranceConfig = {
  minimumAge: 18,
  selfDeclarationAllowed: true,
  thirdPartyProvider: 'local_declaration_only',
  strictEnforcement: true,
  disclaimerVersion: 'v2.0-dhaka-int-2026',
  bangladeshLawsAcknowledged: true,
  internationalCompliance: {
    ukOnlineSafetyAct: true,
    avmsdCompliant: true,
    coppaStrict: true,
  },
};

export const PHASE2_BACKEND_CONFIG: Phase2BackendConfig = {
  supabaseConfigured: false,
  supabaseUrlPlaceholder: 'https://[your-project-ref].supabase.co',
  webrtcStunTurnConfigured: false,
  realtimeEngine: 'supabase_realtime_or_websocket',
};

export const EMERGENCY_CONTACTS = [
  {
    name: 'National Emergency Service (Bangladesh)',
    number: '999',
    purpose: 'Police, Ambulance & Fire Service',
    badge: 'BD 24/7 Toll Free',
  },
  {
    name: 'National Violence Against Women & Children Helpline',
    number: '109',
    purpose: 'Emergency support and immediate legal protection',
    badge: 'Govt. Helpline',
  },
  {
    name: 'Cyber Police Centre (CID Bangladesh Police)',
    number: '+880 1769691522',
    purpose: 'Cyber harassment, blackmail, and online abuse reporting',
    badge: 'Cyber Crime Unit',
  },
  {
    name: 'Kaan Pete Roi (Emotional Support & Suicide Prevention BD)',
    number: '+880 1779554391',
    purpose: 'Confidential mental health support and active listening',
    badge: 'Crisis Line',
  },
  {
    name: 'International Child Abuse / CSAM Reporting (NCMEC)',
    number: 'report.cybertip.org',
    purpose: 'Global portal for reporting exploitation material',
    badge: 'Global Portal',
  },
];
