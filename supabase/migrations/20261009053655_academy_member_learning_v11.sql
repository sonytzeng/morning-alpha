-- Academy V1.1 candidate ONLY. No production apply, no changes to existing RLS.
begin;
create schema academy_private;
revoke all on schema academy_private from public,anon,authenticated,service_role;
grant usage on schema academy_private to authenticated;

-- Read-only projection of the existing member-entitlement.ts contract. No new
-- entitlement grants, billing changes, metadata trust, or profile writes.
create function academy_private.access_v11() returns text
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype; e public.member_entitlements%rowtype; ending timestamptz;
begin
 if auth.uid() is null or not exists(select from auth.users u where u.id=auth.uid() and not coalesce(u.is_anonymous,false)) then return 'denied'; end if;
 if public.is_research_owner_v1() then return 'owner'; end if;
 select * into p from public.profiles where id=auth.uid();
 select * into e from public.member_entitlements where user_id=auth.uid();
 if lower(trim(p.role))='admin' or e.state='owner' then return 'premium'; end if;
 if e.user_id is null then
  if lower(trim(p.subscription_status))='active' and (p.paid_until is null or p.paid_until>now()) then return 'premium'; end if;
  return 'free';
 end if;
 ending:=coalesce(e.access_ends_at,e.current_period_end);
 if (e.state in ('beta_full','paid_active') and (ending is null or ending>now()))
 or (e.state='trialing' and e.trial_ends_at>now())
 or (e.state='canceled' and ending>now()) then return 'premium'; end if;
 return 'free';
end $$;
revoke all on function academy_private.access_v11() from public,anon,authenticated,service_role;
grant execute on function academy_private.access_v11() to authenticated;

create table public.academy_lessons_v11(
 id text primary key check(id ~ '^[a-z0-9-]{1,80}$'),
 version text not null check(version='ACADEMY_MEMBER_V11'),
 position integer not null unique check(position>0),
 tier text not null check(tier in ('free','premium')),
 title text not null,
 content jsonb not null check(jsonb_typeof(content)='object'),
 rights text not null check(rights='ORIGINAL_MEMBER_EDUCATION'),
 check(content->>'id'=id)
);
alter table public.academy_lessons_v11 enable row level security;
alter table public.academy_lessons_v11 force row level security;
revoke all on public.academy_lessons_v11 from public,anon,authenticated,service_role;
grant select on public.academy_lessons_v11 to authenticated;
create policy academy_lessons_read on public.academy_lessons_v11 for select to authenticated
 using ((select academy_private.access_v11()) in ('owner','premium') or (tier='free' and (select academy_private.access_v11())='free'));

create table public.academy_progress_v11(
 user_id uuid not null references auth.users(id) on delete cascade,
 chapter_id text not null references public.academy_lessons_v11(id),
 version text not null check(version='ACADEMY_MEMBER_V11'),
 completed boolean not null default false,
 last_position integer not null default 0 check(last_position between 0 and 100000),
 answers jsonb not null default '[]' check(jsonb_typeof(answers)='array' and jsonb_array_length(answers)<=100),
 updated_at timestamptz not null default now(),
 primary key(user_id,chapter_id)
);
alter table public.academy_progress_v11 enable row level security;
alter table public.academy_progress_v11 force row level security;
revoke all on public.academy_progress_v11 from public,anon,authenticated,service_role;
grant select on public.academy_progress_v11 to authenticated;
create policy academy_progress_own on public.academy_progress_v11 for select to authenticated
 using(user_id=(select auth.uid()) and (select academy_private.access_v11())<>'denied'
 and exists(select from public.academy_lessons_v11 l where l.id=chapter_id));

create table public.academy_pdf_v11(
 edition text primary key check(edition in ('free','premium')),
 filename text not null,
 body bytea not null check(octet_length(body) between 100 and 4000000),
 rights text not null check(rights='ORIGINAL_MEMBER_EDUCATION')
);
alter table public.academy_pdf_v11 enable row level security;
alter table public.academy_pdf_v11 force row level security;
revoke all on public.academy_pdf_v11 from public,anon,authenticated,service_role;
grant select on public.academy_pdf_v11 to authenticated;
create policy academy_pdf_read on public.academy_pdf_v11 for select to authenticated
 using ((select academy_private.access_v11()) in ('owner','premium') or (edition='free' and (select academy_private.access_v11())='free'));

-- Catalog can disclose titles, never locked lesson bodies or answers.
create function academy_private.catalog_v11() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare access text:=academy_private.access_v11();
begin
 if access='denied' then raise exception 'ACADEMY_SIGN_IN_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('user_id',auth.uid(),'tier',access,'version','ACADEMY_MEMBER_V11',
 'chapters',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'tier',tier,'allowed',tier='free' or access in ('premium','owner')) order by position),'[]') from public.academy_lessons_v11),
 'progress',(select coalesce(jsonb_agg(to_jsonb(p) - 'user_id'),'[]') from public.academy_progress_v11 p join public.academy_lessons_v11 l on l.id=p.chapter_id
 where p.user_id=auth.uid() and (l.tier='free' or access in ('premium','owner'))));
