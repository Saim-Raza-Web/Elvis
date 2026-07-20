import { useEffect, useState } from "react";
import { Settings2, Bell, Shield, Users, Key, Save, LockKeyhole, Eye, Pencil, Trash2, Plus } from "lucide-react";
import { useLang } from "../LangContext";
import { adminService } from "../../services/admin.service";
import { settingsService } from "../../services/settings.service";
import { toast } from "sonner";

type User = { _id: string; name: string; email: string; role: string; createdAt: string; };

const settingsTabIds = ["general", "notifications", "security", "team", "roles", "api"] as const;
const settingsTabIcons = [Settings2, Bell, Shield, Users, LockKeyhole, Key];

const roles = [
  {
    id: "owner", name: "Owner", description: "Full access to all features and settings", users: 1, color: "text-primary bg-primary/10",
    permissions: { dashboard: true, warehouses: true, inventory: true, orders: true, billing: true, reports: true, settings: true, admin: true },
  },
  {
    id: "admin", name: "Admin", description: "Can manage all operations except billing and subscription", users: 1, color: "text-amber-500 bg-amber-500/10",
    permissions: { dashboard: true, warehouses: true, inventory: true, orders: true, billing: false, reports: true, settings: true, admin: false },
  },
  {
    id: "manager", name: "Manager", description: "Can manage warehouse operations and view reports", users: 2, color: "text-blue-500 bg-blue-500/10",
    permissions: { dashboard: true, warehouses: true, inventory: true, orders: true, billing: false, reports: true, settings: false, admin: false },
  },
  {
    id: "staff", name: "Warehouse Staff", description: "Can perform picking, packing, receiving operations", users: 4, color: "text-success bg-success/10",
    permissions: { dashboard: true, warehouses: false, inventory: true, orders: false, billing: false, reports: false, settings: false, admin: false },
  },
  {
    id: "readonly", name: "Read-only", description: "View-only access to dashboards and reports", users: 2, color: "text-muted-foreground bg-secondary",
    permissions: { dashboard: true, warehouses: false, inventory: false, orders: false, billing: false, reports: true, settings: false, admin: false },
  },
];

const permissionModules = ["dashboard", "warehouses", "inventory", "orders", "billing", "reports", "settings", "admin"] as const;



const apiKeys = [
  { name: "Production API Key", key: "sk_live_...xyz8", created: "2026-01-01", lastUsed: "2026-06-26", status: "active" },
  { name: "Staging Key", key: "sk_test_...abc3", created: "2026-03-15", lastUsed: "2026-06-20", status: "active" },
  { name: "Legacy Integration", key: "sk_live_...mno1", created: "2025-07-01", lastUsed: "2025-12-31", status: "inactive" },
];

