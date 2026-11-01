# VoxaNex Chat System Audit Report

## 1. Architectural Data Flow

### Authentication
- **Guest Auth**: Tokens signed via `GUEST_SESSION_SECRET` (HMAC-SHA256). Validated on every request against `public.guest_sessions` in Supabase (check: ID, token hash, revocation status, expiry).
- **Member Auth**: JWT validation via Supabase Auth API (`/auth/v1/user`) or Supabase client `getUser()` call.

### Messaging
- **Public Room**:
  - POST `/api/chat/rooms/:roomId/messages`: Server validates, persists to Supabase, broadcasts via `roomStreams` (Worker-local), Supabase Realtime, and BroadcastChannel.
  - GET `.../messages`: Fetches history from server (which queries Supabase).
- **Private Conversations**:
  - POST `/api/chat/conversations/:id/messages`: Similar flow to public, uses conversation-specific handlers (`conversationStreams`).

### SSE & Realtime
- **SSE Streams**:
  - `userDMStreams` (DM events)
  - `roomStreams` (Public room events)
  - `conversationStreams` (Private conversation events)
  - *Reliability Note*: These rely on **Worker-isolate-local** `Map`s of `ReadableStreamDefaultController`s. This is **NOT** cross-isolate safe.

## 2. Persistence vs. Memory State
- **Persistent (Supabase)**: User accounts, guest sessions, all messages (`room_messages`, `conversation_messages`), room metadata, block lists, reports, presence (partially), read receipts.
- **Worker-Local (Volatile)**: SSE stream controllers (`roomStreams`, `conversationStreams`, `userDMStreams`), active typing state, account deletion cache. **These are lost on Worker restart or isolate migration.**
- **Browser-Local**: `localStorage` (Guest token), `BroadcastChannel` (cross-tab sync).

## 3. Reliability Analysis
- **Cross-Isolate Risk**: The reliance on local `Map`s for SSE broadcasting means clients connected to different Cloudflare isolates will *not* receive realtime messages via SSE if those events are broadcast only to the local controller map.
- **Supabase Realtime**: Used as a fallback/sync mechanism for rooms and DMs. This is the primary reliable path for cross-isolate delivery.

## 4. Security Findings
- Private SSE endpoints correctly implement authentication and membership validation (preventing access to conversations not belonging to the authenticated user).
- Guest session verification is strictly enforced using `public.guest_sessions`.
- 401/403 errors correctly stop reconnect loops in `connectCustomSSE`.
- The `reader.cancel()` correction ensures resource cleanup on cancellation.
