import {
  BarChart3,
  BadgeCheck,
  Bell,
  Box,
  BriefcaseBusiness,
  CalendarClock,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Eye,
  Flag,
  FileText,
  Grid3X3,
  Heart,
  Home,
  ImagePlus,
  LogIn,
  LogOut,
  MapPinned,
  MapPin,
  Megaphone,
  MessageSquareText,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Trash2,
  Truck,
  Upload,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  addCartItem,
  checkoutCart,
  createListing,
  createMediaAsset,
  createAdvert,
  createOrder,
  createReport,
  createReview,
  decideDispute,
  decideListing,
  decideAdvert,
  decideReport,
  decideSeller,
  decideUser,
  deleteListing,
  loadBootstrap,
  login,
  logout,
  openOrder,
  registerAccount,
  removeCartItem,
  requestEmailVerification,
  requestPasswordReset,
  sendMessage,
  submitSellerOnboarding,
  toggleFavorite,
  toggleSellerFollow,
  updateCartItem,
  updateAdminSettings,
  updateDeliveryStatus,
  updateListing,
  updateOrderStatus,
  uploadListingImages,
} from "./api";

const marketLocation = "Dunkwa-on-Offin, Ghana";

const initialDraft = {
  title: "",
  category: "Farm & Produce",
  price: "",
  stock: "1",
  location: marketLocation,
  images: [],
  description: "",
  fulfillment: "Pickup or delivery",
  visibility: "Public",
};

const initialAuthDraft = {
  name: "",
  email: "",
  password: "",
  role: "buyer",
  shopName: "",
};

const initialCheckoutDraft = {
  deliveryContactName: "",
  deliveryPhone: "",
  deliveryTown: "Dunkwa-on-Offin",
  deliveryAddress: "",
  deliveryNote: "",
  deliveryMethod: "Seller delivery",
};

const emptyCart = {
  items: [],
  subtotal: "GH₵0.00",
  subtotalCents: 0,
  count: 0,
};

const navItems = [
  { id: "Home", icon: Home },
  { id: "Discover", icon: Search },
  { id: "Categories", icon: Grid3X3 },
  { id: "Messages", icon: MessageSquareText },
  { id: "Saved", icon: Heart },
  { id: "My listings", icon: Package },
  { id: "Orders", icon: ClipboardList },
  { id: "Cart", icon: ShoppingCart },
  { id: "Payments", icon: CreditCard },
  { id: "Reviews", icon: Star },
  { id: "Notifications", icon: Bell },
  { id: "Community", icon: Users },
  { id: "Policies", icon: FileText },
  { id: "Admin", icon: Settings, adminOnly: true },
  { id: "Reports", icon: BarChart3, adminOnly: true },
];

const adminPages = new Set(["Admin", "Reports"]);

function visibleNavItemsFor(user) {
  const isAdmin = user?.role === "admin";
  return navItems.filter((item) => !item.adminOnly || isAdmin);
}

const categoryTabs = [
  { label: "All", icon: Grid3X3, tone: "blue" },
  { label: "For sale", icon: Store, tone: "green" },
  { label: "Home & Garden", icon: Home, tone: "yellow" },
  { label: "Electronics", icon: Package, tone: "blue" },
  { label: "Vehicles", icon: Car, tone: "red" },
  { label: "Fashion", icon: Shirt, tone: "violet" },
  { label: "Services", icon: Wrench, tone: "violet" },
  { label: "Jobs", icon: BriefcaseBusiness, tone: "sea" },
  { label: "Community", icon: Users, tone: "pink" },
];

const discoveryChips = ["Nearby", "Under GH₵100", "Top rated", "Fast delivery", "Verified sellers"];

