import { Download, CheckCircle2, AlertCircle, FileCode, ArrowRight, ShieldAlert, Info } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UpdateInfo, UpdateDownloadProgress } from "../lib/types";

interface Props {
  updateInfo: UpdateInfo | null;
  progress: UpdateDownloadProgress | null;
  onStartDownload: () => void;
  onInstall: () => void;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function UpdateView({ updateInfo, progress, onStartDownload, onInstall }: Props) {
  const status = progress?.status ?? "idle";
  const bytesDownloaded = progress?.bytesDownloaded ?? 0;
  const totalBytes = progress?.totalBytes ?? updateInfo?.assetSize ?? 0;
  const percent = totalBytes > 0 ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)) : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col divide-y divide-border">

        {/* Version banner */}
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                New version
              </span>
              <span className="text-sm font-semibold text-foreground leading-tight">
                {updateInfo ? `v${updateInfo.version}` : "Checking..."}
              </span>
            </div>
          </div>

          {updateInfo?.assetSize && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border border-border px-2 py-1">
              <FileCode size={11} strokeWidth={1.75} />
              <span>{formatBytes(totalBytes)}</span>
            </div>
          )}
        </div>

        {/* Download / progress / install action */}
        <div className="px-4 py-4 space-y-3">

          {status === "idle" && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Ready to download. The installer will run after the app closes.
              </p>
              <button
                onClick={onStartDownload}
                className="self-start flex items-center gap-2 text-xs px-3 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Download size={12} strokeWidth={2} />
                Download update
              </button>
            </div>
          )}

          {status === "paused" && (
            <div className="flex flex-col gap-3">
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Download interrupted.</p>
                <div className="h-1 w-full bg-secondary overflow-hidden">
                  <div className="h-full bg-muted-foreground/40" style={{ width: `${percent}%` }} />
                </div>
                <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                  <span>{formatBytes(bytesDownloaded)} saved</span>
                  <span>{formatBytes(totalBytes)} total</span>
                </div>
              </div>
              <button
                onClick={onStartDownload}
                className="self-start flex items-center gap-2 text-xs px-3 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Download size={12} strokeWidth={2} />
                Resume download
              </button>
            </div>
          )}

          {status === "downloading" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Downloading...</span>
                <span className="tabular-nums">{percent}%</span>
              </div>
              <div className="h-1 w-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>{formatBytes(bytesDownloaded)}</span>
                <span>{formatBytes(totalBytes)}</span>
              </div>
            </div>
          )}

          {status === "completed" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} strokeWidth={2} className="text-emerald-400 shrink-0" />
                <span className="text-[11px] text-emerald-400 font-medium">Download complete</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-amber-500/80 bg-amber-500/5 border border-amber-500/15 px-2.5 py-2">
                <ShieldAlert size={11} className="shrink-0" />
                <span>Save your work — the app will close after install begins.</span>
              </div>
              <button
                onClick={onInstall}
                className="self-start flex items-center gap-2 text-xs px-3 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Install and restart
                <ArrowRight size={12} strokeWidth={2} />
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-rose-400">
                <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span className="text-[11px]">{progress?.message || "Download failed. Please try again."}</span>
              </div>
              <button
                onClick={onStartDownload}
                className="self-start flex items-center gap-2 text-xs px-3 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Download size={12} strokeWidth={2} />
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Release notes */}
        {updateInfo && (
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]">
              <Info size={11} strokeWidth={1.75} />
              <span>What's new</span>
            </div>

            {updateInfo.body ? (
              <div className="
                text-[11px] text-foreground leading-relaxed
                [&_p]:mb-2 [&_p]:text-[11px] [&_p]:text-foreground
                [&_ul]:ml-3.5 [&_ul]:list-disc [&_ul]:space-y-0.5
                [&_ol]:ml-3.5 [&_ol]:list-decimal [&_ol]:space-y-0.5
                [&_li]:text-[11px] [&_li]:text-foreground
                [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1
                [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-3 [&_h2]:mb-1
                [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-2 [&_h3]:mb-0.5
                [&_strong]:text-foreground [&_strong]:font-medium
                [&_code]:bg-secondary [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px] [&_code]:font-mono
                [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                [&_hr]:border-border [&_hr]:my-2
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {updateInfo.body}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">No release notes for this version.</p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}