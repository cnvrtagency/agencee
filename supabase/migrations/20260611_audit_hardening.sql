-- Agencee audit hardening follow-up.
-- Safe to run more than once in Supabase SQL Editor.

BEGIN;

-- Short-lived server-side Google OAuth sessions.
CREATE TABLE IF NOT EXISTS public.google_oauth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID,
  google_account_email TEXT,
  properties JSONB NOT NULL DEFAULT '[]'::JSONB,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_oauth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct client access to google oauth sessions" ON public.google_oauth_sessions;
CREATE POLICY "No direct client access to google oauth sessions"
  ON public.google_oauth_sessions
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE INDEX IF NOT EXISTS google_oauth_sessions_user_idx
  ON public.google_oauth_sessions(user_id);

CREATE INDEX IF NOT EXISTS google_oauth_sessions_client_idx
  ON public.google_oauth_sessions(client_id);

CREATE INDEX IF NOT EXISTS google_oauth_sessions_expires_at_idx
  ON public.google_oauth_sessions(expires_at);

-- Queue/output/calendar integrity. NOT VALID avoids failing on legacy rows while enforcing new writes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_queue_status_check') THEN
    ALTER TABLE public.content_queue
      ADD CONSTRAINT content_queue_status_check
      CHECK (status IS NULL OR status IN ('queued', 'running', 'review', 'done', 'failed'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_calendar_status_check') THEN
    ALTER TABLE public.content_calendar
      ADD CONSTRAINT content_calendar_status_check
      CHECK (status IS NULL OR status IN ('planned', 'approved', 'scheduled', 'in_progress', 'review', 'published', 'cancelled'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_queue_client_fk') THEN
    ALTER TABLE public.content_queue
      ADD CONSTRAINT content_queue_client_fk
      FOREIGN KEY (client_id) REFERENCES public.client_profiles(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_queue_calendar_fk') THEN
    ALTER TABLE public.content_queue
      ADD CONSTRAINT content_queue_calendar_fk
      FOREIGN KEY (calendar_id) REFERENCES public.content_calendar(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_queue_output_fk') THEN
    ALTER TABLE public.content_queue
      ADD CONSTRAINT content_queue_output_fk
      FOREIGN KEY (output_id) REFERENCES public.content_outputs(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_outputs_queue_item_fk') THEN
    ALTER TABLE public.content_outputs
      ADD CONSTRAINT content_outputs_queue_item_fk
      FOREIGN KEY (queue_item_id) REFERENCES public.content_queue(id) ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_oauth_sessions_client_fk') THEN
    ALTER TABLE public.google_oauth_sessions
      ADD CONSTRAINT google_oauth_sessions_client_fk
      FOREIGN KEY (client_id) REFERENCES public.client_profiles(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_oauth_sessions_workspace_fk') THEN
    ALTER TABLE public.google_oauth_sessions
      ADD CONSTRAINT google_oauth_sessions_workspace_fk
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

-- Hot-path indexes.
CREATE INDEX IF NOT EXISTS agent_activity_workspace_created_idx
  ON public.agent_activity(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_activity_client_created_idx
  ON public.agent_activity(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_activity_agent_created_idx
  ON public.agent_activity(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS briefing_items_workspace_dismissed_priority_idx
  ON public.briefing_items(workspace_id, dismissed, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS briefing_items_client_dismissed_idx
  ON public.briefing_items(client_id, dismissed, created_at DESC);

CREATE INDEX IF NOT EXISTS content_outputs_client_created_idx
  ON public.content_outputs(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS content_outputs_client_approved_idx
  ON public.content_outputs(client_id, approved, created_at DESC);

CREATE INDEX IF NOT EXISTS content_calendar_client_status_date_idx
  ON public.content_calendar(client_id, status, scheduled_date);

CREATE INDEX IF NOT EXISTS content_queue_status_scheduled_idx
  ON public.content_queue(status, scheduled_for);

CREATE INDEX IF NOT EXISTS content_queue_workspace_status_created_idx
  ON public.content_queue(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS search_performance_client_period_query_idx
  ON public.search_performance(client_id, period_start, period_end, query);

CREATE INDEX IF NOT EXISTS search_performance_client_page_period_idx
  ON public.search_performance(client_id, page, period_start, period_end);

CREATE INDEX IF NOT EXISTS keyword_banks_client_opportunity_idx
  ON public.keyword_banks(client_id, opportunity_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS keyword_banks_client_targeting_idx
  ON public.keyword_banks(client_id, content_targeting_this);

CREATE INDEX IF NOT EXISTS google_connections_status_synced_idx
  ON public.google_connections(status, last_synced_at);

CREATE INDEX IF NOT EXISTS client_schedules_enabled_next_run_idx
  ON public.client_schedules(enabled, next_run_at);

CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_next_run_idx
  ON public.scheduled_jobs(enabled, next_run_at);

CREATE INDEX IF NOT EXISTS agent_automations_enabled_next_run_idx
  ON public.agent_automations(enabled, next_run_at);

-- Public read for generated blog images. Uploads still happen server-side via service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-images', 'blog-images', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read blog images'
  ) THEN
    CREATE POLICY "Public read blog images"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'blog-images');
  END IF;
END $$;

COMMIT;
