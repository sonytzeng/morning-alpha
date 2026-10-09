import { useId, useState } from 'react';
import { classifyCandle } from '@/features/academy/model';
import type { AcademyDiagram } from './content';

// Original illustrative examples for the UI, not teacher research or user-supplied source material.
const DEMO_CANDLES = [
  { open: 100, high: 106, low: 98, close: 104, volume: 0 },
  { open: 104, high: 106, low: 99, close: 100, volume: 0 },
];
const DEFAULT_ZONES = [{ label: '支撐區', low: 98, high: 100 }, { label: '壓力區', low: 108, high: 110 }];
const format = (value: number) => Number(value.toFixed(2)).toString();

export default function Diagram({ diagram }: { diagram: AcademyDiagram }) {
  const { kind, caption } = diagram;
  const titleId = useId();
  const [selected, setSelected] = useState(0), [step, setStep] = useState(0), [zone, setZone] = useState(0);
  const candles = diagram.candles || DEMO_CANDLES;
  const candle = candles[Math.min(selected, candles.length - 1)];
  const classification = classifyCandle(candle);
  const staged = ['bullSteps', 'bearSteps', 'cycle', 'steps'].includes(kind);
  const labels = diagram.labels || [0, 1, 2, 3, 4, 5].slice(0, kind === 'cycle' ? 6 : 4).map(i => `${kind === 'cycle' ? '階段' : '步驟'} ${i + 1}`);
  const values = diagram.values || (diagram.candles ? diagram.candles.map(c => c.close) : kind === 'bullSteps' ? [110, 103, 98, 108, 104, 115] : kind === 'bearSteps' ? [100, 107, 112, 102, 106, 95] : []);
  const counts = diagram.visibleCounts || (staged ? labels.map((_, i) => Math.min(values.length, Math.ceil((i + 1) * Math.max(0, values.length - 1) / labels.length) + 1)) : []);
  const count = staged ? counts[step] || 0 : values.length;
  const visible = values.slice(0, count);
  const levels = diagram.levels || DEFAULT_ZONES;
  const risk = diagram.risk || { entry: 102, stop: 98, target: 110 };
  const volumes = diagram.volumes || (diagram.candles ? candles.map(c => c.volume) : []);
  const hasVolume = volumes.length > 0;
  const candlePlot = kind === 'candle' || (kind === 'volume' && !!diagram.candles);
  const numberPool = kind === 'risk' ? [risk.entry, risk.stop, risk.target] : candlePlot ? candles.flatMap(c => [c.low, c.high]) : [...values, ...(kind === 'zones' ? levels.flatMap(l => [l.low, l.high]) : [])];
  const min = Math.min(...(numberPool.length ? numberPool : [0])), max = Math.max(...(numberPool.length ? numberPool : [1]));
  const span = max - min || 1, bottom = hasVolume ? 180 : 248;
  const y = (v: number) => bottom - ((v - min + span * .12) / (span * 1.24)) * (bottom - 30);
  const x = (i: number, total: number) => 65 + i * 435 / Math.max(1, total - 1);
  const line = visible.map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length)},${y(v)}`).join(' ');
  const dataProvided = !!(diagram.values || diagram.candles || diagram.risk || diagram.levels || diagram.labels);
  const missing = kind === 'volume' && !hasVolume || kind === 'trend' && values.length === 0 || kind === 'steps' && !diagram.labels;
  const labelText = candlePlot ? `第 ${selected + 1} 根 K 線：開 ${candle.open}、高 ${candle.high}、低 ${candle.low}、收 ${candle.close}` : staged ? `第 ${step + 1} 階段：${labels[step]}` : kind === 'risk' ? `示例：進場 ${risk.entry}，停止 ${risk.stop}，目標 ${risk.target}` : caption;
  return <figure className="academy-diagram">
    <div className="academy-diagram-heading"><span>INTERACTIVE STUDY</span><span>{dataProvided ? '依匯入資料繪製 · 教學示意' : '原創通用示意 · 非真實行情'}</span></div>
    {missing ? <p className="academy-diagram-missing" role="status">此圖所需的{kind === 'volume' ? '成交量資料' : kind === 'steps' ? '步驟標籤' : '數值序列'}尚未提供，未代填其他圖形。</p> : kind === 'steps' || kind === 'cycle' ? <div className={`academy-stage-flow ${kind === 'cycle' ? 'is-cycle' : ''}`} aria-label={kind === 'cycle' ? '循環階段' : '流程步驟'}>
      {labels.slice(0, step + 1).map((label, i) => <div key={i} className={i === step ? 'is-current' : ''}><span>{String(i + 1).padStart(2, '0')}</span><strong>{label}</strong>{i < step && <span aria-hidden="true">↓</span>}</div>)}
      <p role="status">已揭露 {step + 1}／{labels.length} 階段{kind === 'cycle' && step === labels.length - 1 ? ' · 循環示意，不保證重複發生' : ''}</p>
    </div> : <svg viewBox="0 0 560 310" role={candlePlot ? 'group' : 'img'} aria-labelledby={titleId}>
      <title id={titleId}>{labelText}</title>
      {[min, min + span / 2, max].map((v, i) => <g key={i}><line x1="50" y1={y(v)} x2="535" y2={y(v)} stroke="#263e48" strokeDasharray="3 7" /><text x="4" y={y(v) + 4} fill="#b2c6ca" fontSize="11">{format(v)}</text></g>)}
      {kind === 'risk' ? <>
        <rect x="235" y={Math.min(y(risk.entry), y(risk.target))} width="165" height={Math.abs(y(risk.entry) - y(risk.target))} fill="#82d3c429" />
        <rect x="235" y={Math.min(y(risk.entry), y(risk.stop))} width="165" height={Math.abs(y(risk.entry) - y(risk.stop))} fill="#ffb59129" />
        {[[risk.target, '示例目標', '#82d3c4'], [risk.entry, '示例進場', '#f0e9d8'], [risk.stop, '示例停止', '#ffb591']].map(([v, label, color]) => <g key={label}><line x1="60" x2="530" y1={y(Number(v))} y2={y(Number(v))} stroke={String(color)} strokeWidth="2" /><text x="70" y={y(Number(v)) - 8} fill={String(color)} fontSize="14">{label} {v}</text></g>)}
      </> : candlePlot ? candles.map((c, i) => {
        const cx = candles.length === 1 ? 280 : x(i, candles.length), width = Math.min(45, 280 / candles.length), color = c.close >= c.open ? '#ffb591' : '#82d3c4';
        return <g key={i} role="button" tabIndex={0} aria-label={`圖中第 ${i + 1} 根 K 線`} aria-pressed={selected === i} onClick={() => setSelected(i)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(i); } }} style={{ cursor: 'pointer' }}>
          <rect x={cx - width} y="20" width={width * 2} height={bottom - 10} rx="9px" fill={selected === i ? '#ffffff08' : 'transparent'} stroke={selected === i ? '#bddccc' : 'transparent'} />
          <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="3" />
          <rect x={cx - width / 2} y={y(Math.max(c.open, c.close))} width={width} height={Math.max(2, Math.abs(y(c.open) - y(c.close)))} fill={color} />
        </g>;
      }) : <>
        {kind === 'zones' && levels.map((level, i) => <g key={i}><rect x="50" y={y(level.high)} width="480" height={Math.max(2, y(level.low) - y(level.high))} fill={zone === i ? '#82d3c440' : '#82d3c410'} stroke={zone === i ? '#82d3c4' : '#49636b'} /><text x="60" y={y(level.high) - 7} fill="#cfdfd9" fontSize="12">{level.label} {format(level.low)}–{format(level.high)}</text></g>)}
        {line && <path data-testid="academy-visible-line" data-visible-points={visible.length} d={line} fill="none" stroke="#82d3c4" strokeWidth="3" />}
        {visible.map((v, i) => <circle key={i} cx={x(i, values.length)} cy={y(v)} r={i === visible.length - 1 ? 6 : 3} fill={i === visible.length - 1 ? '#ffb591' : '#bddccc'} />)}
      </>}
      {hasVolume && <g aria-label="成交量柱狀圖">{volumes.map((v, i) => <rect key={i} data-testid="academy-volume-bar" x={x(i, volumes.length) - Math.min(15, 180 / volumes.length)} y={275 - v / Math.max(1, ...volumes) * 65} width={Math.min(30, 360 / volumes.length)} height={v / Math.max(1, ...volumes) * 65} fill={i === selected ? '#ffb591' : '#82d3c4'} />)}<text x="5" y="211" fill="#b2c6ca" fontSize="11">量</text></g>}
      {!staged && (diagram.labels || []).slice(0, 12).map((label, i, all) => <text key={i} x={x(i, all.length)} y="303" textAnchor="middle" fill="#c7d8dc" fontSize="10">{label.length > 8 ? label.slice(0, 8) + '…' : label}</text>)}
    </svg>}
    {candlePlot && !missing && <><p className="academy-candle-legend">深色圖例：暖色＝紅 K（收高於開），青色＝黑 K（收低於開）；開收相同＝十字。</p><div className="academy-segments" role="group" aria-label="選擇 K 線">{candles.map((_, i) => <button type="button" key={i} aria-pressed={selected === i} onClick={() => setSelected(i)}>{diagram.labels?.[i] || `K 線 ${i + 1}`}</button>)}</div>
      <dl className="academy-ohlc" aria-live="polite">{[['開 O', candle.open], ['高 H', candle.high], ['低 L', candle.low], ['收 C', candle.close]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{format(Number(v))}</dd></div>)}</dl><p className="academy-candle-classification" role="status">{classification.explanation}{hasVolume ? ` 選取成交量：${format(volumes[selected] || 0)}` : ''}</p></>}
    {kind === 'zones' && <div className="academy-segments" role="group" aria-label="選擇區域">{levels.map((level, i) => <button type="button" key={i} aria-pressed={zone === i} onClick={() => setZone(i)}>觀察{level.label}</button>)}</div>}
    {kind === 'risk' && <dl className="academy-risk-math"><div><dt>每單位風險</dt><dd>{format(Math.abs(risk.entry - risk.stop))}</dd></div><div><dt>示例潛在報酬</dt><dd>{format(Math.abs(risk.target - risk.entry))}</dd></div><div><dt>示例報酬／風險</dt><dd>{format(Math.abs(risk.target - risk.entry) / Math.abs(risk.entry - risk.stop))} : 1</dd></div></dl>}
    {staged && !missing && <><div className="academy-segments" role="group" aria-label="分步圖解">{labels.map((label, i) => <button type="button" key={i} aria-pressed={step === i} onClick={() => setStep(i)}>{i + 1}. {label}</button>)}</div><div className="academy-step-controls"><button type="button" disabled={step === 0} onClick={() => setStep(s => s - 1)}>上一步</button><span role="status">步驟 {step + 1}／{labels.length} · {labels[step]}</span><button type="button" disabled={step === labels.length - 1} onClick={() => setStep(s => s + 1)}>下一步</button></div></>}
    <figcaption>{caption}<small>{dataProvided ? '圖解由本機課程資料驅動；不是即時行情或投資建議。' : '通用操作示意；私人章節可提供數值、標籤及步驟界線覆寫。'}</small></figcaption>
  </figure>;
}
