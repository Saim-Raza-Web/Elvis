import { useState } from "react";
import { Truck, Search, MapPin, Package, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { shippingService } from "../../services/shipping.service";
import { warehousesService } from "../../services/warehouses.service";

type Shipment = { _id: string; id: string; order: string; customer: string; carrier: string; tracking: string; origin: string; destination: string; status: string; weight: string; date: string; eta: string; shipmentId?: string };

const carriers = ["All", "FedEx", "UPS", "DHL", "USPS"];

const blankShipment = () => ({ order: "", customer: "", carrier: "FedEx", origin: "MIA", destination: "", weight: "", eta: "" });

export function Shipping() {
  const { t } = useLang();
  const [shipmentList, setShipmentList] = useState<Shipment[]>([]);
  const [search, setSearch] = useState("");
  const [carrier, setCarrier] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankShipment());
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const [data, whs] = await Promise.all([
        shippingService.getAll(),
        warehousesService.getAll()
      ]);
      setShipmentList(data.map((d: any) => ({ ...d, id: d.shipmentId || d._id, date: d.date?.slice(0, 10) || "—", eta: d.eta?.slice(0, 10) || "—" })));
      setWarehouses(whs);
    } catch (err) {
      toast.error("Failed to load shipments");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm(blankShipment()); setShowAdd(true); };
    window.addEventListener("open-new-shipment", handler);
    return () => window.removeEventListener("open-new-shipment", handler);
  }, []);

  async function handleCreate() {
    if (!form.order || !form.destination) { toast.error("Order and destination are required."); return; }
    const id = `SHP-${String(shipmentList.length + 431).padStart(4, "0")}`;
    const tracking = Math.random().toString().slice(2, 20);
    try {
      await shippingService.create({ ...form, shipmentId: id, tracking, status: "processing", weight: form.weight || "—", date: new Date().toISOString().slice(0, 10), eta: form.eta || "TBD" });
      toast.success(`${t.shipping.shipmentCreated}: ${id}`);
      setShowAdd(false);
      setForm(blankShipment());
      loadData();
    } catch (err) { toast.error("Failed to create shipment"); }
  }

  async function handleStatusUpdate(s: Shipment) {
    try {
      const newStatus = s.status === "processing" ? "in_transit" : "delivered";
      await shippingService.update(s._id, { status: newStatus });
      toast.success(`Shipment ${s.id} is now ${newStatus.replace("_", " ")}.`);
      loadData();
    } catch (err) {
      toast.error("Failed to update shipment status");
    }
  }

  const filtered = shipmentList.filter((s) => {
    const matchSearch = s.id.toLowerCase().includes(search.toLowerCase()) || s.customer.toLowerCase().includes(search.toLowerCase()) || s.tracking.includes(search);
    const matchCarrier = carrier === "All" || s.carrier === carrier;
    return matchSearch && matchCarrier;
  });

  const inTransit = shipmentList.filter((s) => s.status === "in_transit").length;
  const delivered = shipmentList.filter((s) => s.status === "delivered").length;
  const processing = shipmentList.filter((s) => s.status === "processing").length;

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
        <div className="flex gap-1.5">
          {carriers.map((c) => (
            <button
              key={c}
              onClick={() => setCarrier(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${carrier === c ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <PrimaryButton icon={Package} onClick={() => setShowAdd(true)}>{t.shipping.newShipment}</PrimaryButton>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.id}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="text-xs text-muted-foreground">{s.order} · {s.customer}</div>
              </div>
              <span className="text-xs font-semibold bg-secondary px-2 py-1 rounded">{s.carrier}</span>
            </div>

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
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.tracking.slice(0, 16)}…</span>
              <div className="flex items-center gap-2">
                <span>{s.weight}</span>
                <span>·</span>
                <span>ETA {s.eta}</span>
              </div>
            </div>
            
            {s.status !== "delivered" && (
              <div className="mt-4 pt-3 border-t border-border flex justify-end">
                <button
                  onClick={() => handleStatusUpdate(s)}
                  className="px-4 py-1.5 bg-secondary hover:bg-primary hover:text-primary-foreground text-foreground rounded-lg text-xs font-semibold transition-colors"
                >
                  {s.status === "processing" ? "Ship (In Transit)" : "Mark Delivered"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.shipping.newShipment} subtitle="Create a shipment and assign carrier" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.shipping.trackingNo} required><Input value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder="ORD-XXXXX" /></Field>
          <Field label={t.orders.customer}><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Customer name" /></Field>
        </Row>
        <Row>
          <Field label={t.common.warehouse} required><Select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
            {warehouses.length === 0 && <option value="MIA">MIA</option>}
          </Select></Field>
          <Field label={t.common.type}><Select value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}>
            {["FedEx","UPS","DHL","USPS","GLS"].map((c) => <option key={c}>{c}</option>)}
          </Select></Field>
        </Row>
        <Field label={t.shipping.destination} required><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="City, State / Country" /></Field>
        <Row>
          <Field label={t.shipping.weight}><Input value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="5.0 kg" /></Field>
          <Field label={t.shipping.estimatedDelivery}><Input type="date" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} /></Field>
        </Row>
      </Modal>
    </div>
  );
}
