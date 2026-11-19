import { createLearningViews } from './learning.mjs';
import { createMapDetails } from './mapDetails.mjs';
import { createTimeline } from './timeline.mjs';
import { embedded, scrollEmbeddedSection } from './embed.mjs';
import { MercatorProjector } from './geometry.mjs';
import { CONFIG, formatYear, formatRecordDate, canShowTerritories, normalizeYear, selectSnapshot, historicalName, normalizeSearch, stepYear, yearToOrdinal, ordinalToYear } from './model.mjs';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1200;
const HEIGHT = 760;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = (name) => `<svg viewBox="0 0 20 20" aria-hidden="true">${({ back: '<path d="m12 5-5 5 5 5"/>', next: '<path d="m8 5 5 5-5 5"/>', play: '<path d="m7 4 9 6-9 6z"/>', pause: '<path d="M7 4v12M13 4v12"/>' })[name] || ''}</svg>`;
const safeUrl = (url) => { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; } };
const sourceLink = (url, title) => safeUrl(url) ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : esc(title);
const recordYear = formatRecordDate;
const dateNote = (record) => record.datePrecision && record.datePrecision !== 'year' ? `<p class="record-note">Date: ${esc(record.datePrecision)}. The timeline year is a navigation reference.</p>` : '';
const reviewNote = (record) => record.reviewStatus ? `<p class="source-status">${esc(record.reviewStatus === 'historical coverage pending' ? 'Historical account pending; reference location only.' : 'Sources checked; independent human scholarly review pending.')}</p>` : '';
const labelForRange = (from, to) => Number.isInteger(from) && Number.isInteger(to) ? `${formatYear(from)}–${formatYear(to)}` : Number.isInteger(from) ? `From ${formatYear(from)}; end unknown` : Number.isInteger(to) ? `Recorded by ${formatYear(to)}; start unknown` : 'Date range not established';

