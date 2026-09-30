// Preserve the SDK and the business RPC result. Only bounded structured
// service-side error capsules are observed; headers/requests are never read.
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value==='object'&&!Array.isArray(value)?value as Row:{};
export function observeCriticalClientFactory<T extends (...args: never[]) => object>(factory: T): T {
  return new Proxy(factory, {
    apply(target,thisArg,args) {
      const client=Reflect.apply(target,thisArg,args);
      return new Proxy(client, {
        get(target,key,receiver) {
          const value=Reflect.get(target,key,receiver);
          if(key!=='rpc') return value;
          return (...rpcArgs: unknown[])=>{
            const request=Reflect.apply(value,target,rpcArgs);
            if(rpcArgs[0]!=='advance_trading_day_state_v1') return request;
            if(!request||typeof request!=='object') return request;
            return new Proxy(request, {
              get(request,key,receiver) {
                const property=Reflect.get(request,key,receiver);
                if(key!=='then') return property;
                return (resolve: (value: unknown)=>unknown,reject: (error: unknown)=>unknown)=>Reflect.apply(property,request,[
                  (result:unknown)=>{
                    try {
                      const details=object(object(result).error).details;
                      if(typeof details==='string'&&details.length<=1_048_576) {
                        const parsed=object(JSON.parse(details)),capsule=object(parsed.critical_contract_capsule);
                        if(parsed.stage==='LIFECYCLE'&&/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.business_date))&&
                          capsule.contract_version==='CRITICAL_CONTRACT_REPLAY_V1') {
                          const write=Promise.resolve(Reflect.apply(value,target,['record_critical_contract_evidence_v1',{
                            p_business_date:parsed.business_date,p_stage:'LIFECYCLE',p_capsule:capsule,
                          }])).catch(()=>undefined);
                          let timer:ReturnType<typeof setTimeout>|undefined;
                          const task=Promise.race([write,new Promise(resolve=>{timer=setTimeout(resolve,1500);})])
                            .finally(()=>{if(timer)clearTimeout(timer);});
                          const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(task:Promise<unknown>)=>void}}).EdgeRuntime;
                          if(runtime) runtime.waitUntil(task);
                        }
                      }
                    } catch { /* Observability cannot change the original error. */ }
                    return resolve(result);
                  },reject,
                ]);
              },
            });
          };
        },
      });
    },
  });
}
