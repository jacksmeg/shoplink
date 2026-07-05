async function apiRequest(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    headers: isFormData
      ? { ...options.headers }
      : {
          "Content-Type": "application/json",
          ...options.headers,
        },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "ShopLink request failed.");
  }
  return payload;
}

export function loadBootstrap({ signal } = {}) {
  return apiRequest("/api/bootstrap", { method: "GET", signal });
}

export function login(credentials) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function registerAccount(account) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(account),
  });
}

export function logout() {
  return apiRequest("/api/auth/logout", { method: "POST" });
}

export function createListing(listing) {
  return apiRequest("/api/listings", {
    method: "POST",
    body: JSON.stringify(listing),
  });
}

export function uploadListingImages(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }
  return apiRequest("/api/uploads/listing-images", {
    method: "POST",
    body: formData,
  });
}

export function toggleFavorite(listingId) {
  return apiRequest(`/api/favorites/${encodeURIComponent(listingId)}`, {
    method: "POST",
  });
}

export function toggleSellerFollow(sellerId) {
  return apiRequest(`/api/sellers/${encodeURIComponent(sellerId)}/follow`, {
    method: "POST",
  });
}

export function loadCart() {
  return apiRequest("/api/cart", { method: "GET" });
}

export function addCartItem(listingId, quantity = 1) {
  return apiRequest("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ listingId, quantity }),
  });
}

export function updateCartItem(listingId, quantity) {
  return apiRequest(`/api/cart/items/${encodeURIComponent(listingId)}`, {
    method: "POST",
    body: JSON.stringify({ quantity }),
  });
}

export function removeCartItem(listingId) {
  return apiRequest(`/api/cart/items/${encodeURIComponent(listingId)}`, {
    method: "DELETE",
  });
}

export function checkoutCart(checkout = {}) {
  return apiRequest("/api/cart/checkout", {
    method: "POST",
    body: JSON.stringify(checkout),
  });
}

export function updateProfile(profile) {
  return apiRequest("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(profile),
  });
}

export function submitSellerOnboarding(onboarding) {
  return apiRequest("/api/seller/onboarding", {
    method: "POST",
    body: JSON.stringify(onboarding),
  });
}

export function updateListing(listingId, listing) {
  return apiRequest(`/api/listings/${encodeURIComponent(listingId)}`, {
    method: "PATCH",
    body: JSON.stringify(listing),
  });
}

export function deleteListing(listingId) {
  return apiRequest(`/api/listings/${encodeURIComponent(listingId)}`, {
    method: "DELETE",
  });
}

export function createOrder(order) {
  return apiRequest("/api/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function updateOrderStatus(orderId, status) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function openOrder(orderId) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}/open`, {
    method: "POST",
  });
}

export function updateDeliveryStatus(orderId, deliveryStatus) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}/delivery-status`, {
    method: "POST",
    body: JSON.stringify({ deliveryStatus }),
  });
}

export function sendMessage(message) {
  return apiRequest("/api/messages", {
    method: "POST",
    body: JSON.stringify(message),
  });
}

export function createReview(review) {
  return apiRequest("/api/reviews", {
    method: "POST",
    body: JSON.stringify(review),
  });
}

export function createReport(report) {
  return apiRequest("/api/reports", {
    method: "POST",
    body: JSON.stringify(report),
  });
}

export function createMediaAsset(media) {
  return apiRequest("/api/media-assets", {
    method: "POST",
    body: JSON.stringify(media),
  });
}

export function createAdvert(advert) {
  return apiRequest("/api/adverts", {
    method: "POST",
    body: JSON.stringify(advert),
  });
}

export function decideListing(listingId, action) {
  return apiRequest(`/api/admin/listings/${encodeURIComponent(listingId)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note: `${action} from admin workspace` }),
  });
}

export function decideSeller(sellerId, action) {
  return apiRequest(`/api/admin/sellers/${encodeURIComponent(sellerId)}/${action}`, {
    method: "POST",
  });
}

export function decideAdvert(advertId, action) {
  return apiRequest(`/api/admin/adverts/${encodeURIComponent(advertId)}/${action}`, {
    method: "POST",
  });
}

export function updateAdminSettings(settings) {
  return apiRequest("/api/admin/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export function decideUser(userId, action) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/${action}`, {
    method: "POST",
  });
}

export function decideReport(reportId, action) {
  return apiRequest(`/api/admin/reports/${encodeURIComponent(reportId)}/${action}`, {
    method: "POST",
  });
}

export function decideDispute(disputeId, action) {
  return apiRequest(`/api/admin/disputes/${encodeURIComponent(disputeId)}/${action}`, {
    method: "POST",
  });
}

export function requestPasswordReset(email) {
  return apiRequest("/api/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function completePasswordReset(token, password) {
  return apiRequest("/api/auth/password-reset/complete", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function requestEmailVerification() {
  return apiRequest("/api/auth/request-verification", {
    method: "POST",
  });
}

export function confirmEmailVerification(token) {
  return apiRequest("/api/auth/confirm-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}
