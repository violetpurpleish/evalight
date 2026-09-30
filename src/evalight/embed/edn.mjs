/** Read configuration data without evaluating it; retain spans for path edits. */
export function readEdn(text) {
  let i = 0;
  function skip() {
    while (i < text.length) {
      if (/[\s,]/.test(text[i])) i++;
      else if (text[i] === ";") {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (text.startsWith("#_", i)) {
        i += 2;
        read();
      } else break;
    }
  }
  function read() {
    skip();
    const start = i;
    if (i >= text.length) throw new Error("Unexpected end of EDN");
    if (text[i] === "^") {
      i++;
      read();
      return read();
    }
    const regex = text.startsWith('#"', i);
    if (regex) i++;
    if (text[i] === '"') {
      const quote = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      if (i >= text.length) throw new Error("Unterminated EDN string");
      i++;
      return { type: regex ? "regex" : "string", start, end: i,
        value: regex ? text.slice(quote, i) : JSON.parse(text.slice(quote, i)) };
    }
    const set = text.startsWith("#{", i);
    if (set) i++;
    const open = text[i];
    if ("{[(".includes(open)) {
      i++;
      const close = { "{": "}", "[": "]", "(": ")" }[open];
      const items = [];
      for (;;) {
        skip();
        if (text[i] === close) { i++; break; }
        if (i >= text.length) throw new Error(`Unterminated EDN ${open}`);
        items.push(read());
      }
      if (open === "{" && !set && items.length % 2) throw new Error("EDN map needs key/value pairs");
      return { type: set ? "set" : open === "{" ? "map" : "sequence", start, end: i, items };
    }
    if ("}])".includes(open)) throw new Error(`Unexpected EDN ${open}`);
    while (i < text.length && !/[\s,{}\[\]();]/.test(text[i])) i++;
    if (i === start) throw new Error(`Invalid EDN at ${i}`);
    const token = text.slice(start, i);
    if (token.startsWith("#")) {
      return { type: "tag", start, end: i, items: [read()] };
    }
    const value = token === "nil" ? null : token === "true" ? true : token === "false" ? false
      : /^-?\d+$/.test(token) ? Number(token) : token.replace(/^:/, "");
    return { type: token.startsWith(":") ? "keyword" : "symbol", start, end: i, value };
  }
  const node = read();
  skip();
  if (i !== text.length) throw new Error("Trailing EDN data");
  return node;
}

export function ednGet(node, key) {
  if (node?.type !== "map") return null;
  for (let i = 0; i < node.items.length; i += 2) {
    if (node.items[i].value === key) return node.items[i + 1];
  }
  return null;
}

export function ednValue(node) {
  if (!node) return undefined;
  if (node.type === "map") {
    const out = Object.create(null);
    for (let i = 0; i < node.items.length; i += 2) out[ednValue(node.items[i])] = ednValue(node.items[i + 1]);
    return out;
  }
  return node.items ? node.items.map(ednValue) : node.value;
}

export function replaceEdn(text, edits) {
  for (const { start, end, value } of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + value + text.slice(end);
  }
  return text;
}
