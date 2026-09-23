import { useState, useEffect } from "react";
import { 
  BarChart3, RefreshCw, Edit3, XCircle, CheckCircle2, 
  AlertTriangle, Search, Filter, RotateCcw 
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";

type ABCProduct = {
  _id: string;
  sku: string;
  name: string;
  category: string;
  calculatedClass: 'A' | 'B' | 'C';
  effectiveClass: 'A' | 'B' | 'C';
  volume: number;
  calcDate: string | null;
  hasOverride: boolean;
  override: 'A' | 'B' | 'C' | null;
};

type ABCSummary = {
  totalProducts: number;
  counts: { A: number; B: number; C: number };
  products: ABCProduct[];
};

export function ABCClassificationManager() {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [data, setData] = useState<ABCSummary | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<"All" | "A" | "B" | "C">("All");
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ABCProduct | null>(null);
  const [overrideClass, setOverrideClass] = useState<"A" | "B" | "C">("A");
  const [overrideReason, setOverrideReason] = useState("");

  const fetchABCData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const res = await fetch("/api/v1/abc-classification", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load ABC data");
      const result = await res.json();
      setData(result);
    } catch (err: any) {
      toast.error(err.message || "Failed to load ABC classification data");
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    if (!confirm("Recalculate ABC classification for all products? This may take several minutes.")) return;
    
    try {
      setRecalculating(true);
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const res = await fetch("/api/v1/abc-classification/recalculate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to recalculate ABC classification");
      const result = await res.json();
      toast.success(`ABC classification recalculated: ${result.totalProducts} products processed`);
      await fetchABCData();
    } catch (err: any) {
      toast.error(err.message || "Failed to recalculate ABC classification");
    } finally {
      setRecalculating(false);
    }
  };

  const handleSetOverride = async () => {
    if (!selectedProduct) return;
    
    try {
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const res = await fetch(`/api/v1/abc-classification/${selectedProduct.sku}/override`, {
        method: "PUT",
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          abcClass: overrideClass,
          reason: overrideReason
        })
      });
      if (!res.ok) throw new Error("Failed to set ABC override");
      toast.success(`ABC override set for ${selectedProduct.sku}`);
      setShowOverrideModal(false);
      setSelectedProduct(null);
      setOverrideReason("");
      await fetchABCData();
    } catch (err: any) {
      toast.error(err.message || "Failed to set ABC override");
    }
  };

  const handleClearOverride = async (product: ABCProduct) => {
    if (!confirm(`Clear ABC override for ${product.sku}?`)) return;
    
    try {
      const token = localStorage.getItem("jwt_token") || localStorage.getItem("token");
      const res = await fetch(`/api/v1/abc-classification/${product.sku}/override`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to clear ABC override");
      toast.success(`ABC override cleared for ${product.sku}`);
      await fetchABCData();
    } catch (err: any) {
      toast.error(err.message || "Failed to clear ABC override");
    }
  };

  const openOverrideModal = (product: ABCProduct) => {
    setSelectedProduct(product);
    setOverrideClass(product.effectiveClass);
    setOverrideReason("");
    setShowOverrideModal(true);
  };

  useEffect(() => {
    fetchABCData();
  }, []);

  const filteredProducts = data?.products.filter(p => {
    const matchesSearch = !search || 
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      p.name.toLowerCase().includes(search.toLowerCase());
    const matchesClass = classFilter === "All" || p.effectiveClass === classFilter;
    return matchesSearch && matchesClass;
  }) || [];

  const getClassColor = (cls: string) => {
    switch (cls) {
      case 'A': return 'text-green-600 bg-green-50 border-green-200';
      case 'B': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'C': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getClassIcon = (cls: string) => {
    return null; // Text-only representation
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">ABC Classification Management</h2>
        </div>
        <div className="flex gap-2">
          <SecondaryButton
            onClick={fetchABCData}
            disabled={loading}
            icon={<RefreshCw className="w-4 h-4" />}
          >
            Refresh
          </SecondaryButton>
          <PrimaryButton
            onClick={handleRecalculate}
            disabled={recalculating}
            icon={<RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />}
          >
            {recalculating ? 'Recalculating...' : 'Recalculate'}
          </PrimaryButton>
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Total Products</div>
            <div className="text-2xl font-bold">{data.totalProducts}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Class A (Top 80%)</div>
            <div className="text-2xl font-bold text-green-600">{data.counts.A}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Class B (80-95%)</div>
            <div className="text-2xl font-bold text-yellow-600">{data.counts.B}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Class C (Bottom 5%)</div>
            <div className="text-2xl font-bold text-red-600">{data.counts.C}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by SKU or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex gap-2">
          {["All", "A", "B", "C"].map((cls) => (
            <button
              key={cls}
              onClick={() => setClassFilter(cls as any)}
              className={`px-3 py-2 rounded-lg border transition-colors ${
                classFilter === cls
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border hover:bg-secondary"
              }`}
            >
              {cls === "All" ? "All Classes" : `Class ${cls}`}
            </button>
          ))}
        </div>
      </div>

      {/* Products Table */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading ABC classification data...</div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-secondary/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">SKU</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Category</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Calculated</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Effective</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Volume (30d)</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Override</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product._id} className="border-t border-border">
                  <td className="px-4 py-3 text-sm font-mono">{product.sku}</td>
                  <td className="px-4 py-3 text-sm">{product.name}</td>
                  <td className="px-4 py-3 text-sm">{product.category}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${getClassColor(product.calculatedClass)}`}>
                      {product.calculatedClass}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${getClassColor(product.effectiveClass)}`}>
                      {product.effectiveClass}
                      {product.hasOverride && <AlertTriangle className="w-3 h-3" />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{product.volume.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">
                    {product.hasOverride ? (
                      <span className="text-purple-600 font-medium">{product.override}</span>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openOverrideModal(product)}
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                        title="Set override"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      {product.hasOverride && (
                        <button
                          onClick={() => handleClearOverride(product)}
                          className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                          title="Clear override"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProducts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No products found matching the current filters
            </div>
          )}
        </div>
      )}

      {/* Override Modal */}
      {showOverrideModal && selectedProduct && (
        <Modal
          title={`Set ABC Override for ${selectedProduct.sku}`}
          onClose={() => setShowOverrideModal(false)}
        >
          <div className="space-y-4">
            <Field label="Current Calculated Class">
              <div className={`inline-flex items-center gap-1 px-3 py-1.5 rounded border ${getClassColor(selectedProduct.calculatedClass)}`}>
                {selectedProduct.calculatedClass}
              </div>
            </Field>
            <Field label="Override Class">
              <div className="flex gap-2">
                {['A', 'B', 'C'].map((cls) => (
                  <button
                    key={cls}
                    onClick={() => setOverrideClass(cls as any)}
                    className={`flex-1 py-2 rounded border transition-colors ${
                      overrideClass === cls
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-secondary"
                    }`}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Reason (optional)">
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why is this override needed?"
              />
            </Field>
            <Row>
              <ModalCancel onClick={() => setShowOverrideModal(false)} />
              <ModalSubmit onClick={handleSetOverride}>
                Set Override
              </ModalSubmit>
            </Row>
          </div>
        </Modal>
      )}
    </div>
  );
}