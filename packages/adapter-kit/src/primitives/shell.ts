// POSIX shell-arg quoting. A token made only of shell-safe characters is left
// bare; anything else is wrapped in single quotes with embedded single quotes
// escaped as '\'' so the canonical command string round-trips through a shell.
export function quoteShellArg(value: string): string {
  return /^[A-Za-z0-9_\-./@:+=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
