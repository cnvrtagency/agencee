alter table public.competitor_pages
  add column if not exists meta_description text,
  add column if not exists content text,
  add column if not exists headings text[] default '{}'::text[],
  add column if not exists internal_links text[] default '{}'::text[],
  add column if not exists source text,
  add column if not exists lastmod timestamptz;

create index if not exists competitor_pages_competitor_crawled_idx
  on public.competitor_pages (competitor_id, crawled_at desc);

create index if not exists competitor_pages_client_word_count_idx
  on public.competitor_pages (client_id, word_count desc);
