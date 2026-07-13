import { useState } from "react";
import { MapPin, Plus, Search, Boxes, AlertTriangle, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const whList = ["MIA", "LAX", "ORD", "JFK", "DAL"];

const initialZones = [
  { code: "RECV-A", name: "Receiving Zone A", type: "receiving", warehouse: "MIA", locations: 12, occupied: 8, capacity: 500 },
  { code: "RECV-B", name: "Receiving Zone B", type: "receiving", warehouse: "MIA", locations: 8, occupied: 3, capacity: 300 },
  { code: "PICK-A", name: "Picking Zone A", type: "picking", warehouse: "MIA", locations: 24, occupied: 20, capacity: 1200 },
  { code: "PICK-B", name: "Picking Zone B", type: "picking", warehouse: "LAX", locations: 30, occupied: 28, capacity: 1800 },
  { code: "BULK-A", name: "Bulk Storage A", type: "storage", warehouse: "MIA", locations: 40, occupied: 32, capacity: 8000 },
  { code: "BULK-B", name: "Bulk Storage B", type: "storage", warehouse: "LAX", locations: 60, occupied: 58, capacity: 12000 },
  { code: "PACK-1", name: "Packing Station 1", type: "packing", warehouse: "MIA", locations: 6, occupied: 2, capacity: 0 },
  { code: "PACK-2", name: "Packing Station 2", type: "packing", warehouse: "LAX", locations: 6, occupied: 1, capacity: 0 },
  { code: "SHIP-A", name: "Shipping Area A", type: "shipping", warehouse: "MIA", locations: 10, occupied: 6, capacity: 400 },
  { code: "RETURN-A", name: "Returns Area A", type: "returns", warehouse: "MIA", locations: 8, occupied: 3, capacity: 200 },
  { code: "BLOCK-A", name: "Blocked Stock A", type: "blocked", warehouse: "ORD", locations: 5, occupied: 2, capacity: 100 },
  { code: "PALLET-A", name: "Pallet Storage A", type: "pallet", warehouse: "ORD", locations: 20, occupied: 14, capacity: 3000 },
];

const initialLocations = [
  { code: "MIA-PICK-A-01-A", zone: "PICK-A", aisle: "01", shelf: "A", bin: "01", sku: "SKU-1001", product: "Premium Widget Alpha", qty: 48, capacity: 100, status: "ok" },
  { code: "MIA-PICK-A-01-B", zone: "PICK-A", aisle: "01", shelf: "B", bin: "01", sku: "SKU-1006", product: "Precision Sensor Module", qty: 12, capacity: 50, status: "low" },
  { code: "MIA-BULK-A-03-A", zone: "BULK-A", aisle: "03", shelf: "A", bin: "01", sku: "SKU-1003", product: "Steel Bracket Type-C", qty: 840, capacity: 1000, status: "ok" },
  { code: "MIA-BULK-A-03-B", zone: "BULK-A", aisle: "03", shelf: "B", bin: "01", sku: "SKU-1005", product: "Nylon Cable Tie 500mm", qty: 2400, capacity: 3000, status: "ok" },
  { code: "MIA-RECV-A-01-A", zone: "RECV-A", aisle: "01", shelf: "A", bin: "01", sku: null, product: null, qty: 0, capacity: 200, status: "ok" },
  { code: "ORD-BLOCK-A-01-A", zone: "BLOCK-A", aisle: "01", shelf: "A", bin: "01", sku: "SKU-1004", product: "Lithium Battery Pack 12V", qty: 8, capacity: 50, status: "blocked" },
];

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
  const [zones, setZones] = useState(initialZones);
  const [locs, setLocs] = useState(initialLocations);
  const [selectedWarehouse, setSelectedWarehouse] = useState("MIA");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"zones" | "locations">("zones");

  // Add Zone modal
  const [showZone, setShowZone] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: "", name: "", type: "storage", warehouse: "MIA", locations: 10, capacity: 1000 });

  // Add Location modal
  const [showLoc, setShowLoc] = useState(false);
  const [locForm, setLocForm] = useState({ zone: "PICK-A", aisle: "", shelf: "", bin: "", sku: "", product: "", capacity: 100 });

  const filteredZones = zones.filter(
    (z) => z.warehouse === selectedWarehouse &&
      (z.code.toLowerCase().includes(search.toLowerCase()) || z.name.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredLocs = locs.filter(
    (l) => l.code.toLowerCase().includes(search.toLowerCase()) ||
      (l.sku ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (l.product ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function handleAddZone() {
    if (!zoneForm.code || !zoneForm.name) { toast.error("Zone code and name required."); return; }
    setZones((prev) => [...prev, { ...zoneForm, occupied: 0 }]);
    toast.success(`${t.locations.zoneCreated}: ${zoneForm.code}`);
    setShowZone(false);
    setZoneForm({ code: "", name: "", type: "storage", warehouse: "MIA", locations: 10, capacity: 1000 });
  }

  function handleAddLoc() {
    if (!locForm.aisle || !locForm.shelf) { toast.error("Aisle and shelf are required."); return; }
    const code = `${locForm.zone}-${locForm.aisle}-${locForm.shelf}-${locForm.bin || "01"}`;
    setLocs((prev) => [...prev, { code, zone: locForm.zone, aisle: locForm.aisle, shelf: locForm.shelf, bin: locForm.bin || "01", sku: locForm.sku || null, product: locForm.product || null, qty: 0, capacity: locForm.capacity, status: "ok" }]);
    toast.success(`${t.locations.locCreated}: ${code}`);
    setShowLoc(false);
    setLocForm({ zone: "PICK-A", aisle: "", shelf: "", bin: "", sku: "", product: "", capacity: 100 });
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.locations.totalZones, value: zones.length, icon: MapPin, color: "text-primary" },
          { label: t.locations.totalLocations, value: zones.reduce((a, z) => a + z.locations, 0), icon: Boxes, color: "text-blue-500" },
          { label: t.locations.occupied, value: `${Math.round(zones.reduce((a, z) => a + z.occupied, 0) / zones.reduce((a, z) => a + z.locations, 0) * 100)}%`, icon: Warehouse, color: "text-amber-500" },
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
          {whList.map((wh) => (
            <button key={wh} onClick={() => setSelectedWarehouse(wh)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedWarehouse === wh ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`}>{wh}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView("zones")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "zones" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.common.zone}s</button>
          <button onClick={() => setView("locations")} className={`px-3 py-2 text-xs font-semibold transition-colors ${view === "locations" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.common.location}s</button>
        </div>
        <PrimaryButton icon={Plus} onClick={() => view === "zones" ? setShowZone(true) : setShowLoc(true)}>
          {view === "zones" ? t.locations.addZone : t.locations.addLocation}
        </PrimaryButton>
      </div>

      {view === "zones" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredZones.map((zone, i) => {
            const pct = Math.round((zone.occupied / zone.locations) * 100);
            const barColor = pct > 90 ? "bg-destructive" : pct > 70 ? "bg-warning" : "bg-success";
            return (
              <div key={zone.code} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
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
                  <span className="text-xs font-bold bg-secondary px-2 py-1 rounded">{zone.warehouse}</span>
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
      ) : (
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
              {filteredLocs.map((loc, i) => (
                <tr key={loc.code} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                  <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{loc.code}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${zoneTypeColor[zones.find((z) => z.code === loc.zone)?.type ?? "storage"]}`}>{loc.zone}</span></td>
                  <td className="px-4 py-3">
                    {loc.product ? <div><div className="font-medium">{loc.product}</div><div className="text-xs text-muted-foreground">{loc.sku}</div></div> : <span className="text-muted-foreground text-xs">{t.locations.empty}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{loc.qty > 0 ? loc.qty : "—"}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={loc.status} /></td>
                </tr>
              ))}
              {filteredLocs.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">{t.common.noResults}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Zone Modal */}
      <Modal open={showZone} onClose={() => setShowZone(false)} title={t.locations.addZone} subtitle={t.locations.zoneName} footer={<><ModalCancel onClose={() => setShowZone(false)} /><ModalSubmit onClick={handleAddZone}>{t.common.create}</ModalSubmit></>}>
        <Row>
          <Field label={t.locations.zoneName} required><Input value={zoneForm.code} onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value.toUpperCase() })} placeholder="PICK-C" /></Field>
          <Field label={t.common.warehouse} required><Select value={zoneForm.warehouse} onChange={(e) => setZoneForm({ ...zoneForm, warehouse: e.target.value })}>
            {whList.map((w) => <option key={w}>{w}</option>)}
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
      </Modal>
    </div>
  );
}
