# VoxaNex Guest Session Implementation Backup

This backup contains the verified, strict database-backed Guest Session implementation for ChatLustora.

## Backup Contents
- `src/worker.ts`: The core Cloudflare Worker implementation.
- `wrangler.toml`: Worker configuration.
- `package.json`: Dependencies and build scripts.
- `build/worker.js` (Generated): The compiled Worker bundle.

## Build Instructions
To build the project from this source:
1. Run `npm install` to install dependencies.
2. Run `npm run build` to generate the `build/worker.js` bundle.

## Environment Configuration
The Worker requires the following runtime environment variables to be configured in Cloudflare:
- `GUEST_SESSION_SECRET`: Used for JWT signing. MUST be a strong, random, secure secret.
- `SUPABASE_URL`: The URL of the Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: The Supabase Service Role Key. 

**SECURITY WARNING**: The `SUPABASE_SERVICE_ROLE_KEY` is highly sensitive and grants administrative access to your database. **NEVER** expose this key in frontend code or client-side bundles. It must only be used in secure, server-side environments like Cloudflare Workers.

## Supabase Project Reference
- Staging Supabase URL: `https://iccxxsuincnqwbfyypho.supabase.co`

## Secret Management
The `GUEST_SESSION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` must be configured as **encrypted Cloudflare Secrets** in the Cloudflare dashboard or via `wrangler secret put <SECRET_NAME>`. Do not store these in `wrangler.toml` or any plain-text file.
