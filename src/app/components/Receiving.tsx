import { useState, useEffect, useMemo, useRef } from "react";
import {
  Package, Search, Plus, Truck, AlertTriangle, CheckCircle2, Clock,
  Trash2, Copy, Eye, Pencil, Calendar, Anchor, FileText, ArrowUpDown, RefreshCw, Layers,
  ScanLine, Check, AlertOctagon, History, ShieldAlert, CheckSquare, Play, Camera
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { receivingService } from "../../services/receiving.service";
import { locationsService } from "../../services/locations.service";
import { incidentsService } from "../../services/incidents.service";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";

// ── Types ──────────────────────────────────────────────────────

type ProductLine = {
  sku: string;
  name: string;
  description: string;
  expected_qty: number;
  received_qty?: number;
  uom: string;
  lotNumber: string;
  batchNumber: string;
  expiryDate: string;
  qcRequired: boolean;
};

type ASN = {
  _id: string;
  asnId: string;
  asnNumber?: string;
  supplier: string;
  owner?: string;
  poNumber: string;
  po?: string;
  origin: string;
  carrier: string;
  expectedDate: string;
  expected_date?: string;
  receivingDock: string;
  warehouse: string;
  notes: string;
  status: "pending" | "in_progress" | "partially_received" | "completed" | "completed_with_discrepancies" | "cancelled";
  sku_count: number;
  expected_units: number;
  items: ProductLine[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  __v?: number;
};

type ReceiveLineState = {
  sku: string;
  name: string;
  expected: number;
  alreadyReceived: number;
  remaining: number;
  qtyToReceive: number;
  damagedQty: number;
  uom: string;
  lotNumber: string;
  batchNumber: string;
  expiryDate: string;
  bin: string;
  zone?: string;
  ruleApplied?: string;
  qcRequired: boolean;
};

const blankLine = (): ProductLine => ({
  sku: "",
  name: "",
  description: "",
  expected_qty: 1,
  received_qty: 0,
  uom: "pcs",
  lotNumber: "",
  batchNumber: "",
  expiryDate: "",
  qcRequired: false,
});

const blankASN = () => ({
  supplier: "",
  owner: "Default Owner",
  poNumber: "",
  origin: "",
  carrier: "DHL",
  expectedDate: new Date().toISOString().split("T")[0],
  receivingDock: "Dock 1",
  warehouse: "MIA",
  notes: "",
  items: [blankLine()],
  __v: undefined as number | undefined
});

const asnListService: ListService<ASN> = {
  getAll: async (params) => {
    const data = await receivingService.getAll(params);
    return data.map((d: any) => ({ ...d, id: d.asnId || d._id }));
  },
  getPage: async (params) => {
    const data = await receivingService.getPage(params);
    return {
      data: data.data.map((d: any) => ({ ...d, id: d.asnId || d._id })),
      pagination: data.pagination
    };
  }
};

const CARRIERS = ["DHL", "FedEx", "UPS", "USPS", "GLS", "TNT", "Kuehne+Nagel", "DB Schenker"];
const DOCKS = ["Dock 1", "Dock 2", "Dock 3", "Dock 4 (Cold Chain)", "Dock 5 (Heavy Freight)"];
const UOMS = ["pcs", "box", "pallet", "kg", "units", "carton", "pack", "meter"];

const STATUS_OPTIONS = [
  { value: "All", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "completed_with_discrepancies", label: "Completed With Discrepancies" },
  { value: "cancelled", label: "Cancelled" }
];

export function Receiving() {
  const { t } = useLang();
  const tc = t.common as any;
  const tr = t.receiving as any;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [sortField, setSortField] = useState<"expectedDate" | "createdAt" | "asnId">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Modals state
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<ASN | null>(null);
  const [viewTarget, setViewTarget] = useState<ASN | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ASN | null>(null);

  // Phase 2 Receiving Workspace State
  const [receiveTarget, setReceiveTarget] = useState<ASN | null>(null);
  const [receiveLines, setReceiveLines] = useState<ReceiveLineState[]>([]);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [highlightedSku, setHighlightedSku] = useState<string | null>(null);
  const [asnHistory, setAsnHistory] = useState<any[]>([]);
  const [asnDiscrepancies, setAsnDiscrepancies] = useState<any[]>([]);

  const [form, setForm] = useState(blankASN());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [proposeLoading, setProposeLoading] = useState(false);

  const { items: pagedAsns, allItems: asns, pagination, page, setPage, reload, isLoading } = usePaginatedList<ASN>(
    asnListService,
    {
      apiParams: {
        search: search.trim().toLowerCase(),
        status: statusFilter !== "All" ? statusFilter : undefined,
        supplier: supplierFilter.trim() || undefined
      },
      deps: [search, statusFilter, supplierFilter],
    }
  );

  // External open trigger
  useEffect(() => {
    const handler = () => {
      setForm(blankASN());
      setEditTarget(null);
      setShowAdd(true);
    };
    window.addEventListener("open-new-asn", handler);
    return () => window.removeEventListener("open-new-asn", handler);
  }, []);

  // Compute stats
  const stats = useMemo(() => {
    const total = asns.length;
    const pending = asns.filter(a => a.status === "pending").length;
    const inProgress = asns.filter(a => a.status === "in_progress" || (a.status as string) === "partially_received").length;
    const completed = asns.filter(a => a.status === "completed").length;
    const discrepancies = asns.filter(a => a.status === "completed_with_discrepancies").length;
    return { total, pending, inProgress, completed, discrepancies };
  }, [asns]);

  // Unique suppliers list for filter
  const uniqueSuppliers = useMemo(() => {
    const set = new Set(asns.map(a => a.supplier).filter(Boolean));
    return Array.from(set);
  }, [asns]);

  // Client-side sorted items
  const sortedAsns = useMemo(() => {
    return [...pagedAsns].sort((a, b) => {
      let valA = a[sortField] || "";
      let valB = b[sortField] || "";
      if (sortField === "expectedDate") {
        valA = a.expectedDate || a.expected_date || "";
        valB = b.expectedDate || b.expected_date || "";
      }
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [pagedAsns, sortField, sortOrder]);

  // Form Field Updater
  const updateFormHeader = (key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  // Product Line Editor Handlers
  const addLine = () => {
    setForm(prev => ({ ...prev, items: [...prev.items, blankLine()] }));
  };

  const removeLine = (index: number) => {
    if (form.items.length <= 1) {
      toast.error(tc?.error || "An ASN must contain at least one product line.");
      return;
    }
    setForm(prev => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index)
    }));
  };

  const duplicateLine = (index: number) => {
    const lineToCopy = form.items[index];
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { ...lineToCopy }]
    }));
    toast.success(tc?.operationSuccess || "Product line duplicated.");
  };

  const updateLine = (index: number, key: keyof ProductLine, value: any) => {
    setForm(prev => {
      const nextItems = [...prev.items];
      nextItems[index] = { ...nextItems[index], [key]: value };
      return { ...prev, items: nextItems };
    });
  };

  // Validate form before save
  const validateForm = () => {
    if (!form.supplier.trim()) return "Supplier is required.";
    if (!form.owner.trim()) return "Inventory Owner (3PL) is required.";
    if (!form.poNumber.trim()) return "Purchase Order number is required.";
    if (!form.expectedDate) return "Expected arrival date is required.";
    if (!form.receivingDock.trim()) return "Receiving dock is required.";
    if (!form.items || form.items.length === 0) return "At least one product line is required.";

    for (let i = 0; i < form.items.length; i++) {
      const line = form.items[i];
      if (!line.sku.trim()) return `Line ${i + 1}: SKU is required.`;
      if (!line.name.trim()) return `Line ${i + 1}: Product Name is required.`;
      if (!line.expected_qty || Number(line.expected_qty) <= 0) return `Line ${i + 1}: Expected quantity must be greater than 0.`;
      if (!line.uom.trim()) return `Line ${i + 1}: Unit of Measure (UOM) is required.`;
    }

    return null;
  };

  // Open Edit Modal
  const handleOpenEdit = (asn: ASN) => {
    setEditTarget(asn);
    setForm({
      supplier: asn.supplier || "",
      owner: asn.owner || "",
      poNumber: asn.poNumber || asn.po || "",
      origin: asn.origin || "",
      carrier: asn.carrier || "DHL",
      expectedDate: asn.expectedDate ? new Date(asn.expectedDate).toISOString().split("T")[0] : (asn.expected_date ? new Date(asn.expected_date).toISOString().split("T")[0] : ""),
      receivingDock: asn.receivingDock || "Dock 1",
      warehouse: asn.warehouse || "MIA",
      notes: asn.notes || "",
      items: asn.items && asn.items.length > 0 ? asn.items.map(i => ({
        sku: i.sku || "",
        name: i.name || (i as any).productName || "",
        description: i.description || "",
        expected_qty: i.expected_qty || 1,
        received_qty: i.received_qty || 0,
        uom: i.uom || "pcs",
        lotNumber: i.lotNumber || "",
        batchNumber: i.batchNumber || "",
        expiryDate: i.expiryDate ? new Date(i.expiryDate).toISOString().split("T")[0] : "",
        qcRequired: Boolean(i.qcRequired)
      })) : [blankLine()],
      __v: asn.__v
    });
    setShowAdd(true);
  };

  // Open View Details Modal
  const handleOpenView = async (asn: ASN) => {
    setViewTarget(asn);
    try {
      const [hist, disc] = await Promise.all([
        receivingService.getHistory(asn._id),
        receivingService.getDiscrepancies(asn._id)
      ]);
      setAsnHistory(hist || []);
      setAsnDiscrepancies(disc || []);
    } catch (_) { }
  };

  // Download / Preview Delivery Note Document
  const handleDownloadDeliveryNote = async (asn: ASN) => {
    try {
      const asnId = asn.asnId || asn.asnNumber || asn._id;
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const response = await fetch(`/api/v1/documents/inbound-delivery-note/${asnId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to fetch delivery note");
      }
      const html = await response.text();
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    } catch (err: any) {
      toast.error(err.message || "Delivery Note not generated yet");
    }
  };

  // Open Phase 2 Receiving Workspace Modal
  const handleOpenReceivingWorkspace = async (asn: ASN) => {
    setReceiveTarget(asn);
    setScannedBarcode("");
    setHighlightedSku(null);

    const initialLines: ReceiveLineState[] = (asn.items || []).map(item => {
      const exp = Number(item.expected_qty) || 0;
      const rec = Number(item.received_qty) || 0;
      const rem = Math.max(0, exp - rec);
      return {
        sku: item.sku,
        name: item.name || (item as any).productName || "Product",
        expected: exp,
        alreadyReceived: rec,
        remaining: rem,
        qtyToReceive: rem, // Pre-fill with remaining expected quantity
        damagedQty: 0,
        uom: item.uom || "pcs",
        lotNumber: item.lotNumber || "",
        batchNumber: item.batchNumber || "",
        expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString().split("T")[0] : "",
        bin: "",        // will be filled by location proposal
        qcRequired: Boolean(item.qcRequired)
      };
    });

    setReceiveLines(initialLines);

    // Fetch dynamic proposed bin for each SKU
    const warehouse = asn.warehouse || "MIA";
    setProposeLoading(true);
    const updatedLines = await Promise.all(
      initialLines.map(async (line) => {
        try {
          const token = localStorage.getItem("jwt_token");
          const r = await fetch(
            `/api/v1/putaway/propose-location?sku=${encodeURIComponent(line.sku)}&warehouse=${encodeURIComponent(warehouse)}&qty=${line.remaining || 1}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (r.ok) {
            const proposal = await r.json();
            return { ...line, bin: proposal.proposedBin || "", zone: proposal.zone || "Z-RECEIVING", ruleApplied: proposal.ruleApplied || "" };
          }
        } catch (_) { }
        return { ...line, bin: `${warehouse}-RCV-DOCK1`, zone: "Z-RECEIVING" };
      })
    );
    setProposeLoading(false);
    setReceiveLines(updatedLines);
  };

  const [showCameraScanner, setShowCameraScanner] = useState(false);

  // Barcode Scan Handler (Strict Non-ASN Barcode Rejection & Permanent Incident Creation)
  const handleBarcodeScanSubmit = async (scannedVal?: string) => {
    const term = (scannedVal !== undefined ? scannedVal : scannedBarcode).trim().toUpperCase();
    if (!term) return;

    const matchIdx = receiveLines.findIndex(l => l.sku.toUpperCase() === term || l.name.toUpperCase().includes(term));
    if (matchIdx !== -1) {
      const line = receiveLines[matchIdx];
      setHighlightedSku(line.sku);
      toast.success(`Scanned valid ASN SKU: ${line.sku} (${line.name}). Row highlighted!`);
      const inputEl = document.getElementById(`receive-qty-input-${matchIdx}`);
      if (inputEl) inputEl.focus();
    } else {
      setHighlightedSku(null);
      toast.error(`REJECTED: Barcode/SKU '${term}' does not belong to this ASN.`);
      if (receiveTarget) {
        try {
          const incId = 'INC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
          await incidentsService.create({
            incidentId: incId,
            type: 'Discrepancy',
            sku: term,
            scannedBarcode: term,
            expectedSKU: 'N/A',
            asnReference: receiveTarget.poNumber || receiveTarget.po || receiveTarget.asnId,
            asnId: receiveTarget.asnId || receiveTarget.asnNumber,
            supplier: receiveTarget.supplier,
            owner: receiveTarget.owner || 'Default Owner',
            operator: 'admin@demologistics.io',
            user: 'admin@demologistics.io',
            reported_by: 'admin@demologistics.io',
            reason: 'Unexpected SKU',
            module: 'Receiving',
            status: 'open',
            description: `Unexpected barcode scan '${term}' on ASN ${receiveTarget.asnId || receiveTarget.asnNumber}. Supplier: ${receiveTarget.supplier}, Owner: ${receiveTarget.owner || 'Default Owner'}`
          });
          reload();
        } catch (e) {
          console.error("Failed to create incident on rejection:", e);
        }
      }
    }
  };

  // Update Receive Line Input
  const updateReceiveLine = (index: number, key: keyof ReceiveLineState, value: any) => {
    setReceiveLines(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  // Confirm Physical Receive Execution
  const handleConfirmReceiveExecution = async () => {
    if (!receiveTarget) return;

    // Filter lines that have qtyToReceive > 0 or damagedQty > 0
    const activeToReceive = receiveLines.filter(l => Number(l.qtyToReceive) > 0 || Number(l.damagedQty) > 0);

    if (activeToReceive.length === 0) {
      toast.error(tc?.error || "Please enter a receive quantity greater than 0 for at least one item.");
      return;
    }

    // Client-side validations
    for (const line of activeToReceive) {
      if (line.qtyToReceive < 0) {
        toast.error(`Line ${line.sku}: Receive quantity cannot be negative.`);
        return;
      }
      if (line.qtyToReceive > line.remaining) {
        toast.error(`Line ${line.sku}: Cannot receive ${line.qtyToReceive} units. Maximum remaining is ${line.remaining}.`);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const payload = {
        receiveItems: activeToReceive.map(l => ({
          sku: l.sku,
          qtyToReceive: Number(l.qtyToReceive),
          damagedQty: Number(l.damagedQty) || 0,
          lotNumber: l.lotNumber,
          batchNumber: l.batchNumber,
          expiryDate: l.expiryDate,
          bin: l.bin,
          zone: l.zone || "Z-RECEIVING"
        })),
        __v: receiveTarget.__v
      };

      const result = await receivingService.receiveGoods(receiveTarget._id, payload);
      toast.success(`Successfully received goods against ${receiveTarget.asnId || receiveTarget.asnNumber}! Stock updated.`);

      setReceiveTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to confirm receiving execution.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save (Create or Update ASN Header/Lines)
  const handleSaveASN = async () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }

    try {
      setIsSubmitting(true);
      if (editTarget) {
        await receivingService.update(editTarget._id, form);
        toast.success(`ASN ${editTarget.asnId || editTarget.asnNumber} updated successfully.`);
      } else {
        const created = await receivingService.create(form);
        toast.success(`ASN ${created.asnId || created.asnNumber} created successfully.`);
      }
      setShowAdd(false);
      setEditTarget(null);
      setForm(blankASN());
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save ASN");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete ASN (Soft Delete)
  const handleDeleteASN = async () => {
    if (!deleteTarget) return;
    try {
      setIsSubmitting(true);
      await receivingService.delete(deleteTarget._id);
      toast.success(`ASN ${deleteTarget.asnId || deleteTarget.asnNumber} cancelled and archived (Soft Delete).`);
      setDeleteTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete ASN");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: `${t.common.total} ASNs`, value: stats.total, icon: Layers, color: "text-foreground" },
          { label: t.status.pending, value: stats.pending, icon: Clock, color: "text-warning" },
          { label: t.status.in_progress, value: stats.inProgress, icon: Truck, color: "text-primary" },
          { label: t.status.completed, value: stats.completed, icon: CheckCircle2, color: "text-success" },
          { label: t.documents.discrepancyReport, value: stats.discrepancies, icon: AlertTriangle, color: "text-destructive" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Search, Filters & Controls Bar ── */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-64">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${t.common.search} by ASN #, Supplier, PO #...`}
                className="w-full pl-9 pr-4 py-2 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary/50 text-sm transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-secondary/50 text-xs font-medium outline-none focus:border-primary/50 transition-colors"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.value === 'All' ? `${t.common.all} ${t.common.status}` : (t.status[opt.value as keyof typeof t.status] || opt.label)}</option>
              ))}
            </select>

            {/* Supplier Filter */}
            {uniqueSuppliers.length > 0 && (
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-secondary/50 text-xs font-medium outline-none focus:border-primary/50 transition-colors"
              >
                <option value="">{t.common.all} Suppliers</option>
                {uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            {/* Sort Toggle */}
            <button
              type="button"
              onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
              className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-medium bg-secondary/50 hover:bg-secondary transition-colors"
              title={`Sort by ${sortField} (${sortOrder})`}
            >
              <ArrowUpDown className="size-3.5" />
              {sortOrder.toUpperCase()}
            </button>

            <button
              type="button"
              onClick={() => reload()}
              className="p-2 border border-border rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
              title={tc?.refreshASNs || "Refresh ASNs"}
            >
              <RefreshCw className="size-4" />
            </button>

            <PrimaryButton icon={Plus} onClick={() => { setForm(blankASN()); setEditTarget(null); setShowAdd(true); }}>
              {t.common.new} ASN
            </PrimaryButton>
          </div>
        </div>
      </div>

      {/* ── ASN Table / Cards List ── */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border border-border">
            <RefreshCw className="size-6 animate-spin mx-auto mb-2 text-primary" />
            {t.common.loading}
          </div>
        ) : sortedAsns.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-3">
            <Package className="size-10 text-muted-foreground mx-auto opacity-40" />
            <div className="font-semibold text-lg">{t.common.noResults}</div>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Create an inbound ASN to register upcoming supplier shipments before physical arrival.
            </p>
            <PrimaryButton icon={Plus} onClick={() => { setForm(blankASN()); setEditTarget(null); setShowAdd(true); }}>
              {t.common.create} ASN
            </PrimaryButton>
          </div>
        ) : (
          sortedAsns.map((asn, i) => {
            const displayId = asn.asnId || asn.asnNumber || "ASN-0000";
            const displayPo = asn.poNumber || asn.po || "—";
            const displayDate = asn.expectedDate || asn.expected_date ? new Date(asn.expectedDate || asn.expected_date!).toLocaleDateString("en-GB") : "—";
            const totalUnits = asn.expected_units || (asn.items ? asn.items.reduce((s, x) => s + (Number(x.expected_qty) || 0), 0) : 0);
            const receivedUnits = asn.items ? asn.items.reduce((s, x) => s + (Number(x.received_qty) || 0), 0) : 0;
            const lineCount = asn.sku_count || (asn.items ? asn.items.length : 0);
            const isCompleted = asn.status === "completed" || asn.status === "completed_with_discrepancies" || asn.status === "cancelled";

            return (
              <div
                key={asn._id}
                className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-all shadow-sm"
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-secondary/80 flex items-center justify-center border border-border">
                      <Package className="size-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-base" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                          {displayId}
                        </span>
                        <StatusBadge status={asn.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Supplier: <strong className="text-foreground">{asn.supplier}</strong> · Owner: <strong className="text-primary font-semibold">{asn.owner || 'Default Owner'}</strong> · PO: <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{displayPo}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    <div className="bg-secondary/50 px-2.5 py-1 rounded-md border border-border/50">
                      <strong>{lineCount}</strong> lines · <strong style={{ fontFamily: "JetBrains Mono, monospace" }}>{receivedUnits}/{totalUnits.toLocaleString()}</strong> units received
                    </div>
                    <div className="flex items-center gap-1">
                      <Truck className="size-3.5" /> {asn.carrier || "DHL"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Anchor className="size-3.5" /> {asn.receivingDock || "Dock 1"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="size-3.5" /> {t.receiving?.eta || "ETA"}: <strong className="text-foreground">{displayDate}</strong>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => handleOpenReceivingWorkspace(asn)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm active:scale-95"
                      >
                        <Play className="size-3.5 fill-current" /> {t.receiving?.receiveGoods || "Receive Goods"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleOpenView(asn)}
                      className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-secondary transition-colors"
                      title={tc?.viewDetailsHistory || "View Details & History"}
                    >
                      <Eye className="size-3.5" /> {t.common.view}
                    </button>
                    {(isCompleted || asn.deliveryNoteNumber) && (
                      <button
                        type="button"
                        onClick={() => handleDownloadDeliveryNote(asn)}
                        className="flex items-center gap-1 px-3 py-1.5 border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-bold transition-all shadow-sm"
                        title="Download / View Delivery Note Document"
                      >
                        <FileText className="size-3.5" /> Delivery Note
                      </button>
                    )}
                    {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(asn)}
                        className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-xs font-semibold hover:bg-secondary transition-colors"
                        title={tc?.editASN || "Edit ASN"}
                      >
                        <Pencil className="size-3.5" /> {t.common.edit}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(asn)}
                      className="p-1.5 border border-border rounded-lg text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
                      title={tc?.softDeleteCancelASN || "Soft Delete / Cancel ASN"}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      {/* ── PHASE 2 PHYSICAL RECEIVING WORKSPACE MODAL ── */}
      {receiveTarget && (
        <Modal
          open={true}
          onClose={() => { if (!isSubmitting) setReceiveTarget(null); }}
          title={`Receiving Workspace: ${receiveTarget.asnId || receiveTarget.asnNumber}`}
          subtitle={`Supplier: ${receiveTarget.supplier} · Dock: ${receiveTarget.receivingDock} · PO: ${receiveTarget.poNumber || receiveTarget.po}`}
          width="xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <div className="text-xs text-muted-foreground font-medium">
                Ready to Receive: <strong>{receiveLines.reduce((s, l) => s + (Number(l.qtyToReceive) || 0), 0)}</strong> units
              </div>
              <div className="flex gap-2">
                <ModalCancel onClose={() => setReceiveTarget(null)} />
                <button
                  type="button"
                  onClick={handleConfirmReceiveExecution}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all shadow-sm disabled:opacity-50"
                >
                  <Check className="size-4" />
                  {isSubmitting ? "Confirming & Updating Stock..." : "Confirm Receive"}
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Barcode Scanner Box */}
            <div className="bg-secondary/40 border-2 border-dashed border-primary/40 p-3.5 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-primary">
                <ScanLine className="size-4" /> Barcode SKU Scanner
              </div>
              <div className="flex gap-2">
                <input
                  value={scannedBarcode}
                  onChange={(e) => setScannedBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleBarcodeScanSubmit()}
                  placeholder={tc?.scanProductBarcodeOrTypeSKUAndPressEnter || "Scan product barcode or type SKU and press Enter..."}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-mono outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  onClick={() => handleBarcodeScanSubmit()}
                  className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:opacity-90 transition-all"
                >
                  Scan SKU
                </button>
                <button
                  type="button"
                  onClick={() => setShowCameraScanner(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-bold rounded-lg transition-all border border-border"
                  title="Scan using Webcam / Mobile Camera"
                >
                  <Camera className="size-3.5" /> Camera Scanner
                </button>
              </div>
            </div>

            {/* Camera Barcode Scanner Modal */}
            <CameraBarcodeScanner
              open={showCameraScanner}
              onClose={() => setShowCameraScanner(false)}
              onScan={(scannedVal) => {
                setScannedBarcode(scannedVal);
                handleBarcodeScanSubmit(scannedVal);
              }}
              title={`Scan SKU for ASN ${receiveTarget.asnId || receiveTarget.asnNumber}`}
            />

            {/* Line Items Receiving Table */}
            <div className="border border-border rounded-xl overflow-hidden text-xs space-y-0">
              <div className="bg-secondary/70 p-2.5 font-bold border-b border-border flex items-center justify-between">
                <span>Inbound Product Lines ({receiveLines.length})</span>
                <span className="text-[11px] text-muted-foreground">Line-by-Line Receiving Execution</span>
              </div>
              <div className="divide-y divide-border max-h-[50vh] overflow-y-auto">
                {receiveLines.map((line, idx) => {
                  const remainingAfterThis = Math.max(0, line.remaining - (Number(line.qtyToReceive) || 0));
                  const isHighlighted = highlightedSku === line.sku;

                  return (
                    <div
                      key={line.sku}
                      className={`p-3.5 space-y-3 transition-colors ${isHighlighted ? "bg-amber-500/10 border-l-4 border-l-amber-500" : "hover:bg-secondary/20"}`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <span className="font-bold font-mono text-sm text-primary">{line.sku}</span>
                          <span className="font-semibold text-xs text-foreground ml-2">{line.name}</span>
                          {line.qcRequired && (
                            <span className="ml-2 bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                              QC HOLD REQUIRED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono">
                          <span>Expected: <strong>{line.expected}</strong></span>
                          <span>Recv'd: <strong>{line.alreadyReceived}</strong></span>
                          <span className="text-primary font-bold">Remaining: {line.remaining}</span>
                        </div>
                      </div>

                      {/* Inputs Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1">
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground block mb-0.5">Qty to Receive</label>
                          <input
                            id={`receive-qty-input-${idx}`}
                            type="number"
                            min="0"
                            max={line.remaining}
                            value={line.qtyToReceive}
                            onChange={(e) => updateReceiveLine(idx, "qtyToReceive", Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-mono font-bold focus:border-primary/50"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground block mb-0.5">Damaged Qty</label>
                          <input
                            type="number"
                            min="0"
                            value={line.damagedQty}
                            onChange={(e) => updateReceiveLine(idx, "damagedQty", Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-destructive/40 bg-destructive/5 text-xs font-mono font-bold text-destructive"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground block mb-0.5">
                            {tc?.proposedBin || "Proposed Bin"}
                            {proposeLoading && <span className="ml-1 text-primary animate-pulse">…</span>}
                          </label>
                          <input
                            value={line.bin}
                            onChange={(e) => updateReceiveLine(idx, "bin", e.target.value)}
                            placeholder={proposeLoading ? "Proposing..." : "Auto-proposed"}
                            title={(line as any).ruleApplied ? `Rule: ${(line as any).ruleApplied}` : "Dynamic location proposal"}
                            className={`w-full px-2.5 py-1.5 rounded-lg border bg-emerald-500/5 text-xs font-mono font-bold focus:border-emerald-500/50 ${line.bin ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-border text-muted-foreground"
                              }`}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground block mb-0.5">Lot #</label>
                          <input
                            value={line.lotNumber}
                            onChange={(e) => updateReceiveLine(idx, "lotNumber", e.target.value)}
                            placeholder={tc?.lOT101 || "LOT-101"}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground block mb-0.5">Batch #</label>
                          <input
                            value={line.batchNumber}
                            onChange={(e) => updateReceiveLine(idx, "batchNumber", e.target.value)}
                            placeholder={tc?.bATCHA || "BATCH-A"}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground block mb-0.5">Remaining After</label>
                          <div className="px-2.5 py-1.5 rounded-lg bg-secondary/50 border border-border text-xs font-mono font-bold text-muted-foreground">
                            {remainingAfterThis} {line.uom}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Create / Edit ASN Modal ── */}
      <Modal
        open={showAdd}
        onClose={() => { if (!isSubmitting) { setShowAdd(false); setEditTarget(null); } }}
        title={editTarget ? `Edit ASN (${editTarget.asnId || editTarget.asnNumber})` : "Create New Inbound ASN"}
        subtitle={tc?.registerIncomingShippingNoticeAndProductLineItems || "Register incoming shipping notice and product line items"}
        width="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground font-medium">
              Total Lines: <strong>{form.items.length}</strong> · Expected Units: <strong>{form.items.reduce((s, x) => s + (Number(x.expected_qty) || 0), 0)}</strong>
            </div>
            <div className="flex gap-2">
              <ModalCancel onClose={() => { setShowAdd(false); setEditTarget(null); }} />
              <ModalSubmit onClick={handleSaveASN} disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : editTarget ? "Update ASN" : "Save & Create ASN"}
              </ModalSubmit>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Header Section */}
          <div className="bg-secondary/20 p-4 rounded-xl border border-border space-y-4">
            <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Shipment Header Information</h4>
            <Row>
              <Field label={tc?.supplierName || "Supplier Name *"} required>
                <Input
                  value={form.supplier}
                  onChange={(e) => updateFormHeader("supplier", e.target.value)}
                  placeholder={tc?.eGAcmeIndustrialCorp || "e.g. Acme Industrial Corp"}
                />
              </Field>
              <Field label="Inventory Owner * (3PL)" required>
                <Input
                  value={form.owner}
                  onChange={(e) => updateFormHeader("owner", e.target.value)}
                  placeholder="e.g. Apple Distribution"
                />
              </Field>
            </Row>
            <Row>
              <Field label={tc?.purchaseOrder || "Purchase Order # *"} required>
                <Input
                  value={form.poNumber}
                  onChange={(e) => updateFormHeader("poNumber", e.target.value)}
                  placeholder={tc?.eGPO998877 || "e.g. PO-998877"}
                />
              </Field>
              <Field label={tc?.originAddress || "Origin / Address"}>
                <Input
                  value={form.origin}
                  onChange={(e) => updateFormHeader("origin", e.target.value)}
                  placeholder={tc?.eGHamburgGermany || "e.g. Hamburg, Germany"}
                />
              </Field>
            </Row>
            <Row>
              <Field label={tc?.carrier || "Carrier"}>
                <Select value={form.carrier} onChange={(e) => updateFormHeader("carrier", e.target.value)}>
                  {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label={tc?.receivingDock || "Receiving Dock *"} required>
                <Select value={form.receivingDock} onChange={(e) => updateFormHeader("receivingDock", e.target.value)}>
                  {DOCKS.map(d => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
            </Row>
            <Row>
              <Field label={tc?.expectedArrivalDate || "Expected Arrival Date *"} required>
                <Input
                  type="date"
                  value={form.expectedDate}
                  onChange={(e) => updateFormHeader("expectedDate", e.target.value)}
                />
              </Field>
              <Field label={tc?.notesSpecialInstructions || "Notes / Special Instructions"}>
                <Input
                  value={form.notes}
                  onChange={(e) => updateFormHeader("notes", e.target.value)}
                  placeholder={tc?.fragileFreightRequiresForkliftHandling || "Fragile freight, requires forklift handling..."}
                />
              </Field>
            </Row>
          </div>

          {/* Product Line Editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm">Product Line Items</h4>
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
              >
                <Plus className="size-3.5" /> Add Product Line
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {form.items.map((line, idx) => (
                <div key={idx} className="p-3.5 rounded-xl border border-border bg-card space-y-3 relative group">
                  <div className="flex items-center justify-between text-xs font-bold border-b border-border pb-2">
                    <span className="text-primary">Line #{idx + 1}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => duplicateLine(idx)}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]"
                        title={tc?.duplicateLine || "Duplicate line"}
                      >
                        <Copy className="size-3" /> Duplicate
                      </button>
                      {form.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-destructive hover:underline flex items-center gap-1 text-[11px]"
                          title={tc?.removeLine || "Remove line"}
                        >
                          <Trash2 className="size-3" /> Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] font-medium block mb-1">SKU *</label>
                      <Input
                        value={line.sku}
                        onChange={(e) => updateLine(idx, "sku", e.target.value)}
                        placeholder={tc?.sKU1001 || "SKU-1001"}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-medium block mb-1">Product Name *</label>
                      <Input
                        value={line.name}
                        onChange={(e) => updateLine(idx, "name", e.target.value)}
                        placeholder={tc?.lithiumBatteryPack || "Lithium Battery Pack"}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1">Description</label>
                      <Input
                        value={line.description}
                        onChange={(e) => updateLine(idx, "description", e.target.value)}
                        placeholder={tc?.modelX || "Model X"}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="text-[11px] font-medium block mb-1">Expected Qty *</label>
                      <Input
                        type="number"
                        min="1"
                        value={line.expected_qty}
                        onChange={(e) => updateLine(idx, "expected_qty", Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1">UOM *</label>
                      <Select value={line.uom} onChange={(e) => updateLine(idx, "uom", e.target.value)}>
                        {UOMS.map(u => <option key={u} value={u}>{u}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1">Lot Number</label>
                      <Input
                        value={line.lotNumber}
                        onChange={(e) => updateLine(idx, "lotNumber", e.target.value)}
                        placeholder={tc?.lOT2026A || "LOT-2026-A"}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1">Batch Number</label>
                      <Input
                        value={line.batchNumber}
                        onChange={(e) => updateLine(idx, "batchNumber", e.target.value)}
                        placeholder={tc?.bATCH09 || "BATCH-09"}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1">Expiry Date</label>
                      <Input
                        type="date"
                        value={line.expiryDate}
                        onChange={(e) => updateLine(idx, "expiryDate", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={line.qcRequired}
                        onChange={(e) => updateLine(idx, "qcRequired", e.target.checked)}
                        className="rounded border-border text-primary focus:ring-primary size-4"
                      />
                      <span>Require Quality Control (QC Check upon receipt)</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* ── View Details Modal with History & Discrepancies ── */}
      {viewTarget && (
        <Modal
          open={true}
          onClose={() => setViewTarget(null)}
          title={`ASN Details: ${viewTarget.asnId || viewTarget.asnNumber}`}
          subtitle={`Supplier: ${viewTarget.supplier} · PO: ${viewTarget.poNumber || viewTarget.po}`}
          width="xl"
          footer={
            <div className="flex justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Status:</span>
                <StatusBadge status={viewTarget.status} />
              </div>
              <div className="flex gap-2">
                {(viewTarget.status === 'completed' || viewTarget.deliveryNoteNumber) && (
                  <button
                    type="button"
                    onClick={() => handleDownloadDeliveryNote(viewTarget)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90 transition-all shadow-sm"
                  >
                    <FileText className="size-3.5" /> View Delivery Note
                  </button>
                )}
                <ModalCancel onClose={() => setViewTarget(null)} />
              </div>
            </div>
          }
        >
          <div className="space-y-5">
            {/* Header Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-secondary/30 p-4 rounded-xl border border-border text-xs">
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase">Carrier</div>
                <div className="font-semibold text-foreground text-sm mt-0.5">{viewTarget.carrier || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase">Receiving Dock</div>
                <div className="font-semibold text-foreground text-sm mt-0.5">{viewTarget.receivingDock || "Dock 1"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase">Origin</div>
                <div className="font-semibold text-foreground text-sm mt-0.5">{viewTarget.origin || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase">Expected Arrival</div>
                <div className="font-semibold text-foreground text-sm mt-0.5 font-mono">
                  {viewTarget.expectedDate || viewTarget.expected_date ? new Date(viewTarget.expectedDate || viewTarget.expected_date!).toLocaleDateString("en-GB") : "—"}
                </div>
              </div>
            </div>

            {/* Registered Product Lines Table */}
            <div>
              <h4 className="font-bold text-sm mb-2.5">Registered Product Lines ({viewTarget.items?.length || 0})</h4>
              <div className="border border-border rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-secondary/60 border-b border-border font-semibold text-muted-foreground">
                      <th className="p-2.5">#</th>
                      <th className="p-2.5">SKU</th>
                      <th className="p-2.5">Product Name</th>
                      <th className="p-2.5 text-right">Expected</th>
                      <th className="p-2.5 text-right">Received</th>
                      <th className="p-2.5">UOM</th>
                      <th className="p-2.5">QC Req.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(viewTarget.items || []).map((item, idx) => (
                      <tr key={idx} className="hover:bg-secondary/20 transition-colors">
                        <td className="p-2.5 text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="p-2.5 font-bold font-mono text-primary">{item.sku}</td>
                        <td className="p-2.5">
                          <div className="font-medium">{item.name || (item as any).productName}</div>
                          {item.description && <div className="text-[10px] text-muted-foreground">{item.description}</div>}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-foreground">
                          {(item.expected_qty || 0).toLocaleString()}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {(item.received_qty || 0).toLocaleString()}
                        </td>
                        <td className="p-2.5 uppercase font-semibold text-[10px] text-muted-foreground">{item.uom || "pcs"}</td>
                        <td className="p-2.5">
                          {item.qcRequired ? (
                            <span className="bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-[10px] px-1.5 py-0.5 rounded">HOLD</span>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Receiving History Section */}
            {asnHistory.length > 0 && (
              <div>
                <h4 className="font-bold text-sm mb-2 flex items-center gap-1.5 text-primary">
                  <History className="size-4" /> Receiving Execution Logs ({asnHistory.length})
                </h4>
                <div className="border border-border rounded-xl overflow-hidden text-xs space-y-0 max-h-48 overflow-y-auto">
                  {asnHistory.map((h, idx) => (
                    <div key={idx} className="p-2.5 border-b border-border/60 flex items-center justify-between hover:bg-secondary/20">
                      <div>
                        <div className="font-bold font-mono text-foreground">
                          SKU {h.sku} — Received +{h.qtyReceived} units
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Operator: {h.operator} · Dock: {h.receivingDock} · {new Date(h.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right font-mono text-xs">
                        <span className="text-muted-foreground">{h.beforeQty} ➔ </span>
                        <strong className="text-emerald-600">{h.afterQty}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Discrepancies Section */}
            {asnDiscrepancies.length > 0 && (
              <div>
                <h4 className="font-bold text-sm mb-2 flex items-center gap-1.5 text-destructive">
                  <AlertOctagon className="size-4" /> Discrepancies & Damages ({asnDiscrepancies.length})
                </h4>
                <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-3 space-y-2 text-xs text-destructive">
                  {asnDiscrepancies.map((d, idx) => (
                    <div key={idx} className="border-b border-destructive/20 pb-2 last:border-b-0 last:pb-0">
                      <div className="font-bold uppercase tracking-wider text-[11px]">
                        Type: {d.type.replace("_", " ")} — SKU: {d.sku}
                      </div>
                      <div className="text-[11px] mt-0.5">
                        {d.notes} (Reported by {d.user} on {new Date(d.createdAt).toLocaleString()})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && (
        <Modal
          open={true}
          onClose={() => setDeleteTarget(null)}
          title={tc?.cancelArchiveASNSoftDelete || "Cancel & Archive ASN (Soft Delete)"}
          subtitle={`Are you sure you want to cancel ${deleteTarget.asnId || deleteTarget.asnNumber}? The document will be soft-deleted and archived for audit compliance.`}
          footer={
            <div className="flex gap-2 justify-end w-full">
              <ModalCancel onClose={() => setDeleteTarget(null)} />
              <button
                type="button"
                onClick={handleDeleteASN}
                disabled={isSubmitting}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all"
              >
                {isSubmitting ? "Cancelling..." : "Confirm Soft Delete"}
              </button>
            </div>
          }
        >
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive">
            <strong>Enterprise Audit Rule:</strong> Hard-deleting supply chain records is strictly prohibited. This ASN will be marked as <strong className="underline">cancelled & soft-deleted</strong> in MongoDB while retaining history.
          </div>
        </Modal>
      )}
    </div>
  );
}
