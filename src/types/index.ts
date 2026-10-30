/**
 * Core type definitions for VoxaNex platform.
 * Phase 1: UI/UX, routing, client-side state, and Phase 2 backend preparation.
 */

export type AppLanguage = 'en' | 'bn';

export type CommunicationMode = 'text' | 'voice' | 'video';

export type RoomCategory =
  | 'bangla-adult'
  | 'bangladesh-random'
  | 'banglish-chat'
  | 'regional'
  | 'international'
  | 'english'
  | 'gaming-tech'
  | 'adult'
  | 'social';

export type RoomLanguage = 'bn' | 'en' | 'mixed' | 'hi' | 'ur' | 'de' | 'ta' | 'other';

export interface RoomRules {
  en: string[];
  bn: string[];
}

export interface Room {
  id: string;
  slug: string;
  name: {
    en: string;
    bn: string;
  };
  description: {
    en: string;
    bn: string;
  };
  category: RoomCategory;
  categoryLabel: {
    en: string;
    bn: string;
  };
  language: RoomLanguage;
  modes: CommunicationMode[];
  is18Plus: boolean;
  requiresAccount: boolean;
  region?: string;
  country?: string;
  flagUrl?: string;
  rules?: RoomRules;
  activeParticipants?: number;
  /** Status indicates readiness or Phase 2 Supabase connection requirement */
  backendStatus: 'ready_local_demo' | 'phase2_realtime_pending';
}

export type UserGender = 'male' | 'female' | 'couple' | 'other' | 'prefer_not_to_say';

export interface UserProfile {
  id: string;
  nickname: string;
  email?: string;
  isGuest: boolean;
  is18Verified: boolean;
  verifiedAt?: string;
  verificationMethod?: 'self_declaration' | 'third_party_id' | 'pending';
  ageVerificationStatus?: AgeVerificationStatus;
  avatar: string;
  gender?: UserGender;
  bio?: string;
  interests?: string[];
  onlineVisibility?: 'online' | 'away' | 'stealth_invisible';
  allowDiscoverability?: boolean;
  allowDirectMessages?: 'everyone' | 'connections_only' | 'nobody';
  languagePreference: AppLanguage;
  audioDeviceId?: string;
  videoDeviceId?: string;
  safeFilterEnabled: boolean;
  notificationSounds: boolean;
  role?: 'user' | 'moderator' | 'admin';
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  roomId?: string;
  conversationId?: string;
  recipientId?: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: any;
  timestamp: string; // ISO 8601 string
  isSystem?: boolean;
  isDirect?: boolean;
  clientNonce?: string;
  status?: 'sending' | 'delivered' | 'failed';
}

export interface DirectConversation {
  id: string;
  partnerId: string;
  partnerNickname: string;
  partnerAvatar: string;
  partnerOnlineStatus: 'idle' | 'in_call' | 'offline_phase2';
  lastMessage: string;
  lastMessageTimestamp: string;
  unreadCount: number;
}

export interface RandomMatchPreference {
  language: 'all' | 'bn' | 'en';
  mode: 'text' | 'voice' | 'video';
  interests: string[];
  safeModeOnly: boolean;
  adultGateAccepted: boolean;
}

export interface ForumReply {
  id: string;
  topicId: string;
  authorId: string;
  authorNickname: string;
  authorAvatar: string;
  authorRole?: 'user' | 'moderator' | 'admin';
  content: string;
  createdAt: string;
  isModeratorApproved?: boolean;
}

export interface ForumTopic {
  id: string;
  title: string;
  category: 'general' | 'banglish' | 'tech' | 'regional' | 'safety' | 'international';
  categoryLabel: { en: string; bn: string };
  authorId: string;
  author: string;
  authorAvatar: string;
  authorRole?: 'user' | 'moderator' | 'admin';
  repliesCount: number;
  viewsCount: number;
  lastActivity: string;
  createdAt: string;
  pinned?: boolean;
  isLocked?: boolean;
  content: string;
  replies?: ForumReply[];
}

