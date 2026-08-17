using Radar.Domain.Models;

namespace Radar.Application;

public static class AggregateRadarBuilder
{
    public static string? Build(Player player, List<PlayerMatchRecord> records, out AggregateRadarResponse response)
    {
        response = new AggregateRadarResponse();
        var metrics = AggregateRadar.AggregateMetrics(records);
        var unavailable = metrics.Count(m => m.Status == "unavailable");
        var values = metrics.Select(m => m.Value).ToList();
        if (unavailable == MetricOrder.Values.Length)
            return "aggregate_radar_unavailable";
        var rating2 = new RadarPayload
        {
            Dimensions = MetricOrder.Values.ToList(),
            Values = values,
            DisplayTypes = metrics.Select(m => m.DisplayType).ToList(),
            MaxValues = metrics.Select(m => m.MaxValue).ToList(),
            MinValues = metrics.Select(m => m.MinValue).ToList(),
            Note = AggregateRadar.Note,
            Metrics = metrics,
        };
        RadarPayload? rating3 = null;
        var rating3Available = records.All(r => r.Rating3Metrics.Count > 0 && r.RoundSwing != null);
        if (rating3Available)
        {
            var r3Metrics = AggregateRadar.AggregateForOrder(records, MetricOrder.Rating3.ToList(), true);
            var r3Values = r3Metrics.Select(m => m.Value).ToList();
            var swingTotal = records.Sum(r => r.RoundSwing!.Value);
            var swing = Math.Round(swingTotal / records.Count * 100) / 100;
            rating3 = new RadarPayload
            {
                Dimensions = MetricOrder.Rating3.ToList(),
                Values = r3Values,
                DisplayTypes = AggregateRadar.Rating3DisplayTypes.ToList(),
                MaxValues = AggregateRadar.Rating3MaxValues.ToList(),
                MinValues = new double[] { 0, 0, 0, 0, 0, 0 }.ToList(),
                Note = "综合雷达为所选比赛等权平均结果。" + "Rating 3.0 为本地逆向公式近似，非 HLTV 官方数据。",
                Metrics = r3Metrics,
                RoundSwing = swing,
                AlgorithmVersion = Rating3.AlgorithmVersion,
            };
        }
        var status = new Rating3Status { Available = rating3 != null };
        if (!status.Available)
            status.Reason = "部分比赛尚无完整 Rating 3.0 事件数据。";
        response = new AggregateRadarResponse
        {
            Player = player,
            MatchCount = records.Count,
            Radar = rating2,
            Profiles = new RatingProfiles { Rating2 = rating2, Rating3 = rating3 },
            Rating3Status = status,
        };
        return null;
    }
}