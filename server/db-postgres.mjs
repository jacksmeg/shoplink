import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(rootDir, "server", "migrations");

let pool;
let ensured = false;

export async function ensurePostgresDb(seedFactory) {
  if (ensured) {
    return;
  }

  const db = await getPool();
  const client = await db.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const alreadyApplied = await client.query("select 1 from schema_migrations where version = $1", [file]);
      if (alreadyApplied.rowCount) {
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    client.release();
  }

  ensured = true;

  const seeded = await db.query("select count(*)::int as count from users");
  if (!seeded.rows[0]?.count) {
    await writePostgresDb(seedFactory());
  }
}

export async function readPostgresDb() {
  const db = await getPool();
  const [
    users,
    sellerProfiles,
    categories,
    listings,
    listingImages,
    favorites,
    carts,
    orders,
    orderEvents,
    paymentIntents,
    payouts,
    messages,
    messageThreads,
    reviews,
    reports,
    disputes,
    notifications,
    mediaAssets,
    verificationRequests,
    passwordResets,
    auditLogs,
    sessions,
    sellerFollows,
    sellerAdverts,
    emailNotifications,
    platformSettings,
  ] = await Promise.all([
    selectRows(db, "users", "created_at asc"),
    selectRows(db, "seller_profiles", "created_at asc"),
    selectRows(db, "categories", "name asc"),
    selectRows(db, "listings", "created_at desc"),
    selectRows(db, "listing_images", "sort_order asc"),
    selectRows(db, "favorites", "created_at asc"),
    selectRows(db, "carts", "updated_at desc"),
    selectRows(db, "orders", "created_at desc"),
    selectRows(db, "order_events", "created_at asc"),
    selectRows(db, "payment_intents", "created_at asc"),
    selectRows(db, "payouts", "created_at asc"),
    selectRows(db, "messages", "created_at asc"),
    selectRows(db, "message_threads", "updated_at desc"),
    selectRows(db, "reviews", "created_at desc"),
    selectRows(db, "reports", "created_at desc"),
    selectRows(db, "disputes", "created_at desc"),
    selectRows(db, "notifications", "created_at desc"),
    selectRows(db, "media_assets", "created_at desc"),
    selectRows(db, "verification_requests", "created_at desc"),
    selectRows(db, "password_resets", "created_at desc"),
    selectRows(db, "audit_logs", "created_at desc"),
    selectRows(db, "sessions", "created_at desc"),
    selectRows(db, "seller_follows", "created_at desc"),
    selectRows(db, "seller_adverts", "created_at desc"),
    selectRows(db, "email_notifications", "created_at desc"),
    selectRows(db, "platform_settings", "updated_at desc"),
  ]);

  return {
    meta: {
      name: "ShopLink PostgreSQL database",
      version: 5,
      createdAt: users[0]?.created_at ? toIso(users[0].created_at) : new Date().toISOString(),
    },
    users: users.map(mapUser),
    seller_profiles: sellerProfiles.map(mapSellerProfile),
    categories: categories.map(mapCategory),
    listings: listings.map(mapListing),
    listing_images: listingImages.map(mapListingImage),
    favorites: favorites.map(mapFavorite),
    carts: carts.map(mapCart),
    orders: orders.map(mapOrder),
    order_events: orderEvents.map(mapOrderEvent),
    payment_intents: paymentIntents.map(mapPaymentIntent),
    payouts: payouts.map(mapPayout),
    messages: messages.map(mapMessage),
    message_threads: messageThreads.map(mapMessageThread),
    reviews: reviews.map(mapReview),
    reports: reports.map(mapReport),
    disputes: disputes.map(mapDispute),
    notifications: notifications.map(mapNotification),
    media_assets: mediaAssets.map(mapMediaAsset),
    verification_requests: verificationRequests.map(mapVerificationRequest),
    password_resets: passwordResets.map(mapPasswordReset),
    audit_logs: auditLogs.map(mapAuditLog),
    sessions: sessions.map(mapSession),
    seller_follows: sellerFollows.map(mapSellerFollow),
    seller_adverts: sellerAdverts.map(mapSellerAdvert),
    email_notifications: emailNotifications.map(mapEmailNotification),
    platform_settings: platformSettings.map(mapPlatformSetting),
  };
}

