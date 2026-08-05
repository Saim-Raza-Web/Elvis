import { useState, useEffect, useMemo } from "react";
import { ClipboardList, Search, Plus, Play, CheckCircle2, AlertTriangle, Boxes, ScanLine, XCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { stockCountsService } from "../../services/stock_counts.service";
import { warehousesService } from "../../services/warehouses.service";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";

const stockCountsListService: ListService<StockCount> = {
  getAll: async (params) => (await stockCountsService.getAll(params)) as StockCount[],
  getPage: async (params) => {
    const res = await stockCountsService.getPage(params);
    return { data: res.data as StockCount[], pagination: res.pagination };
  },
};

type StockCountItem = {
  sku: string;
  expected_qty: number;
  counted_qty: number;
  discrepancy: number;
  status: "pending" | "counted" | "discrepancy" | "resolved";
  notes: string;
};

type StockCount = {
  _id: string;
  countId: string;
  type: "full" | "cycle" | "spot";
  status: "scheduled" | "in_progress" | "review" | "completed" | "cancelled";
  warehouse: string;
  assigned_to: string;
  scheduled_date: string;
  completed_date?: string;
  items: StockCountItem[];
  total_discrepancy_items: number;
  total_discrepancy_value: number;
  notes: string;
};

const blankCount = (): Omit<StockCount, "_id" | "countId" | "status" | "items" | "total_discrepancy_items" | "total_discrepancy_value"> => ({
  type: "cycle",
  warehouse: "MIA",
  assigned_to: "Admin",
  scheduled_date: new Date().toISOString().slice(0, 10),
  notes: "",
});

export function StockCount() {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankCount());
  
  const [activeSession, setActiveSession] = useState<StockCount | null>(null);
  const [scanSku, setScanSku] = useState("");
  const [scanQty, setScanQty] = useState(1);

  const { items: pagedCounts, allItems: counts, pagination, page, setPage, isLoading, reload } = usePaginatedList<StockCount>(
    stockCountsListService,
    {
      apiParams: { search: search.toLowerCase() },
      deps: [search],
    }
  );

  async function loadData() {
    try {
      const whs = await warehousesService.getAll();
      setWarehouses(whs);
    } catch (err) {
      toast.error(t.common?.error || "Failed to load warehouses");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate() {
    try {
      await stockCountsService.create(form);
      toast.success(t.common?.operationSuccess || "Stock count session created");
      setShowAdd(false);
      setForm(blankCount());
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create count");
    }
  }

  async function handleStartCount(id: string) {
    try {
      await stockCountsService.update(id, { status: "in_progress" });
      toast.success(t.common?.operationSuccess || "Count session started");
      loadData();
    } catch (err) {
      toast.error(t.common?.error || "Failed to start count");
    }
  }

  async function handleCompleteCount(id: string) {
    try {
      await stockCountsService.update(id, { status: "review" });
      toast.success(t.common?.operationSuccess || "Count session submitted for review");
      setActiveSession(null);
      loadData();
    } catch (err) {
      toast.error(t.common?.error || "Failed to submit count");
    }
  }

  async function handleResolveCount(id: string) {
    try {
      await stockCountsService.update(id, { status: "completed" });
      toast.success(t.common?.operationSuccess || "Count session resolved and completed");
      loadData();
    } catch (err) {
      toast.error(t.common?.error || "Failed to resolve count");
    }
  }

  async function handleScan() {
    if (!activeSession) return;
    if (!scanSku.trim()) { toast.error(t.common?.error || "Please enter a SKU"); return; }

    const updatedItems = activeSession.items.map(item => {
      if (item.sku.toLowerCase() === scanSku.trim().toLowerCase()) {
        const newQty = item.counted_qty + scanQty;
        const diff = newQty - item.expected_qty;
        return {
          ...item,
          counted_qty: newQty,
          discrepancy: diff,
          status: diff === 0 ? "counted" : "discrepancy"
        };
      }
      return item;
    });

    try {
      await stockCountsService.update(activeSession._id, { items: updatedItems });
      toast.success(`Counted ${scanQty}x ${scanSku}`);
      setScanSku("");
      setScanQty(1);
      
      // Update local state immediately for fast scanning
      setActiveSession({ ...activeSession, items: updatedItems as any });
      
    } catch (err) {
      toast.error(t.common?.error || "Failed to record scan");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Sessions", value: counts.length, icon: ClipboardList, color: "text-primary" },
          { label: "In Progress", value: counts.filter(c => c.status === "in_progress").length, icon: Play, color: "text-blue-500" },
          { label: "Needs Review", value: counts.filter(c => c.status === "review").length, icon: AlertTriangle, color: "text-warning" },
          { label: "Completed", value: counts.filter(c => c.status === "completed").length, icon: CheckCircle2, color: "text-success" },
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

      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t.common?.search || "Search"}  counts…`}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors"
            style={{ fontSize: "0.875rem" }}
          />
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>New Count</PrimaryButton>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">Session ID</th>
              <th className="text-left px-4 py-3">{t.common?.type || "Type"}</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Warehouse</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">Assigned To</th>
              <th className="text-center px-4 py-3">Items</th>
              <th className="text-right px-4 py-3 hidden lg:table-cell">Discrepancy</th>
              <th className="text-center px-4 py-3">{t.common?.status || "Status"}</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {pagedCounts.map((c, i) => (
              <tr key={c._id} className={`border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up ${activeSession?._id === c._id ? 'bg-primary/5' : ''}`} style={{ animationDelay: `${i * 30}ms` }}>
                <td className="px-4 py-3 font-medium text-primary" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.875rem" }}>{c.countId}</td>
                <td className="px-4 py-3 uppercase text-xs">{c.type}</td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">{c.warehouse}</td>
                <td className="px-4 py-3 hidden sm:table-cell font-medium">{c.assigned_to}</td>
                <td className="px-4 py-3 text-center">{c.items.length}</td>
                <td className="px-4 py-3 text-right hidden lg:table-cell">
                  {c.total_discrepancy_items > 0 ? (
                    <span className="text-destructive font-bold">{c.total_discrepancy_items} items</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-right">
                  {c.status === "scheduled" && (
                    <PrimaryButton onClick={() => handleStartCount(c._id)} icon={Play}>Start</PrimaryButton>
                  )}
                  {c.status === "in_progress" && activeSession?._id !== c._id && (
                    <PrimaryButton onClick={() => setActiveSession(c)} icon={ScanLine}>Resume</PrimaryButton>
                  )}
                  {c.status === "in_progress" && activeSession?._id === c._id && (
                    <button onClick={() => setActiveSession(null)} className="px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-secondary">{t.common?.close || "Close"}</button>
                  )}
                  {c.status === "review" && (
                    <PrimaryButton onClick={() => handleResolveCount(c._id)} icon={CheckCircle2}>Resolve</PrimaryButton>
                  )}
                </td>
              </tr>
            ))}
            {pagedCounts.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No stock counts found</td></tr>
            )}
          </tbody>
        </table>
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      {activeSession && (
        <div className="rounded-xl border-2 border-primary/30 bg-card overflow-hidden shadow-xl animate-fade-in-up mt-6">
          <div className="bg-primary/10 p-4 border-b border-primary/20 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary text-primary-foreground rounded-lg"><ScanLine className="size-5" /></div>
              <div>
                <h3 className="font-bold">Active Scan Session: {activeSession.countId}</h3>
                <p className="text-xs text-muted-foreground">{activeSession.type.toUpperCase()} Count · {activeSession.warehouse}</p>
              </div>
            </div>
            <PrimaryButton onClick={() => handleCompleteCount(activeSession._id)} icon={CheckCircle2}>Complete & Submit</PrimaryButton>
          </div>
          
          <div className="p-6 border-b border-border bg-secondary/10 flex items-end gap-3">
            <Field label={t.common?.scanBarcodeSKU || "Scan Barcode / SKU"} required className="flex-1">
              <Input value={scanSku} onChange={(e) => setScanSku(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} placeholder={t.common?.scanHere || "Scan here..."} autoFocus />
            </Field>
            <Field label={t.common?.qty || "Qty"} required className="w-24">
              <Input type="number" value={scanQty} onChange={(e) => setScanQty(Number(e.target.value))} />
            </Field>
            <PrimaryButton onClick={handleScan} className="mb-1" icon={ArrowRight}>Record</PrimaryButton>
          </div>

          <div className="p-0 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-center px-4 py-2">Expected</th>
                  <th className="text-center px-4 py-2">Counted</th>
                  <th className="text-center px-4 py-2">Variance</th>
                  <th className="text-center px-4 py-2">{t.common?.status || "Status"}</th>
                </tr>
              </thead>
              <tbody>
                {activeSession.items.map((item, i) => (
                  <tr key={i} className={`border-t border-border ${item.status === 'discrepancy' ? 'bg-destructive/5' : item.status === 'counted' ? 'bg-success/5' : ''}`}>
                    <td className="px-4 py-2 font-medium" style={{ fontFamily: "JetBrains Mono, monospace" }}>{item.sku}</td>
                    <td className="px-4 py-2 text-center text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{item.expected_qty}</td>
                    <td className="px-4 py-2 text-center font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{item.counted_qty}</td>
                    <td className="px-4 py-2 text-center" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                      {item.discrepancy !== 0 && (
                        <span className={item.discrepancy < 0 ? "text-destructive" : "text-primary"}>
                          {item.discrepancy > 0 ? "+" : ""}{item.discrepancy}
                        </span>
                      )}
                      {item.discrepancy === 0 && item.status === 'counted' && <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {item.status === 'pending' && <span className="text-xs text-muted-foreground">Pending</span>}
                      {item.status === 'counted' && <CheckCircle2 className="size-4 text-success mx-auto" />}
                      {item.status === 'discrepancy' && <AlertTriangle className="size-4 text-destructive mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.common?.scheduleStockCount || "Schedule Stock Count"} subtitle={t.common?.createANewPhysicalInventorySession || "Create a new physical inventory session"} footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>Schedule Session</ModalSubmit></>}>
        <Row>
          <Field label={t.common?.countType || "Count Type"}>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
              <option value="cycle">{t.common?.cycleCount || "Cycle Count"}</option>
              <option value="spot">{t.common?.spotCheck || "Spot Check"}</option>
              <option value="full">{t.common?.fullInventory || "Full Inventory"}</option>
            </Select>
          </Field>
          <Field label={t.common?.warehouse || "Warehouse"}>
            <Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
              {warehouses.map(w => <option key={w.code} value={w.code}>{w.code}</option>)}
              {warehouses.length === 0 && <option value="MIA">{t.common?.mIA || "MIA"}</option>}
            </Select>
          </Field>
        </Row>
        <Row>
          <Field label={t.common?.assignTo || "Assign To"} required>
            <Input value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} placeholder={t.common?.workerName || "Worker name"} />
          </Field>
          <Field label={t.common?.date || "Date"} required>
            <Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
          </Field>
        </Row>
        <Field label={t.common?.notesInstructions || "Notes / Instructions"}>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t.common?.focusOnElectronicsAisle || "Focus on electronics aisle..."} />
        </Field>
      </Modal>
    </div>
  );
}
