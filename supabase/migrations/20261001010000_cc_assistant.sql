-- CareCall PH — CC, the in-portal assistant.
--
-- CC answers questions from the CC wiki (docs/cc-wiki), guides users through
-- workflows, analyses campaign results, and files ACTION ITEMS that clinic
-- admins work through on the /cc page.
--
-- cc_action_items is written by the cc-chat edge function using the CALLER's
-- JWT, so RLS below is what scopes CC to the user's clinic — CC can never file
-- or read items for another clinic.
--
-- cc_usage records token counts per request for cost tracking.
--
-- Written idempotently so it is safe to re-run during development.

create table if not exists cc_action_items (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  created_by uuid references auth.users(id),          -- the user CC was talking to
  title text not null,
  detail text,
  category text not null default 'campaign'
    check (category in ('campaign', 'review', 'patients', 'messaging', 'settings', 'other')),
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'urgent')),
  route text,                                         -- portal route to act on it, e.g. /review
  status text not null default 'open'
    check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists idx_cc_action_items_clinic
  on cc_action_items (clinic_id, status, created_at desc);

alter table cc_action_items enable row level security;

drop policy if exists cc_action_items_read on cc_action_items;
create policy cc_action_items_read on cc_action_items for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

drop policy if exists cc_action_items_insert on cc_action_items;
create policy cc_action_items_insert on cc_action_items for insert to authenticated
  with check ( is_admin() or clinic_id = jwt_clinic_id() );

-- Any clinic user can mark items done/dismissed; only status fields matter.
drop policy if exists cc_action_items_update on cc_action_items;
create policy cc_action_items_update on cc_action_items for update to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() )
  with check ( is_admin() or clinic_id = jwt_clinic_id() );

-- ============================================================
-- Usage log (service role writes; admins read)
-- ============================================================
create table if not exists cc_usage (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  clinic_id uuid references clinics(id),
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  tool_calls int not null default 0,
  wiki_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cc_usage_clinic on cc_usage (clinic_id, created_at desc);

alter table cc_usage enable row level security;

drop policy if exists cc_usage_read on cc_usage;
create policy cc_usage_read on cc_usage for select to authenticated
  using ( is_admin() );
