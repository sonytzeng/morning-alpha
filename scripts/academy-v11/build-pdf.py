"""Original member textbook renderer. Never reads Owner handout/materials.
Usage: python build-pdf.py original-course.json output-directory
"""
import json, sys
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader

course=json.loads(Path(sys.argv[1]).read_text()); out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
font='/System/Library/Fonts/STHeiti Light.ttc'
pdfmetrics.registerFont(TTFont('CJK',font,subfontIndex=0))
pdfmetrics.registerFont(TTFont('CJKB','/System/Library/Fonts/STHeiti Medium.ttc',subfontIndex=0))
W,H=A4; navy=HexColor('#142c40'); teal=HexColor('#007a78'); issues=[]; qa={}
for edition in ['free','premium']:
 lessons=[r for r in course if edition=='premium' or r['tier']=='free']
 path=out/f'Morning_Alpha_Academy_{edition}_V11.pdf'
 c=canvas.Canvas(str(path),pagesize=A4,invariant=1); c.setTitle('Morning Alpha 原創股票學院 — '+('免費入門版' if edition=='free' else '完整教學版')); c.setAuthor('Morning Alpha')
 page=0; y=0
 def text(s,x,yy,size=11,bold=False):
  c.setFont('CJKB' if bold else 'CJK',size);c.setFillColor(navy);c.drawString(x,yy,s)
 def new(title):
  global page,y
  if page:c.showPage()
  page+=1;c.setFillColor(teal);c.rect(42,H-43,28,4,fill=1,stroke=0)
  text('MORNING ALPHA / 原創會員教材',82,H-43,9)
  text(title,42,H-83,17,True);y=H-109
  text('通用教學 · 圖形為教學假設 · 非投資建議 · 非老師原講義',42,27,8);text(str(page),W-58,27,9)
 def para(s,size=11,gap=12):
  global y
  p=Paragraph(escape(s),ParagraphStyle('p',fontName='CJK',fontSize=size,leading=size*1.65,textColor=navy,wordWrap='CJK'))
  _,h=p.wrap(W-84,H);p.drawOn(c,42,y-h);y-=h+gap
  if y<55:issues.append([edition,page,round(y,1)])
 def diagram(d):
  global y
  kind=d['kind']
  base=y-135;c.setFillColor(HexColor('#eff5f5'));c.roundRect(42,base,W-84,126,8,fill=1,stroke=0)
  vals=[100,102,98,101,106,103,108];scale=6;left=75
  if kind=='candle':
   bars=[(r['open'],r['high'],r['low'],r['close']) for r in d['candles']] if 'candles' in d else [(100,108,97,104),(104,107,98,100),(100,105,98,100)]
   for i,(o,hi,lo,cl) in enumerate(bars):
    x=left+i*(420/max(1,len(bars)-1));col=HexColor('#b64042') if cl>o else teal;c.setStrokeColor(col);c.setFillColor(col);c.line(x,base+18+(lo-97)*scale,x,base+18+(hi-97)*scale);c.rect(x-12,base+18+(min(o,cl)-97)*scale,24,max(1,abs(cl-o)*scale),fill=1,stroke=0)
    text(d.get('labels',['收高於開','收低於開','開收接近'])[i],x-25,base+7,9)
  else:
   pts=[(left+i*62,base+23+(v-97)*6) for i,v in enumerate(vals)]
   c.setStrokeColor(teal);c.setLineWidth(2)
   for a,b in zip(pts,pts[1:]):c.line(*a,*b)
   if kind=='zones':
    c.setStrokeColor(HexColor('#9b4c18'));c.line(60,base+35,W-65,base+35);text('觀察區，不保證守住',65,base+104,9)
   if kind=='volume':
    for i,h in enumerate([12,18,24,33,20,30,39]):c.setFillColor(teal);c.rect(left+i*62-5,base+10,10,h,fill=1,stroke=0)
  y=base-15
 new('先理解，再練習；不急著做決定')
 para('免費入門版' if edition=='free' else '完整原創教學版',18)
 para('這份教材從股票與 K 線基本概念開始，以原創圖形和假設案例練習觀察。它沒有引用或重製私人講義圖像，也不提供 Signal Lab 未驗證策略。')
 para('課程完成、答對題目或看懂圖形，都不代表已證明投資能力。圖中數字不是歷史績效；請勿直接用作買賣建議。')
 for i,r in enumerate(lessons):para(f'{i+1:02d}　{r["title"]}',10,8)
 for r in lessons:
  l=r['content'];new(l['title']);diagram(l['diagram'])
  for s in l['paragraphs']:para(s,10.8,10)
  para('假設案例：'+l['example'],10.5)
  new('練習與答案｜'+l['title'].split('：')[0])
  para('先自行作答，再看解析。紙本練習不會替你寫入網站學習進度。')
  for i,q in enumerate(l['questions']):
   para(f'{i+1}. '+q['prompt'],11)
   for j,v in enumerate(q['choices']):para(f'　{chr(65+j)}　{v}',10,4)
   para('答案：'+chr(65+q['correctIndex'])+'。'+q['explanation'],10,16)
  for m in l['mistakes']:para('提醒：'+m,10)
 c.save(); reader=PdfReader(path); extracted=''.join(p.extract_text() or '' for p in reader.pages)
 qa[edition]={'pages':len(reader.pages),'chapters':len(lessons),'questions':sum(len(r['content']['questions']) for r in lessons),'replacement_characters':extracted.count('\ufffd'),'han_characters':sum('\u4e00'<=x<='\u9fff' for x in extracted),'overflow':[x for x in issues if x[0]==edition]}
 assert not qa[edition]['replacement_characters'] and not qa[edition]['overflow'] and qa[edition]['han_characters']>1500
(out/'qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2))
print(json.dumps(qa,ensure_ascii=False))
