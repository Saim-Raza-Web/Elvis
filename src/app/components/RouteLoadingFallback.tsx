import React from "react";
import { Loader2 } from "lucide-react";

interface RouteLoadingFallbackProps {
  pageName?: string;
}

export function RouteLoadingFallback({ pageName }: RouteLoadingFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[320px] p-6 text-center space-y-4 animate-fade-in">
      <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
        <Loader2 className="size-6 text-primary animate-spin" />
      </div>
      <div>
        <h3 className="font-semibold text-base">
          {pageName ? `Loading ${pageName}...` : "Loading screen..."}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
          Optimizing handheld PDA transfer & fetching screen assets
        </p>
      </div>
      {/* Lightweight skeleton placeholder */}
      <div className="w-full max-w-md space-y-2.5 pt-2 opacity-50">
        <div className="h-8 bg-muted rounded-lg animate-pulse" />
        <div className="h-24 bg-muted rounded-lg animate-pulse" />
        <div className="h-16 bg-muted rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
