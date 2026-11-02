/**
 * @module cli/prompt
 * The prompt surface the CLI needs, behind an interface so tests and the interactive mode can
 * swap the terminal UI for a fake.
 */

import * as clack from "@clack/prompts";
import { CancelledError } from "../errors.js";

/** The prompts the CLI uses. Every prompt resolves to a value or throws {@link CancelledError}. */
export interface PromptAdapter {
  /** Ask for a line of text. `validate` returns an error message or undefined. */
  text(o: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (v: string) => string | undefined;
  }): Promise<string>;
  /** Ask for a secret; the input is masked. */
  password(o: { message: string }): Promise<string>;
  /** Ask a yes or no question. */
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean>;
  /** Pick one of several options. */
  select<T extends string>(o: {
    message: string;
    options: readonly { value: T; label: string; hint?: string }[];
  }): Promise<T>;
  /** Show a boxed note. */
  note(message: string, title?: string): void;
}

function answer<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as T;
}

/** {@link PromptAdapter} backed by `@clack/prompts`. A cancelled prompt throws {@link CancelledError}. */
export const clackPrompts: PromptAdapter = {
  async text(o) {
    const validate = o.validate;
    return answer<string>(await clack.text({ ...o, validate: validate ? (v) => validate(v ?? "") : undefined }));
  },
  async password(o) {
    return answer<string>(await clack.password(o));
  },
  async confirm(o) {
    return answer<boolean>(await clack.confirm(o));
  },
  async select<T extends string>(o: {
    message: string;
    options: readonly { value: T; label: string; hint?: string }[];
  }) {
    return answer<T>(await clack.select<T>({ message: o.message, options: o.options.map((option) => ({ ...option })) } as never));
  },
  note(message, title) {
    clack.note(message, title);
  },
};
