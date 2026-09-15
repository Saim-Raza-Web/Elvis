import { useState, useEffect, useCallback } from "react";
import { Shield, Plus, Edit3, AlertTriangle, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { storageRulesService } from "../../services/storage_rules.service";
import { warehousesService } from "../../services/warehouses.service";

// ── Types ─────────────────────────────────────────────────────────────────────

type Condition = { field: string; operator: string; value: any };

type StorageRule = {
  _id: string;
  code: string;
  name: string;
  description?: string;
  priority: number;
  ruleType: "PUTAWAY" | "PICKING";
  isDefault: boolean;
  isActive: boolean;
  conditions: Condition[];
  action: string;
  strategy?: string;
  targetZone?: any;
};

type Warehouse = { _id: string; code: string; name: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const CONDITION_FIELD_LABELS: Record<string, string> = {
  product_category: "Product Category",
  owner: "Owner (3PL Client)",
  temperature: "Temperature Req.",
  sku: "SKU",
  pallet_weight: "Pallet Weight (kg)",
  abc_class: "ABC Class",
  has_lot_expiry: "Has Lot Expiry",
  supplier: "Supplier",
  pallet_type: "Pallet Type",
  qc_status: "QC Status",
  hazmat_class: "Hazmat Class",
  is_crossdock: "Is Cross-Dock",
};

const OPERATOR_LABELS: Record<string, string> = {
  is: "=",
  is_not: "\u2260",
  in_list: "in",
  not_in_list: "not in",
  greater_than: ">",
  less_than: "<",
  between: "between",
  yes: "= YES",
  no: "= NO",
};

const ACTION_LABELS: Record<string, string> = {
  send_to_zone: "Send to Zone",
  send_to_zone_reserve_only: "Reserve Zone Only",
  send_to_pick_face: "Send to Pick Face",
  send_to_aisle: "Send to Aisle",
  consolidate: "Consolidate",
  fixed_location: "Fixed Location",
  manual_assignment: "Manual Assignment",
  send_to_quarantine: "Send to Quarantine",
  cross_dock: "Cross-Dock",
  pick_from_zone: "Pick from Zone",
  pick_from_location: "Pick from Location",
  pick_fefo: "Pick FEFO",
  pick_fifo: "Pick FIFO",
  pick_lifo: "Pick LIFO",
};

const CONDITION_FIELDS = Object.keys(CONDITION_FIELD_LABELS);
const OPERATORS = Object.keys(OPERATOR_LABELS);
const ACTIONS = Object.keys(ACTION_LABELS);
const STRATEGIES = ["FIFO","FEFO","LIFO","FPFO","Nearest","Consolidate","Fill_first","Spread","Manual"];
const CANONICAL_CODES = ["CRIT-01","CRIT-02","CRIT-03","CRIT-04","CRIT-05","HL-01","HL-02","HL-03","HL-04","HL-05","DEFAULT"];

// ── Condition Badge ───────────────────────────────────────────────────────────

function ConditionBadge({ cond }: { cond: Condition }) {
  const fieldLabel = CONDITION_FIELD_LABELS[cond.field] || cond.field;
  const opLabel = OPERATOR_LABELS[cond.operator] || cond.operator;
  const valLabel = Array.isArray(cond.value) ? cond.value.join(", ") : String(cond.value ?? "");
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-secondary border border-border whitespace-nowrap">
      <span className="text-muted-foreground">{fieldLabel}</span>
      <span className="text-primary font-bold">{opLabel}</span>
      {opLabel !== "= YES" && opLabel !== "= NO" && <span className="text-amber-400">{valLabel}</span>}
    </span>
  );
}

// ── Rule Card ─────────────────────────────────────────────────────────────────

function RuleCard({ rule, onEdit, onDelete, onToggle }: {
  rule: StorageRule;
  onEdit: (r: StorageRule) => void;
  onDelete: (r: StorageRule) => void;
  onToggle: (r: StorageRule) => void;
}) {
  const isCanonical = rule.isDefault || CANONICAL_CODES.includes(rule.code);
  const pc =
    rule.priority <= 2 ? "text-red-400 bg-red-500/10 border-red-500/30" :
    rule.priority <= 5 ? "text-amber-400 bg-amber-500/10 border-amber-500/30" :
    rule.priority <= 10 ? "text-blue-400 bg-blue-500/10 border-blue-500/30" :
    "text-muted-foreground bg-secondary border-border";

  return (
    <div className={`rounded-xl border bg-card hover-lift transition-all ${rule.isActive ? "border-border" : "border-border/40 opacity-60"}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`flex-none text-[11px] font-bold px-2 py-0.5 rounded border ${pc}`}>P{rule.priority}</span>
            {isCanonical && (
              <span className="flex-none text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">CANONICAL</span>
            )}
            <span className="font-bold text-sm text-foreground truncate">{rule.name}</span>
            <span className="flex-none text-[10px] font-mono text-muted-foreground">[{rule.code}]</span>
          </div>
          <div className="flex items-center gap-1 flex-none">
            <button onClick={() => onToggle(rule)} title={rule.isActive ? "Deactivate" : "Activate"}
              className={`p-1.5 rounded-lg transition-colors ${rule.isActive ? "text-success hover:bg-success/10" : "text-muted-foreground hover:bg-secondary"}`}>
              {rule.isActive ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            </button>
            <button onClick={() => onEdit(rule)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
              <Edit3 className="size-3.5" />
            </button>
            {!isCanonical && (
              <button onClick={() => onDelete(rule)} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                <AlertTriangle className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {rule.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{rule.description}</p>}

        <div className="flex flex-wrap gap-1 mb-2">
          {rule.conditions.length === 0
            ? <span className="text-[11px] text-muted-foreground italic">No conditions (catch-all / DEFAULT)</span>
            : rule.conditions.map((c, i) => <ConditionBadge key={i} cond={c} />)
          }
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Action:</span>
            <span className="font-bold text-primary">{ACTION_LABELS[rule.action] || rule.action}</span>
          </div>
          {rule.strategy && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Strategy:</span>
              <span className="font-semibold text-foreground">{rule.strategy}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Type:</span>
            <span className={`font-semibold ${rule.ruleType === "PICKING" ? "text-amber-400" : "text-blue-400"}`}>{rule.ruleType}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rule Form Modal ───────────────────────────────────────────────────────────

const emptyCondition = (): Condition => ({ field: "product_category", operator: "is", value: "" });

function RuleFormModal({ initial, onSave, onClose }: {
  initial?: StorageRule | null;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [priority, setPriority] = useState(initial?.priority ?? 50);
  const [ruleType, setRuleType] = useState<"PUTAWAY"|"PICKING">(initial?.ruleType || "PUTAWAY");
  const [action, setAction] = useState(initial?.action || "send_to_zone");
  const [strategy, setStrategy] = useState(initial?.strategy || "Nearest");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [conditions, setConditions] = useState<Condition[]>(
    initial?.conditions?.length ? initial.conditions : [emptyCondition()]
  );
  const [saving, setSaving] = useState(false);

  const addCondition = () => setConditions(c => [...c, emptyCondition()]);
  const removeCondition = (i: number) => setConditions(c => c.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, key: keyof Condition, val: any) =>
    setConditions(c => c.map((cond, idx) => idx === i ? { ...cond, [key]: val } : cond));

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Rule name is required"); return; }
    setSaving(true);
    try {
      const cleanConds = conditions.filter(c => c.field && c.operator).map(c => ({
        field: c.field, operator: c.operator,
        value: c.operator === "yes" || c.operator === "no" ? true : c.value,
      }));
      await onSave({ name, description, priority: Number(priority), ruleType, action, strategy, isActive, conditions: cleanConds });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold">{initial ? "Edit Storage Rule" : "New Storage Rule"}</h3>
            <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg transition-colors">
              <XCircle className="size-5 text-muted-foreground" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Rule Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cold Chain Isolation"
                  className="w-full mt-1 px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Priority (1=high)</label>
                <input type="number" min={1} max={999} value={priority} onChange={e => setPriority(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary" />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase text-muted-foreground">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description"
                className="w-full mt-1 px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Rule Type</label>
                <select value={ruleType} onChange={e => setRuleType(e.target.value as any)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary">
                  <option value="PUTAWAY">PUTAWAY</option>
                  <option value="PICKING">PICKING</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Action *</label>
                <select value={action} onChange={e => setAction(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary">
                  {ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Strategy</label>
                <select value={strategy} onChange={e => setStrategy(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary">
                  {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 accent-primary" />
                  <span className="text-sm font-semibold">Active</span>
                </label>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-bold uppercase text-muted-foreground">IF Conditions (AND logic)</label>
                <button onClick={addCondition}
                  className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
                  <Plus className="size-3" /> Add Condition
                </button>
              </div>
              {conditions.length === 0 && (
                <p className="text-xs text-muted-foreground italic px-3 py-2 bg-secondary/30 rounded-lg">
                  No conditions = catch-all (used for DEFAULT fallback rules)
                </p>
              )}
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-2 mt-1.5">
                  <select value={cond.field} onChange={e => updateCondition(i, "field", e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary">
                    {CONDITION_FIELDS.map(f => <option key={f} value={f}>{CONDITION_FIELD_LABELS[f]}</option>)}
                  </select>
                  <select value={cond.operator} onChange={e => updateCondition(i, "operator", e.target.value)}
                    className="w-28 px-2 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary">
                    {OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                  </select>
                  {cond.operator !== "yes" && cond.operator !== "no" && (
                    <input value={Array.isArray(cond.value) ? cond.value.join(",") : (cond.value ?? "")}
                      onChange={e => updateCondition(i, "value", e.target.value)}
                      placeholder="value"
                      className="flex-1 px-2 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg outline-none focus:border-primary" />
                  )}
                  <button onClick={() => removeCondition(i)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                    <XCircle className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-secondary hover:bg-secondary/80 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 text-sm font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saving ? "Saving\u2026" : initial ? "Update Rule" : "Create Rule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StorageRulesManager ───────────────────────────────────────────────────────

interface StorageRulesManagerProps {
  isAdmin?: boolean;
  compact?: boolean;
}

export function StorageRulesManager({ isAdmin = false, compact = false }: StorageRulesManagerProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [rules, setRules] = useState<StorageRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [filterType, setFilterType] = useState<"ALL"|"PUTAWAY"|"PICKING">("ALL");
  const [editTarget, setEditTarget] = useState<StorageRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StorageRule | null>(null);

  useEffect(() => {
    warehousesService.getAll().then((whs: any) => {
      const list = Array.isArray(whs) ? whs : (whs?.data || []);
      setWarehouses(list);
      if (list.length > 0) setSelectedWarehouse(list[0].code);
    }).catch(() => {});
  }, []);

  const loadRules = useCallback(async () => {
    if (!selectedWarehouse) { setRules([]); return; }
    setLoading(true);
    try {
      const data = await storageRulesService.getAll({ warehouse: selectedWarehouse }) as StorageRule[];
      setRules(Array.isArray(data) ? data : []);
    } catch { toast.error("Failed to load storage rules"); setRules([]); }
    finally { setLoading(false); }
  }, [selectedWarehouse]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const filteredRules = rules
    .filter(r => filterType === "ALL" || r.ruleType === filterType)
    .sort((a, b) => a.priority - b.priority);

  const handleSeedCanonical = async () => {
    if (!selectedWarehouse) { toast.error("Select a warehouse first"); return; }
    setSeeding(true);
    try {
      const result = await storageRulesService.seedCanonical(selectedWarehouse);
      toast.success(`Seeded: ${result.created ?? 0} created, ${result.updated ?? 0} updated, ${result.skipped ?? 0} preserved`);
      loadRules();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Seeding failed");
    } finally { setSeeding(false); }
  };

  const handleCreate = async (data: any) => {
    try {
      await storageRulesService.create({ ...data, warehouse: selectedWarehouse });
      toast.success("Rule created");
      setShowCreate(false);
      loadRules();
    } catch (err: any) { toast.error(err.response?.data?.message || err.message || "Failed to create rule"); }
  };

  const handleUpdate = async (data: any) => {
    if (!editTarget) return;
    try {
      await storageRulesService.update(editTarget._id, data);
      toast.success("Rule updated");
      setEditTarget(null);
      loadRules();
    } catch (err: any) { toast.error(err.response?.data?.message || err.message || "Failed to update rule"); }
  };

  const handleToggle = async (rule: StorageRule) => {
    try {
      await storageRulesService.update(rule._id, { isActive: !rule.isActive });
      toast.success(rule.isActive ? "Rule deactivated" : "Rule activated");
      loadRules();
    } catch (err: any) { toast.error(err.response?.data?.message || err.message || "Toggle failed"); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await storageRulesService.delete(deleteTarget._id);
      toast.success(`Rule "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      loadRules();
    } catch (err: any) { toast.error(err.response?.data?.message || err.message || "Delete failed"); }
  };

  const canonicalCount = rules.filter(r => r.isDefault || CANONICAL_CODES.includes(r.code)).length;
  const activeCount = rules.filter(r => r.isActive).length;

  return (
    <div className="space-y-5">
      {/* Stats (hidden in compact mode) */}
      {!compact && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Rules", value: rules.length, color: "text-primary" },
            { label: "Active", value: activeCount, color: "text-success" },
            { label: "Canonical", value: canonicalCount, color: "text-blue-400" },
            { label: "Custom", value: rules.length - canonicalCount, color: "text-amber-400" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {warehouses.map(wh => (
            <button key={wh.code} onClick={() => setSelectedWarehouse(wh.code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedWarehouse === wh.code ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"
              }`}>
              {wh.code}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-border overflow-hidden">
          {(["ALL", "PUTAWAY", "PICKING"] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {isAdmin && (
          <button onClick={handleSeedCanonical} disabled={seeding || !selectedWarehouse}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-blue-600/90 hover:bg-blue-600 text-white transition-colors disabled:opacity-50">
            <RotateCcw className={`size-3.5 ${seeding ? "animate-spin" : ""}`} />
            {seeding ? "Seeding\u2026" : "Seed Canonical Rules"}
          </button>
        )}

        {selectedWarehouse && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="size-3.5" /> Add Rule
          </button>
        )}
      </div>

      {/* Empty / loading / list */}
      {!selectedWarehouse && (
        <div className="p-12 text-center bg-card rounded-xl border border-border">
          <Shield className="size-10 mx-auto text-muted-foreground opacity-40 mb-3" />
          <p className="font-bold mb-1">Select a warehouse</p>
          <p className="text-xs text-muted-foreground">Storage rules are warehouse-scoped.</p>
        </div>
      )}

      {selectedWarehouse && loading && (
        <div className="p-8 text-center text-muted-foreground text-sm animate-pulse">Loading rules\u2026</div>
      )}

      {selectedWarehouse && !loading && filteredRules.length === 0 && (
        <div className="p-12 text-center bg-card rounded-xl border border-border space-y-3">
          <Shield className="size-10 mx-auto text-muted-foreground opacity-40" />
          <p className="font-bold">No {filterType !== "ALL" ? filterType + " " : ""}storage rules configured</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Storage rules govern putaway location assignment.
            {isAdmin && " Use \u201cSeed Canonical Rules\u201d to initialize the 11 standard warehouse rules."}
          </p>
          {isAdmin && (
            <button onClick={handleSeedCanonical} disabled={seeding}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
              <RotateCcw className={`size-4 ${seeding ? "animate-spin" : ""}`} />
              {seeding ? "Seeding\u2026" : "Initialize 11 Canonical Rules"}
            </button>
          )}
        </div>
      )}

      {selectedWarehouse && !loading && filteredRules.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filteredRules.map((rule, i) => (
            <div key={rule._id} className="animate-pop-in" style={{ animationDelay: `${i * 30}ms` }}>
              <RuleCard rule={rule} onEdit={setEditTarget}
                onDelete={r => setDeleteTarget(r)} onToggle={handleToggle} />
            </div>
          ))}
        </div>
      )}

      {showCreate && <RuleFormModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {editTarget && <RuleFormModal initial={editTarget} onSave={handleUpdate} onClose={() => setEditTarget(null)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-bold mb-2">Delete Rule</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Delete <strong>"{deleteTarget.name}"</strong>? This cannot be undone.
              {(deleteTarget.isDefault || CANONICAL_CODES.includes(deleteTarget.code)) && (
                <span className="block mt-2 text-amber-400 text-xs font-bold">
                  \u26a0 Canonical rule. Re-seed to restore.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded-lg bg-secondary">Cancel</button>
              <button onClick={handleDelete} className="px-4 py-2 text-sm font-bold rounded-lg bg-destructive text-destructive-foreground">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
