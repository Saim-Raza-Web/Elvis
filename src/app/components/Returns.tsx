import { useState } from "react";
import { Undo2, Search, AlertTriangle, CheckCircle2, Clock, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, Textarea, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const returns = [
  { id: "RET-0041", order: "ORD-00155", customer: "Meridian Corp", reason: "Defective item", items: 2, amount: 234.00, status: "processing", date: "2026-06-24", warehouse: "MIA" },
  { id: "RET-0040", order: "ORD-00148", customer: "Tidal Wave Inc.", reason: "Wrong item shipped", items: 1, amount: 89.99, status: "returned", date: "2026-06-23", warehouse: "LAX" },
  { id: "RET-0039", order: "ORD-00141", customer: "Granite Peak Co.", reason: "No longer needed", items: 5, amount: 1100.00, status: "refunded", date: "2026-06-22", warehouse: "ORD" },
  { id: "RET-0038", order: "ORD-00137", customer: "Lunar Systems", reason: "Damaged in transit", items: 3, amount: 450.00, status: "pending", date: "2026-06-20", warehouse: "DAL" },
  { id: "RET-0037", order: "ORD-00130", customer: "Ember Tech", reason: "Ordered by mistake", items: 1, amount: 29.99, status: "refunded", date: "2026-06-18", warehouse: "JFK" },
];

export function Returns() {
  const { t } = useLang();
  const [returnList, setReturnList] = useState(returns);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" });

  function handleCreate() {
    if (!form.order || !form.customer) { toast.error("Order and customer required."); return; }
    const id = `RET-${String(returnList.length + 42).padStart(4, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    setReturnList((prev) => [...prev, { id, order: form.order, customer: form.customer, reason: form.reason || "Not specified", items: form.items, amount: form.amount, status: "pending", date: today, warehouse: form.warehouse }]);
    toast.success(`Return ${id} created.`);
    setShowAdd(false);
    setForm({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" });
  }

  const filtered = returnList.filter((r) =>
    r.id.toLowerCase().includes(search.toLowerCase()) || r.customer.toLowerCase().includes(search.toLowerCase())
  );

  const totalRefunded = returnList.filter((r) => r.status === "refunded").reduce((a, r) => a + r.amount, 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.returns.totalReturns, value: returnList.length, icon: Undo2, color: "text-primary" },
          { label: t.common.status, value: returnList.filter((r) => r.status === "pending").length, icon: Clock, color: "text-warning" },
          { label: t.status.processing, value: returnList.filter((r) => r.status === "processing").length, icon: AlertTriangle, color: "text-info" },
          { label: t.returns.totalRefunded, value: `€${totalRefunded.toFixed(0)}`, icon: DollarSign, color: "text-success" },
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

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t.common.search}…`}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors"
            style={{ fontSize: "0.875rem" }}
          />
        </div>
        <PrimaryButton icon={Undo2} onClick={() => setShowAdd(true)}>{t.returns.createReturn}</PrimaryButton>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">ID</th>
              <th className="text-left px-4 py-3">{t.returns.orderNo}</th>
              <th className="text-left px-4 py-3">{t.common.name}</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">{t.returns.reason}</th>
              <th className="text-center px-4 py-3 hidden sm:table-cell">{t.common.items}</th>
              <th className="text-right px-4 py-3">{t.common.amount}</th>
              <th className="text-center px-4 py-3">{t.common.status}</th>
              <th className="text-right px-4 py-3 hidden sm:table-cell">{t.common.date}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{r.id}</td>
                <td className="px-4 py-3 text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{r.order}</td>
                <td className="px-4 py-3 font-medium">{r.customer}</td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">{r.reason}</td>
                <td className="px-4 py-3 text-center hidden sm:table-cell">{r.items}</td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{r.amount.toFixed(2)}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground text-xs">{r.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.returns.createReturn} subtitle="Register a customer return" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.returns.createReturn}</ModalSubmit></>}>
        <Row>
          <Field label={t.returns.orderNo} required><Input value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder="ORD-XXXXX" /></Field>
          <Field label={t.common.name} required><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Company name" /></Field>
        </Row>
        <Field label={t.returns.reason}><Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
          <option value="">— {t.common.none} —</option>
          <option value={t.returns.reasons.defective}>{t.returns.reasons.defective}</option>
          <option value={t.returns.reasons.wrong}>{t.returns.reasons.wrong}</option>
          <option value={t.returns.reasons.damaged}>{t.returns.reasons.damaged}</option>
          <option value={t.returns.reasons.noLonger}>{t.returns.reasons.noLonger}</option>
          <option value={t.returns.reasons.mistake}>{t.returns.reasons.mistake}</option>
          <option value={t.returns.reasons.missing}>{t.returns.reasons.missing}</option>
          <option value={t.returns.reasons.other}>{t.returns.reasons.other}</option>
        </Select></Field>
        <Row>
          <Field label={t.returns.noOfItems}><Input type="number" value={form.items} onChange={(e) => setForm({ ...form, items: Number(e.target.value) })} /></Field>
          <Field label={t.returns.refundAmount}><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.common.warehouse}><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
          {["MIA","LAX","ORD","JFK","DAL"].map((w) => <option key={w}>{w}</option>)}
        </Select></Field>
      </Modal>
    </div>
  );
}
