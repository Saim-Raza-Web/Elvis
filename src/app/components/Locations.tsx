import { useState, useMemo, useEffect } from "react";
import { MapPin, Plus, Search, Boxes, AlertTriangle, Warehouse, Edit3, Printer, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
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
type Loc = {
  _id: string;
  code: string;
  zone: string;
  aisle: string;
  shelf: string;
  bin: string;
  sku: string | null;
  product: string | null;
  qty: number;
  capacity: number;
  status: string;
  locationType?: string;
  type?: string;
  tempMin?: number;
  tempMax?: number;
  palletCapacity?: number;
  boxCapacity?: number;
  weightCapacity?: number;
  allowedOwners?: string[];
  active?: boolean;
};

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
  const [view, setView] = useState<"zones" | "locations" | "rules" | "simulators">("zones");
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvErrors, setCsvErrors] = useState<string[]>([]);

  // Selection & Barcode Label Printing (LOC-04)
  const [selectedLocIds, setSelectedLocIds] = useState<string[]>([]);

  // Storage Rules State (LOC-01)
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

  // Add Location modal (LOC-03 Extended Properties)
  const [showLoc, setShowLoc] = useState(false);
  const [locForm, setLocForm] = useState({
    zone: "PICK-A",
    aisle: "",
    shelf: "",
    bin: "",
    sku: "",
    product: "",
    capacity: 100,
    locationType: "PALLET",
    tempMin: 15,
    tempMax: 25,
    palletCapacity: 1,
    boxCapacity: 50,
    weightCapacity: 1000,
    allowedOwners: "",
    active: true,
    allowed_manufacturers: "",
    allowed_families: ""
  });
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
        }).then(res => res.json()).catch(() => [])
      ]);
      const whList = (whs || []) as any[];
      setZones((zonesData as Zone[]) || []);
      setWarehouses(whList);
      setRules(Array.isArray(rulesData) ? rulesData : []);
      if (whList.length > 0 && !selectedWarehouse) setSelectedWarehouse(whList[0].code);
    } catch (err) {
      toast.error(t.common?.error || "Failed to load data");
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

  const toggleSelectLoc = (id: string) => {
    setSelectedLocIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAllLocs = () => {
    if (selectedLocIds.length === pagedLocs.length) {
      setSelectedLocIds([]);
    } else {
      setSelectedLocIds(pagedLocs.map(l => l._id));
    }
  };

  // LOC-04 Barcode Label Printable Generator (Zebra 100x50mm Code 128)
  const handlePrintLocationLabels = (targetList?: Loc[]) => {
    const printItems = targetList || pagedLocs.filter(l => selectedLocIds.includes(l._id));
    if (printItems.length === 0) {
      toast.error("Please select at least one location to print barcode labels.");
      return;
    }

    const printWin = window.open('', '_blank');
    if (!printWin) {
      toast.error("Please allow popups to print location barcode labels.");
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Location Barcode Labels - Elvis WMS</title>
        <style>
          @page { size: A4; margin: 8mm; }
          body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; background: #fff; color: #000; }
          .label-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; }
          .label-card {
            border: 2px solid #000;
            border-radius: 8px;
            padding: 5mm;
            box-sizing: border-box;
            height: 52mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            page-break-inside: avoid;
            background: #fff;
          }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 4px; }
          .code { font-family: monospace; font-size: 22px; font-weight: 900; letter-spacing: 1px; }
          .badge { font-size: 11px; font-weight: bold; background: #000; color: #fff; padding: 2px 8px; border-radius: 4px; }
          .barcode-box { text-align: center; margin: 4px 0; }
          .barcode-box svg { max-width: 100%; height: 50px; }
          .barcode-text { font-family: monospace; font-size: 13px; font-weight: bold; margin-top: 2px; }
          .footer-info { display: flex; justify-content: space-between; font-size: 9px; font-weight: bold; color: #333; border-top: 1px solid #ccc; padding-top: 4px; }
        </style>
      </head>
      <body>
        <div class="label-grid">
          ${printItems.map(item => `
            <div class="label-card">
              <div class="header">
                <span class="code">${item.code}</span>
                <span class="badge">${item.zone || 'MAIN'} · ${item.locationType || item.type || 'PALLET'}</span>
              </div>
              <div class="barcode-box">
                <svg id="barcode-${item._id}"></svg>
                <div class="barcode-text">*${item.code}*</div>
              </div>
              <div class="footer-info">
                <span>WH: ${selectedWarehouse}</span>
                <span>Temp: ${item.tempMin ?? 15}°C to ${item.tempMax ?? 25}°C</span>
                <span>Cap: ${item.palletCapacity ?? 1} Pallet / ${item.weightCapacity ?? 1000}kg</span>
              </div>
            </div>
          `).join('')}
        </div>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
        <script>
          window.onload = () => {
            ${printItems.map(item => `
              try {
                JsBarcode("#barcode-${item._id}", "${item.code}", { format: "CODE128", width: 2, height: 45, displayValue: false });
              } catch(e) {}
            `).join('\n')}
            setTimeout(() => { window.print(); }, 400);
          };
        </script>
      </body>
      </html>
    `;

    printWin.document.write(html);
    printWin.document.close();
  };

  const handleAddZone = async () => {
    try {
      if (!zoneForm.code || !zoneForm.name) { toast.error("Code and Name are required"); return; }
      if (editZoneTarget) {
        await zonesService.update(editZoneTarget._id, zoneForm);
        toast.success(`Zone ${zoneForm.code} updated`);
      } else {
        await zonesService.create(zoneForm);
        toast.success(`Zone ${zoneForm.code} created`);
      }
      setShowZone(false);
      setEditZoneTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save zone");
    }
  };

  const handleDeleteZone = async () => {
    if (!deleteZoneTarget) return;
    try {
      await zonesService.delete(deleteZoneTarget._id);
      toast.success(`Zone ${deleteZoneTarget.code} deleted`);
      setDeleteZoneTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete zone");
    }
  };

  const handleAddLoc = async () => {
    try {
      if (!locForm.zone || !locForm.aisle || !locForm.shelf) { toast.error("Zone, Aisle, and Shelf are required"); return; }
      const payload = {
        ...locForm,
        warehouse: selectedWarehouse,
        allowed_manufacturers: locForm.allowed_manufacturers.split(',').map(s => s.trim()).filter(Boolean),
        allowed_families: locForm.allowed_families.split(',').map(s => s.trim()).filter(Boolean),
        allowedOwners: locForm.allowedOwners.split(',').map(s => s.trim()).filter(Boolean),
      };
      if (editLocTarget) {
        await locationsService.update(editLocTarget._id, payload);
        toast.success(`Location updated`);
      } else {
        await locationsService.create(payload);
        toast.success(`Location created`);
      }
      setShowLoc(false);
      setEditLocTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save location");
    }
  };

  const handleDeleteLoc = async () => {
    if (!deleteLocTarget) return;
    try {
      await locationsService.delete(deleteLocTarget._id);
      toast.success(`Location ${deleteLocTarget.code} deleted`);
      setDeleteLocTarget(null);
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete location");
    }
  };

  const handleAddRule = async () => {
    try {
      if (!ruleForm.name || !ruleForm.targetZone) { toast.error("Rule name and Target Zone are required"); return; }
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const url = editRuleTarget ? `/api/v1/storage-rules/${editRuleTarget._id}` : `/api/v1/storage-rules`;
      const method = editRuleTarget ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(ruleForm)
      });
      if (!res.ok) throw new Error("Failed to save storage rule");
      toast.success(editRuleTarget ? `Rule ${ruleForm.name} updated` : `Rule ${ruleForm.name} created`);
      setShowRule(false);
      setEditRuleTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save rule");
    }
  };

  const handleDeleteRule = async () => {
    if (!deleteRuleTarget) return;
    try {
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const res = await fetch(`/api/v1/storage-rules/${deleteRuleTarget._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to delete rule");
      toast.success(`Rule ${deleteRuleTarget.name} deleted`);
      setDeleteRuleTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete rule");
    }
  };

  const filteredZones = useMemo(() => {
    return zones.filter(z => z.code.toLowerCase().includes(search.toLowerCase()) || z.name.toLowerCase().includes(search.toLowerCase()));
  }, [zones, search]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.locations.totalZones, value: [...new Set(locs.map(l => l.zone).filter(Boolean))].length || zones.length, icon: MapPin, color: "text-primary" },
          { label: t.locations.totalLocations, value: pagination?.total ?? locs.length, icon: Boxes, color: "text-blue-500" },
          { label: t.locations.occupied, value: `${locs.length > 0 ? Math.round((locs.filter(l => (l.qty || 0) > 0).length / locs.length) * 100) : 0}%`, icon: Warehouse, color: "text-amber-500" },
          { label: t.locations.lowBlocked, value: locs.filter((l) => l.status === "low" || l.status === "blocked" || l.status === "LOCKED").length, icon: AlertTriangle, color: "text-destructive" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-48">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t.common.search}…`} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
          </div>
          <div className="flex gap-1.5">
            {warehouses.map((wh: any) => (
              <button key={wh.code} onClick={() => setSelectedWarehouse(wh.code)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedWarehouse === wh.code ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}>{wh.code}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {view === "locations" && selectedLocIds.length > 0 && (
            <button
              type="button"
              onClick={() => handlePrintLocationLabels()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-all shadow-sm"
            >
              <Printer className="size-4" /> Print Selected Labels ({selectedLocIds.length})
            </button>
          )}

          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setView("zones")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "zones" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.common.zone}s</button>
            <button onClick={() => setView("locations")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "locations" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.common.location}s</button>
            <button onClick={() => setView("rules")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "rules" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>Rules</button>
            <button onClick={() => setView("simulators" as any)} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === ("simulators" as any) ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>Simulators</button>
          </div>

          <button
            type="button"
            onClick={() => setShowCsvImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border hover:bg-secondary/80 font-bold text-xs transition-all"
          >
            Import CSV
          </button>

          <PrimaryButton icon={Plus} onClick={() => view === "zones" ? setShowZone(true) : view === "locations" ? setShowLoc(true) : setShowRule(true)}>
            {view === "zones" ? t.locations.addZone : view === "locations" ? t.locations.addLocation : "Add Rule"}
          </PrimaryButton>
        </div>
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
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border font-bold">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <button type="button" onClick={toggleSelectAllLocs} className="hover:text-foreground">
                    {selectedLocIds.length > 0 && selectedLocIds.length === pagedLocs.length ? (
                      <CheckSquare className="size-4 text-primary" />
                    ) : (
                      <Square className="size-4" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3">{t.locations.locationCode}</th>
                <th className="px-4 py-3 hidden md:table-cell">{t.common.zone}</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">{t.locations.product}</th>
                <th className="px-4 py-3 text-right">{t.locations.qty}</th>
                <th className="px-4 py-3 text-center">{t.common.status}</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedLocs.map((loc, i) => {
                const isSelected = selectedLocIds.includes(loc._id);
                return (
                  <tr key={loc._id || i} className={`border-t border-border hover:bg-secondary/30 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
                    <td className="px-4 py-3 text-center">
                      <button type="button" onClick={() => toggleSelectLoc(loc._id)} className="hover:text-foreground">
                        {isSelected ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4 text-muted-foreground" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold font-mono text-xs">{loc.code}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${zoneTypeColor[zones.find((z) => z.code === loc.zone)?.type ?? "storage"]}`}>{loc.zone}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-secondary text-foreground">
                        {loc.locationType || loc.type || "PALLET"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {loc.product ? <div><div className="font-medium">{loc.product}</div><div className="text-xs text-muted-foreground font-mono">{loc.sku}</div></div> : <span className="text-muted-foreground text-xs">{t.locations.empty}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-bold font-mono">{loc.qty > 0 ? loc.qty : "—"}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={loc.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handlePrintLocationLabels([loc])}
                          title="Print Location Barcode Label (LOC-04)"
                          className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors"
                        >
                          <Printer className="size-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setEditLocTarget(loc);
                            setLocForm({
                              zone: loc.zone,
                              aisle: loc.aisle,
                              shelf: loc.shelf,
                              bin: loc.bin,
                              sku: loc.sku || "",
                              product: loc.product || "",
                              capacity: loc.capacity,
                              locationType: loc.locationType || loc.type || "PALLET",
                              tempMin: loc.tempMin ?? 15,
                              tempMax: loc.tempMax ?? 25,
                              palletCapacity: loc.palletCapacity ?? 1,
                              boxCapacity: loc.boxCapacity ?? 50,
                              weightCapacity: loc.weightCapacity ?? 1000,
                              allowedOwners: loc.allowedOwners?.join(', ') || "",
                              active: loc.active !== false,
                              allowed_manufacturers: (loc as any).allowed_manufacturers?.join(', ') || "",
                              allowed_families: (loc as any).allowed_families?.join(', ') || ""
                            });
                          }}
                          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                        >
                          <Edit3 className="size-3.5" />
                        </button>
                        <button onClick={() => setDeleteLocTarget(loc)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"><AlertTriangle className="size-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pagedLocs.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">{t.common.noResults}</td></tr>}
            </tbody>
          </table>
          <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
        </div>
      )}

      {/* Rules Tab Error Boundary & Empty State (LOC-01) */}
      {view === "rules" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(Array.isArray(rules) && rules.length > 0) ? rules.map((rule, i) => (
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
          )) : (
            <div className="col-span-full p-12 text-center bg-card rounded-xl border border-border space-y-3">
              <Boxes className="size-10 text-muted-foreground mx-auto opacity-40" />
              <div className="font-bold text-base text-foreground">No rules configured. Go to Settings &gt; Storage Rules to create them.</div>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Storage rules dynamically govern putaway location proposals based on product category, temperature limits, and client owner isolation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Add Zone Modal */}
      <Modal open={showZone} onClose={() => setShowZone(false)} title={t.locations.addZone} subtitle={t.locations.zoneName} footer={<><ModalCancel onClose={() => setShowZone(false)} /><ModalSubmit onClick={handleAddZone}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.locations.zoneName} required><Input value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value.toUpperCase() })} placeholder="PICK-C" /></Field>
          <Field label={t.common.warehouse} required><Select value={zoneForm.warehouse} onChange={(e) => setZoneForm({ ...zoneForm, warehouse: e.target.value })}>
            {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
            {warehouses.length === 0 && <option value="MIA">{t.common?.mIA || "MIA"}</option>}
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

      {/* Add / Edit Location Modal (LOC-03 Extended Properties) */}
      <Modal open={showLoc || !!editLocTarget} onClose={() => { setShowLoc(false); setEditLocTarget(null); }} title={editLocTarget ? `${t.common.edit} ${t.common.location}` : t.locations.addLocation} subtitle="Configure bin, location type, capacity and temperature limits." footer={<><ModalCancel onClose={() => { setShowLoc(false); setEditLocTarget(null); }} /><ModalSubmit onClick={handleAddLoc}>{editLocTarget ? t.common.save : t.common.create}</ModalSubmit></>}>
        <Field label={t.common.zone} required><Select value={locForm.zone} onChange={(e) => setLocForm({ ...locForm, zone: e.target.value })}>
          {zones.map((z) => <option key={z.code} value={z.code}>{z.code} — {z.name}</option>)}
        </Select></Field>
        <Row>
          <Field label={t.locations.aisle} required><Input value={locForm.aisle} onChange={(e) => setLocForm({ ...locForm, aisle: e.target.value })} placeholder="01" /></Field>
          <Field label={t.locations.shelf} required><Input value={locForm.shelf} onChange={(e) => setLocForm({ ...locForm, shelf: e.target.value })} placeholder="A" /></Field>
          <Field label={t.locations.bin}><Input value={locForm.bin} onChange={(e) => setLocForm({ ...locForm, bin: e.target.value })} placeholder="01" /></Field>
        </Row>
        <Row>
          <Field label="Location Type (LOC-03)">
            <Select value={locForm.locationType} onChange={(e) => setLocForm({ ...locForm, locationType: e.target.value })}>
              <option value="PALLET">PALLET</option>
              <option value="SHELF">SHELF</option>
              <option value="FLOOR">FLOOR</option>
              <option value="STAGING">STAGING</option>
              <option value="OVERFLOW">OVERFLOW</option>
            </Select>
          </Field>
          <Field label="Weight Cap (kg)"><Input type="number" value={locForm.weightCapacity} onChange={(e) => setLocForm({ ...locForm, weightCapacity: Number(e.target.value) })} /></Field>
        </Row>
        <Row>
          <Field label="Min Temp (°C)"><Input type="number" value={locForm.tempMin} onChange={(e) => setLocForm({ ...locForm, tempMin: Number(e.target.value) })} /></Field>
          <Field label="Max Temp (°C)"><Input type="number" value={locForm.tempMax} onChange={(e) => setLocForm({ ...locForm, tempMax: Number(e.target.value) })} /></Field>
        </Row>
        <Row>
          <Field label="Pallet Cap"><Input type="number" value={locForm.palletCapacity} onChange={(e) => setLocForm({ ...locForm, palletCapacity: Number(e.target.value) })} /></Field>
          <Field label="Box Cap"><Input type="number" value={locForm.boxCapacity} onChange={(e) => setLocForm({ ...locForm, boxCapacity: Number(e.target.value) })} /></Field>
        </Row>
        <Field label="Allowed 3PL Owners (comma-separated)"><Input value={locForm.allowedOwners} onChange={(e) => setLocForm({ ...locForm, allowedOwners: e.target.value })} placeholder="e.g. Apple Distribution 3PL, Acme Logistics 3PL" /></Field>
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
          <button onClick={handleDeleteRule} className="flex-1 rounded-xl bg-destructive text-destructive-foreground font-bold hover:bg-destructive/90 transition-colors">{t.common?.delete || "Delete"}</button>
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

      {/* CSV Location Importer Modal */}
      <Modal open={showCsvImport} onClose={() => { setShowCsvImport(false); setCsvErrors([]); }} title="CSV Location Importer (Whole-File Validation)" width="xl">
        <div className="space-y-4 p-4">
          <p className="text-xs text-muted-foreground">
            Paste location JSON or CSV formatted objects. If <strong>ANY</strong> row contains errors (duplicate codes, invalid temperature bounds, or bad location types), the <strong>ENTIRE</strong> file will be rejected with 0 partial commits.
          </p>

          <textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={`[\n  { "code": "A-01-01", "locationType": "SHELF", "tempMin": 15, "tempMax": 25 },\n  { "code": "PAL-01-01", "locationType": "PALLET", "palletCapacity": 1 }\n]`}
            className="w-full p-3 bg-secondary/30 border border-border rounded-xl font-mono text-xs outline-none focus:border-primary"
          />

          {csvErrors.length > 0 && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl space-y-1">
              <div className="font-bold text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="size-4 shrink-0" /> Whole-File Validation Failed ({csvErrors.length} errors):
              </div>
              <ul className="list-disc list-inside text-[11px] text-destructive space-y-0.5 max-h-32 overflow-y-auto font-mono">
                {csvErrors.map((err, idx) => <li key={idx}>{err}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="flex gap-3 p-4 pt-0">
          <ModalCancel onClose={() => { setShowCsvImport(false); setCsvErrors([]); }} />
          <ModalSubmit onClick={async () => {
            try {
              let parsed: any[];
              try {
                parsed = JSON.parse(csvText);
              } catch (_) {
                toast.error("Invalid JSON format. Please provide valid JSON array of objects.");
                return;
              }
              const res = await locationsService.importCSV(parsed);
              toast.success(res.message);
              setShowCsvImport(false);
              setCsvText("");
              setCsvErrors([]);
              loadData();
            } catch (err: any) {
              const errData = err.response?.data;
              if (errData?.errors) {
                setCsvErrors(errData.errors);
              } else {
                toast.error(errData?.message || err.message || "CSV import failed");
              }
            }
          }}>Validate & Import Whole File</ModalSubmit>
        </div>
      </Modal>

    </div>
  );
}
