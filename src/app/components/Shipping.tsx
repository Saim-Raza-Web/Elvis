import { useState } from "react";
import { Truck, Search, MapPin, Package, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const shipments = [
  { id: "SHP-0430", order: "ORD-00183", customer: "Apex Industries", carrier: "FedEx", tracking: "784512345670", origin: "MIA", destination: "Chicago, IL", status: "in_transit", weight: "12.4 kg", date: "2026-06-25", eta: "2026-06-28" },
  { id: "SHP-0429", order: "ORD-00182", customer: "Blue Horizon LLC", carrier: "UPS", tracking: "1Z999AA1012345678", origin: "LAX", destination: "Seattle, WA", status: "in_transit", weight: "5.8 kg", date: "2026-06-25", eta: "2026-06-27" },
  { id: "SHP-0428", order: "ORD-00181", customer: "Nova Retail Group", carrier: "DHL", tracking: "DHL122456789", origin: "ORD", destination: "New York, NY", status: "delivered", weight: "28.3 kg", date: "2026-06-24", eta: "2026-06-26" },
  { id: "SHP-0427", order: "ORD-00179", customer: "Crestline Corp", carrier: "USPS", tracking: "9400111202555435117669", origin: "DAL", destination: "Denver, CO", status: "processing", weight: "3.1 kg", date: "2026-06-24", eta: "2026-06-29" },
  { id: "SHP-0426", order: "ORD-00178", customer: "TechFlow Systems", carrier: "FedEx", tracking: "784512345671", origin: "LAX", destination: "Portland, OR", status: "delivered", weight: "9.7 kg", date: "2026-06-23", eta: "2026-06-25" },
  { id: "SHP-0425", order: "ORD-00176", customer: "EastCoast Supplies", carrier: "UPS", tracking: "1Z999AA1012345679", origin: "JFK", destination: "Boston, MA", status: "in_transit", weight: "45.2 kg", date: "2026-06-22", eta: "2026-06-27" },
  { id: "SHP-0424", order: "ORD-00175", customer: "Red Rock Trading", carrier: "DHL", tracking: "DHL122456790", origin: "DAL", destination: "Phoenix, AZ", status: "delivered", weight: "7.0 kg", date: "2026-06-21", eta: "2026-06-23" },
];

const carriers = ["All", "FedEx", "UPS", "DHL", "USPS"];

const blankShipment = () => ({ order: "", customer: "", carrier: "FedEx", origin: "MIA", destination: "", weight: "", eta: "" });

export function Shipping() {
  const { t } = useLang();
  const [shipmentList, setShipmentList] = useState(shipments);
  const [search, setSearch] = useState("");
  const [carrier, setCarrier] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankShipment());

  function handleCreate() {
    if (!form.order || !form.destination) { toast.error("Order and destination are required."); return; }
    const id = `SHP-${String(shipmentList.length + 431).padStart(4, "0")}`;
    const tracking = Math.random().toString().slice(2, 20);
    setShipmentList((prev) => [...prev, { id, order: form.order, customer: form.customer, carrier: form.carrier, tracking, origin: form.origin, destination: form.destination, status: "processing", weight: form.weight || "—", date: new Date().toISOString().slice(0, 10), eta: form.eta || "TBD" }]);
    toast.success(`${t.shipping.shipmentCreated}: ${id}`);
    setShowAdd(false);
    setForm(blankShipment());
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
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.tracking.slice(0, 16)}…</span>
              <div className="flex items-center gap-2">
                <span>{s.weight}</span>
                <span>·</span>
                <span>ETA {s.eta}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.shipping.newShipment} subtitle="Create a shipment and assign carrier" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.shipping.trackingNo} required><Input value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder="ORD-XXXXX" /></Field>
          <Field label={t.orders.customer}><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Customer name" /></Field>
        </Row>
        <Row>
          <Field label={t.shipping.origin}><Select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
            {["MIA","LAX","ORD","JFK","DAL"].map((w) => <option key={w}>{w}</option>)}
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
