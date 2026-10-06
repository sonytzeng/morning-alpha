// Override binding only: real entrypoint, validator and HTTP Request semantics.
const serve=Deno.serve;
Deno.serve=((handler: Deno.ServeHandler) => serve({hostname:'127.0.0.1',port:0,
  onListen:({port})=>console.log(JSON.stringify({port}))},handler)) as typeof Deno.serve;
await import('../../supabase/functions/research-analysis-shadow-v1/index.ts');
