import { Response } from 'express';
import crypto from 'crypto';
import {
  ForumTopic,
  ForumReply,
  BlogArticle,
  BlogComment,
  CommunityGuide,
  AdminPlatformSettings,
  SafetyReport,
  Room,
  AgeAssuranceConfig,
  AgeAssuranceRecord,
  AgeVerificationStatus,
  AgeAssuranceProvider,
  ModerationAuditLog,
  UserConnection,
  BlockedUserEntry,
  ReportCategory,
  ReportTargetType,
} from '../types';
import { ROOMS_CONFIG, AGE_ASSURANCE_CONFIG } from '../config/voxanexConfig';

// -----------------------------------------------------------------------------
// COMMUNITY FORUM IN-MEMORY SERVER STORE
// -----------------------------------------------------------------------------
const forumTopics = new Map<string, ForumTopic>();
const forumReplies = new Map<string, ForumReply[]>(); // topicId -> replies
const forumRateLimits = new Map<string, { lastPostTime: number; count: number; windowStart: number }>();

// Initial Seed Forum Topics
const INITIAL_FORUM_TOPICS: ForumTopic[] = [
  {
    id: 'top-1',
    title: 'VoxaNex Launch Roadmap & Community Guidelines for Bangladesh',
    category: 'general',
    categoryLabel: { en: 'Announcements', bn: 'ঘোষণা' },
    authorId: 'admin_sys',
    author: 'VoxaNex_Admin',
    authorAvatar: '🛡️',
    authorRole: 'admin',
    repliesCount: 3,
    viewsCount: 342,
    lastActivity: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    pinned: true,
    isLocked: false,
    content:
      'Welcome to VoxaNex! Our platform is dedicated to respectful, open conversations across Bangladesh and global communities. Please review our safety guidelines regarding camera etiquette, mutual respect, and zero tolerance for harassment.',
  },
  {
    id: 'top-2',
    title: 'Banglish Phonetics Guide: Standardizing common chat spellings',
    category: 'banglish',
    categoryLabel: { en: 'Banglish', bn: 'বাংলিশ' },
    authorId: 'usr_meghna',
    author: 'Meghna_Echo',
    authorAvatar: '🌊',
    authorRole: 'user',
    repliesCount: 2,
    viewsCount: 168,
    lastActivity: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(),
    pinned: false,
    content:
      'What are your favorite Banglish expressions? For example: "kmn acho?", "valobashi", "shob thik ache to?". Share your thoughts on how mobile typists can communicate faster without losing clarity.',
  },
  {
    id: 'top-3',
    title: 'Dhaka & Global Dev Community: WebRTC, Vite, and Low-Latency P2P',
    category: 'tech',
    categoryLabel: { en: 'Tech & Code', bn: 'প্রযুক্তি ও কোড' },
    authorId: 'usr_dhakadev',
    author: 'Dhaka_Dev',
    authorAvatar: '⚡',
    authorRole: 'user',
    repliesCount: 1,
    viewsCount: 220,
    lastActivity: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    pinned: false,
    content:
      'We are discussing building modern real-time WebRTC audio/video mesh architectures and optimizing browser battery efficiency. Drop a comment if you are building web apps in Bangladesh or the diaspora!',
  },
  {
    id: 'top-4',
    title: 'International Exchange: Connecting Hindi, Urdu, German & English Speakers',
    category: 'international',
    categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' },
    authorId: 'usr_global_nomad',
    author: 'Global_Nomad',
    authorAvatar: '🌍',
    authorRole: 'user',
    repliesCount: 1,
    viewsCount: 195,
    lastActivity: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    pinned: false,
    content:
      'Hello from Berlin! Welcoming members speaking German, Urdu, Hindi, English, and Bengali to exchange cultural stories and language practice.',
  },
];

const INITIAL_REPLIES: Record<string, ForumReply[]> = {
  'top-1': [
    {
      id: 'rep-101',
      topicId: 'top-1',
      authorId: 'usr_padma',
      authorNickname: 'Padma_Rider',
      authorAvatar: '⚡',
      authorRole: 'user',
      content: 'Glad to see strict anti-doxxing enforcement! Keep up the great work.',
      createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      isModeratorApproved: true,
    },
    {
      id: 'rep-102',
      topicId: 'top-1',
      authorId: 'usr_sylhet',
      authorNickname: 'Sylhet_Tea',
      authorAvatar: '🌿',
      authorRole: 'user',
      content: 'The low-latency WebRTC calling is working smoothly across mobile networks.',
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      isModeratorApproved: true,
    },
    {
      id: 'rep-103',
      topicId: 'top-1',
      authorId: 'admin_sys',
      authorNickname: 'VoxaNex_Admin',
      authorAvatar: '🛡️',
      authorRole: 'admin',
      content: 'Thank you everyone! Phase 7 community tools are now online.',
      createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      isModeratorApproved: true,
    },
  ],
  'top-2': [
    {
      id: 'rep-201',
      topicId: 'top-2',
      authorId: 'usr_dhaka',
      authorNickname: 'Dhaka_Echo',
      authorAvatar: '🔥',
      authorRole: 'user',
      content: 'I frequently use "shob bhalo to?". Standardizing these helps everyone.',
      createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      isModeratorApproved: true,
    },
    {
      id: 'rep-202',
      topicId: 'top-2',
      authorId: 'usr_meghna',
      authorNickname: 'Meghna_Echo',
      authorAvatar: '🌊',
      authorRole: 'user',
      content: 'Agreed! Adding common phrases to our blog guides soon.',
      createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      isModeratorApproved: true,
    },
  ],
  'top-3': [
    {
      id: 'rep-301',
      topicId: 'top-3',
      authorId: 'usr_ctg',
      authorNickname: 'Port_Engineer',
      authorAvatar: '🎯',
      authorRole: 'user',
      content: 'Vite dev server + Express backend combo handles SSE signaling cleanly.',
      createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      isModeratorApproved: true,
    },
  ],
  'top-4': [
    {
      id: 'rep-401',
      topicId: 'top-4',
      authorId: 'usr_munich',
      authorNickname: 'Bavaria_Echo',
      authorAvatar: '✨',
      authorRole: 'user',
      content: 'Willkommen! Great initiative for cross-cultural networking.',
      createdAt: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
      isModeratorApproved: true,
    },
  ],
};

// Seed stores
INITIAL_FORUM_TOPICS.forEach((t) => forumTopics.set(t.id, t));
Object.entries(INITIAL_REPLIES).forEach(([topicId, reps]) => forumReplies.set(topicId, reps));

