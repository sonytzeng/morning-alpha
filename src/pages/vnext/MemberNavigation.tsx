import {useState} from 'react';
import {MEMBER_NAVIGATION,STOCK_OBSERVATION_NAV} from '@/features/vnext/member';
/** Single candidate navigation source for desktop, mobile and account. No
 * Production mount occurs until the UI release manifest is approved. */
export default function MemberNavigation(){
 const [open,setOpen]=useState(false);
 const links=MEMBER_NAVIGATION.map(link=><a key={link.to} href={link.to} aria-current={window.location.pathname===link.to?'page':undefined}>{link.label}</a>);
 return <header className="vm-header"><a className="vm-brand" href="/stocks">Morning Alpha</a><nav className="vm-desktop" aria-label="會員主選單">{links}</nav>
  <button className="vm-menu" aria-expanded={open} aria-controls="vm-mobile-menu" onClick={()=>setOpen(!open)}>{open?'關閉選單':'開啟選單'}</button>
  {open&&<nav id="vm-mobile-menu" className="vm-mobile" aria-label="手機會員選單">{links}</nav>}</header>;
}
export function MemberObservationEntry(){return <section className="vnext-card"><h2>{STOCK_OBSERVATION_NAV.label}</h2><p>依短、中、長期整理觀察理由、確認條件與風險。研究觀察不是正式推薦。</p><a className="vnext-primary" href={STOCK_OBSERVATION_NAV.to}>查看股票觀察</a></section>;}
