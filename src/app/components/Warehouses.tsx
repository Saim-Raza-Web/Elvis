import { useState } from "react";
import { Warehouse, Plus, MapPin, Package, TrendingUp, Edit3, Trash2, Search, Thermometer, User } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const initialWarehouses = [
  { id: "1", name: "Miami Hub", code: "MIA", location: "Miami, FL", country: "US", capacity: 5000, used: 3842, status: "active", manager: "Carlos Rivera", temp: "22°C", zones: 8 },
  { id: "2", name: "Los Angeles DC", code: "LAX", location: "Los Angeles, CA", country: "US", capacity: 8000, used: 7621, status: "active", manager: "Sarah Chen", temp: "24°C", zones: 12 },
  { id: "3", name: "Chicago Distribution", code: "ORD", location: "Chicago, IL", country: "US", capacity: 6500, used: 2100, status: "active", manager: "Mike Johnson", temp: "20°C", zones: 10 },
  { id: "4", name: "New York East", code: "JFK", location: "Newark, NJ", country: "US", capacity: 4000, used: 3100, status: "active", manager: "Priya Patel", temp: "21°C", zones: 6 },
  { id: "5", name: "Dallas Central", code: "DAL", location: "Dallas, TX", country: "US", capacity: 7000, used: 4500, status: "active", manager: "Tom Williams", temp: "26°C", zones: 11 },
  { id: "6", name: "Seattle North", code: "SEA", location: "Seattle, WA", country: "US", capacity: 3500, used: 800, status: "inactive", manager: "Emma Davis", temp: "18°C", zones: 5 },
];

type WH = typeof initialWarehouses[0];

const blank = (): Omit<WH, "id" | "used" | "zones"> & { capacity: number } => ({
  name: "", code: "", location: "", country: "US", capacity: 5000, status: "active", manager: "", temp: "20°C",
});

export function Warehouses() {
  const { t } = useLang();
  const [warehouses, setWarehouses] = useState(initialWarehouses);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<WH | null>(null);
  const [form, setForm] = useState(blank());
  const [deleteTarget, setDeleteTarget] = useState<WH | null>(null);

  const filtered = warehouses.filter(
    (w) => w.name.toLowerCase().includes(search.toLowerCase()) || w.code.toLowerCase().includes(search.toLowerCase())
  );

  function openAdd() { setForm(blank()); setShowAdd(true); }
  function openEdit(w: WH) { setEditTarget(w); setForm({ name: w.name, code: w.code, location: w.location, country: w.country, capacity: w.capacity, status: w.status, manager: w.manager, temp: w.temp }); }

  function handleSave() {
    if (!form.name || !form.code) { toast.error("Name and code are required."); return; }
    if (showAdd) {
      const newWh: WH = { ...form, id: String(Date.now()), used: 0, zones: 0 };
      setWarehouses((prev) => [...prev, newWh]);
      toast.success(`${t.warehouses.createSuccess}: "${form.name}"`);
      setShowAdd(false);
    } else if (editTarget) {
      setWarehouses((prev) => prev.map((w) => w.id === editTarget.id ? { ...w, ...form } : w));
      toast.success(`${t.warehouses.updateSuccess}: "${form.name}"`);
      setEditTarget(null);
    }
  }

  function handleDelete() {
    if (!deleteTarget) return;
    setWarehouses((prev) => prev.filter((w) => w.id !== deleteTarget.id));
    toast.success(`${t.warehouses.deleteSuccess}: "${deleteTarget.name}"`);
    setDeleteTarget(null);
  }

  const FormBody = () => (
    <>
      <Row>
        <Field label={t.common.name} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Miami Hub" /></Field>
        <Field label={t.warehouses.code} required hint={t.warehouses.codeHint}><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().slice(0, 4) })} placeholder="MIA" /></Field>
      </Row>
      <Row>
        <Field label={t.common.location}><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Miami, FL" /></Field>
        <Field label={t.warehouses.country}><Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
          <option>US</option><option>DE</option><option>FR</option><option>ES</option><option>IT</option><option>GB</option>
        </Select></Field>
      </Row>
      <Row>
        <Field label={t.warehouses.capacity}><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
        <Field label={t.warehouses.temp}><Input value={form.temp} onChange={(e) => setForm({ ...form, temp: e.target.value })} placeholder="20°C" /></Field>
      </Row>
      <Row>
        <Field label={t.warehouses.manager}><Input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="Full name" /></Field>
        <Field label={t.common.status}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">{t.status.active}</option><option value="inactive">{t.status.inactive}</option>
        </Select></Field>
      </Row>
    </>
  );

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.warehouses.totalWarehouses, value: warehouses.length, icon: Warehouse, color: "text-primary" },
          { label: t.status.active, value: warehouses.filter((w) => w.status === "active").length, icon: TrendingUp, color: "text-success" },
          { label: t.warehouses.totalCapacity, value: `${(warehouses.reduce((a, w) => a + w.capacity, 0) / 1000).toFixed(0)}k units`, icon: Package, color: "text-blue-500" },
          { label: t.warehouses.overallUtil, value: `${Math.round(warehouses.reduce((a, w) => a + w.used, 0) / warehouses.reduce((a, w) => a + w.capacity, 0) * 100)}%`, icon: TrendingUp, color: "text-amber-500" },
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
        {filtered.map((w, i) => {
          const pct = Math.round((w.used / w.capacity) * 100);
          const barColor = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success";
          return (
            <div key={w.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 50}ms` }}>
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
                  <span className="text-[10px] text-muted-foreground">{w.used.toLocaleString()} used</span>
                  <span className="text-[10px] text-muted-foreground">{w.capacity.toLocaleString()} total</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center p-2 bg-secondary/50 rounded-lg">
                  <div className="text-muted-foreground">{t.warehouses.zones}</div>
                  <div className="font-bold mt-0.5">{w.zones}</div>
                </div>
                <div className="text-center p-2 bg-secondary/50 rounded-lg">
                  <div className="flex items-center justify-center gap-0.5 text-muted-foreground"><Thermometer className="size-3" />{t.warehouses.temp}</div>
                  <div className="font-bold mt-0.5">{w.temp}</div>
                </div>
                <div className="text-center p-2 bg-secondary/50 rounded-lg">
                  <div className="flex items-center justify-center gap-0.5 text-muted-foreground"><User className="size-3" />{t.warehouses.manager.slice(0, 3)}</div>
                  <div className="font-bold mt-0.5 truncate">{w.manager.split(" ")[0]}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.warehouses.addWarehouse} subtitle={t.pages.warehouses.sub} footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleSave}>{t.common.create}</ModalSubmit></>}>
        <FormBody />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t.warehouses.editWarehouse} subtitle={editTarget?.name} footer={<><ModalCancel onClose={() => setEditTarget(null)} /><ModalSubmit onClick={handleSave}>{t.common.save}</ModalSubmit></>}>
        <FormBody />
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t.warehouses.deleteWarehouse} width="sm" footer={<><ModalCancel onClose={() => setDeleteTarget(null)} /><ModalSubmit variant="destructive" onClick={handleDelete}>{t.common.delete}</ModalSubmit></>}>
        <p className="text-sm text-muted-foreground">{t.warehouses.confirmDelete} <strong>{deleteTarget?.name}</strong>? {t.warehouses.cannotUndo}</p>
      </Modal>
    </div>
  );
}
