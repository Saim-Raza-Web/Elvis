import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Search, BookOpen, ExternalLink, ShieldCheck, Download, Code } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../services/admin.service';

interface ApiDocsModalProps {
  onClose: () => void;
  isOpen?: boolean;
}

export function ApiDocsModal({ onClose, isOpen = true }: ApiDocsModalProps) {
  if (!isOpen) return null;

  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Close on ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  useEffect(() => {
    adminService.getApiDocs()
      .then(data => {
        setSpec(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load API docs:', err);
        setLoading(false);
      });
  }, []);

  const handleCopyCurl = (method: string, path: string, idx: number) => {
    const origin = window.location.origin;
    const curl = `curl -X ${method.toUpperCase()} "${origin}/api/v1${path}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-CSRF-Token: <your-csrf-token>" \\\n  --cookie "jwt_token=<your-session-cookie>"`;
    navigator.clipboard.writeText(curl);
    setCopiedIndex(idx);
    toast.success('cURL command copied to clipboard');
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleDownloadSpec = () => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'elvis-wms-openapi.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('OpenAPI specification downloaded');
  };

  // Extract endpoints list
  const endpoints: any[] = [];
  if (spec?.paths) {
    Object.entries(spec.paths).forEach(([path, methods]: [string, any]) => {
      Object.entries(methods).forEach(([method, def]: [string, any]) => {
        endpoints.push({
          path,
          method: method.toUpperCase(),
          summary: def.summary || '',
          description: def.description || '',
          tags: def.tags || ['General'],
          requestBody: def.requestBody,
          responses: def.responses,
          parameters: def.parameters || []
        });
      });
    });
  }

  const tags = ['All', ...Array.from(new Set(endpoints.flatMap(e => e.tags)))];

  const filteredEndpoints = endpoints.filter(e => {
    const matchesTag = selectedTag === 'All' || e.tags.includes(selectedTag);
    const matchesSearch = searchTerm === '' ||
      e.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesTag && matchesSearch;
  });

  const getMethodBadgeClass = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-blue-500/15 text-blue-500 border-blue-500/30';
      case 'POST': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
      case 'PUT': return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
      case 'DELETE': return 'bg-rose-500/15 text-rose-500 border-rose-500/30';
      default: return 'bg-secondary text-muted-foreground';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <BookOpen className="size-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2">
                Elvis WMS REST API Documentation
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono">v1.2.0</span>
              </h2>
              <p className="text-xs text-muted-foreground">Interactive OpenAPI 3.0 specification for warehouse integrations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadSpec}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-secondary transition-colors"
              title="Download OpenAPI JSON"
            >
              <Download className="size-3.5" />
              <span className="hidden sm:inline">Export OpenAPI</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Security / Auth Quick Guide */}
        <div className="bg-secondary/40 px-5 py-3 border-b border-border flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-4 text-primary shrink-0" />
            <span><strong>Authentication:</strong> HttpOnly Session Cookie (<code className="bg-card px-1 py-0.5 rounded border border-border">jwt_token</code>) + CSRF Header (<code className="bg-card px-1 py-0.5 rounded border border-border">X-CSRF-Token</code>) or Bearer Token</span>
          </div>
          <div className="text-muted-foreground">
            <span>Base URL: <code className="bg-card px-1.5 py-0.5 rounded border border-border font-mono">/api/v1</code></span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3 bg-card shrink-0">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search endpoints by path, description, or keyword..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-secondary/50 text-sm outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedTag === tag
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Endpoints List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading API documentation...</div>
          ) : filteredEndpoints.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No endpoints found matching your criteria.</div>
          ) : (
            filteredEndpoints.map((ep, idx) => (
              <div key={`${ep.method}-${ep.path}`} className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-secondary/20 border-b border-border">
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold border font-mono ${getMethodBadgeClass(ep.method)}`}>
                      {ep.method}
                    </span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      /api/v1{ep.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">
                      {ep.tags[0]}
                    </span>
                    <button
                      onClick={() => handleCopyCurl(ep.method, ep.path, idx)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-secondary text-xs transition-colors text-muted-foreground hover:text-foreground"
                      title="Copy cURL snippet"
                    >
                      {copiedIndex === idx ? (
                        <>
                          <Check className="size-3 text-success" />
                          <span className="text-success font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Code className="size-3" />
                          <span>cURL</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-3 text-sm">
                  <div>
                    <h4 className="font-semibold text-foreground">{ep.summary}</h4>
                    {ep.description && <p className="text-xs text-muted-foreground mt-1">{ep.description}</p>}
                  </div>

                  {ep.parameters.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Parameters</div>
                      <div className="space-y-1">
                        {ep.parameters.map((p: any) => (
                          <div key={p.name} className="flex items-center gap-2 text-xs">
                            <code className="bg-secondary px-1.5 py-0.5 rounded text-foreground font-mono">{p.name}</code>
                            <span className="text-muted-foreground">({p.in}{p.required ? ', required' : ''})</span>
                            {p.description && <span className="text-muted-foreground">— {p.description}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ep.requestBody && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Request Body</div>
                      <div className="p-2.5 rounded-lg bg-secondary/50 border border-border font-mono text-xs overflow-x-auto text-muted-foreground">
                        {JSON.stringify(ep.requestBody?.content?.['application/json']?.schema?.properties || {}, null, 2)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
