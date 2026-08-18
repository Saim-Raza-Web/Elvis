import { useState, useEffect } from "react";
import { Plus, Search, Pencil, Trash2, Truck, Globe, Mail, Phone, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { PrimaryButton, SecondaryButton } from "./AppShell";
import { suppliersService, type Supplier } from "../../services/suppliers.service";
import { useLang } from "../LangContext";

export function Suppliers() {
  const { t, lang } = useLang();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Supplier | null>(null);

  const [form, setForm] = useState({
    name: "",
    taxId: "",
    country: "Spain",
    contact: "",
    email: "",
    phone: "",
    defaultCarrier: "DHL Express",
    leadTime: 7,
  });

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const res = await suppliersService.getAll();
      setSuppliers(res || []);
    } catch (_) {
      toast.error("Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const handleOpenAdd = () => {
    setEditingTarget(null);
    setForm({ name: "", taxId: "", country: "Spain", contact: "", email: "", phone: "", defaultCarrier: "DHL Express", leadTime: 7 });
    setShowAdd(true);
  };

  const handleOpenEdit = (sup: Supplier) => {
    setEditingTarget(sup);
    setForm({
      name: sup.name,
      taxId: sup.taxId || "",
      country: sup.country || "Spain",
      contact: sup.contact || "",
      email: sup.email || "",
      phone: sup.phone || "",
      defaultCarrier: sup.defaultCarrier || "DHL Express",
      leadTime: sup.leadTime || 7,
    });
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Supplier name is required.");
      return;
    }
    try {
      if (editingTarget) {
        await suppliersService.update(editingTarget._id, form);
        toast.success(`Supplier '${form.name}' updated.`);
      } else {
        await suppliersService.create(form);
        toast.success(`Supplier '${form.name}' created.`);
      }
      setShowAdd(false);
      loadSuppliers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save supplier");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this supplier?")) return;
    try {
      await suppliersService.delete(id);
      toast.success("Supplier deleted.");
      loadSuppliers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete supplier");
    }
  };

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contact && s.contact.toLowerCase().includes(search.toLowerCase())) ||
    (s.taxId && s.taxId.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "es" ? "Buscar proveedores por nombre, NIF o contacto..." : "Search suppliers by name, tax ID or contact..."}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none text-xs focus:border-primary/50"
          />
        </div>
        <PrimaryButton icon={Plus} onClick={handleOpenAdd}>
          {lang === "es" ? "Nuevo Proveedor" : "Add Supplier"}
        </PrimaryButton>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((s) => (
          <div key={s._id} className="rounded-xl border border-border bg-card p-4 space-y-3 relative group">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-bold text-sm text-foreground">{s.name}</h4>
                {s.taxId && <span className="text-[10px] font-mono text-muted-foreground block">NIF/Tax: {s.taxId}</span>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleOpenEdit(s)} className="p-1 text-muted-foreground hover:text-primary rounded">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => handleDelete(s._id)} className="p-1 text-muted-foreground hover:text-destructive rounded">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-1 text-xs text-muted-foreground">
              {s.contact && <div className="flex items-center gap-2"><strong>Contact:</strong> {s.contact}</div>}
              {s.country && <div className="flex items-center gap-2"><Globe className="size-3 text-primary" /> {s.country}</div>}
              {s.defaultCarrier && <div className="flex items-center gap-2"><Truck className="size-3 text-amber-500" /> {s.defaultCarrier}</div>}
              {s.leadTime !== undefined && <div className="flex items-center gap-2"><Calendar className="size-3 text-emerald-500" /> Lead Time: {s.leadTime} days</div>}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full p-8 text-center text-muted-foreground text-xs border border-dashed border-border rounded-xl">
            {lang === "es" ? "No se encontraron proveedores." : "No suppliers found."}
          </div>
        )}
      </div>

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={editingTarget ? (lang === "es" ? "Editar Proveedor" : "Edit Supplier") : (lang === "es" ? "Nuevo Proveedor" : "Add Supplier")}
        subtitle="Manage supplier master details and logistics rules"
        footer={
          <>
            <ModalCancel onClose={() => setShowAdd(false)} />
            <ModalSubmit onClick={handleSave}>{lang === "es" ? "Guardar" : "Save Supplier"}</ModalSubmit>
          </>
        }
      >
        <div className="space-y-4">
          <Row>
            <Field label={lang === "es" ? "Nombre del Proveedor *" : "Supplier Name *"} required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Global Suppliers" />
            </Field>
            <Field label={lang === "es" ? "NIF / CIF / Tax ID" : "Tax ID / CIF"}>
              <Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder="TAX-001" />
            </Field>
          </Row>
          <Row>
            <Field label={lang === "es" ? "Contacto Principal" : "Primary Contact"}>
              <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Carlos Rodriguez" />
            </Field>
            <Field label={lang === "es" ? "País" : "Country"}>
              <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Spain" />
            </Field>
          </Row>
          <Row>
            <Field label={lang === "es" ? "Transportista Habitual" : "Default Carrier"}>
              <Input value={form.defaultCarrier} onChange={(e) => setForm({ ...form, defaultCarrier: e.target.value })} placeholder="DHL Express" />
            </Field>
            <Field label={lang === "es" ? "Plazo de Entrega (Días)" : "Lead Time (Days)"}>
              <Input type="number" value={form.leadTime} onChange={(e) => setForm({ ...form, leadTime: Number(e.target.value) })} />
            </Field>
          </Row>
        </div>
      </Modal>
    </div>
  );
}
