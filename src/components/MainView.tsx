import { ContentArea } from "./ContentArea";
import { BottomBar } from "./BottomBar";
import { ContentBlock } from "../lib/types";

interface Props {
  blocks: ContentBlock[];
  isTranscribing: boolean;
  isAnswering: boolean;
  activeTranscriptionId: number | null;
  activeAnswerId: number | null;
  scrollToBottomSignal: number;
  onListen: () => void;
  onAnswer: () => void;
  onClear: () => void;
  onAnalyze: () => void;
}

export function MainView({
  blocks,
  isTranscribing,
  isAnswering,
  activeTranscriptionId,
  activeAnswerId,
  scrollToBottomSignal,
  onListen,
  onAnswer,
  onClear,
  onAnalyze,
}: Props) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <ContentArea
        blocks={blocks}
        isTranscribing={isTranscribing}
        isAnswering={isAnswering}
        activeTranscriptionId={activeTranscriptionId}
        activeAnswerId={activeAnswerId}
        scrollToBottomSignal={scrollToBottomSignal}
      />
      <BottomBar
        isTranscribing={isTranscribing}
        isAnswering={isAnswering}
        onListen={onListen}
        onAnswer={onAnswer}
        onClear={onClear}
        onAnalyze={onAnalyze}
      />
    </div>
  );
}
