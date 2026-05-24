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
});
