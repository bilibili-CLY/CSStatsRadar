using Radar.Domain.Models;

namespace Radar.Application;

public static class AggregateRadar
{
    public const string Note = "综合雷达为所选比赛等权平均结果。Rating 2.0 为公开逆向公式的本地计算。";
    public static readonly string[] Rating3DisplayTypes = { "number", "percentage", "number", "percentage", "percentage", "number" };
    public static readonly double[] Rating3MaxValues = { 1, 0.6, 100, 0.7, 0.2, 1.5 };

    public static RadarPayload BuildRadar2(List<RadarMetric> metrics)
    {
        var values = metrics.Select(m => m.Value).ToList();
        var payload = new RadarPayload
        {
            Dimensions = MetricOrder.Values.ToList(),
            Values = values,
            DisplayTypes = metrics.Select(m => m.DisplayType).ToList(),
            MaxValues = metrics.Select(m => m.MaxValue).ToList(),
            MinValues = metrics.Select(m => m.MinValue).ToList(),
            Note = Note,
            Metrics = metrics,
        };
        return payload;
    }

    public static List<RadarMetric> AggregateMetrics(List<PlayerMatchRecord> records) => AggregateForOrder(records, MetricOrder.Values.ToList(), false);

    public static List<RadarMetric> AggregateForOrder(List<PlayerMatchRecord> records, List<string> order, bool rating3)
    {
        var result = new List<RadarMetric>();
        foreach (var name in order)
        {
            string displayType = "";
            double metricMax = 0, minValue = 0;
            double sum = 0;
            int count = 0;
            bool hasUnavailable = false, hasApproximate = false;
            foreach (var record in records)
            {
                var source = record.Metrics;
                if (rating3) source = record.Rating3Metrics;
                var metric = FindMetric(source, name);
                if (displayType == "")
                {
                    displayType = metric.DisplayType;
                    metricMax = metric.MaxValue;
                    minValue = metric.MinValue;
                }
                if (metric.Value == null || metric.Status == "unavailable") { hasUnavailable = true; continue; }
                if (metric.Status == "approximate") hasApproximate = true;
                sum += metric.Value.Value;
                count++;
            }
            if (displayType == "")
            {
                displayType = DisplayTypeForMetric(name);
                metricMax = PlayerStatsCalculator.MaxValue(name);
            }
            var resultMetric = new RadarMetric { Name = name, DisplayType = displayType, MaxValue = metricMax, MinValue = minValue, Status = "ok" };
            if (hasUnavailable || count != records.Count)
            {
                resultMetric.Status = "unavailable";
                resultMetric.Reason = "所选比赛中存在不可用指标。";
            }
            else
            {
                var value = PlayerStatsCalculator.Round3(sum / count);
                resultMetric.Value = value;
                if (hasApproximate)
                {
                    resultMetric.Status = "approximate";
                    resultMetric.Reason = "所选比赛中存在近似指标。";
                }
            }
            result.Add(resultMetric);
        }
        return result;
    }

    public static RadarMetric FindMetric(List<RadarMetric> metrics, string name)
    {
        foreach (var metric in metrics)
            if (metric.Name == name) return metric;
        return new RadarMetric { Name = name, DisplayType = DisplayTypeForMetric(name), MaxValue = PlayerStatsCalculator.MaxValue(name), MinValue = 0, Status = "unavailable" };
    }

    public static string DisplayTypeForMetric(string name)
    {
        if (name == "Surviving" || name == "KAST" || name == "Multi-Kill") return "percentage";
        return "number";
    }

    public static List<string> UniqueStrings(List<string> values)
    {
        var seen = new HashSet<string>();
        var result = new List<string>();
        foreach (var value in values)
        {
            var trimmed = value.Trim();
            if (trimmed == "" || !seen.Add(trimmed)) continue;
            result.Add(trimmed);
        }
        return result;
    }
}
