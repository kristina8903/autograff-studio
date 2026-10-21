import { describe, expect, it } from "vitest";
import { gateSession, homePathFor, isAllowedEmail, isPublicPath, normalizeEmail, parseAuthLinkType } from "./access";

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail("  Kris@AutoGraff.ai ")).toBe("kris@autograff.ai");
  });
  it("rejects things that are not addresses", () => {
    for (const bad of [
      "",
      "kris",
      "kris@",
      "@autograff.ai",
      "a b@autograff.ai",
      "a@b@autograff.ai",
      "kris@autograff",
    ]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });
});

describe("isAllowedEmail (mirrors private.email_domain_allowed)", () => {
  const domains = ["autograff.ai"];
  it("allows the company domain, case-insensitively", () => {
    expect(isAllowedEmail("ceo@autograff.ai", domains)).toBe(true);
    expect(isAllowedEmail("CEO@AutoGraff.AI", domains)).toBe(true);
  });
  it("rejects other and look-alike domains", () => {
    for (const bad of [
      "ceo@gmail.com",
      "ceo@autograff.ai.evil.com",
      "ceo@sub.autograff.ai",
      "ceo@autograff.io",
      "ceo@evil.com@autograff.ai",
    ]) {
      expect(isAllowedEmail(bad, domains), bad).toBe(false);
    }
  });
  it("rejects everything when no domains are configured", () => {
    expect(isAllowedEmail("ceo@autograff.ai", [])).toBe(false);
  });
});

describe("gateSession", () => {
  it("forbids a founder from the admin area and an admin from the founder area", () => {
    expect(gateSession({ role: "founder", area: "admin", currentLevel: "aal2", nextLevel: "aal2" })).toBe("forbidden");
    expect(gateSession({ role: "admin", area: "founder", currentLevel: "aal2", nextLevel: "aal2" })).toBe("forbidden");
  });
  it("requires an admin without an authenticator to enroll", () => {
    expect(gateSession({ role: "admin", area: "admin", currentLevel: "aal1", nextLevel: "aal1" })).toBe("enroll_mfa");
  });
  it("requires an admin with an authenticator to pass the challenge", () => {
    expect(gateSession({ role: "admin", area: "admin", currentLevel: "aal1", nextLevel: "aal2" })).toBe("verify_mfa");
  });
  it("lets an admin with a completed challenge in", () => {
    expect(gateSession({ role: "admin", area: "admin", currentLevel: "aal2", nextLevel: "aal2" })).toBe("ok");
  });
  it("does not require founders to enroll, but challenges founders who did", () => {
    expect(gateSession({ role: "founder", area: "founder", currentLevel: "aal1", nextLevel: "aal1" })).toBe("ok");
    expect(gateSession({ role: "founder", area: "founder", currentLevel: "aal1", nextLevel: "aal2" })).toBe(
      "verify_mfa",
    );
  });
  it("treats an unknown assurance level as not verified", () => {
    expect(gateSession({ role: "admin", area: "admin", currentLevel: null, nextLevel: null })).toBe("enroll_mfa");
  });
});

describe("routing helpers", () => {
  it("sends each role to its home", () => {
    expect(homePathFor("admin")).toBe("/admin");
    expect(homePathFor("founder")).toBe("/dashboard");
  });
  it("accepts only known email-link types", () => {
    expect(parseAuthLinkType("invite")).toBe("invite");
    expect(parseAuthLinkType("email")).toBe("email");
    expect(parseAuthLinkType("recovery")).toBeNull();
    expect(parseAuthLinkType("signup")).toBeNull();
    expect(parseAuthLinkType(null)).toBeNull();
  });
  it("keeps only sign-in, link confirmation and the secret-protected job tick public", () => {
    for (const path of ["/sign-in", "/sign-in/verify", "/auth/confirm", "/robots.txt", "/api/jobs/tick"])
      expect(isPublicPath(path), path).toBe(true);
    for (const path of [
      "/",
      "/admin",
      "/dashboard",
      "/mfa",
      "/auth/sign-out",
      "/sign-inx",
      "/auth/confirmed",
      "/api/jobs",
      "/api/jobs/tick/x",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});
