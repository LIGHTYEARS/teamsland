import { describe, expect, it } from "vitest";
import { hotnessScore } from "../lifecycle.js";

describe("hotnessScore", () => {
  it("新建条目（age=0）得分约 0.80 * accessCount", () => {
    const score = hotnessScore(10, new Date(), 7);
    expect(score).toBeGreaterThan(7.5);
    expect(score).toBeLessThan(8.5);
  });

  it("age = halfLife 时得分约 0.67 * accessCount", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - halfLife * 86_400_000);
    const score = hotnessScore(10, updatedAt, halfLife);
    expect(score).toBeGreaterThan(6.0);
    expect(score).toBeLessThan(7.5);
  });

  it("age = 2*halfLife 时得分恰好 0.50 * accessCount（拐点）", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - 2 * halfLife * 86_400_000);
    const score = hotnessScore(10, updatedAt, halfLife);
    expect(score).toBeCloseTo(5.0, 1);
  });

  it("age = 3*halfLife 时得分约 0.33 * accessCount", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - 3 * halfLife * 86_400_000);
    const score = hotnessScore(10, updatedAt, halfLife);
    expect(score).toBeGreaterThan(2.5);
    expect(score).toBeLessThan(4.0);
  });

  it("accessCount=0 时返回 0", () => {
    const score = hotnessScore(0, new Date(), 7);
    expect(score).toBe(0);
  });

  it("非常旧的条目得分趋近于 0", () => {
    const updatedAt = new Date(Date.now() - 365 * 86_400_000);
    const score = hotnessScore(5, updatedAt, 7);
    expect(score).toBeLessThan(0.01);
  });

  it("高访问量抵消衰减", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - 2 * halfLife * 86_400_000);
    const lowAccess = hotnessScore(1, updatedAt, halfLife);
    const highAccess = hotnessScore(100, updatedAt, halfLife);
    expect(highAccess).toBe(100 * lowAccess);
  });

  it("默认 halfLifeDays=7", () => {
    const score = hotnessScore(10, new Date());
    expect(score).toBeGreaterThan(7.0);
  });
});
