import { useState } from "react";
import { ShoppingCart, Plus, Search, Eye, Package } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { ordersService } from "../../services/orders.service";

type Order = { _id: string; orderId: string; customer: string; email: string; channel: string; warehouse: string; items: number; total: number; status: string; date: string; notes: string; };

const statusFilters = ["All", "pending", "processing", "shipped", "delivered", "cancelled"];

const blankOrder = () => ({ customer: "", email: "", channel: "web", warehouse: "MIA", items: 1, total: 0, notes: "" });

export function Orders() {
  const { t } = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankOrder());
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const data = await ordersService.getAll();
      setOrders(data);
    } catch (err) {
      toast.error("Failed to load orders");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate() {
    if (!form.customer || !form.email) { toast.error("Customer name and email required."); return; }
    const num = `ORD-${String(orders.length + 184).padStart(5, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      await ordersService.create({ orderId: num, customer: form.customer, email: form.email, status: "pending", total: Number(form.total), items: Number(form.items), channel: form.channel, date: today, warehouse: form.warehouse });
      toast.success(`${t.orders.orderCreated}: ${num} for ${form.customer}.`);
      setShowAdd(false);
      setForm(blankOrder());
      loadData();
    } catch (err) {
      toast.error("Failed to create order");
    }
  }

  const filtered = orders.filter((o) => {
    const matchSearch = o.orderId?.toLowerCase().includes(search.toLowerCase()) || o.customer?.toLowerCase().includes(search.toLowerCase());
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
          { label: t.orders.totalOrders, value: orders.length, icon: ShoppingCart, color: "text-primary" },
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
              <tr key={o._id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                <td className="px-4 py-3 font-medium text-primary" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.875rem" }}>{o.orderId}</td>
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
