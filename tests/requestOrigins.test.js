import assert from "node:assert/strict";
import test from "node:test";
import { getTrustedOrigins } from "../lib/requestOrigins.js";

test("trusts the Vercel project production domain and deployment URL", () => {
  const origins = getTrustedOrigins({
    appBaseUrl: "https://cafeteria-management-system-abc.vercel.app",
    requestOrigin: "https://cafeteria-management-system-theta.vercel.app",
    vercelUrl: "cafeteria-management-system-abc.vercel.app",
    vercelProjectProductionUrl: "cafeteria-management-system-theta.vercel.app",
  });

  assert.equal(origins.has("https://cafeteria-management-system-theta.vercel.app"), true);
  assert.equal(origins.has("https://cafeteria-management-system-abc.vercel.app"), true);
});

test("does not trust an unrelated cross-origin request", () => {
  const origins = getTrustedOrigins({
    appBaseUrl: "https://cafeteria.example.com",
    requestOrigin: "https://cafeteria.example.com",
    vercelUrl: "cafeteria-preview.vercel.app",
    vercelProjectProductionUrl: "cafeteria.example.com",
  });

  assert.equal(origins.has("https://attacker.example"), false);
});
