import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { bridge } from "../bridge";
import type { RatingMethodology } from "../types";

type Tab = "rating2" | "rating3" | "swing";

export function RatingMethodologyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<RatingMethodology | null>(null);
  const [tab, setTab] = useState<Tab>("rating2");
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    bridge.getRatingMethodology().then(setData);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [open, onClose]);
  if (!open) return null;
  const copyText = data ? methodologyText(data, tab) : "";
  return (
    <div className="methodology-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="methodology-dialog" role="dialog" aria-modal="true" aria-labelledby="methodology-title">
        <header>
          <div><span className="eyebrow">算法透明度</span><h2 id="methodology-title">Rating 与 Round Swing 计算方式</h2></div>
          <button ref={closeRef} className="icon-button" aria-label="关闭计算方式" onClick={onClose}><X /></button>
        </header>
        <div className="methodology-meta"><span>算法版本</span><code>{data?.algorithm_version ?? "加载中…"}</code></div>
        <div className="methodology-tabs" role="tablist" aria-label="公式分类">
          {([['rating2','Rating 2.0'],['rating3','Rating 3.0'],['swing','Round Swing']] as const).map(([id,label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setCopied(false); }}>{label}</button>
          ))}
        </div>
        <div className="methodology-content">
          {!data ? <p>正在读取实际计算常数…</p> : tab === "rating2" ? <Rating2 data={data} /> : tab === "rating3" ? <Rating3 data={data} /> : <Swing data={data} />}
        </div>
        <footer>
          <p>所有 3.0 数据均为本地近似，并非 HLTV 官方结果。</p>
          <button disabled={!data} onClick={async () => { await navigator.clipboard.writeText(copyText); setCopied(true); }}>{copied ? <Check /> : <Copy />}{copied ? "已复制" : "复制当前公式"}</button>
        </footer>
      </section>
    </div>
  );
}

function Formula({ children }: { children: string }) { return <pre className="formula-block"><code>{children}</code></pre>; }
function Rating2({ data }: { data: RatingMethodology }) { return <>
  <h3>Rating 2.0 本地计算</h3><p>修正后的逆向近似，KAST 使用百分数输入。</p>
  <Formula>{data.impact_formula}</Formula><Formula>{data.rating_2_formula}</Formula>
  <dl><dt>KPR / DPR / APR</dt><dd>每回合击杀、死亡和助攻。</dd><dt>ADR</dt><dd>每回合实际生命值伤害。</dd><dt>KAST</dt><dd>发生击杀、助攻、存活或死亡被补枪的回合占比。</dd></dl>
  </>; }
function Rating3({ data }: { data: RatingMethodology }) { return <>
  <h3>Rating 3.0 本地近似</h3><Formula>{data.multi_kpr_formula}</Formula><Formula>{data.multi_impact_formula}</Formula><Formula>{data.rating_3_base_formula}</Formula><Formula>{data.swing_rating_formula}</Formula><Formula>{data.rating_3_formula}</Formula>
  <p>eKPR、eDPR、eADR、eKAST 与 eAPR 分别是按枪械对位修正后的每回合击杀、死亡、伤害、KAST 信用和助攻。</p>
  <h3>枪械对位权重</h3><Formula>{data.weapon_weight_formula}</Formula><Formula>{data.sniper_damage_formula}</Formula>
  <div className="methodology-table-wrap"><table><thead><tr><th>类别</th><th>强度</th><th>武器</th></tr></thead><tbody>{data.weapon_categories.map((item) => <tr key={item.id}><td>{item.label}</td><td className="mono">{item.strength.toFixed(2)}</td><td>{item.weapons.join("、")}</td></tr>)}</tbody></table></div>
  <h3>T / CT 枪械对位矩阵</h3>
  <p>单元格为击杀事件权重；行是攻击者，列是受害者。矩阵由当前常数实时生成，双方均按无甲计算。</p>
  <DuelMatrix data={data} side="T" />
  <DuelMatrix data={data} side="CT" />
  <p>护甲为自身强度增加 0.20。T 方偏置 −0.08，CT 方偏置 +0.08；最终事件权重限制为 0.50–1.50。</p>
  </>; }

function DuelMatrix({ data, side }: { data: RatingMethodology; side: "T" | "CT" }) {
  const bias = data.constants[side === "T" ? "side_bias_t" : "side_bias_ct"];
  const beta = data.constants.weapon_beta;
  const weight = (attacker: number, victim: number) => {
    const q = 1 / (1 + Math.exp(-(bias + beta * (attacker - victim))));
    return Math.max(.5, Math.min(1.5, 2 * (1 - q)));
  };
  return <div className="methodology-table-wrap duel-matrix"><table><caption>{side} 方攻击者</caption><thead><tr><th>攻击 \ 受害</th>{data.weapon_categories.map((item) => <th key={item.id}>{item.label}</th>)}</tr></thead><tbody>{data.weapon_categories.map((attacker) => <tr key={attacker.id}><th>{attacker.label}</th>{data.weapon_categories.map((victim) => <td className="mono" key={victim.id}>{weight(attacker.strength, victim.strength).toFixed(2)}</td>)}</tr>)}</tbody></table></div>;
}
function Swing({ data }: { data: RatingMethodology }) { return <>
  <h3>Round Swing</h3><Formula>{data.win_probability_formula}</Formula><Formula>{data.swing_formula}</Formula>
  <h3>击杀信用分配</h3><ul><li>伤害占比：50%</li><li>最终击杀：30%</li><li>闪光助攻：10%</li><li>五秒内补枪：10%</li></ul>
  <p>枪械权重只改变同一事件内贡献者的信用比例；归一化后，事件总胜率变化保持不变且正负双方零和。</p>
  <h3>回合结束的剩余影响</h3><p>此前正 Swing 贡献者计 2 份；残局获胜者、拆包者与获胜存活者各计 1 份。失败方存活者承担对应负值。</p>
  <h3>示例</h3><p>若一名 T 玩家击杀使 T 方胜率从 48% 升至 64%，该事件共有 +16 个百分点的正信用，受害者承担 −16；正信用再依伤害、最后一击、闪光与补枪比例分配。</p>
  <h3>已知限制</h3><ul>{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
  </>; }

function methodologyText(data: RatingMethodology, tab: Tab) {
  if (tab === "rating2") return [data.impact_formula, data.rating_2_formula].join("\n");
  if (tab === "rating3") return [data.multi_kpr_formula, data.multi_impact_formula, data.rating_3_base_formula, data.swing_rating_formula, data.rating_3_formula, data.weapon_weight_formula, data.sniper_damage_formula].join("\n");
  return [data.win_probability_formula, data.swing_formula, "伤害 50% / 最终击杀 30% / 闪光助攻 10% / 五秒补枪 10%"].join("\n");
}