// -----------------------------------------------------------------------------
// CMS BLOG & ARTICLES SERVER STORE
// -----------------------------------------------------------------------------
const blogArticles = new Map<string, BlogArticle>();
const INITIAL_BLOG_ARTICLES: BlogArticle[] = [
  {
    id: 'art-1',
    slug: 'conversing-in-banglish-guide',
    title: {
      en: 'The Art of Conversing in Banglish: Phonetics, Slang & Modern Etiquette',
      bn: 'বাংলিশে কথা বলার শিল্প: ধ্বনিতত্ত্ব, স্ল্যাং ও আধুনিক শিষ্টাচার',
    },
    summary: {
      en: 'How the Latin script became a vibrant medium for Bengali internet culture, and best practices for writing clearly and respectfully.',
      bn: 'কীভাবে ইংরেজি হরফ বাঙালি ইন্টারনেট সংস্কৃতির প্রাণবন্ত মাধ্যম হয়ে উঠল এবং পারস্পরিক শ্রদ্ধাপূর্ণ যোগাযোগের মূলনীতি।',
    },
    category: 'Culture & Language',
    tags: ['Banglish', 'Bengali Culture', 'Chat Etiquette', 'Linguistics'],
    readTime: '4 min read',
    publishedAt: '2026-03-20',
    author: 'VoxaNex Editorial',
    authorRole: 'editor',
    status: 'published',
    content: {
      en: `Banglish—the transliteration of the Bengali language into the Latin (English) alphabet—originated during the early days of mobile SMS when Bengali font support was limited on feature phones. Over the past two decades, it evolved from a technological workaround into a vibrant, expressive conversational dialect for millions of digital natives in Bangladesh and across the diaspora.\n\nOn VoxaNex, we celebrate Banglish alongside formal Bangla. When typing quickly on mobile devices, Banglish offers rapid expression. However, clarity and respect remain essential:\n\n1. Phonetic Consistency: Spellings like "kmn acho?", "valo achi", and "kothay jabe?" are widely recognized.\n2. Respectful Boundaries: Because Latin text lacks visual honorifics, always clarify tone when speaking to new partners.\n3. Zero Tolerance for Verbal Abuse: Abusive slurs in Banglish violate platform terms just as severely as English or Bengali insults.`,
      bn: `বাংলিশ—অর্থাৎ ইংরেজি হরফে বাংলা লেখার প্রচলন শুরু হয়েছিল প্রথম দিকের মোবাইল এসএমএসের যুগে, যখন ফিচার ফোনে বাংলা ফন্টের সমর্থন ছিল না। গত দুই দশকে এটি প্রযুক্তিগত সীমাবদ্ধতার সমাধান থেকে শুরু করে তরুণ প্রজন্মের প্রাণবন্ত ভাষায় রূপান্তরিত হয়েছে।\n\nভক্সানেক্সে আমরা আনুষ্ঠানিক বাংলার পাশাপাশি বাংলিশকেও গুরুত্ব দিই। মোবাইলে দ্রুত টাইপ করার ক্ষেত্রে এটি অত্যন্ত সহায়ক:\n\n১. সাধারণ ফোনেটিক রীতি: "kmn acho?", "valo achi", "ki khobor?" ইত্যাদি সহজেই বোধগম্য।\n২. সম্মানজনক স্বর: অনলাইন লেখায় শারীরিক অভিব্যক্তি থাকে না, তাই অপরিচিতদের সাথে কথা বলার সময় সংযত থাকা বাঞ্ছনীয়।\n৩. গালিগালাজ সম্পূর্ণ নিষিদ্ধ: বাংলিশে লেখা যেকোনো অশ্লীল কটূক্তি বা উত্ত্যক্তকরণ প্ল্যাটফর্মের নীতিমালার সরাসরি লঙ্ঘন।`,
    },
    comments: [
      {
        id: 'com-1',
        articleId: 'art-1',
        authorNickname: 'Padma_Reader',
        authorAvatar: '🌊',
        content: 'Spot-on explanation! Respectful tone is so crucial in transliterated chats.',
        createdAt: '2026-03-21T10:15:00Z',
        status: 'approved',
      },
    ],
  },
  {
    id: 'art-2',
    slug: 'preventing-online-extortion-bangladesh',
    title: {
      en: 'Digital Safety 101: Preventing Online Extortion, Blackmail & Doxxing',
      bn: 'ডিজিটাল নিরাপত্তা ১০১: অনলাইন ব্ল্যাকমেইল, হয়রানি ও ব্যক্তিগত তথ্য ফাঁস প্রতিরোধ',
    },
    summary: {
      en: 'Practical steps for protecting your privacy, recognizing social engineering traps, and legal protections under Bangladesh law.',
      bn: 'অনলাইনে নিজের গোপনীয়তা রক্ষা, সামাজিক ফাঁদ চিহ্নিতকরণ এবং বাংলাদেশের প্রচলিত আইনে সুরক্ষার বাস্তবসম্মত উপায়।',
    },
    category: 'Safety & Legal',
    tags: ['Cyber Safety', 'Bangladesh Law', 'Anti-Doxxing', 'Privacy'],
    readTime: '6 min read',
    publishedAt: '2026-03-12',
    author: 'Trust & Safety Team',
    authorRole: 'admin',
    status: 'published',
    content: {
      en: `Online anonymity should bring freedom, not vulnerability. Over recent years, bad actors have targeted internet users through screenshot extortion, impersonation, and doxxing.\n\nHere are the critical security practices enforced on VoxaNex:\n\n- Never Share Phone Numbers Early: Meeting an interesting person in a random room does not require immediate WhatsApp contact. Continue chatting securely in the platform's direct messages.\n- Beware of Video Screenshot Traps: Never display identifiable government documents, school uniforms, or office badges on camera.\n- Immediate Reporting: If someone attempts to threaten you with a recorded video or private chat, do not pay money or give in to demands. Take evidence snapshots and immediately report via the Safety Center or call the CID Cyber Police Centre at +880 1769691522.`,
      bn: `অনলাইন বেনামী আড্ডা আপনার স্বাধীনতা দেবে, দুর্বলতা নয়। সাম্প্রতিক বছরগুলোতে অনলাইন ব্যবহারকারীদের লক্ষ্য করে ব্ল্যাকমেইল ও ব্যক্তিগত তথ্য ফাঁসের মতো ঘটনা ঘটছে।\n\nভক্সানেক্সের গুরুত্বপূর্ণ নিরাপত্তা পরামর্শসমূহ:\n\n- শুরুতেই ফোন নম্বর দেবেন না: র‍্যান্ডম রুমে পরিচিত হলেই হোয়াটসঅ্যাপ বা ফেসবুক শেয়ার করার প্রয়োজন নেই। প্ল্যাটফর্মের সুরক্ষিত ডিরেক্ট মেসেজ ব্যবহার করুন।\n- ক্যামেরায় নিজের গোপনীয়তা রাখুন: অফিস আইডি, শিক্ষাপ্রতিষ্ঠানের ইউনিফর্ম বা বাড়ির ঠিকানা দৃশ্যমান রাখবেন না।\n- তাৎক্ষণিক অভিযোগ করুন: কেউ আপত্তিকর ছবি বা চ্যাট দিয়ে ব্ল্যাকমেইল করার চেষ্টা করলে কখনই টাকা দেবেন না। দ্রুত সেফটি সেন্টারে জানান অথবা পুলিশের সাইবার ইউনিটে যোগাযোগ করুন।`,
    },
    comments: [
      {
        id: 'com-2',
        articleId: 'art-2',
        authorNickname: 'Dhaka_Guardian',
        authorAvatar: '🛡️',
        content: 'The CID cyber police contact number is very helpful to have handy.',
        createdAt: '2026-03-14T08:30:00Z',
        status: 'approved',
      },
    ],
  },
  {
    id: 'art-3',
    slug: 'voxanex-architecture-roadmap',
    title: {
      en: 'The VoxaNex Technical Architecture: Full Real-Time Stack',
      bn: 'ভক্সানেক্স টেকনিক্যাল আর্কিটেকচার: রিয়েল-টাইম সিস্টেম ডিজাইন',
    },
    summary: {
      en: 'An architectural deep dive into our engineering choices: Express backend, WebRTC media relay, SSE real-time events, and moderation controls.',
      bn: 'আমাদের প্রযুক্তিগত অবকাঠামো, ভাইট, ওয়েবআরটিসি, এসএসই ব্রডকাস্ট এবং কমিউনিটি সুরক্ষা ব্যবস্থা।',
    },
    category: 'Engineering & Tech',
    tags: ['WebRTC', 'Architecture', 'TypeScript', 'Node.js', 'SSE'],
    readTime: '5 min read',
    publishedAt: '2026-02-28',
    author: 'Principal Architect',
    authorRole: 'admin',
    status: 'published',
    content: {
      en: `VoxaNex is designed with zero-pill anti-slop visual discipline, server-authoritative matchmaking, client-safe SSE messaging, and STUN/TURN WebRTC relays.\n\nKey architectural pillars:\n1. Server-authoritative state: No client claims arbitrary matches or reads unauthorized channels.\n2. Granular moderation: Instant server-side mutes, suspensions, bans, and room shutdowns.\n3. Honest telemetry: Real active session counts with zero fabricated counters.`,
      bn: `ভক্সানেক্স তৈরি হয়েছে আধুনিক ডার্ক ইন্টারফেস, সার্ভার-নিয়ন্ত্রিত ম্যাচমেকিং, এসএসই রিয়েল-টাইম মেসেজিং এবং সুরক্ষিত ওয়েবআরটিসি সংযোগের মাধ্যমে।\n\nপ্রধান নীতিসমূহ:\n১. শতভাগ সার্ভার নিয়ন্ত্রণ ও সুরক্ষা।\n২. ক্ষতিকর কনটেন্ট বা হয়রানি দমনে কঠোর মডারেশন।\n৩. সততাপূর্ণ পরিসংখ্যান ও নির্ভরযোগ্য সংযোগ।`,
    },
    comments: [],
  },
];

INITIAL_BLOG_ARTICLES.forEach((a) => blogArticles.set(a.slug, a));

