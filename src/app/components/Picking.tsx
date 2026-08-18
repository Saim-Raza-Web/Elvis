import { useState, useMemo, useEffect } from "react";
import { 
  ScanLine, CheckCircle2, Clock, AlertCircle, Package, User, Plus, Search, Filter, 
  Layers, MapPin, QrCode, FileText, Download, AlertTriangle, Check, X, Camera, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, PrimaryButton, SecondaryButton } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { pickingService } from "../../services/picking.service";
import { inventoryService } from "../../services/inventory.service";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";

type PickTaskLine = {
  _id?: string;
  sku: string;
  productName: string;
  orderedQty: number;
  pickedQty: number;
  shortfallQty: number;
  sourceLocation: string;
  status: "pending" | "picked" | "partial" | "shortfall";
};

type PickTask = {
  _id: string;
  id: string;
  taskId: string;
  orderId: string;
  orderNumber?: string;
  orderType?: "B2B" | "B2C";
  owner: string;
  customer?: string;
  warehouse?: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "in_progress" | "partially_picked" | "completed" | "cancelled";
  assignee?: string;
  linesCount?: number;
  totalOrderedQty?: number;
  totalPickedQty?: number;
  totalShortfallQty?: number;
  items: PickTaskLine[];
  deliveryNoteNumber?: string;
  startedAt?: string;
  completedAt?: string;
  completedBy?: string;
};

type PickBatch = {
  _id: string;
  id: string;
  batchId: string;
  owner: string;
  pickTaskIds: string[];
  orders: string[];
  priority: string;
  status: string;
  assignee?: string;
  total_items: number;
  picked_items: number;
  groupedLines?: any[];
};

const batchesListService: ListService<PickBatch> = {
  getAll: async (params) => {
    const data = await pickingService.getBatches(params);
    return data.map((d: any) => ({ ...d, id: d.batchId || d._id }));
  },
  getPage: async (params) => {
    const data = await pickingService.getBatchesPage(params);
    return {
      data: data.data.map((d: any) => ({ ...d, id: d.batchId || d._id })),
      pagination: data.pagination
    };
  }
};

const priorityColor: Record<string, string> = {
  high: "text-destructive bg-destructive/10",
  urgent: "text-destructive bg-destructive/15 font-bold",
  normal: "text-info bg-info/10",
  low: "text-muted-foreground bg-secondary",
};

