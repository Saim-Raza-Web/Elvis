import React, { useState, useEffect } from "react";
import { Undo2, Search, AlertTriangle, Clock, DollarSign, FileText } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";
import { returnsService } from "../../services/returns.service";
import { warehousesService } from "../../services/warehouses.service";

type ReturnItem = { _id: string; id: string; order: string; customer: string; reason: string; items: number; amount: number; status: string; date: string; warehouse: string; returnId?: string; items_details?: any[] };

export function Returns() {
  const { t } = useLang();
  const [returnList, setReturnList] = useState<ReturnItem[]>([]);
  const [activeReturn, setActiveReturn] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" });
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const [data, whs] = await Promise.all([
        returnsService.getAll(),
        warehousesService.getAll()
      ]);
      setReturnList(data.map((d: any) => ({ ...d, id: d.returnId || d._id, date: d.date?.slice(0, 10) || "—" })));
      setWarehouses(whs);
    } catch (err) {
      toast.error("Failed to load returns");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" }); setShowAdd(true); };
    window.addEventListener("open-create-return", handler);
    return () => window.removeEventListener("open-create-return", handler);
  }, []);

  async function handleCreate() {
    if (!form.order || !form.customer) { toast.error("Order and customer required."); return; }
    const id = `RET-${String(returnList.length + 42).padStart(4, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      await returnsService.create({ ...form, returnId: id, status: "pending", date: today });
      toast.success(`Return ${id} created.`);
      setShowAdd(false);
      setForm({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" });
      loadData();
    } catch (err) { toast.error("Failed to create return"); }
  }

  async function handleProcess(ret: ReturnItem) {
    try {
      await returnsService.update(ret._id, { status: "processing" });
      toast.info(`Return ${ret.id} is now processing.`);
      loadData();
    } catch (err) { toast.error("Failed to update status"); }
  }

  async function handleRefund(ret: ReturnItem) {
    try {
      await returnsService.update(ret._id, { status: "refunded" });
      toast.success(`Return ${ret.id} refunded successfully.`);
      loadData();
    } catch (err) { toast.error("Failed to process refund"); }
  }

  async function handleQCItem(ret: ReturnItem) {
    const skuInput = document.getElementById(`ret-sku-${ret.id}`) as HTMLInputElement;
    const qtyInput = document.getElementById(`ret-qty-${ret.id}`) as HTMLInputElement;
    const statusInput = document.getElementById(`ret-status-${ret.id}`) as HTMLSelectElement;
    if (!skuInput?.value || !qtyInput?.value) return toast.error("SKU and Qty required");
    
    const newItem = {
      sku: skuInput.value,
      qty: Number(qtyInput.value),
      qc_status: statusInput.value,
      notes: ret.reason
    };
    
    try {
      const items_details = ret.items_details ? [...ret.items_details, newItem] : [newItem];
      await returnsService.update(ret._id, { items_details });
      toast.success(`QC recorded for ${skuInput.value}`);
      skuInput.value = ""; qtyInput.value = "";
      loadData();
    } catch (err) {
      toast.error("Failed to record returned item");
    }
  }

  async function downloadReturnNote(ret: ReturnItem) {
    try {
      const token = localStorage.getItem("token");
      const url = `/api/v1/documents/return-note/${ret._id}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ReturnNote-${ret.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Return note downloaded");
    } catch (err) {
      toast.error("Failed to generate document");
    }
  }

  const filtered = returnList.filter((r) =>
    (r.id || "").toLowerCase().includes(search.toLowerCase()) || (r.customer || "").toLowerCase().includes(search.toLowerCase())
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
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <React.Fragment key={r.id}>
                <tr className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{r.id}</td>
                <td className="px-4 py-3 text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{r.order}</td>
                <td className="px-4 py-3 font-medium">{r.customer}</td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">{r.reason}</td>
                <td className="px-4 py-3 text-center hidden sm:table-cell">{r.items}</td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{r.amount.toFixed(2)}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground text-xs">{r.date}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); downloadReturnNote(r); }} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Download Return Note">
                      <FileText className="size-4" />
                    </button>
                    {r.status === "pending" && (
                      <button onClick={(e) => { e.stopPropagation(); handleProcess(r); }} className="px-3 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all active:scale-95">Process</button>
                    )}
                    {r.status === "processing" && (
                      <button onClick={(e) => { e.stopPropagation(); setActiveReturn(activeReturn === r.id ? null : r.id); }} className="px-3 py-1 border border-primary text-primary rounded-lg text-xs font-semibold hover:bg-primary/5 transition-all">Inspect Items</button>
                    )}
                  </div>
                </td>
              </tr>
              {activeReturn === r.id && r.status === "processing" && (
                <tr className="bg-secondary/10 border-b border-border">
                  <td colSpan={9} className="p-4">
                    <div className="bg-card border border-primary/20 rounded-lg p-4 animate-fade-in-up">
                      <h4 className="font-bold text-sm mb-3 text-primary">Return Inspection & QC</h4>
                      <div className="flex gap-2 mb-3">
                        <Input placeholder="Scan Returned SKU..." id={`ret-sku-${r.id}`} className="flex-1" />
                        <Input type="number" placeholder="Qty" id={`ret-qty-${r.id}`} className="w-24" />
                        <Select id={`ret-status-${r.id}`} className="w-32">
                          <option value="restock">Restock</option>
                          <option value="damage">Damaged</option>
                          <option value="disposed">Dispose</option>
                        </Select>
                        <PrimaryButton onClick={() => handleQCItem(r)}>Add</PrimaryButton>
                      </div>
                      
                      {r.items_details && r.items_details.length > 0 && (
                        <div className="mb-4 space-y-1">
                          {r.items_details.map((it: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-xs bg-card p-2 rounded border border-border">
                              <span><strong style={{ fontFamily: "JetBrains Mono" }}>{it.sku}</strong> ({it.qty} units)</span>
                              <StatusBadge status={it.qc_status} />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex justify-end pt-2 border-t border-primary/20">
                        <button onClick={() => handleRefund(r)} className="px-4 py-2 bg-success text-success-foreground rounded-lg text-sm font-bold hover:opacity-90">
                          Complete & Issue Refund
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
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
        <Field label="Return to Warehouse"><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
          {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
          {warehouses.length === 0 && <option value="MIA">MIA</option>}
        </Select></Field>
      </Modal>
    </div>
  );
}
