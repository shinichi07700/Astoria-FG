/* ============================================================
   Golden-vector unit tests for the Google OAuth PKCE helpers.

   The crypto vectors are the published ones: RFC 7636 Appendix B
   for the S256 challenge, and the standard base64url edge cases
   (no padding, URL-safe alphabet). Getting these wrong means
   GoTrue rejects every exchange, so they are pinned exactly.
   Run: node tests/oauth-pkce.test.js
   Exits non-zero on any failure. No external dependencies.
   ============================================================ */
global.window = {};                              /* oauth.js assigns window.OAuthPKCE at load */
var O = require("../assets/js/oauth.js");

var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}
/* Async assertions: collected, then awaited before the summary prints. */
var pending = [];
function eqA(name, promise, want) {
  pending.push(Promise.resolve(promise).then(function (v) { eq(name, v, want); },
    function (e) { count++; fails++; console.log("FAIL " + name + "  threw=" + (e && e.message)); }));
}

/* ---------- PKCE_PATH: the GoTrue endpoint the code is exchanged at ---------- */
eq("PKCE_PATH is the pkce grant on the token endpoint", O.PKCE_PATH, "token?grant_type=pkce");

/* ---------- b64url: base64 without padding, URL-safe alphabet ---------- */
eq("b64url: RFC 7636 Appendix A vector", O.b64url([0, 16, 131]), "ABCD");
eq("b64url: single byte drops the padding", O.b64url([0]), "AA");
eq("b64url: two bytes drop one pad character", O.b64url([0, 16]), "ABA");
eq("b64url: + and / become - and _", O.b64url([251, 255, 190]), "-_--");
eq("b64url: empty input is the empty string", O.b64url([]), "");
eq("b64url: all-zero triple", O.b64url([0, 0, 0]), "AAAA");
eq("b64url: all-ones triple", O.b64url([255, 255, 255]), "____");