let learning;
let learningViews;
let mapDetails;
let timeline;
let quizIndex = null;
let quizAnswer = null;
let quizScore = 0;
let eventFilter = 'all';
let atlas;
let manifest;
let chronicle;
let base;
let projector;
let sourceById;
let placeById;
let snapshot = null;
let snapshotData = null;
let state = { year: CONFIG.defaultYear, pane: 'overview', selected: null, journey: null, stop: 0, story: null, storyStep: 0, connection: null, referenceYear: null };
let camera = { x: 0, y: 0, k: 1 };
let playing = false;
let playTimer;
let toastTimer;
let tipTimer;
let lastRenderedSnapshot = null;
let urlTimer;
let gesture;
let hasMoved = false;
let placeFrame;
let placeLabelBoxes = [];
let cameraFrame;
let welcomeViewport = '';
let readerReturnTarget;
const initialParams = new URLSearchParams(location.search);
initialParams.delete('embed');
const experience = { welcome: initialParams.size === 0, readerOpen: initialParams.size > 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const compactLayout = matchMedia('(max-width:950px), (max-height:520px)');
const sectionForPane = { journeys: 'journeys-section', learn: 'stories-section', about: 'sources-section' };
const pointers = new Map();
const svg = $('map');

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function announce(message) { $('announcement').textContent = message; }

/** Keep the map, reading leaf and journey instrument in one explicit UI state. */
function syncExperience() {
  document.body.dataset.mode = experience.welcome ? 'welcome' : state.journey ? 'journey' : 'atlas';
  document.body.dataset.reader = experience.readerOpen ? 'open' : 'closed';
  $('reading-pane').inert = !experience.readerOpen;
  $('reading-toggle').setAttribute('aria-expanded', String(experience.readerOpen));
  $('map-intro').hidden = !experience.welcome;
  $('map-story-note').hidden = !experience.welcome && !state.journey && !state.connection;
  $('map-story-note').textContent = state.journey ? 'Documented stops · schematic connections, not reconstructed routes' : 'Selected stops · schematic connections, not routes';
}

function scrollToSection(id, { focus = true, instant = false } = {}) {
  const section = $(id);
  if (!section) return;
  if (focus) { section.tabIndex = -1; section.focus({ preventScroll: true }); }
  const behavior = instant || reducedMotion.matches ? 'instant' : 'smooth';
  if (!scrollEmbeddedSection(section, behavior)) section.scrollIntoView({ behavior, block: 'start' });
  const url = new URL(location.href); url.hash = id; history.replaceState(null, '', url);
}

function setReader(open, { focus = false } = {}) {
  if (open && !experience.readerOpen) readerReturnTarget = document.activeElement;
  experience.readerOpen = open;
  if (open) experience.welcome = false;
  syncExperience();
  if (focus) {
    if (open) $('reading-pane').focus({ preventScroll: true });
    else if (readerReturnTarget?.isConnected && readerReturnTarget.offsetParent) readerReturnTarget.focus({ preventScroll: true });
    else $('reading-toggle').focus({ preventScroll: true });
  }
}

function enterAtlas({ read = false } = {}) {
  stopPlayback();
  state.pane = 'overview'; state.journey = null; state.story = null; state.connection = null; state.selected = null; quizIndex = null;
  experience.welcome = false;
  setReader(read);
  render();
  updateUrl();
}

/** Preview highlights are a documented subset, not a reconstructed route. */
function renderWelcomeMap() {
  const layer = $('welcome-layer');
  layer.replaceChildren();
  if (!experience.welcome) return;
  const highlights = ['cairo', 'delhi', 'kozhikode'].map(id => placeById.get(id)).filter(place => place?.coord);
  layer.append(svgNode('path', { d: linePath(highlights.map(place => place.coord)), fill: 'none', class: 'welcome-connection', 'aria-hidden': 'true' }));
  const metrics = symbolMetrics();
  for (const place of highlights) {
    const [x, y] = projector.toScreen(...place.coord);
    const group = svgNode('g', { class: 'welcome-stop', transform: `translate(${x} ${y}) scale(${metrics.unitsPerPixel})`, 'data-highlight-place': place.id });
    group.append(svgNode('circle', { r: 22, fill: 'transparent', stroke: 'none', class: 'map-symbol-hit', 'aria-hidden': 'true' }), svgNode('circle', { r: 7 }));
    const labelToLeft = compactLayout.matches && place.id !== 'cairo';
    const label = svgNode('text', { x: labelToLeft ? -13 : 13, y: -10, 'text-anchor': labelToLeft ? 'end' : 'start' }); label.textContent = place.name;
    const title = svgNode('title'); title.textContent = `Explore the documented ${place.name} stop`;
    group.append(label, title);
    group.addEventListener('click', () => {
      if (hasMoved) return;
      const journey = chronicle.journeys[0];
      openJourney(journey.id, journey.stops.findIndex(stop => stop.placeId === place.id));
    });
    layer.append(group);
  }
}

function renderJourneyRibbon() {
  const journey = chronicle.journeys.find(item => item.id === state.journey) || chronicle.journeys[0];
  const visible = experience.welcome || Boolean(state.journey);
  $('journey-ribbon').hidden = !visible;
  if (!visible || !journey) return;
  $('ribbon-title').textContent = journey.person || journey.name;
  const indices = experience.welcome ? [1, 8, 9] : journey.stops.map((_, index) => index);
  const signature = `${journey.id}:${experience.welcome}:${state.stop}`;
  if ($('journey-stops').dataset.signature !== signature) {
    const focusedStop = $('journey-stops').contains(document.activeElement) ? document.activeElement.dataset.ribbonStop : undefined;
    $('journey-stops').dataset.signature = signature;
    $('journey-stops').innerHTML = indices.map(index => {
      const stop = journey.stops[index];
      const name = placeById.get(stop.placeId)?.name || stop.title;
      return `<button class="ribbon-stop${state.journey && state.stop === index ? ' active' : ''}" type="button" data-ribbon-stop="${index}" aria-label="Open stop ${index + 1}: ${esc(name)}, ${esc(recordYear(stop))}" ${state.journey && state.stop === index ? 'aria-current="step"' : ''}><span class="ribbon-number">${index + 1}</span><span>${esc(name)}<time>${esc(recordYear(stop))}</time></span></button>`;
    }).join('');
    if (focusedStop !== undefined) $('journey-stops').querySelector(`[data-ribbon-stop="${focusedStop}"]`)?.focus({ preventScroll: true });
  }
  $('journey-toggle').textContent = playing && state.journey ? 'Pause stops' : 'Play stops';
  $('journey-toggle').setAttribute('aria-pressed', String(playing && Boolean(state.journey)));
  $('ribbon-fit').hidden = experience.welcome;
  requestAnimationFrame(() => {
    const button = $('journey-stops').querySelector('.active');
    if (!button) return;
    const inner = button.getBoundingClientRect(); const outer = $('journey-stops').getBoundingClientRect();
    if (inner.left < outer.left || inner.right > outer.right) $('journey-stops').scrollTo({ left: $('journey-stops').scrollLeft + inner.left - outer.left - (outer.width - inner.width) / 2, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  });
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function tip(message) {
  clearTimeout(tipTimer);
  $('map-tip').textContent = message;
  $('map-tip').hidden = false;
  tipTimer = setTimeout(() => { $('map-tip').hidden = true; }, 3600);
}

function getSources(ids = []) {
  return [...new Set(ids)].map((id) => sourceById.get(id)).filter(Boolean);
}

function sourcesHtml(ids = [], open = false) {
  const sources = getSources(ids);
  if (!sources.length) return '';
  return `<details class="sources-details" ${open ? 'open' : ''}><summary>${sources.length} reference${sources.length === 1 ? '' : 's'} for this record</summary><ol class="source-list">${sources.map(source => `<li>${sourceLink(source.url, source.title)}<small>${esc(source.publisher || '')}${source.license ? ` · ${esc(source.license)}` : ''}</small>${source.locator ? `<p class="source-locator">Passage: ${esc(source.locator)}</p>` : ''}${source.evidenceFamily ? `<small>Evidence family: ${esc(source.evidenceFamily)}</small>` : ''}${source.relationshipNote ? `<p class="source-locator">${esc(source.relationshipNote)}</p>` : ''}</li>`).join('')}</ol><p class="record-note">Reference count is not a count of independent witnesses.</p></details>`;
}

function evidenceHtml(record) {
  return `${record.locationNote ? `<p class="record-note"><strong>Map anchor:</strong> ${esc(record.locationNote)}</p>` : ''}${record.sourceIndependenceNote ? `<div class="evidence-note"><strong>How the evidence connects</strong><p>${esc(record.sourceIndependenceNote)}</p></div>` : ''}${record.claims?.length ? `<details class="claim-evidence"><summary>Evidence for individual claims</summary><ol>${record.claims.map(claim => `<li><p>${esc(claim.text)}</p>${sourcesHtml(claim.sourceIds)}</li>`).join('')}</ol></details>` : ''}`;
}

function territoriesVisible() {
  return $('layer-territories').checked && canShowTerritories(snapshot, state.year, state.referenceYear);
}

function syncTerritoryVisibility() {
  const visible = territoriesVisible();
  $('territory-layer').style.display = visible ? '' : 'none';
  $('polity-label-layer').style.display = visible && $('layer-labels').checked ? '' : 'none';
  $('legend').hidden = !visible;
}

function setActiveTab(pane) {
  for (const key of ['overview', 'places', 'journeys', 'events', 'learn']) {
    const button = $(`tab-${key}`);
    button.classList.toggle('active', pane === key);
    if (pane === key) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function showPane(pane, { scroll = false } = {}) {
  setReader(!sectionForPane[pane]);
  state.pane = pane;
  state.selected = null;
  state.story = null; state.connection = null; quizIndex = null;
  state.journey = null; state.stop = 0;
  stopPlayback();
  render();
  updateUrl();
  if (sectionForPane[pane]) scrollToSection(sectionForPane[pane]);
  else if (scroll) revealReadingPane();
}

function revealReadingPane() {
  setReader(true);
  const pane = $('reading-pane');
  pane.scrollTop = 0;
  scrollToSection('reading-pane');
}

function nearbyEvents(limit = 5) {
  return [...chronicle.events].sort((a, b) => Math.abs(a.year - state.year) - Math.abs(b.year - state.year)).slice(0, limit).sort((a, b) => a.year - b.year);
}

function eventListHtml(events) {
  if (!events.length) return '<p class="empty-note">No event records are available in this view.</p>';
  return `<ol class="event-list">${events.map((event) => `<li class="event-item"><button type="button" class="event-button" data-event="${esc(event.id)}"><time>${esc(recordYear(event))}</time><span>${esc(event.title)}</span></button></li>`).join('')}</ol>`;
}

function coverageText() {
  if (!snapshot) return `No territory reconstruction for ${formatYear(state.year)}. The earliest available map is ${formatYear(manifest.snapshots[0].year)}.`;
  if (snapshot.year === state.year) return `Map dated ${formatYear(snapshot.year)} · approximate historical territories`;
  return territoriesVisible() ? `Optional reference map: ${formatYear(snapshot.year)} · ${yearToOrdinal(state.year) - yearToOrdinal(snapshot.year)} years earlier. It does not reconstruct ${formatYear(state.year)}.` : `No territory reconstruction for ${formatYear(state.year)}. Borders are hidden; an older ${formatYear(snapshot.year)} reference is available on the map.`;
}

function renderOverview() {
  const period = learning.periods.find(item => item.fromYear <= state.year && item.toYear >= state.year);
  const title = snapshot?.year === state.year ? snapshot.title : period?.title || `Explore ${formatYear(state.year)}`;
  const description = snapshot?.description || snapshotData?.note || 'Explore connected histories through selected, source-dated maps. Choose a territory or a reference place to read its record.';
  const sourceUrl = snapshot?.sourceUrl || snapshotData?.sourceUrl;
  const journey = chronicle.journeys[0];
  return `<div class="overview-intro"><h1>${esc(title)}</h1><p class="reading-intro">${esc(period?.summary || description)}</p></div><div class="field-note"><strong>Start with a question</strong><p>${esc(period?.prompt || 'How do places connect across changing borders?')}</p><button class="inline-action" type="button" data-pane="learn">Explore guided stories</button></div><p class="coverage-note">${esc(coverageText())}</p>${sourceUrl && territoriesVisible() ? `<p class="record-note">Territories: ${sourceLink(sourceUrl, 'Historical Basemaps source snapshot')}.</p>` : ''}${snapshot?.note && territoriesVisible() ? `<p class="record-note">${esc(snapshot.note)}</p>` : ''}${sourcesHtml([...(territoriesVisible() ? snapshot?.sourceIds || [] : []), ...(period?.sourceIds || [])])}<h3>Events near this year</h3>${eventListHtml(nearbyEvents())}${journey ? `<h3>Follow a journey</h3><div class="journey-preview"><h3>${esc(journey.name)}</h3><p>${esc(journey.summary)}</p><button type="button" class="inline-action" data-journey="${esc(journey.id)}">Explore the documented stops</button></div>` : ''}<p class="record-note" style="margin-top:24px">Maps show selected dates, not a complete annual history. Blank areas mean coverage is absent or unresolved.</p>`;
}

function renderEvents() {
  const filters = ['all', ...new Set(chronicle.places.map(place => place.region).filter(Boolean))];
  const events = [...chronicle.events].filter(event => eventFilter === 'all' || placeById.get(event.placeId)?.region === eventFilter).sort((a, b) => a.year - b.year);
  return `<h1>Moments that changed the map.</h1><p class="reading-intro">Explore political change, cities, scholarship, and movement. An event date and a territory-map date are different kinds of evidence.</p><div class="event-filters"><label for="event-region">Region</label><select id="event-region">${filters.map(region => `<option value="${esc(region)}" ${eventFilter === region ? 'selected' : ''}>${esc(region === 'all' ? 'All regions' : region)}</option>`).join('')}</select></div><p class="record-note">${events.length} selected events · map diamonds show events within 80 years of the selected year.</p>${eventListHtml(events)}`;
}

function renderPlaces() {
  const groups = new Map();
  for (const place of chronicle.places) {
    const region = place.region || 'Places';
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(place);
  }
  return `<h1>Places through time</h1><p class="reading-intro">Cities, ports, and sites connecting two regions. Open a place to explore selected history and the evidence behind its reference location.</p>${[...groups].map(([region, places]) => `<h3 class="directory-group">${esc(region)}</h3><ul class="place-directory">${places.sort((a, b) => a.name.localeCompare(b.name)).map((place) => `<li class="directory-item"><button type="button" data-place="${esc(place.id)}"><span><strong>${esc(place.name)}</strong>${place.aliases?.length ? `<small>${esc(place.aliases.slice(0, 2).join(' · '))}</small>` : ''}</span>${icon('next')}</button></li>`).join('')}</ul>`).join('')}`;
}

function renderPlace(place) {
  const name = historicalName(place, state.year);
  const datedName = (place.history || []).some((entry) => Number.isInteger(entry.nameValidFrom) && Number.isInteger(entry.nameValidTo) && entry.nameValidFrom !== 0 && entry.nameValidTo !== 0 && entry.nameValidFrom <= state.year && state.year <= entry.nameValidTo);
  const matches = territoriesVisible() ? snapshotData.polities.filter((polity) => place.coord && MercatorProjector.pointInShape(...place.coord, polity.shape)) : [];
  const associatedEvents = chronicle.events.filter((event) => event.placeId === place.id);
  const history = place.history || [];
  return `<button type="button" class="record-back" data-pane="places">${icon('back')}All places</button><h1>${esc(name)}</h1><p class="record-subtitle">${esc(place.region || '')}${place.name !== name ? ` · modern reference: ${esc(place.name)}` : ''}</p><p>${esc(place.summary)}</p>${place.classificationNote ? `<p class="record-note">${esc(place.classificationNote)}</p>` : ''}${!datedName ? '<p class="record-note">Reference name shown. This record does not establish a historical name for the selected year.</p>' : ''}${place.aliases?.length ? `<p class="record-note">Search aliases: ${esc(place.aliases.join(" · "))}. These aliases have no established validity dates in this dataset.</p>` : ''}<dl class="record-meta"><dt>Record type</dt><dd>${esc(place.recordType || "Reference location")}</dd><dt>Location</dt><dd>${place.coord ? `${Math.abs(place.coord[1]).toFixed(2)}°${place.coord[1] < 0 ? 'S' : 'N'}, ${Math.abs(place.coord[0]).toFixed(2)}°${place.coord[0] < 0 ? 'W' : 'E'}` : 'Unknown; no map pin'}</dd><dt>Precision</dt><dd>${esc(place.precision || 'Approximate reference location')}</dd>${matches.length ? `<dt>Map overlay</dt><dd>${matches.map((polity) => `<button class="text-button" type="button" data-polity="${esc(polity.id)}">${esc(polity.title)}</button>`).join(' · ')}<br><small>Geometry lookup on the ${esc(formatYear(snapshot.year))} source map; not independent evidence of control.</small></dd>` : ''}</dl>${place.coord ? `<button type="button" class="inline-action" data-locate="${esc(place.id)}">Locate on the map</button>` : ''}${history.length ? `<h3>Selected history</h3><p class="record-note">Dates below describe selected episodes, not the full life of a place, the validity of a name, or continuous political control.</p><ol class="history-list">${history.map((entry) => `<li><time>${esc(labelForRange(entry.from, entry.to))}</time><strong>${esc(entry.name)}</strong>${entry.note ? `<p>${esc(entry.note)}</p>` : ''}${sourcesHtml(entry.sourceIds)}</li>`).join('')}</ol>` : ''}${associatedEvents.length ? `<h3>Events at this place</h3>${eventListHtml(associatedEvents)}` : ''}${evidenceHtml(place)}${sourcesHtml(place.sourceIds, true)}${reviewNote(place)}`;
}

function renderEvent(event) {
  const place = placeById.get(event.placeId);
  const related = learning.stories.filter(story => story.stops.some(stop => stop.eventId === event.id));
  const chapter = related[0]?.stops.find(stop => stop.eventId === event.id);
  return `<button type="button" class="record-back" data-pane="overview">${icon('back')}Explore this period</button><p class="date-line">${esc(recordYear(event))}</p><h1>${esc(event.title)}</h1>${place ? `<p class="record-subtitle">Map anchor: ${esc(place.name)} · ${esc(place.region || '')}</p>` : ''}<p>${esc(event.description)}</p>${chapter ? `<div class="field-note"><strong>Look closer</strong><p>${esc(chapter.question)}</p></div>` : ''}${related.length ? `<div class="learning-actions">${related.map(story => `<button class="inline-action" type="button" data-story="${esc(story.id)}">Story: ${esc(story.title)}</button>`).join('')}</div>` : ''}${dateNote(event)}<p class="coverage-note">${esc(coverageText())}</p>${place ? `<button type="button" class="inline-action" data-place="${esc(place.id)}">Read the place history</button>` : ''}${evidenceHtml(event)}${sourcesHtml(event.sourceIds, true)}${reviewNote(event)}`;
}

function renderPolity(polity) {
  const title = polity.title || polity.sourceName || 'Territory';
  return `<button type="button" class="record-back" data-pane="overview">${icon('back')}All territories</button><p class="date-line">Source map · ${esc(formatYear(snapshot.year))}</p><h1>${esc(title)}</h1>${polity.description ? `<p>${esc(polity.description)}</p>` : `<p>Inspect this territory as represented in the dated source map. Its outline is a schematic historical reconstruction.</p>`}<dl class="record-meta"><dt>Source name</dt><dd>${esc(polity.sourceName || title)}</dd><dt>Authority</dt><dd>${esc(polity.authority || 'Not specified in source')}</dd><dt>Relationship</dt><dd>${esc(polity.relationship || 'Not specified in source')}</dd><dt>Precision</dt><dd>${polity.borderPrecision != null ? `Source precision code ${esc(polity.borderPrecision)}; not a surveyed border` : 'Approximate; not a surveyed border'}</dd><dt>Review</dt><dd>${esc(polity.reviewStatus || snapshot.reviewStatus || 'Source-derived geometry; scholarly review pending')}</dd></dl>${polity.note || polity.geometryNote ? `<p class="record-note">${esc(polity.note || polity.geometryNote)}</p>` : ''}${polity.interpretationNote ? `<p class="record-note"><strong>Editorial interpretation:</strong> ${esc(polity.interpretationNote)}</p>` : ''}<p class="coverage-note">${esc(coverageText())}</p><button type="button" class="inline-action" data-fit-polity="${esc(polity.id)}">Fit this territory</button><h3 class="source-heading">Map evidence</h3><ol class="source-list"><li>${sourceLink(polity.sourceUrl || snapshot.sourceUrl, 'Inspect the original snapshot')}<small>Historical Basemaps · GPL-3.0</small></li></ol>${sourcesHtml(polity.sourceIds)}<p class="record-note">A source label, a dependency, and a claim are not interchangeable. The source fields are preserved above where supplied.</p>`;
}

function renderJourneys() {
  return `<h1>Journeys across the map</h1><p class="reading-intro">Follow documented movements through changing political landscapes.</p>${chronicle.journeys.map((journey) => `<div class="journey-preview"><p class="date-line">${esc(labelForRange(journey.fromYear, journey.toYear))}</p><h3>${esc(journey.name)}</h3><p>${esc(journey.summary)}</p><button type="button" class="inline-action" data-journey="${esc(journey.id)}">Follow ${journey.stops.length} selected stops</button></div>`).join('')}<p class="record-note" style="margin-top:20px">Connections between stops are schematic, not reconstructed travel paths.</p>`;
}

function renderJourney(journey) {
  const stop = journey.stops[state.stop];
  const place = placeById.get(stop.placeId);
  return `<button type="button" class="record-back" data-pane="journeys">${icon('back')}All journeys</button>
    <p class="journey-eyebrow">${esc(journey.person || journey.name)} · stop ${state.stop + 1} of ${journey.stops.length}</p>
    <h1>${esc(stop.title || place?.name || 'Recorded stop')}</h1>
    <p class="record-subtitle">${esc(recordYear(stop))}${place ? ' · ' + esc(place.name) : ''}</p>
    <p class="journey-active-copy">${esc(stop.description)}</p>${dateNote(stop)}
    <div class="journey-controls"><button type="button" data-journey-step="-1" ${state.stop === 0 ? 'disabled' : ''} aria-label="Previous journey stop">${icon('back')}</button><button type="button" class="journey-play" data-journey-play>${icon(playing ? 'pause' : 'play')}${playing ? 'Pause' : 'Play journey'}</button><button type="button" data-journey-step="1" ${state.stop >= journey.stops.length - 1 ? 'disabled' : ''} aria-label="Next journey stop">${icon('next')}</button><span>${state.stop + 1} of ${journey.stops.length}</span></div>
    ${sourcesHtml(stop.sourceIds)}
    ${stop.placeId ? `<button type="button" class="inline-action" data-place="${esc(stop.placeId)}">Read this place</button>` : ''}
    <details class="journey-context"><summary>About these selected stops</summary><h2>${esc(journey.name)}</h2><p class="record-subtitle">${esc(labelForRange(journey.fromYear, journey.toYear))}</p><p>${esc(journey.summary)}</p><p class="record-note">${esc(journey.geometryNote || 'Selected stops joined by schematic connections.')} Zoom in to separate nearby stops.</p></details>
    <p class="record-note">${esc(coverageText())}</p>
    <h3>Explore the stops</h3><ol class="stop-list">${journey.stops.map((entry, index) => `<li class="stop-row ${index === state.stop ? 'active' : ''}"><button type="button" data-stop="${index}" ${index === state.stop ? 'aria-current="step"' : ''}><span class="stop-number">${index + 1}</span><strong>${esc(entry.title || placeById.get(entry.placeId)?.name || 'Recorded stop')}</strong><time>${esc(recordYear(entry))}</time></button></li>`).join('')}</ol>
    ${evidenceHtml(journey)}${sourcesHtml(journey.sourceIds)}${reviewNote(journey)}`;
}

function renderAbout({ inline = false } = {}) {
  const dates = manifest.snapshots.map((entry) => formatYear(entry.year)).join(', ');
  return `${inline ? '' : `<button type="button" class="record-back" data-pane="overview">${icon('back')}Return to the atlas</button><h1>A map with its sources</h1>`}<p>Geohistory brings the Middle East and South Asia into one view, from 600 BCE to 1947. It connects selected territorial maps with places, events, and documented journeys.</p><h3>Read the date on the map</h3><p>Territories are available for selected dates. Between those dates, territory borders and polity labels stay hidden. You may explicitly show the most recent earlier map as a dated reference; changing years clears that choice. Before the first snapshot, no territories are drawn. Borders do not interpolate between years.</p><p class="record-note">Available maps: ${esc(dates)}.</p><h3>What the layers mean</h3><p>Historical boundaries are approximate and may omit local polities or disputed relationships. Modern coastlines, rivers, and lakes help with orientation; they do not reconstruct ancient physical geography. Place pins are source-linked reference locations, not proof that a city existed at every selected date.</p><h3>Provenance &amp; attribution</h3><ol class="source-list"><li>${sourceLink('https://github.com/DeanChensj/jiangshan-map', 'Jiangshan Atlas by DeanChensj')}<small>Original SVG map engine and polygon encoding · GPL-3.0</small></li><li>${sourceLink('https://github.com/aourednik/historical-basemaps', 'Historical Basemaps by A. Ourednik and contributors')}<small>Source-dated territory geometry · GPL-3.0</small></li><li>${sourceLink('https://www.naturalearthdata.com/about/terms-of-use/', 'Natural Earth')}<small>Modern physical reference geography · public domain</small></li></ol><p class="record-note">The original China-specific prefecture dataset is not included in this regional interface. Source checks are not independent human scholarly review.</p><h3>Reading evidence together</h3><p>${esc(learning.meta.sourceDependencies)}</p><p>New records link individual claims to specific references and describe dependencies. Older records retain record-level citations where a claim-level review has not yet been completed. Modern reference names and undated search aliases do not establish names in a historical year.</p>${inline ? `<details class="page-bibliography"><summary>Browse ${chronicle.sources.length} historical references</summary>` : '<h3>Historical records</h3>'}<ol class="source-list">${chronicle.sources.map((source) => `<li>${sourceLink(source.url, source.title)}<small>${esc(source.publisher || '')}${source.license ? ` · ${esc(source.license)}` : ''}</small></li>`).join('')}</ol>${inline ? '</details>' : ''}<h3>Keyboard &amp; touch</h3><p class="record-note">Press / to search, left/right to step through map dates, and Space to play. Escape closes the current selection. When the map has focus, arrow keys pan and +/− zoom. Scrolling moves through this page; Ctrl + scroll zooms the map. On a touch screen, use two fingers to pan; one finger scrolls the page.</p><p class="record-note"><a href="data/region/chronicle.json" download>Download historical records</a> · <a href="data/region/manifest.json" download>Download snapshot manifest</a> · <a href="LICENSE">Code license</a></p>`;
}

/** Permanent directories share the same records as the interactive atlas. */
function renderPageSections() {
  $('page-journeys').innerHTML = chronicle.journeys.map(journey => `<article class="journey-preview"><p class="date-line">${esc(labelForRange(journey.fromYear, journey.toYear))}</p><h3>${esc(journey.name)}</h3><p>${esc(journey.summary)}</p><button type="button" class="inline-action" data-page-journey="${esc(journey.id)}">Follow ${journey.stops.length} selected stops <span aria-hidden="true">→</span></button><p class="record-note">${esc(journey.geometryNote)}</p></article>`).join('');
  renderPageStories();
  $('page-sources').innerHTML = renderAbout({ inline: true });
}

function renderPageStories() {
  const template = document.createElement('template');
  template.innerHTML = learningViews.home();
  template.content.querySelector('.learning-hero')?.remove();
  for (const [from, to] of [['data-story', 'data-page-story'], ['data-connection', 'data-page-connection'], ['data-quiz-start', 'data-page-quiz']]) {
    for (const button of template.content.querySelectorAll('[' + from + ']')) {
      button.setAttribute(to, button.getAttribute(from)); button.removeAttribute(from);
    }
  }
  $('page-stories').replaceChildren(template.content);
}

function renderReading() {
  setActiveTab(state.pane);
  const content = $('reading-content');
  const previousScroll = $('reading-pane').scrollTop;
  let html;
  if (state.story) html = learningViews.story(state.story, state.storyStep, coverageText());
  else if (state.connection) html = learningViews.connection(state.connection, state.year);
  else if (quizIndex !== null) html = learningViews.quiz(quizIndex, quizAnswer, quizScore);
  else if (state.journey) {
    const journey = chronicle.journeys.find((entry) => entry.id === state.journey);
    html = journey ? renderJourney(journey) : renderJourneys();
  } else if (state.selected?.kind === 'place') {
    const place = placeById.get(state.selected.id);
    html = place ? renderPlace(place) : renderPlaces();
  } else if (state.selected?.kind === 'event') {
    const event = chronicle.events.find((entry) => entry.id === state.selected.id);
    html = event ? renderEvent(event) : renderOverview();
  } else if (state.selected?.kind === 'polity') {
    const polity = snapshotData?.polities?.find((entry) => entry.id === state.selected.id);
    html = polity ? renderPolity(polity) : renderOverview();
  } else html = ({ overview: renderOverview, places: renderPlaces, journeys: renderJourneys, events: renderEvents, learn: learningViews.home, about: renderAbout })[state.pane]?.() || renderOverview();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  content.innerHTML = html + ('speechSynthesis' in window ? '<button type="button" class="text-button narration-button" data-listen aria-pressed="false">Listen to this page</button>' : '');
  $('reading-pane').scrollTop = previousScroll;
  if (state.story) renderPageStories();
}

function linePath(coordinates) {
  return coordinates.map(([lng, lat], index) => {
    const [x, y] = projector.toScreen(lng, lat);
    return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join('');
}

function renderBase() {
  const land = $('base-layer');
  const water = $('water-layer');
  land.replaceChildren();
  water.replaceChildren();
  const clip = svgNode('clipPath', { id: 'relief-land-clip' });
  svg.querySelector('defs').append(clip);
  for (const feature of base.features || []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const kind = feature.properties?.kind || 'land';
    let d;
    if (geometry.type === 'LineString') d = linePath(geometry.coordinates);
    else if (geometry.type === 'MultiLineString') d = geometry.coordinates.map(linePath).join('');
    else d = projector.shapeToSvgPath(geometry, false);
    const node = svgNode('path', { d, class: `base-${kind}`, 'aria-hidden': 'true' });
    if (feature.properties.name) {
      const title = svgNode('title'); title.textContent = `${feature.properties.name} · modern physical reference`; node.append(title);
    }
    if (kind === 'land') clip.append(svgNode('path', { d }));
    (kind === 'land' ? land : water).append(node);
  }
  $('relief-layer').append(svgNode('image', { href: 'assets/region/relief.webp', x: 0, y: 0, width: WIDTH, height: HEIGHT, preserveAspectRatio: 'none', 'clip-path': 'url(#relief-land-clip)' }));
  const labels = [
    ['Mediterranean Sea', 29.5, 34.4, -12], ['Arabian Sea', 62, 15.5, 0],
    ['Bay of Bengal', 88, 14.5, 0], ['Indian Ocean', 73, 2, 0],
    ['Red Sea', 37.8, 20.5, -62], ['Persian Gulf', 50.8, 26.5, -28],
    ['Hindu Kush', 68, 35.8, -16], ['Himalaya', 82, 31, 18],
    ['Deccan', 77, 18, 0], ['Arabian Peninsula', 46, 20.5, 0],
  ];
  $('geography-labels').replaceChildren();
  for (const [name, lng, lat, angle] of labels) {
    const [x, y] = projector.toScreen(lng, lat);
    const label = svgNode('text', { x, y, class: `geo-label${['Hindu Kush', 'Himalaya', 'Deccan', 'Arabian Peninsula'].includes(name) ? ' is-land' : ''}`, transform: `rotate(${angle} ${x} ${y})`, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    label.textContent = name;
    $('geography-labels').append(label);
  }
}

function renderTerritories() {
  const layer = $('territory-layer');
  layer.replaceChildren();
  for (const polity of snapshotData?.polities || []) {
    if (!polity.shape) continue;
    const path = svgNode('path', { d: projector.shapeToSvgPath(polity.shape, false), fill: polity.tint || '#b39570', class: 'territory', 'data-polity-id': polity.id, 'aria-label': polity.title || polity.sourceName || 'Territory' });
    const title = svgNode('title');
    title.textContent = `${polity.title} · ${formatYear(snapshot.year)}`;
    path.append(title);
    path.addEventListener('click', () => { if (!hasMoved) selectRecord('polity', polity.id); });
    path.addEventListener('mouseenter', () => highlightPolity(polity.id));
    path.addEventListener('mouseleave', () => highlightPolity(null));
    layer.append(path);
  }
  renderLegend();
  updateSelection();
}

function renderLegend() {
  const polities = snapshotData?.polities || [];
  $('legend-count').textContent = polities.length ? `${polities.length} territories` : 'No snapshot';
  $('legend-items').innerHTML = polities.length ? polities.map((polity) => `<button class="legend-item" type="button" data-polity="${esc(polity.id)}"><span class="legend-swatch" style="background:${esc(polity.tint || '#b39570')}"></span><span>${esc(polity.title || polity.sourceName)}</span></button>`).join('') : '<p class="record-note" style="padding:0 7px">Choose a later date to view the first available territories.</p>';
  for (const button of $('legend-items').querySelectorAll('[data-polity]')) {
    button.addEventListener('mouseenter', () => highlightPolity(button.dataset.polity));
    button.addEventListener('mouseleave', () => highlightPolity(null));
    button.addEventListener('focus', () => highlightPolity(button.dataset.polity));
    button.addEventListener('blur', () => highlightPolity(null));
  }
}

function highlightPolity(id) {
  for (const path of $('territory-layer').children) {
    path.classList.toggle('is-highlighted', Boolean(id && path.dataset.polityId === id));
    path.classList.toggle('is-muted', Boolean(id && path.dataset.polityId !== id));
  }
}

function updateSelection() {
  const polityId = state.selected?.kind === 'polity' ? state.selected.id : null;
  for (const path of $('territory-layer').children) path.classList.toggle('is-selected', path.dataset.polityId === polityId);
  for (const button of $('legend-items').querySelectorAll('[data-polity]')) {
    button.classList.toggle('active', button.dataset.polity === polityId);
    button.setAttribute('aria-pressed', String(button.dataset.polity === polityId));
  }
}

/** Map symbols are sized in CSS pixels, including the SVG's letterboxed viewport scale. */
function symbolMetrics() {
  const matrix = svg.getScreenCTM();
  const rect = svg.getBoundingClientRect();
  const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
  return {
    unitsPerPixel: 1 / Math.max(.001, scale),
    width: rect.width,
    height: rect.height,
    toPixels: (x, y) => matrix ? [matrix.a * x + matrix.c * y + matrix.e - rect.left, matrix.b * x + matrix.d * y + matrix.f - rect.top] : [x, y],
  };
}

function boxesIntersect(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function mapLabelExclusions() {
  const mapRect = svg.getBoundingClientRect();
  return ['.map-date', '.map-toolbar', '.region-switch', '.map-controls', '.map-legend', '.map-scale', '.map-footnote', '.confluence-hero', '.map-reading-toggle', '.map-story-note'].flatMap((selector) => {
    const element = document.querySelector(selector);
    if (!element || element.hidden) return [];
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    return [[rect.left - mapRect.left - 6, rect.top - mapRect.top - 6,
      rect.right - mapRect.left + 6, rect.bottom - mapRect.top + 6]];
  });
}

function renderPlacesOnMap() {
  const layer = $('place-layer');
  layer.replaceChildren();
  const currentJourney = chronicle.journeys.find((entry) => entry.id === state.journey);
  const storyPlace = learning.stories.find(item => item.id === state.story)?.stops[state.storyStep]?.placeId;
  const activePlace = storyPlace || (state.selected?.kind === 'place' ? state.selected.id : state.selected?.kind === 'event' ? chronicle.events.find((entry) => entry.id === state.selected.id)?.placeId : currentJourney?.stops[state.stop]?.placeId);
  const journeyPlaces = new Set(currentJourney?.stops.map((stop) => stop.placeId) || []);
  const visible = chronicle.places.filter((place) => Array.isArray(place.coord) && place.coord.length >= 2 && !journeyPlaces.has(place.id)).sort((a, b) => (b.id === activePlace ? 1 : 0) - (a.id === activePlace ? 1 : 0));
  const boxes = [];
  placeLabelBoxes = boxes;
  const exclusions = mapLabelExclusions();
  const metrics = symbolMetrics();
  const centers = (currentJourney?.stops || []).map((stop) => placeById.get(stop.placeId)?.coord)
    .filter(Boolean).map((coord) => metrics.toPixels(...projector.toScreen(...coord)));
  for (const place of visible) {
    const [x, y] = projector.toScreen(...place.coord);
    const [screenX, screenY] = metrics.toPixels(x, y);
    if (screenX < -22 || screenX > metrics.width + 22 || screenY < -22 || screenY > metrics.height + 22) continue;
    if (centers.some(([cx, cy]) => Math.hypot(cx - screenX, cy - screenY) < 46)) continue;
    const pinBox = [screenX - 22, screenY - 22, screenX + 22, screenY + 22];
    if (place.id !== activePlace && boxes.some((box) => boxesIntersect(box, pinBox))) continue;
    const group = svgNode('g', { class: `place-marker${place.id === activePlace ? ' is-selected' : ''}`, transform: `translate(${x} ${y}) scale(${metrics.unitsPerPixel})`, 'data-place-id': place.id, 'aria-label': place.name });
    const circle = svgNode('circle', { cx: 0, cy: 0, r: place.id === activePlace ? 5 : 3.5 });
    const hit = svgNode('circle', { cx: 0, cy: 0, r: 22, class: 'map-symbol-hit', 'aria-hidden': 'true' });
    group.append(hit, circle);
    const name = historicalName(place, state.year);
    const labelWidth = name.length * 7;
    const candidates = [[9, -7, 'start'], [9, 17, 'start'], [-9, -7, 'end'], [-9, 17, 'end']];
    const placement = candidates.map(([dx, dy, anchor]) => {
      const left = screenX + dx - (anchor === 'end' ? labelWidth : 0);
      return { dx, dy, anchor, box: [left - 2, screenY + dy - 13, left + labelWidth + 2, screenY + dy + 3] };
    }).find(({ box }) => box[0] >= 4 && box[2] <= metrics.width - 4 && box[1] >= 4 && box[3] <= metrics.height - 4 && !boxes.some((other) => boxesIntersect(box, other)) && !exclusions.some((other) => boxesIntersect(box, other)));
    if (placement) {
      const text = svgNode('text', { x: placement.dx, y: placement.dy, 'text-anchor': placement.anchor });
      text.textContent = name;
      group.append(text);
      boxes.push(placement.box);
    }
    centers.push([screenX, screenY]);
    boxes.push(pinBox);
    const title = svgNode('title');
    title.textContent = `${place.name} · ${place.precision || 'reference location'}`;
    group.append(title);
    group.addEventListener('click', () => { if (!hasMoved) selectRecord('place', place.id); });
    layer.append(group);
  }
}

function renderJourneyMap() {
  const layer = $('journey-layer');
  layer.replaceChildren();
  const journey = chronicle.journeys.find((entry) => entry.id === state.journey);
  if (!journey) return;
  const points = journey.stops.map((stop) => placeById.get(stop.placeId)?.coord);
  let segment = [];
  function flushSegment() { if (segment.length > 1) layer.append(svgNode('path', { d: linePath(segment), class: 'journey-path', 'aria-hidden': 'true' })); segment = []; }
  for (const point of points) { if (point) segment.push(point); else flushSegment(); }
  flushSegment();
  const metrics = symbolMetrics();
  const centers = [];
  const ordered = points.map((point, index) => ({ point, index })).sort((a, b) => (b.index === state.stop ? 1 : 0) - (a.index === state.stop ? 1 : 0));
  ordered.forEach(({ point, index }) => {
    if (!point) return;
    const [x, y] = projector.toScreen(...point);
    const [screenX, screenY] = metrics.toPixels(x, y);
    if (screenX < -22 || screenX > metrics.width + 22 || screenY < -22 || screenY > metrics.height + 22) return;
    if (centers.some(([cx, cy]) => Math.hypot(cx - screenX, cy - screenY) < 46)) return;
    centers.push([screenX, screenY]);
    const group = svgNode('g', { class: `journey-stop${index === state.stop ? ' active' : ''}`, transform: `translate(${x} ${y}) scale(${metrics.unitsPerPixel})`, 'aria-label': `Journey stop ${index + 1}` });
    const hit = svgNode('circle', { r: 22, class: 'map-symbol-hit', 'aria-hidden': 'true' });
    const circle = svgNode('circle', { r: 11 });
    const text = svgNode('text');
    text.textContent = index + 1;
    const title = svgNode('title');
    title.textContent = `Stop ${index + 1} · ${placeById.get(journey.stops[index].placeId)?.name || journey.stops[index].title} · ${recordYear(journey.stops[index])}`;
    group.append(hit, circle, text, title);
    group.addEventListener('click', () => { if (!hasMoved) goToStop(index, { scroll: true }); });
    layer.append(group);
  });
}

function renderMapDetails() {
  $('connection-layer').style.display = $('layer-connections').checked ? '' : 'none';
  mapDetails?.render({ snapshot: territoriesVisible() ? snapshotData : null, year: state.year, story: state.story, storyStep: state.storyStep, connection: state.connection, journey: state.journey, exclusions: mapLabelExclusions(), labelBoxes: placeLabelBoxes });
  const visibleConnections = $('layer-connections').checked && $('connection-layer').children.length;
  $('overlay-key').hidden = !visibleConnections;
  $('overlay-key').textContent = visibleConnections ? 'Dashed links are schematic; select a line for its meaning.' : '';
  const size = symbolMetrics();
  const center = [camera.x + WIDTH / camera.k / 2, camera.y + HEIGHT / camera.k / 2];
  const [lng, lat] = projector.toGeo(...center);
  const [otherLng] = projector.toGeo(center[0] + 100 * size.unitsPerPixel, center[1]);
  const distance = Math.abs(otherLng - lng) * 111.195 * Math.cos(lat * Math.PI / 180);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, distance)));
  const scale = [5, 2, 1].map(value => value * magnitude).find(value => value <= distance) || magnitude / 2;
  $('map-scale').style.width = `${Math.max(20, scale / distance * 100)}px`;
  $('map-scale').textContent = `${scale} km`;
}

function setCamera(next, { write = true, intermediate = false } = {}) {
  if (!intermediate) cancelAnimationFrame(cameraFrame);
  const k = Math.max(.7, Math.min(8, next.k));
  camera = { x: Math.max(-WIDTH, Math.min(WIDTH * 1.5, next.x)), y: Math.max(-HEIGHT, Math.min(HEIGHT * 1.5, next.y)), k };
  svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${WIDTH / camera.k} ${HEIGHT / camera.k}`);
  cancelAnimationFrame(placeFrame);
  placeFrame = requestAnimationFrame(() => { renderPlacesOnMap(); renderJourneyMap(); renderWelcomeMap(); renderMapDetails(); });
  if (write) { clearTimeout(urlTimer); urlTimer = setTimeout(() => updateUrl(), 180); }
}

/** Camera motion expresses selection, never an inferred historical movement. */
function animateCamera(next) {
  cancelAnimationFrame(cameraFrame);
  if (reducedMotion.matches || document.documentElement.dataset.atlasReady !== 'true') { setCamera(next); return; }
  const start = { ...camera };
  const started = performance.now();
  const duration = 480;
  const tick = now => {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - t) ** 3;
    setCamera({ x: start.x + (next.x - start.x) * eased, y: start.y + (next.y - start.y) * eased, k: start.k + (next.k - start.k) * eased }, { write: false, intermediate: true });
    if (t < 1) cameraFrame = requestAnimationFrame(tick);
    else updateUrl();
  };
  cameraFrame = requestAnimationFrame(tick);
}

function zoom(factor, point = [camera.x + WIDTH / camera.k / 2, camera.y + HEIGHT / camera.k / 2]) {
  const k = Math.max(.7, Math.min(8, camera.k * factor));
  setCamera({ x: point[0] - (point[0] - camera.x) * camera.k / k, y: point[1] - (point[1] - camera.y) * camera.k / k, k });
}

function focusPoint(coord, k = Math.max(camera.k, 2.3)) {
  if (!coord) return;
  const [x, y] = projector.toScreen(...coord);
  animateCamera({ x: x - WIDTH / k / 2, y: y - HEIGHT / k / 2, k });
}

function fitCoordinates(coords) {
  if (!coords.length) return;
  const points = coords.map((coord) => projector.toScreen(...coord));
  const left = Math.min(...points.map((point) => point[0]));
  const right = Math.max(...points.map((point) => point[0]));
  const top = Math.min(...points.map((point) => point[1]));
  const bottom = Math.max(...points.map((point) => point[1]));
  const viewport = svg.getBoundingClientRect();
  const scaleAtOne = Math.max(viewport.width / WIDTH, viewport.height / HEIGHT) || 1;
  const visibleWidth = viewport.width / scaleAtOne;
  const visibleHeight = viewport.height / scaleAtOne;
  const k = Math.max(.7, Math.min(5, .75 * Math.min(visibleWidth / Math.max(60, right - left), visibleHeight / Math.max(60, bottom - top))));
  animateCamera({ x: (left + right) / 2 - WIDTH / k / 2, y: (top + bottom) / 2 - HEIGHT / k / 2, k });
}

function fitWelcomeMap() {
  if (!experience.welcome || !compactLayout.matches) return;
  // The mobile welcome uses the source aspect ratio, keeping the finite relief in frame.
  setCamera({ x: 0, y: 0, k: 1 }, { write: false });
}

function fitPolity(id) {
  const polity = snapshotData?.polities?.find((entry) => entry.id === id);
  const rings = polity?.shape?.type === 'MultiPolygon' ? polity.shape.coordinates.flat() : polity?.shape?.coordinates || [];
  const coords = rings.flat().filter(([lng, lat]) => lng >= CONFIG.bounds.west && lng <= CONFIG.bounds.east && lat >= CONFIG.bounds.south && lat <= CONFIG.bounds.north);
  fitCoordinates(coords);
}

function renderDate() {
  $('year-slider').value = yearToOrdinal(state.year);
  $('year-slider').setAttribute('aria-valuetext', formatYear(state.year));
  $('year-input').value = state.year;
  $('year-era').textContent = state.year < 0 ? 'BCE' : 'CE';
  const reference = !snapshot || snapshot.year !== state.year;
  const visible = territoriesVisible();
  $('coverage-status').textContent = !snapshot || reference && !visible
    ? `${formatYear(state.year)} · no territory map for this year`
    : reference ? `Exploring ${formatYear(state.year)} · optional reference: ${formatYear(snapshot.year)}`
    : `Map: ${formatYear(snapshot.year)} · schematic territories`;
  $('map-date').classList.toggle('is-reference', reference);
  $('map-date').innerHTML = `<strong>${esc(formatYear(state.year))}</strong>${reference ? `<span>${visible ? `Borders: ${esc(formatYear(snapshot.year))} · ${yearToOrdinal(state.year) - yearToOrdinal(snapshot.year)} years earlier` : 'No territory map for this year'}</span>${snapshot ? `<button class="reference-toggle" type="button" data-reference-toggle aria-pressed="${visible}">${visible ? 'Hide older borders' : `Show ${esc(formatYear(snapshot.year))} reference`}</button>` : ''}` : `<span>${esc(snapshot.title)}</span>`}`;
  for (const button of $('snapshot-ticks').children) {
    const active = Number(button.dataset.year) === (territoriesVisible() ? snapshot?.year : state.year);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  requestAnimationFrame(revealActiveSnapshotShortcut);
  $('previous-snapshot').disabled = state.story ? state.storyStep === 0 : state.journey ? state.stop === 0 : !nextPlaybackEntry(-1);
  $('next-snapshot').disabled = state.story ? state.storyStep === learning.stories.find(item => item.id === state.story).stops.length - 1 : state.journey ? state.stop === chronicle.journeys.find(item => item.id === state.journey).stops.length - 1 : !nextPlaybackEntry(1);
  const unit = timeline?.getMode() === 'events' ? 'event' : 'dated snapshot';
  $('previous-snapshot').setAttribute('aria-label', `Previous ${unit}`);
  $('next-snapshot').setAttribute('aria-label', `Next ${unit}`);
  $('map-title').textContent = `Middle East and South Asia · ${territoriesVisible() ? `territories from ${formatYear(snapshot.year)}` : 'territories hidden'} · selected year ${formatYear(state.year)}`;
  $('compact-year').textContent = formatYear(state.year);
  $('compact-coverage').textContent = visible ? (reference ? `Reference: ${formatYear(snapshot.year)} · ${yearToOrdinal(state.year) - yearToOrdinal(snapshot.year)} years earlier` : 'Dated map · approximate territories') : !reference ? 'Territory layer hidden · map available' : 'No territory map for this year';
  for (const button of $('compact-map-dates').children) {
    const active = Number(button.dataset.year) === (visible ? snapshot?.year : state.year);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  document.title = `${formatYear(state.year)} · Geohistory`;
  timeline?.render(state.year);
}

function revealActiveSnapshotShortcut() {
  if (!compactLayout.matches) return;
  const strip = $('snapshot-ticks');
  const button = strip.querySelector('.active');
  if (!button) return;
  const stripRect = strip.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  if (buttonRect.left < stripRect.left + 5 || buttonRect.right > stripRect.right - 5) {
    strip.scrollLeft += (buttonRect.left + buttonRect.width / 2) - (stripRect.left + stripRect.width / 2);
  }
}

function render() {
  syncExperience();
  snapshot = selectSnapshot(manifest.snapshots, state.year);
  snapshotData = snapshot ? atlas[snapshot.id] : null;
  if (state.selected?.kind === 'polity' && (!territoriesVisible() || !snapshotData?.polities?.some((entry) => entry.id === state.selected.id))) state.selected = null;
  if (lastRenderedSnapshot !== snapshot?.id) { renderTerritories(); lastRenderedSnapshot = snapshot?.id; }
  syncTerritoryVisibility();
  updateSelection();
  renderDate();
  renderPlacesOnMap();
  renderJourneyMap();
  renderWelcomeMap();
  renderMapDetails();
  renderReading();
  renderJourneyRibbon();
}

function setYear(year, { preserveSelection = false, write = true } = {}) {
  experience.welcome = false;
  state.year = normalizeYear(year); state.referenceYear = null;
  if (!preserveSelection) {
    state.story = null; quizIndex = null;
    if (state.selected?.kind !== 'place') state.selected = null;
    state.journey = null;
  }
  render();
  if (write) updateUrl();
}

function selectRecord(kind, id, { scroll = true, focus = false } = {}) {
  setReader(true);
  stopPlayback();
  state.journey = null; state.story = null; state.connection = null; quizIndex = null;
  state.selected = { kind, id };
  if (kind === 'place') {
    const place = placeById.get(id);
    if (!place) return;
    state.pane = 'places';
    if (focus && place.coord) focusPoint(place.coord);
    announce(`Selected ${place.name}`);
  } else if (kind === 'event') {
    const event = chronicle.events.find((entry) => entry.id === id);
    if (!event) return;
    state.year = normalizeYear(event.year); state.referenceYear = null;
    state.pane = 'overview';
    const place = placeById.get(event.placeId);
    if (focus && place?.coord) focusPoint(place.coord);
    announce(`Selected ${event.title}, ${recordYear(event)}`);
  } else {
    state.pane = 'overview';
    if (focus) fitPolity(id);
    announce('Territory details opened');
  }
  render();
  updateUrl();
  if (scroll) revealReadingPane();
}

function openJourney(id, stop = 0, { scroll = true } = {}) {
  const journey = chronicle.journeys.find((entry) => entry.id === id);
  if (!journey?.stops.length) return;
  setReader(true);
  stopPlayback();
  state.journey = id;
  state.story = null; state.connection = null; quizIndex = null;
  state.selected = null;
  state.pane = 'journeys';
  state.stop = Math.max(0, Math.min(journey.stops.length - 1, Math.floor(Number(stop) || 0)));
  state.year = normalizeYear(journey.stops[state.stop].year); state.referenceYear = null;
  fitCoordinates(journey.stops.map((entry) => placeById.get(entry.placeId)?.coord).filter(Boolean));
  render();
  updateUrl();
  if (scroll) revealReadingPane();
  announce(`${journey.name}, stop ${state.stop + 1}`);
}

function goToStop(index, { scroll = false } = {}) {
  const journey = chronicle.journeys.find((entry) => entry.id === state.journey);
  if (!journey) return;
  state.stop = Math.max(0, Math.min(journey.stops.length - 1, index));
  state.year = normalizeYear(journey.stops[state.stop].year); state.referenceYear = null;
  render();
  if (!compactLayout.matches) $('reading-pane').scrollTop = 0;
  const coord = placeById.get(journey.stops[state.stop].placeId)?.coord;
  if (coord) focusPoint(coord, Math.max(1.5, Math.min(2.3, camera.k)));
  updateUrl();
  if (scroll) revealReadingPane();
  announce(`${journey.stops[state.stop].title}, ${recordYear(journey.stops[state.stop])}`);
}

function openStory(id, step = 0, { scroll = true, fit = true } = {}) {
  const story = learning.stories.find(item => item.id === id);
  if (!story) return;
  setReader(true);
  stopPlayback();
  state.story = id; state.storyStep = Math.max(0, Math.min(story.stops.length - 1, Math.floor(Number(step) || 0)));
  state.journey = null; state.connection = null; state.selected = null; quizIndex = null; state.pane = 'learn';
  const stop = story.stops[state.storyStep]; state.year = normalizeYear(stop.year); state.referenceYear = null;
  if (fit) focusPoint(placeById.get(stop.placeId)?.coord, 2);
  render(); updateUrl(); if (scroll) revealReadingPane();
  announce(`${story.title}, stop ${state.storyStep + 1}: ${stop.title}`);
}

function openConnection(id, { scroll = true } = {}) {
  const connection = learning.connections.find(item => item.id === id);
  if (!connection) return;
  setReader(true);
  stopPlayback(); state.connection = id; state.story = null; state.journey = null; state.selected = null; quizIndex = null; state.pane = 'learn';
  state.year = normalizeYear(connection.fromYear); state.referenceYear = null;
  $('layer-connections').checked = true; $('connection-layer').style.display = '';
  fitCoordinates(connection.placeIds.map(id => placeById.get(id)?.coord).filter(Boolean));
  render(); updateUrl(); if (scroll) revealReadingPane();
}

function playbackEntries() { return timeline?.getMode() === 'events' ? [...chronicle.events].sort((a, b) => a.year - b.year) : manifest.snapshots; }
function nextPlaybackEntry(direction) {
  const entries = playbackEntries();
  const index = timeline?.getMode() === 'events' && state.selected?.kind === 'event' ? entries.findIndex(entry => entry.id === state.selected.id) : -1;
  if (index >= 0) return entries[index + direction];
  return direction > 0 ? entries.find(entry => entry.year > state.year) : [...entries].reverse().find(entry => entry.year < state.year);
}
function playEntry(entry) { if (timeline?.getMode() === 'events') { state.selected = {kind:'event', id:entry.id}; state.pane = 'events'; setYear(entry.year, {preserveSelection:true}); } else setYear(entry.year); }

function stopPlayback() {
  clearInterval(playTimer);
  playing = false;
  $('play-button').innerHTML = icon('play');
  $('play-button').setAttribute('aria-label', 'Play through dated snapshots');
  $('play-button').setAttribute('aria-pressed', 'false');
  if (chronicle) renderJourneyRibbon();
}

function togglePlayback() {
  if (experience.welcome) openJourney(chronicle.journeys[0].id, 0, { scroll: false });
  if (playing) { stopPlayback(); renderReading(); return; }
  if (state.story || state.connection || quizIndex !== null) { state.story = null; state.connection = null; quizIndex = null; state.pane = 'overview'; render(); }
  playing = true;
  $('play-button').innerHTML = icon('pause');
  $('play-button').setAttribute('aria-label', 'Pause playback');
  $('play-button').setAttribute('aria-pressed', 'true');
  renderJourneyRibbon();
  if (state.journey) {
    const journey = chronicle.journeys.find((entry) => entry.id === state.journey);
    if (state.stop === journey.stops.length - 1) goToStop(0);
    renderReading();
  } else if (!nextPlaybackEntry(1)) playEntry(playbackEntries()[0]);
  playTimer = setInterval(() => {
    if (document.hidden) { stopPlayback(); renderReading(); return; }
    if (state.journey) {
      const journey = chronicle.journeys.find((entry) => entry.id === state.journey);
      if (state.stop >= journey.stops.length - 1) { stopPlayback(); renderReading(); }
      else goToStop(state.stop + 1);
    } else {
      const next = nextPlaybackEntry(1);
      if (!next) { stopPlayback(); return; }
      playEntry(next);
    }
  }, 4200 / (timeline?.getSpeed() || 1));
}

function stepSnapshot(direction) {
  stopPlayback();
  if (state.journey) { goToStop(state.stop + direction); return; }
  if (state.story) { openStory(state.story, state.storyStep + direction, {scroll:false}); return; }
  const next = nextPlaybackEntry(direction);
  if (next) playEntry(next);
}

function search(query) {
  const value = normalizeSearch(query);
  if (!value) return [];
  const matches = (parts) => parts.filter(Boolean).some((part) => normalizeSearch(part).includes(value));
  const results = [];
  for (const place of chronicle.places) if (matches([place.name, ...(place.aliases || []), ...(place.history || []).map((entry) => entry.name)])) results.push({ kind: 'place', id: place.id, title: place.name, detail: `Place · ${place.region || 'reference location'}` });
  for (const event of chronicle.events) if (matches([event.title, placeById.get(event.placeId)?.name])) results.push({ kind: 'event', id: event.id, title: event.title, detail: `Event · ${recordYear(event)}` });
  for (const journey of chronicle.journeys) if (matches([journey.name, journey.person])) results.push({ kind: 'journey', id: journey.id, title: journey.name, detail: `Journey · ${labelForRange(journey.fromYear, journey.toYear)}` });
  for (const polity of (territoriesVisible() ? snapshotData?.polities || [] : [])) if (matches([polity.title, polity.sourceName, polity.authority])) results.push({ kind: 'polity', id: polity.id, title: polity.title, detail: `Territory · map dated ${formatYear(snapshot.year)}` });
  for (const story of learning.stories) if (matches([story.title, story.theme, story.subtitle])) results.push({kind:'story', id:story.id, title:story.title, detail:`Guided story · ${story.stops.length} stops`});
  for (const connection of learning.connections) if (matches([connection.title])) results.push({kind:'connection', id:connection.id, title:connection.title, detail:'Thematic connection · schematic'});
  return results.slice(0, 20);
}

function closeSearch() {
  $('search-results').hidden = true;
  $('search-input').setAttribute('aria-expanded', 'false');
}

function renderSearch() {
  const query = $('search-input').value.trim();
  if (!query) { closeSearch(); return; }
  const results = search(query);
  $('search-results').innerHTML = results.length ? results.map((result) => `<button type="button" class="search-result" data-search-kind="${result.kind}" data-search-id="${esc(result.id)}"><strong>${esc(result.title)}</strong><span>${esc(result.detail)}</span></button>`).join('') : '<p class="search-message">No matching records. Try a city name, a historical alias, or a journey. Territory search uses the current map.</p>';
  $('search-results').hidden = false;
  $('search-input').setAttribute('aria-expanded', 'true');
  announce(`${results.length} search results`);
}

function updateUrl() {
  const url = new URL(location.href);
  url.search = '';
  if (embedded) url.searchParams.set('embed', '1');
  url.searchParams.set('year', state.year);
  if (experience.welcome) url.searchParams.set('intro', '1');
  else url.searchParams.set('reader', experience.readerOpen ? '1' : '0');
  if (state.referenceYear === state.year) url.searchParams.set('reference', '1');
  if (state.story) { url.searchParams.set('story', state.story); url.searchParams.set('chapter', state.storyStep); }
  else if (state.connection) url.searchParams.set('connection', state.connection);
  else if (state.journey) { url.searchParams.set('journey', state.journey); url.searchParams.set('stop', state.stop); }
  else if (state.selected) url.searchParams.set(state.selected.kind, state.selected.id);
  else if (state.pane !== 'overview') url.searchParams.set('pane', state.pane);
  if (camera.k !== 1 || camera.x !== 0 || camera.y !== 0) url.searchParams.set('view', [camera.x.toFixed(1), camera.y.toFixed(1), camera.k.toFixed(3)].join(','));
  const range = timeline?.getWindow();
  if (range && (range.from !== CONFIG.minYear || range.to !== CONFIG.maxYear)) url.searchParams.set('window', `${range.from},${range.to}`);
  if (timeline?.getMode() === 'events') url.searchParams.set('mode', 'events');
  history.replaceState(null, '', url);
}

function restoreUrl() {
  const params = new URLSearchParams(location.search);
  params.delete('embed');
  experience.welcome = (params.size === 0 || params.get('intro') === '1') && !['story', 'journey', 'connection', 'place', 'event', 'polity', 'pane'].some(key => params.has(key));
  state = { year: normalizeYear(params.get('year')), pane: ['places', 'journeys', 'events', 'learn', 'about'].includes(params.get('pane')) ? params.get('pane') : 'overview', selected: null, journey: null, stop: 0, story: null, storyStep: 0, connection: null, referenceYear: null };
  quizIndex = null;
  if (experience.welcome && !params.has('year')) state.year = 1334;
  timeline?.setMode(params.get('mode'));
  const range = params.get('window')?.split(',').map(Number);
  if (range?.length === 2) timeline?.restoreWindow(...range); else timeline?.restoreWindow(CONFIG.minYear, CONFIG.maxYear);
  const journeyId = params.get('journey');
  const journey = chronicle.journeys.find((entry) => entry.id === journeyId);
  if (journey) {
    state.journey = journey.id;
    state.pane = 'journeys';
    state.stop = Math.max(0, Math.min(journey.stops.length - 1, Math.floor(Number(params.get('stop')) || 0)));
    state.year = normalizeYear(journey.stops[state.stop].year); state.referenceYear = null;
  } else {
    for (const kind of ['place', 'event', 'polity']) {
      const id = params.get(kind);
      if (!id) continue;
      const valid = kind === 'place' ? placeById.has(id) : kind === 'event' ? chronicle.events.some((entry) => entry.id === id) : true;
      if (valid) {
        state.selected = { kind, id };
        state.pane = kind === 'place' ? 'places' : 'overview';
        if (kind === 'event') state.year = normalizeYear(chronicle.events.find((entry) => entry.id === id).year); state.referenceYear = null;
        break;
      }
    }
  }
  const story = learning.stories.find(item => item.id === params.get('story'));
  const connection = learning.connections.find(item => item.id === params.get('connection'));
  if (story) { state.story = story.id; state.storyStep = Math.max(0, Math.min(story.stops.length - 1, Math.floor(Number(params.get('chapter')) || 0))); state.year = story.stops[state.storyStep].year; state.referenceYear = null; state.pane = 'learn'; state.selected = null; state.journey = null; }
  else if (connection) { state.connection = connection.id; state.pane = 'learn'; state.selected = null; state.journey = null; $('layer-connections').checked = true; }
  state.referenceYear = params.get('reference') === '1' && Number(params.get('year')) === state.year ? state.year : null;
  experience.readerOpen = !experience.welcome && params.get('reader') !== '0' && Boolean(state.selected || state.story || state.journey || state.connection || state.pane !== 'overview' || params.get('reader') === '1');
  if (sectionForPane[state.pane] && !state.selected && !state.story && !state.journey && !state.connection) experience.readerOpen = false;
  syncExperience();
  const view = params.get('view')?.split(',').map(Number);
  if (view?.length === 3 && view.every(Number.isFinite)) camera = { x: view[0], y: view[1], k: view[2] };
  else camera = { x: 0, y: 0, k: 1 };
  setCamera(camera, { write: false });
  if (!(view?.length === 3 && view.every(Number.isFinite))) {
    if (story) focusPoint(placeById.get(story.stops[state.storyStep].placeId)?.coord, 2);
    else if (connection) fitCoordinates(connection.placeIds.map(id => placeById.get(id)?.coord).filter(Boolean));
    else if (journey) fitCoordinates(journey.stops.map(stop => placeById.get(stop.placeId)?.coord).filter(Boolean));
    else fitWelcomeMap();
  }
  welcomeViewport = `${svg.clientWidth}:${svg.clientHeight}`;
  render();
  updateUrl();
  const anchor = location.hash.slice(1);
  const target = ['atlas-section', 'journeys-section', 'stories-section', 'sources-section', 'reading-pane'].includes(anchor) ? anchor : experience.readerOpen ? 'reading-pane' : sectionForPane[state.pane];
  if (target && (target !== 'reading-pane' || experience.readerOpen)) requestAnimationFrame(() => scrollToSection(target, { focus: false, instant: true }));
}

function mapPoint(clientX, clientY) {
  const point = new DOMPoint(clientX, clientY);
  const ctm = svg.getScreenCTM();
  if (!ctm) return [WIDTH / 2, HEIGHT / 2];
  const result = point.matrixTransform(ctm.inverse());
  return [result.x, result.y];
}

function attachMapGestures() {
  svg.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom(Math.exp(-event.deltaY * .002), mapPoint(event.clientX, event.clientY));
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    cancelAnimationFrame(cameraFrame);
    hasMoved = false;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    gesture = { start: mapPoint(event.clientX, event.clientY), camera: { ...camera } };
  });
  svg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const next = mapPoint(event.clientX, event.clientY);
    const dx = next[0] - gesture.start[0];
    const dy = next[1] - gesture.start[1];
    if (Math.hypot(dx, dy) > 3 / camera.k) hasMoved = true;
    if (hasMoved) {
      if (!svg.hasPointerCapture(event.pointerId)) svg.setPointerCapture(event.pointerId);
      svg.classList.add('is-panning');
      setCamera({ ...camera, x: camera.x - dx, y: camera.y - dy });
    }
  });
  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    gesture = null;
    svg.classList.remove('is-panning');
    setTimeout(() => { hasMoved = false; }, 30);
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  let touchStart;
  svg.addEventListener('touchstart', (event) => {
    hasMoved = false;
    if (event.touches.length !== 2) { touchStart = null; return; }
    const [a, b] = event.touches;
    touchStart = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), camera: { ...camera } };
    event.preventDefault();
  }, { passive: false });
  svg.addEventListener('touchmove', (event) => {
    if (!touchStart || event.touches.length !== 2) return;
    event.preventDefault();
    hasMoved = true;
    const [a, b] = event.touches;
    const x = (a.clientX + b.clientX) / 2;
    const y = (a.clientY + b.clientY) / 2;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const oldCenter = mapPoint(touchStart.x, touchStart.y);
    const newCenter = mapPoint(x, y);
    setCamera({ x: camera.x + oldCenter[0] - newCenter[0], y: camera.y + oldCenter[1] - newCenter[1], k: camera.k });
    zoom(distance / touchStart.distance, oldCenter);
    touchStart = { x, y, distance, camera: { ...camera } };
  }, { passive: false });
  svg.addEventListener('touchend', () => { touchStart = null; setTimeout(() => { hasMoved = false; }, 60); });
  svg.addEventListener('keydown', (event) => {
    const distance = 50 / camera.k;
    const deltas = { ArrowLeft: [-distance, 0], ArrowRight: [distance, 0], ArrowUp: [0, -distance], ArrowDown: [0, distance] };
    if (deltas[event.key]) {
      event.preventDefault(); event.stopPropagation();
      setCamera({ ...camera, x: camera.x + deltas[event.key][0], y: camera.y + deltas[event.key][1] });
    } else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); zoom(event.key === '-' ? 1 / 1.25 : 1.25); }
  });
}

function attachControls() {
  new ResizeObserver(() => {
    const viewport = `${svg.clientWidth}:${svg.clientHeight}`;
    if (experience.welcome && viewport !== welcomeViewport) {
      welcomeViewport = viewport;
      fitWelcomeMap();
    }
    cancelAnimationFrame(placeFrame);
    placeFrame = requestAnimationFrame(() => { renderPlacesOnMap(); renderJourneyMap(); renderWelcomeMap(); renderMapDetails(); revealActiveSnapshotShortcut(); });
  }).observe(svg);
  new ResizeObserver((entries) => {
    document.documentElement.style.setProperty('--mobile-timeline-height', `${Math.ceil(entries[0].target.getBoundingClientRect().height)}px`);
  }).observe(document.querySelector('.timeline'));
  $('begin-journey').addEventListener('click', () => openJourney(chronicle.journeys[0].id));
  $('explore-map').addEventListener('click', () => { enterAtlas(); svg.focus({ preventScroll: true }); });
  for (const link of document.querySelectorAll('.primary-nav a, .page-colophon a')) link.addEventListener('click', event => {
    event.preventDefault(); stopPlayback(); scrollToSection(link.hash.slice(1));
  });
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    const sectionId = visible.target.id === 'reading-pane'
      ? state.story || state.connection || quizIndex !== null ? 'stories-section' : state.journey ? 'journeys-section' : 'atlas-section'
      : visible.target.id;
    for (const link of document.querySelectorAll('.primary-nav a')) {
      const active = link.hash === '#' + sectionId; link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-10% 0px -65% 0px', threshold: 0 });
  for (const id of ['atlas-section', 'reading-pane', 'journeys-section', 'stories-section', 'sources-section']) observer.observe($(id));
  document.addEventListener('geohistory:viewport', event => {
    observer.disconnect();
    const position = event.detail.top + event.detail.headerHeight + Math.min(140, event.detail.height * .2);
    let activeId = 'atlas-section';
    for (const id of ['atlas-section', 'reading-pane', 'journeys-section', 'stories-section', 'sources-section']) {
      const section = $(id);
      if (section.getBoundingClientRect().height > 0 && section.getBoundingClientRect().top + window.scrollY <= position) activeId = id;
    }
    if (activeId === 'reading-pane') activeId = state.story || state.connection || quizIndex !== null ? 'stories-section' : state.journey ? 'journeys-section' : 'atlas-section';
    for (const link of document.querySelectorAll('.primary-nav a')) {
      const active = link.hash === '#' + activeId; link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  });
  $('reading-toggle').addEventListener('click', () => { setReader(true, { focus: true }); render(); updateUrl(); revealReadingPane(); });
  $('reader-close').addEventListener('click', () => {
    setReader(false, { focus: true }); renderWelcomeMap(); renderMapDetails(); updateUrl();
    scrollToSection('atlas-section');
  });
  document.querySelector('.skip-link').addEventListener('click', () => { setReader(true); render(); });
  $('journey-toggle').addEventListener('click', togglePlayback);
  $('ribbon-fit').addEventListener('click', () => {
    const journey = chronicle.journeys.find(item => item.id === state.journey);
    if (journey) fitCoordinates(journey.stops.map(stop => placeById.get(stop.placeId)?.coord).filter(Boolean));
  });
  $('year-slider').addEventListener('input', (event) => { stopPlayback(); setYear(ordinalToYear(Number(event.target.value))); });
  $('year-form').addEventListener('submit', (event) => { event.preventDefault(); stopPlayback(); setYear($('year-input').value); });
  $('year-input').addEventListener('change', () => { stopPlayback(); setYear($('year-input').value); });
  $('previous-snapshot').addEventListener('click', () => stepSnapshot(-1));
  $('next-snapshot').addEventListener('click', () => stepSnapshot(1));
  $('play-button').addEventListener('click', togglePlayback);
  $('zoom-in').addEventListener('click', () => zoom(1.35));
  $('zoom-out').addEventListener('click', () => zoom(1 / 1.35));
  $('map-reset').addEventListener('click', () => setCamera({ x: 0, y: 0, k: 1 }));
  for (const key of ['overview', 'places', 'journeys', 'events', 'learn']) $(`tab-${key}`).addEventListener('click', () => showPane(key));
  for (const key of ['territories', 'places', 'rivers', 'relief', 'labels', 'events', 'connections']) $(`layer-${key}`).addEventListener('change', (event) => {
    const id = { territories: 'territory-layer', places: 'place-layer', rivers: 'water-layer', relief: 'relief-layer', labels: 'polity-label-layer', events: 'event-layer', connections: 'connection-layer' }[key];
    $(id).style.display = event.target.checked ? '' : 'none';
    if (key === 'territories' || key === 'labels') {
      if (key === 'territories' && !event.target.checked) { state.referenceYear = null; updateUrl(); }
      syncTerritoryVisibility(); renderMapDetails(); renderReading(); renderDate();
    }
    if (key === 'connections') renderMapDetails();
  });
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-view]')) { other.classList.toggle('active', other === button); other.setAttribute('aria-pressed', String(other === button)); }
    if (button.dataset.view === 'all') setCamera({ x: 0, y: 0, k: 1 });
    else if (button.dataset.view === 'west') fitCoordinates([[25, 10], [63, 43]]);
    else fitCoordinates([[60, 0], [98, 38]]);
  });
  $('search-input').addEventListener('input', renderSearch);
  $('search-input').addEventListener('focus', renderSearch);
  $('search-input').addEventListener('keydown', (event) => {
    if (['ArrowDown', 'Enter'].includes(event.key)) { event.preventDefault(); $('search-results').querySelector('button')?.focus(); }
    if (event.key === 'Escape') { closeSearch(); $('search-input').blur(); }
  });
  $('search-results').addEventListener('keydown', (event) => {
    const buttons = [...$('search-results').querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    if (event.key === 'Escape') { closeSearch(); $('search-input').focus(); }
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!event.target.closest('.search-wrap')) closeSearch();
    if (!event.target.closest('#layers-menu')) $('layers-menu').open = false;
    if (!target) return;
    if (target.dataset.pageJourney) { openJourney(target.dataset.pageJourney); return; }
    if (target.dataset.pageStory) { openStory(target.dataset.pageStory); return; }
    if (target.dataset.pageConnection) { openConnection(target.dataset.pageConnection); return; }
    if (target.hasAttribute('data-page-quiz')) { setReader(true); state.story = null; state.journey = null; state.connection = null; state.selected = null; state.pane = 'learn'; quizIndex = 0; quizAnswer = null; quizScore = 0; stopPlayback(); render(); updateUrl(); revealReadingPane(); return; }
    if (target.dataset.ribbonStop !== undefined) {
      if (!state.journey) openJourney(chronicle.journeys[0].id, Number(target.dataset.ribbonStop));
      else { stopPlayback(); setReader(true); goToStop(Number(target.dataset.ribbonStop), { scroll: true }); }
      return;
    }
    if (target.hasAttribute('data-reference-toggle')) { state.referenceYear = territoriesVisible() ? null : state.year; $('layer-territories').checked = true; render(); updateUrl(); document.querySelector('[data-reference-toggle]')?.focus({preventScroll:true}); return; }
    if (target.dataset.searchKind) {
      const kind = target.dataset.searchKind;
      const id = target.dataset.searchId;
      closeSearch(); $('search-input').value = '';
      if (kind === 'story') openStory(id);
      else if (kind === 'connection') openConnection(id);
      else if (kind === 'journey') openJourney(id);
      else selectRecord(kind, id, { focus: true });
    } else if (target.dataset.story) openStory(target.dataset.story);
    else if (target.dataset.storyStep !== undefined) openStory(state.story, Number(target.dataset.storyStep));
    else if (target.dataset.connection) openConnection(target.dataset.connection);
    else if (target.hasAttribute('data-quiz-start')) {
      stopPlayback(); state.story = null; state.connection = null; state.journey = null; state.selected = null; state.pane = 'learn'; quizIndex = 0; quizAnswer = null; quizScore = 0; render(); updateUrl(); revealReadingPane();
    } else if (target.dataset.answer !== undefined && quizIndex !== null && quizAnswer === null) {
      quizAnswer = Number(target.dataset.answer); if (quizAnswer === learning.quiz[quizIndex].answerIndex) quizScore++; renderReading(); $('reading-content').querySelector('[data-quiz-next]')?.focus({ preventScroll: true });
    } else if (target.hasAttribute('data-quiz-next')) { quizIndex++; quizAnswer = null; renderReading(); revealReadingPane(); $('reading-content').querySelector('[data-answer], [data-pane]')?.focus(); }
    else if (target.dataset.quizMap) { state.year = normalizeYear(target.dataset.quizYear); state.referenceYear = null; focusPoint(placeById.get(target.dataset.quizMap)?.coord, 2.4); render(); updateUrl(); document.querySelector('.map-section').scrollIntoView({behavior:reducedMotion.matches ? 'instant' : 'smooth',block:'start'}); tip(placeById.get(target.dataset.quizMap)?.name); }
    else if (target.hasAttribute('data-listen')) {
      if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); target.textContent = 'Listen to this page'; target.setAttribute('aria-pressed','false'); }
      else { const text = [...$('reading-content').querySelectorAll('h1,h2,.reading-intro,.story-step > p,.quiz-feedback p')].map(node => node.textContent).join('. '); const speech = new SpeechSynthesisUtterance(text || $('reading-content').querySelector('p')?.textContent || ''); speech.lang = 'en'; speech.rate = .9; speech.onend = speech.onerror = () => { target.textContent = 'Listen to this page'; target.setAttribute('aria-pressed','false'); }; window.speechSynthesis.speak(speech); target.textContent = 'Stop listening'; target.setAttribute('aria-pressed','true'); }
    } else if (target.dataset.place) selectRecord('place', target.dataset.place);
    else if (target.dataset.event) selectRecord('event', target.dataset.event, { focus: true });
    else if (target.dataset.polity) selectRecord('polity', target.dataset.polity);
    else if (target.dataset.journey) openJourney(target.dataset.journey);
    else if (target.dataset.pane) showPane(target.dataset.pane);
    else if (target.dataset.locate) {
      const place = placeById.get(target.dataset.locate);
      focusPoint(place?.coord);
      document.querySelector('.map-section').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
      tip(place?.name || 'Place selected');
    } else if (target.dataset.fitPolity) fitPolity(target.dataset.fitPolity);
    else if (target.dataset.year) { stopPlayback(); setYear(target.dataset.year); }
    else if (target.dataset.stop !== undefined) { stopPlayback(); goToStop(Number(target.dataset.stop), { scroll: true }); }
    else if (target.dataset.journeyStep) { stopPlayback(); goToStop(state.stop + Number(target.dataset.journeyStep)); }
    else if (target.hasAttribute('data-journey-play')) togglePlayback();
  });
  document.addEventListener('change', event => { if (event.target.id === 'event-region') { eventFilter = event.target.value; renderReading(); $('event-region')?.focus(); } });
  $('map-fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.atlas-shell').requestFullscreen(); }
    catch { toast('Fullscreen is unavailable in this browser. You can still zoom and pan the map.'); }
  });
  document.addEventListener('fullscreenchange', () => { const active = Boolean(document.fullscreenElement); $('map-fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen'); $('map-fullscreen').setAttribute('aria-pressed', String(active)); });
  $('share-button').addEventListener('click', async () => {
    updateUrl();
    try { await navigator.clipboard.writeText(location.href); toast('Link copied. It restores this date and selection.'); }
    catch {
      const input = document.createElement('input'); input.value = location.href; input.readOnly = true; input.setAttribute('aria-label', 'Share link');
      const content = $('toast'); content.replaceChildren(input); content.hidden = false; input.select();
      toastTimer = setTimeout(() => { content.hidden = true; }, 12000);
    }
  });
  document.addEventListener('keydown', (event) => {
    const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
    if (event.key === 'Escape') {
      closeSearch(); $('layers-menu').open = false;
      if (document.querySelector('.timeline').classList.contains('is-expanded')) { $('chronology-button').click(); $('chronology-button').focus(); return; }
      if (!editing && experience.readerOpen) { stopPlayback(); setReader(false, { focus: true }); updateUrl(); }
      return;
    }
    if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/') { event.preventDefault(); $('search-input').focus(); }
    if (event.key === ' ' && !event.target.closest('button, summary, a')) { event.preventDefault(); togglePlayback(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      if (event.shiftKey) { stopPlayback(); setYear(stepYear(state.year, direction * 10)); }
      else stepSnapshot(direction);
    }
  });
  addEventListener('popstate', () => { stopPlayback(); restoreUrl(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopPlayback(); cancelAnimationFrame(cameraFrame); } });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) cancelAnimationFrame(cameraFrame); });
  attachMapGestures();
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

async function boot() {
  try {
    [manifest, chronicle, base, learning] = await Promise.all(['data/region/manifest.json', 'data/region/chronicle.json', 'data/region/base.geojson', 'data/region/learning.json'].map(loadJson));
    atlas = window.ATLAS_SNAPSHOTS;
    if (!atlas || !manifest.snapshots?.length) throw new Error('The territory bundle or snapshot manifest is missing.');
    if (!chronicle.places?.length || !chronicle.sources?.length) throw new Error('The historical record dataset is incomplete.');
    manifest.snapshots.sort((a, b) => a.year - b.year);
    for (const entry of manifest.snapshots) if (!atlas[entry.id]) throw new Error(`Territory snapshot ${entry.id} is missing from the bundle.`);
    sourceById = new Map();
    for (const source of [...(manifest.sources || []), ...learning.sources, ...chronicle.sources]) sourceById.set(source.id, { ...sourceById.get(source.id), ...source });
    placeById = new Map(chronicle.places.map((place) => [place.id, place]));
    projector = new MercatorProjector(WIDTH, HEIGHT, manifest.config?.bounds || CONFIG.bounds);
    const span = CONFIG.maxYear - CONFIG.minYear;
    $('snapshot-ticks').innerHTML = manifest.snapshots.map((entry) => `<button class="snapshot-tick" type="button" data-year="${entry.year}" style="left:${((entry.year - CONFIG.minYear) / span * 100).toFixed(3)}%" aria-label="Open map dated ${esc(formatYear(entry.year))}" title="${esc(formatYear(entry.year))}"><span>${entry.year < 0 ? `${Math.abs(entry.year)} BCE` : entry.year}</span></button>`).join('');
    $('compact-map-dates').innerHTML = manifest.snapshots.map(entry => `<button class="compact-map-date" type="button" data-year="${entry.year}" aria-label="Open map dated ${esc(formatYear(entry.year))}" title="Map dated ${esc(formatYear(entry.year))}"><span>${entry.year < 0 ? `${Math.abs(entry.year)} BCE` : entry.year}</span></button>`).join('');
    learningViews = createLearningViews({data:learning, chronicle, esc, sourcesHtml, formatYear});
    mapDetails = createMapDetails({svg, projector, node:svgNode, linePath, metrics:symbolMetrics, chronicle, learning, formatYear, onEvent:id => {if (!hasMoved) selectRecord('event',id,{focus:true});}, onPolity:id => {if (!hasMoved) selectRecord('polity',id);}, onConnection:id => {if (!hasMoved) openConnection(id);}});
    timeline = createTimeline({manifest, chronicle, learning, onYear:year => {stopPlayback();setYear(year);}, onEvent:id => selectRecord('event',id,{focus:true}), onMode:() => {stopPlayback();renderDate();updateUrl();}, onSpeed:() => {if (playing) {stopPlayback();togglePlayback();}}, onWindow:() => updateUrl()});
    if (compactLayout.matches) $('legend').open = false;
    renderBase();
    renderPageSections();
    attachControls();
    restoreUrl();
    $('map-loading').hidden = true;
    document.documentElement.dataset.atlasReady = 'true';
    // Read-only inspection surface for accessible automation and dataset verification.
    window.geohistory = Object.freeze({
      getState: () => ({ ...state, experience: { ...experience }, selected: state.selected && { ...state.selected }, snapshotId: snapshot?.id || null, snapshotYear: snapshot?.year || null, territoriesVisible: territoriesVisible(), playing, mode: timeline?.getMode(), window: timeline?.getWindow(), quizIndex, quizAnswer, quizScore, camera: { ...camera } }),
      getCoverage: () => manifest.snapshots.map(({ id, year, title }) => ({ id, year, title })),
    });
  } catch (error) {
    $('map-loading').innerHTML = `<strong>The atlas could not open</strong><p>${esc(error.message)}.</p><button type="button" class="quiet-button" id="retry-load">Try again</button>`;
    $('retry-load').addEventListener('click', () => location.reload());
    $('coverage-status').textContent = 'Data unavailable. Retry to load the historical atlas.';
    document.documentElement.dataset.atlasReady = 'error';
  }
}

boot();
