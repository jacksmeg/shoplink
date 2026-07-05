create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null check (role in ('buyer', 'seller', 'admin')),
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'pending_verification')),
  email_verified boolean not null default false,
  phone text not null default '',
  location text not null default '',
  profile_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip_hash text not null default '',
  user_agent_hash text not null default '',
  revoked_at timestamptz
);

create table if not exists seller_profiles (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  shop_name text not null,
  category text not null,
  initials text not null,
  tone text not null default 'green',
  verified boolean not null default false,
  kyc_status text not null default 'not_started',
  payout_status text not null default 'not_started',
  bio text not null default '',
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id text primary key,
  name text not null unique,
  listing_type text not null check (listing_type in ('product', 'service'))
);

create table if not exists listings (
  id text primary key,
  title text not null,
  listing_type text not null check (listing_type in ('product', 'service')),
  category_id text not null references categories(id),
  price_cents integer not null check (price_cents >= 0),
  pricing_unit text not null default '',
  description text not null default '',
  fulfillment text not null default 'Pickup only',
  visibility text not null default 'Public',
  stock integer,
  location text not null default '',
  delivery_options jsonb not null default '[]'::jsonb,
  seller_profile_id text not null references seller_profiles(id) on delete cascade,
  primary_image text not null,
  distance text not null default '',
  rating text not null default '',
  status text not null default 'pending_review',
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists listing_images (
  id text primary key,
  listing_id text not null references listings(id) on delete cascade,
  url text not null,
  sort_order integer not null default 1
);

create table if not exists favorites (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  listing_id text not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

create table if not exists carts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  buyer_id text not null references users(id),
  seller_profile_id text not null references seller_profiles(id),
  listing_id text not null references listings(id),
  order_type text not null check (order_type in ('product_order', 'service_booking')),
  status text not null check (status in ('pending', 'accepted', 'paid', 'completed', 'cancelled', 'rejected')),
  quantity integer not null default 1 check (quantity > 0),
  total_cents integer not null check (total_cents >= 0),
  delivery_method text not null,
  scheduled_for timestamptz,
  payment_status text not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_events (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  actor_id text references users(id),
  from_status text,
  to_status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists payment_intents (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  provider text not null,
  status text not null,
  amount_cents integer not null check (amount_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists payouts (
  id text primary key,
  seller_profile_id text not null references seller_profiles(id),
  status text not null,
  amount_cents integer not null check (amount_cents >= 0),
  scheduled_for timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists message_threads (
  id text primary key,
  buyer_id text not null references users(id),
  seller_profile_id text not null references seller_profiles(id),
  listing_id text not null references listings(id),
  order_id text references orders(id) on delete set null,
  status text not null default 'open',
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  thread_id text not null references message_threads(id) on delete cascade,
  order_id text references orders(id) on delete set null,
  listing_id text not null references listings(id) on delete cascade,
  sender_id text not null references users(id),
  recipient_id text references users(id),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  listing_id text not null references listings(id) on delete cascade,
  reviewer_id text not null references users(id),
  seller_profile_id text not null references seller_profiles(id),
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  status text not null default 'published',
  created_at timestamptz not null default now(),
  unique (order_id, reviewer_id)
);

create table if not exists reports (
  id text primary key,
  reporter_id text not null references users(id),
  target_type text not null,
  target_id text not null,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists disputes (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  opened_by text not null references users(id),
  reason text not null,
  status text not null default 'reviewing',
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists media_assets (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  url text not null,
  kind text not null,
  status text not null default 'pending_review',
  byte_size integer not null default 0,
  mime_type text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists verification_requests (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  seller_profile_id text references seller_profiles(id) on delete cascade,
  type text not null,
  status text not null,
  reviewed_by text references users(id),
  token_hash text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists password_resets (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null,
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists audit_logs (
  id text primary key,
  actor_id text references users(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions (user_id);
create index if not exists seller_profiles_user_id_idx on seller_profiles (user_id);
create index if not exists listings_category_id_idx on listings (category_id);
create index if not exists listings_seller_profile_id_idx on listings (seller_profile_id);
create index if not exists listing_images_listing_id_idx on listing_images (listing_id);
create index if not exists favorites_user_id_idx on favorites (user_id);
create index if not exists favorites_listing_id_idx on favorites (listing_id);
create index if not exists carts_user_id_idx on carts (user_id);
create index if not exists orders_buyer_id_idx on orders (buyer_id);
create index if not exists orders_seller_profile_id_idx on orders (seller_profile_id);
create index if not exists orders_listing_id_idx on orders (listing_id);
create index if not exists order_events_order_id_idx on order_events (order_id);
create index if not exists payment_intents_order_id_idx on payment_intents (order_id);
create index if not exists payouts_seller_profile_id_idx on payouts (seller_profile_id);
create index if not exists message_threads_buyer_id_idx on message_threads (buyer_id);
create index if not exists message_threads_seller_profile_id_idx on message_threads (seller_profile_id);
create index if not exists messages_thread_id_idx on messages (thread_id);
create index if not exists messages_sender_id_idx on messages (sender_id);
create index if not exists messages_recipient_id_idx on messages (recipient_id);
create index if not exists reviews_listing_id_idx on reviews (listing_id);
create index if not exists reviews_seller_profile_id_idx on reviews (seller_profile_id);
create index if not exists reports_reporter_id_idx on reports (reporter_id);
create index if not exists disputes_order_id_idx on disputes (order_id);
create index if not exists notifications_user_id_idx on notifications (user_id);
create index if not exists media_assets_owner_id_idx on media_assets (owner_id);
create index if not exists verification_requests_user_id_idx on verification_requests (user_id);
create index if not exists password_resets_user_id_idx on password_resets (user_id);
create index if not exists audit_logs_actor_id_idx on audit_logs (actor_id);

create index if not exists listings_active_created_idx on listings (created_at desc)
where status = 'active';

create index if not exists listings_pending_review_idx on listings (created_at desc)
where status = 'pending_review';

create index if not exists reports_open_created_idx on reports (created_at desc)
where status = 'open';

create index if not exists orders_open_created_idx on orders (created_at desc)
where status in ('pending', 'accepted', 'paid');

create index if not exists notifications_unread_user_idx on notifications (user_id, created_at desc)
where read_at is null;
