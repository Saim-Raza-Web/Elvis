import { useEffect, useState } from "react";
import { Check, Zap, Shield, Star, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "../LangContext";
import { subscriptionService, SubscriptionUsage, SubscriptionStatus, PlanConfig } from "../../services/subscription.service";

interface PlanDisplay {
  key: string;
  name: string;
  price: number;
  period: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
  features: string[];
}

const DEFAULT_PLANS: PlanDisplay[] = [
  {
    key: "starter",
    name: "Starter",
    price: 99,
    period: "month",
    description: "Perfect for small operations and getting started",
    icon: Zap,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
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
    key: "professional",
    name: "Professional",
    price: 299,
    period: "month",
    description: "For growing businesses with multiple locations",
    icon: Shield,
    color: "text-primary",
    bgColor: "bg-primary/10",
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
    key: "enterprise",
    name: "Enterprise",
    price: 999,
    period: "month",
    description: "Full-scale logistics management for large enterprises",
    icon: Star,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
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
  const { t } = useLang();
  const [plans, setPlans] = useState<PlanDisplay[]>(DEFAULT_PLANS);
  const [currentPlan, setCurrentPlan] = useState("starter");
  const [statusData, setStatusData] = useState<SubscriptionStatus | null>(null);
  const [usageData, setUsageData] = useState<SubscriptionUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statusRes, usageRes, plansRes] = await Promise.allSettled([
        subscriptionService.getStatus(),
        subscriptionService.getUsage(),
        subscriptionService.getPlans()
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value?.data) {
        setStatusData(statusRes.value.data);
        setCurrentPlan(statusRes.value.data.plan || "starter");
      }

      if (usageRes.status === "fulfilled" && usageRes.value?.data) {
        setUsageData(usageRes.value.data);
      }

      if (plansRes.status === "fulfilled" && plansRes.value?.data) {
        const remotePlans: PlanConfig[] = plansRes.value.data;
        const iconMap: Record<string, any> = { starter: Zap, professional: Shield, enterprise: Star };
        const colorMap: Record<string, string> = { starter: "text-blue-500", professional: "text-primary", enterprise: "text-amber-500" };
        const bgMap: Record<string, string> = { starter: "bg-blue-500/10", professional: "bg-primary/10", enterprise: "bg-amber-500/10" };

        const mapped = remotePlans.map(p => ({
          key: p.key,
          name: p.name,
          price: p.price,
          period: p.period,
          description: p.description,
          icon: iconMap[p.key] || Zap,
          color: colorMap[p.key] || "text-primary",
          bgColor: bgMap[p.key] || "bg-primary/10",
          features: p.features || []
        }));
        setPlans(mapped);
      }
    } catch (err) {
      console.error("Failed to load subscription data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Check for Stripe Checkout return in URL params
    const searchParams = new URLSearchParams(window.location.search);
    const sessionId = searchParams.get("session_id");
    const isSuccess = searchParams.get("success") === "true";

    if (sessionId && isSuccess) {
      toast.info("Verifying subscription upgrade with payment provider...");
      subscriptionService.getCheckoutStatus(sessionId).then((res) => {
        if (res?.data?.status === "succeeded") {
          toast.success("Subscription upgraded successfully! Your new plan is active.");
          loadData();
        } else {
          toast.info(`Payment status: ${res?.data?.status || "processing"}`);
          loadData();
        }
      }).catch((err) => {
        console.error("Failed to verify checkout session:", err);
      });

      // Clear query params without full page reload
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  async function handleUpgrade(planKey: string) {
    if (planKey === currentPlan.toLowerCase()) return;

    try {
      setUpgradingPlan(planKey);
      const res = await subscriptionService.createCheckoutSession({
        targetPlan: planKey,
        successUrl: `${window.location.origin}${window.location.pathname}?session_id={CHECKOUT_SESSION_ID}&success=true`,
        cancelUrl: `${window.location.origin}${window.location.pathname}?canceled=true`
      });

      if (res?.data?.checkoutUrl) {
        toast.info("Redirecting to secure Stripe Checkout...");
        window.location.href = res.data.checkoutUrl;
      } else {
        toast.error("Could not obtain checkout URL from payment provider.");
      }
    } catch (err: any) {
      const errCode = err?.response?.data?.code;
      const errMsg = err?.response?.data?.message || err?.message || t.common?.error || "Failed to initiate upgrade";

      if (errCode === "PAYMENT_PROVIDER_NOT_CONFIGURED" || err?.response?.status === 503) {
        toast.error(
          "Payment provider not configured: STRIPE_SECRET_KEY is missing on the server. Real payment is required to upgrade.",
          { duration: 7000 }
        );
      } else {
        toast.error(errMsg, { duration: 6000 });
      }
    } finally {
      setUpgradingPlan(null);
    }
  }

  const currentPlanObj = plans.find(p => p.key.toLowerCase() === currentPlan.toLowerCase()) || plans[0];

  const renewalDateDisplay = statusData?.currentPeriodEnd
    ? new Date(statusData.currentPeriodEnd).toLocaleDateString()
    : "End of current billing cycle";

  const subscriptionStatusBadge = () => {
    const status = statusData?.subscriptionStatus || "active";
    if (status === "active") {
      return <span className="bg-success/15 text-success text-xs font-bold px-2.5 py-1 rounded-full uppercase">Active</span>;
    }
    if (status === "past_due") {
      return <span className="bg-destructive/15 text-destructive text-xs font-bold px-2.5 py-1 rounded-full uppercase">Past Due</span>;
    }
    if (status === "canceled") {
      return <span className="bg-muted text-muted-foreground text-xs font-bold px-2.5 py-1 rounded-full uppercase">Canceled</span>;
    }
    return <span className="bg-secondary text-secondary-foreground text-xs font-bold px-2.5 py-1 rounded-full uppercase">{status}</span>;
  };

  return (
    <div className="space-y-8">
      {/* Current plan banner */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Current plan</span>
            {subscriptionStatusBadge()}
          </div>
          <h2 className="font-bold text-xl">{currentPlanObj.name} Plan</h2>
          <p className="text-muted-foreground mt-0.5" style={{ fontSize: "0.875rem" }}>
            Renews: {renewalDateDisplay} · €{currentPlanObj.price}/{currentPlanObj.period}
          </p>
        </div>
        <div className="flex gap-2">
          {statusData && !statusData.providerConfigured && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20">
              <AlertCircle className="size-4" />
              <span>Payment provider (Stripe) unconfigured</span>
            </div>
          )}
        </div>
      </div>

      {/* Plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan, i) => {
          const isCurrent = currentPlan.toLowerCase() === plan.key.toLowerCase();
          const isUpgrading = upgradingPlan === plan.key;

          return (
            <div
              key={plan.key}
              className={`rounded-xl border bg-card p-6 relative animate-pop-in hover-lift ${isCurrent ? "border-primary shadow-lg shadow-primary/10" : "border-border"}`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">Current plan</span>
                </div>
              )}

              <div className={`size-10 rounded-xl ${plan.bgColor} flex items-center justify-center mb-4`}>
                <plan.icon className={`size-5 ${plan.color}`} />
              </div>

              <h3 className="font-bold text-lg">{plan.name}</h3>
              <p className="text-muted-foreground mt-1 mb-4" style={{ fontSize: "0.75rem" }}>{plan.description}</p>

              <div className="flex items-baseline gap-1 mb-6">
                <span className="font-bold" style={{ fontSize: "2.25rem", fontFamily: "JetBrains Mono, monospace" }}>€{plan.price}</span>
                <span className="text-muted-foreground text-sm">/{plan.period}</span>
              </div>

              <button
                onClick={() => handleUpgrade(plan.key)}
                disabled={isCurrent || isUpgrading || loading}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all mb-6 flex items-center justify-center gap-2 ${
                  isCurrent
                    ? "bg-primary text-primary-foreground opacity-60 cursor-default"
                    : "border border-border hover:bg-secondary cursor-pointer"
                }`}
              >
                {isUpgrading && <Loader2 className="size-4 animate-spin" />}
                {isCurrent ? "Current plan" : isUpgrading ? "Connecting to Checkout..." : `Upgrade to ${plan.name}`}
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
          );
        })}
      </div>

      {/* Authoritative Usage */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Current usage & plan limits</h3>
          <span className="text-xs text-muted-foreground">Authoritative server metrics</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              label: "Warehouses",
              used: usageData?.usage?.warehouses?.used ?? 0,
              limit: usageData?.usage?.warehouses?.unlimited ? "Unlimited" : (usageData?.usage?.warehouses?.limit ?? "—"),
              pct: usageData?.usage?.warehouses?.unlimited ? 0 : (usageData?.usage?.warehouses?.percentage ?? 0),
              color: "bg-primary"
            },
            {
              label: "Orders (this month)",
              used: usageData?.usage?.orders?.used ?? 0,
              limit: usageData?.usage?.orders?.unlimited ? "Unlimited" : (usageData?.usage?.orders?.limit ?? "—"),
              pct: usageData?.usage?.orders?.unlimited ? 0 : (usageData?.usage?.orders?.percentage ?? 0),
              color: "bg-success"
            },
            {
              label: "Team members",
              used: usageData?.usage?.team?.used ?? 0,
              limit: usageData?.usage?.team?.unlimited ? "Unlimited" : (usageData?.usage?.team?.limit ?? "—"),
              pct: usageData?.usage?.team?.unlimited ? 0 : (usageData?.usage?.team?.percentage ?? 0),
              color: "bg-info"
            },
          ].map((u) => (
            <div key={u.label}>
              <div className="flex justify-between mb-1.5">
                <span className="text-sm font-medium">{u.label}</span>
                <span className="text-sm text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  {u.used} / {u.limit}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${u.color}`} style={{ width: `${Math.min(100, u.pct)}%` }} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {typeof u.limit === "string" && u.limit === "Unlimited" ? "Unlimited usage" : `${u.pct}% used`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
