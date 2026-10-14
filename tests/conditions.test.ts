import { describe, expect, it } from "vitest";
import { and, cond, cwDate, or, quote } from "@/lib/cw/conditions";

describe("condition builder", () => {
  it("escapes quotes and backslashes", () => {
    expect(quote('Bob\'s "Pizza"')).toBe('"Bob\'s \\"Pizza\\""');
    expect(quote("a\\b")).toBe('"a\\\\b"');
    expect(cond.eq("company/name", 'x" or id > 0 or name = "y')).toBe('company/name = "x\\" or id > 0 or name = \\"y"');
  });

  it("formats literals", () => {
    expect(cond.eq("closedFlag", false)).toBe("closedFlag = false");
    expect(cond.eq("board/id", 12)).toBe("board/id = 12");
    expect(cond.contains("summary", "printer")).toBe('summary like "%printer%"');
    expect(cond.contains("summary", "a%b*c")).toBe('summary like "%a b c%"');
    expect(cond.startsWith("name", "Acme")).toBe('name like "Acme%"');
    expect(cond.in("id", [1, 2, 3])).toBe("id in (1,2,3)");
  });

  it("formats dates to CW bracket syntax without millis", () => {
    expect(cwDate("2026-10-14T09:30:15.123Z")).toBe("[2026-10-14T09:30:15Z]");
    expect(cond.dateGte("timeStart", new Date("2026-01-01T00:00:00Z"))).toBe("timeStart >= [2026-01-01T00:00:00Z]");
    expect(() => cwDate("not a date")).toThrow();
  });

  it("rejects field-name injection", () => {
    expect(() => cond.eq("id = 1 or name", 1)).toThrow(/Invalid condition field/);
    expect(() => cond.eq("a/b c", 1)).toThrow();
    expect(() => cond.in("id", [1.5])).toThrow();
    expect(() => cond.eq("x", Number.NaN)).toThrow();
  });

  it("combines with and/or, skipping empties and parenthesising ors", () => {
    expect(and(undefined, false, "a = 1", "", "b = 2")).toBe("a = 1 and b = 2");
    expect(and()).toBeUndefined();
    expect(or("a = 1")).toBe("a = 1");
    expect(and("x = 1", or("a = 1", "b = 2"))).toBe("x = 1 and (a = 1 or b = 2)");
  });
});
