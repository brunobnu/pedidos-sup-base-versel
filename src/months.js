export const MONTHS = [
  { n: 1, label: "Jan" },
  { n: 2, label: "Fev" },
  { n: 3, label: "Mar" },
  { n: 4, label: "Abr" },
  { n: 5, label: "Mai" },
  { n: 6, label: "Jun" },
  { n: 7, label: "Jul" },
  { n: 8, label: "Ago" },
  { n: 9, label: "Set" },
  { n: 10, label: "Out" },
  { n: 11, label: "Nov" },
  { n: 12, label: "Dez" },
];

export const CURRENT_YEAR = 2026;
export const CURRENT_MONTH = 4;

export function key(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
