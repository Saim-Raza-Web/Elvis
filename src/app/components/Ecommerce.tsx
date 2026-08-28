import { useState, useEffect } from "react";
import { 
  Globe, Plus, RefreshCw, ShoppingCart, Package, AlertTriangle, CheckCircle2, 
  ArrowUpRight, Zap, Settings2, Power, History, ExternalLink, ShieldCheck, 
  Layers, ArrowRight, ArrowLeft, ArrowLeftRight, Clock, Search, ChevronRight, HelpCircle,
  Info, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, SecondaryButton, StatusBadge } from "./AppShell";
import { Modal, Field, Input, Select, Row, ModalCancel, ModalSubmit } from "./Modal";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { 
  integrationsService, 
  type ConnectedStore, 
  type IntegrationProviderInfo, 
  type IntegrationSyncLog 
} from "../../services/integrations.service";
import { ordersService } from "../../services/orders.service";

// ── Brand SVG Logos for All 16 4Seller Marketplaces ─────────────────────────
export function AmazonLogo({ className }: { className?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
      <svg viewBox="0 0 102 30" fill="none" className="w-[80px] h-auto">
        <text x="2" y="21" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="22" fill="currentColor">amazon</text>
        <path d="M14 25c16 7 34 5 46-2" stroke="#FF9900" strokeWidth="3" strokeLinecap="round" />
        <path d="M57 21.5l5 2.5-4 3" fill="#FF9900" stroke="#FF9900" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function EbayLogo({ className = "h-6 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center">
      <svg className={className} viewBox="0 0 76 28" fill="none" style={{ minWidth: '68px' }}>
        <text x="2" y="21" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="25" fill="#E53238">e</text>
        <text x="17" y="21" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="25" fill="#0064D2">b</text>
        <text x="32" y="21" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="25" fill="#F5AF02">a</text>
        <text x="47" y="21" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontSize="25" fill="#86B817">y</text>
      </svg>
    </div>
  );
}

export function WalmartLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center gap-1 font-black text-[#0071DC] tracking-tight">
      <span className="text-[16px] font-black font-sans">Walmart</span>
      <svg className="size-4" viewBox="0 0 24 24" fill="none">
        <path d="M12 2v5M12 17v5M3.5 7l4.3 2.5M16.2 14.5l4.3 2.5M3.5 17l4.3-2.5M16.2 9.5l4.3-2.5" stroke="#FFC220" strokeWidth="3" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

export function TikTokShopLogo({ className }: { className?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
      <svg className="size-7" viewBox="0 0 24 24" fill="none">
        <path d="M12 3a4 4 0 004 4h1v3a7 7 0 01-5-2v7a5 5 0 11-5-5c.4 0 .7 0 1 .1V13a2.5 2.5 0 102.5 2.5V3z" fill="currentColor"/>
        <path d="M11.5 3.5a4 4 0 004 4h.5v1.5a5.5 5.5 0 01-4.5-2v7a5 5 0 11-5-5c.4 0 .7 0 1 .1v1.5a3.5 3.5 0 103.5 3.4V3.5z" fill="#25F4EE" style={{ mixBlendMode: 'screen' }}/>
        <path d="M12.5 3.5a4 4 0 004 4h.5v1.5a5.5 5.5 0 01-4.5-2v7a5 5 0 11-5-5c.4 0 .7 0 1 .1v1.5a3.5 3.5 0 103.5 3.4V3.5z" fill="#FE2C55" style={{ mixBlendMode: 'screen' }}/>
      </svg>
      <span className="text-[10px] font-black tracking-tight text-foreground leading-none">TikTok Shop</span>
    </div>
  );
}

export function ShopifyLogo({ className }: { className?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
      <svg className="size-7" viewBox="0 0 24 24" fill="none">
        <path d="M17.5 7.8l-1.8-2.4c-.3-.4-.7-.6-1.1-.6h-5.2c-.4 0-.8.2-1.1.6L6.5 7.8c-.3.4-.4.8-.3 1.2l1.6 8.5c.2.8.8 1.4 1.6 1.4h5.2c.8 0 1.4-.6 1.6-1.4l1.6-8.5c.1-.4 0-.8-.3-1.2z" fill="#5E8E3E"/>
        <path d="M13.8 9.5c-.2-.5-.7-.8-1.3-.8-.7 0-1.2.4-1.2 1 0 1.1 2.2 1 2.2 2.6 0 .9-.7 1.5-1.8 1.5-1 0-1.6-.5-1.8-1.1l1-.4c.1.3.4.6.8.6.5 0 .8-.2.8-.6 0-1.1-2.2-.9-2.2-2.5 0-1 .8-1.6 1.9-1.6.9 0 1.4.4 1.7 1l-1 .4z" fill="#FFFFFF"/>
      </svg>
      <span className="text-[10px] font-bold text-foreground tracking-tight leading-none">shopify</span>
    </div>
  );
}

export function EtsyLogo({ className = "h-6 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center">
      <span className="text-[19px] font-serif font-bold text-[#F1641E] tracking-wider">Etsy</span>
    </div>
  );
}

export function WooCommerceLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="bg-[#7F54B3] text-white px-1.5 py-0.5 rounded text-[9.5px] font-black tracking-tighter">WOO</div>
      <span className="text-[11px] font-bold text-[#7F54B3] tracking-tight">COMMERCE</span>
    </div>
  );
}

export function TemuLogo({ className }: { className?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
      <div className="size-7 rounded-full bg-[#FB5F00] flex items-center justify-center">
        <span className="text-white font-black text-[11px] leading-none">T</span>
      </div>
      <span className="text-[10px] font-black text-[#FB5F00] tracking-wider leading-none">TEMU</span>
    </div>
  );
}

export function SheinLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center">
      <span className="text-[14px] font-black tracking-[0.22em] text-foreground uppercase">SHEIN</span>
    </div>
  );
}

export function AliExpressLogo({ className }: { className?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
      <div className="size-7 rounded-lg bg-[#E62E04] flex items-center justify-center">
        <span className="text-white font-black text-[11px] leading-none">AE</span>
      </div>
      <span className="text-[9.5px] font-black text-[#E62E04] tracking-tight leading-none">AliExpress</span>
    </div>
  );
}

export function KauflandLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="border-[1.5px] border-[#E10915] p-0.5 rounded-xs">
        <div className="bg-[#E10915] text-white font-black text-[9px] px-1">K</div>
      </div>
      <span className="text-[12px] font-black text-[#E10915] tracking-tight">Kaufland</span>
    </div>
  );
}

export function OttoLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center">
      <span className="text-[18px] font-black italic text-[#E30613] tracking-wider font-sans">OTTO</span>
    </div>
  );
}

export function CdiscountLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center gap-1 text-[#2B3990] font-black text-[13px] tracking-tight">
      <span>Cdiscount</span>
      <span className="text-[#F15A24] text-[10px]">📢</span>
    </div>
  );
}

export function MiraviaLogo({ className }: { className?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 w-full h-full">
      <svg className="size-7" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 12l10 10 10-10L12 2z" fill="#7822FF"/>
        <path d="M12 2l-6 10h12L12 2z" fill="#9955FF"/>
      </svg>
      <span className="text-[10px] font-bold text-foreground tracking-tight leading-none">Miravia</span>
    </div>
  );
}

export function PrestaShopLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <div className="size-4.5 rounded-full bg-[#DF0067] flex items-center justify-center text-white text-[10px] font-black">🐧</div>
      <span className="text-[12px] font-bold text-foreground">Presta<span className="text-[#DF0067]">Shop</span></span>
    </div>
  );
}

export function ManualLogo({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 text-emerald-600 font-bold text-[13px]">
      <div className="size-4.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 font-bold text-[10px]">
        🏪
      </div>
      <span className="text-foreground font-bold">Manual</span>
    </div>
  );
}

export function PlatformBrandLogo({ code }: { code: string }) {
  switch (code?.toUpperCase()) {
    case "AMAZON":
      return <AmazonLogo />;
    case "EBAY":
      return <EbayLogo />;
    case "WALMART":
      return <WalmartLogo />;
    case "TIKTOK_SHOP":
      return <TikTokShopLogo />;
    case "SHOPIFY":
      return <ShopifyLogo />;
    case "ETSY":
      return <EtsyLogo />;
    case "WOOCOMMERCE":
      return <WooCommerceLogo />;
    case "TEMU":
      return <TemuLogo />;
    case "SHEIN":
      return <SheinLogo />;
    case "ALIEXPRESS":
      return <AliExpressLogo />;
    case "KAUFLAND":
      return <KauflandLogo />;
    case "OTTO":
      return <OttoLogo />;
    case "CDISCOUNT":
      return <CdiscountLogo />;
    case "MIRAVIA":
      return <MiraviaLogo />;
    case "PRESTASHOP":
      return <PrestaShopLogo />;
    case "MANUAL":
      return <ManualLogo />;
    default:
      return <span className="font-bold text-xs text-foreground">{code}</span>;
  }
}

