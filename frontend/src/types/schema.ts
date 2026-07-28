/**
 * types/schema.ts — Struct rendering schema types (from LLM analysis).
 */

export type FieldRole =
  | "label"
  | "left_child"
  | "right_child"
  | "next"
  | "prev"
  | "pointer"
  | "data";

export type RenderAs = "tree" | "linked_list" | "graph";

export interface StructField {
  name: string;
  cpp_type: string;
  role: FieldRole;
}

export interface StructSchema {
  name: string;
  render_as: RenderAs;
  fields: StructField[];
}

export interface ProgramSchema {
  structs: StructSchema[];
}
