import { useState } from "react";
import { ScanLine, CheckCircle2, Clock, AlertCircle, Package, User, Plus } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { pickingService } from "../../services/picking.service";

type PickTask = { _id: string; id: string; order: string; priority: string; status: string; assignee: string; items: number; picked: number; zone: string; started: string; taskId?: string };

const priorityColor: Record<string, string> = {
  high: "text-destructive bg-destructive/10",
  normal: "text-info bg-info/10",
  low: "text-muted-foreground bg-secondary",
};

export function Picking() {
  const { t } = useLang();
  const [tasks, setTasks] = useState<PickTask[]>([]);
  const [view, setView] = useState<"board" | "list">("board");
  const [scanValue, setScanValue] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ order: "", zone: "", assignee: "", priority: "normal", items: 1 });

  const pending = tasks.filter((task) => task.status === "pending");
  const inProgress = tasks.filter((task) => task.status === "in_progress");
  const completed = tasks.filter((task) => task.status === "completed");

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const data = await pickingService.getAll();
      setTasks(data.map((d: any) => ({ ...d, id: d.taskId || d._id })));
    } catch (err) {
      toast.error("Failed to load pick tasks");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handler = () => { setManualForm({ order: "", zone: "", assignee: "", priority: "normal", items: 1 }); setShowManual(true); };
    window.addEventListener("open-new-pick", handler);
    return () => window.removeEventListener("open-new-pick", handler);
  }, []);

  async function handleScanStart() {
    if (!scanValue.trim()) { toast.error("No barcode detected. Enter or scan a barcode."); return; }
    
    const task = tasks.find(t => t.id.toLowerCase() === scanValue.trim().toLowerCase());
    if (!task) {
      toast.error(`No task found with ID "${scanValue.trim()}".`);
      return;
    }

    if (task.status === "completed") {
      toast.info(`Task ${task.id} is already completed.`);
      return;
    }

    try {
      const newStatus = task.status === "pending" ? "in_progress" : "completed";
      const newPicked = newStatus === "completed" ? task.items : task.picked;
      await pickingService.update(task._id, { status: newStatus, picked: newPicked });
      toast.success(`${t.picking.scanConfirmed}: "${task.id}" is now ${newStatus.replace("_", " ")}.`);
      setScanValue("");
      loadData();
    } catch (err) {
      toast.error("Failed to update task via scan.");
    }
  }

  async function handleTaskAction(task: PickTask) {
    try {
      const newStatus = task.status === "pending" ? "in_progress" : "completed";
      const newPicked = newStatus === "completed" ? task.items : task.picked;
      await pickingService.update(task._id, { status: newStatus, picked: newPicked });
      toast.success(`Task ${task.id} is now ${newStatus.replace("_", " ")}.`);
      loadData();
    } catch (err) {
      toast.error("Failed to update task status.");
    }
  }

  async function handleManualPick() {
    if (!manualForm.order) { toast.error("Order number is required."); return; }
    const id = `T${String(tasks.length + 1).padStart(3, "0")}`;
    try {
      await pickingService.create({ ...manualForm, taskId: id, status: "pending", picked: 0, started: "—" });
      toast.success(`${t.picking.taskCreated}: ${id} — ${manualForm.order}.`);
      setShowManual(false);
      setManualForm({ order: "", zone: "", assignee: "", priority: "normal", items: 1 });
      loadData();
    } catch (err) { toast.error("Failed to create manual pick task"); }
  }

  const TaskCard = ({ task }: { task: PickTask }) => (
    <div className="bg-card border border-border rounded-xl p-4 hover-lift animate-pop-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{task.id}</span>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${priorityColor[task.priority]}`}>{task.priority}</span>
      </div>
      <div className="font-semibold mb-1">{task.order}</div>
      <div className="text-xs text-muted-foreground mb-3">{t.picking.zone} {task.zone}</div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{t.picking.progress}</span>
          <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{task.picked}/{task.items}</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${task.status === "completed" ? "bg-success" : "bg-primary"}`}
            style={{ width: `${task.items > 0 ? (task.picked / task.items) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground mt-4">
        <div className="flex items-center gap-1"><User className="size-3" />{task.assignee}</div>
        <div className="flex items-center gap-1"><Clock className="size-3" />{task.started}</div>
      </div>

      {task.status !== "completed" && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            onClick={() => handleTaskAction(task)}
            className="w-full py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all active:scale-95"
          >
            {task.status === "pending" ? "Start Pick" : "Complete Pick"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t.picking.pending, value: pending.length, icon: Clock, color: "text-warning" },
          { label: t.picking.inProgress, value: inProgress.length, icon: Package, color: "text-primary" },
          { label: t.picking.completed, value: completed.length, icon: CheckCircle2, color: "text-success" },
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

      {/* Scan prompt */}
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ScanLine className="size-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold">Quick scan</div>
            <div className="text-xs text-muted-foreground">{t.picking.scanToStart}</div>
          </div>
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-48">
          <input
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            placeholder="Scan barcode…"
            onKeyDown={(e) => e.key === "Enter" && handleScanStart()}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          />
          <button onClick={handleScanStart} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all active:scale-95">
            Scan
          </button>
        </div>
        <button onClick={() => setShowManual(true)} className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors">
          <Plus className="size-4" /> {t.picking.startManualPick}
        </button>
      </div>

      {/* Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: t.picking.pending, tasks: pending, icon: AlertCircle, color: "text-warning", badge: "bg-warning/15 text-warning" },
          { label: t.picking.inProgress, tasks: inProgress, icon: Package, color: "text-primary", badge: "bg-primary/15 text-primary" },
          { label: t.picking.completed, tasks: completed, icon: CheckCircle2, color: "text-success", badge: "bg-success/15 text-success" },
        ].map((col) => (
          <div key={col.label}>
            <div className="flex items-center gap-2 mb-3">
              <col.icon className={`size-4 ${col.color}`} />
              <h3 className="font-bold">{col.label}</h3>
              <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${col.badge}`}>{col.tasks.length}</span>
            </div>
            <div className="space-y-3">
              {col.tasks.map((task) => <TaskCard key={task.id} task={task} />)}
              {col.tasks.length === 0 && <div className="border-2 border-dashed border-border rounded-xl p-4 text-center text-xs text-muted-foreground">{t.common.noData}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Manual Pick Modal */}
      <Modal open={showManual} onClose={() => setShowManual(false)} title={t.picking.startManualPick} subtitle="Create a pick task without scanning" footer={<><ModalCancel onClose={() => setShowManual(false)} /><ModalSubmit onClick={handleManualPick}>{t.picking.taskCreated}</ModalSubmit></>}>
        <Field label={t.picking.order} required><Input value={manualForm.order} onChange={(e) => setManualForm({ ...manualForm, order: e.target.value })} placeholder="ORD-XXXXX" /></Field>
        <Row>
          <Field label={t.picking.zone}><Input value={manualForm.zone} onChange={(e) => setManualForm({ ...manualForm, zone: e.target.value })} placeholder="A-12" /></Field>
          <Field label="No. of items"><Input type="number" value={manualForm.items} onChange={(e) => setManualForm({ ...manualForm, items: Number(e.target.value) })} /></Field>
        </Row>
        <Row>
          <Field label={t.picking.assignee}><Input value={manualForm.assignee} onChange={(e) => setManualForm({ ...manualForm, assignee: e.target.value })} placeholder="Staff name" /></Field>
          <Field label={t.picking.priority}><Select value={manualForm.priority} onChange={(e) => setManualForm({ ...manualForm, priority: e.target.value })}>
            <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
          </Select></Field>
        </Row>
      </Modal>
    </div>
  );
}
