import assert from "node:assert/strict";
import test from "node:test";
import { ghanaDate, ghanaTime, isMealScheduled, isWithinMealHours, mealAvailability, minutesUntil, nextMealDate, normalizeMealDays } from "../lib/mealAvailability.js";

test("meal availability opens at the scheduled minute in Ghana", () => {
  const meal = { stock: 5, available_start: "08:00", available_end: "10:30" };
  assert.equal(ghanaTime(new Date("2026-11-24T01:00:00-07:00")), "08:00");
  assert.equal(mealAvailability(meal, "07:59"), "closed");
  assert.equal(mealAvailability(meal, "08:00"), "available");
  assert.equal(mealAvailability(meal, "10:30"), "available");
  assert.equal(mealAvailability(meal, "10:31"), "closed");
  assert.equal(mealAvailability({ ...meal, stock: 0 }, "08:00"), "sold-out");
  assert.equal(mealAvailability({ ...meal, availability_status: "unavailable" }, "08:00"), "unavailable");
});

test("overnight and legacy meal hours are handled consistently", () => {
  const overnight = { available_start: "22:00", available_end: "02:00" };
  assert.equal(isWithinMealHours(overnight, "01:00"), true);
  assert.equal(isWithinMealHours(overnight, "15:00"), false);
  assert.equal(minutesUntil("23:00", "02:00"), 180);
  assert.equal(isWithinMealHours({}, "08:00"), true);
  assert.equal(isWithinMealHours({ available_start: "08:00" }, "08:00"), false);
});

test("a weekly meal opens only on selected Ghana weekdays", () => {
  const meal = { stock: 3, available_start: "08:00", available_end: "10:30", available_days: "1,4" };
  assert.equal(ghanaDate(new Date("2026-11-22T20:00:00-07:00")), "2026-11-23");
  assert.equal(mealAvailability(meal, "08:00", "2026-11-23"), "available");
  assert.equal(mealAvailability(meal, "08:00", "2026-11-24"), "closed");
  assert.equal(nextMealDate(meal, "08:00", new Date("2026-11-23T08:01:00Z")), "2026-11-26");
  assert.equal(isMealScheduled(meal, "2026-11-31", "08:00"), false);
  assert.equal(normalizeMealDays("4,1,4"), "1,4");
  assert.equal(normalizeMealDays(""), null);
});

test("an overnight meal continues into the next morning of its selected start day", () => {
  const meal = { available_start: "22:00", available_end: "02:00", available_days: "1" };
  assert.equal(isMealScheduled(meal, "2026-11-23", "01:00"), false);
  assert.equal(isMealScheduled(meal, "2026-11-24", "01:00"), true);
  assert.equal(isMealScheduled({ ...meal, available_days: undefined }, "2026-11-24", "01:00"), true);
});
