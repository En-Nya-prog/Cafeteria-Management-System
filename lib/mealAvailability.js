const ghanaClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Accra",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const ghanaCalendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Accra", dateStyle: "short" });
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAILY_MEAL_DAYS = "0,1,2,3,4,5,6";

export function normalizeMealDays(value) {
  if (typeof value !== "string" || !/^[0-6](,[0-6]){0,6}$/.test(value)) return null;
  return [...new Set(value.split(","))].sort().join(",");
}

export function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function ghanaTime(date) {
  return ghanaClock.format(date);
}

export function ghanaDate(date) {
  return ghanaCalendar.format(date);
}

export function isCalendarDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function isWithinMealHours(meal, time) {
  if (!isTime(time)) return false;
  const { available_start: start, available_end: end } = meal;
  if (!start && !end) return true;
  if (!isTime(start) || !isTime(end)) return false;
  return start <= end ? time >= start && time <= end : time >= start || time <= end;
}

export function isMealScheduled(meal, date, time) {
  if (!isCalendarDate(date) || !isWithinMealHours(meal, time)) return false;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const { available_start: start, available_end: end } = meal;
  const scheduledDay = start > end && time <= end ? (day + 6) % 7 : day;
  return (meal.available_days || DAILY_MEAL_DAYS).split(",").includes(String(scheduledDay));
}

export function nextMealDate(meal, time, now) {
  if (!isTime(time)) return null;
  const today = ghanaDate(now);
  const midnight = Date.parse(`${today}T00:00:00Z`);
  for (let offset = time < ghanaTime(now) ? 1 : 0; offset <= 7; offset++) {
    const date = ghanaDate(new Date(midnight + offset * 86400000));
    if (isMealScheduled(meal, date, time)) return date;
  }
  return null;
}

export function mealAvailability(meal, time, date) {
  if (meal.availability_status === "sold_out") return "sold-out";
  if (meal.availability_status && meal.availability_status !== "available") return "unavailable";
  if (Number(meal.stock) <= 0) return "sold-out";
  return (date ? isMealScheduled(meal, date, time) : isWithinMealHours(meal, time)) ? "available" : "closed";
}

export function minutesUntil(time, end) {
  if (!isTime(time) || !isTime(end)) return null;
  const toMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  return (toMinutes(end) - toMinutes(time) + 1440) % 1440;
}
