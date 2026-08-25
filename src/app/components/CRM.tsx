import { useState, useEffect, useMemo } from "react";
import { Users, Search, Plus, Mail, Phone, ShoppingCart, Star, Calendar, TrendingUp, Edit3, Trash2, Building2, MapPin, CreditCard, FileText } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import { crmService, Customer, CustomerAddress } from "../../services/crm.service";
import { leadsService } from "../../services/leads.service";

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

function mapCustomer(d: any): Customer {
  return {
    ...d,
    id: d._id,
    orders: d.orders || 0,
    total_spend: d.total_spend || 0,
    last_activity: d.last_activity?.slice(0, 10) || "—",
    active: d.active !== false,
    billingAddress: d.billingAddress || {},
    shippingAddress: d.shippingAddress || {}
  };
}

function mapLead(d: any): Lead {
  return { ...d, id: d.leadId || d._id, value: d.value || 0, probability: d.probability || 0, last_contact: d.last_contact?.slice(0, 10) || "—" };
}

const defaultCustomerForm = () => ({
  name: "",
  contact: "",
  email: "",
  phone: "",
  vatNumber: "",
  country: "ES",
  paymentTerms: "Net 30",
  iban: "",
  bankInfo: "",
  tier: "bronze" as "bronze" | "silver" | "gold" | "platinum",
  notes: "",
  active: true,
  billingAddress: {
    street: "",
    number: "",
    city: "",
    postcode: "",
    region: "",
    country: "Spain"
  },
  shippingAddress: {
    street: "",
    number: "",
    city: "",
    postcode: "",
    region: "",
    country: "Spain"
  }
});

