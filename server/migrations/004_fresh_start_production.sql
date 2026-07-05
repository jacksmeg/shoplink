truncate table
  sessions,
  password_resets,
  verification_requests,
  email_notifications,
  seller_adverts,
  seller_follows,
  media_assets,
  notifications,
  disputes,
  reports,
  reviews,
  messages,
  message_threads,
  payouts,
  payment_intents,
  order_events,
  orders,
  carts,
  favorites,
  listing_images,
  listings,
  seller_profiles,
  audit_logs
cascade;

delete from users
where role <> 'admin';

insert into audit_logs (
  id,
  actor_id,
  action,
  target_type,
  target_id,
  metadata,
  created_at
)
values (
  'audit_fresh_start_20260705',
  (select id from users where role = 'admin' order by created_at asc limit 1),
  'production_fresh_start',
  'system',
  'shoplink-production',
  '{"reason":"Removed starter marketplace data before public launch"}'::jsonb,
  now()
)
on conflict (id) do nothing;
