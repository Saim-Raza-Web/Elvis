import { useState } from "react";
import { History, Search, Filter, ShoppingCart, Package, Truck, Users, ReceiptText, Settings2, Warehouse, ArrowRightLeft, User } from "lucide-react";
import { useLang } from "../LangContext";

const actions = [
  { id: "LOG-9921", user: "Alex M.", role: "Warehouse Staff", action: "Completed pick task", module: "picking", detail: "Pick task PCK-0055 — ORD-00179 (7 items)", ip: "192.168.1.42", time: "2026-06-26 10:44:02" },
  { id: "LOG-9920", user: "admin@demologistics.io", role: "Admin", action: "Created invoice", module: "billing", detail: "INV-0087 — Apex Industries €4,200.00", ip: "192.168.1.10", time: "2026-06-26 10:38:11" },
  { id: "LOG-9919", user: "System", role: "Automation", action: "Stock replenishment triggered", module: "inventory", detail: "SKU-1001 below reorder point → TRF-0089 created", ip: "system", time: "2026-06-26 10:30:00" },
  { id: "LOG-9918", user: "Sarah K.", role: "Manager", action: "Approved return", module: "returns", detail: "RET-0041 — Meridian Corp, 2 items approved for refund", ip: "192.168.1.22", time: "2026-06-26 10:22:31" },
  { id: "LOG-9917", user: "admin@demologistics.io", role: "Admin", action: "New order received", module: "orders", detail: "ORD-00183 — Apex Industries €2,341.00 (Shopify)", ip: "10.0.0.1", time: "2026-06-26 10:15:44" },
  { id: "LOG-9916", user: "Tom W.", role: "Warehouse Staff", action: "Received shipment", module: "receiving", detail: "ASN-0038 — Global Supply Co. 120 units SKU-1001", ip: "192.168.1.55", time: "2026-06-26 09:42:18" },
  { id: "LOG-9915", user: "Chris R.", role: "Warehouse Staff", action: "Completed pick task", module: "picking", detail: "Pick task PCK-0055 — ORD-00179 completed", ip: "192.168.1.43", time: "2026-06-26 09:30:05" },
  { id: "LOG-9914", user: "admin@demologistics.io", role: "Admin", action: "User permission updated", module: "settings", detail: "Mike Johnson role changed to ADMIN", ip: "192.168.1.10", time: "2026-06-26 09:15:00" },
  { id: "LOG-9913", user: "System", role: "Automation", action: "Shipment status updated", module: "shipping", detail: "SHP-0428 delivered — DHL tracking confirmed", ip: "system", time: "2026-06-26 08:55:22" },
  { id: "LOG-9912", user: "Priya P.", role: "Manager", action: "Adjusted inventory", module: "inventory", detail: "SKU-1007 quantity adjusted: 14 → 12 (audit)", ip: "192.168.1.30", time: "2026-06-26 08:30:00" },
  { id: "LOG-9911", user: "System", role: "Automation", action: "Low stock alert sent", module: "inventory", detail: "SKU-8821 below reorder point — notification sent", ip: "system", time: "2026-06-25 23:00:01" },
  { id: "LOG-9910", user: "admin@demologistics.io", role: "Admin", action: "Company settings updated", module: "settings", detail: "Timezone changed to America/New_York", ip: "192.168.1.10", time: "2026-06-25 18:45:00" },
];

const moduleIcon: Record<string, React.ElementType> = {
  picking: Package,
  billing: ReceiptText,
  inventory: Warehouse,
  returns: ArrowRightLeft,
  orders: ShoppingCart,
  receiving: Package,
  shipping: Truck,
  settings: Settings2,
  crm: Users,
};

const moduleColor: Record<string, string> = {
  picking: "text-primary bg-primary/10",
  billing: "text-success bg-success/10",
  inventory: "text-amber-500 bg-amber-500/10",
  returns: "text-info bg-info/10",
  orders: "text-purple-500 bg-purple-500/10",
  receiving: "text-blue-500 bg-blue-500/10",
  shipping: "text-primary bg-primary/10",
  settings: "text-muted-foreground bg-secondary",
  crm: "text-pink-500 bg-pink-500/10",
};

const modules = ["All", "orders", "inventory", "picking", "receiving", "shipping", "billing", "returns", "settings"];

export function ActivityLog() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [userFilter, setUserFilter] = useState("All");

  const users = ["All", ...Array.from(new Set(actions.map((a) => a.user)))];

  const filtered = actions.filter((a) => {
    const matchSearch = a.action.toLowerCase().includes(search.toLowerCase()) || a.detail.toLowerCase().includes(search.toLowerCase()) || a.user.toLowerCase().includes(search.toLowerCase());
    const matchModule = moduleFilter === "All" || a.module === moduleFilter;
    const matchUser = userFilter === "All" || a.user === userFilter;
    return matchSearch && matchModule && matchUser;
  });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.activity.eventsToday, value: actions.length, icon: History, color: "text-primary" },
          { label: t.activity.userActions, value: actions.filter((a) => a.role !== "Automation").length, icon: User, color: "text-blue-500" },
          { label: t.activity.automations, value: actions.filter((a) => a.role === "Automation").length, icon: Settings2, color: "text-amber-500" },
          { label: t.activity.activeUsers, value: 5, icon: Users, color: "text-success" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.activity.searchPlaceholder} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="px-3 py-2 bg-card border border-border rounded-lg outline-none text-sm capitalize">
            {modules.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
          </select>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="px-3 py-2 bg-card border border-border rounded-lg outline-none text-sm max-w-[160px]">
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="divide-y divide-border">
          {filtered.map((log, i) => {
            const Icon = moduleIcon[log.module] ?? History;
            const colorClass = moduleColor[log.module] ?? "text-muted-foreground bg-secondary";
            return (
              <div key={log.id} className="flex gap-4 p-4 hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 20}ms` }}>
                <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-semibold text-sm">{log.action}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${colorClass}`}>{log.module}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-1 truncate">{log.detail}</div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="size-3" />{log.user}</span>
                    <span className="bg-secondary px-1.5 py-0.5 rounded">{log.role}</span>
                    {log.ip !== "system" && <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{log.ip}</span>}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0 text-right" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  {log.time.split(" ")[1]}
                  <div className="text-muted-foreground/60">{log.time.split(" ")[0]}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
