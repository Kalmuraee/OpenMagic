import { describe, it, expect } from "vitest";
import { AbortRegistry } from "../src/abort-registry.js";

describe("AbortRegistry", () => {
  it("hands out a live (non-aborted) controller for a request id", () => {
    const reg = new AbortRegistry();
    const c = reg.register("conn1:req1");
    expect(c.signal.aborted).toBe(false);
  });

  it("aborts a specific request and reports whether it existed", () => {
    const reg = new AbortRegistry();
    const c = reg.register("conn1:req1");
    expect(reg.abort("conn1:req1")).toBe(true);
    expect(c.signal.aborted).toBe(true);
    // already removed
    expect(reg.abort("conn1:req1")).toBe(false);
    expect(reg.abort("nope")).toBe(false);
  });

  it("complete() removes a request without aborting it", () => {
    const reg = new AbortRegistry();
    const c = reg.register("conn1:req1");
    reg.complete("conn1:req1");
    expect(c.signal.aborted).toBe(false);
    // nothing left to abort
    expect(reg.abort("conn1:req1")).toBe(false);
  });

  it("aborts every request for a connection prefix and leaves others alone", () => {
    const reg = new AbortRegistry();
    const a = reg.register("conn1:req1");
    const b = reg.register("conn1:req2");
    const other = reg.register("conn2:req1");

    const count = reg.abortByPrefix("conn1:");
    expect(count).toBe(2);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });
});
