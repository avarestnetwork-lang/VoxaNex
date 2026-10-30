import {
  SafetyReport,
  AgeAssuranceConfig,
  AgeAssuranceRecord,
  UserRestrictionRecord,
  ModerationAppeal,
  ModerationAuditLog,
  UserConnection,
  BlockedUserEntry,
  ReportCategory,
  ReportTargetType,
} from '../types';

class SafetyService {
  /**
   * Submit an actionable safety report
   */
  async submitReport(params: {
    targetType: ReportTargetType;
    targetId: string;
    reportedTarget: string;
    reportedUserId?: string;
    reporterId?: string;
    reporterNickname?: string;
    category: ReportCategory;
    reasonText: string;
    evidenceSnapshot?: any;
  }): Promise<{ success: boolean; reportId?: string; error?: string }> {
    try {
      const res = await fetch('/api/safety/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; reportId?: string; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error submitting report' };
    }
  }

  /**
   * Check status of a submitted report
   */
  async checkReportStatus(reportId: string, reporterId?: string): Promise<{ success: boolean; report?: any; error?: string }> {
    try {
      const url = `/api/safety/report/${reportId}${reporterId ? `?reporterId=${encodeURIComponent(reporterId)}` : ''}`;
      const res = await fetch(url);
      return (await res.json()) as { success: boolean; report?: any; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Age assurance: fetch config and legal notices
   */
  async getAgeAssuranceConfig(): Promise<{ success: boolean; config: AgeAssuranceConfig }> {
    try {
      const res = await fetch('/api/safety/age-assurance/config');
      return (await res.json()) as { success: boolean; config: AgeAssuranceConfig };
    } catch {
      return {
        success: false,
        config: {
          minimumAge: 18,
          selfDeclarationAllowed: true,
          thirdPartyProvider: 'local_declaration_only',
          strictEnforcement: true,
          disclaimerVersion: 'v2.0-fallback',
          bangladeshLawsAcknowledged: true,
          internationalCompliance: {
            ukOnlineSafetyAct: true,
            avmsdCompliant: true,
            coppaStrict: true,
          },
        },
      };
    }
  }

  /**
   * Check user age verification record and adult room eligibility
   */
  async checkAgeStatus(userId: string): Promise<{ success: boolean; record?: AgeAssuranceRecord; eligibility?: { eligible: boolean; reason?: string } }> {
    try {
      const res = await fetch(`/api/safety/age-assurance/status?userId=${encodeURIComponent(userId)}`);
      return (await res.json()) as { success: boolean; record?: AgeAssuranceRecord; eligibility?: { eligible: boolean; reason?: string } };
    } catch {
      return { success: false };
    }
  }

  /**
   * Submit age self-declaration
   */
  async submitAgeDeclaration(userId: string, birthYear: number, consentAffirmed: boolean): Promise<{ success: boolean; record?: AgeAssuranceRecord; error?: string }> {
    try {
      const res = await fetch('/api/safety/age-assurance/declare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, birthYear, consentAffirmed }),
      });
      return (await res.json()) as { success: boolean; record?: AgeAssuranceRecord; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Initiate sandbox third-party age verification session (Persona / Yoti / Veriff)
   */
  async startProviderVerification(userId: string, provider: string): Promise<{ success: boolean; sessionId?: string; redirectUrl?: string; error?: string }> {
    try {
      const res = await fetch('/api/safety/age-assurance/provider/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, provider }),
      });
      return (await res.json()) as { success: boolean; sessionId?: string; redirectUrl?: string; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Complete third-party verification session
   */
  async completeProviderVerification(params: {
    userId: string;
    provider: string;
    sessionId: string;
    isAdultConfirmed: boolean;
    referenceProofToken: string;
  }): Promise<{ success: boolean; record?: AgeAssuranceRecord; error?: string }> {
    try {
      const res = await fetch('/api/safety/age-assurance/provider/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; record?: AgeAssuranceRecord; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Revoke age verification (Moderator/Admin)
   */
  async revokeAgeVerification(userId: string, reason: string, role = 'admin'): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/age-assurance/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ userId, reason }),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  /**
   * Block / Unblock user
   */
  async toggleBlockUser(params: {
    blockerId: string;
    targetId: string;
    targetNickname?: string;
    targetAvatar?: string;
    blocked: boolean;
    reason?: string;
  }): Promise<boolean> {
    try {
      const res = await fetch('/api/moderation/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  /**
   * Get blocked users list
   */
  async getBlockedUsers(userId: string): Promise<BlockedUserEntry[]> {
    try {
      const res = await fetch(`/api/moderation/blocks?userId=${encodeURIComponent(userId)}`);
      const data = (await res.json()) as { blockedUsers?: BlockedUserEntry[] };
      return data.blockedUsers || [];
    } catch {
      return [];
    }
  }

  /**
   * Check restriction status for a user
   */
  async checkRestriction(userId: string): Promise<{ isRestricted: boolean; restriction?: UserRestrictionRecord }> {
    try {
      const res = await fetch(`/api/moderation/status?userId=${encodeURIComponent(userId)}`);
      return (await res.json()) as { isRestricted: boolean; restriction?: UserRestrictionRecord };
    } catch {
      return { isRestricted: false };
    }
  }

  /**
   * Submit moderation appeal
   */
  async submitAppeal(userId: string, userNickname: string, statement: string): Promise<{ success: boolean; appeal?: ModerationAppeal; error?: string }> {
    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userNickname, statement }),
      });
      return (await res.json()) as { success: boolean; appeal?: ModerationAppeal; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * User connections (friends)
   */
  async getConnections(userId: string): Promise<UserConnection[]> {
    try {
      const res = await fetch(`/api/connections?userId=${encodeURIComponent(userId)}`);
      const data = (await res.json()) as { connections?: UserConnection[] };
      return data.connections || [];
    } catch {
      return [];
    }
  }

  async sendConnectionRequest(params: {
    requesterId: string;
    requesterNickname: string;
    requesterAvatar: string;
    recipientId: string;
    recipientNickname: string;
    recipientAvatar: string;
  }): Promise<{ success: boolean; connection?: UserConnection; error?: string }> {
    try {
      const res = await fetch('/api/connections/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; connection?: UserConnection; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async respondConnection(connectionId: string, recipientId: string, accept: boolean): Promise<boolean> {
    try {
      const res = await fetch(`/api/connections/${connectionId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId, accept }),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  /**
   * Privacy Data Export (JSON download)
   */
  async exportUserData(userId: string): Promise<any> {
    try {
      const res = await fetch(`/api/auth/data-export?userId=${encodeURIComponent(userId)}`);
      const data = (await res.json()) as { export?: any };
      return data.export;
    } catch {
      return null;
    }
  }

  /**
   * Account Deletion Purge
   */
  async deleteAccount(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      return (await res.json()) as { success: boolean; message: string };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Admin / Moderator Console Functions
   */
  async fetchAdminReports(role = 'admin'): Promise<SafetyReport[]> {
    try {
      const res = await fetch('/api/admin/reports', {
        headers: { 'x-user-role': role },
      });
      const data = (await res.json()) as { reports?: SafetyReport[] };
      return data.reports || [];
    } catch {
      return [];
    }
  }

  async updateAdminReportStatus(
    reportId: string,
    status: SafetyReport['status'],
    actionTaken?: SafetyReport['actionTaken'],
    moderatorNotes?: string,
    role = 'admin'
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ status, actionTaken, moderatorNotes }),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  async fetchAdminRestrictions(role = 'admin'): Promise<UserRestrictionRecord[]> {
    try {
      const res = await fetch('/api/admin/restrictions', {
        headers: { 'x-user-role': role },
      });
      const data = (await res.json()) as { restrictions?: UserRestrictionRecord[] };
      return data.restrictions || [];
    } catch {
      return [];
    }
  }

  async imposeRestriction(params: {
    userId: string;
    userNickname: string;
    type: UserRestrictionRecord['type'];
    scope?: UserRestrictionRecord['scope'];
    reason: string;
    role?: string;
  }): Promise<{ success: boolean; restriction?: UserRestrictionRecord; error?: string }> {
    try {
      const res = await fetch('/api/admin/restrictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': params.role || 'admin' },
        body: JSON.stringify(params),
      });
      return (await res.json()) as { success: boolean; restriction?: UserRestrictionRecord; error?: string };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async liftRestriction(userId: string, reason: string, role = 'admin'): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/restrictions/${userId}/lift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ reason }),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  async fetchAdminAppeals(role = 'admin'): Promise<ModerationAppeal[]> {
    try {
      const res = await fetch('/api/admin/appeals', {
        headers: { 'x-user-role': role },
      });
      const data = (await res.json()) as { appeals?: ModerationAppeal[] };
      return data.appeals || [];
    } catch {
      return [];
    }
  }

  async reviewAppeal(appealId: string, status: 'accepted' | 'rejected', notes?: string, role = 'admin'): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/appeals/${appealId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ status, notes }),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  async fetchAuditLogs(role = 'admin'): Promise<ModerationAuditLog[]> {
    try {
      const res = await fetch('/api/admin/audit-logs', {
        headers: { 'x-user-role': role },
      });
      const data = (await res.json()) as { auditLogs?: ModerationAuditLog[] };
      return data.auditLogs || [];
    } catch {
      return [];
    }
  }
}

export const safetyService = new SafetyService();
