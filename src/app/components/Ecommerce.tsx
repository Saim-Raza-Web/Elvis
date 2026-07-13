import { useState } from "react";
import { Globe, Plus, RefreshCw, ShoppingCart, Package, AlertTriangle, CheckCircle2, ArrowUpRight, Zap } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { useLang } from "../LangContext";

const channels = [
  { id: "1", name: "Shopify — demologistics", platform: "Shopify", url: "demologistics.myshopify.com", status: "connected", orders_today: 14, synced_at: "2026-06-26 10:42", products: 1240, pending_sync: 0 },
  { id: "2", name: "Amazon EU", platform: "Amazon", url: "amazon.co.uk seller", status: "connected", orders_today: 31, synced_at: "2026-06-26 10:38", products: 320, pending_sync: 2 },
  { id: "3", name: "WooCommerce Store", platform: "WooCommerce", url: "shop.demologistics.io", status: "syncing", orders_today: 5, synced_at: "2026-06-26 10:00", products: 890, pending_sync: 8 },
  { id: "4", name: "eBay Listings", platform: "eBay", url: "ebay.com/usr/demolog", status: "disconnected", orders_today: 0, synced_at: "2026-06-20 09:00", products: 120, pending_sync: 0 },
  { id: "5", name: "Mirakl Marketplace", platform: "Mirakl", url: "marketplace.mirakl.net", status: "connected", orders_today: 7, synced_at: "2026-06-26 10:30", products: 450, pending_sync: 1 },
];

const platformIcon: Record<string, string> = {
  Shopify: "🟢",
  Amazon: "🟠",
  WooCommerce: "🔵",
  eBay: "🔴",
  Mirakl: "🟣",
};

const recentChannelOrders = [
  { id: "ORD-SH-4421", channel: "Shopify", customer: "Maria G.", total: 89.99, status: "processing", time: "10:41" },
  { id: "ORD-AMZ-8812", channel: "Amazon", customer: "John D.", total: 124.50, status: "pending", time: "10:38" },
  { id: "ORD-AMZ-8810", channel: "Amazon", customer: "Sara L.", total: 45.00, status: "shipped", time: "10:22" },
  { id: "ORD-SH-4418", channel: "Shopify", customer: "Tom K.", total: 210.00, status: "processing", time: "10:10" },
  { id: "ORD-MIR-0092", channel: "Mirakl", customer: "Priya M.", total: 67.80, status: "pending", time: "09:55" },
];

export function Ecommerce() {
  const { t } = useLang();
  const [channelList, setChannelList] = useState(channels);
  const [search, setSearch] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [connectForm, setConnectForm] = useState({ name: "", platform: "Shopify", url: "", apiKey: "" });

  function handleConnect() {
    if (!connectForm.name || !connectForm.url) { toast.error("Channel name and URL required."); return; }
    setChannelList((prev) => [...prev, { id: String(Date.now()), name: connectForm.name, platform: connectForm.platform, url: connectForm.url, status: "syncing", orders_today: 0, synced_at: "Just now", products: 0, pending_sync: 0 }]);
    toast.success(`${t.ecommerce.channelConnected}: ${connectForm.name}`);
    setShowConnect(false);
    setConnectForm({ name: "", platform: "Shopify", url: "", apiKey: "" });
  }

  function handleQuickConnect(platform: string) {
    setConnectForm((f) => ({ ...f, platform, name: platform + " Store" }));
    setShowConnect(true);
  }

  function handleSync(id: string, name: string) {
    toast.info(`${t.ecommerce.syncStarted} ${name}…`);
    setTimeout(() => toast.success(`${name} ${t.ecommerce.syncCompleted}.`), 1500);
  }

  const totalOrdersToday = channelList.reduce((a, c) => a + c.orders_today, 0);
  const connected = channelList.filter((c) => c.status === "connected").length;

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
            <PrimaryButton icon={Plus} onClick={() => setShowConnect(true)}>{t.ecommerce.connectChannel}</PrimaryButton>
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
                    <button onClick={() => handleSync(ch.id, ch.name)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground" title={t.ecommerce.syncNow}>
                      <RefreshCw className="size-3.5" />
                    </button>
                    <button className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                      <ArrowUpRight className="size-3.5" />
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
              {recentChannelOrders.map((o) => (
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
      <Modal open={showConnect} onClose={() => setShowConnect(false)} title={t.ecommerce.connectChannel} subtitle="Integrate a new sales channel" footer={<><ModalCancel onClose={() => setShowConnect(false)} /><ModalSubmit onClick={handleConnect}>{t.common.connect}</ModalSubmit></>}>
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
