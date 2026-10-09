// Test-only identity simulator. NEVER imported into the application router or auth.
let role = new URLSearchParams(window.location.search).get('role') || 'anonymous';
const allowed = () => ['owner', 'owner2', 'logout-race'].includes(role);
export const supabase = {
  auth: {
    async getUser() {
      return { data: { user: allowed() ? { id: role === 'owner2' ? 'synthetic-owner-2' : 'synthetic-owner-1' } : null }, error: null };
    },
    onAuthStateChange(listener: (event: string) => void) {
      const handle = (event: Event) => {
        const detail = (event as CustomEvent<string>).detail;
        if (detail === 'signed-out') { role = 'anonymous'; listener('SIGNED_OUT'); }
        if (detail === 'owner2') { role = 'owner2'; listener('SIGNED_IN'); }
        if (detail === 'refresh-denied') { role = 'admin'; listener('TOKEN_REFRESHED'); }
      };
      window.addEventListener('academy-synthetic-identity', handle);
      const timer = role === 'logout-race' ? setTimeout(() => { role = 'anonymous'; listener('SIGNED_OUT'); }, 10) : undefined;
      return { data: { subscription: { unsubscribe() { clearTimeout(timer); window.removeEventListener('academy-synthetic-identity', handle); } } } };
    },
  },
  async rpc(name: string) {
    if (name !== 'is_research_owner_v1') throw Error('UNEXPECTED_RPC');
    const permitted = allowed(), unavailable = role === 'unavailable';
    await new Promise(resolve => setTimeout(resolve, 80));
    return unavailable ? { data: null, error: { code: 'PGRST202' } } : { data: permitted, error: null };
  },
};
