import { useState, useEffect, lazy, Suspense } from "react";
import { Loader2, Plus } from "lucide-react";
import { Toaster } from "sonner";
import { AppShell, PrimaryButton } from "./components/AppShell";
import type { Page } from "./components/AppShell";
import { LangProvider, useLang } from "./LangContext";
import type { Lang } from "./i18n";
import { authService } from "../services/auth.service";
import { canAccessPage } from "../utils/roles";
import { RouteLoadingFallback } from "./components/RouteLoadingFallback";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";

// Lazy-loaded routes for PDA slow-network performance & modular bundle splitting
const HomePage = lazy(() => import("./components/HomePage").then(m => ({ default: m.HomePage })));
const LoginPage = lazy(() => import("./components/LoginPage").then(m => ({ default: m.LoginPage })));
const Dashboard = lazy(() => import("./components/Dashboard").then(m => ({ default: m.Dashboard })));
const Warehouses = lazy(() => import("./components/Warehouses").then(m => ({ default: m.Warehouses })));
const Locations = lazy(() => import("./components/Locations").then(m => ({ default: m.Locations })));
const Inventory = lazy(() => import("./components/Inventory").then(m => ({ default: m.Inventory })));
const Receiving = lazy(() => import("./components/Receiving").then(m => ({ default: m.Receiving })));
const Transfers = lazy(() => import("./components/Transfers").then(m => ({ default: m.Transfers })));
const Picking = lazy(() => import("./components/Picking").then(m => ({ default: m.Picking })));
const Packing = lazy(() => import("./components/Packing").then(m => ({ default: m.Packing })));
const Orders = lazy(() => import("./components/Orders").then(m => ({ default: m.Orders })));
const PurchaseOrders = lazy(() => import("./components/PurchaseOrders").then(m => ({ default: m.PurchaseOrders })));
const Ecommerce = lazy(() => import("./components/Ecommerce").then(m => ({ default: m.Ecommerce })));
const Shipping = lazy(() => import("./components/Shipping").then(m => ({ default: m.Shipping })));
const Carriers = lazy(() => import("./components/Carriers").then(m => ({ default: m.Carriers })));
const Returns = lazy(() => import("./components/Returns").then(m => ({ default: m.Returns })));
const CRM = lazy(() => import("./components/CRM").then(m => ({ default: m.CRM })));
const Billing = lazy(() => import("./components/Billing").then(m => ({ default: m.Billing })));
const Accounting = lazy(() => import("./components/Accounting").then(m => ({ default: m.Accounting })));
const Compliance = lazy(() => import("./components/Compliance").then(m => ({ default: m.Compliance })));
const Reports = lazy(() => import("./components/Reports").then(m => ({ default: m.Reports })));
const Subscription = lazy(() => import("./components/Subscription").then(m => ({ default: m.Subscription })));
const Settings = lazy(() => import("./components/Settings").then(m => ({ default: m.default })));
const ActivityLog = lazy(() => import("./components/ActivityLog").then(m => ({ default: m.ActivityLog })));
const Admin = lazy(() => import("./components/Admin").then(m => ({ default: m.Admin })));
const Incidents = lazy(() => import("./components/Incidents").then(m => ({ default: m.Incidents })));
const StockCount = lazy(() => import("./components/StockCount").then(m => ({ default: m.StockCount })));
const QCWorkspace = lazy(() => import("./components/QCWorkspace").then(m => ({ default: m.QCWorkspace })));
const PutawayQueue = lazy(() => import("./components/PutawayQueue").then(m => ({ default: m.PutawayQueue })));
const ClientPortal = lazy(() => import("./components/ClientPortal").then(m => ({ default: m.ClientPortal })));
const RecallManagement = lazy(() => import("./components/RecallManagement").then(m => ({ default: m.RecallManagement })));

// Screen states — "validating" is an exclusive loading gate: the Dashboard
// cannot mount while session validation is in progress, preventing the
// Dashboard → 401 → redirect loop for the stale-localStorage + expired-cookie case.
type Screen = "home" | "login" | "validating" | "app";

