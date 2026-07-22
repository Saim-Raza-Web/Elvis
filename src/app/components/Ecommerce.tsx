import { useState } from "react";
import { Globe, Plus, RefreshCw, ShoppingCart, Package, AlertTriangle, CheckCircle2, ArrowUpRight, Zap, Edit3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

import { useEffect } from "react";
import { ecommerceService } from "../../services/ecommerce.service";

type Channel = { _id: string; id: string; name: string; platform: string; url: string; status: string; orders_today: number; synced_at: string; products: number; pending_sync: number };

const platformIcon: Record<string, string> = {
  Shopify: "🟢",
  Amazon: "🟠",
  WooCommerce: "🔵",
  eBay: "🔴",
  Mirakl: "🟣",
};

import { ordersService } from "../../services/orders.service";

export function Ecommerce() {
  const { t } = useLang();
  const [channelList, setChannelList] = useState<Channel[]>([]);
  const [search, setSearch] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [editMode, setEditMode] = useState<"connect" | "edit">("connect");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectForm, setConnectForm] = useState({ name: "", platform: "Shopify", url: "", apiKey: "" });

  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function loadData() {
    try {
      setIsLoading(true);
      const [data, orders] = await Promise.all([
        ecommerceService.getAll(),
        ordersService.getAll()
      ]);
      setChannelList(data.map((d: any) => ({ ...d, id: d._id, synced_at: d.synced_at?.slice(0, 10) || "Never" })));
      
      const channelOrders = orders
        .filter((o: any) => o.channel && o.channel !== "Direct")
        .sort((a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime())
        .slice(0, 5)
        .map((o: any) => ({
          id: o.orderId,
          channel: o.channel,
          customer: o.customer,
          total: o.total || 0,
          status: o.status,
          time: new Date(o.createdAt || o.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
      setRecentOrders(channelOrders);
    } catch (err) {
      toast.error("Failed to load ecommerce channels");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => { setConnectForm({ name: "", platform: "Shopify", url: "", apiKey: "" }); setEditMode("connect"); setShowConnect(true); };
    window.addEventListener("open-connect-channel", handler);
    return () => window.removeEventListener("open-connect-channel", handler);
  }, []);

  async function handleConnect() {
    if (!connectForm.name || !connectForm.url) { toast.error("Channel name and URL required."); return; }
    try {
      if (editMode === "connect") {
        await ecommerceService.create({ ...connectForm, status: "connected", orders_today: 0, products: 0, pending_sync: 0, synced_at: new Date().toISOString() });
        toast.success(`${t.ecommerce.channelConnected}: ${connectForm.name}`);
      } else {
        await ecommerceService.update(editingId!, { name: connectForm.name, platform: connectForm.platform, url: connectForm.url });
        toast.success(`Channel updated: ${connectForm.name}`);
      }
      setShowConnect(false);
      setConnectForm({ name: "", platform: "Shopify", url: "", apiKey: "" });
      loadData();
    } catch (err) { toast.error("Failed to save channel"); }
  }

  function handleQuickConnect(platform: string) {
    setEditMode("connect");
    setConnectForm((f) => ({ ...f, platform, name: platform + " Store" }));
    setShowConnect(true);
  }

  function openEditChannel(ch: Channel) {
    setEditMode("edit");
    setEditingId(ch._id);
    setConnectForm({ name: ch.name, platform: ch.platform, url: ch.url, apiKey: "" });
    setShowConnect(true);
  }

  async function handleDeleteChannel(id: string) {
    if (!confirm("Remove this channel?")) return;
    try {
      await ecommerceService.delete(id);
      toast.success("Channel removed.");
      loadData();
    } catch (err) { toast.error("Failed to delete channel"); }
  }

  async function handleSync(id: string, name: string) {
    toast.info(`${t.ecommerce.syncStarted} ${name}…`);
    try {
      await ecommerceService.syncChannel(id);
      toast.success(`${name} ${t.ecommerce.syncCompleted}.`);
      loadData();
    } catch (err) {
      toast.error("Sync failed.");
    }
  }

  const totalOrdersToday = channelList.reduce((a, c) => a + c.orders_today, 0);
  const connected = channelList.filter((c) => c.status === "connected" || c.status === "syncing").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t.ecommerce.connectedChannels, value: connected, icon: Globe, color: "text-success" },
          { label: t.ecommerce.ordersToday, value: totalOrdersToday, icon: ShoppingCart, color: "text-primary" },
          { label: t.ecommerce.syncQueue, value: channelList.reduce((a, c) => a + c.pending_sync, 0), icon: AlertTriangle, color: "text-warning" },
          { label: t.ecommerce.errors, value: channelList.filter((c) => c.status === "disconnected").length, icon: Package, color: "text-blue-500" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Channels */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Sales channels</h3>
            <PrimaryButton icon={Plus} onClick={() => { setEditMode("connect"); setConnectForm({ name: "", platform: "Shopify", url: "", apiKey: "" }); setShowConnect(true); }}>{t.ecommerce.connectChannel}</PrimaryButton>
          </div>

          {channelList.map((ch, i) => (
            <div key={ch.id} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-secondary flex items-center justify-center text-xl">{platformIcon[ch.platform]}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{ch.name}</span>
                      <StatusBadge status={ch.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">{ch.url}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="text-center hidden sm:block">
                    <div className="font-bold text-foreground text-base" style={{ fontFamily: "JetBrains Mono, monospace" }}>{ch.orders_today}</div>
                    <div>{t.ecommerce.ordersToday}</div>
                  </div>
                  <div className="text-center hidden md:block">
                    <div className="font-bold text-foreground text-base" style={{ fontFamily: "JetBrains Mono, monospace" }}>{ch.products}</div>
                    <div>products</div>
                  </div>
                  {ch.pending_sync > 0 && (
                    <span className="bg-warning/15 text-warning text-[10px] font-bold px-2 py-0.5 rounded-full">{ch.pending_sync} pending</span>
                  )}
                  <div className="flex gap-1">
                    <button onClick={() => handleSync(ch._id, ch.name)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground" title={t.ecommerce.syncNow}>
                      <RefreshCw className={`size-3.5 ${ch.status === "syncing" ? "animate-spin" : ""}`} />
                    </button>
                    <button onClick={() => openEditChannel(ch)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                      <Edit3 className="size-3.5" />
                    </button>
                    <button onClick={() => handleDeleteChannel(ch._id)} className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                <span>Last sync: {ch.synced_at}</span>
                {ch.status === "connected" && (
                  <span className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3" /> Sync active</span>
                )}
                {ch.status === "syncing" && (
                  <span className="flex items-center gap-1 text-info"><RefreshCw className="size-3 animate-spin" /> Syncing…</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Recent orders + Integration tips */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border"><h3 className="font-bold">{t.ecommerce.recentOrders}</h3></div>
            <div className="divide-y divide-border">
              {recentOrders.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">No recent channel orders</div>}
              {recentOrders.map((o) => (
                <div key={o.id} className="p-3 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>{o.id}</span>
                    <span className="text-[10px] text-muted-foreground">{o.time}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{o.customer}</div>
                      <div className="text-xs text-muted-foreground">{o.channel}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{o.total}</div>
                      <StatusBadge status={o.status} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Zap className="size-4 text-amber-500" /> {t.ecommerce.quickConnect}</h3>
            <div className="space-y-2">
              {["Shopify", "Amazon", "WooCommerce", "Zalando", "PrestaShop"].map((p) => (
                <button key={p} onClick={() => handleQuickConnect(p)} className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-secondary transition-colors text-sm">
                  <span className="text-lg">{platformIcon[p] ?? "🔗"}</span>
                  <span className="flex-1 text-left font-medium">{p}</span>
                  <Plus className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Connect channel modal */}
      <Modal open={showConnect} onClose={() => setShowConnect(false)} title={editMode === "connect" ? t.ecommerce.connectChannel : "Edit Channel"} subtitle="Integrate a new sales channel" footer={<><ModalCancel onClose={() => setShowConnect(false)} /><ModalSubmit onClick={handleConnect}>{editMode === "connect" ? t.common.connect : "Save Changes"}</ModalSubmit></>}>
        <Row>
          <Field label={t.ecommerce.platform}><Select value={connectForm.platform} onChange={(e) => setConnectForm({ ...connectForm, platform: e.target.value })}>
            {["Shopify","Amazon","WooCommerce","eBay","Mirakl","Zalando","PrestaShop","Magento"].map((p) => <option key={p}>{p}</option>)}
          </Select></Field>
          <Field label={t.ecommerce.displayName} required><Input value={connectForm.name} onChange={(e) => setConnectForm({ ...connectForm, name: e.target.value })} placeholder="My Shopify Store" /></Field>
        </Row>
        <Field label={t.ecommerce.storeUrl} required><Input value={connectForm.url} onChange={(e) => setConnectForm({ ...connectForm, url: e.target.value })} placeholder="store.myshopify.com" /></Field>
        <Field label={t.ecommerce.apiKey} hint="Will be stored encrypted"><Input type="password" value={connectForm.apiKey} onChange={(e) => setConnectForm({ ...connectForm, apiKey: e.target.value })} placeholder="sk_live_..." /></Field>
      </Modal>
    </div>
  );
}
