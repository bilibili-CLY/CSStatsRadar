import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChartNoAxesCombined, FileSearch, Play, Search } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { bridge } from "../../bridge";
import { BusyMessage } from "../../components/Busy";
import { DemoCard } from "../../components/demo/DemoCard";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import { formatDemoDate, signed } from "../../lib/format";
import { useAppStore } from "../../stores/appStore";
import type { DemoAnalysis, DemoPlayerAnalysis, DemoRecord, PlayerRoundMetric } from "../../types";

export function AnalysisView() {
  const demos = useAppStore((state) => state.demos);
  const setDemos = useAppStore((state) => state.setDemos);
  const navigate = useNavigate();
  const { demoId: demoIdParam } = useParams();
  const [demoId, setDemoId] = useState(demoIdParam ?? "");
  const [analysis, setAnalysis] = useState<DemoAnalysis | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [round, setRound] = useState(1);
  const [tab, setTab] = useState<"trend" | "timeline">("trend");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const roundRefs = useRef<Record<number, HTMLElement | null>>({});
  const selectedDemo = demos.find((item) => item.demo_record_id === demoId);
  const player = analysis?.players.find((item) => item.player.steam_id === playerId) ?? analysis?.players[0];
  const selectedRound = player?.rounds.find((item) => item.round_number === round) ?? player?.rounds[0];
  const filteredDemos = useMemo(() => demos.filter((item) => `${item.file_name} ${item.map_name} ${item.note ?? ""}`.toLowerCase().includes(query.toLowerCase())), [demos, query]);

  useEffect(() => { setDemoId(demoIdParam ?? ""); }, [demoIdParam]);
  useEffect(() => {
    if (!demoId) { setAnalysis(null); return; }
    setLoading(true); setError("");
    bridge.getDemoAnalysis(demoId).then((value) => {
      setAnalysis(value); setPlayerId((current) => value.players.some((item) => item.player.steam_id === current) ? current : value.players[0]?.player.steam_id ?? ""); setRound(1);
      bridge.listDemos().then(setDemos).catch(() => undefined);
    }).catch((value) => setError(value instanceof Error ? value.message : String(value))).finally(() => setLoading(false));
  }, [demoId]);

  function pickRound(value: number) {
    setRound(value);
    if (tab === "timeline") requestAnimationFrame(() => roundRefs.current[value]?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  if (!demoId || !selectedDemo) return (
    <div className="page analysis-page">
      <header className="page-header"><div><span className="eyebrow">逐回合洞察</span><h1>比赛分析</h1><p>选择一场已成功解析的 Demo，查看玩家 Rating 与 Swing 的变化。</p></div></header>
      <section className="demo-catalog analysis-demo-catalog">
        <div className="demo-catalog-heading"><div><h2>比赛目录</h2><p>已成功解析的 Demo 可用于逐回合分析。</p></div></div>
        <div className="demo-catalog-content">
          <label className="search-box" style={{ margin: "0 0 12px" }}><Search size={17}/><span className="sr-only">搜索 Demo</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="文件名、地图或备注"/></label>
          {filteredDemos.length ? <div className="demo-record-grid">{filteredDemos.map((demo) => <DemoCard key={demo.demo_record_id} demo={demo} variant="analysis" onOpen={() => navigate(`/analysis/${demo.demo_record_id}`)} footer={<button onClick={() => navigate(`/analysis/${demo.demo_record_id}`)}><Play size={15}/>分析此 Demo</button>}/>)}</div> : <div className="demo-empty-state"><span><FileSearch size={29}/></span><h2>没有可分析的 Demo</h2><p>调整文件名、地图或备注搜索条件，或先在导入页添加比赛。</p></div>}
        </div>
      </section>
    </div>
  );

  return <div className="page analysis-page">
    <header className="page-header compact-header"><div><span className="eyebrow">逐回合洞察</span><h1>{selectedDemo.map_name || "比赛分析"}</h1><p>{selectedDemo.file_name} · {selectedDemo.score_a}:{selectedDemo.score_b} · {selectedDemo.rounds} 回合</p></div><button className="quiet" onClick={() => { setDemoId(""); setAnalysis(null); navigate("/analysis"); }}><FileSearch size={16}/>切换 Demo</button></header>
    {error && <div className="notice danger" role="alert"><span>{error}</span><button onClick={() => bridge.chooseReplacementDemo(demoId).then(setAnalysis).catch((value) => setError(String(value)))}>重新定位文件</button></div>}
    {loading ? <BusyMessage>正在读取并补全回合分析…</BusyMessage> : analysis && <div className="analysis-workspace">
      <aside className="card analysis-roster">
        <div className="analysis-score"><span>{analysis.map_name}</span><strong>{analysis.teams[0]?.score ?? 0}<i>:</i>{analysis.teams[1]?.score ?? 0}</strong><small>{analysis.rounds} 回合 · Rating 3.0 本地近似</small></div>
        {analysis.teams.map((team) => <section key={team.id} className={`analysis-team team-${team.id.toLowerCase()}`}><header><strong>{team.name}</strong><span>{team.score}</span></header>{team.players.map((member) => <button key={member.steam_id} className={player?.player.steam_id === member.steam_id ? "active" : ""} onClick={() => { setPlayerId(member.steam_id); setRound(1); }}><PlayerAvatarView name={member.name} steamId={member.steam_id}/><span><strong>{member.name}</strong><small>{member.steam_id}</small></span></button>)}</section>)}
      </aside>
      <main className="card analysis-main">
        <div className="analysis-main-head"><div>{player && <PlayerAvatarView name={player.player.name} steamId={player.player.steam_id} large/>}<div><h2>{player?.player.name}</h2><p>悬停图表列或使用键盘查看回合明细</p></div></div><div className="analysis-tabs"><button className={tab === "trend" ? "active" : ""} onClick={() => setTab("trend")}>回合走势</button><button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}>回合时间线</button></div></div>
        {player && tab === "trend" ? <RoundCharts key={player.player.steam_id} player={player} selected={round} onSelect={pickRound}/> : player && <div className="round-event-list">{player.rounds.map((item) => <RoundTimeline key={item.round_number} metric={item} active={round === item.round_number} onSelect={() => pickRound(item.round_number)} elementRef={(node) => { roundRefs.current[item.round_number] = node; }}/>)}</div>}
        {selectedRound && <RoundDetail metric={selectedRound}/>} 
      </main>
    </div>}
  </div>;
}

function RoundCharts({ player, selected, onSelect }: { player: DemoPlayerAnalysis; selected: number; onSelect: (round: number) => void }) {
  const values = player.rounds;
  const height = 230, pad = 42;
  const width = Math.max(900, pad * 2 + Math.max(1, values.length - 1) * 44);
  const ratings = values.map((item) => item.cumulative_rating ?? 0);
  const minR = Math.min(.5, ...ratings), maxR = Math.max(1.5, ...ratings);
  const x = (index: number) => pad + index * ((width-pad*2)/Math.max(1, values.length-1));
  const ratingY = (value: number) => height-pad-(value-minR)/(Math.max(.01,maxR-minR))*(height-pad*2);
  const ratingTicks = Array.from({ length: 5 }, (_, index) => minR+(maxR-minR)*index/4);
  const selectedIndex = Math.max(0, values.findIndex((item) => item.round_number === selected));
  const selectedMetric = values[selectedIndex];
  const maxSwing = Math.max(1, ...values.map((item) => Math.abs(item.round_swing)));
  const swingY = (value: number) => height/2-value/maxSwing*(height/2-pad);
  const path = ratings.map((value,index) => `${index ? "L" : "M"}${x(index)} ${ratingY(value)}`).join(" ");
  const guideOffset = x(selectedIndex) - pad;
  const selectFromKey = (event: KeyboardEvent<SVGGElement>, roundNumber: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(roundNumber);
    }
  };
  return <div className="round-charts">
    <div className="round-charts-content" style={{ minWidth: width + 22 }}>
    <section><header><div><ChartNoAxesCombined size={16}/><strong>累计 Rating 3.0</strong></div><span className="chart-current-value">R{selectedMetric?.round_number ?? "—"} · {selectedMetric?.cumulative_rating?.toFixed(2) ?? "—"}</span></header><svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width, width }} role="img" aria-label="累计 Rating 3.0 折线图">{ratingTicks.map((value) => <g className="chart-grid" key={value}><line x1={pad} x2={width-pad} y1={ratingY(value)} y2={ratingY(value)}/><text className="axis-label" x={pad-9} y={ratingY(value)+3}>{value.toFixed(2)}</text></g>)}<line className="selected-guide" x1={pad} x2={pad} y1={pad-5} y2={height-pad} style={{ transform: `translateX(${guideOffset}px)` }}/><path className="rating-line chart-enter-line" pathLength={1} d={path}/>{values.map((item,index) => <g key={item.round_number} className={selected === item.round_number ? "active" : ""} role="button" tabIndex={0} aria-label={`第 ${item.round_number} 回合，累计 Rating 3.0 ${item.cumulative_rating?.toFixed(2) ?? "无数据"}`} onPointerEnter={() => onSelect(item.round_number)} onFocus={() => onSelect(item.round_number)} onClick={() => onSelect(item.round_number)} onKeyDown={(event) => selectFromKey(event, item.round_number)}><rect className="chart-column-hit" x={x(index)-22} y={pad-5} width="44" height={height-pad*2+10}/><circle cx={x(index)} cy={ratingY(item.cumulative_rating ?? 0)} r="6"/><text className="point-value" x={x(index)} y={Math.max(12,ratingY(item.cumulative_rating ?? 0)-11)}>{item.cumulative_rating?.toFixed(2) ?? "—"}</text><text x={x(index)} y={height-8}>R{item.round_number}</text><title>第 {item.round_number} 回合：{item.cumulative_rating?.toFixed(2) ?? "—"}</title></g>)}</svg></section>
    <section><header><div><strong>单回合 Swing</strong><span className="chart-legend">↑ 正 / ↓ 负</span></div><span className={`chart-current-value ${selectedMetric && selectedMetric.round_swing < 0 ? "negative-text" : "positive-text"}`}>R{selectedMetric?.round_number ?? "—"} · {selectedMetric ? `${signed(selectedMetric.round_swing)}%` : "—"}</span></header><svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width, width }} role="img" aria-label="单回合 Swing 正负柱状图"><line className="zero-line" x1={pad} x2={width-pad} y1={height/2} y2={height/2}/><line className="selected-guide" x1={pad} x2={pad} y1={pad-5} y2={height-pad} style={{ transform: `translateX(${guideOffset}px)` }}/>{values.map((item,index) => { const y = swingY(item.round_swing); const positive = item.round_swing >= 0; return <g key={item.round_number} className={`${positive ? "positive" : "negative"} ${selected === item.round_number ? "active" : ""}`} role="button" tabIndex={0} aria-label={`第 ${item.round_number} 回合，${positive ? "正贡献" : "负贡献"} ${signed(item.round_swing)}%`} onPointerEnter={() => onSelect(item.round_number)} onFocus={() => onSelect(item.round_number)} onClick={() => onSelect(item.round_number)} onKeyDown={(event) => selectFromKey(event, item.round_number)}><rect className="swing-bar chart-enter-bar" x={x(index)-8} y={Math.min(y,height/2)} width="16" height={Math.max(2,Math.abs(y-height/2))} style={{ animationDelay: `${Math.min(270, index * 12)}ms`, transformOrigin: positive ? "center bottom" : "center top" }}/><rect className="chart-column-hit" x={x(index)-22} y={pad-5} width="44" height={height-pad*2+10}/><text className="swing-direction" x={x(index)} y={positive ? Math.max(12,y-5) : Math.min(height-24,y+14)}>{positive ? "↑" : "↓"}</text><text x={x(index)} y={height-8}>R{item.round_number}</text><title>第 {item.round_number} 回合：{signed(item.round_swing)}%</title></g>; })}</svg></section>
    </div>
  </div>;
}