export function Picking() {
  const { t, lang } = useLang();
  const [tasks, setTasks] = useState<PickTask[]>([]);
  const [view, setView] = useState<"tasks" | "batches">("tasks");
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [scanValue, setScanValue] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ order: "", customer: "", owner: "Apple Distribution 3PL", priority: "normal", sku: "", qty: 1, location: "STAGING-A" });

  // Detail Modal & Execution Modal
  const [selectedTask, setSelectedTask] = useState<PickTask | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [executeModalOpen, setExecuteModalOpen] = useState(false);

  // Execution Step State
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [lineScannedBins, setLineScannedBins] = useState<Record<string, string>>({});
  const [lineScannedBarcodes, setLineScannedBarcodes] = useState<Record<string, string>>({});
  const [scannedBin, setScannedBin] = useState("");
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [enteredQty, setEnteredQty] = useState<number>(0);
  const [linePickedQtys, setLinePickedQtys] = useState<Record<string, number>>({});
  const [locationError, setLocationError] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Batch Multi-Select State
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const { items: pagedBatches, allItems: batches, pagination, page, setPage, reload: reloadBatches } = usePaginatedList<PickBatch>(
    batchesListService,
    { limit: 10 }
  );

  async function loadData() {
    try {
      setIsLoading(true);
      const tasksData = await pickingService.getAll();
      setTasks(tasksData.map((d: any) => ({ ...d, id: d.taskId || d._id, taskId: d.taskId || d._id })));
    } catch (err) {
      toast.error(t.common?.error || "Failed to load pick tasks");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handler = () => { setManualForm({ order: "", customer: "", owner: "Apple Distribution 3PL", priority: "normal", sku: "", qty: 1, location: "STAGING-A" }); setShowManual(true); };
    window.addEventListener("open-new-pick", handler);
    return () => window.removeEventListener("open-new-pick", handler);
  }, []);

  // Compute status counts for clickable counters
  const counts = useMemo(() => {
    const pending = tasks.filter(t => t.status === "pending").length;
    const inProgress = tasks.filter(t => t.status === "in_progress").length;
    const partiallyPicked = tasks.filter(t => t.status === "partially_picked").length;
    const completed = tasks.filter(t => t.status === "completed").length;
    return { pending, inProgress, partiallyPicked, completed, total: tasks.length };
  }, [tasks]);

  // Registered 3PL Owners for filtering
  const uniqueOwners = useMemo(() => {
    const set = new Set(tasks.map(t => t.owner).filter(Boolean));
    return Array.from(set);
  }, [tasks]);

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchSearch = search === "" ||
        t.taskId.toLowerCase().includes(search.toLowerCase()) ||
        t.orderId.toLowerCase().includes(search.toLowerCase()) ||
        (t.customer || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.owner || "").toLowerCase().includes(search.toLowerCase());

      const matchOwner = ownerFilter === "all" || t.owner === ownerFilter;
      const matchStatus = statusFilter === "all" || t.status === statusFilter;

      return matchSearch && matchOwner && matchStatus;
    });
  }, [tasks, search, ownerFilter, statusFilter]);

  // Quick Scan Handler
  async function handleQuickScanSubmit() {
    const val = scanValue.trim();
    if (!val) {
      toast.error("Please enter or scan an Order ID or Pick Task ID.");
      return;
    }

    try {
      const task = await pickingService.lookup(val);
      toast.success(`Found Pick Task ${task.taskId} for Order ${task.orderId}`);
      setScanValue("");
      openExecuteModal(task);
    } catch (err: any) {
      toast.error(err.response?.data?.message || `No Pick Task found for barcode '${val}'.`);
    }
  }

  // Open Execute Modal
  const openExecuteModal = (task: PickTask) => {
    setSelectedTask(task);
    setCurrentLineIndex(0);
    setScannedBin("");
    setScannedBarcode("");
    setLocationError(null);
    setBarcodeError(null);
    setLineScannedBins({});
    setLineScannedBarcodes({});

    const initialQtys: Record<string, number> = {};
    (task.items || []).forEach(item => {
      initialQtys[item.sku] = item.pickedQty || item.orderedQty;
    });
    setLinePickedQtys(initialQtys);
    setEnteredQty((task.items && task.items[0]) ? (task.items[0].orderedQty - (task.items[0].pickedQty || 0)) : 1);
    setExecuteModalOpen(true);
  };

  // Execute Pick Task Completion
  const handleCompletePickExecution = async () => {
    if (!selectedTask) return;

    // Save active line scanned bin if set
    const currentItem = selectedTask.items && selectedTask.items[currentLineIndex];
    const activeBin = scannedBin.trim() || (currentItem ? lineScannedBins[currentItem.sku] || "" : "");

    // Validate location for every line
    for (let idx = 0; idx < (selectedTask.items || []).length; idx++) {
      const line = selectedTask.items[idx];
      const expectedLoc = (line.sourceLocation || 'STAGING-A').trim().toUpperCase();
      const actualLoc = idx === currentLineIndex
        ? activeBin.toUpperCase()
        : (lineScannedBins[line.sku] || "").trim().toUpperCase();

      if (!actualLoc) {
        setCurrentLineIndex(idx);
        setScannedBin("");
        setScannedBarcode(lineScannedBarcodes[line.sku] || "");
        setEnteredQty(linePickedQtys[line.sku] ?? line.orderedQty);
        toast.error(`Line ${idx + 1} (${line.sku}) missing location scan. Expected: ${expectedLoc}`);
        return;
      }

      if (actualLoc !== expectedLoc) {
        setCurrentLineIndex(idx);
        setScannedBin(lineScannedBins[line.sku] || actualLoc);
        setLocationError(`Wrong location. Scanned: ${actualLoc}. Expected: ${expectedLoc}`);
        toast.error(`Line ${idx + 1} (${line.sku}) wrong location. Scanned: ${actualLoc}. Expected: ${expectedLoc}`);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const lineUpdates = (selectedTask.items || []).map(item => ({
        sku: item.sku,
        pickedQty: linePickedQtys[item.sku] !== undefined ? linePickedQtys[item.sku] : item.orderedQty,
        sourceLocation: item.sourceLocation || 'STAGING-A',
        scannedLocation: (lineScannedBins[item.sku] || item.sourceLocation || 'STAGING-A').trim()
      }));

      const result = await pickingService.complete(selectedTask._id, { lineUpdates });
      toast.success(`Pick Task ${selectedTask.taskId} completed! Delivery Note ${result.deliveryNoteNumber} generated.`);
      setExecuteModalOpen(false);
      setSelectedTask(null);
      loadData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to complete Pick Task");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Download PDF Delivery Note
  const handleDownloadPdfFile = async (dnNumber: string) => {
    try {
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const response = await fetch(`/api/v1/documents/dn/${dnNumber}/pdf`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to download PDF from server");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${dnNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`PDF ${dnNumber}.pdf downloaded!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to download Pick Delivery Note PDF");
    }
  };

  // Batch Creation with STRICT OWNER ISOLATION
  const handleCreateBatch = async () => {
    if (selectedTaskIds.length === 0) {
      toast.error("Please select at least one pending Pick Task to create a batch.");
      return;
    }

    const selectedTasks = tasks.filter(t => selectedTaskIds.includes(t._id));
    const owners = Array.from(new Set(selectedTasks.map(t => (t.owner || 'Default Owner').trim())));

    if (owners.length > 1) {
      toast.error(`Owner Isolation Violation: Selected tasks belong to different Owners (${owners.join(', ')}). Batches must contain single-owner tasks.`);
      return;
    }

    try {
      setIsSubmitting(true);
      const batch = await pickingService.createBatch({ pickTaskIds: selectedTaskIds });
      toast.success(`Pick Batch ${batch.batchId} created for Owner '${owners[0]}'!`);
      setSelectedTaskIds([]);
      setView("batches");
      reloadBatches();
      loadData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create Pick Batch");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Manual Task Creation
  async function handleManualPick() {
    if (!manualForm.order) { toast.error("Order ID is required."); return; }
    if (!manualForm.sku) { toast.error("Product SKU is required."); return; }
    try {
      await pickingService.create({
        taskId: `PICK-2026-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
        orderId: manualForm.order,
        orderNumber: manualForm.order,
        orderType: "B2B",
        owner: manualForm.owner,
        customer: manualForm.customer || "B2B Client",
        warehouse: "MIA",
        priority: manualForm.priority,
        status: "pending",
        items: [{
          sku: manualForm.sku.toUpperCase(),
          productName: `Product ${manualForm.sku.toUpperCase()}`,
          orderedQty: manualForm.qty,
          pickedQty: 0,
          shortfallQty: 0,
          sourceLocation: manualForm.location || 'STAGING-A',
          status: 'pending'
        }]
      });
      toast.success(`Pick Task created for Order ${manualForm.order}!`);
      setShowManual(false);
      loadData();
    } catch (err: any) { toast.error("Failed to create pick task"); }
  }

  return (
    <div className="space-y-6">
      {/* ── Interactive Clickable Status KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { id: "pending", label: lang === "es" ? "Tareas Pendientes" : "Pending Tasks", value: counts.pending, icon: Clock, color: "text-warning", badge: "bg-warning/15 text-warning" },
          { id: "in_progress", label: t.status.in_progress || "In Progress", value: counts.inProgress, icon: Package, color: "text-primary", badge: "bg-primary/15 text-primary" },
          { id: "partially_picked", label: lang === "es" ? "Parcialmente Recogido" : "Partially Picked", value: counts.partiallyPicked, icon: AlertTriangle, color: "text-amber-500", badge: "bg-amber-500/15 text-amber-500" },
          { id: "completed", label: lang === "es" ? "Picks Completados" : "Completed Picks", value: counts.completed, icon: CheckCircle2, color: "text-success", badge: "bg-success/15 text-success" },
        ].map((s) => (
          <div
            key={s.id}
            onClick={() => setStatusFilter(statusFilter === s.id ? "all" : s.id)}
            className={`rounded-xl border p-4 cursor-pointer transition-all ${
              statusFilter === s.id ? "border-primary bg-primary/5 ring-1 ring-primary/40 shadow-sm" : "border-border bg-card hover:border-border/80"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="flex items-baseline justify-between">
              <div className="font-bold text-2xl" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.badge}`}>
                {statusFilter === s.id ? (lang === "es" ? "FILTRO ACTIVO" : "ACTIVE FILTER") : (lang === "es" ? "FILTRAR" : "FILTER")}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Top Bar Controls: View Tabs & Quick Scan ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden bg-card p-1">
          <button
            onClick={() => setView("tasks")}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${view === "tasks" ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground"}`}
          >
            {lang === "es" ? "Tareas de Picking" : "Pick Tasks"} ({filteredTasks.length})
          </button>
          <button
            onClick={() => setView("batches")}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${view === "batches" ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground"}`}
          >
            {lang === "es" ? "Lotes de Picking" : "Pick Batches"} ({batches.length})
          </button>
        </div>

        {/* Quick Scan Input */}
        <div className="flex items-center gap-2 flex-1 max-w-md bg-card border border-border p-1.5 rounded-xl">
          <ScanLine className="size-5 text-primary ml-2 shrink-0" />
          <input
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            placeholder={lang === "es" ? "Escaneo rápido de ID de pedido o tarea…" : "Quick Scan Order ID or Pick Task ID…"}
            onKeyDown={(e) => e.key === "Enter" && handleQuickScanSubmit()}
            className="flex-1 bg-transparent text-xs font-mono outline-none px-1"
          />
          <button
            onClick={handleQuickScanSubmit}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90 transition-all"
          >
            {lang === "es" ? "Ejecutar Escaneo" : "Execute Scan"}
          </button>
        </div>

        <div className="flex gap-2">
          {selectedTaskIds.length > 0 && (
            <button
              onClick={handleCreateBatch}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-all"
            >
              <Layers className="size-4" /> {lang === "es" ? "Crear Lote" : "Create Batch"} ({selectedTaskIds.length})
            </button>
          )}
          <PrimaryButton icon={Plus} onClick={() => setShowManual(true)}>
            {lang === "es" ? "Crear tarea de picking" : "Create pick task"}
          </PrimaryButton>
        </div>
      </div>

      {/* ── Filters & Search Toolbar ── */}
      {view === "tasks" && (
        <div className="flex items-center gap-3 flex-wrap bg-card p-3 rounded-xl border border-border">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "es" ? "Buscar ID de tarea, pedido, cliente o propietario…" : "Search Task ID, Order ID, Customer or Owner…"}
              className="w-full pl-9 pr-4 py-1.5 bg-secondary/50 border border-border rounded-lg outline-none text-xs focus:border-primary/50"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Filter className="size-3.5 text-muted-foreground" />
            <span className="font-bold text-muted-foreground">{lang === "es" ? "Propietario 3PL:" : "3PL Owner:"}</span>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-secondary/50 border border-border rounded-lg text-xs font-medium outline-none"
            >
              <option value="all">{lang === "es" ? "Todos los propietarios" : "All Owners"}</option>
              {uniqueOwners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-muted-foreground">{lang === "es" ? "Estado:" : "Status:"}</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-secondary/50 border border-border rounded-lg text-xs font-medium outline-none"
            >
              <option value="all">{lang === "es" ? "Todos los estados" : "All Statuses"}</option>
              <option value="pending">{t.status.pending}</option>
              <option value="in_progress">{t.status.in_progress}</option>
              <option value="partially_picked">{lang === "es" ? "Parcialmente Recogido" : "Partially Picked"}</option>
              <option value="completed">{t.status.completed}</option>
            </select>
          </div>

          <button onClick={() => loadData()} className="p-2 border border-border rounded-lg text-muted-foreground hover:bg-secondary">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      )}

      {/* ── View 1: Pick Tasks List ── */}
      {view === "tasks" ? (
        <div className="border border-border rounded-xl overflow-x-auto bg-card text-xs">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="bg-secondary/60 border-b border-border font-semibold text-muted-foreground">
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.length > 0 && selectedTaskIds.length === filteredTasks.filter(t => t.status === "pending").length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTaskIds(filteredTasks.filter(t => t.status === "pending").map(t => t._id));
                      } else {
                        setSelectedTaskIds([]);
                      }
                    }}
                  />
                </th>
                <th className="p-3 whitespace-nowrap">{lang === "es" ? "ID Tarea" : "Task ID"}</th>
                <th className="p-3 whitespace-nowrap">{lang === "es" ? "Cliente 3PL" : "Owner (3PL Client)"}</th>
                <th className="p-3 whitespace-nowrap">{lang === "es" ? "Ref Pedido" : "Order Ref"}</th>
                <th className="p-3 text-center whitespace-nowrap">{lang === "es" ? "Nº Líneas" : "Lines Count"}</th>
                <th className="p-3 whitespace-nowrap">{lang === "es" ? "Prioridad" : "Priority"}</th>
                <th className="p-3 whitespace-nowrap">{lang === "es" ? "Asignado" : "Assignee"}</th>
                <th className="p-3 whitespace-nowrap">{lang === "es" ? "Estado" : "Status"}</th>
                <th className="p-3 text-right whitespace-nowrap">{lang === "es" ? "Acciones" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground"><RefreshCw className="size-6 animate-spin mx-auto mb-2 text-primary" />Loading pick tasks...</td></tr>
              ) : filteredTasks.length === 0 ? (
                <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">No pick tasks match the selected filters.</td></tr>
              ) : (
                filteredTasks.map((task) => (
                  <tr key={task._id} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-3">
                      {task.status === "pending" && (
                        <input
                          type="checkbox"
                          checked={selectedTaskIds.includes(task._id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTaskIds(prev => [...prev, task._id]);
                            } else {
                              setSelectedTaskIds(prev => prev.filter(id => id !== task._id));
                            }
                          }}
                        />
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-primary cursor-pointer whitespace-nowrap" onClick={() => { setSelectedTask(task); setDetailModalOpen(true); }}>
                      {task.taskId}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-[11px]">
                        {task.owner || "Default Owner"}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div className="font-bold font-mono text-foreground">{task.orderId}</div>
                      <div className="text-[11px] text-muted-foreground">{task.customer || "B2B Client"}</div>
                    </td>
                    <td className="p-3 text-center font-mono font-bold whitespace-nowrap">
                      {task.items ? task.items.length : (task.linesCount || 1)} lines
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${priorityColor[task.priority]}`}>{task.priority}</span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="text-muted-foreground">{task.assignee || "Unassigned"}</span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => { setSelectedTask(task); setDetailModalOpen(true); }}
                          className="p-1.5 bg-secondary border border-border rounded text-muted-foreground hover:text-foreground"
                          title="View Task Details"
                        >
                          <FileText className="size-3.5" />
                        </button>
                        {task.status !== "completed" && (
                          <button
                            onClick={() => openExecuteModal(task)}
                            className="px-2.5 py-1 bg-primary text-primary-foreground rounded text-[11px] font-bold hover:opacity-90 flex items-center gap-1"
                          >
                            <ScanLine className="size-3" /> Execute Pick
                          </button>
                        )}
                        {task.deliveryNoteNumber && (
                          <button
                            onClick={() => handleDownloadPdfFile(task.deliveryNoteNumber!)}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded text-[11px] font-bold hover:bg-emerald-700 flex items-center gap-1"
                            title={`Download Delivery Note ${task.deliveryNoteNumber}`}
                          >
                            <Download className="size-3" /> Delivery Note
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── View 2: Pick Batches (Owner Isolated) ── */
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pagedBatches.map((batch, i) => (
              <div key={batch.id} className="bg-card border border-border rounded-xl p-5 hover-lift shadow-sm">
                <div className="flex items-start justify-between mb-3 border-b border-border pb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-base font-mono text-primary">{batch.batchId}</span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Owner: <strong className="text-primary font-bold">{batch.owner || "Default Owner"}</strong> · {batch.orders?.length || 0} Orders Included
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${priorityColor[batch.priority || "normal"]}`}>{batch.priority}</span>
                </div>

                <div className="space-y-2 mb-4">
                  <span className="font-bold text-xs text-muted-foreground uppercase tracking-wider block">Grouped Warehouse Picking Lines:</span>
                  {(batch.groupedLines || []).slice(0, 3).map((grp, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-secondary/40 p-2 rounded-lg text-xs font-mono">
                      <div>
                        <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded mr-2">{grp.sourceLocation}</span>
                        <strong className="text-foreground">{grp.sku}</strong> ({grp.productName})
                      </div>
                      <span className="font-bold text-primary">{grp.totalQtyToPick} units</span>
                    </div>
                  ))}
                  {(batch.groupedLines || []).length > 3 && (
                    <div className="text-[11px] text-muted-foreground italic text-right">+ {(batch.groupedLines || []).length - 3} more picking locations</div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button className="px-3.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-1">
                    <ScanLine className="size-3.5" /> Execute Batch Pick
                  </button>
                </div>
              </div>
            ))}
            {batches.length === 0 && <div className="col-span-full border-2 border-dashed border-border rounded-xl p-12 text-center text-xs text-muted-foreground">No pick batches created yet. Select pending tasks above to group into a batch.</div>}
          </div>
          <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
        </div>
      )}

      {/* ── Task Detail Modal ── */}
      {detailModalOpen && selectedTask && (
        <Modal open={detailModalOpen} onClose={() => setDetailModalOpen(false)} title={`Pick Task Details (${selectedTask.taskId})`} width="lg">
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 bg-secondary/30 p-3 rounded-xl border border-border">
              <div><span className="text-muted-foreground block">Order Reference:</span><strong className="font-mono text-sm text-foreground">{selectedTask.orderId}</strong></div>
              <div><span className="text-muted-foreground block">3PL Owner Client:</span><strong className="text-primary font-bold">{selectedTask.owner}</strong></div>
              <div><span className="text-muted-foreground block">Customer / Buyer:</span><strong>{selectedTask.customer || 'B2B Client'}</strong></div>
              <div><span className="text-muted-foreground block">Task Status:</span><StatusBadge status={selectedTask.status} /></div>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold uppercase tracking-wider text-muted-foreground text-[11px]">Order Line Items & Source Locations:</h4>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/60 text-muted-foreground">
                    <tr>
                      <th className="p-2">SKU</th>
                      <th className="p-2">Product Name</th>
                      <th className="p-2 text-right">Ordered Qty</th>
                      <th className="p-2 text-right">Picked Qty</th>
                      <th className="p-2">Source Location</th>
                      <th className="p-2">Line Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {(selectedTask.items || []).map((line, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold text-foreground">{line.sku}</td>
                        <td className="p-2 font-sans">{line.productName}</td>
                        <td className="p-2 text-right font-bold">{line.orderedQty}</td>
                        <td className="p-2 text-right font-bold text-emerald-600">{line.pickedQty || 0}</td>
                        <td className="p-2"><span className="bg-secondary px-1.5 py-0.5 rounded">{line.sourceLocation || 'STAGING-A'}</span></td>
                        <td className="p-2"><StatusBadge status={line.status || 'pending'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedTask.deliveryNoteNumber && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-bold text-emerald-800 dark:text-emerald-300 block">Outbound Delivery Note Generated</span>
                  <span className="font-mono text-xs text-muted-foreground">{selectedTask.deliveryNoteNumber}</span>
                </div>
                <button
                  onClick={() => handleDownloadPdfFile(selectedTask.deliveryNoteNumber!)}
                  className="px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg font-bold flex items-center gap-1"
                >
                  <Download className="size-3.5" /> Download PDF
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── 3-Step Warehouse Pick Execution Modal ── */}
      {executeModalOpen && selectedTask && (
        <Modal
          open={executeModalOpen}
          onClose={() => setExecuteModalOpen(false)}
          title={`Execute B2B Pick Task (${selectedTask.taskId})`}
          subtitle={`Owner: ${selectedTask.owner} · Order: ${selectedTask.orderId}`}
          width="lg"
          footer={
            <div className="flex items-center justify-between w-full">
              <div className="text-xs font-mono font-bold text-muted-foreground">
                Line {currentLineIndex + 1} of {(selectedTask.items || []).length}
              </div>
              <div className="flex gap-2">
                <ModalCancel onClose={() => setExecuteModalOpen(false)} />
                <ModalSubmit onClick={handleCompletePickExecution} disabled={isSubmitting}>
                  {isSubmitting ? "Completing Pick..." : "Confirm & Complete Pick Task"}
                </ModalSubmit>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Progress Bar */}
            <div className="p-3 bg-secondary/40 border border-border rounded-xl space-y-1.5">
              <div className="flex justify-between font-bold text-xs">
                <span>Picking Progress</span>
                <span className="font-mono">{currentLineIndex + 1} / {(selectedTask.items || []).length} Lines</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(((currentLineIndex + 1) / Math.max(1, (selectedTask.items || []).length))) * 100}%` }}
                />
              </div>
            </div>

            {/* Current Order Line Execution Block */}
            {selectedTask.items && selectedTask.items[currentLineIndex] && (
              <div className="p-4 bg-card border border-primary/40 rounded-xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Target Product SKU:</span>
                    <h3 className="font-bold text-base text-foreground font-mono">{selectedTask.items[currentLineIndex].sku}</h3>
                    <p className="text-xs text-muted-foreground">{selectedTask.items[currentLineIndex].productName}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Ordered Quantity:</span>
                    <span className="font-bold text-lg font-mono text-primary">{selectedTask.items[currentLineIndex].orderedQty} units</span>
                  </div>
                </div>

                {/* Step 1: Scan Source Bin Barcode */}
                <div>
                  <label className="block font-bold mb-1 flex justify-between items-center">
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <MapPin className="size-4" /> STEP 1: Scan Source Bin Barcode *
                    </span>
                    <span className="font-mono bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                      Expected Bin: {selectedTask.items[currentLineIndex].sourceLocation || 'STAGING-A'}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={scannedBin}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScannedBin(val);
                      const curSku = selectedTask.items[currentLineIndex].sku;
                      setLineScannedBins(prev => ({ ...prev, [curSku]: val }));
                      const expected = (selectedTask.items[currentLineIndex].sourceLocation || 'STAGING-A').toUpperCase();
                      if (val.trim() && val.trim().toUpperCase() !== expected) {
                        setLocationError(`Wrong location. Scanned: ${val.trim()}. Expected: ${expected}.`);
                      } else {
                        setLocationError(null);
                      }
                    }}
                    placeholder={`Scan bin barcode (must match ${selectedTask.items[currentLineIndex].sourceLocation || 'STAGING-A'})`}
                    className={`w-full p-2.5 border rounded-lg outline-none font-mono text-xs ${
                      locationError ? 'border-destructive bg-destructive/10 text-destructive' : 'bg-secondary/50 border-border'
                    }`}
                  />
                  {locationError && <div className="text-[11px] font-bold text-destructive mt-1 flex items-center gap-1"><X className="size-3.5" /> {locationError}</div>}
                </div>

                {/* Step 2: Scan Product Barcode / SKU */}
                <div>
                  <label className="block font-bold mb-1 text-primary flex items-center gap-1">
                    <QrCode className="size-4" /> STEP 2: Scan Product Barcode / SKU *
                  </label>
                  <input
                    type="text"
                    value={scannedBarcode}
                    onChange={async (e) => {
                      const val = e.target.value;
                      setScannedBarcode(val);
                      const curSku = selectedTask.items[currentLineIndex].sku;
                      setLineScannedBarcodes(prev => ({ ...prev, [curSku]: val }));
                      if (!val.trim()) { setBarcodeError(null); return; }

                      const resolveRes = await inventoryService.resolveBarcode(val.trim()).catch(() => null);
                      const targetSku = selectedTask.items[currentLineIndex].sku.toUpperCase();

                      if (!resolveRes || !resolveRes.found || resolveRes.sku.toUpperCase() !== targetSku) {
                        setBarcodeError(`Wrong product scanned: ${val.trim()}. Expected SKU: ${targetSku}.`);
                      } else {
                        setBarcodeError(null);
                        toast.success(`Verified Product SKU: ${targetSku}!`);
                      }
                    }}
                    placeholder={`Scan product barcode or unit/case EAN...`}
                    className={`w-full p-2.5 border rounded-lg outline-none font-mono text-xs ${
                      barcodeError ? 'border-destructive bg-destructive/10 text-destructive' : 'bg-secondary/50 border-border'
                    }`}
                  />
                  {barcodeError && <div className="text-[11px] font-bold text-destructive mt-1 flex items-center gap-1"><X className="size-3.5" /> {barcodeError}</div>}
                </div>

                {/* Step 3: Confirm Picked Quantity */}
                <div>
                  <label className="block font-bold mb-1 text-foreground">
                    STEP 3: Confirm Picked Quantity (Shortfall will be recorded if partial)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max={selectedTask.items[currentLineIndex].orderedQty}
                      value={enteredQty}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value));
                        setEnteredQty(val);
                        const curSku = selectedTask.items[currentLineIndex].sku;
                        setLinePickedQtys(prev => ({ ...prev, [curSku]: val }));
                      }}
                      className="w-32 p-2.5 border border-border bg-card rounded-lg font-mono font-bold text-sm"
                    />
                    <div className="text-xs text-muted-foreground">
                      {enteredQty < selectedTask.items[currentLineIndex].orderedQty ? (
                        <span className="text-amber-500 font-bold flex items-center gap-1">
                          <AlertTriangle className="size-3.5" /> Shortfall of {selectedTask.items[currentLineIndex].orderedQty - enteredQty} units recorded.
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-bold flex items-center gap-1">
                          <Check className="size-3.5" /> Full quantity picked.
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Line Switcher Buttons */}
                <div className="flex justify-between pt-2 border-t border-border">
                  <button
                    disabled={currentLineIndex === 0}
                    onClick={() => {
                      const prevIdx = currentLineIndex - 1;
                      setCurrentLineIndex(prevIdx);
                      const prevSku = selectedTask.items[prevIdx].sku;
                      setEnteredQty(linePickedQtys[prevSku] ?? selectedTask.items[prevIdx].orderedQty);
                      setScannedBin(lineScannedBins[prevSku] || "");
                      setScannedBarcode(lineScannedBarcodes[prevSku] || "");
                      setLocationError(null);
                      setBarcodeError(null);
                    }}
                    className="px-3 py-1.5 border border-border rounded-lg font-bold disabled:opacity-40"
                  >
                    ← Previous Line
                  </button>
                  <button
                    disabled={currentLineIndex >= selectedTask.items.length - 1}
                    onClick={() => {
                      const nextIdx = currentLineIndex + 1;
                      setCurrentLineIndex(nextIdx);
                      const nextSku = selectedTask.items[nextIdx].sku;
                      setEnteredQty(linePickedQtys[nextSku] ?? selectedTask.items[nextIdx].orderedQty);
                      setScannedBin(lineScannedBins[nextSku] || "");
                      setScannedBarcode(lineScannedBarcodes[nextSku] || "");
                      setLocationError(null);
                      setBarcodeError(null);
                    }}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-bold disabled:opacity-40"
                  >
                    Next Line →
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Manual Pick Modal (Button label: Create pick task) ── */}
      <Modal
        open={showManual}
        onClose={() => setShowManual(false)}
        title="Create New B2B Pick Task"
        subtitle="Manually create a pick task for an order"
        footer={<><ModalCancel onClose={() => setShowManual(false)} /><ModalSubmit onClick={handleManualPick}>Create pick task</ModalSubmit></>}
      >
        <Row>
          <Field label="Order ID *" required><Input value={manualForm.order} onChange={(e) => setManualForm({ ...manualForm, order: e.target.value.toUpperCase() })} placeholder="ORD-2026-001" /></Field>
          <Field label="3PL Owner *"><Select value={manualForm.owner} onChange={(e) => setManualForm({ ...manualForm, owner: e.target.value })}>
            <option value="Apple Distribution 3PL">Apple Distribution 3PL</option>
            <option value="Acme Logistics 3PL">Acme Logistics 3PL</option>
            <option value="Global Retail Corp">Global Retail Corp</option>
          </Select></Field>
        </Row>
        <Row>
          <Field label="Customer Name"><Input value={manualForm.customer} onChange={(e) => setManualForm({ ...manualForm, customer: e.target.value })} placeholder="Client Co" /></Field>
          <Field label="Priority"><Select value={manualForm.priority} onChange={(e) => setManualForm({ ...manualForm, priority: e.target.value })}>
            <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
          </Select></Field>
        </Row>
        <Row>
          <Field label="Product SKU *" required><Input value={manualForm.sku} onChange={(e) => setManualForm({ ...manualForm, sku: e.target.value.toUpperCase() })} placeholder="SKU-XXXX" /></Field>
          <Field label="Quantity *"><Input type="number" min="1" value={manualForm.qty} onChange={(e) => setManualForm({ ...manualForm, qty: Math.max(1, Number(e.target.value)) })} /></Field>
        </Row>
      </Modal>
    </div>
  );
}