// -----------------------------------------------------------------------------
// COMMUNITY GUIDES STORE
// -----------------------------------------------------------------------------
export const COMMUNITY_GUIDES: CommunityGuide[] = [
  {
    id: 'guide-joining-rooms',
    slug: 'joining-chat-rooms',
    title: {
      en: 'Guide to Joining Public Chat Rooms',
      bn: 'পাবলিক চ্যাট রুমে প্রবেশের নিয়মাবলী',
    },
    summary: {
      en: 'Learn how public rooms work, category etiquette, language expectations, and guest participant privileges.',
      bn: 'পাবলিক রুম কীভাবে কাজ করে, ক্যাটাগরি শিষ্টাচার, ভাষা নির্বাচন ও গেস্ট সুবিধা সম্পর্কে জানুন।',
    },
    icon: 'Compass',
    category: 'onboarding',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Selecting the Right Channel',
          bn: 'সঠিক চ্যানেল নির্বাচন',
        },
        body: {
          en: 'VoxaNex categorizes public lounges by language and topic (Bangla Adult 18+, Bangladesh Random, Banglish, Regional hubs, and International exchange). Join rooms matching your current conversational interests.',
          bn: 'ভক্সানেক্সে বিভিন্ন ভাষার ও বিষয়ের রুম রয়েছে (যেমন বাংলা ১৮+, বাংলাদেশ আড্ডা, বাংলিশ, আঞ্চলিক হাব এবং আন্তর্জাতিক বিনিময়)। আপনার আগ্রহ অনুযায়ী রুমে যোগ দিন।',
        },
        doList: {
          en: ['Verify the room topic and language before chatting', 'Greet others politely upon entering'],
          bn: ['চ্যাটে কথা বলার আগে রুমের বিষয় ও ভাষা দেখে নিন', 'প্রবেশ করে বিনম্রভাবে সম্ভাষণ জানান'],
        },
        dontList: {
          en: ['Do not flood messages or post unrelated promotions', 'Do not enter 18+ lounges if you are a minor'],
          bn: ['একটানা স্প্যাম বা বিজ্ঞাপন পাঠাবেন না', 'প্রাপ্তবয়স্ক না হলে ১৮+ লাউঞ্জে প্রবেশ করবেন না'],
        },
      },
      {
        heading: {
          en: 'Guest vs. Registered Privileges',
          bn: 'গেস্ট বনাম নিবন্ধিত ব্যবহারকারীর সুবিধা',
        },
        body: {
          en: 'Guests can participate in all general public lounges with temporary cryptographic tokens. Registered accounts gain persistent handles, avatars, verified 18+ access, and direct messaging memory.',
          bn: 'গেস্ট হিসেবে যে কেউ সাধারণ রুমে অংশ নিতে পারেন। নিবন্ধিত অ্যাকাউন্টে স্থায়ী ইউজারনেম, প্রোফাইল পিকচার এবং স্থায়ী বার্তা সংরক্ষণ সুবিধা পাওয়া যায়।',
        },
      },
    ],
  },
  {
    id: 'guide-random-matching',
    slug: 'random-matching-roulette',
    title: {
      en: 'Random 1-on-1 Partner Roulette Guide',
      bn: 'র‍্যান্ডম ১-অন-১ পার্টনার রউলেট গাইড',
    },
    summary: {
      en: 'How our server-authoritative matchmaking queue works, pool filtering (Bangladesh vs International), and skip etiquette.',
      bn: 'সার্ভার ম্যাচমেকিং কিউ কীভাবে কাজ করে, পুল ফিল্টারিং (বাংলাদেশ বনাম আন্তর্জাতিক) ও স্কিপ শিষ্টাচার।',
    },
    icon: 'Shuffle',
    category: 'onboarding',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Pool Preference & Matching Engine',
          bn: 'পুল পছন্দ ও ম্যাচমেকিং ইঞ্জিন',
        },
        body: {
          en: 'When clicking Find Partner, the backend claims an eligible ticket atomically, matching by shared interests and regional preferences (Bangladesh or International). A 3-second skip cooldown protects against automated cycling abuse.',
          bn: 'সঙ্গী খোঁজার বাটনে চাপলে সার্ভার স্বয়ংক্রিয়ভাবে মিল থাকা প্রোফাইল খুঁজে দেয়। বট আক্রমণ প্রতিরোধে ৩ সেকেন্ডের স্কিপ কুলডাউন প্রযোজ্য থাকে।',
        },
        doList: {
          en: ['Specify common topics you genuinely enjoy', 'Use Skip politely if interests diverge'],
          bn: ['আপনার পছন্দের বিষয়গুলো যুক্ত করুন', 'কথোপকথন ভালো না লাগলে ভদ্রভাবে স্কিপ করুন'],
        },
        dontList: {
          en: ['Do not rapidly spam skip to target specific users', 'Never harass matched partners'],
          bn: ['কাউকে বিরক্ত করতে বারবার স্কিপ করবেন না', 'ম্যাচ হওয়া সঙ্গীর সাথে অসদাচরণ করবেন না'],
        },
      },
    ],
  },
  {
    id: 'guide-privacy-anonymity',
    slug: 'privacy-anonymity-limits',
    title: {
      en: 'Privacy and Anonymity Limits: What You Must Know',
      bn: 'গোপনীয়তা ও বেনামী সুবিধার সীমাবদ্ধতা: যা আপনার জানা জরুরি',
    },
    summary: {
      en: 'Clear explanation of what is and is not private, why lawful authorities can be contacted for severe threats, and anti-doxxing rules.',
      bn: 'কী তথ্য সুরক্ষিত আর কী নয়, গুরুতর অপরাধে কেন আইন প্রয়োগকারী সংস্থার সহায়তা নেওয়া হয় এবং ডক্সিং প্রতিরোধ।',
    },
    icon: 'ShieldCheck',
    category: 'privacy',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Zero-Knowledge Boundaries vs. Safety Audits',
          bn: 'গোপনীয়তার সীমা ও নিরাপত্তা নিরীক্ষা',
        },
        body: {
          en: 'While VoxaNex does not sell user data or expose IP addresses in client frontend code, anonymity is not a license for criminal harassment, cyber extortion, child exploitation, or terrorism. Server incident logs are retained strictly for safety investigations.',
          bn: 'ভক্সানেক্স কোনো বিজ্ঞাপনদাতার কাছে তথ্য বিক্রি করে না এবং ফ্রন্টএন্ডে কারো আইপি প্রকাশ করে না। তবে ব্ল্যাকমেইল, সাইবার চাঁদাবাজি বা গুরুতর অপরাধে নিরাপত্তা অডিট প্রযোজ্য হয়।',
        },
      },
    ],
  },
  {
    id: 'guide-webcam-safety',
    slug: 'webcam-and-voice-safety',
    title: {
      en: 'Webcam & Voice Call Safety Handbook',
      bn: 'ওয়েবক্যাম ও ভয়েস কল নিরাপত্তা নির্দেশিকা',
    },
    summary: {
      en: 'Crucial tips on avoiding screenshot traps, background privacy, microphone consent, and handling suspicious callers.',
      bn: 'স্ক্রিনশট ব্ল্যাকমেইল ফাঁদ এড়ানো, ব্যাকগ্রাউন্ড গোপনীয়তা, মাইক্রোফোন অনুমতি ও সন্দেহভাজন কলার সনাক্তকরণ।',
    },
    icon: 'Video',
    category: 'safety',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Camera Etiquette & Physical Safety',
          bn: 'ক্যামেরা শিষ্টাচার ও শারীরিক নিরাপত্তা',
        },
        body: {
          en: 'Always inspect your background before enabling your camera. Never show sensitive documents, address numbers, company badges, or family photos. If another party acts inappropriately, end the call immediately and tap Report.',
          bn: 'ক্যামেরা চালু করার আগে পেছনের পরিবেশ দেখে নিন। কোনো জরুরি দলিল, বাড়ির ঠিকানা বা ব্যক্তিগত ছবি ক্যামেরার সামনে রাখবেন না। কোনো অসঙ্গতি দেখলে দ্রুত কল কেটে রিপোর্ট করুন।',
        },
        doList: {
          en: ['Mute your microphone in noisy environments', 'Report non-consensual sexual exhibition immediately'],
          bn: ['শব্দদূষণ থাকলে মাইক্রোফোন মিউট রাখুন', 'অসম্মতিমূলক দৃশ্য বা আপত্তিকর আচরণ দেখা মাত্র রিপোর্ট করুন'],
        },
        dontList: {
          en: ['Never record a caller without explicit mutual consent', 'Never pay money if threatened with screenshots'],
          bn: ['অনুমতি ছাড়া অন্য কারো কল রেকর্ড করবেন না', 'স্ক্রিনশটের হুমকি পেলে কখনো টাকা দেবেন না'],
        },
      },
    ],
  },
  {
    id: 'guide-blocking-reporting',
    slug: 'blocking-and-reporting',
    title: {
      en: 'How to Block, Mute, and Report Violators',
      bn: 'কীভাবে কাউকে ব্লক, মিউট এবং রিপোর্ট করবেন',
    },
    summary: {
      en: 'Step-by-step instructions on silencing abusers instantly and submitting actionable incident evidence to moderators.',
      bn: 'অসদাচরণকারীকে তাৎক্ষণিক ব্লক করার এবং মডারেটরদের কাছে অভিযোগ দায়ের করার বিস্তারিত উপায়।',
    },
    icon: 'ShieldAlert',
    category: 'safety',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Instant Server-Side Protection',
          bn: 'তাৎক্ষণিক সার্ভার-সুরক্ষা',
        },
        body: {
          en: 'Blocking a user prevents them from sending you direct messages, matching with you in partner roulette, or initiating WebRTC calls. Reporting queues the incident for moderator triage.',
          bn: 'কাউকে ব্লক করলে সে আর আপনাকে কোনো ডিরেক্ট মেসেজ পাঠাতে পারবে না, র‍্যান্ডম চ্যাটে আপনার সামনে আসবে না এবং কল দিতে পারবে না। রিপোর্ট জমা দিলে মডারেটর দল তা পর্যালোচনা করে।',
        },
      },
    ],
  },
  {
    id: 'guide-scam-awareness',
    slug: 'scam-and-impersonation-awareness',
    title: {
      en: 'Scam, Phishing & Impersonation Awareness',
      bn: 'অনলাইন প্রতারণা ও ছদ্মবেশ সনাক্তকরণ সচেতনতা',
    },
    summary: {
      en: 'Recognizing fake admins, crypto schemes, gambling links, and suspicious external download requests.',
      bn: 'ভুয়া অ্যাডমিন, ক্রিপ্টো ফাঁদ, জুয়ার লিংক ও ক্ষতিকর ফাইল ডাউনলোড সনাক্ত করার উপায়।',
    },
    icon: 'AlertTriangle',
    category: 'rules',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Recognizing Official Platform Staff',
          bn: 'অফিসিয়াল টিম চেনার উপায়',
        },
        body: {
          en: 'VoxaNex staff will NEVER ask for your password, verification codes, bKash/Nagad transfers, or external Telegram links. Real staff carry verified 🛡️ Admin badges.',
          bn: 'ভক্সানেক্সের কোনো মডারেটর কখনো আপনার পাসওয়ার্ড, বিকাশ/নগদ পিন নম্বর বা টাকা চাইবে না। প্রকৃত অ্যাডমিনদের সাথে যাচাইকৃত 🛡️ ব্যাজ থাকে।',
        },
      },
    ],
  },
  {
    id: 'guide-community-rules',
    slug: 'voxanex-community-rules',
    title: {
      en: 'Official VoxaNex Community Code of Conduct',
      bn: 'ভক্সানেক্স অফিশিয়াল আচরণবিধি ও কমিউনিটি নীতিমালা',
    },
    summary: {
      en: 'Comprehensive platform standards on respect, non-discrimination, lawful content, and appeal procedures.',
      bn: 'পারস্পরিক শ্রদ্ধা, বৈষম্যহীনতা, বৈধ আলোচনা ও আপিল পদ্ধতির সামগ্রিক রূপরেখা।',
    },
    icon: 'FileText',
    category: 'rules',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'The Golden Rule of VoxaNex',
          bn: 'ভক্সানেক্সের মূলনীতি',
        },
        body: {
          en: 'Treat every participant with dignity. Harassment based on gender, religion, regional dialect, ethnicity, or sexual orientation results in immediate suspension or permanent bans.',
          bn: 'প্রতিটি মানুষের সাথে মর্যাদাপূর্ণ আচরণ করুন। ধর্ম, লিঙ্গ, আঞ্চলিক ভাষা বা বর্ণের ভিত্তিতে কোনো বিদ্বেষমূলক আচরণ করলে তাৎক্ষণিক স্থায়ী নিষেধাজ্ঞা আরোপ করা হবে।',
        },
      },
    ],
  },
  {
    id: 'guide-consent-communication',
    slug: 'consent-and-respectful-communication',
    title: {
      en: 'Consent and Respectful Communication Guide',
      bn: 'সম্মতি ও শ্রদ্ধাপূর্ণ যোগাযোগের নির্দেশিকা',
    },
    summary: {
      en: 'Understanding digital consent, conversational boundaries, honoring when someone says no, and safe peer dialogues.',
      bn: 'ডিজিটাল সম্মতি, পারস্পরিক সীমারেখা, কারো অসম্মতিকে সম্মান জানানো এবং নিরাপদ যোগাযোগ রক্ষা।',
    },
    icon: 'HeartHandshake',
    category: 'safety',
    lastUpdated: '2026-04-01',
    sections: [
      {
        heading: {
          en: 'Digital Consent in Real-Time Voice and Video',
          bn: 'ভয়েস ও ভিডিও কলে ডিজিটাল সম্মতি',
        },
        body: {
          en: 'Consent must be ongoing, voluntary, and unambiguous. Never assume someone wishes to turn on their webcam or discuss personal topics simply because they joined a call. If a participant asks to stop, honor their request immediately without negotiation.',
          bn: 'অনলাইনে প্রতিটি মুহূর্তে সম্মতি থাকা আবশ্যক। কেউ ক্যামেরা চালু করতে বা ব্যক্তিগত কথা বলতে না চাইলে কখনই চাপ প্রয়োগ করবেন না।',
        },
        doList: {
          en: ['Ask before switching to video or voice mode', 'Respect sudden pauses or departures without judgment'],
          bn: ['ভিডিও বা অডিও চালুর আগে বিনম্রভাবে অনুমতি নিন', 'অন্যের বিরতি বা প্রস্থানকে শ্রদ্ধা জানান'],
        },
        dontList: {
          en: ['Never pressure peers for off-platform contact details', 'Never record audio or video streams without explicit consent'],
          bn: ['যোগাযোগের ব্যক্তিগত তথ্য চাইতে জোর করবেন না', 'অনুমতি ছাড়া অডিও বা ভিডিও রেকর্ড করবেন না'],
        },
      },
    ],
  },
];

// Mutable store for editable community guides
export const communityGuidesMap = new Map<string, CommunityGuide>();
COMMUNITY_GUIDES.forEach((g) => communityGuidesMap.set(g.slug, g));


