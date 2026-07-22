import { BookOpen, TrendingUp, TrendingDown, DollarSign, BarChart3, Download } from "lucide-react";
import { toast } from "sonner";
import { SecondaryButton } from "./AppShell";
import { useLang } from "../LangContext";

import { useEffect, useState } from "react";
import { accountingService } from "../../services/accounting.service";

type Transaction = { _id: string; id: string; date: string; description: string; type: string; amount: number; account: string; category: string; txnId?: string };



export function Accounting() {
  const { t } = useLang();
  const [transactionList, setTransactionList] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const data = await accountingService.getAll();
      setTransactionList((data.transactions || []).map((d: any) => ({ ...d, id: d.txnId || d._id, date: d.date?.slice(0, 10) || "—" })));
      setAccounts(data.accounts || []);
    } catch (err) {
      toast.error("Failed to load transactions");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);
  const totalRevenue = transactionList.filter(t => t.type === "credit").reduce((a, t) => a + t.amount, 0);
  const totalExpenses = transactionList.filter(t => t.type === "debit").reduce((a, t) => a + t.amount, 0);
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0.0";

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
              {transactionList.map((t, i) => (
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
