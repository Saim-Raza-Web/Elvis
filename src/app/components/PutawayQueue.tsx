import { useState, useMemo } from "react";
import { 
  Truck, Search, Filter, RefreshCw, Layers, ArrowRight, Package, Clock, CheckCircle2,
  Scan, UserPlus, MapPin, Building2, AlertTriangle, ShieldCheck, Check, X, QrCode, Camera
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./AppShell";
import { TablePagination } from "./TablePagination";
import { putawayService } from "../../services/putaway.service";
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
  const [selectedBin, setSelectedBin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);

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
    const assigned = tasks.filter(t => t.status === "assigned" || t.status === "in_progress").length;
    const completed = tasks.filter(t => t.status === "completed").length;
    const totalUnits = tasks.reduce((s, t) => s + (Number(t.qty) || 0), 0);
    return { total, pending, assigned, completed, totalUnits };
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
    setSelectedBin(task.destinationBin || task.toLocation || "");
    setExecuteModalOpen(true);
    loadLocations();
  };

  // Execute Putaway Task
  const handleExecutePutaway = async () => {
    if (!selectedTask) return;

    const targetBin = scannedBinBarcode.trim() || selectedBin.trim() || selectedTask.toLocation;
    if (!targetBin) {
      toast.error(t.common?.error || "Please scan or select a destination bin");
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await putawayService.complete(selectedTask._id, {
        scannedTaskBarcode: scannedTaskBarcode.trim() || undefined,
        scannedBinBarcode: scannedBinBarcode.trim() || undefined,
        destinationBin: targetBin,
        __v: selectedTask.__v
      });
      toast.success(res.message || `Putaway Task ${selectedTask.taskId} completed!`);
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
              placeholder={`${t.common.search} by Task ID, SKU...`}
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
            <option value="pending">{t.status.pending}</option>
            <option value="assigned">{t.status.assigned}</option>
            <option value="in_progress">{t.status.in_progress}</option>
            <option value="completed">{t.status.completed}</option>
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
        ) : pagedTasks.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-2">
            <Truck className="size-10 text-muted-foreground mx-auto opacity-40" />
            <div className="font-semibold text-base">{t.putaway.noTasksFound}</div>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {t.putaway.noTasksSub}
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden bg-card text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/60 border-b border-border font-semibold text-muted-foreground">
                  <th className="p-3">{t.putaway.taskId}</th>
                  <th className="p-3">{t.putaway.asnId} / {t.putaway.qcId}</th>
                  <th className="p-3">{t.inventory.sku}</th>
                  <th className="p-3 text-right">{t.transfers.qty}</th>
                  <th className="p-3">{t.putaway.fromLocation}</th>
                  <th className="p-3">{t.putaway.toLocation}</th>
                  <th className="p-3">{t.putaway.assignedOperator}</th>
                  <th className="p-3">{t.common.status}</th>
                  <th className="p-3 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedTasks.map(task => (
                  <tr key={task._id} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-3 font-mono font-bold text-primary cursor-pointer" onClick={() => setSelectedTask(task)}>
                      {task.taskId}
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">
                      <div className="font-bold text-foreground">{task.asnNumber || task.asnId || "—"}</div>
                      <div className="text-[11px]">{task.qcId || "—"}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-foreground">{task.sku}</div>
                      <div className="text-[11px] text-muted-foreground">{task.productName}</div>
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {task.qty.toLocaleString()} units
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">
                      <span className="bg-secondary px-2 py-0.5 rounded text-[11px] font-bold">{task.fromLocation}</span>
                    </td>
                    <td className="p-3 font-mono text-foreground">
                      <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[11px] font-bold">
                        {task.toLocation}
                      </span>
                    </td>
                    <td className="p-3">
                      {task.assignedTo ? (
                        <span className="font-medium text-foreground bg-secondary px-2 py-0.5 rounded text-[11px]">
                          {task.assignedTo}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic text-[11px]">{t.putaway.unassigned}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {task.status !== 'completed' && task.status !== 'cancelled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setSelectedTask(task); setAssignOperatorEmail(task.assignedTo || ""); setAssignModalOpen(true); }}
                              className="px-2.5 py-1 bg-secondary border border-border rounded text-[11px] font-semibold hover:bg-secondary/80 text-foreground flex items-center gap-1"
                            >
                              <UserPlus className="size-3" /> {t.putaway.assign}
                            </button>
                            <button
                              type="button"
                              onClick={() => openExecuteModal(task)}
                              className="px-2.5 py-1 bg-primary text-primary-foreground rounded text-[11px] font-semibold hover:bg-primary/90 flex items-center gap-1"
                            >
                              <Scan className="size-3" /> {t.putaway.execute}
                            </button>
                          </>
                        )}
                        {task.status === 'completed' && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px] flex items-center gap-1">
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
                  placeholder={t.common?.eGOperatorWarehouseCom || "e.g. operator@warehouse.com"}
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

      {/* ── Execute Putaway Barcode Workspace Modal ── */}
      {executeModalOpen && selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Scan className="size-5 text-primary" /> {t.putaway.executeTaskTitle}
                </h3>
                <p className="text-xs text-muted-foreground">Task #{selectedTask.taskId} • SKU: {selectedTask.sku}</p>
              </div>
              <button onClick={() => setExecuteModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Dynamic Location Proposal Banner */}
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-1">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-emerald-800 dark:text-emerald-300">Dynamically Proposed Location:</span>
                  <span className="font-mono font-extrabold text-sm text-emerald-600 dark:text-emerald-400 bg-card px-2 py-0.5 border border-emerald-500/30 rounded">
                    {selectedTask.toLocation || selectedTask.destinationBin || "MIA-Z1-A1-S1-B1"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Calculated based on Storage Rules, Zone, Temp/Hazmat, Weight & Capacity.</p>
              </div>

              {/* Task Details Banner */}
              <div className="p-3 bg-secondary/40 border border-border rounded-lg space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.common.name}:</span>
                  <span className="font-bold text-foreground">{selectedTask.productName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.putaway.quantityToMove}:</span>
                  <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{selectedTask.qty} units</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.putaway.currentBuffer}:</span>
                  <span className="font-bold font-mono">{selectedTask.fromLocation}</span>
                </div>
              </div>

              {/* Step 1: Scan Task Barcode */}
              <div>
                <label className="block font-semibold mb-1 flex items-center gap-1">
                  <QrCode className="size-4 text-primary" /> {t.putaway.scanTaskOptional}
                </label>
                <input
                  type="text"
                  value={scannedTaskBarcode}
                  onChange={(e) => setScannedTaskBarcode(e.target.value)}
                  placeholder={`Scan or type ${selectedTask.taskId}`}
                  className="w-full p-2.5 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary text-xs font-mono"
                />
              </div>

              {/* Step 2: Scan Shelf / Bin Barcode */}
              <div>
                <label className="block font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <MapPin className="size-4 text-emerald-600" /> Verify Shelf / Bin Barcode
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCameraScanner(true)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-primary text-primary-foreground text-[11px] font-bold rounded hover:opacity-90 transition-all"
                  >
                    <Camera className="size-3" /> Camera Scan Bin
                  </button>
                </label>
                <input
                  type="text"
                  value={scannedBinBarcode || selectedBin}
                  onChange={(e) => { setScannedBinBarcode(e.target.value); setSelectedBin(e.target.value); }}
                  placeholder={`Scan shelf barcode (must match ${selectedTask.toLocation || selectedTask.destinationBin})`}
                  className="w-full p-2.5 bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary text-xs font-mono mb-2"
                />

                {locations.length > 0 && (
                  <div>
                    <span className="text-[11px] text-muted-foreground block mb-1">{t.putaway.selectFromLocMaster}:</span>
                    <select
                      value={selectedBin}
                      onChange={(e) => { setSelectedBin(e.target.value); setScannedBinBarcode(e.target.value); }}
                      className="w-full p-2 bg-secondary/50 border border-border rounded-lg text-xs"
                    >
                      <option value="">{t.putaway.selectDestBinOption}</option>
                      {locations.map((loc) => (
                        <option key={loc._id || loc.code} value={loc.code}>
                          {loc.code} ({loc.zone || "Zone"} - {loc.status || "ACTIVE"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Camera Barcode Scanner Modal */}
            <CameraBarcodeScanner
              open={showCameraScanner}
              onClose={() => setShowCameraScanner(false)}
              onScan={(scannedVal) => {
                setScannedBinBarcode(scannedVal);
                setSelectedBin(scannedVal);
                toast.success(`Scanned shelf/bin barcode: ${scannedVal}`);
              }}
              title={`Scan Shelf/Bin Barcode for Task #${selectedTask.taskId}`}
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
                {isSubmitting ? t.putaway.executing : t.putaway.confirmCompletePutaway}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
