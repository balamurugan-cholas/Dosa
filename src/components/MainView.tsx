import { ContentArea } from "./ContentArea";
import { ContentBlock } from "../lib/types";

interface Props {
  blocks: ContentBlock[];
  isTranscribing: boolean;
  isAnswering: boolean;
  activeTranscriptionId: number | null;
  activeAnswerId: number | null;
  scrollToBottomSignal: number;
  answerIndex: number;
}

export function MainView({
  blocks,
  isTranscribing,
  isAnswering,
  activeTranscriptionId,
  activeAnswerId,
  scrollToBottomSignal,
  answerIndex,
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
        answerIndex={answerIndex}
      />
    </div>
  );
}