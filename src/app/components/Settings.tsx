import React, { useEffect, useState } from "react";
import { Settings2, Bell, Shield, Users, Key, Save, LockKeyhole, Eye, Pencil, Trash2, Plus, X, Building2, FileText, Upload, Truck, BarChart3, QrCode, Copy, Check, AlertTriangle, Loader2 } from "lucide-react";
import { useLang } from "../LangContext";
import { adminService } from "../../services/admin.service";
import { settingsService } from "../../services/settings.service";
import { authService } from "../../services/auth.service";
import { clientsService, type ClientOwner } from "../../services/clients.service";
import { toast } from "sonner";
import { ROLE_DEFINITIONS, PERMISSION_MODULES } from "../../utils/permissions";

import { Tag } from "lucide-react";
import { Suppliers } from "./Suppliers";
import { ProductCategories } from "./ProductCategories";
import { StorageRulesManager } from "./StorageRulesManager";
import { ABCClassificationManager } from "./ABCClassificationManager";
import { ApiDocsModal } from "./ApiDocsModal";
import { ConfirmModal, PromptModal } from "./Modal";

type User = { _id: string; name: string; email: string; role: string; createdAt: string; totpEnabled?: boolean; };

// Error Boundary for Settings
class SettingsErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Settings Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-card border border-border rounded-lg p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Error Loading Settings</h2>
          <p className="text-muted-foreground mb-4 text-sm max-w-md">
            {this.state.error?.message || 'An unexpected error occurred while loading settings.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-all"
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Two-Factor Auth Section Component
function TwoFactorAuthSection({ t }: { t: any }) {
  const t2fa = t.settings.twoFactorAuth;
  const [status, setStatus] = useState<{ enabled: boolean; setupPending: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'success' | 'recovery'>('idle');
  const [qrData, setQrData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [regenPassword, setRegenPassword] = useState('');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await authService.get2FAStatus();
      setStatus(data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load 2FA status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleStartSetup = async () => {
    try {
      setLoading(true);
      const data = await authService.setup2FA();
      setQrData(data);
      setSetupStep('qr');
    } catch (err: any) {
      toast.error(err.response?.data?.message || t2fa.errorSetupFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }
    try {
      setLoading(true);
      const data = await authService.verify2FA(verifyCode);
      setRecoveryCodes(data.recoveryCodes || []);
      setSetupStep('recovery');
    } catch (err: any) {
      toast.error(err.response?.data?.message || t2fa.errorVerifyFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSetup = async () => {
    try {
      setLoading(true);
      await authService.cancel2FASetup();
      setSetupStep('idle');
      setQrData(null);
      setVerifyCode('');
      await loadStatus();
    } catch (err: any) {
      toast.error('Failed to cancel setup');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    try {
      setLoading(true);
      await authService.disable2FA(disablePassword);
      toast.success(t2fa.successTitle);
      setShowDisableConfirm(false);
      setDisablePassword('');
      await loadStatus();
    } catch (err: any) {
      toast.error(err.response?.data?.message || t2fa.errorDisableFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    try {
      setLoading(true);
      const data = await authService.regenerateRecoveryCodes(regenPassword);
      setRecoveryCodes(data.recoveryCodes || []);
      setSetupStep('recovery');
      setShowRegenConfirm(false);
      setRegenPassword('');
      toast.success(t2fa.successTitle);
    } catch (err: any) {
      toast.error(err.response?.data?.message || t2fa.errorRegenerateFailed);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (loading && !status) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="font-bold mb-1">{t.settings.twoFA}</h3>
      <p className="text-sm text-muted-foreground mb-4">{t.settings.twoFASub}</p>

      {setupStep === 'idle' && (
        <>
          {status?.enabled ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-green-500" />
                <span className="font-medium">{t2fa.statusEnabled}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRegenConfirm(true)}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors"
                >
                  {t2fa.regenerateButton}
                </button>
                <button
                  onClick={() => setShowDisableConfirm(true)}
                  className="px-4 py-2 border border-destructive/30 text-destructive rounded-lg text-sm font-semibold hover:bg-destructive/10 transition-colors"
                >
                  {t2fa.disableButton}
                </button>
              </div>
            </div>
          ) : status?.setupPending ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="size-4" />
                <span className="font-medium">{t2fa.statusPending}</span>
              </div>
              <button
                onClick={handleCancelSetup}
                className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors"
              >
                {t2fa.cancelButton}
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartSetup}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-colors"
            >
              {t2fa.enableButton}
            </button>
          )}
        </>
      )}

      {setupStep === 'qr' && qrData && (
        <div className="space-y-4">
          <p className="text-sm">{t2fa.setupDescription}</p>
          <div className="flex justify-center bg-white p-4 rounded-lg">
            <img src={qrData.qrCode} alt="QR Code" className="w-48 h-48" />
          </div>
          <div className="text-sm">
            <p className="font-medium mb-2">{t2fa.setupManualKey}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-secondary rounded text-xs font-mono break-all">{qrData.secret}</code>
              <button
                onClick={() => copyToClipboard(qrData.secret)}
                className="p-2 hover:bg-secondary rounded transition-colors"
                title="Copy"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCancelSetup}
              className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors"
            >
              {t.common?.cancel || 'Cancel'}
            </button>
            <button
              onClick={() => setSetupStep('verify')}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-colors"
            >
              {t.common?.next || 'Next'}
            </button>
          </div>
        </div>
      )}

      {setupStep === 'verify' && (
        <div className="space-y-4">
          <p className="text-sm">{t2fa.verifyDescription}</p>
          <div>
            <input
              type="text"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t2fa.verifyPlaceholder}
              maxLength={6}
              className="w-full px-4 py-3 rounded-lg border border-border bg-card outline-none focus:border-primary/50 text-center text-2xl font-mono tracking-widest"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCancelSetup}
              disabled={loading}
              className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {t2fa.cancelButton}
            </button>
            <button
              onClick={handleVerify}
              disabled={loading || verifyCode.length !== 6}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t2fa.verifyButton}
            </button>
          </div>
        </div>
      )}

      {setupStep === 'recovery' && recoveryCodes.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-bold">{t2fa.recoveryCodesTitle}</h4>
          <p className="text-sm text-muted-foreground">{t2fa.recoveryCodesDescription}</p>
          <div className="bg-destructive/10 border border-destructive/30 p-4 rounded-lg">
            <p className="text-sm font-semibold text-destructive mb-3">{t2fa.recoveryCodesWarning}</p>
            <div className="grid grid-cols-2 gap-2">
              {recoveryCodes.map((code, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-background rounded border">
                  <code className="text-xs font-mono">{code}</code>
                  <button
                    onClick={() => copyToClipboard(code)}
                    className="p-1 hover:bg-secondary rounded transition-colors"
                    title="Copy"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => { setSetupStep('idle'); setRecoveryCodes([]); setVerifyCode(''); loadStatus(); }}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-colors"
          >
            {t2fa.recoveryCodesClose}
          </button>
        </div>
      )}

      {showDisableConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDisableConfirm(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{t2fa.disableTitle}</h3>
            <p className="text-sm text-muted-foreground">{t2fa.disableDescription}</p>
            <input
              type="password"
              value={disablePassword}
              onChange={e => setDisablePassword(e.target.value)}
              placeholder={t.common?.password || "Password"}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card outline-none focus:border-primary/50"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDisableConfirm(false)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors"
              >
                {t.common?.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleDisable}
                disabled={loading || !disablePassword}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {t2fa.disableConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegenConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowRegenConfirm(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{t2fa.regenerateTitle}</h3>
            <p className="text-sm text-muted-foreground">{t2fa.regenerateDescription}</p>
            <input
              type="password"
              value={regenPassword}
              onChange={e => setRegenPassword(e.target.value)}
              placeholder={t.common?.password || "Password"}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card outline-none focus:border-primary/50"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowRegenConfirm(false)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors"
              >
                {t.common?.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleRegenerate}
                disabled={loading || !regenPassword}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading && <Loader2 className="size-4 animate-spin" />}
                {t2fa.regenerateButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const settingsTabIds = ["general", "notifications", "security", "team", "roles", "api"] as const;
const settingsTabIcons = [Settings2, Bell, Shield, Users, LockKeyhole, Key];

const roles = ROLE_DEFINITIONS;

const permissionModules = PERMISSION_MODULES;

function Settings() {
  const { t } = useLang();
  const tc = (t.common || {}) as any;
  const settingsTabs = [
    { id: "general", label: t.settings.general, icon: settingsTabIcons[0] },
    { id: "branding", label: "Company Branding", icon: Building2 },
    { id: "owners", label: "Clients / 3PL Owners", icon: Building2 },
    { id: "suppliers", label: "Suppliers Master", icon: Truck },
    { id: "categories", label: "Product Categories", icon: Tag },
    { id: "storage-rules", label: "Storage Rules", icon: Shield },
    { id: "abc-classification", label: "ABC Classification", icon: BarChart3 },
    { id: "notifications", label: t.settings.notifications, icon: settingsTabIcons[1] },
    { id: "security", label: t.settings.security, icon: settingsTabIcons[2] },
    { id: "team", label: t.settings.team, icon: settingsTabIcons[3] },
    { id: "roles", label: t.settings.roles, icon: settingsTabIcons[4] },
    { id: "api", label: t.settings.apiKeys, icon: settingsTabIcons[5] },
  ];
  // Determine if current user is admin for Storage Rules seed button
  const currentUserRaw = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } })();
  const currentUserIsAdmin = currentUserRaw?.role === "admin" || currentUserRaw?.role === "manager";
  const [activeTab, setActiveTab] = useState("general");
  const [companyName, setCompanyName] = useState("demologistics HQ");
  const [timezone, setTimezone] = useState("America/New_York");
  const [currency, setCurrency] = useState("EUR");
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [orderNotifs, setOrderNotifs] = useState(true);
  const [lowStockNotifs, setLowStockNotifs] = useState(true);
  const [shipmentNotifs, setShipmentNotifs] = useState(false);
  const [blindReceiving, setBlindReceiving] = useState(false);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Company Branding State
  const [tradingName, setTradingName] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [logo, setLogo] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [postcode, setPostcode] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("warehouse_staff");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  // Roles Management State
  const [rolesList, setRolesList] = useState<any[]>(roles);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleModalMode, setRoleModalMode] = useState<'create' | 'edit' | 'view'>('create');
  const [activeRoleTarget, setActiveRoleTarget] = useState<any | null>(null);
  const [roleForm, setRoleForm] = useState<{
    roleId: string;
    name: string;
    description: string;
    color: string;
    permissions: Record<string, boolean>;
  }>({
    roleId: "",
    name: "",
    description: "",
    color: "bg-primary/15 text-primary",
    permissions: {}
  });

  // Edit User Role Modal State
  const [editingUserTarget, setEditingUserTarget] = useState<User | null>(null);
  const [editingUserRole, setEditingUserRole] = useState("warehouse_staff");
  const [editUserLoading, setEditUserLoading] = useState(false);

  // API Docs Modal State
  const [showApiDocs, setShowApiDocs] = useState(false);

  // In-app Modal Confirmation / Prompt State
  const [showCreateKeyPrompt, setShowCreateKeyPrompt] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [confirmDeleteMemberId, setConfirmDeleteMemberId] = useState<string | null>(null);
  const [confirmDeleteRoleTarget, setConfirmDeleteRoleTarget] = useState<any | null>(null);

  // Clients / 3PL Owners State
  const [clientsList, setClientsList] = useState<ClientOwner[]>([]);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [editingClientTarget, setEditingClientTarget] = useState<ClientOwner | null>(null);
  const [clientFormState, setClientFormState] = useState({ name: "", vat: "", contact: "", email: "", phone: "", warehouseAccess: "MIA" });

  const fetchClientsList = async () => {
    try {
      const data = await clientsService.getAll();
      setClientsList(data || []);
    } catch (err: any) {
      console.error("Failed to load clients:", err);
    }
  };

  async function loadSettings() {
    try {
      setLoading(true);
      const data = await settingsService.getCompanySettings();
      if (data) {
        setCompanyName(data.name || "demologistics HQ");
        setTimezone(data.timezone || "America/New_York");
        setCurrency(data.currency || "EUR");
        setEmailNotifs(data.emailNotifs ?? true);
        setOrderNotifs(data.orderNotifs ?? true);
        setLowStockNotifs(data.lowStockNotifs ?? true);
        setShipmentNotifs(data.shipmentNotifs ?? false);
        setBlindReceiving(Boolean(data.blindReceiving));
        setKeys(data.apiKeys || []);

        setTradingName(data.tradingName || "");
        setVatNumber(data.vatNumber || "");
        setLogo(data.logo || "");
        setPhone(data.phone || "");
        setEmail(data.email || "");
        setWebsite(data.website || "");
        if (data.address) {
          setStreet(data.address.street || "");
          setNumber(data.address.number || "");
          setPostcode(data.address.postcode || "");
          setCity(data.address.city || "");
          setRegion(data.address.region || "");
          setCountry(data.address.country || "");
        }
      }
    } catch (err) {
      toast.error(t.common?.error || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
    fetchClientsList();
    fetchRoles();
  }, []);

  const handleSaveClientForm = async () => {
    if (!clientFormState.name.trim()) {
      toast.error("Client/Owner name is required.");
      return;
    }
    try {
      if (editingClientTarget) {
        await clientsService.update(editingClientTarget._id, {
          name: clientFormState.name.trim(),
          vat: clientFormState.vat,
          contact: clientFormState.contact,
          email: clientFormState.email,
          phone: clientFormState.phone,
          warehouseAccess: [clientFormState.warehouseAccess]
        });
        toast.success(`Client/Owner '${clientFormState.name}' updated.`);
      } else {
        await clientsService.create({
          name: clientFormState.name.trim(),
          vat: clientFormState.vat,
          contact: clientFormState.contact,
          email: clientFormState.email,
          phone: clientFormState.phone,
          warehouseAccess: [clientFormState.warehouseAccess]
        });
        toast.success(`Client/Owner '${clientFormState.name}' created.`);
      }
      setShowAddClientModal(false);
      setEditingClientTarget(null);
      setClientFormState({ name: "", vat: "", contact: "", email: "", phone: "", warehouseAccess: "MIA" });
      fetchClientsList();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save Client/Owner");
    }
  };

  const handleDeleteClientItem = async (id: string) => {
    try {
      await clientsService.delete(id);
      toast.success("Client/Owner deleted.");
      fetchClientsList();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete Client/Owner");
    }
  };

  async function handleSaveGeneral() {
    try {
      await settingsService.updateCompanySettings({ name: companyName, timezone, currency });
      toast.success(t.common?.operationSuccess || "General settings saved.");
    } catch (err) {
      toast.error(t.common?.error || "Failed to save settings");
    }
  }

  async function handleSaveBranding() {
    try {
      await settingsService.updateCompanySettings({
        name: companyName,
        tradingName,
        vatNumber,
        logo,
        phone,
        email,
        website,
        address: { street, number, postcode, city, region, country },
      });
      toast.success(t.common?.operationSuccess || "Company branding saved successfully!");
    } catch (err) {
      toast.error(t.common?.error || "Failed to save company branding.");
    }
  }

  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t.common?.error || "Logo file size must be less than 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogo(reader.result);
        toast.success("Logo uploaded. Click 'Save Company Branding' to apply.");
      }
    };
    reader.readAsDataURL(file);
  }

  async function handlePreviewDeliveryNote() {
    try {
      setPreviewLoading(true);
      const res = await fetch("/api/v1/documents/preview-delivery-note", {
        credentials: 'include'
      });
      if (!res.ok) throw new Error("Failed to generate preview");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "DeliveryNote-Preview.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t.common?.operationSuccess || "Sample Delivery Note downloaded for preview!");
    } catch (err) {
      toast.error(t.common?.error || "Failed to preview delivery note.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleToggleNotif(field: string, val: boolean) {
    try {
      await settingsService.updateCompanySettings({ [field]: val });
      if (field === 'emailNotifs') setEmailNotifs(val);
      if (field === 'orderNotifs') setOrderNotifs(val);
      if (field === 'lowStockNotifs') setLowStockNotifs(val);
      if (field === 'shipmentNotifs') setShipmentNotifs(val);
      toast.success(t.common?.operationSuccess || "Notification preferences updated.");
    } catch (err) {
      toast.error(t.common?.error || "Failed to update preferences");
    }
  }

  async function handleUpdatePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error(t.common?.error || "Please fill in all password fields."); return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t.common?.error || "New passwords do not match."); return;
    }
    if (newPassword.length < 6) {
      toast.error(t.common?.error || "New password must be at least 6 characters."); return;
    }
    try {
      setPwLoading(true);
      await authService.changePassword(currentPassword, newPassword);
      toast.success(t.common?.operationSuccess || "Password updated successfully.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to update password.");
    } finally {
      setPwLoading(false);
    }
  }

  async function handleInviteMember() {
    if (!inviteEmail || !invitePassword) { toast.error(t.common?.error || "Email and password are required."); return; }
    try {
      setInviteLoading(true);
      await adminService.inviteUser({ email: inviteEmail, name: inviteName, password: invitePassword, role: inviteRole });
      toast.success(`${inviteEmail} has been invited.`);
      setShowInvite(false); setInviteEmail(""); setInviteName(""); setInvitePassword(""); setInviteRole("warehouse_staff");
      const data = await adminService.getUsers();
      setTeamMembers(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to invite member.");
    } finally {
      setInviteLoading(false);
    }
  }

  function handleRemoveMember(id: string) {
    setConfirmDeleteMemberId(id);
  }

  const fetchRoles = async () => {
    try {
      setRolesLoading(true);
      const data = await adminService.getRoles();
      if (Array.isArray(data) && data.length > 0) {
        setRolesList(data);
      }
    } catch (err: any) {
      console.error("Failed to load roles:", err);
    } finally {
      setRolesLoading(false);
    }
  };

  const handleOpenCreateRole = () => {
    setRoleModalMode('create');
    setActiveRoleTarget(null);
    setRoleForm({
      roleId: '',
      name: '',
      description: '',
      color: 'bg-primary/15 text-primary',
      permissions: permissionModules.reduce((acc, m) => ({ ...acc, [m]: false }), {})
    });
    setShowRoleModal(true);
  };

  const handleOpenEditRole = (role: any, mode: 'edit' | 'view') => {
    setRoleModalMode(mode);
    setActiveRoleTarget(role);
    setRoleForm({
      roleId: role.roleId || role.id,
      name: role.name,
      description: role.description || '',
      color: role.color || 'bg-primary/15 text-primary',
      permissions: { ...(role.permissions || {}) }
    });
    setShowRoleModal(true);
  };

  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) {
      toast.error('Role name is required');
      return;
    }
    try {
      if (roleModalMode === 'create') {
        await adminService.createRole({
          name: roleForm.name.trim(),
          roleId: roleForm.roleId.trim() || undefined,
          description: roleForm.description,
          color: roleForm.color,
          permissions: roleForm.permissions
        });
        toast.success(`Role '${roleForm.name}' created successfully`);
      } else {
        await adminService.updateRole(activeRoleTarget.roleId || activeRoleTarget.id, {
          name: roleForm.name.trim(),
          description: roleForm.description,
          color: roleForm.color,
          permissions: roleForm.permissions
        });
        toast.success(`Role '${roleForm.name}' updated successfully`);
      }
      setShowRoleModal(false);
      fetchRoles();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Failed to save role');
    }
  };

  const handleDeleteRole = (role: any) => {
    if (role.isSystem || role.id === 'admin') {
      toast.error('Cannot delete built-in system role');
      return;
    }
    setConfirmDeleteRoleTarget(role);
  };

  const handleOpenEditUserRole = (u: User) => {
    setEditingUserTarget(u);
    setEditingUserRole(u.role);
  };

  const handleSaveUserRole = async () => {
    if (!editingUserTarget) return;
    try {
      setEditUserLoading(true);
      await adminService.updateUser(editingUserTarget._id, { role: editingUserRole });
      toast.success(`Updated role for ${editingUserTarget.name || editingUserTarget.email}`);
      setEditingUserTarget(null);
      const data = await adminService.getUsers();
      setTeamMembers(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Failed to update user role');
    } finally {
      setEditUserLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "team") {
      adminService.getUsers().then(data => setTeamMembers(data)).catch(() => toast.error(t.common?.error || "Failed to load users"));
      fetchRoles();
    } else if (activeTab === "roles") {
      fetchRoles();
    }
  }, [activeTab]);

  function handleCreateKey() {
    setShowCreateKeyPrompt(true);
  }

  function handleDeleteKey(id: string) {
    setConfirmDeleteKey(id);
  }

  const Toggle = ({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-secondary border border-border"}`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Tabs */}
      <div className="lg:w-48 shrink-0">
        <nav className="space-y-0.5">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {activeTab === "general" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-5">
              <h3 className="font-bold">{t.settings.companySettings}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.companyName}</label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem" }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.timezone}</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem" }}
                  >
                    <option value="America/New_York">{tc?.americaNewYork || "America/New_York"}</option>
                    <option value="America/Los_Angeles">{tc?.americaLosAngeles || "America/Los_Angeles"}</option>
                    <option value="Europe/London">{tc?.europeLondon || "Europe/London"}</option>
                    <option value="Europe/Madrid">Europe/Madrid</option>
                    <option value="Europe/Paris">{tc?.europeParis || "Europe/Paris"}</option>
                    <option value="Asia/Tokyo">{tc?.asiaTokyo || "Asia/Tokyo"}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.currency}</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors"
                    style={{ fontSize: "0.875rem" }}
                  >
                    <option value="EUR">{tc?.eUREuro || "EUR — Euro"}</option>
                    <option value="USD">{tc?.uSDUSDollar || "USD — US Dollar"}</option>
                    <option value="GBP">{tc?.gBPBritishPound || "GBP — British Pound"}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.settings.dateFormat}</label>
                  <select className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }}>
                    <option>{tc?.yYYYMMDD || "YYYY-MM-DD"}</option>
                    <option>{tc?.mMDDYYYY || "MM/DD/YYYY"}</option>
                    <option>{tc?.dDMMYYYY || "DD/MM/YYYY"}</option>
                  </select>
                </div>
              </div>

              {/* Blind Receiving Mode Toggle (O1) */}
              <div className="pt-4 border-t border-border flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Blind Receiving Mode</div>
                  <div className="text-xs text-muted-foreground">Hide expected & remaining quantities during receiving until actual count submission to eliminate operator confirmation bias.</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const nextVal = !blindReceiving;
                    try {
                      await settingsService.updateCompanySettings({ blindReceiving: nextVal });
                      setBlindReceiving(nextVal);
                      toast.success(nextVal ? "Blind Receiving Mode enabled" : "Blind Receiving Mode disabled");
                    } catch (_) {
                      toast.error("Failed to update Blind Receiving setting");
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${blindReceiving ? "bg-primary" : "bg-secondary"}`}
                >
                  <span className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${blindReceiving ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              <button onClick={handleSaveGeneral} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all">
                <Save className="size-4" /> {t.settings.saveChanges}
              </button>
            </div>
          </div>
        )}

        {activeTab === "suppliers" && (
          <Suppliers />
        )}

        {activeTab === "categories" && (
          <ProductCategories />
        )}

        {activeTab === "storage-rules" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="size-5 text-primary" />
              <div>
                <h2 className="text-base font-bold text-foreground">Storage Rules</h2>
                <p className="text-xs text-muted-foreground">Configure putaway routing rules. Canonical rules are auto-evaluated by the putaway engine in priority order.</p>
              </div>
            </div>
            <StorageRulesManager isAdmin={currentUserIsAdmin} compact={false} />
          </div>
        )}

        {activeTab === "abc-classification" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="size-5 text-primary" />
              <div>
                <h2 className="text-base font-bold text-foreground">ABC Classification</h2>
                <p className="text-xs text-muted-foreground">Manage product ABC classifications based on 30-day rolling sales volume. Set manual overrides and trigger recalculation.</p>
              </div>
            </div>
            <ABCClassificationManager />
          </div>
        )}

        {activeTab === "branding" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h3 className="font-bold text-lg">Company Branding & Documents Setup</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure your tenant company details. All generated PDF Delivery Notes dynamically load this branding.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePreviewDeliveryNote}
                  disabled={previewLoading}
                  className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
                >
                  <FileText className="size-4" />
                  {previewLoading ? "Generating Preview..." : "Preview Delivery Note"}
                </button>
              </div>

              {/* Logo Box */}
              <div>
                <label className="text-sm font-medium mb-2 block">Company Logo</label>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="size-24 rounded-xl border-2 border-dashed border-border bg-secondary/30 flex items-center justify-center overflow-hidden p-2 text-center relative">
                    {logo ? (
                      <img src={logo} alt="Company Logo" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <div className="text-center">
                        <Building2 className="size-6 text-muted-foreground mx-auto mb-1 opacity-50" />
                        <span className="text-[10px] text-muted-foreground font-semibold uppercase">{tradingName || companyName || "LOGO"}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold cursor-pointer border border-border transition-colors">
                      <Upload className="size-4" /> Upload Logo Image
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
                    </label>
                    {logo && (
                      <button
                        type="button"
                        onClick={() => setLogo("")}
                        className="block text-xs text-destructive hover:underline"
                      >
                        Remove Logo
                      </button>
                    )}
                    <p className="text-xs text-muted-foreground">PNG or JPG under 2MB. Displayed on top-left of Delivery Notes.</p>
                  </div>
                </div>
              </div>

              {/* Legal & Trading Names */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Legal Company Name *</label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={tc?.houseLogisticSL || "House Logistic S.L."}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Trading Name</label>
                  <input
                    value={tradingName}
                    onChange={(e) => setTradingName(e.target.value)}
                    placeholder={tc?.houseLogistic || "House Logistic"}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">VAT / CIF / NIF *</label>
                  <input
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    placeholder={tc?.b12345678 || "B-12345678"}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 text-sm transition-colors"
                  />
                </div>
              </div>

              {/* Contact Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Phone Number</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+34 91 000 0000"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Email Address</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={tc?.logisticsHouselogisticEs || "logistics@houselogistic.es"}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Website (Optional)</label>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder={tc?.wwwHouselogisticEs || "www.houselogistic.es"}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 text-sm transition-colors"
                  />
                </div>
              </div>

              {/* Address Header */}
              <div className="pt-2 border-t border-border">
                <h4 className="font-semibold text-sm mb-3">Official Warehouse Address</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">Street Name</label>
                    <input
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder={tc?.polGonoIndustrialNorte || "Polígono Industrial Norte"}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">Building / Nave #</label>
                    <input
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      placeholder={tc?.nave7 || "Nave 7"}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">Postcode</label>
                    <input
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                      placeholder="28001"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">City</label>
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder={t.common?.madrid || "Madrid"}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block text-muted-foreground">Country</label>
                    <input
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder={t.common?.spain || "Spain"}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={handleSaveBranding}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all shadow-sm"
                >
                  <Save className="size-4" /> Save Company Branding
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "owners" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-base">Clients / 3PL Owners Master List</h3>
                  <p className="text-xs text-muted-foreground">Centralized single source of truth for stock ownership across ASN, Products, Picking, Inventory, and Transfers.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingClientTarget(null);
                    setClientFormState({ name: "", vat: "", contact: "", email: "", phone: "", warehouseAccess: "MIA" });
                    setShowAddClientModal(true);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all"
                >
                  <Plus className="size-3.5" /> Add Client / Owner
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold">Client / Owner Name</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold">VAT / Tax ID</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold">Contact Person</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold">Warehouses</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clientsList.map((c) => (
                      <tr key={c._id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 font-semibold text-foreground flex items-center gap-2">
                          <Building2 className="size-4 text-primary" /> {c.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.vat || "N/A"}</td>
                        <td className="px-4 py-3 text-xs">{c.contact || c.email || "N/A"}</td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {(c.warehouseAccess || ['MIA']).join(', ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingClientTarget(c);
                                setClientFormState({
                                  name: c.name,
                                  vat: c.vat || "",
                                  contact: c.contact || "",
                                  email: c.email || "",
                                  phone: c.phone || "",
                                  warehouseAccess: (c.warehouseAccess && c.warehouseAccess[0]) || "MIA"
                                });
                                setShowAddClientModal(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                              title="Edit Client"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteClientItem(c._id)}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"
                              title="Delete Client"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {clientsList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">
                          No Clients / Owners found. Click "Add Client / Owner" to create one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {showAddClientModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddClientModal(false)} />
                <div className="relative w-full max-w-md bg-card border border-border rounded-xl p-5 shadow-2xl z-10 space-y-4 animate-pop-in">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <h3 className="font-bold text-sm text-foreground">
                      {editingClientTarget ? "Edit Client / Owner" : "Create New Client / Owner"}
                    </h3>
                    <button onClick={() => setShowAddClientModal(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground">
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold block mb-1">Client / Owner Name *</label>
                      <input
                        value={clientFormState.name}
                        onChange={(e) => setClientFormState({ ...clientFormState, name: e.target.value })}
                        placeholder="e.g. Apple Distribution 3PL"
                        className="w-full p-2 border border-border bg-secondary/50 rounded-lg text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-1">VAT / Tax ID</label>
                      <input
                        value={clientFormState.vat}
                        onChange={(e) => setClientFormState({ ...clientFormState, vat: e.target.value })}
                        placeholder="e.g. US-998877665"
                        className="w-full p-2 border border-border bg-secondary/50 rounded-lg text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-1">Contact Person</label>
                      <input
                        value={clientFormState.contact}
                        onChange={(e) => setClientFormState({ ...clientFormState, contact: e.target.value })}
                        placeholder="e.g. Operations Manager"
                        className="w-full p-2 border border-border bg-secondary/50 rounded-lg text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-1">Warehouse Access</label>
                      <select
                        value={clientFormState.warehouseAccess}
                        onChange={(e) => setClientFormState({ ...clientFormState, warehouseAccess: e.target.value })}
                        className="w-full p-2 border border-border bg-secondary/50 rounded-lg text-xs outline-none"
                      >
                        <option value="MIA">MIA (Miami Main Warehouse)</option>
                        <option value="LAX">LAX (Los Angeles Hub)</option>
                        <option value="ORD">ORD (Chicago Central)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => setShowAddClientModal(false)}
                      className="px-3 py-1.5 border border-border text-xs rounded-lg hover:bg-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveClientForm}
                      className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90"
                    >
                      {editingClientTarget ? "Save Changes" : "Create Client"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <h3 className="font-bold">{t.settings.notifPrefs}</h3>
            {[
              { label: t.settings.emailNotifs, sub: t.settings.emailNotifsSub, value: emailNotifs, toggle: () => handleToggleNotif('emailNotifs', !emailNotifs) },
              { label: t.settings.orderAlerts, sub: t.settings.orderAlertsSub, value: orderNotifs, toggle: () => handleToggleNotif('orderNotifs', !orderNotifs) },
              { label: t.settings.lowStockAlerts, sub: t.settings.lowStockAlertsSub, value: lowStockNotifs, toggle: () => handleToggleNotif('lowStockNotifs', !lowStockNotifs) },
              { label: t.settings.shipmentUpdates, sub: t.settings.shipmentUpdatesSub, value: shipmentNotifs, toggle: () => handleToggleNotif('shipmentNotifs', !shipmentNotifs) },
            ].map((n) => (
              <div key={n.label} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div>
                  <div className="text-sm font-medium">{n.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{n.sub}</div>
                </div>
                <Toggle enabled={n.value} onToggle={n.toggle} />
              </div>
            ))}
          </div>
        )}

        {activeTab === "security" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="font-bold mb-4">{t.settings.password}</h3>
              <div className="space-y-3 max-w-sm">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.common?.currentPassword || "Current password"}</label>
                  <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.common?.newPassword || "New password"}</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t.common?.confirmPassword || "Confirm new password"}</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
                </div>
                <button onClick={handleUpdatePassword} disabled={pwLoading} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all mt-2 disabled:opacity-50">
                  <Shield className="size-4" /> {pwLoading ? t.settings.twoFactorAuth?.submitting || "Updating…" : t.settings.updatePassword}
                </button>
              </div>
            </div>
            <TwoFactorAuthSection t={t} />
          </div>
        )}

        {activeTab === "team" && (
          <div className="space-y-4">
            {/* Invite Modal */}
            {showInvite && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowInvite(false)}>
                <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-lg">Invite Team Member</h3>
                    <button onClick={() => setShowInvite(false)} className="p-1 rounded-lg hover:bg-secondary transition-colors"><X className="size-4" /></button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Email *</label>
                      <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} type="email" placeholder={tc?.colleagueCompanyCom || "colleague@company.com"} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Full Name</label>
                      <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder={tc?.johnSmith || "John Smith"} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Temporary Password *</label>
                      <input value={invitePassword} onChange={e => setInvitePassword(e.target.value)} type="password" placeholder={tc?.min6Characters || "Min 6 characters"} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Role</label>
                      <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm">
                        {rolesList.map((r: any) => (
                          <option key={r.id || r.roleId} value={r.id || r.roleId}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <button onClick={() => setShowInvite(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors">{tc?.cancel || "Cancel"}</button>
                    <button onClick={handleInviteMember} disabled={inviteLoading} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50">
                      {inviteLoading ? "Inviting…" : "Add Member"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit User Role Modal */}
            {editingUserTarget && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingUserTarget(null)}>
                <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-lg">Change Role</h3>
                    <button onClick={() => setEditingUserTarget(null)} className="p-1 rounded-lg hover:bg-secondary transition-colors"><X className="size-4" /></button>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Update platform permissions for <strong>{editingUserTarget.name || editingUserTarget.email}</strong>.
                    </p>
                    <label className="text-sm font-medium mb-1.5 block">Select Role</label>
                    <select
                      value={editingUserRole}
                      onChange={e => setEditingUserRole(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/50 transition-colors text-sm"
                    >
                      {rolesList.map((r: any) => (
                        <option key={r.id || r.roleId} value={r.id || r.roleId}>
                          {r.name} {r.description ? `— ${r.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end pt-2 border-t border-border">
                    <button onClick={() => setEditingUserTarget(null)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors">{tc?.cancel || "Cancel"}</button>
                    <button onClick={handleSaveUserRole} disabled={editUserLoading} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-1.5">
                      {editUserLoading && <Loader2 className="size-3.5 animate-spin" />}
                      Save Role
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-bold">Team Members</h3>
                <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all">
                  <Users className="size-3.5" /> Invite member
                </button>
              </div>
              {teamMembers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No team members found.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-3">Member</th>
                      <th className="text-left px-4 py-3 hidden sm:table-cell">Role</th>
                      <th className="text-left px-4 py-3 hidden sm:table-cell">2FA Status</th>
                      <th className="text-left px-4 py-3 hidden md:table-cell">Joined</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map((m, i) => (
                      <tr key={m._id} className="border-t border-border animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-primary-foreground">
                              {(m.name || m.email).slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium">{m.name || m.email}</div>
                              <div className="text-xs text-muted-foreground">{m.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            m.role === "admin" ? "bg-primary/15 text-primary" : m.role === "manager" ? "bg-amber-500/15 text-amber-500" : "bg-secondary text-muted-foreground"
                          }`}>{m.role}</span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {m.totpEnabled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                              <Shield className="size-3" /> Enabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                              Disabled
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{m.createdAt?.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleOpenEditUserRole(m)}
                              className="text-xs text-primary hover:underline font-medium"
                            >
                              Edit Role
                            </button>
                            <button
                              onClick={() => handleRemoveMember(m._id)}
                              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === "roles" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold">Roles & Permissions</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Define custom roles and configure server-enforced access per module</p>
              </div>
              <button
                onClick={handleOpenCreateRole}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all"
              >
                <Plus className="size-3.5" /> New role
              </button>
            </div>

            {/* Permission matrix */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[750px]">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs text-muted-foreground font-semibold">Role</th>
                      {permissionModules.map((m) => (
                        <th key={m} className="px-2.5 py-3 text-center text-xs text-muted-foreground font-semibold capitalize">{m}</th>
                      ))}
                      <th className="px-4 py-3 text-right text-xs text-muted-foreground font-semibold">{t.common?.actions || "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolesList.map((role: any, i: number) => {
                      const roleKey = role.id || role.roleId;
                      const userCount = teamMembers.filter((m) => m.role === roleKey).length;
                      return (
                        <tr key={roleKey} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${role.color || "bg-primary/15 text-primary"}`}>{role.name}</span>
                              <span className="text-xs text-muted-foreground hidden lg:block">{userCount} user{userCount !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 hidden md:block">{role.description}</div>
                          </td>
                          {permissionModules.map((mod) => (
                            <td key={mod} className="px-2.5 py-3 text-center">
                              {role.permissions && role.permissions[mod]
                                ? <span className="size-5 rounded-full bg-success/15 text-success inline-flex items-center justify-center text-xs font-bold">✓</span>
                                : <span className="size-5 rounded-full bg-secondary text-muted-foreground/30 inline-flex items-center justify-center text-xs">—</span>
                              }
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenEditRole(role, 'view')}
                                className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                                title="View details"
                              >
                                <Eye className="size-3.5" />
                              </button>
                              {roleKey !== "admin" && (
                                <button
                                  onClick={() => handleOpenEditRole(role, 'edit')}
                                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                                  title="Edit role"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              )}
                              {!role.isSystem && roleKey !== "admin" && (
                                <button
                                  onClick={() => handleDeleteRole(role)}
                                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"
                                  title="Delete role"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">
                All permissions are strictly enforced on the server for every API endpoint. System roles cannot be deleted, but permissions on custom roles can be fully tailored.
              </p>
            </div>

            {/* Role Create / Edit / View Modal */}
            {showRoleModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowRoleModal(false)}>
                <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <h3 className="font-bold text-lg">
                      {roleModalMode === 'create' ? "Create Custom Role" : roleModalMode === 'edit' ? `Edit Role: ${roleForm.name}` : `Role Details: ${roleForm.name}`}
                    </h3>
                    <button onClick={() => setShowRoleModal(false)} className="p-1 rounded-lg hover:bg-secondary transition-colors">
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold block mb-1">Role Name *</label>
                        <input
                          disabled={roleModalMode === 'view'}
                          value={roleForm.name}
                          onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                          placeholder="e.g. Quality Inspector"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm outline-none focus:border-primary/50"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold block mb-1">Role Identifier (Slug)</label>
                        <input
                          disabled={roleModalMode !== 'create'}
                          value={roleForm.roleId}
                          onChange={e => setRoleForm({ ...roleForm, roleId: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                          placeholder="e.g. quality_inspector"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm outline-none focus:border-primary/50 font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold block mb-1">Description</label>
                      <input
                        disabled={roleModalMode === 'view'}
                        value={roleForm.description}
                        onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                        placeholder="Brief summary of responsibilities..."
                        className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm outline-none focus:border-primary/50"
                      />
                    </div>

                    {roleModalMode !== 'view' && (
                      <div>
                        <label className="text-xs font-semibold block mb-1">Badge Color</label>
                        <div className="flex gap-2 flex-wrap">
                          {[
                            { label: "Blue", class: "bg-primary/15 text-primary" },
                            { label: "Amber", class: "bg-amber-500/15 text-amber-500" },
                            { label: "Emerald", class: "bg-emerald-500/15 text-emerald-500" },
                            { label: "Purple", class: "bg-purple-500/15 text-purple-500" },
                            { label: "Rose", class: "bg-rose-500/15 text-rose-500" },
                            { label: "Cyan", class: "bg-cyan-500/15 text-cyan-500" }
                          ].map(c => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => setRoleForm({ ...roleForm, color: c.class })}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${c.class} ${roleForm.color === c.class ? "ring-2 ring-primary ring-offset-2" : "border-transparent"}`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Permissions list */}
                    <div className="pt-2 border-t border-border">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold">Module Permissions</label>
                        {roleModalMode !== 'view' && (
                          <div className="flex gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                const all: Record<string, boolean> = {};
                                permissionModules.forEach(m => { all[m] = true; });
                                setRoleForm({ ...roleForm, permissions: all });
                              }}
                              className="text-primary hover:underline"
                            >
                              Select All
                            </button>
                            <span className="text-muted-foreground">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                const none: Record<string, boolean> = {};
                                permissionModules.forEach(m => { none[m] = false; });
                                setRoleForm({ ...roleForm, permissions: none });
                              }}
                              className="text-muted-foreground hover:underline"
                            >
                              Clear All
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-secondary/30 p-3 rounded-xl border border-border">
                        {permissionModules.map(mod => {
                          const isChecked = Boolean(roleForm.permissions[mod]);
                          return (
                            <label
                              key={mod}
                              className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer select-none transition-colors ${isChecked ? "bg-card border border-primary/30" : "hover:bg-secondary"}`}
                            >
                              <input
                                type="checkbox"
                                disabled={roleModalMode === 'view'}
                                checked={isChecked}
                                onChange={e => {
                                  setRoleForm({
                                    ...roleForm,
                                    permissions: {
                                      ...roleForm.permissions,
                                      [mod]: e.target.checked
                                    }
                                  });
                                }}
                                className="rounded border-border text-primary focus:ring-primary size-4"
                              />
                              <span className="capitalize font-medium">{mod}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-3 border-t border-border">
                    <button
                      onClick={() => setShowRoleModal(false)}
                      className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors"
                    >
                      {roleModalMode === 'view' ? 'Close' : 'Cancel'}
                    </button>
                    {roleModalMode !== 'view' && (
                      <button
                        onClick={handleSaveRole}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-all"
                      >
                        {roleModalMode === 'create' ? 'Create Role' : 'Save Changes'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "api" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">API Keys</h3>
                <button onClick={handleCreateKey} className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-all">
                  <Key className="size-3.5" /> Generate key
                </button>
              </div>
              <div className="space-y-3">
                {keys.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4 text-center border border-dashed border-border rounded-xl">No API keys generated yet.</div>
                ) : keys.map((k, i) => (
                  <div key={k._id || k.key} className="flex items-center justify-between p-4 bg-secondary/50 rounded-xl border border-border animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold">{k.name}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-success/15 text-success`}>Active</span>
                      </div>
                      <div className="text-xs text-muted-foreground" style={{ fontFamily: "JetBrains Mono, monospace" }}>{k.key}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">Created: {new Date(k.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs font-medium hover:bg-secondary/80 transition-colors">Revoke</button>
                      <button onClick={() => handleDeleteKey(k._id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-bold mb-1">API Documentation</h3>
              <p className="text-sm text-muted-foreground mb-3">Integrate ELVIS WMS with your existing systems using our interactive OpenAPI REST documentation.</p>
              <button
                onClick={() => setShowApiDocs(true)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-secondary transition-colors flex items-center gap-2"
              >
                <FileText className="size-4 text-primary" /> View docs
              </button>
            </div>
          </div>
        )}
      </div>

      {/* OpenAPI Documentation Modal */}
      {showApiDocs && <ApiDocsModal onClose={() => setShowApiDocs(false)} />}

      {/* Create API Key In-App Prompt Modal */}
      <PromptModal
        open={showCreateKeyPrompt}
        onClose={() => setShowCreateKeyPrompt(false)}
        onSubmit={async (name) => {
          try {
            const updatedKeys = await settingsService.createApiKey(name);
            setKeys(updatedKeys);
            toast.success(t.common?.operationSuccess || "API key created.");
          } catch (err) {
            toast.error(t.common?.error || "Failed to create API key.");
          }
        }}
        title="Create API Key"
        subtitle="Generate a new API key for external service integrations"
        label="Key Identifier / Name"
        placeholder="e.g. ERP Integration Key"
        submitText="Generate Key"
      />

      {/* Delete API Key Confirm Modal */}
      <ConfirmModal
        open={Boolean(confirmDeleteKey)}
        onClose={() => setConfirmDeleteKey(null)}
        onConfirm={async () => {
          if (!confirmDeleteKey) return;
          try {
            const updatedKeys = await settingsService.deleteApiKey(confirmDeleteKey);
            setKeys(updatedKeys);
            setConfirmDeleteKey(null);
            toast.success(t.common?.operationSuccess || "API key deleted.");
          } catch (err) {
            toast.error(t.common?.error || "Failed to delete API key.");
          }
        }}
        title="Delete API Key"
        message="Are you sure you want to delete this API key? This will permanently break any integrations using it."
        confirmText="Delete Key"
        variant="destructive"
      />

      {/* Delete Member Confirm Modal */}
      <ConfirmModal
        open={Boolean(confirmDeleteMemberId)}
        onClose={() => setConfirmDeleteMemberId(null)}
        onConfirm={async () => {
          if (!confirmDeleteMemberId) return;
          try {
            await adminService.deleteUser(confirmDeleteMemberId);
            setTeamMembers(prev => prev.filter(m => m._id !== confirmDeleteMemberId));
            setConfirmDeleteMemberId(null);
            toast.success(t.common?.operationSuccess || "Team member removed.");
          } catch (err: any) {
            toast.error(err?.response?.data?.message || "Failed to remove member.");
          }
        }}
        title="Remove Team Member"
        message="Are you sure you want to remove this team member? They will lose access to the system immediately."
        confirmText="Remove Member"
        variant="destructive"
      />

      {/* Delete Role Confirm Modal */}
      <ConfirmModal
        open={Boolean(confirmDeleteRoleTarget)}
        onClose={() => setConfirmDeleteRoleTarget(null)}
        onConfirm={async () => {
          if (!confirmDeleteRoleTarget) return;
          const roleKey = confirmDeleteRoleTarget.roleId || confirmDeleteRoleTarget.id;
          try {
            await adminService.deleteRole(roleKey);
            toast.success(`Role '${confirmDeleteRoleTarget.name}' deleted.`);
            setConfirmDeleteRoleTarget(null);
            fetchRoles();
          } catch (err: any) {
            toast.error(err?.response?.data?.message || err.message || "Failed to delete role.");
          }
        }}
        title="Delete Custom Role"
        message={`Are you sure you want to delete role '${confirmDeleteRoleTarget?.name}'? Users assigned to this role must be reassigned first.`}
        confirmText="Delete Role"
        variant="destructive"
      />
    </div>
  );
}

// Wrap Settings in Error Boundary
export default function SettingsWithErrorBoundary() {
  return (
    <SettingsErrorBoundary>
      <Settings />
    </SettingsErrorBoundary>
  );
}
