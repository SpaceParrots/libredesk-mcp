/**
 * @module ops/fields
 * Flat description of an operation's input fields, read from the zod schemas. The CLI builds
 * flags and prompts from it and the catalog lists it.
 */

import { z } from "zod";
import type { Operation } from "./define.js";

/** How a field is entered: a scalar, one of a fixed set, or a JSON document. */
export type FieldKind = "string" | "number" | "boolean" | "enum" | "json";

/** One input field of an operation. */
export interface FieldInfo {
  /** Input key. */
  readonly name: string;
  /** How the value is entered. For `array` fields, the kind of each element. */
  readonly kind: FieldKind;
  /** False when the field is optional or has a default. */
  readonly required: boolean;
  /** The zod description, or "" when there is none. */
  readonly description: string;
  /** Allowed values of an `enum` field. */
  readonly enumValues?: readonly string[];
  /** The zod default, when there is one. */
  readonly defaultValue?: unknown;
  /** True for a list of strings or enum values, entered by repeating the flag. */
  readonly array: boolean;
}

type Schema = z.core.$ZodType;

interface Unwrapped {
  readonly inner: Schema;
  readonly required: boolean;
  readonly description: string;
  readonly hasDefault: boolean;
  readonly defaultValue: unknown;
}

function describedAs(schema: Schema): string | undefined {
  const description = z.globalRegistry.get(schema)?.description;
  return description ? description : undefined;
}

function unwrap(schema: Schema): Unwrapped {
  let current = schema;
  let required = true;
  let description = describedAs(current);
  let hasDefault = false;
  let defaultValue: unknown;
  for (;;) {
    const def = current._zod.def;
    let next: Schema;
    if (def.type === "optional" || def.type === "nullable" || def.type === "readonly") {
      if (def.type === "optional") required = false;
      next = (def as z.core.$ZodOptionalDef).innerType;
    } else if (def.type === "default" || def.type === "prefault") {
      const withDefault = def as z.core.$ZodDefaultDef;
      required = false;
      if (!hasDefault) {
        hasDefault = true;
        defaultValue = withDefault.defaultValue;
      }
      next = withDefault.innerType;
    } else if (def.type === "pipe") {
      next = (def as z.core.$ZodPipeDef).in;
    } else {
      break;
    }
    current = next;
    description ??= describedAs(current);
  }
  return { inner: current, required, description: description ?? "", hasDefault, defaultValue };
}

interface Shape {
  readonly kind: FieldKind;
  readonly enumValues?: readonly string[];
}

function scalarShape(schema: Schema): Shape {
  const def = schema._zod.def;
  switch (def.type) {
    case "string":
      return { kind: "string" };
    case "number":
    case "int":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "enum":
      return { kind: "enum", enumValues: Object.values((def as z.core.$ZodEnumDef).entries).map(String) };
    case "literal":
      return { kind: "enum", enumValues: (def as z.core.$ZodLiteralDef<z.core.util.Literal>).values.map(String) };
    default:
      return { kind: "json" };
  }
}

/** Describe one input field. Objects, records and arrays of anything but strings or enums are `json`. */
export function fieldInfo(name: string, schema: Schema): FieldInfo {
  const { inner, required, description, hasDefault, defaultValue } = unwrap(schema);
  let shape = scalarShape(inner);
  let array = false;
  const def = inner._zod.def;
  if (def.type === "array") {
    const element = scalarShape(unwrap((def as z.core.$ZodArrayDef).element).inner);
    array = element.kind === "string" || element.kind === "enum";
    shape = array ? element : { kind: "json" };
  }
  return {
    name,
    kind: shape.kind,
    required,
    description,
    ...(shape.enumValues !== undefined ? { enumValues: shape.enumValues } : {}),
    ...(hasDefault ? { defaultValue } : {}),
    array,
  };
}

/** Describe every input field of an operation, in declaration order. */
export function operationFields(op: Operation): FieldInfo[] {
  return Object.entries(op.input).map(([name, schema]) => fieldInfo(name, schema));
}
