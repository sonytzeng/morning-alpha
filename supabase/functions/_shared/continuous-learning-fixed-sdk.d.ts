/** CLE-only type surface of archived Supabase JS 2.57.4, checked against the
 * locally locked SDK and exercised against that archived runtime. Not an SDK
 * replacement or schema claim. No auth/admin/storage/realtime API is exposed.
 * Unknown data stays unknown. This file has no runtime implementation. */
import type { RuntimeDatabase, RuntimeJson } from './runtime-database-contract.ts';

export type LearningSdkError = { message: string; code: string; details: string; hint: string };
type ResponseBase = {
  count: number | null;
  status: number;
  statusText: string;
};
export type LearningSdkResult<Data> = ResponseBase & (
  { data: Data | null; error: null } | { data: null; error: LearningSdkError }
);
type Count = 'exact' | 'planned' | 'estimated';
type Single<Data> = Data extends (infer Row)[] ? Row : never;
export interface LearningResult<Data> extends PromiseLike<LearningSdkResult<Data>> {}
export interface LearningTransform<Data> extends LearningResult<Data> {
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string }): LearningTransform<Data>;
  limit(count: number, options?: { referencedTable?: string }): LearningTransform<Data>;
  single(): LearningResult<Single<Data>>;
  maybeSingle(): LearningResult<Single<Data> | null>;
}
export interface LearningFilter<Data> extends LearningTransform<Data> {
  eq(column: string, value: unknown): LearningFilter<Data>;
  gte(column: string, value: unknown): LearningFilter<Data>;
  lte(column: string, value: unknown): LearningFilter<Data>;
  in(column: string, values: readonly unknown[]): LearningFilter<Data>;
  is(column: string, value: boolean | null): LearningFilter<Data>;
  like(column: string, pattern: string): LearningFilter<Data>;
}
// CLE consumes returning-select after writes, never a second select after a
// read-select. Keep those states separate instead of claiming extra SDK APIs.
export interface LearningWriteFilter<Data> extends LearningFilter<Data> {
  select(columns?: string): LearningTransform<RuntimeJson[]>;
  eq(column: string, value: unknown): LearningWriteFilter<Data>;
  gte(column: string, value: unknown): LearningWriteFilter<Data>;
  lte(column: string, value: unknown): LearningWriteFilter<Data>;
  in(column: string, values: readonly unknown[]): LearningWriteFilter<Data>;
  is(column: string, value: boolean | null): LearningWriteFilter<Data>;
  like(column: string, pattern: string): LearningWriteFilter<Data>;
}
export interface LearningTable<Row extends RuntimeJson, Insert extends RuntimeJson, Update extends RuntimeJson> {
  select(columns?: string, options?: { head?: boolean; count?: Count }): LearningFilter<Row[]>;
  insert(values: Insert | Insert[], options?: { count?: Count; defaultToNull?: boolean }): LearningWriteFilter<null>;
  upsert(values: Insert | Insert[], options?: {
    onConflict?: string; ignoreDuplicates?: boolean; count?: Count; defaultToNull?: boolean;
  }): LearningWriteFilter<null>;
  update(values: Update, options?: { count?: Count }): LearningWriteFilter<null>;
}
export interface LearningClient<Database extends RuntimeDatabase> {
  from<Name extends string & keyof Database['public']['Tables']>(relation: Name): LearningTable<
    Database['public']['Tables'][Name]['Row'], Database['public']['Tables'][Name]['Insert'], Database['public']['Tables'][Name]['Update']
  >;
  rpc<Name extends string & keyof Database['public']['Functions']>(
    name: Name, args?: Database['public']['Functions'][Name]['Args'], options?: { head?: boolean; get?: boolean; count?: Count },
  ): LearningResult<Database['public']['Functions'][Name]['Returns']>;
}
export type LearningClientOptions = {
  auth?: { persistSession?: boolean; autoRefreshToken?: boolean; detectSessionInUrl?: boolean };
  global?: { fetch?: typeof fetch; headers?: Record<string, string> };
  db?: { schema?: 'public' };
};
export declare function createClient<Database extends RuntimeDatabase = RuntimeDatabase>(
  url: string, key: string, options?: LearningClientOptions,
): LearningClient<Database>;
