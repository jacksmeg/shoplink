# ShopLink Product Foundation

## Version 1 Scope

ShopLink V1 should support:

- Ghana Cedi pricing and Dunkwa-on-Offin marketplace defaults
- Buyer, seller, and admin accounts
- Seller profiles with verification status
- Product and service listings
- Category-based browsing
- Real listing image upload with file size/type validation
- Favorites
- Buyer cart with quantity updates and checkout
- Product orders and service booking requests
- Buyer-seller messaging linked to listings/orders
- Reviews after completed orders
- Admin approval for listings and sellers
- Reports, disputes, notifications, audit logs, payment intents, and payout records
- PostgreSQL migrations and starter marketplace seeding when `DATABASE_URL` is configured

## Database Tables

The default development database is `data/shoplink-db.json`. When `DATABASE_URL` is set, the same app shape is backed by PostgreSQL tables created from `server/migrations/001_initial_marketplace_schema.sql`.

- `users`: account identity, email, role, status, password hash
- `seller_profiles`: seller shop profile, approval, verification
- `categories`: marketplace categories and product/service type
- `listings`: listing core fields, status, price, stock, location, delivery options, seller owner
- `listing_images`: listing image records
- `favorites`: buyer saved listings
- `carts`: buyer cart records with listing quantities
- `orders`: product orders and service bookings
- `order_events`: order status history
- `payment_intents`: checkout/payment ledger records
- `payouts`: seller payout ledger records
- `message_threads`: buyer-seller conversation containers
- `messages`: buyer/seller messages
- `reviews`: ratings for completed orders
- `reports`: reported listings, users, messages, or reviews
- `disputes`: refund/dispute workflow records
- `notifications`: in-app notifications
- `media_assets`: uploaded media approval records
- `verification_requests`: KYC/seller verification requests
- `password_resets`: forgot-password request records
- `audit_logs`: admin action history
- `sessions`: hashed login session records

## Database Commands

- `npm run db:migrate`: runs PostgreSQL migrations when `DATABASE_URL` is set
- `npm run db:seed`: writes starter marketplace data to the active database mode
- `npm run smoke`: exercises buyer, seller, and admin workflow APIs

## Local Test Accounts

- Buyer: `buyer@shoplink.local` / `BuyerPass123`
- Seller: `seller@shoplink.local` / `SellerPass123`
- Admin: `admin@shoplink.local` / `AdminPass123`

## API Routes

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/platform`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/password-reset`
- `POST /api/auth/password-reset/complete`
- `POST /api/auth/request-verification`
- `POST /api/auth/confirm-email`
- `POST /api/auth/verify-email`
- `PATCH /api/profile`
- `POST /api/seller/onboarding`
- `POST /api/uploads/listing-images`
- `POST /api/listings`
- `PATCH /api/listings/:listingId`
- `DELETE /api/listings/:listingId`
- `POST /api/favorites/:listingId`
- `GET /api/cart`
- `POST /api/cart/items`
- `POST /api/cart/items/:listingId`
- `DELETE /api/cart/items/:listingId`
- `POST /api/cart/checkout`
- `POST /api/orders`
- `POST /api/orders/:orderId`
- `POST /api/messages`
- `POST /api/reviews`
- `POST /api/reports`
- `POST /api/media-assets`
- `POST /api/admin/listings/:listingId/:action`
- `POST /api/admin/sellers/:sellerId/:action`
- `POST /api/admin/users/:userId/:action`
- `POST /api/admin/reports/:reportId/:action`
- `POST /api/admin/disputes/:disputeId/:action`

Seller-created listings are stored as `pending_review`. Admin-created listings are stored as `active`. The frontend still shows a seller their own pending listings so they can confirm the save worked.

Payment records are intentionally provider-ready until live credentials are configured. Real checkout, refunds, seller payouts, invoices, and compliance should be connected through a Ghana-supported marketplace payment provider before public launch.
