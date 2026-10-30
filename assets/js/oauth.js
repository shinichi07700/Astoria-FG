/* ============================================================
   OAUTH PKCE - "Continue with Google" for the static app.

   The app talks to GoTrue over raw fetch (see sb.js) and has no
   supabase-js, so the Authorization Code + PKCE flow is done by
   hand here: build the challenge, navigate to /auth/v1/authorize,
   then exchange the code that comes back on the redirect.

   PKCE is what makes this safe for a public client: the browser
   holds only the anon key, so an intercepted authorization code is
   useless without the verifier, which never leaves this origin
   until the exchange. The verifier lives in sessionStorage for the
   one redirect hop and is dropped the moment it is spent.

   Everything here is pure and covered by tests/oauth-pkce.test.js.
   ============================================================ */
window.OAuthPKCE = (function () {
  "use strict";

  var PKCE_PATH = "token?grant_type=pkce";
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function cryptoApi() {
    var c = (typeof globalThis !== "undefined" && globalThis.crypto) ||
            (typeof window !== "undefined" && window.crypto) || null;
    if (!c || !c.subtle || !c.getRandomValues) {
      throw new Error("Web Crypto is unavailable - this page must be served over HTTPS or localhost.");
    }
    return c;
  }

  /* base64url with no padding: the alphabet GoTrue expects for the
     challenge, and a subset of RFC 7636's unreserved set for verifiers. */
  function b64url(bytes) {
    var b = bytes || [], out = "", i;
    for (i = 0; i < b.length; i += 3) {
      var b1 = i + 1 < b.length ? b[i + 1] : 0;
      var b2 = i + 2 < b.length ? b[i + 2] : 0;
      var n = (b[i] << 16) | (b1 << 8) | b2;
      out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
      if (i + 1 < b.length) out += B64[(n >>> 6) & 63];
      if (i + 2 < b.length) out += B64[n & 63];
    }
    return out;
  }

  /* 48 random bytes -> 64 base64url chars, inside RFC 7636's 43-128
     bound. Sampling the alphabet by index instead would skew the
     distribution; encoding raw bytes cannot. */
  function newVerifier() {
    var bytes = new Uint8Array(48);
    cryptoApi().getRandomValues(bytes);
    return b64url(bytes);
  }

  function challenge(verifier) {
    var data = new TextEncoder().encode(String(verifier == null ? "" : verifier));
    return cryptoApi().subtle.digest("SHA-256", data).then(function (buf) {
      return b64url(new Uint8Array(buf));
    });
  }

  /* The browser is NAVIGATED here, so no apikey header can ride along -
     /auth/v1/authorize is public by design and the anon key stays out
     of the address bar and the history. */
  function authorizeUrl(baseUrl, provider, codeChallenge, redirectTo) {
    var base = String(baseUrl || "").replace(/\/+$/, "");
    return base + "/auth/v1/authorize?" +
      "provider=" + encodeURIComponent(provider) +
      "&code_challenge=" + encodeURIComponent(codeChallenge) +
      "&code_challenge_method=S256" +
      "&redirect_to=" + encodeURIComponent(redirectTo);
  }

  /* GoTrue returns the code in the hash for PKCE and in the query for
     some provider/error paths, so both are read; the hash wins. "+" is
     form-encoding for a space, which is how error_description arrives. */
  function parseParams(str) {
    var p = {};
    String(str || "").split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) {
        p[decodeURIComponent(kv.slice(0, i))] =
          decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
      }
    });
    return p;
  }
  function parts(url) {
    var s = String(url == null ? "" : url);
    var hi = s.indexOf("#");
    var hash = hi >= 0 ? s.slice(hi + 1) : "";
    if (hi >= 0) s = s.slice(0, hi);
    var qi = s.indexOf("?");
    return { hash: parseParams(hash), query: parseParams(qi >= 0 ? s.slice(qi + 1) : "") };
  }

  function extractCode(url) {
    var u = parts(url);
    return u.hash.code || u.query.code || null;
  }

  /* A cancelled consent or a misconfigured provider lands here instead
     of a code; surface the reason rather than a generic failure. */
  function extractError(url) {
    var u = parts(url);
    return u.hash.error_description || u.query.error_description ||
           u.hash.error || u.query.error || null;
  }

  function exchangeBody(code, verifier) {
    return { auth_code: String(code || ""), code_verifier: String(verifier || "") };
  }

  var api = {
    PKCE_PATH: PKCE_PATH,
    b64url: b64url, challenge: challenge, newVerifier: newVerifier,
    authorizeUrl: authorizeUrl, extractCode: extractCode,
    extractError: extractError, exchangeBody: exchangeBody
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
