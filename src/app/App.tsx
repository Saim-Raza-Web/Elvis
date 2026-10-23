import { useState, useEffect, lazy, Suspense } from "react";
import { Plus } from "lucide-react";
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
const Settings = lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));
const ActivityLog = lazy(() => import("./components/ActivityLog").then(m => ({ default: m.ActivityLog })));
const Admin = lazy(() => import("./components/Admin").then(m => ({ default: m.Admin })));
const Incidents = lazy(() => import("./components/Incidents").then(m => ({ default: m.Incidents })));
const StockCount = lazy(() => import("./components/StockCount").then(m => ({ default: m.StockCount })));
const QCWorkspace = lazy(() => import("./components/QCWorkspace").then(m => ({ default: m.QCWorkspace })));
const PutawayQueue = lazy(() => import("./components/PutawayQueue").then(m => ({ default: m.PutawayQueue })));
const ClientPortal = lazy(() => import("./components/ClientPortal").then(m => ({ default: m.ClientPortal })));
const RecallManagement = lazy(() => import("./components/RecallManagement").then(m => ({ default: m.RecallManagement })));

// Screen states
type Screen = "home" | "login" | "app";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
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

  // Restore session from localStorage via authService & check URL query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPage = params.get("page") as Page | null;
    if (urlPage) {
      setCurrentPage(urlPage);
    }
    authService.isAuthenticated().then((authed) => {
      if (authed) {
        setScreen("app");
      }
    });
  }, []);

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
      case "dashboard": return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
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
      default: return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
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
      <RouteErrorBoundary fallbackTitle={`Error Loading ${p.title}`}>
        <Suspense fallback={<RouteLoadingFallback pageName={p.title} />}>
          {renderPage()}
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}
