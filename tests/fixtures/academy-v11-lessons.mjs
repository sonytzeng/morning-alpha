// Synthetic contract content, NOT member teaching material or real Owner proof.
export const syntheticLessons=['stock-basics','candles','volume','support-basic','candles-basic','trend-basic','practice-basic','support-advanced','candles-advanced','trend-advanced'].map((id,i)=>({
 id,tier:i<7?'free':'premium',position:i+1,title:'隔離教材 '+id,
 content:{id,title:'隔離教材 '+id,goal:'合成測試，不代表正式教材。',paragraphs:['SYNTHETIC_CONTRACT_FIXTURE'],example:'合成',mistakes:['合成'],sourceNote:'SYNTHETIC',diagram:{kind:'candle',caption:'合成'},questions:[1,2].map((n)=>({id:id+'-q'+n,prompt:'合成題'+n,choices:['測試甲','測試乙'],correctIndex:n===1?1:0,explanation:'合成答案'}))}
}));
