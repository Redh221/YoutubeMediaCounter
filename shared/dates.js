// Local calendar date as "2026-09-24": sorts and compares as a plain string.
export function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// The date key `days` days before the given one.
export function daysBefore(key, days) {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() - days);
  return dayKey(date);
}
