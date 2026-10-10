import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('member selected and hovered candle buttons retain the light diagram text',()=>{
 const css=readFileSync(new URL('../src/pages/academy/member.css',import.meta.url),'utf8');
 assert.match(css,/\.academy-member \.academy-segments button:hover:not\(:disabled\)\{color:inherit\}/);
 const luminance=hex=>{
  const rgb=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
 };
 const shared=readFileSync(new URL('../src/pages/academy/academy.css',import.meta.url),'utf8');
 const text=shared.match(/\.academy-diagram\{[^}]*color:#([a-f0-9]{6})/)[1];
 const hover=shared.match(/\.academy-segments button:hover:not\(:disabled\)\{background:#([a-f0-9]{6})/)[1];
 assert.ok((luminance(text)+.05)/(luminance(hover)+.05)>=4.5,'active hover meets normal-text AA');
});
