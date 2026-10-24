# Implementation Plan — Minimal Production Guest Session Recovery Fix

## Proposed Changes

### 1. `src/services/guestSessionService.ts`
- Modify `createSession()` to strictly enforce server-issued tokens in production.
- Prevent generating or storing `vx_gst_local_...` fallback tokens when `fetch()` fails or returns a non-OK status in production environments (allowing fallback strictly in local development where `import.meta.env.DEV` is true).

### 2. `src/services/messagingService.ts`
- Modify `sendRoomMessage()` for `senderType === 'guest'`.
- If `!guestToken`, do not generate a local `vx_gst_local_...` token in production. Return an explicit validation error (`{ success: false, error: 'Guest session expired or missing. Please re-enter chat.' }`) instead of dispatching an invalid token to the server.

### 3. `src/context/AuthContext.tsx`
- Modify `loginGuest()` to handle `createSession()` failures gracefully without activating unverified guest sessions when server token issuance fails in production.

---

## Failure Case Behavior
- **Server Non-OK Response (`POST /api/guest/session` fails):** Returns `{ success: false }`, prevents activation of unauthenticated guest state, and prompts the user properly.
- **Network Failure:** In production, fails closed without storing a local fallback token.
- **Missing Guest Token on Message Send:** Fails fast with a clear error prompt rather than sending an invalid `vx_gst_local_` token that results in a 401 Unauthorized server rejection.

---

## Verification Plan
1. **TypeScript & Linter Checks:** Run `npm run lint` (`tsc --noEmit`).
2. **Production Build:** Run `npm run build` (`compile_applet`).
3. **Guest Login & Messaging Verification:**
   - Verify successful guest sessions operate normally.
   - Verify non-OK server responses fail gracefully without local simulation tokens in production.
