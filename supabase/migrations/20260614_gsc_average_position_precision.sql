alter table public.keyword_banks
  alter column current_position type numeric using current_position::numeric;

alter table public.content_history
  alter column ranking_position type numeric using ranking_position::numeric;
