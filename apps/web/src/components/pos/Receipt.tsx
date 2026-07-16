import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/lib/currency";
import type { ReceiptData } from "@/services/hardware/printService";

export function Receipt({ sale, lines, cashierName }: ReceiptData) {
  const { t } = useTranslation();

  return (
    <div className="receipt">
      <div className="receipt-header">
        <p style={{ fontWeight: "bold" }}>{t("receipt.shopName")}</p>
        <p>{new Date(sale.created_at).toLocaleString()}</p>
        <p>{t("receipt.cashier", { name: cashierName })}</p>
      </div>

      <div>
        {lines.map((line, index) => (
          <div key={index} className="receipt-item">
            <span>
              {line.quantity} x {line.productName}
            </span>
            <span>{formatCurrency(line.quantity * line.unitPrice)}</span>
          </div>
        ))}
      </div>

      <div className="receipt-total">
        <span>{t("pos.cart.total")}</span>
        <span>{formatCurrency(sale.total_amount)}</span>
      </div>

      <p>{t(`pos.cart.paymentMethod.${sale.payment_method}`)}</p>

      <p style={{ textAlign: "center", marginTop: "0.75rem" }}>{t("receipt.footer")}</p>
    </div>
  );
}
