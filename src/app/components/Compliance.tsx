import { useState, useEffect } from "react";
import { ShieldCheck, Upload, Key, FileText, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "./AppShell";
import { Field, Input, Select, Row } from "./Modal";
import { toast } from "sonner";
import { complianceService, type ComplianceConfig } from "../../services/compliance.service";

export function Compliance() {
  const [activeTab, setActiveTab] = useState<"verifactu" | "sii" | "certificates">("certificates");
  
  const [config, setConfig] = useState<ComplianceConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [pfxBase64, setPfxBase64] = useState<string>("");

  const [verifactuRecords, setVerifactuRecords] = useState<any[]>([]);
  const [siiRecords, setSiiRecords] = useState<any[]>([]);

  useEffect(() => {
    loadConfig();
    loadVerifactu();
    loadSii();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await complianceService.getConfig();
      setConfig(data);
    } catch (e) {
      toast.error("Failed to load compliance config");
    }
  };

  const loadVerifactu = async () => {
    try {
      const data = await complianceService.getVerifactu();
      setVerifactuRecords(data);
    } catch (e) { }
  };

  const loadSii = async () => {
    try {
      const data = await complianceService.getSii();
      setSiiRecords(data);
    } catch (e) { }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPfxFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result is like data:application/x-pkcs12;base64,.....
        const base64 = result.split(',')[1];
        setPfxBase64(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveCert = async () => {
    if (!pfxBase64) {
      toast.error("Please select a certificate file.");
      return;
    }
    if (!password) {
      toast.error("Password is required to encrypt and use the certificate.");
      return;
    }
    setLoading(true);
    try {
      await complianceService.updateConfig({ pfxBase64, password });
      toast.success("Certificate uploaded and encrypted securely.");
      setPassword("");
      setPfxFile(null);
      setPfxBase64("");
      loadConfig();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to save certificate.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleVerifactu = async () => {
    if (!config) return;
    try {
      await complianceService.updateConfig({ verifactuEnabled: !config.verifactuEnabled });
      toast.success(`VeriFactu ${!config.verifactuEnabled ? 'Enabled' : 'Disabled'}`);
      loadConfig();
    } catch (e) {}
  };

  const handleToggleSii = async () => {
    if (!config) return;
    try {
      await complianceService.updateConfig({ siiEnabled: !config.siiEnabled });
      toast.success(`SII ${!config.siiEnabled ? 'Enabled' : 'Disabled'}`);
      loadConfig();
    } catch (e) {}
  };

  return (
    <div className="space-y-6 animate-pop-in">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border pb-3">
        {[
          { id: "certificates", label: "AEAT Certificates", icon: Key },
          { id: "verifactu", label: "VeriFactu Status", icon: ShieldCheck },
          { id: "sii", label: "SII Status", icon: FileText }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-card border border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            <tab.icon className="size-4" /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "certificates" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border p-6 rounded-xl space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Key className="size-5 text-primary" /> AEAT Digital Certificate
            </h3>
            <p className="text-sm text-muted-foreground">
              Upload your .PFX or .P12 certificate to securely authenticate with the Spanish Tax Agency (AEAT) for VeriFactu and SII submissions.
            </p>
            
            <div className="space-y-4 pt-4 border-t border-border">
              <Field label="Upload Certificate (.pfx / .p12)">
                <div className="relative border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center text-center hover:border-primary/50 transition-colors">
                  <input type="file" accept=".pfx,.p12" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <Upload className="size-6 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">{pfxFile ? pfxFile.name : "Click to upload certificate"}</span>
                  <span className="text-xs text-muted-foreground mt-1">Encrypted with AES-256-GCM</span>
                </div>
              </Field>
              <Field label="Certificate Password">
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter certificate password" />
              </Field>
              <div className="flex justify-end pt-2">
                <PrimaryButton onClick={handleSaveCert} disabled={loading}>{loading ? "Saving..." : "Save Configuration"}</PrimaryButton>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-6 rounded-xl space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" /> Current Status
            </h3>
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg border border-border">
                <div>
                  <div className="text-sm font-semibold">Certificate Status</div>
                  <div className="text-xs text-muted-foreground">{config?.hasCertificate ? (config.certificateSubject || "Certificate securely stored") : "No certificate loaded"}</div>
                </div>
                <span className={`px-2 py-1 text-[10px] font-bold rounded-full uppercase ${config?.hasCertificate ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                  {config?.hasCertificate ? 'Active' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg border border-border">
                <div>
                  <div className="text-sm font-semibold">VeriFactu Ready</div>
                  <div className="text-xs text-muted-foreground">{config?.hasCertificate ? "Ready for submission" : "Requires valid certificate"}</div>
                </div>
                <span className={`px-2 py-1 text-[10px] font-bold rounded-full uppercase ${config?.hasCertificate ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                  {config?.hasCertificate ? 'Ready' : 'Not Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "verifactu" && (
        <div className="bg-card border border-border p-6 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" /> VeriFactu Submissions
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time tracking of invoice submissions to AEAT.
              </p>
            </div>
            <SecondaryButton icon={RefreshCw} onClick={loadVerifactu}>Refresh</SecondaryButton>
          </div>
          
          <div className="border border-border rounded-lg overflow-hidden mt-4">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase text-muted-foreground font-semibold">
                <tr>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Hash (Chain)</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">AEAT Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {verifactuRecords.map(r => (
                  <tr key={r._id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">{r.invoiceId?.invoiceNumber || r.supplierBillId?.billNumber}</td>
                    <td className="px-4 py-3">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono text-[10px] truncate max-w-[150px]">{r.hash || 'Pending'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                        ${r.status === 'ACCEPTED' ? 'bg-success/20 text-success' :
                          r.status === 'PENDING' ? 'bg-warning/20 text-warning' :
                          'bg-destructive/20 text-destructive'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.responseMessage || '-'}
                      {r.status === 'ERROR' && (
                        <button onClick={() => { complianceService.retryVerifactu(r._id); loadVerifactu(); }} className="ml-2 text-primary hover:underline">Retry</button>
                      )}
                    </td>
                  </tr>
                ))}
                {verifactuRecords.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No VeriFactu submissions found. Configure your AEAT certificate first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "sii" && (
        <div className="bg-card border border-border p-6 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                <FileText className="size-5 text-primary" /> SII (Suministro Inmediato de Información)
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Tracking of VAT register submissions (Libros Registro de IVA).
              </p>
            </div>
            <SecondaryButton icon={RefreshCw} onClick={loadSii}>Refresh</SecondaryButton>
          </div>
          
          <div className="border border-border rounded-lg overflow-hidden mt-4">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase text-muted-foreground font-semibold">
                <tr>
                  <th className="px-4 py-3">Batch ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {siiRecords.map(r => (
                  <tr key={r._id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 font-mono text-xs">{r._id.toString().substring(0,8)}</td>
                    <td className="px-4 py-3">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">{r.type}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                        ${r.status === 'ACCEPTED' ? 'bg-success/20 text-success' :
                          r.status === 'PENDING' ? 'bg-warning/20 text-warning' :
                          'bg-destructive/20 text-destructive'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.responseMessage || '-'}
                    </td>
                  </tr>
                ))}
                {siiRecords.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No SII submissions found. Configure your AEAT certificate first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
