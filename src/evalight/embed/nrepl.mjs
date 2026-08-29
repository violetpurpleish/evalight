/**
 * Tiny nREPL client. One TCP connection, one cloned session, eval until done.
 */
import net from "node:net";
import { decodeAll, encode } from "./bencode.mjs";

function statusOf(msg) {
  const s = msg.status;
  if (!s) return [];
  return Array.isArray(s) ? s : [s];
}

export function connectNrepl(port, host = "127.0.0.1") {
  let seq = 0;
  let buf = Buffer.alloc(0);
  const pending = new Map();
  let closed = null;

  const socket = net.connect({ port, host });
  socket.setNoDelay(true);

  let settleReady;
  const ready = new Promise((resolve, reject) => {
    settleReady = { resolve, reject };
  });
  socket.once("connect", () => settleReady.resolve());
  socket.on("error", (e) => {
    closed = e;
    settleReady.reject(e);
    for (const [, wait] of pending) {
      wait.reject?.(e);
    }
    pending.clear();
  });

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { values, rest } = decodeAll(buf);
    buf = rest;
    for (const msg of values) {
      const id = msg.id;
      const wait = pending.get(id);
      if (!wait) continue;
      wait.msgs.push(msg);
      const st = statusOf(msg);
      if (st.includes("done") || st.includes("error") || st.includes("eval-error")) {
        pending.delete(id);
        wait.resolve(wait.msgs);
      }
    }
  });

  function failPending(err) {
    for (const [, wait] of pending) {
      wait.reject?.(err);
    }
    pending.clear();
  }

  socket.on("close", () => {
    if (!closed) closed = new Error("nREPL connection closed");
    failPending(closed);
  });

  function request(msg, ms = 20000) {
    if (closed) return Promise.reject(closed);
    const id = String(++seq);
    const payload = { ...msg, id };
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`nREPL timeout (${msg.op || "op"})`));
      }, ms);
      pending.set(id, {
        msgs: [],
        resolve: (msgs) => {
          clearTimeout(t);
          resolve(msgs);
        },
        reject: (err) => {
          clearTimeout(t);
          reject(err);
        },
      });
      socket.write(encode(payload));
    });
  }

  function foldEval(msgs) {
    const outs = [];
    const errs = [];
    let value;
    let ns;
    let ex;
    let status = [];
    for (const msg of msgs) {
      if (msg.out) outs.push(msg.out);
      if (msg.err) errs.push(msg.err);
      if (msg.value !== undefined) value = msg.value;
      if (msg.ns) ns = msg.ns;
      if (msg.ex) ex = msg.ex;
      status = status.concat(statusOf(msg));
    }
    const failed = status.includes("eval-error") || status.includes("error") || Boolean(ex);
    return {
      ok: !failed,
      value,
      ns,
      stdout: outs.join(""),
      stderr: errs.join(""),
      ex,
      status,
    };
  }

  return {
    socket,
    async clone() {
      await ready;
      const msgs = await request({ op: "clone" });
      const last = msgs[msgs.length - 1] || {};
      const session = last["new-session"];
      if (!session) throw new Error("nREPL clone did not return a session");
      return session;
    },
    async eval(session, code, ms = 20000, nsName) {
      await ready;
      const payload = { op: "eval", session, code };
      if (nsName) payload.ns = nsName;
      const msgs = await request(payload, ms);
      return foldEval(msgs);
    },
    close() {
      socket.destroy();
    },
  };
}

export async function pingNrepl(port, host = "127.0.0.1", ms = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const t = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, ms);
    socket.on("connect", () => {
      clearTimeout(t);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}
