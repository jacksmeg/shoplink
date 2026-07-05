import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePostgresDb, readPostgresDb, writePostgresDb } from "./db-postgres.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = join(rootDir, "data", "shoplink-db.json");
const passwordIterations = 100_000;
const passwordKeyLength = 32;

export async function readDb() {
  if (usesPostgres()) {
    await ensurePostgresDb(createSeedDb);
    return normalizeDb(await readPostgresDb());
  }

  await ensureDb();
  return normalizeDb(JSON.parse(await readFile(dbPath, "utf8")));
}

export async function writeDb(db) {
  if (usesPostgres()) {
    await ensurePostgresDb(createSeedDb);
    await writePostgresDb(db);
    return;
  }

  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

export async function ensureDb() {
  if (usesPostgres()) {
    await ensurePostgresDb(createSeedDb);
    return;
  }

  try {
    const existing = JSON.parse(await readFile(dbPath, "utf8"));
    if (!existing.meta || existing.meta.version < 4) {
      await writeDb(createSeedDb());
    } else {
      const before = JSON.stringify(existing);
      const normalized = normalizeDb(existing);
      if (before !== JSON.stringify(normalized)) {
        await writeDb(normalized);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeDb(createSeedDb());
  }
}

export function dbMode() {
  return usesPostgres() ? "postgres" : "json";
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, passwordIterations, passwordKeyLength, "sha256").toString("hex");
  return `pbkdf2_sha256$${passwordIterations}$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [scheme, iterationsRaw, salt, expected] = storedHash.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expected) {
    return false;
  }

  const actual = pbkdf2Sync(
    password,
    salt,
    Number(iterationsRaw),
    Buffer.from(expected, "hex").length,
    "sha256",
  );
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

export function createId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function createSeedDb() {
  const now = nowIso();

  const users = [
    {
      id: "user_admin",
      name: "El Admin",
      email: "admin@shoplink.local",
      role: "admin",
      passwordHash: hashPassword("AdminPass123"),
      createdAt: now,
    },
    {
      id: "user_buyer",
      name: "Akua Buyer",
      email: "buyer@shoplink.local",
      role: "buyer",
      passwordHash: hashPassword("BuyerPass123"),
      createdAt: now,
    },
    {
      id: "user_green_valley",
      name: "Kwame Mensah",
      email: "seller@shoplink.local",
      role: "seller",
      passwordHash: hashPassword("SellerPass123"),
      createdAt: now,
    },
    {
      id: "user_techfix",
      name: "Daniel Osei",
      email: "techfix@shoplink.local",
      role: "seller",
      passwordHash: hashPassword("SellerPass123"),
      createdAt: now,
    },
    {
      id: "user_oak_pine",
      name: "Ama Owusu",
      email: "oakpine@shoplink.local",
      role: "seller",
      passwordHash: hashPassword("SellerPass123"),
      createdAt: now,
    },
    {
      id: "user_brightpath",
      name: "Amina Boateng",
      email: "brightpath@shoplink.local",
      role: "seller",
      passwordHash: hashPassword("SellerPass123"),
      createdAt: now,
    },
    {
      id: "user_taste_serve",
      name: "Kojo Ansah",
      email: "taste@shoplink.local",
      role: "seller",
      passwordHash: hashPassword("SellerPass123"),
      createdAt: now,
    },
  ];

  return {
    meta: {
      name: "ShopLink Dunkwa-on-Offin marketplace database",
      version: 5,
      createdAt: now,
    },
    users: users.map((user) => ({
      ...user,
      status: "active",
      emailVerified: true,
      googleId: null,
      avatarUrl: "",
      authProvider: "password",
      phone: "",
      location: "Dunkwa-on-Offin",
      profileCompleted: true,
    })),
    seller_profiles: [
      {
        id: "seller_green_valley",
        userId: "user_green_valley",
        shopName: "Offin Valley Farm",
        category: "Farm & Produce",
        initials: "OV",
        tone: "green",
        verified: true,
        kycStatus: "verified",
        payoutStatus: "ready",
        momoNetwork: "MTN Mobile Money",
        momoNumber: "0240000001",
        payoutAccountName: "Kwame Mensah",
        paystackRecipientCode: "",
        paystackSubaccountCode: "",
        bio: "Fresh farm produce supplied around Dunkwa-on-Offin.",
        approvedAt: now,
      },
      {
        id: "seller_techfix",
        userId: "user_techfix",
        shopName: "FixIt Mobile Dunkwa",
        category: "Electronics Repair",
        initials: "FM",
        tone: "blue",
        verified: true,
        kycStatus: "verified",
        payoutStatus: "ready",
        momoNetwork: "Telecel Cash",
        momoNumber: "0200000002",
        payoutAccountName: "Daniel Osei",
        paystackRecipientCode: "",
        paystackSubaccountCode: "",
        bio: "Phone repairs, accessories, and same-day diagnostics.",
        approvedAt: now,
      },
      {
        id: "seller_oak_pine",
        userId: "user_oak_pine",
        shopName: "Adom Woodworks",
        category: "Home & Living",
        initials: "AW",
        tone: "amber",
        verified: true,
        kycStatus: "verified",
        payoutStatus: "ready",
        momoNetwork: "AirtelTigo Money",
        momoNumber: "0270000003",
        payoutAccountName: "Ama Owusu",
        paystackRecipientCode: "",
        paystackSubaccountCode: "",
        bio: "Handmade furniture, repairs, and home fittings.",
        approvedAt: now,
      },
      {
        id: "seller_brightpath",
        userId: "user_brightpath",
        shopName: "BrightPath Lessons",
        category: "Education",
        initials: "BL",
        tone: "rose",
        verified: true,
        kycStatus: "verified",
        payoutStatus: "ready",
        momoNetwork: "MTN Mobile Money",
        momoNumber: "0240000004",
        payoutAccountName: "Amina Boateng",
        paystackRecipientCode: "",
        paystackSubaccountCode: "",
        bio: "After-school tutoring for JHS and SHS learners.",
        approvedAt: now,
      },
      {
        id: "seller_taste_serve",
        userId: "user_taste_serve",
        shopName: "Taste & Serve Dunkwa",
        category: "Catering & Events",
        initials: "TS",
        tone: "violet",
        verified: true,
        kycStatus: "verified",
        payoutStatus: "ready",
        momoNetwork: "MTN Mobile Money",
        momoNumber: "0550000005",
        payoutAccountName: "Kojo Ansah",
        paystackRecipientCode: "",
        paystackSubaccountCode: "",
        bio: "Catering for family, church, school, and community events.",
        approvedAt: now,
      },
    ],
    categories: [
      { id: "cat_all", name: "For sale", listingType: "product" },
      { id: "cat_farm", name: "Farm & Produce", listingType: "product" },
      { id: "cat_electronics", name: "Electronics", listingType: "product" },
      { id: "cat_home", name: "Home & Living", listingType: "product" },
      { id: "cat_fashion", name: "Fashion", listingType: "product" },
      { id: "cat_jobs", name: "Jobs", listingType: "service" },
      { id: "cat_community", name: "Community", listingType: "service" },
      { id: "cat_education", name: "Education", listingType: "service" },
      { id: "cat_services", name: "Home Services", listingType: "service" },
      { id: "cat_catering", name: "Catering & Events", listingType: "service" },
    ],
    listings: [
      createListing("listing_tomatoes", "Fresh tomatoes", "product", "cat_farm", 2500, "/bowl", "seller_green_valley", "/images/tomatoes.png", "0.4 km", "4.9", now, "active", true, "Ripe tomatoes from farms around Dunkwa-on-Offin."),
      createListing("listing_phone_repair", "Phone repair", "service", "cat_electronics", 18000, "", "seller_techfix", "/images/phone-repair.png", "1.2 km", "4.8", now, "active", true, "Screen, charging port, battery, and software repair."),
      createListing("listing_chair", "Handmade chair", "product", "cat_home", 65000, "", "seller_oak_pine", "/images/chair.png", "2.1 km", "4.9", now, "active", true, "Strong handmade wooden chair for home or shop use."),
      createListing("listing_tutor", "Math tutor", "service", "cat_education", 7500, "/hr", "seller_brightpath", "/images/tutor.png", "0.9 km", "5.0", now, "active", true, "Maths support for JHS and SHS students."),
      createListing("listing_catering", "Event catering", "service", "cat_catering", 85000, "", "seller_taste_serve", "/images/catering.png", "3.0 km", "4.7", now, "active", true, "Food packages for meetings, funerals, weddings, and church events."),
      createListing("listing_cleaning", "Home cleaning", "service", "cat_services", 16000, "", "seller_brightpath", "/images/cleaning.png", "1.7 km", "4.6", now, "active", true, "Home, office, and compound cleaning around Dunkwa."),
      createListing("listing_record_player", "Bluetooth speaker", "product", "cat_electronics", 22000, "", "seller_techfix", "/images/record-player.png", "1.5 km", "4.7", now, "active", true, "Portable speaker for events, shops, and home use."),
    ],
    listing_images: [
      { id: "img_tomatoes", listingId: "listing_tomatoes", url: "/images/tomatoes.png", sortOrder: 1 },
      { id: "img_phone", listingId: "listing_phone_repair", url: "/images/phone-repair.png", sortOrder: 1 },
      { id: "img_chair", listingId: "listing_chair", url: "/images/chair.png", sortOrder: 1 },
      { id: "img_tutor", listingId: "listing_tutor", url: "/images/tutor.png", sortOrder: 1 },
      { id: "img_catering", listingId: "listing_catering", url: "/images/catering.png", sortOrder: 1 },
      { id: "img_cleaning", listingId: "listing_cleaning", url: "/images/cleaning.png", sortOrder: 1 },
      { id: "img_record_player", listingId: "listing_record_player", url: "/images/record-player.png", sortOrder: 1 },
    ],
    favorites: [{ id: "favorite_seed", userId: "user_buyer", listingId: "listing_chair", createdAt: now }],
    carts: [{ id: "cart_buyer", userId: "user_buyer", items: [], updatedAt: now }],
    orders: [
      {
        id: "order_seed_1",
        buyerId: "user_buyer",
        sellerProfileId: "seller_techfix",
        listingId: "listing_phone_repair",
        orderType: "service_booking",
        status: "accepted",
        quantity: 1,
        totalCents: 18000,
        deliveryMethod: "Drop-off",
        deliveryContactName: "Akua Buyer",
        deliveryPhone: "0241234567",
        deliveryTown: "Dunkwa-on-Offin",
        deliveryAddress: "Near Dunkwa market",
        deliveryNote: "Buyer will bring the phone before noon.",
        sellerOpenedAt: now,
        deliveryStatus: "opened",
        scheduledFor: "2026-07-06T10:00:00.000Z",
        paymentStatus: "authorized",
        createdAt: now,
        updatedAt: now,
      },
    ],
    order_events: [
      {
        id: "event_seed_1",
        orderId: "order_seed_1",
        actorId: "user_techfix",
        fromStatus: "pending",
        toStatus: "accepted",
        note: "Seller accepted the repair booking.",
        createdAt: now,
      },
    ],
    payment_intents: [
      {
        id: "pay_seed_1",
        orderId: "order_seed_1",
        provider: "manual",
        status: "authorized",
        amountCents: 18000,
        platformFeeCents: 1800,
        sellerProfileId: "seller_techfix",
        destinationType: "mobile_money",
        destinationLabel: "Telecel Cash ending 0002",
        createdAt: now,
      },
    ],
    payouts: [
      {
        id: "payout_seed_1",
        sellerProfileId: "seller_techfix",
        status: "pending",
        amountCents: 16200,
        scheduledFor: "2026-07-08T10:00:00.000Z",
        createdAt: now,
      },
    ],
    messages: [
      {
        id: "message_seed_1",
        threadId: "thread_seed_1",
        orderId: "order_seed_1",
        listingId: "listing_phone_repair",
        senderId: "user_buyer",
        recipientId: "user_techfix",
        body: "Hi, can I bring the phone tomorrow morning?",
        readAt: null,
        createdAt: now,
      },
    ],
    message_threads: [
      {
        id: "thread_seed_1",
        buyerId: "user_buyer",
        sellerProfileId: "seller_techfix",
        listingId: "listing_phone_repair",
        orderId: "order_seed_1",
        status: "open",
        updatedAt: now,
      },
    ],
    reviews: [
      {
        id: "review_seed_1",
        orderId: "order_seed_1",
        listingId: "listing_phone_repair",
        reviewerId: "user_buyer",
        sellerProfileId: "seller_techfix",
        rating: 5,
        comment: "Clear communication and quick diagnosis.",
        status: "published",
        createdAt: now,
      },
    ],
    seller_follows: [
      { id: "follow_seed_1", userId: "user_buyer", sellerProfileId: "seller_techfix", createdAt: now },
      { id: "follow_seed_2", userId: "user_buyer", sellerProfileId: "seller_green_valley", createdAt: now },
    ],
    seller_adverts: [
      {
        id: "advert_seed_1",
        sellerProfileId: "seller_green_valley",
        listingId: "listing_tomatoes",
        title: "Fresh tomatoes from Offin Valley Farm",
        body: "Order farm-fresh tomatoes for pickup or seller delivery around Dunkwa-on-Offin.",
        placement: "home_top",
        status: "active",
        feeCents: 2500,
        createdAt: now,
        updatedAt: now,
        startsAt: now,
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "advert_seed_2",
        sellerProfileId: "seller_techfix",
        listingId: "listing_phone_repair",
        title: "Phone repair with same-day diagnostics",
        body: "Book trusted repairs for screens, batteries, charging ports, and software issues.",
        placement: "home_top",
        status: "active",
        feeCents: 2500,
        createdAt: now,
        updatedAt: now,
        startsAt: now,
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    email_notifications: [],
    platform_settings: [
      {
        id: "shoplink",
        advertListingFeeCents: 2500,
        featuredAdvertFeeCents: 7500,
        advertDurationDays: 7,
        commissionRate: 10,
        updatedAt: now,
      },
    ],
    reports: [
      {
        id: "report_seed_1",
        reporterId: "user_buyer",
        targetType: "listing",
        targetId: "listing_cleaning",
        reason: "Needs clearer service area",
        status: "open",
        createdAt: now,
      },
    ],
    disputes: [
      {
        id: "dispute_seed_1",
        orderId: "order_seed_1",
        openedBy: "user_buyer",
        reason: "Buyer requested admin review for repair timing.",
        status: "reviewing",
        createdAt: now,
      },
    ],
    notifications: [
      {
        id: "notification_seed_1",
        userId: "user_techfix",
        type: "order_status",
        title: "Booking accepted",
        body: "Phone repair booking is ready for drop-off.",
        readAt: null,
        createdAt: now,
      },
    ],
    media_assets: [
      {
        id: "media_seed_1",
        ownerId: "user_green_valley",
        url: "/images/tomatoes.png",
        kind: "listing_image",
        status: "approved",
        createdAt: now,
      },
    ],
    verification_requests: [
      {
        id: "verify_seed_1",
        userId: "user_green_valley",
        sellerProfileId: "seller_green_valley",
        type: "seller_kyc",
        status: "approved",
        reviewedBy: "user_admin",
        createdAt: now,
        reviewedAt: now,
      },
    ],
    password_resets: [],
    audit_logs: [
      {
        id: "audit_seed_1",
        actorId: "user_admin",
        action: "marketplace_database_created",
        targetType: "system",
        targetId: "shoplink-db",
        metadata: { version: 5 },
        createdAt: now,
      },
    ],
    sessions: [],
  };
}

function usesPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

function createListing(
  id,
  title,
  listingType,
  categoryId,
  priceCents,
  pricingUnit,
  sellerProfileId,
  image,
  distance,
  rating,
  createdAt,
  status = "active",
  approved = true,
  description = "",
) {
  return {
    id,
    title,
    listingType,
    categoryId,
    priceCents,
    pricingUnit,
    description,
    fulfillment: "Pickup or delivery",
    visibility: "Public",
    stock: listingType === "product" ? 8 : null,
    location: "Dunkwa-on-Offin",
    deliveryOptions: ["Pickup", "Seller delivery"],
    sellerProfileId,
    primaryImage: image,
    distance,
    rating,
    status,
    approved,
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeDb(db) {
  const now = nowIso();
  db.meta ||= { name: "ShopLink Dunkwa-on-Offin marketplace database", createdAt: now };
  db.meta.version = Math.max(Number(db.meta.version || 0), 5);
  db.users ||= [];
  db.seller_profiles ||= [];
  db.categories ||= [];
  db.listings ||= [];
  db.listing_images ||= [];
  db.favorites ||= [];
  db.carts ||= [];
  db.orders ||= [];
  db.order_events ||= [];
  db.payment_intents ||= [];
  db.payouts ||= [];
  db.messages ||= [];
  db.message_threads ||= [];
  db.reviews ||= [];
  db.reports ||= [];
  db.disputes ||= [];
  db.notifications ||= [];
  db.media_assets ||= [];
  db.verification_requests ||= [];
  db.password_resets ||= [];
  db.audit_logs ||= [];
  db.sessions ||= [];
  db.seller_follows ||= [];
  db.seller_adverts ||= [];
  db.email_notifications ||= [];
  db.platform_settings ||= [
    {
      id: "shoplink",
      advertListingFeeCents: 2500,
      featuredAdvertFeeCents: 7500,
      advertDurationDays: 7,
      commissionRate: 10,
      updatedAt: now,
    },
  ];

  for (const user of db.users) {
    user.googleId ??= null;
    user.avatarUrl ??= "";
    user.authProvider ??= "password";
    user.phone ??= "";
    user.location ??= "Dunkwa-on-Offin";
    user.profileCompleted ??= true;
    user.status ??= "active";
    user.emailVerified ??= false;
  }

  for (const seller of db.seller_profiles) {
    seller.momoNetwork ??= "";
    seller.momoNumber ??= "";
    seller.payoutAccountName ??= "";
    seller.paystackRecipientCode ??= "";
    seller.paystackSubaccountCode ??= "";
    seller.bio ??= "";
    seller.idDocumentUrl ??= "";
    seller.businessDocumentUrl ??= "";
    seller.sellerAgreementAcceptedAt ??= null;
    seller.serviceRadiusKm ??= 10;
    seller.trustBadges ??= [];
    seller.createdAt ??= seller.approvedAt || now;
  }

  for (const listing of db.listings) {
    listing.sku ??= "";
    listing.lowStockThreshold ??= 2;
    listing.variants ??= [];
    listing.bookingSlots ??= [];
    listing.deliveryFeeCents ??= 0;
  }

  for (const order of db.orders) {
    order.deliveryContactName ??= "";
    order.deliveryPhone ??= "";
    order.deliveryTown ??= "Dunkwa-on-Offin";
    order.deliveryAddress ??= "";
    order.deliveryNote ??= "";
    order.sellerOpenedAt ??= null;
    order.deliveryStatus ??= order.status === "completed" ? "delivered" : order.sellerOpenedAt ? "opened" : "new";
  }

  for (const payment of db.payment_intents) {
    payment.sellerProfileId ??= db.orders.find((order) => order.id === payment.orderId)?.sellerProfileId || null;
    payment.destinationType ??= "mobile_money";
    payment.destinationLabel ??= "";
  }

  for (const payout of db.payouts) {
    payout.orderId ??= null;
  }

  for (const media of db.media_assets) {
    media.storageProvider ??= "local";
    media.storageKey ??= "";
    media.originalName ??= "";
  }

  for (const settings of db.platform_settings) {
    settings.r2AccountId ??= "";
    settings.r2AccessKeyId ??= "";
    settings.r2SecretAccessKey ??= "";
    settings.r2Bucket ??= "";
    settings.r2PublicUrl ??= "";
    settings.supportEmail ??= "";
    settings.deliveryZones ??= [];
    settings.pickupPoints ??= [];
    settings.bannedTerms ??= [];
  }

  return db;
}
