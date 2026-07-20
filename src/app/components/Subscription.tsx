import { useEffect, useState } from "react";
import { Check, Zap, Shield, Star } from "lucide-react";
import { settingsService } from "../../services/settings.service";
import { toast } from "sonner";

const plans = [
  {
    name: "Starter",
    price: 99,
    period: "month",
    description: "Perfect for small operations and getting started",
    icon: Zap,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    current: false,
    features: [
      "Up to 2 warehouses",
      "500 orders / month",
      "1,000 SKUs",
      "Basic analytics",
      "Email support",
      "2 team members",
    ],
  },
  {
    name: "Professional",
    price: 299,
    period: "month",
    description: "For growing businesses with multiple locations",
    icon: Shield,
    color: "text-primary",
    bgColor: "bg-primary/10",
    current: true,
    features: [
      "Up to 10 warehouses",
      "5,000 orders / month",
      "Unlimited SKUs",
      "Advanced analytics & reports",
      "Priority support",
      "10 team members",
      "API access",
      "Multi-company",
    ],
  },
  {
    name: "Enterprise",
    price: 999,
    period: "month",
    description: "Full-scale logistics management for large enterprises",
    icon: Star,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    current: false,
    features: [
      "Unlimited warehouses",
      "Unlimited orders",
      "Unlimited SKUs",
      "Custom analytics",
      "Dedicated support manager",
      "Unlimited team members",
      "Full API access",
      "Custom integrations",
      "SLA guarantee",
      "White-label option",
    ],
  },
];

export function Subscription() {
  const [currentPlan, setCurrentPlan] = useState("professional");

  useEffect(() => {
    settingsService.getCompanySettings().then(data => {
      if (data && data.plan) {
        setCurrentPlan(data.plan);
      }
    }).catch(console.error);
  }, []);

  async function handleUpgrade(planName: string) {
    try {
      await settingsService.updateCompanySettings({ plan: planName });
      setCurrentPlan(planName);
      toast.success(`Successfully upgraded to ${planName} plan!`);
    } catch (err) {
      toast.error("Failed to upgrade plan.");
    }
  }

  const currentPlanObj = plans.find(p => p.name.toLowerCase() === currentPlan.toLowerCase()) || plans[0];

  return (
    <div className="space-y-8">
      {/* Current plan banner */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Current plan</div>
          <h2 className="font-bold">{currentPlanObj.name} Plan</h2>
          <p className="text-muted-foreground mt-0.5" style={{ fontSize: "0.875rem" }}>Renews on July 1, 2026 · €{currentPlanObj.price}/month</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors">Manage billing</button>
        </div>
      </div>

      {/* Plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan, i) => (
          <div
            key={plan.name}
            className={`rounded-xl border bg-card p-6 relative animate-pop-in hover-lift ${currentPlan.toLowerCase() === plan.name.toLowerCase() ? "border-primary shadow-lg shadow-primary/10" : "border-border"}`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {currentPlan.toLowerCase() === plan.name.toLowerCase() && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">Current plan</span>
              </div>
            )}

            <div className={`size-10 rounded-xl ${plan.bgColor} flex items-center justify-center mb-4`}>
              <plan.icon className={`size-5 ${plan.color}`} />
            </div>

            <h3 className="font-bold">{plan.name}</h3>
            <p className="text-muted-foreground mt-1 mb-4" style={{ fontSize: "0.75rem" }}>{plan.description}</p>

            <div className="flex items-baseline gap-1 mb-6">
              <span className="font-bold" style={{ fontSize: "2.25rem", fontFamily: "JetBrains Mono, monospace" }}>€{plan.price}</span>
              <span className="text-muted-foreground text-sm">/{plan.period}</span>
            </div>

            <button
              onClick={() => handleUpgrade(plan.name.toLowerCase())}
              disabled={currentPlan.toLowerCase() === plan.name.toLowerCase()}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all mb-6 ${
                currentPlan.toLowerCase() === plan.name.toLowerCase()
                  ? "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  : "border border-border hover:bg-secondary"
              }`}
            >
              {currentPlan.toLowerCase() === plan.name.toLowerCase() ? "Current plan" : `Upgrade to ${plan.name}`}
            </button>

            <div className="space-y-2.5">
              {plan.features.map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 text-success shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Usage */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-bold mb-4">Current usage</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { label: "Warehouses", used: 3, limit: 10, color: "bg-primary" },
            { label: "Orders this month", used: 183, limit: 5000, color: "bg-success" },
            { label: "Team members", used: 5, limit: 10, color: "bg-info" },
          ].map((u) => {
            const pct = Math.round((u.used / u.limit) * 100);
            return (
              <div key={u.label}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-sm font-medium">{u.label}</span>
                  <span className="text-sm text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{u.used} / {u.limit}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${u.color}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">{pct}% used</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
