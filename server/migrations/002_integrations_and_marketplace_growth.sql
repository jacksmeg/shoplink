alter table users
  add column if not exists google_id text unique,
  add column if not exists avatar_url text not null default '',
  add column if not exists auth_provider text not null default 'password';

alter table seller_profiles
  add column if not exists momo_network text not null default '',
  add column if not exists momo_number text not null default '',
  add column if not exists payout_account_name text not null default '',
  add column if not exists paystack_recipient_code text not null default '',
  add column if not exists paystack_subaccount_code text not null default '';

alter table orders
  add column if not exists delivery_contact_name text not null default '',
  add column if not exists delivery_phone text not null default '',
  add column if not exists delivery_town text not null default 'Dunkwa-on-Offin',
  add column if not exists delivery_address text not null default '',
  add column if not exists delivery_note text not null default '',
  add column if not exists seller_opened_at timestamptz,
  add column if not exists delivery_status text not null default 'new';

alter table payment_intents
  add column if not exists seller_profile_id text references seller_profiles(id),
  add column if not exists destination_type text not null default 'mobile_money',
  add column if not exists destination_label text not null default '';

create table if not exists seller_follows (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  seller_profile_id text not null references seller_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, seller_profile_id)
);

create table if not exists seller_adverts (
  id text primary key,
  seller_profile_id text not null references seller_profiles(id) on delete cascade,
  listing_id text references listings(id) on delete set null,
  title text not null,
  body text not null default '',
  placement text not null default 'home_top',
  status text not null default 'pending_payment',
  fee_cents integer not null default 0 check (fee_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_notifications (
  id text primary key,
  user_id text references users(id) on delete set null,
  order_id text references orders(id) on delete set null,
  to_email text not null,
  subject text not null,
  status text not null default 'queued',
  provider text not null default 'resend',
  provider_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists platform_settings (
  id text primary key,
  advert_listing_fee_cents integer not null default 2500 check (advert_listing_fee_cents >= 0),
  featured_advert_fee_cents integer not null default 7500 check (featured_advert_fee_cents >= 0),
  advert_duration_days integer not null default 7 check (advert_duration_days between 1 and 365),
  commission_rate numeric(5, 2) not null default 10,
  updated_at timestamptz not null default now()
);

insert into platform_settings (id)
values ('shoplink')
on conflict (id) do nothing;

create index if not exists users_google_id_idx on users (google_id);
create index if not exists seller_follows_user_id_idx on seller_follows (user_id);
create index if not exists seller_follows_seller_profile_id_idx on seller_follows (seller_profile_id);
create index if not exists seller_adverts_seller_profile_id_idx on seller_adverts (seller_profile_id);
create index if not exists seller_adverts_status_idx on seller_adverts (status, ends_at);
create index if not exists email_notifications_status_idx on email_notifications (status, created_at);
create index if not exists email_notifications_order_id_idx on email_notifications (order_id);
