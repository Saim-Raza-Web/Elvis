import { useState, useEffect } from "react";
import {
  Boxes, ShoppingCart, PackageCheck, ReceiptText, BarChart3,
  Search, Plus, Download, Truck, CheckCircle2, Clock, AlertCircle,
  Building, User, ShieldCheck, MapPin
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { clientPortalService, ClientPortalInventoryItem, ClientPortalOrder, ClientPortalAsn } from "../../services/clientPortal.service";
import { authService } from "../../services/auth.service";

export function ClientPortal() {
  const [activeTab, setActiveTab] = useState<'kpis' | 'inventory' | 'orders' | 'asns' | 'billing'>('kpis');
  const [profile, setProfile] = useState<any | null>(null);
  const [kpis, setKpis] = useState<any | null>(null);
  const [inventory, setInventory] = useState<ClientPortalInventoryItem[]>([]);
  const [invSummary, setInvSummary] = useState<any | null>(null);
  const [orders, setOrders] = useState<ClientPortalOrder[]>([]);
  const [asns, setAsns] = useState<ClientPortalAsn[]>([]);
  const [billingData, setBillingData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const currentUser = authService.getCurrentUser();

  // Load profile and KPIs on mount
  useEffect(() => {
    async function loadInitial() {
      setLoading(true);
      try {
        const [profData, kpiData] = await Promise.all([
          clientPortalService.getProfile().catch(() => null),
          clientPortalService.getKpis().catch(() => null)
        ]);
        if (profData?.client) setProfile(profData.client);
        if (kpiData?.kpis) setKpis(kpiData.kpis);
      } catch (err: any) {
        console.error("Client portal load error", err);
      } finally {
        setLoading(false);
      }
    }
    loadInitial();
  }, []);

  // Fetch data on tab change
  useEffect(() => {
    async function loadTabContent() {
      setLoading(true);
      try {
        if (activeTab === 'inventory') {
          const data = await clientPortalService.getInventory();
          setInventory(data.inventory || []);
          setInvSummary(data.summary || null);
        } else if (activeTab === 'orders') {
          const data = await clientPortalService.getOrders();
          setOrders(data.orders || []);
        } else if (activeTab === 'asns') {
          const data = await clientPortalService.getAsns();
          setAsns(data.asns || []);
        } else if (activeTab === 'billing') {
          const data = await clientPortalService.getBilling();
          setBillingData(data);
        }
      } catch (err: any) {
        toast.error("Failed to load portal data");
      } finally {
        setLoading(false);
      }
    }
    loadTabContent();
  }, [activeTab]);

  const filteredInventory = inventory.filter(item =>
    item.sku.toLowerCase().includes(search.toLowerCase()) ||
    (item.productName || '').toLowerCase().includes(search.toLowerCase()) ||
    (item.lot || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Profile Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <Building className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{profile?.name || currentUser?.name || "Client 3PL"}</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-500 border border-purple-500/20 uppercase">
                  Portal 3PL • {profile?.billingModality || "RECURRENT"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Authorized Warehouses: {(profile?.warehouseAccess || ['MIA']).join(', ')} • VAT: {profile?.vat || "B-12345678"} • Active Stock Days: {profile?.activeStockDays || 0}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Authoritative Scoped Access</span>
            <ShieldCheck className="size-4 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border gap-2 pb-1 overflow-x-auto">
        {[
          { id: 'kpis', label: 'Resumen & KPIs', icon: BarChart3 },
          { id: 'inventory', label: 'Mi Inventario', icon: Boxes },
          { id: 'orders', label: 'Mis Pedidos (Outbound)', icon: ShoppingCart },
          { id: 'asns', label: 'Avisos de Expedición (ASN)', icon: PackageCheck },
          { id: 'billing', label: 'Liquidación & Tarifas', icon: ReceiptText },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 font-semibold text-xs md:text-sm rounded-t-lg transition-colors border-b-2 -mb-1 flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: KPIs */}
      {activeTab === 'kpis' && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs text-muted-foreground">Stock Disponible</span>
              <div className="text-2xl font-bold font-mono text-primary mt-1">
                {(kpis?.totalAvailableStock || 0).toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1 block">Unidades listas para servir</span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs text-muted-foreground">Stock Reservado</span>
              <div className="text-2xl font-bold font-mono text-amber-500 mt-1">
                {(kpis?.totalReservedStock || 0).toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1 block">En preparación de pedidos</span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs text-muted-foreground">Pedidos este Mes</span>
              <div className="text-2xl font-bold font-mono text-blue-500 mt-1">
                {kpis?.ordersThisMonth || 0}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1 block">
                {kpis?.dispatchedOrdersThisMonth || 0} expedidos ({kpis?.fulfillmentRatePct || 100}%)
              </span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs text-muted-foreground">SKUs Activos</span>
              <div className="text-2xl font-bold font-mono text-foreground mt-1">
                {kpis?.activeSkuCount || 0}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1 block">Referencias en almacén</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Inventory */}
      {activeTab === 'inventory' && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por SKU, producto o lote..."
                className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm outline-none focus:border-primary/50"
              />
            </div>
            {invSummary && (
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                Total Físico: <strong>{invSummary.totalPhysical?.toLocaleString()}</strong>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3">SKU</th>
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-4 py-3">Lote / Caducidad</th>
                  <th className="text-left px-4 py-3">Almacén</th>
                  <th className="text-right px-4 py-3">Disponible</th>
                  <th className="text-right px-4 py-3">Reservado</th>
                  <th className="text-right px-4 py-3">Awaiting Putaway</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((item) => (
                  <tr key={item.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-semibold text-primary font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-3">{item.productName}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.lot} {item.expiryDate ? `(${new Date(item.expiryDate).toLocaleDateString()})` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">{item.warehouse}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-foreground">{item.qtyAvailable}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-500">{item.qtyReserved}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{item.qtyAwaitingPutaway}</td>
                  </tr>
                ))}
                {filteredInventory.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">
                      No stock records found for this client.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Orders */}
      {activeTab === 'orders' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in-up">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-3">Pedido #</th>
                <th className="text-left px-4 py-3">Destinatario</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-center px-4 py-3">Líneas</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Transportista / Tracking</th>
                <th className="text-right px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-primary font-mono text-xs">{o.orderId}</td>
                  <td className="px-4 py-3 font-medium">{o.customerName || "Cliente Final"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{o.order_type}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{o.itemsCount}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.carrier ? <span className="font-semibold">{o.carrier} </span> : null}
                    {o.tracking_number ? <span className="font-mono text-muted-foreground">({o.tracking_number})</span> : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-foreground">€{(o.total || 0).toFixed(2)}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No orders registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: ASNs */}
      {activeTab === 'asns' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in-up">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-3">ASN #</th>
                <th className="text-left px-4 py-3">PO Number</th>
                <th className="text-left px-4 py-3">Proveedor</th>
                <th className="text-left px-4 py-3">Fecha Prevista</th>
                <th className="text-center px-4 py-3">Uds Previstas</th>
                <th className="text-center px-4 py-3">Uds Recibidas</th>
                <th className="text-center px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {asns.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-primary font-mono text-xs">{a.asnId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.poNumber}</td>
                  <td className="px-4 py-3">{a.supplier}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(a.expectedDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-center font-mono font-bold">{a.expectedUnits}</td>
                  <td className="px-4 py-3 text-center font-mono text-emerald-500">{a.receivedUnits}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={a.status} />
                  </td>
                </tr>
              ))}
              {asns.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No expected inbounds (ASNs) found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Billing */}
      {activeTab === 'billing' && (
        <div className="space-y-4 animate-fade-in-up">
          {billingData?.liquidation ? (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h3 className="font-bold text-base">Estado de Liquidación Mensual 3PL</h3>
                  <p className="text-xs text-muted-foreground">
                    Period: {billingData.liquidation.period?.month}/{billingData.liquidation.period?.year} • Modalidad: {billingData.liquidation.clientModality}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Total Estimado Mes</div>
                  <div className="text-2xl font-bold font-mono text-primary">
                    €{(billingData.liquidation.totals?.grandTotal || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <span className="text-xs text-muted-foreground">Entradas</span>
                  <div className="font-bold font-mono text-sm mt-1">€{(billingData.liquidation.concepts?.inbound?.subtotal || 0).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <span className="text-xs text-muted-foreground">Almacenaje</span>
                  <div className="font-bold font-mono text-sm mt-1">€{(billingData.liquidation.concepts?.storage?.subtotal || 0).toFixed(2)}</div>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <span className="text-xs text-muted-foreground">Preparación / Salidas</span>
                  <div className="font-bold font-mono text-sm mt-1">
                    €{((billingData.liquidation.concepts?.outboundB2C?.subtotal || 0) + (billingData.liquidation.concepts?.outboundB2B?.subtotal || 0)).toFixed(2)}
                  </div>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <span className="text-xs text-muted-foreground">Devoluciones & Otros</span>
                  <div className="font-bold font-mono text-sm mt-1">
                    €{((billingData.liquidation.concepts?.returns?.subtotal || 0) + (billingData.liquidation.concepts?.valueAdded?.subtotal || 0)).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-muted-foreground bg-card border border-border rounded-xl">
              No current billing liquidation available for this period.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
