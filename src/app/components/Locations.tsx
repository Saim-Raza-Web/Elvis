import { useState, useMemo } from "react";
import { MapPin, Plus, Search, Boxes, AlertTriangle, Warehouse, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { locationsService } from "../../services/locations.service";
import { warehousesService } from "../../services/warehouses.service";
import { zonesService } from "../../services/zones.service";
import { usePaginatedList, type ListService } from "../../hooks/usePaginatedList";

const locationsListService: ListService<Loc> = {
  getAll: async (params) => (await locationsService.getAll(params)) as Loc[],
  getPage: async (params) => {
    const res = await locationsService.getPage(params);
    return { data: res.data as Loc[], pagination: res.pagination };
  },
};

type Zone = { _id: string; code: string; name: string; type: string; warehouse: string; locations: number; occupied: number; capacity: number; };
type Loc = { _id: string; code: string; zone: string; aisle: string; shelf: string; bin: string; sku: string | null; product: string | null; qty: number; capacity: number; status: string; };

const zoneTypeColor: Record<string, string> = {
  receiving: "bg-blue-500/15 text-blue-500",
  picking: "bg-primary/15 text-primary",
  storage: "bg-success/15 text-success",
  packing: "bg-amber-500/15 text-amber-500",
  shipping: "bg-info/15 text-info",
  returns: "bg-warning/15 text-warning",
  blocked: "bg-destructive/15 text-destructive",
  pallet: "bg-purple-500/15 text-purple-500",
};

export function Locations() {
  const { t } = useLang();
  const [zones, setZones] = useState<Zone[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("MIA");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"zones" | "locations" | "rules">("zones");

  // Storage Rules State
  const [rules, setRules] = useState<any[]>([]);
  const [showRule, setShowRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: "", conditionType: "category", conditionValue: "", targetZone: "", targetLocationType: "", priority: 1 });
  const [editRuleTarget, setEditRuleTarget] = useState<any | null>(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<any | null>(null);

  // Add Zone modal
  const [showZone, setShowZone] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: "", name: "", type: "storage", warehouse: "MIA", locations: 10, capacity: 1000 });
  const [editZoneTarget, setEditZoneTarget] = useState<Zone | null>(null);
  const [deleteZoneTarget, setDeleteZoneTarget] = useState<Zone | null>(null);

  // Add Location modal
  const [showLoc, setShowLoc] = useState(false);
  const [locForm, setLocForm] = useState({ zone: "PICK-A", aisle: "", shelf: "", bin: "", sku: "", product: "", capacity: 100, allowed_manufacturers: "", allowed_families: "" });
  const [editLocTarget, setEditLocTarget] = useState<Loc | null>(null);
  const [deleteLocTarget, setDeleteLocTarget] = useState<Loc | null>(null);

  const { items: pagedLocs, allItems: locs, pagination, page, setPage, isLoading, reload } = usePaginatedList<Loc>(
    locationsListService,
    {
      apiParams: { search: search.toLowerCase(), warehouse: selectedWarehouse },
      deps: [search, selectedWarehouse],
    }
  );

  async function loadData() {
    try {
      const [whs, zonesData, rulesData] = await Promise.all([
        warehousesService.getAll(),
        zonesService.getAll({ warehouse: selectedWarehouse }),
        fetch(`/api/v1/storage-rules`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("jwt_token") || localStorage.getItem("token")}` }
        }).then(res => res.json())
      ]);
      const whList = (whs || []) as any[];
      setZones((zonesData as Zone[]) || []);
      setWarehouses(whList);
      setRules((rulesData as any) || []);
      if (whList.length > 0 && !selectedWarehouse) setSelectedWarehouse(whList[0].code);
    } catch (err) {
      toast.error("Failed to load data");
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedWarehouse]);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setZoneForm({ code: "", name: "", type: "storage", warehouse: selectedWarehouse, locations: 10, capacity: 1000 }); setShowZone(true); };
    window.addEventListener("open-add-location", handler);
    return () => window.removeEventListener("open-add-location", handler);
  }, [selectedWarehouse]);

  const filteredZones = zones.filter(
    (z) => (z.code || "").toLowerCase().includes(search.toLowerCase()) || (z.name || "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleAddZone() {
    if (!zoneForm.code || !zoneForm.name) return;
    try {
      if (editZoneTarget) {
        await zonesService.update(editZoneTarget._id, zoneForm);
        toast.success(`Zone updated.`);
        setEditZoneTarget(null);
      } else {
        await zonesService.create(zoneForm);
        toast.success(`${t.locations.zoneCreated}: ${zoneForm.code}`);
        setShowZone(false);
      }
      loadData();
    } catch (e) { toast.error("Failed to save zone"); }
  }

  async function handleDeleteZone() {
    if (!deleteZoneTarget) return;
    try {
      await zonesService.delete(deleteZoneTarget._id);
      toast.success(`Zone deleted.`);
      setDeleteZoneTarget(null);
      loadData();
    } catch (e) { toast.error("Failed to delete zone"); }
  }

  async function handleAddLoc() {
    if (!locForm.aisle || !locForm.shelf || !locForm.bin) return;
    const code = `${selectedWarehouse}-${locForm.zone}-${locForm.aisle}-${locForm.shelf}`;
    const parsedRules = {
      allowed_manufacturers: locForm.allowed_manufacturers.split(',').map(s=>s.trim()).filter(Boolean),
      allowed_families: locForm.allowed_families.split(',').map(s=>s.trim()).filter(Boolean)
    };
    try {
      if (editLocTarget) {
        await locationsService.update(editLocTarget._id, { ...locForm, ...parsedRules, code });
        toast.success(`Location updated.`);
        setEditLocTarget(null);
      } else {
        await locationsService.create({ ...locForm, ...parsedRules, code, qty: 0, status: "ok" });
        toast.success(`${t.locations.locCreated}: ${code}`);
        setShowLoc(false);
      }
      reload();
    } catch (e) { toast.error("Failed to save location"); }
  }

  async function handleDeleteLoc() {
    if (!deleteLocTarget) return;
    try {
      await locationsService.delete(deleteLocTarget._id);
      toast.success(`Location deleted.`);
      setDeleteLocTarget(null);
      reload();
    } catch (e) { toast.error("Failed to delete location"); }
  }

  async function handleAddRule() {
    if (!ruleForm.name || !ruleForm.conditionValue) return;
    try {
      const url = `/api/v1/storage-rules`;
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      if (editRuleTarget) {
        await fetch(`${url}/${editRuleTarget._id}`, {
          method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(ruleForm)
        });
        toast.success(`Rule updated.`);
        setEditRuleTarget(null);
      } else {
        await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(ruleForm)
        });
        toast.success(`Storage Rule created.`);
        setShowRule(false);
      }
      loadData();
    } catch (e) { toast.error("Failed to save rule"); }
  }

  async function handleDeleteRule() {
    if (!deleteRuleTarget) return;
    try {
      await fetch(`/api/v1/storage-rules/${deleteRuleTarget._id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("jwt_token") || localStorage.getItem("token")}` }
      });
      toast.success(`Rule deleted.`);
      setDeleteRuleTarget(null);
      loadData();
    } catch (e) { toast.error("Failed to delete rule"); }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.locations.totalZones, value: zones.length, icon: MapPin, color: "text-primary" },
          { label: t.locations.totalLocations, value: zones.reduce((a, z) => a + z.locations, 0), icon: Boxes, color: "text-blue-500" },
          { label: t.locations.occupied, value: `${Math.round(zones.reduce((a, z) => a + z.occupied, 0) / (zones.reduce((a, z) => a + z.locations, 0) || 1) * 100)}%`, icon: Warehouse, color: "text-amber-500" },
          { label: t.locations.lowBlocked, value: locs.filter((l) => l.status === "low" || l.status === "blocked").length, icon: AlertTriangle, color: "text-destructive" },
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
        <div className="flex gap-1.5">
          {warehouses.map((wh: any) => (
            <button key={wh.code} onClick={() => setSelectedWarehouse(wh.code)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedWarehouse === wh.code ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}>{wh.code}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView("zones")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "zones" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.common.zone}s</button>
          <button onClick={() => setView("locations")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "locations" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.common.location}s</button>
          <button onClick={() => setView("rules")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "rules" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>Rules</button>
        </div>
        <PrimaryButton icon={Plus} onClick={() => view === "zones" ? setShowZone(true) : view === "locations" ? setShowLoc(true) : setShowRule(true)}>
          {view === "zones" ? t.locations.addZone : view === "locations" ? t.locations.addLocation : "Add Rule"}
        </PrimaryButton>
      </div>

      {view === "zones" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredZones.map((zone, i) => {
            const pct = Math.round((zone.occupied / zone.locations) * 100);
            const barColor = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success";
            return (
              <div key={zone._id || i} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.875rem" }}>{zone.code}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${zoneTypeColor[zone.type]}`}>
                        {t.locations.types[zone.type as keyof typeof t.locations.types] ?? zone.type}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">{zone.name}</div>
                  </div>
                  <div className="flex gap-1 items-center">
                    <span className="text-xs font-bold bg-secondary px-2 py-1 rounded">{zone.warehouse}</span>
                    <button onClick={() => { setEditZoneTarget(zone); setZoneForm({ code: zone.code, name: zone.name, type: zone.type, warehouse: zone.warehouse, locations: zone.locations, capacity: zone.capacity }); }} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"><Edit3 className="size-3.5" /></button>
                    <button onClick={() => setDeleteZoneTarget(zone)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"><AlertTriangle className="size-3.5" /></button>
                  </div>
                </div>
                <div className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{t.locations.occupancy}</span>
                    <span className="text-xs font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{zone.occupied}/{zone.locations}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-secondary/50 rounded-lg p-2 text-center"><div className="text-muted-foreground">{t.common.location}s</div><div className="font-bold mt-0.5">{zone.locations}</div></div>
                  <div className="bg-secondary/50 rounded-lg p-2 text-center"><div className="text-muted-foreground">{t.warehouses.capacity}</div><div className="font-bold mt-0.5">{zone.capacity > 0 ? zone.capacity.toLocaleString() : "—"}</div></div>
                </div>
              </div>
            );
          })}
          {filteredZones.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border rounded-xl">{t.common.noResults}</div>
          )}
        </div>
      )}

      {view === "locations" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-3">{t.locations.locationCode}</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">{t.common.zone}</th>
                <th className="text-left px-4 py-3">{t.locations.product}</th>
                <th className="text-right px-4 py-3">{t.locations.qty}</th>
                <th className="text-center px-4 py-3">{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {pagedLocs.map((loc, i) => (
                <tr key={loc._id || i} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                  <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{loc.code}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${zoneTypeColor[zones.find((z) => z.code === loc.zone)?.type ?? "storage"]}`}>{loc.zone}</span></td>
                  <td className="px-4 py-3">
                    {loc.product ? <div><div className="font-medium">{loc.product}</div><div className="text-xs text-muted-foreground">{loc.sku}</div></div> : <span className="text-muted-foreground text-xs">{t.locations.empty}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{loc.qty > 0 ? loc.qty : "—"}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={loc.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setEditLocTarget(loc); setLocForm({ zone: loc.zone, aisle: loc.aisle, shelf: loc.shelf, bin: loc.bin, sku: loc.sku || "", product: loc.product || "", capacity: loc.capacity, allowed_manufacturers: (loc as any).allowed_manufacturers?.join(', ') || "", allowed_families: (loc as any).allowed_families?.join(', ') || "" }); }} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"><Edit3 className="size-3.5" /></button>
                      <button onClick={() => setDeleteLocTarget(loc)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"><AlertTriangle className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {pagedLocs.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">{t.common.noResults}</td></tr>}
            </tbody>
          </table>
          <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
        </div>
      )}
      
      {view === "rules" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rules.map((rule, i) => (
            <div key={rule._id || i} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold" style={{ fontSize: "0.875rem" }}>{rule.name}</span>
                    {rule.isActive ? <StatusBadge status="active" /> : <StatusBadge status="blocked" />}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    IF <strong className="text-foreground">{rule.conditionType}</strong> = <strong className="text-foreground">{rule.conditionValue}</strong>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    THEN PUT IN <strong className="text-primary">{rule.targetZone}</strong>
                  </div>
                </div>
                <div className="flex gap-1 items-center">
                  <span className="text-xs font-bold bg-secondary px-2 py-1 rounded">Priority: {rule.priority}</span>
                  <button onClick={() => { setEditRuleTarget(rule); setRuleForm({ name: rule.name, conditionType: rule.conditionType, conditionValue: rule.conditionValue, targetZone: rule.targetZone, targetLocationType: rule.targetLocationType, priority: rule.priority }); }} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"><Edit3 className="size-3.5" /></button>
                  <button onClick={() => setDeleteRuleTarget(rule)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"><AlertTriangle className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Zone Modal */}
      <Modal open={showZone} onClose={() => setShowZone(false)} title={t.locations.addZone} subtitle={t.locations.zoneName} footer={<><ModalCancel onClose={() => setShowZone(false)} /><ModalSubmit onClick={handleAddZone}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.locations.zoneName} required><Input value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value.toUpperCase() })} placeholder="PICK-C" /></Field>
          <Field label={t.common.warehouse} required><Select value={zoneForm.warehouse} onChange={(e) => setZoneForm({ ...zoneForm, warehouse: e.target.value })}>
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
            {warehouses.length === 0 && <option value="MIA">MIA</option>}
          </Select></Field>
        </Row>
        <Field label={t.locations.zoneName} required><Input value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder="Picking Zone C" /></Field>
        <Row>
          <Field label={t.locations.zoneType}><Select value={zoneForm.type} onChange={(e) => setZoneForm({ ...zoneForm, type: e.target.value })}>
            {Object.keys(zoneTypeColor).map((typeKey) => (
              <option key={typeKey} value={typeKey}>
                {t.locations.types[typeKey as keyof typeof t.locations.types] ?? typeKey}
              </option>
            ))}
          </Select></Field>
          <Field label={t.locations.totalLocations}><Input type="number" value={zoneForm.locations} onChange={(e) => setZoneForm({ ...zoneForm, locations: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.warehouses.capacity}><Input type="number" value={zoneForm.capacity} onChange={(e) => setZoneForm({ ...zoneForm, capacity: Number(e.target.value) })} /></Field>
      </Modal>

      {/* Add Location Modal */}
      <Modal open={showLoc} onClose={() => setShowLoc(false)} title={t.locations.addLocation} subtitle={t.locations.locationCode} footer={<><ModalCancel onClose={() => setShowLoc(false)} /><ModalSubmit onClick={handleAddLoc}>{t.common.create}</ModalSubmit></>}>
        <Field label={t.common.zone} required><Select value={locForm.zone} onChange={(e) => setLocForm({ ...locForm, zone: e.target.value })}>
          {zones.map((z) => <option key={z.code} value={z.code}>{z.code} — {z.name}</option>)}
        </Select></Field>
        <Row>
          <Field label={t.locations.aisle} required><Input value={locForm.aisle} onChange={(e) => setLocForm({ ...locForm, aisle: e.target.value })} placeholder="01" /></Field>
          <Field label={t.locations.shelf} required><Input value={locForm.shelf} onChange={(e) => setLocForm({ ...locForm, shelf: e.target.value })} placeholder="A" /></Field>
        </Row>
        <Row>
          <Field label={t.locations.bin}><Input value={locForm.bin} onChange={(e) => setLocForm({ ...locForm, bin: e.target.value })} placeholder="01" /></Field>
          <Field label={t.warehouses.capacity}><Input type="number" value={locForm.capacity} onChange={(e) => setLocForm({ ...locForm, capacity: Number(e.target.value) })} /></Field>
        </Row>
        <Row>
          <Field label={`${t.inventory.sku} (optional)`}><Input value={locForm.sku} onChange={(e) => setLocForm({ ...locForm, sku: e.target.value })} placeholder="SKU-XXXX" /></Field>
          <Field label={t.inventory.productName}><Input value={locForm.product} onChange={(e) => setLocForm({ ...locForm, product: e.target.value })} placeholder="Auto-filled from SKU" /></Field>
        </Row>
        <div className="pt-2 border-t border-border mt-2 mb-2">
          <p className="text-sm font-bold text-muted-foreground mb-3">{t.common.rules}</p>
          <Row>
            <Field label="Allowed Manufacturers"><Input value={locForm.allowed_manufacturers} onChange={(e) => setLocForm({ ...locForm, allowed_manufacturers: e.target.value })} placeholder="Samsung, Apple (comma separated)" /></Field>
            <Field label="Allowed Families"><Input value={locForm.allowed_families} onChange={(e) => setLocForm({ ...locForm, allowed_families: e.target.value })} placeholder="Electronics, Clothing" /></Field>
          </Row>
        </div>
      </Modal>

      {/* Edit Zone Modal */}
      <Modal open={!!editZoneTarget} onClose={() => setEditZoneTarget(null)} title={`${t.common.edit} ${t.common.zone}`} footer={<><ModalCancel onClose={() => setEditZoneTarget(null)} /><ModalSubmit onClick={handleAddZone}>{t.common.save}</ModalSubmit></>}>
        <Row>
          <Field label={t.locations.zoneName} required><Input value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value.toUpperCase() })} placeholder="PICK-C" /></Field>
          <Field label={t.common.warehouse} required><Select value={zoneForm.warehouse} onChange={(e) => setZoneForm({ ...zoneForm, warehouse: e.target.value })}>
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
            {warehouses.length === 0 && <option value="MIA">MIA</option>}
          </Select></Field>
        </Row>
        <Field label={t.locations.zoneName} required><Input value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder="Picking Zone C" /></Field>
        <Row>
          <Field label={t.locations.zoneType}><Select value={zoneForm.type} onChange={(e) => setZoneForm({ ...zoneForm, type: e.target.value })}>
            {Object.keys(zoneTypeColor).map((typeKey) => (
              <option key={typeKey} value={typeKey}>
                {t.locations.types[typeKey as keyof typeof t.locations.types] ?? typeKey}
              </option>
            ))}
          </Select></Field>
          <Field label={t.locations.totalLocations}><Input type="number" value={zoneForm.locations} onChange={(e) => setZoneForm({ ...zoneForm, locations: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.warehouses.capacity}><Input type="number" value={zoneForm.capacity} onChange={(e) => setZoneForm({ ...zoneForm, capacity: Number(e.target.value) })} /></Field>
      </Modal>

      {/* Delete Zone Modal */}
      <Modal open={!!deleteZoneTarget} onClose={() => setDeleteZoneTarget(null)} title={`${t.common.delete} ${t.common.zone}`} width="sm" footer={<><ModalCancel onClose={() => setDeleteZoneTarget(null)} /><ModalSubmit variant="destructive" onClick={handleDeleteZone}>{t.common.delete}</ModalSubmit></>}>
        <p className="text-sm text-muted-foreground">{t.warehouses.confirmDelete} <strong>{deleteZoneTarget?.code}</strong>? {t.warehouses.cannotUndo}</p>
      </Modal>

      {/* Edit Location Modal */}
      <Modal open={!!editLocTarget} onClose={() => setEditLocTarget(null)} title={`${t.common.edit} ${t.common.location}`} footer={<><ModalCancel onClose={() => setEditLocTarget(null)} /><ModalSubmit onClick={handleAddLoc}>{t.common.save}</ModalSubmit></>}>
        <Field label={t.common.zone} required><Select value={locForm.zone} onChange={(e) => setLocForm({ ...locForm, zone: e.target.value })}>
          {zones.map((z) => <option key={z.code} value={z.code}>{z.code} — {z.name}</option>)}
        </Select></Field>
        <Row>
          <Field label={t.locations.aisle} required><Input value={locForm.aisle} onChange={(e) => setLocForm({ ...locForm, aisle: e.target.value })} placeholder="01" /></Field>
          <Field label={t.locations.shelf} required><Input value={locForm.shelf} onChange={(e) => setLocForm({ ...locForm, shelf: e.target.value })} placeholder="A" /></Field>
        </Row>
        <Row>
          <Field label={t.locations.bin}><Input value={locForm.bin} onChange={(e) => setLocForm({ ...locForm, bin: e.target.value })} placeholder="01" /></Field>
          <Field label={t.warehouses.capacity}><Input type="number" value={locForm.capacity} onChange={(e) => setLocForm({ ...locForm, capacity: Number(e.target.value) })} /></Field>
        </Row>
        <Row>
          <Field label={`${t.inventory.sku} (optional)`}><Input value={locForm.sku} onChange={(e) => setLocForm({ ...locForm, sku: e.target.value })} placeholder="SKU-XXXX" /></Field>
          <Field label={t.inventory.productName}><Input value={locForm.product} onChange={(e) => setLocForm({ ...locForm, product: e.target.value })} placeholder="Auto-filled from SKU" /></Field>
        </Row>
        <div className="pt-2 border-t border-border mt-2 mb-2">
          <p className="text-sm font-bold text-muted-foreground mb-3">{t.common.rules}</p>
          <Row>
            <Field label="Allowed Manufacturers"><Input value={locForm.allowed_manufacturers} onChange={(e) => setLocForm({ ...locForm, allowed_manufacturers: e.target.value })} placeholder="Samsung, Apple (comma separated)" /></Field>
            <Field label="Allowed Families"><Input value={locForm.allowed_families} onChange={(e) => setLocForm({ ...locForm, allowed_families: e.target.value })} placeholder="Electronics, Clothing" /></Field>
          </Row>
        </div>
      </Modal>

      {/* Delete Location Modal */}
      <Modal open={!!deleteLocTarget} onClose={() => setDeleteLocTarget(null)} title="Delete Location" width="sm" footer={<><ModalCancel onClose={() => setDeleteLocTarget(null)} /><ModalSubmit variant="destructive" onClick={handleDeleteLoc}>{t.common.delete}</ModalSubmit></>}>
        <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{deleteLocTarget?.code}</strong>? This cannot be undone.</p>
      </Modal>

      {/* Delete Rule Confirm Modal */}
      <Modal open={!!deleteRuleTarget} onClose={() => setDeleteRuleTarget(null)} title="Delete Storage Rule">
        <div className="p-4 text-sm text-muted-foreground">
          Are you sure you want to delete the rule <strong>{deleteRuleTarget?.name}</strong>? This action cannot be undone.
        </div>
        <div className="flex gap-3 p-4 pt-0">
          <ModalCancel onClose={() => setDeleteRuleTarget(null)} />
          <button onClick={handleDeleteRule} className="flex-1 rounded-xl bg-destructive text-destructive-foreground font-bold hover:bg-destructive/90 transition-colors">Delete</button>
        </div>
      </Modal>

      {/* Rule Form Modal */}
      <Modal open={showRule || !!editRuleTarget} onClose={() => { setShowRule(false); setEditRuleTarget(null); }} title={editRuleTarget ? "Edit Storage Rule" : "New Storage Rule"}>
        <div className="space-y-4 p-4">
          <Field label="Rule Name">
            <Input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="e.g. Hazardous Materials" />
          </Field>
          <Row>
            <Field label="Condition Type">
              <Select value={ruleForm.conditionType} onChange={(e) => setRuleForm({ ...ruleForm, conditionType: e.target.value })}>
                <option value="category">Category</option>
                <option value="manufacturer">Manufacturer</option>
                <option value="owner">Owner</option>
                <option value="brand">Brand</option>
              </Select>
            </Field>
            <Field label="Condition Value">
              <Input value={ruleForm.conditionValue} onChange={(e) => setRuleForm({ ...ruleForm, conditionValue: e.target.value })} placeholder="e.g. Electronics" />
            </Field>
          </Row>
          <Row>
            <Field label="Target Zone">
              <Input value={ruleForm.targetZone} onChange={(e) => setRuleForm({ ...ruleForm, targetZone: e.target.value })} placeholder="e.g. Aisle A" />
            </Field>
            <Field label="Priority (1-100)">
              <Input type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: parseInt(e.target.value) })} />
            </Field>
          </Row>
        </div>
        <div className="flex gap-3 p-4 pt-0">
          <ModalCancel onClose={() => { setShowRule(false); setEditRuleTarget(null); }} />
          <ModalSubmit onClick={handleAddRule}>{t.common.save}</ModalSubmit>
        </div>
      </Modal>

    </div>
  );
}
