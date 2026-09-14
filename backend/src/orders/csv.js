// CSV writing, to RFC 4180.
//
// Hand-written rather than pulled in as a dependency: the whole format is the two rules below,
// and a library would be more code to justify than this is.

/**
 * Quote a field only when it needs it — a comma, a quote, or a line break inside the value —
 * and escape an embedded quote by doubling it.
 *
 * The leading-character guard is the part that is easy to miss: a value starting with =, +, -
 * or @ is executed as a formula by Excel and Sheets when the file is opened. An item called
 * `=cmd|...` in a menu would be a live payload in someone's spreadsheet, so it gets prefixed
 * with a tab, which those programs strip on display but not before parsing.
 */
function field(value) {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Rows to a CSV document. CRLF line endings, as the spec says and as Excel prefers. */
export function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}

// Excel on Windows reads a UTF-8 file as the system code page unless it starts with a byte
// order mark, which turns 'Café' into 'CafÃ©'. Every other consumer ignores it.
export const BOM = '﻿';
