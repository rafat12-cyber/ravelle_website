// Live-site admin lock: with PUBLIC_URL=https://ravellebd.com the sign-in only works at https://ravellebd.com/admin.
// Run with: node server/admin-lock-test.js (part of npm test)
"use strict";
var http = require("http");
var fs = require("fs");
var path = require("path");
var spawn = require("child_process").spawn;
var assert = require("assert");

var ROOT = path.resolve(__dirname, "..");
var dirName = "data-locktest-" + process.pid;
var PORT = 4500 + Math.floor(Math.random() * 400);
var child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: Object.assign({}, process.env, { PORT: PORT, DATA_DIR: dirName, PUBLIC_URL: "https://ravellebd.com", ADMIN_EMAIL: "owner@test.com", ADMIN_PASSWORD: "test-password-1", TRUST_PROXY: "1", ADMIN_LOCK: "" }),
  stdio: ["ignore", "pipe", "inherit"]
});
function call(method, p, headers, body) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : "";
    var req = http.request({ host: "127.0.0.1", port: PORT, path: p, method: method,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, headers) }, function (res) {
      var b = []; res.on("data", function (c) { b.push(c); });
      res.on("end", function () { var t = Buffer.concat(b).toString(), j; try { j = JSON.parse(t); } catch (e) { j = t; } resolve({ status: res.statusCode, body: j, headers: res.headers }); });
    });
    req.on("error", reject); req.end(data);
  });
}
var site = { Host: "ravellebd.com", "X-Forwarded-Proto": "https" };
var login = { email: "owner@test.com", password: "test-password-1" };
function h(extra) { return Object.assign({}, site, extra); }

async function main() {
  for (var i = 0; i < 50; i++) { try { await call("GET", "/api/health", site); break; } catch (e) { await new Promise(function (r) { setTimeout(r, 100); }); } }

  var r = await call("GET", "/admin", site);
  assert.strictEqual(r.status, 200, "admin page on the real address");
  r = await call("GET", "/admin.html", site);
  assert.strictEqual(r.status, 404, "/admin.html is gone");
  r = await call("GET", "/admin", { Host: "www.ravellebd.com" });
  assert.strictEqual(r.status, 301); assert.strictEqual(r.headers.location, "https://ravellebd.com/admin", "www goes to the real address");
  r = await call("GET", "/admin?reset=abc", { Host: "203.0.113.5:" + PORT });
  assert.strictEqual(r.headers.location, "https://ravellebd.com/admin?reset=abc", "server IP goes to the real address and keeps the reset link");
  r = await call("GET", "/admin", { Host: "ravellebd.com", "X-Forwarded-Proto": "http" });
  assert.strictEqual(r.status, 301, "plain http goes to https");

  r = await call("POST", "/api/auth/login", h({ Origin: "https://ravellebd.com" }), login);
  assert.strictEqual(r.status, 200, "sign-in from the admin page works"); assert.ok(r.body.token);
  var token = r.body.token;
  r = await call("POST", "/api/auth/login", h({ Origin: "https://evil.example" }), login);
  assert.strictEqual(r.status, 403, "sign-in from another site is refused");
  r = await call("POST", "/api/auth/login", h({}), login);
  assert.strictEqual(r.status, 403, "sign-in from a script with no page is refused");
  r = await call("POST", "/api/auth/login", { Host: "www.ravellebd.com", Origin: "https://www.ravellebd.com" }, login);
  assert.strictEqual(r.status, 403, "sign-in on www is refused");
  r = await call("POST", "/api/auth/forgot", h({ Origin: "https://evil.example" }), { email: "owner@test.com" });
  assert.strictEqual(r.status, 403, "password reset requests from elsewhere are refused");
  r = await call("GET", "/api/auth/reset/nope", h({ Referer: "https://ravellebd.com/admin?reset=nope" }));
  assert.notStrictEqual(r.status, 403, "reset link check works from the admin page");

  // Once signed in, the token still works for the admin's other calls and for API keys from other software
  r = await call("GET", "/api/auth/me", h({ Authorization: "Bearer " + token }));
  assert.strictEqual(r.status, 200, "signed-in calls are not affected");
  r = await call("GET", "/api/store", { Host: "whatever" });
  assert.strictEqual(r.status, 200, "the public store API is not affected");
  r = await call("GET", "/", { Host: "www.ravellebd.com" });
  assert.strictEqual(r.status, 200, "the storefront is not affected");
  console.log("Admin lock tests passed");
}
main().then(function () { done(0); }, function (e) { console.error(e); done(1); });
function done(code) {
  child.on("exit", function () { fs.rmSync(path.join(ROOT, dirName), { recursive: true, force: true }); process.exit(code); });
  child.kill();
}
