import { useState, useEffect, useRef } from "react";
import {
  Truck,
  Search,
  MapPin,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Printer,
  Layers,
  Calculator,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Radio,
  Boxes
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import type { ListService } from "../../hooks/usePaginatedList";
import { shippingService } from "../../services/shipping.service";
import { warehousesService } from "../../services/warehouses.service";
import { ordersService } from "../../services/orders.service";

type Shipment = {
  _id: string;
  id: string;
  order: string;
  orders?: string[];
  isGrouped?: boolean;
  groupedShipmentId?: string;
  customer: string;
  carrier: string;
  tracking: string;
  origin: string;
  destination: string;
  status: string;
  weight: string;
  date: string;
  eta: string;
  shipmentId?: string;
  shipment_type?: string;
  pallets_count?: number;
  labelUrl?: string;
};

const defaultCarrierCodes = ["All", "CTT", "CORREOS", "GLS", "DHL", "SEUR", "MRW"];

const blankShipment = () => ({
  order: "",
  orders: [] as string[],
  isGrouped: false,
  groupedShipmentId: "",
  customer: "",
  carrier: "CTT",
  origin: "MIA",
  destination: "",
  weight: "1.5",
  eta: "",
  shipment_type: "Parcel",
  pallets_count: 0
});

function mapShipment(d: unknown): Shipment {
  const data = d as Record<string, unknown>;
  return {
    _id: data._id as string,
    id: (data.shipmentId as string) || (data._id as string),
    order: (data.order as string) || (Array.isArray(data.orders) && data.orders[0]) || "—",
    orders: data.orders as string[] | undefined,
    isGrouped: data.isGrouped as boolean | undefined,
    groupedShipmentId: data.groupedShipmentId as string | undefined,
    customer: (data.customer as string) || "Customer",
    carrier: (data.carrier as string) || "CTT",
    tracking: (data.tracking as string) || "Pending",
    origin: (data.origin as string) || "MIA",
    destination: (data.destination as string) || "—",
    status: (data.status as string) || "pending",
    weight: (data.weight as string) || "1.5 kg",
    date: (data.date as string)?.slice(0, 10) || "—",
    eta: (data.eta as string)?.slice(0, 10) || "—",
    shipmentId: data.shipmentId as string | undefined,
    shipment_type: data.shipment_type as string | undefined,
    pallets_count: data.pallets_count as number | undefined,
    labelUrl: data.labelUrl as string | undefined
  };
}

const shippingListService: ListService<Shipment> = {
  getAll: async (params) => (await shippingService.getAll(params)).map(mapShipment),
  getPage: async (params) => {
    const result = await shippingService.getPage(params);
    return { data: result.data.map(mapShipment), pagination: result.pagination };
  },
};

export function Shipping() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [carrier, setCarrier] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [showSign, setShowSign] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [signatureData, setSignatureData] = useState("");
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [form, setForm] = useState(blankShipment());
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [availableCarriers, setAvailableCarriers] = useState<any[]>([]);

  // Tracking modal state
  const [showTracking, setShowTracking] = useState(false);
  const [trackingShipment, setTrackingShipment] = useState<Shipment | null>(null);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [loadingTracking, setLoadingTracking] = useState(false);
  const [syncingTracking, setSyncingTracking] = useState(false);

  // Rate Quotes modal state
  const [showRates, setShowRates] = useState(false);
  const [ratesForm, setRatesForm] = useState({
    destinationCountry: "ES",
    recipientPostalCode: "28001",
    weightKg: "2.0",
    serviceLevel: "STANDARD"
  });
  const [loadingRates, setLoadingRates] = useState(false);
  const [quotesList, setQuotesList] = useState<any[]>([]);

  // Grouped Shipments modal state
  const [showGroup, setShowGroup] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<any[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [groupValidation, setGroupValidation] = useState<any>(null);
  const [groupValidating, setGroupValidating] = useState(false);
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupCarrier, setGroupCarrier] = useState("CTT");

  const searchLower = search.toLowerCase();

  const { items: shipmentList, allItems, pagination, page, setPage, reload } = usePaginatedList<Shipment>(
    shippingListService,
    {
      apiParams: {
        search: searchLower || undefined,
        carrier: carrier !== "All" ? carrier : undefined,
      },
      deps: [search, carrier],
    }
  );

  useEffect(() => {
    warehousesService
      .getAll({ all: true })
      .then(setWarehouses)
      .catch(() => toast.error(t.common?.error || "Failed to load warehouses"));

    shippingService
      .getMethods()
      .then((res: any) => {
        if (res?.methods && Array.isArray(res.methods)) {
          setAvailableCarriers(res.methods);
        }
      })
      .catch(() => {});
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm(blankShipment()); setShowAdd(true); };
    window.addEventListener("open-new-shipment", handler);
    return () => window.removeEventListener("open-new-shipment", handler);
  }, []);

  const carrierPillOptions = [
    "All",
    ...Array.from(new Set([
      ...availableCarriers.map((c) => c.code),
      "CTT",
      "CORREOS",
      "GLS",
      "DHL",
      "SEUR",
      "MRW"
    ]))
  ];

  async function handleCreate() {
    if (!form.order && (!form.orders || form.orders.length === 0)) {
      toast.error(t.common?.error || "Order number is required.");
      return;
    }
    if (!form.destination) {
      toast.error(t.common?.error || "Destination is required.");
      return;
    }

    const id = `SHP-${String(allItems.length + 431).padStart(4, "0")}`;
    try {
      const payload: any = {
        ...form,
        shipmentId: id,
        tracking: "Pending", // Real tracking assigned by carrier
        status: "processing",
        weight: form.weight ? (form.weight.includes("kg") ? form.weight : `${form.weight} kg`) : "1.5 kg",
        date: new Date().toISOString().slice(0, 10),
        eta: form.eta || "TBD",
        shipment_type: form.shipment_type,
        pallets_count: Number(form.pallets_count) || 0
      };

      if (form.orders && Array.isArray(form.orders) && form.orders.length > 1) {
        payload.orders = form.orders;
        payload.isGrouped = true;
        payload.groupedShipmentId = `GRP-${Date.now()}`;
      } else {
        payload.order = form.order;
        payload.orders = [form.order];
      }

      const created = await shippingService.create(payload);

      // Attempt immediate carrier label and tracking assignment
      try {
        const labelRes = await shippingService.generateLabel(created._id || created.id, {
          carrier: form.carrier,
          weightKg: parseFloat(form.weight) || 1.5
        });
        toast.success(
          `${t.shipping.shipmentCreated}: ${id} via ${labelRes.carrierName || labelRes.carrier} (${labelRes.trackingNumber})`
        );
      } catch (labelErr: any) {
        toast.info(`${t.shipping.shipmentCreated}: ${id}. Note: Label can be generated from the shipment card.`);
      }

      setShowAdd(false);
      setForm(blankShipment());
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || t.common?.error || "Failed to create shipment");
    }
  }

  async function handleGenerateLabelForShipment(s: Shipment) {
    try {
      const res = await shippingService.generateLabel(s._id, {
        carrier: s.carrier,
        weightKg: parseFloat(s.weight) || 1.5
      });
      toast.success(`Label generated via ${res.carrierName || res.carrier} (${res.trackingNumber})`);
      if (res.labelUrl) {
        window.open(res.labelUrl, "_blank");
      }
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to generate carrier label");
    }
  }

  async function openTrackingModal(s: Shipment) {
    setTrackingShipment(s);
    setShowTracking(true);
    setLoadingTracking(true);
    setTrackingData(null);
    try {
      const data = await shippingService.getTracking(s._id);
      setTrackingData(data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to retrieve carrier tracking checkpoints");
    } finally {
      setLoadingTracking(false);
    }
  }

  async function handleSyncTrackingAuthoritative() {
    if (!trackingShipment) return;
    setSyncingTracking(true);
    try {
      const res = await shippingService.syncTracking(trackingShipment._id);
      if (res.statusChanged) {
        toast.success(`Status updated to ${res.shipmentStatus} based on carrier tracking (${res.carrierStatus})`);
      } else {
        toast.info(`Shipment status already up-to-date (${res.shipmentStatus})`);
      }
      setTrackingData((prev: any) => ({
        ...prev,
        shipmentStatus: res.shipmentStatus,
        status: res.carrierStatus,
        events: res.events
      }));
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to sync tracking with carrier");
    } finally {
      setSyncingTracking(false);
    }
  }

  async function handleCalculateRates() {
    setLoadingRates(true);
    try {
      const res = await shippingService.getRateQuote({
        destinationCountry: ratesForm.destinationCountry,
        recipientPostalCode: ratesForm.recipientPostalCode,
        weightKg: parseFloat(ratesForm.weightKg) || 1.0,
        serviceLevel: ratesForm.serviceLevel,
        compare: true
      });
      setQuotesList(res.quotes || []);
      if (!res.quotes || res.quotes.length === 0) {
        toast.info("No carrier rate quotes returned for this destination.");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to calculate carrier rates");
    } finally {
      setLoadingRates(false);
    }
  }

  async function openGroupModal() {
    setShowGroup(true);
    setSelectedOrderIds([]);
    setGroupValidation(null);
    try {
      const orders = await ordersService.getAll({ all: true });
      const eligible = orders.filter(
        (o: any) => !o.shipmentId && !["delivered", "cancelled", "shipped"].includes(o.status)
      );
      setAvailableOrders(eligible);
    } catch (err) {
      toast.error("Failed to load eligible orders for grouping");
    }
  }

  async function handleValidateGroup() {
    if (selectedOrderIds.length < 2) {
      toast.error("Please select at least 2 orders to group.");
      return;
    }
    setGroupValidating(true);
    setGroupValidation(null);
    try {
      const res = await shippingService.groupOrders({ orderIds: selectedOrderIds });
      setGroupValidation({ valid: true, data: res });
      toast.success(`Group valid! ${res.orderCount} orders compatible from warehouse ${res.warehouse}`);
    } catch (err: any) {
      setGroupValidation({
        valid: false,
        errors: err.response?.data?.errors || [err.response?.data?.message || "Grouping validation failed"]
      });
    } finally {
      setGroupValidating(false);
    }
  }

  async function handleCreateGroupedShipment() {
    if (!groupValidation?.valid) return;
    setGroupCreating(true);
    try {
      const gData = groupValidation.data;
      const id = `SHP-GRP-${Date.now().toString().slice(-6)}`;
      const payload = {
        shipmentId: id,
        orders: selectedOrderIds,
        order: selectedOrderIds[0],
        isGrouped: true,
        groupedShipmentId: `GRP-${Date.now()}`,
        customer: `${gData.owner} (${gData.orderCount} orders)`,
        carrier: groupCarrier,
        origin: gData.warehouse || "MIA",
        destination: "Distribution Center",
        status: "processing",
        weight: `${Math.max(1, (gData.totalItems || 1) * 0.8).toFixed(1)} kg`,
        shipment_type: gData.orderType === "B2B" ? "Pallet" : "Parcel",
        date: new Date().toISOString().slice(0, 10),
        tracking: "Pending"
      };

      const created = await shippingService.create(payload);

      try {
        await shippingService.generateLabel(created._id || created.id, {
          carrier: groupCarrier,
          weightKg: (gData.totalItems || 1) * 0.8
        });
      } catch (_) {}

      toast.success(`Grouped shipment created: ${id} (${selectedOrderIds.length} orders)`);
      setShowGroup(false);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create grouped shipment");
    } finally {
      setGroupCreating(false);
    }
  }

  async function handleStatusUpdate(s: Shipment) {
    try {
      const newStatus = s.status === "processing" ? "in_transit" : "delivered";
      await shippingService.update(s._id, { status: newStatus });
      toast.success(`Shipment ${s.id} is now ${newStatus.replace("_", " ")}.`);
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to update shipment status");
    }
  }

  async function handleSign() {
    if (!selectedShipment) return;
    if (!signatureData || signatureData.trim().length === 0) {
      toast.error("Please draw a signature before submitting");
      return;
    }
    try {
      await shippingService.signShipment(selectedShipment._id, { signatureData, discrepancyNote });
      toast.success(`Shipment ${selectedShipment.id} signed successfully`);
      setShowSign(false);
      setSignatureData("");
      setDiscrepancyNote("");
      setSelectedShipment(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to sign shipment");
    }
  }

  const inTransit = allItems.filter((s) => s.status === "in_transit").length;
  const delivered = allItems.filter((s) => s.status === "delivered").length;
  const processing = allItems.filter((s) => s.status === "processing" || s.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t.shipping.activeShipments, value: inTransit, icon: Truck, color: "text-primary" },
          { label: t.shipping.totalShipped, value: processing, icon: Clock, color: "text-warning" },
          { label: t.shipping.deliveredToday, value: delivered, icon: CheckCircle2, color: "text-success" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.common.search + "…"}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors"
            style={{ fontSize: "0.875rem" }}
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto py-1">
          {carrierPillOptions.map((c) => (
            <button
              key={c}
              onClick={() => setCarrier(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                carrier === c ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <button
          onClick={() => { setShowRates(true); if (quotesList.length === 0) handleCalculateRates(); }}
          className="px-3.5 py-2 border border-border hover:bg-secondary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Calculator className="size-4 text-primary" /> Rate Quotes
        </button>

        <button
          onClick={openGroupModal}
          className="px-3.5 py-2 border border-border hover:bg-secondary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Layers className="size-4 text-info" /> Group Orders
        </button>

        <PrimaryButton icon={Package} onClick={() => setShowAdd(true)}>{t.shipping.newShipment}</PrimaryButton>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {shipmentList.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.id}</span>
                  <StatusBadge status={s.status} />
                  {s.shipment_type === 'Pallet' && (
                    <span className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded font-bold uppercase">
                      LTL Pallet
                    </span>
                  )}
                  {s.isGrouped && (
                    <span className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-1">
                      <Boxes className="size-3" /> Grouped ({s.orders?.length || 2})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.order} · {s.customer}
                </div>
              </div>
              <span className="text-xs font-semibold bg-secondary px-2.5 py-1 rounded text-primary">
                {s.carrier}
              </span>
            </div>

            {/* Grouped orders detail banner if applicable */}
            {s.isGrouped && s.orders && s.orders.length > 0 && (
              <div className="mb-3 text-[11px] bg-secondary/50 p-2 rounded border border-border/50 flex items-center justify-between">
                <span className="font-semibold text-muted-foreground">Orders:</span>
                <span className="font-mono text-foreground font-medium">{s.orders.join(", ")}</span>
              </div>
            )}

            {/* Route */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-1 text-xs">
                <MapPin className="size-3 text-muted-foreground" />
                <span>{s.origin}</span>
              </div>
              <div className="flex-1 h-px bg-border relative">
                <div className={`absolute inset-0 ${s.status === "delivered" ? "bg-success" : s.status === "in_transit" ? "bg-primary" : "bg-border"}`} />
              </div>
              <div className="flex items-center gap-1 text-xs">
                <MapPin className="size-3 text-muted-foreground" />
                <span>{s.destination}</span>
              </div>
            </div>

            {/* Tracking + details */}
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground">Tracking:</span>
                <span style={{ fontFamily: "JetBrains Mono, monospace" }} className="font-medium text-foreground">
                  {s.tracking && s.tracking !== "Pending" ? s.tracking : "Pending (Not Generated)"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>{s.weight}</span>
                <span>·</span>
                <span>ETA {s.eta}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 pt-3 border-t border-border flex flex-wrap justify-end gap-2 items-center">
              {/* Label Action */}
              {s.tracking && s.tracking !== "Pending" ? (
                <a
                  href={`/api/v1/shipping/${s._id}/label`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Printer className="size-3.5 text-primary" /> Label PDF
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => handleGenerateLabelForShipment(s)}
                  className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Printer className="size-3.5" /> Generate Label
                </button>
              )}

              {/* Tracking Checkpoints Action */}
              {s.tracking && s.tracking !== "Pending" && (
                <button
                  type="button"
                  onClick={() => openTrackingModal(s)}
                  className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Truck className="size-3.5 text-info" /> Track Checkpoints
                </button>
              )}

              {/* Sign Delivery */}
              {s.status === "in_transit" && (
                <button
                  type="button"
                  onClick={() => { setSelectedShipment(s); setShowSign(true); }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  Sign Delivery
                </button>
              )}

              {/* Status Update / Authoritative Sync */}
              {s.status !== "delivered" && (
                <button
                  type="button"
                  onClick={() => s.tracking && s.tracking !== "Pending" ? openTrackingModal(s) : handleStatusUpdate(s)}
                  className="px-3 py-1.5 bg-secondary hover:bg-primary hover:text-primary-foreground text-foreground rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                >
                  {s.tracking && s.tracking !== "Pending" ? (
                    <>
                      <RefreshCw className="size-3" /> Sync / Update Status
                    </>
                  ) : s.status === "processing" || s.status === "pending" ? (
                    "Ship (In Transit)"
                  ) : (
                    "Mark Delivered"
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <TablePagination pagination={pagination} page={page} onPageChange={setPage} />

      {/* New Shipment Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.shipping.newShipment} subtitle="Create a shipment and assign carrier adapter" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.shipping.trackingNo} required><Input value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder="ORD-XXXXX" /></Field>
          <Field label={t.orders.customer}><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Customer name" /></Field>
        </Row>
        <Row>
          <Field label={t.common.warehouse} required><Select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
            {warehouses.length === 0 && <option value="MIA">MIA</option>}
          </Select></Field>
          <Field label="Carrier Adapter"><Select value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}>
            {["CTT", "CORREOS", "GLS", "DHL", "SEUR", "MRW"].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select></Field>
        </Row>
        <Field label={t.shipping.destination} required><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="City, State / Country" /></Field>
        <Row>
          <Field label="Shipment Mode"><Select value={form.shipment_type} onChange={(e) => setForm({ ...form, shipment_type: e.target.value })}>
            <option value="Parcel">Parcel (B2C)</option>
            <option value="Pallet">LTL Pallet (B2B)</option>
          </Select></Field>
          {form.shipment_type === 'Pallet' && (
            <Field label="Pallets Count"><Input type="number" value={form.pallets_count} onChange={(e) => setForm({ ...form, pallets_count: Number(e.target.value) })} /></Field>
          )}
        </Row>
        <Row>
          <Field label={t.shipping.weight}><Input value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="1.5 kg" /></Field>
          <Field label={t.shipping.estimatedDelivery}><Input type="date" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} /></Field>
        </Row>
      </Modal>

      {/* Tracking Modal */}
      <Modal open={showTracking} onClose={() => setShowTracking(false)} title="Shipment Tracking" subtitle={`Tracking: ${trackingShipment?.tracking} · Carrier: ${trackingShipment?.carrier}`} footer={<><ModalCancel onClose={() => setShowTracking(false)} />{trackingShipment?.status !== 'delivered' && <button onClick={handleSyncTrackingAuthoritative} disabled={syncingTracking} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5">{syncingTracking ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sync Status from Carrier</button>}</>}>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 border border-border text-xs">
            <div>
              <div className="font-semibold text-foreground text-sm flex items-center gap-2">
                <span>{trackingShipment?.carrier}</span>
                <span className="font-mono text-xs text-muted-foreground">{trackingShipment?.tracking}</span>
              </div>
              <div className="text-muted-foreground mt-0.5">
                Shipment Status: <strong className="text-foreground capitalize">{trackingData?.shipmentStatus || trackingShipment?.status}</strong>
              </div>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-primary/10 text-primary">
                {trackingData?.status || "IN_TRANSIT"}
              </span>
              <div className="text-[10px] text-muted-foreground mt-1">
                {trackingData?.isProductionConfigured ? "✓ Live Carrier API" : "Hermetic Sandbox"}
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
              <Clock className="size-3.5" /> Checkpoint Timeline
            </h4>
            {loadingTracking ? (
              <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="size-4 animate-spin text-primary" /> Loading tracking events from carrier...
              </div>
            ) : trackingData?.events && trackingData.events.length > 0 ? (
              <div className="space-y-3 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {trackingData.events.map((ev: any, idx: number) => (
                  <div key={idx} className="relative pl-6 text-xs">
                    <div className="absolute left-1 top-1 size-2 rounded-full bg-primary -translate-x-1/2 ring-4 ring-background" />
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="font-semibold text-foreground capitalize">{ev.status?.toLowerCase().replace(/_/g, ' ')}</span>
                      <span>{new Date(ev.timestamp).toLocaleString()}</span>
                    </div>
                    {ev.location && <div className="text-[11px] text-muted-foreground font-medium">{ev.location}</div>}
                    <div className="text-foreground mt-0.5">{ev.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-secondary/30 text-center text-xs text-muted-foreground">
                No checkpoints returned by carrier yet. Shipment is preregistered.
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Rate Quotes Modal */}
      <Modal open={showRates} onClose={() => setShowRates(false)} title="Carrier Rate Calculator & Quotes" subtitle="Real-time multi-carrier rate calculation" footer={<><ModalCancel onClose={() => setShowRates(false)} /><button onClick={handleCalculateRates} disabled={loadingRates} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5">{loadingRates ? <RefreshCw className="size-3.5 animate-spin" /> : <Calculator className="size-3.5" />} Calculate Rates</button></>}>
        <div className="space-y-4">
          <Row>
            <Field label="Destination Country">
              <Select value={ratesForm.destinationCountry} onChange={(e) => setRatesForm({ ...ratesForm, destinationCountry: e.target.value })}>
                <option value="ES">Spain (ES)</option>
                <option value="PT">Portugal (PT)</option>
                <option value="FR">France (FR)</option>
                <option value="DE">Germany (DE)</option>
                <option value="IT">Italy (IT)</option>
                <option value="US">United States (US)</option>
              </Select>
            </Field>
            <Field label="Postal / ZIP Code">
              <Input value={ratesForm.recipientPostalCode} onChange={(e) => setRatesForm({ ...ratesForm, recipientPostalCode: e.target.value })} placeholder="28001" />
            </Field>
          </Row>
          <Row>
            <Field label="Weight (kg)">
              <Input type="number" step="0.1" value={ratesForm.weightKg} onChange={(e) => setRatesForm({ ...ratesForm, weightKg: e.target.value })} />
            </Field>
            <Field label="Service Level">
              <Select value={ratesForm.serviceLevel} onChange={(e) => setRatesForm({ ...ratesForm, serviceLevel: e.target.value })}>
                <option value="STANDARD">Standard (24/48h)</option>
                <option value="EXPRESS">Express (Time-Definite 14h)</option>
                <option value="ECONOMY">Economy Ground</option>
              </Select>
            </Field>
          </Row>

          <div>
            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">Available Carrier Quotes</h4>
            {loadingRates ? (
              <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="size-4 animate-spin text-primary" /> Calculating rates across carriers...
              </div>
            ) : quotesList.length > 0 ? (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-secondary/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="p-2.5">Carrier</th>
                      <th className="p-2.5">Transit</th>
                      <th className="p-2.5">Environment</th>
                      <th className="p-2.5 text-right">Rate (€)</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {quotesList.map((q, idx) => (
                      <tr key={idx} className="hover:bg-secondary/30 transition-colors">
                        <td className="p-2.5 font-semibold text-foreground">
                          {q.carrierName} ({q.carrier})
                        </td>
                        <td className="p-2.5 text-muted-foreground">
                          {q.estimatedDeliveryDays} {q.estimatedDeliveryDays === 1 ? "day" : "days"}
                        </td>
                        <td className="p-2.5">
                          {q.isProductionConfigured ? (
                            <span className="text-[10px] bg-success/15 text-success px-1.5 py-0.5 rounded font-semibold">Live API</span>
                          ) : (
                            <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">Sandbox Tariff</span>
                          )}
                        </td>
                        <td className="p-2.5 text-right font-bold text-foreground font-mono">
                          €{Number(q.rate).toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setForm({
                                ...form,
                                carrier: q.carrier,
                                weight: ratesForm.weightKg
                              });
                              setShowRates(false);
                              setShowAdd(true);
                              toast.info(`Selected ${q.carrierName} for new shipment`);
                            }}
                            className="px-2 py-1 bg-primary text-primary-foreground text-[11px] font-semibold rounded hover:opacity-90"
                          >
                            Use
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-muted-foreground bg-secondary/20 rounded-lg">
                Click &quot;Calculate Rates&quot; to fetch carrier pricing.
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Group Orders Modal */}
      <Modal open={showGroup} onClose={() => setShowGroup(false)} title="Group Orders for Shipment" subtitle="Group multiple compatible orders into a single consolidated shipment" footer={<><ModalCancel onClose={() => setShowGroup(false)} /><button onClick={handleValidateGroup} disabled={groupValidating || selectedOrderIds.length < 2} className="px-3.5 py-2 border border-border hover:bg-secondary rounded-lg text-xs font-semibold flex items-center gap-1.5">{groupValidating ? <RefreshCw className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Validate Compatibility</button>{groupValidation?.valid && <button onClick={handleCreateGroupedShipment} disabled={groupCreating} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5">{groupCreating ? <RefreshCw className="size-3.5 animate-spin" /> : <Boxes className="size-3.5" />} Create Grouped Shipment</button>}</>}>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground">Select Orders to Group (minimum 2)</label>
              <span className="text-xs font-mono">{selectedOrderIds.length} selected</span>
            </div>
            {availableOrders.length === 0 ? (
              <div className="p-4 bg-secondary/30 rounded-lg text-center text-xs text-muted-foreground">
                No eligible unassigned orders found.
              </div>
            ) : (
              <div className="border border-border rounded-lg max-h-48 overflow-y-auto divide-y divide-border">
                {availableOrders.map((ord: any) => {
                  const isChecked = selectedOrderIds.includes(ord.orderId);
                  return (
                    <label key={ord._id || ord.orderId} className={`flex items-center justify-between p-2.5 text-xs hover:bg-secondary/40 cursor-pointer ${isChecked ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOrderIds([...selectedOrderIds, ord.orderId]);
                            } else {
                              setSelectedOrderIds(selectedOrderIds.filter((id) => id !== ord.orderId));
                            }
                            setGroupValidation(null);
                          }}
                          className="size-3.5 rounded border-border"
                        />
                        <div>
                          <span className="font-bold text-foreground font-mono">{ord.orderId}</span>
                          <span className="text-muted-foreground ml-2">({ord.customer})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
                        <span>WH: <strong>{ord.warehouse || 'MIA'}</strong></span>
                        <span>·</span>
                        <span>{ord.order_type || 'B2C'}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Validation Feedback */}
          {groupValidation && (
            <div>
              {groupValidation.valid ? (
                <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-xs space-y-1">
                  <div className="font-bold text-success flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> Grouping Compatible
                  </div>
                  <div className="text-muted-foreground">
                    Warehouse: <strong className="text-foreground">{groupValidation.data.warehouse}</strong> · Owner: <strong className="text-foreground">{groupValidation.data.owner}</strong> · Type: <strong className="text-foreground">{groupValidation.data.orderType}</strong>
                  </div>
                  <div className="text-muted-foreground">
                    Total Items: <strong className="text-foreground">{groupValidation.data.totalItems}</strong> · Total Value: <strong className="text-foreground">€{Number(groupValidation.data.totalValue || 0).toFixed(2)}</strong>
                  </div>
                  <div className="pt-2">
                    <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Assign Carrier Adapter</label>
                    <select
                      value={groupCarrier}
                      onChange={(e) => setGroupCarrier(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-background border border-border rounded text-xs outline-none"
                    >
                      {["CTT", "CORREOS", "GLS", "DHL", "SEUR", "MRW"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs space-y-1">
                  <div className="font-bold text-destructive flex items-center gap-1.5">
                    <AlertCircle className="size-4" /> Incompatible Orders
                  </div>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                    {groupValidation.errors?.map((err: string, i: number) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Signature Modal */}
      <Modal open={showSign} onClose={() => setShowSign(false)} title="Sign Delivery Document" subtitle={`Shipment: ${selectedShipment?.id}`} footer={<><ModalCancel onClose={() => setShowSign(false)} /><ModalSubmit onClick={handleSign}>Sign & Submit</ModalSubmit></>}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-2">Signer Information</label>
            <div className="bg-secondary/30 p-3 rounded-lg text-xs space-y-1">
              <div><span className="text-muted-foreground">Shipment:</span> {selectedShipment?.id}</div>
              <div><span className="text-muted-foreground">Recipient:</span> {selectedShipment?.customer || "Authorized Signatory"}</div>
              <div><span className="text-muted-foreground">Role:</span> Delivery Signatory</div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2">Digital Signature</label>
            <SignaturePad value={signatureData} onChange={setSignatureData} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2">Discrepancy Note (if applicable)</label>
            <textarea
              value={discrepancyNote}
              onChange={(e) => setDiscrepancyNote(e.target.value)}
              placeholder="Enter any discrepancies or delivery notes..."
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-xs outline-none resize-none"
              rows={3}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface SignaturePadProps {
  value: string;
  onChange: (dataUrl: string) => void;
}

function SignaturePad({ value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e && e.touches.length > 0) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    const mouseEvent = e as React.MouseEvent<HTMLCanvasElement>;
    return {
      x: mouseEvent.clientX - rect.left,
      y: mouseEvent.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas && hasDrawn) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-border rounded-lg bg-card p-1 overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          width={440}
          height={150}
          className="w-full h-36 bg-white rounded cursor-crosshair block"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && !value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground/50 text-xs">
            Draw signature here using mouse or touch
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {hasDrawn || value ? "✓ Signature captured" : "Draw above to sign"}
        </span>
        <button
          type="button"
          onClick={clear}
          className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary rounded transition-colors"
        >
          Clear Signature
        </button>
      </div>
    </div>
  );
}
