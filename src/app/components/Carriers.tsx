import { useState } from "react";
import { Building2, Plus, Truck, CheckCircle2, Zap, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const carriers = [
  { id: "1", name: "FedEx", type: "international", status: "active", account: "FX-7842110", on_time: 94, cost_avg: 8.20, shipments_mtd: 142, regions: ["US", "EU", "APAC"], label: true, tracking: true, features: ["Express", "Ground", "Freight"] },
  { id: "2", name: "UPS", type: "international", status: "active", account: "1Z999AA1", on_time: 91, cost_avg: 7.80, shipments_mtd: 98, regions: ["US", "EU"], label: true, tracking: true, features: ["Standard", "Express", "Access Point"] },
  { id: "3", name: "DHL", type: "international", status: "active", account: "DHL-EU-4421", on_time: 97, cost_avg: 9.40, shipments_mtd: 211, regions: ["EU", "APAC", "LATAM"], label: true, tracking: true, features: ["Express", "Parcel", "Freight"] },
  { id: "4", name: "USPS", type: "domestic", status: "active", account: "USPS-0081", on_time: 88, cost_avg: 5.10, shipments_mtd: 67, regions: ["US"], label: true, tracking: true, features: ["Priority", "First Class", "Ground"] },
  { id: "5", name: "Correos Spain", type: "domestic", status: "active", account: "COR-ES-2210", on_time: 86, cost_avg: 4.20, shipments_mtd: 33, regions: ["ES"], label: true, tracking: false, features: ["Standard", "Certified"] },
  { id: "6", name: "Chronopost", type: "regional", status: "inactive", account: "CHR-FR-9921", on_time: 92, cost_avg: 11.00, shipments_mtd: 0, regions: ["FR", "EU"], label: true, tracking: true, features: ["Express 13h", "Classic"] },
];

const carrierRules = [
  { id: "R1", name: "Domestic express < 2kg", condition: "Weight ≤ 2kg + Destination: US + Priority: Express", carrier: "FedEx", active: true },
  { id: "R2", name: "EU standard delivery", condition: "Destination: EU + Priority: Standard", carrier: "DHL", active: true },
  { id: "R3", name: "Economy US domestic", condition: "Weight ≤ 5kg + Destination: US + Priority: Economy", carrier: "USPS", active: true },
  { id: "R4", name: "Spain local delivery", condition: "Destination: ES + Weight ≤ 30kg", carrier: "Correos Spain", active: false },
  { id: "R5", name: "Heavy freight international", condition: "Weight > 30kg + Destination: any", carrier: "UPS", active: true },
];

export function Carriers() {
  const { t } = useLang();
  const [carrierList, setCarrierList] = useState(carriers);
  const [view, setView] = useState<"carriers" | "rules">("carriers");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "international", account: "", status: "active", on_time: 90, cost_avg: 8.0, regions: "US,EU" });

  function handleAdd() {
    if (!form.name || !form.account) { toast.error("Carrier name and account are required."); return; }
    setCarrierList((prev) => [...prev, { id: String(Date.now()), name: form.name, type: form.type, status: form.status, account: form.account, on_time: form.on_time, cost_avg: form.cost_avg, shipments_mtd: 0, regions: form.regions.split(",").map((r) => r.trim()), label: true, tracking: true, features: ["Standard"] }]);
    toast.success(`Carrier "${form.name}" added.`);
    setShowAdd(false);
    setForm({ name: "", type: "international", account: "", status: "active", on_time: 90, cost_avg: 8.0, regions: "US,EU" });
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.carriers.activeCarriers, value: carrierList.filter((c) => c.status === "active").length, icon: Truck, color: "text-success" },
          { label: t.carriers.shipmentsMTD, value: carrierList.reduce((a, c) => a + c.shipments_mtd, 0), icon: Building2, color: "text-primary" },
          { label: t.carriers.avgOnTime, value: `${Math.round(carrierList.filter((c) => c.status === "active").reduce((a, c) => a + c.on_time, 0) / Math.max(1, carrierList.filter((c) => c.status === "active").length))}%`, icon: CheckCircle2, color: "text-success" },
          { label: t.carriers.autoRules, value: carrierRules.filter((r) => r.active).length, icon: Zap, color: "text-amber-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setView("carriers")} className={`px-4 py-2 text-sm font-semibold transition-colors ${view === "carriers" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.nav.carriers}</button>
          <button onClick={() => setView("rules")} className={`px-4 py-2 text-sm font-semibold transition-colors ${view === "rules" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t.carriers.autoRules}</button>
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>{view === "carriers" ? t.carriers.addCarrier : t.common.new}</PrimaryButton>
      </div>

      {view === "carriers" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {carrierList.map((carrier, i) => (
            <div key={carrier.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold">{carrier.name}</h3>
                    <StatusBadge status={carrier.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">{carrier.account}</div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {carrier.regions.map((r) => (
                      <span key={r} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded font-bold">{r}</span>
                    ))}
                  </div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
              </div>

              {/* Performance */}
              <div className="grid grid-cols-3 gap-2 mb-4 text-center text-xs">
                <div className="bg-secondary/50 rounded-lg p-2">
                  <div className="text-muted-foreground">{t.carriers.onTimeRate.replace(" (%)", "")}</div>
                  <div className={`font-bold mt-0.5 ${carrier.on_time >= 95 ? "text-success" : carrier.on_time >= 90 ? "text-warning" : "text-destructive"}`}>{carrier.on_time}%</div>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2">
                  <div className="text-muted-foreground">{t.carriers.avgCost.replace(" (€)", "")}</div>
                  <div className="font-bold mt-0.5">€{carrier.cost_avg}</div>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2">
                  <div className="text-muted-foreground">MTD</div>
                  <div className="font-bold mt-0.5">{carrier.shipments_mtd}</div>
                </div>
              </div>

              {/* Features */}
              <div className="flex flex-wrap gap-1">
                {carrier.features.map((f) => (
                  <span key={f} className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">{f}</span>
                ))}
                {carrier.label && <span className="text-[10px] bg-success/15 text-success rounded px-1.5 py-0.5 font-bold">Labels</span>}
                {carrier.tracking && <span className="text-[10px] bg-primary/15 text-primary rounded px-1.5 py-0.5 font-bold">Tracking</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-4 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="size-4 text-amber-500" />
              <h3 className="font-semibold">{t.carriers.autoSelectTitle}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{t.carriers.autoSelectDesc}</p>
          </div>

          {carrierRules.map((rule, i) => (
            <div key={rule.id} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="size-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">#{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold">{rule.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rule.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{rule.active ? "Active" : "Inactive"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{rule.condition}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground">{t.carriers.assignedCarrier}</div>
                    <div className="font-bold text-sm text-primary">{rule.carrier}</div>
                  </div>
                  <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.carriers.addCarrier} subtitle="Connect a shipping carrier" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleAdd}>{t.carriers.addCarrier}</ModalSubmit></>}>
        <Row>
          <Field label={t.carriers.carrierName} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="FedEx, DHL…" /></Field>
          <Field label={t.common.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="international">International</option><option value="domestic">Domestic</option><option value="regional">Regional</option>
          </Select></Field>
        </Row>
        <Field label={t.carriers.accountNo} required><Input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="ACC-XXXXXX" /></Field>
        <Row>
          <Field label={t.carriers.avgCost}><Input type="number" step="0.1" value={form.cost_avg} onChange={(e) => setForm({ ...form, cost_avg: Number(e.target.value) })} /></Field>
          <Field label={t.carriers.onTimeRate}><Input type="number" value={form.on_time} onChange={(e) => setForm({ ...form, on_time: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.carriers.regions} hint={t.carriers.regionsHint}><Input value={form.regions} onChange={(e) => setForm({ ...form, regions: e.target.value })} placeholder="US, EU" /></Field>
      </Modal>
    </div>
  );
}
