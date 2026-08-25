import { useState, useEffect, useMemo } from "react";
import { ReceiptText, Search, Plus, DollarSign, Clock, AlertCircle, CheckCircle2, Send, Download, Eye, Trash2, FileText, Check, ShieldCheck, Mail, Building, RefreshCw, Calendar } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import { billingService, InvoiceLine } from "../../services/billing.service";
import { crmService, Customer } from "../../services/crm.service";
import { inventoryService } from "../../services/inventory.service";
import type { ListService } from "../../hooks/usePaginatedList";

type Invoice = {
  _id: string;
  id: string;
  invoiceNumber: string;
  invoiceId?: string;
  customerId: any;
  customerName: string;
  customerEmail?: string;
  customerVat?: string;
  customerAddress?: string;
  lines: InvoiceLine[];
  subtotal: number;
  discountTotal?: number;
  totalTax: number;
  grandTotal: number;
  amount?: number;
  status: 'draft' | 'issued' | 'sent' | 'paid' | 'cancelled';
  issuedDate?: string;
  dueDate?: string;
  paymentTerms?: string;
  notes?: string;
  bankInfo?: string;
  sentAt?: string;
  sentTo?: string;
  taxBreakdown?: Array<{ taxRate: number; taxableAmount: number; taxAmount: number }>;
  items: number;
  customer?: string;
};

const blankLine = (): InvoiceLine => ({
  itemType: "product",
  sku: "",
  description: "",
  quantity: 1,
  uom: "EA",
  unitPrice: 0,
  discount: 0,
  taxRate: 21,
  lineSubtotal: 0,
  lineTax: 0,
  lineTotal: 0,
});

const blankInvoiceForm = () => ({
  customerId: "",
  customerName: "",
  customerEmail: "",
  customerVat: "",
  customerAddress: "",
  paymentTerms: "Net 30",
  issuedDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  notes: "",
  bankInfo: "",
  lines: [blankLine()],
  status: "draft" as "draft" | "issued",
});

function mapInvoice(d: any): Invoice {
  const invNumber = d.invoiceNumber || d.invoiceId || d._id;
  const custName = d.customerName || (typeof d.customer === 'string' ? d.customer : d.customerId?.name) || 'Customer';
  const gTotal = d.grandTotal !== undefined ? d.grandTotal : (d.amount || 0);

  return {
    ...d,
    id: invNumber,
    invoiceNumber: invNumber,
    customerName: custName,
    grandTotal: gTotal,
    amount: gTotal,
    issuedDate: d.issuedDate ? d.issuedDate.slice(0, 10) : (d.issued ? String(d.issued).slice(0, 10) : "—"),
    dueDate: d.dueDate ? d.dueDate.slice(0, 10) : (d.due ? String(d.due).slice(0, 10) : "—"),
    lines: Array.isArray(d.lines) ? d.lines : [],
    items: Array.isArray(d.lines) && d.lines.length > 0 ? d.lines.length : (d.items || 1),
    subtotal: d.subtotal || gTotal,
    totalTax: d.totalTax || 0,
    status: d.status || "draft"
  };
}

const billingListService: ListService<Invoice> = {
  getAll: async (params) => (await billingService.getAll(params)).map(mapInvoice),
  getPage: async (params) => {
    const result = await billingService.getPage(params);
    return { data: result.data.map(mapInvoice), pagination: result.pagination };
  },
};

