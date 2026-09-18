/**
 * utils/formatCpp.ts — Zero-dep opinionated C++ tidy.
 *
 * Normalizes the editor buffer (indent, brace style, whitespace) to match
 * repo preset style: 1TBS/K&R braces (`int main() {`), 4-space indent,
 * `} else {` on one line. Whitespace-only: never renames, moves, or
 * deletes tokens, so formatting the buffer before Run keeps trace
 * line-mapping semantics (what you see is what runs).
 *
 * String/char literals and comments are masked before any edit so their
 * contents are never touched. Idempotent: format(format(x)) === format(x).
 */

const INDENT = "    ";

interface Masked {
  text: string;
  literals: string[];
}

/** Replace string/char literals and comments with NUL placeholders. */
function maskLine(line: string, inBlock: { value: boolean }): Masked {
  const literals: string[] = [];
  let out = "";
  let i = 0;
  const push = (raw: string): string => {
    literals.push(raw);
    return `\0${literals.length - 1}\0`;
  };
  while (i < line.length) {
    const c = line[i];
    const two = line.slice(i, i + 2);
    if (inBlock.value) {
      const end = line.indexOf("*/", i);
      if (end === -1) {
        out += push(line.slice(i));
        break;
      }
      out += push(line.slice(i, end + 2));
      i = end + 2;
      inBlock.value = false;
      continue;
    }
    if (two === "//") {
      out += push(line.slice(i));
      break;
    }
    if (two === "/*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        out += push(line.slice(i));
        inBlock.value = true;
        break;
      }
      out += push(line.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += push(line.slice(i, j));
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return { text: out, literals };
}

function unmask(text: string, literals: string[]): string {
  return text.replace(/\0(\d+)\0/g, (_, n: string) => literals[Number(n)] ?? "");
}

/** Collapse runs of spaces/tabs to one; strip space before , ; ) ] and after ( [. */
function normalizeSpacing(masked: string): string {
  let s = masked.replace(/[ \t]+/g, " ");
  s = s
    .replace(/\s+([,;)}]])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\b(if|for|while|switch|catch|return)\(/g, "$1 (")
    .replace(/\)(?=[A-Za-z_])/g, ") ")
    .replace(/\)\s*\{/g, ") {")
    .replace(/\}\s*else/g, "} else")
    .replace(/\belse\s*\{/g, "else {")
    .replace(/,(?=\S)/g, ", ");
  // Binary operator spacing (masked text has no string contents to corrupt).
  // Deliberately partial: bare `*`/`&`/`<`/`>` are left alone because a
  // textual tidy cannot tell `int *p` from `a * b` or `vector<int>` from
  // `a < b` — spacing them would corrupt valid code. `->` is glued back
  // (member access) or spaced (trailing return type) after the pass.
  s = s
    .replace(/(\+=|-=|\*=|\/=|%=|<<=?|>>=?|&&|\|\||[=!<>]=|\+(?!\+)|-(?!-|>)|=(?![=])|\/(?=\S)|%(?=\S))/g, " $1 ")
    .replace(/(\w)\s*->\s*(\w)/g, "$1->$2")
    .replace(/\)\s*->\s*(\S)/g, ") -> $1")
    .replace(/\s+/g, " ");
  return s.trim();
}

/** Count net brace depth change, ignoring placeholders (no braces inside). */
function braceDelta(masked: string): number {
  let d = 0;
  for (const c of masked) {
    if (c === "{") d += 1;
    else if (c === "}") d -= 1;
  }
  return d;
}

/**
 * Format C++ source. Whitespace-only edits; preprocessor lines keep column 0.
 */
export function formatCpp(source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n").replace(/\t/g, INDENT);
  const inBlock = { value: false };
  const out: string[] = [];
  let depth = 0;
  let blankPending = false;

  for (const raw of normalized.split("\n")) {
    const { text: masked, literals } = maskLine(raw, inBlock);
    const trimmedMasked = masked.trim();

    if (trimmedMasked === "") {
      // Collapse blank runs to at most one; never lead the file.
      if (out.length > 0) blankPending = true;
      continue;
    }

    const spaced = normalizeSpacing(trimmedMasked);
    const isPreprocessor = spaced.startsWith("#");

    // Lone `{` joins the previous line (1TBS), unless it closes a blank gap
    // after a preprocessor block or namespace-style opener.
    if (spaced === "{" && out.length > 0 && !isPreprocessor) {
      const prev = out[out.length - 1];
      if (!prev.endsWith("{") && !prev.startsWith("#")) {
        // `prev` is already unmasked — append directly, no re-mask needed.
        out[out.length - 1] = `${prev} {`;
        depth += 1;
        blankPending = false;
        continue;
      }
    }

    // Dedent closing braces before emitting.
    const closes = isPreprocessor ? 0 : (spaced.match(/^(\}+)/)?.[1].length ?? 0);
    const level = isPreprocessor ? 0 : Math.max(0, depth - closes);
    const indent = isPreprocessor ? "" : INDENT.repeat(level);

    if (blankPending) {
      out.push("");
      blankPending = false;
    }
    out.push(indent + unmask(spaced, literals));

    if (!isPreprocessor) depth = Math.max(0, depth + braceDelta(spaced));
  }

  return out.join("\n").trimEnd() + "\n";
}