// ── 16 Platforms Grid List matching 4Seller UI ─────────────────────────────
export const PLATFORM_GRID_LIST = [
  { code: "TEMU", name: "Temu", badge: "" },
  { code: "AMAZON", name: "Amazon", badge: "" },
  { code: "MIRAVIA", name: "Miravia", badge: "" },
  { code: "ALIEXPRESS", name: "AliExpress", badge: "" },
  { code: "SHOPIFY", name: "Shopify", badge: "" },
  { code: "TIKTOK_SHOP", name: "TikTok Shop", badge: "" },
];


export function StoreBrandIcon({ provider, className = "size-5" }: { provider: string; className?: string }) {
  switch (provider?.toUpperCase()) {
    case "AMAZON":
      return <AmazonLogo className={className} />;
    case "TEMU":
      return <TemuLogo className={className} />;
    case "MIRAVIA":
      return <MiraviaLogo className={className} />;
    case "ALIEXPRESS":
      return <AliExpressLogo className={className} />;
    case "SHOPIFY":
      return <ShopifyLogo className={className} />;
    case "TIKTOK_SHOP":
      return <TikTokShopLogo className={className} />;
    case "WOOCOMMERCE":
      return <WooCommerceLogo className={className} />;
    case "EBAY":
      return <EbayLogo className={className} />;
    case "WALMART":
      return <WalmartLogo className={className} />;
    case "ETSY":
      return <EtsyLogo className={className} />;
    case "SHEIN":
      return <SheinLogo className={className} />;
    case "KAUFLAND":
      return <KauflandLogo className={className} />;
    case "OTTO":
      return <OttoLogo className={className} />;
    case "CDISCOUNT":
      return <CdiscountLogo className={className} />;
    case "PRESTASHOP":
      return <PrestaShopLogo className={className} />;
    case "MANUAL":
      return <ManualLogo className={className} />;
    default:
      return <Globe className={`${className} text-primary`} />;
  }
}

type ActiveTab = "stores" | "logs" | "orders";

