import { useState } from "react";
import { PackageCheck, Search, Plus, Truck, AlertTriangle, CheckCircle2, Clock, ScanLine, Package } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { asnService } from "../../services/asn.service";
import { receivingService } from "../../services/receiving.service";

type ASN = { _id: string; id: string; supplier: string; origin: string; carrier: string; sku_count: number; expected_units: number; status: string; expected_date: string; po: string };

const blankASN = (): Omit<ASN, "id" | "status" | "_id"> => ({
  supplier: "", origin: "", carrier: "DHL", sku_count: 1, expected_units: 0, expected_date: "", po: "",
});

export function Receiving() {
  const { t } = useLang();
  const [asns, setAsns] = useState<ASN[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<any[]>([]);
  const [activeAsn, setActiveAsn] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState(false);
  const [scanned, setScanned] = useState("");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankASN());

  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const [asnData, receiptData] = await Promise.all([
        asnService.getAll(),
        receivingService.getAll()
      ]);
      setAsns(asnData);
      setRecentReceipts(receiptData.slice(0, 5));
    } catch (err) {
      toast.error("Failed to load ASNs and Receipts");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setForm(blankASN()); setShowAdd(true); };
    window.addEventListener("open-new-asn", handler);
    return () => window.removeEventListener("open-new-asn", handler);
  }, []);

  const filtered = asns.filter((a) =>
    a.id?.toLowerCase().includes(search.toLowerCase()) || a.supplier?.toLowerCase().includes(search.toLowerCase())
  );

  const pending = asns.filter((a) => a.status === "pending" || a.status === "in_transit").length;

  async function handleConfirmScan() {
    if (!scanned.trim()) { toast.error(t.receiving.scanError); return; }
    try {
      const receiptId = `RCV-${Math.floor(Math.random() * 10000)}`;
      await receivingService.create({
        receiptId,
        product: scanned.trim(),
        expected: 1,
        received: 1,
        discrepancy: 0,
        condition: "good",
        zone: "Z-1",
        asn: activeAsn || "WALK-IN",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      toast.success(`${t.receiving.scanConfirmed}: "${scanned.trim()}".`);
      setScanned("");
      setScanMode(false);
      loadData();
    } catch (err) {
      toast.error("Failed to process scan");
    }
  }

  async function handleStartReceiving(asn: ASN) {
    try {
      await asnService.update(asn._id, { status: "in_progress" });
      toast.info(`${t.receiving.startReceiving}: ${asn.id} — ${asn.supplier}.`);
      loadData();
    } catch (err) {
      toast.error("Failed to update status");
    }
  }

  async function handleCreateASN() {
    if (!form.supplier || !form.po) { toast.error("Supplier and PO number are required."); return; }
    const newId = `ASN-${String(asns.length + 42).padStart(4, "0")}`;
    try {
      await asnService.create({ ...form, id: newId, status: "pending", expected_units: Number(form.expected_units), sku_count: Number(form.sku_count) });
      toast.success(`${t.receiving.asnCreated}: ${newId} — ${form.supplier}.`);
      setShowAdd(false);
      setForm(blankASN());
      loadData();
    } catch (err) {
      toast.error("Failed to create ASN");
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.receiving.pendingASNs, value: pending, icon: Clock, color: "text-warning" },
          { label: t.receiving.inTransit, value: asns.filter((a) => a.status === "in_transit").length, icon: Truck, color: "text-primary" },
          { label: t.receiving.receivedToday, value: 3, icon: CheckCircle2, color: "text-success" },
          { label: t.receiving.discrepancies, value: 2, icon: AlertTriangle, color: "text-destructive" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Scan terminal */}
      <div className={`rounded-xl border-2 transition-all p-5 ${scanMode ? "border-primary bg-primary/5" : "border-dashed border-border bg-secondary/20"}`}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`size-10 rounded-xl flex items-center justify-center ${scanMode ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
              <ScanLine className="size-5" />
            </div>
            <div>
              <div className="font-semibold">{scanMode ? t.receiving.scannerActive : "Barcode scanner"}</div>
              <div className="text-xs text-muted-foreground">Scan product barcode to begin receiving</div>
            </div>
          </div>
          <div className="flex-1 flex items-center gap-2 min-w-48">
            <input
              value={scanned}
              onChange={(e) => setScanned(e.target.value)}
              placeholder={t.receiving.barcodePlaceholder}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-card outline-none focus:border-primary/50 transition-colors"
              style={{ fontSize: "0.875rem", fontFamily: "JetBrains Mono, monospace" }}
              onFocus={() => setScanMode(true)}
              onBlur={() => setTimeout(() => setScanMode(false), 200)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmScan()}
            />
            <button
              onClick={handleConfirmScan}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all active:scale-95"
            >
              {t.common.confirm}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* ASN list */}
        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t.common.search} ASNs…`} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
            </div>
            <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>{t.receiving.newASN}</PrimaryButton>
          </div>

          {filtered.map((asn, i) => (
            <div
              key={asn.id}
              onClick={() => setActiveAsn(activeAsn === asn.id ? null : asn.id)}
              className={`rounded-xl border bg-card p-4 cursor-pointer hover-lift animate-pop-in transition-colors ${activeAsn === asn.id ? "border-primary" : "border-border"}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-secondary flex items-center justify-center"><Package className="size-4 text-muted-foreground" /></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.875rem" }}>{asn.id}</span>
                      <StatusBadge status={asn.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">{asn.supplier} · {asn.po}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{asn.sku_count} {t.receiving.skuCount}</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{asn.expected_units.toLocaleString()} units</span>
                  <span className="hidden sm:inline">{asn.carrier}</span>
                  <span className="hidden md:inline">ETA {asn.expected_date}</span>
                </div>
              </div>

              {activeAsn === asn.id && (
                <div className="mt-4 pt-4 border-t border-border animate-fade-in-up">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: t.receiving.origin, value: asn.origin },
                      { label: t.receiving.carrier, value: asn.carrier },
                      { label: t.receiving.poNumber, value: asn.po },
                      { label: t.receiving.expectedDate, value: asn.expected_date },
                    ].map((d) => (
                      <div key={d.label} className="bg-secondary/50 rounded-lg p-3">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">{d.label}</div>
                        <div className="text-sm font-semibold">{d.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {asn.status !== "completed" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStartReceiving(asn); }}
                        className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all active:scale-95"
                      >
                        {t.receiving.startReceiving}
                      </button>
                    )}
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-secondary transition-colors"
                    >
                      {t.receiving.viewDetails}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Recent receipts */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border"><h3 className="font-bold text-sm">{t.receiving.recentReceipts}</h3></div>
          <div className="divide-y divide-border">
            {recentReceipts.map((r, i) => (
              <div key={r._id || i} className="p-3 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{r.receiptId || `RCV-${i}`}</span>
                  <span className="text-[10px] text-muted-foreground">{r.time || "Recent"}</span>
                </div>
                <div className="text-sm font-medium truncate">{r.product?.name || r.product || "Unknown Product"}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Recv: <span className="font-bold text-foreground">{r.received}</span>/{r.expected}</span>
                  {r.discrepancy !== 0 && (
                    <span className={`text-xs font-bold ${r.discrepancy < 0 ? "text-destructive" : "text-success"}`}>{r.discrepancy > 0 ? "+" : ""}{r.discrepancy}</span>
                  )}
                  {r.condition === "damaged" && <span className="text-[10px] bg-destructive/15 text-destructive px-1.5 py-0.5 rounded font-bold">DAMAGED</span>}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Zone: {r.zone} · {r.asn?.asnId || r.asn || "N/A"}</div>
              </div>
            ))}
            {recentReceipts.length === 0 && <div className="p-4 text-center text-muted-foreground text-sm">No recent receipts.</div>}
          </div>
        </div>
      </div>

      {/* New ASN Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t.receiving.newASN} subtitle="Register an inbound shipment" footer={<><ModalCancel onClose={() => setShowAdd(false)} /><ModalSubmit onClick={handleCreateASN}>{t.receiving.asnCreated}</ModalSubmit></>}>
        <Row>
          <Field label={t.receiving.supplier} required><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier name" /></Field>
          <Field label={t.receiving.poNumber} required><Input value={form.po} onChange={(e) => setForm({ ...form, po: e.target.value })} placeholder="PO-XXXX" /></Field>
        </Row>
        <Row>
          <Field label={t.receiving.origin}><Input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="City, Country" /></Field>
          <Field label={t.receiving.carrier}><Select value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}>
            {["DHL","FedEx","UPS","USPS","GLS","TNT"].map((c) => <option key={c}>{c}</option>)}
          </Select></Field>
        </Row>
        <Row>
          <Field label={t.receiving.skuCount}><Input type="number" value={form.sku_count} onChange={(e) => setForm({ ...form, sku_count: Number(e.target.value) })} /></Field>
          <Field label={t.receiving.expectedUnits}><Input type="number" value={form.expected_units} onChange={(e) => setForm({ ...form, expected_units: Number(e.target.value) })} /></Field>
        </Row>
        <Field label={t.receiving.expectedDate}><Input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}
