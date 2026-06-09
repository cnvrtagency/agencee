-- ============================================================
-- Agencee SaaS Migration
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Enable auth schema (should already be enabled on Supabase)
-- 2. Add user_id to all tables
-- 3. Create workspace_settings
-- 4. Enable RLS and add policies
-- 5. Create usage tracking function

-- -------------------------------------------------------
-- workspace_settings (new)
-- -------------------------------------------------------
create table if not exists workspace_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  workspace_name text not null default 'My Workspace',
  anthropic_api_key text,
  monthly_token_budget integer not null default 500000,
  tokens_used_this_month integer not null default 0,
  budget_reset_at timestamptz not null default date_trunc('month', now()) + interval '1 month',
  plan text not null default 'solo',
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- Add user_id to all tables
-- -------------------------------------------------------
alter table client_profiles      add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table agents                add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table content_queue         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table content_outputs       add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table content_history       add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table keyword_banks         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table conversations         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table messages              add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table planned_tasks         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table site_pages            add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- -------------------------------------------------------
-- Token usage tracking on outputs and queue
-- -------------------------------------------------------
alter table content_outputs add column if not exists tokens_used integer default 0;
alter table content_queue   add column if not exists tokens_used integer default 0;

-- -------------------------------------------------------
-- Enable RLS on all tables
-- -------------------------------------------------------
alter table workspace_settings   enable row level security;
alter table client_profiles      enable row level security;
alter table agents                enable row level security;
alter table content_queue         enable row level security;
alter table content_outputs       enable row level security;
alter table content_history       enable row level security;
alter table keyword_banks         enable row level security;
alter table conversations         enable row level security;
alter table messages              enable row level security;
alter table planned_tasks         enable row level security;
alter table site_pages            enable row level security;

-- -------------------------------------------------------
-- RLS policies — users only see their own data
-- -------------------------------------------------------

-- workspace_settings
create policy "Own workspace" on workspace_settings for all using (auth.uid() = user_id);

-- client_profiles
create policy "Own clients" on client_profiles for all using (auth.uid() = user_id);

-- agents
create policy "Own agents" on agents for all using (auth.uid() = user_id);

-- content_queue
create policy "Own queue" on content_queue for all using (auth.uid() = user_id);

-- content_outputs
create policy "Own outputs" on content_outputs for all using (auth.uid() = user_id);

-- content_history
create policy "Own history" on content_history for all using (auth.uid() = user_id);

-- keyword_banks
create policy "Own keywords" on keyword_banks for all using (auth.uid() = user_id);

-- conversations
create policy "Own conversations" on conversations for all using (auth.uid() = user_id);

-- messages — allow via conversation ownership
create policy "Own messages" on messages for all using (
  exists (
    select 1 from conversations c
    where c.id = messages.conversation_id and c.user_id = auth.uid()
  )
);

-- planned_tasks
create policy "Own planned tasks" on planned_tasks for all using (auth.uid() = user_id);

-- site_pages
create policy "Own site pages" on site_pages for all using (auth.uid() = user_id);

-- -------------------------------------------------------
-- Worker service role bypass (worker uses service key, bypasses RLS)
-- No changes needed — service role already bypasses RLS in Supabase
-- -------------------------------------------------------

-- -------------------------------------------------------
-- Function: increment token usage + auto-reset monthly budget
-- -------------------------------------------------------
create or replace function increment_tokens(p_user_id uuid, p_tokens integer)
returns void language plpgsql security definer as $$
begin
  -- Reset budget if we've passed the reset date
  update workspace_settings
  set tokens_used_this_month = 0,
      budget_reset_at = date_trunc('month', now()) + interval '1 month'
  where user_id = p_user_id
    and budget_reset_at <= now();

  -- Increment usage
  update workspace_settings
  set tokens_used_this_month = tokens_used_this_month + p_tokens,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

-- -------------------------------------------------------
-- Function: check if user is within budget
-- -------------------------------------------------------
create or replace function check_budget(p_user_id uuid)
returns boolean language plpgsql security definer as $$
declare
  v_used integer;
  v_budget integer;
  v_reset timestamptz;
begin
  select tokens_used_this_month, monthly_token_budget, budget_reset_at
  into v_used, v_budget, v_reset
  from workspace_settings
  where user_id = p_user_id;

  if not found then return true; end if;

  -- Reset if needed
  if v_reset <= now() then
    update workspace_settings
    set tokens_used_this_month = 0,
        budget_reset_at = date_trunc('month', now()) + interval '1 month'
    where user_id = p_user_id;
    return true;
  end if;

  return v_used < v_budget;
end;
$$;

-- -------------------------------------------------------
-- NOTE: After running this migration, sign in to the app
-- and your existing data will be assigned to your user_id
-- automatically via the onboarding flow.
-- -------------------------------------------------------
