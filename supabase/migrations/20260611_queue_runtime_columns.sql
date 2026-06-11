-- Queue runtime columns used by the Agencee scheduler, calendar, and worker.
-- Safe to run more than once in Supabase SQL Editor.

BEGIN;

ALTER TABLE public.content_queue
  ADD COLUMN IF NOT EXISTS workspace_id UUID,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_id UUID,
  ADD COLUMN IF NOT EXISTS agent_type TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'blog_post',
  ADD COLUMN IF NOT EXISTS primary_keyword TEXT,
  ADD COLUMN IF NOT EXISTS supporting_keywords TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS title_brief TEXT,
  ADD COLUMN IF NOT EXISTS internal_links TEXT,
  ADD COLUMN IF NOT EXISTS word_count INTEGER,
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_id UUID,
  ADD COLUMN IF NOT EXISTS calendar_id UUID,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.content_outputs
  ADD COLUMN IF NOT EXISTS queue_item_id UUID;

CREATE OR REPLACE FUNCTION public.agencee_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_queue_set_updated_at ON public.content_queue;
CREATE TRIGGER content_queue_set_updated_at
  BEFORE UPDATE ON public.content_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.agencee_set_updated_at();

CREATE INDEX IF NOT EXISTS content_queue_status_idx
  ON public.content_queue(status);

CREATE INDEX IF NOT EXISTS content_queue_client_status_idx
  ON public.content_queue(client_id, status);

CREATE INDEX IF NOT EXISTS content_queue_workspace_status_idx
  ON public.content_queue(workspace_id, status);

CREATE INDEX IF NOT EXISTS content_queue_scheduled_for_idx
  ON public.content_queue(scheduled_for);

CREATE INDEX IF NOT EXISTS content_queue_calendar_id_idx
  ON public.content_queue(calendar_id)
  WHERE calendar_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_queue_output_id_idx
  ON public.content_queue(output_id)
  WHERE output_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_outputs_queue_item_id_idx
  ON public.content_outputs(queue_item_id)
  WHERE queue_item_id IS NOT NULL;

COMMIT;
