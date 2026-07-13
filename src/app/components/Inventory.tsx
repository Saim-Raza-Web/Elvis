import { useState } from "react";
import { Boxes, Search, Plus, Filter, AlertTriangle, TrendingDown, Edit3, Users, Lock, Globe, Package } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

type Product = { id: string; sku: string; name: string; category: string; qty_available: number; qty_reserved: number; qty_blocked: number; qty_ecommerce: number; qty_customer: number; owner: string; price: number; warehouse: string; status: string };

const products = [
  { id: "1", sku: "SKU-1001", name: "Premium Widget Alpha", category: "Widgets", qty_available: 1200, qty_reserved: 40, qty_blocked: 0, qty_ecommerce: 200, qty_customer: 0, owner: "internal", price: 45.99, warehouse: "MIA", status: "ok" },
  { id: "2", sku: "SKU-1002", name: "Industrial Bolt Set (100pk)", category: "Hardware", qty_available: 15, qty_reserved: 0, qty_blocked: 0, qty_ecommerce: 0, qty_customer: 0, owner: "internal", price: 12.50, warehouse: "LAX", status: "low" },
  { id: "3", sku: "SKU-1003", name: "Steel Bracket Type-C", category: "Hardware", qty_available: 3300, qty_reserved: 100, qty_blocked: 0, qty_ecommerce: 0, qty_customer: 500, owner: "mixed", price: 8.75, warehouse: "ORD", status: "ok" },
  { id: "4", sku: "SKU-1004", name: "Lithium Battery Pack 12V", category: "Electronics", qty_available: 80, qty_reserved: 8, qty_blocked: 8, qty_ecommerce: 0, qty_customer: 0, owner: "internal", price: 89.00, warehouse: "MIA", status: "low" },
  { id: "5", sku: "SKU-1005", name: "Nylon Cable Tie 500mm", category: "Accessories", qty_available: 5200, qty_reserved: 400, qty_blocked: 0, qty_ecommerce: 800, qty_customer: 0, owner: "internal", price: 0.25, warehouse: "DAL", status: "ok" },
  { id: "6", sku: "SKU-1006", name: "Precision Sensor Module", category: "Electronics", qty_available: 312, qty_reserved: 8, qty_blocked: 0, qty_ecommerce: 80, qty_customer: 0, owner: "internal", price: 129.99, warehouse: "LAX", status: "ok" },
  { id: "7", sku: "SKU-1007", name: "Hydraulic Pump A300", category: "Industrial", qty_available: 12, qty_reserved: 0, qty_blocked: 0, qty_ecommerce: 0, qty_customer: 0, owner: "internal", price: 450.00, warehouse: "DAL", status: "low" },
  { id: "8", sku: "SKU-1008", name: "Foam Packing Material", category: "Packaging", qty_available: 8000, qty_reserved: 200, qty_blocked: 0, qty_ecommerce: 0, qty_customer: 1200, owner: "customer", price: 1.10, warehouse: "JFK", status: "ok" },
  { id: "9", sku: "SKU-1009", name: "Stainless Hex Bolt M8", category: "Hardware", qty_available: 11800, qty_reserved: 200, qty_blocked: 0, qty_ecommerce: 0, qty_customer: 3000, owner: "customer", price: 0.08, warehouse: "ORD", status: "ok" },
  { id: "10", sku: "SKU-1010", name: "Network Switch 24-port", category: "Electronics", qty_available: 7, qty_reserved: 0, qty_blocked: 2, qty_ecommerce: 4, qty_customer: 0, owner: "internal", price: 299.99, warehouse: "LAX", status: "low" },
  { id: "11", sku: "SKU-1011", name: "LED Strip Light 5m", category: "Electronics", qty_available: 430, qty_reserved: 20, qty_blocked: 0, qty_ecommerce: 120, qty_customer: 0, owner: "internal", price: 18.50, warehouse: "MIA", status: "ok" },
  { id: "12", sku: "SKU-1012", name: "Pallet Jack Manual", category: "Industrial", qty_available: 3, qty_reserved: 0, qty_blocked: 0, qty_ecommerce: 0, qty_customer: 0, owner: "internal", price: 850.00, warehouse: "ORD", status: "low" },
];

