const baseUrl = process.env.SHOPLINK_BASE_URL || "http://127.0.0.1:8787";

let cookie = "";

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${payload.error || "request failed"}`);
  }
  return payload;
}

function post(path, body = {}) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function login(email, password) {
  return post("/api/auth/login", { email, password });
}

await login("buyer@shoplink.local", "BuyerPass123");
const bootstrap = await request("/api/bootstrap");
const listing =
  bootstrap.listings.find((item) => item.id === "listing_tomatoes") ||
  bootstrap.listings.find((item) => item.status === "active");

if (!listing) {
  throw new Error("No active listing available for smoke test.");
}

const order = await post("/api/orders", {
  listingId: listing.id,
  deliveryMethod: "Pickup",
  deliveryContactName: "QA Buyer",
  deliveryPhone: "0241234567",
  deliveryTown: "Dunkwa-on-Offin",
  deliveryAddress: "QA address near Dunkwa market",
  scheduledFor: "2026-07-06T10:00:00.000Z",
});

const follow = await post(`/api/sellers/${listing.sellerProfileId}/follow`);

const cartItem = await post("/api/cart/items", {
  listingId: listing.id,
  quantity: 1,
});

const cartCheckout = await post("/api/cart/checkout", {
  deliveryMethod: "Seller delivery",
  deliveryContactName: "QA Buyer",
  deliveryPhone: "0241234567",
  deliveryTown: "Dunkwa-on-Offin",
  deliveryAddress: "QA delivery address",
});

await post("/api/messages", {
  listingId: listing.id,
  orderId: order.order.id,
  body: "QA buyer message for seller.",
});

const report = await post("/api/reports", {
  targetType: "listing",
  targetId: listing.id,
  reason: "QA trust and safety report.",
});

await login("seller@shoplink.local", "SellerPass123");
const opened = await post(`/api/orders/${order.order.id}/open`);
const delivery = await post(`/api/orders/${order.order.id}/delivery-status`, { deliveryStatus: "out_for_delivery" });
const accepted = await post(`/api/orders/${order.order.id}`, { status: "accepted" });

await post("/api/seller/onboarding", {
  shopName: "Offin Valley Farm",
  category: "Farm & Produce",
  bio: "QA onboarding update.",
  momoNetwork: "MTN Mobile Money",
  momoNumber: "0241234567",
  payoutAccountName: "QA Seller",
});

const sellerListing = await post("/api/listings", {
  title: `QA listing ${Date.now()}`,
  listingType: "product",
  category: "Home & Living",
  price: "19",
  stock: "3",
  location: "Dunkwa-on-Offin",
  description: "QA listing for admin approval.",
  fulfillment: "Pickup only",
  visibility: "Public",
  primaryImage: "/images/chair.png",
});

const advert = await post("/api/adverts", {
  listingId: sellerListing.listing.id,
  placement: "home_top",
  title: "QA promoted listing",
  body: "QA advert body",
});

await login("buyer@shoplink.local", "BuyerPass123");
const completed = await post(`/api/orders/${order.order.id}`, { status: "completed" });
const review = await post("/api/reviews", {
  orderId: order.order.id,
  rating: 5,
  comment: "QA completed order review.",
});

await login("admin@shoplink.local", "AdminPass123");
await post("/api/admin/settings", {
  advertListingFee: "30",
  featuredAdvertFee: "80",
  advertDurationDays: "10",
  commissionRate: "9",
});
await post(`/api/admin/adverts/${advert.advert.id}/mark_paid`);
const approvedAdvert = await post(`/api/admin/adverts/${advert.advert.id}/approve`);
const approved = await post(`/api/admin/listings/${sellerListing.listing.id}/approve`, {
  note: "QA approval",
});
const platform = await request("/api/platform");

console.log(
  JSON.stringify(
    {
      buyerOrder: order.order.status,
      followedSeller: follow.following,
      cartItemsAfterAdd: cartItem.cart.count,
      cartCheckoutOrders: cartCheckout.orders.length,
      sellerOpenedAt: Boolean(opened.order.sellerOpenedAt),
      deliveryStatus: delivery.order.deliveryStatus,
      sellerOrder: accepted.order.status,
      completedOrder: completed.order.status,
      reviewRating: review.review.rating,
      approvedAdvert: approvedAdvert.advert.status,
      reportStatus: report.report.status,
      approvedListing: approved.listing.status,
      platformUsers: platform.platform.stats.users,
      platformReports: platform.platform.stats.openReports,
    },
    null,
    2,
  ),
);