export function Settings() {
  const { t } = useLang();
  const settingsTabs = [
    { id: "general", label: t.settings.general, icon: settingsTabIcons[0] },
    { id: "notifications", label: t.settings.notifications, icon: settingsTabIcons[1] },
    { id: "security", label: t.settings.security, icon: settingsTabIcons[2] },
    { id: "team", label: t.settings.team, icon: settingsTabIcons[3] },
    { id: "roles", label: t.settings.roles, icon: settingsTabIcons[4] },
    { id: "api", label: t.settings.apiKeys, icon: settingsTabIcons[5] },
  ];
  const [activeTab, setActiveTab] = useState("general");
  const [companyName, setCompanyName] = useState("demologistics HQ");
  const [timezone, setTimezone] = useState("America/New_York");
  const [currency, setCurrency] = useState("EUR");
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [orderNotifs, setOrderNotifs] = useState(true);
  const [lowStockNotifs, setLowStockNotifs] = useState(true);
  const [shipmentNotifs, setShipmentNotifs] = useState(false);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadSettings() {
    try {
      setLoading(true);
      const data = await settingsService.getCompanySettings();
      if (data) {
        setCompanyName(data.name || "demologistics HQ");
        setTimezone(data.timezone || "America/New_York");
        setCurrency(data.currency || "EUR");
        setEmailNotifs(data.emailNotifs ?? true);
        setOrderNotifs(data.orderNotifs ?? true);
        setLowStockNotifs(data.lowStockNotifs ?? true);
        setShipmentNotifs(data.shipmentNotifs ?? false);
      }
    } catch (err) {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSaveGeneral() {
    try {
      await settingsService.updateCompanySettings({ name: companyName, timezone, currency });
      toast.success("General settings saved.");
    } catch (err) {
      toast.error("Failed to save settings");
    }
  }

  async function handleToggleNotif(field: string, val: boolean) {
    try {
      await settingsService.updateCompanySettings({ [field]: val });
      if (field === 'emailNotifs') setEmailNotifs(val);
      if (field === 'orderNotifs') setOrderNotifs(val);
      if (field === 'lowStockNotifs') setLowStockNotifs(val);
      if (field === 'shipmentNotifs') setShipmentNotifs(val);
      toast.success("Notification preferences updated.");
    } catch (err) {
      toast.error("Failed to update preferences");
    }
  }

  useEffect(() => {
    if (activeTab === "team") {
      adminService.getUsers().then(data => setTeamMembers(data)).catch(() => toast.error("Failed to load users"));
    }
  }, [activeTab]);

  const Toggle = ({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-secondary border border-border"}`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Tabs */}
      <div className="lg:w-48 shrink-0">
        <nav className="space-y-0.5">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {activeTab === "general" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-5">
              <h3 className="font-bold">{t.settings.companySettings}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.companyName}</label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem" }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.timezone}</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem" }}
                  >
                    <option value="America/New_York">America/New_York</option>
                    <option value="America/Los_Angeles">America/Los_Angeles</option>
                    <option value="Europe/London">Europe/London</option>
                    <option value="Europe/Paris">Europe/Paris</option>
                    <option value="Asia/Tokyo">Asia/Tokyo</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.currency}</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem" }}
                  >
                    <option value="EUR">EUR — Euro</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="GBP">GBP — British Pound</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.dateFormat}</label>
                  <select className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }}>
                    <option>YYYY-MM-DD</option>
                    <option>MM/DD/YYYY</option>
                    <option>DD/MM/YYYY</option>
                  </select>
                </div>
              </div>
              <button onClick={handleSaveGeneral} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all">
                <Save className="size-4" /> {t.settings.saveChanges}
              </button>
            </div>
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <h3 className="font-bold">{t.settings.notifPrefs}</h3>
            {[
              { label: t.settings.emailNotifs, sub: t.settings.emailNotifsSub, value: emailNotifs, toggle: () => handleToggleNotif('emailNotifs', !emailNotifs) },
              { label: t.settings.orderAlerts, sub: t.settings.orderAlertsSub, value: orderNotifs, toggle: () => handleToggleNotif('orderNotifs', !orderNotifs) },
              { label: t.settings.lowStockAlerts, sub: t.settings.lowStockAlertsSub, value: lowStockNotifs, toggle: () => handleToggleNotif('lowStockNotifs', !lowStockNotifs) },
              { label: t.settings.shipmentUpdates, sub: t.settings.shipmentUpdatesSub, value: shipmentNotifs, toggle: () => handleToggleNotif('shipmentNotifs', !shipmentNotifs) },
            ].map((n) => (
              <div key={n.label} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div>
                  <div className="text-sm font-medium">{n.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{n.sub}</div>
                </div>
                <Toggle enabled={n.value} onToggle={n.toggle} />
              </div>
            ))}
          </div>
        )}

        {activeTab === "security" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-bold mb-4">Password</h3>
              <div className="space-y-3 max-w-sm">
                {["Current password", "New password", "Confirm new password"].map((label) => (
                  <div key={label}>
                    <label className="text-sm font-medium mb-1.5 block">{label}</label>
                    <input type="password" placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
                  </div>
                ))}
                <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all mt-2">
                  <Shield className="size-4" /> Update password
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-bold mb-1">Two-Factor Authentication</h3>
              <p className="text-sm text-muted-foreground mb-4">Add an extra layer of security to your account</p>
              <button className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors">Enable 2FA</button>
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-bold">Team Members</h3>
              <button className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all">
                <Users className="size-3.5" /> Invite member
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Member</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Role</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Joined</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((m, i) => (
                  <tr key={m.email} className="border-t border-border animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-primary-foreground">
                          {m.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div>
                          <div className="font-medium">{m.name}</div>
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${m.role === "OWNER" ? "bg-primary/15 text-primary" : m.role === "ADMIN" ? "bg-amber-500/15 text-amber-500" : "bg-secondary text-muted-foreground"}`}>{m.role}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{m.createdAt?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      {m.role !== "OWNER" && (
                        <button className="text-xs text-muted-foreground hover:text-destructive transition-colors">Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "roles" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold">Roles & Permissions</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Define what each role can access across the platform</p>
              </div>
              <button className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all"><Plus className="size-3.5" /> New role</button>
            </div>

            {/* Permission matrix */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs text-muted-foreground font-semibold">Role</th>
                      {permissionModules.map((m) => (
                        <th key={m} className="px-3 py-3 text-center text-xs text-muted-foreground font-semibold capitalize">{m}</th>
                      ))}
                      <th className="px-4 py-3 text-right text-xs text-muted-foreground font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role, i) => (
                      <tr key={role.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${role.color}`}>{role.name}</span>
                            <span className="text-xs text-muted-foreground hidden lg:block">{role.users} user{role.users !== 1 ? "s" : ""}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 hidden md:block">{role.description}</div>
                        </td>
                        {permissionModules.map((mod) => (
                          <td key={mod} className="px-3 py-3 text-center">
                            {role.permissions[mod]
                              ? <span className="size-5 rounded-full bg-success/15 text-success inline-flex items-center justify-center text-xs font-bold">✓</span>
                              : <span className="size-5 rounded-full bg-secondary text-muted-foreground/30 inline-flex items-center justify-center text-xs">—</span>
                            }
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground" title="View"><Eye className="size-3.5" /></button>
                            {role.id !== "owner" && <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground" title="Edit"><Pencil className="size-3.5" /></button>}
                            {role.id !== "owner" && role.id !== "admin" && <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="size-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Role assignments are per-user. To change a user's role, go to <strong>Team</strong> and edit their access level.</p>
            </div>
          </div>
        )}

        {activeTab === "api" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">API Keys</h3>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all">
                  <Key className="size-3.5" /> Generate key
                </button>
              </div>
              <div className="space-y-3">
                {apiKeys.map((k, i) => (
                  <div key={k.name} className="flex items-center justify-between p-4 bg-secondary/50 rounded-xl border border-border animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold">{k.name}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${k.status === "active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{k.status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{k.key}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">Last used: {k.lastUsed}</div>
                    </div>
                    <button className="text-xs text-destructive hover:underline shrink-0 ml-4">Revoke</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-bold mb-1">API Documentation</h3>
              <p className="text-sm text-muted-foreground mb-3">Integrate demologistics with your existing systems using our REST API.</p>
              <button className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors">View docs</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