const providerBadges: Record<string, { bg: string; color: string; label: string }> = {
  AMAZON: { bg: "bg-amber-500/10 text-amber-600 border-amber-500/20", color: "text-amber-600", label: "Amazon SP-API" },
  TEMU: { bg: "bg-orange-500/10 text-orange-600 border-orange-500/20", color: "text-orange-600", label: "Temu" },
  MIRAVIA: { bg: "bg-purple-500/10 text-purple-600 border-purple-500/20", color: "text-purple-600", label: "Miravia EU" },
  ALIEXPRESS: { bg: "bg-red-500/10 text-red-600 border-red-500/20", color: "text-red-600", label: "AliExpress" },
  SHOPIFY: { bg: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", color: "text-emerald-600", label: "Shopify" },
  TIKTOK_SHOP: { bg: "bg-pink-500/10 text-pink-600 border-pink-500/20", color: "text-pink-600", label: "TikTok Shop" },
  WOOCOMMERCE: { bg: "bg-blue-500/10 text-blue-600 border-blue-500/20", color: "text-blue-600", label: "WooCommerce" },
  EBAY: { bg: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", color: "text-yellow-600", label: "eBay" },
  WALMART: { bg: "bg-blue-600/10 text-blue-600 border-blue-600/20", color: "text-blue-600", label: "Walmart" },
  ETSY: { bg: "bg-orange-600/10 text-orange-600 border-orange-600/20", color: "text-orange-600", label: "Etsy" },
  SHEIN: { bg: "bg-neutral-800/10 text-neutral-800 dark:text-neutral-200 border-neutral-800/20", color: "text-neutral-800", label: "SHEIN" },
  KAUFLAND: { bg: "bg-red-600/10 text-red-600 border-red-600/20", color: "text-red-600", label: "Kaufland" },
  OTTO: { bg: "bg-red-500/10 text-red-500 border-red-500/20", color: "text-red-500", label: "OTTO" },
  CDISCOUNT: { bg: "bg-indigo-600/10 text-indigo-600 border-indigo-600/20", color: "text-indigo-600", label: "Cdiscount" },
  PRESTASHOP: { bg: "bg-pink-600/10 text-pink-600 border-pink-600/20", color: "text-pink-600", label: "PrestaShop" },
  MANUAL: { bg: "bg-emerald-600/10 text-emerald-600 border-emerald-600/20", color: "text-emerald-600", label: "Manual" },
};

const REGION_SITES_CONFIG: Record<string, {
  regions: string[];
  sites: Record<string, { id: string; label: string }[]>;
  defaultSites: string[];
  notice: string;
  guideTitle: string;
  guideSteps: string[];
  guideNotes: string[];
}> = {
  AMAZON: {
    regions: ["North American region", "European region", "Far East / Asia-Pacific region"],
    sites: {
      "North American region": [
        { id: "US", label: "US Site" },
        { id: "CA", label: "Canada Site" },
        { id: "MX", label: "Mexico Site" },
        { id: "BR", label: "Brazil Site" }
      ],
      "European region": [
        { id: "ES", label: "Spain Site (ES)" },
        { id: "DE", label: "Germany Site (DE)" },
        { id: "FR", label: "France Site (FR)" },
        { id: "IT", label: "Italy Site (IT)" },
        { id: "UK", label: "UK Site (UK)" },
        { id: "NL", label: "Netherlands Site (NL)" },
        { id: "SE", label: "Sweden Site (SE)" },
        { id: "PL", label: "Poland Site (PL)" }
      ],
      "Far East / Asia-Pacific region": [
        { id: "JP", label: "Japan Site (JP)" },
        { id: "SG", label: "Singapore Site (SG)" },
        { id: "AU", label: "Australia Site (AU)" }
      ]
    },
    defaultSites: ["US", "CA"],
    notice: "You need an Amazon Professional Seller account to sell on Amazon.",
    guideTitle: "How to authorize an Amazon shop to 4Seller?",
    guideSteps: [
      "Step 1: After entering the Amazon shop authorization page, enter a custom shop name (i.e., the shop name managed by 4Seller), select the corresponding country site (4Seller supports US/EU site), and click Connect.",
      "Step 2: After clicking Connect, you will be redirected to the Amazon login page. Enter your Amazon account password to log in (only Amazon main account authorization is supported, not sub-account authorization).",
      "Step 3: Complete Shop Authorization: After successfully logging into your Amazon account, click Confirm to authorize the shop to 4Seller. 'Activated' indicates that the authorized shop is successful, and you can then use 4Seller to complete online product synchronization, order processing, inventory synchronization, and other operations!"
    ],
    guideNotes: [
      "Note 1: If you need to authorize 2 or more Amazon shops, please log out of the already authorized Amazon shop account on Amazon after successful authorization, then log in to the new Amazon shop, and then proceed to authorize it on 4Seller!",
      "Note 2: These errors may also occur when the store status is abnormal, such as: subscription not renewed, store has policy violations, newly registered, or status still under review."
    ]
  },
  TIKTOK_SHOP: {
    regions: ["North America", "Europe (UK & EU Sites)", "Southeast Asia"],
    sites: {
      "North America": [
        { id: "US", label: "US Shop" }
      ],
      "Europe (UK & EU Sites)": [
        { id: "UK", label: "UK Shop" },
        { id: "ES", label: "Spain Shop (ES)" },
        { id: "DE", label: "Germany Shop (DE)" },
        { id: "FR", label: "France Shop (FR)" },
        { id: "IT", label: "Italy Shop (IT)" }
      ],
      "Southeast Asia": [
        { id: "SG", label: "Singapore Shop" },
        { id: "MY", label: "Malaysia Shop" },
        { id: "PH", label: "Philippines Shop" },
        { id: "TH", label: "Thailand Shop" },
        { id: "VN", label: "Vietnam Shop" }
      ]
    },
    defaultSites: ["US"],
    notice: "Note: Only the primary TikTok account holds the authorization to connect with 4Seller; if using a sub-account, you need to switch to the primary account before binding the TikTok store.",
    guideTitle: "How to Authorize TikTok Shop with 4Seller?",
    guideSteps: [
      "Entrance 1 (Setup Wizard) & Entrance 2 (Shop Manage): Click the TikTok Shop icon to enter the store authorization page.",
      "Step 1 & 2: Enter the customized store name, select your target region/country sites, and click Connect. It will automatically jump to the authorization page of the TikTok Seller Center.",
      "Step 3: After entering the authorization page of the TikTok Seller Center, select your region, and then click Next to enter the authorization page in the App & Service Store.",
      "Step 4: (1) Check whether the authorized Target Shop is correct (on EU site stores, associated site stores can be authorized together); (2) Select authorization duration; (3) Enter your contact email; (4) Check precaution boxes; (5) Click Confirm to install.",
      "Step 5: On the final authorization page, wait for 3 seconds. The Authorize button will become clickable. Click Authorize to successfully authorize the store. The status will become 'Activated' in 4Seller!"
    ],
    guideNotes: [
      "Note: If you need to authorize two or more TikTok stores, please log out of the authorized store account in the TikTok Seller Center after successful authorization, then log in to the new TikTok store for authorization."
    ]
  },
  TEMU: {
    regions: ["US MMS Region", "European MMS Region", "Global Cross-Border"],
    sites: {
      "US MMS Region": [
        { id: "US", label: "US Site" },
        { id: "CA", label: "Canada Site" }
      ],
      "European MMS Region": [
        { id: "ES", label: "Spain Site (ES)" },
        { id: "DE", label: "Germany Site (DE)" },
        { id: "FR", label: "France Site (FR)" },
        { id: "IT", label: "Italy Site (IT)" },
        { id: "UK", label: "UK Site (UK)" }
      ],
      "Global Cross-Border": [
        { id: "GLOBAL", label: "Global MMS Site" }
      ]
    },
    defaultSites: ["US"],
    notice: "You need a registered Temu Merchant account (MMS) to sell on Temu.",
    guideTitle: "How to authorize a Temu shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter your custom shop name, select MMS region (US, EU, or Global Cross-Border), and click Connect.",
      "Step 2: Log in to the Temu Open Platform with your primary merchant credentials.",
      "Step 3: Grant catalog, order management, and stock synchronization permissions. Once authorized, the shop becomes 'Activated'!"
    ],
    guideNotes: [
      "Note: Ensure your Temu MMS merchant account has active API permissions enabled in the Seller Center."
    ]
  },
  MIRAVIA: {
    regions: ["Iberia & Southern Europe"],
    sites: {
      "Iberia & Southern Europe": [
        { id: "ES", label: "Spain Site (ES)" },
        { id: "PT", label: "Portugal Site (PT)" },
        { id: "IT", label: "Italy Site (IT)" }
      ]
    },
    defaultSites: ["ES", "PT"],
    notice: "You need a registered Miravia EU Merchant account for Spanish and European marketplace sales.",
    guideTitle: "How to authorize a Miravia shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter your custom store name and select Iberia / Southern Europe target sites (Spain, Portugal, Italy).",
      "Step 2: Log in to the Miravia Open Platform portal with your seller account.",
      "Step 3: Confirm authorization to link catalog, fulfillment, and real-time inventory sync."
    ],
    guideNotes: [
      "Note: Ensure you are logged into your primary Miravia brand merchant account."
    ]
  },
  ALIEXPRESS: {
    regions: ["Cross-Border Region", "European Local Plaza"],
    sites: {
      "Cross-Border Region": [
        { id: "GLOBAL", label: "Global Cross-Border" },
        { id: "RU", label: "CIS / Russian Site" }
      ],
      "European Local Plaza": [
        { id: "ES", label: "Spain Plaza (ES)" },
        { id: "FR", label: "France Local (FR)" },
        { id: "IT", label: "Italy Local (IT)" }
      ]
    },
    defaultSites: ["GLOBAL"],
    notice: "You need an AliExpress Seller / Open Platform account.",
    guideTitle: "How to authorize an AliExpress shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and choose Cross-Border or European Local Plaza (Spain, France, Italy).",
      "Step 2: Log in to the AliExpress TOP OAuth portal with your merchant account.",
      "Step 3: Authorize store management to enable automatic order processing."
    ],
    guideNotes: [
      "Note: Both Global cross-border and local European Plaza sellers are supported."
    ]
  },
  SHOPIFY: {
    regions: ["Global Cloud"],
    sites: {
      "Global Cloud": [
        { id: "GLOBAL", label: "Primary Storefront" }
      ]
    },
    defaultSites: ["GLOBAL"],
    notice: "Enter your .myshopify.com store domain to grant official app permissions.",
    guideTitle: "How to authorize a Shopify store to 4Seller?",
    guideSteps: [
      "Step 1: Enter your custom name and Shopify store domain (e.g. my-brand.myshopify.com).",
      "Step 2: Click Connect to open your Shopify Admin app installation page.",
      "Step 3: Click 'Install app' to grant inventory and orders read/write access. Status will update to 'Activated'!"
    ],
    guideNotes: [
      "Note: You must have store admin or owner permissions in Shopify."
    ]
  },
  WOOCOMMERCE: {
    regions: ["Self-Hosted / Managed"],
    sites: {
      "Self-Hosted / Managed": [
        { id: "GLOBAL", label: "Primary WordPress Site" }
      ]
    },
    defaultSites: ["GLOBAL"],
    notice: "Enter your WordPress WooCommerce store URL with REST API enabled.",
    guideTitle: "How to authorize a WooCommerce store to 4Seller?",
    guideSteps: [
      "Step 1: Enter your custom store name and WordPress website URL (https://www.yourstore.com).",
      "Step 2: Click Connect to authorize the WooCommerce REST API endpoint.",
      "Step 3: Click 'Approve' on your WordPress admin prompt to generate secure read/write keys."
    ],
    guideNotes: [
      "Note: Ensure HTTPS is enabled and Pretty Permalinks are active on your WordPress site."
    ]
  },
  EBAY: {
    regions: ["North America", "Europe", "Asia Pacific"],
    sites: {
      "North America": [
        { id: "US", label: "US Site (eBay.com)" },
        { id: "CA", label: "Canada Site" }
      ],
      "Europe": [
        { id: "ES", label: "Spain Site (eBay.es)" },
        { id: "DE", label: "Germany Site (eBay.de)" },
        { id: "UK", label: "UK Site (eBay.co.uk)" },
        { id: "FR", label: "France Site (eBay.fr)" },
        { id: "IT", label: "Italy Site (eBay.it)" }
      ],
      "Asia Pacific": [
        { id: "AU", label: "Australia Site" }
      ]
    },
    defaultSites: ["US"],
    notice: "You need an active eBay Seller account.",
    guideTitle: "How to authorize an eBay shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name, select marketplace region (US, EU, UK, AU), and click Connect.",
      "Step 2: Sign in to your eBay Seller account on eBay's OAuth consent screen.",
      "Step 3: Click 'Agree' to authorize 4Seller for inventory management and order fulfillment."
    ],
    guideNotes: [
      "Note: If authorizing multiple eBay accounts, log out of eBay in your browser before connecting the next store."
    ]
  },
  WALMART: {
    regions: ["US Marketplace", "Canada Marketplace", "Mexico Marketplace"],
    sites: {
      "US Marketplace": [{ id: "US", label: "Walmart.com (US)" }],
      "Canada Marketplace": [{ id: "CA", label: "Walmart.ca (Canada)" }],
      "Mexico Marketplace": [{ id: "MX", label: "Walmart.com.mx (Mexico)" }]
    },
    defaultSites: ["US"],
    notice: "You need an approved Walmart Marketplace Seller account with Client ID and Client Secret.",
    guideTitle: "How to authorize a Walmart shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and select Walmart US, CA, or MX marketplace region.",
      "Step 2: Sign in to Walmart Developer Portal (developer.walmart.com) to generate API keys.",
      "Step 3: Connect and grant inventory & order sync permissions to 4Seller."
    ],
    guideNotes: [
      "Note: Requires Walmart Marketplace Developer Portal API credentials."
    ]
  },
  ETSY: {
    regions: ["Global Marketplace"],
    sites: {
      "Global Marketplace": [{ id: "GLOBAL", label: "Etsy Global Shop" }]
    },
    defaultSites: ["GLOBAL"],
    notice: "You need an active Etsy Seller account.",
    guideTitle: "How to authorize an Etsy shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and click Connect.",
      "Step 2: Log in to Etsy and approve OAuth 2.0 app authorization for 4Seller.",
      "Step 3: Confirm shop connection to sync listings and orders."
    ],
    guideNotes: [
      "Note: Etsy stores use official OAuth 2.0 PKCE authorization."
    ]
  },
  SHEIN: {
    regions: ["US Marketplace", "European Marketplace", "Global Cross-Border"],
    sites: {
      "US Marketplace": [{ id: "US", label: "SHEIN US Marketplace" }],
      "European Marketplace": [
        { id: "ES", label: "Spain (ES)" },
        { id: "DE", label: "Germany (DE)" },
        { id: "FR", label: "France (FR)" },
        { id: "IT", label: "Italy (IT)" }
      ],
      "Global Cross-Border": [{ id: "GLOBAL", label: "SHEIN Global Marketplace" }]
    },
    defaultSites: ["ES", "US"],
    notice: "You need a registered SHEIN Marketplace Seller account with Open API permissions.",
    guideTitle: "How to authorize a SHEIN shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and select target marketplace region.",
      "Step 2: Authorize via SHEIN Seller Open Platform.",
      "Step 3: Confirm shop connection to sync catalog and orders."
    ],
    guideNotes: [
      "Note: Both Global cross-border and local European marketplace sellers are supported."
    ]
  },
  KAUFLAND: {
    regions: ["Kaufland Global Marketplace"],
    sites: {
      "Kaufland Global Marketplace": [
        { id: "DE", label: "Kaufland.de (Germany)" },
        { id: "CZ", label: "Kaufland.cz (Czech Republic)" },
        { id: "SK", label: "Kaufland.sk (Slovakia)" },
        { id: "PL", label: "Kaufland.pl (Poland)" },
        { id: "AT", label: "Kaufland.at (Austria)" }
      ]
    },
    defaultSites: ["DE"],
    notice: "You need an active Kaufland Global Marketplace seller account with API credentials.",
    guideTitle: "How to authorize a Kaufland shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and select European country sites.",
      "Step 2: Enter API Key and Secret from Kaufland Seller Portal.",
      "Step 3: Connect and start order synchronization."
    ],
    guideNotes: [
      "Note: Kaufland stores support multi-country European marketplace fulfillment."
    ]
  },
  OTTO: {
    regions: ["Germany / European Market"],
    sites: {
      "Germany / European Market": [{ id: "DE", label: "OTTO Market Germany (OTTO.de)" }]
    },
    defaultSites: ["DE"],
    notice: "You need a registered OTTO Market partner account.",
    guideTitle: "How to authorize an OTTO shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom store name.",
      "Step 2: Authenticate with OTTO Partner API.",
      "Step 3: Complete store connection."
    ],
    guideNotes: [
      "Note: OTTO marketplace requires partner approval."
    ]
  },
  CDISCOUNT: {
    regions: ["France & European Market"],
    sites: {
      "France & European Market": [
        { id: "FR", label: "Cdiscount France (FR)" },
        { id: "BE", label: "Cdiscount Belgium (BE)" },
        { id: "ES", label: "Cdiscount Spain (ES)" },
        { id: "IT", label: "Cdiscount Italy (IT)" }
      ]
    },
    defaultSites: ["FR"],
    notice: "You need an active Cdiscount Marketplace seller account with API access.",
    guideTitle: "How to authorize a Cdiscount shop to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and select target country sites.",
      "Step 2: Authorize via Cdiscount Marketplace API.",
      "Step 3: Complete authorization and start sync."
    ],
    guideNotes: [
      "Note: Cdiscount Octopia marketplace API credentials required."
    ]
  },
  PRESTASHOP: {
    regions: ["Self-Hosted / Cloud"],
    sites: {
      "Self-Hosted / Cloud": [{ id: "GLOBAL", label: "Primary PrestaShop Store" }]
    },
    defaultSites: ["GLOBAL"],
    notice: "Enter your PrestaShop store URL with WebService API enabled.",
    guideTitle: "How to authorize a PrestaShop store to 4Seller?",
    guideSteps: [
      "Step 1: Enter custom shop name and PrestaShop store URL (https://www.yourprestashop.com).",
      "Step 2: Generate WebService API Key in PrestaShop Back Office (Advanced Parameters > Webservice).",
      "Step 3: Connect and verify synchronization."
    ],
    guideNotes: [
      "Note: Ensure HTTPS is enabled and WebService permissions are granted in PrestaShop."
    ]
  },
  MANUAL: {
    regions: ["Custom Warehouse Channel"],
    sites: {
      "Custom Warehouse Channel": [{ id: "GLOBAL", label: "Default Warehouse Channel" }]
    },
    defaultSites: ["GLOBAL"],
    notice: "Create a manual shop channel to import orders via Excel/CSV and manage custom stock.",
    guideTitle: "How to set up a Manual Store Channel?",
    guideSteps: [
      "Step 1: Enter custom store name.",
      "Step 2: Choose default fulfillment warehouse.",
      "Step 3: Click Connect to create the channel for manual order entries & CSV imports."
    ],
    guideNotes: [
      "Note: Manual channels do not require external marketplace credentials."
    ]
  }
};

