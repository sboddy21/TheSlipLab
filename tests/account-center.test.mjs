import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import supportHandler from "../website/api/account-support.mjs";
import exportHandler from "../website/api/account-export.mjs";
import deleteHandler from "../website/api/account-delete.mjs";

function responseRecorder() {
  return {
    headers: {}, statusCode: 200, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test("account endpoints reject unsupported methods", async () => {
  for (const [handler, method] of [[supportHandler, "GET"], [exportHandler, "POST"], [deleteHandler, "GET"]]) {
    const response = responseRecorder();
    await handler({ method, headers: {} }, response);
    assert.equal(response.statusCode, 405);
  }
});

test("account endpoints require authentication", async () => {
  for (const [handler, request] of [
    [supportHandler, { method: "POST", headers: {}, body: { category: "account", message: "A valid support message" } }],
    [exportHandler, { method: "GET", headers: {} }],
    [deleteHandler, { method: "POST", headers: {}, body: { confirmation: "DELETE" } }]
  ]) {
    const response = responseRecorder();
    await handler(request, response);
    assert.equal(response.statusCode, 401);
  }
});

test("all account-center DOM ids are unique", () => {
  const html = fs.readFileSync(new URL("../website/account.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("account-center assets are loaded", () => {
  const html = fs.readFileSync(new URL("../website/account.html", import.meta.url), "utf8");
  assert.match(html, /assets\/account-center\.css/);
  assert.match(html, /assets\/account-center\.js/);
});
