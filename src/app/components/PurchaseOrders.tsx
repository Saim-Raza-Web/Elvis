import { useState, useEffect } from "react";
import { Plus, Search, Send, CheckCircle, PackageOpen, FileText, Ban, Eye, Mail } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton } from "./AppShell";
import { purchaseOrdersService, type PurchaseOrder } from "../../services/purchase_orders.service";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

export function PurchaseOrders() {
  const { t, lang } = useLang();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  
  // Modals
  const [showReceive, setShowReceive] = useState(false);
  const [showBill, setShowBill] = useState(false);

  // Receive Form
  const [receiveData, setReceiveData] = useState<{lineId: string, qty: number}[]>([]);
  
  // Bill Form
  const [billData, setBillData] = useState({ supplierInvoiceNumber: "", billDate: "", dueDate: "" });

  const loadPOs = async () => {
    try {
      setLoading(true);
      const data = await purchaseOrdersService.getAll();
      setPos(data);
    } catch (err) {
      toast.error("Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPOs();
  }, []);

  const handleConfirm = async (id: string) => {
    try {
      await purchaseOrdersService.confirm(id);
      toast.success("Purchase Order confirmed");
      loadPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to confirm PO");
    }
  };

  const handleSend = async (id: string) => {
    try {
      const res = await purchaseOrdersService.sendToSupplier(id);
      toast.success(res.message);
      loadPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to send PO");
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Are you sure you want to cancel this PO?")) return;
    try {
      await purchaseOrdersService.cancel(id);
      toast.success("Purchase Order cancelled");
      loadPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to cancel PO");
    }
  };

  const openReceive = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setReceiveData(po.lines.map(l => ({ lineId: l._id || '', qty: Math.max(0, l.quantityOrdered - (l.quantityReceived || 0)) })));
    setShowReceive(true);
  };

  const handleReceive = async () => {
    if (!selectedPO) return;
    try {
      await purchaseOrdersService.receiveGoods(selectedPO._id, receiveData);
      toast.success("Goods received successfully");
      setShowReceive(false);
      loadPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to receive goods");
    }
  };

  const openBill = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setBillData({ supplierInvoiceNumber: "", billDate: new Date().toISOString().split('T')[0], dueDate: "" });
    setShowBill(true);
  };

  const handleBill = async () => {
    if (!selectedPO) return;
    if (!billData.supplierInvoiceNumber) {
      toast.error("Supplier Invoice Number is required");
      return;
    }
    try {
      await purchaseOrdersService.createBill(selectedPO._id, billData);
      toast.success("Supplier Bill generated successfully");
      setShowBill(false);
      loadPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create bill");
    }
  };

  const filtered = pos.filter(po => 
    po.poNumber.toLowerCase().includes(search.toLowerCase()) ||
    (po.supplierId?.name && po.supplierId.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search POs..."
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none text-xs focus:border-primary/50"
          />
        </div>
      </div>

      <div className="overflow-x-auto bg-card rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium text-muted-foreground">PO Number</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Supplier</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Total</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(po => (
              <tr key={po._id} className="hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3 font-medium">{po.poNumber}</td>
                <td className="px-4 py-3">{po.supplierId?.name || 'Unknown'}</td>
                <td className="px-4 py-3">{new Date(po.createdAt || '').toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium
                    ${po.status === 'DRAFT' ? 'bg-slate-100 text-slate-700' :
                      po.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-700' :
                      po.status === 'PARTIALLY_RECEIVED' ? 'bg-amber-100 text-amber-700' :
                      po.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-700' :
                      po.status === 'BILLED' ? 'bg-purple-100 text-purple-700' :
                      'bg-red-100 text-red-700'}`}>
                    {po.status}
                  </span>
                </td>
                <td className="px-4 py-3">{(po.grandTotal || 0).toFixed(2)} {po.currency || 'EUR'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {po.status === 'DRAFT' && (
                      <>
                        <button onClick={() => handleConfirm(po._id)} title="Confirm PO" className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><CheckCircle className="size-4" /></button>
                        <button onClick={() => handleCancel(po._id)} title="Cancel PO" className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Ban className="size-4" /></button>
                      </>
                    )}
                    {(po.status === 'CONFIRMED' || po.status === 'PARTIALLY_RECEIVED') && (
                      <>
                        <button onClick={() => handleSend(po._id)} title="Send to Supplier via Email" className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"><Mail className="size-4" /></button>
                        <button onClick={() => openReceive(po)} title="Receive Goods" className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg"><PackageOpen className="size-4" /></button>
                      </>
                    )}
                    {(po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED') && (
                      <button onClick={() => openBill(po)} title="Generate Supplier Bill" className="p-1.5 text-purple-500 hover:bg-purple-50 rounded-lg"><FileText className="size-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">No purchase orders found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showReceive} onClose={() => setShowReceive(false)} title={`Receive Goods - ${selectedPO?.poNumber}`} footer={<><ModalCancel onClose={() => setShowReceive(false)} /><ModalSubmit onClick={handleReceive}>Confirm Receipt</ModalSubmit></>}>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {selectedPO?.lines.map((line, idx) => {
            const remaining = line.quantityOrdered - (line.quantityReceived || 0);
            return (
              <div key={line._id} className="p-3 bg-muted/30 rounded-lg border border-border">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <div className="font-medium text-sm">{line.sku}</div>
                    <div className="text-xs text-muted-foreground">{line.description}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div>Ordered: {line.quantityOrdered}</div>
                    <div>Received: {line.quantityReceived || 0}</div>
                  </div>
                </div>
                {remaining > 0 ? (
                  <Field label="Qty to Receive Now">
                    <Input type="number" min={0} max={remaining} value={receiveData.find(r => r.lineId === line._id)?.qty || 0} onChange={e => {
                      const val = Number(e.target.value);
                      setReceiveData(prev => prev.map(r => r.lineId === line._id ? { ...r, qty: val } : r));
                    }} />
                  </Field>
                ) : (
                  <div className="text-xs text-emerald-600 font-medium mt-2">Fully Received</div>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal open={showBill} onClose={() => setShowBill(false)} title={`Create Supplier Bill - ${selectedPO?.poNumber}`} footer={<><ModalCancel onClose={() => setShowBill(false)} /><ModalSubmit onClick={handleBill}>Generate Bill</ModalSubmit></>}>
        <div className="space-y-4">
          <Field label="Supplier Invoice Number *" required>
            <Input value={billData.supplierInvoiceNumber} onChange={e => setBillData({...billData, supplierInvoiceNumber: e.target.value})} placeholder="e.g. INV-9921" />
          </Field>
          <Row>
            <Field label="Bill Date">
              <Input type="date" value={billData.billDate} onChange={e => setBillData({...billData, billDate: e.target.value})} />
            </Field>
            <Field label="Due Date">
              <Input type="date" value={billData.dueDate} onChange={e => setBillData({...billData, dueDate: e.target.value})} />
            </Field>
          </Row>
          <div className="text-xs text-muted-foreground p-3 bg-blue-50/50 text-blue-800 rounded border border-blue-100">
            Unbilled received quantities will be automatically calculated and converted into a Supplier Bill with a corresponding Journal Entry based on your Accounting Settings.
          </div>
        </div>
      </Modal>
    </div>
  );
}
