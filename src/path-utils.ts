/** Convert repository-relative paths to a stable, cross-platform form. */
export function toPortablePath(value: string): string {
  return value.replace(/\\/g, "/");
}
