import { ShoppingCart, Truck, Boxes, AlertTriangle, TrendingUp, Warehouse, ArrowUpRight, Package } from "lucide-react";
import { StatCard, StatusBadge } from "./AppShell";
import { useLang } from "../LangContext";

const recentOrders = [
  { id: "1", order_number: "ORD-00183", customer: "Apex Industries", status: "processing", total: 2341.00, channel: "web" },
  { id: "2", order_number: "ORD-00182", customer: "Blue Horizon LLC", status: "shipped", total: 876.50, channel: "api" },
  { id: "3", order_number: "ORD-00181", customer: "Nova Retail Group", status: "delivered", total: 4120.00, channel: "web" },
  { id: "4", order_number: "ORD-00180", customer: "Summit Supply Co.", status: "pending", total: 639.99, channel: "mobile" },
  { id: "5", order_number: "ORD-00179", customer: "Crestline Corp", status: "processing", total: 1887.25, channel: "api" },
  { id: "6", order_number: "ORD-00178", customer: "TechFlow Systems", status: "delivered", total: 3250.00, channel: "web" },
  { id: "7", order_number: "ORD-00177", customer: "Pacific Goods Inc.", status: "cancelled", total: 420.00, channel: "web" },
];

const warehouseStatus = [
  { name: "Miami Hub", code: "MIA", capacity: 5000, used: 3842, status: "ok" },
  { name: "Los Angeles", code: "LAX", capacity: 8000, used: 7621, status: "low" },
  { name: "Chicago DC", code: "ORD", capacity: 6500, used: 2100, status: "ok" },
];

export function Dashboard({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const { t } = useLang();

  const totalRevenue = 48320;
  const pendingShipments = 12;
  const totalStock = 24571;
  const lowStockSKUs = 8;

  const quickActions = [
    { label: "Create order", icon: ShoppingCart, page: "orders" },
    { label: "Add product", icon: Boxes, page: "inventory" },
    { label: "Add warehouse", icon: Warehouse, page: "warehouses" },
    { label: "Add customer", icon: Package, page: "crm" },
  ];

  const stats = [
    { label: t.dashboard.recentOrders, value: recentOrders.length, icon: ShoppingCart, color: "text-primary", delay: 0 },
    { label: "Pending shipments", value: pendingShipments, icon: Truck, color: "text-blue-500", delay: 40 },
    { label: "Units in stock", value: totalStock.toLocaleString(), icon: Boxes, color: "text-purple-500", delay: 80 },
    { label: "Low-stock SKUs", value: lowStockSKUs, icon: AlertTriangle, color: "text-destructive", delay: 120 },
    { label: "Revenue (paid)", value: `€${totalRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-success", delay: 160 },
    { label: "Active warehouses", value: 3, icon: Warehouse, color: "text-amber-500", delay: 200 },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} color={s.color} delay={s.delay} />
        ))}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent orders */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold">{t.dashboard.recentOrders}</h3>
            <button
              onClick={() => onNavigate?.("orders")}
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
            >
              {t.dashboard.viewAll} <ArrowUpRight className="size-3" />
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">{t.dashboard.orderNo}</th>
                <th className="text-left px-4 py-2">{t.dashboard.customer}</th>
                <th className="text-left px-4 py-2 hidden sm:table-cell">{t.dashboard.channel}</th>
                <th className="text-left px-4 py-2">{t.common.status}</th>
                <th className="text-right px-4 py-2">{t.dashboard.value}</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order, i) => (
                <tr key={order.id} className="border-t border-border animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <td className="px-4 py-2.5" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{order.order_number}</td>
                  <td className="px-4 py-2.5 font-medium">{order.customer}</td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className="text-xs text-muted-foreground uppercase bg-secondary px-2 py-0.5 rounded">{order.channel}</span>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={order.status} /></td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{order.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Package className="size-4" /> {t.dashboard.quickActions}
            </h3>
            <div className="space-y-2">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => onNavigate?.(a.page)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary transition-colors w-full"
                >
                  <a.icon className="size-4 text-primary" />
                  <span className="text-sm font-medium flex-1 text-left">{a.label}</span>
                  <ArrowUpRight className="size-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>

          {/* Warehouse utilization */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Warehouse className="size-4" /> {t.dashboard.warehouseUtil}
            </h3>
            <div className="space-y-3">
              {warehouseStatus.map((w) => {
                const pct = Math.round((w.used / w.capacity) * 100);
                const barColor = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success";
                return (
                  <div key={w.code}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{w.name}</span>
                      <span className="text-xs text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{w.code}</span>
                      <span className="text-[10px] text-muted-foreground">{w.used.toLocaleString()} / {w.capacity.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
