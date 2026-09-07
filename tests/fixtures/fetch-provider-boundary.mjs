// LOCAL ONLY. Vendor JSON and clock are controlled fixtures; Auth/DB/handler are real.
if (Deno.env.get('SUPABASE_URL') !== 'http://kong:8000') throw Error('Local isolated runtime required');
const realFetch = globalThis.fetch, RealDate = Date, realServe = Deno.serve;
let active = 0, activeNow = null;
Deno.serve = handler => realServe(async req => {
  const fixture = (await req.clone().json().catch(() => ({}))).__local_fixture || {};
  const now = RealDate.parse(fixture.now || '2026-09-07T09:30:00+08:00'), start = RealDate.now();
  if (active && activeNow !== now) throw Error('Concurrent local fixtures must use the same clock');
  activeNow = now; active++;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now + RealDate.now() - start])); }
    static now() { return now + RealDate.now() - start; }
  };
  const requests = [];
  globalThis.fetch = (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (u.origin === 'http://kong:8000') return realFetch(input, init);
    if (!['finnhub.io', 'api.fugle.tw', 'mis.twse.com.tw'].includes(u.hostname)) throw Error('External egress prohibited');
    requests.push({ host: u.hostname, path: u.pathname });
    const json = (body, status=200) => Promise.resolve(new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}}));
    if (u.hostname === 'mis.twse.com.tw') return json({msgArray:[]});
    if (u.pathname.endsWith('/tickers')) return fixture.missingTXF ? json({data:[]}) : json({data:[{symbol:'TXF202609',product:'TXF',deliveryDate:'2026-09-16',status:'active'}]});
    const symbol = u.hostname === 'finnhub.io' ? u.searchParams.get('symbol') : u.pathname.split('/').at(-1);
    if (fixture.missingTXF && String(symbol).startsWith('TXF')) return json({},404);
    const at = fixture.coreClose ? String(fixture.now).slice(0,10)+(String(symbol).startsWith('TXF')?'T13:45:00+08:00':'T13:30:00+08:00') : fixture.sourceAt || new RealDate(now).toISOString();
    const value = (['IX0001','TAIEX'].includes(symbol) ? 21200 : symbol === '2330' ? 1075 : String(symbol).startsWith('TXF') ? 21230 : symbol === 'VXX' ? 16 : 140)+(fixture.priceDelta||0);
    if (u.hostname === 'finnhub.io') return json({c:value,d:1,dp:1.2,h:value,l:value-1,o:value,pc:value-1,t:RealDate.parse(at)/1000});
    return json({price:value,change:fixture.missingPercent ? null : 1,changePercent:fixture.missingPercent ? null : 1.2,lastUpdated:at});
  };
  try {
    const response = await handler(req);
    const data = await response.json();
    return new Response(JSON.stringify({...data,__local_provider_requests:requests}),{status:response.status,headers:response.headers});
  } finally { if (--active === 0) { globalThis.fetch=realFetch; globalThis.Date=RealDate; activeNow=null; } }
});