export interface BlogComment {
  id: string;
  articleId: string;
  authorNickname: string;
  authorAvatar: string;
  content: string;
  createdAt: string;
  status: 'approved' | 'pending' | 'rejected';
}

export interface BlogArticle {
  id: string;
  slug: string;
  title: { en: string; bn: string };
  summary: { en: string; bn: string };
  content: { en: string; bn: string };
  category: string;
  tags?: string[];
  readTime: string;
  publishedAt: string;
  author: string;
  authorRole?: 'editor' | 'admin' | 'staff';
  status: 'draft' | 'published' | 'archived';
  comments?: BlogComment[];
}

export interface CommunityGuide {
  id: string;
  slug: string;
  title: { en: string; bn: string };
  summary: { en: string; bn: string };
  icon: string;
  category: 'onboarding' | 'safety' | 'privacy' | 'rules';
  lastUpdated: string;
  sections: {
    heading: { en: string; bn: string };
    body: { en: string; bn: string };
    doList?: { en: string[]; bn: string[] };
    dontList?: { en: string[]; bn: string[] };
  }[];
}

export interface AdminPlatformSettings {
  featureFlags: {
    randomMatchingEnabled: boolean;
    webRtcCallingEnabled: boolean;
    guestAccessEnabled: boolean;
    banglaAdultLoungeEnabled: boolean;
    publicRoomChatEnabled: boolean;
    communityForumEnabled: boolean;
  };
  rateLimits: {
    maxRoomMessagesPerMinute: number;
    maxDmsPerMinute: number;
    maxCallsPerFiveMinutes: number;
    maxGuestSessionsPerHour: number;
  };
  contentPolicy: {
    autoFilterOffensiveTerms: boolean;
    requireApprovalForForumPosts: boolean;
    quarantineAdultKeywords: boolean;
    strictAgeGateMandatory: boolean;
    requireThirdPartyAgeProof: boolean;
  };
  retention: {
    guestSessionRetentionHours: number;
    roomMessageRetentionDays: number;
    callLogRetentionDays: number;
    auditLogRetentionDays: number;
  };
}

export type ReportCategory =
  | 'harassment'
  | 'threats'
  | 'underage_suspicion'
  | 'hate_speech'
  | 'spam'
  | 'scam'
  | 'non_consensual_imagery'
  | 'exploitation'
  | 'illegal_content'
  | 'other';

export type ReportTargetType = 'user' | 'message' | 'profile' | 'room';

export interface SafetyReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reportedTarget: string; // Nickname or Room Name
  reportedUserId?: string;
  reporterId?: string;
  reporterNickname?: string; // Anonymized to public
  category: ReportCategory;
  reasonText: string;
  evidenceSnapshot?: {
    textSnippet?: string;
    roomId?: string;
    messageId?: string;
    callId?: string;
    timestamp?: string;
  } | string;
  timestamp: string;
  status: 'received' | 'investigating' | 'action_taken' | 'resolved' | 'dismissed';
  actionTaken?: 'none' | 'warned' | 'muted' | 'suspended_24h' | 'suspended_7d' | 'banned_permanent' | 'room_locked';
  moderatorNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export type AgeVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified_adult_18plus'
  | 'rejected_underage'
  | 'revoked';

export type AgeAssuranceProvider =
  | 'local_declaration_only'
  | 'persona_sandbox'
  | 'yoti_sandbox'
  | 'veriff_sandbox';

export interface AgeAssuranceConfig {
  minimumAge: number;
  selfDeclarationAllowed: boolean;
  thirdPartyProvider: AgeAssuranceProvider;
  strictEnforcement: boolean;
  disclaimerVersion: string;
  bangladeshLawsAcknowledged: boolean;
  internationalCompliance: {
    ukOnlineSafetyAct: boolean;
    avmsdCompliant: boolean;
    coppaStrict: boolean;
  };
}

