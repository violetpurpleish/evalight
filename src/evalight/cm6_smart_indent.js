/**
 * Parinfer-friendly indent for insertNewlineAndIndent.
 *
 * Copied from @jurjanpaul/codemirror6-clojure-smart-indent (MIT) so
 * @codemirror/language comes from Evalight's top-level package — the
 * published module pins a second @codemirror/state and that breaks
 * CodeMirror. Pass indentService in so the Facet instance matches.
 *
 * Not a Tab keymap. Tab / Shift-Tab stay indentMore / indentLess.
 * If the previous code line has an unmatched delimiter, indent like the
 * Clojure style guide; otherwise copy the current indent. Comments are
 * skipped. Nothing happens inside strings. Assumes matched delimiters
 * (Parinfer).
 */
import { indentService as defaultIndentService } from "@codemirror/language";

const FLAG_ESCAPE = 1;
const FLAG_COMMENT = 2;
const FLAG_STRING = 4;

function flagCommentsAndStrings(text) {
  const size = text.length;
  const flags = new Uint8Array(size);
  let inString = false;
  let inComment = false;
  let escaped = false;
  for (let i = 0; i < size; i++) {
    const c = text[i];
    if (inComment) {
      flags[i] = FLAG_COMMENT;
      if (c === "\n") inComment = false;
    } else if (escaped) {
      flags[i] = FLAG_ESCAPE;
      escaped = false;
    } else if (c === "\\") {
      escaped = true;
    } else if (inString) {
      if (c === '"') {
        inString = false;
      } else {
        flags[i] = FLAG_STRING;
      }
    } else if (c === '"') {
      inString = true;
      flags[i] = FLAG_STRING;
    } else if (c === ";") {
      inComment = true;
      flags[i] = FLAG_COMMENT;
    }
  }
  return { text, flags };
}

function hasFlag(flags, index, flag) {
  return (flags[index] & flag) !== 0;
}

function isIgnored(flaggedText, index) {
  return hasFlag(flaggedText.flags, index, FLAG_STRING | FLAG_COMMENT | FLAG_ESCAPE);
}

function inString(flaggedText, index) {
  return hasFlag(flaggedText.flags, index, FLAG_STRING);
}

function inComment(flaggedText, index) {
  return hasFlag(flaggedText.flags, index, FLAG_COMMENT);
}

