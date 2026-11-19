/** Exercise the Confluence entry, journey instrument and reading surfaces in a real browser. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function verifyConfluence(page, origin = 'http://127.0.0.1:8767') {
  const checks = [];
  const failures = [];
  const consoleErrors = [];
  const recordConsole = message => { if (message.type() === 'error') consoleErrors.push(message.text()); };
  page.on('console', recordConsole);
  const state = () => page.evaluate(() => window.geohistory.getState());
  const settleScroll = () => page.evaluate(() => new Promise(resolve => {
    let previous=null,stable=0;
    const frame=()=>{stable=scrollY===previous?stable+1:0;previous=scrollY;if(stable>=4)resolve();else requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
  }));
  const go = async (query = '') => {
    await page.goto(`${origin}/${query}`);
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settleScroll();
  };
  const check = async (name, run) => {
    try { const details = await run(); checks.push({ name, status: 'pass', ...(details ? { details } : {}) }); }
    catch (error) { checks.push({ name, status: 'fail', message: error.message }); failures.push(name); console.error(`Confluence: ${name}: ${error.message}`); }
  };
  await page.setViewportSize({ width: 1440, height: 960 });
  await check('Welcome uses 1334, three curated stops and an explicit boundary gap', async () => {
    await go();
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'welcome');
    assert.equal((await state()).year, 1334);
    assert.equal((await state()).territoriesVisible, false);
    assert.equal(await page.locator('#polity-label-layer text').count(), 0);
    assert(await page.locator('#legend').isHidden());
    assert.match(await page.locator('#map-date').innerText(), /No territory map for this year/);
    assert.deepEqual(await page.locator('#welcome-layer [data-highlight-place]').evaluateAll(nodes => nodes.map(node => node.dataset.highlightPlace)), ['cairo', 'delhi', 'kozhikode']);
    assert.deepEqual(await page.locator('#welcome-layer text').allTextContents(), ['Cairo', 'Delhi', 'Kozhikode']);
    assert.deepEqual(await page.locator('#journey-stops [data-ribbon-stop]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.ribbonStop))), [1, 8, 9]);
    assert.match(await page.locator('#map-story-note').innerText(), /schematic connections, not routes/);
    assert.equal(await page.locator('#reading-pane').evaluate(node => node.inert), true);
  });
  await check('Compact date shortcuts exactly match the ten accepted maps', async () => {
    await go('?year=1600');
    const expected = [-500, -200, 200, 600, 900, 1100, 1500, 1600, 1800, 1914];
    const manifestYears = await page.evaluate(async () => (await (await fetch('data/region/manifest.json')).json()).snapshots.map(entry => entry.year));
    const shown = await page.locator('#compact-map-dates [data-year]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.year)));
    assert.deepEqual(manifestYears, expected);
    assert.deepEqual(shown, expected);
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'atlas');
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'closed');
    await page.locator('#layers-menu summary').click();
    await page.locator('#layer-territories').uncheck();
    assert.equal((await state()).territoriesVisible, false);
    assert.equal(await page.locator('#compact-coverage').innerText(), 'Territory layer hidden · map available');
    await page.locator('#layer-territories').check();
    assert.equal((await state()).territoriesVisible, true);
    assert.equal(await page.locator('#compact-coverage').innerText(), 'Dated map · approximate territories');
    await page.locator('#layers-menu summary').click();
    await page.locator('#compact-map-dates [data-year="900"]').click();
    assert.equal((await state()).year, 900);
    assert.equal((await state()).territoriesVisible, true);
    await page.reload(); await page.waitForFunction(() => window.geohistory?.getState().year === 900);
    return { dates: shown };
  });
  await check('Journey entry exposes twelve source-backed stops and preserves the unlocated final stop', async () => {
    await go(); await page.locator('#begin-journey').click();
    assert.equal((await state()).journey, 'ibn-battuta');
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'journey');
    assert.equal(await page.locator('#journey-stops [data-ribbon-stop]').count(), 12);
    const expected = await page.evaluate(async () => {
      const data = await (await fetch('data/region/chronicle.json')).json();
      const places = new Map(data.places.map(place => [place.id, place]));
      return data.journeys.find(journey => journey.id === 'ibn-battuta').stops.map(stop => places.get(stop.placeId)?.name || stop.title);
    });
    const labels = await page.locator('#journey-stops [data-ribbon-stop]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    expected.forEach((name, index) => assert(labels[index].includes(name), `Missing actual stop ${index + 1}: ${name}`));
    await page.locator('#journey-stops [data-ribbon-stop="8"]').click();
    assert.equal((await state()).stop, 8);
    assert.equal((await state()).year, 1334);
    assert.equal(await page.locator('#journey-stops [data-ribbon-stop="8"]').getAttribute('aria-current'), 'step');
    assert.match(await page.locator('#map-story-note').innerText(), /schematic connections, not reconstructed routes/);
    await page.locator('#journey-stops [data-ribbon-stop="11"]').click();
    assert.match(await page.locator('#reading-content').innerText(), /No precise location pin/);
    assert(!(await page.locator('#journey-layer').innerHTML()).includes('NaN'));
    await page.reload(); await page.waitForFunction(() => window.geohistory?.getState().stop === 11);
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'open');
    await page.locator('#reading-content [data-pane="journeys"]').click();
    assert.equal((await state()).journey, null, 'All journeys did not return to the gallery');
    assert(await page.locator('#journeys-section [data-page-journey="ibn-battuta"]').isVisible());
    await page.locator('#journeys-section [data-page-journey="ibn-battuta"]').click();
    assert.equal((await state()).journey, 'ibn-battuta');
    assert.equal(await page.locator('#journey-stops [data-ribbon-stop]').count(), 12);
    return { stops: expected };
  });
  await check('Welcome highlight opens its real journey stop; free exploration clears the journey', async () => {
    await go(); await page.locator('#welcome-layer [data-highlight-place="delhi"]').click();
    assert.equal((await state()).journey, 'ibn-battuta');
    assert.equal((await state()).stop, 8);
    assert.equal((await state()).year, 1334);
    await go(); await page.locator('#explore-map').click();
    assert.equal(await page.locator('body').getAttribute('data-mode'), 'atlas');
    assert.equal((await state()).journey, null);
    assert(await page.locator('#map-intro').isHidden());
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'closed');
  });
  await check('Reader opens, returns keyboard focus, and restores a closed selected-record URL', async () => {
    await go('?year=1600'); await page.locator('#reading-toggle').click();
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'open');
    assert.equal(await page.locator('#reading-pane').evaluate(node => node.inert), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'closed');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'reading-toggle');
    assert.equal(await page.locator('#reading-pane').evaluate(node => node.inert), true);
    await go('?year=1600&place=baghdad');
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'open');
    await page.locator('#reader-close').click();
    assert.equal(new URL(page.url()).searchParams.get('reader'), '0');
    assert.equal(new URL(page.url()).searchParams.get('place'), 'baghdad');
    await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    assert.equal((await state()).selected.id, 'baghdad');
    assert.equal(await page.locator('body').getAttribute('data-reader'), 'closed');
    await page.locator('#reading-toggle').click();
    assert.match(await page.locator('#reading-content h1').innerText(), /Baghdad/);
  });
  await check('Expanded chronology is operable and Escape returns focus to its opener', async () => {
    await go('?year=1600');
    assert(await page.locator('#timeline-details').isHidden());
    await page.locator('#chronology-button').click();
    assert(await page.locator('#timeline-details').isVisible());
    assert.equal(await page.locator('#chronology-button').getAttribute('aria-expanded'), 'true');
    await page.locator('#year-input').fill('762'); await page.locator('#year-input').press('Enter');
    assert.equal((await state()).year, 762);
    assert.equal((await state()).territoriesVisible, false);
    await page.locator('#year-input').focus(); await page.keyboard.press('Escape');
    assert(await page.locator('#timeline-details').isHidden());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'chronology-button');
    assert.equal(await page.locator('#chronology-button').getAttribute('aria-expanded'), 'false');
  });
  await check('Journey playback advances, pauses, and stops on a simulated hidden-page event', async () => {
    await go('?journey=ibn-battuta&stop=0');
    await page.locator('#chronology-button').click(); await page.locator('#playback-speed').selectOption('3');
    await page.locator('#chronology-button').click();
    await page.locator('#journey-toggle').click();
    await page.waitForFunction(() => window.geohistory.getState().stop > 0, {}, { timeout: 5000 });
    await page.locator('#journey-toggle').click();
    assert.equal((await state()).playing, false);
    assert.equal(await page.locator('#journey-toggle').getAttribute('aria-pressed'), 'false');
    const pausedStop = (await state()).stop;
    await page.waitForTimeout(1550);
    assert.equal((await state()).stop, pausedStop, 'Paused playback continued advancing');
    await page.locator('#journey-toggle').click();
    assert.equal((await state()).playing, true);
    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(document, 'hidden');
      try {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        if (original) Object.defineProperty(document, 'hidden', original);
        else delete document.hidden;
      }
    });
    assert.equal((await state()).playing, false);
    return { visibilityScope: 'Synthetic visibility event exercises the pause handler; not OS background-tab certification.' };
  });
  await check('Reduced motion settles selection immediately and whole-journey framing changes the camera', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      await go('?journey=ibn-battuta&stop=0');
      await page.locator('#journey-stops [data-ribbon-stop="8"]').click();
      const selected = (await state()).camera;
      assert(selected.k > 1);
      await page.waitForTimeout(550);
      assert.deepEqual((await state()).camera, selected, 'Reduced-motion camera kept moving');
      await page.locator('#ribbon-fit').click();
      const whole = (await state()).camera;
      assert.notDeepEqual(whole, selected, 'Whole-journey framing did not move the camera');
      await page.waitForTimeout(550);
      assert.deepEqual((await state()).camera, whole);
      return { selected, whole };
    } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
  });
  await check('Journey and story readers stay in document flow without horizontal clipping', async () => {
    const measurements = [];
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 960 });
      for (const query of ['?journey=ibn-battuta&stop=8', '?story=moving-capitals&chapter=1']) {
        await go(query);
        assert.equal(await page.locator('body').getAttribute('data-reader'), 'open');
        assert(await page.getByRole('button', { name: 'Share view', exact: true }).isVisible(), 'Share control lacks its accessible name');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow: ${width} ${query}`);
        const boxes = await page.evaluate(() => {
          const selectors = ['.brand', '.primary-nav', '.header-search', '.header-actions', '#reading-pane', '#reader-close', '#reading-content h1'];
          return selectors.map(selector => {
            const element = document.querySelector(selector);
            const box = element.getBoundingClientRect();
            return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, visible: getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none' };
          });
        });
        for (const box of boxes) {
          assert(box.visible && box.width > 0 && box.height > 0, `Missing visible ${box.selector}: ${width} ${query}`);
          assert(box.left >= -1 && box.right <= width + 1, `Clipped ${box.selector} (${box.left}…${box.right}) at ${width} ${query}`);
        }
        const reader = boxes.find(box => box.selector === '#reading-pane');
        const heading = boxes.find(box => box.selector === '#reading-content h1');
        assert(heading.top >= reader.top && heading.bottom <= reader.bottom, `Reader heading is outside its visible pane at ${width} ${query}`);
        measurements.push({ width, query, reader });
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    return measurements;
  });
  await check('Selected journey stop title, date and account lead the reader', async () => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      await go('?journey=ibn-battuta&stop=8');
      const stop = await page.evaluate(async () => (await (await fetch('data/region/chronicle.json')).json()).journeys.find(journey => journey.id === 'ibn-battuta').stops[8]);
      assert.equal(await page.locator('#reading-content h1').innerText(), stop.title);
      assert.equal(await page.locator('.journey-active-copy').innerText(), stop.description);
      assert.match(await page.locator('#reading-content > .record-subtitle').innerText(), /1334.*Delhi/);
      assert.match(await page.locator('.journey-eyebrow').innerText(), /stop 9 of 12/i);
      assert.equal(await page.locator('#reading-content [data-stop]').count(), 12);
      const position = await page.evaluate(() => {
        const reader = document.querySelector('#reading-pane').getBoundingClientRect();
        const title = document.querySelector('#reading-content h1').getBoundingClientRect();
        const copy = document.querySelector('.journey-active-copy').getBoundingClientRect();
        return { titleOffset: title.top - reader.top, copyOffset: copy.top - reader.top };
      });
      assert(position.titleOffset >= 0 && position.titleOffset < 260, `Current stop title buried at ${width}px: ${position.titleOffset}`);
      assert(position.copyOffset < 500, `Current account buried at ${width}px: ${position.copyOffset}`);
      const copy = page.locator('.journey-active-copy');
      await copy.scrollIntoViewIfNeeded();
      const copyBox = await copy.boundingBox();
      assert(copyBox && copyBox.y >= 0 && copyBox.y + copyBox.height <= page.viewportSize().height, `Current account obscured at ${width}px`);
      assert(await copy.evaluate(node=>{const box=node.getBoundingClientRect();const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return hit===node||node.contains(hit);}), `Current account covered at ${width}px`);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });
  await check('All three mobile welcome pins and labels receive real pointer input after ordinary scrolling', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const measurements = [];
    for (const [id, expectedStop] of [['cairo', 1], ['delhi', 8], ['kozhikode', 9]]) {
      await go();
      await page.mouse.move(190, 350); await page.mouse.wheel(0, 350);
      await page.waitForFunction(() => scrollY > 30);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.locator(`#welcome-layer [data-highlight-place="${id}"]`).evaluate(group => {
        const pin = group.querySelector('circle:not(.map-symbol-hit)').getBoundingClientRect();
        const label = group.querySelector('text').getBoundingClientRect();
        const hit = box => document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('[data-highlight-place]')?.getAttribute('data-highlight-place') || null;
        return {
          x: pin.left + pin.width / 2, y: pin.top + pin.height / 2,
          pinHit: hit(pin), labelHit: hit(label), scroll: scrollY,
          pinTopElement: document.elementFromPoint(pin.left + pin.width / 2, pin.top + pin.height / 2)?.outerHTML.slice(0, 250),
          labelTopElement: document.elementFromPoint(label.left + label.width / 2, label.top + label.height / 2)?.outerHTML.slice(0, 250),
          labelVisible: label.left >= 0 && label.right <= innerWidth && label.top >= 0 && label.bottom <= innerHeight,
          pinVisible: pin.left >= 0 && pin.right <= innerWidth && pin.top >= 0 && pin.bottom <= innerHeight,
        };
      });
      assert(geometry.pinVisible && geometry.labelVisible, `${id} pin or label is clipped after scrolling`);
      assert.equal(geometry.pinHit, id, `${id} pin is covered: ${geometry.pinTopElement}`);
      assert.equal(geometry.labelHit, id, `${id} label is covered: ${geometry.labelTopElement}`);
      await page.mouse.click(geometry.x, geometry.y);
      assert.equal((await state()).journey, 'ibn-battuta');
      assert.equal((await state()).stop, expectedStop);
      measurements.push({ id, ...geometry });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    return measurements;
  });
  await check('Mobile records and permanent sources remain readable without overlay controls', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const query of ['', '?year=1600', '?journey=ibn-battuta&stop=9', '?story=moving-capitals&chapter=1']) {
      await go(query);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${query || 'welcome'}`);
      assert(await page.getByRole('button', { name: 'Share view', exact: true }).isVisible(), 'Mobile share control lacks its accessible name');
      if (query.includes('journey=') || query.includes('story=')) {
        assert.equal(await page.locator('body').getAttribute('data-reader'), 'open');
        const reader = await page.locator('#reading-pane').boundingBox();
        assert(reader && reader.x >= -1 && reader.x + reader.width <= 391, `Mobile reader clipped at ${query}`);
        const heading = page.locator('#reading-content h1');
        await heading.scrollIntoViewIfNeeded();
        const box = await heading.boundingBox();
        assert(box && box.x >= -1 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 844, `Mobile reader heading obscured at ${query}`);
      }
    }
    await page.locator('#sources-button').click();
    await page.locator('#sources-section .page-bibliography > summary').click();
    const link = page.locator('#sources-section .source-list a').last();
    await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Final source is outside the visible page');
    assert.equal(await link.evaluate(node => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (node === hit || node.contains(hit)));
    }), true, 'Final source cannot receive a pointer');
    await page.setViewportSize({ width: 1440, height: 960 });
    return { sourceBottom: bounds.y + bounds.height, viewportHeight: 844 };
  });
  await check('Narrow, tablet and landscape welcome pins and primary action remain reachable', async () => {
    const measurements = [];
    const wheelIntoClearView = async locator => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const box = await locator.boundingBox();
        assert(box, 'Missing control geometry');
        const availableBottom = page.viewportSize().height;
        if (box.y >= 12 && box.y + box.height <= availableBottom - 12) return;
        const previousScroll = await page.evaluate(() => scrollY);
        await page.mouse.move(40, 90);
        await page.mouse.wheel(0, box.y + box.height / 2 - availableBottom / 2);
        await page.waitForFunction(prior => Math.abs(scrollY - prior) > 1, previousScroll, { timeout: 2000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    };
    for (const viewport of [{ width: 320, height: 844 }, { width: 768, height: 960 }, { width: 820, height: 960 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      for (const [id, stop] of [['cairo', 1], ['delhi', 8], ['kozhikode', 9]]) {
        await go();
        await page.mouse.move(80, 160); await page.mouse.wheel(0, 350);
        await page.waitForFunction(() => scrollY > 20);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const group = page.locator(`#welcome-layer [data-highlight-place="${id}"]`);
        await wheelIntoClearView(group);
        const geometry = await group.evaluate(node => {
          const pin = node.querySelector('circle:not(.map-symbol-hit)').getBoundingClientRect();
          const label = node.querySelector('text').getBoundingClientRect();
          const point = box => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
          const hit = box => { const position = point(box); return document.elementFromPoint(position.x, position.y)?.closest('[data-highlight-place]')?.getAttribute('data-highlight-place'); };
          return { ...point(pin), pinHit: hit(pin), labelHit: hit(label), labelClear: label.left >= 0 && label.right <= innerWidth && label.top >= 0 && label.bottom <= innerHeight, scroll: scrollY };
        });
        assert.equal(geometry.pinHit, id, `Pin inaccessible: ${viewport.width}×${viewport.height} ${id}`);
        assert.equal(geometry.labelHit, id, `Label inaccessible: ${viewport.width}×${viewport.height} ${id}`);
        assert(geometry.labelClear, `Clipped label: ${viewport.width}×${viewport.height} ${id}`);
        await page.mouse.click(geometry.x, geometry.y);
        assert.equal((await state()).journey, 'ibn-battuta'); assert.equal((await state()).stop, stop);
        measurements.push({ viewport, id, ...geometry });
      }
      await go();
      const begin = page.locator('#begin-journey');
      await wheelIntoClearView(begin);
      const box = await begin.boundingBox();
      const hit = await begin.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return top === node || node.contains(top);
      });
      assert(hit, `Primary action is covered at ${viewport.width}×${viewport.height}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal((await state()).journey, 'ibn-battuta');
      assert.equal(await page.locator('#journey-stops [data-ribbon-stop]').count(), 12);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    return measurements;
  });
  await check('Atlas, journeys, stories and sources form one ordered document with anchor navigation', async () => {
    await page.setViewportSize({width:1440,height:960}); await go();
    const ids=['atlas-section','journeys-section','stories-section','sources-section'];
    assert(await page.locator('body').evaluate(node=>node.classList.contains('continuous-page')));
    const layout=await page.evaluate(sectionIds=>sectionIds.map(id=>{
      const node=document.getElementById(id),style=getComputedStyle(node),box=node.getBoundingClientRect();
      return {id,top:box.top+scrollY,bottom:box.bottom+scrollY,height:box.height,display:style.display,visibility:style.visibility,hidden:node.hidden,inert:node.inert};
    }),ids);
    for(let index=0;index<layout.length;index++) {
      const section=layout[index];
      assert(section.height>0&&!section.hidden&&!section.inert&&section.display!=='none'&&section.visibility!=='hidden',`Missing persistent section: ${section.id}`);
      if(index) assert(section.top>=layout[index-1].bottom-1,`Sections overlap or are out of order: ${section.id}`);
    }
    assert(await page.locator('.timeline').evaluate(node=>Boolean(node.closest('main'))),'Chronology is outside the main document');
    assert(await page.locator('.timeline').evaluate(node=>!['fixed','absolute','sticky'].includes(getComputedStyle(node).position)),'Chronology overlays the document');
    const pathname=new URL(page.url()).pathname;
    await page.evaluate(()=>{window.__qaContinuousDocument='same-document';});
    for(const id of ['journeys-section','stories-section','sources-section','atlas-section']) {
      await page.locator(`.primary-nav a[href="#${id}"]`).click(); await settleScroll();
      assert.equal(new URL(page.url()).pathname,pathname);
      assert.equal(new URL(page.url()).hash,`#${id}`);
      assert.equal(await page.evaluate(()=>window.__qaContinuousDocument),'same-document','Header navigation loaded another document');
      const box=await page.locator(`#${id}`).boundingBox();
      assert(box&&box.y>=-1&&box.y<480,`Anchor did not reveal ${id}`);
      for(const section of ids) assert(await page.locator(`#${section}`).isVisible(),`Navigation hid ${section}`);
    }
    return layout;
  });
  await check('Persistent journey and story directories survive selections and return links', async () => {
    await go();
    const sectionIds=['atlas-section','journeys-section','stories-section','sources-section'];
    const counts=async()=>({journeys:await page.locator('[data-page-journey]').count(),stories:await page.locator('[data-page-story]').count(),connections:await page.locator('[data-page-connection]').count(),quiz:await page.locator('[data-page-quiz]').count(),sources:await page.locator('#sources-section a[href^="https://"]').count()});
    const before=await counts();
    assert.equal(before.stories,5); assert.equal(before.connections,4); assert(before.journeys>0&&before.quiz>0&&before.sources>50);
    await page.locator('[data-page-journey="ibn-battuta"]').click(); await settleScroll();
    assert.equal((await state()).journey,'ibn-battuta');
    assert(await page.locator('#reading-pane').evaluate(node=>!['fixed','absolute'].includes(getComputedStyle(node).position)),'Contextual reader floats over the page');
    assert.deepEqual(await counts(),before);
    for(const id of sectionIds) assert(await page.locator(`#${id}`).isVisible(),`Journey selection hid ${id}`);
    await page.locator('#reading-content [data-pane="journeys"]').click(); await settleScroll();
    assert.equal((await state()).journey,null);
    let directory=await page.locator('#journeys-section').boundingBox();
    assert(directory.y>=-1&&directory.y<480,'Back to journeys did not scroll to the permanent directory');
    await page.locator('[data-page-story="moving-capitals"]').click(); await settleScroll();
    assert.equal((await state()).story,'moving-capitals'); assert.equal((await state()).year,661);
    assert.deepEqual(await counts(),before);
    await page.locator('#reading-content [data-pane="learn"]').click(); await settleScroll();
    directory=await page.locator('#stories-section').boundingBox();
    assert(directory.y>=-1&&directory.y<480,'Back to stories did not scroll to the permanent directory');
    for(const id of sectionIds) assert(await page.locator(`#${id}`).isVisible(),`Story navigation hid ${id}`);
    return before;
  });
  await check('Ordinary wheel input scrolls over the map while Ctrl+wheel zooms the map', async () => {
    await go('?year=1600'); await page.locator('#map').scrollIntoViewIfNeeded(); await settleScroll();
    let box=await page.locator('#map').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    const before=await state(),startScroll=await page.evaluate(()=>scrollY);
    await page.mouse.wheel(0,400); await page.waitForFunction(start=>scrollY>start+100,startScroll); await settleScroll();
    assert.deepEqual((await state()).camera,before.camera,'Ordinary page scrolling changed the map camera');
    await page.locator('#map').scrollIntoViewIfNeeded(); await settleScroll(); box=await page.locator('#map').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.keyboard.down('Control');
    try {await page.mouse.wheel(0,-200);await page.waitForFunction(k=>window.geohistory.getState().camera.k>k,before.camera.k);}
    finally {await page.keyboard.up('Control');}
    assert((await state()).camera.k>before.camera.k,'Ctrl+wheel failed to zoom the map');
  });
  await check('The final permanent source is reachable by ordinary page scrolling', async () => {
    await page.setViewportSize({width:390,height:844}); await go();
    await page.locator('#sources-button').click(); await settleScroll();
    await page.locator('#sources-section .page-bibliography > summary').click(); await settleScroll();
    const link=page.locator('#sources-section a[href^="https://"]').last();
    let scrollSteps=0;
    for(let attempt=0;attempt<40;attempt++) {
      const box=await link.boundingBox();
      if(box.y>=10&&box.y+box.height<=834) break;
      const before=await page.evaluate(()=>scrollY);
      await page.mouse.move(300,420); await page.mouse.wheel(0,Math.max(-900,Math.min(900,box.y+box.height/2-422)));
      await page.waitForFunction(value=>Math.abs(scrollY-value)>1,before,{timeout:2000}); await settleScroll(); scrollSteps++;
    }
    const box=await link.boundingBox();
    assert(scrollSteps>0,'Source scrolling was not exercised');
    assert(box.y>=0&&box.y+box.height<=844,'Last source remains outside the viewport after scrolling');
    assert(await link.evaluate(node=>{const box=node.getClientRects()[0];const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);return hit===node||node.contains(hit);}),'Last source is covered');
    assert.equal(new URL(page.url()).pathname,'/');
    await page.setViewportSize({width:1440,height:960});
    return {scrollSteps,sourceBottom:box.y+box.height};
  });
  await check('Continuous-page flows produce no browser console errors', async () => assert.deepEqual(consoleErrors, []));
  page.off('console', recordConsole);
  return { checks, failures, consoleErrors };
}

export async function captureConfluence(page, directory, origin = 'http://127.0.0.1:8767') {
  await fs.mkdir(directory, { recursive: true });
  const captures = [];
  const shot = async (name, query, width, height, action, fullPage=false) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/${query}`);
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    if (action) await action();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const path = `${directory}/${name}.png`;
    await page.screenshot({ path, animations: 'disabled',fullPage });
    captures.push(path);
  };
  await shot('desktop-full-page', '', 1440, 960,undefined,true);
  await shot('desktop-atlas', '?year=1600', 1440, 960);
  await shot('desktop-journey', '?journey=ibn-battuta&stop=8', 1440, 960);
  await shot('desktop-chronology', '?year=1600', 1440, 960, async () => page.locator('#chronology-button').click());
  await shot('desktop-sources', '', 1440, 960,async()=>page.locator('#sources-button').click());
  await shot('mobile-full-page', '', 390, 844,undefined,true);
  await shot('mobile-atlas', '?year=1600', 390, 844);
  await shot('mobile-journey', '?journey=ibn-battuta&stop=8', 390, 844, async () => page.locator('#reading-pane').scrollIntoViewIfNeeded());
  await shot('mobile-chronology', '?year=1600', 390, 844, async () => page.locator('#chronology-button').click());
  return captures;
}
