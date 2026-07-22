import { useState, useEffect } from "react";
import {
  LayoutDashboard, Warehouse, Boxes, ScanLine, PackageCheck,
  ArrowRightLeft, PackageOpen, ShoppingCart, Globe, Truck,
  Building2, Undo2, Users, ReceiptText, BookOpen, BarChart3,
  CreditCard, Settings2, Menu, X, Bell, Search, Sun, Moon,
  Check, Plus, ChevronDown, LogOut, Sparkles, CheckCheck,
  MapPin, History, ShieldCheck, Globe2,
} from "lucide-react";
import type { Lang } from "../i18n";
import { useT } from "../i18n";
import { useLang } from "../LangContext";
import { authService } from "../../services/auth.service";
import { activityService } from "../../services/activity.service";

export type Page =
  | "dashboard" | "warehouses" | "locations" | "inventory" | "receiving" | "transfers" | "picking" | "packing"
  | "orders" | "ecommerce" | "shipping" | "carriers" | "returns"
  | "crm" | "billing" | "accounting" | "reports" | "subscription" | "settings"
  | "activity" | "admin";

interface NavItem {
  id: Page;
  label: string;
  icon: React.ElementType;
  badge?: string;
}
interface NavSection { label: string; items: NavItem[] }

function buildNavSections(nav: ReturnType<typeof useT>["nav"]): NavSection[] {
  return [
    {
      label: nav.sections.operations,
      items: [
        { id: "dashboard", label: nav.dashboard, icon: LayoutDashboard },
        { id: "warehouses", label: nav.warehouses, icon: Warehouse },
        { id: "locations", label: nav.locations, icon: MapPin },
        { id: "inventory", label: nav.inventory, icon: Boxes },
        { id: "receiving", label: nav.receiving, icon: PackageCheck, badge: "3" },
        { id: "transfers", label: nav.transfers, icon: ArrowRightLeft },
        { id: "picking", label: nav.picking, icon: ScanLine },
        { id: "packing", label: nav.packing, icon: PackageOpen },
      ],
    },
    {
      label: nav.sections.commerce,
      items: [
        { id: "orders", label: nav.orders, icon: ShoppingCart },
        { id: "ecommerce", label: nav.ecommerce, icon: Globe },
        { id: "shipping", label: nav.shipping, icon: Truck },
        { id: "carriers", label: nav.carriers, icon: Building2 },
        { id: "returns", label: nav.returns, icon: Undo2 },
      ],
    },
    {
      label: nav.sections.business,
      items: [
        { id: "crm", label: nav.crm, icon: Users },
        { id: "billing", label: nav.billing, icon: ReceiptText },
        { id: "accounting", label: nav.accounting, icon: BookOpen },
        { id: "reports", label: nav.reports, icon: BarChart3 },
        { id: "subscription", label: nav.subscription, icon: CreditCard },
        { id: "settings", label: nav.settings, icon: Settings2 },
      ],
    },
    {
      label: nav.sections.system,
      items: [
        { id: "activity", label: nav.activity, icon: History },
        { id: "admin", label: nav.admin, icon: ShieldCheck },
      ],
    },
  ];
}

// Removed hardcoded companies



function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

interface AppShellProps {
  currentPage: Page;
  setCurrentPage: (p: Page) => void;
  isDark: boolean;
  setIsDark: (v: boolean) => void;
  pageTitle: string;
  pageSubtitle: string;
  pageActions?: React.ReactNode;
  children: React.ReactNode;
  lang: Lang;
  setLang: (l: Lang) => void;
  onLogout?: () => void;
}