export interface AgeAssuranceRecord {
  userId: string;
  status: AgeVerificationStatus;
  method: string;
  verifiedAt?: string;
  expiresAt?: string;
  providerReferenceId?: string;
  providerProofHash?: string; // Zero-knowledge cryptographic proof (no PII stored)
  notes?: string;
}

export interface ModerationAuditLog {
  id: string;
  actorId: string;
  actorNickname: string;
  actorRole: 'moderator' | 'admin' | 'system' | 'user';
  action:
    | 'impose_restriction'
    | 'lift_restriction'
    | 'resolve_report'
    | 'dismiss_report'
    | 'review_appeal'
    | 'update_platform_settings'
    | 'purge_data'
    | 'lock_room'
    | 'revoke_age_verification';
  targetType: string;
  targetId: string;
  details: Record<string, any>;
  timestamp: string;
}

export type RestrictionType =
  | 'warning'
  | 'muted'
  | 'suspended_24h'
  | 'suspended_7d'
  | 'suspended_30d'
  | 'banned_permanent';

export interface UserRestrictionRecord {
  id: string;
  userId: string;
  userNickname: string;
  type: RestrictionType;
  scope: 'all' | 'rooms' | 'direct_messages' | 'matching' | 'calls';
  reason: string;
  imposedBy: string;
  imposedAt: string;
  expiresAt?: string;
  active: boolean;
  liftedAt?: string;
  liftedBy?: string;
  liftReason?: string;
}

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

export interface UserConnection {
  id: string;
  requesterId: string;
  requesterNickname: string;
  requesterAvatar: string;
  recipientId: string;
  recipientNickname: string;
  recipientAvatar: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  updatedAt: string;
}

export interface BlockedUserEntry {
  targetId: string;
  targetNickname: string;
  targetAvatar: string;
  blockedAt: string;
  reason?: string;
}

export interface ModeratorAssignment {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  gender: string;
  assignedAt: string;
}

export interface Phase2BackendConfig {
  supabaseConfigured: boolean;
  supabaseUrlPlaceholder: string;
  webrtcStunTurnConfigured: boolean;
  realtimeEngine: 'supabase_realtime_or_websocket';
}

export type MatchLifecycleState =
  | 'idle'
  | 'waiting'
  | 'matched'
  | 'connected'
  | 'disconnected';

export interface MatchParticipant {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  regionPool: string;
  interests: string[];
}

export interface MatchSession {
  matchId: string;
  conversationId: string;
  userA: MatchParticipant;
  userB: MatchParticipant;
  sharedInterests: string[];
  regionPool: string;
  language: string;
  status: 'matched' | 'connected' | 'disconnected';
  createdAt: number;
  endedAt?: number;
  endedBy?: string;
}

export interface QueueTicket {
  ticketId: string;
  userId: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  languagePref: 'all' | 'bn' | 'en';
  regionPool: 'bangladesh' | 'international' | 'any';
  interests: string[];
  is18Verified: boolean;
  status: 'waiting' | 'matched' | 'cancelled' | 'expired';
  matchId?: string;
  createdAt: number;
  lastHeartbeat: number;
}

export type CallMediaKind = 'audio' | 'video';

export type CallSessionStatus =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'rejected'
  | 'missed'
  | 'ended'
  | 'failed';

export interface CallParticipant {
  id: string;
  nickname: string;
  avatar: string;
  isGuest?: boolean;
}

export interface CallSessionData {
  callId: string;
  conversationId?: string;
  initiator: CallParticipant;
  callee: CallParticipant;
  mediaKind: CallMediaKind;
  status: CallSessionStatus;
  startedAt?: number;
  endedAt?: number;
  durationSeconds?: number;
  endedReason?: string;
}

export interface WebRTCSignal {
  id: string;
  callId: string;
  senderId: string;
  receiverId: string;
  type: 'offer' | 'answer' | 'ice_candidate' | 'mute_state' | 'hangup';
  payload: any;
  timestamp: string;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

