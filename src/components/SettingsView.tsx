import { SettingsState } from "../lib/types";
import { JOB_ROLES } from "../lib/constants";
import { TranscriptionModel } from "./settings/TranscriptionModel";
import { OpenRouterModel } from "./settings/OpenRouterModel";
import { AnalyzeScreenGeminiApiKey } from "./settings/AnalyzeScreenGeminiApiKey";
import { AppTransparency } from "./settings/AppTransparency";
import { AppWidth } from "./settings/AppWidth";
import { JobRoleSelect } from "./settings/JobRoleSelect";
import { AnswerMemory } from "./settings/AnswerMemory";
import { ResumeUpload } from "./settings/ResumeUpload";
import { ShortcutKeys } from "./settings/ShortcutKeys";
import { AboutSection } from "./settings/AboutSection";

interface Props {
  settings: SettingsState;
  onChange: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  onResumeUpload: () => void | Promise<void>;
  onResumeDelete: () => void | Promise<void>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4">{children}</div>;
}

export function SettingsView({
  settings,
  onChange,
  onResumeUpload,
  onResumeDelete,
}: Props) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
      <Row>
        <TranscriptionModel
          apiKey={settings.deepgramApiKey}
          onApiKeyChange={(value) => onChange("deepgramApiKey", value)}
        />
      </Row>

      <Row>
        <OpenRouterModel
          apiKey={settings.openrouterApiKey}
          model={settings.openrouterModel}
          onApiKeyChange={(value) => onChange("openrouterApiKey", value)}
          onModelChange={(value) => onChange("openrouterModel", value)}
        />
      </Row>

      <Row>
        <AnalyzeScreenGeminiApiKey
          apiKey={settings.geminiApiKey}
          onApiKeyChange={(value) => onChange("geminiApiKey", value)}
        />
      </Row>

      <Row>
        <AppTransparency
          value={settings.transparency}
          onChange={(v) => onChange("transparency", v)}
        />
      </Row>

      <Row>
        <AppWidth
          value={settings.appWidth}
          onChange={(v) => onChange("appWidth", v)}
        />
      </Row>

      <Row>
        <JobRoleSelect
          value={settings.jobRole}
          onChange={(v) => onChange("jobRole", v)}
          options={JOB_ROLES}
        />
      </Row>

      <Row>
        <AnswerMemory
          value={settings.answerMemory}
          onChange={(v) => onChange("answerMemory", v)}
        />
      </Row>

      <Row>
        <ResumeUpload
          uploaded={settings.resumeUploaded}
          fileName={settings.resumeFileName}
          onUpload={onResumeUpload}
          onDelete={onResumeDelete}
        />
      </Row>

      <Row>
        <ShortcutKeys />
      </Row>

      <div className="px-4 py-4 space-y-5">
        <AboutSection />
      </div>
    </div>
  );
}
