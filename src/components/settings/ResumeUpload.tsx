interface Props {
  uploaded: boolean;
  fileName: string;
  onUpload: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}

export function ResumeUpload({ uploaded, fileName, onUpload, onDelete }: Props) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3">
        Resume
      </p>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Upload your real resume so the assistant can use it for background, experience, and
          project-related questions.
        </p>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onUpload}
            className="text-xs px-2.5 py-[5px] bg-secondary text-secondary-foreground hover:bg-accent transition-colors leading-none"
          >
            {uploaded ? "Replace Resume" : "Upload Resume"}
          </button>
          {uploaded && (
            <>
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                {fileName || "resume.pdf"}
              </span>
              <button
                onClick={onDelete}
                className="text-[10px] px-2 py-[4px] text-destructive-foreground bg-destructive/20 hover:bg-destructive/35 transition-colors leading-none"
              >
                Delete
              </button>
            </>
          )}
          {!uploaded && (
            <span className="text-[10px] text-muted-foreground">
              PDF, DOCX, TXT, MD, and RTF supported
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
