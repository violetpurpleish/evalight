import assert from "node:assert/strict";
import { calculateIndentation } from "../../src/evalight/cm6_smart_indent.js";

function assertSmartIndent(expected, input) {
  const prefix = input.slice(0, input.indexOf("|"));
  const indent = " ".repeat(calculateIndentation(prefix));
  const actual = input.replace("|", `\n${indent}|`);
  assert.equal(actual, expected, `input:\n${input}`);
}

assertSmartIndent("\n|", "|");
assertSmartIndent("(foo bar \n     |)", "(foo bar |)");
assertSmartIndent("(foo\n |)", "(foo|)");
assertSmartIndent("(defn foo [x]\n  |", "(defn foo [x]|");
assertSmartIndent("  (foo)\n  |", "  (foo)|");
assertSmartIndent("(foo\n      bar\n      |)", "(foo\n      bar|)");
assertSmartIndent("(foo\n  (bar\n    baz)\n  |)", "(foo\n  (bar\n    baz)|)");
assertSmartIndent('(println "Hello\n|")', '(println "Hello|")');
assertSmartIndent("(defn foo [] ; ignore )\n  |", "(defn foo [] ; ignore )|");

console.log("smart_indent.test.mjs: ok");