export async function writePostgresDb(db) {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(`
      truncate table
        audit_logs,
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
        categories,
        seller_profiles,
        platform_settings,
        sessions,
        users
      cascade
    `);

    await insertRows(client, "users", [
      "id",
      "name",
      "email",
      "role",
      "password_hash",
      "status",
      "email_verified",
      "phone",
      "location",
      "profile_completed",
      "google_id",
      "avatar_url",
      "auth_provider",
      "created_at",
    ], db.users || [], (row) => [
      row.id,
      row.name,
      row.email,
      row.role,
      row.passwordHash,
      row.status || "active",
      Boolean(row.emailVerified),
      row.phone || "",
      row.location || "",
      Boolean(row.profileCompleted ?? true),
      row.googleId || null,
      row.avatarUrl || "",
      row.authProvider || "password",
      row.createdAt,
    ]);

    await insertRows(client, "sessions", [
      "token_hash",
      "user_id",
      "created_at",
      "expires_at",
      "last_seen_at",
      "ip_hash",
      "user_agent_hash",
      "revoked_at",
    ], db.sessions || [], (row) => [
      row.tokenHash || row.token,
      row.userId,
      row.createdAt,
      row.expiresAt,
      row.lastSeenAt || row.createdAt,
      row.ipHash || "",
      row.userAgentHash || "",
      row.revokedAt || null,
    ]);

    await insertRows(client, "seller_profiles", [
      "id",
      "user_id",
      "shop_name",
      "category",
      "initials",
      "tone",
      "verified",
      "kyc_status",
      "payout_status",
      "momo_network",
      "momo_number",
      "payout_account_name",
      "paystack_recipient_code",
      "paystack_subaccount_code",
      "bio",
      "id_document_url",
      "business_document_url",
      "seller_agreement_accepted_at",
      "service_radius_km",
      "trust_badges",
      "approved_at",
      "created_at",
    ], db.seller_profiles || [], (row) => [
      row.id,
      row.userId,
      row.shopName,
      row.category,
      row.initials,
      row.tone || "green",
      Boolean(row.verified),
      row.kycStatus || "not_started",
      row.payoutStatus || "not_started",
      row.momoNetwork || "",
      row.momoNumber || "",
      row.payoutAccountName || "",
      row.paystackRecipientCode || "",
      row.paystackSubaccountCode || "",
      row.bio || "",
      row.idDocumentUrl || "",
      row.businessDocumentUrl || "",
      row.sellerAgreementAcceptedAt || null,
      row.serviceRadiusKm ?? 10,
      JSON.stringify(row.trustBadges || []),
      row.approvedAt || null,
      row.createdAt || row.approvedAt || new Date().toISOString(),
    ]);

    await insertRows(client, "categories", ["id", "name", "listing_type"], db.categories || [], (row) => [
      row.id,
      row.name,
      row.listingType,
    ]);

    await insertRows(client, "listings", [
      "id",
      "title",
      "listing_type",
      "category_id",
      "price_cents",
      "pricing_unit",
      "description",
      "fulfillment",
      "visibility",
      "stock",
      "location",
      "delivery_options",
      "seller_profile_id",
      "primary_image",
      "distance",
      "rating",
      "status",
      "approved",
      "sku",
      "low_stock_threshold",
      "variants",
      "booking_slots",
      "delivery_fee_cents",
      "created_at",
      "updated_at",
    ], db.listings || [], (row) => [
      row.id,
      row.title,
      row.listingType,
      row.categoryId,
      row.priceCents,
      row.pricingUnit || "",
      row.description || "",
      row.fulfillment || "Pickup only",
      row.visibility || "Public",
      row.stock ?? null,
      row.location || "",
      JSON.stringify(row.deliveryOptions || []),
      row.sellerProfileId,
      row.primaryImage,
      row.distance || "",
      row.rating || "",
      row.status || "pending_review",
      Boolean(row.approved),
      row.sku || "",
      row.lowStockThreshold ?? 2,
      JSON.stringify(row.variants || []),
      JSON.stringify(row.bookingSlots || []),
      row.deliveryFeeCents ?? 0,
      row.createdAt,
      row.updatedAt || row.createdAt,
    ]);

    await insertRows(client, "listing_images", ["id", "listing_id", "url", "sort_order"], db.listing_images || [], (row) => [
      row.id,
      row.listingId,
      row.url,
      row.sortOrder || 1,
    ]);

    await insertRows(client, "favorites", ["id", "user_id", "listing_id", "created_at"], db.favorites || [], (row) => [
      row.id,
      row.userId,
      row.listingId,
      row.createdAt,
    ]);

    await insertRows(client, "carts", ["id", "user_id", "items", "updated_at"], db.carts || [], (row) => [
      row.id,
      row.userId,
      JSON.stringify(row.items || []),
      row.updatedAt,
    ]);

    await insertRows(client, "orders", [
      "id",
      "buyer_id",
      "seller_profile_id",
      "listing_id",
      "order_type",
      "status",
      "quantity",
      "total_cents",
      "delivery_method",
      "delivery_contact_name",
      "delivery_phone",
      "delivery_town",
      "delivery_address",
      "delivery_note",
      "seller_opened_at",
      "delivery_status",
      "scheduled_for",
      "payment_status",
      "created_at",
      "updated_at",
    ], db.orders || [], (row) => [
      row.id,
      row.buyerId,
      row.sellerProfileId,
      row.listingId,
      row.orderType,
      row.status,
      row.quantity || 1,
      row.totalCents,
      row.deliveryMethod,
      row.deliveryContactName || "",
      row.deliveryPhone || "",
      row.deliveryTown || "Dunkwa-on-Offin",
      row.deliveryAddress || "",
      row.deliveryNote || "",
      row.sellerOpenedAt || null,
      row.deliveryStatus || "new",
      row.scheduledFor || null,
      row.paymentStatus,
      row.createdAt,
      row.updatedAt || row.createdAt,
    ]);

    await insertRows(client, "order_events", ["id", "order_id", "actor_id", "from_status", "to_status", "note", "created_at"], db.order_events || [], (row) => [
      row.id,
      row.orderId,
      row.actorId,
      row.fromStatus,
      row.toStatus,
      row.note || "",
      row.createdAt,
    ]);

    await insertRows(client, "payment_intents", ["id", "order_id", "provider", "status", "amount_cents", "platform_fee_cents", "seller_profile_id", "destination_type", "destination_label", "created_at"], db.payment_intents || [], (row) => [
      row.id,
      row.orderId,
      row.provider,
      row.status,
      row.amountCents,
      row.platformFeeCents || 0,
      row.sellerProfileId || null,
      row.destinationType || "mobile_money",
      row.destinationLabel || "",
      row.createdAt,
    ]);

    await insertRows(client, "payouts", ["id", "seller_profile_id", "order_id", "status", "amount_cents", "scheduled_for", "created_at"], db.payouts || [], (row) => [
      row.id,
      row.sellerProfileId,
      row.orderId || null,
      row.status,
      row.amountCents,
      row.scheduledFor || null,
      row.createdAt,
    ]);

    await insertRows(client, "message_threads", ["id", "buyer_id", "seller_profile_id", "listing_id", "order_id", "status", "updated_at"], db.message_threads || [], (row) => [
      row.id,
      row.buyerId,
      row.sellerProfileId,
      row.listingId,
      row.orderId || null,
      row.status || "open",
      row.updatedAt,
    ]);

    await insertRows(client, "messages", ["id", "thread_id", "order_id", "listing_id", "sender_id", "recipient_id", "body", "read_at", "created_at"], db.messages || [], (row) => [
      row.id,
      row.threadId,
      row.orderId || null,
      row.listingId,
      row.senderId,
      row.recipientId || null,
      row.body,
      row.readAt || null,
      row.createdAt,
    ]);

    await insertRows(client, "reviews", ["id", "order_id", "listing_id", "reviewer_id", "seller_profile_id", "rating", "comment", "status", "created_at"], db.reviews || [], (row) => [
      row.id,
      row.orderId,
      row.listingId,
      row.reviewerId,
      row.sellerProfileId,
      row.rating,
      row.comment || "",
      row.status || "published",
      row.createdAt,
    ]);

    await insertRows(client, "reports", ["id", "reporter_id", "target_type", "target_id", "reason", "status", "created_at"], db.reports || [], (row) => [
      row.id,
      row.reporterId,
      row.targetType,
      row.targetId,
      row.reason,
      row.status || "open",
      row.createdAt,
    ]);

    await insertRows(client, "disputes", ["id", "order_id", "opened_by", "reason", "status", "created_at"], db.disputes || [], (row) => [
      row.id,
      row.orderId,
      row.openedBy,
      row.reason,
      row.status || "reviewing",
      row.createdAt,
    ]);

    await insertRows(client, "notifications", ["id", "user_id", "type", "title", "body", "read_at", "created_at"], db.notifications || [], (row) => [
      row.id,
      row.userId,
      row.type,
      row.title,
      row.body,
      row.readAt || null,
      row.createdAt,
    ]);

    await insertRows(client, "media_assets", ["id", "owner_id", "url", "kind", "status", "byte_size", "mime_type", "storage_provider", "storage_key", "original_name", "created_at"], db.media_assets || [], (row) => [
      row.id,
      row.ownerId,
      row.url,
      row.kind,
      row.status || "pending_review",
      row.byteSize || 0,
      row.mimeType || "",
      row.storageProvider || "local",
      row.storageKey || "",
      row.originalName || "",
      row.createdAt,
    ]);

    await insertRows(client, "verification_requests", ["id", "user_id", "seller_profile_id", "type", "status", "reviewed_by", "token_hash", "created_at", "reviewed_at"], db.verification_requests || [], (row) => [
      row.id,
      row.userId,
      row.sellerProfileId || null,
      row.type,
      row.status,
      row.reviewedBy || null,
      row.tokenHash || "",
      row.createdAt,
      row.reviewedAt || null,
    ]);

    await insertRows(client, "password_resets", ["id", "user_id", "token_hash", "status", "created_at", "used_at"], db.password_resets || [], (row) => [
      row.id,
      row.userId,
      row.tokenHash || row.token,
      row.status,
      row.createdAt,
      row.usedAt || null,
    ]);

    await insertRows(client, "audit_logs", ["id", "actor_id", "action", "target_type", "target_id", "metadata", "created_at"], db.audit_logs || [], (row) => [
      row.id,
      row.actorId || null,
      row.action,
      row.targetType,
      row.targetId,
      JSON.stringify(row.metadata || {}),
      row.createdAt,
    ]);

    await insertRows(client, "seller_follows", ["id", "user_id", "seller_profile_id", "created_at"], db.seller_follows || [], (row) => [
      row.id,
      row.userId,
      row.sellerProfileId,
      row.createdAt,
    ]);

    await insertRows(client, "seller_adverts", ["id", "seller_profile_id", "listing_id", "title", "body", "placement", "status", "fee_cents", "starts_at", "ends_at", "created_at", "updated_at"], db.seller_adverts || [], (row) => [
      row.id,
      row.sellerProfileId,
      row.listingId || null,
      row.title,
      row.body || "",
      row.placement || "home_top",
      row.status || "pending_payment",
      row.feeCents || 0,
      row.startsAt || null,
      row.endsAt || null,
      row.createdAt,
      row.updatedAt || row.createdAt,
    ]);

    await insertRows(client, "email_notifications", ["id", "user_id", "order_id", "to_email", "subject", "status", "provider", "provider_id", "error", "created_at", "sent_at"], db.email_notifications || [], (row) => [
      row.id,
      row.userId || null,
      row.orderId || null,
      row.toEmail,
      row.subject,
      row.status || "queued",
      row.provider || "resend",
      row.providerId || "",
      row.error || "",
      row.createdAt,
      row.sentAt || null,
    ]);

    await insertRows(client, "platform_settings", ["id", "advert_listing_fee_cents", "featured_advert_fee_cents", "advert_duration_days", "commission_rate", "google_client_id", "google_client_secret", "google_redirect_uri", "public_base_url", "resend_api_key", "resend_from_email", "r2_account_id", "r2_access_key_id", "r2_secret_access_key", "r2_bucket", "r2_public_url", "support_email", "delivery_zones", "pickup_points", "banned_terms", "updated_at"], db.platform_settings || [], (row) => [
      row.id || "shoplink",
      row.advertListingFeeCents ?? 2500,
      row.featuredAdvertFeeCents ?? 7500,
      row.advertDurationDays ?? 7,
      row.commissionRate ?? 10,
      row.googleClientId || "",
      row.googleClientSecret || "",
      row.googleRedirectUri || "",
      row.publicBaseUrl || "",
      row.resendApiKey || "",
      row.resendFromEmail || "",
      row.r2AccountId || "",
      row.r2AccessKeyId || "",
      row.r2SecretAccessKey || "",
      row.r2Bucket || "",
      row.r2PublicUrl || "",
      row.supportEmail || "",
      JSON.stringify(row.deliveryZones || []),
      JSON.stringify(row.pickupPoints || []),
      JSON.stringify(row.bannedTerms || []),
      row.updatedAt || new Date().toISOString(),
    ]);

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool() {
  if (pool) {
    await pool.end();
    pool = null;
    ensured = false;
  }
}

async function getPool() {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL mode.");
  }

  let pg;
  try {
    pg = await import("pg");
  } catch (error) {
    throw new Error("PostgreSQL mode requires the pg package. Run `npm install pg`, then retry.");
  }

  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  return pool;
}