end $$;
create function public.get_academy_catalog_v11() returns jsonb
language sql stable security invoker set search_path='' as $$select academy_private.catalog_v11()$$;
create function public.get_academy_lesson_v11(p_chapter_id text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare lesson jsonb;
begin
 select content into lesson from public.academy_lessons_v11 where id=p_chapter_id;
 if lesson is null then raise exception 'ACADEMY_LESSON_DENIED' using errcode='42501'; end if;
 return lesson;
end $$;
create function public.get_academy_pdf_v11(p_edition text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare doc jsonb;
begin
 select jsonb_build_object('filename',filename,'base64',encode(body,'base64'),'mime','application/pdf') into doc from public.academy_pdf_v11 where edition=p_edition;
 if doc is null then raise exception 'ACADEMY_PDF_DENIED' using errcode='42501'; end if;
 return doc;
end $$;

-- Only this fixed, identity-bound operation writes NEW learning records. Client
-- cannot provide user_id, grade, version, timestamps, or a completion score.
create function academy_private.record_progress_v11(p_chapter_id text,p_question_id text,p_choice_index integer,p_position integer,p_complete boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a text:=academy_private.access_v11(); l public.academy_lessons_v11%rowtype; r public.academy_progress_v11%rowtype; q jsonb; passed boolean;
begin
 if a='denied' then raise exception 'ACADEMY_SIGN_IN_REQUIRED' using errcode='42501'; end if;
 select * into l from public.academy_lessons_v11 where id=p_chapter_id;
 if l.id is null or (l.tier='premium' and a='free') then raise exception 'ACADEMY_LESSON_DENIED' using errcode='42501'; end if;
 if p_position is null or p_position not between 0 and 100000 or p_complete is null then raise exception 'ACADEMY_INVALID_PROGRESS' using errcode='22023'; end if;
 if (p_question_id is null)<>(p_choice_index is null) then raise exception 'ACADEMY_INVALID_ANSWER' using errcode='22023'; end if;
 if p_question_id is not null then
  select x into q from jsonb_array_elements(l.content->'questions') x where x->>'id'=p_question_id;
  if q is null or p_choice_index<0 or p_choice_index>=jsonb_array_length(q->'choices') then raise exception 'ACADEMY_INVALID_ANSWER' using errcode='22023'; end if;
 end if;
 insert into public.academy_progress_v11(user_id,chapter_id,version) values(auth.uid(),l.id,l.version) on conflict do nothing;
 select * into r from public.academy_progress_v11 where user_id=auth.uid() and chapter_id=l.id for update;
 if q is not null then
  select coalesce(jsonb_agg(x),'[]') into r.answers from jsonb_array_elements(r.answers) x where x->>'question_id'<>p_question_id;
  r.answers:=r.answers||jsonb_build_array(jsonb_build_object('question_id',p_question_id,'choice_index',p_choice_index,'correct',p_choice_index=(q->>'correctIndex')::integer));
 end if;
 select not exists(select from jsonb_array_elements(l.content->'questions') x where not exists(select from jsonb_array_elements(r.answers) z where z->>'question_id'=x->>'id' and z->>'correct'='true')) into passed;
 if p_complete and not passed then raise exception 'ACADEMY_QUIZ_INCOMPLETE' using errcode='22023'; end if;
 update public.academy_progress_v11 set answers=r.answers,last_position=p_position,completed=(r.completed or p_complete),updated_at=now() where user_id=auth.uid() and chapter_id=l.id returning * into r;
 return to_jsonb(r)-'user_id';
end $$;
create function public.record_academy_progress_v11(p_chapter_id text,p_question_id text default null,p_choice_index integer default null,p_position integer default 0,p_complete boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select academy_private.record_progress_v11(p_chapter_id,p_question_id,p_choice_index,p_position,p_complete)$$;

revoke all on function academy_private.catalog_v11(),academy_private.record_progress_v11(text,text,integer,integer,boolean),public.get_academy_catalog_v11(),public.get_academy_lesson_v11(text),public.get_academy_pdf_v11(text),public.record_academy_progress_v11(text,text,integer,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function academy_private.catalog_v11(),academy_private.record_progress_v11(text,text,integer,integer,boolean),public.get_academy_catalog_v11(),public.get_academy_lesson_v11(text),public.get_academy_pdf_v11(text),public.record_academy_progress_v11(text,text,integer,integer,boolean) to authenticated;

-- Original member curriculum and PDF payloads are loaded by the reviewed
-- candidate content loader; never import the Owner's source handout here.
commit;
