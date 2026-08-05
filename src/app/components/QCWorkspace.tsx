import { useState, useMemo } from "react";
import { 
  ShieldCheck, Search, Filter, RefreshCw, CheckCircle2, XCircle, AlertTriangle, 
  RotateCcw, Clock, Layers, FileText, Eye, Play, ArrowRight, Package
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel } from "./Modal";
import { TablePagination } from "./TablePagination";
import { qcService } from "../../services/qc.service";
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
    notes: ""
  });

  const [failReason, setFailReason] = useState("Damaged Packaging & Visual Failure");
  const [rtvAuthNumber, setRtvAuthNumber] = useState("RTV-AUTH-2026-99");
  const [rtvCarrier, setRtvCarrier] = useState("DHL Freight");

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
    try {
      setIsSubmitting(true);
      const result = await qcService.passInspection(inspectTarget._id, form.notes);
      toast.success(`${t.qc?.passSuccess || "QC PASSED!"} ${inspectTarget.qty} units released. Task ${result.putawayTask?.taskId} created.`);
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

            {/* Inspection Parameters Grid */}
            <div className="bg-secondary/20 p-4 rounded-xl border border-border space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">{t.qc.paramTitle}</h4>
              <Row>
                <Field label={t.qc.pkgCondition}>
                  <Select value={form.packagingCondition} onChange={(e) => setForm(p => ({ ...p, packagingCondition: e.target.value }))}>
                    <option value="Good">{t.common?.goodIntact || "Good / Intact"}</option>
                    <option value="Minor Damage">{t.common?.minorBoxDamage || "Minor Box Damage"}</option>
                    <option value="Severely Damaged">{t.common?.severelyDamaged || "Severely Damaged"}</option>
                  </Select>
                </Field>
                <Field label={t.qc.prodCondition}>
                  <Select value={form.productCondition} onChange={(e) => setForm(p => ({ ...p, productCondition: e.target.value }))}>
                    <option value="Pass">{t.common?.passPristine || "Pass / Pristine"}</option>
                    <option value="Scratched">{t.common?.scratchedCosmeticFault || "Scratched / Cosmetic Fault"}</option>
                    <option value="Defective">{t.common?.defectiveNonFunctional || "Defective / Non-functional"}</option>
                  </Select>
                </Field>
              </Row>
              <Row>
                <Field label={t.qc.tempReading}>
                  <Input value={form.temperature} onChange={(e) => setForm(p => ({ ...p, temperature: e.target.value }))} />
                </Field>
                <Field label={t.qc.humidityLevel}>
                  <Input value={form.humidity} onChange={(e) => setForm(p => ({ ...p, humidity: e.target.value }))} />
                </Field>
              </Row>
              <Row>
                <Field label={t.qc.visualResult}>
                  <Select value={form.visualInspection} onChange={(e) => setForm(p => ({ ...p, visualInspection: e.target.value }))}>
                    <option value="Pass">{t.common?.pass || "Pass"}</option>
                    <option value="Fail">{t.common?.fail || "Fail"}</option>
                  </Select>
                </Field>
                <Field label={t.qc.functionalResult}>
                  <Select value={form.functionalTest} onChange={(e) => setForm(p => ({ ...p, functionalTest: e.target.value }))}>
                    <option value="Pass">{t.common?.pass || "Pass"}</option>
                    <option value="Fail">{t.common?.fail || "Fail"}</option>
                    <option value="N/A">{t.common?.nANotRequired || "N/A (Not Required)"}</option>
                  </Select>
                </Field>
              </Row>
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
                <option value="Damaged Packaging & Visual Failure">{t.common?.damagedPackagingVisualFailure || "Damaged Packaging & Visual Failure"}</option>
                <option value="Expired or Invalid Expiry Date">{t.common?.expiredOrInvalidExpiryDate || "Expired or Invalid Expiry Date"}</option>
                <option value="Temperature Excursion Failure">{t.common?.temperatureExcursionFailure || "Temperature Excursion Failure"}</option>
                <option value="Missing Component Labels">{t.common?.missingComponentLabels || "Missing Component Labels"}</option>
                <option value="Functional Test Defect">{t.common?.functionalTestDefect || "Functional Test Defect"}</option>
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