async function selectRows(db, table, orderBy) {
  const result = await db.query(`select * from ${table} order by ${orderBy}`);
  return result.rows;
}

async function insertRows(client, table, columns, rows, mapRow) {
  for (const row of rows) {
    const values = mapRow(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(`insert into ${table} (${columns.join(", ")}) values (${placeholders})`, values);
  }
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    phone: row.phone || "",
    location: row.location || "",
    profileCompleted: Boolean(row.profile_completed),
    googleId: row.google_id || null,
    avatarUrl: row.avatar_url || "",
    authProvider: row.auth_provider || "password",
    createdAt: toIso(row.created_at),
  };
}

function mapSellerProfile(row) {
  return {
    id: row.id,
    userId: row.user_id,
    shopName: row.shop_name,
    category: row.category,
    initials: row.initials,
    tone: row.tone,
    verified: Boolean(row.verified),
    kycStatus: row.kyc_status,
    payoutStatus: row.payout_status,
    momoNetwork: row.momo_network || "",
    momoNumber: row.momo_number || "",
    payoutAccountName: row.payout_account_name || "",
    paystackRecipientCode: row.paystack_recipient_code || "",
    paystackSubaccountCode: row.paystack_subaccount_code || "",
    bio: row.bio || "",
    idDocumentUrl: row.id_document_url || "",
    businessDocumentUrl: row.business_document_url || "",
    sellerAgreementAcceptedAt: toIso(row.seller_agreement_accepted_at),
    serviceRadiusKm: row.service_radius_km ?? 10,
    trustBadges: row.trust_badges || [],
    approvedAt: toIso(row.approved_at),
    createdAt: toIso(row.created_at),
  };
}

