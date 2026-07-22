import { useState, useEffect } from "react";
import { BarChart3, TrendingUp, Package, Truck, Globe, Users, FileText, Warehouse, ShoppingCart, Download, Clock } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { SecondaryButton } from "./AppShell";
import { useLang } from "../LangContext";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { reportsService } from "../../services/reports.service";

// Dynamic data will be loaded from backend

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--foreground)",
  fontSize: "12px",
};

const reportTabIds = ["overview", "inventory", "warehouse", "ecommerce", "logistics", "customers", "financial"] as const;
const reportTabIcons = [BarChart3, Package, Warehouse, Globe, Truck, Users, FileText];

export function Reports() {
  const { t } = useLang();
  const reportTabs = reportTabIds.map((id, i) => ({ id, label: t.reports.tabs[id as keyof typeof t.reports.tabs], icon: reportTabIcons[i] }));
  const [activeTab, setActiveTab] = useState("overview");
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedForm, setSchedForm] = useState({ report: "overview", freq: "weekly", email: "", format: "pdf" });

  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [orderStatusData, setOrderStatusData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [shippingData, setShippingData] = useState<any[]>([]);
  const [warehousePerf, setWarehousePerf] = useState<any[]>([]);
  const [channelData, setChannelData] = useState<any[]>([]);
  const [headerStats, setHeaderStats] = useState({ revenueMTD: 0, ordersMTD: 0, avgOrderValue: 0, onTimeDelivery: 100 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await reportsService.getDashboardStats();
        setRevenueData(data.revenueData || []);
        setOrderStatusData(data.orderStatusData || []);
        setCategoryData(data.categoryData || []);
        setShippingData(data.shippingData || []);
        setWarehousePerf(data.warehousePerf || []);
        setChannelData(data.channelData || []);
        if (data.headerStats) setHeaderStats(data.headerStats);
      } catch (err) {
        toast.error("Failed to load live report data");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  async function handleExportPDF() {
    try {
      await reportsService.exportPDF(activeTab);
      toast.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} report exported as PDF — check your downloads.`);
    } catch (error) {
      toast.error("Failed to export report");
    }
  }

  async function handleScheduleReport() {
    if (!schedForm.email) { toast.error("Recipient email is required."); return; }
    try {
      await reportsService.scheduleReport(schedForm);
      toast.success(`${schedForm.report} report scheduled ${schedForm.freq} → ${schedForm.email}`);
      setShowSchedule(false);
      setSchedForm({ report: "overview", freq: "weekly", email: "", format: "pdf" });
    } catch (error) {
      toast.error("Failed to schedule report");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.reports.revenueMTD, value: `€${(headerStats.revenueMTD / 1000).toFixed(1)}k`, icon: TrendingUp, color: "text-success", sub: "+19.7% vs last month" },
          { label: t.reports.ordersMTD, value: headerStats.ordersMTD.toString(), icon: ShoppingCart, color: "text-primary", sub: "+18.3% vs last month" },
          { label: t.reports.avgOrderValue, value: `€${headerStats.avgOrderValue.toFixed(0)}`, icon: BarChart3, color: "text-amber-500", sub: "+1.2% vs last month" },
          { label: t.reports.onTimeDelivery, value: `${headerStats.onTimeDelivery.toFixed(0)}%`, icon: Truck, color: "text-info", sub: "+2pp vs last month" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
            <div className="text-xs text-success mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Report actions */}
      <div className="flex items-center justify-end gap-2">
        <SecondaryButton icon={Download} onClick={handleExportPDF}>{t.reports.exportPDF}</SecondaryButton>
        <SecondaryButton icon={Clock} onClick={() => setShowSchedule(true)}>{t.reports.scheduleReport}</SecondaryButton>
      </div>

      {/* Report tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-0">
        {reportTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all -mb-px ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Revenue & Orders — 2026</h3>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => name === "revenue" ? [`€${v.toLocaleString()}`, "Revenue"] : [v, "Orders"]} />
                <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-bold mb-4">Order Status Distribution</h3>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={180}>
                  <PieChart><Pie data={orderStatusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={2}>
                    {orderStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie><Tooltip contentStyle={tooltipStyle} /></PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {orderStatusData.map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: s.color }} /><span className="text-muted-foreground">{s.name}</span></div>
                      <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-bold mb-4">Carrier On-Time Performance</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={shippingData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="carrier" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v}%`, name === "onTime" ? "On-time" : "Late"]} />
                  <Bar dataKey="onTime" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="late" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === "inventory" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Inventory Value by Category</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`€${v.toLocaleString()}`, "Value"]} />
                <Bar dataKey="value" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Units by Category</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="units" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "warehouse" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Warehouse Performance</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={warehousePerf}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="wh" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="picks" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Picks" />
                <Bar dataKey="errors" fill="#ef4444" radius={[4, 4, 0, 0]} name="Errors" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border"><h3 className="font-bold">Utilization by warehouse</h3></div>
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5">Warehouse</th>
                  <th className="text-right px-4 py-2.5">Picks</th>
                  <th className="text-right px-4 py-2.5">Errors</th>
                  <th className="text-right px-4 py-2.5">Error rate</th>
                  <th className="text-left px-4 py-2.5">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {warehousePerf.map((w) => (
                  <tr key={w.wh} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{w.wh}</td>
                    <td className="px-4 py-3 text-right">{w.picks}</td>
                    <td className="px-4 py-3 text-right text-destructive">{w.errors}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{((w.errors / w.picks) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${w.utilization > 90 ? "bg-destructive" : w.utilization > 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${w.utilization}%` }} />
                        </div>
                        <span className="text-xs" style={{ fontFamily: "JetBrains Mono, monospace" }}>{w.utilization}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "ecommerce" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Orders by Channel</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={channelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="channel" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="orders" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Orders" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Revenue by Channel</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={channelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="channel" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`€${v.toLocaleString()}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {(activeTab === "logistics" || activeTab === "customers" || activeTab === "financial") && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-4">Revenue trend & Order volume</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={{ fill: "#4f46e5" }} name="Revenue" />
                <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#22d3ee" strokeWidth={2} dot={{ fill: "#22d3ee" }} name="Orders" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <Modal open={showSchedule} onClose={() => setShowSchedule(false)} title={t.reports.scheduleReport} subtitle="Auto-deliver reports on a recurring basis" footer={<><ModalCancel onClose={() => setShowSchedule(false)} /><ModalSubmit onClick={handleScheduleReport}>{t.common.schedule}</ModalSubmit></>}>
        <Row>
          <Field label={t.reports.reportType}><Select value={schedForm.report} onChange={(e) => setSchedForm({ ...schedForm, report: e.target.value })}>
            {reportTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </Select></Field>
          <Field label={t.reports.format}><Select value={schedForm.format} onChange={(e) => setSchedForm({ ...schedForm, format: e.target.value })}>
            <option value="pdf">{t.reports.formats.pdf}</option><option value="csv">{t.reports.formats.csv}</option><option value="xlsx">{t.reports.formats.xlsx}</option>
          </Select></Field>
        </Row>
        <Field label={t.reports.frequency}><Select value={schedForm.freq} onChange={(e) => setSchedForm({ ...schedForm, freq: e.target.value })}>
          <option value="daily">{t.reports.freqs.daily}</option><option value="weekly">{t.reports.freqs.weekly}</option><option value="monthly">{t.reports.freqs.monthly}</option>
        </Select></Field>
        <Field label={t.reports.recipient} required><Input type="email" value={schedForm.email} onChange={(e) => setSchedForm({ ...schedForm, email: e.target.value })} placeholder="finance@company.com" /></Field>
      </Modal>
    </div>
  );
}
