-- Client knowledge panel: persistent brain per client, read into every agent session
create table if not exists client_knowledge (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references client_profiles(id) on delete cascade not null,
  workspace_id uuid not null,

  -- Cached site intelligence (updated on crawl, not every message)
  site_pages jsonb default '[]'::jsonb,
  site_pages_updated_at timestamptz,
  site_summary text,

  -- Cached GSC snapshot (updated on sync)
  gsc_snapshot jsonb default '{}'::jsonb,
  gsc_snapshot_updated_at timestamptz,

  -- Content state
  content_summary text,
  content_updated_at timestamptz,

  -- Knowledge docs (freeform markdown, edited by user or agent)
  docs jsonb default '[]'::jsonb,

  -- Agent notes (each agent can write observations here)
  agent_notes jsonb default '{}'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists client_knowledge_client_id_idx on client_knowledge(client_id);

-- One knowledge panel per client
create unique index if not exists client_knowledge_client_unique on client_knowledge(client_id);
