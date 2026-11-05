CREATE OR REPLACE FUNCTION public.dispatch_daily_stock_ai_batch_v1(p_batch_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare token text;request bigint;
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' then raise exception 'AI_DISPATCH_SCOPE';end if;
 perform 1 from vnext_runtime.ai_stock_batches where id=p_batch_id for update;
 if not found then raise exception 'AI_DISPATCH_BATCH_MISSING';end if;
 if (select count(*) from vnext_runtime.ai_stock_dispatches where batch_id=p_batch_id)>=216 then
  return jsonb_build_object('state','DISPATCH_BUDGET_EXHAUSTED');end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
 if token is null or length(token)<24 or length(token)>512 then raise exception 'AI_DISPATCH_CREDENTIAL_UNAVAILABLE';end if;
 select net.http_post(url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',
  headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',token),
  body:=jsonb_build_object('batch_id',p_batch_id),timeout_milliseconds:=60000) into request;
 insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) values(request,p_batch_id);
 return jsonb_build_object('state','DISPATCHED','request_id',request,'batch_id',p_batch_id,'member_published',false);
end $function$