function RoundTimeline({ metric, active, onSelect, elementRef }: { metric: PlayerRoundMetric; active: boolean; onSelect: () => void; elementRef: (node: HTMLElement | null) => void }) {
  return <article ref={elementRef} className={`round-timeline-card ${active ? "active" : ""}`}><button className="round-timeline-head" onClick={onSelect}><span className={metric.won ? "round-win" : "round-loss"}>{metric.won ? "胜利" : "失利"}</span><strong>第 {metric.round_number} 回合</strong><span>{metric.score_a}:{metric.score_b}</span><span className={metric.round_swing >= 0 ? "positive-text" : "negative-text"}>{metric.round_swing >= 0 ? <ArrowUp size={14}/> : <ArrowDown size={14}/>} {signed(metric.round_swing)}%</span></button>{active && <div className="swing-event-list">{metric.events.length ? metric.events.map((event) => <div key={event.id} className={event.contribution >= 0 ? "positive" : "negative"}><span className="event-tick">tick {event.tick || "—"}</span><span><strong>{event.label}</strong><small>{event.breakdown?.map((part) => `${contributionLabel(part.kind)} ${signed(part.value)}%`).join(" · ")}</small></span><b>{signed(event.contribution)}%</b></div>) : <p>本回合没有该玩家的可归因 Swing 事件。</p>}</div>}</article>;
}

