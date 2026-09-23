import React, { useState, useEffect } from "react";
import { Undo2, Search, AlertTriangle, Clock, DollarSign, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import type { ListService } from "../../hooks/usePaginatedList";
import { returnsService } from "../../services/returns.service";
import { warehousesService } from "../../services/warehouses.service";

type ReturnItem = { _id: string; id: string; order: string; customer: string; reason: string; items: number; amount: number; status: string; date: string; warehouse: string; returnId?: string; items_details?: any[]; owner?: string; ownerType?: string };

function mapReturn(d: Record<string, unknown>): ReturnItem {
  return {
    ...(d as ReturnItem),
    id: (d.returnId as string) || (d._id as string),
    date: (d.date as string)?.slice(0, 10) || "—",
  };
}

const returnsListService: ListService<ReturnItem> = {
  getAll: async (params) => {
    const data = await returnsService.getAll(params);
    return data.map((d: any) => mapReturn(d));
  },
  getPage: async (params) => {
    const result = await returnsService.getPage(params);
    return { data: result.data.map((d: any) => mapReturn(d)), pagination: result.pagination };
  },
};

export function Returns() {
  const { t } = useLang();
  const [activeReturn, setActiveReturn] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showDecision, setShowDecision] = useState(false);
  const [form, setForm] = useState({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" });
  const [decisionForm, setDecisionForm] = useState({
    decision: 'PENDING_DECISION' as 'PENDING_DECISION' | 'RESTOCK_CLIENT' | 'RESTOCK_COMPANY' | 'INCIDENT' | 'WRITEOFF',
    decision_reason: '',
    writeoff_reason: ''
  });
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const searchLower = search.toLowerCase();

  const { items: filtered, allItems, pagination, page, setPage, isLoading, reload } = usePaginatedList<ReturnItem>(
    returnsListService,
    {
      apiParams: { search: searchLower || undefined },
      deps: [search],
    }
  );

  useEffect(() => {
    warehousesService.getAll({ all: true }).then(setWarehouses).catch(() => toast.error(t.common?.error || "Failed to load warehouses"));
  }, []);

  function openAdd() {
    setForm({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: warehouses.length > 0 ? warehouses[0].code : "MIA" });
    setShowAdd(true);
  }

  // Listen for header button CustomEvent
  useEffect(() => {
    window.addEventListener("open-create-return", openAdd);
    return () => window.removeEventListener("open-create-return", openAdd);
  }, [warehouses]);

  async function handleCreate() {
    if (!form.order || !form.customer) { toast.error(t.common?.error || "Order and customer required."); return; }
    const id = `RET-${String(allItems.length + 42).padStart(4, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      await returnsService.create({ ...form, returnId: id, status: "pending", date: today });
      toast.success(`Return ${id} created.`);
      setShowAdd(false);
      setForm({ order: "", customer: "", reason: "", items: 1, amount: 0, warehouse: "MIA" });
      reload();
    } catch (err) { toast.error(t.common?.error || "Failed to create return"); }
  }

  async function handleProcess(ret: ReturnItem) {
    try {
      await returnsService.update(ret._id, { status: "processing" });
      toast.info(`Return ${ret.id} is now processing.`);
      reload();
    } catch (err) { toast.error(t.common?.error || "Failed to update status"); }
  }

  async function handleRefund(ret: ReturnItem) {
    try {
      await returnsService.update(ret._id, { status: "refunded" });
      toast.success(`Return ${ret.id} refunded successfully.`);
      reload();
    } catch (err) { toast.error(t.common?.error || "Failed to process refund"); }
  }

  async function handleQCItem(ret: ReturnItem) {
    const skuInput = document.getElementById(`ret-sku-${ret.id}`) as HTMLInputElement;
    const qtyInput = document.getElementById(`ret-qty-${ret.id}`) as HTMLInputElement;
    const statusInput = document.getElementById(`ret-status-${ret.id}`) as HTMLSelectElement;
    if (!skuInput?.value || !qtyInput?.value) return toast.error(t.common?.error || "SKU and Qty required");
    
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
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to record returned item");
    }
  }

  async function downloadReturnNote(ret: ReturnItem) {
    try {
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
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
      toast.success(t.common?.operationSuccess || "Return note downloaded");
    } catch (err) {
      toast.error(t.common?.error || "Failed to generate document");
    }
  }

  const totalRefunded = allItems.filter((r) => r.status === "refunded").reduce((a, r) => a + r.amount, 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.returns.totalReturns, value: allItems.length, icon: Undo2, color: "text-primary" },
          { label: t.common.status, value: allItems.filter((r) => r.status === "pending").length, icon: Clock, color: "text-warning" },
          { label: t.status.processing, value: allItems.filter((r) => r.status === "processing").length, icon: AlertTriangle, color: "text-info" },
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
        <PrimaryButton icon={Undo2} onClick={openAdd}>{t.returns.createReturn}</PrimaryButton>
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
                    {(r.status === "processing" || r.status === "pending") && (
                      <button onClick={(e) => { e.stopPropagation(); setShowDecision(true); setActiveReturn(r.id); }} className="px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 transition-all">Decision</button>
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
                        <Input placeholder={t.common?.scanReturnedSKU || "Scan Returned SKU..."} id={`ret-sku-${r.id}`} className="flex-1 min-w-[200px]" />
                        <Input type="number" placeholder={t.common?.qty || "Qty"} id={`ret-qty-${r.id}`} className="w-24" />
                        <Select id={`ret-status-${r.id}`} className="w-32">
                          <option value="restock">Restock</option>
                          <option value="damage">Damaged</option>
                          <option value="disposed">Dispose</option>
                        </Select>
                        <PrimaryButton onClick={() => handleQCItem(r)}>{t.common?.add || "Add"}</PrimaryButton>
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
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.returns.createReturn} subtitle={t.common?.registerACustomerReturn || "Register a customer return"} footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.returns.createReturn}</ModalSubmit></>}>
        <Row>
          <Field label={t.returns.orderNo} required><Input value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder={t.common?.oRDXXXXX || "ORD-XXXXX"} /></Field>
          <Field label={t.common.name} required><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder={t.common?.companyName || "Company name"} /></Field>
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
        <Field label={t.common?.returnToWarehouse || "Return to Warehouse"}><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
          {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
          {warehouses.length === 0 && <option value="MIA">{t.common?.mIA || "MIA"}</option>}
        </Select></Field>
      </Modal>

      {/* Decision Modal (RF-P11) */}
      {showDecision && activeReturn && (() => {
        const ret = allItems.find(r => r.id === activeReturn);
        if (!ret) return null;
        
        const hasFinalDecision = ret.items_details?.some((item: any) => 
          item.decision && item.decision !== 'PENDING_DECISION'
        );

        return (
          <Modal
            open={showDecision}
            onClose={() => { setShowDecision(false); setActiveReturn(null); }}
            title="Return Decision Engine (RF-P11)"
            subtitle={`Return: ${ret.id} • Order: ${ret.order}`}
            footer={
              <div className="flex justify-end gap-2 w-full">
                <ModalCancel onClose={() => { setShowDecision(false); setActiveReturn(null); }} />
                {!hasFinalDecision && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (decisionForm.decision === 'WRITEOFF' && !decisionForm.writeoff_reason.trim()) {
                        toast.error("Write-off reason is required");
                        return;
                      }
                      try {
                        // Update items_details with decision
                        const updatedItems = ret.items_details?.map((item: any) => ({
                          ...item,
                          decision: decisionForm.decision,
                          decision_reason: decisionForm.decision_reason,
                          decision_by: 'operator',
                          decision_date: new Date().toISOString(),
                          incidentId: decisionForm.decision === 'INCIDENT' ? `INC-RET-${Date.now().toString().slice(-6)}` : ''
                        })) || [];
                        
                        await returnsService.update(ret._id, { 
                          items_details: updatedItems,
                          status: 'processed'
                        });
                        toast.success(`Return decision recorded: ${decisionForm.decision}`);
                        setShowDecision(false);
                        setActiveReturn(null);
                        setDecisionForm({ decision: 'PENDING_DECISION', decision_reason: '', writeoff_reason: '' });
                        reload();
                      } catch (err: any) {
                        toast.error(err.response?.data?.message || err.message || "Failed to record decision");
                      }
                    }}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-xs transition-all"
                  >
                    Record Decision
                  </button>
                )}
              </div>
            }
          >
            <div className="space-y-4 text-xs">
              {hasFinalDecision ? (
                <div className="bg-purple-500/10 p-4 rounded-xl border border-purple-500/30 text-purple-600 dark:text-purple-400">
                  <div className="font-bold flex items-center gap-1.5 mb-2">
                    <CheckCircle2 className="size-4" /> Final Decision Already Recorded
                  </div>
                  <p>This return has a final decision and cannot be modified.</p>
                  {ret.items_details?.map((item: any, idx: number) => (
                    <div key={idx} className="mt-2 p-2 bg-white/50 rounded border border-purple-500/20">
                      <div className="font-bold">{item.sku}</div>
                      <div className="text-muted-foreground">Decision: {item.decision}</div>
                      <div className="text-muted-foreground">By: {item.decision_by} • {item.decision_date ? new Date(item.decision_date).toLocaleDateString() : ''}</div>
                      {item.decision_reason && <div className="text-muted-foreground">Reason: {item.decision_reason}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="bg-secondary/20 p-4 rounded-xl border border-border space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Select Final Decision</h4>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'RESTOCK_CLIENT', label: 'Restock to Client', desc: 'Return inventory assigned to customer ownership' },
                        { value: 'RESTOCK_COMPANY', label: 'Restock to Company', desc: 'Return inventory becomes company-owned' },
                        { value: 'INCIDENT', label: 'Create Incident', desc: 'Link to incident record for quarantine/follow-up' },
                        { value: 'WRITEOFF', label: 'Write Off', desc: 'Remove from inventory with write-off reason' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDecisionForm({ ...decisionForm, decision: opt.value as any })}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            decisionForm.decision === opt.value
                              ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                              : 'border-border bg-card hover:border-purple-500/50'
                          }`}
                        >
                          <div className="font-bold">{opt.label}</div>
                          <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field label="Decision Reason">
                    <Input
                      value={decisionForm.decision_reason}
                      onChange={(e) => setDecisionForm({ ...decisionForm, decision_reason: e.target.value })}
                      placeholder="Explain the decision rationale..."
                    />
                  </Field>

                  {decisionForm.decision === 'WRITEOFF' && (
                    <Field label="Write-off Reason *" required>
                      <Input
                        value={decisionForm.writeoff_reason}
                        onChange={(e) => setDecisionForm({ ...decisionForm, writeoff_reason: e.target.value })}
                        placeholder="Mandatory: explain why this stock is being written off..."
                      />
                    </Field>
                  )}

                  {decisionForm.decision === 'INCIDENT' && (
                    <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="size-4" /> Incident Will Be Created
                      </div>
                      <p>An Incident record will be automatically linked to this return.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