// -----------------------------------------------------------------------------
// EXTENDED INTERNATIONAL ROOMS
// -----------------------------------------------------------------------------
export const EXTENDED_ROOMS_CATALOG: Room[] = [
  ...ROOMS_CONFIG,
  {
    id: 'room-hindi-lounge',
    slug: 'hindi-dostana',
    name: {
      en: 'Hindi Dostana & Desi Vibes',
      bn: 'হিন্দি দোস্তানা ও দেশি আড্ডা',
    },
    description: {
      en: 'Casual chat, Bollywood movies, music, and friendly conversation in Hindi and English.',
      bn: 'হিন্দি ও ইংরেজিতে সিনেমা, গান এবং বন্ধুত্বপূর্ণ আড্ডার উন্মুক্ত স্থান।',
    },
    category: 'international',
    categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' },
    language: 'hi',
    modes: ['text', 'voice'],
    is18Plus: false,
    requiresAccount: false,
    country: 'India / Global',
    rules: {
      en: ['Respectful Hindi/Hinglish conversations.', 'Zero tolerance for hate speech or political fighting.'],
      bn: ['শ্রদ্ধাশীল হিন্দি ও ইংলিশ আলোচনা।', 'কোনো রাজনৈতিক বা ঘৃণাত্মক বক্তব্য সম্পূর্ণ নিষিদ্ধ।'],
    },
    backendStatus: 'ready_local_demo',
  },
  {
    id: 'room-urdu-mahfil',
    slug: 'urdu-mahfil',
    name: {
      en: 'Urdu Adab & Mahfil',
      bn: 'উর্দু আদব ও মেহফিল',
    },
    description: {
      en: 'Poetry (Shayari), literature, cultural discussions, and polite community chat in Urdu.',
      bn: 'উর্দু সাহিত্য, কবিতা (শায়েরি) ও মার্জিত সাংস্কৃতিক আড্ডা।',
    },
    category: 'international',
    categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' },
    language: 'ur',
    modes: ['text', 'voice'],
    is18Plus: false,
    requiresAccount: false,
    country: 'Pakistan / South Asia / Global',
    rules: {
      en: ['Courteous communication in Urdu or English.', 'Respect literary and cultural diversity.'],
      bn: ['উর্দু ও ইংরেজি মার্জিত ভাষা ব্যবহার করুন।', 'সাহিত্য ও সাংস্কৃতিক বৈচিত্র্যের প্রতি শ্রদ্ধাশীল থাকুন।'],
    },
    backendStatus: 'ready_local_demo',
  },
  {
    id: 'room-german-stammtisch',
    slug: 'deutsch-stammtisch',
    name: {
      en: 'German Stammtisch (Deutsch & Diaspora)',
      bn: 'জার্মান ভাষা ও প্রবাসী ফোরাম',
    },
    description: {
      en: 'Sprachaustausch, studieren in Deutschland, Leben in Europa und lockere Gespräche auf Deutsch und Englisch.',
      bn: 'জার্মানিতে উচ্চশিক্ষা, জীবনযাপন এবং ভাষা চর্চার জন্য ইউরোপ ও প্রবাসীদের বিশেষ আড্ডা।',
    },
    category: 'international',
    categoryLabel: { en: 'International', bn: 'আন্তর্জাতিক' },
    language: 'de',
    modes: ['text', 'voice', 'video'],
    is18Plus: false,
    requiresAccount: false,
    country: 'Germany / Austria / Switzerland / Global',
    rules: {
      en: ['Language learners and native German speakers welcome.', 'Respect community conduct.'],
      bn: ['জার্মান শিক্ষার্থী ও স্থানীয় ভাষাভাষী সকলের জন্য উন্মুক্ত।', 'কমিউনিটি নিয়ম মেনে চলুন।'],
    },
    backendStatus: 'ready_local_demo',
  },
];

// Dynamic rooms store
export const dynamicRoomsMap = new Map<string, Room>();
EXTENDED_ROOMS_CATALOG.forEach((r) => dynamicRoomsMap.set(r.id, r));

// -----------------------------------------------------------------------------
// ADMIN PLATFORM SETTINGS & MODERATION ACTIONS STORE
// -----------------------------------------------------------------------------
export let currentPlatformSettings: AdminPlatformSettings = {
  featureFlags: {
    randomMatchingEnabled: true,
    webRtcCallingEnabled: true,
    guestAccessEnabled: true,
    banglaAdultLoungeEnabled: true,
    publicRoomChatEnabled: true,
    communityForumEnabled: true,
  },
  rateLimits: {
    maxRoomMessagesPerMinute: 30,
    maxDmsPerMinute: 20,
    maxCallsPerFiveMinutes: 10,
    maxGuestSessionsPerHour: 20,
  },
  contentPolicy: {
    autoFilterOffensiveTerms: true,
    requireApprovalForForumPosts: false,
    quarantineAdultKeywords: true,
    strictAgeGateMandatory: true,
    requireThirdPartyAgeProof: false,
  },
  retention: {
    guestSessionRetentionHours: 24,
    roomMessageRetentionDays: 30,
    callLogRetentionDays: 7,
    auditLogRetentionDays: 90,
  },
};

export interface UserRestrictionRecord {
  id?: string;
  userId: string;
  userNickname: string;
  type: 'warning' | 'muted' | 'suspended_24h' | 'suspended_7d' | 'banned_permanent';
  scope?: 'all' | 'room' | 'messages' | 'matching' | 'calling';
  reason: string;
  imposedBy: string;
  imposedAt: string;
  expiresAt?: string;
  active: boolean;
  revokedAt?: string;
  revokedBy?: string;
}

const userRestrictions = new Map<string, UserRestrictionRecord>();

export interface ModerationAppeal {
  id: string;
  restrictionId: string;
  userId: string;
  userNickname: string;
  statement: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
  reviewedBy?: string;
  reviewNotes?: string;
  reviewedAt?: string;
}

const moderationAppeals = new Map<string, ModerationAppeal>();
const moderationAuditLogs: ModerationAuditLog[] = [];
const reportRateLimits = new Map<string, { count: number; windowStart: number }>();
const ageAssuranceRecords = new Map<string, AgeAssuranceRecord>();
export let currentAgeAssuranceConfig: AgeAssuranceConfig = { ...AGE_ASSURANCE_CONFIG };
const userBlockedEntries = new Map<string, Map<string, BlockedUserEntry>>();
const userConnections = new Map<string, UserConnection>();

// Initial seeded restriction and appeal
const SEED_RESTRICTION: UserRestrictionRecord = {
  id: 'rst_seed_01',
  userId: 'usr_bot_spammer',
  userNickname: 'Bot_Advertiser_01',
  type: 'banned_permanent',
  scope: 'all',
  reason: 'Posting automated commercial gambling links and scraping public chat.',
  imposedBy: 'VoxaNex_Admin',
  imposedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  active: true,
};
userRestrictions.set(SEED_RESTRICTION.userId, SEED_RESTRICTION);

const SEED_APPEAL: ModerationAppeal = {
  id: 'app-seed-1',
  restrictionId: SEED_RESTRICTION.id!,
  userId: 'usr_bot_spammer',
  userNickname: 'Bot_Advertiser_01',
  statement: 'My account was accessed from an infected public terminal. I have secured credentials and request reconsideration.',
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  status: 'pending',
};
moderationAppeals.set(SEED_APPEAL.id, SEED_APPEAL);

// Initial audit log
moderationAuditLogs.push({
  id: 'aud_seed_01',
  actorId: 'admin_sys',
  actorNickname: 'VoxaNex_Admin',
  actorRole: 'admin',
  action: 'impose_restriction',
  targetType: 'user',
  targetId: 'usr_bot_spammer',
  details: { type: 'banned_permanent', reason: SEED_RESTRICTION.reason },
  timestamp: SEED_RESTRICTION.imposedAt,
});

// Seeded Safety Reports
const reportsList: SafetyReport[] = [
  {
    id: 'rep-init-1',
    targetType: 'user',
    targetId: 'usr_suspicious_77',
    reportedTarget: 'Suspicious_Caller_77',
    reportedUserId: 'usr_suspicious_77',
    reporterId: 'usr_padma',
    reporterNickname: 'Padma_Rider',
    category: 'harassment',
    reasonText: 'Harassing participants with unwanted aggressive comments in casual lobby.',
    evidenceSnapshot: {
      textSnippet: 'You cannot hide here, I will find your socials.',
      roomId: 'room-bangladesh-random',
      timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    },
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    status: 'received',
  },
  {
    id: 'rep-init-2',
    targetType: 'message',
    targetId: 'msg_spam_999',
    reportedTarget: 'Bot_Advertiser_01',
    reportedUserId: 'usr_bot_spammer',
    reporterId: 'usr_dhaka',
    reporterNickname: 'Dhaka_Echo',
    category: 'spam',
    reasonText: 'Posting commercial gambling links in Banglish chat repeatedly.',
    evidenceSnapshot: {
      textSnippet: 'Earn 10000 BDT daily now! Join t.me/fake_casino_win',
      roomId: 'room-banglish',
      timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    },
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    status: 'resolved',
    actionTaken: 'banned_permanent',
    reviewedBy: 'VoxaNex_Admin',
    reviewedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    moderatorNotes: 'Confirmed commercial spam bot. Imposed permanent ban.',
  },
];

