import { beforeEach, describe, expect, it } from "vitest";
import { CONFIRM_TTL_MS, _resetUsedTokens, canonicalJson, issueConfirmToken, verifyConfirmToken } from "@/lib/confirm";
import { TOKEN, setEnv } from "./helpers";

const payload = { summary: "x", requests: [{ method: "POST", path: "/service/tickets/1/notes", body: { text: "hi", internalAnalysisFlag: true } }] };

describe("confirm tokens", () => {
  beforeEach(() => {
    setEnv();
    _resetUsedTokens();
  });

  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });

  it("verifies a fresh token for the same tool and payload", () => {
    const { token } = issueConfirmToken("cw_add_ticket_note", payload);
    expect(() => verifyConfirmToken(token, "cw_add_ticket_note", structuredClone(payload))).not.toThrow();
  });

  it("is single use", () => {
    const { token } = issueConfirmToken("t", payload);
    verifyConfirmToken(token, "t", payload);
    expect(() => verifyConfirmToken(token, "t", payload)).toThrow(/already used/);
  });

  it("rejects a changed payload", () => {
    const { token } = issueConfirmToken("t", payload);
    const changed = structuredClone(payload);
    changed.requests[0].body.internalAnalysisFlag = false;
    expect(() => verifyConfirmToken(token, "t", changed)).toThrow(/differs/);
  });

  it("rejects a different tool", () => {
    const { token } = issueConfirmToken("cw_add_ticket_note", payload);
    expect(() => verifyConfirmToken(token, "cw_update_ticket", payload)).toThrow(/different tool/);
  });

  it("expires after 10 minutes", () => {
    const now = Date.now();
    const { token, expiresAt } = issueConfirmToken("t", payload, { now });
    expect(Date.parse(expiresAt) - now).toBe(CONFIRM_TTL_MS);
    expect(() => verifyConfirmToken(token, "t", payload, { now: now + CONFIRM_TTL_MS + 1 })).toThrow(/expired/);
  });

  it("rejects tampered claims and bad signatures", () => {
    const { token } = issueConfirmToken("t", payload);
    const [body, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    claims.e += 10 ** 9;
    const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");
    expect(() => verifyConfirmToken(`${forged}.${sig}`, "t", payload)).toThrow(/signature/);
    expect(() => verifyConfirmToken(`${body}.AAAA`, "t", payload)).toThrow(/signature/);
    expect(() => verifyConfirmToken("garbage", "t", payload)).toThrow(/malformed/);
  });

  it("is invalidated by rotating BRIDGE_API_TOKEN", () => {
    const { token } = issueConfirmToken("t", payload);
    setEnv({ BRIDGE_API_TOKEN: TOKEN + "-rotated" });
    expect(() => verifyConfirmToken(token, "t", payload)).toThrow(/signature/);
  });
});
