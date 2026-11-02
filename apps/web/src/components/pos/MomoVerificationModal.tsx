import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { MoMoVerificationCard } from "@/components/admin/MoMoVerificationCard";

interface MomoVerificationModalProps {
  onClose: () => void;
}

// The verification card, right on the POS -- opened from the reminder bubble
// so a cashier never has to leave the till (or unlock the admin zone) to
// check the shop phone's SMS.
export function MomoVerificationModal({ onClose }: MomoVerificationModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted hover:bg-surface2 hover:text-foreground"
          aria-label={t("pos.pin.close")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <MoMoVerificationCard />
      </div>
    </div>
  );
}
