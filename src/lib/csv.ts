function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Formula-injection guard: a cell starting with = + - @ (or a leading
  // tab/CR) is executed as a formula by Excel/Sheets. Guest-controlled data
  // (names, user agents, actor strings) reaches these exports, so neutralise
  // it by prefixing a single quote — the OWASP-recommended defence — before
  // the CSV-structural quoting below.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escape(r[c.key])).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}