function mapCategory(row) {
  return { id: row.id, name: row.name, listingType: row.listing_type };
}

function mapListing(row) {
  return {
    id: row.id,
    title: row.title,
    listingType: row.listing_type,
    categoryId: row.category_id,
    priceCents: row.price_cents,
    pricingUnit: row.pricing_unit || "",
    description: row.description || "",
    fulfillment: row.fulfillment || "",
    visibility: row.visibility || "",
    stock: row.stock,
    location: row.location || "",
    deliveryOptions: row.delivery_options || [],
    sellerProfileId: row.seller_profile_id,
    primaryImage: row.primary_image,
    distance: row.distance || "",
    rating: row.rating || "",
    status: row.status,
    approved: Boolean(row.approved),
    sku: row.sku || "",
    lowStockThreshold: row.low_stock_threshold ?? 2,
    variants: row.variants || [],
    bookingSlots: row.booking_slots || [],
    deliveryFeeCents: row.delivery_fee_cents ?? 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapListingImage(row) {
  return { id: row.id, listingId: row.listing_id, url: row.url, sortOrder: row.sort_order };
}

function mapFavorite(row) {
  return { id: row.id, userId: row.user_id, listingId: row.listing_id, createdAt: toIso(row.created_at) };
}

function mapCart(row) {
  return { id: row.id, userId: row.user_id, items: row.items || [], updatedAt: toIso(row.updated_at) };
}

function mapOrder(row) {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerProfileId: row.seller_profile_id,
    listingId: row.listing_id,
    orderType: row.order_type,
    status: row.status,
    quantity: row.quantity || 1,
    totalCents: row.total_cents,
    deliveryMethod: row.delivery_method,
    deliveryContactName: row.delivery_contact_name || "",
    deliveryPhone: row.delivery_phone || "",
    deliveryTown: row.delivery_town || "",
    deliveryAddress: row.delivery_address || "",
    deliveryNote: row.delivery_note || "",
    sellerOpenedAt: toIso(row.seller_opened_at),
    deliveryStatus: row.delivery_status || "new",
    scheduledFor: toIso(row.scheduled_for),
    paymentStatus: row.payment_status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapOrderEvent(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    actorId: row.actor_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note || "",
    createdAt: toIso(row.created_at),
  };
}

function mapPaymentIntent(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    status: row.status,
    amountCents: row.amount_cents,
    platformFeeCents: row.platform_fee_cents,
    sellerProfileId: row.seller_profile_id,
    destinationType: row.destination_type || "mobile_money",
    destinationLabel: row.destination_label || "",
    createdAt: toIso(row.created_at),
  };
}

function mapPayout(row) {
  return {
    id: row.id,
    sellerProfileId: row.seller_profile_id,
    orderId: row.order_id || null,
    status: row.status,
    amountCents: row.amount_cents,
    scheduledFor: toIso(row.scheduled_for),
    createdAt: toIso(row.created_at),
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    orderId: row.order_id,
    listingId: row.listing_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  };
}

function mapMessageThread(row) {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerProfileId: row.seller_profile_id,
    listingId: row.listing_id,
    orderId: row.order_id,
    status: row.status,
    updatedAt: toIso(row.updated_at),
  };
}

