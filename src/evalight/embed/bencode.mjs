/**
 * Minimal bencode for nREPL. Strings are UTF-8. Dict keys are sorted.
 */
export function encode(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return Buffer.from(`i${value}e`);
  }
  if (typeof value === "boolean") {
    return encode(value ? 1 : 0);
  }
  if (typeof value === "string") {
    const buf = Buffer.from(value, "utf8");
    return Buffer.concat([Buffer.from(`${buf.length}:`), buf]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("l"), ...value.map(encode), Buffer.from("e")]);
  }
  if (value && typeof value === "object") {
    const parts = [Buffer.from("d")];
    for (const k of Object.keys(value).sort()) {
      if (value[k] === undefined) continue;
      parts.push(encode(String(k)), encode(value[k]));
    }
    parts.push(Buffer.from("e"));
    return Buffer.concat(parts);
  }
  throw new Error(`cannot bencode ${typeof value}`);
}

function decodeAt(buf, i) {
  const b = buf[i];
  if (b === 105) {
    // i
    const end = buf.indexOf(101, i + 1); // e
    if (end < 0) return null;
    return { value: Number(buf.slice(i + 1, end).toString()), next: end + 1 };
  }
  if (b >= 48 && b <= 57) {
    const colon = buf.indexOf(58, i); // :
    if (colon < 0) return null;
    const len = Number(buf.slice(i, colon).toString());
    const start = colon + 1;
    const next = start + len;
    if (next > buf.length) return null;
    return { value: buf.slice(start, next).toString("utf8"), next };
  }
  if (b === 108) {
    // l
    const items = [];
    let pos = i + 1;
    while (pos < buf.length && buf[pos] !== 101) {
      const step = decodeAt(buf, pos);
      if (!step) return null;
      items.push(step.value);
      pos = step.next;
    }
    if (pos >= buf.length) return null;
    return { value: items, next: pos + 1 };
  }
  if (b === 100) {
    // d
    const obj = {};
    let pos = i + 1;
    while (pos < buf.length && buf[pos] !== 101) {
      const k = decodeAt(buf, pos);
      if (!k) return null;
      const v = decodeAt(buf, k.next);
      if (!v) return null;
      obj[k.value] = v.value;
      pos = v.next;
    }
    if (pos >= buf.length) return null;
    return { value: obj, next: pos + 1 };
  }
  throw new Error(`bad bencode at ${i}`);
}

export function decode(buf) {
  const step = decodeAt(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), 0);
  if (!step) return null;
  return step.value;
}

export function decodeAll(buf) {
  const out = [];
  let pos = 0;
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  while (pos < bytes.length) {
    const step = decodeAt(bytes, pos);
    if (!step) break;
    out.push(step.value);
    pos = step.next;
  }
  return { values: out, rest: bytes.slice(pos) };
}
