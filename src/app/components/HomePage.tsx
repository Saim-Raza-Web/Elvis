import { useState } from "react";
import { Globe, Package, BarChart3, ShoppingCart, Truck, Shield, ArrowRight, CheckCircle2, ChevronRight, Zap, Star, Menu, X } from "lucide-react";
import type { Lang } from "../i18n";
import { useT } from "../i18n";

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "es", flag: "🇪🇸", label: "ES" },
  { code: "fr", flag: "🇫🇷", label: "FR" },
  { code: "it", flag: "🇮🇹", label: "IT" },
];

const PLANS = [
  { key: "starter", name: "Starter", price: 49, color: "border-border", badge: false, features: ["Up to 2 warehouses", "5,000 orders/month", "Basic reporting", "Email support", "2 team members"] },
  { key: "professional", name: "Professional", price: 149, color: "border-primary", badge: true, features: ["Up to 10 warehouses", "50,000 orders/month", "Advanced analytics", "Priority support", "15 team members", "Ecommerce integrations", "Custom carriers"] },
  { key: "enterprise", name: "Enterprise", price: 399, color: "border-border", badge: false, features: ["Unlimited warehouses", "Unlimited orders", "BI & data exports", "Dedicated SLA", "Unlimited users", "Custom integrations", "API access", "White-label options"] },
];

const FEATURE_ICONS = [Package, ShoppingCart, Globe, Truck, BarChart3, Shield];

const TESTIMONIALS = [
  { name: "Sarah Mitchell", role: "COO at NovaDist", avatar: "SM", rating: 5, text: "demologistics reduced our picking errors by 94% in the first month. The real-time inventory sync with our Shopify stores is incredible." },
  { name: "Carlos Reyes", role: "Founder at LogiMex", avatar: "CR", rating: 5, text: "We scaled from 2 to 8 warehouses without adding any extra admin overhead. The platform just handles it all." },
  { name: "Emma Dubois", role: "VP Supply Chain at PrimeFlex", avatar: "ED", rating: 5, text: "Finally, a WMS that integrates with our carrier network natively. The auto-select rules save us hours of manual work every day." },
];

interface Props {
  lang: Lang;
  setLang: (l: Lang) => void;
  onLogin: () => void;
  onEnterApp: () => void;
}