function mapReview(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    listingId: row.listing_id,
    reviewerId: row.reviewer_id,
    sellerProfileId: row.seller_profile_id,
    rating: row.rating,
    comment: row.comment || "",
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function mapReport(row) {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function mapDispute(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    openedBy: row.opened_by,
    reason: row.reason,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  };
}

function mapMediaAsset(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    url: row.url,
    kind: row.kind,
    status: row.status,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    storageProvider: row.storage_provider || "local",
    storageKey: row.storage_key || "",
    originalName: row.original_name || "",
    createdAt: toIso(row.created_at),
  };
}

function mapVerificationRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    sellerProfileId: row.seller_profile_id,
    type: row.type,
    status: row.status,
    reviewedBy: row.reviewed_by,
    tokenHash: row.token_hash,
    createdAt: toIso(row.created_at),
    reviewedAt: toIso(row.reviewed_at),
  };
}

function mapPasswordReset(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    status: row.status,
    createdAt: toIso(row.created_at),
    usedAt: toIso(row.used_at),
  };
}

function mapAuditLog(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata || {},
    createdAt: toIso(row.created_at),
  };
}

function mapSession(row) {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    lastSeenAt: toIso(row.last_seen_at),
    ipHash: row.ip_hash || "",
    userAgentHash: row.user_agent_hash || "",
    revokedAt: toIso(row.revoked_at),
  };
}

