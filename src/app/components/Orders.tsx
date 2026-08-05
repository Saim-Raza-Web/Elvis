import { useState, useEffect } from "react";
import {
  ShoppingCart, Plus, Search, Eye, FileText, Download, Trash2,
  Package, Building2, MapPin, Truck, X,
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";
import { ordersService } from "../../services/orders.service";
import { warehousesService } from "../../services/warehouses.service";
import { ecommerceService } from "../../services/ecommerce.service";
import { exportToCSV } from "../../lib/csvExport";

// ─────────────────────────────────────────────────────────────
//   Types
// ─────────────────────────────────────────────────────────────
type ProductLine = { sku: string; product_name: string; qty: number; unit_price: number; line_total: number };
type DeliveryAddress = { street: string; number: string; postcode: string; city: string; region: string; country: string };

type Order = {
  _id: string; orderId: string; customer: string; email: string;
  channel: string; warehouse: string; items: number; total: number;
  subtotal: number; vat_rate: number; vat_amount: number;
  status: string; date: string; notes: string; order_type: string;
  store_id?: string; store_name?: string;
  // B2C
  delivery_address?: DeliveryAddress;
  tracking_number?: string; package_weight?: string; package_dimensions?: string;
  // B2B
  company_name?: string; vat_number?: string; contact_person?: string;
  contact_phone?: string; pallet_count?: number; shipment_weight?: string;
  delivery_terms?: string; agreed_delivery_date?: string; po_reference?: string;
  // Lines
  product_lines?: ProductLine[];
  delivery_note_number?: string;
};

const statusFilters = ["All", "pending", "processing", "shipped", "delivered", "cancelled"];
const DELIVERY_TERMS = ["EXW", "FCA", "DDP"];
const VAT_RATE = 21;

const blankAddress = (): DeliveryAddress => ({ street: "", number: "", postcode: "", city: "", region: "", country: "" });
const blankLine = (): ProductLine => ({ sku: "", product_name: "", qty: 1, unit_price: 0, line_total: 0 });

type OrderForm = {
  customer: string; email: string; order_type: string;
  channel: string; warehouse: string; notes: string; store_id: string;
  delivery_address: DeliveryAddress; product_lines: ProductLine[];
  // B2C
  tracking_number: string; package_weight: string; package_dimensions: string;
  // B2B
  company_name: string; vat_number: string; contact_person: string;
  contact_phone: string; pallet_count: string; shipment_weight: string;
  delivery_terms: string; agreed_delivery_date: string; po_reference: string;
};

const blankForm = (): OrderForm => ({
  customer: "", email: "", order_type: "B2C",
  channel: "web", warehouse: "MIA", notes: "", store_id: "",
  delivery_address: blankAddress(), product_lines: [blankLine()],
  tracking_number: "", package_weight: "", package_dimensions: "",
  company_name: "", vat_number: "", contact_person: "", contact_phone: "",
  pallet_count: "", shipment_weight: "", delivery_terms: "",
  agreed_delivery_date: "", po_reference: "",
});

// ─────────────────────────────────────────────────────────────
//   List Service
// ─────────────────────────────────────────────────────────────
const ordersListService: ListService<Order> = {
  getAll: (params) => ordersService.getAll(params) as Promise<Order[]>,
  getPage: (params) => ordersService.getPage(params) as Promise<any>,
};

// ─────────────────────────────────────────────────────────────
//   Totals Calculator
// ─────────────────────────────────────────────────────────────
function calcTotals(lines: ProductLine[]) {
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const vat_amount = parseFloat((subtotal * (VAT_RATE / 100)).toFixed(2));
  const total = parseFloat((subtotal + vat_amount).toFixed(2));
  return { subtotal, vat_amount, total, items: lines.reduce((s, l) => s + l.qty, 0) };
}

// ─────────────────────────────────────────────────────────────
//   Product Lines Editor
// ─────────────────────────────────────────────────────────────
function ProductLinesEditor({ lines, onChange }: { lines: ProductLine[]; onChange: (l: ProductLine[]) => void }) {
  function update(i: number, field: keyof ProductLine, value: string | number) {
    const next = lines.map((l, idx) => {
      if (idx !== i) return l;
      const updated = { ...l, [field]: value };
      if (field === "qty" || field === "unit_price") {
        updated.line_total = parseFloat((Number(updated.qty) * Number(updated.unit_price)).toFixed(2));
      }
      return updated;
    });
    onChange(next);
  }

  function addLine() { onChange([...lines, blankLine()]); }
  function removeLine(i: number) { if (lines.length > 1) onChange(lines.filter((_, idx) => idx !== i)); }

  const { subtotal, vat_amount, total } = calcTotals(lines);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Product Lines</span>
        <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-primary hover:underline font-semibold">
          <Plus className="size-3.5" /> Add Line
        </button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-2 w-24">SKU *</th>
              <th className="text-left px-2 py-2">Product Name *</th>
              <th className="text-center px-2 py-2 w-16">Qty *</th>
              <th className="text-right px-2 py-2 w-24">Unit Price *</th>
              <th className="text-right px-2 py-2 w-24">Line Total</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-1 py-1">
                  <input value={l.sku} onChange={e => update(i, "sku", e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-border bg-secondary/30 outline-none focus:border-primary/50 text-xs" placeholder="SKU-001" />
                </td>
                <td className="px-1 py-1">
                  <input value={l.product_name} onChange={e => update(i, "product_name", e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-border bg-secondary/30 outline-none focus:border-primary/50 text-xs" placeholder="Product description" />
                </td>
                <td className="px-1 py-1">
                  <input type="number" min={1} value={l.qty} onChange={e => update(i, "qty", Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded border border-border bg-secondary/30 outline-none focus:border-primary/50 text-xs text-center" />
                </td>
                <td className="px-1 py-1">
                  <input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => update(i, "unit_price", Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded border border-border bg-secondary/30 outline-none focus:border-primary/50 text-xs text-right" />
                </td>
                <td className="px-2 py-1 text-right font-medium text-foreground">
                  €{l.line_total.toFixed(2)}
                </td>
                <td className="px-1 py-1 text-center">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-red-500 transition-colors">
                      <X className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Totals */}
      <div className="flex flex-col items-end gap-1 pr-2 text-sm">
        <div className="flex gap-8 text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-medium text-foreground w-24 text-right">€{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex gap-8 text-muted-foreground">
          <span>VAT ({VAT_RATE}%)</span>
          <span className="font-medium text-foreground w-24 text-right">€{vat_amount.toFixed(2)}</span>
        </div>
        <div className="flex gap-8 border-t border-border pt-1 font-bold text-foreground">
          <span>Grand Total</span>
          <span className="w-24 text-right">€{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//   Delivery Address Editor
// ─────────────────────────────────────────────────────────────
function DeliveryAddressEditor({ addr, onChange }: { addr: DeliveryAddress; onChange: (a: DeliveryAddress) => void }) {
  function f(k: keyof DeliveryAddress) {
    return (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...addr, [k]: e.target.value });
  }
  return (
    <div className="space-y-3">
      <Row>
        <Field label="Street *"><Input value={addr.street} onChange={f("street")} placeholder="Calle Mayor" /></Field>
        <Field label="Number *"><Input value={addr.number} onChange={f("number")} placeholder="42" /></Field>
      </Row>
      <Row>
        <Field label="Postcode *"><Input value={addr.postcode} onChange={f("postcode")} placeholder="28001" /></Field>
        <Field label="City *"><Input value={addr.city} onChange={f("city")} placeholder="Madrid" /></Field>
      </Row>
      <Row>
        <Field label="Region"><Input value={addr.region} onChange={f("region")} placeholder="Comunidad de Madrid" /></Field>
        <Field label="Country *"><Input value={addr.country} onChange={f("country")} placeholder="Spain" /></Field>
      </Row>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//   Validation
// ─────────────────────────────────────────────────────────────
function validateForm(form: OrderForm): string | null {
  if (!form.customer.trim()) return "Customer name is required.";
  if (form.order_type === "B2C") {
    if (!form.email.trim()) return "Email is required for B2C orders.";
    const hasLine = form.product_lines.some(l => l.sku.trim() && l.product_name.trim() && l.qty > 0);
    if (!hasLine) return "At least one valid product line is required.";
    const addr = form.delivery_address;
    if (!addr.street || !addr.city || !addr.postcode || !addr.country) return "Complete delivery address is required.";
  }
  if (form.order_type === "B2B") {
    if (!form.company_name.trim()) return "Company name is required.";
    if (!form.vat_number.trim()) return "VAT number is required.";
    if (!form.contact_person.trim()) return "Contact person is required.";
    if (!form.pallet_count || Number(form.pallet_count) < 1) return "Pallet count is required.";
    if (!form.shipment_weight.trim()) return "Shipment weight is required.";
    if (!form.po_reference.trim()) return "PO reference is required.";
    const hasLine = form.product_lines.some(l => l.sku.trim() && l.product_name.trim() && l.qty > 0);
    if (!hasLine) return "At least one valid product line is required.";
    const addr = form.delivery_address;
    if (!addr.street || !addr.city || !addr.postcode || !addr.country) return "Warehouse/delivery address is required.";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
//   Build API Payload
// ─────────────────────────────────────────────────────────────
function buildPayload(form: OrderForm, isCreate = true) {
  const lines = form.product_lines.filter(l => l.sku.trim() && l.product_name.trim() && l.qty > 0);
  const { subtotal, vat_amount, total, items } = calcTotals(lines);

  const payload: any = {
    customer: form.customer,
    email: form.email,
    order_type: form.order_type,
    channel: form.channel,
    warehouse: form.warehouse,
    notes: form.notes,
    store_id: form.store_id || undefined,
    delivery_address: form.delivery_address,
    product_lines: lines,
    subtotal, vat_rate: VAT_RATE, vat_amount, total, items,
  };

  // Only set date and status on creation
  if (isCreate) {
    payload.date = new Date().toISOString().slice(0, 10);
    payload.status = "pending";
  }

  if (form.order_type === "B2C") {
    payload.tracking_number = form.tracking_number;
    payload.package_weight = form.package_weight;
    payload.package_dimensions = form.package_dimensions;
  } else {
    payload.company_name = form.company_name;
    payload.vat_number = form.vat_number;
    payload.contact_person = form.contact_person;
    payload.contact_phone = form.contact_phone;
    payload.pallet_count = Number(form.pallet_count) || 0;
    payload.shipment_weight = form.shipment_weight;
    payload.delivery_terms = form.delivery_terms;
    payload.agreed_delivery_date = form.agreed_delivery_date || undefined;
    payload.po_reference = form.po_reference;
  }
  return payload;
}

// ─────────────────────────────────────────────────────────────
//   Order Form Modal Content
// ─────────────────────────────────────────────────────────────
function OrderFormContent({
  form, setForm, warehouses, stores, isB2B
}: {
  form: OrderForm;
  setForm: (f: OrderForm | ((prev: OrderForm) => OrderForm)) => void;
  warehouses: any[]; stores: any[]; isB2B: boolean;
}) {
  function f<K extends keyof OrderForm>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }));
  }

  return (
    <div className="space-y-4">
      {/* Order Type Switcher */}
      <div className="flex gap-2 p-1 bg-secondary/50 rounded-xl w-fit">
        {["B2C", "B2B"].map(type => (
          <button
            key={type} type="button"
            onClick={() => setForm(prev => ({ ...prev, order_type: type }))}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${form.order_type === type
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            {type === "B2C" ? " B2C — E-commerce" : " B2B — Wholesale / Pallets"}
          </button>
        ))}
      </div>

      {/* ── Core ── */}
      <Row>
        <Field label="Customer Name" required>
          <Input value={form.customer} onChange={f("customer")} placeholder="John Doe / Acme Ltd" />
        </Field>
        {!isB2B && (
          <Field label="Email" required>
            <Input type="email" value={form.email} onChange={f("email")} placeholder="orders@company.com" />
          </Field>
        )}
        {isB2B && (
          <Field label="PO Reference" required>
            <Input value={form.po_reference} onChange={f("po_reference")} placeholder="PO-2025-001" />
          </Field>
        )}
      </Row>

      {/* ── B2B Company Section ── */}
      {isB2B && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
            <Building2 className="size-4" /> Company Information
          </div>
          <Row>
            <Field label="Company Name" required>
              <Input value={form.company_name} onChange={f("company_name")} placeholder="Acme Corporation S.L." />
            </Field>
            <Field label="VAT Number (CIF/NIF)" required>
              <Input value={form.vat_number} onChange={f("vat_number")} placeholder="B-12345678" />
            </Field>
          </Row>
          <Row>
            <Field label="Contact Person" required>
              <Input value={form.contact_person} onChange={f("contact_person")} placeholder="Maria García" />
            </Field>
            <Field label="Contact Phone">
              <Input value={form.contact_phone} onChange={f("contact_phone")} placeholder="+34 600 000 000" />
            </Field>
          </Row>
        </div>
      )}

      {/* ── Delivery Address ── */}
      <div className="rounded-xl border border-border bg-secondary/10 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="size-4 text-primary" />
          {isB2B ? "Warehouse Delivery Address" : "Customer Delivery Address"} <span className="text-destructive">*</span>
        </div>
        <DeliveryAddressEditor
          addr={form.delivery_address}
          onChange={addr => setForm(prev => ({ ...prev, delivery_address: addr }))}
        />
      </div>

      {/* ── Product Lines ── */}
      <div className="rounded-xl border border-border bg-secondary/10 p-4">
        <ProductLinesEditor
          lines={form.product_lines}
          onChange={lines => setForm(prev => ({ ...prev, product_lines: lines }))}
        />
      </div>

      {/* ── B2B Shipment Info ── */}
      {isB2B && (
        <div className="rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50/30 dark:bg-orange-950/20 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-orange-700 dark:text-orange-300">
            <Truck className="size-4" /> Shipment Information
          </div>
          <Row>
            <Field label="Number of Pallets" required>
              <Input type="number" min={1} value={form.pallet_count} onChange={f("pallet_count")} placeholder="4" />
            </Field>
            <Field label="Total Shipment Weight" required>
              <Input value={form.shipment_weight} onChange={f("shipment_weight")} placeholder="1500 kg" />
            </Field>
          </Row>
          <Row>
            <Field label="Delivery Terms (Optional)">
              <Select value={form.delivery_terms} onChange={f("delivery_terms")}>
                <option value="">— Select Delivery Terms —</option>
                {DELIVERY_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Agreed Delivery Date">
              <Input type="date" value={form.agreed_delivery_date} onChange={f("agreed_delivery_date")} />
            </Field>
          </Row>
        </div>
      )}

      {/* ── B2C Shipping Info ── */}
      {!isB2B && (
        <div className="rounded-xl border border-border bg-secondary/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Package className="size-4 text-primary" /> Shipping Information (Optional)
          </div>
          <Row>
            <Field label="Tracking Number">
              <Input value={form.tracking_number} onChange={f("tracking_number")} placeholder="1Z999AA1012345678" />
            </Field>
            <Field label="Package Weight">
              <Input value={form.package_weight} onChange={f("package_weight")} placeholder="2.5 kg" />
            </Field>
          </Row>
          <Field label="Package Dimensions">
            <Input value={form.package_dimensions} onChange={f("package_dimensions")} placeholder="30×25×15 cm" />
          </Field>
        </div>
      )}

      {/* ── B2C Channel / Store ── */}
      {!isB2B && (
        <Row>
          <Field label="Channel">
            <Select value={form.channel} onChange={f("channel")}>
              <option value="web">Web</option>
              <option value="api">API</option>
              <option value="mobile">Mobile</option>
              <option value="phone">Phone</option>
            </Select>
          </Field>
          <Field label="eCommerce Store (Optional)">
            <Select value={form.store_id} onChange={f("store_id")}>
              <option value="">— None —</option>
              {stores.map(s => <option key={s._id} value={s._id}>{s.name} ({s.platform})</option>)}
            </Select>
          </Field>
        </Row>
      )}

      {/* Warehouse */}
      <Field label="Fulfillment Warehouse">
        <Select value={form.warehouse} onChange={f("warehouse")}>
          {warehouses.map(w => <option key={w.code} value={w.code}>{w.code}</option>)}
          {warehouses.length === 0 && <option value="MIA">MIA</option>}
        </Select>
      </Field>

      {/* Notes */}
      <Field label="Notes / Special Instructions">
        <Input value={form.notes} onChange={f("notes")} placeholder="Handle with care, requires cold chain…" />
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//   Main Orders Component
// ─────────────────────────────────────────────────────────────
export function Orders() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Order | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [form, setForm] = useState<OrderForm>(blankForm());
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const isB2B = form.order_type === "B2B";

  const { items: orders, allItems, pagination, page, setPage, isLoading, reload } = usePaginatedList<Order>(
    ordersListService,
    {
      apiParams: {
        search: search.toLowerCase() || undefined,
        status: statusFilter !== "All" ? statusFilter : undefined,
      },
      deps: [search, statusFilter],
    }
  );

  useEffect(() => {
    async function loadMeta() {
      try {
        const [whs, ecom] = await Promise.all([
          warehousesService.getAll({ all: true }),
          ecommerceService.getAll({ all: true }),
        ]);
        setWarehouses(whs);
        setStores(ecom);
      } catch {
        toast.error("Failed to load order metadata");
      }
    }
    loadMeta();
  }, []);

  useEffect(() => {
    const handler = () => { setForm(blankForm()); setShowAdd(true); };
    window.addEventListener("open-new-order", handler);
    return () => window.removeEventListener("open-new-order", handler);
  }, []);

  function openEdit(o: Order) {
    setEditTarget(o);
    setForm({
      customer: o.customer || "",
      email: o.email || "",
      order_type: o.order_type || "B2C",
      channel: o.channel || "web",
      warehouse: o.warehouse || "MIA",
      notes: o.notes || "",
      store_id: o.store_id || "",
      delivery_address: o.delivery_address || blankAddress(),
      product_lines: (o.product_lines && o.product_lines.length > 0) ? o.product_lines : [blankLine()],
      tracking_number: o.tracking_number || "",
      package_weight: o.package_weight || "",
      package_dimensions: o.package_dimensions || "",
      company_name: o.company_name || "",
      vat_number: o.vat_number || "",
      contact_person: o.contact_person || "",
      contact_phone: o.contact_phone || "",
      pallet_count: o.pallet_count ? String(o.pallet_count) : "",
      shipment_weight: o.shipment_weight || "",
      delivery_terms: o.delivery_terms || "EXW",
      agreed_delivery_date: o.agreed_delivery_date ? o.agreed_delivery_date.slice(0, 10) : "",
      po_reference: o.po_reference || "",
    });
  }

  async function handleSave() {
    const err = validateForm(form);
    if (err) { toast.error(err); return; }

    try {
      if (editTarget) {
        await ordersService.update(editTarget._id, buildPayload(form, false));
        toast.success(`Order ${editTarget.orderId} updated.`);
        setEditTarget(null);
      } else {
        // orderId is generated server-side via Counter; send empty and backend assigns
        await ordersService.create(buildPayload(form, true));
        toast.success(`Order created for ${form.customer}.`);
        setShowAdd(false);
      }
      reload();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save order");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await ordersService.delete(deleteTarget._id);
      toast.success("Order deleted.");
      setDeleteTarget(null);
      reload();
    } catch {
      toast.error("Failed to delete order");
    }
  }

  async function handleRelease() {
    if (!editTarget) return;
    try {
      await ordersService.releaseOrder(editTarget._id);
      toast.success(`Order ${editTarget.orderId} released to fulfillment!`);
      setEditTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to release order");
    }
  }

  async function downloadDeliveryNote(o: Order) {
    setDownloadingId(o._id);
    try {
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const res = await fetch(`/api/v1/documents/delivery-note/${o._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `Server error: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `DeliveryNote-${o.orderId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Delivery Note downloaded for ${o.orderId}`);
      reload(); // refresh to show new DN number
    } catch (err: any) {
      toast.error(err.message || "Failed to generate delivery note");
    } finally {
      setDownloadingId(null);
    }
  }

  // Stats
  const totalRevenue = allItems.reduce((a, o) => a + (o.total || 0), 0);
  const pendingCount = allItems.filter(o => o.status === "pending").length;
  const processingCount = allItems.filter(o => o.status === "processing").length;
  const b2bCount = allItems.filter(o => o.order_type === "B2B").length;

  const modalTitle = editTarget ? `Edit Order — ${editTarget.orderId}` : "New Order";

  return (
    <div className="space-y-6">
      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.orders.totalOrders, value: allItems.length, icon: ShoppingCart, color: "text-primary" },
          { label: t.orders.pending, value: pendingCount, icon: Package, color: "text-warning" },
          { label: t.orders.processing, value: processingCount, icon: Package, color: "text-blue-500" },
          { label: "B2B Orders", value: b2bCount, icon: Building2, color: "text-purple-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>
              {s.label === t.orders.totalOrders ? allItems.length : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ── */}
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
        <div className="flex gap-1.5 overflow-x-auto">
          {statusFilters.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all capitalize ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => exportToCSV(
            allItems.map((o: any) => ({
              ID: o.orderId, Customer: o.customer, Email: o.email,
              Type: o.order_type, Channel: o.channel, Warehouse: o.warehouse,
              Date: o.date, Items: o.items, Subtotal: o.subtotal,
              VAT: o.vat_amount, Total: o.total, Status: o.status,
              "DN Number": o.delivery_note_number || "",
            })), "orders")}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-secondary transition-colors"
        >
          <Download className="size-4" /> Export CSV
        </button>
        <PrimaryButton icon={Plus} onClick={() => { setForm(blankForm()); setShowAdd(true); }}>
          {t.orders.newOrder}
        </PrimaryButton>
      </div>

      {/* ── Orders Table ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">{t.orders.orderNo}</th>
              <th className="text-left px-4 py-3">{t.orders.customer}</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Type / Channel</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">{t.orders.warehouse}</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">{t.common.date}</th>
              <th className="text-center px-4 py-3 hidden sm:table-cell">{t.orders.noOfItems}</th>
              <th className="text-center px-4 py-3">{t.common.status}</th>
              <th className="text-right px-4 py-3">{t.orders.orderTotal}</th>
              <th className="text-right px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={o._id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                <td className="px-4 py-3">
                  <div className="font-medium text-primary" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem" }}>{o.orderId}</div>
                  {o.delivery_note_number && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">{o.delivery_note_number}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{o.customer}</div>
                  <div className="text-xs text-muted-foreground">{o.email}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${o.order_type === 'B2B' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-secondary text-muted-foreground'}`}>
                    {o.order_type || 'B2C'}
                  </span>
                  {o.channel && <span className="ml-1 text-[10px] text-muted-foreground">{o.channel}</span>}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{o.warehouse}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">{o.date}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-center text-muted-foreground">{o.items}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  €{(o.total || 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button title="View / Edit" onClick={() => openEdit(o)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                      <Eye className="size-3.5" />
                    </button>
                    <button
                      title={downloadingId === o._id ? "Generating…" : "Download Delivery Note"}
                      onClick={() => downloadDeliveryNote(o)}
                      disabled={downloadingId === o._id}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary disabled:opacity-40"
                    >
                      {downloadingId === o._id
                        ? <span className="size-3.5 block rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        : <FileText className="size-3.5" />}
                    </button>
                    <button title="Delete" onClick={() => setDeleteTarget(o)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-red-500">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && !isLoading && (
              <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">{t.common.noData}</td></tr>
            )}
          </tbody>
        </table>
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      {/* ── Add Modal ── */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="New Order"
        subtitle={`${form.order_type} Order`}
        width="xl"
        footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleSave}>Create Order</ModalSubmit></>}
      >
        <OrderFormContent form={form} setForm={setForm} warehouses={warehouses} stores={stores} isB2B={isB2B} />
      </Modal>

      {/* ── Edit Modal ── */}
      {editTarget && (() => {
        const hasValidAddress = Boolean(
          form.delivery_address?.street?.trim() &&
          form.delivery_address?.city?.trim() &&
          form.delivery_address?.postcode?.trim() &&
          form.delivery_address?.country?.trim()
        );
        const hasValidProductLine = form.product_lines?.some(
          l => l.sku?.trim() && l.product_name?.trim() && Number(l.qty) > 0
        );
        const canGenerateDN = hasValidAddress && hasValidProductLine;

        return (
          <Modal
            open={true}
            onClose={() => setEditTarget(null)}
            title={modalTitle}
            subtitle={`${editTarget.order_type || "B2C"} Order`}
            width="xl"
            footer={
              <div className="flex items-center gap-2 w-full justify-between">
                <div className="flex items-center gap-2">
                  {editTarget.status === "pending" && (
                    <PrimaryButton onClick={handleRelease} className="!bg-purple-600 hover:!bg-purple-700">
                      Release to Fulfillment
                    </PrimaryButton>
                  )}
                  <button
                    type="button"
                    onClick={() => downloadDeliveryNote(editTarget)}
                    disabled={!canGenerateDN || downloadingId === editTarget._id}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                    title={canGenerateDN ? "Generate and Download Delivery Note PDF" : "Requires complete delivery address and at least one valid product line"}
                  >
                    <FileText className="size-4" />
                    {downloadingId === editTarget._id ? "Generating..." : "Generate Delivery Note"}
                  </button>
                </div>
                <div className="flex gap-2">
                  <ModalCancel onClose={() => setEditTarget(null)} />
                  <ModalSubmit onClick={handleSave}>Save Changes</ModalSubmit>
                </div>
              </div>
            }
          >
            <OrderFormContent form={form} setForm={setForm} warehouses={warehouses} stores={stores} isB2B={isB2B} />
          </Modal>
        );
      })()}

      {/* ── Delete Confirm ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Order"
        width="sm"
        footer={<><ModalCancel onClose={() => setDeleteTarget(null)} /><ModalSubmit variant="destructive" onClick={handleDelete}>Delete</ModalSubmit></>}
      >
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete order <strong>{deleteTarget?.orderId}</strong>? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
