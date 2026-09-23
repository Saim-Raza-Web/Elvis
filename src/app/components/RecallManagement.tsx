import React, { useState, useEffect } from "react";
import { 
  AlertTriangle, Search, RefreshCw, CheckCircle2, XCircle, 
  Package, Truck, FileText, Building, MapPin, User, Calendar,
  Filter, Download, ShieldCheck, Clock, Ban
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { recallService } from "../../services/recall.service";
import { warehousesService } from "../../services/warehouses.service";

type ShippedOrder = {
  orderId: string;
  orderNumber: string;
  shipmentId: string;
  tracking: string;
  carrier: string;
  customer: string;
  owner: string;
  ownerType: string;
  sku: string;
  productName: string;
  lotNumber: string;
  shippedQty: number;
  shippedDate: string;
  status: string;
  warehouse: string;
};

type InventorySummary = {
  id: string;
  sku: string;
  bin: string;
  warehouse: string;
  owner: string;
  ownerType: string;
  lotNumber: string;
  qtyAvailable: number;
  qtyQuarantine: number;
  qtyReserved: number;
  expiryDate: string | null;
};

type RecallPreview = {
  success: boolean;
  lotNumber: string;
  sku: string;
  remainingStock: InventorySummary[];
  totalAvailable: number;
  totalQuarantine: number;
  totalReserved: number;
  shippedOrders: ShippedOrder[];
  shippedOrdersCount: number;
};

export function RecallManagement() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShippedReport, setShowShippedReport] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  
  const [form, setForm] = useState({
    lotNumber: "",
    sku: "",
    warehouse: "",
    owner: "",
    quantity: "",
    reason: ""
  });

  const [previewData, setPreviewData] = useState<RecallPreview | null>(null);
  const [shippedData, setShippedData] = useState<ShippedOrder[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    warehousesService.getAll({ all: true }).then(setWarehouses).catch(() => toast.error(t.common?.error || "Failed to load warehouses"));
  }, []);

  const handlePreview = async () => {
    if (!form.lotNumber.trim()) {
      toast.error("Lot number is required");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await recallService.previewRecall({
        lotNumber: form.lotNumber.trim(),
        sku: form.sku.trim() || undefined,
        warehouse: form.warehouse || undefined,
        owner: form.owner || undefined
      });
      setPreviewData(result);
      setShowPreview(true);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to preview recall");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShippedReport = async () => {
    if (!form.lotNumber.trim()) {
      toast.error("Lot number is required");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await recallService.getShippedReport({
        lotNumber: form.lotNumber.trim(),
        sku: form.sku.trim() || undefined,
        warehouse: form.warehouse || undefined,
        owner: form.owner || undefined
      });
      setShippedData(result.shippedOrders || []);
      setShowShippedReport(true);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to fetch shipped report");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExecuteRecall = async () => {
    if (!form.lotNumber.trim()) {
      toast.error("Lot number is required");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await recallService.executeRecall({
        lotNumber: form.lotNumber.trim(),
        sku: form.sku.trim() || undefined,
        warehouse: form.warehouse || undefined,
        owner: form.owner || undefined,
        quantity: form.quantity ? Number(form.quantity) : undefined,
        reason: form.reason
      });
      toast.success(`Lot recall executed: ${result.recallId}`);
      setShowCreate(false);
      setForm({ lotNumber: "", sku: "", warehouse: "", owner: "", quantity: "", reason: "" });
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to execute recall");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Recall Preview", value: previewData?.shippedOrdersCount || 0, icon: Search, color: "text-primary" },
          { label: "Remaining Stock", value: previewData?.totalAvailable || 0, icon: Package, color: "text-warning" },
          { label: "Quarantined", value: previewData?.totalQuarantine || 0, icon: ShieldCheck, color: "text-emerald-600" },
          { label: "Reserved", value: previewData?.totalReserved || 0, icon: Clock, color: "text-purple-600" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3.5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 35}ms` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="font-bold text-xl" style={{ fontFamily: "JetBrains Mono, monospace" }}>
              {s.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-64">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${t.common.search} by lot number...`}
              className="w-full pl-9 pr-4 py-2 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary/50 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PrimaryButton icon={AlertTriangle} onClick={() => setShowCreate(true)}>
            Initiate Recall
          </PrimaryButton>
        </div>
      </div>

      {/* Create Recall Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Initiate Lot Recall"
        subtitle="Execute atomic lot quarantine and shipped orders discovery"
        footer={
          <>
            <ModalCancel onClose={() => setShowCreate(false)} />
            <button
              type="button"
              onClick={handlePreview}
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              <Search className="size-4" /> Preview
            </button>
            <button
              type="button"
              onClick={handleExecuteRecall}
              disabled={isSubmitting}
              className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-white rounded-lg font-bold text-xs transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              <Ban className="size-4" /> Execute Recall
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <Row>
            <Field label="Lot Number *" required>
              <Input
                value={form.lotNumber}
                onChange={(e) => setForm({ ...form, lotNumber: e.target.value })}
                placeholder="e.g. LOT-2024-001"
              />
            </Field>
            <Field label="SKU (Optional)">
              <Input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="Filter by SKU..."
              />
            </Field>
          </Row>

          <Row>
            <Field label="Warehouse">
              <Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
                <option value="">All Warehouses</option>
                {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
              </Select>
            </Field>
            <Field label="Owner">
              <Input
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                placeholder="Filter by owner..."
              />
            </Field>
          </Row>

          <Field label="Partial Quantity (Optional)">
            <Input
              type="number"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="Leave empty for full lot recall"
            />
          </Field>

          <Field label="Recall Reason">
            <Input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Quality Hazard / Recall Event"
            />
          </Field>
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Recall Preview"
        subtitle={`Lot: ${previewData?.lotNumber} • SKU: ${previewData?.sku || 'ALL'}`}
        width="xl"
        footer={<ModalCancel onClose={() => setShowPreview(false)} />}
      >
        {previewData && (
          <div className="space-y-4 text-xs">
            {/* Inventory Summary */}
            <div className="bg-secondary/20 p-4 rounded-xl border border-border space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Package className="size-4" /> Affected Inventory
              </h4>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/30">
                  <div className="text-[10px] text-muted-foreground">Available</div>
                  <div className="font-bold text-lg text-emerald-600">{previewData.totalAvailable.toLocaleString()}</div>
                </div>
                <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-500/30">
                  <div className="text-[10px] text-muted-foreground">Reserved</div>
                  <div className="font-bold text-lg text-amber-600">{previewData.totalReserved.toLocaleString()}</div>
                </div>
                <div className="bg-purple-500/10 p-3 rounded-lg border border-purple-500/30">
                  <div className="text-[10px] text-muted-foreground">Quarantined</div>
                  <div className="font-bold text-lg text-purple-600">{previewData.totalQuarantine.toLocaleString()}</div>
                </div>
              </div>

              {previewData.remainingStock.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-secondary/60">
                      <tr>
                        <th className="p-2">SKU</th>
                        <th className="p-2">Bin</th>
                        <th className="p-2 text-right">Available</th>
                        <th className="p-2 text-right">Reserved</th>
                        <th className="p-2 text-right">Quarantine</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {previewData.remainingStock.map((stock, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-mono">{stock.sku}</td>
                          <td className="p-2 font-mono">{stock.bin}</td>
                          <td className="p-2 text-right">{stock.qtyAvailable}</td>
                          <td className="p-2 text-right">{stock.qtyReserved}</td>
                          <td className="p-2 text-right">{stock.qtyQuarantine}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Shipped Orders Summary */}
            <div className="bg-blue-500/10 p-4 rounded-xl border border-blue-500/30 space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <Truck className="size-4" /> Shipped Orders ({previewData.shippedOrdersCount})
              </h4>
              
              <button
                type="button"
                onClick={handleShippedReport}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <FileText className="size-3" /> View Full Shipped Report
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Shipped Report Modal */}
      <Modal
        open={showShippedReport}
        onClose={() => setShowShippedReport(false)}
        title="Shipped Orders Report"
        subtitle={`Lot: ${form.lotNumber} • ${shippedData.length} orders shipped`}
        width="xl"
        footer={<ModalCancel onClose={() => setShowShippedReport(false)} />}
      >
        <div className="space-y-4 text-xs">
          {shippedData.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Truck className="size-8 mx-auto mb-2 opacity-40" />
              <div>No shipped orders found for this lot</div>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-secondary/60">
                  <tr>
                    <th className="p-2">Order #</th>
                    <th className="p-2">Shipment</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">SKU</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2">Shipped Date</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shippedData.map((order, idx) => (
                    <tr key={idx}>
                      <td className="p-2 font-mono">{order.orderNumber}</td>
                      <td className="p-2 font-mono">{order.shipmentId}</td>
                      <td className="p-2">{order.customer}</td>
                      <td className="p-2 font-mono">{order.sku}</td>
                      <td className="p-2 text-right">{order.shippedQty}</td>
                      <td className="p-2">{new Date(order.shippedDate).toLocaleDateString()}</td>
                      <td className="p-2"><StatusBadge status={order.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