/* ---------- challenge: S256(verifier), base64url ---------- */
/* RFC 7636 Appendix B - the canonical published pair. */
eqA("challenge: RFC 7636 Appendix B vector",
  O.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
  "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
/* SHA-256 of the empty string, a second independent known digest. */
eqA("challenge: empty verifier matches the known SHA-256 digest",
  O.challenge(""), "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
eqA("challenge: output is 43 chars with no padding",
  O.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").then(function (c) { return c.length; }), 43);
eqA("challenge: is deterministic for the same verifier",
  Promise.all([O.challenge("abc123"), O.challenge("abc123")]).then(function (p) { return p[0] === p[1]; }), true);
eqA("challenge: different verifiers give different challenges",
  Promise.all([O.challenge("abc123"), O.challenge("abc124")]).then(function (p) { return p[0] !== p[1]; }), true);
eqA("challenge: never emits + or /",
  O.challenge("any-verifier-value").then(function (c) { return /[+/=]/.test(c); }), false);

/* ---------- newVerifier: RFC 7636 requires 43-128 unreserved chars ---------- */
var v1 = O.newVerifier();
eq("newVerifier: length is inside the RFC bounds", v1.length >= 43 && v1.length <= 128, true);
eq("newVerifier: uses only RFC 7636 unreserved characters", /^[A-Za-z0-9\-._~]+$/.test(v1), true);
eq("newVerifier: consecutive calls differ", O.newVerifier() !== O.newVerifier(), true);
eq("newVerifier: 100 calls are all distinct",
  (function () {
    var seen = {};
    for (var i = 0; i < 100; i++) seen[O.newVerifier()] = 1;
    return Object.keys(seen).length === 100;
  })(), true);

/* ---------- authorizeUrl: what the browser is navigated to ---------- */
var BASE = "https://proj.supabase.co";
var REDIR = "https://shinichi07700.github.io/Astoria-FG/";
var CH = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
var au = O.authorizeUrl(BASE, "google", CH, REDIR);
eq("authorizeUrl: returns a string", typeof au, "string");
eq("authorizeUrl: points at the GoTrue authorize endpoint",
  au.indexOf(BASE + "/auth/v1/authorize?"), 0);
eq("authorizeUrl: carries the provider", (function () {
  try { return new URL(au).searchParams.get("provider"); } catch (e) { return "UNPARSEABLE"; }
})(), "google");
eq("authorizeUrl: declares the S256 challenge method", (function () {
  try { return new URL(au).searchParams.get("code_challenge_method"); } catch (e) { return "UNPARSEABLE"; }
})(), "S256");
eq("authorizeUrl: carries the challenge verbatim", (function () {
  try { return new URL(au).searchParams.get("code_challenge"); } catch (e) { return "UNPARSEABLE"; }
})(), CH);
eq("authorizeUrl: carries the redirect target", (function () {
  try { return new URL(au).searchParams.get("redirect_to"); } catch (e) { return "UNPARSEABLE"; }
})(), REDIR);
eq("authorizeUrl: a trailing slash on the base URL is not doubled",
  O.authorizeUrl(BASE + "/", "google", CH, REDIR).indexOf("//auth"), -1);
eq("authorizeUrl: no apikey is leaked into the navigated URL", au.indexOf("apikey"), -1);

/* ---------- extractCode: the redirect can carry the code in hash or query ---------- */
eq("extractCode: hash form (GoTrue PKCE redirect)",
  O.extractCode("https://site.test/#code=abc123"), "abc123");
eq("extractCode: query form",
  O.extractCode("https://site.test/?code=abc123"), "abc123");
eq("extractCode: code among other hash params",
  O.extractCode("https://site.test/#code=abc123&scope=email"), "abc123");
eq("extractCode: code among other query params",
  O.extractCode("https://site.test/?state=x&code=abc123&y=1"), "abc123");
eq("extractCode: percent-encoded value is decoded",
  O.extractCode("https://site.test/#code=ab%2Bcd%3D"), "ab+cd=");
eq("extractCode: hash wins when both are present",
  O.extractCode("https://site.test/?code=fromquery#code=fromhash"), "fromhash");
eq("extractCode: an error redirect yields no code",
  O.extractCode("https://site.test/#error=access_denied&error_description=User+cancelled"), null);
eq("extractCode: an implicit-flow token is not a PKCE code",
  O.extractCode("https://site.test/#access_token=xyz&type=recovery"), null);
eq("extractCode: a clean app URL yields no code",
  O.extractCode("https://site.test/"), null);
eq("extractCode: empty string yields no code", O.extractCode(""), null);
eq("extractCode: null yields no code", O.extractCode(null), null);
eq("extractCode: undefined yields no code", O.extractCode(undefined), null);
eq("extractCode: a code= prefix with an empty value yields no code",
  O.extractCode("https://site.test/#code="), null);

/* ---------- extractError: a cancelled or misconfigured redirect must say why ---------- */
eq("extractError: surfaces the provider's description",
  O.extractError("https://site.test/#error=access_denied&error_description=User+cancelled"), "User cancelled");
eq("extractError: falls back to the error code",
  O.extractError("https://site.test/#error=server_error"), "server_error");
eq("extractError: a successful code redirect has no error",
  O.extractError("https://site.test/#code=abc123"), null);
eq("extractError: a clean URL has no error", O.extractError("https://site.test/"), null);
eq("extractError: null is safe", O.extractError(null), null);

/* ---------- exchangeBody: the payload GoTrue's pkce grant expects ---------- */
eq("exchangeBody: exact shape", JSON.stringify(O.exchangeBody("the-code", "the-verifier")),
  JSON.stringify({ auth_code: "the-code", code_verifier: "the-verifier" }));

Promise.all(pending).then(function () {
  console.log("\nRESULT: " + (fails ? fails + " FAILED" : "ALL PASS") + " (" + count + " vectors)");
  process.exit(fails ? 1 : 0);
});
