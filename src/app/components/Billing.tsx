import { useState } from "react";
import { ReceiptText, Search, Plus, DollarSign, Clock, AlertCircle, CheckCircle2, Send } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { billingService } from "../../services/billing.service";

type Invoice = { _id: string; id: string; customer: string; amount: number; status: string; issued: string; due: string; items: number; invoiceId?: string };

const blankInvoice = () => ({ customer: "", amount: 0, items: 1, issued: new Date().toISOString().slice(0, 10), due: "", notes: "" });

export function Billing() {
  const { t } = useLang();
  const [invoiceList, setInvoiceList] = useState<Invoice[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankInvoice());

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const data = await billingService.getAll();
      setInvoiceList(data.map((d: any) => ({ ...d, id: d.invoiceId || d._id, issued: d.issued?.slice(0, 10) || "—", due: d.due?.slice(0, 10) || "—" })));
    } catch (err) {
      toast.error("Failed to load invoices");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handler = () => { setForm(blankInvoice()); setShowAdd(true); };
    window.addEventListener("open-new-invoice", handler);
    return () => window.removeEventListener("open-new-invoice", handler);
  }, []);

  async function handleCreate() {
    if (!form.customer || !form.amount) { toast.error("Customer and amount required."); return; }
    const id = `INV-${String(invoiceList.length + 88).padStart(4, "0")}`;
    try {
      await billingService.create({ invoiceId: id, customer: form.customer, amount: Number(form.amount), status: "draft", issued: form.issued, due: form.due || form.issued, items: Number(form.items) });
      toast.success(t.billing.invoiceCreated.replace("{id}", id).replace("{customer}", form.customer));
      setShowAdd(false);
      setForm(blankInvoice());
      loadData();
    } catch (err) { toast.error("Failed to create invoice"); }
  }

  async function handleSend(inv: typeof invoiceList[0]) {
    try {
      await billingService.update(inv._id, { status: "unpaid" });
      toast.success(t.billing.invoiceSent.replace("{id}", inv.id).replace("{customer}", inv.customer));
      loadData();
    } catch (err) { toast.error("Failed to send invoice"); }
  }

  const filters = ["All", "draft", "unpaid", "paid", "overdue"];

  const paid = invoiceList.filter((inv) => inv.status === "paid").reduce((a, inv) => a + inv.amount, 0);
  const outstanding = invoiceList.filter((inv) => inv.status === "unpaid" || inv.status === "overdue").reduce((a, inv) => a + inv.amount, 0);
  const overdue = invoiceList.filter((inv) => inv.status === "overdue").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.billing.totalInvoices, value: invoiceList.length, icon: ReceiptText, color: "text-primary" },
          { label: t.billing.revenueCollected, value: `€${(paid / 1000).toFixed(1)}k`, icon: CheckCircle2, color: "text-success" },
          { label: t.billing.outstanding, value: `€${outstanding.toFixed(0)}`, icon: Clock, color: "text-warning" },
          { label: t.billing.overdue, value: overdue, icon: AlertCircle, color: "text-destructive" },
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
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.common.search + "…"}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors"
            style={{ fontSize: "0.875rem" }}
          />
        </div>
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all capitalize ${filter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}
            >
              {f}
            </button>
          ))}
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>{t.billing.newInvoice}</PrimaryButton>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">{t.billing.invoice}</th>
              <th className="text-left px-4 py-3">{t.common.company}</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">{t.billing.issued}</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">{t.billing.due}</th>
              <th className="text-center px-4 py-3 hidden sm:table-cell">{t.billing.noOfItems}</th>
              <th className="text-center px-4 py-3">{t.common.status}</th>
              <th className="text-right px-4 py-3">{t.common.amount}</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {invoiceList.filter((inv) => {
        const matchSearch = inv.id.toLowerCase().includes(search.toLowerCase()) || inv.customer.toLowerCase().includes(search.toLowerCase());
        const matchFilter = filter === "All" || inv.status === filter;
        return matchSearch && matchFilter;
      }).map((inv, i) => (
              <tr key={inv.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{inv.id}</td>
                <td className="px-4 py-3 font-medium">{inv.customer}</td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">{inv.issued}</td>
                <td className={`px-4 py-3 hidden sm:table-cell text-xs ${inv.status === "overdue" ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{inv.due}</td>
                <td className="px-4 py-3 text-center hidden sm:table-cell text-muted-foreground">{inv.items}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={inv.status} /></td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{inv.amount.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">
                  {inv.status !== "paid" && (
                    <button onClick={() => handleSend(inv)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Send invoice">
                      <Send className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.billing.newInvoice} subtitle="Create an invoice for a customer" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.billing.newInvoice}</ModalSubmit></>}>
        <Field label={t.common.company} required><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Company name" /></Field>
        <Row>
          <Field label={t.common.amount + " (€)"} required><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
          <Field label={t.billing.noOfLineItems}><Input type="number" value={form.items} onChange={(e) => setForm({ ...form, items: Number(e.target.value) })} /></Field>
        </Row>
        <Row>
          <Field label={t.billing.issueDate}><Input type="date" value={form.issued} onChange={(e) => setForm({ ...form, issued: e.target.value })} /></Field>
          <Field label={t.billing.dueDate}><Input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
        </Row>
        <Field label={t.common.notes}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t.billing.paymentTerms + "…"} /></Field>
      </Modal>
    </div>
  );
}
