import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { setMeta, getMeta, getProjectRoot } from "./meta";

describe("meta helpers", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores and retrieves a value", () => {
    setMeta(db, "project_root", "/home/user/project");
    expect(getMeta(db, "project_root")).toBe("/home/user/project");
  });

  it("overwrites existing values", () => {
    setMeta(db, "project_root", "/first");
    setMeta(db, "project_root", "/second");
    expect(getMeta(db, "project_root")).toBe("/second");
  });

  it("returns undefined for missing key", () => {
    expect(getMeta(db, "nonexistent")).toBeUndefined();
  });

  it("getProjectRoot returns project_root value", () => {
    setMeta(db, "project_root", "/my/project");
    expect(getProjectRoot(db)).toBe("/my/project");
  });

  it("getMeta returns undefined when meta table is missing", () => {
    const db2 = new Database(":memory:");
    // Do NOT call createSchema — simulate a pre-meta database
    expect(getMeta(db2, "project_root")).toBeUndefined();
    db2.close();
  });

  it("getProjectRoot returns undefined when meta table is missing", () => {
    const db2 = new Database(":memory:");
    // Do NOT call createSchema — simulate a pre-meta database
    expect(getProjectRoot(db2)).toBeUndefined();
    db2.close();
  });
});
