import { useState, useEffect } from "react";
import { Boxes, Search, Plus, Filter, AlertTriangle, TrendingDown, Edit3, Users, Lock, Globe, Package, BellRing, Download, ChevronUp, ChevronDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { BarcodeGenerator } from "./BarcodeGenerator";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import { inventoryService } from "../../services/inventory.service";
import { warehousesService } from "../../services/warehouses.service";
import { exportToCSV } from "../../lib/csvExport";

type Product = { _id: string; sku: string; name: string; category: string; manufacturer?: string; brand?: string; qty_available: number; qty_reserved: number; qty_blocked: number; qty_ecommerce: number; qty_customer: number; owner: string; price: number; warehouse: string; status: string; reorder_point?: number; min_stock?: number; max_stock?: number; safety_stock?: number; supplier_lead_time_days?: number; unitBarcode?: string; caseBarcode?: string; caseMultiplier?: number; };

const categories = ["All", "Widgets", "Hardware", "Electronics", "Industrial", "Accessories", "Packaging"];


const blankProduct = (): Omit<Product, "_id"> => ({
  sku: "", name: "", category: "Widgets", manufacturer: "", brand: "",
  qty_available: 0, qty_reserved: 0, qty_blocked: 0,
  qty_ecommerce: 0, qty_customer: 0, owner: "internal", price: 0, warehouse: "MIA", status: "ok",
  reorder_point: 0, min_stock: 0, max_stock: 0, safety_stock: 0, supplier_lead_time_days: 7,
  unitBarcode: "", caseBarcode: "", caseMultiplier: 1,
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
    { id: "replenishment", label: "Replenishment", icon: BellRing },
  ];
  const [replenishment, setReplenishment] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [filterLow, setFilterLow] = useState(false);
  const [stockTab, setStockTab] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [barcodeTarget, setBarcodeTarget] = useState<Product | null>(null);
  const [form, setForm] = useState(blankProduct());
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [warehouses, setWarehouses] = useState<any[]>([]);

  const { items: productList, allItems, pagination, page, setPage, isLoading, reload } = usePaginatedList<Product>(inventoryService, { limit: 25 });

  async function loadData() {
    try {
      const whs = await warehousesService.getAll();
      setWarehouses(whs);
    } catch (err) {
      toast.error(t.common?.error || "Failed to load warehouses");
    }
    // Load replenishment alerts separately so a failure here doesn't break the rest of the page
    try {
      const res = await fetch(`/api/v1/inventory/alerts/low-stock`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("jwt_token")}` }
      });
      if (res.ok) {
        const body = await res.json();
        // Guard: handle both plain array and paginated envelope { data: [] }
        const alertList = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        setReplenishment(alertList);
      }
    } catch {
      // Non-fatal: replenishment tab will just show empty
      setReplenishment([]);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm(blankProduct()); setShowAdd(true); };
    window.addEventListener("open-add-product", handler);
    return () => window.removeEventListener("open-add-product", handler);
  }, []);

  function openAdd() { setForm(blankProduct()); setShowAdd(true); }
  function openEdit(p: Product) { setEditTarget(p); setForm({ ...p }); }
  async function handleSave() {
    if (!form.sku || !form.name) { toast.error(t.common?.error || "SKU and name are required."); return; }
    try {
      if (showAdd) {
        await inventoryService.create({ ...form, status: form.qty_available <= 20 ? "low" : "ok" });
        toast.success(`"${form.name}" added to inventory.`);
        setShowAdd(false);
      } else if (editTarget) {
        await inventoryService.update(editTarget._id, { ...form, status: form.qty_available <= 20 ? "low" : "ok" });
        toast.success(`"${form.name}" updated.`);
        setEditTarget(null);
      }
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to save product");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await inventoryService.delete(deleteTarget._id);
      toast.success(`Product deleted.`);
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to delete product");
    }
  }

  function handleSort(field: string) {
    if (sortField === field) setSortOrder(o => o === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("asc"); }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ChevronUp className="size-3 opacity-30" />;
    return sortOrder === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />;
  }

  const filtered = productList.filter((p) => {
    const matchSearch = (p.name || "").toLowerCase().includes(search.toLowerCase()) || (p.sku || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "All" || p.category === category;
    const matchLow = !filterLow || p.status === "low";
    const matchTab = stockTab === "all"
      || (stockTab === "available" && p.qty_available > 0)
      || (stockTab === "reserved" && p.qty_reserved > 0)
      || (stockTab === "blocked" && p.qty_blocked > 0)
      || (stockTab === "ecommerce" && p.qty_ecommerce > 0)
      || (stockTab === "customer" && p.owner === "customer");
    return matchSearch && matchCat && matchLow && matchTab;
  }).sort((a, b) => {
    const av = (a as any)[sortField] ?? "";
    const bv = (b as any)[sortField] ?? "";
    if (av < bv) return sortOrder === "asc" ? -1 : 1;
    if (av > bv) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const totalValue = allItems.reduce((a: number, p: any) => a + (Number(p.qty_available) || 0) * (Number(p.price) || 0), 0);
  const lowCount = allItems.filter((p: any) => p.status === "low").length;
  const totalReserved = allItems.reduce((a: number, p: any) => a + (Number(p.qty_reserved) || 0), 0);

  function handleExportCSV() {
    exportToCSV(allItems.map((p: any) => ({
      SKU: p.sku, Name: p.name, Category: p.category, Warehouse: p.warehouse,
      Available: p.qty_available, Reserved: p.qty_reserved, Blocked: p.qty_blocked,
      Price: p.price, Status: p.status, Owner: p.owner
    })), 'inventory');
  }

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
          { label: t.inventory.totalSKUs, value: productList.length, icon: Boxes, color: "text-primary" },
          { label: t.inventory.lowStock, value: lowCount, icon: AlertTriangle, color: "text-destructive" },
          { label: t.inventory.reservedUnits, value: (totalReserved || 0).toLocaleString(), icon: Lock, color: "text-warning" },
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t.common?.search || "Search"}  SKU or product…`} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${category === c ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}>{c}</button>
          ))}
        </div>
        <SecondaryButton icon={Filter} onClick={() => setFilterLow(!filterLow)}>{filterLow ? t.common.all : t.inventory.lowStock}</SecondaryButton>
        <SecondaryButton icon={Download} onClick={handleExportCSV}>{t.common?.export || "Export"} CSV</SecondaryButton>
        <PrimaryButton icon={Plus} onClick={openAdd}>{t.inventory.addProduct}</PrimaryButton>
      </div>

      {/* Replenishment Alert View */}
      {stockTab === "replenishment" ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-border bg-destructive/5">
            <BellRing className="size-4 text-destructive" />
            <span className="font-semibold text-sm">{replenishment.length} products need replenishment</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-3">SKU</th>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-right px-4 py-3">In Stock</th>
                <th className="text-right px-4 py-3">Reorder Point</th>
                <th className="text-right px-4 py-3">Order Qty</th>
                <th className="text-left px-4 py-3">Lead Time</th>
                <th className="text-left px-4 py-3">Owner</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(replenishment) ? replenishment : []).map((p, i) => (
                <tr key={p._id} className="border-t border-border hover:bg-secondary/30 animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                  <td className="px-4 py-3 text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{p.sku}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-right text-destructive font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{p.qty_available}</td>
                  <td className="px-4 py-3 text-right" style={{ fontFamily: "JetBrains Mono, monospace" }}>{p.reorder_point}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary" style={{ fontFamily: "JetBrains Mono, monospace" }}>{p.recommended_order_qty}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{p.supplier_lead_time_days ?? '—'} days</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">{p.owner || '—'}</span>
                  </td>
                </tr>
              ))}
              {replenishment.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">All products are adequately stocked! ✅</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("sku")}><div className="flex items-center gap-1">{t.inventory.sku}<SortIcon field="sku" /></div></th>
              <th className="text-left px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}><div className="flex items-center gap-1">{t.inventory.productName}<SortIcon field="name" /></div></th>
              <th className="text-left px-4 py-3 hidden md:table-cell cursor-pointer hover:text-foreground" onClick={() => handleSort("category")}><div className="flex items-center gap-1">{t.inventory.category}<SortIcon field="category" /></div></th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">{t.common.warehouse}</th>
              <th className="text-left px-4 py-3 hidden xl:table-cell">{t.inventory.owner}</th>
              <th className="text-right px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("qty_available")}><div className="flex items-center justify-end gap-1">{t.inventory.available}<SortIcon field="qty_available" /></div></th>
              <th className="text-right px-4 py-3 hidden sm:table-cell">{t.inventory.reserved}</th>
              <th className="text-right px-4 py-3 hidden lg:table-cell">{t.inventory.blocked}</th>
              <th className="text-center px-4 py-3">{t.common.status}</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={p._id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                <td className="px-4 py-3 text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{p.sku}</td>
                <td className="px-4 py-3 font-medium">
                  <div>{p.name}</div>
                  {(p.manufacturer || p.brand) && <div className="text-xs text-muted-foreground">{[p.manufacturer, p.brand].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="px-4 py-3 hidden md:table-cell"><span className="text-xs bg-secondary px-2 py-0.5 rounded">{p.category}</span></td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{p.warehouse}</td>
                <td className="px-4 py-3 hidden xl:table-cell">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.owner === "customer" ? "bg-purple-500/15 text-purple-500" : p.owner === "mixed" ? "bg-amber-500/15 text-amber-500" : "bg-secondary text-muted-foreground"}`}>{p.owner}</span>
                </td>
                <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  <span className={(p.qty_available || 0) <= 20 ? "text-destructive" : ""}>{(p.qty_available ?? 0).toLocaleString()}</span>
                </td>
                <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{(p.qty_reserved || 0) > 0 ? (p.qty_reserved || 0).toLocaleString() : "—"}</td>
                <td className="px-4 py-3 text-right hidden lg:table-cell" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  {(p.qty_blocked || 0) > 0 ? <span className="text-destructive">{(p.qty_blocked || 0).toLocaleString()}</span> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3 text-center"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setBarcodeTarget(p)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title={t.common?.printBarcode || "Print Barcode"}><Printer className="size-3.5" /></button>
                    <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title={t.common.edit}><Edit3 className="size-3.5" /></button>
                    <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive" title={t.common.delete}><AlertTriangle className="size-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">{t.common.noResults}</td></tr>}
          </tbody>
        </table>
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>
      )}

      {/* Add/Edit Modal */}
      {[{ open: showAdd, onClose: () => setShowAdd(false), title: t.inventory.addProduct, cta: t.inventory.addProduct }, { open: !!editTarget, onClose: () => setEditTarget(null), title: t.inventory.editProduct, cta: t.common.save }].map((m) => (
        <Modal key={m.title} open={m.open} onClose={m.onClose} title={m.title} width="lg" footer={<><ModalCancel onClose={m.onClose} /><ModalSubmit onClick={handleSave}>{m.cta}</ModalSubmit></>}>
          <Row><Field label={t.inventory.sku} required hint={t.inventory.skuHint}><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder={t.common?.sKUXXXX || "SKU-XXXX"} /></Field>
            <Field label={t.inventory.category}><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["Widgets","Hardware","Electronics","Industrial","Accessories","Packaging"].map((c) => <option key={c}>{c}</option>)}
            </Select></Field>
          </Row>
          <Field label={t.inventory.productName} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t.common?.fullProductName || "Full product name"} /></Field>
          <Row>
            <Field label={t.common?.manufacturer || "Manufacturer"}><Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} placeholder={t.common?.eGSony || "e.g. Sony"} /></Field>
            <Field label={t.common?.brand || "Brand"}><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder={t.common?.eGPlayStation || "e.g. PlayStation"} /></Field>
          </Row>
          <Row>
            <Field label={t.inventory.price}><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></Field>
            <Field label={t.common.warehouse}><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
              {warehouses.length === 0 && <option value="MIA">{t.common?.mIA || "MIA"}</option>}
            </Select></Field>
          </Row>
          <div className="pt-2 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border">Barcodes & Case Multipliers</div>
          <Row>
            <Field label="Unit Barcode / EAN" hint="Scanned as 1 unit"><Input value={form.unitBarcode || ""} onChange={(e) => setForm({ ...form, unitBarcode: e.target.value })} placeholder="e.g. 1234567890123" /></Field>
            <Field label="Case Barcode" hint="Scanned as Case Qty"><Input value={form.caseBarcode || ""} onChange={(e) => setForm({ ...form, caseBarcode: e.target.value })} placeholder="e.g. 1234567890999" /></Field>
          </Row>
          <Row>
            <Field label="Case Quantity Multiplier" hint="Units per case"><Input type="number" min="1" value={form.caseMultiplier || 1} onChange={(e) => setForm({ ...form, caseMultiplier: Math.max(1, Number(e.target.value)) })} /></Field>
          </Row>
          <div className="pt-2 pb-1 text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border">Stock & Replenishment</div>
          <Row>
            <Field label={t.common?.qtyAvailable || "Qty available"}><Input type="number" value={form.qty_available} onChange={(e) => setForm({ ...form, qty_available: Number(e.target.value) })} /></Field>
            <Field label={t.common?.reorderPoint || "Reorder Point"}><Input type="number" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: Number(e.target.value) })} /></Field>
          </Row>
          <Row>
            <Field label={t.common?.maxStockIdeal || "Max Stock (Ideal)"}><Input type="number" value={form.max_stock} onChange={(e) => setForm({ ...form, max_stock: Number(e.target.value) })} /></Field>
            <Field label={t.common?.leadTimeDays || "Lead Time (Days)"}><Input type="number" value={form.supplier_lead_time_days} onChange={(e) => setForm({ ...form, supplier_lead_time_days: Number(e.target.value) })} /></Field>
          </Row>
          <Row>
            <Field label={t.common?.qtyReserved || "Qty reserved"}><Input type="number" value={form.qty_reserved} onChange={(e) => setForm({ ...form, qty_reserved: Number(e.target.value) })} /></Field>
            <Field label={t.inventory.blocked}><Input type="number" value={form.qty_blocked} onChange={(e) => setForm({ ...form, qty_blocked: Number(e.target.value) })} /></Field>
          </Row>
          <Row>
            <Field label={t.inventory.owner}><Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
              <option value="internal">{t.common?.internal || "Internal"}</option><option value="customer">{t.inventory.customerOwned}</option><option value="mixed">{t.common?.mixed || "Mixed"}</option>
            </Select></Field>
          </Row>
        </Modal>
      ))}

      {/* Delete confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t.common?.deleteProduct || "Delete Product"} width="sm" footer={<><ModalCancel onClose={() => setDeleteTarget(null)} /><ModalSubmit variant="destructive" onClick={handleDelete}>{t.common.delete}</ModalSubmit></>}>
        <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.</p>
      </Modal>

      {/* Barcode Modal */}
      <Modal open={!!barcodeTarget} onClose={() => setBarcodeTarget(null)} title={t.common?.printSKUBarcode || "Print SKU Barcode"} size="sm">
        {barcodeTarget && (
          <div className="p-4">
            <p className="text-sm text-muted-foreground mb-4 text-center">
              Generate and print a standard 1D barcode for this product's SKU.
            </p>
            <BarcodeGenerator value={barcodeTarget.sku} title={barcodeTarget.name} />
          </div>
        )}
      </Modal>
    </div>
  );
}
