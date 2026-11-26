import { RoomBroadcast } from '../types';
import { getAuthToken } from './messagingService';

export interface BroadcastStatusResponse {
  success: boolean;
  sfuConfigured: boolean;
  missingBindings?: string[];
  error?: string;
}

export interface RoomBroadcastsResponse {
  success: boolean;
  sfuConfigured: boolean;
  broadcasts: RoomBroadcast[];
  error?: string;
}

export interface StartBroadcastResponse {
  success: boolean;
  broadcast?: RoomBroadcast;
  unavailable?: boolean;
  missingBindings?: string[];
  error?: string;
}

class BroadcastService {
  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await getAuthToken({ allowPublicFallback: true });
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public async getBroadcastStatus(): Promise<BroadcastStatusResponse> {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/broadcast/status', { headers });
      const data = await res.json().catch(() => null);
      if (data && typeof data === 'object') {
        return data as BroadcastStatusResponse;
      }
    } catch (err) {
      console.warn('[BroadcastService] Failed to fetch status:', err);
    }
    return {
      success: false,
      sfuConfigured: false,
      missingBindings: ['CALLS_APP_ID', 'CALLS_APP_SECRET'],
    };
  }

  public async fetchRoomBroadcasts(roomId: string): Promise<RoomBroadcastsResponse> {
    if (!roomId) return { success: true, sfuConfigured: false, broadcasts: [] };
    try {
      const headers = await this.getHeaders();
      const res = await fetch(`/api/broadcast/room/${encodeURIComponent(roomId)}`, { headers });
      const data = await res.json().catch(() => null);
      if (data && typeof data === 'object' && Array.isArray(data.broadcasts)) {
        return data as RoomBroadcastsResponse;
      }
    } catch (err) {
      console.warn('[BroadcastService] Failed to fetch room broadcasts:', err);
    }
    return { success: false, sfuConfigured: false, broadcasts: [] };
  }

  public async startBroadcast(roomId: string): Promise<StartBroadcastResponse> {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/broadcast/start', {
        method: 'POST',
        headers,
        body: JSON.stringify({ roomId }),
      });
      const data = await res.json().catch(() => null);
      if (data && typeof data === 'object') {
        return data as StartBroadcastResponse;
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Network request failed' };
    }
    return { success: false, error: 'Failed to initiate broadcast' };
  }

  public async endBroadcast(broadcastId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/broadcast/end', {
        method: 'POST',
        headers,
        body: JSON.stringify({ broadcastId }),
      });
      const data = await res.json().catch(() => null);
      if (data && typeof data === 'object' && data.success) {
        return { success: true };
      }
      return { success: false, error: data?.error || 'Failed to end broadcast' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  }

  public async subscribeToBroadcast(
    broadcastId: string
  ): Promise<{ success: boolean; unavailable?: boolean; error?: string }> {
    try {
      const headers = await this.getHeaders();
      const res = await fetch('/api/broadcast/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ broadcastId }),
      });
      const data = await res.json().catch(() => null);
      if (data && typeof data === 'object') {
        return data;
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Subscription request failed' };
    }
    return { success: false, error: 'Subscription failed' };
  }
}

export const broadcastService = new BroadcastService();
