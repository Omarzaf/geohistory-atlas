/** Region-independent temporal and search helpers. GPL-3.0. */
export const CONFIG = Object.freeze({
  minYear: -600, maxYear: 1947, defaultYear: 1600,
  bounds: Object.freeze({ west: 24, east: 98, south: -2, north: 44 }),
});

export function formatYear(year) {
  if (!Number.isInteger(year) || year === 0) return 'Date unknown';
  return `${Math.abs(year)} ${year < 0 ? 'BCE' : 'CE'}`;
}

/** The navigation anchor never replaces a source's date range or uncertainty. */
export function formatRecordDate(record) {
  if (record.displayDate) return record.displayDate;
  if (Number.isInteger(record.earliestYear) && Number.isInteger(record.latestYear) && record.earliestYear !== record.latestYear) {
    return `${formatYear(record.earliestYear)}–${formatYear(record.latestYear)}`;
  }
  const precision = record.datePrecision || '';
  if (/century|centuries|editorial/i.test(precision)) return precision.split(';')[0];
  return /circa|approximate|unresolved/i.test(precision) ? `c. ${formatYear(record.year)}` : formatYear(record.year);
}

/** Undated territory overlays require a deliberate, year-specific reference choice. */
export function canShowTerritories(snapshot, year, referenceYear = null) {
  return Boolean(snapshot && (snapshot.year === year || referenceYear === year));
}

export function normalizeYear(value) {
  if (value === '' || value === null || value === undefined) return CONFIG.defaultYear;
  const year = Math.round(Number(value));
  if (!Number.isFinite(year)) return CONFIG.defaultYear;
  return Math.max(CONFIG.minYear, Math.min(CONFIG.maxYear, year === 0 ? 1 : year));
}

/** Explicitly returns the last available reference, never a future reconstruction. */
export function selectSnapshot(snapshots, year) {
  return snapshots.filter(snapshot => snapshot.year <= year)
    .reduce((latest, snapshot) => !latest || snapshot.year > latest.year ? snapshot : latest, null);
}

/** Episode dates never establish name validity; only explicit name ranges may change labels. */
export function historicalName(place, year) {
  const names = (place.history || []).filter(entry =>
    Number.isInteger(entry.nameValidFrom) && Number.isInteger(entry.nameValidTo) &&
    entry.nameValidFrom !== 0 && entry.nameValidTo !== 0 &&
    entry.nameValidFrom <= year && year <= entry.nameValidTo);
  return names.length ? names[names.length - 1].name : place.name;
}

/** A civil-year ordinal avoids a fictitious year zero in timeline arithmetic. */
export function yearToOrdinal(year) { return year < 0 ? year : year - 1; }
export function ordinalToYear(ordinal) { return ordinal < 0 ? ordinal : ordinal + 1; }
export function stepYear(year, delta) { return normalizeYear(ordinalToYear(yearToOrdinal(year) + delta)); }

export function normalizeSearch(value) {
  return String(value).normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
