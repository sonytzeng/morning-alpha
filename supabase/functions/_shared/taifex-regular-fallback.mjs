// Free official prior-regular-session fallback, never an intraday/night quote.
// The final price comes from the daily report; its actual second comes from
// matching trades at the latest second. No publication/close time is invented.
import { inflateRawSync } from "node:zlib";
import {
  coveredCalendarDate,
  isMarketTradingDate,
  previousMarketTradingDate,
} from "./market-session-contract.mjs";
import {
  PREMARKET_LAST_COLLECTION_MINUTES,
  PREMARKET_READINESS_START_MINUTES,
} from "./premarket-provider-readiness.mjs";

export const TAIFEX_REGULAR_VERSION = "TAIFEX_REGULAR_WITH_TICK_TIME_V1";
export const TAIFEX_DAILY_URL =
  "https://www.taifex.com.tw/data_gov/taifex_open_data.asp?data_name=DailyMarketReportFut";
export const TAIFEX_TICK_DATASET = "https://data.gov.tw/dataset/20668";
export const TAIFEX_ATTRIBUTION =
  "資料來源：臺灣期貨交易所／金融監督管理委員會證券期貨局；依政府資料開放授權條款第1版利用。";
const MAX_CSV = 64 * 1024 * 1024, MAX_ZIP = 8 * 1024 * 1024;
const fail = (code) => {
  throw Error(code);
};
const record = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const isoDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(s)) &&
  Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const clock = (s) => {
  const ms = Date.parse(String(s));
  if (!Number.isFinite(ms)) return null;
  const t = new Date(ms + 8 * 3600000).toISOString();
  return {
    ms,
    date: t.slice(0, 10),
    minutes: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)),
  };
};
const number = (s) =>
  typeof s === "number" && Number.isFinite(s)
    ? s
    : typeof s === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s.trim())
    ? Number(s)
    : null;
