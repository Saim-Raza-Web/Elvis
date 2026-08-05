import { useState, useEffect } from "react";
import { Warehouse, Plus, MapPin, Package, TrendingUp, Edit3, Trash2, Search, Thermometer, User } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import { warehousesService } from "../../services/warehouses.service";

type WH = {
  _id: string;
  name: string;
  code: string;
  location: string;
  country: string;
  capacity: number;
  used: number;
  status: string;
  manager: string;
  temp: string;
  zones: number;
};

const blank = (): Omit<WH, "_id" | "used" | "zones"> & { capacity: number } => ({
  name: "", code: "", location: "", country: "US", capacity: 5000, status: "active", manager: "", temp: "20°C",
});

export function Warehouses() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<WH | null>(null);
  const [form, setForm] = useState(blank());
  const [deleteTarget, setDeleteTarget] = useState<WH | null>(null);

  const searchLower = search.toLowerCase();

  const { items: warehouses, allItems, pagination, page, setPage, isLoading, reload } = usePaginatedList<WH>(
    warehousesService,
    {
      apiParams: { search: searchLower || undefined },
      deps: [search],
    }
  );

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm(blank()); setShowAdd(true); };
    window.addEventListener("open-add-warehouse", handler);
    return () => window.removeEventListener("open-add-warehouse", handler);
  }, []);

  function openAdd() { setForm(blank()); setShowAdd(true); }
  function openEdit(w: WH) { setEditTarget(w); setForm({ name: w.name, code: w.code, location: w.location, country: w.country, capacity: w.capacity, status: w.status, manager: w.manager, temp: w.temp }); }

  async function handleSave() {
    if (!form.name || !form.code) { toast.error(t.common?.error || "Name and code are required."); return; }
    try {
      if (showAdd) {
        await warehousesService.create(form);
        toast.success(`${t.warehouses.createSuccess}: "${form.name}"`);
        setShowAdd(false);
      } else if (editTarget) {
        await warehousesService.update(editTarget._id, form);
        toast.success(`${t.warehouses.updateSuccess}: "${form.name}"`);
        setEditTarget(null);
      }
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to save warehouse");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await warehousesService.delete(deleteTarget._id);
      toast.success(`${t.warehouses.deleteSuccess}: "${deleteTarget.name}"`);
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to delete warehouse");
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.warehouses.totalWarehouses, value: allItems.length, icon: Warehouse, color: "text-primary" },
          { label: t.status.active, value: allItems.filter((w) => w.status === "active").length, icon: TrendingUp, color: "text-success" },
          { label: t.warehouses.totalCapacity, value: `${(allItems.reduce((a, w) => a + w.capacity, 0) / 1000).toFixed(0)}k units`, icon: Package, color: "text-blue-500" },
          { label: t.warehouses.overallUtil, value: allItems.length ? `${Math.round(allItems.reduce((a, w) => a + (w.used || 0), 0) / allItems.reduce((a, w) => a + w.capacity, 0) * 100)}%` : "0%", icon: TrendingUp, color: "text-amber-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t.common.search}…`} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
        </div>
        <PrimaryButton icon={Plus} onClick={openAdd}>{t.warehouses.addWarehouse}</PrimaryButton>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {warehouses.map((w, i) => {
          const pct = w.capacity > 0 ? Math.round(((w.used || 0) / w.capacity) * 100) : 0;
          const barColor = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success";
          return (
            <div key={w._id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted-foreground bg-secondary px-2 py-0.5 rounded" style={{ fontFamily: "JetBrains Mono, monospace" }}>{w.code}</span>
                    <StatusBadge status={w.status} />
                  </div>
                  <h3 className="font-bold mt-1">{w.name}</h3>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="size-3" /> {w.location}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(w)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title={t.common.edit}><Edit3 className="size-3.5" /></button>
                  <button onClick={() => setDeleteTarget(w)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive" title={t.common.delete}><Trash2 className="size-3.5" /></button>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-muted-foreground">{t.warehouses.utilization}</span>
                  <span className="text-xs font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">{(w.used || 0).toLocaleString()} used</span>
                  <span className="text-[10px] text-muted-foreground">{w.capacity.toLocaleString()} total</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center p-2 bg-secondary/50 rounded-lg">
                  <div className="text-muted-foreground">{t.warehouses.zones}</div>
                  <div className="font-bold mt-0.5">{w.zones || 0}</div>
                </div>
                <div className="text-center p-2 bg-secondary/50 rounded-lg">
                  <div className="flex items-center justify-center gap-0.5 text-muted-foreground"><Thermometer className="size-3" />{t.warehouses.temp}</div>
                  <div className="font-bold mt-0.5">{w.temp}</div>
                </div>
                <div className="text-center p-2 bg-secondary/50 rounded-lg">
                  <div className="flex items-center justify-center gap-0.5 text-muted-foreground"><User className="size-3" />{t.warehouses.manager.slice(0, 3)}</div>
                  <div className="font-bold mt-0.5 truncate">{(w.manager || "—").split(" ")[0]}</div>
                </div>
              </div>
            </div>
          );
        })}
        {warehouses.length === 0 && !isLoading && (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            <Warehouse className="size-12 mx-auto mb-3 opacity-30" />
            <p>No warehouses found. Add your first warehouse!</p>
          </div>
        )}
      </div>
      <TablePagination pagination={pagination} page={page} onPageChange={setPage} />

      {/* Add modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.warehouses.addWarehouse} subtitle={t.pages.warehouses.sub} footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleSave}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.common.name} required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t.common?.miamiHub || "Miami Hub"} /></Field>
          <Field label={t.warehouses.code} required hint={t.warehouses.codeHint}><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().slice(0, 4) }))} placeholder={t.common?.mIA || "MIA"} /></Field>
        </Row>
        <Row>
          <Field label={t.common.location}><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder={t.common?.miamiFL || "Miami, FL"} /></Field>
          <Field label={t.warehouses.country}><Select value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}>
            <option>{t.common?.uS || "US"}</option><option>{t.common?.dE || "DE"}</option><option>{t.common?.fR || "FR"}</option><option>{t.common?.eS || "ES"}</option><option>{t.common?.iT || "IT"}</option><option>{t.common?.gB || "GB"}</option>
          </Select></Field>
        </Row>
        <Row>
          <Field label={t.warehouses.capacity}><Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))} /></Field>
          <Field label={t.warehouses.temp}><Input value={form.temp} onChange={(e) => setForm((f) => ({ ...f, temp: e.target.value }))} placeholder="20°C" /></Field>
        </Row>
        <Row>
          <Field label={t.warehouses.manager}><Input value={form.manager} onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))} placeholder={t.common?.fullName || "Full name"} /></Field>
          <Field label={t.common.status}><Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">{t.status.active}</option><option value="inactive">{t.status.inactive}</option>
          </Select></Field>
        </Row>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t.warehouses.editWarehouse} subtitle={editTarget?.name} footer={<><ModalCancel onClose={() => setEditTarget(null)} /><ModalSubmit onClick={handleSave}>{t.common.save}</ModalSubmit></>}>
        <Row>
          <Field label={t.common.name} required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t.common?.miamiHub || "Miami Hub"} /></Field>
          <Field label={t.warehouses.code} required hint={t.warehouses.codeHint}><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().slice(0, 4) }))} placeholder={t.common?.mIA || "MIA"} /></Field>
        </Row>
        <Row>
          <Field label={t.common.location}><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder={t.common?.miamiFL || "Miami, FL"} /></Field>
          <Field label={t.warehouses.country}><Select value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}>
            <option>{t.common?.uS || "US"}</option><option>{t.common?.dE || "DE"}</option><option>{t.common?.fR || "FR"}</option><option>{t.common?.eS || "ES"}</option><option>{t.common?.iT || "IT"}</option><option>{t.common?.gB || "GB"}</option>
          </Select></Field>
        </Row>
        <Row>
          <Field label={t.warehouses.capacity}><Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))} /></Field>
          <Field label={t.warehouses.temp}><Input value={form.temp} onChange={(e) => setForm((f) => ({ ...f, temp: e.target.value }))} placeholder="20°C" /></Field>
        </Row>
        <Row>
          <Field label={t.warehouses.manager}><Input value={form.manager} onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))} placeholder={t.common?.fullName || "Full name"} /></Field>
          <Field label={t.common.status}><Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">{t.status.active}</option><option value="inactive">{t.status.inactive}</option>
          </Select></Field>
        </Row>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t.warehouses.deleteWarehouse} width="sm" footer={<><ModalCancel onClose={() => setDeleteTarget(null)} /><ModalSubmit variant="destructive" onClick={handleDelete}>{t.common.delete}</ModalSubmit></>}>
        <p className="text-sm text-muted-foreground">{t.warehouses.confirmDelete} <strong>{deleteTarget?.name}</strong>? {t.warehouses.cannotUndo}</p>
      </Modal>
    </div>
  );
}
