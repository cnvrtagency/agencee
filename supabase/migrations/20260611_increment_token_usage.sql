create or replace function increment_token_usage(p_user_id uuid, p_tokens integer)
returns void
language plpgsql
as $$
begin
  update workspace_settings
  set tokens_used_this_month = coalesce(tokens_used_this_month, 0) + p_tokens
  where user_id = p_user_id;
end;
$$;
