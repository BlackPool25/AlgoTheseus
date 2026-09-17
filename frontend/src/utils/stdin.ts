/**
 * utils/stdin.ts — Single source for the reads-stdin heuristic.
 *
 * Line/block comments are stripped first; fail-open by design — this only
 * gates a proactive UI hint, never blocks a run (the backend owns the 422).
 */
export function readsStdin(code: string): boolean {
  const stripped = code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return /\bcin\s*>>|\bscanf\s*\(|\bgetline\s*\(\s*cin|\bgetchar\s*\(|\bgetc\s*\(/.test(
    stripped,
  );
}
