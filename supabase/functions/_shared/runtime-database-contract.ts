export type RuntimeJson = Record<string, unknown>;

type RuntimeTable = {
  Row: RuntimeJson;
  Insert: RuntimeJson;
  Update: RuntimeJson;
  Relationships: [];
};

type RuntimeFunction = {
  Args: RuntimeJson;
  Returns: unknown;
};

// Edge Functions use tables and RPCs that evolve additively across migrations.
// This contract preserves unknown-value checking without using `any`, while
// avoiding the unsafe `never` inference produced by an unparameterized client.
export interface RuntimeDatabase {
  public: {
    Tables: Record<string, RuntimeTable>;
    Views: Record<string, RuntimeTable>;
    Functions: Record<string, RuntimeFunction>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
