// A fast drop-in for csv-reader 1.0.0, written from the competition spec
// (RULES.txt): run(input) returns exactly {columns, rows, errors} for an
// input {text, header}. Same broken-row policy, different engine.
//
// The reference walks the text one character at a time, growing each field
// by concatenation. This version jumps instead:
//   - an unquoted field is sliced in one go between the nearest comma and
//     the nearest line feed, both found with indexOf;
//   - a quoted field jumps from quote to quote with indexOf, converting
//     CR / CRLF inside it to LF as it goes;
//   - the next CR and LF positions are kept in lazily refreshed caches, so
//     no search ever re-walks text it already passed: all refreshes together
//     cost O(n).
// No regular expressions anywhere on the path a field takes.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on, and the index it takes
  // in rows (null while it is the header). Every error of this record
  // reports these two, never the line the parser has reached.
  let recordLine = 1;
  let recordRow = null;

  // Next CR / LF at or after pos: -2 unknown, -1 none left. A refresh
  // always starts at or after where the previous one ended.
  let crAt = -2;
  let nlAt = -2;

  function refreshCr() {
    if (crAt === -2 || (crAt !== -1 && crAt < pos)) crAt = text.indexOf('\r', pos);
  }

  function refreshNl() {
    if (nlAt === -2 || (nlAt !== -1 && nlAt < pos)) nlAt = text.indexOf('\n', pos);
  }

  // Reads unquoted characters after `value` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr) and costs no
  // line. `added` counts only the characters kept here, so a caller that
  // passed in a quoted value can tell whether junk followed its quote.
  function readUnquoted(value) {
    let out = value;
    let added = 0;
    for (;;) {
      refreshCr();
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      let end = -1;
      let isComma = false;
      if (ci !== -1 && (ni === -1 || ci < ni)) {
        end = ci;
        isComma = true;
      } else if (ni !== -1) {
        end = ni;
      }
      if (crAt !== -1 && (end === -1 || crAt < end)) {
        if (crAt > pos) {
          out += text.slice(pos, crAt);
          added += crAt - pos;
        }
        if (text.charCodeAt(crAt + 1) === 10) {
          pos = crAt + 2;
          line += 1;
          crAt = -2;
          return { value: out, ended: LINE_BREAK, added };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = crAt + 1;
        crAt = -2;
        continue;
      }
      if (end === -1) {
        if (pos < n) {
          out += text.slice(pos);
          added += n - pos;
        }
        pos = n;
        return { value: out, ended: END, added };
      }
      if (end > pos) {
        out += text.slice(pos, end);
        added += end - pos;
      }
      if (isComma) {
        pos = end + 1;
        return { value: out, ended: COMMA, added };
      }
      pos = end + 1;
      line += 1;
      return { value: out, ended: LINE_BREAK, added };
    }
  }

  // Returns text[pos..end) with each CRLF or lone CR inside it read as
  // one LF, counting the lines crossed. Leaves pos at end.
  function quotedSpan(end) {
    let s = '';
    while (pos < end) {
      refreshCr();
      refreshNl();
      let cut = end;
      let isCr = false;
      if (crAt !== -1 && crAt < end) {
        cut = crAt;
        isCr = true;
      }
      if (nlAt !== -1 && nlAt < end && nlAt < cut) {
        cut = nlAt;
        isCr = false;
      }
      if (cut > pos) s += text.slice(pos, cut);
      if (cut === end) {
        pos = end;
        return s;
      }
      s += '\n';
      line += 1;
      if (isCr) {
        pos = text.charCodeAt(cut + 1) === 10 ? cut + 2 : cut + 1;
        crAt = -2;
      } else {
        pos = cut + 1;
        nlAt = -2;
      }
    }
    return s;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let out = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted. Nothing scanned inside the
        // would-be field counts: the line rolls back to the opening line.
        pos = open + 1;
        line = openLine;
        crAt = -2;
        nlAt = -2;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      out += quotedSpan(q);
      if (text.charCodeAt(q + 1) === 34) {
        out += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      break;
    }
    if (pos >= n) return { value: out, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value: out, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value: out, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value: out, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break; any of it kept is quote_junk, reported
    // after the stray_cr errors the junk itself raised.
    const junk = readUnquoted(out);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay). A single empty quoted field
    // ("") is a record; a single empty unquoted field is not.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