const categories = ["All", "Widgets", "Hardware", "Electronics", "Industrial", "Accessories", "Packaging"];


const blankProduct = (): Omit<Product, "id"> => ({
  sku: "", name: "", category: "Widgets", qty_available: 0, qty_reserved: 0, qty_blocked: 0,
  qty_ecommerce: 0, qty_customer: 0, owner: "internal", price: 0, warehouse: "MIA", status: "ok",
});

export function Inventory() {
  const { t } = useLang();
  const stockTypeTabs = [
    { id: "all", label: t.inventory.allStock, icon: Boxes },
    { id: "available", label: t.inventory.available, icon: Package },
    { id: "reserved", label: t.inventory.reserved, icon: Lock },
    { id: "blocked", label: t.inventory.blocked, icon: AlertTriangle },
    { id: "ecommerce", label: t.inventory.ecommerce, icon: Globe },
    { id: "customer", label: t.inventory.customerOwned, icon: Users },
  ];
  const [productList, setProductList] = useState<Product[]>(products.map((p, i) => ({ ...p, id: String(i + 1) })));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [filterLow, setFilterLow] = useState(false);
  const [stockTab, setStockTab] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [form, setForm] = useState(blankProduct());

  function openAdd() { setForm(blankProduct()); setShowAdd(true); }
  function openEdit(p: Product) { setEditTarget(p); setForm({ ...p }); }
  function handleSave() {
    if (!form.sku || !form.name) { toast.error("SKU and name are required."); return; }
    if (showAdd) {
      if (productList.find((p) => p.sku === form.sku)) { toast.error("SKU already exists."); return; }
      setProductList((prev) => [...prev, { ...form, id: String(Date.now()), status: form.qty_available <= 20 ? "low" : "ok" }]);
      toast.success(`"${form.name}" added to inventory.`);
      setShowAdd(false);
    } else if (editTarget) {
      setProductList((prev) => prev.map((p) => p.id === editTarget.id ? { ...p, ...form, status: form.qty_available <= 20 ? "low" : "ok" } : p));
      toast.success(`"${form.name}" updated.`);
      setEditTarget(null);
    }
  }

  const filtered = productList.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "All" || p.category === category;
    const matchLow = !filterLow || p.status === "low";
    const matchTab = stockTab === "all"
      || (stockTab === "available" && p.qty_available > 0)
      || (stockTab === "reserved" && p.qty_reserved > 0)
      || (stockTab === "blocked" && p.qty_blocked > 0)
      || (stockTab === "ecommerce" && p.qty_ecommerce > 0)
      || (stockTab === "customer" && p.owner === "customer");
    return matchSearch && matchCat && matchLow && matchTab;
  });

  const totalValue = productList.reduce((a, p) => a + p.qty_available * p.price, 0);
  const lowCount = productList.filter((p) => p.status === "low").length;
  const totalReserved = productList.reduce((a, p) => a + p.qty_reserved, 0);

  function getQtyForTab(p: Product) {
    switch (stockTab) {
      case "reserved": return p.qty_reserved;
      case "blocked": return p.qty_blocked;
      case "ecommerce": return p.qty_ecommerce;
      case "customer": return p.qty_customer;
      default: return p.qty_available;
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.inventory.totalSKUs, value: products.length, icon: Boxes, color: "text-primary" },
          { label: t.inventory.lowStock, value: lowCount, icon: AlertTriangle, color: "text-destructive" },
          { label: t.inventory.reservedUnits, value: totalReserved.toLocaleString(), icon: Lock, color: "text-warning" },
          { label: t.inventory.inventoryValue, value: `€${(totalValue / 1000).toFixed(0)}k`, icon: TrendingDown, color: "text-amber-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Stock type tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {stockTypeTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStockTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${stockTab === tab.id ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or product…" className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${category === c ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}>{c}</button>
          ))}
        </div>
        <SecondaryButton icon={Filter} onClick={() => setFilterLow(!filterLow)}>{filterLow ? t.common.all : t.inventory.lowStock}</SecondaryButton>
        <PrimaryButton icon={Plus} onClick={openAdd}>{t.inventory.addProduct}</PrimaryButton>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">{t.inventory.sku}</th>
              <th className="text-left px-4 py-3">{t.inventory.productName}</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">{t.inventory.category}</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">{t.common.warehouse}</th>
              <th className="text-left px-4 py-3 hidden xl:table-cell">{t.inventory.owner}</th>
              <th className="text-right px-4 py-3">{t.inventory.available}</th>
              <th className="text-right px-4 py-3 hidden sm:table-cell">{t.inventory.reserved}</th>
              <th className="text-right px-4 py-3 hidden lg:table-cell">{t.inventory.blocked}</th>
              <th className="text-center px-4 py-3">{t.common.status}</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={p.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                <td className="px-4 py-3 text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{p.sku}</td>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 hidden md:table-cell"><span className="text-xs bg-secondary px-2 py-0.5 rounded">{p.category}</span></td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{p.warehouse}</td>
                <td className="px-4 py-3 hidden xl:table-cell">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.owner === "customer" ? "bg-purple-500/15 text-purple-500" : p.owner === "mixed" ? "bg-amber-500/15 text-amber-500" : "bg-secondary text-muted-foreground"}`}>{p.owner}</span>
                </td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  <span className={p.qty_available <= 20 ? "text-destructive" : ""}>{p.qty_available.toLocaleString()}</span>
                </td>
                <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{p.qty_reserved > 0 ? p.qty_reserved : "—"}</td>
                <td className="px-4 py-3 text-right hidden lg:table-cell" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  {p.qty_blocked > 0 ? <span className="text-destructive">{p.qty_blocked}</span> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3 text-center"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-3 text-right"><button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"><Edit3 className="size-3.5" /></button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">{t.common.noResults}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {[{ open: showAdd, onClose: () => setShowAdd(false), title: t.inventory.addProduct, cta: t.inventory.addProduct }, { open: !!editTarget, onClose: () => setEditTarget(null), title: t.inventory.editProduct, cta: t.common.save }].map((m) => (
        <Modal key={m.title} open={m.open} onClose={m.onClose} title={m.title} width="lg" footer={<><ModalCancel onClose={m.onClose} /><ModalSubmit onClick={handleSave}>{m.cta}</ModalSubmit></>}>
          <Row><Field label={t.inventory.sku} required hint={t.inventory.skuHint}><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="SKU-XXXX" /></Field>
            <Field label={t.inventory.category}><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["Widgets","Hardware","Electronics","Industrial","Accessories","Packaging"].map((c) => <option key={c}>{c}</option>)}
            </Select></Field>
          </Row>
          <Field label={t.inventory.productName} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full product name" /></Field>
          <Row>
            <Field label={t.inventory.price}><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></Field>
            <Field label={t.common.warehouse}><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
              {["MIA","LAX","ORD","JFK","DAL"].map((w) => <option key={w}>{w}</option>)}
            </Select></Field>
          </Row>
          <Row>
            <Field label="Qty available"><Input type="number" value={form.qty_available} onChange={(e) => setForm({ ...form, qty_available: Number(e.target.value) })} /></Field>
            <Field label="Qty reserved"><Input type="number" value={form.qty_reserved} onChange={(e) => setForm({ ...form, qty_reserved: Number(e.target.value) })} /></Field>
          </Row>
          <Row>
            <Field label={t.inventory.owner}><Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
              <option value="internal">Internal</option><option value="customer">{t.inventory.customerOwned}</option><option value="mixed">Mixed</option>
            </Select></Field>
            <Field label={t.inventory.blocked}><Input type="number" value={form.qty_blocked} onChange={(e) => setForm({ ...form, qty_blocked: Number(e.target.value) })} /></Field>
          </Row>
        </Modal>
      ))}
    </div>
  );
}
