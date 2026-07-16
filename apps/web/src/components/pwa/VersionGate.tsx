import { useState } from "react";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { UpdateBanner } from "./UpdateBanner";
import { UpdateLoading } from "./UpdateLoading";
import { ChangelogModal } from "./ChangelogModal";

export function VersionGate() {
  const { available, info, applying, snoozed, applyUpdate, snooze, reopen } = useAppUpdate();
  const [changelogOpen, setChangelogOpen] = useState(false);

  if (applying) return <UpdateLoading info={info} />;

  return (
    <>
      <UpdateBanner
        available={available}
        snoozed={snoozed}
        info={info}
        applying={applying}
        onUpdate={applyUpdate}
        onSnooze={snooze}
        onReopen={reopen}
        onShowChangelog={() => setChangelogOpen(true)}
      />
      {changelogOpen && info && <ChangelogModal info={info} onClose={() => setChangelogOpen(false)} />}
    </>
  );
}