function RoundDetail({ metric }: { metric: PlayerRoundMetric }) {
  return <section className="round-detail" aria-label={`第 ${metric.round_number} 回合详情`}><header><strong>第 {metric.round_number} 回合详情</strong><span className={metric.won ? "round-win" : "round-loss"}>{metric.won ? "胜利" : "失利"}</span></header><div><Metric label="比分" value={`${metric.score_a}:${metric.score_b}`}/><Metric label="K / D / A" value={`${metric.kills} / ${metric.deaths} / ${metric.assists}`}/><Metric label="伤害" value={String(metric.damage)}/><Metric label="KAST" value={metric.kast ? "✓ 有效" : "—"}/><Metric label="累计 R3" value={metric.cumulative_rating?.toFixed(2) ?? "—"}/><Metric label="Swing" value={`${signed(metric.round_swing)}%`} tone={metric.round_swing}/></div></section>;
}
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <span><small>{label}</small><strong className={tone == null ? "" : tone >= 0 ? "positive-text" : "negative-text"}>{value}</strong></span>; }
function contributionLabel(kind: string) { return ({ final_blow: "终结击杀", damage: "伤害分摊", flash_assist: "闪光助攻", trade: "补枪", death: "死亡", round_result: "回合结算", plant_and_result: "下包与结算", defuse_and_result: "拆包与结算", survival_and_result: "存活与结算" } as Record<string,string>)[kind] ?? kind; }
