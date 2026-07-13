import { useState } from "react";
import { ShieldCheck, Building2, Users, CreditCard, BarChart3, Server, AlertTriangle, CheckCircle2, Activity, Globe, Plus, Edit3, Trash2 } from "lucide-react";
import { StatusBadge } from "./AppShell";
import { useLang } from "../LangContext";

const companies = [
  { id: "1", name: "demologistics HQ", plan: "Professional", users: 5, warehouses: 3, orders_mtd: 183, revenue_mtd: 58320, status: "active", created: "2025-01-15" },
  { id: "2", name: "West Coast Hub", plan: "Starter", users: 2, warehouses: 1, orders_mtd: 42, revenue_mtd: 12400, status: "active", created: "2025-06-01" },
  { id: "3", name: "EU Operations", plan: "Enterprise", users: 12, warehouses: 6, orders_mtd: 890, revenue_mtd: 312000, status: "active", created: "2024-09-10" },
  { id: "4", name: "Test Company", plan: "Starter", users: 1, warehouses: 0, orders_mtd: 0, revenue_mtd: 0, status: "inactive", created: "2026-05-01" },
];

const systemMetrics = [
  { label: "API requests (24h)", value: "142,820", change: "+12%", trend: "up" },
  { label: "DB query time (avg)", value: "4.2ms", change: "-8%", trend: "down" },
  { label: "Error rate", value: "0.02%", change: "-0.01%", trend: "down" },
  { label: "Uptime (30d)", value: "99.98%", change: "stable", trend: "stable" },
];

const recentSignups = [
  { company: "Logistica Norte SA", plan: "Professional", country: "ES", date: "2026-06-24" },
  { company: "Nordic Freight AB", plan: "Enterprise", country: "SE", date: "2026-06-22" },
  { company: "Quick Ship LLC", plan: "Starter", country: "US", date: "2026-06-20" },
];

export function Admin() {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState("companies");

  const tabs = [
    { id: "companies", label: "Companies", icon: Building2 },
    { id: "platform", label: "Platform health", icon: Activity },
    { id: "subscriptions", label: "Subscriptions", icon: CreditCard },
  ];

  const totalRevenueMRR = 299 * companies.filter((c) => c.plan === "Professional").length
    + 99 * companies.filter((c) => c.plan === "Starter").length
    + 999 * companies.filter((c) => c.plan === "Enterprise").length;

  return (
    <div className="space-y-6">
      {/* Platform stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total companies", value: companies.length, icon: Building2, color: "text-primary" },
          { label: "Total users", value: companies.reduce((a, c) => a + c.users, 0), icon: Users, color: "text-blue-500" },
          { label: "MRR", value: `€${totalRevenueMRR.toLocaleString()}`, icon: CreditCard, color: "text-success" },
          { label: "Platform uptime", value: "99.98%", icon: Server, color: "text-success" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">All companies</h3>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all">
              <Plus className="size-3.5" /> Add company
            </button>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Plan</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Users</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Warehouses</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Orders MTD</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Created</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => (
                  <tr key={c.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.name}</div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.plan === "Enterprise" ? "bg-amber-500/15 text-amber-500" : c.plan === "Professional" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>{c.plan}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">{c.users}</td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">{c.warehouses}</td>
                    <td className="px-4 py-3 text-right hidden md:table-cell" style={{ fontFamily: "JetBrains Mono, monospace" }}>{c.orders_mtd}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell text-xs text-muted-foreground">{c.created}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
                        <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent signups */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Recent signups</h3>
            <div className="space-y-2">
              {recentSignups.map((s, i) => (
                <div key={s.company} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-primary-foreground">{s.company.slice(0, 2)}</div>
                    <div>
                      <div className="font-medium text-sm">{s.company}</div>
                      <div className="text-xs text-muted-foreground">{s.country} · {s.date}</div>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.plan === "Enterprise" ? "bg-amber-500/15 text-amber-500" : s.plan === "Professional" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>{s.plan}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "platform" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {systemMetrics.map((m, i) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4 animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="text-xs text-muted-foreground mb-2">{m.label}</div>
                <div className="font-bold" style={{ fontSize: "1.25rem", fontFamily: "JetBrains Mono, monospace" }}>{m.value}</div>
                <div className={`text-xs mt-1 ${m.trend === "down" ? "text-success" : m.trend === "up" ? "text-warning" : "text-muted-foreground"}`}>{m.change}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Service status */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-bold mb-4 flex items-center gap-2"><Server className="size-4" /> Service status</h3>
              <div className="space-y-2.5">
                {[
                  { name: "API Gateway", status: "operational" },
                  { name: "Database cluster", status: "operational" },
                  { name: "File storage", status: "operational" },
                  { name: "Email service", status: "operational" },
                  { name: "Barcode scanner service", status: "operational" },
                  { name: "Carrier integrations", status: "operational" },
                  { name: "Ecommerce sync engine", status: "degraded" },
                ].map((svc) => (
                  <div key={svc.name} className="flex items-center justify-between">
                    <span className="text-sm">{svc.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${svc.status === "operational" ? "bg-success" : svc.status === "degraded" ? "bg-warning" : "bg-destructive"}`} />
                      <span className={`text-xs font-semibold ${svc.status === "operational" ? "text-success" : "text-warning"}`}>{svc.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent alerts */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-bold mb-4 flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> System alerts</h3>
              <div className="space-y-2">
                {[
                  { type: "warning", msg: "Ecommerce sync service latency elevated (+120ms)", time: "10 min ago" },
                  { type: "info", msg: "Scheduled maintenance window tonight 02:00–04:00 UTC", time: "1h ago" },
                  { type: "success", msg: "Database backup completed successfully", time: "4h ago" },
                  { type: "success", msg: "SSL certificate renewed — valid until 2027-06-26", time: "2d ago" },
                ].map((alert, i) => (
                  <div key={i} className={`flex gap-3 p-3 rounded-lg ${alert.type === "warning" ? "bg-warning/10" : alert.type === "success" ? "bg-success/10" : "bg-info/10"}`}>
                    <span className={`size-2 rounded-full mt-1.5 shrink-0 ${alert.type === "warning" ? "bg-warning" : alert.type === "success" ? "bg-success" : "bg-info"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs">{alert.msg}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{alert.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "subscriptions" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { plan: "Starter", count: companies.filter((c) => c.plan === "Starter").length, price: 99, color: "text-blue-500 bg-blue-500/10" },
              { plan: "Professional", count: companies.filter((c) => c.plan === "Professional").length, price: 299, color: "text-primary bg-primary/10" },
              { plan: "Enterprise", count: companies.filter((c) => c.plan === "Enterprise").length, price: 999, color: "text-amber-500 bg-amber-500/10" },
            ].map((p, i) => (
              <div key={p.plan} className="rounded-xl border border-border bg-card p-5 text-center animate-pop-in" style={{ animationDelay: `${i * 60}ms` }}>
                <div className={`inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3 ${p.color}`}>{p.plan}</div>
                <div className="font-bold" style={{ fontSize: "2rem", fontFamily: "JetBrains Mono, monospace" }}>{p.count}</div>
                <div className="text-xs text-muted-foreground mt-1">companies</div>
                <div className="text-xs font-semibold text-success mt-2">€{(p.count * p.price).toLocaleString()}/mo</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
