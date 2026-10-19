type ActualRow = {
  fiscal_period: string;
  eps_actual: number;
  eps_basis: 'DILUTED';
  share_class: 'COMMON_SHARE';
  revenue_actual: number;
  reported_revenue_billion: string;
  revenue_resolution_twd: number;
  source_ref: string;
  source_sha256: string;
  source_date_label: string;
  source_received_at: string;
  available_at: string;
  announced_at: null;
};
type QuarterActuals = {
  contract: 'OWNER_RETAINED_QUARTER_ACTUALS_V1';
  status: 'ACTUALS_4_OF_4_V1_BLOCKED';
  symbol: '2330';
  as_of_date: string;
  supported_report_dates: { from: string; through: string };
  source_pack_sha256: string;
  pack_created_at: string;
  evidence_cutoff: string;
  rows: ActualRow[];
  missing: string[];
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const isoTime = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const dateLabel = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function officialPdf(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'investor.tsmc.com' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && /\.pdf$/i.test(url.pathname) && url.href === value;
  } catch { return false; }
}
/** Reads only the server Owner-field envelope; it does not grant access or admit a source. */
function readQuarterActuals(candidate: unknown): QuarterActuals | null {
  const owner = object(candidate), value = object(owner.quarter_actuals), dates = object(value.supported_report_dates);
  if (owner.candidate_only !== true || owner.member_publication_approved !== false
    || value.contract !== 'OWNER_RETAINED_QUARTER_ACTUALS_V1' || value.status !== 'ACTUALS_4_OF_4_V1_BLOCKED'
    || value.symbol !== '2330' || !dateLabel(value.as_of_date) || !dateLabel(dates.from) || !dateLabel(dates.through)
    || dates.from !== value.as_of_date || dates.through < dates.from || !sha256(value.source_pack_sha256)
    || !isoTime(value.pack_created_at) || !isoTime(value.evidence_cutoff) || !Array.isArray(value.rows) || value.rows.length !== 4
    || !Array.isArray(value.missing) || !value.missing.length
    || !value.missing.every(code => typeof code === 'string' && Boolean(code.trim()))) return null;
  const periods = ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];
  const rows = value.rows.map(object);
  if (new Set(rows.map(row => row.fiscal_period)).size !== 4 || rows.some(row => !periods.includes(String(row.fiscal_period))
    || typeof row.eps_actual !== 'number' || !Number.isFinite(row.eps_actual) || row.eps_basis !== 'DILUTED' || row.share_class !== 'COMMON_SHARE'
    || typeof row.revenue_actual !== 'number' || !Number.isSafeInteger(row.revenue_actual) || row.revenue_actual < 0
    || typeof row.reported_revenue_billion !== 'string' || !/^\d+(?:\.\d+)?$/.test(row.reported_revenue_billion)
    || row.revenue_resolution_twd !== 10_000_000 || !officialPdf(row.source_ref) || !sha256(row.source_sha256)
    || !dateLabel(row.source_date_label) || !isoTime(row.source_received_at) || !isoTime(row.available_at) || row.announced_at !== null)) return null;
  return { ...value, rows: periods.map(period => rows.find(row => row.fiscal_period === period)) } as QuarterActuals;
}
const missingLabels: Record<string, string> = {
  EXACT_FIRST_PUBLIC_ANNOUNCEMENT_AND_VERSION: '首次公開公告時間與版本尚未確認',
  PREANNOUNCEMENT_CONSENSUS: '公告前共識尚未留存',
  LATEST_GUIDANCE: '最新財測尚未完成核對',
  FORMAL_SOURCE_ADMISSION: '正式來源准入尚未完成',
};