export function AppShell({
  currentPage, setCurrentPage,
  isDark, setIsDark,
  pageTitle, pageSubtitle, pageActions,
  children, lang, setLang, onLogout,
}: AppShellProps) {
  const t = useT(lang);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [companyList, setCompanyList] = useState<any[]>([]);
  const [activeCompany, setActiveCompany] = useState<any>({ name: "Loading...", role: "OWNER" });
  const [notifs, setNotifs] = useState<any[]>([]);
  const [clock, setClock] = useState(new Date().toLocaleTimeString());
  const [searchVal, setSearchVal] = useState("");
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const user = authService.getCurrentUser();
    setCurrentUser(user);
    
    // Fetch dynamic companies
    authService.getCompanies().then((comps: any[]) => {
      setCompanyList(comps);
      if (user && user.company) {
        const active = comps.find(c => c._id === user.company);
        if (active) setActiveCompany({ ...active, role: "OWNER" });
      } else if (comps.length > 0) {
        setActiveCompany({ ...comps[0], role: "OWNER" });
      }
    }).catch((err: any) => console.error("Failed to load companies", err));

    // Fetch dynamic notifications
    activityService.getNotifications()
      .then(data => setNotifs(data))
      .catch(err => console.error("Failed to load notifications", err));
  }, []);

  const unread = notifs.filter((n) => !n.read_at).length;
  const navSections = buildNavSections(t.nav);
  const langs: Lang[] = ["en", "es", "fr", "it"];

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  function markAllRead() {
    setNotifs((ns) => ns.map((n) => ({ ...n, read_at: n.read_at ?? "now" })));
  }
  function markRead(id: string) {
    setNotifs((ns) => ns.map((n) => n.id === id ? { ...n, read_at: "now" } : n));
  }
  function navigate(page: Page) {
    setCurrentPage(page);
    setSidebarOpen(false);
    setCompanyOpen(false);
    setNotifOpen(false);
    setUserOpen(false);
  }

  const kindColor: Record<string, string> = {
    success: "bg-success", warning: "bg-warning", error: "bg-destructive", info: "bg-info",
  };

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Topbar */}
      <nav className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border bg-card/80 backdrop-blur-md px-4 lg:px-6 animate-fade-in-down">
        <div className="flex items-center gap-4">
          <button className="lg:hidden p-2 rounded-md hover:bg-secondary transition-colors" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>

          <button onClick={() => navigate("dashboard")} className="flex items-center gap-2 group">
            <div className="size-8 rounded-md bg-primary flex items-center justify-center transition-transform duration-300 group-hover:rotate-12">
              <div className="size-4 bg-accent rounded-sm animate-pulse-soft" />
            </div>
            <span className="hidden sm:inline" style={{ fontSize: "1.125rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              demo<span style={{ color: "var(--accent)", fontWeight: 300 }}>logistics</span>
            </span>
          </button>

          <div className="h-8 w-px bg-border hidden md:block" />

          <div className="hidden md:block relative">
            <button
              onClick={() => { setCompanyOpen((v) => !v); setUserOpen(false); setNotifOpen(false); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-secondary/50 hover:bg-card transition-colors"
            >
              <span className="size-2 rounded-full bg-success animate-pulse-dot" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground max-w-[160px] truncate">{activeCompany.name}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
            {companyOpen && (
              <div className="absolute top-full mt-2 left-0 w-64 bg-card border border-border rounded-xl shadow-xl p-1 z-50 animate-fade-in-down">
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t.common.yourCompanies}</div>
                {companyList.map((c) => (
                  <button key={c._id} onClick={async () => { 
                    setCompanyOpen(false); 
                    try {
                      await authService.switchCompany(c._id);
                      window.location.reload();
                    } catch(err) {
                      alert("Failed to switch company");
                    }
                  }} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-secondary text-left">
                    <Building2 className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{c.role || "OWNER"}</span>
                    {activeCompany._id === c._id && <Check className="size-3 text-success" />}
                  </button>
                ))}
                <div className="h-px bg-border my-1" />
                <button onClick={async () => {
                  setCompanyOpen(false);
                  const name = prompt("Enter new workspace/company name:");
                  if (name) {
                    try {
                      await authService.createCompany(name);
                      window.location.reload();
                    } catch(err) {
                      alert("Failed to create company");
                    }
                  }
                }} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-secondary">
                  <Plus className="size-4" /> {t.common.createCompany}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <div className="hidden md:flex relative items-center">
            <Search className="absolute left-3 size-3.5 text-muted-foreground" />
            <input
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder={`${t.common.search}…`}
              className="bg-secondary/60 border border-transparent rounded-lg pl-9 pr-10 py-1.5 w-64 outline-none focus:border-accent/50 focus:bg-card transition-all"
              style={{ fontSize: "0.875rem" }}
            />
            <kbd className="absolute right-2 text-[10px] font-mono text-muted-foreground bg-card border border-border rounded px-1.5 py-0.5">⌘K</kbd>
          </div>

          {/* Language switcher — fixed: stores lowercase, compares correctly */}
          <div className="hidden md:flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-secondary/50 rounded-lg p-0.5">
            <Globe2 className="size-3 mx-1.5" />
            {langs.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-1 rounded-md transition-all ${lang === l ? "bg-card text-foreground shadow-sm" : "hover:text-foreground"}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          <button onClick={() => setIsDark(!isDark)} className="p-2 rounded-lg hover:bg-secondary transition-colors">
            {isDark ? <Sun className="size-4 animate-fade-in" /> : <Moon className="size-4 animate-fade-in" />}
          </button>

          <div className="relative">
            <button onClick={() => { setNotifOpen((v) => !v); setUserOpen(false); setCompanyOpen(false); }} className="relative p-2 rounded-lg hover:bg-secondary transition-colors group">
              <Bell className="size-4 group-hover:animate-wiggle" />
              {unread > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 grid place-items-center bg-accent text-accent-foreground rounded-full text-[9px] font-bold animate-badge-pop">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute top-full right-0 mt-2 w-80 bg-card border border-border rounded-xl shadow-xl z-50 animate-fade-in-down overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                  <div className="text-sm font-semibold">{t.common.notifications}</div>
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1">
                      <CheckCheck className="size-3" /> {t.common.markAllRead}
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifs.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                      <Sparkles className="size-5 text-success" /> {t.common.noNotifications}
                    </div>
                  ) : notifs.map((n) => (
                    <button key={n.id} onClick={() => markRead(n.id)} className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-secondary transition-colors flex gap-2 ${!n.read_at ? "bg-accent/5" : ""}`}>
                      <span className={`mt-1.5 size-2 rounded-full shrink-0 ${kindColor[n.kind] ?? "bg-info"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{n.title}</div>
                        {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                        <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</div>
                      </div>
                      {!n.read_at && <span className="size-2 rounded-full bg-accent shrink-0 mt-1.5" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); setCompanyOpen(false); }} className="size-9 rounded-full bg-gradient-to-br from-primary to-accent outline outline-1 outline-black/10 hover-scale cursor-pointer grid place-items-center text-xs font-bold text-primary-foreground uppercase">
              {currentUser?.name ? currentUser.name.substring(0, 2) : (currentUser?.email ? currentUser.email.substring(0, 2) : "DL")}
            </button>
            {userOpen && (
              <div className="absolute top-full right-0 mt-2 w-56 bg-card border border-border rounded-xl shadow-xl p-1 z-50 animate-fade-in-down">
                <div className="px-3 py-2 text-xs">
                  <div className="font-semibold truncate">{currentUser?.email || "admin@demologistics.io"}</div>
                  <div className="text-muted-foreground truncate">{currentUser?.name || activeCompany.name}</div>
                </div>
                <div className="h-px bg-border" />
                <button onClick={() => navigate("subscription")} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary"><CreditCard className="size-4" /> {t.nav.subscription}</button>
                <button onClick={() => navigate("settings")} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary"><Settings2 className="size-4" /> {t.nav.settings}</button>
                <button onClick={() => navigate("activity")} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary"><History className="size-4" /> {t.nav.activity}</button>
                <button onClick={() => { setUserOpen(false); onLogout?.(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary text-destructive"><LogOut className="size-4" /> {t.common.signOut}</button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Body */}
      <div className="flex">
        <aside
          className={`${sidebarOpen ? "block animate-slide-in-left" : "hidden"} lg:block w-64 border-r border-border sticky top-16 bg-card overflow-y-auto shrink-0 z-40 scrollbar-thin`}
          style={{ height: "calc(100vh - 64px)" }}
        >
          <div className="p-4 space-y-5">
            {navSections.map((section, si) => (
              <div key={section.label} className="animate-fade-in-left" style={{ animationDelay: `${si * 60}ms` }}>
                <div className="px-3 mb-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">{section.label}</div>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = currentPage === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.id)}
                        className={`nav-item w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.badge && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-white/20 text-white" : "bg-warning/20 text-warning"}`}>{item.badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 min-w-0 pb-14">
          <header className="flex items-end justify-between border-b border-border px-4 lg:px-8 py-6 gap-4 flex-wrap animate-fade-in-up">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
              {pageSubtitle && <p className="text-muted-foreground mt-1 max-w-prose" style={{ fontSize: "0.875rem" }}>{pageSubtitle}</p>}
            </div>
            {pageActions && <div className="flex gap-2 flex-wrap">{pageActions}</div>}
          </header>
          <div className="p-4 lg:p-8">{children}</div>
        </main>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 h-9 bg-primary text-primary-foreground/80 text-[10px] flex items-center justify-between px-4 lg:px-6 z-50" style={{ fontFamily: "JetBrains Mono, monospace" }}>
        <div className="flex items-center gap-3 lg:gap-4">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-success animate-pulse-dot" />
            <span>{t.common.systemOnline}</span>
          </div>
          <div className="w-px h-3 bg-primary-foreground/20 hidden sm:block" />
          <span className="hidden sm:inline">v4.2.0-stable</span>
          <div className="w-px h-3 bg-primary-foreground/20 hidden md:block" />
          <span className="hidden md:inline text-primary-foreground/60">{activeCompany.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden md:inline">☁ {t.common.cloudSync}</span>
          <span>{clock}</span>
        </div>
      </footer>

      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}

export function PrimaryButton({ children, icon: Icon, onClick }: { children: React.ReactNode; icon?: React.ElementType; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 active:scale-95 transition-all hover-glow">
      {Icon && <Icon className="size-4" />}{children}
    </button>
  );
}

export function SecondaryButton({ children, icon: Icon, onClick }: { children: React.ReactNode; icon?: React.ElementType; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm font-semibold hover:bg-secondary active:scale-95 transition-all">
      {Icon && <Icon className="size-4" />}{children}
    </button>
  );
}

export function StatCard({ label, value, icon: Icon, color, delay = 0, sub }: {
  label: string; value: string | number; icon: React.ElementType; color: string; delay?: number; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`size-4 ${color}`} />
      </div>
      <div className="font-bold mt-2" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{value}</div>
      {sub && <div className="text-xs text-success mt-1">{sub}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const map: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    processing: "bg-info/15 text-info",
    shipped: "bg-primary/15 text-primary",
    delivered: "bg-success/15 text-success",
    cancelled: "bg-destructive/15 text-destructive",
    paid: "bg-success/15 text-success",
    unpaid: "bg-warning/15 text-warning",
    overdue: "bg-destructive/15 text-destructive",
    active: "bg-success/15 text-success",
    inactive: "bg-muted text-muted-foreground",
    returned: "bg-info/15 text-info",
    refunded: "bg-purple-500/15 text-purple-500",
    in_transit: "bg-info/15 text-info",
    low: "bg-destructive/15 text-destructive",
    ok: "bg-success/15 text-success",
    draft: "bg-muted text-muted-foreground",
    in_progress: "bg-primary/15 text-primary",
    completed: "bg-success/15 text-success",
    blocked: "bg-destructive/15 text-destructive",
    reserved: "bg-warning/15 text-warning",
    available: "bg-success/15 text-success",
    approved: "bg-success/15 text-success",
    rejected: "bg-destructive/15 text-destructive",
    inspecting: "bg-info/15 text-info",
    partial: "bg-warning/15 text-warning",
    connected: "bg-success/15 text-success",
    disconnected: "bg-destructive/15 text-destructive",
    syncing: "bg-info/15 text-info",
    ready: "bg-success/15 text-success",
    picking: "bg-primary/15 text-primary",
  };
  const key = status.toLowerCase() as keyof typeof t.status;
  const label = t.status[key] ?? status.replace("_", " ");
  const cls = map[key] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>
  );
}
