// Isolated UI role fixture; NEVER an auth implementation. No Production SDK / credentials.
const mode = new URLSearchParams(location.search).get('mode') || 'owner';
export const supabase = {
  auth: { onAuthStateChange(listener: (event: string) => void) {
    const callback = () => listener('SIGNED_OUT'); window.addEventListener('synthetic-logout', callback);
    const timer = mode === 'logout-race' ? setTimeout(callback, 10) : undefined;
    return { data: { subscription: { unsubscribe() { clearTimeout(timer); window.removeEventListener('synthetic-logout', callback); } } } };
  } },
  async rpc(name: string) {
    if (!['get_owner_analysis_v1','get_research_foundation_v1'].includes(name)) throw Error('UNEXPECTED_RPC');
    await new Promise(resolve => setTimeout(resolve, 60));
    if(mode === 'unavailable') return { data: null, error: { code: 'PGRST202' } };
    if(!['owner','logout-race','empty'].includes(mode)) return { data: null, error: { code: '42501' } };
    if(name === 'get_research_foundation_v1') return { data: {schema_version:'RESEARCH_FOUNDATION_V1',mode:'SHADOW',production_eligible:false,features:[],method_versions:0,graphs:0,observations:0},error:null };
    const data = await (await fetch('/__phase2_fixture')).json();
    if(mode === 'empty') data.latest = null;
    return { data, error: null };
  },
};
