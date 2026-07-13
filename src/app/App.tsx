import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { Toaster } from "sonner";
import { AppShell, PrimaryButton } from "./components/AppShell";
import type { Page } from "./components/AppShell";
import { LangProvider, useLang } from "./LangContext";
import type { Lang } from "./i18n";
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

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [isDark, setIsDark] = useState(true);
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

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
      />
    </LangProvider>
  );
}

function AppInner({
  currentPage, setCurrentPage, isDark, setIsDark, lang, setLang,
}: {
  currentPage: Page;
  setCurrentPage: (p: Page) => void;
  isDark: boolean;
  setIsDark: (v: boolean) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  const { t } = useLang();
  const p = t.pages[currentPage as keyof typeof t.pages] ?? { title: currentPage, sub: "" };

  const pageActions: Partial<Record<Page, React.ReactNode>> = {
    warehouses: <PrimaryButton icon={Plus}>{t.warehouses.addWarehouse}</PrimaryButton>,
    locations: <PrimaryButton icon={Plus}>{t.locations.addLocation}</PrimaryButton>,
    inventory: <PrimaryButton icon={Plus}>{t.inventory.addProduct}</PrimaryButton>,
    receiving: <PrimaryButton icon={Plus}>{t.receiving.newASN}</PrimaryButton>,
    transfers: <PrimaryButton icon={Plus}>{t.transfers.newTransfer}</PrimaryButton>,
    orders: <PrimaryButton icon={Plus}>{t.orders.newOrder}</PrimaryButton>,
    ecommerce: <PrimaryButton icon={Plus}>{t.ecommerce.connectChannel}</PrimaryButton>,
    shipping: <PrimaryButton icon={Plus}>{t.shipping.newShipment}</PrimaryButton>,
    carriers: <PrimaryButton icon={Plus}>{t.carriers.addCarrier}</PrimaryButton>,
    returns: <PrimaryButton icon={Plus}>{t.returns.createReturn}</PrimaryButton>,
    crm: <PrimaryButton icon={Plus}>{t.crm.addCustomer}</PrimaryButton>,
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
    >
      {renderPage()}
    </AppShell>
  );
}
