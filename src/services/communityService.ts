import {
  ForumTopic,
  ForumReply,
  BlogArticle,
  BlogComment,
  CommunityGuide,
  Room,
  AdminPlatformSettings,
  SafetyReport,
} from '../types';

export interface ForumTopicsResponse {
  success: boolean;
  topics: ForumTopic[];
  total: number;
  page: number;
  totalPages: number;
  error?: string;
}

export const communityService = {
  // ---------------------------------------------------------------------------
  // FORUM APIS
  // ---------------------------------------------------------------------------
  async getTopics(params?: {
    category?: string;
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<ForumTopicsResponse> {
    try {
      const url = new URL('/api/forum/topics', window.location.origin);
      if (params?.category) url.searchParams.set('category', params.category);
      if (params?.q) url.searchParams.set('q', params.q);
      if (params?.page) url.searchParams.set('page', params.page.toString());
      if (params?.limit) url.searchParams.set('limit', params.limit.toString());

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to fetch forum topics');
      return await res.json();
    } catch (err: any) {
      return { success: false, topics: [], total: 0, page: 1, totalPages: 1, error: err.message };
    }
  },

  async getTopicById(id: string): Promise<{ success: boolean; topic?: ForumTopic; error?: string }> {
    try {
      const res = await fetch(`/api/forum/topics/${id}`);
      if (!res.ok) throw new Error('Topic not found');
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async createTopic(params: {
    authorId: string;
    authorNickname: string;
    authorAvatar: string;
    authorRole?: 'user' | 'moderator' | 'admin';
    title: string;
    category: ForumTopic['category'];
    categoryLabel: { en: string; bn: string };
    content: string;
  }): Promise<{ success: boolean; topic?: ForumTopic; error?: string }> {
    try {
      const res = await fetch('/api/forum/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; topic?: ForumTopic; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async replyToTopic(params: {
    topicId: string;
    authorId: string;
    authorNickname: string;
    authorAvatar: string;
    authorRole?: 'user' | 'moderator' | 'admin';
    content: string;
  }): Promise<{ success: boolean; reply?: ForumReply; error?: string }> {
    try {
      const res = await fetch(`/api/forum/topics/${params.topicId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; reply?: ForumReply; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async editTopic(
    id: string,
    params: { authorId: string; authorRole?: string; title?: string; content?: string }
  ): Promise<{ success: boolean; topic?: ForumTopic; error?: string }> {
    try {
      const res = await fetch(`/api/forum/topics/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': params.authorRole || 'user',
          'x-user-id': params.authorId,
        },
        body: JSON.stringify(params),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async lockTopic(id: string, isLocked: boolean, userRole = 'moderator'): Promise<boolean> {
    try {
      const res = await fetch(`/api/forum/topics/${id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': userRole },
        body: JSON.stringify({ isLocked }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async pinTopic(id: string, pinned: boolean, userRole = 'moderator'): Promise<boolean> {
    try {
      const res = await fetch(`/api/forum/topics/${id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': userRole },
        body: JSON.stringify({ pinned }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async deleteTopic(id: string, role = 'user', authorId?: string): Promise<boolean> {
    try {
      const url = new URL(`/api/forum/topics/${id}`, window.location.origin);
      if (authorId) url.searchParams.set('authorId', authorId);
      url.searchParams.set('role', role);

      const res = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          'x-user-role': role,
          ...(authorId ? { 'x-user-id': authorId } : {}),
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async deleteReply(topicId: string, replyId: string, role = 'user', authorId?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/forum/topics/${topicId}/replies/${replyId}`, {
        method: 'DELETE',
        headers: {
          'x-user-role': role,
          ...(authorId ? { 'x-user-id': authorId } : {}),
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async moderateReply(topicId: string, replyId: string, isApproved: boolean, role = 'moderator'): Promise<boolean> {
    try {
      const res = await fetch(`/api/forum/topics/${topicId}/replies/${replyId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ isApproved }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // ---------------------------------------------------------------------------
  // BLOG & CMS APIS
  // ---------------------------------------------------------------------------
  async getArticles(params?: { status?: string; tag?: string }): Promise<BlogArticle[]> {
    try {
      const url = new URL('/api/blog/articles', window.location.origin);
      if (params?.status) url.searchParams.set('status', params.status);
      if (params?.tag) url.searchParams.set('tag', params.tag);

      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const data = (await res.json()) as { articles?: BlogArticle[] };
      return data.articles || [];
    } catch {
      return [];
    }
  },

  async getArticleBySlug(slug: string): Promise<BlogArticle | null> {
    try {
      const res = await fetch(`/api/blog/articles/${slug}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { article?: BlogArticle };
      return data.article || null;
    } catch {
      return null;
    }
  },

  async publishArticle(article: BlogArticle, userRole: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/blog/articles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify(article),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async deleteArticle(slug: string, userRole = 'admin'): Promise<boolean> {
    try {
      const res = await fetch(`/api/blog/articles/${slug}`, {
        method: 'DELETE',
        headers: { 'x-user-role': userRole },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async addCommentToArticle(
    slug: string,
    authorNickname: string,
    authorAvatar: string,
    content: string
  ): Promise<{ success: boolean; comment?: BlogComment; error?: string }> {
    try {
      const res = await fetch(`/api/blog/articles/${slug}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorNickname, authorAvatar, content }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async moderateComment(
    slug: string,
    commentId: string,
    status: 'approved' | 'rejected',
    role = 'moderator'
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/blog/articles/${slug}/comments/${commentId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ status }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async deleteComment(slug: string, commentId: string, role = 'moderator'): Promise<boolean> {
    try {
      const res = await fetch(`/api/blog/articles/${slug}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': role },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // ---------------------------------------------------------------------------
  // COMMUNITY GUIDES
  // ---------------------------------------------------------------------------
  async getGuides(): Promise<{ guides: CommunityGuide[]; legalDisclaimer?: string }> {
    try {
      const res = await fetch('/api/guides');
      if (!res.ok) return { guides: [] };
      const data = (await res.json()) as { guides?: CommunityGuide[]; legalDisclaimer?: string };
      return {
        guides: data.guides || [],
        legalDisclaimer: data.legalDisclaimer,
      };
    } catch {
      return { guides: [] };
    }
  },

  async getGuideBySlug(slug: string): Promise<CommunityGuide | null> {
    try {
      const res = await fetch(`/api/guides/${slug}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { guide?: CommunityGuide };
      return data.guide || null;
    } catch {
      return null;
    }
  },

  async updateGuide(
    slug: string,
    updates: Partial<CommunityGuide>,
    role = 'admin'
  ): Promise<{ success: boolean; guide?: CommunityGuide; error?: string }> {
    try {
      const res = await fetch(`/api/admin/guides/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify(updates),
      });
      return (await res.json()) as { success: boolean; guide?: CommunityGuide; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  // ---------------------------------------------------------------------------
  // INTERNATIONAL ROOMS CATALOG (WITH LIVE PARTICIPANT TELEMETRY)
  // ---------------------------------------------------------------------------
  async getCatalogRooms(): Promise<Room[]> {
    try {
      const res = await fetch('/api/rooms/catalog');
      if (!res.ok) return [];
      const data = (await res.json()) as { rooms?: Room[] };
      return data.rooms || [];
    } catch {
      return [];
    }
  },

  async createRoom(room: Room, role = 'admin'): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/admin/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify(room),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async updateRoom(
    roomId: string,
    updates: Partial<Room>,
    role = 'admin'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify(updates),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async deleteRoom(roomId: string, role = 'admin'): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': role },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // ---------------------------------------------------------------------------
  // SAFE YOUTUBE, MEDIA VALIDATION & PROVIDERS
  // ---------------------------------------------------------------------------
  async validateYouTube(url: string): Promise<{
    valid: boolean;
    videoId?: string;
    safeEmbedUrl?: string;
    thumbnailUrl?: string;
    requiresUserAction?: boolean;
    autoplayAllowed?: boolean;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/media/youtube/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return await res.json();
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  },

  async validateUpload(params: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    uploaderId: string;
  }): Promise<{
    valid: boolean;
    uploadId?: string;
    sanitizedFileName?: string;
    sanitizedUrl?: string;
    fileSize?: number;
    mimeType?: string;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/media/upload/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return await res.json();
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  },

  async flagMedia(uploadId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/media/${uploadId}/flag`, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getAdminMedia(role = 'moderator'): Promise<any[]> {
    try {
      const res = await fetch('/api/admin/media', {
        headers: { 'x-user-role': role },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { media?: any[] };
      return data.media || [];
    } catch {
      return [];
    }
  },

  async deleteAdminMedia(uploadId: string, role = 'moderator'): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/media/${uploadId}`, {
        method: 'DELETE',
        headers: { 'x-user-role': role },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getProviderDocs(): Promise<any> {
    try {
      const res = await fetch('/api/media/providers/docs');
      if (!res.ok) return null;
      const data = (await res.json()) as { providers?: any };
      return data.providers;
    } catch {
      return null;
    }
  },

  // ---------------------------------------------------------------------------
  // ADMIN DASHBOARD & MODERATION ACTIONS
  // ---------------------------------------------------------------------------
  async getAdminMetrics(): Promise<any> {
    try {
      const res = await fetch('/api/admin/metrics');
      if (!res.ok) return null;
      const data = (await res.json()) as { metrics?: any };
      return data.metrics;
    } catch {
      return null;
    }
  },

  async getReports(): Promise<SafetyReport[]> {
    try {
      const res = await fetch('/api/admin/reports');
      if (!res.ok) return [];
      const data = (await res.json()) as { reports?: SafetyReport[] };
      return data.reports || [];
    } catch {
      return [];
    }
  },

  async updateReport(id: string, status: SafetyReport['status'], actionTaken?: SafetyReport['actionTaken']): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/reports/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, actionTaken }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getRestrictions(): Promise<any[]> {
    try {
      const res = await fetch('/api/admin/restrictions');
      if (!res.ok) return [];
      const data = (await res.json()) as { restrictions?: any[] };
      return data.restrictions || [];
    } catch {
      return [];
    }
  },

  async imposeRestriction(params: {
    userId: string;
    userNickname: string;
    type: string;
    reason: string;
    imposedBy: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/admin/restrictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; error?: string };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to impose restriction' };
    }
  },

  async getAppeals(): Promise<any[]> {
    try {
      const res = await fetch('/api/admin/appeals');
      if (!res.ok) return [];
      const data = (await res.json()) as { appeals?: any[] };
      return data.appeals || [];
    } catch {
      return [];
    }
  },

  async submitAppeal(userId: string, userNickname: string, statement: string): Promise<boolean> {
    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userNickname, statement }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async reviewAppeal(appealId: string, status: 'accepted' | 'rejected', notes?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/appeals/${appealId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes, reviewer: 'Admin' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getAdminSettings(): Promise<AdminPlatformSettings | null> {
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) return null;
      const data = (await res.json()) as { settings?: AdminPlatformSettings };
      return data.settings || null;
    } catch {
      return null;
    }
  },

  async updateAdminSettings(settings: Partial<AdminPlatformSettings>): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
