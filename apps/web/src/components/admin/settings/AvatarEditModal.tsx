import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { CircleUserRound, X } from "lucide-react";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { enqueueMutation } from "@/services/syncService";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useToast } from "@/hooks/useToast";
import { ButtonCustom } from "@/components/ui/button-custom";
import type { Profile } from "@/types/db";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
// Fixed, extension-less path per user (upsert: true) -- always the same
// object, so nothing accumulates in storage across repeated uploads, and
// rendering doesn't depend on the original file extension (the browser
// decodes using the stored Content-Type, not the URL).
function storagePath(userId: string): string {
  return `${userId}/avatar`;
}

function isOwnUploadedAvatar(url: string | undefined, userId: string): boolean {
  return !!url && url.includes(`/storage/v1/object/public/avatars/${storagePath(userId)}`);
}

interface AvatarEditModalProps {
  profile: Profile;
  onClose: () => void;
}

// Single entry point for every avatar-photo action (Settings' "Changer la
// photo" button opens this) instead of a file button and a URL field living
// separately in the form -- import-from-computer and paste-a-URL are two
// options offered together here, with the uploaded one always winning if
// both are present, and one delete action that clears both.
export function AvatarEditModal({ profile, onClose }: AvatarEditModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { triggerManualSync } = useSyncEngine();

  const [uploadedUrl, setUploadedUrl] = useState<string | null>(
    isOwnUploadedAvatar(profile.avatar_url, profile.id) ? profile.avatar_url! : null,
  );
  const [manualUrl, setManualUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards Save/Delete against a fast double-click the same way every other
  // handler in this app does (see ProductFormDrawer's savingRef).
  const savingRef = useRef(false);

  // Upload always wins over a manually typed URL, regardless of which was
  // set first in this session -- the explicit precedence rule this modal
  // exists to enforce, not just "whichever was touched last".
  const previewUrl = uploadedUrl ?? (manualUrl.trim() || profile.avatar_url);

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the exact same file later
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError(t("admin.profile.avatarTypeError"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(t("admin.profile.avatarSizeError"));
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const path = storagePath(profile.id);
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      // Cache-bust: the path never changes, so without this the browser
      // would keep showing whatever it first cached at this exact URL.
      setUploadedUrl(`${data.publicUrl}?v=${Date.now()}`);
    } catch (uploadError) {
      console.warn("[AvatarEditModal] upload failed", uploadError);
      setError(t("admin.profile.avatarUploadError"));
    } finally {
      setUploading(false);
    }
  };

  const persistAvatarUrl = async (url: string | undefined) => {
    await db.profiles.update(profile.id, { avatar_url: url });
    await enqueueMutation("UPDATE", "profiles", { id: profile.id, avatar_url: url ?? null });
    void triggerManualSync();
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const finalUrl = uploadedUrl ?? (manualUrl.trim() || undefined);
      await persistAvatarUrl(finalUrl);
      showToast("success", t("admin.profile.avatarSaveSuccessToast"));
      onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Best-effort -- if the current avatar was only ever a pasted external
      // URL, there's no object at this path to remove; the API treats that
      // as a no-op rather than an error.
      await supabase.storage.from("avatars").remove([storagePath(profile.id)]);
      await persistAvatarUrl(undefined);
      showToast("success", t("admin.profile.avatarDeleteSuccessToast"));
      onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("admin.profile.avatarModalTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("pos.pin.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mb-4 flex justify-center">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface2" aria-hidden>
              <CircleUserRound className="h-10 w-10 text-muted" />
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />
          <ButtonCustom variant="primary" isLoading={uploading} onClick={() => fileInputRef.current?.click()}>
            {t("admin.profile.avatarImportButton")}
          </ButtonCustom>

          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-px flex-1 bg-border" aria-hidden />
            {t("admin.profile.avatarOr")}
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>

          <input
            type="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder={t("admin.profile.avatarUrlPlaceholder")}
            className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-foreground"
          />
          {uploadedUrl && manualUrl.trim() && (
            <p className="text-xs text-muted">{t("admin.profile.avatarUploadedPriorityHint")}</p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="mt-2 flex gap-2">
            <ButtonCustom
              variant="danger"
              size="sm"
              disabled={!previewUrl}
              isLoading={saving}
              onClick={() => void handleDelete()}
            >
              {t("admin.profile.avatarDelete")}
            </ButtonCustom>
            <ButtonCustom variant="primary" className="flex-1" isLoading={saving} onClick={() => void handleSave()}>
              {t("admin.profile.avatarSave")}
            </ButtonCustom>
          </div>
        </div>
      </div>
    </div>
  );
}
