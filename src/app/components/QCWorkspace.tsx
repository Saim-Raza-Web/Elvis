import { useState, useEffect, useMemo } from "react";
import { 
  ShieldCheck, Search, Filter, RefreshCw, CheckCircle2, XCircle, AlertTriangle, 
  RotateCcw, Clock, Layers, FileText, Eye, Play, ArrowRight, Package, CheckSquare, Camera, Upload, Trash2
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel } from "./Modal";
import { TablePagination } from "./TablePagination";
import { qcService } from "../../services/qc.service";
import { inventoryService } from "../../services/inventory.service";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";
import { useLang } from "../LangContext";

type QuarantineItem = {
  _id: string;
  quarantineId: string;
  inspectionId?: string;
  asnId: string;
  asnNumber?: string;
  sku: string;
  productName: string;
  warehouse: string;
  qty: number;
  lotNumber: string;
  batchNumber: string;
  expiryDate?: string;
  status: "pending_qc" | "under_inspection" | "qc_passed" | "qc_failed" | "returned_to_vendor";
  failReason?: string;
  rtvAuthNumber?: string;
  rtvCarrier?: string;
  createdAt?: string;
};

const qcListService: ListService<QuarantineItem> = {
  getAll: async (params) => {
    const data = await qcService.getAll(params);
    return data.map((d: any) => ({ ...d, id: d.quarantineId || d._id }));
  },
  getPage: async (params) => {
    const data = await qcService.getPage(params);
    return {
      data: data.data.map((d: any) => ({ ...d, id: d.quarantineId || d._id })),
      pagination: data.pagination
    };
  }
};

const QC_STATUS_OPTIONS = [
  { value: "All", label: "All QC Statuses" },
  { value: "pending_qc", label: "Pending QC" },
  { value: "under_inspection", label: "Under Inspection" },
  { value: "qc_passed", label: "QC Passed" },
  { value: "qc_failed", label: "QC Failed" },
  { value: "returned_to_vendor", label: "Returned To Vendor" }
];