export function HomePage({ lang, setLang, onLogin, onEnterApp }: Props) {
  const t = useT(lang);
  const h = t.home;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── NAV ─────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="size-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">demologistics</span>
          </div>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <button onClick={() => scrollTo("features")} className="hover:text-foreground transition-colors">{h.nav.features}</button>
            <button onClick={() => scrollTo("pricing")} className="hover:text-foreground transition-colors">{h.nav.pricing}</button>
            <button onClick={() => scrollTo("about")} className="hover:text-foreground transition-colors">{h.nav.about}</button>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* Language picker */}
            <div className="relative">
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
              >
                <Globe className="size-3.5" />
                <span className="font-medium">{LANGS.find(l => l.code === lang)?.label}</span>
                <ChevronRight className={`size-3 transition-transform ${langOpen ? "rotate-90" : ""}`} />
              </button>
              {langOpen && (
                <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[120px] animate-fade-in-down z-50">
                  {LANGS.map(l => (
                    <button
                      key={l.code}
                      onClick={() => { setLang(l.code); setLangOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${lang === l.code ? "text-primary font-semibold bg-primary/8" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                      {lang === l.code && <CheckCircle2 className="size-3 ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={onLogin}
              className="hidden md:block px-4 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              {h.nav.login}
            </button>
            <button
              onClick={onEnterApp}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-sm"
            >
              {h.nav.getStarted}
            </button>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 rounded-lg hover:bg-secondary transition-colors">
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-card animate-fade-in-down">
            <div className="px-4 py-3 space-y-1">
              <button onClick={() => scrollTo("features")} className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors">{h.nav.features}</button>
              <button onClick={() => scrollTo("pricing")} className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors">{h.nav.pricing}</button>
              <button onClick={() => scrollTo("about")} className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors">{h.nav.about}</button>
              <button onClick={onLogin} className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors text-primary font-medium">{h.nav.login}</button>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20 px-4 sm:px-6 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/10 rounded-full blur-[120px]" />
          <div className="absolute top-1/2 left-1/4 w-[400px] h-[300px] bg-violet-500/8 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-5xl mx-auto text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold mb-6 animate-pop-in">
            <Zap className="size-3" />
            {h.hero.badge}
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.05] mb-6 animate-fade-in-down" style={{ animationDelay: "60ms" }}>
            {h.hero.title}{" "}
            <span className="relative">
              <span className="bg-gradient-to-r from-primary via-violet-400 to-cyan-400 bg-clip-text text-transparent">
                {h.hero.titleAccent}
              </span>
              <svg className="absolute -bottom-2 left-0 w-full" height="6" viewBox="0 0 200 6" fill="none" preserveAspectRatio="none">
                <path d="M0 5 Q100 0 200 5" stroke="url(#gr)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <defs><linearGradient id="gr" x1="0" x2="200" y1="0" y2="0"><stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#22d3ee" /></linearGradient></defs>
              </svg>
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            {h.hero.subtitle}
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12 animate-pop-in" style={{ animationDelay: "180ms" }}>
            <button
              onClick={onEnterApp}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-primary text-white font-semibold text-base hover:bg-primary/90 transition-all shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              {h.hero.cta}
              <ArrowRight className="size-4" />
            </button>
            <button
              onClick={onLogin}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl border border-border bg-card text-foreground font-semibold text-base hover:bg-secondary transition-all hover:-translate-y-0.5"
            >
              {h.hero.ctaSub}
            </button>
          </div>

          {/* Trust line */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: "240ms" }}>
            <div className="flex -space-x-2">
              {["A","B","C","D","E"].map((l, i) => (
                <div key={l} className="size-7 rounded-full bg-gradient-to-br from-primary/60 to-violet-500/60 border-2 border-background flex items-center justify-center text-[10px] font-bold text-white" style={{ zIndex: 5 - i }}>
                  {l}
                </div>
              ))}
            </div>
            <span>⭐⭐⭐⭐⭐</span>
            <span>{h.hero.trustedBy}</span>
          </div>
        </div>

        {/* App preview mockup */}
        <div className="max-w-5xl mx-auto mt-16 px-4 animate-pop-in" style={{ animationDelay: "300ms" }}>
          <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm shadow-2xl overflow-hidden">
            {/* Fake browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-card/80">
              <div className="flex gap-1.5"><div className="size-3 rounded-full bg-red-400/70" /><div className="size-3 rounded-full bg-yellow-400/70" /><div className="size-3 rounded-full bg-green-400/70" /></div>
              <div className="flex-1 mx-4 h-6 rounded bg-secondary/60 flex items-center px-3"><span className="text-[10px] text-muted-foreground">app.demologistics.io/dashboard</span></div>
            </div>
            {/* Dashboard preview */}
            <div className="p-5 bg-background/50">
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[["Total Orders", "2,847", "text-primary"], ["Revenue MTD", "€142.3k", "text-success"], ["On-time", "97.2%", "text-success"], ["Warehouses", "5 / 5", "text-warning"]].map(([label, val, col]) => (
                  <div key={label} className="rounded-xl border border-border bg-card p-3">
                    <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
                    <div className={`text-lg font-black ${col}`} style={{ fontFamily: "JetBrains Mono, monospace" }}>{val}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 rounded-xl border border-border bg-card p-3">
                  <div className="text-xs font-semibold mb-2">Recent Orders</div>
                  <div className="space-y-1.5">
                    {[["ORD-00183", "Apex Industries", "€4,200", "Shipped"], ["ORD-00182", "Blue Horizon LLC", "€890", "Processing"], ["ORD-00181", "Nova Retail Group", "€2,100", "Delivered"]].map(([id, cust, amt, status]) => (
                      <div key={id} className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-muted-foreground">{id}</span>
                        <span className="flex-1 mx-2 truncate">{cust}</span>
                        <span className="font-bold mr-2">{amt}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${status === "Shipped" ? "bg-primary/15 text-primary" : status === "Delivered" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="text-xs font-semibold mb-2">Warehouse Util</div>
                  <div className="space-y-2">
                    {([["MIA", 78], ["LAX", 91], ["ORD", 65]] as [string, number][]).map(([name, pct]) => (
                      <div key={name}>
                        <div className="flex justify-between text-[10px] mb-0.5"><span>{name}</span><span className="font-bold">{pct}%</span></div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className={`h-full rounded-full ${pct > 85 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ───────────────────────────────────────────────── */}
      <section className="py-16 border-y border-border/60 bg-card/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {h.stats.map((s, i) => (
              <div key={i} className="animate-pop-in" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="text-4xl font-black bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent mb-1" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
                <div className="text-sm text-muted-foreground font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">{h.features.title}</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{h.features.sub}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {h.features.items.map((item, i) => {
              const Icon = FEATURE_ICONS[i];
              return (
                <div key={i} className="rounded-2xl border border-border bg-card p-6 hover-lift animate-pop-in group" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="size-11 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-base mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ────────────────────────────────────────── */}
      <section id="about" className="py-20 px-4 sm:px-6 bg-card/30 border-y border-border/60">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-black mb-3">Loved by logistics teams</h2>
            <p className="text-muted-foreground">Real results from real operators</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-6 hover-lift animate-pop-in" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.rating }).map((_, j) => (
                    <Star key={j} className="size-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-full bg-gradient-to-br from-primary/60 to-violet-500/60 flex items-center justify-center text-xs font-bold text-white">{t.avatar}</div>
                  <div>
                    <div className="text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-black mb-4">{h.pricing.title}</h2>
            <p className="text-lg text-muted-foreground">{h.pricing.sub}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map((plan, i) => (
              <div
                key={plan.key}
                className={`rounded-2xl border-2 ${plan.color} bg-card p-7 flex flex-col hover-lift animate-pop-in relative overflow-hidden ${plan.badge ? "shadow-xl shadow-primary/10" : ""}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {plan.badge && (
                  <div className="absolute top-0 right-0">
                    <div className="bg-primary text-white text-[10px] font-bold px-4 py-1 rounded-bl-xl">{h.pricing.popular}</div>
                  </div>
                )}
                <div>
                  <div className="text-sm font-semibold text-muted-foreground mb-1">{plan.name}</div>
                  <div className="flex items-end gap-1 mb-5">
                    <span className="text-4xl font-black" style={{ fontFamily: "JetBrains Mono, monospace" }}>€{plan.price}</span>
                    <span className="text-muted-foreground mb-1.5">/{h.pricing.monthly}</span>
                  </div>
                  <ul className="space-y-2.5 mb-7">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-center gap-2.5 text-sm">
                        <CheckCircle2 className="size-4 text-success shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={onEnterApp}
                  className={`mt-auto w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${plan.badge ? "bg-primary text-white hover:bg-primary/90 shadow-md" : "border border-border hover:bg-secondary"}`}
                >
                  {h.pricing.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ──────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto rounded-3xl bg-gradient-to-br from-primary via-primary/90 to-violet-600 p-12 text-center text-white relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full blur-3xl" />
          </div>
          <div className="relative">
            <h2 className="text-4xl font-black mb-4">{h.cta.title}</h2>
            <p className="text-lg text-white/80 mb-8 max-w-xl mx-auto">{h.cta.sub}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={onEnterApp} className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-white text-primary font-bold hover:bg-white/90 transition-all">
                {h.cta.btn}
                <ArrowRight className="size-4" />
              </button>
              <button onClick={onLogin} className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl border-2 border-white/40 text-white font-semibold hover:bg-white/10 transition-all">
                {h.cta.btnSub}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────── */}
      <footer className="border-t border-border/60 bg-card/30 py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="size-7 rounded-lg bg-primary flex items-center justify-center">
                  <Zap className="size-3.5 text-white" />
                </div>
                <span className="font-bold">demologistics</span>
              </div>
              <p className="text-sm text-muted-foreground">{h.footer.tagline}</p>
            </div>
            {[h.footer.links.product, h.footer.links.company, h.footer.links.legal].map((section) => (
              <div key={section}>
                <div className="text-sm font-semibold mb-3">{section}</div>
                <ul className="space-y-2">
                  {["Features", "Pricing", "Changelog", "Roadmap"].map(l => (
                    <li key={l}><button className="text-sm text-muted-foreground hover:text-foreground transition-colors">{l}</button></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-muted-foreground">
            <span>© {new Date().getFullYear()} demologistics. {h.footer.copy}</span>
            <div className="flex gap-4">
              {LANGS.map(l => (
                <button key={l.code} onClick={() => setLang(l.code)} className={`transition-colors ${lang === l.code ? "text-primary font-semibold" : "hover:text-foreground"}`}>
                  {l.flag} {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