const PROVIDER_NAMES: Record<string, string> = {
  AMAZON: "Amazon",
  EBAY: "eBay",
  WALMART: "Walmart",
  TIKTOK_SHOP: "TikTok Shop",
  SHOPIFY: "Shopify",
  ETSY: "Etsy",
  WOOCOMMERCE: "WooCommerce",
  TEMU: "Temu",
  SHEIN: "SHEIN",
  ALIEXPRESS: "AliExpress",
  KAUFLAND: "Kaufland",
  OTTO: "OTTO",
  CDISCOUNT: "Cdiscount",
  MIRAVIA: "Miravia",
  PRESTASHOP: "PrestaShop",
  MANUAL: "Manual"
};

export function Ecommerce() {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState<ActiveTab>("stores");

  // Stores state
  const [stores, setStores] = useState<ConnectedStore[]>([]);
  const [providers, setProviders] = useState<IntegrationProviderInfo[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [syncingStoreIds, setSyncingStoreIds] = useState<Record<string, boolean>>({});

  // Sync History state
  const [syncLogs, setSyncLogs] = useState<IntegrationSyncLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logPagination, setLogPagination] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);

  const [selectedLog, setSelectedLog] = useState<IntegrationSyncLog | null>(null);

  // Recent Marketplace Orders state
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  // ── Connect Store Wizard Modal State (4Seller 2-Step Experience) ──
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectStep, setConnectStep] = useState<"SELECT_PLATFORM" | "CONFIGURE_STORE">("SELECT_PLATFORM");
  const [selectedProvider, setSelectedProvider] = useState<string>("AMAZON");
  const [customShopName, setCustomShopName] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string>("North American region");
  const [selectedSites, setSelectedSites] = useState<string[]>(["US", "CA"]);
  const [contactEmail, setContactEmail] = useState<string>("");
  const [temuShopType, setTemuShopType] = useState<string>("Semi-Managed (Half-Managed)");
  const [temuSiteCountry, setTemuSiteCountry] = useState<string>("US");
  const [temuToken, setTemuToken] = useState<string>("");
  const [showHelpGuide, setShowHelpGuide] = useState<boolean>(false);
  const [shopDomain, setShopDomain] = useState<string>("");
  const [storeUrl, setStoreUrl] = useState<string>("");
  const [isSandbox, setIsSandbox] = useState<boolean>(true);
  const [connecting, setConnecting] = useState(false);

  // Helper to open connect modal at Step 1 (Platform Grid)
  function handleOpenConnectModal() {
    setConnectStep("SELECT_PLATFORM");
    setShowConnectModal(true);
  }

  // Helper to select platform card in Step 1 Grid and transition to Step 2 Form
  function handleSelectPlatformCard(pCode: string) {
    handleSelectProvider(pCode);
    setConnectStep("CONFIGURE_STORE");
  }

  // Helper to change provider in Connect Modal
  function handleSelectProvider(pCode: string) {
    setSelectedProvider(pCode);
    const conf = REGION_SITES_CONFIG[pCode];
    if (conf) {
      const firstReg = conf.regions[0] || "";
      setSelectedRegion(firstReg);
      setSelectedSites(conf.defaultSites || []);
    }
    setCustomShopName("");
    setContactEmail("");
    setTemuToken("");
    setTemuShopType("Semi-Managed (Half-Managed)");
    setTemuSiteCountry("US");
    setShowHelpGuide(false);
  }

  // Helper to change region in Connect Modal
  function handleRegionChange(reg: string) {
    setSelectedRegion(reg);
    const conf = REGION_SITES_CONFIG[selectedProvider];
    if (conf && conf.sites[reg]) {
      setSelectedSites(conf.sites[reg].map(s => s.id));
    }
  }

  // Helper to toggle site selection
  function handleToggleSite(siteId: string) {
    setSelectedSites(prev => 
      prev.includes(siteId) ? prev.filter(s => s !== siteId) : [...prev, siteId]
    );
  }

  // Helper to toggle Select All for current region
  function handleToggleSelectAll() {
    const conf = REGION_SITES_CONFIG[selectedProvider];
    const currentRegionSites = (conf && conf.sites[selectedRegion]) ? conf.sites[selectedRegion].map(s => s.id) : [];
    const allSelected = currentRegionSites.every(id => selectedSites.includes(id));
    if (allSelected) {
      setSelectedSites(prev => prev.filter(id => !currentRegionSites.includes(id)));
    } else {
      setSelectedSites(prev => Array.from(new Set([...prev, ...currentRegionSites])));
    }
  }

  // ── Sync Settings Modal State ────────────────────────────────────
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingStore, setEditingStore] = useState<ConnectedStore | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    storeName: "",
    syncProducts: true,
    syncOrders: true,
    syncInventory: true,
    inventoryDirection: "wms_to_store" as "wms_to_store" | "store_to_wms" | "manual_only",
    autoSyncIntervalMinutes: 30,
    defaultWarehouse: "MIA",
    orderPrefix: "ORD-"
  });

  // ── Disconnect Modal State ───────────────────────────────────────
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [storeToDisconnect, setStoreToDisconnect] = useState<ConnectedStore | null>(null);

  // Listen for header button CustomEvent
  useEffect(() => {
    const handler = () => {
      handleOpenConnectModal();
    };
    window.addEventListener("open-connect-channel", handler);
    return () => window.removeEventListener("open-connect-channel", handler);
  }, []);

  // Check URL params for OAuth callback return notifications
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      const storeName = params.get("store") || "Store";
      toast.success(`${storeName} connected successfully via OAuth!`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("error")) {
      toast.error(`Store connection failed: ${params.get("error")}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    loadProviders();
    loadStores();
    loadRecentOrders();
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      loadLogs();
    }
  }, [activeTab, logPage]);

  async function loadProviders() {
    try {
      const data = await integrationsService.getProviders();
      setProviders(data);
    } catch (err: any) {
      console.error("Failed to load providers:", err);
    }
  }

  async function loadStores() {
    setLoadingStores(true);
    try {
      const res = await integrationsService.getStores({ limit: 50 });
      setStores(res.data || []);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to load connected stores");
    } finally {
      setLoadingStores(false);
    }
  }

  async function loadLogs() {
    setLoadingLogs(true);
    try {
      const res = await integrationsService.getSyncHistory("all", { page: logPage, limit: 10 });
      setSyncLogs(res.data || []);
      setLogPagination(res.pagination || { totalPages: 1, totalItems: res.data?.length || 0 });
    } catch (err: any) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function loadRecentOrders() {
    try {
      const orders = await ordersService.getAll();
      const channelOrders = orders
        .filter((o: any) => o.channel && o.channel !== "Direct")
        .sort((a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime())
        .slice(0, 8)
        .map((o: any) => ({
          id: o.orderId,
          channel: o.channel,
          customer: o.customer,
          total: o.total || 0,
          status: o.status,
          date: o.date ? new Date(o.date).toLocaleDateString() : "—",
          time: new Date(o.createdAt || o.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
      setRecentOrders(channelOrders);
    } catch (err) {
      console.error("Failed to load recent orders", err);
    }
  }

  // ── Handle Connect Initiation (OAuth Redirect vs Token Connection) ────────
  async function handleInitiateConnect() {
    if (!customShopName.trim()) {
      toast.error("Please enter custom store name");
      return;
    }

    // Token-based platform: Temu
    if (selectedProvider === "TEMU") {
      if (!temuToken.trim()) {
        toast.error("Please enter Temu Authorization Token");
        return;
      }
      setConnecting(true);
      try {
        const res = await integrationsService.connectWithToken("TEMU", {
          customName: customShopName.trim(),
          token: temuToken.trim(),
          shopType: temuShopType,
          siteCountry: temuSiteCountry,
          isSandbox
        });
        toast.success(res.message || "Temu shop connected successfully!");
        setShowConnectModal(false);
        loadStores();
      } catch (err: any) {
        toast.error(err.response?.data?.message || err.message || "Failed to connect Temu shop");
      } finally {
        setConnecting(false);
      }
      return;
    }

    if (selectedProvider === "SHOPIFY" && !shopDomain.trim()) {
      toast.error("Please enter Shopify store domain");
      return;
    }
    if (selectedProvider === "WOOCOMMERCE" && !storeUrl.trim()) {
      toast.error("Please enter WooCommerce store URL");
      return;
    }

    setConnecting(true);
    try {
      const res = await integrationsService.initiateConnect(selectedProvider, {
        customName: customShopName.trim(),
        region: selectedRegion,
        sites: selectedSites,
        shopDomain: selectedProvider === "SHOPIFY" ? shopDomain.trim() : undefined,
        storeUrl: selectedProvider === "WOOCOMMERCE" ? storeUrl.trim() : undefined,
        isSandbox
      });

      if (res.authorizationUrl) {
        toast.info(t.ecommerce.oauthNotice || "Redirecting to official authorization page...");
        window.location.href = res.authorizationUrl;
      } else {
        toast.error("Failed to obtain OAuth authorization URL");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to initiate store connection");
    } finally {
      setConnecting(false);
    }
  }

  // ── Handle Manual Sync Trigger ──────────────────────────────────
  async function handleTriggerSync(store: ConnectedStore) {
    setSyncingStoreIds(prev => ({ ...prev, [store._id]: true }));
    try {
      toast.loading(`Syncing ${store.storeName}...`, { id: `sync-${store._id}` });
      const res = await integrationsService.triggerSync(store._id, { syncType: "full" });
      toast.success(`Sync complete for ${store.storeName}! (${res.summary})`, { id: `sync-${store._id}` });
      loadStores();
      loadRecentOrders();
      if (activeTab === "logs") loadLogs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Sync failed", { id: `sync-${store._id}` });
    } finally {
      setSyncingStoreIds(prev => ({ ...prev, [store._id]: false }));
    }
  }

  // ── Handle Open Settings Modal ──────────────────────────────────
  function handleOpenSettings(store: ConnectedStore) {
    setEditingStore(store);
    setSettingsForm({
      storeName: store.storeName,
      syncProducts: store.syncSettings?.syncProducts ?? true,
      syncOrders: store.syncSettings?.syncOrders ?? true,
      syncInventory: store.syncSettings?.syncInventory ?? true,
      inventoryDirection: store.syncSettings?.inventoryDirection || "wms_to_store",
      autoSyncIntervalMinutes: store.syncSettings?.autoSyncIntervalMinutes || 30,
      defaultWarehouse: store.syncSettings?.defaultWarehouse || "MIA",
      orderPrefix: store.syncSettings?.orderPrefix || "ORD-"
    });
    setShowSettingsModal(true);
  }

  async function handleSaveSettings() {
    if (!editingStore) return;
    try {
      await integrationsService.updateSettings(editingStore._id, {
        storeName: settingsForm.storeName,
        syncSettings: {
          syncProducts: settingsForm.syncProducts,
          syncOrders: settingsForm.syncOrders,
          syncInventory: settingsForm.syncInventory,
          inventoryDirection: settingsForm.inventoryDirection,
          autoSyncIntervalMinutes: Number(settingsForm.autoSyncIntervalMinutes) || 30,
          defaultWarehouse: settingsForm.defaultWarehouse,
          orderPrefix: settingsForm.orderPrefix
        }
      });
      toast.success("Store synchronization settings updated successfully!");
      setShowSettingsModal(false);
      loadStores();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to update settings");
    }
  }

  // ── Handle Disconnect Store ─────────────────────────────────────
  async function handleConfirmDisconnect() {
    if (!storeToDisconnect) return;
    try {
      await integrationsService.disconnectStore(storeToDisconnect._id);
      toast.success(`${storeToDisconnect.storeName} has been disconnected.`);
      setShowDisconnectModal(false);
      setStoreToDisconnect(null);
      loadStores();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to disconnect store");
    }
  }

  // Compute Metrics
  const connectedCount = stores.filter(s => s.status === "connected").length;
  const syncingCount = stores.filter(s => s.status === "syncing" || syncingStoreIds[s._id]).length;
  const errorCount = stores.filter(s => s.status === "error").length;

  return (
    <div className="space-y-6 animate-pop-in">
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TOP HEADER & NAVIGATION TABS                                              */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex items-center gap-2 overflow-x-auto text-sm font-semibold">
          {[
            { id: "stores", label: t.ecommerce.tabConnectedStores || "Connected Stores", icon: Globe },
            { id: "logs", label: t.ecommerce.tabSyncHistory || "Sync History & Logs", icon: History },
            { id: "orders", label: t.ecommerce.tabChannelAnalytics || "Marketplace Orders", icon: ShoppingCart }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all text-xs md:text-sm ${
                  active
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <Icon className="size-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <PrimaryButton 
            icon={Plus} 
            onClick={handleOpenConnectModal}
          >
            {t.ecommerce.connectChannel || "Connect Store"}
          </PrimaryButton>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* METRIC CARDS                                                               */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {[
          { label: t.ecommerce.connectedChannels || "Connected Stores", value: connectedCount, icon: Globe, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: t.ecommerce.syncQueue || "Active Syncing", value: syncingCount, icon: RefreshCw, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: t.ecommerce.ordersToday || "Orders Imported Today", value: recentOrders.length, icon: ShoppingCart, color: "text-primary", bg: "bg-primary/10" },
          { label: t.ecommerce.errors || "Sync Errors", value: errorCount, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" }
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-muted-foreground">{s.label}</span>
              <div className="font-bold text-2xl mt-0.5 font-mono">{s.value}</div>
            </div>
            <div className={`p-2.5 rounded-xl ${s.bg}`}>
              <s.icon className={`size-5 ${s.color}`} />
            </div>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: CONNECTED STORES LIST & CONTROLS                                    */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "stores" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <Globe className="size-4 text-primary" /> Active Marketplace & Store Integrations
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automated OAuth 2.0 and API synchronization with Shopify, WooCommerce, Amazon SP-API, and eBay.
                </p>
              </div>
              <SecondaryButton icon={RefreshCw} onClick={loadStores}>
                Refresh
              </SecondaryButton>
            </div>

            {loadingStores ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                Loading connected stores...
              </div>
            ) : stores.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                  <Globe className="size-6" />
                </div>
                <h4 className="font-bold text-sm text-foreground">No External Stores Connected Yet</h4>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Connect your Shopify, WooCommerce, Amazon, or eBay store to automatically import customer orders and keep your warehouse stock perfectly in sync.
                </p>
                <button
                  type="button"
                  onClick={handleOpenConnectModal}
                  className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg shadow hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="size-3.5" /> Connect Your First Store
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {stores.map(store => {
                  const badge = providerBadges[store.provider] || { bg: "bg-secondary", color: "text-foreground", label: store.provider };
                  const isSyncing = store.status === "syncing" || syncingStoreIds[store._id];

                  return (
                    <div key={store._id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-secondary/20 transition-colors">
                      {/* Left: Platform & Info */}
                      <div className="flex items-start gap-3.5">
                        <div className="size-11 flex items-center justify-center shrink-0">
                          <StoreBrandIcon provider={store.provider} className="size-6" />
                        </div>
                        <div className="space-y-1 min-w-0">
                          {/* Store name — full width, never truncated */}
                          <p className="font-bold text-sm text-foreground leading-tight break-words">
                            {store.storeName}
                          </p>
                          {/* Platform badge + status badge */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge.bg}`}>
                              {badge.label}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              store.status === "connected" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" :
                              store.status === "sandbox_connected" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20" :
                              isSyncing ? "bg-purple-500/10 text-purple-600 border border-purple-500/20 animate-pulse" :
                              store.status === "pending" || store.status === "pending_authorization" ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" :
                              store.status === "auth_expired" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40" :
                              store.status === "error" ? "bg-destructive/10 text-destructive border border-destructive/20" :
                              "bg-muted text-muted-foreground"
                            }`}>
                              {isSyncing ? "Syncing..." :
                               store.status === "connected" ? "ACTIVE / LIVE" :
                               store.status === "sandbox_connected" ? "SANDBOX CONNECTED" :
                               store.status === "auth_expired" ? "AUTH EXPIRED" :
                               store.status === "pending_authorization" ? "PENDING AUTH" :
                               store.status.toUpperCase()}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Globe className="size-3 shrink-0" /> {store.storeUrl || "—"}
                            </span>
                            <span className="flex items-center gap-1">
                              <ArrowLeftRight className="size-3 text-primary shrink-0" /> 
                              Direction: <strong className="text-foreground">{
                                store.syncSettings?.inventoryDirection === "wms_to_store" ? "WMS → Store" :
                                store.syncSettings?.inventoryDirection === "store_to_wms" ? "Store → WMS" : "Manual Only"
                              }</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="size-3 shrink-0" /> 
                              Last Sync: <strong className="text-foreground">{store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Never"}</strong>
                            </span>
                          </div>

                          {store.lastError && (
                            <div className="text-[11px] text-destructive flex items-center gap-1 font-semibold">
                              <AlertTriangle className="size-3 shrink-0" /> Error: {store.lastError}
                            </div>
                          )}
                        </div>

                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTriggerSync(store)}
                          disabled={isSyncing}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                          {isSyncing ? "Syncing..." : "Sync Now"}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenSettings(store)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
                          title="Configure Sync Settings"
                        >
                          <Settings2 className="size-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setStoreToDisconnect(store);
                            setShowDisconnectModal(true);
                          }}
                          className="p-1.5 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 border border-border transition-colors"
                          title="Disconnect Store"
                        >
                          <Power className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: SYNCHRONIZATION AUDIT LOGS                                          */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "logs" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <History className="size-4 text-primary" /> Synchronization Execution History
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete audit trail of all background and manual store synchronization cycles.
                </p>
              </div>
              <SecondaryButton icon={RefreshCw} onClick={loadLogs}>
                Refresh Logs
              </SecondaryButton>
            </div>

            {loadingLogs ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                Loading execution history...
              </div>
            ) : syncLogs.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                No synchronization logs recorded yet. Trigger a sync from the Connected Stores tab to generate audit logs.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] font-bold border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5">Date / Time</th>
                      <th className="text-left px-3 py-2.5">Platform</th>
                      <th className="text-left px-3 py-2.5">Sync Type</th>
                      <th className="text-left px-3 py-2.5">Trigger</th>
                      <th className="text-center px-3 py-2.5">Processed</th>
                      <th className="text-center px-3 py-2.5">Created</th>
                      <th className="text-center px-3 py-2.5">Updated</th>
                      <th className="text-center px-3 py-2.5">Failed</th>
                      <th className="text-right px-3 py-2.5">Duration</th>
                      <th className="text-right px-3 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLogs.map((log) => (
                      <tr 
                        key={log._id} 
                        onClick={() => setSelectedLog(log)}
                        className="border-t border-border hover:bg-secondary/20 transition-colors cursor-pointer"
                      >
                        <td className="px-3 py-2 text-muted-foreground font-mono">
                          {new Date(log.startedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-bold text-foreground">
                          <div className="flex items-center gap-2">
                            <StoreBrandIcon provider={log.provider} className="size-4 shrink-0" />
                            <span>{log.provider}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] uppercase font-semibold">
                            {log.syncType}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground capitalize">
                          {log.trigger}
                        </td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-foreground">
                          {log.recordsProcessed}
                        </td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-emerald-600">
                          +{log.recordsCreated}
                        </td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-blue-600">
                          {log.recordsUpdated}
                        </td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-destructive">
                          {log.recordsFailed > 0 ? log.recordsFailed : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {log.durationMs}ms
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            log.status === "completed" ? "bg-emerald-500/10 text-emerald-600" :
                            log.status === "failed" ? "bg-destructive/10 text-destructive" :
                            "bg-blue-500/10 text-blue-600 animate-pulse"
                          }`}>
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <TablePagination pagination={logPagination} page={logPage} onPageChange={setLogPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: MARKETPLACE ORDERS                                                  */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <ShoppingCart className="size-4 text-primary" /> Orders Imported from External Marketplaces
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Synchronized customer orders automatically routed to warehouse fulfillment queues.
                </p>
              </div>
              <SecondaryButton icon={RefreshCw} onClick={loadRecentOrders}>
                Refresh Orders
              </SecondaryButton>
            </div>

            {recentOrders.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                No marketplace orders imported yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground uppercase text-[10px] font-bold border-b border-border">
                    <tr>
                      <th className="text-left px-3 py-2.5">Order ID</th>
                      <th className="text-left px-3 py-2.5">Channel</th>
                      <th className="text-left px-3 py-2.5">Customer</th>
                      <th className="text-left px-3 py-2.5">Date</th>
                      <th className="text-right px-3 py-2.5">Total (€)</th>
                      <th className="text-right px-3 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((o) => (
                      <tr key={o.id} className="border-t border-border hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2 font-mono font-bold text-primary">{o.id}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">
                          <div className="flex items-center gap-2">
                            <StoreBrandIcon provider={o.channel} className="size-4 shrink-0" />
                            <span>{o.channel}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{o.customer}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{o.date}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                          €{Number(o.total).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <StatusBadge status={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: 4SELLER CONNECT SHOP MODAL (2-STEP EXPERIENCE)                     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showConnectModal}
        onClose={() => {
          setShowConnectModal(false);
          setConnectStep("SELECT_PLATFORM");
        }}
        title={
          connectStep === "SELECT_PLATFORM" ? (
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-bold text-base text-foreground">Connect Shop</span>
              <span className="text-xs text-muted-foreground font-normal">
                Please select the platform for connect first.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setConnectStep("SELECT_PLATFORM")}
                className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border/60 hover:border-border"
                title="Back to platform selection"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div>
                <div className="font-bold text-base text-foreground">
                  Add {PROVIDER_NAMES[selectedProvider] || selectedProvider} shop
                </div>
                <div className="text-xs text-muted-foreground font-normal">
                  {REGION_SITES_CONFIG[selectedProvider]?.notice || "You need a registered seller account to authorize this shop."}
                </div>
              </div>
            </div>
          )
        }
        width={connectStep === "SELECT_PLATFORM" ? "2xl" : "xl"}
        footer={
          connectStep === "SELECT_PLATFORM" ? (
            <div className="flex items-center justify-end w-full">
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="px-5 py-2 border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => setConnectStep("SELECT_PLATFORM")}
                className="px-4 py-2 border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-secondary transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="size-3.5" /> Back to platforms
              </button>
              <button
                type="button"
                onClick={handleInitiateConnect}
                disabled={
                  connecting ||
                  !customShopName.trim() ||
                  (selectedProvider === "TEMU" && !temuToken.trim()) ||
                  (selectedProvider === "SHOPIFY" && !shopDomain.trim()) ||
                  (selectedProvider === "WOOCOMMERCE" && !storeUrl.trim()) ||
                  (selectedProvider === "PRESTASHOP" && !storeUrl.trim())
                }
                className="px-6 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow flex items-center gap-1.5 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {connecting ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" /> Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </button>
            </div>
          )
        }
      >
        {connectStep === "SELECT_PLATFORM" ? (
          /* ── STEP 1: 16-PLATFORM BRAND CARD GRID (4SELLER UI) ── */
          <div className="py-2 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {PLATFORM_GRID_LIST.map(p => (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => handleSelectPlatformCard(p.code)}
                  className="relative h-20 border border-border/60 hover:border-emerald-500/80 rounded-xl flex items-center justify-center p-3 hover:bg-secondary/30 shadow-xs hover:shadow-md transition-all duration-150 group cursor-pointer hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {p.badge && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-secondary/90 text-muted-foreground border border-border/60">
                      {p.badge}
                    </span>
                  )}
                  <div className="flex items-center justify-center max-w-full max-h-full">
                    <PlatformBrandLogo code={p.code} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── STEP 2: DEDICATED PLATFORM CONFIGURATION & AUTH FORM ── */
          <div className="space-y-4">

            {/* 4Seller Documentation & Authorization Guide Link */}
            <div>
              <button
                type="button"
                onClick={() => setShowHelpGuide(v => !v)}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <HelpCircle className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{REGION_SITES_CONFIG[selectedProvider]?.guideTitle || `How to authorize an ${PROVIDER_NAMES[selectedProvider]} shop to 4Seller?`}</span>
              </button>

              {showHelpGuide && (
                <div className="mt-3 p-3.5 bg-secondary/50 rounded-xl border border-border space-y-3 text-xs text-foreground animate-fade-in-up">
                  <div className="font-bold text-xs text-primary flex items-center gap-1.5">
                    <Info className="size-4 shrink-0" />
                    Connect Your {PROVIDER_NAMES[selectedProvider] || selectedProvider} Account
                  </div>
                  <div className="space-y-2 text-muted-foreground text-[11.5px] leading-relaxed">
                    {(REGION_SITES_CONFIG[selectedProvider]?.guideSteps || []).map((step, idx) => (
                      <p key={idx} className="flex items-start gap-2">
                        <span className="font-bold text-primary shrink-0">•</span>
                        <span>{step}</span>
                      </p>
                    ))}
                  </div>

                  {REGION_SITES_CONFIG[selectedProvider]?.guideNotes && REGION_SITES_CONFIG[selectedProvider].guideNotes.length > 0 && (
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-800 dark:text-amber-300 space-y-1.5">
                      {REGION_SITES_CONFIG[selectedProvider].guideNotes.map((note, idx) => (
                        <div key={idx} className="flex items-start gap-1.5">
                          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Production Configuration Requirement Notice */}
            {(() => {
              const currentProviderInfo = providers.find(p => p.code === selectedProvider);
              if (currentProviderInfo && !currentProviderInfo.isProductionConfigured && !isSandbox) {
                return (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-bold">Production Configuration Required</span>
                      <p className="text-[11.5px] leading-relaxed">
                        {currentProviderInfo.productionRequirements || "Production credentials or marketplace developer approval are required before a live store can be connected. Enable the Developer Sandbox / Test Simulator switch below to test."}
                      </p>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* ── TEMU DEDICATED TOKEN AUTHORIZATION FORM ── */}
            {selectedProvider === "TEMU" ? (
              <div className="space-y-3.5 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Shop Type" required>
                    <Select
                      value={temuShopType}
                      onChange={e => setTemuShopType(e.target.value)}
                    >
                      <option value="Semi-Managed (Half-Managed)">Semi-Managed (Half-Managed)</option>
                      <option value="Full-Managed">Full-Managed</option>
                      <option value="Local Seller (EU / US)">Local Seller (EU / US)</option>
                      <option value="Global Cross-Border">Global Cross-Border</option>
                    </Select>
                  </Field>

                  <Field label="Site Country" required>
                    <Select
                      value={temuSiteCountry}
                      onChange={e => setTemuSiteCountry(e.target.value)}
                    >
                      <option value="US">United States (US)</option>
                      <option value="ES">Spain Site (ES)</option>
                      <option value="DE">Germany Site (DE)</option>
                      <option value="FR">France Site (FR)</option>
                      <option value="IT">Italy Site (IT)</option>
                      <option value="UK">United Kingdom (UK)</option>
                      <option value="CA">Canada (CA)</option>
                      <option value="GLOBAL">Global Cross-Border</option>
                    </Select>
                  </Field>
                </div>

                <Field label="Custom Store Name" required>
                  <Input
                    value={customShopName}
                    onChange={e => setCustomShopName(e.target.value)}
                    placeholder="e.g. My Temu Semi-Managed Shop"
                  />
                </Field>

                <Field label="Authorization Token" required>
                  <textarea
                    value={temuToken}
                    onChange={e => setTemuToken(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono resize-none"
                    placeholder="Paste the Authorization Token generated from Temu Seller Center (MMS)..."
                  />
                </Field>
              </div>
            ) : (
              /* ── OAUTH REDIRECT & PLATFORM SPECIFIC FORMS ── */
              <div className="space-y-3.5">
                {/* Custom Store Name */}
                <Field label="Custom Store Name" required>
                  <Input
                    value={customShopName}
                    onChange={e => setCustomShopName(e.target.value)}
                    placeholder="Please enter custom store name"
                  />
                </Field>

                {/* Region Dropdown */}
                {REGION_SITES_CONFIG[selectedProvider]?.regions && (
                  <Field label="Region">
                    <Select
                      value={selectedRegion}
                      onChange={e => handleRegionChange(e.target.value)}
                    >
                      {REGION_SITES_CONFIG[selectedProvider].regions.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </Select>
                  </Field>
                )}

                {/* Site country * (Dynamic Checkboxes with Select All) */}
                {(() => {
                  const conf = REGION_SITES_CONFIG[selectedProvider];
                  const currentRegionSites = (conf && conf.sites[selectedRegion]) ? conf.sites[selectedRegion] : [];
                  if (currentRegionSites.length === 0) return null;
                  const allSelected = currentRegionSites.length > 0 && currentRegionSites.every(s => selectedSites.includes(s.id));

                  return (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold block text-foreground">
                        Site country <span className="text-destructive">*</span>
                      </label>
                      <div className="p-3 bg-secondary/30 rounded-xl border border-border flex flex-wrap items-center gap-x-5 gap-y-2.5 text-xs">
                        <label className="inline-flex items-center gap-2 cursor-pointer font-bold select-none text-foreground">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={handleToggleSelectAll}
                            className="size-4 accent-emerald-600 rounded cursor-pointer"
                          />
                          <span>Select All</span>
                        </label>
                        {currentRegionSites.map(s => (
                          <label key={s.id} className="inline-flex items-center gap-2 cursor-pointer select-none text-foreground">
                            <input
                              type="checkbox"
                              checked={selectedSites.includes(s.id)}
                              onChange={() => handleToggleSite(s.id)}
                              className="size-4 accent-emerald-600 rounded cursor-pointer"
                            />
                            <span>{s.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Platform Specific: TikTok Contact Email */}
                {selectedProvider === "TIKTOK_SHOP" && (
                  <Field label="Contact Email">
                    <Input
                      type="email"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                      placeholder="seller@yourdomain.com"
                    />
                  </Field>
                )}

                {/* Platform Specific: Shopify Domain */}
                {selectedProvider === "SHOPIFY" && (
                  <Field label="Shopify Store Domain (.myshopify.com)" required>
                    <Input
                      value={shopDomain}
                      onChange={e => setShopDomain(e.target.value)}
                      placeholder="e.g. my-brand.myshopify.com"
                    />
                  </Field>
                )}

                {/* Platform Specific: WooCommerce / PrestaShop Store URL */}
                {(selectedProvider === "WOOCOMMERCE" || selectedProvider === "PRESTASHOP") && (
                  <Field label={`${PROVIDER_NAMES[selectedProvider]} Store URL`} required>
                    <Input
                      value={storeUrl}
                      onChange={e => setStoreUrl(e.target.value)}
                      placeholder="https://www.yourstore.com"
                    />
                  </Field>
                )}
              </div>
            )}

            {/* Developer Sandbox / Test Simulator Switch */}
            <div className="p-3 rounded-xl bg-card border border-border flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-foreground flex items-center gap-1.5">
                  <Zap className="size-3.5 text-amber-500" />
                  {t.ecommerce.sandboxMode || "Developer Sandbox / Test Simulator"}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t.ecommerce.sandboxHint || "Simulate token authorization and sample catalog/order sync without live keys."}
                </p>
              </div>
              <input
                type="checkbox"
                checked={isSandbox}
                onChange={e => setIsSandbox(e.target.checked)}
                className="size-4 accent-emerald-600 rounded cursor-pointer"
              />
            </div>

            <div className="text-[11px] text-muted-foreground italic flex items-center gap-1">
              <HelpCircle className="size-3 shrink-0" />
              {t.ecommerce.oauthNotice || "Passwords are never collected in WMS. Tokens are encrypted at rest with AES-256-GCM."}
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: SYNC SETTINGS & RULES MODAL                                       */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {editingStore && (
        <Modal
          open={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          title={t.ecommerce.syncSettingsTitle || "Store Synchronization Rules"}
          subtitle={`Configuring ${editingStore.storeName} (${editingStore.provider})`}
          width="xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowSettingsModal(false)} />
              <ModalSubmit onClick={handleSaveSettings}>
                Save Synchronization Rules
              </ModalSubmit>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Store Display Name" required>
              <Input
                value={settingsForm.storeName}
                onChange={e => setSettingsForm({ ...settingsForm, storeName: e.target.value })}
              />
            </Field>

            <div className="p-3.5 bg-secondary/30 rounded-xl border border-border space-y-3">
              <div className="font-bold text-xs text-foreground uppercase tracking-wide">
                Feature Toggles
              </div>

              <div className="space-y-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.syncProducts}
                    onChange={e => setSettingsForm({ ...settingsForm, syncProducts: e.target.checked })}
                    className="size-4 accent-primary rounded"
                  />
                  <span>Sync Product Catalog & Match SKUs</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.syncOrders}
                    onChange={e => setSettingsForm({ ...settingsForm, syncOrders: e.target.checked })}
                    className="size-4 accent-primary rounded"
                  />
                  <span>Import Unfulfilled Orders & Create CRM Profiles</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.syncInventory}
                    onChange={e => setSettingsForm({ ...settingsForm, syncInventory: e.target.checked })}
                    className="size-4 accent-primary rounded"
                  />
                  <span>Synchronize Available Inventory Stock Levels</span>
                </label>
              </div>
            </div>

            <Row>
              <Field label="Inventory Sync Direction" required>
                <Select
                  value={settingsForm.inventoryDirection}
                  onChange={e => setSettingsForm({ ...settingsForm, inventoryDirection: e.target.value as any })}
                >
                  <option value="wms_to_store">WMS → Store (Warehouse is Authoritative)</option>
                  <option value="store_to_wms">Store → WMS (Marketplace is Authoritative)</option>
                  <option value="manual_only">Manual Only (Do not overwrite stock)</option>
                </Select>
              </Field>

              <Field label="Default Fulfillment Warehouse">
                <Input
                  value={settingsForm.defaultWarehouse}
                  onChange={e => setSettingsForm({ ...settingsForm, defaultWarehouse: e.target.value })}
                  placeholder="e.g. MIA, BCN, MAD"
                />
              </Field>
            </Row>

            <Row>
              <Field label="Auto-sync Interval (Minutes)">
                <Input
                  type="number"
                  min="5"
                  max="1440"
                  value={settingsForm.autoSyncIntervalMinutes}
                  onChange={e => setSettingsForm({ ...settingsForm, autoSyncIntervalMinutes: Number(e.target.value) })}
                />
              </Field>

              <Field label="Order Number Prefix">
                <Input
                  value={settingsForm.orderPrefix}
                  onChange={e => setSettingsForm({ ...settingsForm, orderPrefix: e.target.value })}
                  placeholder="e.g. ORD-"
                />
              </Field>
            </Row>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: SYNC LOG DETAILS INSPECTOR                                        */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedLog && (
        <Modal
          open={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          title="Synchronization Log Details"
          subtitle={`Executed on ${new Date(selectedLog.startedAt).toLocaleString()}`}
          width="xl"
          footer={
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>
          }
        >
          <div className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <div className="p-3 bg-secondary/30 rounded-lg border border-border">
                <span className="text-muted-foreground text-[10px] uppercase font-bold">Processed</span>
                <div className="text-base font-bold font-mono text-foreground">{selectedLog.recordsProcessed}</div>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <span className="text-emerald-700 dark:text-emerald-400 text-[10px] uppercase font-bold">Created</span>
                <div className="text-base font-bold font-mono text-emerald-600">+{selectedLog.recordsCreated}</div>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <span className="text-blue-700 dark:text-blue-400 text-[10px] uppercase font-bold">Updated</span>
                <div className="text-base font-bold font-mono text-blue-600">{selectedLog.recordsUpdated}</div>
              </div>
              <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                <span className="text-destructive text-[10px] uppercase font-bold">Failed</span>
                <div className="text-base font-bold font-mono text-destructive">{selectedLog.recordsFailed}</div>
              </div>
            </div>

            <div className="p-3 bg-secondary/20 rounded-lg border border-border space-y-1">
              <div><strong>Provider:</strong> {selectedLog.provider}</div>
              <div><strong>Sync Type:</strong> {selectedLog.syncType.toUpperCase()}</div>
              <div><strong>Trigger:</strong> {selectedLog.trigger}</div>
              <div><strong>Duration:</strong> {selectedLog.durationMs}ms</div>
              <div><strong>Summary:</strong> {selectedLog.summary}</div>
            </div>

            {selectedLog.errorDetails && selectedLog.errorDetails.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-bold text-destructive text-xs">Diagnostic Errors ({selectedLog.errorDetails.length})</div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {selectedLog.errorDetails.map((err, i) => (
                    <div key={i} className="p-2 bg-destructive/10 border border-destructive/20 rounded text-[11px] text-destructive">
                      <strong>{err.item}:</strong> {err.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: DISCONNECT CONFIRMATION MODAL                                    */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {storeToDisconnect && (
        <Modal
          open={showDisconnectModal}
          onClose={() => setShowDisconnectModal(false)}
          title="Disconnect Store"
          subtitle={`Disconnecting ${storeToDisconnect.storeName}`}
          footer={
            <div className="flex items-center justify-between w-full">
              <ModalCancel onClose={() => setShowDisconnectModal(false)} />
              <button
                type="button"
                onClick={handleConfirmDisconnect}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                Confirm Disconnect
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            <p className="text-muted-foreground">
              Are you sure you want to disconnect <strong>{storeToDisconnect.storeName}</strong>?
            </p>
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
              OAuth access and refresh tokens will be permanently revoked. Automated order importing and stock synchronization will be stopped.
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Ecommerce;
