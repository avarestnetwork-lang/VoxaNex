# Diagnostic Report: HTTP 503 on /api/guest/session

## 1. Deployment Target
- **Worker Name**: `voxanex-staging` (per `[env.staging]` in `wrangler.toml`)
- **Configured Main**: `build/worker.js`

## 2. Runtime Binding Presence
The environment variables/secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GUEST_SESSION_SECRET`) are not correctly bound to the `env` object in the staging environment. While they appear as variables or secrets in the Cloudflare Dashboard, they are missing from the `[env.staging]` block in `wrangler.toml`, which is necessary for the Worker to receive them during deployment via Wrangler.

## 3. 503 Branch
The 503 error originates in `src/worker.ts` at the guest session initialization:
```typescript
if (!baseSupabaseUrl || !supabaseServiceKey) {
  return jsonResponse({
    success: false,
    error: 'Server configuration error: Database bindings missing.',
  }, 503);
}
```
This check triggers because `env.SUPABASE_URL` and `env.SUPABASE_SERVICE_ROLE_KEY` are not present in the runtime `env` object.

## 4. Build Consistency
- **Verified**: `package.json` build script correctly compiles `src/worker.ts` into `build/worker.js`.
- **Verified**: `wrangler.toml` correctly sets `main = "build/worker.js"`.
- The build process is consistent with the deployment target.

## 5. Alternative Causes
- No other middleware or route modification was observed to strip the `env` bindings.
- The 503 is strictly due to the environment bindings not being properly mapped in `wrangler.toml` for the staging deployment.

## 6. Root Cause Status
- **Root Cause**: The staging environment configuration in `wrangler.toml` lacks the required binding declarations for the Supabase service and guest session secrets.
- **Status**: Identified and confirmed.

## 7. Next Action
The `wrangler.toml` configuration needs to be updated to map the required environment variables and secrets to the `staging` environment. As this is a strictly read-only diagnostic, no changes have been applied.
