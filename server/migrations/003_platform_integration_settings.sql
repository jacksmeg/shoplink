alter table platform_settings
  add column if not exists google_client_id text not null default '',
  add column if not exists google_client_secret text not null default '',
  add column if not exists google_redirect_uri text not null default '',
  add column if not exists public_base_url text not null default '',
  add column if not exists resend_api_key text not null default '',
  add column if not exists resend_from_email text not null default '';
