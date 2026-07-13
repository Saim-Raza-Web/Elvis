import { BookOpen, TrendingUp, TrendingDown, DollarSign, BarChart3, Download } from "lucide-react";
import { toast } from "sonner";
import { SecondaryButton } from "./AppShell";
import { useLang } from "../LangContext";

const transactions = [
  { id: "TXN-5512", date: "2026-06-26", description: "Invoice INV-0087 - Apex Industries", type: "credit", amount: 4200.00, account: "Accounts Receivable", category: "Revenue" },
  { id: "TXN-5511", date: "2026-06-25", description: "Warehouse rent - Miami Hub June", type: "debit", amount: 8500.00, account: "Operating Expenses", category: "Facility" },
  { id: "TXN-5510", date: "2026-06-25", description: "Invoice INV-0086 - Nova Retail Group", type: "credit", amount: 8750.00, account: "Accounts Receivable", category: "Revenue" },
  { id: "TXN-5509", date: "2026-06-24", description: "FedEx shipping costs - June batch", type: "debit", amount: 1240.50, account: "Shipping Expenses", category: "Logistics" },
  { id: "TXN-5508", date: "2026-06-23", description: "Payroll - Warehouse staff June", type: "debit", amount: 22100.00, account: "Payroll", category: "HR" },
  { id: "TXN-5507", date: "2026-06-22", description: "Invoice INV-0082 - Crestline Corp", type: "credit", amount: 3800.00, account: "Accounts Receivable", category: "Revenue" },
  { id: "TXN-5506", date: "2026-06-20", description: "Equipment maintenance - LAX DC", type: "debit", amount: 650.00, account: "Maintenance", category: "Facility" },
  { id: "TXN-5505", date: "2026-06-18", description: "Insurance premium Q2", type: "debit", amount: 4800.00, account: "Insurance", category: "Operating" },
];

const accounts = [
  { name: "Cash & Cash Equivalents", balance: 142500, change: +8200 },
  { name: "Accounts Receivable", balance: 24890, change: -1400 },
  { name: "Inventory Assets", balance: 198000, change: +5600 },
  { name: "Accounts Payable", balance: -31200, change: -2100 },
  { name: "Operating Expenses YTD", balance: -284000, change: -22100 },
  { name: "Revenue YTD", balance: 521400, change: +16750 },
];

export function Accounting() {
  const { t } = useLang();
  const totalRevenue = 521400;
  const totalExpenses = 284000;
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = ((netProfit / totalRevenue) * 100).toFixed(1);

  function handleExport() {
    toast.success(t.accounting.exportSuccess);
  }

  return (
    <div className="space-y-6">
      {/* Export action */}
      <div className="flex justify-end">
        <SecondaryButton icon={Download} onClick={handleExport}>{t.accounting.exportReport}</SecondaryButton>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.accounting.revenueYTD, value: `€${(totalRevenue / 1000).toFixed(0)}k`, icon: TrendingUp, color: "text-success" },
          { label: t.accounting.expensesYTD, value: `€${(totalExpenses / 1000).toFixed(0)}k`, icon: TrendingDown, color: "text-destructive" },
          { label: t.accounting.netProfit, value: `€${(netProfit / 1000).toFixed(0)}k`, icon: DollarSign, color: "text-primary" },
          { label: t.accounting.margin, value: `${profitMargin}%`, icon: BarChart3, color: "text-amber-500" },
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart of Accounts */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-bold mb-4 flex items-center gap-2"><BookOpen className="size-4" /> {t.accounting.chartOfAccounts}</h3>
          <div className="space-y-2.5">
            {accounts.map((acc) => (
              <div key={acc.name} className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-sm truncate">{acc.name}</div>
                  <div className={`text-[10px] font-semibold ${acc.change >= 0 ? "text-success" : "text-destructive"}`}>
                    {acc.change >= 0 ? "+" : ""}€{acc.change.toLocaleString()}
                  </div>
                </div>
                <div className={`font-bold text-sm shrink-0 ${acc.balance < 0 ? "text-destructive" : ""}`} style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  {acc.balance < 0 ? "-" : ""}€{Math.abs(acc.balance).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transactions */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-bold">{t.accounting.recentTransactions}</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5">ID</th>
                <th className="text-left px-4 py-2.5">{t.accounting.description}</th>
                <th className="text-left px-4 py-2.5 hidden md:table-cell">{t.accounting.category}</th>
                <th className="text-left px-4 py-2.5 hidden sm:table-cell">{t.common.date}</th>
                <th className="text-right px-4 py-2.5">{t.common.amount}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, i) => (
                <tr key={t.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{t.id}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-sm">{t.description}</div>
                    <div className="text-xs text-muted-foreground">{t.account}</div>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">{t.category}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell text-xs text-muted-foreground">{t.date}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${t.type === "credit" ? "text-success" : "text-destructive"}`} style={{ fontFamily: "JetBrains Mono, monospace" }}>
                    {t.type === "credit" ? "+" : "-"}€{t.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
