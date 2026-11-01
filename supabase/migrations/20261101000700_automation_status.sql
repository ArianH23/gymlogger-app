-- Read-only check for the automatic planning setup. Never returns secret values.
create function public.claude_automation_status() returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'url_set',            exists (select 1 from vault.decrypted_secrets where name = 'claude_fire_url'),
    'url_host',           (select substring(decrypted_secret from '^https://([^/]+)/') from vault.decrypted_secrets where name = 'claude_fire_url'),
    'url_ends_with_fire', (select decrypted_secret ~ '/fire$' from vault.decrypted_secrets where name = 'claude_fire_url'),
    'url_has_trigger_id', (select decrypted_secret ~ '/routines/trig_[A-Za-z0-9]+/fire$' from vault.decrypted_secrets where name = 'claude_fire_url'),
    'token_set',          exists (select 1 from vault.decrypted_secrets where name = 'claude_fire_token'),
    'token_length',       (select length(decrypted_secret) from vault.decrypted_secrets where name = 'claude_fire_token'),
    'token_has_whitespace', (select decrypted_secret ~ '\s' from vault.decrypted_secrets where name = 'claude_fire_token'),
    'pg_net_enabled',     exists (select 1 from pg_extension where extname = 'pg_net'));
$$;

comment on function public.claude_automation_status() is
  'Reports whether the Vault secrets for automatic planning exist and look well-formed (host, shape, token length). Never returns the secrets themselves.';

revoke execute on function public.claude_automation_status() from public, anon, authenticated;
