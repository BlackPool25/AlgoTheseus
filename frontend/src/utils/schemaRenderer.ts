/**
 * utils/schemaRenderer.ts — Maps variable values to StructGraphVisual props.
 *
 * Given a ProgramSchema and a variable value (the serialized struct object),
 * returns the props needed to render it with StructGraphVisual.
 *
 * The schema tells us:
 *   - which field is the label (role: "label" or "data")
 *   - which fields are left/right children (role: "left_child", "right_child")
 *   - which field is the next pointer (role: "next")
 *   - how to render it (render_as: "tree" | "linked_list" | "graph")
 */

import type { ProgramSchema, StructSchema } from "../types/schema";
import type { RenderAs } from "../components/ContainerVisuals/StructGraphVisual";

export interface StructVisualProps {
  renderAs: RenderAs;
  labelField: string;
  leftField: string;
  rightField: string;
  nextField: string;
}

/** Find the schema for a given struct type name. */
export function findSchema(schema: ProgramSchema, typeName: string): StructSchema | null {
  return schema.structs.find((s) => s.name === typeName) ?? null;
}

/** Extract StructGraphVisual props from a StructSchema. */
export function schemaToVisualProps(struct: StructSchema): StructVisualProps {
  let labelField = "val";
  let leftField = "left";
  let rightField = "right";
  let nextField = "next";

  for (const field of struct.fields) {
    if (field.role === "label" || field.role === "data") labelField = field.name;
    if (field.role === "left_child") leftField = field.name;
    if (field.role === "right_child") rightField = field.name;
    if (field.role === "next" || field.role === "prev") nextField = field.name;
  }

  return {
    renderAs: struct.render_as as RenderAs,
    labelField,
    leftField,
    rightField,
    nextField,
  };
}

/**
 * Detect if a value looks like a serialized struct (has nested object fields
 * that could be pointer children). Returns the matching schema if found.
 *
 * Heuristic: if the value is an object with fields that match a known struct's
 * field names, it's likely that struct type.
 */
export function detectStructSchema(
  value: unknown,
  schema: ProgramSchema
): StructSchema | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  for (const struct of schema.structs) {
    const fieldNames = new Set(struct.fields.map((f) => f.name));
    const objKeys = Object.keys(obj);
    // If at least half the struct's fields are present, it's a match
    const matches = objKeys.filter((k) => fieldNames.has(k)).length;
    if (matches >= Math.ceil(struct.fields.length / 2)) {
      return struct;
    }
  }
  return null;
}