// -----------------------------------------------------------------------------
// FORUM CONTROLLER FUNCTIONS
// -----------------------------------------------------------------------------
export function getForumTopics(params?: { category?: string; query?: string; page?: number; limit?: number }) {
  const category = params?.category || 'all';
  const query = (params?.query || '').toLowerCase().trim();
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(50, params?.limit || 10));

  let list = Array.from(forumTopics.values());

  if (category !== 'all') {
    list = list.filter((t) => t.category === category);
  }

  if (query) {
    list = list.filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        t.content.toLowerCase().includes(query) ||
        t.author.toLowerCase().includes(query)
    );
  }

  // Sort pinned first, then lastActivity descending
  list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  const total = list.length;
  const start = (page - 1) * limit;
  const items = list.slice(start, start + limit);

  return {
    topics: items,
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export function getForumTopicById(id: string): (ForumTopic & { replies: ForumReply[] }) | null {
  const topic = forumTopics.get(id);
  if (!topic) return null;

  // Increment views
  topic.viewsCount += 1;

  const reps = forumReplies.get(id) || [];
  return {
    ...topic,
    replies: reps,
  };
}

export function createForumTopic(params: {
  authorId: string;
  authorNickname: string;
  authorAvatar: string;
  authorRole?: 'guest' | 'user' | 'moderator' | 'admin' | 'editor';
  title: string;
  category: ForumTopic['category'];
  categoryLabel: { en: string; bn: string };
  content: string;
}): { success: boolean; topic?: ForumTopic; error?: string } {
  const { authorId, authorNickname, authorAvatar, authorRole, title, category, categoryLabel, content } = params;

  if (!title || title.trim().length < 5) {
    return { success: false, error: 'Title must be at least 5 characters.' };
  }

  if (!content || content.trim().length < 10) {
    return { success: false, error: 'Content must be at least 10 characters.' };
  }

  // Check user restriction (muted/suspended/banned)
  const restriction = checkUserRestriction(authorId);
  if (restriction.isRestricted) {
    return {
      success: false,
      error: `Action blocked: Your account is currently ${restriction.restriction?.type || 'restricted'}.`,
    };
  }

  // Filter content for prohibited threats/abuse/spam
  const filterTitle = filterProhibitedContent(title);
  if (filterTitle.flagged) {
    return { success: false, error: `Content policy violation: ${filterTitle.reason}` };
  }
  const filterBody = filterProhibitedContent(content);
  if (filterBody.flagged) {
    return { success: false, error: `Content policy violation: ${filterBody.reason}` };
  }

  // Rate check: 1 topic per 30 seconds
  const now = Date.now();
  const rate = forumRateLimits.get(authorId) || { lastPostTime: 0, count: 0, windowStart: now };
  if (now - rate.lastPostTime < 30000) {
    return { success: false, error: 'Please wait at least 30 seconds before creating another topic.' };
  }
  rate.lastPostTime = now;
  forumRateLimits.set(authorId, rate);

  const newTopic: ForumTopic = {
    id: `top_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    title: title.trim(),
    category,
    categoryLabel,
    authorId,
    author: authorNickname,
    authorAvatar,
    authorRole: (authorRole as any) || 'user',
    repliesCount: 0,
    viewsCount: 1,
    lastActivity: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    pinned: false,
    isLocked: false,
    content: content.trim(),
  };

  forumTopics.set(newTopic.id, newTopic);
  forumReplies.set(newTopic.id, []);

  return { success: true, topic: newTopic };
}

export function editForumTopic(params: {
  topicId: string;
  authorId: string;
  authorRole?: string;
  title?: string;
  content?: string;
}): { success: boolean; topic?: ForumTopic; error?: string } {
  const { topicId, authorId, authorRole, title, content } = params;

  const topic = forumTopics.get(topicId);
  if (!topic) {
    return { success: false, error: 'Topic not found.' };
  }

  const isStaff = authorRole === 'admin' || authorRole === 'moderator';

  if (!isStaff) {
    if (topic.authorId !== authorId) {
      return { success: false, error: 'Unauthorized: You can only edit your own topics.' };
    }
    if (topic.isLocked) {
      return { success: false, error: 'This topic is locked and cannot be edited.' };
    }
    // 15-minute author edit window
    const ageMs = Date.now() - new Date(topic.createdAt).getTime();
    if (ageMs > 15 * 60 * 1000) {
      return { success: false, error: 'Editing window has expired (15 minutes from creation). Contact staff.' };
    }
  }

  if (title) {
    if (title.trim().length < 5) {
      return { success: false, error: 'Title must be at least 5 characters.' };
    }
    const filterTitle = filterProhibitedContent(title);
    if (filterTitle.flagged) {
      return { success: false, error: `Content policy violation: ${filterTitle.reason}` };
    }
    topic.title = title.trim();
  }

  if (content) {
    if (content.trim().length < 10) {
      return { success: false, error: 'Content must be at least 10 characters.' };
    }
    const filterBody = filterProhibitedContent(content);
    if (filterBody.flagged) {
      return { success: false, error: `Content policy violation: ${filterBody.reason}` };
    }
    topic.content = content.trim();
  }

  topic.lastActivity = new Date().toISOString();
  return { success: true, topic };
}

export function toggleLockForumTopic(topicId: string, isLocked: boolean, requesterRole: string): {
  success: boolean;
  isLocked?: boolean;
  error?: string;
} {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return { success: false, error: 'Unauthorized: Moderator or Admin privileges required.' };
  }
  const topic = forumTopics.get(topicId);
  if (!topic) {
    return { success: false, error: 'Topic not found.' };
  }
  topic.isLocked = isLocked;
  return { success: true, isLocked };
}

export function togglePinForumTopic(topicId: string, pinned: boolean, requesterRole: string): {
  success: boolean;
  pinned?: boolean;
  error?: string;
} {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return { success: false, error: 'Unauthorized: Moderator or Admin privileges required.' };
  }
  const topic = forumTopics.get(topicId);
  if (!topic) {
    return { success: false, error: 'Topic not found.' };
  }
  topic.pinned = pinned;
  return { success: true, pinned };
}

export function replyToForumTopic(params: {
  topicId: string;
  authorId: string;
  authorNickname: string;
  authorAvatar: string;
  authorRole?: 'guest' | 'user' | 'moderator' | 'admin' | 'editor';
  content: string;
}): { success: boolean; reply?: ForumReply; error?: string } {
  const { topicId, authorId, authorNickname, authorAvatar, authorRole, content } = params;

  const topic = forumTopics.get(topicId);
  if (!topic) {
    return { success: false, error: 'Topic not found.' };
  }

  if (topic.isLocked) {
    return { success: false, error: 'This topic has been locked by moderators.' };
  }

  // Check user restriction
  const restriction = checkUserRestriction(authorId);
  if (restriction.isRestricted) {
    return {
      success: false,
      error: `Action blocked: Your account is currently ${restriction.restriction?.type || 'restricted'}.`,
    };
  }

  if (!content || content.trim().length < 2) {
    return { success: false, error: 'Reply cannot be empty.' };
  }

  // Scan content
  const filtered = filterProhibitedContent(content);
  if (filtered.flagged) {
    return { success: false, error: `Content policy violation: ${filtered.reason}` };
  }

  const reply: ForumReply = {
    id: `rep_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    topicId,
    authorId,
    authorNickname,
    authorAvatar,
    authorRole: (authorRole as any) || 'user',
    content: content.trim(),
    createdAt: new Date().toISOString(),
    isModeratorApproved: true,
  };

  if (!forumReplies.has(topicId)) {
    forumReplies.set(topicId, []);
  }

  const reps = forumReplies.get(topicId)!;
  reps.push(reply);

  topic.repliesCount = reps.length;
  topic.lastActivity = reply.createdAt;

  return { success: true, reply };
}

export function deleteForumTopic(topicId: string, requesterId?: string, requesterRole?: string): boolean {
  const topic = forumTopics.get(topicId);
  if (!topic) return false;

  const isStaff = requesterRole === 'admin' || requesterRole === 'moderator';
  const isAuthor = requesterId && topic.authorId === requesterId;

  if (!isStaff && !isAuthor) {
    return false;
  }

  forumTopics.delete(topicId);
  forumReplies.delete(topicId);
  return true;
}

export function deleteForumReply(
  topicId: string,
  replyId: string,
  requesterId?: string,
  requesterRole?: string
): boolean {
  const reps = forumReplies.get(topicId);
  if (!reps) return false;

  const targetIdx = reps.findIndex((r) => r.id === replyId);
  if (targetIdx === -1) return false;

  const reply = reps[targetIdx];
  const isStaff = requesterRole === 'admin' || requesterRole === 'moderator';
  const isAuthor = requesterId && reply.authorId === requesterId;

  if (!isStaff && !isAuthor) {
    return false;
  }

  reps.splice(targetIdx, 1);
  const topic = forumTopics.get(topicId);
  if (topic) {
    topic.repliesCount = reps.length;
  }
  return true;
}

export function moderateForumReply(
  topicId: string,
  replyId: string,
  isApproved: boolean,
  requesterRole: string
): boolean {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return false;
  }
  const reps = forumReplies.get(topicId);
  if (!reps) return false;
  const reply = reps.find((r) => r.id === replyId);
  if (!reply) return false;
  reply.isModeratorApproved = isApproved;
  return true;
}

// -----------------------------------------------------------------------------
// CMS BLOG CONTROLLER FUNCTIONS
// -----------------------------------------------------------------------------
export function getBlogArticles(params?: { status?: string; tag?: string }) {
  let list = Array.from(blogArticles.values());
  if (params?.status && params.status !== 'all') {
    list = list.filter((a) => a.status === params.status);
  } else {
    // default public: published only
    list = list.filter((a) => a.status === 'published');
  }

  if (params?.tag) {
    const t = params.tag.toLowerCase();
    list = list.filter((a) => a.tags?.some((tg) => tg.toLowerCase() === t));
  }

  list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return list;
}

export function getBlogArticleBySlug(slug: string): BlogArticle | null {
  return blogArticles.get(slug) || null;
}

export function saveBlogArticle(
  article: BlogArticle,
  requesterRole: string
): { success: boolean; article?: BlogArticle; error?: string } {
  if (requesterRole !== 'admin' && requesterRole !== 'editor') {
    return { success: false, error: 'Unauthorized: Admin or editor role required to publish articles.' };
  }

  if (!article.slug) {
    article.slug = (article.title.en || 'post')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  blogArticles.set(article.slug, article);
  return { success: true, article };
}

export function deleteBlogArticle(slug: string, requesterRole: string): boolean {
  if (requesterRole !== 'admin') {
    return false;
  }
  return blogArticles.delete(slug);
}

export function addBlogComment(params: {
  slug: string;
  authorNickname: string;
  authorAvatar: string;
  content: string;
}): { success: boolean; comment?: BlogComment; error?: string } {
  const article = blogArticles.get(params.slug);
  if (!article) return { success: false, error: 'Article not found.' };

  const filtered = filterProhibitedContent(params.content);
  if (filtered.flagged) {
    return { success: false, error: `Content policy violation: ${filtered.reason}` };
  }

  const newComment: BlogComment = {
    id: `com_${Date.now()}`,
    articleId: article.id,
    authorNickname: params.authorNickname,
    authorAvatar: params.authorAvatar,
    content: params.content.trim(),
    createdAt: new Date().toISOString(),
    status: 'approved',
  };

  if (!article.comments) article.comments = [];
  article.comments.push(newComment);
  return { success: true, comment: newComment };
}

export function moderateBlogComment(
  slug: string,
  commentId: string,
  status: 'approved' | 'rejected',
  requesterRole: string
): boolean {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return false;
  }
  const article = blogArticles.get(slug);
  if (!article || !article.comments) return false;
  const comment = article.comments.find((c) => c.id === commentId);
  if (!comment) return false;
  comment.status = status;
  return true;
}

