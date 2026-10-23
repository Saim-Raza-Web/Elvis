import { ShoppingCart, Truck, Boxes, AlertTriangle, TrendingUp, Warehouse, ArrowUpRight, Package, RefreshCw, Loader2 } from "lucide-react";
import { StatCard, StatusBadge } from "./AppShell";
import { useLang } from "../LangContext";

import { useEffect, useState, useCallback } from "react";
import { ordersService } from "../../services/orders.service";
import { warehousesService } from "../../services/warehouses.service";
import { inventoryService } from "../../services/inventory.service";
import { shippingService } from "../../services/shipping.service";

export function Dashboard({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const { t } = useLang();

  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [warehouseStatus, setWarehouseStatus] = useState<any[]>([]);
  const [totalStock, setTotalStock] = useState(0);
  const [lowStockSKUs, setLowStockSKUs] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [pendingShipments, setPendingShipments] = useState(0);
  const [activeWarehouses, setActiveWarehouses] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      // Use Promise.allSettled so partial slow-network failures don't crash entire dashboard
      const [ordersRes, whsRes, prodsRes, shipmentsRes] = await Promise.allSettled([
        ordersService.getPage ? ordersService.getPage({ limit: 10 }) : ordersService.getAll(),
        warehousesService.getAll(),
        inventoryService.getAll(),
        shippingService.getAll()
      ]);

      if (ordersRes.status === "fulfilled") {
        const orderData = (ordersRes.value as any)?.data || ordersRes.value || [];
        setRecentOrders(Array.isArray(orderData) ? orderData.slice(0, 5) : []);
        const rev = (Array.isArray(orderData) ? orderData : [])
          .filter((o: any) => o.status !== "cancelled" && o.status !== "pending")
          .reduce((a: number, o: any) => a + (o.total || 0), 0);
        setTotalRevenue(rev);
      }

      if (whsRes.status === "fulfilled") {
        const whs = Array.isArray(whsRes.value) ? whsRes.value : [];
        setWarehouseStatus(whs.slice(0, 3));
        setActiveWarehouses(whs.filter((w: any) => w.status === "active").length);
      }

      if (prodsRes.status === "fulfilled") {
        const prods = Array.isArray(prodsRes.value) ? prodsRes.value : [];
        setTotalStock(prods.reduce((a: number, p: any) => a + (p.qty_available || 0), 0));
        setLowStockSKUs(prods.filter((p: any) => p.status === "low").length);
      }

      if (shipmentsRes.status === "fulfilled") {
        const shipments = Array.isArray(shipmentsRes.value) ? shipmentsRes.value : [];
        setPendingShipments(shipments.filter((s: any) => s.status === "processing" || s.status === "pending").length);
      }

      if (
        ordersRes.status === "rejected" &&
        whsRes.status === "rejected" &&
        prodsRes.status === "rejected"
      ) {
        setHasError(true);
      }
    } catch (e) {
      console.error("Dashboard fetch error", e);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const quickActions = [
    { label: t.orders?.newOrder || "Create order", icon: ShoppingCart, page: "orders", event: "open-new-order" },
    { label: t.inventory?.addProduct || "Add product", icon: Boxes, page: "inventory", event: "open-add-product" },
    { label: t.warehouses?.addWarehouse || "Add warehouse", icon: Warehouse, page: "warehouses", event: "open-add-warehouse" },
    { label: t.crm?.addCustomer || "Add customer", icon: Package, page: "crm", event: "open-add-customer" },
  ];

  const stats = [
    { label: t.dashboard.recentOrders, value: recentOrders.length, icon: ShoppingCart, color: "text-primary", delay: 0 },
    { label: t.dashboard.pendingShipments, value: pendingShipments, icon: Truck, color: "text-blue-500", delay: 40 },
    { label: t.dashboard.unitsInStock, value: totalStock.toLocaleString(), icon: Boxes, color: "text-purple-500", delay: 80 },
    { label: t.dashboard.lowStockSKUs, value: lowStockSKUs, icon: AlertTriangle, color: "text-destructive", delay: 120 },
    { label: t.dashboard.revenuePaid, value: `€${totalRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-success", delay: 160 },
    { label: t.dashboard.activeWarehouses, value: activeWarehouses, icon: Warehouse, color: "text-amber-500", delay: 200 },
  ];

  return (
    <div className="space-y-6">
      {/* Network error banner with retry for slow PDA connection */}
      {hasError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center gap-2 text-destructive text-sm font-medium">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Connection error loading dashboard data. Slow or intermittent network detected.</span>
          </div>
          <button
            onClick={fetchDashboard}
            disabled={isLoading}
            className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-xs font-semibold hover:opacity-90 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={isLoading ? "—" : s.value} icon={s.icon} color={s.color} delay={s.delay} />
        ))}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent orders */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2">
              <span>{t.dashboard.recentOrders}</span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </h3>
            <button
              onClick={() => onNavigate?.("orders")}
              className="text-xs text-primary inline-flex items-center gap-1 hover:underline cursor-pointer"
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
              {recentOrders.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    No recent orders found.
                  </td>
                </tr>
              )}
              {recentOrders.map((o) => (
                <tr key={o._id} className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
                  <td className="py-3 px-4 font-medium" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.875rem" }}>{o.orderId}</td>
                  <td className="px-4 py-2.5 font-medium">{o.customer}</td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className="text-xs text-muted-foreground uppercase bg-secondary px-2 py-0.5 rounded">{o.channel || "MANUAL"}</span>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{Number(o.total || 0).toFixed(2)}</td>
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
                  onClick={() => {
                    onNavigate?.(a.page);
                    if (a.event) setTimeout(() => window.dispatchEvent(new CustomEvent(a.event)), 100);
                  }}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary transition-colors w-full text-left cursor-pointer"
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
              {warehouseStatus.map((w: any) => {
                const pct = w.capacity > 0 ? Math.round(((w.used || 0) / w.capacity) * 100) : 0;
                const barColor = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success";
                return (
                  <div key={w.code || w.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{w.name}</span>
                      <span className="text-xs text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{w.code}</span>
                      <span className="text-[10px] text-muted-foreground">{(w.used || 0).toLocaleString()} / {(w.capacity || 0).toLocaleString()}</span>
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