export function CRM() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"customers" | "leads" | "pipeline">("customers");
  
  const [showAdd, setShowAdd] = useState(false);
  const [editMode, setEditMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultCustomerForm());
  const [activeTab, setActiveTab] = useState<"general" | "billing" | "shipping" | "financial">("general");

  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);

  const searchLower = search.toLowerCase();

  const { items: customerItems, allItems: customerAllItems, pagination: customerPagination, page: customerPage, setPage: setCustomerPage, isLoading: customersLoading, reload: reloadCustomers } = usePaginatedList<any>(
    crmService,
    {
      apiParams: { search: searchLower || undefined },
      deps: [search],
    }
  );

  const { items: leadItems, allItems: leadAllItems, pagination: leadPagination, page: leadPage, setPage: setLeadPage, isLoading: leadsLoading, reload: reloadLeads } = usePaginatedList<any>(
    leadsService,
    {
      apiParams: { search: searchLower || undefined },
      deps: [search],
    }
  );

  const customers = useMemo(() => customerItems.map(mapCustomer), [customerItems]);
  const allCustomers = useMemo(() => customerAllItems.map(mapCustomer), [customerAllItems]);
  const leads = useMemo(() => leadItems.map(mapLead), [leadItems]);
  const allLeads = useMemo(() => leadAllItems.map(mapLead), [leadAllItems]);

  function reloadAll() {
    reloadCustomers();
    reloadLeads();
  }

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => {
      setForm(defaultCustomerForm());
      setEditMode("add");
      setActiveTab("general");
      setShowAdd(true);
    };
    window.addEventListener("open-add-customer", handler);
    return () => window.removeEventListener("open-add-customer", handler);
  }, []);

  async function handleSave() {
    if (!form.name || !form.email) {
      toast.error(t.common?.error || "Customer / Company name and email are required.");
      return;
    }

    try {
      if (editMode === "add") {
        if (view === "leads" || view === "pipeline") {
          await leadsService.create({
            name: form.name,
            contact: form.contact,
            email: form.email,
            value: 0,
            stage: "contacted",
            probability: 20,
            assignee: "Admin",
            last_contact: new Date().toISOString().slice(0, 10)
          });
          toast.success(t.crm.leadAdded.replace("{name}", form.name));
        } else {
          await crmService.create({
            name: form.name,
            contact: form.contact,
            email: form.email,
            phone: form.phone,
            vatNumber: form.vatNumber,
            country: form.country,
            paymentTerms: form.paymentTerms,
            iban: form.iban,
            bankInfo: form.bankInfo,
            tier: form.tier,
            notes: form.notes,
            active: form.active,
            status: form.active ? "active" : "inactive",
            billingAddress: form.billingAddress,
            shippingAddress: form.shippingAddress,
            orders: 0,
            total_spend: 0,
            last_activity: new Date().toISOString().slice(0, 10)
          });
          toast.success(t.crm.customerAdded.replace("{name}", form.name));
        }
      } else {
        if (view === "leads" || view === "pipeline") {
          await leadsService.update(editingId!, {
            name: form.name,
            contact: form.contact,
            email: form.email
          });
          toast.success(t.common?.operationSuccess || "Lead updated.");
        } else {
          await crmService.update(editingId!, {
            name: form.name,
            contact: form.contact,
            email: form.email,
            phone: form.phone,
            vatNumber: form.vatNumber,
            country: form.country,
            paymentTerms: form.paymentTerms,
            iban: form.iban,
            bankInfo: form.bankInfo,
            tier: form.tier,
            notes: form.notes,
            active: form.active,
            status: form.active ? "active" : "inactive",
            billingAddress: form.billingAddress,
            shippingAddress: form.shippingAddress
          });
          toast.success(t.common?.operationSuccess || "Customer updated.");
        }
      }
      setShowAdd(false);
      reloadAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t.common?.error || "Failed to save record");
    }
  }

  async function handleDeleteCustomer(id: string) {
    if (!confirm("Are you sure you want to delete this customer?")) return;
    try {
      await crmService.delete(id);
      toast.success(t.common?.operationSuccess || "Customer deleted.");
      reloadAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t.common?.error || "Failed to delete customer");
    }
  }

  async function handleDeleteLead(id: string) {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    try {
      await leadsService.delete(id);
      toast.success(t.common?.operationSuccess || "Lead deleted.");
      reloadAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t.common?.error || "Failed to delete lead");
    }
  }

  function openEditCustomer(c: Customer) {
    setEditMode("edit");
    setEditingId(c._id);
    setForm({
      name: c.name || "",
      contact: c.contact || "",
      email: c.email || "",
      phone: c.phone || "",
      vatNumber: c.vatNumber || "",
      country: c.country || "ES",
      paymentTerms: c.paymentTerms || "Net 30",
      iban: c.iban || "",
      bankInfo: c.bankInfo || "",
      tier: c.tier || "bronze",
      notes: c.notes || "",
      active: c.active !== false,
      billingAddress: {
        street: c.billingAddress?.street || "",
        number: c.billingAddress?.number || "",
        city: c.billingAddress?.city || "",
        postcode: c.billingAddress?.postcode || "",
        region: c.billingAddress?.region || "",
        country: c.billingAddress?.country || "Spain"
      },
      shippingAddress: {
        street: c.shippingAddress?.street || "",
        number: c.shippingAddress?.number || "",
        city: c.shippingAddress?.city || "",
        postcode: c.shippingAddress?.postcode || "",
        region: c.shippingAddress?.region || "",
        country: c.shippingAddress?.country || "Spain"
      }
    });
    setActiveTab("general");
    setShowAdd(true);
  }

  function openEditLead(l: Lead) {
    setEditMode("edit");
    setEditingId(l._id);
    setForm({
      ...defaultCustomerForm(),
      name: l.name,
      contact: l.contact,
      email: l.email
    });
    setShowAdd(true);
  }

  function openAddModal() {
    setEditMode("add");
    setEditingId(null);
    setForm(defaultCustomerForm());
    setActiveTab("general");
    setShowAdd(true);
  }

  async function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    if (!draggedLead || draggedLead.stage === stage) return;
    try {
      await leadsService.update(draggedLead._id, { stage });
      toast.success(`Lead moved to ${stage}`);
      reloadAll();
    } catch (err) {
      toast.error(t.common?.error || "Failed to move lead");
    }
    setDraggedLead(null);
  }

  const pipelineValue = allLeads.reduce((a, l) => a + l.value * (l.probability / 100), 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.crm.totalCustomers, value: allCustomers.length, icon: Users, color: "text-primary" },
          { label: t.crm.activeLeads, value: allLeads.length, icon: TrendingUp, color: "text-success" },
          { label: t.crm.totalOrders, value: allCustomers.reduce((a, c) => a + c.orders, 0), icon: ShoppingCart, color: "text-blue-500" },
          { label: t.crm.pipelineValue, value: `€${(pipelineValue / 1000).toFixed(0)}k`, icon: Star, color: "text-amber-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className={`size-4 ${s.color}`} />
            </div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* View tabs & Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {[
            { id: "customers", label: t.crm.customers },
            { id: "leads", label: t.crm.leads },
            { id: "pipeline", label: t.crm.pipeline },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id as any)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${view === tab.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, VAT, email…"
              className="pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors w-56"
              style={{ fontSize: "0.875rem" }}
            />
          </div>
          <PrimaryButton icon={Plus} onClick={openAddModal}>
            {view === "leads" || view === "pipeline" ? t.crm.addLead : t.crm.addCustomer}
          </PrimaryButton>
        </div>
      </div>

      {/* Customers Cards View */}
      {view === "customers" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {customers.map((c, i) => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-5 hover-lift animate-pop-in flex flex-col justify-between" style={{ animationDelay: `${i * 40}ms` }}>
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-bold text-primary-foreground">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-base flex items-center gap-2">
                          {c.name}
                          {!c.active && (
                            <span className="text-[10px] bg-destructive/15 text-destructive px-1.5 py-0.5 rounded font-bold">INACTIVE</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{c.contact || "No Contact Person"}</div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${tierColors[c.tier]}`}>
                      {c.tier}
                    </span>
                  </div>

                  <div className="space-y-1.5 mb-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Mail className="size-3 text-primary" />
                      <span className="font-medium text-foreground">{c.email}</span>
                    </div>
                    {c.vatNumber && (
                      <div className="flex items-center gap-2">
                        <FileText className="size-3 text-amber-500" />
                        <span>VAT: <strong className="text-foreground">{c.vatNumber}</strong></span>
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="size-3" />
                        <span>{c.phone}</span>
                      </div>
                    )}
                    {c.billingAddress?.city && (
                      <div className="flex items-center gap-2">
                        <MapPin className="size-3 text-sky-500" />
                        <span>{c.billingAddress.city}, {c.billingAddress.country || c.country}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-3 text-emerald-500" />
                      <span>Terms: <strong>{c.paymentTerms || "Net 30"}</strong></span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-3">
                    <div className="text-center">
                      <div className="text-muted-foreground">{t.crm.totalOrders}</div>
                      <div className="font-bold mt-0.5">{c.orders}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">{t.crm.spend}</div>
                      <div className="font-bold mt-0.5">€{(c.total_spend / 1000).toFixed(0)}k</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">{t.common.status}</div>
                      <div className="mt-0.5">
                        <StatusBadge status={c.active ? "active" : "inactive"} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-border/50">
                    <button
                      onClick={() => openEditCustomer(c)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary flex items-center gap-1 text-xs"
                      title="Edit Customer Profile"
                    >
                      <Edit3 className="size-3.5" /> Edit Profile
                    </button>
                    <button
                      onClick={() => handleDeleteCustomer(c._id)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
                      title="Delete Customer"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {customers.length === 0 && !customersLoading && (
              <div className="col-span-full text-center py-16 text-muted-foreground">{t.common.noResults}</div>
            )}
          </div>
          <TablePagination pagination={customerPagination} page={customerPage} onPageChange={setCustomerPage} />
        </>
      )}

      {/* Leads Table View */}
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
              {leads.map((l, i) => (
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
              {leads.length === 0 && !leadsLoading && (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">{t.common.noResults}</td></tr>
              )}
            </tbody>
          </table>
          <TablePagination pagination={leadPagination} page={leadPage} onPageChange={setLeadPage} />
        </div>
      )}

      {/* Pipeline View */}
      {view === "pipeline" && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {pipeline.map((stage) => {
              const stageLeads = allLeads.filter((l) => l.stage === stage);
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

      {/* Customer / Lead Create & Edit Modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={editMode === "add" ? (view === "leads" || view === "pipeline" ? t.crm.addLead : t.crm.newCustomerProfile) : t.crm.editCustomerProfile}
        subtitle={t.crm.modalSubtitle}
        footer={
          <>
            <ModalCancel onClose={() => setShowAdd(false)} />
            <ModalSubmit onClick={handleSave}>
              {editMode === "add" ? (view === "leads" || view === "pipeline" ? t.crm.addLead : t.crm.saveCustomer) : t.crm.saveChanges}
            </ModalSubmit>
          </>
        }
      >
        {view === "customers" ? (
          <div className="space-y-4">
            {/* Modal Internal Tabs */}
            <div className="flex border-b border-border pb-1 gap-2 text-xs font-semibold">
              {[
                { id: "general", label: t.crm.tabGeneral },
                { id: "billing", label: t.crm.tabBilling },
                { id: "shipping", label: t.crm.tabShipping },
                { id: "financial", label: t.crm.tabFinancial }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-t-md transition-colors ${activeTab === tab.id ? "border-b-2 border-primary text-primary font-bold bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "general" && (
              <div className="space-y-3">
                <Row>
                  <Field label={t.crm.companyNameLabel} required>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme International S.A." />
                  </Field>
                  <Field label={t.crm.contactPersonLabel}>
                    <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="John Smith" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.emailLabel} required>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="billing@acme.com" />
                  </Field>
                  <Field label={t.crm.phoneLabel}>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+34 912 345 678" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.tierLabel}>
                    <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as any })}>
                      <option value="bronze">Bronze Tier</option>
                      <option value="silver">Silver Tier</option>
                      <option value="gold">Gold Tier</option>
                      <option value="platinum">Platinum Tier</option>
                    </Select>
                  </Field>
                  <Field label={t.crm.statusLabel}>
                    <Select value={form.active ? "true" : "false"} onChange={(e) => setForm({ ...form, active: e.target.value === "true" })}>
                      <option value="true">{t.crm.activeStatus}</option>
                      <option value="false">{t.crm.inactiveStatus}</option>
                    </Select>
                  </Field>
                </Row>
                <Field label={t.crm.notesLabel}>
                  <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t.crm.notesPlaceholder} />
                </Field>
              </div>
            )}

            {activeTab === "billing" && (
              <div className="space-y-3">
                <Row>
                  <Field label={t.crm.vatNumberLabel}>
                    <Input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} placeholder="ES-B12345678" />
                  </Field>
                  <Field label={t.crm.countryLabel}>
                    <Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                      {["ES", "US", "DE", "FR", "IT", "GB", "NL", "SE", "PT", "MX"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.billingStreet}>
                    <Input value={form.billingAddress.street} onChange={(e) => setForm({ ...form, billingAddress: { ...form.billingAddress, street: e.target.value } })} placeholder="Calle Mayor" />
                  </Field>
                  <Field label={t.crm.buildingNumber}>
                    <Input value={form.billingAddress.number} onChange={(e) => setForm({ ...form, billingAddress: { ...form.billingAddress, number: e.target.value } })} placeholder="45, Floor 3" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.cityLabel}>
                    <Input value={form.billingAddress.city} onChange={(e) => setForm({ ...form, billingAddress: { ...form.billingAddress, city: e.target.value } })} placeholder="Madrid" />
                  </Field>
                  <Field label={t.crm.postcodeLabel}>
                    <Input value={form.billingAddress.postcode} onChange={(e) => setForm({ ...form, billingAddress: { ...form.billingAddress, postcode: e.target.value } })} placeholder="28001" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.regionLabel}>
                    <Input value={form.billingAddress.region} onChange={(e) => setForm({ ...form, billingAddress: { ...form.billingAddress, region: e.target.value } })} placeholder="Comunidad de Madrid" />
                  </Field>
                  <Field label={t.crm.billingCountryLabel}>
                    <Input value={form.billingAddress.country} onChange={(e) => setForm({ ...form, billingAddress: { ...form.billingAddress, country: e.target.value } })} placeholder="Spain" />
                  </Field>
                </Row>
              </div>
            )}

            {activeTab === "shipping" && (
              <div className="space-y-3">
                <Row>
                  <Field label={t.crm.shippingStreet}>
                    <Input value={form.shippingAddress.street} onChange={(e) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, street: e.target.value } })} placeholder="Avenida de la Industria" />
                  </Field>
                  <Field label={t.crm.shippingBuildingNumber}>
                    <Input value={form.shippingAddress.number} onChange={(e) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, number: e.target.value } })} placeholder="Nave 12" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.shippingCity}>
                    <Input value={form.shippingAddress.city} onChange={(e) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, city: e.target.value } })} placeholder="Getafe" />
                  </Field>
                  <Field label={t.crm.shippingPostcode}>
                    <Input value={form.shippingAddress.postcode} onChange={(e) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, postcode: e.target.value } })} placeholder="28906" />
                  </Field>
                </Row>
                <Row>
                  <Field label={t.crm.shippingRegion}>
                    <Input value={form.shippingAddress.region} onChange={(e) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, region: e.target.value } })} placeholder="Madrid" />
                  </Field>
                  <Field label={t.crm.shippingCountryLabel}>
                    <Input value={form.shippingAddress.country} onChange={(e) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, country: e.target.value } })} placeholder="Spain" />
                  </Field>
                </Row>
              </div>
            )}

            {activeTab === "financial" && (
              <div className="space-y-3">
                <Row>
                  <Field label={t.crm.paymentTermsLabel}>
                    <Select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                      <option value="Due on Receipt">Due on Receipt (Immediate)</option>
                      <option value="Net 15">Net 15 (15 days)</option>
                      <option value="Net 30">Net 30 (30 days - Standard)</option>
                      <option value="Net 60">Net 60 (60 days)</option>
                      <option value="Net 90">Net 90 (90 days)</option>
                    </Select>
                  </Field>
                  <Field label={t.crm.ibanLabel}>
                    <Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="ES91 2100 0418 4502 0005 1332" />
                  </Field>
                </Row>
                <Field label={t.crm.bankInfoLabel}>
                  <Input value={form.bankInfo} onChange={(e) => setForm({ ...form, bankInfo: e.target.value })} placeholder="Banco Santander / SANESMMXXX" />
                </Field>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Row>
              <Field label={t.common.company} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company Inc." /></Field>
              <Field label={t.crm.contact}><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Full name" /></Field>
            </Row>
            <Field label={t.common.email} required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@company.com" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
