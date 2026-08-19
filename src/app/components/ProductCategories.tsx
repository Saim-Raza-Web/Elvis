import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Tag, ShieldCheck, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { categoriesService, type ProductCategory } from "../../services/categories.service";

export function ProductCategories() {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState<ProductCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductCategory | null>(null);

  const [form, setForm] = useState({
    code: "",
    name: "",
    qc_behaviour: "Standard",
    recommended_zone: "Any available zone",
    description: "",
    active: true
  });

  const loadCategories = async () => {
    try {
      setLoading(true);
      const data = await categoriesService.getAll();
      setCategories(data || []);
    } catch {
      toast.error("Failed to load product categories.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const openCreate = () => {
    setEditingTarget(null);
    setForm({
      code: "",
      name: "",
      qc_behaviour: "Standard",
      recommended_zone: "Any available zone",
      description: "",
      active: true
    });
    setShowModal(true);
  };

  const openEdit = (cat: ProductCategory) => {
    setEditingTarget(cat);
    setForm({
      code: cat.code || "",
      name: cat.name || "",
      qc_behaviour: cat.qc_behaviour || "Standard",
      recommended_zone: cat.recommended_zone || "Any available zone",
      description: cat.description || "",
      active: cat.active !== false
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) { toast.error("Category Code is required."); return; }
    if (!form.name.trim()) { toast.error("Category Name is required."); return; }

    try {
      if (editingTarget) {
        await categoriesService.update(editingTarget._id, form);
        toast.success(`Category '${form.code}' updated.`);
      } else {
        await categoriesService.create(form);
        toast.success(`Category '${form.code}' created.`);
      }
      setShowModal(false);
      loadCategories();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save category.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await categoriesService.delete(deleteTarget._id);
      toast.success(`Category '${deleteTarget.code}' deleted.`);
      setDeleteTarget(null);
      loadCategories();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete category.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-6 rounded-2xl border border-border">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Tag className="size-5 text-primary" /> Product Categories Master (CAT-01)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure product category definitions, quality control behaviors, and recommended storage zones.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-all shadow-md"
        >
          <Plus className="size-4" /> Add Category
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/40 text-muted-foreground uppercase text-[11px] tracking-wider font-bold">
              <tr>
                <th className="px-6 py-4">Code</th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">QC Behaviour</th>
                <th className="px-6 py-4">Recommended Zone</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-medium">
              {categories.map((cat) => (
                <tr key={cat._id} className="hover:bg-secondary/10 transition-colors">
                  <td className="px-6 py-4 font-bold text-primary" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                    {cat.code}
                  </td>
                  <td className="px-6 py-4 font-semibold text-foreground">{cat.name}</td>
                  <td className="px-6 py-4 text-muted-foreground">
                    <span className="flex items-center gap-1.5 text-xs font-semibold bg-secondary px-2.5 py-1 rounded-md w-fit">
                      <ShieldCheck className="size-3.5 text-info" /> {cat.qc_behaviour}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    <span className="flex items-center gap-1.5 text-xs font-semibold bg-secondary/80 px-2.5 py-1 rounded-md w-fit">
                      <MapPin className="size-3.5 text-amber-500" /> {cat.recommended_zone}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${cat.active !== false ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                      {cat.active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(cat)}
                        className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(cat)}
                        className="p-2 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    No product categories configured yet. Click "Add Category" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add/Edit */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingTarget ? "Edit Product Category" : "Create Product Category"}
        subtitle="Manage product category code, QC triggers and zone rules."
        footer={
          <>
            <ModalCancel onClose={() => setShowModal(false)} />
            <ModalSubmit onClick={handleSave}>{editingTarget ? "Save Changes" : "Create Category"}</ModalSubmit>
          </>
        }
      >
        <Row>
          <Field label="Category Code *" required>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="e.g. COLD, FOOD-DRY, PHARMA"
            />
          </Field>
          <Field label="Category Name *" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Cold Chain Products"
            />
          </Field>
        </Row>

        <Field label="QC Inspection Behaviour">
          <Input
            value={form.qc_behaviour}
            onChange={(e) => setForm({ ...form, qc_behaviour: e.target.value })}
            placeholder="e.g. Cold Chain: temp + humidity + data logger"
          />
        </Field>

        <Field label="Recommended Storage Zone">
          <Input
            value={form.recommended_zone}
            onChange={(e) => setForm({ ...form, recommended_zone: e.target.value })}
            placeholder="e.g. Refrigerated / frozen zone"
          />
        </Field>

        <Field label="Description / Notes">
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Additional category notes"
          />
        </Field>

        <Field label="Status">
          <Select value={form.active ? "true" : "false"} onChange={(e) => setForm({ ...form, active: e.target.value === "true" })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Category"
        subtitle="Confirm deletion of product category."
        width="sm"
        footer={
          <>
            <ModalCancel onClose={() => setDeleteTarget(null)} />
            <ModalSubmit variant="destructive" onClick={handleDelete}>Delete Category</ModalSubmit>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete category <strong>{deleteTarget?.code}</strong>? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
