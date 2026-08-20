export function formatDemoDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatValue(value: number | null, type: string) {
  if (value == null) return "—";
  return type === "percentage"
    ? `${Math.round(value * 100)}%`
    : value.toFixed(value >= 10 ? 1 : 2);
}

export function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}