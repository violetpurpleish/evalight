import assert from "node:assert/strict";
import { decode, encode } from "../../src/evalight/embed/bencode.mjs";

const msg = { id: "1", op: "eval", code: "(+ 1 2)", session: "abc" };
const round = decode(encode(msg));
assert.equal(round.id, "1");
assert.equal(round.op, "eval");
assert.equal(round.code, "(+ 1 2)");
assert.equal(round.session, "abc");

const nested = decode(encode({ status: ["done", "eval-error"], value: "3" }));
assert.deepEqual(nested.status, ["done", "eval-error"]);
assert.equal(nested.value, "3");

console.log("bencode.test.mjs ok");
