import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { Toaster } from "sonner";
import { AppShell, PrimaryButton } from "./components/AppShell";
import type { Page } from "./components/AppShell";
import { LangProvider, useLang } from "./LangContext";
import type { Lang } from "./i18n";
import { HomePage } from "./components/HomePage";
import { LoginPage } from "./components/LoginPage";
import { Dashboard } from "./components/Dashboard";
import { Warehouses } from "./components/Warehouses";
import { Locations } from "./components/Locations";
import { Inventory } from "./components/Inventory";
import { Receiving } from "./components/Receiving";
import { Transfers } from "./components/Transfers";
import { Picking } from "./components/Picking";
import { Packing } from "./components/Packing";
import { Orders } from "./components/Orders";
import { Ecommerce } from "./components/Ecommerce";
import { Shipping } from "./components/Shipping";
import { Carriers } from "./components/Carriers";
import { Returns } from "./components/Returns";
import { CRM } from "./components/CRM";
import { Billing } from "./components/Billing";
import { Accounting } from "./components/Accounting";
import { Reports } from "./components/Reports";
import { Subscription } from "./components/Subscription";
import { Settings } from "./components/Settings";
import { ActivityLog } from "./components/ActivityLog";
import { Admin } from "./components/Admin";
import { authService } from "../services/auth.service";

// Screen states
type Screen = "home" | "login" | "app";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [isDark, setIsDark] = useState(true);
  const [lang, setLang] = useState<Lang>("en");

  // Restore session from localStorage via authService
  useEffect(() => {
    if (authService.isAuthenticated()) {
      setScreen("app");
    }
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
        <Toaster position="bottom-right" richColors />
        <HomePage
          lang={lang}
          setLang={setLang}
          onLogin={() => { setLoginMode("login"); setScreen("login"); }}
          onEnterApp={() => { setLoginMode("signup"); setScreen("login"); }}
        />
      </LangProvider>
    );
  }

  if (screen === "login") {
    return (
      <LangProvider lang={lang}>
        <Toaster position="bottom-right" richColors />
        <LoginPage
          lang={lang}
          setLang={setLang}
          initialMode={loginMode}
          onSuccess={handleLoginSuccess}
          onBack={() => setScreen("home")}
        />
      </LangProvider>
    );
  }

  return (
    <LangProvider lang={lang}>
      <Toaster position="bottom-right" richColors />
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
  };

  function renderPage() {
    switch (currentPage) {
      case "dashboard": return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
      case "warehouses": return <Warehouses />;
      case "locations": return <Locations />;
      case "inventory": return <Inventory />;
      case "receiving": return <Receiving />;
      case "transfers": return <Transfers />;
      case "picking": return <Picking />;
      case "packing": return <Packing />;
      case "orders": return <Orders />;
      case "ecommerce": return <Ecommerce />;
      case "shipping": return <Shipping />;
      case "carriers": return <Carriers />;
      case "returns": return <Returns />;
      case "crm": return <CRM />;
      case "billing": return <Billing />;
      case "accounting": return <Accounting />;
      case "reports": return <Reports />;
      case "subscription": return <Subscription />;
      case "settings": return <Settings />;
      case "activity": return <ActivityLog />;
      case "admin": return <Admin />;
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
      {renderPage()}
    </AppShell>
  );
}
