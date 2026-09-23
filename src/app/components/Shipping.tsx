import { useState, useEffect, useRef } from "react";
import { Truck, Search, MapPin, Package, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import type { ListService } from "../../hooks/usePaginatedList";
import { shippingService } from "../../services/shipping.service";
import { warehousesService } from "../../services/warehouses.service";

type Shipment = { _id: string; id: string; order: string; orders?: string[]; isGrouped?: boolean; groupedShipmentId?: string; customer: string; carrier: string; tracking: string; origin: string; destination: string; status: string; weight: string; date: string; eta: string; shipmentId?: string; shipment_type?: string; pallets_count?: number };

const carriers = ["All", "FedEx", "UPS", "DHL", "USPS", "LTL Freight"];

const blankShipment = () => ({ order: "", orders: [], isGrouped: false, groupedShipmentId: "", customer: "", carrier: "FedEx", origin: "MIA", destination: "", weight: "", eta: "", shipment_type: "Parcel", pallets_count: 0 });

function mapShipment(d: unknown): Shipment {
  const data = d as Record<string, unknown>;
  return {
    _id: data._id as string,
    id: (data.shipmentId as string) || (data._id as string),
    order: data.order as string,
    orders: data.orders as string[] | undefined,
    isGrouped: data.isGrouped as boolean | undefined,
    groupedShipmentId: data.groupedShipmentId as string | undefined,
    customer: data.customer as string,
    carrier: data.carrier as string,
    tracking: data.tracking as string,
    origin: data.origin as string,
    destination: data.destination as string,
    status: data.status as string,
    weight: data.weight as string,
    date: (data.date as string)?.slice(0, 10) || "—",
    eta: (data.eta as string)?.slice(0, 10) || "—",
    shipmentId: data.shipmentId as string | undefined,
    shipment_type: data.shipment_type as string | undefined,
    pallets_count: data.pallets_count as number | undefined
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
    warehousesService.getAll({ all: true }).then(setWarehouses).catch(() => toast.error(t.common?.error || "Failed to load warehouses"));
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm(blankShipment()); setShowAdd(true); };
    window.addEventListener("open-new-shipment", handler);
    return () => window.removeEventListener("open-new-shipment", handler);
  }, []);

  async function handleCreate() {
    if (!form.order && !form.orders) { toast.error(t.common?.error || "Order is required."); return; }
    if (!form.destination) { toast.error(t.common?.error || "Destination is required."); return; }
    const id = `SHP-${String(allItems.length + 431).padStart(4, "0")}`;
    const tracking = Math.random().toString().slice(2, 20);
    try {
      const payload = {
        ...form,
        shipmentId: id,
        tracking,
        status: "processing",
        weight: form.weight || "—",
        date: new Date().toISOString().slice(0, 10),
        eta: form.eta || "TBD",
        shipment_type: form.shipment_type,
        pallets_count: Number(form.pallets_count)
      };
      // Support both single order and grouped orders
      if (form.orders && Array.isArray(form.orders) && form.orders.length > 1) {
        payload.orders = form.orders;
        payload.isGrouped = true;
        payload.groupedShipmentId = `GRP-${Date.now()}`;
      } else {
        payload.order = form.order;
        payload.orders = [form.order];
      }
      await shippingService.create(payload);
      toast.success(`${t.shipping.shipmentCreated}: ${id}`);
      setShowAdd(false);
      setForm(blankShipment());
      reload();
    } catch (err) { toast.error(t.common?.error || "Failed to create shipment"); }
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
  const processing = allItems.filter((s) => s.status === "processing").length;

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
        {shipmentList.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.id}</span>
                  <StatusBadge status={s.status} />
                  {s.shipment_type === 'Pallet' && <span className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded font-bold uppercase">LTL Pallet</span>}
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
              <div className="mt-4 pt-3 border-t border-border flex justify-end gap-2">
                {s.status === "in_transit" && (
                  <button
                    onClick={() => { setSelectedShipment(s); setShowSign(true); }}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                  >
                    Sign Delivery
                  </button>
                )}
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
      <TablePagination pagination={pagination} page={page} onPageChange={setPage} />

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
            {["FedEx","UPS","DHL","USPS","LTL Freight"].map((c) => <option key={c}>{c}</option>)}
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
          <Field label={t.shipping.weight}><Input value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="5.0 kg" /></Field>
          <Field label={t.shipping.estimatedDelivery}><Input type="date" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} /></Field>
        </Row>
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
