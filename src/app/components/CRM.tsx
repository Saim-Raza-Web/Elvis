import { useState } from "react";
import { Users, Search, Plus, Mail, Phone, ShoppingCart, Star, MessageCircle, Calendar, ArrowRight, TrendingUp, Edit3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { crmService } from "../../services/crm.service";
import { leadsService } from "../../services/leads.service";

type Customer = { _id: string; id: string; name: string; contact: string; email: string; phone: string; country: string; orders: number; total_spend: number; status: string; tier: string; last_activity: string };
type Lead = { _id: string; id: string; name: string; contact: string; email: string; value: number; stage: string; probability: number; assignee: string; last_contact: string };

const pipeline = ["contacted", "qualified", "demo", "proposal", "negotiation", "closed"];

const stageColor: Record<string, string> = {
  contacted: "bg-secondary text-muted-foreground",
  qualified: "bg-info/15 text-info",
  demo: "bg-primary/15 text-primary",
  proposal: "bg-amber-500/15 text-amber-500",
  negotiation: "bg-warning/15 text-warning",
  closed: "bg-success/15 text-success",
};

const tierColors: Record<string, string> = {
  bronze: "text-amber-700 bg-amber-100 dark:bg-amber-900/20",
  silver: "text-slate-500 bg-slate-100 dark:bg-slate-800/40",
  gold: "text-amber-500 bg-amber-50 dark:bg-amber-900/20",
  platinum: "text-purple-500 bg-purple-50 dark:bg-purple-900/20",
};

export function CRM() {
  const { t } = useLang();
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [leadList, setLeadList] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"customers" | "leads" | "pipeline">("customers");
  
  const [showAdd, setShowAdd] = useState(false);
  const [editMode, setEditMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", contact: "", email: "", phone: "", country: "US", tier: "bronze" });

  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const [custData, leadData] = await Promise.all([crmService.getAll(), leadsService.getAll()]);
      setCustomerList(custData.map((d: any) => ({ ...d, id: d._id, orders: d.orders || 0, total_spend: d.total_spend || 0, last_activity: d.last_activity?.slice(0, 10) || "—" })));
      setLeadList(leadData.map((d: any) => ({ ...d, id: d.leadId || d._id, value: d.value || 0, probability: d.probability || 0, last_contact: d.last_contact?.slice(0, 10) || "—" })));
    } catch (err) {
      toast.error("Failed to load CRM data");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm({ name: "", contact: "", email: "", phone: "", country: "US", tier: "bronze" }); setEditMode("add"); setShowAdd(true); };
    window.addEventListener("open-add-customer", handler);
    return () => window.removeEventListener("open-add-customer", handler);
  }, []);

  async function handleSave() {
    if (!form.name || !form.email) { toast.error("Company name and email required."); return; }
    try {
      if (editMode === "add") {
        if (view === "leads" || view === "pipeline") {
          await leadsService.create({ name: form.name, contact: form.contact, email: form.email, value: 0, stage: "contacted", probability: 20, assignee: "Admin", last_contact: new Date().toISOString().slice(0, 10) });
          toast.success(t.crm.leadAdded.replace("{name}", form.name));
        } else {
          await crmService.create({ name: form.name, contact: form.contact, email: form.email, phone: form.phone, country: form.country, orders: 0, total_spend: 0, status: "active", tier: form.tier, last_activity: new Date().toISOString().slice(0, 10) });
          toast.success(t.crm.customerAdded.replace("{name}", form.name));
        }
      } else {
        if (view === "leads" || view === "pipeline") {
          await leadsService.update(editingId!, { name: form.name, contact: form.contact, email: form.email });
          toast.success("Lead updated.");
        } else {
          await crmService.update(editingId!, { name: form.name, contact: form.contact, email: form.email, phone: form.phone, country: form.country, tier: form.tier });
          toast.success("Customer updated.");
        }
      }
      setShowAdd(false);
      loadData();
    } catch (err) { toast.error("Failed to save record"); }
  }

  async function handleDeleteCustomer(id: string) {
    if (!confirm("Delete customer?")) return;
    try {
      await crmService.delete(id);
      toast.success("Customer deleted.");
      loadData();
    } catch (err) { toast.error("Failed to delete customer"); }
  }

  async function handleDeleteLead(id: string) {
    if (!confirm("Delete lead?")) return;
    try {
      await leadsService.delete(id);
      toast.success("Lead deleted.");
      loadData();
    } catch (err) { toast.error("Failed to delete lead"); }
  }

  function openEditCustomer(c: Customer) {
    setEditMode("edit");
    setEditingId(c._id);
    setForm({ name: c.name, contact: c.contact, email: c.email, phone: c.phone, country: c.country, tier: c.tier });
    setShowAdd(true);
  }

  function openEditLead(l: Lead) {
    setEditMode("edit");
    setEditingId(l._id);
    setForm({ name: l.name, contact: l.contact, email: l.email, phone: "", country: "US", tier: "bronze" });
    setShowAdd(true);
  }

  function openAddModal() {
    setEditMode("add");
    setForm({ name: "", contact: "", email: "", phone: "", country: "US", tier: "bronze" });
    setShowAdd(true);
  }

  async function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    if (!draggedLead || draggedLead.stage === stage) return;
    try {
      await leadsService.update(draggedLead._id, { stage });
      toast.success(`Lead moved to ${stage}`);
      loadData();
    } catch (err) { toast.error("Failed to move lead"); }
    setDraggedLead(null);
  }

  const filteredCustomers = customerList.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.contact.toLowerCase().includes(search.toLowerCase())
  );

  const filteredLeads = leadList.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase()) || l.contact.toLowerCase().includes(search.toLowerCase())
  );

  const pipelineValue = leadList.reduce((a, l) => a + l.value * (l.probability / 100), 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.crm.totalCustomers, value: customerList.length, icon: Users, color: "text-primary" },
          { label: t.crm.activeLeads, value: leadList.length, icon: TrendingUp, color: "text-success" },
          { label: t.crm.totalOrders, value: customerList.reduce((a, c) => a + c.orders, 0), icon: ShoppingCart, color: "text-blue-500" },
          { label: t.crm.pipelineValue, value: `€${(pipelineValue / 1000).toFixed(0)}k`, icon: Star, color: "text-amber-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* View tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {[
            { id: "customers", label: t.crm.customers },
            { id: "leads", label: t.crm.leads },
            { id: "pipeline", label: t.crm.pipeline },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setView(tab.id as any)} className={`px-4 py-2 text-sm font-semibold transition-colors ${view === tab.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{tab.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.common.search + "…"} className="pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors w-48" style={{ fontSize: "0.875rem" }} />
          </div>
          <PrimaryButton icon={Plus} onClick={openAddModal}>{view === "leads" || view === "pipeline" ? t.crm.addLead : t.crm.addCustomer}</PrimaryButton>
        </div>
      </div>

      {view === "customers" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCustomers.map((c, i) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-bold text-primary-foreground">{c.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.contact}</div>
                  </div>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${tierColors[c.tier]}`}>{c.tier}</span>
              </div>
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Mail className="size-3" />{c.email}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Phone className="size-3" />{c.phone}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Calendar className="size-3" />{t.crm.lastActivity}: {c.last_activity}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-3">
                <div className="text-center"><div className="text-muted-foreground">{t.crm.totalOrders}</div><div className="font-bold mt-0.5">{c.orders}</div></div>
                <div className="text-center"><div className="text-muted-foreground">{t.crm.spend}</div><div className="font-bold mt-0.5">€{(c.total_spend / 1000).toFixed(0)}k</div></div>
                <div className="text-center"><div className="text-muted-foreground">{t.common.status}</div><div className="mt-0.5"><StatusBadge status={c.status} /></div></div>
              </div>
              <div className="flex items-center justify-end gap-1 mt-3">
                <button onClick={() => openEditCustomer(c)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
                <button onClick={() => handleDeleteCustomer(c._id)} className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"><Trash2 className="size-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "leads" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-4 py-3">{t.common.company}</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">{t.crm.contact}</th>
                <th className="text-center px-4 py-3">{t.crm.stage}</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">{t.crm.leadValue}</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">{t.crm.probability}</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">{t.crm.assignee}</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((l, i) => (
                <tr key={l.id} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                  <td className="px-4 py-3 font-semibold">{l.name}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{l.contact}</td>
                  <td className="px-4 py-3 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${stageColor[l.stage]}`}>{(t.crm.stages as Record<string, string>)[l.stage] ?? l.stage}</span></td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{l.value.toLocaleString()}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${l.probability}%` }} /></div>
                      <span className="text-xs text-muted-foreground">{l.probability}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{l.assignee}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEditLead(l)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><Edit3 className="size-3.5" /></button>
                      <button onClick={() => handleDeleteLead(l._id)} className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "pipeline" && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {pipeline.map((stage) => {
              const stageLeads = leadList.filter((l) => l.stage === stage);
              const stageValue = stageLeads.reduce((a, l) => a + l.value, 0);
              return (
                <div 
                  key={stage} 
                  className="w-64"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, stage)}
                >
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full capitalize ${stageColor[stage]}`}>{(t.crm.stages as Record<string, string>)[stage] ?? stage}</span>
                    <span className="text-xs text-muted-foreground">€{(stageValue / 1000).toFixed(0)}k</span>
                  </div>
                  <div className="space-y-2 min-h-24 p-1 rounded-xl bg-secondary/10">
                    {stageLeads.map((l) => (
                      <div 
                        key={l.id} 
                        className="bg-card border border-border rounded-xl p-3 hover-lift cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => {
                          setDraggedLead(l);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <div className="font-semibold text-sm mb-0.5">{l.name}</div>
                        <div className="text-xs text-muted-foreground mb-2">{l.contact}</div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{l.value.toLocaleString()}</span>
                          <span className="text-[10px] text-muted-foreground">{l.probability}%</span>
                        </div>
                      </div>
                    ))}
                    {stageLeads.length === 0 && (
                      <div className="border-2 border-dashed border-border rounded-xl p-4 text-center text-xs text-muted-foreground">{t.common.noData}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editMode === "add" ? (view === "leads" || view === "pipeline" ? t.crm.addLead : t.crm.addCustomer) : "Edit Record"} footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleSave}>{editMode === "add" ? (view === "leads" || view === "pipeline" ? t.crm.addLead : t.crm.addCustomer) : "Save Changes"}</ModalSubmit></>}>
        <Row>
          <Field label={t.common.company} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company Inc." /></Field>
          <Field label={t.crm.contact}><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Full name" /></Field>
        </Row>
        <Row>
          <Field label={t.common.email} required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@company.com" /></Field>
          {(view === "customers") && <Field label={t.common.phone}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" /></Field>}
        </Row>
        {(view === "customers") && (
          <Row>
            <Field label={t.crm.country}><Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              {["US","DE","FR","ES","IT","GB","NL","SE","PT","BR"].map((c) => <option key={c}>{c}</option>)}
            </Select></Field>
            <Field label={t.crm.tier}><Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
              <option value="bronze">Bronze</option><option value="silver">Silver</option><option value="gold">Gold</option><option value="platinum">Platinum</option>
            </Select></Field>
          </Row>
        )}
      </Modal>
    </div>
  );
}