export default function OwnerQuarterActualsView({ candidate }: { candidate: unknown }) {
  const data = readQuarterActuals(candidate);
  if (!data) return <section aria-label="台積電四季營收與每股盈餘" className="mt-4 rounded-lg border p-4">
    <h3 className="font-semibold">台積電四季營收與每股盈餘</h3>
    <p role="status" className="mt-2 text-sm">此報告的資料尚未核對完成，暫不顯示四季數字。</p>
  </section>;
  return <section aria-label="台積電四季營收與每股盈餘" className="mt-4 rounded-lg border border-amber-500/50 p-4">
    <h3 className="font-semibold">台積電四季營收與每股盈餘</h3>
    <p className="mt-2 text-sm">已取得四季營收與每股盈餘。公告前預估、財測及公告版本仍待核對，尚不能完成正式推薦。僅供 Owner 研究，尚未對會員發布。</p>
    <p className="mt-2 text-sm">每股盈餘採稀釋普通股計算，單位為新臺幣；營收以十億元新臺幣顯示。</p>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="mb-2 text-left font-semibold">台積電（2330）四季財報數字</caption>
        <thead><tr>{['季度', 'EPS（元）', '營收（十億元）', '官方 PDF'].map(label =>
          <th key={label} scope="col" className="border-b p-2 align-top">{label}</th>)}</tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.fiscal_period}>
          <th scope="row" className="border-b p-2 align-top whitespace-nowrap">{row.fiscal_period}</th>
          <td className="border-b p-2 align-top">{row.eps_actual}</td>
          <td className="border-b p-2 align-top">{row.reported_revenue_billion}</td>
          <td className="border-b p-2 align-top"><a href={row.source_ref} target="_blank" rel="noopener noreferrer"
            aria-label={`${row.fiscal_period} 台積電官方 PDF`} className="underline whitespace-nowrap">查看 PDF</a></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 text-sm">營收保留原報表精度，換算為新臺幣時以一千萬元（10,000,000 TWD）為單位，沒有更細的精確值。首次公開公告時間仍未確認。</p>
    <p className="mt-2 text-sm">這是截至 {data.as_of_date} 的四季版本，並非永久最新；後續季度仍須重新核對。</p>
    <details className="mt-3 text-xs"><summary className="cursor-pointer">查核來源與版本證據</summary>
      <p className="mt-3">適用報告日期：{data.supported_report_dates.from}～{data.supported_report_dates.through}。</p>
      <p className="mt-2">EPS：DILUTED／COMMON_SHARE，單位 TWD。Basic 未揭露，不因此新增評估門檻。</p>
      <p className="mt-2">來源日期標籤、PDF 首次見時間與候選可用時間各有不同意義；皆不代替首次公開公告時間，也不代表預覽報告當時已可取得。</p>
      <div className="mt-3 space-y-4">{data.rows.map(row => <article key={row.fiscal_period}>
        <h4 className="font-semibold">{row.fiscal_period}</h4>
        <dl className="mt-2 space-y-2 break-all"><div><dt>官方 PDF 完整網址</dt><dd>{row.source_ref}</dd></div>
          <div><dt>PDF SHA-256</dt><dd>{row.source_sha256}</dd></div>
          <div><dt>來源日期標籤</dt><dd>{row.source_date_label}</dd></div>
          <div><dt>PDF 首次見時間（source_received_at）</dt><dd>{row.source_received_at}</dd></div>
          <div><dt>候選可用時間（available_at）</dt><dd>{row.available_at}</dd></div>
          <div><dt>首次公開公告時間</dt><dd>未確認（announced_at = null）</dd></div>
          <div><dt>換算營收（保留一千萬元精度）</dt><dd>{row.revenue_actual.toLocaleString('en-US')} TWD</dd></div></dl>
      </article>)}</div>
      <dl className="mt-2 space-y-2 break-all"><div><dt>候選資料截止（evidence_cutoff）</dt><dd>{data.evidence_cutoff}</dd></div>
        <div><dt>候選建立（pack_created_at）</dt><dd>{data.pack_created_at}</dd></div>
        <div><dt>來源包 SHA-256</dt><dd>{data.source_pack_sha256}</dd></div>
        <div><dt>Contract／狀態</dt><dd>{data.contract}／{data.status}</dd></div></dl>
      <ul className="mt-3 space-y-2">{data.missing.map(code => <li key={code}>{missingLabels[code] || code}（{code}）</li>)}</ul>
    </details>
  </section>;
}
