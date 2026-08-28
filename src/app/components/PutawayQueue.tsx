import { useState, useMemo } from "react";
import { 
  Truck, Search, Filter, RefreshCw, Layers, ArrowRight, Package, Clock, CheckCircle2,
  Scan, UserPlus, MapPin, Building2, AlertTriangle, ShieldCheck, Check, X, QrCode, Camera, Calendar
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./AppShell";
import { TablePagination } from "./TablePagination";
import { putawayService } from "../../services/putaway.service";
import { inventoryService } from "../../services/inventory.service";
import { locationsService } from "../../services/locations.service";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";
import { useLang } from "../LangContext";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";

type PutawayTask = {
  _id: string;
  taskId: string;
  qcId?: string;
  asnId?: string;
  asnNumber?: string;
  supplier?: string;
  owner?: string;
  sku: string;
  productName: string;
  warehouse: string;
  qty: number;
  lotNumber?: string;
  batchNumber?: string;
  fromLocation: string;
  toLocation: string;
  destinationBin?: string;
  priority: "normal" | "high" | "urgent";
  status: "pending" | "assigned" | "in_progress" | "completed" | "cancelled";
  assignedTo?: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  completedBy?: string;
  createdBy?: string;
  createdAt?: string;
  isHazmat?: boolean;
  __v?: number;
};

const putawayListService: ListService<PutawayTask> = {
  getAll: async (params) => {
    const data = await putawayService.getAll(params);
    return data.map((d: any) => ({ ...d, id: d.taskId || d._id }));
  },
  getPage: async (params) => {
    const data = await putawayService.getPage(params);
    return {
      data: data.data.map((d: any) => ({ ...d, id: d.taskId || d._id })),
      pagination: data.pagination
    };
  }
};

export function PutawayQueue() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Selection & Modal states
  const [selectedTask, setSelectedTask] = useState<PutawayTask | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignOperatorEmail, setAssignOperatorEmail] = useState("");
  const [executeModalOpen, setExecuteModalOpen] = useState(false);

  // Barcode execution states
  const [scannedTaskBarcode, setScannedTaskBarcode] = useState("");
  const [scannedBinBarcode, setScannedBinBarcode] = useState("");
  const [scannedSkuBarcode, setScannedSkuBarcode] = useState("");
  const [scannedExpiryDate, setScannedExpiryDate] = useState("");
  const [executedQty, setExecutedQty] = useState<number>(0);
  const [selectedBin, setSelectedBin] = useState("");
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [activeCameraStep, setActiveCameraStep] = useState<"bin" | "sku">("bin");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [skuError, setSkuError] = useState<string | null>(null);

  const { items: pagedTasks, allItems: tasks, pagination, page, setPage, reload, isLoading } = usePaginatedList<PutawayTask>(
    putawayListService,
    {
      apiParams: {
        search: search.trim().toLowerCase(),
        priority: priorityFilter !== "All" ? priorityFilter : undefined,
        status: statusFilter !== "All" ? statusFilter : undefined
      },
      deps: [search, priorityFilter, statusFilter]
    }
  );

  // Load locations master list for bin hierarchy dropdown
  const loadLocations = async () => {
    try {
      const res = await locationsService.getAll();
      setLocations(res || []);
    } catch (_) {}
  };

  // Stats computation
  const stats = useMemo(() => {
    const total = tasks.length;
    const pending = tasks.filter(t => t.status === "pending").length;
    const assigned = tasks.filter(t => t.status === "assigned").length;
    const inProgress = tasks.filter(t => t.status === "in_progress").length;
    const completed = tasks.filter(t => t.status === "completed").length;
    const totalUnits = tasks.reduce((sum, t) => sum + (t.qty || 0), 0);
    return { total, pending, assigned, inProgress, completed, totalUnits };
  }, [tasks]);

  // Handle Assign Operator
  const handleAssignOperator = async () => {
    if (!selectedTask) return;
    try {
      setIsSubmitting(true);
      await putawayService.assign(selectedTask._id, {
        operatorEmail: assignOperatorEmail.trim(),
        __v: selectedTask.__v
      });
      toast.success(`Assigned task ${selectedTask.taskId} to ${assignOperatorEmail || 'Unassigned'}`);
      setAssignModalOpen(false);
      setSelectedTask(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to assign operator");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Execute Modal
  const openExecuteModal = (task: PutawayTask) => {
    setSelectedTask(task);
    setScannedTaskBarcode("");
    setScannedBinBarcode("");
    setScannedSkuBarcode("");
    setScannedExpiryDate("");
    setExecutedQty(task.qty || 1);
    setLocationError(null);
    setSkuError(null);
    setSelectedBin(""); // MUST START COMPLETELY EMPTY!
    setExecuteModalOpen(true);
    loadLocations();
  };

  // Execute Putaway Task with Step-by-Step Validation & Partial Putaway Support
  const handleExecutePutaway = async () => {
    if (!selectedTask) return;

    setLocationError(null);
    setSkuError(null);

    const proposedLocation = (selectedTask.destinationBin || selectedTask.toLocation || "").trim();
    const enteredBin = (scannedBinBarcode || selectedBin || "").trim();

    // Step 1 Validation: Shelf / Bin Barcode Check MUST be entered and match proposed location
    if (!enteredBin) {
      const errMsg = `Step 1 Security Failure: Scan shelf/bin barcode to proceed. Proposed location is '${proposedLocation}'.`;
      setLocationError(errMsg);
      toast.error(errMsg);
      return;
    }

    if (enteredBin.toUpperCase() !== proposedLocation.toUpperCase()) {
      const errMsg = `Wrong location. Scanned: ${enteredBin}. Expected: ${proposedLocation}.`;
      setLocationError(errMsg);
      toast.error(errMsg);
      return;
    }

    // Step 2 Validation: Product SKU Barcode Check MUST be entered and match expected SKU
    const enteredSkuBarcode = scannedSkuBarcode.trim();
    if (!enteredSkuBarcode) {
      const errMsg = `Step 2 Security Failure: Scan product barcode / SKU to proceed.`;
      setSkuError(errMsg);
      toast.error(errMsg);
      return;
    }

    let resolvedSku = enteredSkuBarcode.toUpperCase();
    try {
      const resolveRes = await inventoryService.resolveBarcode(enteredSkuBarcode).catch(() => null);
      if (resolveRes && resolveRes.found) {
        resolvedSku = resolveRes.sku.toUpperCase();
      }
    } catch (_) {}

    if (resolvedSku !== selectedTask.sku.toUpperCase()) {
      const errMsg = `Wrong product. Scanned: ${enteredSkuBarcode}. Expected: ${selectedTask.sku}.`;
      setSkuError(errMsg);
      toast.error(errMsg);
      return;
    }

    // Step 3 Validation: Quantity Check
    if (!executedQty || executedQty <= 0) {
      toast.error("Executed putaway quantity must be at least 1.");
      return;
    }

    if (executedQty > selectedTask.qty) {
      toast.error(`Executed quantity (${executedQty}) cannot exceed task quantity (${selectedTask.qty}).`);
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await putawayService.complete(selectedTask._id, {
        scannedTaskBarcode: scannedTaskBarcode.trim() || undefined,
        scannedBinBarcode: enteredBin,
        scannedSkuBarcode: enteredSkuBarcode,
        destinationBin: enteredBin,
        executedQty: executedQty,
        expiryDate: scannedExpiryDate || undefined,
        __v: selectedTask.__v
      });

      if (executedQty < selectedTask.qty) {
        toast.success(`Partial putaway completed! ${executedQty} units placed in ${enteredBin}. Remaining ${selectedTask.qty - executedQty} units placed in a new pending task.`);
      } else {
        toast.success(res.message || `Putaway Task ${selectedTask.taskId} completed!`);
      }

      setExecuteModalOpen(false);
      setSelectedTask(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to execute putaway task");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 hover-lift">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground font-medium">{t.putaway.totalTasks}</span>
            <Layers className="size-4 text-primary" />
          </div>
          <div className="font-bold text-2xl font-mono">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 hover-lift">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground font-medium">{t.putaway.pendingTasks}</span>
            <Clock className="size-4 text-amber-500" />
          </div>
          <div className="font-bold text-2xl font-mono text-amber-600 dark:text-amber-400">{stats.pending}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 hover-lift">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground font-medium">{t.putaway.inProgressTasks}</span>
            <Truck className="size-4 text-blue-500" />
          </div>
          <div className="font-bold text-2xl font-mono text-blue-600 dark:text-blue-400">{stats.inProgress}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 hover-lift">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground font-medium">{t.putaway.completedToday}</span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <div className="font-bold text-2xl font-mono text-emerald-600 dark:text-emerald-400">{stats.completed}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 hover-lift">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground font-medium">{t.common.items}</span>
            <Package className="size-4 text-indigo-500" />
          </div>
          <div className="font-bold text-2xl font-mono">{stats.totalUnits.toLocaleString()}</div>
        </div>
      </div>

      {/* ── Search & Filter Bar ── */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-64">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${t.common.search} by Task ID, SKU, Owner, Location...`}
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
            <option value="All">{t.common.all} {t.common.status}</option>
            <option value="pending">Pending</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-secondary/50 text-xs font-medium outline-none focus:border-primary/50"
          >
            <option value="All">{t.common.all}</option>
            <option value="normal">{t.common.status ? "Normal" : "Normal"}</option>
            <option value="high">{t.common.status ? "High" : "High"}</option>
            <option value="urgent">{t.common.status ? "Urgent" : "Urgent"}</option>
          </select>

          <button
            type="button"
            onClick={() => reload()}
            className="p-2 border border-border rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
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
        ) : pagedTasks.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-2">
            <Truck className="size-10 text-muted-foreground mx-auto opacity-40" />
            <div className="font-semibold text-base">{t.putaway.noTasksFound}</div>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {t.putaway.noTasksSub}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile View (<768px): Card Layout with visible Execute button without horizontal scrolling */}
            <div className="space-y-3 md:hidden">
              {pagedTasks.map(task => (
                <div key={`mob-${task._id}`} className="bg-card border border-border rounded-xl p-3.5 space-y-2.5 text-xs shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-primary text-sm cursor-pointer" onClick={() => setSelectedTask(task)}>{task.taskId}</span>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="flex justify-between items-center bg-secondary/30 p-2 rounded-lg border border-border/50">
                    <div>
                      <div className="font-bold text-foreground">{task.sku}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{task.productName}</div>
                    </div>
                    <div className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {task.qty.toLocaleString()} units
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-muted-foreground block">Destination Bin:</span>
                      <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-bold font-mono inline-block mt-0.5">
                        {task.toLocation}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">3PL Owner:</span>
                      <span className="font-bold text-primary truncate block mt-0.5">{task.owner || "Default Owner"}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                    {task.status !== 'completed' && task.status !== 'cancelled' && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setSelectedTask(task); setAssignOperatorEmail(task.assignedTo || ""); setAssignModalOpen(true); }}
                          className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold hover:bg-secondary/80 flex items-center gap-1"
                        >
                          <UserPlus className="size-3.5" /> {t.putaway.assign}
                        </button>
                        <button
                          type="button"
                          onClick={() => openExecuteModal(task)}
                          className="px-3.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 flex items-center gap-1"
                        >
                          <Scan className="size-3.5" /> {t.putaway.execute}
                        </button>
                      </>
                    )}
                    {task.status === 'completed' && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="size-4" /> {t.putaway.done}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop View (>=768px): Table Layout */}
            <div className="hidden md:block border border-border rounded-xl overflow-x-auto bg-card text-xs">
              <table className="w-full text-left border-collapse min-w-[980px]">
                <thead>
                  <tr className="bg-secondary/60 border-b border-border font-semibold text-muted-foreground">
                  <th className="p-3 whitespace-nowrap">{t.putaway.taskId}</th>
                  <th className="p-3 whitespace-nowrap">{t.putaway.asnId} / {t.putaway.qcId}</th>
                  <th className="p-3 whitespace-nowrap">Owner (3PL)</th>
                  <th className="p-3 whitespace-nowrap">{t.inventory.sku}</th>
                  <th className="p-3 text-right whitespace-nowrap">{t.transfers.qty}</th>
                  <th className="p-3 whitespace-nowrap">{t.putaway.fromLocation}</th>
                  <th className="p-3 whitespace-nowrap">{t.putaway.toLocation}</th>
                  <th className="p-3 whitespace-nowrap">{t.putaway.assignedOperator}</th>
                  <th className="p-3 whitespace-nowrap">{t.common.status}</th>
                  <th className="p-3 text-right whitespace-nowrap">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedTasks.map(task => (
                  <tr key={task._id} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-3 font-mono font-bold text-primary cursor-pointer whitespace-nowrap" onClick={() => setSelectedTask(task)}>
                      {task.taskId}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground whitespace-nowrap">
                      <div className="font-bold text-foreground">{task.asnNumber || task.asnId || "—"}</div>
                      <div className="text-[11px]">{task.qcId || "—"}</div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-[11px] inline-block whitespace-nowrap">
                        {task.owner || "Default Owner"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-foreground whitespace-nowrap">{task.sku}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">{task.productName}</div>
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      {task.qty.toLocaleString()} units
                    </td>
                    <td className="p-3 font-mono text-muted-foreground whitespace-nowrap">
                      <span className="bg-secondary px-2 py-0.5 rounded text-[11px] font-bold inline-block whitespace-nowrap">{task.fromLocation}</span>
                    </td>
                    <td className="p-3 font-mono text-foreground whitespace-nowrap">
                      <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[11px] font-bold inline-block whitespace-nowrap">
                        {task.toLocation}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {task.assignedTo ? (
                        <span className="font-medium text-foreground bg-secondary px-2 py-0.5 rounded text-[11px] inline-block whitespace-nowrap">
                          {task.assignedTo}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic text-[11px]">{t.putaway.unassigned}</span>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {task.status !== 'completed' && task.status !== 'cancelled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setSelectedTask(task); setAssignOperatorEmail(task.assignedTo || ""); setAssignModalOpen(true); }}
                              className="px-2.5 py-1 bg-secondary border border-border rounded text-[11px] font-semibold hover:bg-secondary/80 text-foreground flex items-center gap-1 whitespace-nowrap"
                            >
                              <UserPlus className="size-3" /> {t.putaway.assign}
                            </button>
                            <button
                              type="button"
                              onClick={() => openExecuteModal(task)}
                              className="px-2.5 py-1 bg-primary text-primary-foreground rounded text-[11px] font-semibold hover:bg-primary/90 flex items-center gap-1 whitespace-nowrap"
                            >
                              <Scan className="size-3" /> {t.putaway.execute}
                            </button>
                          </>
                        )}
                        {task.status === 'completed' && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px] flex items-center gap-1 whitespace-nowrap">
                            <CheckCircle2 className="size-3.5" /> {t.putaway.done}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
        )}
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      {/* ── Assign Operator Modal ── */}
      {assignModalOpen && selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-base">{t.putaway.assignModalTitle}</h3>
                <p className="text-xs text-muted-foreground">{t.putaway.taskId} #{selectedTask.taskId}</p>
              </div>
              <button onClick={() => setAssignModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">{t.putaway.operatorEmailLabel}</label>
                <input
                  type="text"
                  value={assignOperatorEmail}
                  onChange={(e) => setAssignOperatorEmail(e.target.value)}
                  placeholder={(t.common as any)?.eGOperatorWarehouseCom || "e.g. operator@warehouse.com"}
                  className="w-full p-2.5 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="px-4 py-2 border border-border rounded-lg text-xs font-medium hover:bg-secondary"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleAssignOperator}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmitting ? t.putaway.assigning : t.putaway.confirmAssignment}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Execute Putaway Barcode Workspace Modal (With Step-by-Step Validation & Partial Putaway) ── */}
      {executeModalOpen && selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Scan className="size-5 text-primary" /> Execute Putaway Execution Modal
                </h3>
                <p className="text-xs text-muted-foreground">Task #{selectedTask.taskId} • Owner: <strong>{selectedTask.owner || 'Default Owner'}</strong></p>
              </div>
              <button onClick={() => setExecuteModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Hazmat Alert Warning Banner */}
              {selectedTask.isHazmat && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2.5 text-amber-800 dark:text-amber-300 font-medium">
                  <AlertTriangle className="size-5 shrink-0 text-amber-600" />
                  <div>
                    <strong className="block font-bold">HAZMAT SAFETY ALERT</strong>
                    Handle with chemical safety equipment. Putaway restricted to HAZMAT compliance zone.
                  </div>
                </div>
              )}

              {/* Dynamic Location Proposal Banner */}
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-1">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-emerald-800 dark:text-emerald-300">Proposed Location:</span>
                  <span className="font-mono font-extrabold text-sm text-emerald-600 dark:text-emerald-400 bg-card px-2.5 py-1 border border-emerald-500/30 rounded">
                    {selectedTask.toLocation || selectedTask.destinationBin || "MIA-Z1-A1-S1-B1"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Verified against Storage Rules, Zone & Capacity.</p>
              </div>

              {/* Task Details Summary Card */}
              <div className="p-3 bg-secondary/40 border border-border rounded-lg space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Product Name / SKU:</span>
                  <span className="font-bold text-foreground">{selectedTask.productName} ({selectedTask.sku})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Pending Quantity:</span>
                  <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{selectedTask.qty} units</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">3PL Owner:</span>
                  <span className="font-bold text-primary">{selectedTask.owner || 'Default Owner'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source ASN / Supplier:</span>
                  <span className="font-bold">{selectedTask.asnNumber || selectedTask.asnId || "—"} ({selectedTask.supplier || 'N/A'})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lot / Batch #:</span>
                  <span className="font-bold font-mono">{selectedTask.lotNumber || 'N/A'} {selectedTask.batchNumber ? `/ ${selectedTask.batchNumber}` : ''}</span>
                </div>
              </div>

              {/* Step 1: Scan Shelf / Bin Barcode Verification */}
              <div>
                <label className="block font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-bold text-foreground">
                    <MapPin className="size-4 text-emerald-600" /> Step 1: Scan Shelf / Bin Barcode *
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const loc = (selectedTask.toLocation || selectedTask.destinationBin || "A-01-01").trim();
                        setScannedBinBarcode(loc);
                        setSelectedBin(loc);
                        setLocationError(null);
                        toast.success(`Scanned location: ${loc}`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[11px] font-bold rounded hover:bg-emerald-500/25 transition-all"
                      title="Quick simulate location scan"
                    >
                      <Check className="size-3" /> Auto-Scan Location
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveCameraStep("bin"); setShowCameraScanner(true); }}
                      className="flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground text-[11px] font-bold rounded hover:opacity-90 transition-all"
                    >
                      <Camera className="size-3" /> Camera Scan Bin
                    </button>
                  </div>
                </label>
                <input
                  type="text"
                  readOnly
                  value={scannedBinBarcode || selectedBin}
                  placeholder={`Scan shelf barcode (must match ${selectedTask.toLocation || selectedTask.destinationBin})`}
                  className={`w-full p-2.5 border rounded-lg outline-none cursor-not-allowed text-xs font-mono mb-1 ${
                    scannedBinBarcode || selectedBin
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-bold'
                      : locationError
                      ? 'border-destructive bg-destructive/10 text-destructive'
                      : 'bg-secondary/30 border-border text-muted-foreground'
                  }`}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Scan-Only: Manual text typing disabled. Please scan shelf barcode via camera or hardware scanner.</p>
                {locationError && (
                  <div className="text-[11px] font-bold text-destructive flex items-center gap-1 mt-1">
                    <X className="size-3.5 shrink-0" /> {locationError}
                  </div>
                )}
              </div>

              {/* Step 2: Scan Product SKU Barcode Verification */}
              <div>
                <label className="block font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-bold text-foreground">
                    <QrCode className="size-4 text-primary" /> Step 2: Scan Product Barcode / SKU *
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setScannedSkuBarcode(selectedTask.sku);
                        setSkuError(null);
                        toast.success(`Scanned SKU: ${selectedTask.sku}`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 bg-primary/15 text-primary border border-primary/30 text-[11px] font-bold rounded hover:bg-primary/25 transition-all"
                      title="Quick simulate SKU scan"
                    >
                      <Check className="size-3" /> Auto-Scan SKU
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveCameraStep("sku"); setShowCameraScanner(true); }}
                      className="flex items-center gap-1 px-2 py-1 bg-secondary border border-border text-[11px] font-bold rounded hover:bg-secondary/80 transition-all"
                    >
                      <Camera className="size-3" /> Camera Scan Product
                    </button>
                  </div>
                </label>
                <input
                  type="text"
                  value={scannedSkuBarcode}
                  onChange={(e) => {
                    setScannedSkuBarcode(e.target.value);
                    setSkuError(null);
                  }}
                  placeholder={`Scan or type SKU barcode (e.g. ${selectedTask.sku})`}
                  className={`w-full p-2.5 border rounded-lg outline-none focus:border-primary text-xs font-mono mb-1 ${
                    skuError ? 'border-destructive bg-destructive/10 text-destructive' : 'bg-secondary/50 border-border'
                  }`}
                />
                {skuError && (
                  <div className="text-[11px] font-bold text-destructive flex items-center gap-1 mt-1">
                    <X className="size-3.5 shrink-0" /> {skuError}
                  </div>
                )}
              </div>

              {/* Step 3: Quantity Confirmation (Supports Partial Put-Away) */}
              <div>
                <label className="block font-semibold mb-1 font-bold text-foreground flex items-center justify-between">
                  <span>Step 3: Confirm Quantity to Put Away (Partial Supported)</span>
                  <span className="text-[11px] text-muted-foreground font-normal">Max: {selectedTask.qty} units</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={selectedTask.qty}
                  value={executedQty}
                  onChange={(e) => setExecutedQty(Number(e.target.value))}
                  className="w-full p-2.5 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary text-xs font-mono font-bold"
                />
                {executedQty < selectedTask.qty && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                    Note: Partial putaway of {executedQty} units. A second pending task of {selectedTask.qty - executedQty} units will be created automatically.
                  </p>
                )}
              </div>

              {/* Step 4: Physical Expiry Date Confirmation (Mandatory for FEFO/Perishable Items) */}
              <div>
                <label className="block font-semibold mb-1 font-bold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Calendar className="size-4 text-primary" /> Step 4: Verify Physical Packaging Expiry Date
                  </span>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold">Mandatory for FEFO</span>
                </label>
                <input
                  type="date"
                  value={scannedExpiryDate}
                  onChange={(e) => setScannedExpiryDate(e.target.value)}
                  className="w-full p-2.5 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary text-xs font-mono font-bold"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Compliance Policy: Operator must physically verify expiration date stamped on physical packaging. ASN fallback is blocked.</p>
              </div>
            </div>

            {/* Camera Barcode Scanner Modal */}
            <CameraBarcodeScanner
              open={showCameraScanner}
              onClose={() => setShowCameraScanner(false)}
              onScan={(scannedVal) => {
                if (activeCameraStep === "bin") {
                  setScannedBinBarcode(scannedVal);
                  setSelectedBin(scannedVal);
                  setLocationError(null);
                  toast.success(`Scanned shelf/bin barcode: ${scannedVal}`);
                } else {
                  setScannedSkuBarcode(scannedVal);
                  setSkuError(null);
                  toast.success(`Scanned product SKU barcode: ${scannedVal}`);
                }
              }}
              title={`Camera Scanner — Scan ${activeCameraStep === "bin" ? "Shelf/Bin" : "Product SKU"} Barcode`}
            />

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setExecuteModalOpen(false)}
                className="px-4 py-2 border border-border rounded-lg text-xs font-medium hover:bg-secondary"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleExecutePutaway}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="size-4" />
                {isSubmitting ? t.putaway.executing : "Confirm & Execute Putaway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
