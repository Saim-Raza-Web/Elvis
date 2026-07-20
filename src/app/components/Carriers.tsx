import { useState } from "react";
import { Building2, Plus, Truck, CheckCircle2, Zap, Edit3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { carriersService } from "../../services/carriers.service";
import { carrierRulesService } from "../../services/carrier_rules.service";

type Carrier = { _id: string; id: string; name: string; type: string; status: string; account: string; on_time: number; cost_avg: number; shipments_mtd: number; regions: string[]; label: boolean; tracking: boolean; features: string[] };
type CarrierRule = { _id: string; id: string; name: string; condition: string; carrier: string; active: boolean };

export function Carriers() {
  const { t } = useLang();
  const [carrierList, setCarrierList] = useState<Carrier[]>([]);
  const [carrierRules, setCarrierRules] = useState<CarrierRule[]>([]);
  const [view, setView] = useState<"carriers" | "rules">("carriers");
  const [showAdd, setShowAdd] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editMode, setEditMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", type: "international", account: "", status: "active", on_time: 90, cost_avg: 8.0, regions: "US,EU" });
  const [ruleForm, setRuleForm] = useState({ name: "", condition: "", carrier: "", active: true });

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const [carrierData, ruleData] = await Promise.all([carriersService.getAll(), carrierRulesService.getAll()]);
      setCarrierList(carrierData.map((d: any) => ({ ...d, id: d._id, shipments_mtd: d.shipments_mtd || 0, on_time: d.on_time || 90, cost_avg: d.cost_avg || 8 })));
      setCarrierRules(ruleData.map((d: any) => ({ ...d, id: d._id })));
    } catch (err) {
      toast.error("Failed to load carriers");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm({ name: "", type: "international", account: "", status: "active", on_time: 90, cost_avg: 8.0, regions: "US,EU" }); setEditMode("add"); setShowAdd(true); };
    window.addEventListener("open-add-carrier", handler);
    return () => window.removeEventListener("open-add-carrier", handler);
  }, []);

  async function handleSaveCarrier() {
    if (!form.name || !form.account) { toast.error("Carrier name and account are required."); return; }
    try {
      if (editMode === "add") {
        await carriersService.create({ name: form.name, type: form.type, status: form.status, account: form.account, on_time: form.on_time, cost_avg: form.cost_avg, shipments_mtd: 0, regions: form.regions.split(",").map((r) => r.trim()), label: true, tracking: true, features: ["Standard"] });
        toast.success(`Carrier "${form.name}" added.`);
      } else {
        await carriersService.update(editingId!, { name: form.name, type: form.type, status: form.status, account: form.account, on_time: form.on_time, cost_avg: form.cost_avg, regions: form.regions.split(",").map((r) => r.trim()) });
        toast.success(`Carrier updated.`);
      }
      setShowAdd(false);
      loadData();
    } catch (err) { toast.error("Failed to save carrier"); }
  }

  function openEditCarrier(c: Carrier) {
    setEditMode("edit");
    setEditingId(c._id);
    setForm({ name: c.name, type: c.type, account: c.account, status: c.status, on_time: c.on_time, cost_avg: c.cost_avg, regions: c.regions.join(", ") });
    setShowAdd(true);
  }

  async function handleSaveRule() {
    if (!ruleForm.name || !ruleForm.condition) { toast.error("Name and condition are required."); return; }
    try {
      if (editMode === "add") {
        await carrierRulesService.create(ruleForm);
        toast.success(`Rule "${ruleForm.name}" added.`);
      } else {
        await carrierRulesService.update(editingId!, ruleForm);
        toast.success(`Rule updated.`);
      }
      setShowRuleModal(false);
      loadData();
    } catch (err) { toast.error("Failed to save rule"); }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("Delete this rule?")) return;
    try {
      await carrierRulesService.delete(id);
      toast.success("Rule deleted.");
      loadData();
    } catch (err) { toast.error("Failed to delete rule"); }
  }

  function openAddRule() {
    setEditMode("add");
    setRuleForm({ name: "", condition: "", carrier: "", active: true });
    setShowRuleModal(true);
  }

  function openEditRule(r: CarrierRule) {
    setEditMode("edit");
    setEditingId(r._id);
    setRuleForm({ name: r.name, condition: r.condition, carrier: r.carrier, active: r.active });
    setShowRuleModal(true);
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
        <PrimaryButton icon={Plus} onClick={() => {
          if (view === "carriers") {
            setEditMode("add");
            setForm({ name: "", type: "international", account: "", status: "active", on_time: 90, cost_avg: 8.0, regions: "US,EU" });
            setShowAdd(true);
          } else {
            openAddRule();
          }
        }}>
          {view === "carriers" ? t.carriers.addCarrier : t.common.new}
        </PrimaryButton>
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
                <button onClick={() => openEditCarrier(carrier)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
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
                  <button onClick={() => openEditRule(rule)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
                  <button onClick={() => handleDeleteRule(rule._id)} className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Carrier Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editMode === "add" ? t.carriers.addCarrier : "Edit Carrier"} subtitle="Connect a shipping carrier" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleSaveCarrier}>{editMode === "add" ? t.carriers.addCarrier : "Save Changes"}</ModalSubmit></>}>
        <Row>
          <Field label={t.carriers.carrierName} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="FedEx, DHL…" /></Field>
          <Field label={t.common.type}><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="international">International</option><option value="domestic">Domestic</option><option value="regional">Regional</option>
          </Select></Field>
        </Row>
        <Row>
          <Field label={t.carriers.accountNo} required><Input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="ACC-XXXXXX" /></Field>
          <Field label={t.common.status}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </Select></Field>
        </Row>
        <Row>
          <Field label={t.carriers.avgCost}><Input type="number" step="0.1" value={form.cost_avg} onChange={(e) => setForm({ ...form, cost_avg: Number(e.target.value) })} /></Field>
          <Field label={t.carriers.onTimeRate}><Input type="number" value={form.on_time} onChange={(e) => setForm({ ...form, on_time: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.carriers.regions} hint={t.carriers.regionsHint}><Input value={form.regions} onChange={(e) => setForm({ ...form, regions: e.target.value })} placeholder="US, EU" /></Field>
      </Modal>

      {/* Rule Modal */}
      <Modal open={showRuleModal} onClose={() => setShowRuleModal(false)} title={editMode === "add" ? "Add Rule" : "Edit Rule"} subtitle="Automate carrier assignment" footer={<><ModalCancel onClose={() => setShowRuleModal(false)} /><ModalSubmit onClick={handleSaveRule}>{editMode === "add" ? "Create Rule" : "Save Changes"}</ModalSubmit></>}>
        <Field label="Rule Name" required><Input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="e.g., Heavy items to UPS" /></Field>
        <Field label="Condition" required><Input value={ruleForm.condition} onChange={(e) => setRuleForm({ ...ruleForm, condition: e.target.value })} placeholder="e.g., Weight > 50 lbs" /></Field>
        <Row>
          <Field label="Assigned Carrier"><Input value={ruleForm.carrier} onChange={(e) => setRuleForm({ ...ruleForm, carrier: e.target.value })} placeholder="e.g., UPS Ground" /></Field>
          <Field label="Active Status"><Select value={ruleForm.active ? "true" : "false"} onChange={(e) => setRuleForm({ ...ruleForm, active: e.target.value === "true" })}>
            <option value="true">Active</option><option value="false">Inactive</option>
          </Select></Field>
        </Row>
      </Modal>
    </div>
  );
}