function App() {
  const [activePage, setActivePage] = useState("Home");
  const [activeCategory, setActiveCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(() => new Set());
  const [cart, setCart] = useState(emptyCart);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [listingType, setListingType] = useState("Product");
  const [draft, setDraft] = useState(initialDraft);
  const [authDraft, setAuthDraft] = useState(initialAuthDraft);
  const [authMode, setAuthMode] = useState("login");
  const [marketListings, setMarketListings] = useState([]);
  const [formCategories, setFormCategories] = useState([]);
  const [featuredSellers, setFeaturedSellers] = useState([]);
  const [serviceQueue, setServiceQueue] = useState([]);
  const [adverts, setAdverts] = useState([]);
  const [publicReviews, setPublicReviews] = useState([]);
  const [followingSellers, setFollowingSellers] = useState(() => new Set());
  const [integrations, setIntegrations] = useState({});
  const [checkoutDraft, setCheckoutDraft] = useState(initialCheckoutDraft);
  const [schema, setSchema] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  const visibleListings = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    return marketListings.filter((listing) => {
      const matchesCategory = categoryMatches(listing, activeCategory);
      const searchable = `${listing.title} ${listing.seller} ${listing.sellerType} ${listing.location}`.toLowerCase();
      return matchesCategory && (!cleanQuery || searchable.includes(cleanQuery));
    });
  }, [activeCategory, marketListings, query]);

  const activeListings = useMemo(
    () => marketListings.filter((listing) => listing.status === "active"),
    [marketListings],
  );

  const savedListings = useMemo(
    () => marketListings.filter((listing) => saved.has(listing.id)),
    [marketListings, saved],
  );

  const unreadNotifications = platform?.buyer?.notifications?.filter((item) => !item.readAt).length || 0;
  const messageCount = platform?.buyer?.messages?.length || 0;
  const reportCount = platform?.stats?.openReports || 0;
  const isAdmin = user?.role === "admin";
  const visibleNavItems = useMemo(() => visibleNavItemsFor(user), [user]);

  useEffect(() => {
    if (!isAdmin && adminPages.has(activePage)) {
      setActivePage("Home");
    }
  }, [activePage, isAdmin]);

  function applyBootstrap(payload) {
    setUser(payload.user);
    setMarketListings(payload.listings || []);
    setFormCategories(payload.categories || []);
    setFeaturedSellers(payload.featuredSellers || []);
    setServiceQueue(payload.serviceQueue || []);
    setAdverts(payload.adverts || payload.platform?.adverts || []);
    setPublicReviews(payload.publicReviews || payload.platform?.publicReviews || []);
    setIntegrations(payload.integrations || payload.platform?.integrations || {});
    setSchema(payload.schema);
    setPlatform(payload.platform);
    setCart(payload.cart || payload.platform?.buyer?.cart || emptyCart);
    setSaved(new Set(payload.favorites || []));
    setFollowingSellers(new Set(payload.followingSellers || payload.platform?.buyer?.followingSellers || []));
    setError("");
  }

  async function refreshData() {
    const payload = await loadBootstrap();
    applyBootstrap(payload);
    return payload;
  }

  useEffect(() => {
    const controller = new AbortController();

    const authNotice = new URLSearchParams(window.location.search).get("auth");
    if (authNotice) {
      const authMessages = {
        google_not_configured: "Google login is ready, but the production Google client keys still need to be added.",
        google_bad_client_id: "Google login is blocked because the client ID format is not valid. Paste the exact client ID from Google Cloud.",
        google_invalid_client: "Google rejected this OAuth client. Recreate or copy the exact web client in Google Cloud, then save it in Admin settings.",
        google_redirect_mismatch: "Google rejected the redirect URL. Add the ShopLink callback URL to the Google OAuth client.",
        google_cancelled: "Google sign-in was cancelled.",
        google_failed: "Google sign-in could not be completed.",
        google_signed_in: "Signed in with Google.",
        suspended: "This account is suspended. Contact ShopLink support.",
      };
      setNotice(authMessages[authNotice] || "");
      window.history.replaceState({}, "", window.location.pathname);
    }

    loadBootstrap({ signal: controller.signal })
      .then(applyBootstrap)
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
        }
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("drawer-open", isDrawerOpen || isAuthOpen || Boolean(selectedListing));
    return () => document.body.classList.remove("drawer-open");
  }, [isAuthOpen, isDrawerOpen, selectedListing]);

  function openLogin(message = "Log in to continue.") {
    setAuthMode("login");
    setIsAuthOpen(true);
    setNotice(message);
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateAuthDraft(field, value) {
    setAuthDraft((current) => ({ ...current, [field]: value }));
  }

  function handlePostListing() {
    if (!user) {
      openLogin("Log in as a seller to post a listing.");
      return;
    }

    if (!["seller", "admin"].includes(user.role)) {
      setNotice("Create or use a seller account before posting listings.");
      return;
    }

    setDraft((current) => ({ ...current, location: current.location || marketLocation }));
    setIsDrawerOpen(true);
  }

  async function handleToggleSaved(id) {
    if (!user) {
      openLogin("Log in to save listings.");
      return;
    }

    setSaved((current) => optimisticToggle(current, id));

    try {
      const payload = await toggleFavorite(id);
      setSaved(new Set(payload.favorites));
      setError("");
    } catch (requestError) {
      setSaved((current) => optimisticToggle(current, id));
      setError(requestError.message);
    }
  }

  async function handleToggleSellerFollow(sellerId) {
    if (!user) {
      openLogin("Log in to follow sellers.");
      return;
    }

    setFollowingSellers((current) => optimisticToggle(current, sellerId));
    try {
      const payload = await toggleSellerFollow(sellerId);
      setFollowingSellers(new Set(payload.followingSellers || []));
      if (payload.platform) {
        setPlatform(payload.platform);
      }
      setNotice(payload.following ? "Seller followed." : "Seller unfollowed.");
      setError("");
    } catch (requestError) {
      setFollowingSellers((current) => optimisticToggle(current, sellerId));
      setError(requestError.message);
    }
  }

  async function handleAddToCart(listing, quantity = 1) {
    if (!user) {
      openLogin("Log in to add items to cart.");
      return;
    }

    if (listing.listingType === "service") {
      await runWorkspaceAction(
        () =>
          createOrder({
            listingId: listing.id,
            deliveryMethod: "Booking request",
            ...checkoutDraft,
            scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
          }),
        `${listing.title} booking request sent.`,
      );
      setActivePage("Orders");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await addCartItem(listing.id, quantity);
      setCart(payload.cart);
      setNotice(`${listing.title} added to cart.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCartQuantity(listingId, quantity) {
    setIsSubmitting(true);
    try {
      const payload = await updateCartItem(listingId, quantity);
      setCart(payload.cart);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveCartItem(listingId) {
    setIsSubmitting(true);
    try {
      const payload = await removeCartItem(listingId);
      setCart(payload.cart);
      setNotice("Cart updated.");
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCheckoutCart() {
    if (!user) {
      openLogin("Log in to checkout.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await checkoutCart({
        ...checkoutDraft,
        deliveryMethod: checkoutDraft.deliveryMethod || `Seller delivery in ${marketLocation}`,
      });
      setCart(payload.cart);
      await refreshData();
      setActivePage("Orders");
      setNotice(`${payload.orders.length} order${payload.orders.length === 1 ? "" : "s"} created from cart.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePhotoUpload(files) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) {
      return;
    }

    setIsUploadingImages(true);
    try {
      const payload = await uploadListingImages(selectedFiles);
      setDraft((current) => ({
        ...current,
        images: [...(current.images || []), ...payload.media].slice(0, 10),
      }));
      setNotice(`${payload.media.length} image${payload.media.length === 1 ? "" : "s"} uploaded.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsUploadingImages(false);
    }
  }

  async function publishListing(event) {
    event.preventDefault();
    const trimmedTitle = draft.title.trim();

    if (!trimmedTitle || !draft.price.trim()) {
      setNotice("Add a title and price before publishing.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = await createListing({
        title: trimmedTitle,
        listingType: listingType === "Product" ? "product" : "service",
        category: draft.category,
        price: draft.price,
        stock: draft.stock,
        location: draft.location || marketLocation,
        description: draft.description,
        fulfillment: draft.fulfillment,
        deliveryOptions: deliveryOptionsFor(draft.fulfillment),
        visibility: draft.visibility,
        images: draft.images,
        primaryImage:
          draft.images[0]?.url || (listingType === "Product" ? "/images/tomatoes.png" : "/images/phone-repair.png"),
      });

      setMarketListings((current) => [payload.listing, ...current.filter((listing) => listing.id !== payload.listing.id)]);
      if (payload.platform) {
        setPlatform(payload.platform);
      }
      setActiveCategory("All");
      setIsDrawerOpen(false);
      setDraft(initialDraft);
      setNotice(
        payload.listing.status === "pending_review"
          ? "Listing saved and sent for admin review."
          : "Listing published to ShopLink.",
      );
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const payload =
        authMode === "login" ? await login(authDraft) : await registerAccount(authDraft);
      await refreshData();
      setIsAuthOpen(false);
      setNotice(`Signed in as ${payload.user.name}.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestAuthPasswordReset() {
    if (!authDraft.email.trim()) {
      setNotice("Enter your email first.");
      return;
    }
    setIsSubmitting(true);
    try {
      await requestPasswordReset(authDraft.email);
      setNotice("Password reset request recorded.");
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      await refreshData();
      setNotice("Signed out.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function runWorkspaceAction(action, successMessage) {
    if (!user) {
      openLogin("Sign in to use this action.");
      return { ok: false, error: "Sign in required." };
    }

    setIsSubmitting(true);
    try {
      const result = await action();
      const payload = await refreshData();
      setNotice(successMessage);
      setError("");
      return { ok: true, payload, result };
    } catch (requestError) {
      setError(requestError.message);
      return { ok: false, error: requestError };
    } finally {
      setIsSubmitting(false);
    }
  }

  const workspaceActions = {
    requestOrder: (listingId) =>
      runWorkspaceAction(
        () => createOrder({ listingId, deliveryMethod: `Pickup in ${marketLocation}`, ...checkoutDraft, scheduledFor: new Date(Date.now() + 86_400_000).toISOString() }),
        "Order or booking request created.",
      ),
    sendMessage: (listingId, body = "Hello, I am interested in this listing.") =>
      runWorkspaceAction(
        () => sendMessage({ listingId, body }),
        "Message sent to seller.",
      ),
    reportListing: (listingId) =>
      runWorkspaceAction(
        () => createReport({ targetType: "listing", targetId: listingId, reason: "Needs admin review" }),
        "Report sent to admin.",
      ),
    reviewOrder: (orderId) =>
      runWorkspaceAction(
        () => createReview({ orderId, rating: 5, comment: "Completed successfully." }),
        "Review submitted.",
      ),
    updateOrder: (orderId, status) =>
      runWorkspaceAction(() => updateOrderStatus(orderId, status), `Order moved to ${status}.`),
    openOrder: (orderId) =>
      runWorkspaceAction(() => openOrder(orderId), "Seller opened the order."),
    updateDelivery: (orderId, deliveryStatus) =>
      runWorkspaceAction(() => updateDeliveryStatus(orderId, deliveryStatus), "Delivery tracking updated."),
    pauseListing: (listingId) =>
      runWorkspaceAction(() => updateListing(listingId, { status: "paused" }), "Listing paused."),
    deleteListing: (listingId) =>
      runWorkspaceAction(() => deleteListing(listingId), "Listing deleted."),
    sellerOnboarding: (onboarding = {}) =>
      runWorkspaceAction(
        () => submitSellerOnboarding({
          shopName: onboarding.shopName || "Your Shop",
          category: onboarding.category || "Community Seller",
          bio: onboarding.bio || "Ready to sell on ShopLink.",
          momoNetwork: onboarding.momoNetwork || "",
          momoNumber: onboarding.momoNumber || "",
          payoutAccountName: onboarding.payoutAccountName || "",
        }),
        "Seller onboarding submitted for review.",
      ),
    createAdvert: (advert) =>
      runWorkspaceAction(() => createAdvert(advert), "Advert request created. Admin can mark paid and approve it."),
    addMedia: () =>
      runWorkspaceAction(
        () => createMediaAsset({ url: "/images/tomatoes.png", kind: "listing_image" }),
        "Media asset added for review.",
      ),
    approveListing: (listingId) =>
      runWorkspaceAction(() => decideListing(listingId, "approve"), "Listing approved."),
    rejectListing: (listingId) =>
      runWorkspaceAction(() => decideListing(listingId, "reject"), "Listing rejected."),
    approveSeller: (sellerId) =>
      runWorkspaceAction(() => decideSeller(sellerId, "approve"), "Seller approved."),
    rejectSeller: (sellerId) =>
      runWorkspaceAction(() => decideSeller(sellerId, "reject"), "Seller rejected."),
    approveAdvert: (advertId) =>
      runWorkspaceAction(() => decideAdvert(advertId, "approve"), "Advert approved."),
    markAdvertPaid: (advertId) =>
      runWorkspaceAction(() => decideAdvert(advertId, "mark_paid"), "Advert marked as paid."),
    rejectAdvert: (advertId) =>
      runWorkspaceAction(() => decideAdvert(advertId, "reject"), "Advert rejected."),
    updateSettings: (settings) =>
      runWorkspaceAction(() => updateAdminSettings(settings), "Admin settings updated."),
    suspendUser: (userId) =>
      runWorkspaceAction(() => decideUser(userId, "suspend"), "User account suspended."),
    activateUser: (userId) =>
      runWorkspaceAction(() => decideUser(userId, "activate"), "User account activated."),
    reviewReport: (reportId) =>
      runWorkspaceAction(() => decideReport(reportId, "review"), "Report moved to review."),
    resolveReport: (reportId) =>
      runWorkspaceAction(() => decideReport(reportId, "resolve"), "Report resolved."),
    resolveDispute: (disputeId) =>
      runWorkspaceAction(() => decideDispute(disputeId, "resolve"), "Dispute resolved."),
    verifyEmail: () =>
      runWorkspaceAction(() => requestEmailVerification(), "Email verification request created."),
    requestReset: () =>
      runWorkspaceAction(() => requestPasswordReset(user.email), "Password reset request recorded."),
  };

  const pageProps = {
    activeListings,
    adverts,
    cart,
    checkoutDraft,
    featuredSellers,
    followingSellers,
    formCategories,
    integrations,
    isLoading,
    isSubmitting,
    listings: visibleListings,
    marketListings,
    platform,
    publicReviews,
    saved,
    savedListings,
    schema,
    serviceQueue,
    setActiveCategory,
    setActivePage,
    setCheckoutDraft,
    setSelectedListing,
    user,
    workspaceActions,
    onAddToCart: handleAddToCart,
    onCartQuantity: handleCartQuantity,
    onCheckoutCart: handleCheckoutCart,
    onPostListing: handlePostListing,
    onRemoveCartItem: handleRemoveCartItem,
    onToggleSellerFollow: handleToggleSellerFollow,
    onToggleSaved: handleToggleSaved,
  };

  return (
    <div className="shoplink-shell">
      <Sidebar
        activePage={activePage}
        cartCount={cart.count}
        messageCount={messageCount}
        notificationCount={unreadNotifications}
        onAuth={() => openLogin("Log in to manage your account.")}
          onLogout={handleLogout}
          onNavigate={setActivePage}
          navigationItems={visibleNavItems}
          reportCount={reportCount}
          user={user}
        />

      <div className="shoplink-main">
        <DiscoveryHeader
          cartCount={cart.count}
          onAuth={() => openLogin("Log in to continue.")}
          onNavigate={setActivePage}
          onPostListing={handlePostListing}
          query={query}
          setQuery={setQuery}
          user={user}
        />

        <div className="mobile-nav" aria-label="Mobile navigation">
          {visibleNavItems.slice(0, 8).map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={activePage === id ? "mobile-nav-item active" : "mobile-nav-item"}
              type="button"
              onClick={() => setActivePage(id)}
            >
              <Icon size={18} />
              <span>{id}</span>
            </button>
          ))}
        </div>

        <main className="page-canvas">
          <NoticeStack error={error} notice={notice} onClearError={() => setError("")} onClearNotice={() => setNotice("")} />
          {renderPage(activePage, pageProps)}
        </main>
      </div>

      <AuthModal
        authDraft={authDraft}
        authMode={authMode}
        integrations={integrations}
        isOpen={isAuthOpen}
        isSubmitting={isSubmitting}
        onAuthDraftChange={updateAuthDraft}
        onClose={() => setIsAuthOpen(false)}
        onModeChange={setAuthMode}
        onPasswordReset={requestAuthPasswordReset}
        onSubmit={submitAuth}
      />

      <PostListingDrawer
        draft={draft}
        formCategories={formCategories}
        isOpen={isDrawerOpen}
        isSubmitting={isSubmitting}
        isUploadingImages={isUploadingImages}
        listingType={listingType}
        onClose={() => setIsDrawerOpen(false)}
        onDraftChange={updateDraft}
        onPhotoUpload={handlePhotoUpload}
        onListingTypeChange={setListingType}
        onSubmit={publishListing}
      />

      <ListingDetailDrawer
        followingSellers={followingSellers}
        isSaved={selectedListing ? saved.has(selectedListing.id) : false}
        listing={selectedListing}
        onAddToCart={handleAddToCart}
        onClose={() => setSelectedListing(null)}
        onToggleSellerFollow={handleToggleSellerFollow}
        onReport={(listing) => workspaceActions.reportListing(listing.id)}
        onToggleSaved={(listing) => handleToggleSaved(listing.id)}
      />
    </div>
  );
}

function renderPage(activePage, props) {
  switch (activePage) {
    case "Discover":
      return <DiscoverPage {...props} />;
    case "Categories":
      return <CategoriesPage {...props} />;
    case "Messages":
      return <MessagesPage {...props} />;
    case "Saved":
      return <SavedPage {...props} />;
    case "My listings":
      return <SellerPage {...props} />;
    case "Orders":
      return <OrdersPage {...props} />;
    case "Cart":
      return <CartPage {...props} />;
    case "Payments":
      return <PaymentsPage {...props} />;
    case "Reviews":
      return <ReviewsPage {...props} />;
    case "Notifications":
      return <NotificationsPage {...props} />;
    case "Community":
      return <CommunityPage {...props} />;
    case "Policies":
      return <PoliciesPage {...props} />;
    case "Admin":
      return props.user?.role === "admin" ? <AdminPage {...props} /> : <HomePage {...props} />;
    case "Reports":
      return props.user?.role === "admin" ? <ReportsPage {...props} /> : <HomePage {...props} />;
    default:
      return <HomePage {...props} />;
  }
}

function Sidebar({
  activePage,
  cartCount,
  messageCount,
  notificationCount,
  onAuth,
  onLogout,
  onNavigate,
  navigationItems,
  reportCount,
  user,
}) {
  const badgeFor = {
    Cart: cartCount,
    Messages: messageCount,
    Notifications: notificationCount,
    Reports: reportCount,
  };

  return (
    <aside className="sidebar">
      <button className="brand-lockup" type="button" onClick={() => onNavigate("Home")}>
        <span className="brand-symbol">
          <span />
          <span />
        </span>
        <strong>ShopLink</strong>
      </button>

      <nav className="sidebar-nav" aria-label="ShopLink pages">
        {navigationItems.map(({ id, icon: Icon }) => (
          <button
            key={id}
            className={activePage === id ? "side-link active" : "side-link"}
            type="button"
            onClick={() => onNavigate(id)}
          >
            <Icon size={21} />
            <span>{id}</span>
            {badgeFor[id] ? <em>{badgeFor[id]}</em> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="location-card" type="button">
          <MapPin size={19} />
          <span>Dunkwa-on-Offin</span>
          <ChevronDown size={16} />
        </button>

        {user ? (
          <div className="account-card">
            <SellerAvatar name={user.name} initials={initialsFor(user.name)} />
            <span>
              <strong>{user.name}</strong>
              <small>{user.role} account</small>
            </span>
            <button type="button" onClick={onLogout} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        ) : (
          <button className="account-card login" type="button" onClick={onAuth}>
            <LogIn size={20} />
            <span>
              <strong>Sign in</strong>
              <small>Buyer or seller</small>
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}

function DiscoveryHeader({ cartCount, onAuth, onNavigate, onPostListing, query, setQuery, user }) {
  return (
    <header className="discovery-header">
      <div className="discovery-copy">
        <h1>Find trusted offers nearby</h1>
        <div className="search-deck">
          <label className="hero-search">
            <Search size={22} />
            <span className="sr-only">Search items or services</span>
            <input
              type="search"
              placeholder="Search items or services"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="hero-location" type="button">
            <MapPin size={20} />
            {marketLocation}
          </button>
          <button className="hero-search-button" type="button">
            Search
          </button>
        </div>
        <div className="discovery-chips">
          {discoveryChips.map((chip) => (
            <button key={chip} type="button">
              {chip === "Nearby" ? <MapPin size={14} /> : null}
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="header-actions">
        <button className="post-button" type="button" onClick={onPostListing}>
          <Plus size={21} />
          Post listing
        </button>
        <button className="header-icon" type="button" onClick={() => onNavigate("Messages")} aria-label="Messages">
          <MessageSquareText size={25} />
        </button>
        <button className="header-icon with-badge" type="button" onClick={() => onNavigate("Notifications")} aria-label="Notifications">
          <Bell size={25} />
          <span>8</span>
        </button>
        <button className="header-icon with-badge" type="button" onClick={() => onNavigate("Cart")} aria-label="Cart">
          <ShoppingCart size={25} />
          {cartCount ? <span>{cartCount}</span> : null}
        </button>
        {!user ? (
          <button className="header-login" type="button" onClick={onAuth}>
            Sign in
          </button>
        ) : null}
      </div>
    </header>
  );
}

function HomePage(props) {
  const {
    adverts,
    cart,
    featuredSellers,
    isLoading,
    listings,
    platform,
    publicReviews,
    saved,
    schema,
    serviceQueue,
    setActiveCategory,
    setActivePage,
    setSelectedListing,
    user,
    onAddToCart,
    onPostListing,
    onToggleSaved,
  } = props;

  return (
    <div className="home-grid">
      <section className="market-column" aria-label="Marketplace home">
        <AdvertCarousel adverts={adverts} onOpenListing={(listingId) => {
          const match = listings.find((listing) => listing.id === listingId);
          if (match) {
            setSelectedListing(match);
          }
        }} />
        <CategoryRail onSelect={setActiveCategory} />
        <SectionTitle title="Top picks near you" action="View all" onAction={() => setActivePage("Discover")} />
        {isLoading ? (
          <LoadingState />
        ) : (
          <ListingGrid
            listings={listings.slice(0, 8)}
            saved={saved}
            onAddToCart={onAddToCart}
            onOpenDetails={setSelectedListing}
            onToggleSaved={onToggleSaved}
          />
        )}
      </section>

      <RightRail
        featuredSellers={featuredSellers}
        listings={listings}
        platform={platform}
        serviceQueue={serviceQueue}
        user={user}
      />

      {user?.role === "admin" ? (
        <OperationsStrip cart={cart} onPostListing={onPostListing} platform={platform} schema={schema} setActivePage={setActivePage} />
      ) : null}
      <section className="market-reviews-strip">
        <SectionTitle title="Recent buyer reviews" action="See reviews" onAction={() => setActivePage("Reviews")} />
        <ReviewTicker reviews={publicReviews} />
      </section>
    </div>
  );
}

function DiscoverPage(props) {
  return (
    <PanelPage
      eyebrow="Discover"
      title="Search products and services around Dunkwa-on-Offin"
      action={<FilterButton />}
    >
      <div className="filter-row">
        {discoveryChips.map((chip) => (
          <button key={chip} type="button">{chip}</button>
        ))}
      </div>
      <ListingGrid
        listings={props.listings}
        saved={props.saved}
        onAddToCart={props.onAddToCart}
        onOpenDetails={props.setSelectedListing}
        onToggleSaved={props.onToggleSaved}
      />
    </PanelPage>
  );
}

function CategoriesPage({ formCategories, marketListings, setActiveCategory, setActivePage }) {
  return (
    <PanelPage eyebrow="Categories" title="Browse by category">
      <div className="category-page-grid">
        {categoryTabs.map(({ label, icon: Icon, tone }) => {
          const count = marketListings.filter((listing) => categoryMatches(listing, label)).length;
          return (
            <button
              className={`category-tile ${tone}`}
              key={label}
              type="button"
              onClick={() => {
                setActiveCategory(label);
                setActivePage("Discover");
              }}
            >
              <span><Icon size={30} /></span>
              <strong>{label}</strong>
              <small>{count} active offer{count === 1 ? "" : "s"}</small>
            </button>
          );
        })}
      </div>
      <section className="table-panel">
        <h3>Seller listing categories</h3>
        <DataList
          empty="No categories yet."
          items={(formCategories || []).map((category) => ({
            title: category.name,
            meta: `${category.listingType} listings`,
          }))}
        />
      </section>
    </PanelPage>
  );
}

function MessagesPage({ activeListings, platform, user, workspaceActions }) {
  const [messageBody, setMessageBody] = useState("");
  const firstListing = activeListings[0];
  const messages = platform?.buyer?.messages || [];

  return (
    <PanelPage eyebrow="Messages" title="Buyer-seller conversations">
      <div className="split-grid">
        <section className="table-panel">
          <h3>Recent messages</h3>
          <DataList
            empty={user ? "No messages yet." : "Log in to see your messages."}
            items={messages.map((message) => ({
              title: message.body,
              meta: `${message.listingId || "listing"} · ${formatDate(message.createdAt)}`,
            }))}
          />
        </section>
        <section className="table-panel action-panel">
          <h3>Send a message</h3>
          <p>Attach the message to an active listing so the seller has context.</p>
          <textarea
            rows={5}
            placeholder="Ask about availability, delivery, or service time..."
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
          />
          <button
            className="solid-action"
            type="button"
            disabled={!user || !firstListing || !messageBody.trim()}
            onClick={() => {
              workspaceActions.sendMessage(firstListing.id, messageBody.trim());
              setMessageBody("");
            }}
          >
            <Send size={17} />
            Send to seller
          </button>
        </section>
      </div>
    </PanelPage>
  );
}

function SavedPage({ saved, savedListings, setSelectedListing, onAddToCart, onToggleSaved }) {
  return (
    <PanelPage eyebrow="Saved" title="Listings you saved">
      <ListingGrid
        emptyText="Save products and services to compare them later."
        listings={savedListings}
        saved={saved}
        onAddToCart={onAddToCart}
        onOpenDetails={setSelectedListing}
        onToggleSaved={onToggleSaved}
      />
    </PanelPage>
  );
}

function SellerPage({ platform, user, workspaceActions, onPostListing }) {
  const seller = platform?.seller;
  const isSeller = user && ["seller", "admin"].includes(user.role);
  const sellerProfile = seller?.profile;
  const [onboarding, setOnboarding] = useState({
    shopName: sellerProfile?.name || "",
    category: sellerProfile?.type || "",
    bio: sellerProfile?.bio || "",
    momoNetwork: sellerProfile?.momoNetwork || "MTN Mobile Money",
    momoNumber: "",
    payoutAccountName: sellerProfile?.payoutAccountName || "",
  });
  const [advertDraft, setAdvertDraft] = useState({
    listingId: seller?.listings?.[0]?.id || "",
    placement: "home_top",
    title: "",
    body: "",
  });

  useEffect(() => {
    setOnboarding((current) => ({
      ...current,
      shopName: sellerProfile?.name || current.shopName,
      category: sellerProfile?.type || current.category,
      bio: sellerProfile?.bio || current.bio,
      momoNetwork: sellerProfile?.momoNetwork || current.momoNetwork || "MTN Mobile Money",
      payoutAccountName: sellerProfile?.payoutAccountName || current.payoutAccountName,
    }));
    setAdvertDraft((current) => ({
      ...current,
      listingId: current.listingId || seller?.listings?.[0]?.id || "",
    }));
  }, [sellerProfile?.id, seller?.listings?.length]);

  function updateOnboarding(field, value) {
    setOnboarding((current) => ({ ...current, [field]: value }));
  }

  function updateAdvertDraft(field, value) {
    setAdvertDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <PanelPage
      eyebrow="Seller"
      title="Manage your shop, listings, and earnings"
      action={<button className="solid-action" type="button" onClick={onPostListing}><Plus size={18} /> Post listing</button>}
    >
      <div className="metrics-row">
        <Metric label="Listings" value={seller?.listings?.length || 0} icon={Package} />
        <Metric label="Seller orders" value={seller?.orders?.length || 0} icon={ClipboardList} />
        <Metric label="Pending payout" value={seller?.earnings?.pending || "GH₵0.00"} icon={WalletCards} />
        <Metric label="KYC status" value={seller?.onboarding?.kycStatus || "not started"} icon={ShieldCheck} />
      </div>

      <div className="split-grid">
        <section className="table-panel span-2">
          <h3>My listings</h3>
          <DataList
            empty={isSeller ? "No seller listings yet." : "Use a seller account to manage listings."}
            items={(isSeller ? seller?.listings || [] : []).map((listing) => ({
              title: listing.title,
              meta: `${listing.price} · ${listing.statusLabel} · ${listing.location} · ${listing.reviewCount || 0} reviews`,
              action: (
                <span className="row-actions">
                  <button className="text-action" type="button" onClick={() => {
                    setAdvertDraft((current) => ({ ...current, listingId: listing.id, title: listing.title }));
                  }}>Promote</button>
                  <button className="text-action" type="button" onClick={() => workspaceActions.pauseListing(listing.id)}>Pause</button>
                  <button className="text-action danger" type="button" onClick={() => workspaceActions.deleteListing(listing.id)}>Delete</button>
                </span>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Seller verification and MoMo</h3>
          <p>Submit shop details and the MoMo account where seller payments should be settled.</p>
          <div className="form-grid compact">
            <input value={onboarding.shopName} onChange={(event) => updateOnboarding("shopName", event.target.value)} placeholder="Shop name" />
            <input value={onboarding.category} onChange={(event) => updateOnboarding("category", event.target.value)} placeholder="Seller category" />
            <select value={onboarding.momoNetwork} onChange={(event) => updateOnboarding("momoNetwork", event.target.value)}>
              <option>MTN Mobile Money</option>
              <option>Telecel Cash</option>
              <option>AirtelTigo Money</option>
            </select>
            <input value={onboarding.momoNumber} onChange={(event) => updateOnboarding("momoNumber", event.target.value)} placeholder="MoMo number" />
            <input value={onboarding.payoutAccountName} onChange={(event) => updateOnboarding("payoutAccountName", event.target.value)} placeholder="MoMo account name" />
            <textarea rows={3} value={onboarding.bio} onChange={(event) => updateOnboarding("bio", event.target.value)} placeholder="Short shop bio" />
          </div>
          <button className="outline-action" type="button" disabled={!isSeller} onClick={() => workspaceActions.sellerOnboarding(onboarding)}>
            <UserCheck size={17} />
            Submit verification
          </button>
          {sellerProfile ? <p className="subtle">Payout status: {sellerProfile.payoutStatus}. Saved MoMo: {sellerProfile.momoNetwork || "not set"} {sellerProfile.momoNumber || ""}</p> : null}
        </section>
        <section className="table-panel">
          <h3>Paid advert request</h3>
          <p>Request a scrolling homepage advert. Admin controls the fee and approval.</p>
          <div className="form-grid compact">
            <select value={advertDraft.listingId} onChange={(event) => updateAdvertDraft("listingId", event.target.value)}>
              <option value="">Choose listing</option>
              {(seller?.listings || []).map((listing) => <option key={listing.id} value={listing.id}>{listing.title}</option>)}
            </select>
            <select value={advertDraft.placement} onChange={(event) => updateAdvertDraft("placement", event.target.value)}>
              <option value="home_top">Home top advert</option>
              <option value="featured">Featured advert</option>
            </select>
            <input value={advertDraft.title} onChange={(event) => updateAdvertDraft("title", event.target.value)} placeholder="Advert title" />
            <textarea rows={3} value={advertDraft.body} onChange={(event) => updateAdvertDraft("body", event.target.value)} placeholder="Advert message" />
          </div>
          <button className="solid-action" type="button" disabled={!isSeller || !advertDraft.listingId} onClick={() => workspaceActions.createAdvert(advertDraft)}>
            <Megaphone size={17} />
            Request advert
          </button>
          <DataList
            empty="No advert requests yet."
            items={(seller?.adverts || []).slice(0, 4).map((advert) => ({
              title: advert.title,
              meta: `${advert.status} · ${advert.fee} · ${advert.placement}`,
            }))}
          />
        </section>
      </div>
    </PanelPage>
  );
}

function OrdersPage({ platform, user, workspaceActions }) {
  const buyerOrders = platform?.buyer?.orders || [];
  const sellerOrders = platform?.seller?.orders || [];

  return (
    <PanelPage eyebrow="Orders" title="Product orders and service bookings">
      <div className="split-grid">
        <section className="table-panel span-2">
          <h3>Buyer orders</h3>
          {buyerOrders.length ? (
            <div className="order-card-list">
              {buyerOrders.map((order) => (
                <OrderCard key={order.id} order={order} viewer="buyer" workspaceActions={workspaceActions} />
              ))}
            </div>
          ) : (
            <p className="subtle">{user ? "No buyer orders yet." : "Log in to view orders."}</p>
          )}
        </section>
        <section className="table-panel span-2">
          <h3>Seller orders</h3>
          {sellerOrders.length ? (
            <div className="order-card-list">
              {sellerOrders.map((order) => (
                <OrderCard key={order.id} order={order} viewer="seller" workspaceActions={workspaceActions} />
              ))}
            </div>
          ) : (
            <p className="subtle">No seller orders yet.</p>
          )}
        </section>
      </div>
    </PanelPage>
  );
}

function OrderCard({ order, viewer, workspaceActions }) {
  const isSeller = viewer === "seller";
  const deliveryOptions = [
    ["preparing", "Preparing"],
    ["ready_for_pickup", "Ready"],
    ["out_for_delivery", "Delivering"],
    ["delivered", "Delivered"],
  ];

  return (
    <article className="order-card">
      <div className="order-card-head">
        <span>
          <strong>{order.listingTitle}</strong>
          <small>{isSeller ? `Buyer: ${order.buyer}` : `Seller: ${order.seller}`} · {order.total} · {order.status}</small>
        </span>
        <span className="status-pill bright">{order.deliveryStatusLabel}</span>
      </div>
      <div className="delivery-box">
        <span><Phone size={15} /> {order.delivery?.phone || "No phone yet"}</span>
        <span><MapPinned size={15} /> {order.delivery?.address || order.deliveryMethod} · {order.delivery?.town || "Dunkwa-on-Offin"}</span>
      </div>
      <div className="tracking-line">
        {["new", "opened", "preparing", "out_for_delivery", "delivered"].map((step) => (
          <span key={step} className={trackingStepActive(order.deliveryStatus, step) ? "active" : ""}>
            {step.replaceAll("_", " ")}
          </span>
        ))}
      </div>
      <DataList
        empty="Tracking events will appear here."
        items={(order.trackingEvents || []).map((event) => ({
          title: event.note || event.status,
          meta: formatDate(event.createdAt),
        }))}
      />
      {isSeller ? (
        <div className="row-actions wrap">
          <button className="text-action" type="button" onClick={() => workspaceActions.openOrder(order.id)}>Open order</button>
          <button className="text-action" type="button" onClick={() => workspaceActions.updateOrder(order.id, "accepted")}>Accept</button>
          {deliveryOptions.map(([status, label]) => (
            <button key={status} className="text-action" type="button" onClick={() => workspaceActions.updateDelivery(order.id, status)}>
              {label}
            </button>
          ))}
          <button className="text-action" type="button" onClick={() => workspaceActions.updateOrder(order.id, "completed")}>Complete</button>
        </div>
      ) : order.status !== "completed" ? (
        <button className="text-action" type="button" onClick={() => workspaceActions.updateOrder(order.id, "completed")}>
          Mark complete
        </button>
      ) : (
        <button className="text-action" type="button" onClick={() => workspaceActions.reviewOrder(order.id)}>
          Review order
        </button>
      )}
    </article>
  );
}

function CartPage({ cart, checkoutDraft, isSubmitting, onCartQuantity, onCheckoutCart, onRemoveCartItem, setActivePage, setCheckoutDraft }) {
  function updateCheckout(field, value) {
    setCheckoutDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <PanelPage eyebrow="Cart" title="Buyer cart">
      <div className="cart-layout">
        <section className="cart-list">
          {cart.items.length ? (
            cart.items.map((item) => (
              <article className="cart-item" key={item.listingId}>
                <img src={item.listing.image} alt="" />
                <div>
                  <strong>{item.listing.title}</strong>
                  <span>{item.listing.seller} · {item.listing.location}</span>
                  <small>{item.listing.price}</small>
                </div>
                <div className="quantity-control">
                  <button type="button" onClick={() => onCartQuantity(item.listingId, item.quantity - 1)}><Minus size={16} /></button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => onCartQuantity(item.listingId, item.quantity + 1)}><Plus size={16} /></button>
                </div>
                <strong>{item.lineTotal}</strong>
                <button className="icon-danger" type="button" onClick={() => onRemoveCartItem(item.listingId)} aria-label="Remove item">
                  <Trash2 size={18} />
                </button>
              </article>
            ))
          ) : (
            <EmptyState icon={ShoppingCart} title="Your cart is empty" copy="Add products from the marketplace before checkout." />
          )}
        </section>
        <aside className="checkout-panel">
          <h3>Order summary</h3>
          <span>{cart.count} item{cart.count === 1 ? "" : "s"}</span>
          <strong>{cart.subtotal}</strong>
          <p>Checkout creates real ShopLink order records and sends the seller an email notification when email keys are configured.</p>
          <div className="checkout-fields">
            <input value={checkoutDraft.deliveryContactName} onChange={(event) => updateCheckout("deliveryContactName", event.target.value)} placeholder="Full name for delivery" />
            <input value={checkoutDraft.deliveryPhone} onChange={(event) => updateCheckout("deliveryPhone", event.target.value)} placeholder="Phone number" />
            <input value={checkoutDraft.deliveryTown} onChange={(event) => updateCheckout("deliveryTown", event.target.value)} placeholder="Town / area" />
            <input value={checkoutDraft.deliveryAddress} onChange={(event) => updateCheckout("deliveryAddress", event.target.value)} placeholder="Delivery address" />
            <select value={checkoutDraft.deliveryMethod} onChange={(event) => updateCheckout("deliveryMethod", event.target.value)}>
              <option>Seller delivery</option>
              <option>Pickup</option>
              <option>Meet in Dunkwa-on-Offin</option>
            </select>
            <textarea rows={3} value={checkoutDraft.deliveryNote} onChange={(event) => updateCheckout("deliveryNote", event.target.value)} placeholder="Delivery note for seller" />
          </div>
          <button className="solid-action wide" type="button" disabled={!cart.items.length || isSubmitting} onClick={onCheckoutCart}>
            <CreditCard size={18} />
            Checkout
          </button>
          <button className="outline-action wide" type="button" onClick={() => setActivePage("Discover")}>
            Continue shopping
          </button>
        </aside>
      </div>
    </PanelPage>
  );
}

function PaymentsPage({ integrations, platform }) {
  const stats = platform?.stats;
  const payments = platform?.admin?.payments || [];
  const payouts = platform?.admin?.payouts || [];
  const settings = platform?.settings;

  return (
    <PanelPage eyebrow="Payments" title="Payments, commissions, and payouts">
      <div className="metrics-row">
        <Metric label="Payment volume" value={stats?.paymentVolume || "GH₵0.00"} icon={CircleDollarSign} />
        <Metric label="Payment intents" value={payments.length} icon={CreditCard} />
        <Metric label="Seller payouts" value={payouts.length} icon={WalletCards} />
        <Metric label="Platform commission" value={`${settings?.commissionRate ?? 10}%`} icon={BarChart3} />
      </div>
      <section className="table-panel">
        <h3>Provider status</h3>
        <p>{integrations?.paymentConfigured ? "Live payment credentials are configured." : "Live checkout is provider-ready. Add Paystack or Hubtel credentials before accepting real money online."}</p>
        <DataList
          empty="Admin login required to inspect payment records."
          items={payments.map((payment) => ({
            title: payment.id,
            meta: `${payment.provider} · ${payment.status} · ${moneyFromCents(payment.amountCents)} · ${payment.destinationLabel || "MoMo pending"}`,
          }))}
        />
      </section>
    </PanelPage>
  );
}

function ReviewsPage({ platform, publicReviews }) {
  const reviews = platform?.buyer?.reviews || [];
  return (
    <PanelPage eyebrow="Reviews" title="Ratings and seller trust">
      <div className="split-grid">
        <section className="table-panel">
          <h3>Marketplace reviews</h3>
          <DataList
            empty="No public buyer reviews yet."
            items={(publicReviews || []).map((review) => ({
              title: `${review.rating} stars for ${review.listingTitle}`,
              meta: `${review.comment} · ${review.seller} · ${formatDate(review.createdAt)}`,
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Your reviews</h3>
          <DataList
            empty="Completed orders can receive reviews."
            items={reviews.map((review) => ({
              title: `${review.rating} stars for ${review.listingTitle || "order"}`,
              meta: `${review.comment} · ${formatDate(review.createdAt)}`,
            }))}
          />
        </section>
      </div>
    </PanelPage>
  );
}

function NotificationsPage({ platform }) {
  const notifications = platform?.buyer?.notifications || [];
  return (
    <PanelPage eyebrow="Notifications" title="Marketplace alerts">
      <section className="table-panel">
        <DataList
          empty="No notifications yet."
          items={notifications.map((notification) => ({
            title: notification.title,
            meta: `${notification.body} · ${formatDate(notification.createdAt)}`,
          }))}
        />
      </section>
    </PanelPage>
  );
}

function CommunityPage({ featuredSellers, serviceQueue }) {
  return (
    <PanelPage eyebrow="Community" title="Verified local marketplace">
      <div className="split-grid">
        <section className="table-panel">
          <h3>Verified sellers</h3>
          <DataList
            items={featuredSellers.map((seller) => ({
              title: seller.name,
              meta: `${seller.type} · verified`,
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Available services</h3>
          <DataList
            items={serviceQueue.map((service) => ({
              title: service.title,
              meta: `${service.seller} · ${service.price} · ${service.status}`,
            }))}
          />
        </section>
      </div>
      <div className="policy-grid">
        <PolicyCard icon={ShieldCheck} title="Verified seller badge" copy="Sellers can submit onboarding details before admin approval." />
        <PolicyCard icon={Flag} title="Report abuse" copy="Buyers and sellers can report listings for admin review." />
        <PolicyCard icon={Truck} title="Pickup and delivery" copy="Listings support pickup, seller delivery, and service bookings." />
      </div>
    </PanelPage>
  );
}

function PoliciesPage() {
  return (
    <PanelPage eyebrow="Policies" title="Terms, privacy, and marketplace rules">
      <div className="split-grid">
        <section className="table-panel policy-copy">
          <h3>Terms of Service</h3>
          <p>ShopLink connects buyers and local sellers around Dunkwa-on-Offin. Sellers are responsible for truthful listings, fair pricing, safe goods, service delivery, and keeping stock information accurate.</p>
          <p>Buyers must provide accurate delivery contact details, pay through approved channels, inspect orders promptly, and use reviews/reporting honestly.</p>
          <p>ShopLink may approve, reject, pause, or remove sellers, adverts, reviews, accounts, and listings that appear unsafe, misleading, illegal, abusive, or outside marketplace rules.</p>
          <p>Paid adverts do not guarantee sales. Advert fees, duration, and placement are controlled by the admin dashboard and may change before a seller submits a new advert request.</p>
        </section>
        <section className="table-panel policy-copy">
          <h3>Privacy Policy</h3>
          <p>ShopLink stores account profile details, seller verification status, delivery phone/address for orders, messages, reviews, reports, and payment/payout records needed to operate the marketplace.</p>
          <p>Seller MoMo details are used to prepare payout destinations. Buyers can see seller identity and trust information; sellers can see buyer delivery details only for relevant orders.</p>
          <p>Admins can review reports, disputes, listings, seller verification, advert requests, payment records, and email notification status to protect the marketplace.</p>
          <p>Google login uses Google account profile information only after the user chooses to continue with Google. Email notifications require the configured email provider keys.</p>
        </section>
      </div>
      <div className="policy-grid">
        <PolicyCard icon={BadgeCheck} title="Seller verification" copy="Admins verify sellers before trust badges and payout readiness appear." />
        <PolicyCard icon={Megaphone} title="Paid adverts" copy="Sellers request paid adverts, then admin marks paid and approves display." />
        <PolicyCard icon={ShieldCheck} title="Trust actions" copy="Reports, disputes, reviews, and account controls help protect the community." />
      </div>
    </PanelPage>
  );
}

function AdminPage({ isSubmitting, platform, user, workspaceActions }) {
  const admin = platform?.admin;
  const isAdmin = user?.role === "admin";
  const settings = admin?.settings || platform?.settings || {};
  const integrations = platform?.integrations || {};
  const pendingListings = isAdmin ? admin?.pendingListings || [] : [];
  const pendingSellers = isAdmin ? (admin?.sellers || []).filter((seller) => seller.kycStatus === "submitted" || seller.kycStatus === "needs_review") : [];
  const reports = isAdmin ? admin?.reports || [] : [];
  const disputes = isAdmin ? admin?.disputes || [] : [];
  const payments = isAdmin ? admin?.payments || [] : [];
  const payouts = isAdmin ? admin?.payouts || [] : [];
  const auditLogs = isAdmin ? admin?.auditLogs || [] : [];
  const emailNotifications = isAdmin ? admin?.emailNotifications || [] : [];
  const [settingsStatus, setSettingsStatus] = useState("");
  const [integrationsStatus, setIntegrationsStatus] = useState("");
  const [settingsDraft, setSettingsDraft] = useState({
    advertListingFee: centsToAmount(settings.advertListingFeeCents ?? 2500),
    featuredAdvertFee: centsToAmount(settings.featuredAdvertFeeCents ?? 7500),
    advertDurationDays: settings.advertDurationDays ?? 7,
    commissionRate: settings.commissionRate ?? 10,
    googleClientId: settings.googleClientId || "",
    googleClientSecret: "",
    googleRedirectUri: settings.googleRedirectUri || "http://127.0.0.1:8787/api/auth/google/callback",
    publicBaseUrl: settings.publicBaseUrl || "http://127.0.0.1:8787",
    resendApiKey: "",
    resendFromEmail: settings.resendFromEmail || "",
  });

  useEffect(() => {
    setSettingsDraft({
      advertListingFee: centsToAmount(settings.advertListingFeeCents ?? 2500),
      featuredAdvertFee: centsToAmount(settings.featuredAdvertFeeCents ?? 7500),
      advertDurationDays: settings.advertDurationDays ?? 7,
      commissionRate: settings.commissionRate ?? 10,
      googleClientId: settings.googleClientId || "",
      googleClientSecret: "",
      googleRedirectUri: settings.googleRedirectUri || "http://127.0.0.1:8787/api/auth/google/callback",
      publicBaseUrl: settings.publicBaseUrl || "http://127.0.0.1:8787",
      resendApiKey: "",
      resendFromEmail: settings.resendFromEmail || "",
    });
  }, [settings.advertListingFeeCents, settings.featuredAdvertFeeCents, settings.advertDurationDays, settings.commissionRate, settings.googleClientId, settings.googleRedirectUri, settings.publicBaseUrl, settings.resendFromEmail]);

  function updateSettingsDraft(field, value) {
    setSettingsStatus("");
    setIntegrationsStatus("");
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings() {
    setSettingsStatus("Saving...");
    const result = await workspaceActions.updateSettings(settingsDraft);
    setSettingsStatus(result?.ok ? "Saved." : "Could not save. Check the message above.");
  }

  async function saveIntegrations() {
    setIntegrationsStatus("Saving...");
    const result = await workspaceActions.updateSettings(settingsDraft);
    setIntegrationsStatus(result?.ok ? "Integrations saved." : "Could not save. Check the message above.");
  }

  return (
    <PanelPage eyebrow="Admin" title="ShopLink operations">
      <div className="metrics-row">
        <Metric label="Users" value={platform?.stats?.users || 0} icon={UserRound} />
        <Metric label="Listings" value={platform?.stats?.listings || 0} icon={Package} />
        <Metric label="Open reports" value={platform?.stats?.openReports || 0} icon={Flag} />
        <Metric label="Active orders" value={platform?.stats?.activeOrders || 0} icon={ClipboardList} />
      </div>
      <AdminControlCenter
        auditLogs={auditLogs}
        disputes={disputes}
        emailNotifications={emailNotifications}
        integrations={integrations}
        payments={payments}
        payouts={payouts}
        pendingListings={pendingListings}
        pendingSellers={pendingSellers}
        reports={reports}
      />
      <div className="split-grid">
        <section className="table-panel span-2">
          <h3>Advert fees and commission</h3>
          <div className="form-grid admin-settings-grid">
            <label>
              <span>Home advert fee (GH₵)</span>
              <input value={settingsDraft.advertListingFee} onChange={(event) => updateSettingsDraft("advertListingFee", event.target.value)} />
            </label>
            <label>
              <span>Featured advert fee (GH₵)</span>
              <input value={settingsDraft.featuredAdvertFee} onChange={(event) => updateSettingsDraft("featuredAdvertFee", event.target.value)} />
            </label>
            <label>
              <span>Advert days</span>
              <input type="number" value={settingsDraft.advertDurationDays} onChange={(event) => updateSettingsDraft("advertDurationDays", event.target.value)} />
            </label>
            <label>
              <span>Commission %</span>
              <input value={settingsDraft.commissionRate} onChange={(event) => updateSettingsDraft("commissionRate", event.target.value)} />
            </label>
          </div>
          <div className="settings-save-row">
            <button className="solid-action" type="button" disabled={!isAdmin || isSubmitting} onClick={saveSettings}>
              <Settings size={17} />
              {isSubmitting ? "Saving..." : "Save settings"}
            </button>
            {settingsStatus ? <span className={settingsStatus.startsWith("Could") ? "inline-save-status error" : "inline-save-status"} aria-live="polite">{settingsStatus}</span> : null}
          </div>
        </section>
        <section className="table-panel span-2">
          <h3>Google login and seller email</h3>
          <p>Update OAuth and email provider settings. Leave secret fields blank to keep the saved secret.</p>
          <div className="form-grid integration-settings-grid">
            <label>
              <span>Google client ID</span>
              <input value={settingsDraft.googleClientId} onChange={(event) => updateSettingsDraft("googleClientId", event.target.value)} />
            </label>
            <label>
              <span>Google client secret</span>
              <input
                value={settingsDraft.googleClientSecret}
                onChange={(event) => updateSettingsDraft("googleClientSecret", event.target.value)}
                placeholder={settings.googleClientSecret ? `${settings.googleClientSecret} saved` : "Paste new secret"}
                type="password"
              />
            </label>
            <label>
              <span>Google redirect URI</span>
              <input value={settingsDraft.googleRedirectUri} onChange={(event) => updateSettingsDraft("googleRedirectUri", event.target.value)} />
            </label>
            <label>
              <span>Public base URL</span>
              <input value={settingsDraft.publicBaseUrl} onChange={(event) => updateSettingsDraft("publicBaseUrl", event.target.value)} />
            </label>
            <label>
              <span>Resend API key</span>
              <input
                value={settingsDraft.resendApiKey}
                onChange={(event) => updateSettingsDraft("resendApiKey", event.target.value)}
                placeholder={settings.resendApiKey ? `${settings.resendApiKey} saved` : "Paste Resend API key"}
                type="password"
              />
            </label>
            <label>
              <span>Resend from email</span>
              <input value={settingsDraft.resendFromEmail} onChange={(event) => updateSettingsDraft("resendFromEmail", event.target.value)} placeholder="ShopLink <orders@yourdomain.com>" />
            </label>
          </div>
          <div className="settings-save-row">
            <button className="solid-action" type="button" disabled={!isAdmin || isSubmitting} onClick={saveIntegrations}>
              <ShieldCheck size={17} />
              {isSubmitting ? "Saving..." : "Save integrations"}
            </button>
            {integrationsStatus ? <span className={integrationsStatus.startsWith("Could") ? "inline-save-status error" : "inline-save-status"} aria-live="polite">{integrationsStatus}</span> : null}
          </div>
        </section>
        <section className="table-panel span-2">
          <h3>Pending listings</h3>
          <DataList
            empty={isAdmin ? "No pending listings." : "Admin login required."}
            items={pendingListings.map((listing) => ({
              title: listing.title,
              meta: `${listing.seller} · ${listing.price} · ${listing.statusLabel}`,
              action: (
                <span className="row-actions">
                  <button className="text-action" type="button" onClick={() => workspaceActions.approveListing(listing.id)}>Approve</button>
                  <button className="text-action danger" type="button" onClick={() => workspaceActions.rejectListing(listing.id)}>Reject</button>
                </span>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Seller verification</h3>
          <DataList
            empty={isAdmin ? "No sellers found." : "Admin login required."}
            items={(isAdmin ? admin?.sellers || [] : []).map((seller) => ({
              title: seller.name,
              meta: `${seller.kycStatus} · ${seller.payoutStatus} · ${seller.momoNetwork || "MoMo not set"} ${seller.momoNumber || ""}`,
              action: (
                <span className="row-actions">
                  <button className="text-action" type="button" onClick={() => workspaceActions.approveSeller(seller.id)}>Verify</button>
                  <button className="text-action danger" type="button" onClick={() => workspaceActions.rejectSeller(seller.id)}>Reject</button>
                </span>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Paid adverts</h3>
          <DataList
            empty={isAdmin ? "No advert requests." : "Admin login required."}
            items={(isAdmin ? admin?.adverts || [] : []).map((advert) => ({
              title: advert.title,
              meta: `${advert.seller} · ${advert.status} · ${advert.fee}`,
              action: (
                <span className="row-actions wrap">
                  <button className="text-action" type="button" onClick={() => workspaceActions.markAdvertPaid(advert.id)}>Paid</button>
                  <button className="text-action" type="button" onClick={() => workspaceActions.approveAdvert(advert.id)}>Approve</button>
                  <button className="text-action danger" type="button" onClick={() => workspaceActions.rejectAdvert(advert.id)}>Reject</button>
                </span>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Users</h3>
          <DataList
            empty={isAdmin ? "No users found." : "Admin login required."}
            items={(isAdmin ? admin?.users || [] : []).slice(0, 8).map((account) => ({
              title: account.name,
              meta: `${account.email} · ${account.role} · ${account.status}`,
              action: account.role === "admin" ? null : account.status === "suspended" ? (
                <button className="text-action" type="button" onClick={() => workspaceActions.activateUser(account.id)}>Activate</button>
              ) : (
                <button className="text-action danger" type="button" onClick={() => workspaceActions.suspendUser(account.id)}>Suspend</button>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Seller emails</h3>
          <DataList
            empty={isAdmin ? "No seller emails queued yet." : "Admin login required."}
            items={emailNotifications.map((email) => ({
              title: email.subject,
              meta: `${email.toEmail} · ${email.status} · ${email.error || formatDate(email.createdAt)}`,
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Reports</h3>
          <DataList
            empty={isAdmin ? "No reports waiting." : "Admin login required."}
            items={reports.slice(0, 6).map((report) => ({
              title: report.reason,
              meta: `${report.targetType} · ${report.status}`,
              action: (
                <span className="row-actions">
                  <button className="text-action" type="button" onClick={() => workspaceActions.reviewReport(report.id)}>Review</button>
                  <button className="text-action" type="button" onClick={() => workspaceActions.resolveReport(report.id)}>Resolve</button>
                </span>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Disputes</h3>
          <DataList
            empty={isAdmin ? "No disputes waiting." : "Admin login required."}
            items={disputes.slice(0, 6).map((dispute) => ({
              title: dispute.reason,
              meta: `${dispute.orderId} · ${dispute.status}`,
              action: <button className="text-action" type="button" onClick={() => workspaceActions.resolveDispute(dispute.id)}>Resolve</button>,
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Payments and payouts</h3>
          <DataList
            empty={isAdmin ? "No payment records yet." : "Admin login required."}
            items={[
              ...payments.slice(0, 4).map((payment) => ({
                title: `${payment.orderId || payment.id} payment`,
                meta: `${payment.provider} · ${payment.status} · ${moneyFromCents(payment.amountCents || 0)}`,
              })),
              ...payouts.slice(0, 4).map((payout) => ({
                title: `${payout.sellerProfileId} payout`,
                meta: `${payout.status} · ${moneyFromCents(payout.amountCents || 0)} · ${formatDate(payout.scheduledFor || payout.createdAt)}`,
              })),
            ]}
          />
        </section>
        <section className="table-panel">
          <h3>Audit logs</h3>
          <DataList
            empty={isAdmin ? "No admin activity recorded." : "Admin login required."}
            items={auditLogs.slice(0, 8).map((log) => ({
              title: log.action.replaceAll("_", " "),
              meta: `${log.targetType} · ${formatDate(log.createdAt)}`,
            }))}
          />
        </section>
      </div>
    </PanelPage>
  );
}

function AdminControlCenter({
  auditLogs,
  disputes,
  emailNotifications,
  integrations,
  payments,
  payouts,
  pendingListings,
  pendingSellers,
  reports,
}) {
  const googleReady = Boolean(
    integrations.googleConfigured
    && integrations.googleClientIdFormatValid
    && integrations.googleRedirectUriConfigured,
  );
  const googleDetail = !integrations.googleClientIdConfigured
    ? "Client ID missing"
    : !integrations.googleClientIdFormatValid
      ? "Client ID format needs review"
      : !integrations.googleClientSecretConfigured
        ? "Client secret missing"
        : !integrations.googleRedirectUriConfigured
          ? "Redirect URI missing"
          : "Client, secret, and redirect saved";
  const emailReady = Boolean(
    integrations.emailConfigured
    && integrations.resendApiKeyConfigured
    && integrations.resendFromEmailConfigured,
  );

  const controls = [
    {
      icon: Package,
      label: "Listing approvals",
      value: pendingListings.length,
      detail: pendingListings.length ? "Needs admin review" : "Queue clear",
      ready: pendingListings.length === 0,
    },
    {
      icon: UserCheck,
      label: "Seller verification",
      value: pendingSellers.length,
      detail: pendingSellers.length ? "KYC waiting" : "No seller KYC queue",
      ready: pendingSellers.length === 0,
    },
    {
      icon: LogIn,
      label: "Google login",
      value: googleReady ? "Ready" : "Check",
      detail: googleDetail,
      ready: googleReady,
    },
    {
      icon: Send,
      label: "Seller emails",
      value: emailReady ? "Ready" : "Off",
      detail: emailReady ? "Resend sender configured" : "Add Resend key and sender",
      ready: emailReady,
    },
    {
      icon: CreditCard,
      label: "Payments",
      value: integrations.paymentConfigured ? "Ready" : "Manual",
      detail: integrations.paymentConfigured ? integrations.paymentProvider : "Provider not configured",
      ready: Boolean(integrations.paymentConfigured),
    },
    {
      icon: Flag,
      label: "Trust queue",
      value: reports.length + disputes.length,
      detail: `${reports.length} reports · ${disputes.length} disputes`,
      ready: reports.length + disputes.length === 0,
    },
    {
      icon: WalletCards,
      label: "Payout ledger",
      value: payouts.length,
      detail: `${payments.length} payments tracked`,
      ready: true,
    },
    {
      icon: ShieldCheck,
      label: "Audit trail",
      value: auditLogs.length,
      detail: `${emailNotifications.length} email records`,
      ready: true,
    },
  ];

  return (
    <section className="admin-control-grid" aria-label="Admin control center">
      {controls.map(({ detail, icon: Icon, label, ready, value }) => (
        <article className="control-card" key={label}>
          <span className={ready ? "control-icon ready" : "control-icon attention"}><Icon size={20} /></span>
          <div>
            <small>{label}</small>
            <strong>{value}</strong>
            <p>{detail}</p>
          </div>
          <em className={ready ? "control-status ready" : "control-status attention"}>{ready ? "OK" : "Action"}</em>
        </article>
      ))}
    </section>
  );
}

function ReportsPage({ platform, user, workspaceActions }) {
  const admin = platform?.admin;
  const isAdmin = user?.role === "admin";

  return (
    <PanelPage eyebrow="Reports" title="Reports, disputes, and audit trail">
      <div className="split-grid">
        <section className="table-panel">
          <h3>Reports</h3>
          <DataList
            empty={isAdmin ? "No open reports." : "Admin login required."}
            items={(isAdmin ? admin?.reports || [] : []).map((report) => ({
              title: report.reason,
              meta: `${report.targetType} · ${report.status}`,
              action: (
                <span className="row-actions">
                  <button className="text-action" type="button" onClick={() => workspaceActions.reviewReport(report.id)}>Review</button>
                  <button className="text-action" type="button" onClick={() => workspaceActions.resolveReport(report.id)}>Resolve</button>
                </span>
              ),
            }))}
          />
        </section>
        <section className="table-panel">
          <h3>Disputes</h3>
          <DataList
            empty={isAdmin ? "No disputes." : "Admin login required."}
            items={(isAdmin ? admin?.disputes || [] : []).map((dispute) => ({
              title: dispute.reason,
              meta: `${dispute.orderId} · ${dispute.status}`,
              action: <button className="text-action" type="button" onClick={() => workspaceActions.resolveDispute(dispute.id)}>Resolve</button>,
            }))}
          />
        </section>
        <section className="table-panel span-2">
          <h3>Audit log</h3>
          <DataList
            empty="No audit logs visible."
            items={(admin?.auditLogs || []).map((log) => ({
              title: log.action,
              meta: `${log.targetType} · ${formatDate(log.createdAt)}`,
            }))}
          />
        </section>
      </div>
    </PanelPage>
  );
}

function CategoryRail({ onSelect }) {
  return (
    <nav className="category-rail" aria-label="Marketplace categories">
      {categoryTabs.map(({ label, icon: Icon, tone }, index) => (
        <button className={index === 0 ? `category-pill ${tone} active` : `category-pill ${tone}`} key={label} type="button" onClick={() => onSelect(label)}>
          <Icon size={26} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function AdvertCarousel({ adverts = [], onOpenListing }) {
  const items = adverts.length
    ? adverts
    : [
        {
          id: "fallback_advert",
          title: "Promote trusted sellers in Dunkwa-on-Offin",
          body: "Admin-approved paid adverts will scroll here when sellers request promotion.",
          seller: "ShopLink",
          image: "/images/tomatoes.png",
          listingId: null,
        },
      ];
  const carouselItems = [...items, ...items];

  return (
    <section className="advert-carousel" aria-label="Promoted adverts">
      <div className="advert-track">
        {carouselItems.map((advert, index) => (
          <button
            className="advert-card"
            key={`${advert.id}-${index}`}
            type="button"
            onClick={() => advert.listingId && onOpenListing(advert.listingId)}
          >
            <img src={advert.image} alt="" />
            <span>
              <small><Megaphone size={14} /> Sponsored by {advert.seller}</small>
              <strong>{advert.title}</strong>
              <em>{advert.body}</em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReviewTicker({ reviews = [] }) {
  if (!reviews.length) {
    return <p className="subtle">Buyer reviews will appear after completed orders.</p>;
  }

  return (
    <div className="review-ticker">
      {reviews.slice(0, 4).map((review) => (
        <article key={review.id}>
          <RatingPill rating={review.rating} />
          <strong>{review.listingTitle}</strong>
          <p>{review.comment}</p>
          <small>{review.reviewer} · {review.seller}</small>
        </article>
      ))}
    </div>
  );
}

function ListingGrid({ emptyText = "No matching listings found.", listings, onAddToCart, onOpenDetails, onToggleSaved, saved }) {
  if (!listings.length) {
    return <EmptyState icon={Search} title="Nothing here yet" copy={emptyText} />;
  }

  return (
    <div className="listing-grid">
      {listings.map((listing, index) => (
        <ListingCard
          index={index}
          isSaved={saved.has(listing.id)}
          key={listing.id}
          listing={listing}
          onAddToCart={() => onAddToCart(listing)}
          onOpenDetails={() => onOpenDetails(listing)}
          onToggleSaved={() => onToggleSaved(listing.id)}
        />
      ))}
    </div>
  );
}

function ListingCard({ index, isSaved, listing, onAddToCart, onOpenDetails, onToggleSaved }) {
  return (
    <article className="listing-card" style={{ "--delay": `${Math.min(index, 8) * 45}ms` }}>
      <button className="listing-media" type="button" onClick={onOpenDetails}>
        <img src={listing.image} alt="" />
        <span className="view-overlay">
          <Eye size={16} />
          View
        </span>
      </button>
      <button
        className={isSaved ? "save-button active" : "save-button"}
        type="button"
        aria-label={isSaved ? `Unsave ${listing.title}` : `Save ${listing.title}`}
        onClick={onToggleSaved}
      >
        <Heart size={23} fill={isSaved ? "currentColor" : "none"} />
      </button>
      <div className="listing-body">
        <div className="price-line">
          <strong>{listing.price}</strong>
          <RatingPill rating={listing.rating} />
        </div>
        <h2>{listing.title}</h2>
        {listing.status === "pending_review" ? <span className="status-pill">Pending review</span> : null}
        <div className="seller-line">
          <SellerAvatar name={listing.seller} initials={listing.sellerInitials} small />
          <span>{listing.seller}</span>
          {listing.verified ? <VerifiedBadge /> : null}
        </div>
        <div className="listing-meta">
          <span><MapPin size={14} /> {listing.distance || listing.location}</span>
          <span>{listing.stock ?? "Service"} available</span>
        </div>
        <button className="card-action" type="button" onClick={onAddToCart}>
          {listing.listingType === "service" ? "Book now" : "Add to cart"}
        </button>
      </div>
    </article>
  );
}

function RightRail({ featuredSellers, listings, platform, serviceQueue, user }) {
  const verifiedCount = featuredSellers.length;
  const recent = [
    featuredSellers[0] ? `${featuredSellers[0].name} is verified` : "Seller verification active",
    platform?.buyer?.orders?.[0] ? `Order placed for ${platform.buyer.orders[0].listingTitle}` : "Orders ready",
    platform?.buyer?.messages?.[0] ? "New marketplace message" : "Messaging available",
    listings[0] ? `${listings[0].seller} added ${listings[0].title}` : "Listings ready",
  ];

  return (
    <aside className="right-rail">
      <section className="trust-card">
        <div className="rail-title">
          <h2>Verified sellers</h2>
          <button type="button">View all</button>
        </div>
        <div className="verified-score">
          <span><ShieldCheck size={48} /></span>
          <strong>{verifiedCount}</strong>
          <p>trusted seller{verifiedCount === 1 ? "" : "s"} in your area</p>
        </div>
        <ul className="trust-list">
          <li><ShieldCheck size={18} /> ID verified</li>
          <li><Star size={18} /> Community reviews</li>
          <li><UserCheck size={18} /> Reliable support</li>
        </ul>
      </section>

      <section className="activity-card">
        <h2>Recent activity</h2>
        {recent.map((item, index) => (
          <div className="activity-row" key={item}>
            <span className={`activity-icon tone-${index}`}><ActivityIcon index={index} /></span>
            <p>{item}<small>{index + 1}h ago</small></p>
          </div>
        ))}
      </section>

      <section className="activity-card compact">
        <h2>Service queue</h2>
        {serviceQueue.slice(0, 3).map((service) => (
          <div className="mini-service" key={service.title}>
            <strong>{service.title}</strong>
            <span>{service.price} · {service.status}</span>
          </div>
        ))}
        <p className="rail-user">{user ? `${user.name}, your workspace is active.` : "Log in for buyer and seller tools."}</p>
      </section>
    </aside>
  );
}

function ActivityIcon({ index }) {
  const icons = [Store, ShoppingCart, MessageSquareText, Heart];
  const Icon = icons[index] || Sparkles;
  return <Icon size={20} />;
}

function OperationsStrip({ cart, onPostListing, platform, schema, setActivePage }) {
  const stats = platform?.stats || {};
  return (
    <section className="operations-strip">
      <div className="operations-lead">
        <span><ShieldCheck size={32} /></span>
        <p><strong>ShopLink operations</strong>Community health and platform insights</p>
      </div>
      <div className="operation-stat">
        <small>Active listings</small>
        <strong>{stats.listings ?? schema?.listings ?? 0}</strong>
        <em>+ live</em>
      </div>
      <div className="operation-stat">
        <small>New users</small>
        <strong>{stats.users ?? schema?.users ?? 0}</strong>
        <em>+ ready</em>
      </div>
      <div className="operation-stat">
        <small>Orders</small>
        <strong>{stats.activeOrders ?? 0}</strong>
        <em>tracking</em>
      </div>
      <div className="operation-stat">
        <small>Cart</small>
        <strong>{cart.subtotal}</strong>
        <em>{cart.count} items</em>
      </div>
      <div className="operation-actions">
        <button className="admin-button" type="button" onClick={() => setActivePage("Admin")}><Settings size={18} /> Admin</button>
        <button className="reports-button" type="button" onClick={() => setActivePage("Reports")}><BarChart3 size={18} /> Reports</button>
        <button className="reports-button mobile-hide" type="button" onClick={onPostListing}><Plus size={18} /> Sell</button>
      </div>
    </section>
  );
}

function PanelPage({ action, children, eyebrow, title }) {
  return (
    <section className="panel-page">
      <div className="panel-heading">
        <span>{eyebrow}</span>
        <div>
          <h2>{title}</h2>
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

function SectionTitle({ action, onAction, title }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action ? <button type="button" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

function FilterButton() {
  return (
    <button className="outline-action" type="button">
      <SlidersHorizontal size={17} />
      Filters
    </button>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <section className="metric-card">
      <span><Icon size={22} /></span>
      <small>{label}</small>
      <strong>{value}</strong>
    </section>
  );
}

function PolicyCard({ copy, icon: Icon, title }) {
  return (
    <article className="policy-card">
      <span><Icon size={24} /></span>
      <strong>{title}</strong>
      <p>{copy}</p>
    </article>
  );
}

function DataList({ empty = "Nothing here yet.", items = [] }) {
  if (!items.length) {
    return <p className="subtle">{empty}</p>;
  }

  return (
    <div className="data-list">
      {items.map((item, index) => (
        <div className="data-row" key={`${item.title}-${index}`}>
          <span>
            <strong>{item.title}</strong>
            <small>{item.meta}</small>
          </span>
          {item.action}
        </div>
      ))}
    </div>
  );
}

function NoticeStack({ error, notice, onClearError, onClearNotice }) {
  return (
    <>
      {error ? (
        <div className="notice error" role="alert">
          <X size={16} />
          <span>{error}</span>
          <button type="button" onClick={onClearError} aria-label="Dismiss error"><X size={15} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="notice" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button type="button" onClick={onClearNotice} aria-label="Dismiss notice"><X size={15} /></button>
        </div>
      ) : null}
    </>
  );
}

function LoadingState() {
  return <EmptyState icon={Sparkles} title="Loading ShopLink" copy="Fetching marketplace records." />;
}

function EmptyState({ copy, icon: Icon, title }) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

function PostListingDrawer({
  draft,
  formCategories,
  isOpen,
  isSubmitting,
  isUploadingImages,
  listingType,
  onClose,
  onDraftChange,
  onPhotoUpload,
  onListingTypeChange,
  onSubmit,
}) {
  const uploadedImages = draft.images || [];

  return (
    <>
      <div className={isOpen ? "drawer-scrim open" : "drawer-scrim"} onClick={onClose} />
      <aside className={isOpen ? "post-drawer open" : "post-drawer"} aria-hidden={!isOpen}>
        <div className="drawer-header">
          <span>
            <small>Seller workspace</small>
            <h2>Post a listing</h2>
          </span>
          <button className="round-icon" type="button" aria-label="Close listing drawer" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="segmented-control" role="tablist" aria-label="Listing type">
            {["Product", "Service"].map((type) => (
              <button
                key={type}
                className={listingType === type ? "segment active" : "segment"}
                type="button"
                role="tab"
                aria-selected={listingType === type}
                onClick={() => onListingTypeChange(type)}
              >
                {type === "Product" ? <Package size={18} /> : <BriefcaseBusiness size={18} />}
                {type}
              </button>
            ))}
          </div>

          <Field label="Listing title">
            <input
              value={draft.title}
              onChange={(event) => onDraftChange("title", event.target.value)}
              placeholder="Fresh plantain, phone repair, delivery help..."
              required
            />
          </Field>

          <Field label="Category">
            <select value={draft.category} onChange={(event) => onDraftChange("category", event.target.value)}>
              {formCategories.map((category) => (
                <option key={category.id}>{category.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Price">
            <div className="price-input">
              <span>GH₵</span>
              <input
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => onDraftChange("price", event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </Field>

          {listingType === "Product" ? (
            <Field label="Stock quantity">
              <input
                inputMode="numeric"
                min="0"
                type="number"
                value={draft.stock}
                onChange={(event) => onDraftChange("stock", event.target.value)}
              />
            </Field>
          ) : null}

          <Field label="Description">
            <textarea
              rows={4}
              value={draft.description}
              onChange={(event) => onDraftChange("description", event.target.value)}
              placeholder="Describe condition, delivery, service time, and any buyer requirements."
            />
          </Field>

          <div className="field-block">
            <span className="field-label">Photos</span>
            <div className="photo-row">
              <label className="upload-box">
                <Upload size={24} />
                <span>{isUploadingImages ? "Uploading..." : "Upload photos"}</span>
                <small>JPG, PNG, or WebP · 5 MB max</small>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  type="file"
                  disabled={isUploadingImages}
                  onChange={(event) => {
                    onPhotoUpload(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              {(uploadedImages.length ? uploadedImages : [{ url: listingType === "Product" ? "/images/tomatoes.png" : "/images/phone-repair.png" }])
                .slice(0, 3)
                .map((image, index) => (
                  <button
                    className={index === 0 ? "photo-thumb selected" : "photo-thumb"}
                    type="button"
                    aria-label={index === 0 ? "Primary listing photo" : "Listing photo"}
                    key={image.id || image.url}
                  >
                    <img src={image.url} alt="" />
                    {index === 0 ? <Check size={18} /> : null}
                  </button>
                ))}
              {uploadedImages.length < 1 ? (
                <button className="photo-thumb" type="button" aria-label="Add listing photo">
                  <ImagePlus size={25} />
                </button>
              ) : null}
            </div>
          </div>

          <Field label="Pickup or delivery">
            <select value={draft.fulfillment} onChange={(event) => onDraftChange("fulfillment", event.target.value)}>
              <option>Pickup only</option>
              <option>Delivery available</option>
              <option>Pickup or delivery</option>
              <option>Buyer chooses</option>
            </select>
          </Field>

          <Field label="Location">
            <input value={draft.location} onChange={(event) => onDraftChange("location", event.target.value)} />
          </Field>

          <Field label="Seller visibility">
            <select value={draft.visibility} onChange={(event) => onDraftChange("visibility", event.target.value)}>
              <option>Public</option>
              <option>Community members only</option>
              <option>Hidden until approved</option>
            </select>
          </Field>

          <div className="drawer-actions">
            <button className="outline-action wide" type="button" onClick={onClose}>Save draft</button>
            <button className="solid-action wide" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Publish listing"}
              <ChevronRight size={18} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function AuthModal({
  authDraft,
  authMode,
  integrations,
  isOpen,
  isSubmitting,
  onAuthDraftChange,
  onClose,
  onModeChange,
  onPasswordReset,
  onSubmit,
}) {
  return (
    <>
      <div className={isOpen ? "drawer-scrim open" : "drawer-scrim"} onClick={onClose} />
      <section className={isOpen ? "auth-modal open" : "auth-modal"} aria-hidden={!isOpen}>
        <div className="drawer-header">
          <span>
            <small>ShopLink account</small>
            <h2>{authMode === "login" ? "Sign in" : "Create account"}</h2>
          </span>
          <button className="round-icon" type="button" aria-label="Close sign in" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <button
          className="google-action"
          type="button"
          disabled={!integrations?.googleConfigured}
          onClick={() => {
            window.location.href = "/api/auth/google/start";
          }}
        >
          <LogIn size={18} />
          Continue with Google
        </button>
        {!integrations?.googleConfigured ? <p className="auth-provider-note">Google login is ready. Add Google client keys before using it live.</p> : null}

        <form onSubmit={onSubmit}>
          <div className="segmented-control" role="tablist" aria-label="Authentication mode">
            <button className={authMode === "login" ? "segment active" : "segment"} type="button" role="tab" aria-selected={authMode === "login"} onClick={() => onModeChange("login")}>Sign in</button>
            <button className={authMode === "register" ? "segment active" : "segment"} type="button" role="tab" aria-selected={authMode === "register"} onClick={() => onModeChange("register")}>Register</button>
          </div>

          {authMode === "register" ? (
            <Field label="Name">
              <input value={authDraft.name} onChange={(event) => onAuthDraftChange("name", event.target.value)} required />
            </Field>
          ) : null}

          <Field label="Email">
            <input type="email" value={authDraft.email} onChange={(event) => onAuthDraftChange("email", event.target.value)} required />
          </Field>

          <Field label="Password">
            <input type="password" value={authDraft.password} onChange={(event) => onAuthDraftChange("password", event.target.value)} required />
          </Field>

          {authMode === "register" ? (
            <>
              <Field label="Account role">
                <select value={authDraft.role} onChange={(event) => onAuthDraftChange("role", event.target.value)}>
                  <option value="buyer">Buyer</option>
                  <option value="seller">Seller</option>
                </select>
              </Field>
              {authDraft.role === "seller" ? (
                <Field label="Shop name">
                  <input value={authDraft.shopName} onChange={(event) => onAuthDraftChange("shopName", event.target.value)} required />
                </Field>
              ) : null}
            </>
          ) : null}

          <button className="solid-action wide" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account"}
          </button>
          {authMode === "login" ? (
            <button className="text-action auth-reset-action" type="button" disabled={isSubmitting} onClick={onPasswordReset}>
              Forgot password
            </button>
          ) : null}
        </form>
      </section>
    </>
  );
}

function ListingDetailDrawer({ followingSellers, isSaved, listing, onAddToCart, onClose, onReport, onToggleSaved, onToggleSellerFollow }) {
  const isFollowing = listing?.sellerProfileId ? followingSellers.has(listing.sellerProfileId) || listing.isFollowingSeller : false;

  return (
    <>
      <div className={listing ? "drawer-scrim open" : "drawer-scrim"} onClick={onClose} />
      <aside className={listing ? "detail-drawer open" : "detail-drawer"} aria-hidden={!listing}>
        {listing ? (
          <>
            <div className="drawer-header">
              <span>
                <small>{listing.seller}</small>
                <h2>{listing.title}</h2>
              </span>
              <button className="round-icon" type="button" onClick={onClose} aria-label="Close listing details"><X size={22} /></button>
            </div>
            <img className="detail-image" src={listing.image} alt="" />
            <div className="detail-price">
              <strong>{listing.price}</strong>
              <RatingPill rating={listing.rating} />
            </div>
            <div className="seller-follow-row">
              <SellerAvatar name={listing.seller} initials={listing.sellerInitials} />
              <span>
                <strong>{listing.seller}</strong>
                <small>{listing.sellerFollowers || 0} follower{listing.sellerFollowers === 1 ? "" : "s"} · {listing.verified ? "Verified" : "Pending verification"}</small>
              </span>
              <button className={isFollowing ? "outline-action active" : "outline-action"} type="button" disabled={!listing.sellerProfileId} onClick={() => onToggleSellerFollow(listing.sellerProfileId)}>
                <UserPlus size={17} />
                {isFollowing ? "Following" : "Follow"}
              </button>
            </div>
            <p>{listing.description || "Contact the seller for more details about this offer."}</p>
            <div className="detail-facts">
              <span><MapPin size={17} /> {listing.location || marketLocation}</span>
              <span><Truck size={17} /> {(listing.deliveryOptions || []).join(", ") || "Pickup or delivery"}</span>
              <span><Package size={17} /> {listing.stock ?? "Service booking"}</span>
            </div>
            <div className="drawer-actions">
              <button className="outline-action wide" type="button" onClick={() => onToggleSaved(listing)}>
                <Heart size={17} fill={isSaved ? "currentColor" : "none"} />
                {isSaved ? "Saved" : "Save"}
              </button>
              <button className="solid-action wide" type="button" onClick={() => onAddToCart(listing)}>
                {listing.listingType === "service" ? <CalendarClock size={18} /> : <ShoppingCart size={18} />}
                {listing.listingType === "service" ? "Book service" : "Add to cart"}
              </button>
            </div>
            <section className="detail-reviews">
              <h3>Buyer reviews</h3>
              <DataList
                empty="No reviews for this listing yet."
                items={(listing.reviews || []).map((review) => ({
                  title: `${review.rating} stars from ${review.reviewer}`,
                  meta: `${review.comment} · ${formatDate(review.createdAt)}`,
                }))}
              />
            </section>
            <button className="report-link" type="button" onClick={() => onReport(listing)}>
              <Flag size={16} />
              Report listing
            </button>
          </>
        ) : null}
      </aside>
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="field-block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function SellerAvatar({ name, initials, small = false }) {
  return <span className={`avatar ${small ? "small" : ""}`}>{initials || initialsFor(name)}</span>;
}

function VerifiedBadge() {
  return (
    <span className="verified" aria-label="Verified seller">
      <Check size={12} />
    </span>
  );
}

function RatingPill({ rating }) {
  return (
    <span className="rating-pill">
      <Star size={14} fill="currentColor" />
      {rating || "New"}
    </span>
  );
}

function optimisticToggle(current, id) {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function categoryMatches(listing, category) {
  if (category === "All") {
    return true;
  }
  if (category === "For sale") {
    return listing.listingType === "product";
  }
  if (category === "Services") {
    return listing.listingType === "service";
  }
  const haystack = `${listing.title} ${listing.sellerType} ${listing.type}`.toLowerCase();
  const normalized = category.toLowerCase().replace("home & garden", "home").replace("jobs", "job");
  return haystack.includes(normalized.split(" ")[0]);
}

function deliveryOptionsFor(fulfillment) {
  if (fulfillment === "Delivery available") {
    return ["Pickup", "Seller delivery"];
  }
  if (fulfillment === "Buyer chooses" || fulfillment === "Pickup or delivery") {
    return ["Pickup", "Seller delivery"];
  }
  return ["Pickup"];
}

function trackingStepActive(current, step) {
  const order = ["new", "opened", "preparing", "ready_for_pickup", "out_for_delivery", "delivered"];
  const currentIndex = order.indexOf(current || "new");
  const stepIndex = order.indexOf(step);
  return stepIndex <= Math.max(0, currentIndex);
}

function initialsFor(name = "") {
  return name
    .split(" ")
    .filter((part) => /^[a-z]/i.test(part))
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SL";
}

function formatDate(value) {
  if (!value) {
    return "Today";
  }
  return new Intl.DateTimeFormat("en-GH", { month: "short", day: "numeric" }).format(new Date(value));
}

function moneyFromCents(cents) {
  return `GH₵${(Number(cents || 0) / 100).toFixed(2)}`;
}

function centsToAmount(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

export default App;