function getLineStart(text, index) {
  const lastNewline = text.lastIndexOf("\n", index);
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

function getColumn(text, index) {
  return index - getLineStart(text, index);
}

function isWhitespace(c) {
  return c === " " || c === "," || c === "\n" || c === "\r" || c === "\t";
}

function notWhitespace(c) {
  return !isWhitespace(c);
}

function isSpaceOrComment(flaggedText, i) {
  return isWhitespace(flaggedText.text[i]) || inComment(flaggedText, i);
}

function isOpenDelimiter(c) {
  return c === "(" || c === "[" || c === "{";
}

function isCloseDelimiter(c) {
  return c === ")" || c === "]" || c === "}";
}

function scan(flaggedText, index, limit, options) {
  const match = options.match || (() => true);
  const skip = options.skip || isIgnored;
  const scanForward = index < limit;
  const step = scanForward ? 1 : -1;
  for (let i = index; scanForward ? i <= limit : i >= limit; i += step) {
    if (skip(flaggedText, i)) continue;
    if (match(flaggedText.text[i], i)) return i;
  }
  return -1;
}

function findLastCodeCharIdx(flaggedText) {
  return scan(flaggedText, flaggedText.text.length - 1, 0, { match: notWhitespace });
}

function findUnmatchedDelimiterInLine(flaggedText, index, limit) {
  let unclosedOpen = -1;
  let unopenedClose = -1;
  let depth = 0;
  const matchFn = (c, i) => {
    if (isOpenDelimiter(c)) {
      if (depth === 0) {
        unclosedOpen = i;
        return true;
      }
      depth--;
      if (depth === 0) {
        unopenedClose = -1;
      }
    } else if (isCloseDelimiter(c)) {
      depth++;
      if (depth === 1) {
        unopenedClose = i;
      }
    }
    return false;
  };
  if (scan(flaggedText, index, limit, { match: matchFn }) !== -1) {
    return unclosedOpen;
  }
  return unopenedClose;
}

function skipSpaceAndComments(flaggedText, index) {
  if (index >= flaggedText.text.length) return -1;
  return scan(flaggedText, index, flaggedText.text.length - 1, { skip: isSpaceOrComment });
}

function readElement(flaggedText, index) {
  if (index >= flaggedText.text.length) return "";
  let depth = 0;
  function isEndOfElement(c, i) {
    if (isOpenDelimiter(c)) {
      depth++;
    } else if (isCloseDelimiter(c)) {
      depth--;
    }
    if (depth === 0) {
      if (i === flaggedText.text.length - 1 || isWhitespace(flaggedText.text[i + 1])) {
        return true;
      }
    }
    return depth < 0;
  }
  const lastCharIdx = scan(flaggedText, index, flaggedText.text.length - 1, {
    match: isEndOfElement,
  });
  return flaggedText.text.slice(index, lastCharIdx + 1);
}

const BODY_FORMS = new Set([
  "as->", "binding", "bound-fn", "case", "catch", "comment", "cond", "cond->", "cond->>", "condp",
  "def", "definterface", "defmethod", "defn", "defn-", "defmacro", "defprotocol", "defrecord",
  "defstruct", "deftype", "do", "doseq", "dotimes", "doto", "extend", "extend-protocol",
  "extend-type", "fn", "for", "future", "if", "if-let", "if-not", "if-some", "let", "letfn",
  "locking", "loop", "ns", "proxy", "reify", "struct-map", "some->", "some->>", "try", "when",
  "when-first", "when-let", "when-not", "when-some", "while", "with-bindings", "with-bindings*",
  "with-in-str", "with-loading-context", "with-local-vars", "with-meta", "with-open", "with-out-str",
  "with-precision", "with-redefs", "with-redefs-fn",
]);

function formIndentation(flaggedText, openParenIdx) {
  const openCol = getColumn(flaggedText.text, openParenIdx);
  if (flaggedText.text[openParenIdx] === "(") {
    const firstElemIdx = skipSpaceAndComments(flaggedText, openParenIdx + 1);
    if (firstElemIdx === -1) return openCol + 1;
    const element = readElement(flaggedText, firstElemIdx);
    const firstElemEnd = firstElemIdx + element.length;
    if (BODY_FORMS.has(element)) {
      return openCol + 2;
    }
    const firstArgIdx = skipSpaceAndComments(flaggedText, firstElemEnd);
    if (firstArgIdx !== -1) {
      const firstArgLineStart = getLineStart(flaggedText.text, firstArgIdx);
      const lineStart = getLineStart(flaggedText.text, openParenIdx);
      if (firstArgLineStart === lineStart) {
        return getColumn(flaggedText.text, firstArgIdx);
      }
    }
  }
  return openCol + 1;
}

function findOpenDelimiter(flaggedText, index, limit) {
  const stop = limit === undefined ? 0 : limit;
  let depth = 0;
  function match(c) {
    if (isCloseDelimiter(c)) {
      depth++;
    } else if (isOpenDelimiter(c)) {
      if (depth === 0) return true;
      depth--;
    }
    return false;
  }
  return scan(flaggedText, index, stop, { match });
}

function calculateIndent(flaggedText) {
  const lastCodeCharIdx = findLastCodeCharIdx(flaggedText);
  if (lastCodeCharIdx === -1) {
    return 0;
  }
  const lastCodeLineStart = getLineStart(flaggedText.text, lastCodeCharIdx);
  const unmatchedDelimiterIdx = findUnmatchedDelimiterInLine(
    flaggedText,
    lastCodeCharIdx,
    lastCodeLineStart
  );
  if (unmatchedDelimiterIdx !== -1) {
    const c = flaggedText.text[unmatchedDelimiterIdx];
    if (isOpenDelimiter(c)) {
      return formIndentation(flaggedText, unmatchedDelimiterIdx);
    }
    if (isCloseDelimiter(c)) {
      const matchingOpenIdx = findOpenDelimiter(flaggedText, unmatchedDelimiterIdx - 1);
      if (matchingOpenIdx !== -1) {
        return calculateIndent({
          text: flaggedText.text.slice(0, matchingOpenIdx) + "$",
          flags: flaggedText.flags,
        });
      }
    }
  }
  const lastCodeLine = flaggedText.text.slice(lastCodeLineStart, lastCodeCharIdx + 1);
  return (lastCodeLine.match(/^\s*/) || [""])[0].length;
}

export function calculateIndentation(prefix) {
  if (prefix === "") {
    return 0;
  }
  const flaggedText = flagCommentsAndStrings(prefix);
  if (inString(flaggedText, prefix.length - 1)) {
    return 0;
  }
  return calculateIndent(flaggedText);
}

function smartIndent(context, pos) {
  const prefix = context.state.doc.sliceString(0, pos);
  return calculateIndentation(prefix);
}

export function clojureSmartIndentExtension(indentServiceFacet) {
  return (indentServiceFacet || defaultIndentService).of(smartIndent);
}