const sha = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
export const taifexArchiveUrl = (date) => {
  if (!isoDate(date)) fail("TAIFEX_DATE_INVALID");
  return `https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_${
    date.replaceAll("-", "_")
  }.zip`;
};
export function taifexFrontMonth(date) {
  if (!isoDate(date) || !isMarketTradingDate("TW", date)) {
    fail("TAIFEX_CALENDAR_UNAVAILABLE");
  }
  let [y, m] = date.split("-").map(Number);
  for (let i = 0; i < 2; i++) {
    const first = new Date(Date.UTC(y, m - 1, 1)),
      day = 1 + (3 - first.getUTCDay() + 7) % 7 + 14;
    const expiry = `${y}-${String(m).padStart(2, "0")}-${
      String(day).padStart(2, "0")
    }`;
    // Exceptional/non-trading expiration requires its official adjustment;
    // never silently substitute an assumed shifted expiry.
    if (
      !coveredCalendarDate("TW", expiry) || !isMarketTradingDate("TW", expiry)
    ) fail("TAIFEX_EXPIRY_REVIEW_REQUIRED");
    if (date <= expiry) return `${y}${String(m).padStart(2, "0")}`;
    if (++m === 13) {
      m = 1;
      y++;
    }
  }
  fail("TAIFEX_CONTRACT_UNAVAILABLE");
}
function context(options) {
  const at = clock(options.observedAt), date = options.tradingDate;
  if (
    options.phase !== "premarket" || !at || at.date !== date ||
    at.minutes < PREMARKET_READINESS_START_MINUTES ||
    at.minutes > PREMARKET_LAST_COLLECTION_MINUTES
  ) fail("TAIFEX_PREMARKET_ONLY");
  const month = taifexFrontMonth(date),
    prior = previousMarketTradingDate("TW", date);
  if (!prior) fail("TAIFEX_CALENDAR_UNAVAILABLE");
  return { at, date, month, prior };
}
function* csvLines(text) {
  let start = 0;
  while (start < text.length) {
    const found = text.indexOf("\n", start),
      end = found < 0 ? text.length : found;
    const line = text.slice(start, end).replace(/\r$/, "");
    start = end + 1;
    if (line.trim()) yield line;
  }
}
function csvCells(line) {
  const out = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(value.trim());
      value = "";
    } else value += c;
  }
  if (quoted) fail("TAIFEX_CSV_INVALID");
  out.push(value.trim());
  return out;
}
export function selectTaifexDaily(text, prior, month) {
  const lines = csvLines(text.replace(/^\uFEFF/, "")),
    header = csvCells(lines.next().value || "");
  const keys = [
    "日期",
    "契約代號",
    "到期月份(週別)",
    "最後成交價",
    "漲跌價",
    "漲跌%",
    "交易時段",
  ];
  const positions = keys.map((k) => header.indexOf(k));
  if (positions.some((i) => i < 0) || new Set(header).size !== header.length) {
    fail("TAIFEX_DAILY_HEADER_INVALID");
  }
  const selected = [];
  for (const line of lines) {
    const cells = csvCells(line);
    if (cells.length !== header.length) fail("TAIFEX_DAILY_ROW_INVALID");
    const r = Object.fromEntries(keys.map((k, i) => [k, cells[positions[i]]]));
    if (
      r["日期"] === prior.replaceAll("-", "") && r["契約代號"] === "TX" &&
      r["到期月份(週別)"] === month && r["交易時段"] === "一般"
    ) selected.push(r);
  }
  if (selected.length !== 1) fail("TAIFEX_DAILY_SESSION_MISSING_OR_DUPLICATE");
  const r = selected[0],
    price = number(r["最後成交價"]),
    change = number(r["漲跌價"]),
    percent = r["漲跌%"];
  if (!percent.endsWith("%")) fail("TAIFEX_DAILY_PRICE_INVALID");
  const changePercent = number(percent.slice(0, -1));
  if (
    price === null || price <= 0 || change === null || changePercent === null ||
    price - change <= 0 ||
    Math.abs(change / (price - change) * 100 - changePercent) > .011
  ) fail("TAIFEX_DAILY_PRICE_INVALID");
  return { price, change, changePercent };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function extractTaifexCsv(bytes, prior) {
  if (
    !(bytes instanceof Uint8Array) || bytes.length > MAX_ZIP ||
    bytes.length < 100
  ) fail("TAIFEX_ARCHIVE_SIZE_INVALID");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (
    e < 0 || e + 22 + v.getUint16(e + 20, true) !== bytes.length ||
    v.getUint16(e + 4, true) !== 0 || v.getUint16(e + 6, true) !== 0 ||
    v.getUint16(e + 8, true) !== 1 || v.getUint16(e + 10, true) !== 1
  ) fail("TAIFEX_ARCHIVE_DIRECTORY_INVALID");
  const c = v.getUint32(e + 16, true),
    directorySize = v.getUint32(e + 12, true);
  if (
    c + 46 > e || c + directorySize !== e || v.getUint32(c, true) !== 0x02014b50
  ) fail("TAIFEX_ARCHIVE_DIRECTORY_INVALID");
  const flags = v.getUint16(c + 8, true),
    method = v.getUint16(c + 10, true),
    crc = v.getUint32(c + 16, true),
    compressed = v.getUint32(c + 20, true),
    size = v.getUint32(c + 24, true),
    n = v.getUint16(c + 28, true),
    extra = v.getUint16(c + 30, true),
    comment = v.getUint16(c + 32, true),
    local = v.getUint32(c + 42, true);
  if (
    flags & 1 || method !== 8 || size > MAX_CSV || size === 0 ||
    compressed > MAX_ZIP || c + 46 + n + extra + comment !== e || local + 30 > c
  ) fail("TAIFEX_ARCHIVE_MEMBER_INVALID");
  const name = new TextDecoder().decode(bytes.subarray(c + 46, c + 46 + n));
  if (
    name !== `Daily_${prior.replaceAll("-", "_")}.csv` ||
    v.getUint32(local, true) !== 0x04034b50 ||
    v.getUint16(local + 6, true) !== flags ||
    v.getUint16(local + 8, true) !== method
  ) fail("TAIFEX_ARCHIVE_MEMBER_INVALID");
  const ln = v.getUint16(local + 26, true),
    le = v.getUint16(local + 28, true),
    start = local + 30 + ln + le;
  if (
    new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + ln)) !==
      name || start + compressed > c
  ) fail("TAIFEX_ARCHIVE_MEMBER_INVALID");
  const csv = inflateRawSync(bytes.subarray(start, start + compressed), {
    maxOutputLength: MAX_CSV,
  });
  if (csv.length !== size || crc32(csv) !== crc) {
    fail("TAIFEX_ARCHIVE_INTEGRITY_FAILED");
  }
  return csv;
}
export function matchTaifexLastTrade(csv, prior, month, price) {
  const end = csv.indexOf(10);
  if (end < 0 || end > 1024) fail("TAIFEX_TICK_HEADER_INVALID");
  const header = new TextDecoder("big5", { fatal: true }).decode(
    csv.subarray(0, end),
  ).trim().split(",").map((s) => s.trim());
  if (
    header.join("|") !==
      "成交日期|商品代號|到期月份(週別)|成交時間|成交價格|成交數量(B+S)|近月價格|遠月價格|開盤集合競價"
  ) fail("TAIFEX_TICK_HEADER_INVALID");
  // Numeric body is ASCII. Iterate lines without allocating an array of the
  // complete trade file, keeping peak memory bounded on the Edge runtime.
  const body = new TextDecoder("utf-8", { fatal: true }).decode(
      csv.subarray(end + 1),
    ),
    date = prior.replaceAll("-", "");
  let latest = "", matched = false, count = 0;
  let cursor = 0;
  for (;;) {
    const productAt = body.indexOf(",TX", cursor);
    if (productAt < 0) break;
    const start = body.lastIndexOf("\n", productAt) + 1,
      end = body.indexOf("\n", productAt);
    cursor = end < 0 ? body.length : end + 1;
    const row = body.slice(start, end < 0 ? body.length : end).split(",").map(
      (s) => s.trim(),
    );
    if (row[1] !== "TX" || row[2] !== month || row[0] !== date) continue;
    if (row.length !== 9 || !/^\d{6}$/.test(row[3])) {
      fail("TAIFEX_TICK_ROW_INVALID");
    }
    const t = row[3];
    if (t < "084500" || t > "134500") continue;
    if (
      Number(t.slice(2, 4)) > 59 || Number(t.slice(4)) > 59 ||
      number(row[4]) === null || Number(row[4]) <= 0 ||
      number(row[5]) === null || Number(row[5]) <= 0
    ) fail("TAIFEX_TICK_ROW_INVALID");
    count++;
    if (t > latest) {
      latest = t;
      matched = false;
    }
    if (t === latest && Number(row[4]) === price) matched = true;
  }
  if (!count || latest < "134000" || !matched) {
    fail("TAIFEX_TICK_LAST_PRICE_MISMATCH");
  }
  return `${prior}T${latest.slice(0, 2)}:${latest.slice(2, 4)}:${
    latest.slice(4)
  }+08:00`;
}
export function normalizeTaifexRegularPayload(payload, options) {
  try {
    const c = context(options),
      p = record(payload),
      trade = record(p.lastTrade),
      total = record(p.total);
    if (
      p.type !== TAIFEX_REGULAR_VERSION || p.exchange !== "TAIFEX" ||
      p.product !== "TX" || p.session !== "regular" || p.date !== c.prior ||
      p.symbol !== `TX${c.month}`
    ) return null;
    if (
      ![p.price, p.change, p.changePercent].every((x) =>
        typeof x === "number" && Number.isFinite(x)
      ) || p.price <= 0 || p.price - p.change <= 0 ||
      Math.abs(p.change / (p.price - p.change) * 100 - p.changePercent) > .011
    ) return null;
    const at = clock(trade.time);
    if (
      !at || trade.price !== p.price || total.time !== trade.time ||
      at.date !== c.prior || at.minutes < 820 ||
      at.ms > Date.parse(c.prior + "T13:45:00+08:00") || at.ms > c.at.ms
    ) return null;
    const sources = p.data;
    if (!Array.isArray(sources) || sources.length !== 2) return null;
    const urls = [TAIFEX_DAILY_URL, taifexArchiveUrl(c.prior)];
    for (let i = 0; i < 2; i++) {
      const r = record(sources[i]), received = clock(r.received_at);
      if (
        r.source_url !== urls[i] ||
        !(/^[a-f0-9]{64}$/).test(String(r.source_sha256)) ||
        !Number.isInteger(r.source_bytes) || r.source_bytes <= 0 ||
        r.source_bytes > (i ? MAX_ZIP : 2 * 1024 * 1024) || !received ||
        received.date !== c.date || received.ms < c.at.ms ||
        received.minutes > PREMARKET_LAST_COLLECTION_MINUTES
      ) return null;
    }
    return {
      value: p.price,
      change: p.change,
      changePercent: p.changePercent,
      capturedAt: trade.time,
      provider: "taifex_open_data",
      sourceSymbol: p.symbol,
      raw: {
        ...p,
        provider: "taifex_open_data",
        product: "TXF",
        date: c.prior,
        session: "regular",
        fallback_used: true,
        fallback_from_session: "afterhours",
        contract_resolution: "official_monthly_contract",
        timestamp_basis: "ACTUAL_MATCHING_TRADE_SECOND",
        published_at: null,
        attribution: TAIFEX_ATTRIBUTION,
        license_url: "https://data.gov.tw/license",
        dataset_urls: [
          "https://data.gov.tw/dataset/11319",
          TAIFEX_TICK_DATASET,
        ],
      },
    };
  } catch {
    return null;
  }
}
async function getBytes(url, limit, fetcher, now) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetcher(url, {
      headers: { Accept: "text/csv,application/zip" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!res.ok) fail(`TAIFEX_HTTP_${res.status}`);
    if (!res.body) fail("TAIFEX_EMPTY_RESPONSE");
    const reader = res.body.getReader(), parts = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit) {
        await reader.cancel();
        fail("TAIFEX_RESPONSE_SIZE_LIMIT");
      }
      parts.push(r.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    return {
      bytes,
      receipt: {
        source_url: url,
        source_bytes: size,
        source_sha256: await sha(bytes),
        received_at: now(),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
export async function resolveTaifexRegularQuote(
  options,
  fetcher = fetch,
  now = () => new Date().toISOString(),
) {
  const observations = [];
  try {
    const c = context(options);
    const [daily, archive] = await Promise.all([
      getBytes(TAIFEX_DAILY_URL, 2 * 1024 * 1024, fetcher, now),
      getBytes(taifexArchiveUrl(c.prior), MAX_ZIP, fetcher, now),
    ]);
    const values = selectTaifexDaily(
      new TextDecoder("utf-8", { fatal: true }).decode(daily.bytes),
      c.prior,
      c.month,
    );
    const time = matchTaifexLastTrade(
      extractTaifexCsv(archive.bytes, c.prior),
      c.prior,
      c.month,
      values.price,
    );
    const payload = {
      type: TAIFEX_REGULAR_VERSION,
      exchange: "TAIFEX",
      product: "TX",
      symbol: `TX${c.month}`,
      date: c.prior,
      session: "regular",
      ...values,
      lastTrade: { price: values.price, time },
      total: { time },
      data: [daily.receipt, archive.receipt],
    };
    const quote = normalizeTaifexRegularPayload(payload, options);
    if (!quote) fail("TAIFEX_RECEIPT_OR_CONTRACT_INVALID");
    const response = { status: 200, payload, error: null };
    observations.push({
      endpoint: TAIFEX_DAILY_URL,
      provider: "taifex_open_data",
      ...response,
    });
    return { quote, endpoint: TAIFEX_DAILY_URL, response, observations };
  } catch (error) {
    const response = {
      status: null,
      payload: null,
      error: error instanceof Error ? error.message : "TAIFEX_SOURCE_FAILED",
    };
    observations.push({
      endpoint: TAIFEX_DAILY_URL,
      provider: "taifex_open_data",
      ...response,
    });
    return { quote: null, endpoint: TAIFEX_DAILY_URL, response, observations };
  }
}
