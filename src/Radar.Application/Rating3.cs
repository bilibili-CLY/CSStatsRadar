using Radar.Domain.Models;

namespace Radar.Application;

public class Rating3
{
    public const string AlgorithmVersion = "local-r3-2026.08-v2";

    public const double SideBiasT = -0.08;
    public const double SideBiasCT = 0.08;
    public const double WeaponBeta = 0.55;
    public const double ArmorBonus = 0.20;
    public const double AliveCoefficient = 0.88;
    public const double EconomyCoefficient = 0.000055;
    public const double BombCoefficient = 1.10;

    public class WeaponCategory
    {
        public string ID = "";
        public string Label = "";
        public double Strength;
        public List<string> Weapons = new();
    }

    public static readonly List<WeaponCategory> WeaponCategories = new()
    {
        new WeaponCategory { ID = "starter_pistol", Label = "初始手枪", Strength = 0, Weapons = new List<string>{ "glock", "glock-18", "usp-s", "usp", "p2000", "hkp2000" } },
        new WeaponCategory { ID = "upgraded_pistol", Label = "强化手枪", Strength = 0.55, Weapons = new List<string>{ "p250", "deagle", "desert eagle", "tec-9", "tec9", "five-seven", "fiveseven", "cz75-auto", "cz75 auto", "cz75a", "dual berettas", "elite", "r8 revolver", "revolver" } },
        new WeaponCategory { ID = "smg_shotgun", Label = "SMG / 霰弹枪", Strength = 1.05, Weapons = new List<string>{ "mp9", "mac-10", "mac10", "ump-45", "ump45", "mp7", "mp5-sd", "mp5sd", "p90", "pp-bizon", "bizon", "nova", "xm1014", "mag-7", "mag7", "sawed-off", "sawedoff", "m249", "negev" } },
        new WeaponCategory { ID = "tier2_rifle", Label = "二级步枪", Strength = 1.45, Weapons = new List<string>{ "galil ar", "galilar", "famas" } },
        new WeaponCategory { ID = "tier1_rifle", Label = "一级步枪", Strength = 2, Weapons = new List<string>{ "ak-47", "ak47", "m4a4", "m4a1-s", "m4a1", "aug", "sg 553", "sg553" } },
        new WeaponCategory { ID = "sniper", Label = "狙击枪", Strength = 2.59, Weapons = new List<string>{ "awp", "ssg 08", "ssg08", "scar-20", "scar20", "g3sg1" } },
    };