function mapSellerFollow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    sellerProfileId: row.seller_profile_id,
    createdAt: toIso(row.created_at),
  };
}

function mapSellerAdvert(row) {
  return {
    id: row.id,
    sellerProfileId: row.seller_profile_id,
    listingId: row.listing_id,
    title: row.title,
    body: row.body || "",
    placement: row.placement || "home_top",
    status: row.status || "pending_payment",
    feeCents: row.fee_cents || 0,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEmailNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    orderId: row.order_id,
    toEmail: row.to_email,
    subject: row.subject,
    status: row.status,
    provider: row.provider,
    providerId: row.provider_id || "",
    error: row.error || "",
    createdAt: toIso(row.created_at),
    sentAt: toIso(row.sent_at),
  };
}

function mapPlatformSetting(row) {
  return {
    id: row.id,
    advertListingFeeCents: row.advert_listing_fee_cents,
    featuredAdvertFeeCents: row.featured_advert_fee_cents,
    advertDurationDays: row.advert_duration_days,
    commissionRate: Number(row.commission_rate || 10),
    googleClientId: row.google_client_id || "",
    googleClientSecret: row.google_client_secret || "",
    googleRedirectUri: row.google_redirect_uri || "",
    publicBaseUrl: row.public_base_url || "",
    resendApiKey: row.resend_api_key || "",
    resendFromEmail: row.resend_from_email || "",
    r2AccountId: row.r2_account_id || "",
    r2AccessKeyId: row.r2_access_key_id || "",
    r2SecretAccessKey: row.r2_secret_access_key || "",
    r2Bucket: row.r2_bucket || "",
    r2PublicUrl: row.r2_public_url || "",
    supportEmail: row.support_email || "",
    deliveryZones: row.delivery_zones || [],
    pickupPoints: row.pickup_points || [],
    bannedTerms: row.banned_terms || [],
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return value.toISOString();
}
