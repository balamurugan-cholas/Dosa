import { AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../app/components/ui/dialog";
import { Button } from "../app/components/ui/button";

interface CaptureStatusModalProps {
  open: boolean;
  message: string;
  onRetry: () => void;
  onClose: () => void;
}

export function CaptureStatusModal({
  open,
  message,
  onRetry,
  onClose,
}: CaptureStatusModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <DialogTitle className="text-base">Couldn't start listening</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}