import { useState } from "react";
import { AlertTriangle, Search, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./AppShell";
import { TablePagination } from "./TablePagination";
import { useLang } from "../LangContext";
import { usePaginatedList } from "../../hooks/usePaginatedList";
import { incidentsService } from "../../services/incidents.service";

export function Incidents() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase();

  const { items: incidents, allItems, pagination, page, setPage, isLoading, reload } = usePaginatedList<any>(
    incidentsService,
    {
      apiParams: { search: searchLower || undefined },
      deps: [search],
    }
  );

  const openIncidents = allItems.filter((i) => i.status !== "resolved").length;
  const qcRejects = allItems.filter((i) => i.type?.includes("QC")).length;

  async function resolveIncident(incident: any) {
    try {
      await incidentsService.update(incident._id, { status: "resolved" });
      toast.success(`Incident ${incident.incidentId} resolved.`);
      reload();
    } catch (err) {
      toast.error(t.common?.error || "Failed to resolve incident");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Open", value: openIncidents, icon: AlertTriangle, color: "text-warning" },
          { label: "QC Failures", value: qcRejects, icon: ShieldAlert, color: "text-destructive" },
          { label: "Resolved", value: allItems.length - openIncidents, icon: CheckCircle2, color: "text-success" },
        ].map((s, i) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 hover-lift animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center justify-between mb-2"><span className="text-xs text-muted-foreground">{s.label}</span><s.icon className={`size-4 ${s.color}`} /></div>
            <div className="font-bold" style={{ fontSize: "1.5rem", fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t.common?.search || "Search"}  Incidents...`} className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:border-primary/50 transition-colors" style={{ fontSize: "0.875rem" }} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left px-4 py-3">ID</th>
              <th className="text-left px-4 py-3">{t.common?.type || "Type"}</th>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Details</th>
              <th className="text-center px-4 py-3">{t.common?.status || "Status"}</th>
              <th className="text-right px-4 py-3">{t.common?.actions || "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc, i) => (
              <tr key={inc._id || i} className="border-t border-border hover:bg-secondary/30 transition-colors animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
                <td className="px-4 py-3 font-semibold" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{inc.incidentId}</td>
                <td className="px-4 py-3 font-semibold text-destructive">{inc.type}</td>
                <td className="px-4 py-3" style={{ fontFamily: "JetBrains Mono, monospace" }}>{inc.sku || "—"}</td>
                <td className="px-4 py-3">
                  <div className="text-xs truncate max-w-xs">{inc.description}</div>
                  <div className="text-[10px] text-muted-foreground">Reported by: {inc.reported_by}</div>
                </td>
                <td className="px-4 py-3 text-center"><StatusBadge status={inc.status} /></td>
                <td className="px-4 py-3 text-right">
                  {inc.status !== "resolved" && (
                    <button onClick={() => resolveIncident(inc)} className="text-xs px-3 py-1.5 bg-success/20 text-success rounded font-bold hover:bg-success hover:text-success-foreground transition-colors">
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {incidents.length === 0 && !isLoading && <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No incidents found</td></tr>}
          </tbody>
        </table>
        <TablePagination pagination={pagination} page={page} onPageChange={setPage} />
      </div>
    </div>
  );
}
