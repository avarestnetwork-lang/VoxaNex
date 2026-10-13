# VoxaNex Supabase Backend Setup & Security Manual

This directory contains the database migration scripts, seeds, and security policies for **VoxaNex (Phase 2)**.

---

## 1. Quickstart Configuration

1. Create a project at [supabase.com](https://supabase.com).
2. Copy your Project URL and Anon Public Key from **Project Settings > API**.
3. In your VoxaNex deployment environment (`.env`):
   ```bash
   VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
   VITE_SUPABASE_ANON_KEY="your-anon-public-jwt"
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-secret" # Server-side only
   GUEST_SESSION_SECRET="random-string-at-least-32-chars-long"
   ```

---

## 2. Deploying Migrations & Seed Data

### Option A: Using the Supabase Dashboard SQL Editor
1. Open your Supabase Dashboard > **SQL Editor**.
2. Copy and paste the entire contents of `supabase/migrations/20260320000001_voxanex_core_schema.sql` and run it.
3. Next, copy and paste `supabase/seed.sql` and run it.

### Option B: Using the Supabase CLI
```bash
# Link your local project
npx supabase link --project-ref your-project-ref

# Push the schema migration
npx supabase db push

# Apply seed data
npx supabase db execute --file supabase/seed.sql
```

---

## 3. Storage Buckets Configuration

In **Supabase Dashboard > Storage > Create new bucket**:

1. **`avatars`**:
   - Public: **Yes**
   - File size limit: **2 MB**
   - Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`
   - Policy: Authenticated users can upload to `avatars/{user_id}/*`, public can read.

2. **`evidence_snapshots`**:
   - Public: **No** (Private)
   - File size limit: **5 MB**
   - Policy: Only users with `role = 'moderator'` or `'admin'` can read.

---

## 4. Row Level Security (RLS) Architecture

Every table enforces Row-Level Security:

| Table | Public Read | Public Insert | User Update | Admin/Mod Access |
| :--- | :--- | :--- | :--- | :--- |
| `profiles` | Safe fields only | Self (`auth.uid() = id`) | Self (Role field protected by trigger) | Full |
| `chat_rooms` | Active channels only | ❌ Denied | ❌ Denied | Full |
| `conversations` | ❌ Participants only | Authenticated | ❌ Denied | ❌ Non-readable (E2EE standard) |
| `conversation_participants`| ❌ Participants only | Self | ❌ Denied | ❌ Denied |
| `messages` | Room messages only | Self in room / conv | ❌ Denied | Room moderation delete |
| `reports` | ❌ Denied | Authenticated or Guest | ❌ Denied | Full Triage |
| `moderation_actions` | ❌ Denied | ❌ Denied | ❌ Denied | Full Read/Write |
| `admin_audit_logs` | ❌ Denied | ❌ Denied | ❌ Denied | Admin Read Only |

---

## 5. Security & Role Escalation Protection

A PostgreSQL trigger (`trg_protect_profile_role`) strictly prevents any regular user from upgrading their own `role` to `moderator` or `admin`. Role changes must be executed by existing administrators or the secure service role.