    public static RatingMethodology GetMethodology()
    {
        var categories = WeaponCategories.Select(c => new WeaponMethodology
        {
            ID = c.ID, Label = c.Label, Strength = c.Strength, Weapons = new List<string>(c.Weapons),
        }).ToList();
        return new RatingMethodology
        {
            AlgorithmVersion = AlgorithmVersion,
            ImpactFormula = "Impact = 2.13 × KPR + 0.42 × APR − 0.41",
            Rating2Formula = "R2 = 0.0073 × KAST% + 0.3591 × KPR − 0.5329 × DPR + 0.2372 × Impact + 0.0032 × ADR + 0.1587",
            Rating3BaseFormula = "base3 = 0.0073 × eKAST% + 0.3591 × eKPR − 0.5329 × eDPR + 0.2372 × multiImpact + 0.0032 × eADR + 0.1587",
            MultiKPRFormula = "multiKPR = eKPR + 0.25 × Σmax(单回合击杀−1, 0) ÷ 有效回合数",
            MultiImpactFormula = "multiImpact = 2.13 × multiKPR + 0.42 × eAPR − 0.41",
            SwingRatingFormula = "swingRating = clamp(1 + Swing% ÷ 4, 0, 2.5)",
            Rating3Formula = "R3 = max(0, 0.92 × base3 + 0.08 × clamp(1 + Swing% / 4, 0, 2.5))",
            SwingFormula = "Swing% = 玩家累计回合胜率变化 ÷ 有效回合数 × 100",
            WinProbabilityFormula = "P(T) = sigmoid(logit(0.48) + 0.88 × (T存活−CT存活) + 0.000055 × (T经济−CT经济) + 1.10 × 已下包)",
            WeaponWeightFormula = "weaponWeight = clamp(2 × (1 − sigmoid(sideBias + 0.55 × (攻击者强度−受害者强度))), 0.50, 1.50)",
            SniperDamageFormula = "sniperDamageWeight = 0.75 × weaponWeight + 0.25",
            WeaponCategories = categories,
            ContributionWeights = new Dictionary<string, double> { ["damage"] = 0.50, ["final_blow"] = 0.30, ["flash_assist"] = 0.10, ["trade"] = 0.10 },
            Constants = new Dictionary<string, double> { ["side_bias_t"] = SideBiasT, ["side_bias_ct"] = SideBiasCT, ["weapon_beta"] = WeaponBeta, ["armor_bonus"] = ArmorBonus, ["alive_coefficient"] = AliveCoefficient, ["economy_coefficient"] = EconomyCoefficient, ["bomb_coefficient"] = BombCoefficient, ["swing_weight"] = 0.08 },
            Limitations = new List<string> {
                "并非 HLTV 官方公式或官方数据。",
                "v1 不使用 HLTV 未公开的地图专属胜率先验。",
                "结果依赖 DEM 是否包含完整的经济、阵营和事件时序。",
                "单图样本中的残局会显著放大 Swing。",
            },
        };
    }

    public static string NormalizeWeaponName(string value)
    {
        value = value.ToLower().Trim();
        if (value.StartsWith("weapon_")) value = value.Substring("weapon_".Length);
        return value;
    }

    public static (WeaponCategory, bool) CategoryForWeapon(string value)
    {
        value = NormalizeWeaponName(value);
        foreach (var category in WeaponCategories)
            foreach (var weapon in category.Weapons)
                if (value == weapon) return (category, true);
        return (WeaponCategories[0], false);
    }

    public static bool IsSpecialWeapon(string value)
    {
        value = NormalizeWeaponName(value);
        return value.Contains("knife") || value == "taser" || value.Contains("zeus") || value == "flashbang" || value.Contains("grenade") || value.Contains("molotov") || value.Contains("inferno");
    }

    public static double Sigmoid(double value) => 1 / (1 + Math.Exp(-value));

    public static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));

    public static double Round2(double value) => Math.Round(value * 100) / 100;

    public static double Round3(double value) => Math.Round(value * 1000) / 1000;

    public static bool SameSide(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    public static double WeaponDuelProbability(string attackerWeapon, string victimWeapon, string attackerSide, bool attackerArmor, bool victimArmor)
    {
        var (attacker, attackerOK) = CategoryForWeapon(attackerWeapon);
        var (victim, victimOK) = CategoryForWeapon(victimWeapon);
        if (!attackerOK) attacker = WeaponCategories[0];
        if (!victimOK) victim = WeaponCategories[0];
        var a = attacker.Strength;
        var v = victim.Strength;
        if (attackerArmor) a += ArmorBonus;
        if (victimArmor) v += ArmorBonus;
        var bias = SideBiasT;
        if (string.Equals(attackerSide, "CT", StringComparison.OrdinalIgnoreCase)) bias = SideBiasCT;
        return Sigmoid(bias + WeaponBeta * (a - v));
    }

    public static double WeaponEventWeight(string attackerWeapon, string victimWeapon, string attackerSide, bool attackerArmor, bool victimArmor)
    {
        if (IsSpecialWeapon(attackerWeapon)) return 1.5;
        return Clamp(2 * (1 - WeaponDuelProbability(attackerWeapon, victimWeapon, attackerSide, attackerArmor, victimArmor)), 0.5, 1.5);
    }
}
