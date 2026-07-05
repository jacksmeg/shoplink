import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createId,
  dbMode,
  ensureDb,
  hashPassword,
  readDb,
  verifyPassword,
  writeDb,
} from "./database.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || (isProduction() ? "0.0.0.0" : "127.0.0.1");
const sessionCookie = "shoplink_session";
const sessionDays = 14;
const uploadRoot = join(rootDir, "public", "uploads", "listings");
const maxImageBytes = 5 * 1024 * 1024;
const maxMultipartBytes = 12 * 1024 * 1024;
const authAttempts = new Map();
const authWindowMs = 10 * 60 * 1000;
const authMaxAttempts = 12;
const imageMimeExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

await loadEnvFile();
await ensureDb();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
}).listen(port, host, () => {
  console.log(`ShopLink API listening on http://${host}:${port}`);
});

async function handleApi(request, response, url) {
  const db = await readDb();
  ensureRuntimeDb(db);
  const session = getSession(request, db);
  const fullUser = session ? db.users.find((candidate) => candidate.id === session.userId) : null;
  const user = sanitizeUser(fullUser);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, mode: dbMode(), tables: tableCounts(db) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(response, 200, {
      user,
      categories: db.categories,
      featuredSellers: featuredSellers(db),
      serviceQueue: serviceQueue(db),
      listings: publicListings(db, user),
      adverts: activeAdverts(db),
      followingSellers: user ? userFollowingSellers(db, user.id) : [],
      publicReviews: publicReviews(db),
      integrations: buildIntegrations(db),
      favorites: user ? userFavorites(db, user.id) : [],
      cart: user ? presentCart(db, user.id) : emptyCart(),
      platform: buildPlatform(db, user),
      schema: tableCounts(db),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/platform") {
    sendJson(response, 200, { platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/google/start") {
    const google = integrationConfig(db).google;
    if (!google.clientId || !google.clientSecret) {
      sendRedirect(response, "/?auth=google_not_configured");
      return;
    }
    if (!googleClientIdLooksValid(google.clientId)) {
      sendRedirect(response, "/?auth=google_bad_client_id");
      return;
    }

    const state = createSecureToken();
    const redirectUri = googleRedirectUri(request, db);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", google.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");

    sendRedirect(response, authUrl.toString(), {
      "Set-Cookie": oauthStateCookie(state),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/google/callback") {
    const google = integrationConfig(db).google;
    if (!google.clientId || !google.clientSecret) {
      sendRedirect(response, "/?auth=google_not_configured");
      return;
    }

    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      sendRedirect(response, `/?auth=${googleAuthErrorCode(oauthError)}`);
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state !== readCookie(request, "shoplink_oauth_state")) {
      sendRedirect(response, "/?auth=google_failed");
      return;
    }

    try {
      const googleUser = await fetchGoogleUser(code, googleRedirectUri(request, db), google);
      let account = db.users.find((candidate) => candidate.googleId === googleUser.sub);
      if (!account && googleUser.email) {
        account = db.users.find((candidate) => candidate.email === normalizeEmail(googleUser.email));
      }

      if (account?.status === "suspended") {
        sendRedirect(response, "/?auth=suspended");
        return;
      }

      if (!account) {
        account = {
          id: createId("user"),
          name: googleUser.name || googleUser.email?.split("@")[0] || "ShopLink Buyer",
          email: normalizeEmail(googleUser.email),
          role: "buyer",
          passwordHash: hashPassword(createSecureToken()),
          status: "active",
          emailVerified: Boolean(googleUser.email_verified),
          googleId: googleUser.sub,
          avatarUrl: googleUser.picture || "",
          authProvider: "google",
          phone: "",
          location: "Dunkwa-on-Offin",
          profileCompleted: true,
          createdAt: nowIso(),
        };
        db.users.push(account);
      } else {
        account.googleId = googleUser.sub;
        account.avatarUrl = googleUser.picture || account.avatarUrl || "";
        account.authProvider = account.authProvider === "password" ? "password_google" : "google";
        account.emailVerified = account.emailVerified || Boolean(googleUser.email_verified);
      }

      const token = createSession(db, account.id, request);
      await writeDb(db);
      sendRedirect(response, "/?auth=google_signed_in", {
        "Set-Cookie": [authCookieHeader(token), oauthStateCookie("", 0)],
      });
    } catch (error) {
      console.error("Google OAuth failed", error);
      sendRedirect(response, "/?auth=google_failed");
    }
    return;
  }

  if (isAuthMutation(request, url) && isRateLimited(request)) {
    sendJson(response, 429, { error: "Too many auth attempts. Try again in a few minutes." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(request);
    const role = ["buyer", "seller"].includes(body.role) ? body.role : "buyer";
    const email = normalizeEmail(body.email);

    if (!body.name?.trim() || !email || !body.password || body.password.length < 8) {
      sendJson(response, 400, { error: "Name, valid email, and password with 8+ characters are required." });
      return;
    }

    if (db.users.some((candidate) => candidate.email === email)) {
      sendJson(response, 409, { error: "That email is already registered." });
      return;
    }

    const newUser = {
      id: createId("user"),
      name: body.name.trim(),
      email,
      role,
      passwordHash: hashPassword(body.password),
      status: "active",
      emailVerified: false,
      googleId: null,
      avatarUrl: "",
      authProvider: "password",
      phone: body.phone?.trim() || "",
      location: body.location?.trim() || "",
      profileCompleted: true,
      createdAt: nowIso(),
    };
    db.users.push(newUser);

    if (role === "seller") {
      db.seller_profiles.push({
        id: createId("seller"),
        userId: newUser.id,
        shopName: body.shopName?.trim() || `${newUser.name}'s Shop`,
        category: body.shopCategory?.trim() || "Community Seller",
        initials: initialsFor(body.shopName || newUser.name),
        tone: "green",
        verified: false,
        kycStatus: "not_started",
        payoutStatus: "not_started",
        momoNetwork: body.momoNetwork?.trim() || "",
        momoNumber: body.momoNumber?.trim() || "",
        payoutAccountName: body.payoutAccountName?.trim() || "",
        paystackRecipientCode: "",
        paystackSubaccountCode: "",
        bio: "",
        idDocumentUrl: "",
        businessDocumentUrl: "",
        sellerAgreementAcceptedAt: null,
        serviceRadiusKm: 10,
        trustBadges: [],
        approvedAt: null,
        createdAt: nowIso(),
      });
    }

    const token = createSession(db, newUser.id, request);
    await writeDb(db);
    sendAuthCookie(response, token);
    sendJson(response, 201, { user: sanitizeUser(newUser) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const foundUser = db.users.find((candidate) => candidate.email === email);

    if (!foundUser || !verifyPassword(body.password || "", foundUser.passwordHash)) {
      sendJson(response, 401, { error: "Invalid email or password." });
      return;
    }

    if (foundUser.status === "suspended") {
      sendJson(response, 403, { error: "This account is suspended. Contact marketplace support." });
      return;
    }

    const token = createSession(db, foundUser.id, request);
    await writeDb(db);
    sendAuthCookie(response, token);
    sendJson(response, 200, { user: sanitizeUser(foundUser) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = readCookie(request, sessionCookie);
    if (token) {
      const tokenHash = hashOpaqueToken(token);
      const nextSessions = db.sessions.filter((candidate) => candidate.token !== token && candidate.tokenHash !== tokenHash);
      if (nextSessions.length !== db.sessions.length) {
        db.sessions = nextSessions;
        await writeDb(db);
      }
    }
    clearAuthCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/password-reset") {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const foundUser = db.users.find((candidate) => candidate.email === email);
    let devToken = null;
    if (foundUser) {
      const token = createSecureToken();
      devToken = token;
      db.password_resets.push({
        id: createId("reset"),
        userId: foundUser.id,
        tokenHash: hashOpaqueToken(token),
        status: "requested",
        createdAt: nowIso(),
        usedAt: null,
      });
      await writeDb(db);
    }
    sendJson(response, 200, {
      ok: true,
      message: "If that email exists, a reset request was recorded.",
      resetToken: isProduction() ? undefined : devToken,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/password-reset/complete") {
    const body = await readJson(request);
    const tokenHash = hashOpaqueToken(body.token || "");
    const reset = db.password_resets.find((candidate) => candidate.tokenHash === tokenHash && candidate.status === "requested");
    if (!reset || new Date(reset.createdAt).getTime() < Date.now() - 60 * 60 * 1000) {
      sendJson(response, 400, { error: "Reset token is invalid or expired." });
      return;
    }
    if (!body.password || body.password.length < 8) {
      sendJson(response, 400, { error: "Password must be at least 8 characters." });
      return;
    }
    const account = db.users.find((candidate) => candidate.id === reset.userId);
    account.passwordHash = hashPassword(body.password);
    reset.status = "used";
    reset.usedAt = nowIso();
    db.sessions = db.sessions.filter((session) => session.userId !== account.id);
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/request-verification") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to request email verification." });
      return;
    }
    const token = createSecureToken();
    db.verification_requests.push({
      id: createId("verify"),
      userId: user.id,
      sellerProfileId: null,
      type: "email",
      status: "requested",
      reviewedBy: null,
      tokenHash: hashOpaqueToken(token),
      createdAt: nowIso(),
      reviewedAt: null,
    });
    await writeDb(db);
    sendJson(response, 200, { ok: true, verificationToken: isProduction() ? undefined : token });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/confirm-email") {
    const body = await readJson(request);
    const tokenHash = hashOpaqueToken(body.token || "");
    const verification = db.verification_requests.find(
      (candidate) => candidate.type === "email" && candidate.tokenHash === tokenHash && candidate.status === "requested",
    );
    if (!verification || new Date(verification.createdAt).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      sendJson(response, 400, { error: "Verification token is invalid or expired." });
      return;
    }
    const account = db.users.find((candidate) => candidate.id === verification.userId);
    account.emailVerified = true;
    verification.status = "confirmed";
    verification.reviewedAt = nowIso();
    await writeDb(db);
    sendJson(response, 200, { user: sanitizeUser(account) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/verify-email") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to verify your account." });
      return;
    }
    const account = db.users.find((candidate) => candidate.id === user.id);
    account.emailVerified = true;
    await writeDb(db);
    sendJson(response, 200, { user: sanitizeUser(account) });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/profile") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to edit your profile." });
      return;
    }
    const body = await readJson(request);
    const account = db.users.find((candidate) => candidate.id === user.id);
    account.name = body.name?.trim() || account.name;
    account.phone = body.phone?.trim() || account.phone || "";
    account.location = body.location?.trim() || account.location || "";
    account.profileCompleted = Boolean(account.name && account.email);
    await writeDb(db);
    sendJson(response, 200, { user: sanitizeUser(account) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/seller/onboarding") {
    if (!user || !["seller", "admin"].includes(user.role)) {
      sendJson(response, 403, { error: "Only sellers can submit onboarding." });
      return;
    }
    const body = await readJson(request);
    const sellerProfile = ensureSellerProfile(db, user, body);
    sellerProfile.shopName = body.shopName?.trim() || sellerProfile.shopName;
    sellerProfile.category = body.category?.trim() || sellerProfile.category;
    sellerProfile.bio = body.bio?.trim() || sellerProfile.bio || "";
    sellerProfile.momoNetwork = body.momoNetwork?.trim() || sellerProfile.momoNetwork || "";
    sellerProfile.momoNumber = body.momoNumber?.trim() || sellerProfile.momoNumber || "";
    sellerProfile.payoutAccountName = body.payoutAccountName?.trim() || sellerProfile.payoutAccountName || "";
    sellerProfile.paystackRecipientCode = body.paystackRecipientCode?.trim() || sellerProfile.paystackRecipientCode || "";
    sellerProfile.paystackSubaccountCode = body.paystackSubaccountCode?.trim() || sellerProfile.paystackSubaccountCode || "";
    sellerProfile.idDocumentUrl = body.idDocumentUrl?.trim() || sellerProfile.idDocumentUrl || "";
    sellerProfile.businessDocumentUrl = body.businessDocumentUrl?.trim() || sellerProfile.businessDocumentUrl || "";
    sellerProfile.serviceRadiusKm = clampInt(body.serviceRadiusKm, 1, 100, sellerProfile.serviceRadiusKm || 10);
    if (body.sellerAgreementAccepted) {
      sellerProfile.sellerAgreementAcceptedAt ||= nowIso();
    }
    sellerProfile.kycStatus = "submitted";
    sellerProfile.payoutStatus = "needs_review";
    db.verification_requests.push({
      id: createId("verify"),
      userId: user.id,
      sellerProfileId: sellerProfile.id,
      type: "seller_kyc",
      status: "submitted",
      reviewedBy: null,
      createdAt: nowIso(),
      reviewedAt: null,
    });
    await writeDb(db);
    sendJson(response, 200, { sellerProfile: presentSeller(db, sellerProfile, user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/listing-images") {
    if (!user || !["seller", "admin"].includes(user.role)) {
      sendJson(response, 403, { error: "Only sellers and admins can upload listing images." });
      return;
    }

    const files = await readMultipartFiles(request);
    const imageFiles = files.filter((file) => file.fieldName === "images");
    if (!imageFiles.length) {
      sendJson(response, 400, { error: "Choose at least one image to upload." });
      return;
    }

    if (imageFiles.length > 10) {
      sendJson(response, 400, { error: "Upload up to 10 listing images at a time." });
      return;
    }

    const uploaded = [];
    const timestamp = nowIso();

    for (const file of imageFiles) {
      const extension = imageMimeExtensions[file.mimeType];
      if (!extension || !isValidImageSignature(file.buffer, file.mimeType)) {
        sendJson(response, 400, { error: "Only valid JPG, PNG, or WebP images are allowed." });
        return;
      }

      if (file.buffer.byteLength > maxImageBytes) {
        sendJson(response, 400, { error: "Each image must be 5 MB or smaller." });
        return;
      }

      const mediaId = createId("media");
      const storedImage = await storeListingImage(db, file, extension);

      const media = {
        id: mediaId,
        ownerId: user.id,
        url: storedImage.url,
        kind: "listing_image",
        status: user.role === "admin" ? "approved" : "pending_review",
        byteSize: file.buffer.byteLength,
        mimeType: file.mimeType,
        storageProvider: storedImage.storageProvider,
        storageKey: storedImage.storageKey,
        originalName: file.fileName,
        createdAt: timestamp,
      };
      db.media_assets.unshift(media);
      uploaded.push(media);
    }

    await writeDb(db);
    sendJson(response, 201, { media: uploaded });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/listings") {
    if (!user || !["seller", "admin"].includes(user.role)) {
      sendJson(response, 403, { error: "Only sellers and admins can publish listings." });
      return;
    }

    const body = await readJson(request);
    const title = body.title?.trim();
    const price = Number(body.price);
    const category = db.categories.find((candidate) => candidate.name === body.category || candidate.id === body.category);

    if (!title || !Number.isFinite(price) || price < 0 || !category) {
      sendJson(response, 400, { error: "Title, valid price, and category are required." });
      return;
    }

    const sellerProfile = ensureSellerProfile(db, user, body);
    const timestamp = nowIso();
    const listingType = body.listingType === "service" ? "service" : "product";
    const stock = listingType === "product" ? Math.max(0, Number.isFinite(Number(body.stock)) ? Number(body.stock) : 1) : null;
    const deliveryOptions = normalizeDeliveryOptions(body.deliveryOptions, body.fulfillment);
    const imageUrls = Array.isArray(body.images)
      ? body.images.map((image) => String(image.url || image)).filter(isSafeImageUrl).slice(0, 10)
      : [];
    const primaryImage = isSafeImageUrl(body.primaryImage)
      ? body.primaryImage
      : imageUrls[0] || "/images/shoplink-placeholder.svg";
    const listing = {
      id: createId("listing"),
      title,
      listingType,
      categoryId: category.id,
      priceCents: Math.round(price * 100),
      pricingUnit: body.pricingUnit?.trim() || "",
      description: body.description?.trim() || "",
      fulfillment: body.fulfillment || "Pickup only",
      visibility: body.visibility || "Public",
      stock,
      location: body.location?.trim() || "Dunkwa-on-Offin",
      deliveryOptions,
      sku: body.sku?.trim() || "",
      lowStockThreshold: clampInt(body.lowStockThreshold, 0, 1000, 2),
      variants: normalizeStringList(body.variants).slice(0, 20),
      bookingSlots: normalizeStringList(body.bookingSlots).slice(0, 20),
      deliveryFeeCents: centsFromGhs(body.deliveryFee, 0),
      sellerProfileId: sellerProfile.id,
      primaryImage,
      distance: "New listing",
      rating: "New",
      status: user.role === "admin" ? "active" : "pending_review",
      approved: user.role === "admin",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.listings.unshift(listing);
    const allImageUrls = [...new Set([listing.primaryImage, ...imageUrls])];
    db.listing_images.push(...allImageUrls.map((imageUrl, index) => ({
      id: createId("img"),
      listingId: listing.id,
      url: imageUrl,
      sortOrder: index + 1,
    })));

    await writeDb(db);
    sendJson(response, 201, { listing: presentListing(db, listing, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/listings/")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to edit listings." });
      return;
    }
    const listingId = decodeURIComponent(url.pathname.replace("/api/listings/", ""));
    const listing = db.listings.find((candidate) => candidate.id === listingId);
    if (!listing) {
      sendJson(response, 404, { error: "Listing not found." });
      return;
    }
    if (!canManageListing(db, listing, user)) {
      sendJson(response, 403, { error: "You cannot manage this listing." });
      return;
    }
    const body = await readJson(request);
    listing.title = body.title?.trim() || listing.title;
    listing.description = body.description?.trim() ?? listing.description;
    listing.stock = Number.isFinite(Number(body.stock)) ? Number(body.stock) : listing.stock;
    listing.location = body.location?.trim() || listing.location;
    listing.deliveryOptions = Array.isArray(body.deliveryOptions) ? body.deliveryOptions : listing.deliveryOptions;
    listing.sku = body.sku?.trim() ?? listing.sku ?? "";
    listing.lowStockThreshold = Object.hasOwn(body, "lowStockThreshold") ? clampInt(body.lowStockThreshold, 0, 1000, listing.lowStockThreshold || 2) : listing.lowStockThreshold || 2;
    listing.variants = Object.hasOwn(body, "variants") ? normalizeStringList(body.variants).slice(0, 20) : listing.variants || [];
    listing.bookingSlots = Object.hasOwn(body, "bookingSlots") ? normalizeStringList(body.bookingSlots).slice(0, 20) : listing.bookingSlots || [];
    listing.deliveryFeeCents = Object.hasOwn(body, "deliveryFee") ? centsFromGhs(body.deliveryFee, listing.deliveryFeeCents || 0) : listing.deliveryFeeCents || 0;
    listing.status = ["active", "paused", "pending_review"].includes(body.status) ? body.status : listing.status;
    listing.updatedAt = nowIso();
    await writeDb(db);
    sendJson(response, 200, { listing: presentListing(db, listing, user) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/listings/")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to delete listings." });
      return;
    }
    const listingId = decodeURIComponent(url.pathname.replace("/api/listings/", ""));
    const listing = db.listings.find((candidate) => candidate.id === listingId);
    if (!listing) {
      sendJson(response, 404, { error: "Listing not found." });
      return;
    }
    if (!canManageListing(db, listing, user)) {
      sendJson(response, 403, { error: "You cannot manage this listing." });
      return;
    }
    await deleteStoredListingImages(db, listing);
    listing.status = "deleted";
    listing.updatedAt = nowIso();
    await writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/favorites/")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to save listings." });
      return;
    }

    const listingId = decodeURIComponent(url.pathname.replace("/api/favorites/", ""));
    const listing = db.listings.find((candidate) => candidate.id === listingId);
    if (!listing) {
      sendJson(response, 404, { error: "Listing not found." });
      return;
    }

    const existing = db.favorites.find((candidate) => candidate.userId === user.id && candidate.listingId === listingId);
    if (existing) {
      db.favorites = db.favorites.filter((candidate) => candidate.id !== existing.id);
    } else {
      db.favorites.push({ id: createId("favorite"), userId: user.id, listingId, createdAt: nowIso() });
    }
    await writeDb(db);
    sendJson(response, 200, { favorites: userFavorites(db, user.id) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/sellers/") && url.pathname.endsWith("/follow")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to follow sellers." });
      return;
    }

    const sellerId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const seller = db.seller_profiles.find((candidate) => candidate.id === sellerId);
    if (!seller) {
      sendJson(response, 404, { error: "Seller not found." });
      return;
    }
    if (seller.userId === user.id) {
      sendJson(response, 400, { error: "Sellers cannot follow their own shop." });
      return;
    }

    const existing = db.seller_follows.find((candidate) => candidate.userId === user.id && candidate.sellerProfileId === seller.id);
    let following = false;
    if (existing) {
      db.seller_follows = db.seller_follows.filter((candidate) => candidate.id !== existing.id);
    } else {
      db.seller_follows.push({ id: createId("follow"), userId: user.id, sellerProfileId: seller.id, createdAt: nowIso() });
      following = true;
    }
    await writeDb(db);
    sendJson(response, 200, {
      following,
      followingSellers: userFollowingSellers(db, user.id),
      seller: presentSeller(db, seller, user),
      platform: buildPlatform(db, user),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/cart") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to view your cart." });
      return;
    }

    sendJson(response, 200, { cart: presentCart(db, user.id) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cart/items") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to add items to cart." });
      return;
    }

    const body = await readJson(request);
    const listing = db.listings.find((candidate) => candidate.id === body.listingId && candidate.status === "active");
    if (!listing) {
      sendJson(response, 404, { error: "Active listing not found." });
      return;
    }

    const sellerAccount = sellerUserForProfile(db, listing.sellerProfileId);
    if (sellerAccount?.id === user.id && user.role !== "admin") {
      sendJson(response, 400, { error: "Sellers cannot add their own listing to cart." });
      return;
    }

    const quantity = cartQuantity(body.quantity);
    if (listing.listingType === "product" && Number.isFinite(Number(listing.stock)) && Number(listing.stock) < quantity) {
      sendJson(response, 400, { error: "There is not enough stock for that quantity." });
      return;
    }

    const cart = ensureCart(db, user.id);
    const existing = cart.items.find((item) => item.listingId === listing.id);
    if (existing) {
      existing.quantity = cartQuantity(existing.quantity + quantity);
      existing.updatedAt = nowIso();
    } else {
      cart.items.push({ listingId: listing.id, quantity, addedAt: nowIso(), updatedAt: nowIso() });
    }
    cart.updatedAt = nowIso();

    await writeDb(db);
    sendJson(response, 200, { cart: presentCart(db, user.id) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/cart/items/")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to update your cart." });
      return;
    }

    const listingId = decodeURIComponent(url.pathname.replace("/api/cart/items/", ""));
    const body = await readJson(request);
    const cart = ensureCart(db, user.id);
    const existing = cart.items.find((item) => item.listingId === listingId);
    if (!existing) {
      sendJson(response, 404, { error: "Cart item not found." });
      return;
    }

    const listing = db.listings.find((candidate) => candidate.id === listingId);
    const quantity = cartQuantity(body.quantity);
    if (listing?.listingType === "product" && Number.isFinite(Number(listing.stock)) && Number(listing.stock) < quantity) {
      sendJson(response, 400, { error: "There is not enough stock for that quantity." });
      return;
    }

    existing.quantity = quantity;
    existing.updatedAt = nowIso();
    cart.updatedAt = nowIso();

    await writeDb(db);
    sendJson(response, 200, { cart: presentCart(db, user.id) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/cart/items/")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to update your cart." });
      return;
    }

    const listingId = decodeURIComponent(url.pathname.replace("/api/cart/items/", ""));
    const cart = ensureCart(db, user.id);
    cart.items = cart.items.filter((item) => item.listingId !== listingId);
    cart.updatedAt = nowIso();

    await writeDb(db);
    sendJson(response, 200, { cart: presentCart(db, user.id) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cart/checkout") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to checkout." });
      return;
    }

    const body = await readJson(request);
    const cart = ensureCart(db, user.id);
    const activeItems = cart.items
      .map((item) => ({
        ...item,
        quantity: cartQuantity(item.quantity),
        listing: db.listings.find((listing) => listing.id === item.listingId && listing.status === "active"),
      }))
      .filter((item) => item.listing);

    if (!activeItems.length) {
      sendJson(response, 400, { error: "Your cart is empty." });
      return;
    }

    for (const item of activeItems) {
      if (item.listing.listingType === "product" && Number.isFinite(Number(item.listing.stock)) && Number(item.listing.stock) < item.quantity) {
        sendJson(response, 400, { error: `${item.listing.title} does not have enough stock.` });
        return;
      }
    }

    const orders = activeItems.map((item) =>
      createOrderRecord(db, user, item.listing, {
        quantity: item.quantity,
        deliveryMethod: body.deliveryMethod || item.listing.fulfillment,
        deliveryDetails: normalizeDeliveryDetails(body, user),
        scheduledFor: body.scheduledFor || null,
        note: "Buyer checked out from cart.",
      }),
    );

    cart.items = [];
    cart.updatedAt = nowIso();
    await deliverQueuedEmails(db);
    await writeDb(db);
    sendJson(response, 201, { orders: orders.map((order) => presentOrder(db, order, user)), cart: presentCart(db, user.id) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to place orders." });
      return;
    }
    const body = await readJson(request);
    const listing = db.listings.find((candidate) => candidate.id === body.listingId && candidate.status === "active");
    if (!listing) {
      sendJson(response, 404, { error: "Active listing not found." });
      return;
    }
    const sellerAccount = sellerUserForProfile(db, listing.sellerProfileId);
    if (sellerAccount?.id === user.id && user.role !== "admin") {
      sendJson(response, 400, { error: "Sellers cannot order their own listing." });
      return;
    }
    const quantity = listing.listingType === "product" ? cartQuantity(body.quantity) : 1;
    if (listing.listingType === "product" && Number.isFinite(Number(listing.stock)) && Number(listing.stock) < quantity) {
      sendJson(response, 400, { error: "There is not enough stock for that quantity." });
      return;
    }

    const order = createOrderRecord(db, user, listing, {
      quantity,
      deliveryMethod: body.deliveryMethod || listing.fulfillment,
      deliveryDetails: normalizeDeliveryDetails(body, user),
      scheduledFor: body.scheduledFor || null,
      note: "Buyer placed an order or service request.",
    });
    await deliverQueuedEmails(db);
    await writeDb(db);
    sendJson(response, 201, { order: presentOrder(db, order, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/open")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to manage orders." });
      return;
    }
    const orderId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      sendJson(response, 404, { error: "Order not found." });
      return;
    }
    if (!canSellerManageOrder(db, order, user)) {
      sendJson(response, 403, { error: "Only the seller or admin can open this order." });
      return;
    }
    const previousStatus = order.deliveryStatus || "new";
    order.sellerOpenedAt ||= nowIso();
    order.deliveryStatus = "opened";
    order.updatedAt = nowIso();
    db.order_events.push({
      id: createId("event"),
      orderId: order.id,
      actorId: user.id,
      fromStatus: previousStatus,
      toStatus: "opened",
      note: "Seller opened the order.",
      createdAt: nowIso(),
    });
    const buyerAccount = db.users.find((candidate) => candidate.id === order.buyerId);
    addNotification(db, buyerAccount, "Seller opened your order", "The seller has opened your order and can now update delivery progress.");
    queueBuyerOrderEmailNotification(db, buyerAccount, order, "ShopLink order update: seller opened your order");
    await deliverQueuedEmails(db);
    await writeDb(db);
    sendJson(response, 200, { order: presentOrder(db, order, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/delivery-status")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to manage orders." });
      return;
    }
    const orderId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      sendJson(response, 404, { error: "Order not found." });
      return;
    }
    if (!canSellerManageOrder(db, order, user)) {
      sendJson(response, 403, { error: "Only the seller or admin can update delivery tracking." });
      return;
    }
    const body = await readJson(request);
    const nextDeliveryStatus = body.deliveryStatus || body.status;
    if (!["opened", "preparing", "ready_for_pickup", "out_for_delivery", "delivered"].includes(nextDeliveryStatus)) {
      sendJson(response, 400, { error: "Invalid delivery status." });
      return;
    }
    const previousStatus = order.deliveryStatus || "new";
    order.deliveryStatus = nextDeliveryStatus;
    if (!order.sellerOpenedAt) {
      order.sellerOpenedAt = nowIso();
    }
    order.updatedAt = nowIso();
    db.order_events.push({
      id: createId("event"),
      orderId: order.id,
      actorId: user.id,
      fromStatus: previousStatus,
      toStatus: nextDeliveryStatus,
      note: body.note?.trim() || deliveryStatusLabel(nextDeliveryStatus),
      createdAt: nowIso(),
    });
    const buyerAccount = db.users.find((candidate) => candidate.id === order.buyerId);
    addNotification(db, buyerAccount, "Order tracking updated", deliveryStatusLabel(nextDeliveryStatus));
    queueBuyerOrderEmailNotification(db, buyerAccount, order, `ShopLink order update: ${deliveryStatusLabel(nextDeliveryStatus)}`);
    await deliverQueuedEmails(db);
    await writeDb(db);
    sendJson(response, 200, { order: presentOrder(db, order, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/confirm-received")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to confirm delivery." });
      return;
    }
    const orderId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      sendJson(response, 404, { error: "Order not found." });
      return;
    }
    if (order.buyerId !== user.id && user.role !== "admin") {
      sendJson(response, 403, { error: "Only the buyer can confirm delivery." });
      return;
    }
    completeOrderAndCreatePayout(db, order, user.id, "Buyer confirmed the order was received.");
    const sellerAccount = sellerUserForProfile(db, order.sellerProfileId);
    addNotification(db, sellerAccount, "Buyer confirmed delivery", `Order ${order.id} is completed and ready for payout tracking.`);
    await writeDb(db);
    sendJson(response, 200, { order: presentOrder(db, order, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/cancel-request")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to request cancellation." });
      return;
    }
    const orderId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      sendJson(response, 404, { error: "Order not found." });
      return;
    }
    if (!canManageOrder(db, order, user)) {
      sendJson(response, 403, { error: "You cannot request cancellation for this order." });
      return;
    }
    const body = await readJson(request);
    const previousStatus = order.status;
    order.status = "cancelled";
    order.deliveryStatus = order.deliveryStatus || "new";
    order.updatedAt = nowIso();
    db.order_events.push({
      id: createId("event"),
      orderId: order.id,
      actorId: user.id,
      fromStatus: previousStatus,
      toStatus: "cancelled",
      note: body.reason?.trim() || "Cancellation requested.",
      createdAt: nowIso(),
    });
    const buyerAccount = db.users.find((candidate) => candidate.id === order.buyerId);
    const sellerAccount = sellerUserForProfile(db, order.sellerProfileId);
    addNotification(db, buyerAccount, "Order cancellation recorded", `Order ${order.id} has been cancelled.`);
    addNotification(db, sellerAccount, "Order cancellation recorded", `Order ${order.id} has been cancelled.`);
    await writeDb(db);
    sendJson(response, 200, { order: presentOrder(db, order, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/refund-request")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to request a refund." });
      return;
    }
    const orderId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      sendJson(response, 404, { error: "Order not found." });
      return;
    }
    if (!canManageOrder(db, order, user)) {
      sendJson(response, 403, { error: "You cannot open a dispute for this order." });
      return;
    }
    const body = await readJson(request);
    const dispute = {
      id: createId("dispute"),
      orderId: order.id,
      openedBy: user.id,
      reason: body.reason?.trim() || "Refund or replacement requested.",
      status: "refund_requested",
      createdAt: nowIso(),
    };
    db.disputes.unshift(dispute);
    db.order_events.push({
      id: createId("event"),
      orderId: order.id,
      actorId: user.id,
      fromStatus: order.status,
      toStatus: "refund_requested",
      note: dispute.reason,
      createdAt: nowIso(),
    });
    const sellerAccount = sellerUserForProfile(db, order.sellerProfileId);
    addNotification(db, sellerAccount, "Refund request opened", `A buyer opened a refund request for order ${order.id}.`);
    db.audit_logs.unshift(createAuditLog(user.id, "refund_requested", "order", order.id, { disputeId: dispute.id }));
    await writeDb(db);
    sendJson(response, 201, { dispute, platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/orders/")) {
    if (!user) {
      sendJson(response, 401, { error: "Log in to manage orders." });
      return;
    }
    const orderId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      sendJson(response, 404, { error: "Order not found." });
      return;
    }
    if (!canManageOrder(db, order, user)) {
      sendJson(response, 403, { error: "You cannot manage this order." });
      return;
    }
    const body = await readJson(request);
    const nextStatus = body.status;
    if (!["pending", "accepted", "paid", "completed", "cancelled", "rejected"].includes(nextStatus)) {
      sendJson(response, 400, { error: "Invalid order status." });
      return;
    }
    if (!canTransitionOrder(db, order, user, nextStatus)) {
      sendJson(response, 403, { error: "This account cannot move the order to that status." });
      return;
    }
    const previousStatus = order.status;
    order.status = nextStatus;
    order.paymentStatus = nextStatus === "paid" ? "paid" : order.paymentStatus;
    order.updatedAt = nowIso();
    db.order_events.push({
      id: createId("event"),
      orderId: order.id,
      actorId: user.id,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      note: body.note?.trim() || `Order moved to ${nextStatus}.`,
      createdAt: nowIso(),
    });
    const buyerAccount = db.users.find((candidate) => candidate.id === order.buyerId);
    const sellerAccount = sellerUserForProfile(db, order.sellerProfileId);
    if (nextStatus === "completed") {
      completeOrderAndCreatePayout(db, order, user.id, body.note?.trim() || "Order completed.");
    }
    if (user.id !== buyerAccount?.id) {
      addNotification(db, buyerAccount, "Order status updated", `Your order is now ${nextStatus}.`);
      queueBuyerOrderEmailNotification(db, buyerAccount, order, `ShopLink order update: order ${nextStatus}`);
    }
    if (user.id !== sellerAccount?.id) {
      addNotification(db, sellerAccount, "Order status updated", `Order ${order.id} is now ${nextStatus}.`);
    }
    await deliverQueuedEmails(db);
    await writeDb(db);
    sendJson(response, 200, { order: presentOrder(db, order, user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/messages") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to send messages." });
      return;
    }
    const body = await readJson(request);
    const listing = db.listings.find((candidate) => candidate.id === body.listingId);
    if (!listing || !body.body?.trim()) {
      sendJson(response, 400, { error: "Listing and message body are required." });
      return;
    }
    const sellerUser = sellerUserForProfile(db, listing.sellerProfileId);
    const thread = findOrCreateThread(db, user.id, listing.sellerProfileId, listing.id, body.orderId || null);
    const message = {
      id: createId("message"),
      threadId: thread.id,
      orderId: body.orderId || null,
      listingId: listing.id,
      senderId: user.id,
      recipientId: sellerUser?.id === user.id ? body.recipientId : sellerUser?.id,
      body: body.body.trim(),
      readAt: null,
      createdAt: nowIso(),
    };
    db.messages.push(message);
    thread.updatedAt = message.createdAt;
    await writeDb(db);
    sendJson(response, 201, { message });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reviews") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to leave reviews." });
      return;
    }
    const body = await readJson(request);
    const order = db.orders.find((candidate) => candidate.id === body.orderId);
    if (!order || order.buyerId !== user.id || order.status !== "completed") {
      sendJson(response, 400, { error: "Reviews require a completed buyer order." });
      return;
    }
    if (db.reviews.some((candidate) => candidate.orderId === order.id && candidate.reviewerId === user.id)) {
      sendJson(response, 409, { error: "You already reviewed this order." });
      return;
    }
    const review = {
      id: createId("review"),
      orderId: order.id,
      listingId: order.listingId,
      reviewerId: user.id,
      sellerProfileId: order.sellerProfileId,
      rating: Math.max(1, Math.min(5, Number(body.rating) || 5)),
      comment: body.comment?.trim() || "",
      status: "published",
      createdAt: nowIso(),
    };
    db.reviews.push(review);
    await writeDb(db);
    sendJson(response, 201, { review: presentReview(db, review), publicReviews: publicReviews(db) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reports") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to report marketplace issues." });
      return;
    }
    const body = await readJson(request);
    const report = {
      id: createId("report"),
      reporterId: user.id,
      targetType: body.targetType || "listing",
      targetId: body.targetId,
      reason: body.reason?.trim() || "No reason provided",
      status: "open",
      createdAt: nowIso(),
    };
    db.reports.unshift(report);
    await writeDb(db);
    sendJson(response, 201, { report });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/media-assets") {
    if (!user) {
      sendJson(response, 401, { error: "Log in to add media." });
      return;
    }
    const body = await readJson(request);
    if (!isSafeImageUrl(body.url)) {
      sendJson(response, 400, { error: "Use an approved listing image URL." });
      return;
    }
    const media = {
      id: createId("media"),
      ownerId: user.id,
      url: body.url,
      kind: body.kind || "listing_image",
      status: "pending_review",
      createdAt: nowIso(),
    };
    db.media_assets.push(media);
    await writeDb(db);
    sendJson(response, 201, { media });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/adverts") {
    if (!user || !["seller", "admin"].includes(user.role)) {
      sendJson(response, 403, { error: "Only sellers can request adverts." });
      return;
    }

    const body = await readJson(request);
    const sellerProfile = ensureSellerProfile(db, user, body);
    const listing = body.listingId ? db.listings.find((candidate) => candidate.id === body.listingId) : null;
    if (listing && !canManageListing(db, listing, user)) {
      sendJson(response, 403, { error: "You can only advertise your own listings." });
      return;
    }

    const settings = platformSettings(db);
    const placement = body.placement === "featured" ? "featured" : "home_top";
    const feeCents = placement === "featured" ? settings.featuredAdvertFeeCents : settings.advertListingFeeCents;
    const advert = {
      id: createId("advert"),
      sellerProfileId: sellerProfile.id,
      listingId: listing?.id || null,
      title: body.title?.trim() || listing?.title || `${sellerProfile.shopName} advert`,
      body: body.body?.trim() || listing?.description || "Promoted ShopLink seller advert.",
      placement,
      status: user.role === "admin" ? "active" : "pending_payment",
      feeCents,
      startsAt: user.role === "admin" ? nowIso() : null,
      endsAt: user.role === "admin" ? advertEndDate(settings.advertDurationDays) : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.seller_adverts.unshift(advert);
    db.audit_logs.unshift(createAuditLog(user.id, "advert_requested", "seller_advert", advert.id, { feeCents }));
    await writeDb(db);
    sendJson(response, 201, { advert: presentAdvert(db, advert), platform: buildPlatform(db, user), adverts: activeAdverts(db) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/settings") {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const body = await readJson(request);
    const settings = platformSettings(db);
    settings.advertListingFeeCents = centsFromGhs(body.advertListingFee, settings.advertListingFeeCents);
    settings.featuredAdvertFeeCents = centsFromGhs(body.featuredAdvertFee, settings.featuredAdvertFeeCents);
    settings.advertDurationDays = clampInt(body.advertDurationDays, 1, 365, settings.advertDurationDays);
    settings.commissionRate = clampNumber(body.commissionRate, 0, 40, settings.commissionRate);
    updatePlainSetting(settings, body, "googleClientId");
    updateSecretSetting(settings, body, "googleClientSecret");
    updatePlainSetting(settings, body, "googleRedirectUri");
    updatePlainSetting(settings, body, "publicBaseUrl");
    updateSecretSetting(settings, body, "resendApiKey");
    updatePlainSetting(settings, body, "resendFromEmail");
    updatePlainSetting(settings, body, "r2AccountId");
    updateSecretSetting(settings, body, "r2AccessKeyId");
    updateSecretSetting(settings, body, "r2SecretAccessKey");
    updatePlainSetting(settings, body, "r2Bucket");
    updatePlainSetting(settings, body, "r2PublicUrl");
    updatePlainSetting(settings, body, "supportEmail");
    if (Object.hasOwn(body, "deliveryZones")) {
      settings.deliveryZones = normalizeStringList(body.deliveryZones);
    }
    if (Object.hasOwn(body, "pickupPoints")) {
      settings.pickupPoints = normalizeStringList(body.pickupPoints);
    }
    if (Object.hasOwn(body, "bannedTerms")) {
      settings.bannedTerms = normalizeStringList(body.bannedTerms).map((term) => term.toLowerCase());
    }
    settings.updatedAt = nowIso();
    db.audit_logs.unshift(createAuditLog(user.id, "platform_settings_updated", "platform_settings", settings.id));
    await writeDb(db);
    sendJson(response, 200, { settings: publicSettings(settings, true), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/security/password") {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const body = await readJson(request);
    if (!body.newPassword || body.newPassword.length < 8) {
      sendJson(response, 400, { error: "New password must be at least 8 characters." });
      return;
    }
    const target = db.users.find((candidate) => candidate.id === (body.userId || user.id));
    if (!target || target.role !== "admin") {
      sendJson(response, 404, { error: "Admin account not found." });
      return;
    }
    const currentAdmin = db.users.find((candidate) => candidate.id === user.id);
    if (target.id === user.id && !verifyPassword(body.currentPassword || "", currentAdmin.passwordHash)) {
      sendJson(response, 401, { error: "Current password is not correct." });
      return;
    }
    target.passwordHash = hashPassword(body.newPassword);
    db.sessions = db.sessions.filter((session) => session.userId !== target.id || target.id === user.id);
    db.audit_logs.unshift(createAuditLog(user.id, "admin_password_changed", "user", target.id));
    await writeDb(db);
    sendJson(response, 200, { ok: true, platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/admins") {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    if (!body.name?.trim() || !email || !body.password || body.password.length < 8) {
      sendJson(response, 400, { error: "Name, valid email, and password with 8+ characters are required." });
      return;
    }
    if (db.users.some((candidate) => candidate.email === email)) {
      sendJson(response, 409, { error: "That email is already registered." });
      return;
    }
    const adminUser = {
      id: createId("user"),
      name: body.name.trim(),
      email,
      role: "admin",
      passwordHash: hashPassword(body.password),
      status: "active",
      emailVerified: true,
      googleId: null,
      avatarUrl: "",
      authProvider: "password",
      phone: body.phone?.trim() || "",
      location: body.location?.trim() || "Dunkwa-on-Offin",
      profileCompleted: true,
      createdAt: nowIso(),
    };
    db.users.push(adminUser);
    db.audit_logs.unshift(createAuditLog(user.id, "admin_created", "user", adminUser.id));
    await writeDb(db);
    sendJson(response, 201, { user: sanitizeUser(adminUser), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/admins/") && url.pathname.endsWith("/remove")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const adminId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const account = db.users.find((candidate) => candidate.id === adminId);
    if (!account || account.role !== "admin") {
      sendJson(response, 404, { error: "Admin account not found." });
      return;
    }
    if (account.id === user.id) {
      sendJson(response, 400, { error: "You cannot remove your own admin role." });
      return;
    }
    if (db.users.filter((candidate) => candidate.role === "admin" && candidate.status !== "suspended").length <= 1) {
      sendJson(response, 400, { error: "Keep at least one active admin." });
      return;
    }
    account.role = "buyer";
    db.sessions = db.sessions.filter((session) => session.userId !== account.id);
    db.audit_logs.unshift(createAuditLog(user.id, "admin_removed", "user", account.id));
    await writeDb(db);
    sendJson(response, 200, { user: sanitizeUser(account), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/reviews/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , reviewId, action] = url.pathname.split("/");
    const review = db.reviews.find((candidate) => candidate.id === reviewId);
    if (!review || !["publish", "hide", "remove"].includes(action)) {
      sendJson(response, 404, { error: "Admin review action not found." });
      return;
    }
    review.status = action === "publish" ? "published" : action === "hide" ? "hidden" : "removed";
    db.audit_logs.unshift(createAuditLog(user.id, `review_${action}`, "review", review.id));
    await writeDb(db);
    sendJson(response, 200, { review: presentReview(db, review), publicReviews: publicReviews(db), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/adverts/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , advertId, action] = url.pathname.split("/");
    const advert = db.seller_adverts.find((candidate) => candidate.id === advertId);
    if (!advert || !["mark_paid", "approve", "reject", "pause"].includes(action)) {
      sendJson(response, 404, { error: "Admin advert action not found." });
      return;
    }
    const settings = platformSettings(db);
    if (action === "mark_paid") {
      advert.status = "pending_review";
    } else if (action === "approve") {
      advert.status = "active";
      advert.startsAt ||= nowIso();
      advert.endsAt = advertEndDate(settings.advertDurationDays);
    } else if (action === "reject") {
      advert.status = "rejected";
    } else if (action === "pause") {
      advert.status = "paused";
    }
    advert.updatedAt = nowIso();
    db.audit_logs.unshift(createAuditLog(user.id, `advert_${action}`, "seller_advert", advert.id));
    await writeDb(db);
    sendJson(response, 200, { advert: presentAdvert(db, advert), adverts: activeAdverts(db), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/listings/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , listingId, action] = url.pathname.split("/");
    const listing = db.listings.find((candidate) => candidate.id === listingId);
    if (!listing || !["approve", "reject"].includes(action)) {
      sendJson(response, 404, { error: "Admin listing action not found." });
      return;
    }
    const body = await readJson(request);
    listing.status = action === "approve" ? "active" : "rejected";
    listing.approved = action === "approve";
    listing.updatedAt = nowIso();
    db.audit_logs.unshift({
      id: createId("audit"),
      actorId: user.id,
      action: `listing_${action}`,
      targetType: "listing",
      targetId: listing.id,
      metadata: { note: body.note || "" },
      createdAt: nowIso(),
    });
    await writeDb(db);
    sendJson(response, 200, { listing: presentListing(db, listing, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/sellers/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , sellerId, action] = url.pathname.split("/");
    const seller = db.seller_profiles.find((candidate) => candidate.id === sellerId);
    if (!seller || !["approve", "reject", "suspend"].includes(action)) {
      sendJson(response, 404, { error: "Admin seller action not found." });
      return;
    }
    seller.verified = action === "approve";
    seller.kycStatus = action === "approve" ? "verified" : action;
    seller.payoutStatus = action === "approve" ? "ready" : seller.payoutStatus;
    seller.approvedAt = action === "approve" ? nowIso() : seller.approvedAt;
    if (action === "approve") {
      seller.trustBadges = [...new Set([...(seller.trustBadges || []), "Verified seller", "Local business"])];
    }
    db.audit_logs.unshift({
      id: createId("audit"),
      actorId: user.id,
      action: `seller_${action}`,
      targetType: "seller_profile",
      targetId: seller.id,
      metadata: {},
      createdAt: nowIso(),
    });
    await writeDb(db);
    sendJson(response, 200, { seller: presentSeller(db, seller, user), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/users/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , userId, action] = url.pathname.split("/");
    const account = db.users.find((candidate) => candidate.id === userId);
    if (!account || !["suspend", "activate"].includes(action)) {
      sendJson(response, 404, { error: "Admin user action not found." });
      return;
    }
    if (account.id === user.id && action === "suspend") {
      sendJson(response, 400, { error: "Admins cannot suspend their own active session." });
      return;
    }
    account.status = action === "activate" ? "active" : "suspended";
    if (account.status === "suspended") {
      db.sessions = db.sessions.filter((session) => session.userId !== account.id);
    }
    db.audit_logs.unshift(createAuditLog(user.id, `user_${action}`, "user", account.id));
    await writeDb(db);
    sendJson(response, 200, { user: sanitizeUser(account), platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/reports/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , reportId, action] = url.pathname.split("/");
    const report = db.reports.find((candidate) => candidate.id === reportId);
    if (!report || !["review", "resolve", "dismiss"].includes(action)) {
      sendJson(response, 404, { error: "Admin report action not found." });
      return;
    }
    report.status = action === "resolve" ? "resolved" : action === "dismiss" ? "dismissed" : "reviewing";
    db.audit_logs.unshift(createAuditLog(user.id, `report_${action}`, "report", report.id));
    await writeDb(db);
    sendJson(response, 200, { report, platform: buildPlatform(db, user) });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/disputes/")) {
    if (!user || user.role !== "admin") {
      sendJson(response, 403, { error: "Admin access required." });
      return;
    }
    const [, , , , disputeId, action] = url.pathname.split("/");
    const dispute = db.disputes.find((candidate) => candidate.id === disputeId);
    if (!dispute || !["resolve", "refund_requested", "close"].includes(action)) {
      sendJson(response, 404, { error: "Admin dispute action not found." });
      return;
    }
    dispute.status = action === "close" ? "closed" : action;
    db.audit_logs.unshift(createAuditLog(user.id, `dispute_${action}`, "dispute", dispute.id));
    await writeDb(db);
    sendJson(response, 200, { dispute, platform: buildPlatform(db, user) });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function presentListing(db, listing, viewer) {
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === listing.sellerProfileId);
  const category = db.categories.find((candidate) => candidate.id === listing.categoryId);
  const listingReviews = publicReviews(db, { listingId: listing.id }).slice(0, 3);
  return {
    id: listing.id,
    title: listing.title,
    type: listing.listingType === "service" ? "Services" : "Products",
    listingType: listing.listingType,
    price: formatPrice(listing.priceCents, listing.pricingUnit),
    priceCents: listing.priceCents,
    seller: sellerProfile?.shopName || "Community Seller",
    sellerProfileId: sellerProfile?.id || null,
    sellerInitials: sellerProfile?.initials || "CS",
    sellerType: sellerProfile?.category || category?.name || "Community",
    sellerFollowers: sellerProfile ? sellerFollowerCount(db, sellerProfile.id) : 0,
    isFollowingSeller: Boolean(viewer && sellerProfile && isFollowingSeller(db, viewer.id, sellerProfile.id)),
    distance: listing.distance,
    image: listing.primaryImage,
    verified: Boolean(sellerProfile?.verified && listing.approved),
    rating: computedListingRating(db, listing) || listing.rating,
    reviewCount: publicReviews(db, { listingId: listing.id }).length,
    reviews: listingReviews,
    status: listing.status,
    statusLabel: listing.status === "pending_review" ? "Pending review" : "Active",
    stock: listing.stock,
    lowStockThreshold: listing.lowStockThreshold ?? 2,
    lowStock: listing.listingType === "product" && Number(listing.stock) <= Number(listing.lowStockThreshold ?? 2),
    sku: listing.sku || "",
    variants: listing.variants || [],
    bookingSlots: listing.bookingSlots || [],
    deliveryFee: money(listing.deliveryFeeCents || 0),
    deliveryFeeCents: listing.deliveryFeeCents || 0,
    location: listing.location,
    deliveryOptions: listing.deliveryOptions || [],
    isOwner: Boolean(viewer && sellerProfile?.userId === viewer.id),
  };
}

function buildPlatform(db, user) {
  const allListings = db.listings.filter((listing) => listing.status !== "deleted");
  const activeListings = allListings.filter((listing) => listing.status === "active");
  const pendingListings = allListings.filter((listing) => listing.status === "pending_review");
  const activeOrders = db.orders.filter((order) => !["completed", "cancelled", "rejected"].includes(order.status));

  const platform = {
    stats: {
      users: db.users.length,
      sellers: db.seller_profiles.length,
      listings: allListings.length,
      pendingListings: pendingListings.length,
      activeOrders: activeOrders.length,
      paymentVolume: money(db.payment_intents.reduce((sum, payment) => sum + payment.amountCents, 0)),
      activeAdverts: activeAdverts(db).length,
      publicReviews: publicReviews(db).length,
      openReports: db.reports.filter((report) => report.status === "open").length,
      adminCount: db.users.filter((account) => account.role === "admin").length,
      verifiedSellers: db.seller_profiles.filter((seller) => seller.verified).length,
      lowStockListings: allListings.filter((listing) => listing.listingType === "product" && Number(listing.stock) <= Number(listing.lowStockThreshold ?? 2)).length,
      platformEarnings: money(db.payment_intents.reduce((sum, payment) => sum + Number(payment.platformFeeCents || 0), 0)),
    },
    settings: publicSettings(platformSettings(db)),
    integrations: buildIntegrations(db),
    adverts: activeAdverts(db),
    publicReviews: publicReviews(db),
    modules: [
      { name: "Users", status: "built", detail: "Roles, sessions, profiles, verification hooks" },
      { name: "Sellers", status: "built", detail: "Onboarding, KYC status, listing management" },
      { name: "Listings", status: "built", detail: "Approval workflow, inventory, delivery options" },
      { name: "Orders", status: "built", detail: "Product orders and service booking statuses" },
      { name: "Payments", status: "provider-needed", detail: "Intent, payout, fee, refund records ready" },
      { name: "MoMo payouts", status: "provider-ready", detail: "Seller MoMo account fields and payout destinations captured" },
      { name: "Seller adverts", status: "built", detail: "Admin-controlled advert fees, paid requests, and active placements" },
      { name: "Messaging", status: "built", detail: "Listing/order-linked threads" },
      { name: "Reviews", status: "built", detail: "Completed-order ratings and moderation status" },
      { name: "Trust", status: "built", detail: "Reports, disputes, banned-item policy hook" },
      { name: "Notifications", status: "built", detail: "In-app notification table and order triggers" },
      { name: "Cloud images", status: buildIntegrations(db).r2Configured ? "built" : "provider-ready", detail: "Cloudflare R2 upload path with local development fallback" },
      { name: "Support", status: "built", detail: "Support reports, disputes, policies, and admin handling" },
      { name: "PWA/SEO", status: "built", detail: "Manifest, app metadata, robots, and sitemap-ready public pages" },
      { name: "Infrastructure", status: "built", detail: "PostgreSQL migrations, production start, and host blueprint ready" },
    ],
    buyer: null,
    seller: null,
    admin: null,
  };

  if (user) {
    platform.buyer = {
      savedListings: userFavorites(db, user.id),
      cart: presentCart(db, user.id),
      orders: db.orders.filter((order) => order.buyerId === user.id).map((order) => presentOrder(db, order, user)),
      messages: db.messages.filter((message) => message.senderId === user.id || message.recipientId === user.id).slice(-6),
      reviews: db.reviews.filter((review) => review.reviewerId === user.id).map((review) => presentReview(db, review)),
      followingSellers: userFollowingSellers(db, user.id),
      notifications: db.notifications.filter((notification) => notification.userId === user.id).slice(-6),
    };
  }

  if (user && ["seller", "admin"].includes(user.role)) {
    const sellerProfile = db.seller_profiles.find((seller) => seller.userId === user.id);
    const sellerIds = user.role === "admin" ? db.seller_profiles.map((seller) => seller.id) : [sellerProfile?.id].filter(Boolean);
    platform.seller = {
      profile: sellerProfile ? presentSeller(db, sellerProfile, user) : null,
      listings: db.listings
        .filter((listing) => sellerIds.includes(listing.sellerProfileId) && listing.status !== "deleted")
        .map((listing) => presentListing(db, listing, user)),
      orders: db.orders
        .filter((order) => sellerIds.includes(order.sellerProfileId))
        .map((order) => presentOrder(db, order, user)),
      earnings: {
        pending: money(db.payouts.filter((payout) => sellerIds.includes(payout.sellerProfileId) && payout.status === "pending").reduce((sum, payout) => sum + payout.amountCents, 0)),
        paid: money(db.payouts.filter((payout) => sellerIds.includes(payout.sellerProfileId) && payout.status === "paid").reduce((sum, payout) => sum + payout.amountCents, 0)),
      },
      adverts: db.seller_adverts
        .filter((advert) => sellerIds.includes(advert.sellerProfileId))
        .map((advert) => presentAdvert(db, advert)),
      onboarding: {
        kycStatus: sellerProfile?.kycStatus || "not_started",
        payoutStatus: sellerProfile?.payoutStatus || "not_started",
      },
    };
  }

  if (user?.role === "admin") {
    platform.admin = {
      pendingListings: pendingListings.map((listing) => presentListing(db, listing, user)),
      pendingSellers: db.seller_profiles.filter((seller) => seller.kycStatus === "submitted").map((seller) => presentSeller(db, seller, user)),
      sellers: db.seller_profiles.map((seller) => presentSeller(db, seller, user)),
      users: db.users.map(sanitizeUser),
      orders: db.orders.map((order) => presentOrder(db, order, user)),
      reports: db.reports,
      disputes: db.disputes,
      auditLogs: db.audit_logs.slice(0, 12),
      payments: db.payment_intents,
      payouts: db.payouts,
      mediaAssets: db.media_assets,
      adverts: db.seller_adverts.map((advert) => presentAdvert(db, advert)),
      emailNotifications: db.email_notifications.slice(0, 25),
      reviews: db.reviews.map((review) => presentReview(db, review)),
      settings: publicSettings(platformSettings(db), true),
    };
  }

  return platform;
}

function presentSeller(db, seller, viewer = null) {
  return {
    id: seller.id,
    name: seller.shopName,
    type: seller.category,
    initials: seller.initials,
    tone: seller.tone || "green",
    verified: Boolean(seller.verified),
    kycStatus: seller.kycStatus || "not_started",
    payoutStatus: seller.payoutStatus || "not_started",
    momoNetwork: seller.momoNetwork || "",
    momoNumber: viewer?.role === "admin" ? seller.momoNumber || "" : maskPhone(seller.momoNumber),
    payoutAccountName: seller.payoutAccountName || "",
    followerCount: sellerFollowerCount(db, seller.id),
    isFollowing: Boolean(viewer && isFollowingSeller(db, viewer.id, seller.id)),
    bio: seller.bio || "",
    idDocumentUrl: seller.idDocumentUrl || "",
    businessDocumentUrl: seller.businessDocumentUrl || "",
    sellerAgreementAcceptedAt: seller.sellerAgreementAcceptedAt,
    serviceRadiusKm: seller.serviceRadiusKm || 10,
    trustBadges: seller.trustBadges || [],
  };
}

function presentOrder(db, order, viewer) {
  const listing = db.listings.find((candidate) => candidate.id === order.listingId);
  const seller = db.seller_profiles.find((candidate) => candidate.id === order.sellerProfileId);
  const buyer = db.users.find((candidate) => candidate.id === order.buyerId);
  return {
    id: order.id,
    listingId: order.listingId,
    listingTitle: listing?.title || "Listing",
    seller: seller?.shopName || "Seller",
    buyer: buyer?.name || "Buyer",
    orderType: order.orderType,
    status: order.status,
    quantity: order.quantity || 1,
    total: money(order.totalCents),
    totalCents: order.totalCents,
    deliveryMethod: order.deliveryMethod,
    delivery: {
      contactName: order.deliveryContactName || "",
      phone: order.deliveryPhone || "",
      town: order.deliveryTown || "Dunkwa-on-Offin",
      address: order.deliveryAddress || "",
      note: order.deliveryNote || "",
    },
    sellerOpenedAt: order.sellerOpenedAt,
    deliveryStatus: order.deliveryStatus || "new",
    deliveryStatusLabel: deliveryStatusLabel(order.deliveryStatus || "new"),
    scheduledFor: order.scheduledFor,
    paymentStatus: order.paymentStatus,
    canConfirmReceived: Boolean(viewer && (viewer.role === "admin" || order.buyerId === viewer.id) && !["completed", "cancelled", "rejected"].includes(order.status)),
    canRequestRefund: Boolean(viewer && (viewer.role === "admin" || order.buyerId === viewer.id) && !["cancelled", "rejected"].includes(order.status)),
    trackingEvents: db.order_events
      .filter((event) => event.orderId === order.id)
      .slice(-6)
      .map((event) => ({
        status: event.toStatus,
        note: event.note,
        createdAt: event.createdAt,
      })),
    canManage: Boolean(viewer && canManageOrder(db, order, viewer)),
  };
}

function emptyCart() {
  return {
    items: [],
    subtotal: money(0),
    subtotalCents: 0,
    count: 0,
    updatedAt: null,
  };
}

function presentCart(db, userId) {
  const cart = ensureCart(db, userId);
  const items = cart.items
    .map((item) => {
      const listing = db.listings.find((candidate) => candidate.id === item.listingId && candidate.status === "active");
      if (!listing) {
        return null;
      }

      const presented = presentListing(db, listing, { id: userId });
      const quantity = cartQuantity(item.quantity);
      const lineTotalCents = listing.priceCents * quantity;
      return {
        id: listing.id,
        listingId: listing.id,
        quantity,
        lineTotal: money(lineTotalCents),
        lineTotalCents,
        addedAt: item.addedAt,
        listing: presented,
      };
    })
    .filter(Boolean);
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);

  return {
    items,
    subtotal: money(subtotalCents),
    subtotalCents,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    updatedAt: cart.updatedAt,
  };
}

function ensureCart(db, userId) {
  db.carts ||= [];
  let cart = db.carts.find((candidate) => candidate.userId === userId);
  if (!cart) {
    cart = {
      id: createId("cart"),
      userId,
      items: [],
      updatedAt: nowIso(),
    };
    db.carts.push(cart);
  }
  cart.items ||= [];
  return cart;
}

function cartQuantity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(99, Math.max(1, Math.floor(parsed)));
}

function createOrderRecord(db, user, listing, { deliveryMethod, deliveryDetails = {}, scheduledFor = null, quantity = 1, note = "" }) {
  const cleanQuantity = listing.listingType === "product" ? cartQuantity(quantity) : 1;
  const timestamp = nowIso();
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === listing.sellerProfileId);
  const settings = platformSettings(db);
  const platformFeeCents = Math.round(listing.priceCents * cleanQuantity * (Number(settings.commissionRate || 10) / 100));
  const order = {
    id: createId("order"),
    buyerId: user.id,
    sellerProfileId: listing.sellerProfileId,
    listingId: listing.id,
    orderType: listing.listingType === "service" ? "service_booking" : "product_order",
    status: "pending",
    quantity: cleanQuantity,
    totalCents: listing.priceCents * cleanQuantity,
    deliveryMethod,
    deliveryContactName: deliveryDetails.contactName || user.name || "",
    deliveryPhone: deliveryDetails.phone || user.phone || "",
    deliveryTown: deliveryDetails.town || "Dunkwa-on-Offin",
    deliveryAddress: deliveryDetails.address || "",
    deliveryNote: deliveryDetails.note || "",
    sellerOpenedAt: null,
    deliveryStatus: "new",
    scheduledFor,
    paymentStatus: "unpaid",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.orders.unshift(order);
  db.order_events.push({
    id: createId("event"),
    orderId: order.id,
    actorId: user.id,
    fromStatus: null,
    toStatus: "pending",
    note,
    createdAt: timestamp,
  });
  db.payment_intents.push({
    id: createId("pay"),
    orderId: order.id,
    provider: process.env.PAYMENT_PROVIDER || "provider_not_configured",
    status: "created",
    amountCents: order.totalCents,
    platformFeeCents,
    sellerProfileId: sellerProfile?.id || listing.sellerProfileId,
    destinationType: "mobile_money",
    destinationLabel: sellerPayoutDestination(sellerProfile),
    createdAt: timestamp,
  });
  if (listing.listingType === "product" && Number.isFinite(Number(listing.stock))) {
    listing.stock = Math.max(0, Number(listing.stock) - cleanQuantity);
    listing.updatedAt = timestamp;
  }
  const sellerUser = sellerUserForProfile(db, listing.sellerProfileId);
  addNotification(db, sellerUser, "New order", `${user.name} requested ${listing.title}.`);
  queueOrderEmailNotification(db, sellerUser, user, listing, order);
  return order;
}

function completeOrderAndCreatePayout(db, order, actorId, note = "Order completed.") {
  const previousStatus = order.status;
  order.status = "completed";
  order.deliveryStatus = "delivered";
  order.paymentStatus = order.paymentStatus === "unpaid" ? "manual_settlement_pending" : order.paymentStatus;
  order.updatedAt = nowIso();

  if (previousStatus !== "completed") {
    db.order_events.push({
      id: createId("event"),
      orderId: order.id,
      actorId,
      fromStatus: previousStatus,
      toStatus: "completed",
      note,
      createdAt: nowIso(),
    });
  }

  const payment = db.payment_intents.find((candidate) => candidate.orderId === order.id);
  const payoutExists = db.payouts.some((payout) => payout.orderId === order.id);
  if (!payoutExists) {
    db.payouts.unshift({
      id: createId("payout"),
      orderId: order.id,
      sellerProfileId: order.sellerProfileId,
      status: "pending",
      amountCents: Math.max(0, Number(order.totalCents || 0) - Number(payment?.platformFeeCents || 0)),
      scheduledFor: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: nowIso(),
    });
  }
}

function publicListings(db, user) {
  return db.listings
    .filter((listing) => {
      if (listing.status === "active") {
        return true;
      }
      const sellerProfile = db.seller_profiles.find((seller) => seller.id === listing.sellerProfileId);
      return Boolean(user && (user.role === "admin" || sellerProfile?.userId === user.id));
    })
    .map((listing) => presentListing(db, listing, user));
}

function featuredSellers(db) {
  return db.seller_profiles
    .filter((seller) => seller.verified)
    .map((seller) => ({
      id: seller.id,
      name: seller.shopName,
      type: seller.category,
      initials: seller.initials,
      tone: seller.tone || "green",
      verified: seller.verified,
      bio: seller.bio || "",
      serviceRadiusKm: seller.serviceRadiusKm || 10,
      trustBadges: seller.trustBadges || [],
      followerCount: sellerFollowerCount(db, seller.id),
    }));
}

function userFavorites(db, userId) {
  return db.favorites.filter((favorite) => favorite.userId === userId).map((favorite) => favorite.listingId);
}

function userFollowingSellers(db, userId) {
  return db.seller_follows.filter((follow) => follow.userId === userId).map((follow) => follow.sellerProfileId);
}

function tableCounts(db) {
  return {
    users: db.users.length,
    seller_profiles: db.seller_profiles.length,
    listings: db.listings.length,
    categories: db.categories.length,
    carts: db.carts?.length || 0,
    orders: db.orders.length,
    order_events: db.order_events?.length || 0,
    payment_intents: db.payment_intents?.length || 0,
    payouts: db.payouts?.length || 0,
    messages: db.messages.length,
    message_threads: db.message_threads?.length || 0,
    reviews: db.reviews.length,
    reports: db.reports?.length || 0,
    disputes: db.disputes?.length || 0,
    notifications: db.notifications?.length || 0,
    media_assets: db.media_assets?.length || 0,
    verification_requests: db.verification_requests?.length || 0,
    seller_follows: db.seller_follows?.length || 0,
    seller_adverts: db.seller_adverts?.length || 0,
    email_notifications: db.email_notifications?.length || 0,
    platform_settings: db.platform_settings?.length || 0,
    favorites: db.favorites.length,
    listing_images: db.listing_images.length,
    audit_logs: db.audit_logs?.length || 0,
    sessions: db.sessions?.length || 0,
  };
}

function serviceQueue(db) {
  return db.listings
    .filter((listing) => listing.status === "active" && listing.listingType === "service")
    .slice(0, 3)
    .map((listing) => {
      const seller = db.seller_profiles.find((candidate) => candidate.id === listing.sellerProfileId);
      return {
        title: listing.title,
        seller: seller?.shopName || "ShopLink seller",
        price: `${money(listing.priceCents)}${listing.pricingUnit ? ` ${listing.pricingUnit}` : ""}`,
        status: listing.fulfillment || "Available",
      };
    });
}

function ensureSellerProfile(db, user, body) {
  let sellerProfile = db.seller_profiles.find((seller) => seller.userId === user.id);
  if (sellerProfile) {
    return sellerProfile;
  }

  sellerProfile = {
    id: createId("seller"),
    userId: user.id,
    shopName: body.shopName?.trim() || `${user.name}'s Shop`,
    category: body.category || "Community Seller",
    initials: initialsFor(body.shopName || user.name),
    tone: "green",
    verified: user.role === "admin",
    kycStatus: user.role === "admin" ? "verified" : "not_started",
    payoutStatus: user.role === "admin" ? "ready" : "not_started",
    momoNetwork: body.momoNetwork?.trim() || "",
    momoNumber: body.momoNumber?.trim() || "",
    payoutAccountName: body.payoutAccountName?.trim() || "",
    paystackRecipientCode: body.paystackRecipientCode?.trim() || "",
    paystackSubaccountCode: body.paystackSubaccountCode?.trim() || "",
    bio: "",
    idDocumentUrl: body.idDocumentUrl?.trim() || "",
    businessDocumentUrl: body.businessDocumentUrl?.trim() || "",
    sellerAgreementAcceptedAt: body.sellerAgreementAccepted ? nowIso() : null,
    serviceRadiusKm: clampInt(body.serviceRadiusKm, 1, 100, 10),
    trustBadges: user.role === "admin" ? ["Verified seller", "Local business"] : [],
    approvedAt: user.role === "admin" ? nowIso() : null,
    createdAt: nowIso(),
  };
  db.seller_profiles.push(sellerProfile);
  return sellerProfile;
}

function canManageListing(db, listing, user) {
  if (user.role === "admin") {
    return true;
  }
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === listing.sellerProfileId);
  return sellerProfile?.userId === user.id;
}

function canManageOrder(db, order, user) {
  if (user.role === "admin" || order.buyerId === user.id) {
    return true;
  }
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === order.sellerProfileId);
  return sellerProfile?.userId === user.id;
}

function canTransitionOrder(db, order, user, nextStatus) {
  if (user.role === "admin") {
    return true;
  }
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === order.sellerProfileId);
  const isSeller = sellerProfile?.userId === user.id;
  if (isSeller) {
    return ["accepted", "rejected", "completed", "cancelled"].includes(nextStatus);
  }
  if (order.buyerId === user.id) {
    return ["cancelled", "completed"].includes(nextStatus);
  }
  return false;
}

function sellerUserForProfile(db, sellerProfileId) {
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === sellerProfileId);
  return sellerProfile ? db.users.find((candidate) => candidate.id === sellerProfile.userId) : null;
}

function findOrCreateThread(db, buyerId, sellerProfileId, listingId, orderId) {
  let thread = db.message_threads.find(
    (candidate) =>
      candidate.buyerId === buyerId &&
      candidate.sellerProfileId === sellerProfileId &&
      candidate.listingId === listingId &&
      candidate.orderId === orderId,
  );
  if (!thread) {
    thread = {
      id: createId("thread"),
      buyerId,
      sellerProfileId,
      listingId,
      orderId,
      status: "open",
      updatedAt: nowIso(),
    };
    db.message_threads.push(thread);
  }
  return thread;
}

function ensureRuntimeDb(db) {
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
      updatedAt: nowIso(),
    },
  ];
  db.users ||= [];
  db.seller_profiles ||= [];
  db.orders ||= [];
  db.payment_intents ||= [];
  db.reviews ||= [];
  db.notifications ||= [];
  db.order_events ||= [];

  for (const user of db.users) {
    user.googleId ??= null;
    user.avatarUrl ??= "";
    user.authProvider ??= "password";
  }
  for (const seller of db.seller_profiles) {
    seller.momoNetwork ??= "";
    seller.momoNumber ??= "";
    seller.payoutAccountName ??= "";
    seller.paystackRecipientCode ??= "";
    seller.paystackSubaccountCode ??= "";
    seller.idDocumentUrl ??= "";
    seller.businessDocumentUrl ??= "";
    seller.sellerAgreementAcceptedAt ??= null;
    seller.serviceRadiusKm ??= 10;
    seller.trustBadges ??= [];
  }
  for (const listing of db.listings || []) {
    listing.sku ??= "";
    listing.lowStockThreshold ??= 2;
    listing.variants ??= [];
    listing.bookingSlots ??= [];
    listing.deliveryFeeCents ??= 0;
  }
  for (const media of db.media_assets || []) {
    media.storageProvider ??= "local";
    media.storageKey ??= "";
    media.originalName ??= "";
  }
  for (const order of db.orders) {
    order.deliveryContactName ??= "";
    order.deliveryPhone ??= "";
    order.deliveryTown ??= "Dunkwa-on-Offin";
    order.deliveryAddress ??= "";
    order.deliveryNote ??= "";
    order.sellerOpenedAt ??= null;
    order.deliveryStatus ??= order.sellerOpenedAt ? "opened" : "new";
  }
}

async function storeListingImage(db, file, extension) {
  const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
  const r2 = r2Config(db);

  if (r2.ready) {
    const storageKey = `listings/${fileName}`;
    await putR2Object(r2, storageKey, file.buffer, file.mimeType);
    return {
      url: `${r2.publicUrl.replace(/\/+$/, "")}/${storageKey}`,
      storageProvider: "cloudflare_r2",
      storageKey,
    };
  }

  await mkdir(uploadRoot, { recursive: true });
  await writeFile(join(uploadRoot, fileName), file.buffer);
  return {
    url: `/uploads/listings/${fileName}`,
    storageProvider: "local",
    storageKey: fileName,
  };
}

async function deleteStoredListingImages(db, listing) {
  const imageUrls = new Set(
    db.listing_images
      .filter((image) => image.listingId === listing.id)
      .map((image) => image.url),
  );
  if (listing.primaryImage) {
    imageUrls.add(listing.primaryImage);
  }

  const mediaAssets = db.media_assets.filter((media) => imageUrls.has(media.url));
  for (const media of mediaAssets) {
    try {
      if (media.storageProvider === "cloudflare_r2" && media.storageKey) {
        const r2 = r2Config(db);
        if (r2.credentialsReady) {
          await deleteR2Object(r2, media.storageKey);
        }
      } else if (media.url?.startsWith("/uploads/listings/")) {
        const filePath = normalize(join(rootDir, "public", media.url));
        if (filePath.startsWith(rootDir)) {
          await unlink(filePath).catch((error) => {
            if (error.code !== "ENOENT") {
              throw error;
            }
          });
        }
      }
      media.status = "deleted";
    } catch (error) {
      media.status = "delete_failed";
      media.error = error.message;
    }
  }

  db.listing_images = db.listing_images.filter((image) => image.listingId !== listing.id);
}

function r2Config(db) {
  const r2 = integrationConfig(db).r2;
  const credentialsReady = Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket);
  return {
    ...r2,
    credentialsReady,
    ready: Boolean(credentialsReady && r2.publicUrl),
    host: r2.accountId ? `${r2.accountId}.r2.cloudflarestorage.com` : "",
  };
}

async function putR2Object(r2, key, body, mimeType) {
  const request = signR2Request(r2, "PUT", key, body, {
    "content-type": mimeType,
  });
  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(502, `Cloudflare R2 upload failed (${response.status}). ${detail}`.trim());
  }
}

async function deleteR2Object(r2, key) {
  const request = signR2Request(r2, "DELETE", key, Buffer.alloc(0));
  const response = await fetch(request.url, {
    method: "DELETE",
    headers: request.headers,
  });
  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(502, `Cloudflare R2 delete failed (${response.status}). ${detail}`.trim());
  }
}

function signR2Request(r2, method, key, body, extraHeaders = {}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalUri = `/${encodeURIComponent(r2.bucket)}/${encodeR2Path(key)}`;
  const url = `https://${r2.host}${canonicalUri}`;
  const headers = {
    host: r2.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = r2SigningKey(r2.secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url,
    headers: {
      ...headers,
      Authorization: authorization,
    },
  };
}

function r2SigningKey(secret, dateStamp) {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update("auto").digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function encodeR2Path(value) {
  return String(value || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildIntegrations(db) {
  const integrations = integrationConfig(db);
  const r2 = r2Config(db);
  return {
    googleConfigured: Boolean(integrations.google.clientId && integrations.google.clientSecret),
    googleClientIdConfigured: Boolean(integrations.google.clientId),
    googleClientIdFormatValid: googleClientIdLooksValid(integrations.google.clientId),
    googleClientSecretConfigured: Boolean(integrations.google.clientSecret),
    googleRedirectUriConfigured: Boolean(googleRedirectUriFromConfig(integrations.google)),
    emailConfigured: emailConfigured(db),
    resendApiKeyConfigured: Boolean(integrations.email.apiKey),
    resendFromEmailConfigured: Boolean(integrations.email.fromEmail),
    paymentConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY || process.env.HUBTEL_CLIENT_ID),
    paymentProvider: process.env.PAYMENT_PROVIDER || "provider_not_configured",
    r2Configured: r2.ready,
    r2BucketConfigured: Boolean(r2.bucket),
    r2PublicUrlConfigured: Boolean(r2.publicUrl),
    storageProvider: r2.ready ? "cloudflare_r2" : "local",
  };
}

function platformSettings(db) {
  db.platform_settings ||= [];
  let settings = db.platform_settings.find((candidate) => candidate.id === "shoplink");
  if (!settings) {
    settings = {
      id: "shoplink",
      advertListingFeeCents: 2500,
      featuredAdvertFeeCents: 7500,
      advertDurationDays: 7,
      commissionRate: 10,
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "",
      publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
      resendApiKey: process.env.RESEND_API_KEY || "",
      resendFromEmail: process.env.RESEND_FROM_EMAIL || "",
      r2AccountId: process.env.R2_ACCOUNT_ID || "",
      r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      r2Bucket: process.env.R2_BUCKET || "",
      r2PublicUrl: process.env.R2_PUBLIC_URL || "",
      supportEmail: process.env.SUPPORT_EMAIL || "",
      deliveryZones: ["Dunkwa-on-Offin", "Jukwa", "Ayanfuri", "Diaso", "Twifo Praso"],
      pickupPoints: ["Dunkwa market", "Dunkwa station", "Seller shop pickup"],
      bannedTerms: [],
      updatedAt: nowIso(),
    };
    db.platform_settings.push(settings);
  }
  settings.googleClientId ??= process.env.GOOGLE_CLIENT_ID || "";
  settings.googleClientSecret ??= process.env.GOOGLE_CLIENT_SECRET || "";
  settings.googleRedirectUri ??= process.env.GOOGLE_REDIRECT_URI || "";
  settings.publicBaseUrl ??= process.env.PUBLIC_BASE_URL || "";
  settings.resendApiKey ??= process.env.RESEND_API_KEY || "";
  settings.resendFromEmail ??= process.env.RESEND_FROM_EMAIL || "";
  settings.r2AccountId ??= process.env.R2_ACCOUNT_ID || "";
  settings.r2AccessKeyId ??= process.env.R2_ACCESS_KEY_ID || "";
  settings.r2SecretAccessKey ??= process.env.R2_SECRET_ACCESS_KEY || "";
  settings.r2Bucket ??= process.env.R2_BUCKET || "";
  settings.r2PublicUrl ??= process.env.R2_PUBLIC_URL || "";
  settings.supportEmail ??= process.env.SUPPORT_EMAIL || "";
  if (!Array.isArray(settings.deliveryZones) || !settings.deliveryZones.length) {
    settings.deliveryZones = defaultDeliveryZones();
  }
  if (!Array.isArray(settings.pickupPoints) || !settings.pickupPoints.length) {
    settings.pickupPoints = defaultPickupPoints();
  }
  settings.bannedTerms ??= [];
  return settings;
}

function integrationConfig(db) {
  const settings = platformSettings(db);
  return {
    google: {
      clientId: settings.googleClientId || process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: settings.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || "",
      redirectUri: settings.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI || "",
      publicBaseUrl: settings.publicBaseUrl || process.env.PUBLIC_BASE_URL || process.env.APP_URL || "",
    },
    email: {
      apiKey: settings.resendApiKey || process.env.RESEND_API_KEY || "",
      fromEmail: settings.resendFromEmail || process.env.RESEND_FROM_EMAIL || "",
    },
    r2: {
      accountId: settings.r2AccountId || process.env.R2_ACCOUNT_ID || "",
      accessKeyId: settings.r2AccessKeyId || process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: settings.r2SecretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "",
      bucket: settings.r2Bucket || process.env.R2_BUCKET || "",
      publicUrl: settings.r2PublicUrl || process.env.R2_PUBLIC_URL || "",
    },
  };
}

function googleClientIdLooksValid(clientId = "") {
  return /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId.trim());
}

function googleRedirectUriFromConfig(google) {
  return google.redirectUri || (google.publicBaseUrl ? `${google.publicBaseUrl.replace(/\/+$/, "")}/api/auth/google/callback` : "");
}

function googleAuthErrorCode(error) {
  if (error === "access_denied") {
    return "google_cancelled";
  }
  if (error === "invalid_client") {
    return "google_invalid_client";
  }
  if (error === "redirect_uri_mismatch") {
    return "google_redirect_mismatch";
  }
  return "google_failed";
}

function updatePlainSetting(settings, body, key) {
  if (Object.hasOwn(body, key) && typeof body[key] === "string") {
    settings[key] = body[key].trim();
  }
}

function updateSecretSetting(settings, body, key) {
  if (!Object.hasOwn(body, key) || typeof body[key] !== "string") {
    return;
  }
  const value = body[key].trim();
  if (!value || value.includes("***")) {
    return;
  }
  settings[key] = value;
}

function publicSettings(settings, includeIntegrations = false) {
  const visibleSettings = {
    id: settings.id,
    advertListingFeeCents: settings.advertListingFeeCents,
    featuredAdvertFeeCents: settings.featuredAdvertFeeCents,
    advertDurationDays: settings.advertDurationDays,
    commissionRate: settings.commissionRate,
    supportEmail: settings.supportEmail || "",
    deliveryZones: settings.deliveryZones || [],
    pickupPoints: settings.pickupPoints || [],
    bannedTerms: settings.bannedTerms || [],
    updatedAt: settings.updatedAt,
  };

  if (!includeIntegrations) {
    return visibleSettings;
  }

  return {
    ...visibleSettings,
    googleClientId: settings.googleClientId || "",
    googleClientSecret: settings.googleClientSecret ? maskSecret(settings.googleClientSecret) : "",
    googleRedirectUri: settings.googleRedirectUri || "",
    publicBaseUrl: settings.publicBaseUrl || "",
    resendApiKey: settings.resendApiKey ? maskSecret(settings.resendApiKey) : "",
    resendFromEmail: settings.resendFromEmail || "",
    r2AccountId: settings.r2AccountId || "",
    r2AccessKeyId: settings.r2AccessKeyId ? maskSecret(settings.r2AccessKeyId) : "",
    r2SecretAccessKey: settings.r2SecretAccessKey ? maskSecret(settings.r2SecretAccessKey) : "",
    r2Bucket: settings.r2Bucket || "",
    r2PublicUrl: settings.r2PublicUrl || "",
  };
}

function activeAdverts(db) {
  const now = Date.now();
  return db.seller_adverts
    .filter((advert) => advert.status === "active" && (!advert.endsAt || new Date(advert.endsAt).getTime() > now))
    .slice(0, 8)
    .map((advert) => presentAdvert(db, advert));
}

function presentAdvert(db, advert) {
  const seller = db.seller_profiles.find((candidate) => candidate.id === advert.sellerProfileId);
  const listing = db.listings.find((candidate) => candidate.id === advert.listingId);
  return {
    id: advert.id,
    sellerProfileId: advert.sellerProfileId,
    listingId: advert.listingId,
    title: advert.title,
    body: advert.body || "",
    placement: advert.placement || "home_top",
    status: advert.status || "pending_payment",
    fee: money(advert.feeCents),
    feeCents: advert.feeCents || 0,
    seller: seller?.shopName || "ShopLink seller",
    sellerInitials: seller?.initials || "SL",
    listingTitle: listing?.title || "ShopLink offer",
    image: listing?.primaryImage || "/images/shoplink-placeholder.svg",
    startsAt: advert.startsAt,
    endsAt: advert.endsAt,
    createdAt: advert.createdAt,
  };
}

function publicReviews(db, filters = {}) {
  return db.reviews
    .filter((review) => review.status === "published")
    .filter((review) => !filters.listingId || review.listingId === filters.listingId)
    .filter((review) => !filters.sellerProfileId || review.sellerProfileId === filters.sellerProfileId)
    .slice(0, 30)
    .map((review) => presentReview(db, review));
}

function presentReview(db, review) {
  const listing = db.listings.find((candidate) => candidate.id === review.listingId);
  const seller = db.seller_profiles.find((candidate) => candidate.id === review.sellerProfileId);
  const reviewer = db.users.find((candidate) => candidate.id === review.reviewerId);
  return {
    id: review.id,
    orderId: review.orderId,
    listingId: review.listingId,
    listingTitle: listing?.title || "Listing",
    sellerProfileId: review.sellerProfileId,
    seller: seller?.shopName || "Seller",
    reviewer: reviewer?.name || "Buyer",
    reviewerInitials: initialsFor(reviewer?.name || "Buyer"),
    rating: review.rating,
    comment: review.comment || "",
    status: review.status || "published",
    createdAt: review.createdAt,
  };
}

function computedListingRating(db, listing) {
  const reviews = db.reviews.filter((review) => review.listingId === listing.id && review.status === "published");
  if (!reviews.length) {
    return null;
  }
  const average = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length;
  return average.toFixed(1);
}

function sellerFollowerCount(db, sellerProfileId) {
  return db.seller_follows.filter((follow) => follow.sellerProfileId === sellerProfileId).length;
}

function isFollowingSeller(db, userId, sellerProfileId) {
  return db.seller_follows.some((follow) => follow.userId === userId && follow.sellerProfileId === sellerProfileId);
}

function normalizeDeliveryDetails(body, user) {
  return {
    contactName: body.deliveryContactName?.trim() || body.contactName?.trim() || user.name || "",
    phone: body.deliveryPhone?.trim() || body.phone?.trim() || user.phone || "",
    town: body.deliveryTown?.trim() || body.town?.trim() || body.location?.trim() || "Dunkwa-on-Offin",
    address: body.deliveryAddress?.trim() || body.address?.trim() || "",
    note: body.deliveryNote?.trim() || body.note?.trim() || "",
  };
}

function canSellerManageOrder(db, order, user) {
  if (user.role === "admin") {
    return true;
  }
  const sellerProfile = db.seller_profiles.find((seller) => seller.id === order.sellerProfileId);
  return sellerProfile?.userId === user.id;
}

function deliveryStatusLabel(status) {
  return {
    new: "Order placed and waiting for seller",
    opened: "Seller opened the order",
    preparing: "Seller is preparing the item",
    ready_for_pickup: "Ready for pickup",
    out_for_delivery: "Delivery is in process",
    delivered: "Delivered to buyer",
  }[status] || "Order tracking updated";
}

function queueOrderEmailNotification(db, sellerUser, buyer, listing, order) {
  if (!sellerUser?.email) {
    return;
  }
  db.email_notifications.unshift({
    id: createId("email"),
    userId: sellerUser.id,
    orderId: order.id,
    toEmail: sellerUser.email,
    subject: `New ShopLink order: ${listing.title}`,
    status: emailConfigured(db) ? "queued" : "pending_provider_setup",
    provider: "resend",
    providerId: "",
    error: emailConfigured(db) ? "" : "Set RESEND_API_KEY and RESEND_FROM_EMAIL to send real email.",
    createdAt: nowIso(),
    sentAt: null,
  });
  db.audit_logs.unshift(createAuditLog(buyer.id, "seller_email_queued", "order", order.id, { to: sellerUser.email }));
}

function queueBuyerOrderEmailNotification(db, buyer, order, subject) {
  if (!buyer?.email) {
    return;
  }
  db.email_notifications.unshift({
    id: createId("email"),
    userId: buyer.id,
    orderId: order.id,
    toEmail: buyer.email,
    subject,
    status: emailConfigured(db) ? "queued" : "pending_provider_setup",
    provider: "resend",
    providerId: "",
    error: emailConfigured(db) ? "" : "Set RESEND_API_KEY and RESEND_FROM_EMAIL to send real email.",
    createdAt: nowIso(),
    sentAt: null,
  });
}

async function deliverQueuedEmails(db) {
  const emailSettings = integrationConfig(db).email;
  if (!emailConfigured(db)) {
    return;
  }
  const queued = db.email_notifications.filter((email) => email.status === "queued").slice(0, 5);
  for (const email of queued) {
    const order = db.orders.find((candidate) => candidate.id === email.orderId);
    const buyer = db.users.find((candidate) => candidate.id === order?.buyerId);
    const listing = db.listings.find((candidate) => candidate.id === order?.listingId);
    try {
      const isBuyerUpdate = email.userId && email.userId === buyer?.id && email.subject.toLowerCase().includes("order update");
      const text = isBuyerUpdate
        ? [
            `Your ShopLink order has been updated.`,
            `Listing: ${listing?.title || "ShopLink listing"}`,
            `Status: ${order?.status || "pending"}`,
            `Tracking: ${deliveryStatusLabel(order?.deliveryStatus || "new")}`,
            `Seller: ${db.seller_profiles.find((seller) => seller.id === order?.sellerProfileId)?.shopName || "ShopLink seller"}`,
          ].join("\n")
        : [
            `New ShopLink order from ${buyer?.name || "a buyer"}.`,
            `Listing: ${listing?.title || "ShopLink listing"}`,
            `Total: ${money(order?.totalCents || 0)}`,
            `Delivery: ${order?.deliveryAddress || order?.deliveryMethod || "Not provided"}`,
            `Phone: ${order?.deliveryPhone || "Not provided"}`,
          ].join("\n");
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${emailSettings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailSettings.fromEmail,
          to: [email.toEmail],
          subject: email.subject,
          text,
          html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`,
        }),
      });
      const payload = await resendResponse.json().catch(() => ({}));
      if (!resendResponse.ok) {
        throw new Error(payload.message || "Email provider rejected the message.");
      }
      email.status = "sent";
      email.providerId = payload.id || "";
      email.sentAt = nowIso();
      email.error = "";
    } catch (error) {
      email.status = "failed";
      email.error = error.message;
    }
  }
}

function emailConfigured(db) {
  const email = integrationConfig(db).email;
  return Boolean(email.apiKey && email.fromEmail);
}

function sellerPayoutDestination(sellerProfile) {
  if (!sellerProfile?.momoNumber) {
    return "Seller MoMo account not configured";
  }
  return `${sellerProfile.momoNetwork || "Mobile Money"} ending ${maskPhone(sellerProfile.momoNumber).slice(-4)}`;
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length <= 4) {
    return digits;
  }
  return `${digits.slice(0, 3)}***${digits.slice(-4)}`;
}

function maskSecret(secret) {
  const value = String(secret || "");
  if (!value) {
    return "";
  }
  if (value.length <= 10) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function centsFromGhs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.round(number * 100);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    return [...new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
  }
  return [];
}

function defaultDeliveryZones() {
  return ["Dunkwa-on-Offin", "Jukwa", "Ayanfuri", "Diaso", "Twifo Praso", "Kyebi", "Atuabo"];
}

function defaultPickupPoints() {
  return ["Dunkwa market", "Dunkwa station", "Seller shop pickup", "Dunkwa post office area"];
}

function advertEndDate(days) {
  return new Date(Date.now() + clampInt(days, 1, 365, 7) * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchGoogleUser(code, redirectUri, google) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || "Google token exchange failed.");
  }

  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  const userInfo = await userInfoResponse.json().catch(() => ({}));
  if (!userInfoResponse.ok || !userInfo.sub || !userInfo.email) {
    throw new Error("Google profile lookup failed.");
  }
  return userInfo;
}

function googleRedirectUri(request, db) {
  const google = integrationConfig(db).google;
  return google.redirectUri || `${requestOrigin(request, db)}/api/auth/google/callback`;
}

function requestOrigin(request, db) {
  const configured = integrationConfig(db).google.publicBaseUrl || process.env.PUBLIC_BASE_URL || process.env.APP_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const proto = request.headers["x-forwarded-proto"] || (isProduction() ? "https" : "http");
  const hostHeader = request.headers["x-forwarded-host"] || request.headers.host || `127.0.0.1:${port}`;
  return `${String(proto).split(",")[0]}://${String(hostHeader).split(",")[0]}`;
}

function oauthStateCookie(value, maxAge = 600) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `shoplink_oauth_state=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function sendRedirect(response, location, headers = {}) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadEnvFile() {
  const envPath = join(rootDir, ".env");
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function addNotification(db, user, title, body) {
  if (!user) {
    return;
  }
  db.notifications.unshift({
    id: createId("notification"),
    userId: user.id,
    type: "marketplace",
    title,
    body,
    readAt: null,
    createdAt: nowIso(),
  });
}

function createAuditLog(actorId, action, targetType, targetId, metadata = {}) {
  return {
    id: createId("audit"),
    actorId,
    action,
    targetType,
    targetId,
    metadata,
    createdAt: nowIso(),
  };
}

function createSession(db, userId, request) {
  const token = createSecureToken();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
  db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now() && !session.revokedAt);
  db.sessions.push({
    tokenHash: hashOpaqueToken(token),
    userId,
    createdAt,
    expiresAt,
    lastSeenAt: createdAt,
    ipHash: hashRequestValue(clientIp(request)),
    userAgentHash: hashRequestValue(request.headers["user-agent"] || ""),
    revokedAt: null,
  });
  return token;
}

function getSession(request, db) {
  const token = readCookie(request, sessionCookie);
  if (!token) {
    return null;
  }
  const tokenHash = hashOpaqueToken(token);
  const session = db.sessions.find((candidate) => candidate.tokenHash === tokenHash || candidate.token === token);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  const account = db.users.find((candidate) => candidate.id === session.userId);
  if (!account || account.status === "suspended") {
    return null;
  }
  return session;
}

function sendAuthCookie(response, token) {
  response.setHeader("Set-Cookie", authCookieHeader(token));
}

function authCookieHeader(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDays * 24 * 60 * 60}${secure}`;
}

function clearAuthCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function readMultipartFiles(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    throw new HttpError(400, "Multipart boundary is missing.");
  }

  const body = await readRequestBuffer(request, maxMultipartBytes);
  const raw = body.toString("binary");
  const parts = raw.split(`--${boundary}`);
  const files = [];

  for (const rawPart of parts) {
    if (!rawPart || rawPart === "--\r\n" || rawPart === "--") {
      continue;
    }

    const part = rawPart.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      continue;
    }

    const headerText = part.slice(0, headerEnd);
    const bodyText = part.slice(headerEnd + 4).replace(/\r\n--$/, "");
    const headers = parseMultipartHeaders(headerText);
    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    if (!disposition.filename) {
      continue;
    }

    files.push({
      fieldName: disposition.name,
      fileName: disposition.filename,
      mimeType: (headers["content-type"] || "").toLowerCase(),
      buffer: Buffer.from(bodyText, "binary"),
    });
  }

  return files;
}

async function readRequestBuffer(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new HttpError(413, "Upload is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipartHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawValue.length) {
      continue;
    }
    result[rawKey.toLowerCase()] = rawValue.join("=").replace(/^"|"$/g, "");
  }
  return result;
}

function isValidImageSignature(buffer, mimeType) {
  if (mimeType === "image/png") {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

async function serveStatic(response, pathname) {
  const publicPath = pathname === "/" ? "/index.html" : pathname;
  const distFile = normalize(join(rootDir, "dist", publicPath));
  const publicFile = normalize(join(rootDir, "public", publicPath));
  const target = (await fileExists(distFile)) ? distFile : publicFile;

  if (!target.startsWith(rootDir) || !(await fileExists(target))) {
    const fallback = join(rootDir, "dist", "index.html");
    if (await fileExists(fallback)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(fallback).pipe(response);
      return;
    }
    sendJson(response, 404, { error: "Static file not found. Run npm run build first." });
    return;
  }

  response.writeHead(200, { "Content-Type": mimeFor(target) });
  createReadStream(target).pipe(response);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mimeFor(path) {
  const ext = extname(path).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  }[ext] || "application/octet-stream";
}

function isAuthMutation(request, url) {
  return request.method === "POST" && url.pathname.startsWith("/api/auth/");
}

function isRateLimited(request) {
  const key = `${clientIp(request)}:${request.url}`;
  const now = Date.now();
  const bucket = authAttempts.get(key) || [];
  const recentAttempts = bucket.filter((timestamp) => now - timestamp < authWindowMs);
  recentAttempts.push(now);
  authAttempts.set(key, recentAttempts);
  return recentAttempts.length > authMaxAttempts;
}

function createSecureToken() {
  return randomBytes(32).toString("base64url");
}

function hashOpaqueToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function hashRequestValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress || "local";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function normalizeEmail(email) {
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : "";
}

function isSafeImageUrl(url) {
  if (typeof url !== "string") {
    return false;
  }
  if (url.startsWith("/images/") || url.startsWith("/uploads/listings/")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status || "active",
    emailVerified: Boolean(user.emailVerified),
    avatarUrl: user.avatarUrl || "",
    authProvider: user.authProvider || "password",
    phone: user.phone || "",
    location: user.location || "",
  };
}

function money(cents) {
  return `GH₵${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatPrice(priceCents, unit) {
  const amount = priceCents / 100;
  const formatted = amount.toFixed(2);
  const cleanUnit = String(unit || "").trim();
  return `GH₵${formatted}${cleanUnit ? `${cleanUnit.startsWith("/") ? "" : " "}${cleanUnit}` : ""}`;
}

function normalizeDeliveryOptions(options, fallback) {
  if (Array.isArray(options)) {
    const cleanOptions = options.map((option) => String(option).trim()).filter(Boolean);
    if (cleanOptions.length) {
      return [...new Set(cleanOptions)].slice(0, 6);
    }
  }
  const selected = String(fallback || "Pickup only");
  if (selected === "Delivery available") {
    return ["Pickup", "Seller delivery"];
  }
  if (selected === "Buyer chooses") {
    return ["Pickup", "Seller delivery", "Delivery partner later"];
  }
  return ["Pickup"];
}

function initialsFor(name) {
  return (name || "Community Seller")
    .split(/\s+/)
    .filter((part) => /^[a-z]/i.test(part))
    .map((part) => part[0].toUpperCase())
    .join("")
    .slice(0, 2);
}

function nowIso() {
  return new Date().toISOString();
}
