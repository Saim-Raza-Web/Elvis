import { useState, useEffect } from "react";
import {
  Calculator, Download, RefreshCw, FileText, CheckCircle2,
  AlertCircle, Plus, Building, Layers, ArrowUpRight, Clock,
  DollarSign, PackageCheck, Boxes, Truck
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { billingService } from "../../services/billing.service";
import { clientsService } from "../../services/clients.service";

export function ThreePlBillingTab() {
  const [rateCards, setRateCards] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [evaluatingRule, setEvaluatingRule] = useState(false);

  const now = new Date();
  const [client, setClient] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [warehouse, setWarehouse] = useState("MIA");
  const [liquidation, setLiquidation] = useState<any | null>(null);

  // Load clients & rate cards
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [rcList, cList] = await Promise.all([
          billingService.getRateCards().catch(() => []),
          clientsService.getAll().catch(() => [])
        ]);
        setRateCards(rcList);
        setClients(cList);
        if (cList.length > 0 && !client) {
          setClient(cList[0].name);
        }
      } catch (err: any) {
        toast.error("Failed to load 3PL billing configuration");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Run calculation
  async function handleCalculate() {
    if (!client) {
      toast.error("Please select a 3PL client");
      return;
    }
    setCalculating(true);
    try {
      const res = await billingService.calculate3pl({ client, year, month, warehouse });
      setLiquidation(res);
      toast.success(`Calculated 3PL liquidation for ${client} (${month}/${year})`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to calculate 3PL billing");
    } finally {
      setCalculating(false);
    }
  }

  // Evaluate 20-Day Rule
  async function handleEvaluate20DayRule() {
    setEvaluatingRule(true);
    try {
      const res = await billingService.evaluate20DayRule();
      const count = res.convertedClients?.length || 0;
      if (count > 0) {
        toast.success(`20-Day Rule Evaluated: ${count} client(s) converted to RECURRENT modality.`);
      } else {
        toast.info("20-Day Rule Evaluated: No pending conversions found today.");
      }
      // Reload clients to refresh modality
      const cList = await clientsService.getAll().catch(() => []);
      setClients(cList);
    } catch (err: any) {
      toast.error("Failed to evaluate 20-day storage rule");
    } finally {
      setEvaluatingRule(false);
    }
  }

  // Export PDF
  async function handleDownloadPdf() {
    if (!liquidation) return;
    try {
      await billingService.download3plPdf({ client, year, month, warehouse });
      toast.success("Liquidación 3PL PDF downloaded successfully");
    } catch (err: any) {
      toast.error("Failed to generate PDF");
    }
  }

  // Export CSV
  async function handleDownloadCsv() {
    if (!liquidation) return;
    try {
      await billingService.download3plCsv({ client, year, month, warehouse });
      toast.success("Liquidación 3PL CSV downloaded successfully");
    } catch (err: any) {
      toast.error("Failed to generate CSV");
    }
  }

  return (
    <div className="space-y-6">
      {/* 20-Day Storage Rule & Client Modality Banner */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
            <Clock className="size-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-foreground">Regla 20 Días / 20-Day Storage Rule (RF-P15)</h4>
            <p className="text-xs text-muted-foreground">
              Clients with active inventory for &gt;20 days automatically transition from temporal daily storage to recurrent monthly billing.
            </p>
          </div>
        </div>
        <button
          onClick={handleEvaluate20DayRule}
          disabled={evaluatingRule}
          className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          <RefreshCw className={`size-3.5 ${evaluatingRule ? "animate-spin" : ""}`} />
          {evaluatingRule ? "Evaluating..." : "Evaluar Regla 20 Días"}
        </button>
      </div>

      {/* Calculator Section */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="size-5 text-primary" />
            <h3 className="font-bold text-base">3PL Monthly Settlement / Liquidación Mensual</h3>
          </div>
          <span className="text-xs text-muted-foreground">Authoritative Rate Card Calculation</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">3PL Client</label>
            <select
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm outline-none focus:border-primary/50"
            >
              {clients.map((c) => (
                <option key={c._id || c.name} value={c.name}>
                  {c.name} ({c.billingModality || "TEMPORAL"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm outline-none focus:border-primary/50 font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm outline-none focus:border-primary/50 font-mono"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2026, m - 1, 1).toLocaleString("default", { month: "long" })} ({m})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Warehouse</label>
            <input
              type="text"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm outline-none focus:border-primary/50 font-mono uppercase"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <PrimaryButton icon={Calculator} onClick={handleCalculate} disabled={calculating}>
            {calculating ? "Calculating..." : "Calcular Liquidación 3PL"}
          </PrimaryButton>
        </div>
      </div>

      {/* Liquidation Results Table */}
      {liquidation && (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in-up space-y-4 p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">{liquidation.client}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary uppercase">
                  {liquidation.clientModality || "RECURRENT"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Period: {liquidation.period?.month}/{liquidation.period?.year} • Warehouse: {liquidation.warehouse} • Rate Card: {liquidation.rateCardName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadPdf}
                className="px-3 py-1.5 rounded-lg border border-border bg-secondary/50 hover:bg-secondary text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Download className="size-3.5" />
                Export PDF
              </button>
              <button
                onClick={handleDownloadCsv}
                className="px-3 py-1.5 rounded-lg border border-border bg-secondary/50 hover:bg-secondary text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <FileText className="size-3.5" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Concepts Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg border border-border bg-secondary/30">
              <div className="text-xs text-muted-foreground flex items-center justify-between">
                <span>Inbound Reception</span>
                <PackageCheck className="size-4 text-primary" />
              </div>
              <div className="text-lg font-bold font-mono mt-1">€{liquidation.concepts?.inbound?.subtotal?.toFixed(2)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {liquidation.concepts?.inbound?.palletsUnloaded || 0} pallets unloaded
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-secondary/30">
              <div className="text-xs text-muted-foreground flex items-center justify-between">
                <span>Storage (Pallet-Days)</span>
                <Boxes className="size-4 text-purple-500" />
              </div>
              <div className="text-lg font-bold font-mono mt-1">€{liquidation.concepts?.storage?.subtotal?.toFixed(2)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {liquidation.concepts?.storage?.palletDays || 0} pallet-days • {liquidation.concepts?.storage?.modality}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-secondary/30">
              <div className="text-xs text-muted-foreground flex items-center justify-between">
                <span>Outbound Fulfillment (B2C + B2B)</span>
                <Truck className="size-4 text-blue-500" />
              </div>
              <div className="text-lg font-bold font-mono mt-1">
                €{((liquidation.concepts?.outboundB2C?.subtotal || 0) + (liquidation.concepts?.outboundB2B?.subtotal || 0)).toFixed(2)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {liquidation.concepts?.outboundB2C?.ordersCount || 0} B2C orders • {liquidation.concepts?.outboundB2B?.fullPalletsPicked || 0} B2B pallets
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-border bg-secondary/30">
              <div className="text-xs text-muted-foreground flex items-center justify-between">
                <span>Returns & Value-Added</span>
                <Layers className="size-4 text-emerald-500" />
              </div>
              <div className="text-lg font-bold font-mono mt-1">
                €{((liquidation.concepts?.returns?.subtotal || 0) + (liquidation.concepts?.valueAdded?.subtotal || 0)).toFixed(2)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {liquidation.concepts?.returns?.unitsInspected || 0} returns inspected
              </div>
            </div>
          </div>

          {/* Grand Totals Summary */}
          <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Concepts Subtotal</span>
              <span className="font-mono">€{liquidation.totals?.conceptsSubtotal?.toFixed(2)}</span>
            </div>
            {liquidation.totals?.minimumAdjustment > 0 && (
              <div className="flex justify-between text-xs text-amber-500 font-medium">
                <span>Monthly Minimum Adjustment (RF-P15)</span>
                <span className="font-mono">+€{liquidation.totals?.minimumAdjustment?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Taxable Base</span>
              <span className="font-mono">€{liquidation.totals?.taxableBase?.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>VAT (21%)</span>
              <span className="font-mono">€{liquidation.totals?.vatAmount?.toFixed(2)}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-bold text-base text-foreground">
              <span>Total Liquidación 3PL</span>
              <span className="font-mono text-primary">€{liquidation.totals?.grandTotal?.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 3PL Rate Cards List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            <h3 className="font-bold text-sm">Active 3PL Rate Cards / Cuadro de Tarifas</h3>
          </div>
          <span className="text-xs text-muted-foreground">{rateCards.length} rate cards registered</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">Client / Name</th>
              <th className="text-left px-4 py-3">Warehouse</th>
              <th className="text-right px-4 py-3">Storage / Pallet Day</th>
              <th className="text-right px-4 py-3">Outbound B2C Base</th>
              <th className="text-right px-4 py-3">Monthly Minimum</th>
              <th className="text-center px-4 py-3">20-Day Rule</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rateCards.map((rc) => (
              <tr key={rc._id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-semibold text-primary">{rc.name}</div>
                  <div className="text-[11px] text-muted-foreground">{rc.client}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{rc.warehouse || "ALL"}</td>
                <td className="px-4 py-3 text-right font-mono">€{(rc.rates?.storage?.palletDayCost || 0.45).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono">€{(rc.rates?.outboundB2C?.orderPreparationBase || 2.20).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono">€{(rc.minimums?.monthlyMinimumAmount || 150).toFixed(2)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${rc.twentyDayRuleEnabled !== false ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                    {rc.twentyDayRuleEnabled !== false ? "ENABLED" : "DISABLED"}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={rc.isActive !== false ? "active" : "inactive"} />
                </td>
              </tr>
            ))}
            {rateCards.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No custom rate cards defined yet. Standard default rates apply.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
