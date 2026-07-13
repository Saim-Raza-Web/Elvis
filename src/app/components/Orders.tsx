import { useState } from "react";
import { ShoppingCart, Plus, Search, Eye, Package } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const allOrders = [
  { id: "1", order_number: "ORD-00183", customer: "Apex Industries", email: "orders@apex.io", status: "processing", total: 2341.00, items: 5, channel: "web", date: "2026-06-26", warehouse: "MIA" },
  { id: "2", order_number: "ORD-00182", customer: "Blue Horizon LLC", email: "bh@bluehorizon.com", status: "shipped", total: 876.50, items: 2, channel: "api", date: "2026-06-25", warehouse: "LAX" },
  { id: "3", order_number: "ORD-00181", customer: "Nova Retail Group", email: "purchasing@novaretail.com", status: "delivered", total: 4120.00, items: 10, channel: "web", date: "2026-06-24", warehouse: "ORD" },
  { id: "4", order_number: "ORD-00180", customer: "Summit Supply Co.", email: "supply@summit.co", status: "pending", total: 639.99, items: 3, channel: "mobile", date: "2026-06-24", warehouse: "MIA" },
  { id: "5", order_number: "ORD-00179", customer: "Crestline Corp", email: "c@crestline.corp", status: "processing", total: 1887.25, items: 7, channel: "api", date: "2026-06-23", warehouse: "DAL" },
  { id: "6", order_number: "ORD-00178", customer: "TechFlow Systems", email: "ops@techflow.com", status: "delivered", total: 3250.00, items: 8, channel: "web", date: "2026-06-22", warehouse: "LAX" },
  { id: "7", order_number: "ORD-00177", customer: "Pacific Goods Inc.", email: "pg@pacific.biz", status: "cancelled", total: 420.00, items: 1, channel: "web", date: "2026-06-21", warehouse: "SEA" },
  { id: "8", order_number: "ORD-00176", customer: "EastCoast Supplies", email: "ec@eastcoast.com", status: "shipped", total: 5100.00, items: 12, channel: "api", date: "2026-06-20", warehouse: "JFK" },
  { id: "9", order_number: "ORD-00175", customer: "Red Rock Trading", email: "rr@redrock.trade", status: "delivered", total: 789.50, items: 4, channel: "web", date: "2026-06-19", warehouse: "DAL" },
  { id: "10", order_number: "ORD-00174", customer: "Sigma Wholesale", email: "admin@sigma.ws", status: "processing", total: 6780.00, items: 20, channel: "api", date: "2026-06-18", warehouse: "ORD" },
];

const statusFilters = ["All", "pending", "processing", "shipped", "delivered", "cancelled"];

const blankOrder = () => ({ customer: "", email: "", channel: "web", warehouse: "MIA", items: 1, total: 0, notes: "" });

export function Orders() {
  const { t } = useLang();
  const [orders, setOrders] = useState(allOrders);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankOrder());

  function handleCreate() {
    if (!form.customer || !form.email) { toast.error("Customer name and email required."); return; }
    const num = `ORD-${String(orders.length + 184).padStart(5, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    setOrders((prev) => [...prev, { id: String(Date.now()), order_number: num, customer: form.customer, email: form.email, status: "pending", total: Number(form.total), items: Number(form.items), channel: form.channel, date: today, warehouse: form.warehouse }]);
    toast.success(`${t.orders.orderCreated}: ${num} for ${form.customer}.`);
    setShowAdd(false);
    setForm(blankOrder());
  }

  const filtered = orders.filter((o) => {
    const matchSearch = o.order_number.toLowerCase().includes(search.toLowerCase()) || o.customer.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "All" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalRevenue = orders.reduce((a, o) => a + o.total, 0);
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const processingCount = orders.filter((o) => o.status === "processing").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.orders.totalOrders, value: allOrders.length, icon: ShoppingCart, color: "text-primary" },
          { label: t.orders.pending, value: pendingCount, icon: Package, color: "text-warning" },
          { label: t.orders.processing, value: processingCount, icon: Package, color: "text-blue-500" },
          { label: t.orders.totalRevenue, value: `€${(totalRevenue / 1000).toFixed(1)}k`, icon: Package, color: "text-success" },
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
        <div className="flex gap-1.5 overflow-x-auto">
          {statusFilters.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all capitalize ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>{t.orders.newOrder}</PrimaryButton>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">{t.orders.orderNo}</th>
              <th className="text-left px-4 py-3">{t.orders.customer}</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">{t.orders.channel}</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">{t.orders.warehouse}</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">{t.common.date}</th>
              <th className="text-center px-4 py-3 hidden sm:table-cell">{t.orders.noOfItems}</th>
              <th className="text-center px-4 py-3">{t.common.status}</th>
              <th className="text-right px-4 py-3">{t.orders.orderTotal}</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o, i) => (
              <tr key={o.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{o.order_number}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{o.customer}</div>
                  <div className="text-xs text-muted-foreground">{o.email}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs bg-secondary px-2 py-0.5 rounded uppercase">{o.channel}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{o.warehouse}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">{o.date}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-center text-muted-foreground">{o.items}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{o.total.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">
                  <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                    <Eye className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">{t.common.noData}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.orders.newOrder} subtitle="Create a manual order" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreate}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.orders.customer} required><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Company or person" /></Field>
          <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="orders@company.com" /></Field>
        </Row>
        <Row>
          <Field label={t.orders.channel}><Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            <option value="web">Web</option><option value="api">API</option><option value="mobile">Mobile</option><option value="phone">Phone</option>
          </Select></Field>
          <Field label={t.orders.warehouse}><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
            {["MIA","LAX","ORD","JFK","DAL"].map((w) => <option key={w}>{w}</option>)}
          </Select></Field>
        </Row>
        <Row>
          <Field label={t.orders.noOfItems}><Input type="number" value={form.items} onChange={(e) => setForm({ ...form, items: Number(e.target.value) })} /></Field>
          <Field label={t.orders.orderTotal}><Input type="number" step="0.01" value={form.total} onChange={(e) => setForm({ ...form, total: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.common.notes}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Special instructions…" /></Field>
      </Modal>
    </div>
  );
}
