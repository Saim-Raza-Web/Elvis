import { useState, useEffect, useMemo } from "react";
import {
  BookOpen, TrendingUp, TrendingDown, DollarSign, BarChart3, Download,
  Plus, Search, Receipt, Landmark, FileText, ArrowRightLeft, Check,
  AlertCircle, CheckCircle2, RotateCcw, Trash2, Eye, Calendar, Building,
  CreditCard, ShieldCheck, Tag, Info, ArrowUpRight, ArrowDownRight,
  FolderTree, Upload, FileSpreadsheet, ChevronRight, ChevronDown, Sparkles,
  Layers, Settings2, RefreshCw, AlertTriangle, ExternalLink, HelpCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { 
  accountingService, 
  SupplierBill, 
  JournalEntry, 
  BillLine, 
  JournalLine, 
  AccountItem,
  ChartOfAccountRecord,
  ImportPreviewRow,
  ChartOfAccountImportLog
} from "../../services/accounting.service";
import { suppliersService, Supplier } from "../../services/suppliers.service";

type ActiveTab = "overview" | "chart" | "bills" | "journals" | "ledger";

const STANDARD_EXPENSE_ACCOUNTS = [
  "600 - Purchases of Merchandise",
  "621 - Rent Expense",
  "628 - Utilities & Power",
  "624 - Logistics & Freight Expense",
  "Operating Expenses",
  "Inventory Purchases",
  "Warehouse & Storage Expenses",
  "Office & Admin Expenses",
  "Maintenance & Repairs"
];

const STANDARD_PAYMENT_ACCOUNTS = [
  "572.000.001 - Banco Santander (Main Operating EUR)",
  "572 - Bank Accounts",
  "Cash & Cash Equivalents",
  "BBVA Corporate Account",
  "Petty Cash"
];

const blankBillLine = (): BillLine => ({
  expenseAccount: "600 - Purchases of Merchandise",
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

  // ── Chart of Accounts State ────────────────────────────────────────────────
  const [coaList, setCoaList] = useState<ChartOfAccountRecord[]>([]);
  const [coaLoading, setCoaLoading] = useState(false);
  const [coaSearch, setCoaSearch] = useState("");
  const [coaTypeFilter, setCoaTypeFilter] = useState("all");
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({ "400": true, "400.000": true, "572": true, "700": true });

  // ── Account Create / Edit Modal State ───────────────────────────────────────
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountEditMode, setAccountEditMode] = useState<"create" | "edit">("create");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    accountCode: "",
    accountName: "",
    accountType: "Asset" as 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense',
    category: "Current Asset",
    parentAccountId: "",
    parentAccountCode: "",
    allowSubAccounts: true,
    isPostingAccount: true,
    description: "",
    supplierId: ""
  });

  // ── Excel / CSV Import Wizard State ─────────────────────────────────────────
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1); // 1=Upload, 2=Mapping, 3=Preview & Execute
  const [importFileName, setImportFileName] = useState("");
  const [rawSheetRows, setRawSheetRows] = useState<any[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState({
    accountCode: "Account Code",
    accountName: "Account Name",
    accountType: "Account Type",
    category: "Category",
    parentAccountCode: "Parent Account",
    allowSubAccounts: "Allow Sub-Accounts",
    isPostingAccount: "Posting Account"
  });
  const [importMode, setImportMode] = useState<"create_new_only" | "update_existing">("create_new_only");
  const [importPreviewData, setImportPreviewData] = useState<{
    totalRows: number;
    validCount: number;
    invalidCount: number;
    newCount: number;
    updateCount: number;
    previewRows: ImportPreviewRow[];
    errors: any[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImportHistoryModal, setShowImportHistoryModal] = useState(false);
  const [importHistoryLogs, setImportHistoryLogs] = useState<ChartOfAccountImportLog[]>([]);

  // ── Supplier Bills State ──────────────────────────────────────────────────
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [billsPage, setBillsPage] = useState(1);
  const [billsPagination, setBillsPagination] = useState<any>(null);
  const [billSearch, setBillSearch] = useState("");
  const [billStatusFilter, setBillStatusFilter] = useState("all");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // ── Supplier Profile Modal State ──────────────────────────────────────────
  const [selectedSupplierForProfile, setSelectedSupplierForProfile] = useState<Supplier | null>(null);
  const [showSupplierProfileModal, setShowSupplierProfileModal] = useState(false);

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
    paymentAccount: "572.000.001 - Banco Santander (Main Operating EUR)",
    reference: "",
    notes: ""
  });

  // ── Journal Entries State ─────────────────────────────────────────────────
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [journalsPage, setJournalsPage] = useState(1);
  const [journalsPagination, setJournalsPagination] = useState<any>(null);
  const [journalSearch, setJournalSearch] = useState("");
  const [showCreateJournal, setShowCreateJournal] = useState(false);
  const [journalForm, setJournalForm] = useState<{
    date: string;
    reference: string;
    description: string;
    lines: JournalLine[];
  }>({
    date: new Date().toISOString().slice(0, 10),
    reference: "",
    description: "",
    lines: [
      { account: "572.000.001 - Banco Santander (Main Operating EUR)", description: "", debit: 0, credit: 0 },
      { account: "600 - Purchases of Merchandise", description: "", debit: 0, credit: 0 }
    ]
  });

  // ── Reversal Modal State ──────────────────────────────────────────────────
  const [showReversalModal, setShowReversalModal] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<{ type: "bill" | "journal"; id: string; number: string } | null>(null);
  const [reversalReason, setReversalReason] = useState("Accounting adjustment / correction");

  // ── Initial Data Fetching ─────────────────────────────────────────────────
  useEffect(() => {
    loadOverview();
    loadChartOfAccounts();
    loadBills();
    loadSuppliers();
    loadJournals();
  }, []);

  useEffect(() => {
    loadBills();
  }, [billsPage, billSearch, billStatusFilter]);

  useEffect(() => {
    loadJournals();
  }, [journalsPage, journalSearch]);

  async function loadOverview() {
    try {
      const data = await accountingService.getOverview();
      setAccounts(data.accounts || []);
      setTransactions(data.transactions?.data || []);
      if (data.stats) setStats(data.stats);
    } catch (err: any) {
      console.error("Failed to load accounting overview", err);
    }
  }

  async function loadChartOfAccounts() {
    setCoaLoading(true);
    try {
      const list = await accountingService.getAccounts();
      setCoaList(list);
    } catch (err: any) {
      console.error("Failed to load Chart of Accounts", err);
    } finally {
      setCoaLoading(false);
    }
  }

  async function loadBills() {
    try {
      const res = await accountingService.getBills({
        page: billsPage,
        limit: 10,
        search: billSearch,
        status: billStatusFilter === "all" ? undefined : billStatusFilter
      });
      setBills(res.data || []);
      setBillsPagination(res.pagination || null);
    } catch (err) {
      console.error("Failed to load bills", err);
    }
  }

  async function loadSuppliers() {
    try {
      const data = await suppliersService.getAll();
      setSuppliers(data);
    } catch (err) {
      console.error("Failed to load suppliers", err);
    }
  }

  async function loadJournals() {
    try {
      const res = await accountingService.getJournalEntries({
        page: journalsPage,
        limit: 10,
        search: journalSearch
      });
      setJournals(res.data || []);
      setJournalsPagination(res.pagination || null);
    } catch (err) {
      console.error("Failed to load journals", err);
    }
  }

  // ── Chart of Accounts Tree Hierarchy Computation ─────────────────────────
  const coaTree = useMemo(() => {
    const filterText = coaSearch.trim().toLowerCase();
    const typeFilter = coaTypeFilter;

    let filtered = coaList;
    if (typeFilter !== "all") {
      filtered = filtered.filter(a => a.accountType === typeFilter);
    }
    if (filterText) {
      filtered = filtered.filter(a =>
        a.accountCode.toLowerCase().includes(filterText) ||
        a.accountName.toLowerCase().includes(filterText) ||
        (a.category || "").toLowerCase().includes(filterText)
      );
    }

    return filtered.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }, [coaList, coaSearch, coaTypeFilter]);

  // ── Account Code Suggestion on Parent Selection ───────────────────────────
  async function handleParentAccountChange(parentId: string) {
    if (!parentId) {
      setAccountForm(prev => ({
        ...prev,
        parentAccountId: "",
        parentAccountCode: ""
      }));
      return;
    }
    try {
      const res = await accountingService.getNextAccountCode({ parentAccountId: parentId });
      setAccountForm(prev => ({
        ...prev,
        parentAccountId: parentId,
        parentAccountCode: res.parentCode,
        accountCode: res.suggestedCode,
        accountType: (res.accountType as any) || prev.accountType,
        category: res.category || prev.category
      }));
    } catch (err) {
      console.error("Failed to suggest next code", err);
    }
  }

  // ── Create or Edit Account ────────────────────────────────────────────────
  async function handleSaveAccount() {
    if (!accountForm.accountCode.trim()) {
      toast.error("Account code is required");
      return;
    }
    if (!accountForm.accountName.trim()) {
      toast.error("Account name is required");
      return;
    }

    try {
      if (accountEditMode === "create") {
        await accountingService.createAccount({
          accountCode: accountForm.accountCode.trim(),
          accountName: accountForm.accountName.trim(),
          accountType: accountForm.accountType,
          category: accountForm.category.trim(),
          parentAccountId: accountForm.parentAccountId || null,
          allowSubAccounts: accountForm.allowSubAccounts,
          isPostingAccount: accountForm.isPostingAccount,
          description: accountForm.description.trim(),
          supplierId: accountForm.supplierId || null
        });
        toast.success(`Account ${accountForm.accountCode} created successfully!`);
      } else if (editingAccountId) {
        await accountingService.updateAccount(editingAccountId, {
          accountName: accountForm.accountName.trim(),
          accountType: accountForm.accountType,
          category: accountForm.category.trim(),
          parentAccountId: (accountForm.parentAccountId as any) || null,
          allowSubAccounts: accountForm.allowSubAccounts,
          isPostingAccount: accountForm.isPostingAccount,
          description: accountForm.description.trim()
        });
        toast.success(`Account ${accountForm.accountCode} updated successfully!`);
      }

      setShowAccountModal(false);
      loadChartOfAccounts();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save account");
    }
  }

  // ── Delete Account ────────────────────────────────────────────────────────
  async function handleDeleteAccount(account: ChartOfAccountRecord) {
    if (!confirm(`Are you sure you want to delete account ${account.accountCode} - ${account.accountName}?`)) return;
    try {
      await accountingService.deleteAccount(account._id);
      toast.success(`Account ${account.accountCode} deleted successfully.`);
      loadChartOfAccounts();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete account");
    }
  }

  // ── Excel Import Wizard Handlers ──────────────────────────────────────────
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (jsonRows.length === 0) {
          toast.error("Spreadsheet appears to be empty.");
          return;
        }

        const headers = Object.keys(jsonRows[0]);
        setDetectedColumns(headers);
        setRawSheetRows(jsonRows);

        // Auto-match column headers intelligently
        const autoMap = {
          accountCode: headers.find(h => /code|código|account code|codigo/i.test(h)) || headers[0] || "Account Code",
          accountName: headers.find(h => /name|nombre|description|descripción/i.test(h)) || headers[1] || "Account Name",
          accountType: headers.find(h => /type|tipo/i.test(h)) || headers[2] || "Account Type",
          category: headers.find(h => /category|categoría|grupo/i.test(h)) || "Category",
          parentAccountCode: headers.find(h => /parent|padre|parent account/i.test(h)) || "Parent Account",
          allowSubAccounts: headers.find(h => /allow|sub-account|permite/i.test(h)) || "Allow Sub-Accounts",
          isPostingAccount: headers.find(h => /posting|imputable|asiento/i.test(h)) || "Posting Account"
        };
        setColumnMapping(autoMap);
        setImportStep(2); // Proceed to Column Mapping step
      } catch (err) {
        toast.error("Failed to read spreadsheet file. Ensure it is a valid .xlsx, .xls, or .csv file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handlePreviewImport() {
    try {
      setImporting(true);
      const previewRes = await accountingService.previewAccountImport({
        rows: rawSheetRows,
        columnMapping
      });
      setImportPreviewData(previewRes);
      setImportStep(3); // Proceed to Preview step
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to generate preview.");
    } finally {
      setImporting(false);
    }
  }

  async function handleExecuteImport() {
    try {
      setImporting(true);
      const res = await accountingService.executeAccountImport({
        rows: rawSheetRows,
        columnMapping,
        importMode,
        fileName: importFileName
      });

      toast.success(`Import complete! +${res.createdCount} created, ${res.updatedCount} updated, ${res.skippedCount} skipped.`);
      setShowImportModal(false);
      setImportStep(1);
      setRawSheetRows([]);
      setImportPreviewData(null);
      loadChartOfAccounts();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  // ── Calculation for Bill Lines ────────────────────────────────────────────
  const billCalculations = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let totalTax = 0;

    const computedLines = billForm.lines.map(line => {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unitPrice) || 0;
      const discount = Number(line.discount) || 0;
      const taxRate = Number(line.taxRate) || 0;

      const rawSub = qty * price;
      const disc = rawSub * (discount / 100);
      const net = rawSub - disc;
      const tax = net * (taxRate / 100);
      const total = net + tax;

      subtotal += rawSub;
      discountTotal += disc;
      totalTax += tax;

      return { ...line, lineSubtotal: net, lineTax: tax, lineTotal: total };
    });

    const grandTotal = subtotal - discountTotal + totalTax;
    return { lines: computedLines, subtotal, discountTotal, totalTax, grandTotal };
  }, [billForm.lines]);

  // ── Journal Debits / Credits Validation ────────────────────────────────────
  const journalBalance = useMemo(() => {
    let debits = 0;
    let credits = 0;
    journalForm.lines.forEach(l => {
      debits += Number(l.debit) || 0;
      credits += Number(l.credit) || 0;
    });
    debits = Math.round(debits * 100) / 100;
    credits = Math.round(credits * 100) / 100;
    const diff = Math.round(Math.abs(debits - credits) * 100) / 100;
    const isBalanced = diff === 0 && debits > 0;
    return { debits, credits, diff, isBalanced };
  }, [journalForm.lines]);

  // ── Handle Save Supplier Bill ─────────────────────────────────────────────
  async function handleSaveBill(targetStatus: 'draft' | 'posted') {
    if (!billForm.supplierId) {
      toast.error("Please select a supplier");
      return;
    }
    if (!billForm.supplierInvoiceNumber.trim()) {
      toast.error("Supplier invoice number is required");
      return;
    }

    try {
      const payload = {
        ...billForm,
        lines: billCalculations.lines,
        status: targetStatus
      };

      if (billEditMode === "create") {
        const created = await accountingService.createBill(payload);
        toast.success(`Supplier Bill ${created.billNumber} created as ${created.status.toUpperCase()}!`);
      } else if (editingBillId) {
        await accountingService.updateBill(editingBillId, payload);
        toast.success(`Supplier Bill updated successfully!`);
      }

      setShowCreateBill(false);
      loadBills();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save bill");
    }
  }

  // ── Handle Save Journal Entry ─────────────────────────────────────────────
  async function handleSaveJournal() {
    if (!journalForm.description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (!journalBalance.isBalanced) {
      toast.error(`Journal entry is unbalanced! Debits (€${journalBalance.debits}) must equal Credits (€${journalBalance.credits}).`);
      return;
    }

    try {
      const created = await accountingService.createJournalEntry(journalForm);
      toast.success(`Journal Entry ${created.entryNumber} posted successfully!`);
      setShowCreateJournal(false);
      loadJournals();
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to post journal entry");
    }
  }

  return (
    <div className="space-y-6 animate-pop-in">
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TOP TABS NAVIGATION                                                        */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex items-center gap-2 overflow-x-auto text-sm font-semibold">
          {[
            { id: "overview", label: "Overview & Reports", icon: BarChart3 },
            { id: "chart", label: "Chart of Accounts (PGC)", icon: FolderTree },
            { id: "bills", label: "Supplier Bills & Invoices", icon: Receipt },
            { id: "journals", label: "Manual Journal Entries", icon: FileText },
            { id: "ledger", label: "General Ledger Audit", icon: Landmark }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all text-xs md:text-sm whitespace-nowrap ${
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

        {/* Action Buttons based on active tab */}
        <div className="flex items-center gap-2 shrink-0">
          {activeTab === "chart" && (
            <>
              <SecondaryButton icon={Upload} onClick={() => { setImportStep(1); setShowImportModal(true); }}>
                Import Excel / CSV
              </SecondaryButton>
              <PrimaryButton 
                icon={Plus} 
                onClick={() => {
                  setAccountEditMode("create");
                  setEditingAccountId(null);
                  setAccountForm({
                    accountCode: "",
                    accountName: "",
                    accountType: "Asset",
                    category: "Current Asset",
                    parentAccountId: "",
                    parentAccountCode: "",
                    allowSubAccounts: true,
                    isPostingAccount: true,
                    description: "",
                    supplierId: ""
                  });
                  setShowAccountModal(true);
                }}
              >
                Create Account
              </PrimaryButton>
            </>
          )}

          {activeTab === "bills" && (
            <PrimaryButton 
              icon={Plus} 
              onClick={() => {
                setBillEditMode("create");
                setEditingBillId(null);
                setBillForm({
                  supplierId: "",
                  supplierInvoiceNumber: "",
                  billDate: new Date().toISOString().slice(0, 10),
                  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                  paymentTerms: "Net 30",
                  lines: [blankBillLine()],
                  notes: ""
                });
                setShowCreateBill(true);
              }}
            >
              New Supplier Bill
            </PrimaryButton>
          )}

          {activeTab === "journals" && (
            <PrimaryButton 
              icon={Plus} 
              onClick={() => {
                setJournalForm({
                  date: new Date().toISOString().slice(0, 10),
                  reference: "",
                  description: "",
                  lines: [
                    { account: "572.000.001 - Banco Santander (Main Operating EUR)", description: "", debit: 0, credit: 0 },
                    { account: "600 - Purchases of Merchandise", description: "", debit: 0, credit: 0 }
                  ]
                });
                setShowCreateJournal(true);
              }}
            >
              New Journal Entry
            </PrimaryButton>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: OVERVIEW & STATS                                                    */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            {[
              { label: "Total Revenue", value: `€${stats.totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
              { label: "Total Expenses", value: `€${stats.totalExpenses.toFixed(2)}`, icon: TrendingDown, color: "text-amber-500", bg: "bg-amber-500/10" },
              { label: "Net Operating Profit", value: `€${stats.netProfit.toFixed(2)}`, icon: DollarSign, color: stats.netProfit >= 0 ? "text-emerald-500" : "text-destructive", bg: stats.netProfit >= 0 ? "bg-emerald-500/10" : "bg-destructive/10" },
              { label: "Accounts Payable (AP)", value: `€${stats.accountsPayable.toFixed(2)}`, icon: Receipt, color: "text-blue-500", bg: "bg-blue-500/10" }
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground">{s.label}</span>
                  <div className="font-bold text-xl md:text-2xl mt-0.5 font-mono">{s.value}</div>
                </div>
                <div className={`p-2.5 rounded-xl ${s.bg}`}>
                  <s.icon className={`size-5 ${s.color}`} />
                </div>
              </div>
            ))}
          </div>

          {/* Quick Links & Financial Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                <FolderTree className="size-4 text-primary" /> Spanish Chart of Accounts (PGC) Quick Access
              </h4>
              <p className="text-xs text-muted-foreground">
                Manage hierarchical Spanish accounting plan accounts (Groups 1 to 7), sub-accounts for suppliers, and posting rules.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("chart")}
                  className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors"
                >
                  View Full Chart ({coaList.length} Accounts) →
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                <Receipt className="size-4 text-primary" /> Supplier Master Data & Bills
              </h4>
              <p className="text-xs text-muted-foreground">
                Authoritative supplier profiles linked to individual sub-accounts with automatic double-entry liability tracking.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("bills")}
                  className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors"
                >
                  View Supplier Bills ({bills.length}) →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: CHART OF ACCOUNTS (PGC HIERARCHY TREE)                              */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "chart" && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="rounded-xl border border-border bg-card p-3 flex flex-col md:flex-row items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={coaSearch}
                  onChange={e => setCoaSearch(e.target.value)}
                  placeholder="Search code or account..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-secondary/30 outline-none focus:border-primary"
                />
              </div>

              <select
                value={coaTypeFilter}
                onChange={e => setCoaTypeFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border bg-secondary/30 outline-none focus:border-primary"
              >
                <option value="all">All Types</option>
                <option value="Asset">Assets</option>
                <option value="Liability">Liabilities</option>
                <option value="Equity">Equity</option>
                <option value="Revenue">Revenue</option>
                <option value="Expense">Expense</option>
              </select>
            </div>

            <div className="flex items-center gap-2 self-end text-xs text-muted-foreground">
              <span>Total: <strong>{coaTree.length}</strong> accounts</span>
            </div>
          </div>

          {/* Tree Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            {coaLoading ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                Loading Chart of Accounts...
              </div>
            ) : coaTree.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground space-y-2">
                <FolderTree className="size-8 mx-auto text-muted-foreground opacity-50" />
                <p>No accounts match your search or filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] font-bold border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5 w-44">Account Code</th>
                      <th className="text-left px-3 py-2.5">Account Name</th>
                      <th className="text-left px-3 py-2.5">Type</th>
                      <th className="text-left px-3 py-2.5">Category</th>
                      <th className="text-center px-3 py-2.5">Posting Role</th>
                      <th className="text-right px-3 py-2.5">Live Balance (€)</th>
                      <th className="text-right px-3 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {coaTree.map(account => {
                      const typeColors: Record<string, string> = {
                        Asset: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                        Liability: "bg-amber-500/10 text-amber-600 border-amber-500/20",
                        Equity: "bg-purple-500/10 text-purple-600 border-purple-500/20",
                        Revenue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
                        Expense: "bg-rose-500/10 text-rose-600 border-rose-500/20"
                      };

                      const indentPx = (account.hierarchyLevel || 0) * 18;

                      return (
                        <tr key={account._id} className="hover:bg-secondary/20 transition-colors">
                          {/* Code with Tree Indentation */}
                          <td className="px-3 py-2.5 font-mono font-bold text-foreground">
                            <div style={{ paddingLeft: `${indentPx}px` }} className="flex items-center gap-1.5">
                              {account.hierarchyLevel > 0 && (
                                <span className="text-muted-foreground font-mono text-[10px]">↳</span>
                              )}
                              <span>{account.accountCode}</span>
                            </div>
                          </td>

                          {/* Name & Linked Supplier */}
                          <td className="px-3 py-2.5 font-semibold text-foreground">
                            <div className="flex items-center gap-2">
                              <span>{account.accountName}</span>
                              {account.supplierId && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 text-[9px] font-bold border border-blue-500/20">
                                  Supplier Link
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Type Badge */}
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${typeColors[account.accountType] || "bg-secondary text-foreground"}`}>
                              {account.accountType}
                            </span>
                          </td>

                          {/* Category */}
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {account.category || "—"}
                          </td>

                          {/* Posting vs Grouping Badge */}
                          <td className="px-3 py-2.5 text-center">
                            {account.isPostingAccount ? (
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                POSTING
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground border border-border">
                                GROUP (HEADER)
                              </span>
                            )}
                          </td>

                          {/* Balance */}
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">
                            €{(account.balance || 0).toFixed(2)}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-2.5 text-right space-x-1">
                            {account.allowSubAccounts !== false && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAccountEditMode("create");
                                  setEditingAccountId(null);
                                  handleParentAccountChange(account._id);
                                  setShowAccountModal(true);
                                }}
                                className="px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-bold transition-colors"
                                title="Create Sub-Account under this parent"
                              >
                                + Sub-Account
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setAccountEditMode("edit");
                                setEditingAccountId(account._id);
                                setAccountForm({
                                  accountCode: account.accountCode,
                                  accountName: account.accountName,
                                  accountType: account.accountType,
                                  category: account.category || "",
                                  parentAccountId: account.parentAccountId?._id || "",
                                  parentAccountCode: account.parentAccountCode || "",
                                  allowSubAccounts: account.allowSubAccounts !== false,
                                  isPostingAccount: account.isPostingAccount !== false,
                                  description: account.description || "",
                                  supplierId: account.supplierId?._id || ""
                                });
                                setShowAccountModal(true);
                              }}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                              title="Edit Account"
                            >
                              <Settings2 className="size-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(account)}
                              className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete Account"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: SUPPLIER BILLS & INVOICES                                           */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "bills" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="p-3 border-b border-border flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={billSearch}
                    onChange={e => setBillSearch(e.target.value)}
                    placeholder="Search bill number, invoice #..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-secondary/30 outline-none focus:border-primary"
                  />
                </div>

                <select
                  value={billStatusFilter}
                  onChange={e => setBillStatusFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border bg-secondary/30 outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid</option>
                  <option value="reversed">Reversed</option>
                </select>
              </div>

              <SecondaryButton icon={RefreshCw} onClick={loadBills}>
                Refresh
              </SecondaryButton>
            </div>

            {bills.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                No supplier bills found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] font-bold border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5">Bill #</th>
                      <th className="text-left px-3 py-2.5">Supplier</th>
                      <th className="text-left px-3 py-2.5">Supplier Inv #</th>
                      <th className="text-left px-3 py-2.5">Date</th>
                      <th className="text-right px-3 py-2.5">Subtotal (€)</th>
                      <th className="text-right px-3 py-2.5">VAT (€)</th>
                      <th className="text-right px-3 py-2.5">Grand Total (€)</th>
                      <th className="text-right px-3 py-2.5">Outstanding (€)</th>
                      <th className="text-right px-3 py-2.5">Status</th>
                      <th className="text-right px-3 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bills.map(b => (
                      <tr key={b._id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-bold text-primary">{b.billNumber}</td>
                        <td className="px-3 py-2.5 font-semibold text-foreground">
                          <button
                            type="button"
                            onClick={async () => {
                              const sId = typeof b.supplierId === 'object' ? b.supplierId._id : b.supplierId;
                              if (sId) {
                                const fullSupplier = await suppliersService.getById(sId);
                                setSelectedSupplierForProfile(fullSupplier);
                                setShowSupplierProfileModal(true);
                              }
                            }}
                            className="hover:underline text-left text-primary font-bold"
                          >
                            {b.supplierName}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">{b.supplierInvoiceNumber}</td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">
                          {new Date(b.billDate).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">€{b.subtotal.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">€{b.totalTax.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">
                          €{b.grandTotal.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-600">
                          €{b.outstandingAmount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <StatusBadge status={b.status} />
                        </td>
                        <td className="px-3 py-2.5 text-right space-x-1">
                          {b.status === "draft" && (
                            <button
                              type="button"
                              onClick={async () => {
                                await accountingService.postBill(b._id);
                                toast.success(`Bill ${b.billNumber} posted successfully!`);
                                loadBills();
                                loadOverview();
                              }}
                              className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-[10px] font-bold"
                            >
                              Post
                            </button>
                          )}

                          {(b.status === "posted" || b.status === "partially_paid") && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBill(b);
                                setPaymentForm({
                                  amount: b.outstandingAmount,
                                  paymentMethod: "Bank Transfer",
                                  paymentAccount: "572.000.001 - Banco Santander (Main Operating EUR)",
                                  reference: `PAY-${b.billNumber}`,
                                  notes: ""
                                });
                                setShowPaymentModal(true);
                              }}
                              className="px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[10px] font-bold"
                            >
                              Pay
                            </button>
                          )}

                          {b.status === "posted" && b.amountPaid === 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setReversalTarget({ type: "bill", id: b._id, number: b.billNumber });
                                setShowReversalModal(true);
                              }}
                              className="p-1 rounded text-destructive hover:bg-destructive/10"
                              title="Reverse Bill"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <TablePagination pagination={billsPagination} page={billsPage} onPageChange={setBillsPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 4: MANUAL JOURNAL ENTRIES                                              */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "journals" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div className="relative w-64">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={journalSearch}
                  onChange={e => setJournalSearch(e.target.value)}
                  placeholder="Search journal #, description..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-secondary/30 outline-none"
                />
              </div>
              <SecondaryButton icon={RefreshCw} onClick={loadJournals}>
                Refresh
              </SecondaryButton>
            </div>

            {journals.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                No journal entries recorded.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {journals.map(j => (
                  <div key={j._id} className="p-4 hover:bg-secondary/20 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-primary">{j.entryNumber}</span>
                        <span className="text-xs text-muted-foreground">• {new Date(j.date).toLocaleDateString()}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-secondary text-foreground capitalize">
                          {j.entryType}
                        </span>
                        <StatusBadge status={j.status} />
                      </div>

                      {j.status === "posted" && (
                        <button
                          type="button"
                          onClick={() => {
                            setReversalTarget({ type: "journal", id: j._id, number: j.entryNumber });
                            setShowReversalModal(true);
                          }}
                          className="px-2 py-1 rounded text-xs font-bold bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center gap-1"
                        >
                          <RotateCcw className="size-3" /> Reverse Entry
                        </button>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-foreground">{j.description}</p>

                    {/* Lines Table */}
                    <div className="rounded-lg border border-border overflow-hidden bg-background">
                      <table className="w-full text-[11px]">
                        <thead className="bg-secondary/40 text-muted-foreground uppercase text-[9px] font-bold border-b border-border">
                          <tr>
                            <th className="text-left px-3 py-1.5">Account</th>
                            <th className="text-left px-3 py-1.5">Description</th>
                            <th className="text-right px-3 py-1.5">Debit (€)</th>
                            <th className="text-right px-3 py-1.5">Credit (€)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border font-mono">
                          {j.lines.map((l, i) => (
                            <tr key={i}>
                              <td className="px-3 py-1 text-foreground font-bold">{l.account}</td>
                              <td className="px-3 py-1 text-muted-foreground">{l.description || "—"}</td>
                              <td className="px-3 py-1 text-right text-emerald-600">
                                {l.debit > 0 ? `€${l.debit.toFixed(2)}` : "—"}
                              </td>
                              <td className="px-3 py-1 text-right text-blue-600">
                                {l.credit > 0 ? `€${l.credit.toFixed(2)}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <TablePagination pagination={journalsPagination} page={journalsPage} onPageChange={setJournalsPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 5: GENERAL LEDGER TRANSACTION AUDIT TRAIL                              */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "ledger" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <Landmark className="size-4 text-primary" /> General Ledger Transaction Audit Trail
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete immutable double-entry ledger entries with exact debit and credit balances.
                </p>
              </div>
              <SecondaryButton icon={RefreshCw} onClick={loadOverview}>
                Refresh Ledger
              </SecondaryButton>
            </div>

            {transactions.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                No ledger transactions recorded.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] font-bold border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5">Date</th>
                      <th className="text-left px-3 py-2.5">Txn ID</th>
                      <th className="text-left px-3 py-2.5">Account</th>
                      <th className="text-left px-3 py-2.5">Description</th>
                      <th className="text-right px-3 py-2.5">Debit (€)</th>
                      <th className="text-right px-3 py-2.5">Credit (€)</th>
                      <th className="text-right px-3 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {transactions.map((t: any) => (
                      <tr key={t._id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(t.date).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 font-bold text-primary">{t.txnId}</td>
                        <td className="px-3 py-2 font-bold text-foreground">{t.account}</td>
                        <td className="px-3 py-2 text-muted-foreground font-sans">{t.description}</td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-600">
                          {t.debit > 0 ? `€${Number(t.debit).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-blue-600">
                          {t.credit > 0 ? `€${Number(t.credit).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-sans">
                          <StatusBadge status={t.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: CREATE / EDIT CHART OF ACCOUNT                                   */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        title={accountEditMode === "create" ? "Create Chart of Accounts Account" : "Edit Account"}
        subtitle="Configure Spanish PGC hierarchical account codes, parent grouping, and posting rules"
        width="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <ModalCancel onClose={() => setShowAccountModal(false)} />
            <ModalSubmit onClick={handleSaveAccount}>
              {accountEditMode === "create" ? "Create Account" : "Save Changes"}
            </ModalSubmit>
          </div>
        }
      >
        <div className="space-y-4">
          <Row>
            <Field label="Parent Account (Optional)">
              <Select
                value={accountForm.parentAccountId}
                onChange={e => handleParentAccountChange(e.target.value)}
              >
                <option value="">(None - Top Level Root Group)</option>
                {coaList
                  .filter(a => a.allowSubAccounts !== false && a._id !== editingAccountId)
                  .map(a => (
                    <option key={a._id} value={a._id}>
                      {a.accountCode} - {a.accountName} ({a.accountType})
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="Account Code" required>
              <Input
                value={accountForm.accountCode}
                onChange={e => setAccountForm({ ...accountForm, accountCode: e.target.value })}
                placeholder="e.g. 400.000.001"
              />
            </Field>
          </Row>

          <Row>
            <Field label="Account Name" required>
              <Input
                value={accountForm.accountName}
                onChange={e => setAccountForm({ ...accountForm, accountName: e.target.value })}
                placeholder="e.g. Bag Supplier"
              />
            </Field>

            <Field label="Account Type" required>
              <Select
                value={accountForm.accountType}
                onChange={e => setAccountForm({ ...accountForm, accountType: e.target.value as any })}
              >
                <option value="Asset">Asset (Activo)</option>
                <option value="Liability">Liability (Pasivo)</option>
                <option value="Equity">Equity (Patrimonio Neto)</option>
                <option value="Revenue">Revenue (Ingresos / Ventas)</option>
                <option value="Expense">Expense (Gastos / Compras)</option>
              </Select>
            </Field>
          </Row>

          <Row>
            <Field label="Accounting Category">
              <Input
                value={accountForm.category}
                onChange={e => setAccountForm({ ...accountForm, category: e.target.value })}
                placeholder="e.g. Accounts Payable, Current Assets"
              />
            </Field>

            <Field label="Link to Supplier (Optional)">
              <Select
                value={accountForm.supplierId}
                onChange={e => setAccountForm({ ...accountForm, supplierId: e.target.value })}
              >
                <option value="">(None - Generic Account)</option>
                {suppliers.map(s => (
                  <option key={s._id} value={s._id}>
                    {s.name} ({s.taxId || "No Tax ID"})
                  </option>
                ))}
              </Select>
            </Field>
          </Row>

          {/* Posting & Sub-Account Rules */}
          <div className="p-3.5 bg-secondary/30 rounded-xl border border-border space-y-2.5 text-xs">
            <div className="font-bold text-foreground uppercase tracking-wide">Posting & Hierarchy Rules</div>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={accountForm.isPostingAccount}
                onChange={e => setAccountForm({ ...accountForm, isPostingAccount: e.target.checked })}
                className="size-4 accent-primary rounded"
              />
              <span>
                <strong>Posting Account:</strong> Can receive direct Journal Entries, Supplier Bills, and Payments. (Uncheck for grouping headers).
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={accountForm.allowSubAccounts}
                onChange={e => setAccountForm({ ...accountForm, allowSubAccounts: e.target.checked })}
                className="size-4 accent-primary rounded"
              />
              <span>
                <strong>Allow Sub-Accounts:</strong> Allows creating child accounts under this account.
              </span>
            </label>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: 3-STEP EXCEL / CSV IMPORT WIZARD                                 */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        title="Import Spanish Chart of Accounts (PGC)"
        subtitle="Upload your Spanish PGC spreadsheet (.xlsx, .xls, .csv) with column mapping and pre-validation"
        width="2xl"
        footer={
          <div className="flex items-center justify-between w-full">
            {importStep === 1 ? (
              <ModalCancel onClose={() => setShowImportModal(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setImportStep((importStep - 1) as any)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary"
              >
                ← Back
              </button>
            )}

            {importStep === 2 && (
              <button
                type="button"
                onClick={handlePreviewImport}
                disabled={importing}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold shadow hover:opacity-90 disabled:opacity-50"
              >
                {importing ? "Validating..." : "Preview & Validate →"}
              </button>
            )}

            {importStep === 3 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={importing || (importPreviewData?.validCount === 0)}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow hover:opacity-90 disabled:opacity-50"
              >
                {importing ? "Importing..." : `Confirm & Import ${importPreviewData?.validCount || 0} Accounts`}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {/* Step Indicator */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold pb-2 border-b border-border">
            <div className={`p-2 rounded-lg ${importStep === 1 ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
              1. Upload File
            </div>
            <div className={`p-2 rounded-lg ${importStep === 2 ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
              2. Column Mapping
            </div>
            <div className={`p-2 rounded-lg ${importStep === 3 ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
              3. Dry Run Preview
            </div>
          </div>

          {/* STEP 1: UPLOAD FILE */}
          {importStep === 1 && (
            <div className="p-8 border-2 border-dashed border-border rounded-xl text-center space-y-3 bg-secondary/10">
              <FileSpreadsheet className="size-10 text-primary mx-auto" />
              <h4 className="font-bold text-sm text-foreground">Select Spanish Chart of Accounts File</h4>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Supports Excel (.xlsx, .xls) and CSV files. Automatic hierarchical resolution handles unsorted parent/child accounts.
              </p>
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="hidden"
                id="excel-file-upload"
              />
              <label
                htmlFor="excel-file-upload"
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold inline-block cursor-pointer shadow hover:opacity-90"
              >
                Choose Spreadsheet File
              </label>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING */}
          {importStep === 2 && (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-secondary/30 rounded-lg border border-border flex items-center justify-between">
                <div>
                  <strong>File:</strong> {importFileName} (Detected {rawSheetRows.length} rows)
                </div>
                <div className="flex items-center gap-2">
                  <label className="font-semibold">Import Mode:</label>
                  <select
                    value={importMode}
                    onChange={e => setImportMode(e.target.value as any)}
                    className="p-1 rounded bg-card border border-border"
                  >
                    <option value="create_new_only">Create New Accounts Only</option>
                    <option value="update_existing">Update Existing Accounts</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Account Code Column" required>
                  <Select
                    value={columnMapping.accountCode}
                    onChange={e => setColumnMapping({ ...columnMapping, accountCode: e.target.value })}
                  >
                    {detectedColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>

                <Field label="Account Name Column" required>
                  <Select
                    value={columnMapping.accountName}
                    onChange={e => setColumnMapping({ ...columnMapping, accountName: e.target.value })}
                  >
                    {detectedColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>

                <Field label="Account Type Column">
                  <Select
                    value={columnMapping.accountType}
                    onChange={e => setColumnMapping({ ...columnMapping, accountType: e.target.value })}
                  >
                    {detectedColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>

                <Field label="Parent Account Code Column">
                  <Select
                    value={columnMapping.parentAccountCode}
                    onChange={e => setColumnMapping({ ...columnMapping, parentAccountCode: e.target.value })}
                  >
                    <option value="">(None / Optional)</option>
                    {detectedColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          )}

          {/* STEP 3: DRY RUN PREVIEW */}
          {importStep === 3 && importPreviewData && (
            <div className="space-y-3 text-xs">
              {/* Validation Summary Badges */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <span className="text-[10px] uppercase font-bold text-emerald-700">Valid</span>
                  <div className="text-lg font-bold font-mono text-emerald-600">{importPreviewData.validCount}</div>
                </div>
                <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <span className="text-[10px] uppercase font-bold text-blue-700">New</span>
                  <div className="text-lg font-bold font-mono text-blue-600">+{importPreviewData.newCount}</div>
                </div>
                <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <span className="text-[10px] uppercase font-bold text-amber-700">Update</span>
                  <div className="text-lg font-bold font-mono text-amber-600">{importPreviewData.updateCount}</div>
                </div>
                <div className="p-2 bg-destructive/10 rounded-lg border border-destructive/20">
                  <span className="text-[10px] uppercase font-bold text-destructive">Invalid</span>
                  <div className="text-lg font-bold font-mono text-destructive">{importPreviewData.invalidCount}</div>
                </div>
              </div>

              {/* Preview Table */}
              <div className="rounded-lg border border-border overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[9px] font-bold border-b border-border sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5">Row</th>
                      <th className="text-left px-2 py-1.5">Code</th>
                      <th className="text-left px-2 py-1.5">Name</th>
                      <th className="text-left px-2 py-1.5">Type</th>
                      <th className="text-left px-2 py-1.5">Parent</th>
                      <th className="text-right px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {importPreviewData.previewRows.map((r, i) => (
                      <tr key={i} className={r.status === "INVALID" ? "bg-destructive/5" : ""}>
                        <td className="px-2 py-1 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-2 py-1 font-bold text-foreground">{r.accountCode}</td>
                        <td className="px-2 py-1 font-sans">{r.accountName}</td>
                        <td className="px-2 py-1 font-sans">{r.accountType}</td>
                        <td className="px-2 py-1 text-muted-foreground">{r.parentAccountCode || "—"}</td>
                        <td className="px-2 py-1 text-right">
                          {r.status === "VALID" ? (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${r.action === "NEW" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}`}>
                              {r.action}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-destructive/10 text-destructive" title={r.issues.join(", ")}>
                              INVALID
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: SUPPLIER PROFILE & MASTER DATA DETAILS                           */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedSupplierForProfile && (
        <Modal
          open={showSupplierProfileModal}
          onClose={() => setShowSupplierProfileModal(false)}
          title={`Supplier Profile: ${selectedSupplierForProfile.name}`}
          subtitle="Authoritative supplier master data, CIF/NIF, payment IBAN, and linked ledger account"
          width="2xl"
          footer={
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={() => setShowSupplierProfileModal(false)}
                className="px-4 py-2 bg-secondary text-foreground text-xs font-bold rounded-lg hover:bg-secondary/80"
              >
                Close Profile
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Top Metrics */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-3 bg-secondary/30 rounded-lg border border-border">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Total Billed</span>
                <div className="text-base font-bold font-mono text-foreground">
                  €{(selectedSupplierForProfile.metrics?.totalBilled || 0).toFixed(2)}
                </div>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <span className="text-[10px] uppercase font-bold text-emerald-700">Total Paid</span>
                <div className="text-base font-bold font-mono text-emerald-600">
                  €{(selectedSupplierForProfile.metrics?.totalPaid || 0).toFixed(2)}
                </div>
              </div>
              <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <span className="text-[10px] uppercase font-bold text-amber-700">Outstanding AP</span>
                <div className="text-base font-bold font-mono text-amber-600">
                  €{(selectedSupplierForProfile.metrics?.outstandingBalance || 0).toFixed(2)}
                </div>
              </div>
            </div>

            {/* General & Tax Info */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-secondary/20 rounded-lg border border-border">
              <div><strong>Contact Person:</strong> {selectedSupplierForProfile.contact || "—"}</div>
              <div><strong>Email:</strong> {selectedSupplierForProfile.email || "—"}</div>
              <div><strong>Phone:</strong> {selectedSupplierForProfile.phone || "—"}</div>
              <div><strong>Website:</strong> {selectedSupplierForProfile.website || "—"}</div>
              <div><strong>CIF / NIF / Tax ID:</strong> {selectedSupplierForProfile.taxId || "—"}</div>
              <div><strong>Country:</strong> {selectedSupplierForProfile.country}</div>
            </div>

            {/* Accounting Ledger Info */}
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-1">
              <div className="font-bold text-primary flex items-center gap-1.5">
                <Landmark className="size-3.5" /> Assigned Accounts Payable Sub-Account
              </div>
              <div className="font-mono text-sm font-bold text-foreground">
                {selectedSupplierForProfile.accountingInfo?.accountCode || "400.000.001"} — {selectedSupplierForProfile.accountingInfo?.accountName || selectedSupplierForProfile.name}
              </div>
              <p className="text-[11px] text-muted-foreground">
                All bills for this supplier automatically post liability credits directly to this sub-account in the General Ledger.
              </p>
            </div>

            {/* Bank Payment Info */}
            <div className="p-3 bg-secondary/20 rounded-lg border border-border space-y-1">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <CreditCard className="size-3.5" /> Bank & Payment Details
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><strong>Bank Name:</strong> {selectedSupplierForProfile.paymentInfo?.bankName || "—"}</div>
                <div><strong>IBAN:</strong> <span className="font-mono">{selectedSupplierForProfile.paymentInfo?.iban || "—"}</span></div>
                <div><strong>SWIFT / BIC:</strong> <span className="font-mono">{selectedSupplierForProfile.paymentInfo?.swiftBic || "—"}</span></div>
                <div><strong>Payment Terms:</strong> {selectedSupplierForProfile.paymentInfo?.defaultPaymentTerms || "Net 30"}</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: CREATE SUPPLIER BILL                                             */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showCreateBill}
        onClose={() => setShowCreateBill(false)}
        title="Create Supplier Bill / Received Invoice"
        subtitle="Record vendor expense and credit supplier Accounts Payable ledger account"
        width="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <ModalCancel onClose={() => setShowCreateBill(false)} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSaveBill('draft')}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary"
              >
                Save as Draft
              </button>
              <ModalSubmit onClick={() => handleSaveBill('posted')}>
                Post Supplier Bill
              </ModalSubmit>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Row>
            <Field label="Supplier" required>
              <Select
                value={billForm.supplierId}
                onChange={e => {
                  const s = suppliers.find(sup => sup._id === e.target.value);
                  setBillForm({
                    ...billForm,
                    supplierId: e.target.value,
                    paymentTerms: s?.paymentInfo?.defaultPaymentTerms || billForm.paymentTerms
                  });
                }}
              >
                <option value="">Select Supplier...</option>
                {suppliers.map(s => (
                  <option key={s._id} value={s._id}>
                    {s.name} ({s.accountingInfo?.accountCode || "400.000.001"})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Supplier Invoice Number" required>
              <Input
                value={billForm.supplierInvoiceNumber}
                onChange={e => setBillForm({ ...billForm, supplierInvoiceNumber: e.target.value })}
                placeholder="e.g. INV-2026-9901"
              />
            </Field>
          </Row>

          <Row>
            <Field label="Bill Date" required>
              <Input
                type="date"
                value={billForm.billDate}
                onChange={e => setBillForm({ ...billForm, billDate: e.target.value })}
              />
            </Field>

            <Field label="Due Date">
              <Input
                type="date"
                value={billForm.dueDate}
                onChange={e => setBillForm({ ...billForm, dueDate: e.target.value })}
              />
            </Field>
          </Row>

          {/* Expense Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-foreground">
              <span>Expense Lines</span>
              <button
                type="button"
                onClick={() => setBillForm({ ...billForm, lines: [...billForm.lines, blankBillLine()] })}
                className="text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="size-3" /> Add Line
              </button>
            </div>

            <div className="space-y-2">
              {billForm.lines.map((l, i) => (
                <div key={i} className="p-3 bg-secondary/30 rounded-xl border border-border space-y-2 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="Expense Account" required>
                      <Select
                        value={l.expenseAccount}
                        onChange={e => {
                          const lines = [...billForm.lines];
                          lines[i].expenseAccount = e.target.value;
                          setBillForm({ ...billForm, lines });
                        }}
                      >
                        {STANDARD_EXPENSE_ACCOUNTS.map(ac => (
                          <option key={ac} value={ac}>{ac}</option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Description" required>
                      <Input
                        value={l.description}
                        onChange={e => {
                          const lines = [...billForm.lines];
                          lines[i].description = e.target.value;
                          setBillForm({ ...billForm, lines });
                        }}
                        placeholder="e.g. Cardboard boxes packaging batch"
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <Field label="Qty">
                      <Input
                        type="number"
                        min="1"
                        value={l.quantity}
                        onChange={e => {
                          const lines = [...billForm.lines];
                          lines[i].quantity = Number(e.target.value);
                          setBillForm({ ...billForm, lines });
                        }}
                      />
                    </Field>

                    <Field label="Unit Price (€)">
                      <Input
                        type="number"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={e => {
                          const lines = [...billForm.lines];
                          lines[i].unitPrice = Number(e.target.value);
                          setBillForm({ ...billForm, lines });
                        }}
                      />
                    </Field>

                    <Field label="VAT Rate (%)">
                      <Select
                        value={l.taxRate}
                        onChange={e => {
                          const lines = [...billForm.lines];
                          lines[i].taxRate = Number(e.target.value);
                          setBillForm({ ...billForm, lines });
                        }}
                      >
                        <option value="21">21% (Standard)</option>
                        <option value="10">10% (Reduced)</option>
                        <option value="4">4% (Super Reduced)</option>
                        <option value="0">0% (Exempt)</option>
                      </Select>
                    </Field>

                    <div className="flex flex-col justify-center text-right pr-2">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">Line Total</span>
                      <span className="font-mono font-bold text-foreground">
                        €{billCalculations.lines[i]?.lineTotal.toFixed(2) || "0.00"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals Summary */}
          <div className="p-3 bg-secondary/40 rounded-xl border border-border space-y-1 text-xs text-right font-mono">
            <div>Subtotal: <strong>€{billCalculations.subtotal.toFixed(2)}</strong></div>
            <div>Input VAT: <strong>€{billCalculations.totalTax.toFixed(2)}</strong></div>
            <div className="text-sm font-bold text-primary pt-1 border-t border-border">
              Grand Total: €{billCalculations.grandTotal.toFixed(2)}
            </div>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 5: RECORD PAYMENT                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedBill && (
        <Modal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          title={`Record Payment for ${selectedBill.billNumber}`}
          subtitle={`Supplier: ${selectedBill.supplierName} • Outstanding Balance: €${selectedBill.outstandingAmount.toFixed(2)}`}
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowPaymentModal(false)} />
              <ModalSubmit onClick={async () => {
                try {
                  await accountingService.recordPayment(selectedBill._id, paymentForm);
                  toast.success("Payment recorded successfully!");
                  setShowPaymentModal(false);
                  loadBills();
                  loadOverview();
                } catch (err: any) {
                  toast.error(err.response?.data?.message || "Failed to record payment");
                }
              }}>
                Confirm Payment
              </ModalSubmit>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Payment Amount (€)" required>
              <Input
                type="number"
                step="0.01"
                max={selectedBill.outstandingAmount}
                value={paymentForm.amount}
                onChange={e => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
              />
            </Field>

            <Field label="Disbursement Account" required>
              <Select
                value={paymentForm.paymentAccount}
                onChange={e => setPaymentForm({ ...paymentForm, paymentAccount: e.target.value })}
              >
                {STANDARD_PAYMENT_ACCOUNTS.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Select>
            </Field>

            <Field label="Payment Method">
              <Select
                value={paymentForm.paymentMethod}
                onChange={e => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
              >
                <option value="Bank Transfer">Bank Transfer (SEPA)</option>
                <option value="Credit Card">Corporate Credit Card</option>
                <option value="Direct Debit">Direct Debit</option>
                <option value="Cash">Cash</option>
              </Select>
            </Field>

            <Field label="Reference / Notes">
              <Input
                value={paymentForm.reference}
                onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                placeholder="Bank transaction ref..."
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 6: CREATE MANUAL JOURNAL ENTRY                                      */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showCreateJournal}
        onClose={() => setShowCreateJournal(false)}
        title="New Manual Double-Entry Journal Entry"
        subtitle="Create authoritative balanced journal entry (Total Debits must equal Total Credits)"
        width="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <ModalCancel onClose={() => setShowCreateJournal(false)} />
            <ModalSubmit onClick={handleSaveJournal} disabled={!journalBalance.isBalanced}>
              Post Journal Entry
            </ModalSubmit>
          </div>
        }
      >
        <div className="space-y-4">
          <Row>
            <Field label="Entry Date" required>
              <Input
                type="date"
                value={journalForm.date}
                onChange={e => setJournalForm({ ...journalForm, date: e.target.value })}
              />
            </Field>

            <Field label="Reference (Optional)">
              <Input
                value={journalForm.reference}
                onChange={e => setJournalForm({ ...journalForm, reference: e.target.value })}
                placeholder="e.g. ADJ-2026-01"
              />
            </Field>
          </Row>

          <Field label="Description / Reason" required>
            <Input
              value={journalForm.description}
              onChange={e => setJournalForm({ ...journalForm, description: e.target.value })}
              placeholder="e.g. Month-end depreciation adjustment"
            />
          </Field>

          {/* Journal Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-foreground">
              <span>Journal Lines (Min 2)</span>
              <button
                type="button"
                onClick={() => setJournalForm({
                  ...journalForm,
                  lines: [...journalForm.lines, { account: "572.000.001 - Banco Santander (Main Operating EUR)", description: "", debit: 0, credit: 0 }]
                })}
                className="text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="size-3" /> Add Line
              </button>
            </div>

            <div className="space-y-2">
              {journalForm.lines.map((l, i) => (
                <div key={i} className="p-3 bg-secondary/30 rounded-xl border border-border space-y-2 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="Account" required>
                      <Select
                        value={l.account}
                        onChange={e => {
                          const lines = [...journalForm.lines];
                          lines[i].account = e.target.value;
                          setJournalForm({ ...journalForm, lines });
                        }}
                      >
                        {coaList.filter(a => a.isPostingAccount !== false).map(a => (
                          <option key={a._id} value={`${a.accountCode} - ${a.accountName}`}>
                            {a.accountCode} - {a.accountName} ({a.accountType})
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Line Description">
                      <Input
                        value={l.description}
                        onChange={e => {
                          const lines = [...journalForm.lines];
                          lines[i].description = e.target.value;
                          setJournalForm({ ...journalForm, lines });
                        }}
                        placeholder="Line memo..."
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Debit (€)">
                      <Input
                        type="number"
                        step="0.01"
                        value={l.debit || ""}
                        onChange={e => {
                          const lines = [...journalForm.lines];
                          lines[i].debit = Number(e.target.value);
                          lines[i].credit = 0; // mutually exclusive
                          setJournalForm({ ...journalForm, lines });
                        }}
                        placeholder="0.00"
                      />
                    </Field>

                    <Field label="Credit (€)">
                      <Input
                        type="number"
                        step="0.01"
                        value={l.credit || ""}
                        onChange={e => {
                          const lines = [...journalForm.lines];
                          lines[i].credit = Number(e.target.value);
                          lines[i].debit = 0; // mutually exclusive
                          setJournalForm({ ...journalForm, lines });
                        }}
                        placeholder="0.00"
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Balance Invariant Indicator */}
          <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-mono font-bold ${
            journalBalance.isBalanced ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-destructive/10 border-destructive/20 text-destructive"
          }`}>
            <div>Debits: €{journalBalance.debits.toFixed(2)}</div>
            <div>Credits: €{journalBalance.credits.toFixed(2)}</div>
            <div className="flex items-center gap-1.5 font-sans font-bold text-xs">
              {journalBalance.isBalanced ? (
                <>
                  <CheckCircle2 className="size-3.5" /> BALANCED
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3.5" /> UNBALANCED (Diff: €{journalBalance.diff.toFixed(2)})
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 7: REVERSAL CONFIRMATION MODAL                                      */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {reversalTarget && (
        <Modal
          open={showReversalModal}
          onClose={() => setShowReversalModal(false)}
          title={`Reverse ${reversalTarget.type === 'bill' ? 'Supplier Bill' : 'Journal Entry'}: ${reversalTarget.number}`}
          subtitle="Non-destructive financial reversal: Creates an exact inverted double-entry entry"
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowReversalModal(false)} />
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (reversalTarget.type === 'bill') {
                      await accountingService.reverseBill(reversalTarget.id, reversalReason);
                      toast.success(`Supplier Bill ${reversalTarget.number} reversed!`);
                      loadBills();
                    } else {
                      await accountingService.reverseJournalEntry(reversalTarget.id, reversalReason);
                      toast.success(`Journal Entry ${reversalTarget.number} reversed!`);
                      loadJournals();
                    }
                    setShowReversalModal(false);
                    loadOverview();
                  } catch (err: any) {
                    toast.error(err.response?.data?.message || "Failed to reverse entry");
                  }
                }}
                className="px-4 py-2 bg-destructive text-destructive-foreground text-xs font-bold rounded-lg shadow hover:opacity-90"
              >
                Confirm Reversal
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <Field label="Reversal Reason" required>
              <Input
                value={reversalReason}
                onChange={e => setReversalReason(e.target.value)}
                placeholder="Reason for financial reversal..."
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Accounting;