export function Billing() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  
  // Modals & States
  const [showAdd, setShowAdd] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState(blankInvoiceForm());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Available Data
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");

  const searchLower = search.toLowerCase();

  const { items: invoiceList, allItems, pagination, page, setPage, reload } = usePaginatedList<Invoice>(
    billingListService,
    {
      apiParams: {
        search: searchLower || undefined,
        status: filter !== "All" ? filter : undefined,
      },
      deps: [search, filter],
    }
  );

  // Load CRM Customers & Product catalog on mount
  useEffect(() => {
    async function loadCatalog() {
      try {
        const custData = await crmService.getAll();
        setCustomers(Array.isArray(custData) ? custData : []);
      } catch (_) {}

      try {
        const prodData = await inventoryService.getAll();
        setProducts(Array.isArray(prodData) ? prodData : []);
      } catch (_) {}
    }
    loadCatalog();
  }, []);

  useEffect(() => {
    const handler = () => {
      setForm(blankInvoiceForm());
      setShowAdd(true);
    };
    window.addEventListener("open-new-invoice", handler);
    return () => window.removeEventListener("open-new-invoice", handler);
  }, []);

  // Handle Customer Selection
  function handleSelectCustomer(customerId: string) {
    const cust = customers.find(c => String(c._id) === String(customerId));
    if (!cust) return;

    const b = cust.billingAddress || {};
    const addr = [b.street, b.number, b.postcode, b.city, b.region, b.country || cust.country].filter(Boolean).join(', ');

    setForm(prev => ({
      ...prev,
      customerId: cust._id,
      customerName: cust.name,
      customerEmail: cust.email || "",
      customerVat: cust.vatNumber || "",
      customerAddress: addr,
      paymentTerms: cust.paymentTerms || "Net 30",
      bankInfo: cust.bankInfo || cust.iban || ""
    }));
  }

  // Handle Line Changes
  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setForm(prev => {
      const newLines = [...prev.lines];
      const updated = { ...newLines[index], ...patch };

      // Calculate Line Math Live
      const qty = Number(updated.quantity) || 0;
      const price = Number(updated.unitPrice) || 0;
      const disc = Number(updated.discount) || 0;
      const taxR = Number(updated.taxRate) || 0;

      const gross = qty * price;
      const discAmount = gross * (disc / 100);
      const sub = gross - discAmount;
      const tax = sub * (taxR / 100);

      updated.lineSubtotal = Math.round((sub + Number.EPSILON) * 100) / 100;
      updated.lineTax = Math.round((tax + Number.EPSILON) * 100) / 100;
      updated.lineTotal = Math.round(((sub + tax) + Number.EPSILON) * 100) / 100;

      newLines[index] = updated;
      return { ...prev, lines: newLines };
    });
  }

  function handleProductPick(index: number, sku: string) {
    const prod = products.find(p => p.sku === sku);
    if (!prod) return;

    updateLine(index, {
      sku: prod.sku,
      description: prod.name || prod.sku,
      unitPrice: prod.price || 0,
      uom: "EA",
      itemType: "product"
    });
  }

  function addLine() {
    setForm(prev => ({
      ...prev,
      lines: [...prev.lines, blankLine()]
    }));
  }

  function removeLine(index: number) {
    if (form.lines.length <= 1) {
      toast.error("An invoice must contain at least one line item.");
      return;
    }
    setForm(prev => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== index)
    }));
  }

  // Live Summary Calculation
  const liveSummary = useMemo(() => {
    let sub = 0;
    let tax = 0;
    const taxMap: Record<number, { taxable: number; tax: number }> = {};

    form.lines.forEach(line => {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unitPrice) || 0;
      const disc = Number(line.discount) || 0;
      const taxR = Number(line.taxRate !== undefined ? line.taxRate : 21);

      const gross = qty * price;
      const discAmount = gross * (disc / 100);
      const lineSub = gross - discAmount;
      const lineT = lineSub * (taxR / 100);

      sub += lineSub;
      tax += lineT;

      if (!taxMap[taxR]) taxMap[taxR] = { taxable: 0, tax: 0 };
      taxMap[taxR].taxable += lineSub;
      taxMap[taxR].tax += lineT;
    });

    const subtotal = Math.round((sub + Number.EPSILON) * 100) / 100;
    const totalTax = Math.round((tax + Number.EPSILON) * 100) / 100;
    const grandTotal = Math.round(((subtotal + totalTax) + Number.EPSILON) * 100) / 100;

    return { subtotal, totalTax, grandTotal, taxMap };
  }, [form.lines]);

  // Create / Save Invoice
  async function handleCreate(status: 'draft' | 'issued' = 'draft') {
    if (!form.customerId) {
      toast.error("Please select a valid CRM Customer.");
      return;
    }

    if (form.lines.length === 0) {
      toast.error("Please add at least one line item.");
      return;
    }

    for (let i = 0; i < form.lines.length; i++) {
      const l = form.lines[i];
      if (!l.description.trim()) {
        toast.error(`Line #${i + 1}: Description is required.`);
        return;
      }
      if (Number(l.quantity) <= 0 || isNaN(Number(l.quantity))) {
        toast.error(`Line #${i + 1}: Quantity must be greater than 0.`);
        return;
      }
      if (Number(l.unitPrice) < 0 || isNaN(Number(l.unitPrice))) {
        toast.error(`Line #${i + 1}: Unit price cannot be negative.`);
        return;
      }
    }

    try {
      const payload = {
        customerId: form.customerId,
        lines: form.lines,
        issuedDate: form.issuedDate,
        dueDate: form.dueDate,
        paymentTerms: form.paymentTerms,
        notes: form.notes,
        bankInfo: form.bankInfo,
        status
      };

      const created = await billingService.create(payload);
      toast.success(
        status === 'issued'
          ? `Invoice ${created.invoiceNumber} successfully created & issued!`
          : `Draft Invoice ${created.invoiceNumber} created.`
      );
      setShowAdd(false);
      setForm(blankInvoiceForm());
      reload();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t.common?.error || "Failed to create invoice");
    }
  }

  // Real Send Invoice Action
  async function handleSend(inv: Invoice) {
    setSendingId(inv._id);
    try {
      const res = await billingService.sendInvoice(inv._id);
      toast.success(res.message || `Invoice ${inv.invoiceNumber} sent to ${res.dispatch?.recipient || inv.customerEmail}!`);
      reload();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to send invoice email.");
    } finally {
      setSendingId(null);
    }
  }

  // Real PDF Download Action
  async function handleDownloadPdf(inv: Invoice) {
    setDownloadingId(inv._id);
    try {
      await billingService.downloadPdf(inv._id, `${inv.invoiceNumber}.pdf`);
      toast.success(`Downloaded ${inv.invoiceNumber}.pdf`);
    } catch (err: any) {
      toast.error("Failed to generate and download PDF stream.");
    } finally {
      setDownloadingId(null);
    }
  }

  // Mark Paid
  async function handleMarkPaid(inv: Invoice) {
    if (!confirm(`Mark Invoice ${inv.invoiceNumber || inv.id} as PAID in full (€${(inv.grandTotal || inv.amount || 0).toFixed(2)})?`)) return;
    try {
      const targetId = inv._id || inv.id || inv.invoiceNumber;
      await billingService.markPaid(targetId);
      toast.success(`Invoice ${inv.invoiceNumber || inv.id} marked as paid.`);
      setShowDetails(false);
      reload();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to mark invoice as paid.");
    }
  }

  const filters = ["All", "draft", "issued", "sent", "paid", "cancelled"];
  const paidTotal = allItems.filter(inv => inv.status === "paid").reduce((a, inv) => a + (inv.grandTotal || inv.amount || 0), 0);
  const outstandingTotal = allItems.filter(inv => inv.status === "issued" || inv.status === "sent").reduce((a, inv) => a + (inv.grandTotal || inv.amount || 0), 0);
  const draftCount = allItems.filter(inv => inv.status === "draft").length;

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.billing.totalInvoices, value: allItems.length, icon: ReceiptText, color: "text-primary" },
          { label: "Revenue Collected", value: `€${(paidTotal / 1000).toFixed(1)}k`, icon: CheckCircle2, color: "text-success" },
          { label: "Outstanding Receivables", value: `€${outstandingTotal.toFixed(0)}`, icon: Clock, color: "text-warning" },
          { label: "Draft Invoices", value: draftCount, icon: FileText, color: "text-blue-500" },
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

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice number, customer, email…"
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors"
            style={{ fontSize: "0.875rem" }}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
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
        <PrimaryButton icon={Plus} onClick={() => { setForm(blankInvoiceForm()); setShowAdd(true); }}>
          {t.billing.newInvoice}
        </PrimaryButton>
      </div>

      {/* Invoices Master Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">Invoice #</th>
              <th className="text-left px-4 py-3">Customer / Company</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Issue Date</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">Due Date</th>
              <th className="text-center px-4 py-3 hidden sm:table-cell">Lines</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Total Amount</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoiceList.map((inv, i) => (
              <tr key={inv._id || inv.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                <td className="px-4 py-3 font-semibold text-primary" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem" }}>
                  {inv.invoiceNumber || inv.id}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{inv.customerName}</div>
                  {inv.customerVat && <div className="text-[11px] text-muted-foreground">VAT: {inv.customerVat}</div>}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">{inv.issuedDate}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">{inv.dueDate}</td>
                <td className="px-4 py-3 text-center hidden sm:table-cell text-muted-foreground font-mono text-xs">{inv.items}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="px-4 py-3 text-right font-bold text-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  €{(inv.grandTotal || inv.amount || 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {/* View Details */}
                    <button
                      onClick={() => { setSelectedInvoice(inv); setShowDetails(true); }}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      title="View Invoice Details"
                    >
                      <Eye className="size-3.5" />
                    </button>

                    {/* Download PDF */}
                    <button
                      onClick={() => handleDownloadPdf(inv)}
                      disabled={downloadingId === inv._id}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                      title="Download Official Invoice PDF"
                    >
                      <Download className={`size-3.5 ${downloadingId === inv._id ? 'animate-bounce text-primary' : ''}`} />
                    </button>

                    {/* Send Invoice Email */}
                    {inv.status !== "paid" && inv.status !== "cancelled" && (
                      <button
                        onClick={() => handleSend(inv)}
                        disabled={sendingId === inv._id}
                        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                        title={inv.status === "sent" ? "Resend Invoice Email" : "Send Invoice to Customer Email"}
                      >
                        <Send className={`size-3.5 ${sendingId === inv._id ? 'animate-spin text-primary' : ''}`} />
                      </button>
                    )}

                    {/* Mark Paid */}
                    {(inv.status === "issued" || inv.status === "sent") && (
                      <button
                        onClick={() => handleMarkPaid(inv)}
                        className="p-1.5 rounded-lg hover:bg-emerald-500/10 transition-colors text-muted-foreground hover:text-emerald-600"
                        title="Mark Invoice as Paid"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {invoiceList.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-muted-foreground">{t.common.noResults}</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>

      {/* Invoice Creation Studio Modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={t.billing.createCommercialInvoice}
        subtitle={t.billing.modalSubtitle}
        footer={
          <div className="flex items-center justify-between w-full">
            <ModalCancel onClose={() => setShowAdd(false)} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleCreate('draft')}
                className="px-4 py-2 rounded-lg text-xs font-bold border border-border bg-card hover:bg-secondary transition-colors text-foreground"
              >
                {t.billing.saveAsDraft}
              </button>
              <button
                type="button"
                onClick={() => handleCreate('issued')}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-sm"
              >
                {t.billing.issueAndFinalize}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1">
          {/* Section 1: Customer Selection */}
          <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-3">
            <div className="font-semibold text-xs text-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Building className="size-3.5 text-primary" /> {t.billing.selectCrmCustomer}
            </div>

            <Row>
              <Field label={t.billing.authoritativeCustomer} required>
                <Select
                  value={form.customerId}
                  onChange={(e) => handleSelectCustomer(e.target.value)}
                >
                  <option value="">{t.billing.chooseCustomer}</option>
                  {customers.map(c => (
                    <option key={c._id} value={c._id}>
                      {c.name} {c.vatNumber ? `(${c.vatNumber})` : ''} — {c.email}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t.billing.recipientEmail}>
                <Input
                  value={form.customerEmail}
                  onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                  placeholder="customer@company.com"
                />
              </Field>
            </Row>

            {form.customerId && (
              <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2 bg-card p-2.5 rounded-lg border border-border/60">
                <div><strong>VAT ID:</strong> {form.customerVat || "N/A"}</div>
                <div><strong>Payment Terms:</strong> {form.paymentTerms}</div>
                <div className="col-span-2"><strong>Billing Address:</strong> {form.customerAddress || "No structured address"}</div>
              </div>
            )}
          </div>

          {/* Section 2: Dates & Terms */}
          <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-3">
            <div className="font-semibold text-xs text-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Calendar className="size-3.5 text-primary" /> {t.billing.invoiceDatesAndTerms}
            </div>
            <Row>
              <Field label={t.billing.issueDate} required>
                <Input
                  type="date"
                  value={form.issuedDate}
                  onChange={(e) => setForm({ ...form, issuedDate: e.target.value })}
                />
              </Field>
              <Field label={t.billing.dueDate}>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </Field>
              <Field label={t.crm.paymentTermsLabel}>
                <Select
                  value={form.paymentTerms}
                  onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                >
                  <option value="Due on Receipt">Due on Receipt</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                </Select>
              </Field>
            </Row>
          </div>

          {/* Section 3: Dynamic Multi-Line Items */}
          <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-xs text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="size-3.5 text-primary" /> {t.billing.invoiceProductsAndServices} ({form.lines.length} Line{form.lines.length > 1 ? 's' : ''})
              </div>
              <button
                type="button"
                onClick={addLine}
                className="px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-bold transition-colors flex items-center gap-1"
              >
                <Plus className="size-3" /> {t.billing.addItemLine}
              </button>
            </div>

            <div className="space-y-2.5">
              {form.lines.map((line, idx) => (
                <div key={idx} className="bg-card p-3 rounded-lg border border-border space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-muted-foreground">#{idx + 1}</span>
                      <div className="flex rounded border border-border overflow-hidden text-[10px]">
                        <button
                          type="button"
                          onClick={() => updateLine(idx, { itemType: 'product' })}
                          className={`px-2 py-0.5 font-bold ${line.itemType === 'product' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
                        >
                          {t.billing.itemTypeProduct}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateLine(idx, { itemType: 'service', sku: '' })}
                          className={`px-2 py-0.5 font-bold ${line.itemType === 'service' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
                        >
                          {t.billing.itemTypeService}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-foreground">
                        Total: €{line.lineTotal?.toFixed(2) || "0.00"}
                      </span>
                      {form.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-destructive hover:bg-destructive/10 p-1 rounded transition-colors"
                          title="Remove line"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-2">
                    {/* SKU Selection or Code */}
                    {line.itemType === 'product' ? (
                      <div className="col-span-4">
                        <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.skuCatalog}</label>
                        <Select
                          value={line.sku}
                          onChange={(e) => handleProductPick(idx, e.target.value)}
                        >
                          <option value="">-- Choose SKU --</option>
                          {products.map(p => (
                            <option key={p.sku} value={p.sku}>
                              {p.sku} - {p.name} (€{p.price || 0})
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <div className="col-span-4">
                        <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.serviceCode}</label>
                        <Input
                          value={line.sku}
                          onChange={(e) => updateLine(idx, { sku: e.target.value })}
                          placeholder="e.g. SRV-STORAGE"
                        />
                      </div>
                    )}

                    {/* Description */}
                    <div className="col-span-8">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.description}</label>
                      <Input
                        value={line.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        placeholder="Item or service description…"
                      />
                    </div>

                    {/* Quantity */}
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.quantity}</label>
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                      />
                    </div>

                    {/* Unit Price */}
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.unitPrice}</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) })}
                      />
                    </div>

                    {/* Tax Rate */}
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.vatRate}</label>
                      <Select
                        value={line.taxRate !== undefined ? line.taxRate : 21}
                        onChange={(e) => updateLine(idx, { taxRate: Number(e.target.value) })}
                      >
                        <option value="21">21% (Standard)</option>
                        <option value="10">10% (Reduced)</option>
                        <option value="4">4% (Super-reduced)</option>
                        <option value="0">0% (Exempt)</option>
                      </Select>
                    </div>

                    {/* Discount */}
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.billing.discount}</label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={line.discount || 0}
                        onChange={(e) => updateLine(idx, { discount: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Live Calculated Totals */}
          <div className="bg-gradient-to-r from-card to-secondary/30 p-4 rounded-xl border border-border flex justify-between items-center text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {t.billing.subtotalExclTax}: <strong>€{liveSummary.subtotal.toFixed(2)}</strong>
              </div>
              <div className="text-muted-foreground">
                {t.billing.totalVat}: <strong>€{liveSummary.totalTax.toFixed(2)}</strong>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {Object.entries(liveSummary.taxMap).map(([rate, val]) => (
                  <span key={rate} className="mr-3">
                    VAT {rate}%: €{val.tax.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs uppercase font-bold text-muted-foreground">{t.billing.totalPayable}</div>
              <div className="text-2xl font-black text-primary font-mono">
                €{liveSummary.grandTotal.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Invoice Details View Modal */}
      {selectedInvoice && (
        <Modal
          open={showDetails}
          onClose={() => setShowDetails(false)}
          title={`Invoice ${selectedInvoice.invoiceNumber || selectedInvoice.id}`}
          subtitle={`Issued to ${selectedInvoice.customerName} • Status: ${selectedInvoice.status.toUpperCase()}`}
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowDetails(false)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(selectedInvoice)}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-secondary hover:bg-secondary/80 transition-colors flex items-center gap-1.5"
                >
                  <Download className="size-3.5" /> {t.billing.downloadPdf}
                </button>
                {selectedInvoice.status !== "paid" && selectedInvoice.status !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() => handleSend(selectedInvoice)}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                  >
                    <Send className="size-3.5" /> {t.billing.sendToCustomer}
                  </button>
                )}
                {(selectedInvoice.status === "issued" || selectedInvoice.status === "sent") && (
                  <button
                    type="button"
                    onClick={() => handleMarkPaid(selectedInvoice)}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Check className="size-3.5" /> {t.billing.markAsPaid}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 bg-secondary/20 rounded-lg border border-border">
              <div><strong>Customer:</strong> {selectedInvoice.customerName}</div>
              <div><strong>Email:</strong> {selectedInvoice.customerEmail || "N/A"}</div>
              <div><strong>VAT/Tax ID:</strong> {selectedInvoice.customerVat || "N/A"}</div>
              <div><strong>Payment Terms:</strong> {selectedInvoice.paymentTerms || "Net 30"}</div>
              <div><strong>Issue Date:</strong> {selectedInvoice.issuedDate}</div>
              <div><strong>Due Date:</strong> {selectedInvoice.dueDate}</div>
              {selectedInvoice.sentAt && (
                <div className="col-span-2 text-emerald-600 font-semibold flex items-center gap-1">
                  <Mail className="size-3" /> Dispatched to {selectedInvoice.sentTo} on {new Date(selectedInvoice.sentAt).toLocaleString()}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 font-bold text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-2.5">#</th>
                    <th className="text-left p-2.5">SKU / Code</th>
                    <th className="text-left p-2.5">{t.billing.description}</th>
                    <th className="text-right p-2.5">{t.billing.quantity}</th>
                    <th className="text-right p-2.5">{t.billing.unitPrice}</th>
                    <th className="text-right p-2.5">{t.billing.vatRate}</th>
                    <th className="text-right p-2.5">{t.common.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2.5 font-bold">{i + 1}</td>
                      <td className="p-2.5 font-mono text-primary">{l.sku || "SERVICE"}</td>
                      <td className="p-2.5">{l.description}</td>
                      <td className="p-2.5 text-right">{l.quantity} {l.uom || "EA"}</td>
                      <td className="p-2.5 text-right">€{(l.unitPrice || 0).toFixed(2)}</td>
                      <td className="p-2.5 text-right">{l.taxRate || 21}%</td>
                      <td className="p-2.5 text-right font-mono font-bold">€{(l.lineTotal || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-secondary/30 rounded-lg flex justify-between items-center text-xs">
              <div>
                <div>{t.billing.subtotalExclTax}: <strong>€{selectedInvoice.subtotal.toFixed(2)}</strong></div>
                <div>{t.billing.totalVat}: <strong>€{selectedInvoice.totalTax.toFixed(2)}</strong></div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground uppercase text-[10px]">{t.billing.totalPayable}</div>
                <div className="text-xl font-bold font-mono text-primary">€{selectedInvoice.grandTotal.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
