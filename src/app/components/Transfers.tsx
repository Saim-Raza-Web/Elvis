import { useState } from "react";
import { ArrowRightLeft, Plus, Search, MapPin, Package, CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

type Transfer = { id: string; sku: string; product: string; qty: number; from_wh: string; from_loc: string; to_wh: string; to_loc: string; status: string; type: string; requestedBy: string; date: string };

const initialTransfers: Transfer[] = [
  { id: "TRF-0089", sku: "SKU-1001", product: "Premium Widget Alpha", qty: 200, from_wh: "LAX", from_loc: "A-12-C", to_wh: "MIA", to_loc: "B-07-A", status: "in_progress", type: "replenishment", requestedBy: "System", date: "2026-06-26" },
  { id: "TRF-0088", sku: "SKU-1005", product: "Nylon Cable Tie 500mm", qty: 1000, from_wh: "ORD", from_loc: "C-03-B", to_wh: "DAL", to_loc: "D-01-A", status: "completed", type: "transfer", requestedBy: "Alex M.", date: "2026-06-25" },
  { id: "TRF-0087", sku: "SKU-1003", product: "Steel Bracket Type-C", qty: 500, from_wh: "MIA", from_loc: "B-02-D", to_wh: "JFK", to_loc: "A-04-B", status: "pending", type: "transfer", requestedBy: "Sarah K.", date: "2026-06-25" },
  { id: "TRF-0086", sku: "SKU-1006", product: "Precision Sensor Module", qty: 50, from_wh: "LAX", from_loc: "D-08-A", to_wh: "ORD", to_loc: "C-11-C", status: "pending", type: "replenishment", requestedBy: "System", date: "2026-06-24" },
  { id: "TRF-0085", sku: "SKU-1008", product: "Foam Packing Material", qty: 2000, from_wh: "JFK", from_loc: "E-01-A", to_wh: "MIA", to_loc: "F-02-B", status: "completed", type: "transfer", requestedBy: "Tom W.", date: "2026-06-23" },
];

const typeColor: Record<string, string> = {
  replenishment: "bg-primary/15 text-primary",
  transfer: "bg-info/15 text-info",
};

const blankTransfer = () => ({ sku: "", product: "", qty: 1, from_wh: "MIA", from_loc: "", to_wh: "LAX", to_loc: "", type: "transfer", requestedBy: "Admin" });

export function Transfers() {
  const { t } = useLang();
  const [transfers, setTransfers] = useState(initialTransfers);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankTransfer());

  function handleCreate() {
    if (!form.sku || !form.from_loc || !form.to_loc) { toast.error("SKU and locations are required."); return; }
    const id = `TRF-${String(transfers.length + 85).padStart(4, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    setTransfers((prev) => [...prev, { ...form, id, status: "pending", date: today }]);
    toast.success(`${t.transfers.transferCreated}: ${id}.`);
    setShowAdd(false);
    setForm(blankTransfer());
  }

  function handleStart(id: string) {
    setTransfers((prev) => prev.map((tr) => tr.id === id ? { ...tr, status: "in_progress" } : tr));
    toast.info(`${t.transfers.transferStarted}: ${id}.`);
  }

  function handleComplete(id: string) {
    setTransfers((prev) => prev.map((tr) => tr.id === id ? { ...tr, status: "completed" } : tr));
    toast.success(`${t.transfers.transferCompleted}: ${id}.`);
  }

  const filtered = transfers.filter((tr) => {
    const matchSearch = tr.id.toLowerCase().includes(search.toLowerCase()) || tr.product.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "All" || tr.status === filter || tr.type === filter.toLowerCase();
    return matchSearch && matchFilter;
  });

  const pending = transfers.filter((tr) => tr.status === "pending").length;
  const inProgress = transfers.filter((tr) => tr.status === "in_progress").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t.transfers.pendingTransfers, value: pending, icon: Clock, color: "text-warning" },
          { label: "In progress", value: inProgress, icon: ArrowRightLeft, color: "text-primary" },
          { label: t.transfers.completedToday, value: 2, icon: CheckCircle2, color: "text-success" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t.common.search} transfers…`} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
        </div>
        <div className="flex gap-1.5">
          {["All", "pending", "in_progress", "completed", "replenishment"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap capitalize transition-all ${filter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}>{f.replace("_", " ")}</button>
          ))}
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>{t.transfers.newTransfer}</PrimaryButton>
      </div>

      {/* Transfer cards */}
      <div className="space-y-3">
        {filtered.map((tr, i) => (
          <div key={tr.id} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-secondary flex items-center justify-center"><Package className="size-4 text-muted-foreground" /></div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.875rem" }}>{tr.id}</span>
                    <StatusBadge status={tr.status} />
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColor[tr.type]}`}>{tr.type === "replenishment" ? t.transfers.replenishment : t.transfers.transfer}</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">{tr.product}</div>
                  <div className="text-xs text-muted-foreground">{tr.sku} · <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{tr.qty.toLocaleString()} units</span></div>
                </div>
              </div>

              {/* Route */}
              <div className="flex items-center gap-3 text-sm">
                <div className="text-center">
                  <div className="font-bold text-primary">{tr.from_wh}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="size-3" />{tr.from_loc}</div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <div className="text-[10px] text-muted-foreground">{tr.date}</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-success">{tr.to_wh}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="size-3" />{tr.to_loc}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t.transfers.requestedBy}: {tr.requestedBy}</span>
                {tr.status === "pending" && (
                  <button onClick={(e) => { e.stopPropagation(); handleStart(tr.id); }} className="px-3 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all active:scale-95">{t.transfers.startTransfer}</button>
                )}
                {tr.status === "in_progress" && (
                  <button onClick={(e) => { e.stopPropagation(); handleComplete(tr.id); }} className="px-3 py-1 bg-success text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-all active:scale-95">{t.transfers.completeTransfer}</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* New Transfer Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.transfers.newTransfer} subtitle="Move stock between locations" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.transfers.newTransfer}</ModalSubmit></>}>
        <Row>
          <Field label="SKU" required><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="SKU-XXXX" /></Field>
          <Field label={t.transfers.qty}><Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} /></Field>
        </Row>
        <Field label="Product description"><Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="Auto-filled from SKU" /></Field>
        <Row>
          <Field label={t.transfers.fromWarehouse}><Select value={form.from_wh} onChange={(e) => setForm({ ...form, from_wh: e.target.value })}>
            {["MIA","LAX","ORD","JFK","DAL"].map((w) => <option key={w}>{w}</option>)}
          </Select></Field>
          <Field label={t.transfers.fromLocation} required><Input value={form.from_loc} onChange={(e) => setForm({ ...form, from_loc: e.target.value })} placeholder="A-01-B" /></Field>
        </Row>
        <Row>
          <Field label={t.transfers.toWarehouse}><Select value={form.to_wh} onChange={(e) => setForm({ ...form, to_wh: e.target.value })}>
            {["MIA","LAX","ORD","JFK","DAL"].map((w) => <option key={w}>{w}</option>)}
          </Select></Field>
          <Field label={t.transfers.toLocation} required><Input value={form.to_loc} onChange={(e) => setForm({ ...form, to_loc: e.target.value })} placeholder="B-03-A" /></Field>
        </Row>
        <Field label={t.transfers.transferType}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="transfer">{t.transfers.transfer}</option><option value="replenishment">{t.transfers.replenishment}</option>
        </Select></Field>
      </Modal>
    </div>
  );
}
