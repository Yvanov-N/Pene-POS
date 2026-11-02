import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RestockForm } from "@/components/admin/restocking/RestockForm";
import { PurchaseHistory } from "@/components/admin/restocking/PurchaseHistory";
import { SuppliersTab } from "@/components/admin/restocking/SuppliersTab";
import { PILL_CLASS } from "@/components/admin/restocking/styles";

const TABS = ["restock", "history", "suppliers"] as const;
type Tab = (typeof TABS)[number];

export function RestockingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("restock");

  return (
    <div className={`mx-auto p-4 ${tab === "restock" ? "max-w-2xl" : "max-w-5xl"}`}>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={PILL_CLASS(tab === key)}>
            {t(`restocking.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "restock" && <RestockForm />}
      {tab === "history" && <PurchaseHistory />}
      {tab === "suppliers" && <SuppliersTab />}
    </div>
  );
}
