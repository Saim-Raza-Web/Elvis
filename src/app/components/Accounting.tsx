import { useState, useEffect, useMemo } from "react";
import {
  BookOpen, TrendingUp, TrendingDown, DollarSign, BarChart3, Download,
  Plus, Search, Receipt, Landmark, FileText, ArrowRightLeft, Check,
  AlertCircle, CheckCircle2, RotateCcw, Trash2, Eye, Calendar, Building,
  CreditCard, ShieldCheck, Tag, Info, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { accountingService, SupplierBill, JournalEntry, BillLine, JournalLine, AccountItem } from "../../services/accounting.service";
import { suppliersService, Supplier } from "../../services/suppliers.service";

type ActiveTab = "overview" | "bills" | "journals" | "ledger";

const STANDARD_EXPENSE_ACCOUNTS = [
  "Operating Expenses",
  "Inventory Purchases",
  "Warehouse & Storage Expenses",
  "Logistics & Freight Expense",
  "Utilities & Power",
  "Rent & Facilities",
  "Office & Admin Expenses",
  "Maintenance & Repairs"
];

const STANDARD_PAYMENT_ACCOUNTS = [
  "Cash & Cash Equivalents",
  "Banco Santander (Main Operating EUR)",
  "BBVA Corporate Account",
  "Petty Cash"
];

const ALL_CHART_ACCOUNTS = [
  "Cash & Cash Equivalents",
  "Accounts Receivable",
  "Inventory Assets",
  "Input VAT (Tax Deductible)",
  "Accounts Payable",
  "Output VAT (Taxes Payable)",
  "Sales Revenue",
  "Operating Expenses",
  "Inventory Purchases",
  "Warehouse & Storage Expenses",
  "Logistics & Freight Expense",
  "Utilities & Power",
  "Rent & Facilities",
  "Office & Admin Expenses",
  "Maintenance & Repairs"
];

const blankBillLine = (): BillLine => ({
  expenseAccount: "Operating Expenses",
  description: "",
  quantity: 1,
  uom: "EA",
  unitPrice: 0,
  discount: 0,
  taxRate: 21,
  lineSubtotal: 0,
  lineTax: 0,
  lineTotal: 0
});

export function Accounting() {
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  // ── Overview State ──────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalExpenses: 0,
    netProfit: 0,
    profitMargin: 0,
    accountsPayable: 0,
    accountsReceivable: 0
  });

  // ── Supplier Bills State ──────────────────────────────────────────────────
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [billsPage, setBillsPage] = useState(1);
  const [billsPagination, setBillsPagination] = useState<any>(null);
  const [billSearch, setBillSearch] = useState("");
  const [billStatusFilter, setBillStatusFilter] = useState("all");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // ── Bill Modals State ─────────────────────────────────────────────────────
  const [showCreateBill, setShowCreateBill] = useState(false);
  const [billEditMode, setBillEditMode] = useState<"create" | "edit">("create");
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [billForm, setBillForm] = useState<{
    supplierId: string;
    supplierInvoiceNumber: string;
    billDate: string;
    dueDate: string;
    paymentTerms: string;
    lines: BillLine[];
    notes: string;
  }>({
    supplierId: "",
    supplierInvoiceNumber: "",
    billDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    paymentTerms: "Net 30",
    lines: [blankBillLine()],
    notes: ""
  });

  const [selectedBill, setSelectedBill] = useState<SupplierBill | null>(null);
  const [showBillDetails, setShowBillDetails] = useState(false);

  // ── Payment Modal State ───────────────────────────────────────────────────
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    paymentMethod: "Bank Transfer",
    paymentAccount: "Cash & Cash Equivalents",
    reference: "",
    notes: "",
    date: new Date().toISOString().slice(0, 10)
  });

  // ── Reversal Modal State ──────────────────────────────────────────────────
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<{ type: "bill" | "journal"; id: string; number: string } | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  // ── Journal Entries State ─────────────────────────────────────────────────
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalPage, setJournalPage] = useState(1);
  const [journalPagination, setJournalPagination] = useState<any>(null);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalTypeFilter, setJournalTypeFilter] = useState("all");

  const [showCreateJournal, setShowCreateJournal] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState<JournalEntry | null>(null);
  const [showJournalDetails, setShowJournalDetails] = useState(false);
  const [journalForm, setJournalForm] = useState<{
    date: string;
    reference: string;
    description: string;
    notes: string;
    lines: JournalLine[];
  }>({
    date: new Date().toISOString().slice(0, 10),
    reference: "",
    description: "",
    notes: "",
    lines: [
      { account: "Operating Expenses", description: "", debit: 0, credit: 0 },
      { account: "Cash & Cash Equivalents", description: "", debit: 0, credit: 0 }
    ]
  });

  // ── General Ledger State ──────────────────────────────────────────────────
  const [ledgerTxns, setLedgerTxns] = useState<any[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPagination, setLedgerPagination] = useState<any>(null);
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState("all");
  const [ledgerSearch, setLedgerSearch] = useState("");

  // ── Data Loaders ──────────────────────────────────────────────────────────
  async function loadOverview() {
    try {
      const data = await accountingService.getAll();
      setAccounts(data.accounts || []);
      setTransactions((data.transactions as any)?.data || []);
      if (data.stats) {
        setStats(data.stats);
      }
    } catch {
      toast.error(t.common?.error || "Failed to load accounting overview");
    }
  }

  async function loadSuppliers() {
    try {
      const sups = await suppliersService.getAll();
      setSuppliers(sups);
    } catch {
      console.warn("Could not load suppliers list");
    }
  }

  async function loadBills() {
    try {
      const params: Record<string, unknown> = { page: billsPage, limit: 15 };
      if (billSearch.trim()) params.search = billSearch.trim();
      if (billStatusFilter !== "all") params.status = billStatusFilter;
      const res = await accountingService.getBills(params);
      setBills(res.data || []);
      setBillsPagination(res.pagination || null);
    } catch {
      toast.error("Failed to load supplier bills");
    }
  }

  async function loadJournalEntries() {
    try {
      const params: Record<string, unknown> = { page: journalPage, limit: 15 };
      if (journalSearch.trim()) params.search = journalSearch.trim();
      if (journalTypeFilter !== "all") params.entryType = journalTypeFilter;
      const res = await accountingService.getJournalEntries(params);
      setJournalEntries(res.data || []);
      setJournalPagination(res.pagination || null);
    } catch {
      toast.error("Failed to load journal entries");
    }
  }

  async function loadLedger() {
    try {
      const params: Record<string, unknown> = { page: ledgerPage, limit: 20 };
      if (ledgerSearch.trim()) params.search = ledgerSearch.trim();
      if (ledgerAccountFilter !== "all") params.account = ledgerAccountFilter;
      const res = await accountingService.getPage(params);
      setLedgerTxns((res.transactions as any)?.data || []);
      setLedgerPagination((res.transactions as any)?.pagination || null);
    } catch {
      toast.error("Failed to load ledger transactions");
    }
  }

  useEffect(() => {
    loadOverview();
    loadSuppliers();
  }, []);

  useEffect(() => {
    if (activeTab === "bills") loadBills();
    if (activeTab === "journals") loadJournalEntries();
    if (activeTab === "ledger") loadLedger();
    if (activeTab === "overview") loadOverview();
  }, [activeTab, billsPage, billStatusFilter, journalPage, journalTypeFilter, ledgerPage, ledgerAccountFilter]);

  // ── Live Calculation: Supplier Bill Form ──────────────────────────────────
  const liveBillSummary = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let totalTax = 0;
    const taxMap: Record<number, { taxRate: number; taxableAmount: number; taxAmount: number }> = {};

    const computedLines = billForm.lines.map(line => {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unitPrice) || 0;
      const disc = Math.max(0, Math.min(100, Number(line.discount) || 0));
      const rate = Math.max(0, Number(line.taxRate) || 0);

      const rawSub = Math.round((qty * price) * 100) / 100;
      const lineDisc = Math.round((rawSub * (disc / 100)) * 100) / 100;
      const lineNet = Math.round((rawSub - lineDisc) * 100) / 100;
      const lineTax = Math.round((lineNet * (rate / 100)) * 100) / 100;
      const lineTot = Math.round((lineNet + lineTax) * 100) / 100;

      subtotal += rawSub;
      discountTotal += lineDisc;
      totalTax += lineTax;

      if (!taxMap[rate]) {
        taxMap[rate] = { taxRate: rate, taxableAmount: 0, taxAmount: 0 };
      }
      taxMap[rate].taxableAmount += lineNet;
      taxMap[rate].taxAmount += lineTax;

      return { ...line, lineSubtotal: lineNet, lineTax, lineTotal: lineTot };
    });

    const netSubtotal = Math.round((subtotal - discountTotal) * 100) / 100;
    const grandTotal = Math.round((netSubtotal + totalTax) * 100) / 100;

    return {
      lines: computedLines,
      subtotal: netSubtotal,
      discountTotal: Math.round(discountTotal * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      grandTotal,
      taxMap
    };
  }, [billForm.lines]);

  // ── Live Calculation: Manual Journal Entry Form ───────────────────────────
  const liveJournalSummary = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;

    journalForm.lines.forEach(l => {
      totalDebit += Number(l.debit) || 0;
      totalCredit += Number(l.credit) || 0;
    });

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;
    const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    const isBalanced = difference === 0 && totalDebit > 0 && journalForm.lines.length >= 2;

    return { totalDebit, totalCredit, difference, isBalanced };
  }, [journalForm.lines]);

  // ── Supplier Bill Handlers ────────────────────────────────────────────────
  function handleOpenCreateBill() {
    setBillEditMode("create");
    setEditingBillId(null);
    setBillForm({
      supplierId: suppliers[0]?._id || "",
      supplierInvoiceNumber: "",
      billDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      paymentTerms: "Net 30",
      lines: [blankBillLine()],
      notes: ""
    });
    setShowCreateBill(true);
  }

  function handleAddBillLine() {
    setBillForm(prev => ({
      ...prev,
      lines: [...prev.lines, blankBillLine()]
    }));
  }

  function handleUpdateBillLine(index: number, updates: Partial<BillLine>) {
    setBillForm(prev => {
      const copy = [...prev.lines];
      copy[index] = { ...copy[index], ...updates };
      return { ...prev, lines: copy };
    });
  }

  function handleRemoveBillLine(index: number) {
    if (billForm.lines.length <= 1) return;
    setBillForm(prev => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== index)
    }));
  }

  async function handleSaveBill(initialStatus: "draft" | "posted") {
    try {
      if (!billForm.supplierId) {
        toast.error("Please select an authoritative supplier.");
        return;
      }
      if (!billForm.supplierInvoiceNumber.trim()) {
        toast.error("Please enter the supplier invoice reference number.");
        return;
      }

      for (let i = 0; i < billForm.lines.length; i++) {
        const l = billForm.lines[i];
        if (!l.description.trim()) {
          toast.error(`Line #${i + 1}: Description is required.`);
          return;
        }
        if (Number(l.unitPrice) <= 0) {
          toast.error(`Line #${i + 1}: Unit price must be greater than 0.`);
          return;
        }
      }

      const payload = {
        supplierId: billForm.supplierId,
        supplierInvoiceNumber: billForm.supplierInvoiceNumber.trim(),
        billDate: billForm.billDate,
        dueDate: billForm.dueDate,
        paymentTerms: billForm.paymentTerms,
        lines: billForm.lines,
        notes: billForm.notes,
        status: initialStatus
      };

      if (billEditMode === "create") {
        await accountingService.createBill(payload);
        toast.success(initialStatus === "posted" ? "Supplier bill posted to accounting ledger!" : "Supplier bill saved as draft.");
      } else if (editingBillId) {
        await accountingService.updateBill(editingBillId, payload);
        toast.success("Draft supplier bill updated successfully.");
      }

      setShowCreateBill(false);
      loadBills();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save supplier bill");
    }
  }

  async function handlePostExistingBill(bill: SupplierBill) {
    try {
      await accountingService.postBill(bill._id);
      toast.success(`Bill ${bill.billNumber} posted to accounting ledger!`);
      loadBills();
      loadOverview();
      if (selectedBill?._id === bill._id) {
        const updated = await accountingService.getBillById(bill._id);
        setSelectedBill(updated);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to post bill");
    }
  }

  function handleOpenPaymentModal(bill: SupplierBill) {
    setSelectedBill(bill);
    setPaymentForm({
      amount: bill.outstandingAmount,
      paymentMethod: "Bank Transfer",
      paymentAccount: "Cash & Cash Equivalents",
      reference: `PMT-${bill.supplierInvoiceNumber}`,
      notes: `Payment for bill ${bill.billNumber}`,
      date: new Date().toISOString().slice(0, 10)
    });
    setShowPaymentModal(true);
  }

  async function handleRecordPayment() {
    if (!selectedBill) return;
    try {
      if (paymentForm.amount <= 0) {
        toast.error("Payment amount must be greater than 0.");
        return;
      }
      if (paymentForm.amount > selectedBill.outstandingAmount) {
        toast.error(`Payment cannot exceed outstanding amount (€${selectedBill.outstandingAmount.toFixed(2)}).`);
        return;
      }

      await accountingService.payBill(selectedBill._id, paymentForm);
      toast.success(`Payment of €${Number(paymentForm.amount).toFixed(2)} recorded successfully.`);
      setShowPaymentModal(false);
      loadBills();
      loadOverview();
      if (showBillDetails) {
        const updated = await accountingService.getBillById(selectedBill._id);
        setSelectedBill(updated);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to record payment");
    }
  }

  function handleOpenReverseModal(type: "bill" | "journal", id: string, number: string) {
    setReverseTarget({ type, id, number });
    setReversalReason("");
    setShowReverseModal(true);
  }

  async function handleConfirmReversal() {
    if (!reverseTarget) return;
    try {
      if (reverseTarget.type === "bill") {
        await accountingService.reverseBill(reverseTarget.id, { reason: reversalReason });
        toast.success(`Bill ${reverseTarget.number} successfully reversed with offsetting journal entry.`);
        loadBills();
      } else {
        await accountingService.reverseJournalEntry(reverseTarget.id, { reason: reversalReason });
        toast.success(`Journal entry ${reverseTarget.number} successfully reversed.`);
        loadJournalEntries();
      }

      setShowReverseModal(false);
      loadOverview();
      if (showBillDetails && selectedBill?._id === reverseTarget.id) {
        const updated = await accountingService.getBillById(reverseTarget.id);
        setSelectedBill(updated);
      }
      if (showJournalDetails && selectedJournal?._id === reverseTarget.id) {
        const updated = await accountingService.getJournalEntryById(reverseTarget.id);
        setSelectedJournal(updated);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to reverse document");
    }
  }

  async function handleDeleteDraftBill(bill: SupplierBill) {
    if (!confirm(`Are you sure you want to delete draft bill ${bill.billNumber}?`)) return;
    try {
      await accountingService.deleteBill(bill._id);
      toast.success(`Draft bill ${bill.billNumber} deleted.`);
      loadBills();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete bill");
    }
  }

  // ── Manual Journal Entry Handlers ─────────────────────────────────────────
  function handleOpenCreateJournal() {
    setJournalForm({
      date: new Date().toISOString().slice(0, 10),
      reference: "",
      description: "",
      notes: "",
      lines: [
        { account: "Operating Expenses", description: "", debit: 0, credit: 0 },
        { account: "Cash & Cash Equivalents", description: "", debit: 0, credit: 0 }
      ]
    });
    setShowCreateJournal(true);
  }

  function handleAddJournalLine() {
    setJournalForm(prev => ({
      ...prev,
      lines: [...prev.lines, { account: "Operating Expenses", description: "", debit: 0, credit: 0 }]
    }));
  }

  function handleUpdateJournalLine(index: number, updates: Partial<JournalLine>) {
    setJournalForm(prev => {
      const copy = [...prev.lines];
      copy[index] = { ...copy[index], ...updates };
      return { ...prev, lines: copy };
    });
  }

  function handleRemoveJournalLine(index: number) {
    if (journalForm.lines.length <= 2) {
      toast.warning("A double-entry journal entry requires at least two lines.");
      return;
    }
    setJournalForm(prev => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== index)
    }));
  }

  async function handleSaveJournalEntry() {
    try {
      if (!journalForm.description.trim()) {
        toast.error("Please enter a description for the journal entry.");
        return;
      }
      if (!liveJournalSummary.isBalanced) {
        toast.error("Journal entry is unbalanced. Total Debits must equal Total Credits.");
        return;
      }

      await accountingService.createJournalEntry({
        date: journalForm.date,
        reference: journalForm.reference.trim(),
        description: journalForm.description.trim(),
        notes: journalForm.notes.trim(),
        lines: journalForm.lines
      });

      toast.success("Double-entry journal entry posted successfully!");
      setShowCreateJournal(false);
      loadJournalEntries();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to create journal entry");
    }
  }

  function handleExport() {
    toast.success(t.accounting.exportSuccess);
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex items-center gap-2 overflow-x-auto text-sm font-semibold">
          {[
            { id: "overview", label: t.accounting.tabOverview, icon: BookOpen },
            { id: "bills", label: t.accounting.tabBills, icon: Receipt },
            { id: "journals", label: t.accounting.tabJournalEntries, icon: ArrowRightLeft },
            { id: "ledger", label: t.accounting.tabLedger, icon: FileText }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all text-xs md:text-sm ${
                  active
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <Icon className="size-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SecondaryButton icon={Plus} onClick={handleOpenCreateJournal}>
            {t.accounting.newJournalEntry}
          </SecondaryButton>
          <PrimaryButton icon={Plus} onClick={handleOpenCreateBill}>
            {t.accounting.recordSupplierBill}
          </PrimaryButton>
          <SecondaryButton icon={Download} onClick={handleExport}>
            {t.accounting.exportReport}
          </SecondaryButton>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: OVERVIEW & CHART OF ACCOUNTS */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Key Financial Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { label: t.accounting.revenueYTD, value: `€${(stats.totalRevenue / 1000).toFixed(1)}k`, icon: TrendingUp, color: "text-success", bg: "bg-success/10" },
              { label: t.accounting.expensesYTD, value: `€${(stats.totalExpenses / 1000).toFixed(1)}k`, icon: TrendingDown, color: "text-destructive", bg: "bg-destructive/10" },
              { label: t.accounting.netProfit, value: `€${(stats.netProfit / 1000).toFixed(1)}k`, icon: DollarSign, color: "text-primary", bg: "bg-primary/10" },
              { label: t.accounting.margin, value: `${stats.profitMargin}%`, icon: BarChart3, color: "text-amber-500", bg: "bg-amber-500/10" },
              { label: t.accounting.accountsPayable, value: `€${stats.accountsPayable.toLocaleString()}`, icon: Landmark, color: "text-purple-500", bg: "bg-purple-500/10" },
              { label: t.accounting.accountsReceivable, value: `€${stats.accountsReceivable.toLocaleString()}`, icon: Receipt, color: "text-blue-500", bg: "bg-blue-500/10" }
            ].map((s, i) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-3.5 hover-lift animate-pop-in flex flex-col justify-between" style={{ animationDelay: `${i * 35}ms` }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground truncate">{s.label}</span>
                  <div className={`p-1.5 rounded-md ${s.bg}`}>
                    <s.icon className={`size-3.5 ${s.color}`} />
                  </div>
                </div>
                <div className="font-bold text-lg" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Dynamic Chart of Accounts Table */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <BookOpen className="size-4 text-primary" /> {t.accounting.chartOfAccounts}
                </h3>
                <span className="text-xs text-muted-foreground">{accounts.length} Accounts</span>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {accounts.map(acc => (
                  <div key={acc.name} className="flex items-center justify-between p-2 rounded-lg bg-secondary/20 hover:bg-secondary/40 transition-colors text-xs border border-border/50">
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="font-semibold text-foreground truncate">{acc.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-bold ${
                          acc.category === 'Asset' ? 'bg-blue-500/15 text-blue-500' :
                          acc.category === 'Liability' ? 'bg-purple-500/15 text-purple-500' :
                          acc.category === 'Revenue' ? 'bg-emerald-500/15 text-emerald-500' :
                          acc.category === 'Expense' ? 'bg-amber-500/15 text-amber-500' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {acc.category}
                        </span>
                        <span className={`text-[10px] ${acc.change >= 0 ? "text-success" : "text-destructive"}`}>
                          {acc.change >= 0 ? "+" : ""}€{Math.abs(acc.change || 0).toFixed(1)}
                        </span>
                      </div>
                    </div>
                    <div className="font-mono font-bold text-right shrink-0">
                      <span className={acc.balance < 0 ? "text-destructive" : "text-foreground"}>
                        €{acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Double-Entry Audit Transactions */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <FileText className="size-4 text-primary" /> {t.accounting.recentTransactions}
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveTab("ledger")}
                  className="text-xs text-primary hover:underline font-semibold"
                >
                  View Full General Ledger →
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] font-bold border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5">Date</th>
                      <th className="text-left px-3 py-2.5">Reference</th>
                      <th className="text-left px-3 py-2.5">Description & Account</th>
                      <th className="text-left px-3 py-2.5">Category</th>
                      <th className="text-right px-3 py-2.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 8).map((txn, i) => (
                      <tr key={txn.id || i} className="border-t border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground font-mono">{txn.date?.slice(0, 10) || "—"}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-primary">{txn.reference || txn.txnId || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground truncate max-w-[220px]">{txn.description}</div>
                          <div className="text-[10px] text-muted-foreground">{txn.account}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-medium">{txn.category || "General"}</span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${txn.type === "credit" ? "text-success" : "text-destructive"}`}>
                          {txn.type === "credit" ? "+" : "-"}€{Math.abs(Number(txn.amount) || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: EXPENSES & SUPPLIER BILLS */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "bills" && (
        <div className="space-y-4">
          {/* Action & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border">
            <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search bills by #, supplier, invoice ref…"
                  value={billSearch}
                  onChange={e => { setBillSearch(e.target.value); setBillsPage(1); }}
                  className="w-full bg-secondary/40 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <select
                value={billStatusFilter}
                onChange={e => { setBillStatusFilter(e.target.value); setBillsPage(1); }}
                className="bg-secondary/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option>
                <option value="reversed">Reversed</option>
              </select>
            </div>

            <PrimaryButton icon={Plus} onClick={handleOpenCreateBill}>
              {t.accounting.recordSupplierBill}
            </PrimaryButton>
          </div>

          {/* Supplier Bills Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 font-bold text-muted-foreground uppercase text-[10px] border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-3">{t.accounting.billNumber}</th>
                    <th className="text-left px-3 py-3">{t.accounting.supplier}</th>
                    <th className="text-left px-3 py-3">{t.accounting.supplierInvoiceNo}</th>
                    <th className="text-left px-3 py-3">{t.accounting.billDate}</th>
                    <th className="text-right px-3 py-3">{t.accounting.totalPayable}</th>
                    <th className="text-right px-3 py-3">{t.accounting.amountPaid}</th>
                    <th className="text-right px-3 py-3">{t.accounting.outstanding}</th>
                    <th className="text-center px-3 py-3">{t.common.status}</th>
                    <th className="text-right px-3 py-3">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        No supplier bills found. Click "+ Record Supplier Bill / Expense" to create one.
                      </td>
                    </tr>
                  ) : (
                    bills.map(bill => (
                      <tr key={bill._id} className="border-t border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-bold text-primary">{bill.billNumber}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-foreground">{bill.supplierName}</div>
                          {bill.supplierTaxId && <div className="text-[10px] text-muted-foreground">CIF/VAT: {bill.supplierTaxId}</div>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">{bill.supplierInvoiceNumber}</td>
                        <td className="px-3 py-2.5 font-mono">{bill.billDate ? bill.billDate.slice(0, 10) : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold">€{bill.grandTotal?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-emerald-600 font-semibold">€{bill.amountPaid?.toFixed(2) || "0.00"}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-600">€{bill.outstandingAmount?.toFixed(2) || "0.00"}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            bill.status === "paid" ? "bg-emerald-500/15 text-emerald-600" :
                            bill.status === "posted" ? "bg-blue-500/15 text-blue-600" :
                            bill.status === "partially_paid" ? "bg-amber-500/15 text-amber-600" :
                            bill.status === "reversed" ? "bg-destructive/15 text-destructive" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {bill.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => { setSelectedBill(bill); setShowBillDetails(true); }}
                              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                              title="View Details"
                            >
                              <Eye className="size-3.5" />
                            </button>
                            {bill.status === "draft" && (
                              <button
                                type="button"
                                onClick={() => handlePostExistingBill(bill)}
                                className="px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary font-bold text-[10px]"
                              >
                                Post
                              </button>
                            )}
                            {(bill.status === "posted" || bill.status === "partially_paid") && (
                              <button
                                type="button"
                                onClick={() => handleOpenPaymentModal(bill)}
                                className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-[10px]"
                              >
                                Pay
                              </button>
                            )}
                            {bill.status === "posted" && bill.amountPaid === 0 && (
                              <button
                                type="button"
                                onClick={() => handleOpenReverseModal("bill", bill._id, bill.billNumber)}
                                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                                title="Reverse Bill"
                              >
                                <RotateCcw className="size-3.5" />
                              </button>
                            )}
                            {bill.status === "draft" && (
                              <button
                                type="button"
                                onClick={() => handleDeleteDraftBill(bill)}
                                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                                title="Delete Draft"
                              >
                                <Trash2 className="size-3.5" />
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
            <TablePagination pagination={billsPagination} page={billsPage} onPageChange={setBillsPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: MANUAL JOURNAL ENTRIES */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "journals" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border">
            <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search journal entries by #, ref, description…"
                  value={journalSearch}
                  onChange={e => { setJournalSearch(e.target.value); setJournalPage(1); }}
                  className="w-full bg-secondary/40 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <select
                value={journalTypeFilter}
                onChange={e => { setJournalTypeFilter(e.target.value); setJournalPage(1); }}
                className="bg-secondary/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none"
              >
                <option value="all">All Types</option>
                <option value="manual">Manual Entry</option>
                <option value="supplier_bill">Supplier Bill</option>
                <option value="customer_invoice">Customer Invoice</option>
                <option value="payment">Payment</option>
                <option value="reversal">Reversal</option>
              </select>
            </div>

            <PrimaryButton icon={Plus} onClick={handleOpenCreateJournal}>
              {t.accounting.newJournalEntry}
            </PrimaryButton>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 font-bold text-muted-foreground uppercase text-[10px] border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-3">{t.accounting.entryNumber}</th>
                    <th className="text-left px-3 py-3">{t.accounting.journalDate}</th>
                    <th className="text-left px-3 py-3">{t.accounting.journalRef}</th>
                    <th className="text-left px-3 py-3">{t.accounting.journalDesc}</th>
                    <th className="text-left px-3 py-3">Type</th>
                    <th className="text-right px-3 py-3">{t.accounting.totalDebits}</th>
                    <th className="text-right px-3 py-3">{t.accounting.totalCredits}</th>
                    <th className="text-center px-3 py-3">{t.common.status}</th>
                    <th className="text-right px-3 py-3">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {journalEntries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        No journal entries found. Click "+ New Manual Journal Entry" to create one.
                      </td>
                    </tr>
                  ) : (
                    journalEntries.map(entry => (
                      <tr key={entry._id} className="border-t border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-bold text-primary">{entry.entryNumber}</td>
                        <td className="px-3 py-2.5 font-mono">{entry.date ? entry.date.slice(0, 10) : "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">{entry.reference || "—"}</td>
                        <td className="px-3 py-2.5 font-medium text-foreground max-w-[280px] truncate">{entry.description}</td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded bg-secondary text-[10px] font-semibold uppercase">{entry.entryType}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">€{entry.totalDebit?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">€{entry.totalCredit?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            entry.status === "posted" ? "bg-emerald-500/15 text-emerald-600" :
                            entry.status === "reversed" ? "bg-destructive/15 text-destructive" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => { setSelectedJournal(entry); setShowJournalDetails(true); }}
                              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                              title="View Lines"
                            >
                              <Eye className="size-3.5" />
                            </button>
                            {entry.status === "posted" && entry.entryType === "manual" && (
                              <button
                                type="button"
                                onClick={() => handleOpenReverseModal("journal", entry._id, entry.entryNumber)}
                                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                                title="Reverse Journal Entry"
                              >
                                <RotateCcw className="size-3.5" />
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
            <TablePagination pagination={journalPagination} page={journalPage} onPageChange={setJournalPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 4: GENERAL LEDGER */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "ledger" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border">
            <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search ledger by reference, description, account…"
                  value={ledgerSearch}
                  onChange={e => { setLedgerSearch(e.target.value); setLedgerPage(1); }}
                  className="w-full bg-secondary/40 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <select
                value={ledgerAccountFilter}
                onChange={e => { setLedgerAccountFilter(e.target.value); setLedgerPage(1); }}
                className="bg-secondary/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none max-w-[220px]"
              >
                <option value="all">All Chart Accounts</option>
                {ALL_CHART_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>

            <SecondaryButton icon={Download} onClick={handleExport}>
              {t.accounting.exportReport}
            </SecondaryButton>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 font-bold text-muted-foreground uppercase text-[10px] border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-3">Txn ID</th>
                    <th className="text-left px-3 py-3">Date</th>
                    <th className="text-left px-3 py-3">Reference</th>
                    <th className="text-left px-3 py-3">Account & Category</th>
                    <th className="text-left px-3 py-3">Description</th>
                    <th className="text-right px-3 py-3">Debit (€)</th>
                    <th className="text-right px-3 py-3">Credit (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerTxns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        No general ledger transactions found.
                      </td>
                    </tr>
                  ) : (
                    ledgerTxns.map((txn, idx) => (
                      <tr key={txn.id || idx} className="border-t border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{txn.txnId || txn.id}</td>
                        <td className="px-3 py-2 font-mono">{txn.date ? txn.date.slice(0, 10) : "—"}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-primary">{txn.reference || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-foreground">{txn.account}</div>
                          <div className="text-[10px] text-muted-foreground">{txn.category || "General"}</div>
                        </td>
                        <td className="px-3 py-2 text-foreground max-w-[280px] truncate">{txn.description}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                          {txn.type === "debit" || (txn.debit > 0) ? `€${Math.abs(Number(txn.debit || txn.amount)).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                          {txn.type === "credit" || (txn.credit > 0) ? `€${Math.abs(Number(txn.credit || txn.amount)).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination pagination={ledgerPagination} page={ledgerPage} onPageChange={setLedgerPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: CREATE / EDIT SUPPLIER BILL STUDIO */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showCreateBill}
        onClose={() => setShowCreateBill(false)}
        title={t.accounting.createBillModalTitle}
        subtitle={t.accounting.createBillModalSubtitle}
        width="3xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <ModalCancel onClose={() => setShowCreateBill(false)} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSaveBill("draft")}
                className="px-4 py-2 rounded-lg text-xs font-bold border border-border bg-card hover:bg-secondary transition-colors text-foreground"
              >
                {t.accounting.saveAsDraft}
              </button>
              <button
                type="button"
                onClick={() => handleSaveBill("posted")}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-sm"
              >
                {t.accounting.postBillNow}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1">
          {/* Section 1: Supplier Info */}
          <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-3">
            <div className="font-semibold text-xs text-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Building className="size-3.5 text-primary" /> {t.accounting.selectSupplier}
            </div>

            <Row>
              <Field label={t.accounting.supplier} required>
                <Select
                  value={billForm.supplierId}
                  onChange={e => setBillForm({ ...billForm, supplierId: e.target.value })}
                >
                  <option value="">{t.accounting.chooseSupplier}</option>
                  {suppliers.map(s => (
                    <option key={s._id} value={s._id}>
                      {s.name} {s.taxId ? `(${s.taxId})` : ""} — {s.country || "Spain"}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t.accounting.supplierInvoiceNo} required>
                <Input
                  value={billForm.supplierInvoiceNumber}
                  onChange={e => setBillForm({ ...billForm, supplierInvoiceNumber: e.target.value })}
                  placeholder="e.g. SUP-2026-00125"
                />
              </Field>
            </Row>

            <Row>
              <Field label={t.accounting.billDate} required>
                <Input
                  type="date"
                  value={billForm.billDate}
                  onChange={e => setBillForm({ ...billForm, billDate: e.target.value })}
                />
              </Field>
              <Field label={t.accounting.dueDate}>
                <Input
                  type="date"
                  value={billForm.dueDate}
                  onChange={e => setBillForm({ ...billForm, dueDate: e.target.value })}
                />
              </Field>
              <Field label={t.accounting.paymentTerms}>
                <Select
                  value={billForm.paymentTerms}
                  onChange={e => setBillForm({ ...billForm, paymentTerms: e.target.value })}
                >
                  <option value="Due on Receipt">Due on Receipt (Immediate)</option>
                  <option value="Net 15">Net 15 (15 days)</option>
                  <option value="Net 30">Net 30 (30 days - Standard)</option>
                  <option value="Net 60">Net 60 (60 days)</option>
                </Select>
              </Field>
            </Row>
          </div>

          {/* Section 2: Expense Line Items */}
          <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-xs text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Receipt className="size-3.5 text-primary" /> {t.accounting.expenseLinesSection} ({billForm.lines.length})
              </div>
              <button
                type="button"
                onClick={handleAddBillLine}
                className="px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-bold transition-colors flex items-center gap-1"
              >
                <Plus className="size-3" /> {t.accounting.addExpenseLine}
              </button>
            </div>

            <div className="space-y-2.5">
              {billForm.lines.map((line, idx) => (
                <div key={idx} className="bg-card p-3 rounded-lg border border-border space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                    <span className="font-bold text-muted-foreground">Line #{idx + 1}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-foreground">
                        Line Total: €{((Number(line.quantity) || 1) * (Number(line.unitPrice) || 0) * (1 + (Number(line.taxRate) || 21) / 100)).toFixed(2)}
                      </span>
                      {billForm.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBillLine(idx)}
                          className="text-destructive hover:bg-destructive/10 p-1 rounded"
                          title="Remove line"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.accounting.expenseAccount}</label>
                      <Select
                        value={line.expenseAccount}
                        onChange={e => handleUpdateBillLine(idx, { expenseAccount: e.target.value })}
                      >
                        {STANDARD_EXPENSE_ACCOUNTS.map(acc => (
                          <option key={acc} value={acc}>{acc}</option>
                        ))}
                      </Select>
                    </div>

                    <div className="col-span-8">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.accounting.lineDescription}</label>
                      <Input
                        value={line.description}
                        onChange={e => handleUpdateBillLine(idx, { description: e.target.value })}
                        placeholder="e.g. Warehouse electricity, freight invoice, storage racks…"
                      />
                    </div>

                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.accounting.quantity}</label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={e => handleUpdateBillLine(idx, { quantity: Number(e.target.value) })}
                      />
                    </div>

                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.accounting.unitPrice}</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPrice}
                        onChange={e => handleUpdateBillLine(idx, { unitPrice: Number(e.target.value) })}
                      />
                    </div>

                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.accounting.taxRate}</label>
                      <Select
                        value={line.taxRate !== undefined ? line.taxRate : 21}
                        onChange={e => handleUpdateBillLine(idx, { taxRate: Number(e.target.value) })}
                      >
                        <option value="21">21% (Standard)</option>
                        <option value="10">10% (Reduced)</option>
                        <option value="4">4% (Super-reduced)</option>
                        <option value="0">0% (Exempt)</option>
                      </Select>
                    </div>

                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">{t.accounting.discount}</label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={line.discount || 0}
                        onChange={e => handleUpdateBillLine(idx, { discount: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Live Authoritative Calculation Summary */}
          <div className="bg-gradient-to-r from-card to-secondary/30 p-4 rounded-xl border border-border flex justify-between items-center text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {t.accounting.subtotalExclTax}: <strong>€{liveBillSummary.subtotal.toFixed(2)}</strong>
              </div>
              <div className="text-muted-foreground">
                {t.accounting.totalVat}: <strong>€{liveBillSummary.totalTax.toFixed(2)}</strong>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {Object.entries(liveBillSummary.taxMap).map(([rate, val]) => (
                  <span key={rate} className="mr-3">
                    VAT {rate}%: €{val.taxAmount.toFixed(2)} (Taxable: €{val.taxableAmount.toFixed(2)})
                  </span>
                ))}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs uppercase font-bold text-muted-foreground">{t.accounting.totalPayable}</div>
              <div className="text-2xl font-black text-primary font-mono">
                €{liveBillSummary.grandTotal.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: SUPPLIER BILL DETAILS & PAYMENT HISTORY */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedBill && (
        <Modal
          open={showBillDetails}
          onClose={() => setShowBillDetails(false)}
          title={`Supplier Bill ${selectedBill.billNumber}`}
          subtitle={`Issued by ${selectedBill.supplierName} • Ref: ${selectedBill.supplierInvoiceNumber} • Status: ${selectedBill.status.toUpperCase()}`}
          width="2xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowBillDetails(false)} />
              <div className="flex gap-2">
                {selectedBill.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => handlePostExistingBill(selectedBill)}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    Post to Accounting Ledger
                  </button>
                )}
                {(selectedBill.status === "posted" || selectedBill.status === "partially_paid") && (
                  <button
                    type="button"
                    onClick={() => { setShowBillDetails(false); handleOpenPaymentModal(selectedBill); }}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <CreditCard className="size-3.5" /> Record Payment
                  </button>
                )}
                {selectedBill.status === "posted" && selectedBill.amountPaid === 0 && (
                  <button
                    type="button"
                    onClick={() => { setShowBillDetails(false); handleOpenReverseModal("bill", selectedBill._id, selectedBill.billNumber); }}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                  >
                    <RotateCcw className="size-3.5" /> Reverse Bill
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 bg-secondary/20 rounded-lg border border-border">
              <div><strong>Supplier:</strong> {selectedBill.supplierName}</div>
              <div><strong>Invoice Reference:</strong> {selectedBill.supplierInvoiceNumber}</div>
              <div><strong>Supplier Tax ID:</strong> {selectedBill.supplierTaxId || "N/A"}</div>
              <div><strong>Payment Terms:</strong> {selectedBill.paymentTerms || "Net 30"}</div>
              <div><strong>Bill Date:</strong> {selectedBill.billDate ? selectedBill.billDate.slice(0, 10) : "—"}</div>
              <div><strong>Due Date:</strong> {selectedBill.dueDate ? selectedBill.dueDate.slice(0, 10) : "—"}</div>
              {selectedBill.journalEntryId && (
                <div className="col-span-2 text-primary font-semibold flex items-center gap-1">
                  <ShieldCheck className="size-3.5" /> Linked Journal Entry: {selectedBill.journalEntryId.entryNumber || "JE-POSTED"}
                </div>
              )}
            </div>

            {/* Line items */}
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 font-bold text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-2.5">#</th>
                    <th className="text-left p-2.5">Expense Account</th>
                    <th className="text-left p-2.5">Description</th>
                    <th className="text-right p-2.5">Qty</th>
                    <th className="text-right p-2.5">Unit Price</th>
                    <th className="text-right p-2.5">VAT %</th>
                    <th className="text-right p-2.5">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBill.lines?.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2.5 font-bold">{i + 1}</td>
                      <td className="p-2.5 font-semibold text-primary">{l.expenseAccount}</td>
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

            {/* Totals & Payments Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-secondary/30 rounded-lg space-y-1">
                <div>Subtotal (Net): <strong>€{selectedBill.subtotal?.toFixed(2)}</strong></div>
                <div>Total Input VAT: <strong>€{selectedBill.totalTax?.toFixed(2)}</strong></div>
                <div className="text-foreground font-bold">Total Bill: €{selectedBill.grandTotal?.toFixed(2)}</div>
              </div>

              <div className="p-3 bg-secondary/30 rounded-lg space-y-1 text-right">
                <div>Amount Paid: <strong className="text-emerald-600 font-mono">€{selectedBill.amountPaid?.toFixed(2) || "0.00"}</strong></div>
                <div>Outstanding Balance: <strong className="text-amber-600 font-mono text-sm">€{selectedBill.outstandingAmount?.toFixed(2) || "0.00"}</strong></div>
              </div>
            </div>

            {/* Payment History Table */}
            {selectedBill.payments && selectedBill.payments.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-bold text-xs flex items-center gap-1 text-emerald-600">
                  <CreditCard className="size-3.5" /> Payment History ({selectedBill.payments.length})
                </h4>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/40 text-[10px] uppercase font-bold text-muted-foreground">
                      <tr>
                        <th className="text-left p-2">Payment #</th>
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">Method</th>
                        <th className="text-left p-2">Account</th>
                        <th className="text-right p-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBill.payments.map((pmt, pIdx) => (
                        <tr key={pIdx} className="border-t border-border">
                          <td className="p-2 font-mono font-bold text-primary">{pmt.paymentNumber}</td>
                          <td className="p-2 font-mono">{pmt.date ? pmt.date.slice(0, 10) : "—"}</td>
                          <td className="p-2">{pmt.paymentMethod}</td>
                          <td className="p-2">{pmt.paymentAccount}</td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-600">€{pmt.amount?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: RECORD SUPPLIER BILL PAYMENT */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedBill && (
        <Modal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          title={t.accounting.paymentModalTitle}
          subtitle={`Paying Bill ${selectedBill.billNumber} (${selectedBill.supplierName}) • Outstanding: €${selectedBill.outstandingAmount.toFixed(2)}`}
          width="lg"
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowPaymentModal(false)} />
              <ModalSubmit onClick={handleRecordPayment}>
                {t.accounting.confirmPayment}
              </ModalSubmit>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center justify-between text-xs">
              <div>
                <div className="text-muted-foreground">Outstanding Accounts Payable:</div>
                <div className="text-xl font-bold font-mono text-emerald-600">€{selectedBill.outstandingAmount.toFixed(2)}</div>
              </div>
              <button
                type="button"
                onClick={() => setPaymentForm({ ...paymentForm, amount: selectedBill.outstandingAmount })}
                className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
              >
                {t.accounting.payFullBalance}
              </button>
            </div>

            <Row>
              <Field label={t.accounting.paymentAmount} required>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={selectedBill.outstandingAmount}
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                />
              </Field>
              <Field label="Payment Date" required>
                <Input
                  type="date"
                  value={paymentForm.date}
                  onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })}
                />
              </Field>
            </Row>

            <Row>
              <Field label={t.accounting.paymentMethod}>
                <Select
                  value={paymentForm.paymentMethod}
                  onChange={e => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                >
                  <option value="Bank Transfer">Bank Transfer (SEPA / Wire)</option>
                  <option value="Credit Card">Corporate Credit Card</option>
                  <option value="Direct Debit">Direct Debit</option>
                  <option value="Cash">Cash / Petty Cash</option>
                </Select>
              </Field>

              <Field label={t.accounting.paymentAccount}>
                <Select
                  value={paymentForm.paymentAccount}
                  onChange={e => setPaymentForm({ ...paymentForm, paymentAccount: e.target.value })}
                >
                  {STANDARD_PAYMENT_ACCOUNTS.map(acc => (
                    <option key={acc} value={acc}>{acc}</option>
                  ))}
                </Select>
              </Field>
            </Row>

            <Field label={t.accounting.paymentReference}>
              <Input
                value={paymentForm.reference}
                onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                placeholder="e.g. SEPA-TXN-98234"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: CREATE MANUAL DOUBLE-ENTRY JOURNAL ENTRY */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showCreateJournal}
        onClose={() => setShowCreateJournal(false)}
        title={t.accounting.journalModalTitle}
        subtitle={t.accounting.journalModalSubtitle}
        width="2xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <ModalCancel onClose={() => setShowCreateJournal(false)} />
            <button
              type="button"
              onClick={handleSaveJournalEntry}
              disabled={!liveJournalSummary.isBalanced}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-opacity shadow-sm ${
                liveJournalSummary.isBalanced
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {t.accounting.postJournalEntry}
            </button>
          </div>
        }
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <Row>
            <Field label={t.accounting.journalDate} required>
              <Input
                type="date"
                value={journalForm.date}
                onChange={e => setJournalForm({ ...journalForm, date: e.target.value })}
              />
            </Field>
            <Field label={t.accounting.journalRef}>
              <Input
                value={journalForm.reference}
                onChange={e => setJournalForm({ ...journalForm, reference: e.target.value })}
                placeholder="e.g. ADJ-2026-001"
              />
            </Field>
          </Row>

          <Field label={t.accounting.journalDesc} required>
            <Input
              value={journalForm.description}
              onChange={e => setJournalForm({ ...journalForm, description: e.target.value })}
              placeholder="e.g. Monthly depreciation, payroll accrual, capital contribution…"
            />
          </Field>

          {/* Dynamic Lines Table */}
          <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-xs text-foreground uppercase tracking-wide">
                {t.accounting.journalLinesSection} ({journalForm.lines.length})
              </div>
              <button
                type="button"
                onClick={handleAddJournalLine}
                className="px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-bold transition-colors flex items-center gap-1"
              >
                <Plus className="size-3" /> {t.accounting.addJournalLine}
              </button>
            </div>

            <div className="space-y-2">
              {journalForm.lines.map((line, idx) => (
                <div key={idx} className="bg-card p-2.5 rounded-lg border border-border flex items-center gap-2 text-xs">
                  <span className="font-bold text-muted-foreground w-6">#{idx + 1}</span>
                  <div className="flex-1">
                    <Select
                      value={line.account}
                      onChange={e => handleUpdateJournalLine(idx, { account: e.target.value })}
                    >
                      {ALL_CHART_ACCOUNTS.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </Select>
                  </div>

                  <div className="w-28">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Debit (€)"
                      value={line.debit || ""}
                      onChange={e => handleUpdateJournalLine(idx, { debit: Number(e.target.value), credit: 0 })}
                    />
                  </div>

                  <div className="w-28">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Credit (€)"
                      value={line.credit || ""}
                      onChange={e => handleUpdateJournalLine(idx, { credit: Number(e.target.value), debit: 0 })}
                    />
                  </div>

                  {journalForm.lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveJournalLine(idx)}
                      className="text-destructive hover:bg-destructive/10 p-1.5 rounded"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Live Balance Status Card */}
          <div className={`p-3.5 rounded-xl border flex items-center justify-between text-xs ${
            liveJournalSummary.isBalanced
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}>
            <div className="space-y-0.5">
              <div>Total Debits: <strong>€{liveJournalSummary.totalDebit.toFixed(2)}</strong></div>
              <div>Total Credits: <strong>€{liveJournalSummary.totalCredit.toFixed(2)}</strong></div>
            </div>

            <div className="text-right">
              <div className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1 justify-end">
                {liveJournalSummary.isBalanced ? (
                  <>
                    <CheckCircle2 className="size-4" /> {t.accounting.balancedStatus}
                  </>
                ) : (
                  <>
                    <AlertCircle className="size-4" /> Difference: €{liveJournalSummary.difference.toFixed(2)}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 5: JOURNAL ENTRY DETAILS */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedJournal && (
        <Modal
          open={showJournalDetails}
          onClose={() => setShowJournalDetails(false)}
          title={`Journal Entry ${selectedJournal.entryNumber}`}
          subtitle={`Date: ${selectedJournal.date?.slice(0, 10)} • Status: ${selectedJournal.status.toUpperCase()} • Type: ${selectedJournal.entryType.toUpperCase()}`}
          width="2xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowJournalDetails(false)} />
              {selectedJournal.status === "posted" && selectedJournal.entryType === "manual" && (
                <button
                  type="button"
                  onClick={() => { setShowJournalDetails(false); handleOpenReverseModal("journal", selectedJournal._id, selectedJournal.entryNumber); }}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <RotateCcw className="size-3.5" /> Reverse Journal Entry
                </button>
              )}
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-secondary/20 rounded-lg border border-border space-y-1">
              <div><strong>Description:</strong> {selectedJournal.description}</div>
              <div><strong>Reference:</strong> {selectedJournal.reference || "N/A"}</div>
              <div><strong>Posted By:</strong> {selectedJournal.postedBy || "Admin"} on {selectedJournal.postedAt ? new Date(selectedJournal.postedAt).toLocaleString() : "—"}</div>
              {selectedJournal.reversedAt && (
                <div className="text-destructive font-semibold">
                  Reversed on {new Date(selectedJournal.reversedAt).toLocaleString()} ({selectedJournal.reversalReason || "Correction"})
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 font-bold text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-2.5">Account</th>
                    <th className="text-left p-2.5">Description</th>
                    <th className="text-right p-2.5">Debit (€)</th>
                    <th className="text-right p-2.5">Credit (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedJournal.lines?.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2.5 font-bold text-primary">{l.account}</td>
                      <td className="p-2.5">{l.description || selectedJournal.description}</td>
                      <td className="p-2.5 text-right font-mono">{l.debit > 0 ? `€${l.debit.toFixed(2)}` : "—"}</td>
                      <td className="p-2.5 text-right font-mono">{l.credit > 0 ? `€${l.credit.toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-secondary/30 font-bold border-t border-border">
                  <tr>
                    <td colSpan={2} className="p-2.5 uppercase text-[10px]">Totals</td>
                    <td className="p-2.5 text-right font-mono">€{selectedJournal.totalDebit?.toFixed(2)}</td>
                    <td className="p-2.5 text-right font-mono">€{selectedJournal.totalCredit?.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 6: REVERSAL CONFIRMATION MODAL */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {reverseTarget && (
        <Modal
          open={showReverseModal}
          onClose={() => setShowReverseModal(false)}
          title={t.accounting.reverseModalTitle}
          subtitle={`Reversing ${reverseTarget.type === 'bill' ? 'Supplier Bill' : 'Journal Entry'} ${reverseTarget.number}`}
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowReverseModal(false)} />
              <button
                type="button"
                onClick={handleConfirmReversal}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                {t.accounting.confirmReversal}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive">
              <strong>Notice:</strong> This action creates an offsetting double-entry reversal to preserve your accounting audit trail. The original record will be marked as REVERSED and cannot be modified.
            </div>

            <Field label={t.accounting.reversalReason} required>
              <Input
                value={reversalReason}
                onChange={e => setReversalReason(e.target.value)}
                placeholder={t.accounting.reversalReasonPlaceholder}
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