export function QCWorkspace() {
  const { t } = useLang();
  const common = t.common as any;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  // Modals & Active Targets
  const [inspectTarget, setInspectTarget] = useState<QuarantineItem | null>(null);
  const [failTarget, setFailTarget] = useState<QuarantineItem | null>(null);
  const [rtvTarget, setRtvTarget] = useState<QuarantineItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inspection Form State
  const [form, setForm] = useState({
    packagingCondition: "Good",
    productCondition: "Pass",
    temperature: "21°C Ambient",
    humidity: "45% RH",
    damageLevel: "None",
    missingLabels: false,
    visualInspection: "Pass",
    functionalTest: "Pass",
    notes: "",
    arrivalTemp: "4.5",
    minTemp: "3.2",
    maxTemp: "6.8",
    humidityPct: "45",
    dataLogger: "EL-USB-1 S/N: 994821",
    tempRangeMin: 2,
    tempRangeMax: 8,
    overrideBlocked: false,
    approvedQty: 1,
    rejectedQty: 0,
    rejectionDestination: "Quarantine",
    attachments: [] as any[]
  });

  const [failReason, setFailReason] = useState("Damaged Packaging & Visual Failure");
  const [rtvAuthNumber, setRtvAuthNumber] = useState("RTV-AUTH-2026-99");
  const [rtvCarrier, setRtvCarrier] = useState("DHL Freight");
  const [productQcProfile, setProductQcProfile] = useState<string>("Standard");

  useEffect(() => {
    if (!inspectTarget) return;
    setForm(p => ({
      ...p,
      approvedQty: inspectTarget.qty,
      rejectedQty: 0,
      rejectionDestination: "Quarantine"
    }));
    const fetchQcProfile = async () => {
      try {
        const res = await inventoryService.resolveBarcode(inspectTarget.sku).catch(() => null);
        if (res && res.product) {
          const profile = res.product.qc_profile || res.product.qcProfile || (res.product.category === 'COLD' ? 'Cold Chain' : 'Standard');
          setProductQcProfile(profile);
        } else {
          setProductQcProfile("Standard");
        }
      } catch (_) {
        setProductQcProfile("Standard");
      }
    };
    fetchQcProfile();
  }, [inspectTarget]);

  const { items: pagedItems, allItems: items, pagination, page, setPage, reload, isLoading } = usePaginatedList<QuarantineItem>(
    qcListService,
    {
      apiParams: {
        search: search.trim().toLowerCase(),
        status: statusFilter !== "All" ? statusFilter : undefined
      },
      deps: [search, statusFilter]
    }
  );

  // Stats computation
  const stats = useMemo(() => {
    const total = items.length;
    const pending = items.filter(i => i.status === "pending_qc").length;
    const underInspection = items.filter(i => i.status === "under_inspection").length;
    const passed = items.filter(i => i.status === "qc_passed").length;
    const failed = items.filter(i => i.status === "qc_failed").length;
    const rtv = items.filter(i => i.status === "returned_to_vendor").length;
    return { total, pending, underInspection, passed, failed, rtv };
  }, [items]);

  // Start Inspection Trigger
  const handleStartInspection = async (item: QuarantineItem) => {
    try {
      setIsSubmitting(true);
      const result = await qcService.startInspection(item.quarantineId);
      toast.success(`Inspection ${result.inspection?.inspectionId || 'QC-001'} initiated.`);
      setInspectTarget(result.quarantineItem || item);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to start inspection");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pass Inspection Execution
  const handlePassInspection = async () => {
    if (!inspectTarget) return;

    const total = inspectTarget.qty;
    const approved = Number(form.approvedQty);
    const rejected = Number(form.rejectedQty);

    if (approved + rejected !== total) {
      toast.error(`Units Approved (${approved}) + Units Rejected (${rejected}) must equal Total Received (${total}).`);
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await qcService.passInspection(inspectTarget._id, {
        notes: form.notes,
        approvedQty: approved,
        rejectedQty: rejected,
        rejectionDestination: form.rejectionDestination,
        arrivalTemp: form.arrivalTemp,
        minTemp: form.minTemp,
        maxTemp: form.maxTemp,
        humidityPct: form.humidityPct,
        dataLogger: form.dataLogger,
        tempRangeMin: form.tempRangeMin,
        tempRangeMax: form.tempRangeMax,
        overrideBlocked: form.overrideBlocked,
        attachments: form.attachments
      });
      toast.success(`${t.qc?.passSuccess || "QC PASSED!"} ${approved} units released. Task ${result.putawayTask?.taskId || 'PUT-001'} created.`);
      setInspectTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to pass QC inspection");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fail Inspection Execution
  const handleFailInspection = async () => {
    if (!failTarget) return;
    try {
      setIsSubmitting(true);
      await qcService.failInspection(failTarget._id, failReason);
      toast.error(`${t.qc?.failSuccess || "QC FAILED for SKU"} ${failTarget.sku}.`);
      setFailTarget(null);
      setInspectTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to submit QC failure");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Return To Vendor Execution
  const handleRtvExecution = async () => {
    if (!rtvTarget) return;
    try {
      setIsSubmitting(true);
      await qcService.returnToVendor(rtvTarget._id, {
        returnReason: failReason,
        rtvAuthNumber,
        rtvCarrier
      });
      toast.success(`${t.qc?.rtvSuccess || "Return To Vendor (RTV) executed for"} ${rtvTarget.sku}. RTV Auth: ${rtvAuthNumber}.`);
      setRtvTarget(null);
      setInspectTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to execute Return to Vendor");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: t.qc.totalInspections, value: stats.total, icon: Layers, color: "text-foreground" },
          { label: t.qc.pendingQC, value: stats.pending, icon: Clock, color: "text-warning" },
          { label: t.status.under_inspection, value: stats.underInspection, icon: ShieldCheck, color: "text-primary" },
          { label: t.qc.qcPassed, value: stats.passed, icon: CheckCircle2, color: "text-emerald-600" },
          { label: t.qc.qcFailed, value: stats.failed, icon: XCircle, color: "text-destructive" },
          { label: t.status.returned_to_vendor, value: stats.rtv, icon: RotateCcw, color: "text-purple-600" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3.5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 35}ms` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="font-bold text-xl" style={{ fontFamily: "JetBrains Mono, monospace" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Controls Bar ── */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-64">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${t.common.search} by SKU, ASN...`}
              className="w-full pl-9 pr-4 py-2 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary/50 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-secondary/50 text-xs font-medium outline-none focus:border-primary/50"
          >
            <option value="All">{t.common.all}</option>
            <option value="pending_qc">{t.qc.pendingQC}</option>
            <option value="under_inspection">{t.status.under_inspection}</option>
            <option value="qc_passed">{t.qc.qcPassed}</option>
            <option value="qc_failed">{t.qc.qcFailed}</option>
            <option value="returned_to_vendor">{t.status.returned_to_vendor}</option>
          </select>
          <button
            type="button"
            onClick={() => reload()}
            className="p-2 border border-border rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      {/* ── Table List ── */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border border-border">
            <RefreshCw className="size-6 animate-spin mx-auto mb-2 text-primary" />
            {t.common.loading}
          </div>
        ) : pagedItems.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-2">
            <ShieldCheck className="size-10 text-muted-foreground mx-auto opacity-40" />
            <div className="font-semibold text-base">{t.common.noResults}</div>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {t.qc.subtitle}
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden bg-card text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/60 border-b border-border font-semibold text-muted-foreground">
                  <th className="p-3">{t.qc.inspectionNo}</th>
                  <th className="p-3">ASN #</th>
                  <th className="p-3">{t.inventory.sku}</th>
                  <th className="p-3 text-right">{t.transfers.qty}</th>
                  <th className="p-3">Lot / Batch</th>
                  <th className="p-3">{t.common.status}</th>
                  <th className="p-3 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedItems.map(item => (
                  <tr key={item._id} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-3 font-mono font-bold text-primary">
                      {item.inspectionId || item.quarantineId}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">
                      {item.asnId || item.asnNumber || "—"}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-foreground">{item.sku}</div>
                      <div className="text-[11px] text-muted-foreground">{item.productName}</div>
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                      {item.qty.toLocaleString()} units
                    </td>
                    <td className="p-3 font-mono text-[11px] text-muted-foreground">
                      <div>Lot: {item.lotNumber || "—"}</div>
                      {item.batchNumber && <div>Batch: {item.batchNumber}</div>}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="p-3 text-right">
                      {item.status === "pending_qc" && (
                        <button
                          type="button"
                          onClick={() => handleStartInspection(item)}
                          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-all inline-flex items-center gap-1"
                        >
                          <Play className="size-3 fill-current" /> {t.common.start}
                        </button>
                      )}
                      {(item.status === "under_inspection" || item.status === "pending_qc") && (
                        <button
                          type="button"
                          onClick={() => setInspectTarget(item)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all inline-flex items-center gap-1 ml-2"
                        >
                          <ShieldCheck className="size-3.5" /> {t.qc.passQC} / {t.qc.failQC}
                        </button>
                      )}
                      {(item.status === "qc_passed" || item.status === "qc_failed" || item.status === "returned_to_vendor") && (
                        <span className="text-[11px] text-muted-foreground font-mono">{t.status[item.status] || item.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      {/* ── Inspection & Decision Form Modal ── */}
      {inspectTarget && (
        <Modal
          open={true}
          onClose={() => { if (!isSubmitting) setInspectTarget(null); }}
          title={`${t.qc.title}: ${inspectTarget.inspectionId || inspectTarget.quarantineId}`}
          subtitle={`SKU: ${inspectTarget.sku} (${inspectTarget.productName}) · ${t.transfers.qty}: ${inspectTarget.qty} units`}
          width="xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => setRtvTarget(inspectTarget)}
                className="px-3.5 py-1.5 rounded-lg border border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 font-bold text-xs transition-all"
              >
                {t.qc.returnToVendor} (RTV)
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFailTarget(inspectTarget)}
                  className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground font-bold text-xs hover:opacity-90 transition-all"
                >
                  {t.qc.failInspection}
                </button>
                <button
                  type="button"
                  onClick={handlePassInspection}
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="size-4" /> {t.qc.passAndRelease}
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Header info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-secondary/30 p-3.5 rounded-xl border border-border">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">{t.putaway.asnId}</span>
                <div className="font-mono font-bold text-foreground mt-0.5">{inspectTarget.asnId || inspectTarget.asnNumber}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">{t.common.warehouse}</span>
                <div className="font-bold text-foreground mt-0.5">{inspectTarget.warehouse}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Lot #</span>
                <div className="font-mono font-bold text-foreground mt-0.5">{inspectTarget.lotNumber || "—"}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Batch #</span>
                <div className="font-mono font-bold text-foreground mt-0.5">{inspectTarget.batchNumber || "—"}</div>
              </div>
            </div>

            {/* Inspection Parameters Grid (Configured by Product QC Profile) */}
            <div className="bg-secondary/20 p-4 rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">{t.qc.paramTitle}</h4>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  QC Profile: {productQcProfile}
                </span>
              </div>

              {/* Standard Fields (Packaging Condition, Product Condition, Visual Inspection) */}
              <Row>
                <Field label={t.qc.pkgCondition}>
                  <Select value={form.packagingCondition} onChange={(e) => setForm(p => ({ ...p, packagingCondition: e.target.value }))}>
                    <option value="Good">{common?.goodIntact || "Good / Intact"}</option>
                    <option value="Minor Damage">{common?.minorBoxDamage || "Minor Box Damage"}</option>
                    <option value="Severely Damaged">{common?.severelyDamaged || "Severely Damaged"}</option>
                  </Select>
                </Field>
                <Field label={t.qc.prodCondition}>
                  <Select value={form.productCondition} onChange={(e) => setForm(p => ({ ...p, productCondition: e.target.value }))}>
                    <option value="Pass">{common?.passPristine || "Pass / Pristine"}</option>
                    <option value="Scratched">{common?.scratchedCosmeticFault || "Scratched / Cosmetic Fault"}</option>
                    <option value="Defective">{common?.defectiveNonFunctional || "Defective / Non-functional"}</option>
                  </Select>
                </Field>
              </Row>

              <Row>
                <Field label={t.qc.visualResult}>
                  <Select value={form.visualInspection} onChange={(e) => setForm(p => ({ ...p, visualInspection: e.target.value }))}>
                    <option value="Pass">{common?.pass || "Pass"}</option>
                    <option value="Fail">{common?.fail || "Fail"}</option>
                  </Select>
                </Field>
              </Row>

              {/* Cold Chain QC Block (QC-01) */}
              {(productQcProfile?.includes("Cold Chain") || productQcProfile === "COLD" || inspectTarget?.sku.includes("COLD")) && (
                <div className="bg-blue-500/10 p-3.5 rounded-xl border border-blue-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                      <Layers className="size-4" /> Cold Chain Quality Inspection (QC-01)
                    </span>
                    <span className="text-[10px] font-mono bg-blue-500/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-md font-bold">
                      Allowed Range: {form.tempRangeMin}°C – {form.tempRangeMax}°C
                    </span>
                  </div>

                  <Row>
                    <Field label="Arrival Temp (°C) *" required>
                      <Input
                        type="number"
                        step="0.1"
                        value={form.arrivalTemp}
                        onChange={(e) => setForm(p => ({ ...p, arrivalTemp: e.target.value }))}
                        placeholder="e.g. 4.5"
                      />
                    </Field>
                    <Field label="Min Temp Recorded (°C)">
                      <Input
                        type="number"
                        step="0.1"
                        value={form.minTemp}
                        onChange={(e) => setForm(p => ({ ...p, minTemp: e.target.value }))}
                        placeholder="e.g. 3.2"
                      />
                    </Field>
                    <Field label="Max Temp Recorded (°C)">
                      <Input
                        type="number"
                        step="0.1"
                        value={form.maxTemp}
                        onChange={(e) => setForm(p => ({ ...p, maxTemp: e.target.value }))}
                        placeholder="e.g. 6.8"
                      />
                    </Field>
                  </Row>

                  <Row>
                    <Field label="Relative Humidity (%)">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={form.humidityPct}
                        onChange={(e) => setForm(p => ({ ...p, humidityPct: e.target.value }))}
                        placeholder="e.g. 45"
                      />
                      {Number(form.humidityPct) > 85 && (
                        <span className="text-[10px] text-amber-500 font-bold block mt-1">High Humidity Warning (&gt;85%)</span>
                      )}
                    </Field>
                    <Field label="Data Logger Model & Serial #">
                      <Input
                        value={form.dataLogger}
                        onChange={(e) => setForm(p => ({ ...p, dataLogger: e.target.value }))}
                        placeholder="e.g. EL-USB-1 S/N: 994821"
                      />
                    </Field>
                  </Row>

                  {/* Temperature Excursion Warning & Override */}
                  {form.arrivalTemp !== "" && !isNaN(Number(form.arrivalTemp)) &&
                    (Number(form.arrivalTemp) < form.tempRangeMin || Number(form.arrivalTemp) > form.tempRangeMax) && (
                      <div className="bg-destructive/15 p-3 rounded-lg border border-destructive/40 text-destructive text-xs space-y-2">
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertTriangle className="size-4 shrink-0" /> Temperature Excursion Blocked!
                        </div>
                        <p className="text-[11px]">
                          Arrival temperature ({form.arrivalTemp}°C) is outside configured range ({form.tempRangeMin}°C – {form.tempRangeMax}°C).
                        </p>
                        <label className="flex items-center gap-2 text-xs font-bold cursor-pointer text-foreground pt-1">
                          <input
                            type="checkbox"
                            checked={form.overrideBlocked}
                            onChange={(e) => setForm(p => ({ ...p, overrideBlocked: e.target.checked }))}
                            className="size-4 rounded border-border text-primary"
                          />
                          Supervisor Override Unblock Authorization
                        </label>
                      </div>
                    )}
                </div>
              )}

              {/* Partial Pass & Rejection Split (QC-02) */}
              <div className="bg-secondary/40 p-3.5 rounded-xl border border-border space-y-3">
                <h5 className="font-bold text-xs uppercase text-muted-foreground flex items-center gap-1.5">
                  <CheckSquare className="size-4 text-emerald-600" /> Quantity Approval & Partial Rejection (QC-02)
                </h5>
                <Row>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground block mb-1">Total Received Units</label>
                    <Input value={inspectTarget.qty} disabled className="bg-secondary opacity-80 font-mono font-bold" />
                  </div>
                  <Field label="Units Approved *" required>
                    <Input
                      type="number"
                      min="0"
                      max={inspectTarget.qty}
                      value={form.approvedQty}
                      onChange={(e) => {
                        const app = Math.min(inspectTarget.qty, Math.max(0, Number(e.target.value) || 0));
                        setForm(p => ({ ...p, approvedQty: app, rejectedQty: inspectTarget.qty - app }));
                      }}
                    />
                  </Field>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground block mb-1">Units Rejected (Auto)</label>
                    <Input value={form.rejectedQty} disabled className="bg-destructive/10 text-destructive font-mono font-bold" />
                  </div>
                </Row>

                {form.rejectedQty > 0 && (
                  <Field label="Rejection Destination *" required>
                    <Select
                      value={form.rejectionDestination}
                      onChange={(e) => setForm(p => ({ ...p, rejectionDestination: e.target.value }))}
                    >
                      <option value="Quarantine">Quarantine Area</option>
                      <option value="RTV">Return to Vendor (RTV)</option>
                      <option value="Destruction">Scrap / Destruction</option>
                    </Select>
                  </Field>
                )}
              </div>

              {/* Photo & Video Attachments (QC-03) */}
              <div className="bg-secondary/20 p-3.5 rounded-xl border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-xs uppercase text-muted-foreground flex items-center gap-1.5">
                    <Camera className="size-4 text-primary" /> Inspection Attachments (QC-03)
                  </h5>
                  <span className="text-[10px] text-muted-foreground font-mono">{form.attachments.length}/10 Files (Max 20MB)</span>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold cursor-pointer hover:bg-primary/20 transition-colors">
                    <Camera className="size-4" /> Add Photo / Video
                    <input
                      type="file"
                      accept="image/*,video/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        files.forEach(file => {
                          if (file.size > 20 * 1024 * 1024) {
                            toast.error(`File '${file.name}' exceeds 20MB limit.`);
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            setForm(p => ({
                              ...p,
                              attachments: [...p.attachments.slice(0, 9), {
                                url: ev.target?.result as string,
                                filename: file.name,
                                fileType: file.type,
                                size: file.size,
                                uploadedAt: new Date().toISOString()
                              }]
                            }));
                          };
                          reader.readAsDataURL(file);
                        });
                      }}
                    />
                  </label>
                </div>

                {form.attachments.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 pt-2">
                    {form.attachments.map((att, aIdx) => (
                      <div key={aIdx} className="relative group rounded-lg overflow-hidden border border-border bg-card p-1 text-[10px]">
                        {att.fileType?.startsWith("video") ? (
                          <div className="bg-secondary p-2 rounded text-center font-bold">Video File</div>
                        ) : (
                          <img src={att.url} alt={att.filename} className="w-full h-16 object-cover rounded" />
                        )}
                        <button
                          type="button"
                          onClick={() => setForm(p => ({ ...p, attachments: p.attachments.filter((_, i) => i !== aIdx) }))}
                          className="absolute top-1 right-1 bg-destructive text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Field label={t.qc.inspectorComments}>
                <Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} placeholder={t.qc.notesPlaceholder} />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Fail Confirmation Modal ── */}
      {failTarget && (
        <Modal
          open={true}
          onClose={() => setFailTarget(null)}
          title={t.qc.failInspection}
          subtitle={`Flag SKU ${failTarget.sku} (${failTarget.qty} units) as QC Failed.`}
          footer={
            <div className="flex justify-end gap-2 w-full">
              <ModalCancel onClose={() => setFailTarget(null)} />
              <button
                type="button"
                onClick={handleFailInspection}
                disabled={isSubmitting}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg font-bold text-xs"
              >
                {t.qc.confirmFailTitle}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            <Field label={`${t.qc.reasonForFailure} *`} required>
              <Select value={failReason} onChange={(e) => setFailReason(e.target.value)}>
                <option value="Damaged Packaging & Visual Failure">{common?.damagedPackagingVisualFailure || "Damaged Packaging & Visual Failure"}</option>
                <option value="Expired or Invalid Expiry Date">{common?.expiredOrInvalidExpiryDate || "Expired or Invalid Expiry Date"}</option>
                <option value="Temperature Excursion Failure">{common?.temperatureExcursionFailure || "Temperature Excursion Failure"}</option>
                <option value="Missing Component Labels">{common?.missingComponentLabels || "Missing Component Labels"}</option>
                <option value="Functional Test Defect">{common?.functionalTestDefect || "Functional Test Defect"}</option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {/* ── Return to Vendor Modal ── */}
      {rtvTarget && (
        <Modal
          open={true}
          onClose={() => setRtvTarget(null)}
          title={t.qc.returnToVendor}
          subtitle={`Remove ${rtvTarget.qty} units of SKU ${rtvTarget.sku} from quarantine for vendor return.`}
          footer={
            <div className="flex justify-end gap-2 w-full">
              <ModalCancel onClose={() => setRtvTarget(null)} />
              <button
                type="button"
                onClick={handleRtvExecution}
                disabled={isSubmitting}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg font-bold text-xs hover:bg-purple-700"
              >
                {t.qc.executeRtv}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            <Field label={`${t.qc.rtvAuthNo} *`} required>
              <Input value={rtvAuthNumber} onChange={(e) => setRtvAuthNumber(e.target.value)} />
            </Field>
            <Field label={t.qc.rtvCarrier}>
              <Input value={rtvCarrier} onChange={(e) => setRtvCarrier(e.target.value)} />
            </Field>
            <Field label={t.qc.returnReason}>
              <Input value={failReason} onChange={(e) => setFailReason(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
