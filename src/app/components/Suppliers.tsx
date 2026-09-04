import { useState, useEffect } from "react";
import { Plus, Search, Pencil, Trash2, Truck, Globe, Mail, Phone, Calendar, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { PrimaryButton, SecondaryButton } from "./AppShell";
import { suppliersService, type Supplier } from "../../services/suppliers.service";
import { type SupplierProduct } from "../../services/suppliers.service";
import { inventoryService } from "../../services/inventory.service";
import { useLang } from "../LangContext";

export function Suppliers() {
  const { t, lang } = useLang();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Supplier | null>(null);

  // Supplier Products state
  const [showProducts, setShowProducts] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  
  const [mapForm, setMapForm] = useState({
    productId: "",
    supplierSku: "",
    purchaseCost: 0,
    leadTimeDays: 7,
    moq: 1
  });

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

  const handleOpenProducts = async (sup: Supplier) => {
    setSelectedSupplier(sup);
    setShowProducts(true);
    try {
      const prods = await suppliersService.getProducts(sup._id);
      setSupplierProducts(prods);
    } catch (e) {
      toast.error("Failed to load supplier products");
    }
  };

  const searchProductsForMapping = async (q: string) => {
    setProductSearch(q);
    if (q.length > 2) {
      try {
        const res = await inventoryService.searchProducts(q);
        setAvailableProducts(res);
      } catch (e) { }
    } else {
      setAvailableProducts([]);
    }
  };

  const handleMapProduct = async () => {
    if (!selectedSupplier || !mapForm.productId || !mapForm.supplierSku) {
      toast.error("Product and Supplier SKU are required");
      return;
    }
    try {
      await suppliersService.addProduct(selectedSupplier._id, mapForm);
      toast.success("Product mapped successfully");
      setMapForm({ productId: "", supplierSku: "", purchaseCost: 0, leadTimeDays: 7, moq: 1 });
      setProductSearch("");
      
      const prods = await suppliersService.getProducts(selectedSupplier._id);
      setSupplierProducts(prods);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to map product");
    }
  };

  const handleUnmapProduct = async (mappingId: string) => {
    if (!selectedSupplier) return;
    if (!confirm("Are you sure you want to unmap this product?")) return;
    try {
      await suppliersService.deleteProduct(selectedSupplier._id, mappingId);
      toast.success("Product unmapped");
      const prods = await suppliersService.getProducts(selectedSupplier._id);
      setSupplierProducts(prods);
    } catch (e) {
      toast.error("Failed to unmap product");
    }
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
                <button onClick={() => handleOpenProducts(s)} title="Products" className="p-1 text-muted-foreground hover:text-blue-500 rounded">
                  <PackageOpen className="size-3.5" />
                </button>
                <button onClick={() => handleOpenEdit(s)} title="Edit" className="p-1 text-muted-foreground hover:text-primary rounded">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => handleDelete(s._id)} title="Delete" className="p-1 text-muted-foreground hover:text-destructive rounded">
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

      <Modal open={showProducts} onClose={() => setShowProducts(false)} title={`Products - ${selectedSupplier?.name}`} size="lg" footer={<ModalCancel onClose={() => setShowProducts(false)} />}>
        <div className="space-y-6">
          <div className="bg-card border border-border p-4 rounded-xl space-y-4">
            <h4 className="text-sm font-semibold">Map New Product</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 relative">
                <Field label="Search Product by SKU/Name">
                  <Input value={productSearch} onChange={e => searchProductsForMapping(e.target.value)} placeholder="Type to search..." />
                </Field>
                {availableProducts.length > 0 && mapForm.productId === "" && (
                  <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {availableProducts.map(p => (
                      <button key={p._id} onClick={() => { setMapForm({...mapForm, productId: p._id}); setProductSearch(p.sku + ' - ' + p.name); setAvailableProducts([]); }} className="w-full text-left px-3 py-2 hover:bg-secondary text-sm">
                        <span className="font-medium">{p.sku}</span> <span className="text-muted-foreground">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Field label="Supplier SKU *">
                <Input value={mapForm.supplierSku} onChange={e => setMapForm({...mapForm, supplierSku: e.target.value})} placeholder="e.g. SUP-12345" />
              </Field>
              <Field label="Unit Cost (EUR) *">
                <Input type="number" step="0.01" value={mapForm.purchaseCost} onChange={e => setMapForm({...mapForm, purchaseCost: Number(e.target.value)})} />
              </Field>
              <Field label="Lead Time (Days)">
                <Input type="number" value={mapForm.leadTimeDays} onChange={e => setMapForm({...mapForm, leadTimeDays: Number(e.target.value)})} />
              </Field>
              <Field label="MOQ">
                <Input type="number" value={mapForm.moq} onChange={e => setMapForm({...mapForm, moq: Number(e.target.value)})} />
              </Field>
            </div>
            <div className="flex justify-end mt-2">
              <PrimaryButton onClick={handleMapProduct}>Map Product</PrimaryButton>
            </div>
          </div>

          <div className="border border-border rounded-xl overflow-hidden bg-card">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Internal SKU</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Supplier SKU</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Cost</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Lead Time</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {supplierProducts.map(sp => (
                  <tr key={sp._id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">{sp.productId?.sku}</td>
                    <td className="px-4 py-3 text-blue-600">{sp.supplierSku}</td>
                    <td className="px-4 py-3">€{(sp.purchaseCost || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">{sp.leadTimeDays}d</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleUnmapProduct(sp._id)} className="text-destructive hover:underline">Unmap</button>
                    </td>
                  </tr>
                ))}
                {supplierProducts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No products mapped.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
