-- ============================================================================
-- 006 — cue-image catalog (ADR 0012). A generated cue image is stored ONCE and
-- reused across users, keyed by a content-addressed reuse key. Deliberately
-- NOT user-scoped: unlike every existing table, `cue_images` is a shared,
-- read-by-all / write-by-server catalog. All additive and backward compatible.
-- ============================================================================

-- Shared catalog: one row per reuse key (see src/utils/cueImageKey.ts). The
-- key is the primary key, so the pipeline's cache lookup is a single PK hit and
-- concurrent generations of the same cue collapse via ON CONFLICT.
create table if not exists public.cue_images (
  reuse_key text primary key,
  sport_key text not null,
  target_position text,
  prompt text,                       -- the image prompt used (provenance/debug)
  storage_path text not null,        -- object path within the cue-images bucket
  provider text,                     -- which IImageProvider produced it
  created_at timestamptz not null default now()
);

create index if not exists cue_images_sport on public.cue_images(sport_key);

alter table public.cue_images enable row level security;

-- Read: any authenticated user may look up any cue image — that IS the reuse.
create policy "cue images read"
  on public.cue_images for select to authenticated
  using (true);

-- Write: server-side ONLY. The edge function uses the service role (which
-- bypasses RLS), so we intentionally add NO insert/update/delete policy —
-- authenticated clients can never write to the shared catalog.

-- Session -> cue image pointer. Nullable, no FK: the image stage is best-effort
-- (a failure/skip must leave the session intact), so this mirrors the
-- decoupled, insert-order-independent choice made for client_events (005).
alter table public.sessions
  add column if not exists cue_image_key text;

-- ── Shared storage bucket for the rendered images ──────────────────────────
-- Public read: images are non-sensitive, shared, and served by public URL
-- (https://<project>/storage/v1/object/public/cue-images/<storage_path>).
-- Writes go through the service role, so no write policy is needed. If this
-- INSERT fails on a hardened project, create the bucket via Dashboard ->
-- Storage instead (precedent: session-audio, per supabase/SETUP.md).
insert into storage.buckets (id, name, public)
values ('cue-images', 'cue-images', true)
on conflict (id) do nothing;
