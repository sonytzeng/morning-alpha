"""Offline, reproducible analysis of a sealed 72-stock packet set.

No network, models, database access, approval flags or publication mutations.
New quotes are a separately dated observation, never a replacement for old bars.
Price equations retain ENTRY_OPPORTUNITY_1.0.0 hypotheses; no backtest is implied.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

D = lambda x: Decimal(str(x))
mean = lambda xs: sum(xs, D(0)) / len(xs)
sha = lambda b: hashlib.sha256(b).hexdigest()
FINANCIALS = {'2881', '2882', '2884', '2885', '2886', '2891', '2892'}
STRATEGIES = ('OVERSOLD_REVERSAL', 'PULLBACK_ENTRY', 'BREAKOUT_CONTINUATION')
LABELS = dict(zip(STRATEGIES, ('超跌反轉', '趨勢回檔', '突破延續')))

def number(x):
    s = str(x).replace(',', '').strip()
    n = D(s)
    if not n.is_finite():
        raise ValueError('NON_FINITE_NUMBER')
    return n

def stamp(x):
    return datetime.fromisoformat(x.replace('Z', '+00:00'))

def tick(price):
    p = D(price)
    if not p.is_finite() or p <= 0:
        raise ValueError('INVALID_PRICE')
    return next(t for ceiling, t in [(10,D('.01')),(50,D('.05')),(100,D('.1')),
            (500,D('.5')),(1000,D(1)),(D('Infinity'),D(5))] if p < ceiling)

def floor_tick(price):
    p = D(price)
    return (p/tick(p)).to_integral_value(rounding=ROUND_FLOOR)*tick(p)

def next_tick(price):
    p = D(price)
    f = floor_tick(p)
    return f + tick(f)

def metrics(bars):
    if len(bars) != 20 or len({b['date'] for b in bars}) != 20:
        raise ValueError('EXACT_TWENTY_SESSIONS_REQUIRED')
    if [b['date'] for b in bars] != sorted(b['date'] for b in bars):
        raise ValueError('UNSORTED_SESSIONS')
    for b in bars:
        if any(not D(b[k]).is_finite() or D(b[k]) <= 0 for k in ('open','high','low','close','volume','amount')):
            raise ValueError('INVALID_OHLCV')
        if b['high'] < max(b['open'],b['close']) or b['low'] > min(b['open'],b['close']):
            raise ValueError('INVALID_OHLC_RANGE')
    prior, last, recent = bars[:-1], bars[-1], bars[-5:]
    atr = mean([max(b['high']-b['low'],abs(b['high']-a['close']),abs(b['low']-a['close'])) for a,b in zip(bars,bars[1:])])
    if atr <= 0:
        raise ValueError('ZERO_TRUE_RANGE')
    m = {'atr19': atr, 'sma5': mean([b['close'] for b in recent]),
         'sma10': mean([b['close'] for b in bars[-10:]]), 'sma20': mean([b['close'] for b in bars]),
         'support5': min(b['low'] for b in recent), 'resistance19': max(b['high'] for b in prior),
         'prior_low19': min(b['low'] for b in prior), 'volume_ratio':last['volume']/mean([b['volume'] for b in prior]),
         'amount_ratio':last['amount']/mean([b['amount'] for b in prior]), 'average_amount20':mean([b['amount'] for b in bars]),
         'close_location':(last['close']-last['low'])/(last['high']-last['low']) if last['high']>last['low'] else D(0),
         'intraday_range':(last['high']-last['low'])/last['open'], 'raw_price_return':last['close']/bars[0]['close']-1}
    m['extension_atr']=(last['close']-m['sma5'])/atr
    m['drawdown_atr']=(max(b['high'] for b in bars)-last['close'])/atr
    sell=lambda xs:sum((b['volume'] for b in xs if b['close']<b['open']),D(0))
    m['pressure_easing']=sell(bars[-3:])<sell(bars[-6:-3])
    return m

def scenarios(bars, revenue, relative, sector, exchange):
    m=metrics(bars); last, prev=bars[-1],bars[-2]; out=[]
    for strategy in STRATEGIES:
        trigger=last['close'] if strategy=='BREAKOUT_CONTINUATION' else last['high']
        upper=trigger+m['atr19']*D('.25')
        stop=m['resistance19']-m['atr19'] if strategy=='BREAKOUT_CONTINUATION' else m['support5']
        target=2*m['resistance19']-m['prior_low19'] if strategy=='BREAKOUT_CONTINUATION' else m['resistance19']
        raw_cost=upper*D('.00785');raw_risk=upper-stop+raw_cost;raw_reward=target-upper-raw_cost
        raw_geometry=0<stop<trigger and target>upper and raw_risk>0
        raw_rr=raw_reward/raw_risk if raw_risk>0 else None
        raw_risk_fraction=raw_risk/upper
        # Official TWSE tick mapping. TPEx numeric inputs stay raw in this audit.
        lower=next_tick(trigger) if exchange=='TWSE' else trigger
        if exchange=='TWSE' and stop>0:
            upper,stop,target=floor_tick(upper),floor_tick(stop),floor_tick(target)
        cost=upper*D('.00785');risk=upper-stop+cost;reward=target-upper-cost
        geometry=raw_geometry and lower<=upper and 0<stop<lower and target>upper and risk>0
        rr=reward/risk if risk>0 else None
        failed=[]
        if not geometry: failed.append('價格順序或區間不成立')
        if raw_rr is None or raw_rr<2 or rr is None or rr<2:failed.append('費後報酬風險比低於2')
        if raw_risk_fraction>D('.08') or risk/upper>D('.08'):failed.append('含成本風險距離超過8%')
        if m['average_amount20']<50_000_000:failed.append('平均成交額低於5000萬元')
        if m['extension_atr']>2:failed.append('偏離五日均價超過2ATR')
        if revenue['yoy_percent']<0 or revenue['mom_percent']<0:failed.append('最新營收年增或月增為負')
        if strategy=='BREAKOUT_CONTINUATION':
            if last['close']<=m['resistance19']:failed.append('收盤未突破前十九日高點')
            if m['volume_ratio']<D('1.5'):failed.append('量比不足1.5')
            if sector is None:failed.append('原產業不足三家可比同業')
            elif relative<0 or sector<0:failed.append('相對大盤或原產業表現未支持')
            if last['high']>m['resistance19'] and last['close']<=m['resistance19']:failed.append('盤中突破後收回壓力下')
        elif strategy=='PULLBACK_ENTRY':
            if m['sma10']<=m['sma20']:failed.append('十日均價未高於二十日均價')
            if last['close']-m['support5']>m['atr19'] or last['close']<m['sma20']:failed.append('尚未符合回檔支撐位置')
            if not(last['volume']<mean([b['volume'] for b in bars[-6:-1]]) and last['close']>prev['close']):failed.append('未同時量縮與收盤回升')
            if relative<0:failed.append('同期弱於大盤')
        else:
            if m['drawdown_atr']<2 or last['close']-m['support5']>m['atr19']:failed.append('超跌幅度或支撐位置不符')
            if not m['pressure_easing']:failed.append('下跌日成交量未減弱')
            if not(last['close']>prev['high'] and last['close']>last['open']):failed.append('未收復前日高點確認反轉')
        out.append({'strategy':strategy,'label':LABELS[strategy],'numeric_conditions_met':not failed,
                    'failed':failed,'geometry_valid':geometry,'historical_range':[lower,upper] if geometry else None,
                    'historical_wait_above':upper if geometry else None,'historical_stop':stop if geometry else None,
                    'target_scenario':target if geometry else None,'net_reward_risk':rr,'risk_fraction':risk/upper,
                    'raw_net_reward_risk':raw_rr,'raw_risk_fraction':raw_risk_fraction,
                    'tick_basis':'TWSE_RULE_62' if exchange=='TWSE' else 'RAW_FORMULA_NOT_ORDER_PRICE',
                    'actionable':False,'method_validated':False})
    return m,out

def quarterly_eps(facts):
    rows=sorted([f for f in facts if f['kind']=='EPS' and f['basis']=='SINGLE_QUARTER'],key=lambda f:f['period'])[-4:]
    valid=len(rows)==4 and len({f['values'].get('measurement_basis') for f in rows})==1
    indices=[int(f['period'][:4])*4+int(f['period'][-1]) for f in rows]
    valid=valid and all(b-a==1 for a,b in zip(indices,indices[1:]))
    valid=valid and all(f['values'].get('unit')=='TWD_PER_COMMON_SHARE' and
                       f['values'].get('measurement_basis') in ('BASIC','DILUTED') for f in rows)
    return rows,sum((D(f['values']['value']) for f in rows),D(0)) if valid else None

def parse_latest_quotes(root, symbols):
    r=json.loads((root/'twse_quotes.receipt.json').read_text());raw=(root/'twse_quotes.json').read_bytes()
    if sha(raw)!=r['sha256'] or len(raw)!=r['bytes'] or r['http_status']!=200:raise ValueError('QUOTE_RECEIPT_MISMATCH')
    p=json.loads(raw)
    if p.get('stat')!='OK' or p.get('date')!='20261102':raise ValueError('QUOTE_DATE')
    t=next(t for t in p['tables'] if '證券代號' in t.get('fields',[])); out={}
    for cells in t['data']:
        row=dict(zip(t['fields'],cells));s=row['證券代號']
        if s in symbols:
            if s in out:raise ValueError('DUPLICATE_QUOTE')
            out[s]={'date':'2026-11-02','close':number(row['收盤價']),'open':number(row['開盤價']),
                    'high':number(row['最高價']),'low':number(row['最低價']),
                    'source':r['url'],'received_at':r['received_at'],'raw_sha256':r['sha256'],
                    'scope':'SEPARATE_CLOSE_OBSERVATION_NOT_MERGED_INTO_RETAINED_BARS'}
    return out

def serial(x):
    if isinstance(x,Decimal):return float(x)
    raise TypeError(type(x).__name__)

def fmt(x,digits=2):
    return '未提供' if x is None else f'{x:,.{digits}f}'

def build(batch, draft, sectors, companies, benchmark, latest, evaluated_at):
    packets={s:json.loads(t) for s,t in batch['packet_texts'].items()}
    if len(packets)!=72 or len(draft['cards'])!=216:raise ValueError('ORIGINAL_UNIVERSE_REQUIRED')
    if stamp(evaluated_at)<stamp(batch['cutoff']):raise ValueError('EVALUATION_BEFORE_SOURCE')
    if any(stamp(q['received_at'])>stamp(evaluated_at) for q in latest.values()):raise ValueError('FUTURE_QUOTE')
    cards={(c['symbol'],c['horizon']):c for c in draft['cards']}
    bars={s:sorted([{**json.loads(e['content'],parse_float=Decimal,parse_int=Decimal),'source_ref':e['id']} for e in p['evidence'] if e['kind']=='PRICE'],key=lambda b:b['date']) for s,p in packets.items()}
    for s,p in packets.items():
        if p['symbol']!=s or p['data_through']!=batch['through'] or stamp(p['cutoff'])!=stamp(batch['cutoff']):raise ValueError('PACKET_BINDING')
        if [b['date'] for b in bars[s]]!=[b['date'] for b in benchmark]:raise ValueError('BENCHMARK_DATE_ALIGNMENT')
    bm_return=benchmark[-1]['close']/benchmark[0]['close']-1
    sector={c['symbol']:c['sector'] for c in sectors};exchange={c['symbol']:c['exchange'] for c in companies}
    returns={s:bs[-1]['close']/bs[0]['close']-1 for s,bs in bars.items()};result=[]
    for s,p in packets.items():
        facts=[{**json.loads(e['content'],parse_float=Decimal,parse_int=Decimal),'evidence':e} for e in p['evidence'] if e['kind']=='FINANCIAL']
        revenues=sorted([f for f in facts if f['kind']=='REVENUE' and f['basis']=='MONTHLY'],key=lambda f:f['period'])[-3:]
        inst=sorted([f for f in facts if f['kind']=='INSTITUTIONAL' and f['basis']=='SHARES'],key=lambda f:f['period'])[-10:]
        if len(revenues)!=3 or len(inst)!=10 or [f['period'] for f in inst]!=[b['date'] for b in benchmark[-10:]]:raise ValueError('MEDIUM_COVERAGE')
        for f in revenues:
            v=f['values']
            for prior,key in [('prior_year_thousand_twd','yoy_percent'),('prior_month_thousand_twd','mom_percent')]:
                if abs((D(v['revenue_thousand_twd'])/D(v[prior])-1)*100-D(v[key]))>D('0.03'):raise ValueError('REVENUE_ARITHMETIC')
        peers=[q for q in packets if q!=s and sector[q]==sector[s]]
        rel=returns[s]-bm_return;peer=mean([returns[q] for q in peers]) if len(peers)>=3 else None
        m,plans=scenarios(bars[s],revenues[-1]['values'],rel,peer,exchange[s])
        net=sum((f['values']['net_shares'] for f in inst),D(0));tail=sum((f['values']['net_shares'] for f in inst[-2:]),D(0))
        positive=all(f['values']['yoy_percent']>0 for f in revenues)
        medium='營收與最近買盤同向' if positive and net>0 and tail>0 else '累計買超但最近轉賣' if positive and net>0 else '尚未同時支持營收與法人假設'
        eps,ttm=quarterly_eps(facts)
        old_close=bars[s][-1]['close'];q=latest.get(s);raw_pe=old_close/ttm if ttm and ttm>0 else None
        long_extra=''
        if ttm:
            long_extra=f'已核四季每股盈餘合計 {fmt(ttm)} 元，10/30價格除以此合計為 {fmt(raw_pe)} 倍；不等於正常化獲利或合理本益比。'
        if s=='2303':long_extra+=' Q2 EPS占四季合計'+fmt(D(eps[2]['values']['value'])/ttm*100)+'%；既有原報另顯示Q2投資收益偏高，不能將這部分年化。'
        if s=='3006':long_extra+=' 最新一季EPS占四季合計'+fmt(D(eps[-1]['values']['value'])/ttm*100)+'%；低靜態倍數可能高度依賴最近獲利，須辨別能否持續。原封包的法說預告不得充當已發表結果。'
        if s=='2454':long_extra+=' 四季EPS回升本身不證明目前價格便宜；仍缺可核對的合理倍數、投入資本與需求假設。'
        if s=='3711':long_extra+=' 採封包最新比較口徑；設備支出不能自動當成全部現金資本支出。'
        if s=='2379':long_extra='只有三個已核季度且缺2025Q4，不能把缺季補零或把累計EPS差分湊成TTM。'
        if s in FINANCIALS:long_extra='金融股應核對資本適足、淨值與獲利來源；不套用工業公司的毛利率／資本支出份數作買進依據。'
        news=[]
        for e in p['evidence']:
            if e['kind']!='NEWS':continue
            v=json.loads(e['content']);o=v.get('original_content',{})
            if o.get('summary'):news.append({'summary':o['summary'],'limitations':o.get('limitations'),'source':e['source'],'available_at':e['available_at']})
        result.append({'symbol':s,'company':p['company'],'sector':sector[s],'exchange':exchange[s],
          'historical_close':old_close,'data_through':batch['through'],'latest_quote':q,
          'change_since_retained_close_pct':(q['close']/old_close-1)*100 if q else None,
          'short':{'original_status':cards[s,'SHORT']['status'],'metrics':m,'relative_strength':rel,'sector_return':peer,
                   'peer_symbols':peers,'scenarios':plans,'approved_entry_range':None,'approved_stop':None},
          'medium':{'original_status':cards[s,'MEDIUM']['status'],'diagnostic':medium,
                    'revenues':[{k:f[k] for k in ['period','values']} for f in revenues],
                    'institutional_through':inst[-1]['period'],'net_shares10':net,'net_shares2':tail,
                    'foreign_shares10':sum((f['values']['foreign_net_shares'] for f in inst),D(0)),
                    'trust_shares10':sum((f['values']['trust_net_shares'] for f in inst),D(0)),
                    'flows_are_currency':False,'derived_price_range':None},
          'long':{'original_status':cards[s,'LONG']['status'],'eps_ttm':ttm,'reported_eps_multiple_at_old_close':raw_pe,
                  'analysis':long_extra,'original_analysis':cards[s,'LONG']['reason']['text'],
                  'approved_entry_range':None,'original_gaps':cards[s,'LONG']['gaps']},
          'news':news,'sources':list(dict.fromkeys(
              [e['source'] for e in p['evidence'] if e['kind']=='PRICE']+
              [f['evidence']['source'] for f in revenues+inst+eps]+
              [e['source'] for h in ('SHORT','MEDIUM','LONG') for e in cards[s,h]['sources']]+
              ([q['source']] if q else []))), 'publication_ready':False})
    return {'schema':'RETAINED_STOCK_ANALYTICAL_AUDIT_V1','evaluated_at':evaluated_at,'retained_cutoff':batch['cutoff'],
            'retained_through':batch['through'],'original_snapshot_expiry':draft['expires_at'],
            'original_snapshot_expired':stamp(evaluated_at)>=stamp(draft['expires_at']),
            'model_calls':0,'production_writes':0,'member_published':False,'new_price_plans':0,
            'new_quote_scope':'Separate observations; historical analysis and expiry are unchanged.',
            'rows':result,'counts':{'stocks':len(result),'horizon_reviews':len(result)*3,'price_equations':len(result)*3,
                 'new_listed_quotes':len(latest),'historical_numeric_setups':sum(x['numeric_conditions_met'] for r in result for x in r['short']['scenarios']),
                 'medium_recent_selling':sum(r['medium']['diagnostic']=='累計買超但最近轉賣' for r in result),
                 'comparable_ttm':sum(r['long']['eps_ttm'] is not None for r in result)}}

def render(report):
    rows=report['rows']; taipei=stamp(report['evaluated_at']).astimezone(ZoneInfo('Asia/Taipei'))
    source_urls=list(dict.fromkeys(u for r in rows for u in r['sources']))
    source_ids={u:f'S{i+1:03}' for i,u in enumerate(source_urls)}
    lines=['# Morning Alpha｜72檔短、中、長期分析核對',
        '',f"分析時間：{taipei:%Y/%m/%d %H:%M:%S}（台北）；各段使用日期如下。",'',
        '**此版完成逐檔分析核對，尚未完成正式會員推薦發布。有效買進價／停損價均未核准。**',
        '全72檔採同一組2026/9/30–10/30的20個交易日作橫向比較；營收為7–9月，法人為10/15–10/30的10個交易日。日期對齊，但上市／上櫃成交統計涵蓋範圍不同，不直接比較兩市場的絕對成交量大小。',
        '11/2新收盤價另列；不與上櫃舊價混算同期排名。11/2法人及上櫃同口徑盤後資料取得時為空，未補零。',
        '上午216卡已於11/2 13:30到期；本報告保留歷史判斷並新增差異分析，不延長舊買進條件。',
        '', '## 先看研究結論', '',
        '短期依既有三個策略逐一檢查價量、成本、風險距離、營收及同期間相對表現；符合數值條件仍須事件、企業行動與方法審查。',
        '中期加上最近兩個觀察日的法人方向，辨別十日累計買超是否已轉弱；這是新增反證，不修改舊篩選門檻。',
        '長期只對四個連續季度且EPS口徑一致者計算TTM；缺季、基本／稀釋混用或未證明單季的資料不加總。',
        '本輪發現7檔中期原觀察股的最近兩日合計轉賣：'+ '、'.join(r['symbol']+' '+r['company'] for r in rows if r['medium']['diagnostic']=='累計買超但最近轉賣')+'。',
        '', '| 股票 | 10/30收盤 | 11/2收盤 | 短期原觀察 | 中期新增判讀 | 長期原狀態 |',
        '|---|---:|---:|---|---|---|']
    zh={'WATCH':'觀察','WAIT':'等待','INSUFFICIENT':'資料不足','AVOID':'避開'}
    for r in rows:lines.append(f"| {r['symbol']} {r['company']} | {fmt(r['historical_close'])} | {fmt(r['latest_quote']['close']) if r['latest_quote'] else '未取得'} | {zh[r['short']['original_status']]} | {r['medium']['diagnostic']} | {zh[r['long']['original_status']]} |")
    lines+=['','## 價格計算與使用邊界','',
        '下列短期價格全部綁定10/30資料，原觀察日為11/2，現已到期。列出是為了核對推導與今日差異，不能作為11/3下單方案。中、長期不能借用短線價位冒充合理價。',
        'ATR在此沿用原程式：20日資料中的19個True Range之算術平均，並非Wilder ATR14。成本沿用買賣手續費各0.1425%、賣出稅0.3%、雙邊滑價各0.1%，合計按區間上界估0.785%；非保證成交成本。',
        '突破情境目標為「前十九日高點＋前十九日區間高度」；另兩策略目標為已觀察壓力。這些是技術情境，不是公司合理價或保證報酬。台灣上市股票使用第62條tick；上櫃僅保留原始公式輸出，未當成下單價。',
        '費後RR至少2、風險距離不超過8%、平均成交額至少5000萬元、追價偏離不超過2ATR等均為既有研究假設；未完成回測校準，不提供成功率。',
        '', '## 逐檔三期間分析']
    for r in rows:
        sh,me,lo=r['short'],r['medium'],r['long'];m=sh['metrics'];rev=me['revenues'][-1]
        lines+=['',f"### {r['symbol']} {r['company']}｜{r['sector']}", '',
            f"**價格日期：**10/30收盤 {fmt(r['historical_close'])} 元。"+(f"11/2官方收盤 {fmt(r['latest_quote']['close'])} 元，對前收 {fmt(r['change_since_retained_close_pct'])}%。" if r['latest_quote'] else '11/2同口徑新收盤未取得。'),
            '',f"**短期：**原狀態「{zh[sh['original_status']]}」。成交額／前19日均額 {fmt(m['amount_ratio'])} 倍；成交股數量比 {fmt(m['volume_ratio'])} 倍；收盤位於當日區間 {fmt(m['close_location']*100)}%；區間內原始價格表現相對大盤 {fmt(sh['relative_strength']*100)} 個百分點。",
            f"五日低點 {fmt(m['support5'])}、前十九日高點 {fmt(m['resistance19'])}、ATR19 {fmt(m['atr19'])}；未完成企業行動調整，不能把原始低點當成已驗證支撐。",
            '| 歷史情境 | 已到期條件區間 | 不追上界 | 停損觸發參考 | 費後RR | 未成立原因 |',
            '|---|---:|---:|---:|---:|---|']
        for plan in sh['scenarios']:
            ran=plan['historical_range'];status='數值符合；仍缺事件／方法審查，且已到期' if not plan['failed'] else '、'.join(plan['failed'])
            lines.append(f"| {plan['label']} | {fmt(ran[0])+'–'+fmt(ran[1]) if ran else '不成立'} | {fmt(plan['historical_wait_above'])} | {fmt(plan['historical_stop'])} | {fmt(plan['net_reward_risk'])} | {status} |")
        if r['latest_quote']:
            valid=[p for p in sh['scenarios'] if p['numeric_conditions_met'] and p['historical_range']]
            for p in valid:
                c=r['latest_quote']['close'];text='已超過舊不追上界，不能沿用追價' if c>p['historical_wait_above'] else '已低於舊停損參考，原假設失效' if c<=p['historical_stop'] else '未超過舊上界，但舊方案已到期，仍須新一版檢查'
                lines.append(f"11/2收盤相對「{p['label']}」舊計畫：{text}。日線OHLC不能證明盤中進場與停損先後，不計算交易績效。")
        lines+=['',f"**中期：{me['diagnostic']}。**7–9月營收年增分別為 "+'／'.join(fmt(f['values']['yoy_percent'])+'%' for f in me['revenues'])+f"；9月月增 {fmt(rev['values']['mom_percent'])}%。",
            f"截至10/30，10日三大法人合計 {fmt(me['net_shares10'],0)} 股，最近2日合計 {fmt(me['net_shares2'],0)} 股；外資10日 {fmt(me['foreign_shares10'],0)} 股、投信10日 {fmt(me['trust_shares10'],0)} 股。這些是股數，不是金額。",
            '分析：'+('長段累計仍正，但最近兩日反向，追蹤優先度應下降；不能只用十日買超寫成資金持續流入。' if me['diagnostic']=='累計買超但最近轉賣' else '營收與兩種法人觀察長度同向，可以保留研究；未證明新訂單、終端客戶或未來獲利。' if me['diagnostic']=='營收與最近買盤同向' else '目前營收與法人方向未同時滿足既有假設，需等後續實績與買盤重新支持。'),
            '確認／停止：下一次營收及完整法人區間續強才重評；營收轉弱或買盤反向則停止沿用。中期合理價尚未建立，不填入短線價格充數。',
            '',f"**長期：{zh[lo['original_status']]}。** {lo['analysis']}",lo['original_analysis'],
            '確認／停止：以可比較的單季獲利、現金投資支出、需求、競爭優勢及估值共同檢查。合理價或投入資本證據不足時保留缺口；不以官方靜態本益比當成合理買價。',
            '']
        if r.get('supplemental_long_review'):
            supplement=r['supplemental_long_review']
            lines+=['','**本輪長期補充判讀（獨立於上午封包，不回填舊審查）：**',supplement['analysis'],
                    '來源：'+'；'.join(supplement['sources'])]
        lines+=['', '**公司事件：**']
        if r['news']:
            for n in r['news']:lines.append(f"- {n['summary']} {n.get('limitations') or ''}（原觀測 {n['available_at']}；[來源]({n['source']})）")
        else:lines.append('本批沒有足以寫成公司利多的新事件證據；不以無命中宣稱沒有消息或風險。')
        lines+=['','**查核來源：** '+ '、'.join(f"[{source_ids[u]}](#{source_ids[u].lower()})" for u in r['sources'])]
    lines+=['','## 來源索引','', '每檔股票的引用代號對應下列原始網址；完整原件雜湊、收到時間與數值對照另保留於分析資料。']
    for u,i in source_ids.items():lines+=['',f'### {i}','',u]
    return '\n'.join(lines)+'\n'

def main():
    p=argparse.ArgumentParser();p.add_argument('--archive',type=Path,required=True);p.add_argument('--sources',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--supplements',type=Path);a=p.parse_args()
    base=a.archive/'continuation-20261102/work';old=a.archive/'zero-cost-continuation-20261101/work'
    batch=json.loads((base/'draft-revision3/exact-batch.payload-text').read_text());draft=json.loads((base/'draft-revision3/offline-draft-216.private.json').read_text())
    sectors=json.loads((base/'prices/retained-canonical-context.json').read_text())['canonical_sectors']
    companies=json.loads((old/'official-coverage/institutional/companies.json').read_text())
    benchmark=[{**b,'close':D(b['close'])} for b in json.loads((base/'prices/price-prerequisite-audit.private.json').read_text())['benchmark']]
    latest=parse_latest_quotes(a.sources,set(batch['packet_texts']));now=datetime.now(timezone.utc).isoformat()
    report=build(batch,draft,sectors,companies,benchmark,latest,now)
    if a.supplements:
        extra=json.loads(a.supplements.read_text())
        if stamp(extra['reviewed_at'])>stamp(now):raise ValueError('FUTURE_SUPPLEMENT')
        for row in report['rows']:
            if row['symbol'] in extra['stocks']:row['supplemental_long_review']=extra['stocks'][row['symbol']]
        report['supplement_hash']=sha(a.supplements.read_bytes())
    report['input_hashes']={str(f.relative_to(a.archive)):sha(f.read_bytes()) for f in [base/'draft-revision3/exact-batch.payload-text',base/'draft-revision3/offline-draft-216.private.json']}
    a.output.mkdir(parents=True,exist_ok=True)
    (a.output/'research-audit.private.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=serial))
    (a.output/'Morning_Alpha_72_Stock_Analysis_20261102.md').write_text(render(report))
    print(json.dumps(report['counts']))

if __name__=='__main__':main()
