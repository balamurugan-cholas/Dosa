import React from "react";
import { ExternalLink, Coffee, Bot, Info } from "lucide-react";

declare global {
  interface Window {
    electron?: {
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
    };
    windowControls?: {
      openExternal: (url: string) => void;
    };
  }
}

export function AboutSection() {
  const handleOpenLink = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const url = "https://instagram.com";
    
    // 1. Attempt Native IPC Preload Bridges
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url);
      return;
    } 
    
    if (window.windowControls?.openExternal) {
      window.windowControls.openExternal(url);
      return;
    }

    // 2. Electron Breakout Fallback Rule (Triggers System OS Browser Deflection)
    const systemBrowserWindow = window.open(url, "_blank", "noopener,noreferrer");
    
    if (systemBrowserWindow) {
      // Closes the accidental internal popup instantly if it tried to open inside Electron
      setTimeout(() => {
        try {
          if (systemBrowserWindow.location.href === "about:blank" || !systemBrowserWindow.document.body) {
            systemBrowserWindow.close();
          }
        } catch (err) {
          // Cross-origin safe closure means it successfully broke out to an external window
          systemBrowserWindow.close();
        }
      }, 100);
    }
  };

  return (
    <div className="w-full min-w-full flex flex-col justify-stretch items-stretch space-y-6 rounded-xl border border-border/50 bg-card/30 p-4 backdrop-blur-sm">
      {/* App Information Group */}
      <div className="w-full flex flex-col items-stretch space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          <Info size={12} className="text-muted-foreground/70" />
          <span>About Application</span>
        </div>
        
        <div className="w-full p-3 rounded-lg bg-secondary/20 border border-secondary/30 transition-all hover:bg-secondary/30">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-primary/10 text-primary">
                <Bot size={14} strokeWidth={2} />
              </div>
              <span className="text-sm font-semibold tracking-wide text-foreground">
                Dosa
              </span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60">
              v1.0.0
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed text-left w-full">
            Real-time AI interview assistant designed to streamline your preparation.
          </p>
        </div>
      </div>

      {/* Support Developer Group */}
      <div className="w-full flex flex-col items-stretch space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Support Developer
        </p>
        
        <a
          href="https://instagram.com"
          onClick={handleOpenLink}
          className="group flex items-center justify-between w-full p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40 transition-all duration-200"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
              <Coffee size={14} strokeWidth={2} />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                Buy me a coffee
              </p>
              <p className="text-[10px] text-muted-foreground">
                Fuel future updates and features
              </p>
            </div>
          </div>
          <ExternalLink 
            size={12} 
            className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" 
            strokeWidth={2} 
          />
        </a>
      </div>
    </div>
  );
}
