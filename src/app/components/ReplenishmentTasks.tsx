import React, { useState, useEffect } from "react";
import { 
  Package, ArrowRight, CheckCircle2, XCircle, Search, RefreshCw, 
  Clock, User, Calendar, Scan, AlertTriangle, Play, 
  MapPin, Building, Package2
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";
import { useLang } from "../LangContext";
import { replenishmentService } from "../../services/replenishment.service";

type ReplenishmentTask = {
  _id: string;
  taskId: string;
  task_type: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'timed_out';
  priority: number;
  sku_code: string;
  lot_number: string;
  qty: number;
  warehouse: string;
  owner: string;
  ownerType: string;
  source_bin: string;
  destination_bin: string;
  zone?: string;
  completed_by?: string;
  completed_at?: string;
  createdAt: string;
  updatedAt: string;
};

const replenishmentListService: ListService<ReplenishmentTask> = {
  getAll: async (params) => {
    const data = await replenishmentService.getAll(params);
    return data.map((d: any) => ({ ...d, id: d.taskId || d._id }));
  },
  getPage: async (params) => {
    const result = await replenishmentService.getPage(params);
    return { data: result.data.map((d: any) => ({ ...d, id: d.taskId || d._id })), pagination: result.pagination };
  }
};

export function ReplenishmentTasks() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [activeTask, setActiveTask] = useState<ReplenishmentTask | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Scan verification form state
  const [scanForm, setScanForm] = useState({
    sourceBin: "",
    destinationBin: "",
    sku: "",
    qty: ""
  });

  const { items: pagedItems, allItems: items, pagination, page, setPage, reload, isLoading } = usePaginatedList<ReplenishmentTask>(
    replenishmentListService,
    {
      apiParams: {
        search: search.trim().toLowerCase(),
        status: statusFilter !== "All" ? statusFilter : undefined
      },
      deps: [search, statusFilter]
    }
  );

  // Stats computation
  const stats = {
    total: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    inProgress: items.filter(i => i.status === 'in_progress').length,
    completed: items.filter(i => i.status === 'completed').length,
    cancelled: items.filter(i => i.status === 'cancelled').length
  };

  const handleCompleteTask = async () => {
    if (!activeTask) return;

    // Validate scan verification
    const errors: string[] = [];
    
    if (scanForm.sourceBin && scanForm.sourceBin.trim().toUpperCase() !== activeTask.source_bin.trim().toUpperCase()) {
      errors.push(`Invalid source location: expected ${activeTask.source_bin}, got ${scanForm.sourceBin}`);
    }
    
    if (scanForm.destinationBin && scanForm.destinationBin.trim().toUpperCase() !== activeTask.destination_bin.trim().toUpperCase()) {
      errors.push(`Invalid destination location: expected ${activeTask.destination_bin}, got ${scanForm.destinationBin}`);
    }
    
    if (scanForm.sku && scanForm.sku.trim().toUpperCase() !== activeTask.sku_code.trim().toUpperCase()) {
      errors.push(`Invalid SKU: expected ${activeTask.sku_code}, got ${scanForm.sku}`);
    }
    
    if (scanForm.qty && Number(scanForm.qty) !== activeTask.qty) {
      errors.push(`Invalid quantity: expected ${activeTask.qty}, got ${scanForm.qty}`);
    }

    if (errors.length > 0) {
      toast.error(errors.join('; '));
      return;
    }

    try {
      setIsSubmitting(true);
      await replenishmentService.completeReplenishment(activeTask._id, scanForm);
      toast.success(`Replenishment task ${activeTask.taskId} completed successfully`);
      setActiveTask(null);
      setScanForm({ sourceBin: "", destinationBin: "", sku: "", qty: "" });
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to complete replenishment task");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelTask = async (task: ReplenishmentTask) => {
    try {
      await replenishmentService.cancelReplenishment(task._id);
      toast.success(`Replenishment task ${task.taskId} cancelled`);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to cancel task");
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: t.replenishment?.totalTasks || "Total Tasks", value: stats.total, icon: Package, color: "text-foreground" },
          { label: t.common.status || "Pending", value: stats.pending, icon: Clock, color: "text-warning" },
          { label: t.status.in_progress || "In Progress", value: stats.inProgress, icon: Play, color: "text-primary" },
          { label: t.status.completed || "Completed", value: stats.completed, icon: CheckCircle2, color: "text-emerald-600" },
          { label: t.status.cancelled || "Cancelled", value: stats.cancelled, icon: XCircle, color: "text-destructive" },
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

      {/* Controls */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-64">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${t.common.search} by SKU, Task ID...`}
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
            <option value="pending">{t.common.status || "Pending"}</option>
            <option value="in_progress">{t.status.in_progress || "In Progress"}</option>
            <option value="completed">{t.status.completed || "Completed"}</option>
            <option value="cancelled">{t.status.cancelled || "Cancelled"}</option>
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

      {/* Table */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border border-border">
            <RefreshCw className="size-6 animate-spin mx-auto mb-2 text-primary" />
            {t.common.loading}
          </div>
        ) : pagedItems.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border space-y-2">
            <Package className="size-10 text-muted-foreground mx-auto opacity-40" />
            <div className="font-semibold text-base">{t.common.noResults}</div>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No replenishment tasks found
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden bg-card text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/60 border-b border-border font-semibold text-muted-foreground">
                  <th className="p-3">Task ID</th>
                  <th className="p-3">SKU</th>
                  <th className="p-3 text-right">{t.transfers.qty}</th>
                  <th className="p-3">Source → Destination</th>
                  <th className="p-3">Owner</th>
                  <th className="p-3">{t.common.status}</th>
                  <th className="p-3 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedItems.map(item => (
                  <tr key={item._id} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-3 font-mono font-bold text-primary">
                      {item.taskId}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-foreground">{item.sku_code}</div>
                      {item.lot_number && <div className="text-[11px] text-muted-foreground">Lot: {item.lot_number}</div>}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                      {item.qty.toLocaleString()}
                    </td>
                    <td className="p-3 font-mono text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <MapPin className="size-3" />
                        {item.source_bin}
                      </div>
                      <div className="flex items-center gap-1 text-primary">
                        <ArrowRight className="size-3" />
                        {item.destination_bin}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{item.owner}</div>
                      <div className="text-[10px] text-muted-foreground">{item.ownerType}</div>
                    </td>
                    <td className="p-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="p-3 text-right">
                      {item.status === 'pending' || item.status === 'in_progress' ? (
                        <button
                          type="button"
                          onClick={() => setActiveTask(item)}
                          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-all inline-flex items-center gap-1"
                        >
                          <Scan className="size-3" /> Complete
                        </button>
                      ) : item.status === 'completed' ? (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="size-3 text-emerald-600" />
                          {item.completed_by}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{item.status}</span>
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

      {/* Task Completion Modal with Scan Verification */}
      {activeTask && (
        <Modal
          open={true}
          onClose={() => { if (!isSubmitting) setActiveTask(null); }}
          title={`Complete Replenishment: ${activeTask.taskId}`}
          subtitle={`SKU: ${activeTask.sku_code} • Qty: ${activeTask.qty}`}
          footer={
            <div className="flex justify-end gap-2 w-full">
              <ModalCancel onClose={() => setActiveTask(null)} />
              <button
                type="button"
                onClick={handleCompleteTask}
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition-all shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="size-4" /> Complete Task
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Task Details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-secondary/30 p-3.5 rounded-xl border border-border">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Source</span>
                <div className="font-mono font-bold text-foreground mt-0.5">{activeTask.source_bin}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Destination</span>
                <div className="font-mono font-bold text-foreground mt-0.5">{activeTask.destination_bin}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Owner</span>
                <div className="font-bold text-foreground mt-0.5">{activeTask.owner}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold">Warehouse</span>
                <div className="font-bold text-foreground mt-0.5">{activeTask.warehouse}</div>
              </div>
            </div>

            {/* Scan Verification */}
            <div className="bg-secondary/20 p-4 rounded-xl border border-border space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Scan className="size-4" /> Scan Verification (RF-P07)
              </h4>
              
              <Row>
                <Field label="Scan Source Location" hint={`Expected: ${activeTask.source_bin}`}>
                  <Input
                    value={scanForm.sourceBin}
                    onChange={(e) => setScanForm({ ...scanForm, sourceBin: e.target.value })}
                    placeholder="Scan or enter source bin..."
                  />
                </Field>
                <Field label="Scan Destination Location" hint={`Expected: ${activeTask.destination_bin}`}>
                  <Input
                    value={scanForm.destinationBin}
                    onChange={(e) => setScanForm({ ...scanForm, destinationBin: e.target.value })}
                    placeholder="Scan or enter destination bin..."
                  />
                </Field>
              </Row>

              <Row>
                <Field label="Scan SKU" hint={`Expected: ${activeTask.sku_code}`}>
                  <Input
                    value={scanForm.sku}
                    onChange={(e) => setScanForm({ ...scanForm, sku: e.target.value })}
                    placeholder="Scan or enter SKU..."
                  />
                </Field>
                <Field label="Verify Quantity" hint={`Expected: ${activeTask.qty}`}>
                  <Input
                    type="number"
                    value={scanForm.qty}
                    onChange={(e) => setScanForm({ ...scanForm, qty: e.target.value })}
                    placeholder="Enter quantity..."
                  />
                </Field>
              </Row>

              <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="size-4" /> Scan Verification Required
                </div>
                <p>
                  All scans must match task details. Incorrect scans will block completion.
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
