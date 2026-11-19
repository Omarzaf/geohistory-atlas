/** Aligned editorial periods and dated events; geometry remains independently dated. */
import { CONFIG, formatYear, formatRecordDate, yearToOrdinal, ordinalToYear } from './model.mjs';

const $ = (id) => document.getElementById(id);
const minOrdinal = yearToOrdinal(CONFIG.minYear);
const maxOrdinal = yearToOrdinal(CONFIG.maxYear);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function createTimeline({ manifest, chronicle, learning, onYear, onEvent, onMode, onSpeed, onWindow }) {
  let mode = 'maps';
  let speed = 1;
  let selectedYear = CONFIG.defaultYear;
  let from = minOrdinal;
  let to = maxOrdinal;
  let lastWindow = '';
  const events = [...chronicle.events].sort((a, b) => a.year - b.year);
  const periods = learning?.periods || [];
  const percent = (year) => 100 * (yearToOrdinal(year) - from) / (to - from);

  function constrainWindow(start, end) {
    const span = Math.min(maxOrdinal - minOrdinal, Math.max(80, end - start));
    from = Math.round(Math.max(minOrdinal, Math.min(maxOrdinal - span, start)));
    to = Math.round(from + span);
  }

  function render(year) {
    selectedYear = year;
    const ordinal = yearToOrdinal(year);
    if (ordinal < from || ordinal > to) constrainWindow(ordinal - (to - from) / 2, ordinal + (to - from) / 2);
    const windowKey = `${from}:${to}`;
    if (windowKey !== lastWindow) {
      $('period-ribbon').innerHTML = periods.filter((period) => yearToOrdinal(period.toYear) >= from && yearToOrdinal(period.fromYear) <= to).map((period, index) => {
        const left = Math.max(0, percent(period.fromYear));
        const right = Math.min(100, percent(period.toYear));
        return `<button type="button" class="period-segment period-tone-${index % 4}" data-period-id="${esc(period.id)}" style="left:${left}%;width:${Math.max(.1, right - left)}%" title="${esc(period.title)} · ${esc(formatYear(period.fromYear))}–${esc(formatYear(period.toYear))}" aria-label="Explore ${esc(period.title)}, ${esc(formatYear(period.fromYear))} to ${esc(formatYear(period.toYear))}"><span>${esc(period.title)}</span></button>`;
      }).join('');
      const visibleEvents = events.filter((event) => yearToOrdinal(event.year) >= from && yearToOrdinal(event.year) <= to);
      const occupied = [-100, -100, -100];
      $('event-ticks').innerHTML = visibleEvents.map((event) => {
        const x = percent(event.year);
        let row = occupied.findIndex((previous) => x - previous > 2.2);
        if (row < 0) row = occupied.indexOf(Math.min(...occupied));
        occupied[row] = x;
        return `<button type="button" class="timeline-event" data-timeline-event="${esc(event.id)}" style="left:${x}%;--event-row:${row}" title="${esc(formatRecordDate(event))} · ${esc(event.title)}" aria-label="${esc(event.title)}, ${esc(formatRecordDate(event))}"><span class="event-diamond"></span><span class="timeline-event-label"><time>${esc(formatRecordDate(event))}</time>${esc(event.title)}</span></button>`;
      }).join('');
      $('timeline-from').textContent = formatYear(ordinalToYear(from));
      $('timeline-to').textContent = formatYear(ordinalToYear(to));
      $('year-slider').min = from;
      $('year-slider').max = to;
      lastWindow = windowKey;
    }
    $('year-slider').value = ordinal;
    for (const button of $('period-ribbon').children) {
      const period = periods.find((item) => item.id === button.dataset.periodId);
      const active = period && period.fromYear <= year && period.toYear >= year;
      button.classList.toggle('active', Boolean(active));
      button.setAttribute('aria-pressed', String(Boolean(active)));
    }
    for (const button of $('event-ticks').children) {
      const active = events.find((event) => event.id === button.dataset.timelineEvent)?.year === year;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of $('snapshot-ticks').children) {
      const x = percent(Number(button.dataset.year));
      button.style.left = `${x}%`;
      // Mobile shortcuts retain every source-map date, independent of the zoomed ruler.
      button.classList.toggle('outside-window', x < 0 || x > 100);
    }
    $('timeline-zoom-in').disabled = to - from <= 80;
    $('timeline-zoom-out').disabled = from === minOrdinal && to === maxOrdinal;
    $('timeline-reset').disabled = from === minOrdinal && to === maxOrdinal;
    $('timeline-window-note').textContent = from === minOrdinal && to === maxOrdinal ? 'Selected maps · events · editorial periods' : `${to - from + 1} year window · periods are editorial`;
  }

  function zoomTimeline(factor) {
    const width = (to - from) * factor;
    const center = yearToOrdinal(selectedYear);
    constrainWindow(center - width / 2, center + width / 2);
    render(selectedYear);
    onWindow?.({ from: ordinalToYear(from), to: ordinalToYear(to) });
  }

  $('period-ribbon').addEventListener('click', (event) => {
    const button = event.target.closest('[data-period-id]');
    if (!button) return;
    const period = periods.find((item) => item.id === button.dataset.periodId);
    if (period) onYear?.(period.fromYear, { reason: 'period' });
  });
  $('event-ticks').addEventListener('click', (event) => {
    const button = event.target.closest('[data-timeline-event]');
    if (button) onEvent?.(button.dataset.timelineEvent);
  });
  for (const button of document.querySelectorAll('[data-playback-mode]')) {
    button.addEventListener('click', () => {
      setMode(button.dataset.playbackMode);
      onMode?.(mode);
    });
  }
  $('playback-speed').addEventListener('change', (event) => {
    speed = Math.max(1, Math.min(3, Number(event.target.value) || 1));
    onSpeed?.(speed);
  });
  $('timeline-zoom-in').addEventListener('click', () => zoomTimeline(.5));
  $('timeline-zoom-out').addEventListener('click', () => zoomTimeline(2));
  $('timeline-reset').addEventListener('click', () => {
    from = minOrdinal; to = maxOrdinal;
    render(selectedYear);
    onWindow?.({ from: ordinalToYear(from), to: ordinalToYear(to) });
  });
  function setExpanded(expanded) {
    $('timeline-expand').setAttribute('aria-expanded', String(expanded));
    $('chronology-button').setAttribute('aria-expanded', String(expanded));
    document.querySelector('.timeline').classList.toggle('is-expanded', expanded);
    $('timeline-expand').firstChild.textContent = expanded ? 'Close ' : 'More ';
    $('chronology-button').firstChild.textContent = expanded ? 'Close chronology ' : 'Chronology ';
    if (expanded) requestAnimationFrame(() => {
      const nearest = [...events].sort((a, b) => Math.abs(a.year - selectedYear) - Math.abs(b.year - selectedYear))[0];
      for (const [strip, target] of [
        [$('snapshot-ticks'), $('snapshot-ticks').querySelector('.active')],
        [$('period-ribbon'), $('period-ribbon').querySelector('.active')],
        [$('event-ticks'), [...$('event-ticks').children].find(button => button.dataset.timelineEvent === nearest?.id)],
      ]) {
        if (!target) continue;
        const outer = strip.getBoundingClientRect(); const inner = target.getBoundingClientRect();
        strip.scrollLeft += inner.left + inner.width / 2 - outer.left - outer.width / 2;
      }
    });
    if (!expanded && $('timeline-details').contains(document.activeElement)) $('chronology-button').focus({ preventScroll: true });
  }
  $('timeline-expand').addEventListener('click', () => setExpanded($('timeline-expand').getAttribute('aria-expanded') !== 'true'));
  $('chronology-button').addEventListener('click', () => setExpanded($('chronology-button').getAttribute('aria-expanded') !== 'true'));

  function setMode(value) {
    mode = value === 'events' ? 'events' : 'maps';
    for (const button of document.querySelectorAll('[data-playback-mode]')) button.setAttribute('aria-pressed', String(button.dataset.playbackMode === mode));
  }

  return Object.freeze({
    render,
    getMode: () => mode,
    setMode,
    getSpeed: () => speed,
    getWindow: () => ({ from: ordinalToYear(from), to: ordinalToYear(to) }),
    restoreWindow: (start, end) => {
      const valid = Number.isInteger(start) && Number.isInteger(end) && start !== 0 && end !== 0 && start < end && start >= CONFIG.minYear && end <= CONFIG.maxYear;
      if (valid) constrainWindow(yearToOrdinal(start), yearToOrdinal(end));
      else { from = minOrdinal; to = maxOrdinal; }
      lastWindow = '';
    },
  });
}
