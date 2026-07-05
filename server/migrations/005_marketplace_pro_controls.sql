alter table seller_profiles
  add column if not exists id_document_url text not null default '',
  add column if not exists business_document_url text not null default '',
  add column if not exists seller_agreement_accepted_at timestamptz,
  add column if not exists service_radius_km integer not null default 10,
  add column if not exists trust_badges jsonb not null default '[]'::jsonb;

alter table listings
  add column if not exists sku text not null default '',
  add column if not exists low_stock_threshold integer not null default 2,
  add column if not exists variants jsonb not null default '[]'::jsonb,
  add column if not exists booking_slots jsonb not null default '[]'::jsonb,
  add column if not exists delivery_fee_cents integer not null default 0;

alter table media_assets
  add column if not exists storage_provider text not null default 'local',
  add column if not exists storage_key text not null default '',
  add column if not exists original_name text not null default '';

alter table payouts
  add column if not exists order_id text references orders(id) on delete set null;

alter table platform_settings
  add column if not exists r2_account_id text not null default '',
  add column if not exists r2_access_key_id text not null default '',
  add column if not exists r2_secret_access_key text not null default '',
  add column if not exists r2_bucket text not null default '',
  add column if not exists r2_public_url text not null default '',
  add column if not exists support_email text not null default '',
  add column if not exists delivery_zones jsonb not null default '[]'::jsonb,
  add column if not exists pickup_points jsonb not null default '[]'::jsonb,
  add column if not exists banned_terms jsonb not null default '[]'::jsonb;

create index if not exists listings_location_idx on listings (location);
create index if not exists reviews_status_idx on reviews (status);
create index if not exists media_assets_storage_provider_idx on media_assets (storage_provider);
create index if not exists payouts_order_id_idx on payouts (order_id);
