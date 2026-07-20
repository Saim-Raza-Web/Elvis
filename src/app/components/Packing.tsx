import { useState } from "react";
import { PackageOpen, ScanLine, CheckCircle2, AlertCircle, Package, Box, Printer, Scale, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { packingService } from "../../services/packing.service";

type PackTask = { _id: string; id: string; order: string; customer: string; items: number; picked: number; station: string; priority: string; status: string; packId?: string };

const initialPackItems = [
  { sku: "SKU-1001", product: "Premium Widget Alpha", qty: 2, scanned: 2, verified: true },
  { sku: "SKU-1006", product: "Precision Sensor Module", qty: 1, scanned: 1, verified: true },
  { sku: "SKU-1004", product: "Lithium Battery Pack 12V", qty: 2, scanned: 1, verified: false },
];

const priorityColor: Record<string, string> = {
  high: "text-destructive bg-destructive/10",
  normal: "text-info bg-info/10",
  low: "text-muted-foreground bg-secondary",
};

export function Packing() {
  const { t } = useLang();
  const [queue, setQueue] = useState<PackTask[]>([]);
  const [packItems, setPackItems] = useState(initialPackItems);
  const [activeTask, setActiveTask] = useState<string | null>("PCK-0057");
  const [scanned, setScanned] = useState("");
  const [weight, setWeight] = useState("2.4");
  const [boxType, setBoxType] = useState("Box M (30×25×20)");
  const [material, setMaterial] = useState("Bubble wrap");
  const [labelPrinted, setLabelPrinted] = useState(false);
  const [weighed, setWeighed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [manualForm, setManualForm] = useState({ order: "", customer: "", items: 1, station: "Pack-01", priority: "normal" });

  const activePack = queue.find((p) => p.id === activeTask);
  const allVerified = packItems.every((i) => i.verified);

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const data = await packingService.getAll();
      setQueue(data.map((d: any) => ({ ...d, id: d.packId || d._id })));
    } catch (err) {
      toast.error("Failed to load packing queue");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handler = () => { setManualForm({ order: "", customer: "", items: 1, station: "Pack-01", priority: "normal" }); setShowAdd(true); };
    window.addEventListener("open-new-pack", handler);
    return () => window.removeEventListener("open-new-pack", handler);
  }, []);

  function handleVerify() {
    if (!scanned.trim()) { toast.error("Scan or enter a barcode first."); return; }
    const item = packItems.find((i) => i.sku === scanned.trim() || i.product.toLowerCase().includes(scanned.toLowerCase()));
    if (!item) { toast.error(`Barcode "${scanned}" not found in this order.`); setScanned(""); return; }
    if (item.verified) { toast.info(`${item.sku} already verified.`); setScanned(""); return; }
    setPackItems((prev) => prev.map((i) => i.sku === item.sku ? { ...i, scanned: i.qty, verified: true } : i));
    toast.success(`${item.sku} — ${item.product} verified ✓`);
    setScanned("");
  }

  async function handlePrintLabel() {
    if (!activePack) return;
    try {
      await packingService.update(activePack._id, { label_printed: true });
      setLabelPrinted(true);
      toast.success(`Shipping label for ${activePack.order} sent to printer.`);
    } catch (err) {
      toast.error("Failed to update label status");
    }
  }

  async function handleWeigh() {
    if (!activePack) return;
    const w = parseFloat(weight);
    if (isNaN(w) || w <= 0) { toast.error("Enter a valid weight."); return; }
    try {
      await packingService.update(activePack._id, { weight: w });
      setWeighed(true);
      toast.success(`Package weighed: ${weight} kg.`);
    } catch (err) {
      toast.error("Failed to update weight");
    }
  }

  async function handleCompleteShip() {
    if (!activePack) return;
    if (!labelPrinted) { toast.error("Print shipping label before completing."); return; }
    if (!allVerified) { toast.error("All items must be verified before shipping."); return; }
    try {
      await packingService.update(activePack._id, { status: "completed" });
      toast.success(`${activePack.order} packed and queued for shipping!`);
      setActiveTask(null);
      setPackItems(initialPackItems.map((i) => ({ ...i, scanned: 0, verified: false })));
      setLabelPrinted(false);
      setWeighed(false);
      loadData();
    } catch (err) { toast.error("Failed to complete packing"); }
  }

  async function handleAddPack() {
    if (!manualForm.order || !manualForm.customer) { toast.error("Order and customer are required."); return; }
    const id = `PCK-${String(queue.length + 80).padStart(4, "0")}`;
    try {
      await packingService.create({ ...manualForm, packId: id, status: "ready", picked: manualForm.items });
      toast.success(`Pack task created: ${id}`);
      setShowAdd(false);
      setManualForm({ order: "", customer: "", items: 1, station: "Pack-01", priority: "normal" });
      loadData();
    } catch (err) { toast.error("Failed to create pack task"); }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.packing.readyToPack, value: queue.filter((p) => p.status === "ready").length, icon: Package, color: "text-primary" },
          { label: t.packing.currentlyPacking, value: queue.filter((p) => p.status === "packing").length, icon: PackageOpen, color: "text-info" },
          { label: t.packing.completedToday, value: queue.filter((p) => p.status === "completed").length, icon: CheckCircle2, color: "text-success" },
          { label: t.packing.issues, value: 0, icon: AlertCircle, color: "text-destructive" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Queue */}
        <div className="space-y-2">
          <h3 className="font-bold mb-3">{t.packing.packingQueue}</h3>
          {queue.map((task, i) => (
            <div
              key={task.id}
              onClick={() => { setActiveTask(task.id); setLabelPrinted(false); setWeighed(false); }}
              className={`rounded-xl border p-3 cursor-pointer transition-all hover-lift animate-pop-in ${activeTask === task.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{task.id}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${priorityColor[task.priority]}`}>{task.priority}</span>
              </div>
              <div className="text-sm font-semibold">{task.order}</div>
              <div className="text-xs text-muted-foreground">{task.customer}</div>
              <div className="flex items-center justify-between mt-2">
                <StatusBadge status={task.status} />
                <span className="text-xs text-muted-foreground">{task.station}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Active packing station */}
        <div className="xl:col-span-2 space-y-4">
          {activePack ? (
            <>
              <div className="rounded-xl border border-primary/30 bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{activePack.id}</span>
                      <StatusBadge status={activePack.status} />
                    </div>
                    <div className="text-muted-foreground text-sm">{activePack.order} · {activePack.customer}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Station</div>
                    <div className="font-bold">{activePack.station}</div>
                  </div>
                </div>

                {/* Scan bar */}
                <div className="flex items-center gap-2 mb-4">
                  <ScanLine className="size-4 text-muted-foreground shrink-0" />
                  <input
                    value={scanned}
                    onChange={(e) => setScanned(e.target.value)}
                    placeholder={t.packing.scanPlaceholder}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem", fontFamily: "JetBrains Mono, monospace" }}
                  />
                  <button
                    onClick={handleVerify}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all active:scale-95"
                  >
                    {t.packing.verifyBtn}
                  </button>
                </div>

                {/* Items list */}
                <div className="space-y-2">
                  {packItems.map((item) => (
                    <div key={item.sku} className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${item.verified ? "border-success/30 bg-success/5" : "border-border bg-secondary/30"}`}>
                      <div className={`size-8 rounded-full flex items-center justify-center ${item.verified ? "bg-success text-white" : "bg-secondary text-muted-foreground"}`}>
                        {item.verified ? <CheckCircle2 className="size-4" /> : <Package className="size-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{item.product}</div>
                        <div className="text-xs text-muted-foreground">{item.sku}</div>
                      </div>
                      <div className="text-sm font-bold shrink-0" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                        <span className={item.scanned < item.qty ? "text-warning" : "text-success"}>{item.scanned}</span>
                        <span className="text-muted-foreground">/{item.qty}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Packaging details */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-bold mb-4 flex items-center gap-2"><Box className="size-4" /> {t.packing.packageDetails}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t.packing.boxType}</label>
                    <select value={boxType} onChange={(e) => setBoxType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none text-sm">
                      <option>Box S (20×15×10)</option>
                      <option>Box M (30×25×20)</option>
                      <option>Box L (40×35×30)</option>
                      <option>Box XL (60×50×40)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">
                      {t.packing.weight}{weighed && <span className="text-success ml-1 font-bold">✓ {t.packing.weighed.toLowerCase()}</span>}
                    </label>
                    <input value={weight} onChange={(e) => setWeight(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm" style={{ fontFamily: "JetBrains Mono, monospace" }} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">{t.packing.material}</label>
                    <select value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none text-sm">
                      <option>Bubble wrap</option>
                      <option>Foam padding</option>
                      <option>Air cushions</option>
                      <option>Paper fill</option>
                    </select>
                  </div>
                </div>

                {/* Checklist */}
                <div className="flex gap-2 flex-wrap mb-4">
                  {[
                    { label: t.packing.allVerified, done: allVerified },
                    { label: t.packing.labelPrinted, done: labelPrinted },
                    { label: t.packing.weighed, done: weighed },
                  ].map((c) => (
                    <div key={c.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${c.done ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}>
                      {c.done ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
                      {c.label}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handlePrintLabel}
                    className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-semibold transition-all active:scale-95 ${labelPrinted ? "border-success text-success bg-success/5" : "border-border hover:bg-secondary"}`}
                  >
                    <Printer className="size-4" /> {labelPrinted ? t.packing.labelPrinted : t.packing.printLabel}
                  </button>
                  <button
                    onClick={handleWeigh}
                    className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-semibold transition-all active:scale-95 ${weighed ? "border-success text-success bg-success/5" : "border-border hover:bg-secondary"}`}
                  >
                    <Scale className="size-4" /> {weighed ? t.packing.weighed : t.packing.weigh}
                  </button>
                  <button
                    onClick={handleCompleteShip}
                    disabled={!allVerified || !labelPrinted}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-success text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t.packing.completeShip} <ArrowRight className="size-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-border p-12 flex flex-col items-center gap-3 text-center">
              <PackageOpen className="size-10 text-muted-foreground" />
              <div className="font-semibold">Select a task to start packing</div>
              <div className="text-sm text-muted-foreground">Choose an order from the queue on the left</div>
            </div>
          )}
        </div>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Pack Task" subtitle="Manually add an order to the packing queue" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleAddPack}>Add Task</ModalSubmit></>}>
        <Row>
          <Field label="Order Number" required><Input value={manualForm.order} onChange={(e) => setManualForm({ ...manualForm, order: e.target.value })} placeholder="ORD-XXXXX" /></Field>
          <Field label="Customer" required><Input value={manualForm.customer} onChange={(e) => setManualForm({ ...manualForm, customer: e.target.value })} placeholder="Customer Name" /></Field>
        </Row>
        <Row>
          <Field label="No. of items"><Input type="number" value={manualForm.items} onChange={(e) => setManualForm({ ...manualForm, items: Number(e.target.value) })} /></Field>
          <Field label="Station"><Input value={manualForm.station} onChange={(e) => setManualForm({ ...manualForm, station: e.target.value })} placeholder="Pack-01" /></Field>
        </Row>
        <Field label="Priority"><Select value={manualForm.priority} onChange={(e) => setManualForm({ ...manualForm, priority: e.target.value })}>
          <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
        </Select></Field>
      </Modal>
    </div>
  );
}
