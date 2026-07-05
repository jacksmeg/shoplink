# ShopLink

ShopLink is a community marketplace for Dunkwa-on-Offin, Ghana. It supports buyers, sellers, admins, products, services, real listing uploads, carts, orders, messages, reviews, reports, and hosting-ready PostgreSQL deployment.

## Current Product Surface

- Professional sidebar marketplace UI based on the approved ShopLink dashboard design
- Ghana Cedi pricing and Dunkwa-on-Offin location defaults
- Buyer cart with add, quantity update, remove, and checkout-to-order records
- Product orders and service booking requests
- Seller listing drawer with real image upload validation
- Buyer, seller, and admin account roles
- Seller onboarding/KYC workflow
- Admin approval for listings and sellers
- Reports, disputes, notifications, audit logs, payment intents, payout records, and review moderation
- Seller MoMo payout capture, buyer delivery addresses, seller-opened tracking, paid advert requests, seller follows, public reviews, Terms, Privacy, seller rules, refund policy, and FAQ screens
- Admin security controls for password changes, admin creation/removal, user suspension, audit logs, storage settings, delivery zones, pickup points, banned terms, and support email
- Seller verification proofs, seller agreement acceptance, service radius, verified badges, trust badges, inventory alerts, product variants, service booking slots, and delivery fees
- Provider-ready Google OAuth, seller/buyer email notifications, and Cloudflare R2 listing image storage with local fallback
- Installable PWA manifest, app icon, robots.txt, sitemap, and search preview metadata
- Admin and Reports screens are role-gated so buyers and sellers do not see admin navigation
- PostgreSQL migration path for production data
- Render hosting blueprint with managed PostgreSQL wiring

## Run Locally

```bash
npm install
npm run db:seed
npm run dev
```

The app runs at:

- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

For production-style local serving:

```bash
npm run build
npm start
```

## Local Test Accounts

- Buyer: `buyer@shoplink.local` / `BuyerPass123`
- Seller: `seller@shoplink.local` / `SellerPass123`
- Admin: `admin@shoplink.local` / `AdminPass123`

## PostgreSQL Mode

ShopLink includes versioned SQL migrations in `server/migrations`.

```bash
set DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/shoplink
npm run db:migrate
npm run db:seed
npm run dev
```

When `DATABASE_URL` is set, the API uses PostgreSQL. Without it, the app uses local JSON storage at `data/shoplink-db.json`.

## Production Integrations

Add these environment variables before launch:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for Continue with Google.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for real seller order emails.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_URL` for Cloudflare R2 listing images.
- `SUPPORT_EMAIL` for public support/contact operations.
- `PAYSTACK_SECRET_KEY` or a Ghana-supported payment provider secret before taking live online payments.
- `PUBLIC_BASE_URL` with the hosted URL so OAuth redirects match production.

Production target:

- App URL: `https://shoplink.jhimssoftware.com`
- Google OAuth redirect URI: `https://shoplink.jhimssoftware.com/api/auth/google/callback`
- GitHub repository: `https://github.com/jacksmeg/shoplink.git`

Seller MoMo details are captured on seller onboarding and attached to order payment records as the payout destination. Live money movement still requires the payment provider account and compliance setup.

## Deploy To Render

This repo includes `render.yaml`:

- Node web service
- Managed PostgreSQL database
- `DATABASE_URL` wired from the database
- `npm run db:migrate` as the pre-deploy command
- `/api/health` health check
- `HOST=0.0.0.0` for public hosting

Push the repo to GitHub, create a Render Blueprint from `render.yaml`, then set real payment/email/SMS provider secrets before accepting live payments.

For the custom domain, add `shoplink.jhimssoftware.com` in the Render service settings. Render will show the DNS target; create a `CNAME` record for `shoplink` at your DNS provider pointing to that Render target, then wait for TLS to issue.

## Important Production Notes

- Payment records are provider-ready, but live money should only be enabled after connecting a real Ghana-supported provider such as Paystack, Hubtel, or Mobile Money processing.
- Configure Cloudflare R2 before heavy production image uploads. Without R2 keys, local uploads remain useful for development but are not ideal for multi-instance hosting.
- Configure backups, logs, monitoring, rate limits, object storage, and dispute/refund operating rules before public launch.

See `docs/MVP.md` for the data model and API route list.
