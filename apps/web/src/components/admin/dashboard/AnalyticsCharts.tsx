import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/currency";
import type { HourlyPoint, PaymentSplitEntry, TopProduct } from "@/hooks/useDashboardAnalytics";

const CHART_HEIGHT = 280;

function compactAmount(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

function EmptyState({ label }: { label: string }) {
  return <p className="flex h-[280px] items-center justify-center text-sm text-muted">{label}</p>;
}

interface RevenueTooltipPayload {
  payload: HourlyPoint;
}

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: RevenueTooltipPayload[]; label?: string }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted">
        {formatCurrency(point.revenue)} · {t("admin.dashboard.ordersCount", { count: point.orders })}
      </p>
    </div>
  );
}

interface RevenueAreaChartProps {
  data: HourlyPoint[];
}

export function RevenueAreaChart({ data }: RevenueAreaChartProps) {
  const hasData = data.some((point) => point.revenue > 0);
  const { t } = useTranslation();

  if (!hasData) return <EmptyState label={t("admin.dashboard.noData")} />;

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="dashboardRevenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="hour"
          tick={{ fill: "hsl(var(--muted))", fontSize: 12 }}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickLine={false}
          interval={2}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted))", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={compactAmount}
        />
        <Tooltip content={<RevenueTooltip />} />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="hsl(var(--accent))"
          strokeWidth={2}
          fill="url(#dashboardRevenueGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface DonutTooltipPayload {
  payload: PaymentSplitEntry & { label: string };
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: DonutTooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{entry.label}</p>
      <p className="text-muted">
        {formatCurrency(entry.total)} · {entry.percentage}%
      </p>
    </div>
  );
}

interface PaymentDonutChartProps {
  data: PaymentSplitEntry[];
}

export function PaymentDonutChart({ data }: PaymentDonutChartProps) {
  const { t } = useTranslation();
  const chartData = data
    .filter((entry) => entry.total > 0)
    .map((entry) => ({ ...entry, label: t(`pos.cart.paymentMethod.${entry.method}`) }));

  if (chartData.length === 0) return <EmptyState label={t("admin.dashboard.noData")} />;

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <PieChart>
        <Pie data={chartData} dataKey="total" nameKey="label" innerRadius={70} outerRadius={110} paddingAngle={3} strokeWidth={0}>
          {chartData.map((entry) => (
            <Cell key={entry.method} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip content={<DonutTooltip />} />
        <Legend
          verticalAlign="bottom"
          formatter={(_value: string, entry: unknown) => {
            const item = (entry as { payload: PaymentSplitEntry & { label: string } }).payload;
            return (
              <span className="text-xs text-muted">
                {item.label} ({item.percentage}%)
              </span>
            );
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

const BAR_COLORS = [
  "hsl(var(--accent))",
  "hsl(var(--green))",
  "hsl(var(--blue))",
  "hsl(var(--amber))",
  "hsl(var(--orange))",
];

interface TopSellerTooltipPayload {
  payload: TopProduct;
}

function TopSellerTooltip({ active, payload }: { active?: boolean; payload?: TopSellerTooltipPayload[] }) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{point.name}</p>
      <p className="text-muted">
        {formatCurrency(point.revenue)} · {t("admin.dashboard.unitsCount", { count: point.quantitySold })}
      </p>
    </div>
  );
}

interface TopSellersBarChartProps {
  data: TopProduct[];
}

export function TopSellersBarChart({ data }: TopSellersBarChartProps) {
  const { t } = useTranslation();
  if (data.length === 0) return <EmptyState label={t("admin.dashboard.noData")} />;

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "hsl(var(--muted))", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={compactAmount}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: "hsl(var(--text))", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip content={<TopSellerTooltip />} cursor={{ fill: "hsl(var(--surface2))" }} />
        <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
          {data.map((entry, index) => (
            <Cell key={entry.productId} fill={BAR_COLORS[index % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
