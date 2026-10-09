// Round-trips a stdio server's args array through the single-line Args field.
// A plain join(' ') / split(/\s+/) is lossy: an arg with a space in it
// ("--device", "Desktop Chrome") comes back as two args the first time the
// field is edited, and the server then refuses to start.
//
// Quotes group, like a shell, but backslash is always literal so Windows
// paths can be typed as-is. A literal quote goes inside the other kind of
// quote: 'say "hi"' or "it's".

export function parseArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let inToken = false
  let quote: '"' | "'" | null = null

  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
    } else if (/\s/.test(ch)) {
      if (inToken) args.push(current)
      current = ''
      inToken = false
    } else {
      current += ch
      inToken = true
    }
  }
  // An unterminated quote keeps the rest of the line as one arg.
  if (inToken) args.push(current)
  return args
}

function formatArg(arg: string): string {
  if (arg !== '' && !/[\s"']/.test(arg)) return arg
  if (!arg.includes('"')) return `"${arg}"`
  if (!arg.includes("'")) return `'${arg}'`
  // Both quote kinds: double-quote each run between `"`s and join them with '"'.
  return arg.split('"').map((part) => (part ? `"${part}"` : '')).join(`'"'`)
}

export function formatArgs(args: string[]): string {
  return args.map(formatArg).join(' ')
}