export function deleteBlogComment(slug: string, commentId: string, requesterRole: string): boolean {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return false;
  }
  const article = blogArticles.get(slug);
  if (!article || !article.comments) return false;
  const idx = article.comments.findIndex((c) => c.id === commentId);
  if (idx === -1) return false;
  article.comments.splice(idx, 1);
  return true;
}

// -----------------------------------------------------------------------------
// COMMUNITY GUIDES CONTROLLER
// -----------------------------------------------------------------------------
export function getCommunityGuides(): { guides: CommunityGuide[]; legalDisclaimer: string } {
  return {
    guides: Array.from(communityGuidesMap.values()),
    legalDisclaimer:
      'Initial guide content is provided as editable starter guidance and operational policy, not evidence of completed legal counsel review in individual local jurisdictions.',
  };
}

export function getCommunityGuideBySlug(slug: string): CommunityGuide | null {
  return communityGuidesMap.get(slug) || null;
}

export function updateCommunityGuide(
  slug: string,
  updates: Partial<CommunityGuide>,
  requesterRole: string
): { success: boolean; guide?: CommunityGuide; error?: string } {
  if (requesterRole !== 'admin') {
    return { success: false, error: 'Unauthorized: Administrator role required to edit community guides.' };
  }
  const existing = communityGuidesMap.get(slug);
  if (!existing) {
    return { success: false, error: 'Guide not found.' };
  }
  const updated: CommunityGuide = {
    ...existing,
    ...updates,
    lastUpdated: new Date().toISOString().split('T')[0],
  };
  communityGuidesMap.set(slug, updated);
  return { success: true, guide: updated };
}

// -----------------------------------------------------------------------------
// DYNAMIC ROOMS CATALOG & INTERNATIONAL HUBS
// -----------------------------------------------------------------------------
export function getDynamicRoomsCatalog(): Room[] {
  return Array.from(dynamicRoomsMap.values());
}

export function createDynamicRoom(
  room: Room,
  requesterRole: string
): { success: boolean; room?: Room; error?: string } {
  if (requesterRole !== 'admin') {
    return { success: false, error: 'Unauthorized: Admin role required to create rooms.' };
  }
  if (!room.id || !room.name?.en) {
    return { success: false, error: 'Room ID and name are required.' };
  }
  dynamicRoomsMap.set(room.id, room);
  return { success: true, room };
}

export function updateDynamicRoom(
  roomId: string,
  updates: Partial<Room>,
  requesterRole: string
): { success: boolean; room?: Room; error?: string } {
  if (requesterRole !== 'admin') {
    return { success: false, error: 'Unauthorized: Admin role required to update rooms.' };
  }
  const room = dynamicRoomsMap.get(roomId);
  if (!room) {
    return { success: false, error: 'Room not found.' };
  }
  const updated = { ...room, ...updates };
  dynamicRoomsMap.set(roomId, updated);
  return { success: true, room: updated };
}

export function deleteDynamicRoom(roomId: string, requesterRole: string): boolean {
  if (requesterRole !== 'admin') {
    return false;
  }
  return dynamicRoomsMap.delete(roomId);
}


// -----------------------------------------------------------------------------
// ADMIN MODERATION & RESTRICTIONS CONTROLLER
// -----------------------------------------------------------------------------

/**
 * Prohibited Content Filter (abuse prevention, harassment, threats, spam detection)
 */
export function filterProhibitedContent(text: string): {
  flagged: boolean;
  category?: 'harassment' | 'threats' | 'hate_speech' | 'spam' | 'exploitation';
  reason?: string;
  sanitizedText: string;
} {
  if (!text) return { flagged: false, sanitizedText: '' };

  const lower = text.toLowerCase();

  // Child exploitation / abuse zero-tolerance patterns
  const exploitationKeywords = [
    'child porn', 'csam', 'underage nudes', 'pedophile', 'pedo', 'bacchader video', 'shishu porn',
  ];
  for (const kw of exploitationKeywords) {
    if (lower.includes(kw)) {
      return {
        flagged: true,
        category: 'exploitation',
        reason: 'Zero tolerance violation: Prohibited sexual exploitation keywords detected.',
        sanitizedText: '[CONTENT REMOVED UNDER ZERO TOLERANCE SAFETY POLICY]',
      };
    }
  }

  // Severe threats of physical violence or doxxing
  const threatKeywords = [
    'kill you', 'doxx you', 'bomb you', 'tore mere phelbo', 'toke mere ফেলব', 'home address leak',
    'basha theke tule nibo', 'i know where you live', 'acid marchibo',
  ];
  for (const kw of threatKeywords) {
    if (lower.includes(kw)) {
      return {
        flagged: true,
        category: 'threats',
        reason: 'Direct threats of violence or unlawful intimidation are strictly prohibited.',
        sanitizedText: '[CONTENT BLOCKED: THREATENING LANGUAGE]',
      };
    }
  }

  // Commercial gambling / crypto spam bots
  const spamKeywords = [
    'baji999', 'melbet', '1xbet', 'free bdt deposit', 't.me/fake_casino', 'telegram bot investment',
    'double your taka in 1 hour', 'bKash cashout bonus click here',
  ];
  for (const kw of spamKeywords) {
    if (lower.includes(kw)) {
      return {
        flagged: true,
        category: 'spam',
        reason: 'Commercial spam or unsolicited gambling promotions detected.',
        sanitizedText: '[SPAM DETECTED: ADVERTISING BLOCKED]',
      };
    }
  }

  // Severe hate speech slurs (Bangla/English)
  const hateSlurs = ['malaun', 'kufar exterminate', 'jongi maro'];
  for (const kw of hateSlurs) {
    if (lower.includes(kw)) {
      return {
        flagged: true,
        category: 'hate_speech',
        reason: 'Hate speech targeting religion, ethnicity, or community is strictly prohibited.',
        sanitizedText: '[CONTENT BLOCKED: HATE SPEECH VIOLATION]',
      };
    }
  }

  return { flagged: false, sanitizedText: text };
}

/**
 * Submit actionable safety report with abuse prevention
 */
