import { useState } from "react";
import { Eye, EyeOff, Zap, Globe, ChevronRight, CheckCircle2, ArrowLeft, AlertCircle } from "lucide-react";
import type { Lang } from "../i18n";
import { useT } from "../i18n";
import { authService } from "../../services/auth.service";

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "es", flag: "🇪🇸", label: "ES" },
  { code: "fr", flag: "🇫🇷", label: "FR" },
  { code: "it", flag: "🇮🇹", label: "IT" },
];

// Demo credentials accepted on the login page
const DEMO_EMAIL = "admin@demologistics.io";
const DEMO_PASSWORD = "admin123";

interface Props {
  lang: Lang;
  setLang: (l: Lang) => void;
  initialMode: "login" | "signup";
  onSuccess: () => void;
  onBack: () => void;
}

export function LoginPage({ lang, setLang, initialMode, onSuccess, onBack }: Props) {
  const t = useT(lang);
  const l = t.login;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(initialMode === "signup");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || (isRegistering && !name)) return;
    setError("");
    setLoading(true);

    try {
      if (isRegistering) {
        await authService.register(email, password, name);
      } else {
        await authService.login(email, password);
      }
      setLoading(false);
      onSuccess();
    } catch (err: any) {
      setLoading(false);
      setError(err.response?.data?.message || l.error);
    }
  }

  function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setError("");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">

      {/* ── LEFT PANEL (brand) ───────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-[42%] bg-card border-r border-border flex-col justify-between p-10 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-primary/15 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-violet-500/10 rounded-full blur-[100px]" />
        </div>

        <div className="relative">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-16">
            <div className="size-9 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="size-5 text-white" />
            </div>
            <span className="font-black text-xl tracking-tight">demologistics</span>
          </div>

          {/* Headline */}
          <h2 className="text-4xl font-black leading-tight mb-4">
            {l.leftHeadline}<br />
            <span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">{l.leftAccent}</span>
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-10 max-w-xs">
            {l.leftTagline}
          </p>

          {/* Feature list */}
          <ul className="space-y-3">
            {l.leftFeatures.map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Stats at bottom */}
        <div className="relative grid grid-cols-3 gap-4">
          {l.leftStats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-background/50 p-4 text-center">
              <div className="text-2xl font-black text-primary mb-0.5" style={{ fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL (form) ───────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-12">

        {/* Top bar */}
        <div className="w-full max-w-md flex items-center justify-between mb-10">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            {l.backHome}
          </button>

          {/* Lang picker */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              <Globe className="size-3.5" />
              <span className="font-medium">{LANGS.find(ll => ll.code === lang)?.label}</span>
              <ChevronRight className={`size-3 transition-transform ${langOpen ? "rotate-90" : ""}`} />
            </button>
            {langOpen && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[120px] animate-fade-in-down z-50">
                {LANGS.map(ll => (
                  <button
                    key={ll.code}
                    onClick={() => { setLang(ll.code); setLangOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${lang === ll.code ? "text-primary font-semibold bg-primary/8" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                  >
                    <span>{ll.flag}</span>
                    <span>{ll.label}</span>
                    {lang === ll.code && <CheckCircle2 className="size-3 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Form card */}
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="size-4 text-white" />
            </div>
            <span className="font-bold text-lg">demologistics</span>
          </div>

          <h1 className="text-3xl font-black mb-1 animate-fade-in-down">{isRegistering ? "Create Account" : l.title}</h1>
          <p className="text-muted-foreground mb-8 animate-fade-in-down" style={{ animationDelay: "40ms" }}>{isRegistering ? "Join demologistics today." : l.subtitle}</p>

          {/* Demo hint */}
          <button
            onClick={fillDemo}
            className="w-full mb-6 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 text-primary text-sm font-medium flex items-center gap-2 hover:bg-primary/10 transition-colors animate-pop-in"
            style={{ animationDelay: "60ms" }}
          >
            <Zap className="size-4 shrink-0" />
            <span className="text-left flex-1">{l.demoHint}</span>
            <span className="text-xs opacity-60">Click to fill</span>
          </button>

          <form onSubmit={handleSubmit} className="space-y-4 animate-pop-in" style={{ animationDelay: "80ms" }}>
            {/* Name (Register only) */}
            {isRegistering && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setError(""); }}
                  placeholder="John Doe"
                  required
                  className={`w-full px-4 py-3 rounded-xl border bg-card outline-none text-sm transition-all focus:ring-2 focus:ring-primary/30 ${error ? "border-destructive" : "border-border focus:border-primary/60"}`}
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-1.5">{l.email}</label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="you@company.com"
                required
                className={`w-full px-4 py-3 rounded-xl border bg-card outline-none text-sm transition-all focus:ring-2 focus:ring-primary/30 ${error ? "border-destructive" : "border-border focus:border-primary/60"}`}
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">{l.password}</label>
                <button type="button" className="text-xs text-primary hover:underline">{l.forgot}</button>
              </div>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="••••••••"
                  required
                  className={`w-full px-4 py-3 pr-11 rounded-xl border bg-card outline-none text-sm transition-all focus:ring-2 focus:ring-primary/30 ${error ? "border-destructive" : "border-border focus:border-primary/60"}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm animate-pop-in">
                <AlertCircle className="size-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Remember me */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setRemember(!remember)}
                className={`size-5 rounded flex items-center justify-center border-2 transition-all ${remember ? "bg-primary border-primary" : "border-border hover:border-primary/60"}`}
              >
                {remember && <CheckCircle2 className="size-3 text-white" />}
              </button>
              <span className="text-sm text-muted-foreground">{l.remember}</span>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-primary text-white font-semibold text-sm transition-all hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {l.submitting}
                </>
              ) : (isRegistering ? "Sign Up" : l.submit)}
            </button>
          </form>

          {/* Sign up link */}
          <p className="text-center text-sm text-muted-foreground mt-6">
            {isRegistering ? "Already have an account?" : l.noAccount}{" "}
            <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-primary font-semibold hover:underline">
              {isRegistering ? l.submit : l.signUp}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
