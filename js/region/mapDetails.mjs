/** Detail overlays derived from the atlas's dated geometry and source-linked records. */
import { MercatorProjector } from './geometry.mjs';
import { CONFIG, formatRecordDate } from './model.mjs';

export function createMapDetails({ svg, projector, node, linePath, metrics, chronicle, learning, onEvent, onPolity, onConnection, formatYear }) {
  const places = new Map(chronicle.places.map(place => [place.id, place]));
  let previousId;
  let anchors = [];
  function prepare(snapshot) {
    if (previousId === snapshot?.id) return;
    previousId = snapshot?.id;
    anchors = (snapshot?.polities || []).flatMap(polity => {
      const rings = polity.shape.type === 'MultiPolygon' ? polity.shape.coordinates.flat() : polity.shape.coordinates;
      const points = rings.flat();
      const west = Math.max(CONFIG.bounds.west, Math.min(...points.map(p => p[0])));
      const east = Math.min(CONFIG.bounds.east, Math.max(...points.map(p => p[0])));
      const south = Math.max(CONFIG.bounds.south, Math.min(...points.map(p => p[1])));
      const north = Math.min(CONFIG.bounds.north, Math.max(...points.map(p => p[1])));
      if (west >= east || south >= north) return [];
      const projected = points.map(p => projector.toScreen(...p));
      let best;
      let clearance = -1;
      for (let ix = 1; ix < 10; ix++) for (let iy = 1; iy < 10; iy++) {
        const coord = [west + (east - west) * ix / 10, south + (north - south) * iy / 10];
        if (!MercatorProjector.pointInShape(...coord, polity.shape)) continue;
        const point = projector.toScreen(...coord);
        const distance = Math.min(...projected.map(p => Math.hypot(p[0] - point[0], p[1] - point[1])));
        if (distance > clearance) { best = point; clearance = distance; }
      }
      return best ? [{ polity, point: best, clearance }] : [];
    }).sort((a, b) => b.clearance - a.clearance);
  }
  function render({ snapshot, year, story, storyStep, connection, journey, exclusions = [], labelBoxes = [] }) {
    prepare(snapshot);
    const size = metrics();
    const labelLayer = document.getElementById('polity-label-layer');
    const eventLayer = document.getElementById('event-layer');
    const connectionLayer = document.getElementById('connection-layer');
    if (!labelLayer || !eventLayer || !connectionLayer) return;
    labelLayer.replaceChildren(); eventLayer.replaceChildren(); connectionLayer.replaceChildren();
    const boxes = [...exclusions, ...labelBoxes];
    const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    for (const { polity, point, clearance } of anchors) {
      const [x, y] = size.toPixels(...point);
      const text = polity.title || polity.sourceName;
      const width = Math.min(200, text.length * 7.2);
      const box = [x - width / 2, y - 12, x + width / 2, y + 12];
      if (clearance / size.unitsPerPixel < 20 || box[0] < 8 || box[2] > size.width - 8 || box[1] < 8 || box[3] > size.height - 8 || boxes.some(other => intersects(box, other))) continue;
      const label = node('text', { class: 'polity-label', style: `font-size:${13 * size.unitsPerPixel}px`, x: point[0], y: point[1], 'text-anchor': 'middle', 'font-size': 13 * size.unitsPerPixel, 'data-polity-label': polity.id });
      label.textContent = text;
      label.addEventListener('click', () => onPolity(polity.id));
      labelLayer.append(label); boxes.push(box);
    }
    const connections = connection ? learning.connections.filter(item => item.id === connection) : learning.connections.filter(item => item.fromYear <= year && item.toYear >= year);
    for (const item of connections) {
      // A null location breaks the line, rather than inventing a segment across missing evidence.
      let segment = [];
      const flush = () => { if (segment.length > 1) {
        const path = node('path', { d: linePath(segment), class: `connection-path ${item.kind === 'thematic comparison' ? 'comparison' : 'travel'}${connection === item.id ? ' active' : ''}`, 'data-connection-id': item.id });
        const title = node('title'); title.textContent = `${item.title} · ${item.geometryNote}`; path.append(title);
        path.addEventListener('click', () => onConnection(item.id)); connectionLayer.append(path);
      } segment = []; };
      for (const id of item.placeIds) { const coord = places.get(id)?.coord; if (coord) segment.push(coord); else flush(); }
      flush();
    }
    if (story) {
      const record = learning.stories.find(item => item.id === story);
      const stop = record?.stops[storyStep];
      const coord = places.get(stop?.placeId)?.coord;
      if (coord) {
        const point = projector.toScreen(...coord);
        const marker = node('g', { class: 'story-map-marker', transform: `translate(${point.join(' ')}) scale(${size.unitsPerPixel})` });
        marker.append(node('circle', { r: 19 }), node('circle', { r: 5 }));
        const title = node('title'); title.textContent = stop.title; marker.append(title); eventLayer.append(marker);
      }
    } else if (!journey) {
      const events = chronicle.events.filter(event => Math.abs(event.year - year) <= 80 && places.get(event.placeId)?.coord).sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year));
      const used = [];
      for (const event of events) {
        const point = projector.toScreen(...places.get(event.placeId).coord);
        const [x, y] = size.toPixels(...point);
        if (x < 22 || x > size.width - 22 || y < 22 || y > size.height - 22 || used.some(p => Math.hypot(x - p[0], y - p[1]) < 44)) continue;
        if (exclusions.some(box => intersects([x - 18, y - 18, x + 18, y + 18], box))) continue;
        const marker = node('g', { class: 'event-pin', transform: `translate(${point.join(' ')}) scale(${size.unitsPerPixel})`, 'data-map-event': event.id });
        marker.append(node('circle', { r: 22, class: 'map-symbol-hit' }), node('path', { d: 'M0 -10L9 0L0 10L-9 0Z' }));
        const title = node('title'); title.textContent = `${event.title} · ${formatRecordDate(event)} (within 80 years of selection)`; marker.append(title);
        marker.addEventListener('click', () => onEvent(event.id)); eventLayer.append(marker); used.push([x, y]);
      }
    }
  }
  return { render };
}
