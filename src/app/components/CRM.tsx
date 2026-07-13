import { useState } from "react";
import { Users, Search, Plus, Mail, Phone, ShoppingCart, Star, MessageCircle, Calendar, ArrowRight, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const customers = [
  { id: "1", name: "Apex Industries", contact: "David Chen", email: "d.chen@apex.io", phone: "+1 305 555 0101", country: "US", orders: 28, total_spend: 42100, status: "active", tier: "gold", last_activity: "2026-06-26" },
  { id: "2", name: "Blue Horizon LLC", contact: "Sarah Kim", email: "sk@bluehorizon.com", phone: "+1 213 555 0234", country: "US", orders: 14, total_spend: 18750, status: "active", tier: "silver", last_activity: "2026-06-25" },
  { id: "3", name: "Nova Retail Group", contact: "Marco Rossi", email: "m.rossi@novaretail.com", phone: "+39 02 555 0345", country: "IT", orders: 42, total_spend: 87300, status: "active", tier: "platinum", last_activity: "2026-06-24" },
  { id: "4", name: "Summit Supply Co.", contact: "Emily Walsh", email: "e.walsh@summit.co", phone: "+1 312 555 0456", country: "US", orders: 7, total_spend: 9200, status: "active", tier: "bronze", last_activity: "2026-06-20" },
  { id: "5", name: "Crestline Corp", contact: "Raj Patel", email: "rpatel@crestline.corp", phone: "+1 469 555 0567", country: "US", orders: 19, total_spend: 31400, status: "active", tier: "silver", last_activity: "2026-06-23" },
  { id: "6", name: "Pacific Goods Inc.", contact: "Amara Lee", email: "a.lee@pacific.biz", phone: "+1 206 555 0678", country: "US", orders: 3, total_spend: 1200, status: "inactive", tier: "bronze", last_activity: "2026-05-10" },
  { id: "7", name: "TechFlow Systems", contact: "Chris Roberts", email: "c.roberts@techflow.com", phone: "+1 503 555 0789", country: "US", orders: 31, total_spend: 56700, status: "active", tier: "gold", last_activity: "2026-06-22" },
  { id: "8", name: "EastCoast Supplies", contact: "Diana Prince", email: "dp@eastcoast.com", phone: "+1 617 555 0890", country: "US", orders: 22, total_spend: 38900, status: "active", tier: "silver", last_activity: "2026-06-26" },
];

const leads = [
  { id: "L001", name: "Meridian Logistics", contact: "Tom Baker", email: "t.baker@meridian.com", value: 18000, stage: "demo", probability: 60, assignee: "Sarah K.", last_contact: "2026-06-25" },
  { id: "L002", name: "Nordic Freight AB", contact: "Ingrid Larsson", email: "i.larsson@nordic.se", value: 45000, stage: "proposal", probability: 75, assignee: "Admin", last_contact: "2026-06-24" },
  { id: "L003", name: "Iberia Trade SL", contact: "Carlos Ruiz", email: "c.ruiz@iberiatrade.es", value: 22000, stage: "contacted", probability: 30, assignee: "Admin", last_contact: "2026-06-22" },
  { id: "L004", name: "Sunrise Retail", contact: "Amy Chen", email: "amy@sunrise.com", value: 9500, stage: "qualified", probability: 45, assignee: "Sarah K.", last_contact: "2026-06-20" },
  { id: "L005", name: "Alpine Supplies GmbH", contact: "Klaus Müller", email: "k.muller@alpine.de", value: 67000, stage: "negotiation", probability: 80, assignee: "Admin", last_contact: "2026-06-26" },
];

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
  const [customerList, setCustomerList] = useState(customers);
  const [leadList, setLeadList] = useState(leads);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"customers" | "leads" | "pipeline">("customers");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", email: "", phone: "", country: "US", tier: "bronze" as string });

  function handleAdd() {
    if (!form.name || !form.email) { toast.error("Company name and email required."); return; }
    if (view === "leads") {
      setLeadList((prev) => [...prev, { id: `L${String(prev.length + 6).padStart(3, "0")}`, name: form.name, contact: form.contact, email: form.email, value: 0, stage: "contacted", probability: 20, assignee: "Admin", last_contact: new Date().toISOString().slice(0, 10) }]);
      toast.success(t.crm.leadAdded.replace("{name}", form.name));
    } else {
      setCustomerList((prev) => [...prev, { id: String(Date.now()), name: form.name, contact: form.contact, email: form.email, phone: form.phone, country: form.country, orders: 0, total_spend: 0, status: "active", tier: form.tier, last_activity: new Date().toISOString().slice(0, 10) }]);
      toast.success(t.crm.customerAdded.replace("{name}", form.name));
    }
    setShowAdd(false);
    setForm({ name: "", contact: "", email: "", phone: "", country: "US", tier: "bronze" });
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
          <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>{view === "leads" ? t.crm.addLead : t.crm.addCustomer}</PrimaryButton>
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
                      <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><MessageCircle className="size-3.5" /></button>
                      <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"><ArrowRight className="size-3.5" /></button>
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
                <div key={stage} className="w-64">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full capitalize ${stageColor[stage]}`}>{(t.crm.stages as Record<string, string>)[stage] ?? stage}</span>
                    <span className="text-xs text-muted-foreground">€{(stageValue / 1000).toFixed(0)}k</span>
                  </div>
                  <div className="space-y-2">
                    {stageLeads.map((l) => (
                      <div key={l.id} className="bg-card border border-border rounded-xl p-3 hover-lift cursor-pointer">
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

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={view === "leads" ? t.crm.addLead : t.crm.addCustomer} footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleAdd}>{view === "leads" ? t.crm.addLead : t.crm.addCustomer}</ModalSubmit></>}>
        <Row>
          <Field label={t.common.company} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company Inc." /></Field>
          <Field label={t.crm.contact}><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Full name" /></Field>
        </Row>
        <Row>
          <Field label={t.common.email} required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@company.com" /></Field>
          <Field label={t.common.phone}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" /></Field>
        </Row>
        <Row>
          <Field label={t.crm.country}><Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            {["US","DE","FR","ES","IT","GB","NL","SE","PT","BR"].map((c) => <option key={c}>{c}</option>)}
          </Select></Field>
          {view !== "leads" && <Field label={t.crm.tier}><Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
            <option value="bronze">Bronze</option><option value="silver">Silver</option><option value="gold">Gold</option><option value="platinum">Platinum</option>
          </Select></Field>}
        </Row>
      </Modal>
    </div>
  );
}