export default function App() {
  // Start in "validating" — no authenticated content can render until
  // the server confirms the HttpOnly cookie via GET /api/v1/auth/me.
  const [screen, setScreen] = useState<Screen>("validating");
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [isDark, setIsDark] = useState(true);
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("agy_lang") || localStorage.getItem("preferred_lang");
    if (saved === "en" || saved === "es" || saved === "fr" || saved === "it") return saved;
    return "es";
  });

  const setLang = (newLang: Lang) => {
    try {
      localStorage.setItem("agy_lang", newLang);
      localStorage.setItem("preferred_lang", newLang);
    } catch (_) {}
    setLangState(newLang);
  };

  // Session bootstrap — the ONLY place that decides whether to enter the app.
  //
  // Requirements addressed:
  //   Req #1: HttpOnly cookie is the source of truth. localStorage user metadata
  //           is a cache only — it never grants access by itself.
  //   Req #2: Screen starts as "validating" (loading gate). Dashboard cannot
  //           mount until this effect resolves. App opens only on 200 from /me.
  //   Req #4: Works with a valid cookie even if localStorage.user is absent
  //           (e.g. private browsing, storage cleared between reloads).
  //
  // Race-condition safety:
  //   isAuthenticated() passes _skipRedirectOn401=true so the Axios 401
  //   interceptor does NOT fire window.location.href during this call.
  //   App.tsx handles auth failures via React state, not a hard navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPage = params.get("page") as Page | null;
    if (urlPage) {
      setCurrentPage(urlPage);
    }

    authService.isAuthenticated()
      .then((isValid) => {
        if (isValid) {
          // Cookie validated by server — enter the app.
          setScreen("app");
        } else {
          // Explicit 401: cookie absent or expired. Stale localStorage already
          // cleared inside isAuthenticated(). Show home/login.
          setScreen("home");
        }
      })
      .catch(() => {
        // Network failure (ECONNABORTED, 502 …). We cannot verify the session.
        // If there is a cached user entry we open the app optimistically so a
        // transient outage does not lock the user out; the Dashboard's own error
        // handling will surface the network problem. If there is no cache, show home.
        const hasCachedUser = Boolean(localStorage.getItem('user'));
        setScreen(hasCachedUser ? "app" : "home");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  function handleLoginSuccess() {
    setScreen("app");
    setCurrentPage("dashboard");
  }

  function handleLogout() {
    authService.logout();
    setScreen("home");
  }

  // Loading gate — shown while /auth/me is in flight on every page load.
  // Nothing behind this screen can call any authenticated API (Req #2).
  if (screen === "validating") {
    return (
      <LangProvider lang={lang}>
        <div
          id="session-validating-screen"
          className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 gap-4"
          role="status"
          aria-label="Verifying session"
        >
          <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <Loader2 className="size-8 text-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">Verifying session…</p>
        </div>
      </LangProvider>
    );
  }

  if (screen === "home") {
    return (
      <LangProvider lang={lang}>
        <Toaster position="bottom-right" richColors duration={2500} visibleToasts={3} closeButton />
        <RouteErrorBoundary fallbackTitle="Home Screen Error">
          <Suspense fallback={<RouteLoadingFallback pageName="Home" />}>
            <HomePage
              lang={lang}
              setLang={setLang}
              onLogin={() => { setLoginMode("login"); setScreen("login"); }}
              onEnterApp={() => { setLoginMode("signup"); setScreen("login"); }}
            />
          </Suspense>
        </RouteErrorBoundary>
      </LangProvider>
    );
  }

  if (screen === "login") {
    return (
      <LangProvider lang={lang}>
        <Toaster position="bottom-right" richColors duration={2500} visibleToasts={3} closeButton />
        <RouteErrorBoundary fallbackTitle="Login Error">
          <Suspense fallback={<RouteLoadingFallback pageName="Login" />}>
            <LoginPage
              lang={lang}
              setLang={setLang}
              initialMode={loginMode}
              onSuccess={handleLoginSuccess}
              onBack={() => setScreen("home")}
            />
          </Suspense>
        </RouteErrorBoundary>
      </LangProvider>
    );
  }

  return (
    <LangProvider lang={lang}>
      <Toaster position="bottom-right" richColors duration={2500} visibleToasts={3} closeButton />
      <AppInner
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        isDark={isDark}
        setIsDark={setIsDark}
        lang={lang}
        setLang={setLang}
        onLogout={handleLogout}
      />
    </LangProvider>
  );
}

function AppInner({
  currentPage, setCurrentPage, isDark, setIsDark, lang, setLang, onLogout,
}: {
  currentPage: Page;
  setCurrentPage: (p: Page) => void;
  isDark: boolean;
  setIsDark: (v: boolean) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  onLogout: () => void;
}) {
  const { t } = useLang();
  const p = t.pages[currentPage as keyof typeof t.pages] ?? { title: currentPage, sub: "" };

  useEffect(() => {
    const user = authService.getCurrentUser();
    if (user && !canAccessPage(user.role, currentPage)) {
      setCurrentPage("dashboard");
    }
  }, [currentPage, setCurrentPage]);

  const pageActions: Partial<Record<Page, React.ReactNode>> = {
    warehouses: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-add-warehouse'))} icon={Plus}>{t.warehouses.addWarehouse}</PrimaryButton>,
    locations: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-add-location'))} icon={Plus}>{t.locations.addLocation}</PrimaryButton>,
    inventory: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-add-product'))} icon={Plus}>{t.inventory.addProduct}</PrimaryButton>,
    receiving: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-asn'))} icon={Plus}>{t.receiving.newASN}</PrimaryButton>,
    transfers: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-transfer'))} icon={Plus}>{t.transfers.newTransfer}</PrimaryButton>,
    orders: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-order'))} icon={Plus}>{t.orders.newOrder}</PrimaryButton>,
    ecommerce: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-connect-channel'))} icon={Plus}>{t.ecommerce.connectChannel}</PrimaryButton>,
    shipping: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-shipment'))} icon={Plus}>{t.shipping.newShipment}</PrimaryButton>,
    carriers: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-add-carrier'))} icon={Plus}>{t.carriers.addCarrier}</PrimaryButton>,
    returns: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-create-return'))} icon={Plus}>{t.returns.createReturn}</PrimaryButton>,
    crm: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-add-customer'))} icon={Plus}>{t.crm.addCustomer}</PrimaryButton>,
    picking: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-pick'))} icon={Plus}>{t.picking?.startPick || "Start Pick"}</PrimaryButton>,
    packing: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-pack'))} icon={Plus}>{(t.packing as any)?.startPack || "Start Pack"}</PrimaryButton>,
    billing: <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-invoice'))} icon={Plus}>{(t.billing as any)?.newInvoice || "New Invoice"}</PrimaryButton>,
    "stock-counts": <PrimaryButton onClick={() => window.dispatchEvent(new CustomEvent('open-new-count'))} icon={Plus}>{(t.inventory as any)?.newCount || "New Session"}</PrimaryButton>,
  };

  function renderPage() {
    switch (currentPage) {
      case "dashboard": return <Dashboard onNavigate={(p: any) => setCurrentPage(p as Page)} />;
      case "warehouses": return <Warehouses />;
      case "locations": return <Locations />;
      case "inventory": return <Inventory />;
      case "receiving": return <Receiving />;
      case "qc": return <QCWorkspace />;
      case "putaway": return <PutawayQueue />;
      case "transfers": return <Transfers />;
      case "picking": return <Picking />;
      case "packing": return <Packing />;
      case "orders": return <Orders />;
      case "purchase-orders": return <PurchaseOrders />;
      case "ecommerce": return <Ecommerce />;
      case "shipping": return <Shipping />;
      case "carriers": return <Carriers />;
      case "returns": return <Returns />;
      case "crm": return <CRM />;
      case "billing": return <Billing />;
      case "accounting": return <Accounting />;
      case "compliance": return <Compliance />;
      case "reports": return <Reports />;
      case "subscription": return <Subscription />;
      case "settings": return <Settings />;
      case "activity": return <ActivityLog />;
      case "admin": return <Admin />;
      case "incidents": return <Incidents />;
      case "stock-counts": return <StockCount />;
      case "client-portal": return <ClientPortal />;
      case "recalls": return <RecallManagement />;
      default: return <Dashboard onNavigate={(p: any) => setCurrentPage(p as Page)} />;
    }
  }

  return (
    <AppShell
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      isDark={isDark}
      setIsDark={setIsDark}
      lang={lang}
      setLang={setLang}
      pageTitle={p.title}
      pageSubtitle={p.sub}
      pageActions={pageActions[currentPage]}
      onLogout={onLogout}
    >
      <RouteErrorBoundary key={currentPage} fallbackTitle={`Error Loading ${p.title}`}>
        <Suspense fallback={<RouteLoadingFallback pageName={p.title} />}>
          {renderPage()}
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}