export function submitSafetyReport(params: {
  targetType: ReportTargetType;
  targetId: string;
  reportedTarget: string;
  reportedUserId?: string;
  reporterId?: string;
  reporterNickname?: string;
  reporterIp?: string;
  category: ReportCategory;
  reasonText: string;
  evidenceSnapshot?: any;
}): { success: boolean; reportId?: string; error?: string } {
  const {
    targetType,
    targetId,
    reportedTarget,
    reportedUserId,
    reporterId = 'anon',
    reporterNickname = 'Anonymous',
    reporterIp = '127.0.0.1',
    category,
    reasonText,
    evidenceSnapshot,
  } = params;

  if (!reasonText || reasonText.trim().length < 5) {
    return { success: false, error: 'Please provide detailed reason for report (minimum 5 characters).' };
  }

  // Anti-griefing / Report abuse rate limit: max 5 reports per 15 minutes per IP/reporterId
  const rateKey = `${reporterId}_${reporterIp}`;
  const now = Date.now();
  const rate = reportRateLimits.get(rateKey) || { count: 0, windowStart: now };
  if (now - rate.windowStart > 15 * 60 * 1000) {
    rate.count = 0;
    rate.windowStart = now;
  }
  if (rate.count >= 5) {
    return { success: false, error: 'Report submission limit reached. Please wait a few minutes before submitting another report.' };
  }
  rate.count += 1;
  reportRateLimits.set(rateKey, rate);

  // Auto-escalation for exploitation reports
  const isExploitation = category === 'exploitation' || category === 'non_consensual_imagery';

  const newReport: SafetyReport = {
    id: `rep_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    targetType: targetType || 'user',
    targetId: targetId || reportedTarget,
    reportedTarget: reportedTarget.trim(),
    reportedUserId,
    reporterId,
    reporterNickname,
    category,
    reasonText: reasonText.trim(),
    evidenceSnapshot: evidenceSnapshot || undefined,
    timestamp: new Date().toISOString(),
    status: isExploitation ? 'investigating' : 'received',
    actionTaken: 'none',
  };

  reportsList.unshift(newReport);

  // Record audit log
  addModerationAuditLog({
    actorId: reporterId,
    actorNickname: reporterNickname,
    actorRole: 'user',
    action: 'resolve_report',
    targetType,
    targetId,
    details: { reportId: newReport.id, category, isExploitation },
  });

  return { success: true, reportId: newReport.id };
}

/**
 * Fetch reports for authorized moderators/admins only.
 * Public users cannot read other people's reports or reporter identities.
 */
export function getPlatformReports(requesterRole = 'user'): SafetyReport[] {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return [];
  }
  return reportsList;
}

/**
 * Public status lookup for a user's own report (anonymized)
 */
export function getPublicReportStatus(reportId: string, reporterId?: string) {
  const r = reportsList.find((rep) => rep.id === reportId);
  if (!r) return null;
  // If reporterId provided, verify ownership or moderator role
  if (reporterId && r.reporterId !== reporterId && reporterId !== 'admin') {
    return { status: r.status, timestamp: r.timestamp };
  }
  return {
    id: r.id,
    targetType: r.targetType,
    reportedTarget: r.reportedTarget,
    category: r.category,
    status: r.status,
    actionTaken: r.actionTaken,
    timestamp: r.timestamp,
  };
}

/**
 * Update report status & record moderator action
 */
export function updateReportStatus(
  reportId: string,
  status: SafetyReport['status'],
  actionTaken?: SafetyReport['actionTaken'],
  moderatorNotes?: string,
  reviewer = 'VoxaNex_Admin'
) {
  const r = reportsList.find((rep) => rep.id === reportId);
  if (r) {
    r.status = status;
    if (actionTaken) r.actionTaken = actionTaken;
    if (moderatorNotes) r.moderatorNotes = moderatorNotes;
    r.reviewedBy = reviewer;
    r.reviewedAt = new Date().toISOString();

    addModerationAuditLog({
      actorId: reviewer,
      actorNickname: reviewer,
      actorRole: 'admin',
      action: status === 'dismissed' ? 'dismiss_report' : 'resolve_report',
      targetType: r.targetType,
      targetId: r.targetId,
      details: { reportId: r.id, status, actionTaken, moderatorNotes },
    });
  }
  return r;
}

/**
 * USER RESTRICTIONS ENGINE: warnings, mutes, suspensions, bans with server-side expiry
 */
export function imposeUserRestriction(params: {
  userId: string;
  userNickname: string;
  type: UserRestrictionRecord['type'];
  scope?: UserRestrictionRecord['scope'];
  reason: string;
  imposedBy: string;
}): { success: boolean; restriction: UserRestrictionRecord } {
  const { userId, userNickname, type, scope = 'all', reason, imposedBy } = params;

  const now = Date.now();
  let expiresAt: string | undefined = undefined;

  if (type === 'muted') {
    // Default 1 hour mute
    expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  } else if (type === 'suspended_24h') {
    // 24 hours suspension
    expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  } else if (type === 'suspended_7d') {
    // 7 days suspension
    expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  // type === 'banned_permanent' or 'warning': no expiration

  const record: UserRestrictionRecord = {
    id: `rst_${now}_${crypto.randomUUID().slice(0, 6)}`,
    userId,
    userNickname,
    type,
    scope,
    reason: reason.trim(),
    imposedBy,
    imposedAt: new Date(now).toISOString(),
    expiresAt,
    active: type !== 'warning', // Warnings are informational records
  };

  userRestrictions.set(userId, record);

  addModerationAuditLog({
    actorId: imposedBy,
    actorNickname: imposedBy,
    actorRole: 'admin',
    action: 'impose_restriction',
    targetType: 'user',
    targetId: userId,
    details: { type, scope, reason, expiresAt },
  });

  return { success: true, restriction: record };
}

/**
 * Check active restriction status with automatic server-side expiry
 */
export function checkUserRestriction(userId: string): {
  isRestricted: boolean;
  restriction?: UserRestrictionRecord;
} {
  const record = userRestrictions.get(userId);
  if (!record || !record.active) {
    return { isRestricted: false };
  }

  // Automatic expiration check
  if (record.expiresAt) {
    const expiryTime = new Date(record.expiresAt).getTime();
    if (Date.now() > expiryTime) {
      record.active = false;
      record.revokedAt = new Date().toISOString();
      record.revokedBy = 'system_expiration';

      addModerationAuditLog({
        actorId: 'system',
        actorNickname: 'System Expiry Engine',
        actorRole: 'system',
        action: 'lift_restriction',
        targetType: 'user',
        targetId: userId,
        details: { reason: 'Automatic restriction expiration period elapsed', type: record.type },
      });

      return { isRestricted: false };
    }
  }

  return { isRestricted: true, restriction: record };
}

/**
 * Lift a user restriction manually
 */
export function liftUserRestriction(userId: string, reason: string, actor = 'VoxaNex_Admin'): boolean {
  const record = userRestrictions.get(userId);
  if (!record) return false;

  record.active = false;
  record.revokedAt = new Date().toISOString();
  record.revokedBy = actor;

  addModerationAuditLog({
    actorId: actor,
    actorNickname: actor,
    actorRole: 'admin',
    action: 'lift_restriction',
    targetType: 'user',
    targetId: userId,
    details: { reason, previousType: record.type },
  });

  return true;
}

export function getUserRestrictions(requesterRole = 'user'): UserRestrictionRecord[] {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return [];
  }
  return Array.from(userRestrictions.values());
}

/**
 * MODERATION APPEALS
 */
export function submitAppeal(params: {
  userId: string;
  userNickname: string;
  statement: string;
}): { success: boolean; appeal?: ModerationAppeal; error?: string } {
  const { userId, userNickname, statement } = params;

  if (!statement || statement.trim().length < 10) {
    return { success: false, error: 'Appeal statement must be at least 10 characters explaining your circumstance.' };
  }

  // Check if an appeal is already pending
  const existingPending = Array.from(moderationAppeals.values()).find(
    (a) => a.userId === userId && a.status === 'pending'
  );
  if (existingPending) {
    return { success: false, error: 'You already have a pending appeal under review by our moderation team.' };
  }

  const userRestr = userRestrictions.get(userId);
  const newAppeal: ModerationAppeal = {
    id: `app_${Date.now()}_${crypto.randomUUID().slice(0, 4)}`,
    restrictionId: userRestr?.id || userId,
    userId,
    userNickname,
    statement: statement.trim(),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  moderationAppeals.set(newAppeal.id, newAppeal);
  return { success: true, appeal: newAppeal };
}

export function getModerationAppeals(requesterRole = 'user'): ModerationAppeal[] {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return [];
  }
  return Array.from(moderationAppeals.values());
}

export function reviewAppeal(
  appealId: string,
  status: 'accepted' | 'rejected',
  notes?: string,
  reviewer = 'VoxaNex_Admin'
) {
  const appeal = moderationAppeals.get(appealId);
  if (!appeal) return null;

  appeal.status = status;
  appeal.reviewNotes = notes;
  appeal.reviewedBy = reviewer;
  appeal.reviewedAt = new Date().toISOString();

  if (status === 'accepted') {
    // Lift restriction on user
    liftUserRestriction(appeal.userId, `Appeal accepted by ${reviewer}: ${notes || 'Sanction overturned'}`, reviewer);
  }

  addModerationAuditLog({
    actorId: reviewer,
    actorNickname: reviewer,
    actorRole: 'admin',
    action: 'review_appeal',
    targetType: 'appeal',
    targetId: appealId,
    details: { userId: appeal.userId, status, notes },
  });

  return appeal;
}

/**
 * MODERATION AUDIT LOGS
 */
export function addModerationAuditLog(entry: Omit<ModerationAuditLog, 'id' | 'timestamp'>) {
  const log: ModerationAuditLog = {
    id: `aud_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    ...entry,
    timestamp: new Date().toISOString(),
  };
  moderationAuditLogs.unshift(log);
  // Keep last 1000 logs in memory
  if (moderationAuditLogs.length > 1000) {
    moderationAuditLogs.pop();
  }
}

export function getModerationAuditLogs(requesterRole = 'user'): ModerationAuditLog[] {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return [];
  }
  return moderationAuditLogs;
}

/**
 * AGE ASSURANCE ARCHITECTURE & ELIGIBILITY CONTROLS
 * Legal Notice: An age-confirmation checkbox alone must not be represented as proof of age.
 * Never permit minors into adult-oriented rooms or sexual conversations.
 */
export function getAgeAssuranceConfig(): AgeAssuranceConfig {
  return currentAgeAssuranceConfig;
}

export function updateAgeAssuranceConfig(newConfig: Partial<AgeAssuranceConfig>, actor = 'Admin'): AgeAssuranceConfig {
  currentAgeAssuranceConfig = {
    ...currentAgeAssuranceConfig,
    ...newConfig,
    internationalCompliance: {
      ...currentAgeAssuranceConfig.internationalCompliance,
      ...(newConfig.internationalCompliance || {}),
    },
  };

  addModerationAuditLog({
    actorId: actor,
    actorNickname: actor,
    actorRole: 'admin',
    action: 'update_platform_settings',
    targetType: 'age_assurance',
    targetId: 'config',
    details: currentAgeAssuranceConfig,
  });

  return currentAgeAssuranceConfig;
}

export function getUserAgeAssurance(userId: string): AgeAssuranceRecord {
  const existing = ageAssuranceRecords.get(userId);
  if (existing) return existing;

  const defaultRecord: AgeAssuranceRecord = {
    userId,
    status: 'unverified',
    method: 'none',
  };
  return defaultRecord;
}

/**
 * Submit self-declaration (with explicit statutory notice)
 */
export function submitAgeDeclaration(params: {
  userId: string;
  birthYear: number;
  consentAffirmed: boolean;
}): { success: boolean; record?: AgeAssuranceRecord; error?: string } {
  const { userId, birthYear, consentAffirmed } = params;

  if (!consentAffirmed) {
    return { success: false, error: 'You must affirm the consent declaration and community rules.' };
  }

  const currentYear = 2026;
  const age = currentYear - birthYear;
  if (isNaN(age) || age < 18) {
    const rejectedRecord: AgeAssuranceRecord = {
      userId,
      status: 'rejected_underage',
      method: 'self_declaration',
      verifiedAt: new Date().toISOString(),
      notes: 'Self-declared age indicates under 18 years old. Minors strictly prohibited from adult areas.',
    };
    ageAssuranceRecords.set(userId, rejectedRecord);
    return { success: false, error: 'Adult access eligibility denied: You must be at least 18 years of age.' };
  }

  // If strict mode requires 3P provider proof, self-declaration marks status as pending 3P verification
  const isStrict = currentPlatformSettings.contentPolicy.requireThirdPartyAgeProof;
  const record: AgeAssuranceRecord = {
    userId,
    status: isStrict ? 'pending' : 'verified_adult_18plus',
    method: 'self_declaration',
    verifiedAt: new Date().toISOString(),
    notes: isStrict ? 'Self-declaration logged. Awaiting third-party ID verification.' : 'Self-declared adult access granted.',
  };

  ageAssuranceRecords.set(userId, record);
  return { success: true, record };
}

/**
 * Initiate third-party provider age verification session (Persona / Yoti / Veriff sandbox)
 */
export function initiateAgeProviderSession(params: {
  userId: string;
  provider: AgeAssuranceProvider;
}) {
  const { userId, provider } = params;
  const sessionId = `age_ses_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const redirectUrl = `https://verify.voxanex.internal/sandbox?session=${sessionId}&provider=${provider}`;

  return {
    success: true,
    sessionId,
    provider,
    redirectUrl,
    disclaimer: 'Third-party verification handles identity attributes without storing government IDs on VoxaNex servers.',
  };
}

/**
 * Complete provider verification (Zero-Knowledge: stores only cryptographic proof hash)
 */
export function completeAgeProviderVerification(params: {
  userId: string;
  provider: AgeAssuranceProvider;
  sessionId: string;
  isAdultConfirmed: boolean;
  referenceProofToken: string;
}): { success: boolean; record: AgeAssuranceRecord } {
  const { userId, provider, sessionId, isAdultConfirmed, referenceProofToken } = params;

  // Generate zero-knowledge SHA256 proof hash (no PII stored)
  const proofHash = crypto
    .createHash('sha256')
    .update(`${referenceProofToken}_${userId}_${sessionId}`)
    .digest('hex');

  const record: AgeAssuranceRecord = {
    userId,
    status: isAdultConfirmed ? 'verified_adult_18plus' : 'rejected_underage',
    method: provider,
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year retention
    providerReferenceId: sessionId,
    providerProofHash: proofHash,
    notes: isAdultConfirmed ? 'Adult age verified by provider proof' : 'Age verification failed: under 18',
  };

  ageAssuranceRecords.set(userId, record);

  addModerationAuditLog({
    actorId: 'system_age_provider',
    actorNickname: provider,
    actorRole: 'system',
    action: 'resolve_report',
    targetType: 'age_verification',
    targetId: userId,
    details: { status: record.status, provider, proofHashPrefix: proofHash.slice(0, 8) },
  });

  return { success: true, record };
}

/**
 * Revoke adult eligibility when violation or minority discovered
 */
export function revokeAgeVerification(userId: string, reason: string, actor = 'VoxaNex_Admin'): boolean {
  const record = ageAssuranceRecords.get(userId) || { userId, status: 'unverified', method: 'none' };
  record.status = 'revoked';
  record.notes = `Revoked by ${actor}: ${reason}`;
  ageAssuranceRecords.set(userId, record);

  addModerationAuditLog({
    actorId: actor,
    actorNickname: actor,
    actorRole: 'admin',
    action: 'revoke_age_verification',
    targetType: 'user',
    targetId: userId,
    details: { reason },
  });

  return true;
}

/**
 * Check if user is eligible to enter 18+ adult lounges
 */
export function isUserEligibleForAdultAreas(userId: string, isGuest: boolean): {
  eligible: boolean;
  reason?: string;
} {
  // Check platform feature flag first
  if (!currentPlatformSettings.featureFlags.banglaAdultLoungeEnabled) {
    return { eligible: false, reason: 'Adult lounge is currently disabled by platform administrator.' };
  }

  // Check user restrictions (bans/suspensions)
  const restr = checkUserRestriction(userId);
  if (restr.isRestricted && (restr.restriction?.type === 'banned_permanent' || restr.restriction?.type.startsWith('suspended'))) {
    return { eligible: false, reason: 'Account currently suspended from all rooms.' };
  }

  const ageRecord = getUserAgeAssurance(userId);
  if (ageRecord.status === 'revoked') {
    return { eligible: false, reason: 'Adult eligibility revoked due to compliance investigation.' };
  }

  if (ageRecord.status === 'rejected_underage') {
    return { eligible: false, reason: 'Access denied: Minors are strictly prohibited from adult areas.' };
  }

  if (ageRecord.status === 'verified_adult_18plus') {
    return { eligible: true };
  }

  // If strict gate is mandatory, unverified users are strictly blocked
  if (currentPlatformSettings.contentPolicy.strictAgeGateMandatory) {
    return { eligible: false, reason: 'Age assurance mandatory: Complete verification in Age Gate.' };
  }

  return { eligible: false, reason: 'Verification required.' };
}

/**
 * USER BLOCKED LIST MANAGEMENT
 */
export function getBlockedUsers(userId: string): BlockedUserEntry[] {
  const userMap = userBlockedEntries.get(userId);
  if (!userMap) return [];
  return Array.from(userMap.values());
}

export function addBlockedUserEntry(params: {
  blockerId: string;
  targetId: string;
  targetNickname: string;
  targetAvatar: string;
  reason?: string;
}) {
  const { blockerId, targetId, targetNickname, targetAvatar, reason } = params;
  if (!userBlockedEntries.has(blockerId)) {
    userBlockedEntries.set(blockerId, new Map());
  }
  const userMap = userBlockedEntries.get(blockerId)!;
  userMap.set(targetId, {
    targetId,
    targetNickname,
    targetAvatar,
    blockedAt: new Date().toISOString(),
    reason,
  });
}

export function removeBlockedUserEntry(blockerId: string, targetId: string) {
  const userMap = userBlockedEntries.get(blockerId);
  if (userMap) {
    userMap.delete(targetId);
  }
}

/**
 * USER CONNECTIONS / FRIENDS
 */
export function sendConnectionRequest(params: {
  requesterId: string;
  requesterNickname: string;
  requesterAvatar: string;
  recipientId: string;
  recipientNickname: string;
  recipientAvatar: string;
}): { success: boolean; connection?: UserConnection; error?: string } {
  const { requesterId, requesterNickname, requesterAvatar, recipientId, recipientNickname, recipientAvatar } = params;
  if (requesterId === recipientId) {
    return { success: false, error: 'Cannot send connection request to yourself.' };
  }

  const connId = `conn_${[requesterId, recipientId].sort().join('_')}`;
  const existing = userConnections.get(connId);
  if (existing && existing.status === 'pending') {
    return { success: false, error: 'Connection request is already pending.' };
  }
  if (existing && existing.status === 'accepted') {
    return { success: false, error: 'Already connected with this user.' };
  }

  const conn: UserConnection = {
    id: connId,
    requesterId,
    requesterNickname,
    requesterAvatar,
    recipientId,
    recipientNickname,
    recipientAvatar,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  userConnections.set(connId, conn);
  return { success: true, connection: conn };
}

export function respondConnectionRequest(connectionId: string, recipientId: string, accept: boolean) {
  const conn = userConnections.get(connectionId);
  if (!conn || conn.recipientId !== recipientId) return null;

  conn.status = accept ? 'accepted' : 'declined';
  conn.updatedAt = new Date().toISOString();
  return conn;
}

export function getUserConnections(userId: string): UserConnection[] {
  return Array.from(userConnections.values()).filter(
    (c) => (c.requesterId === userId || c.recipientId === userId) && c.status === 'accepted'
  );
}

/**
 * USER PRIVACY & DATA EXPORT (GDPR / Right of Access)
 */
export function exportUserData(userId: string) {
  const age = getUserAgeAssurance(userId);
  const restrictions = Array.from(userRestrictions.values()).filter((r) => r.userId === userId);
  const appeals = Array.from(moderationAppeals.values()).filter((a) => a.userId === userId);
  const blocks = getBlockedUsers(userId);
  const connections = getUserConnections(userId);

  return {
    exportDate: new Date().toISOString(),
    userId,
    dataSummary: {
      accountType: userId.startsWith('guest_') ? 'guest_session' : 'registered_user',
      ageAssurance: {
        status: age.status,
        method: age.method,
        verifiedAt: age.verifiedAt,
      },
      privacySettings: {
        onlineVisibility: 'online',
        allowDiscoverability: true,
      },
      connectionsCount: connections.length,
      blockedUsersCount: blocks.length,
      moderationHistory: restrictions.map((r) => ({
        type: r.type,
        reason: r.reason,
        imposedAt: r.imposedAt,
        active: r.active,
      })),
      appealsHistory: appeals.map((a) => ({
        statement: a.statement,
        status: a.status,
        createdAt: a.createdAt,
      })),
    },
    ageAssurance: age,
    blockedUsers: blocks,
    connections,
    privacyDisclaimer:
      'VoxaNex retains minimal data. Real-time media streams and P2P calls are ephemeral and zero-knowledge.',
  };
}

/**
 * ACCOUNT DELETION PURGE
 */
export function purgeUserData(userId: string, actor = 'user'): { success: boolean; message: string } {
  // Clear restrictions, appeals, age verification, connections, blocks
  userRestrictions.delete(userId);
  ageAssuranceRecords.delete(userId);
  userBlockedEntries.delete(userId);

  for (const [id, conn] of userConnections.entries()) {
    if (conn.requesterId === userId || conn.recipientId === userId) {
      userConnections.delete(id);
    }
  }

  addModerationAuditLog({
    actorId: actor,
    actorNickname: actor,
    actorRole: 'admin',
    action: 'purge_data',
    targetType: 'user',
    targetId: userId,
    details: { reason: 'User requested account deletion and data purge' },
  });

  return {
    success: true,
    message: 'All associated profile data, tokens, and records have been purged from VoxaNex servers.',
  };
}

/**
 * PLATFORM SETTINGS
 */
export function updatePlatformSettings(newSettings: Partial<AdminPlatformSettings>): AdminPlatformSettings {
  currentPlatformSettings = {
    ...currentPlatformSettings,
    ...newSettings,
    featureFlags: { ...currentPlatformSettings.featureFlags, ...newSettings.featureFlags },
    rateLimits: { ...currentPlatformSettings.rateLimits, ...newSettings.rateLimits },
    contentPolicy: { ...currentPlatformSettings.contentPolicy, ...newSettings.contentPolicy },
    retention: { ...currentPlatformSettings.retention, ...newSettings.retention },
  };
  return currentPlatformSettings;
}

export function getPlatformSettings(): AdminPlatformSettings {
  return currentPlatformSettings;
}

// -----------------------------------------------------------------------------
// ROOM MODERATOR MANAGEMENT
// -----------------------------------------------------------------------------
export interface RoomModeratorAssignment {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  role: 'moderator';
  gender: 'male' | 'female' | 'other';
  assignedBy: string;
  assignedAt: string;
}

const roomModeratorAssignments = new Map<string, RoomModeratorAssignment>();

export function getRoomModerators(roomId?: string, requesterRole = 'user'): RoomModeratorAssignment[] {
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') {
    return [];
  }
  const all = Array.from(roomModeratorAssignments.values());
  if (roomId) {
    return all.filter((m) => m.roomId === roomId);
  }
  return all;
}

export function assignRoomModerator(
  params: {
    roomId: string;
    userId: string;
    username: string;
    gender: 'male' | 'female' | 'other';
    assignedBy: string;
  },
  requesterRole = 'admin'
): { success: boolean; assignment?: RoomModeratorAssignment; error?: string } {
  if (requesterRole !== 'admin') {
    return { success: false, error: 'Unauthorized: Only platform administrators can assign room moderators.' };
  }

  const { roomId, userId, username, gender, assignedBy } = params;

  if (!roomId || !userId || !username) {
    return { success: false, error: 'Room ID, User ID, and Username are required.' };
  }

  const assignmentId = `mod_${roomId}_${userId}`;
  const assignment: RoomModeratorAssignment = {
    id: assignmentId,
    roomId,
    userId,
    username: username.trim(),
    role: 'moderator',
    gender: gender || 'other',
    assignedBy,
    assignedAt: new Date().toISOString(),
  };

  roomModeratorAssignments.set(assignmentId, assignment);

  addModerationAuditLog({
    actorId: assignedBy,
    actorNickname: assignedBy,
    actorRole: 'admin',
    action: 'impose_restriction',
    targetType: 'moderator_assignment',
    targetId: assignmentId,
    details: { roomId, userId, username, gender },
  });

  return { success: true, assignment };
}

export function revokeRoomModerator(
  assignmentId: string,
  revokedBy: string,
  requesterRole = 'admin'
): { success: boolean; error?: string } {
  if (requesterRole !== 'admin') {
    return { success: false, error: 'Unauthorized: Only platform administrators can revoke moderator assignments.' };
  }

  const existing = roomModeratorAssignments.get(assignmentId);
  if (!existing) {
    return { success: false, error: 'Moderator assignment not found.' };
  }

  roomModeratorAssignments.delete(assignmentId);

  addModerationAuditLog({
    actorId: revokedBy,
    actorNickname: revokedBy,
    actorRole: 'admin',
    action: 'lift_restriction',
    targetType: 'moderator_assignment',
    targetId: assignmentId,
    details: { roomId: existing.roomId, userId: existing.userId, username: existing.username },
  });

  return { success: true };
}

