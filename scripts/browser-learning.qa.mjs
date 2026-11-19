/** Behavioral checks for the integrated learning atlas, using an existing Playwright installation. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export async function verifyLearning(page, origin = 'http://127.0.0.1:8767') {
  const checks = [];
  const failures = [];
  const blocked = [];
  const state = () => page.evaluate(() => window.geohistory.getState());
  const go = async (query = '') => {
    await page.goto(`${origin}/${query}`);
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const check = async (name, run) => {
    try { await run(); checks.push({ name, status: 'pass' }); }
    catch (error) {
      if (error.name === 'EnvironmentBlocked') {
        checks.push({ name, status: 'blocked', message: error.message, details: error.details }); blocked.push(name);
        console.error(`Learning environment limitation: ${name}: ${error.message}`);
      } else { checks.push({ name, status: 'fail', message: error.message }); failures.push(name); console.error(`Learning: ${name}: ${error.message}`); }
    }
  };
  const openChronology = async () => {
    if (await page.locator('#chronology-button').getAttribute('aria-expanded') !== 'true') await page.locator('#chronology-button').click();
  };
  await page.setViewportSize({ width: 1440, height: 960 });
  await check('Guided stories drive dates, map focus, sources, and restorable chapters', async () => {
    await go('?pane=learn');
    assert.equal(await page.locator('[data-page-story]').count(), 5);
    await page.locator('[data-page-story="moving-capitals"]').click();
    assert.equal((await state()).year, 661);
    assert.equal((await state()).snapshotYear, 600);
    await page.locator('.story-controls [data-story-step="1"]').click();
    assert.equal((await state()).year, 762);
    assert((await state()).camera.k > 1);
    assert(await page.locator('#reading-content a[href^="https://"]').count() >= 2);
    await page.reload(); await page.waitForFunction(() => window.geohistory?.getState().storyStep === 1);
    await openChronology();
    await page.locator('#timeline-zoom-in').click();
    assert.equal((await state()).storyStep, 1, 'Timeline zoom closed the story');
    await page.reload(); await page.waitForFunction(() => window.geohistory?.getState().story === 'moving-capitals');
    assert((await state()).window.from > -600);
  });
  await check('Unsampled years keep stale borders, labels and political overlays hidden', async () => {
    for (const year of [762,1334,1947]) {
      await go('?year='+year);
      assert.equal((await state()).territoriesVisible,false);
      assert.equal(await page.locator('#polity-label-layer text').count(),0);
      assert(await page.locator('#legend').isHidden());
      if(year===762) assert(!(await page.locator('#reading-content h1').innerText()).includes('Sasanian'));
    }
    await go('?year=1947&reference=1&event=ibn-delhi');
    assert.equal((await state()).year,1334);
    assert.equal((await state()).territoriesVisible,false,'Reference consent moved to a different year');
    await go('?year=762&place=baghdad');
    assert(!(await page.locator('#reading-content').innerText()).includes('Geometry lookup'));
    await page.locator('[data-reference-toggle]').click();
    assert.equal((await state()).territoriesVisible,true);
    assert((await page.locator('#map-date').innerText()).includes('162 years earlier'));
    await openChronology();
    await page.locator('#year-input').fill('763'); await page.locator('#year-input').press('Enter');
    assert.equal((await state()).territoriesVisible,false);
    assert(!page.url().includes('reference=1'));
    await page.locator('[data-reference-toggle]').click();
    await page.locator('#layers-menu summary').click();
    await page.locator('#layer-territories').uncheck();
    assert(!page.url().includes('reference=1'));
    await page.reload(); await page.waitForFunction(()=>window.geohistory);
    assert.equal((await state()).territoriesVisible,false);
  });
  await check('Ranges, associated locations, and individual claims remain visible', async () => {
    await go('?event=abbasid-transition');
    assert.equal(await page.locator('#reading-content .date-line').innerText(),'749–750 CE');
    const text=await page.locator('#reading-content').innerText();
    assert(text.includes('Map anchor: Damascus') && text.includes('Kufa'));
    assert(text.includes('How the evidence connects'));
    await page.locator('.claim-evidence > summary').click();
    assert(await page.locator('.claim-evidence').innerText().then(text=>text.includes('749')));
    await page.locator('.claim-evidence .sources-details summary').first().click();
    assert(await page.locator('.claim-evidence a[href^="https://"]').count()>=2);
    await go('?event=cairo-women-protests-1919');
    assert.equal(await page.locator('#reading-content .date-line').innerText(),'March 1919 CE');
    await go('?event=shalamar-gardens');
    assert.equal(await page.locator('#reading-content .date-line').innerText(),'1641–1642 CE');
    await go('?event=nalanda-learning');
    assert.equal(await page.locator('#reading-content .date-line').innerText(),'Fifth century CE');
  });
  await check('Mobile older-reference control is reachable and reversible', async () => {
    await page.setViewportSize({width:390,height:844});
    await go('?year=762');
    const toggle=page.locator('[data-reference-toggle]');
    assert((await toggle.boundingBox()).height>=44);
    await toggle.click(); assert.equal((await state()).territoriesVisible,true);
    await toggle.click(); assert.equal((await state()).territoriesVisible,false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:1440,height:960});
  });
  await check('Recall feedback, score, completion, and restart', async () => {
    await go('?pane=learn'); await page.locator('[data-page-quiz]').click();
    const data = await page.evaluate(async () => (await fetch('data/region/learning.json')).json());
    for (let index = 0; index < data.quiz.length; index++) {
      await page.locator(`[data-answer="${data.quiz[index].answerIndex}"]`).click();
      assert(await page.locator('.quiz-feedback').isVisible());
      assert.equal((await state()).quizScore, index + 1);
      assert(await page.locator('[data-answer]').first().isDisabled());
      await page.locator('[data-quiz-next]').click();
    }
    assert((await page.locator('#reading-content').innerText()).includes('answered 10 correctly'));
    await page.locator('[data-quiz-start]').click();
    assert.equal((await state()).quizScore, 0);
  });
  await check('Incorrect answer explains evidence without awarding a point', async () => {
    await go('?pane=learn'); await page.locator('[data-page-quiz]').click();
    const correct = await page.evaluate(async () => (await (await fetch('data/region/learning.json')).json()).quiz[0].answerIndex);
    await page.locator(`[data-answer="${(correct + 1) % 3}"]`).click();
    assert.equal((await state()).quizScore, 0);
    assert.equal(await page.locator('.quiz-option.is-correct').count(), 1);
    assert.equal(await page.locator('.quiz-option.is-wrong').count(), 1);
  });
  await check('Connections retain their schematic meaning and share state', async () => {
    await go('?pane=learn'); await page.locator('[data-page-connection="three-courts-network"]').click();
    assert((await page.locator('#reading-content').innerText()).includes('not evidence of a direct road'));
    assert.equal((await state()).connection, 'three-courts-network');
    assert(await page.locator('.connection-path').count() > 0);
    await page.reload(); await page.waitForFunction(() => window.geohistory?.getState().connection === 'three-courts-network');
  });
  await check('Layer switches control distinct geographic overlays', async () => {
    await go(); await page.locator('#layers-menu summary').click();
    for (const [control, layer] of [['labels', 'polity-label-layer'], ['connections', 'connection-layer'], ['events', 'event-layer']]) {
      await page.locator(`#layer-${control}`).uncheck();
      assert.equal(await page.locator(`#${layer}`).evaluate(node => getComputedStyle(node).display), 'none');
      await page.locator(`#layer-${control}`).check();
    }
  });
  await check('Event browsing and filters remain reachable independently of map pins', async () => {
    await go('?pane=events');
    const all = await page.locator('#reading-content [data-event]').count();
    await page.locator('#event-region').selectOption({ index: 1 });
    assert((await page.locator('#reading-content [data-event]').count()) < all);
    await page.locator('#event-region').selectOption('all');
    assert.equal(await page.locator('#reading-content [data-event]').count(), all);
  });
  await check('Event mode steps deterministically, including records sharing a year', async () => {
    const events = await page.evaluate(async () => (await (await fetch('data/region/chronicle.json')).json()).events.sort((a,b) => a.year-b.year));
    await go(`?event=${events[0].id}&mode=events`);
    assert.equal((await state()).mode, 'events');
    await openChronology();
    for (const event of events.slice(1, 7)) {
      await page.locator('#next-snapshot').click();
      assert.equal((await state()).selected.id, event.id);
    }
    await page.locator('#playback-speed').selectOption('3');
    const prior = (await state()).selected.id;
    await page.locator('#play-button').click();
    await page.waitForFunction(id => window.geohistory.getState().selected?.id !== id, prior, {timeout:4000});
    await page.locator('#play-button').click();
    assert(!(await state()).playing);
  });
  await check('Fullscreen opens and exits through the map control', async () => {
    await go();
    await page.evaluate(() => {
      const original = Element.prototype.requestFullscreen;
      window.__qaFullscreenErrors = [];
      Element.prototype.requestFullscreen = function (...args) {
        const result = original.apply(this, args);
        result.catch(error => window.__qaFullscreenErrors.push({ name: error.name, message: error.message }));
        return result;
      };
      window.__qaRestoreFullscreen = () => { Element.prototype.requestFullscreen = original; };
    });
    try {
      await page.locator('#map-fullscreen').click();
      try {
        await page.waitForFunction(() => Boolean(document.fullscreenElement), {}, { timeout: 2500 });
        await page.locator('#map-fullscreen').click();
        await page.waitForFunction(() => !document.fullscreenElement);
      } catch (error) {
        const nativeErrors = await page.evaluate(() => window.__qaFullscreenErrors);
        if (!nativeErrors.some(entry => entry.name === 'TypeError' && entry.message === 'not granted')) throw error;
        assert(await page.locator('#toast').isVisible(), 'Native fullscreen denial did not show the fallback');
        assert.match(await page.locator('#toast').textContent(), /Fullscreen is unavailable in this browser.*zoom and pan/);
        assert.equal(await page.locator('#map-fullscreen').getAttribute('aria-pressed'), 'false');
        checks.push({ name: 'Denied native fullscreen provides the usable zoom-and-pan fallback', status: 'pass' });
        const limitation = new Error('Chrome denied the real fullscreen request; native fullscreen remains unverified.');
        limitation.name = 'EnvironmentBlocked';
        limitation.details = { nativeErrors, originalAssertion: error.message, fallbackVerified: true };
        throw limitation;
      }
    } finally { await page.evaluate(() => window.__qaRestoreFullscreen?.()); }
  });
  await check('Malformed deep links recover without invented years or broken chapters', async () => {
    await go('?year=0&story=moving-capitals&chapter=9999&window=bad,0');
    assert.equal((await state()).storyStep, 3);
    assert.notEqual((await state()).year, 0);
    await go('?story=unknown&connection=unknown&mode=nonsense');
    assert.equal((await state()).story, null);
    assert.equal((await state()).mode, 'maps');
  });
  await check('Mobile learning, expanded chronology, and final source remain readable in document flow', async () => {
    await page.setViewportSize({width:390,height:844}); await go('?pane=learn');
    await page.locator('[data-page-story="moving-capitals"]').click();
    await page.locator('.story-controls [data-story-step="1"]').click();
    assert.equal((await state()).year, 762);
    await openChronology();
    assert.equal(await page.locator('#timeline-expand').getAttribute('aria-expanded'), 'true');
    assert(await page.locator('#period-ribbon').isVisible());
    await page.locator('#timeline-zoom-in').click();
    assert.equal((await state()).storyStep, 1);
    await page.locator('#chronology-button').click();
    await page.locator('.sources-details summary').click();
    const link = page.locator('#reading-content .source-list a').last(); await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Final source is outside the visible page');
    assert(await link.evaluate(node => {
      const box=node.getClientRects()[0];
      const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
      return hit===node||node.contains(hit);
    }), 'Final source is covered by another element');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });
  await check('Finish review: visible learning entry, chapter framing, label clearance, and quiz context', async () => {
    await page.setViewportSize({width:390,height:844}); await go();
    const entry = await page.locator('#learn-button').boundingBox();
    assert(entry && entry.y >= 0 && entry.y + entry.height < 844);
    const collisions = await page.evaluate(() => {
      const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const places = [...document.querySelectorAll('#place-layer text')].map(node => node.getBoundingClientRect());
      return [...document.querySelectorAll('.polity-label')].filter(node => places.some(box => overlaps(node.getBoundingClientRect(), box))).map(node => node.textContent);
    });
    assert.deepEqual(collisions, []);
    await page.locator('#learn-button').click();
    assert.equal(new URL(page.url()).hash, '#stories-section');
    assert.equal(await page.locator('#stories-section [data-page-story]').count(),5);
    await page.locator('#stories-section [data-page-story="moving-capitals"]').click();
    assert.equal((await state()).story, 'moving-capitals');
    await page.setViewportSize({width:1440,height:960}); await go('?story=moving-capitals&chapter=1');
    assert((await state()).camera.k > 1, 'Direct story link did not focus the chapter');
    const pin = await page.locator('.story-map-marker').boundingBox();
    const badge = await page.locator('.map-date').boundingBox();
    assert(pin.x > badge.x + badge.width || pin.y > badge.y + badge.height, 'Active story marker is covered');
    await go('?pane=learn'); await page.locator('[data-page-quiz]').click();
    await page.locator('[data-answer="0"]').focus(); await page.keyboard.press('Enter');
    const heading = await page.locator('#reading-content h1').boundingBox();
    assert(heading.y >= 0 && heading.y + heading.height < 960, 'Answer feedback scrolled away the question');
  });
  return { checks, failures, blocked };
}

export async function captureLearning(page, directory, origin = 'http://127.0.0.1:8767') {
  await fs.mkdir(directory, {recursive:true});
  async function shot(name, query, width, height, action) {
    await page.setViewportSize({width,height}); await page.goto(`${origin}/${query}`);
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    await page.emulateMedia({reducedMotion:'reduce'});
    if (action) await action();
    await page.screenshot({path:`${directory}/${name}.png`, animations:'disabled'});
  }
  await shot('desktop','?year=1600',1440,960);
  await shot('desktop-learn','?pane=learn',1440,960);
  await shot('desktop-story','?story=moving-capitals&chapter=1',1440,960);
  await shot('desktop-quiz','?pane=learn',1440,960,async()=>{await page.locator('[data-page-quiz]').click(); await page.locator('[data-answer="0"]').click();});
  await shot('desktop-timeline','?year=1600',1440,960,async()=>{await page.locator('#chronology-button').click();await page.locator('#timeline-zoom-in').click();await page.locator('#timeline-zoom-in').click();});
  await shot('mobile','',390,844);
  await shot('mobile-story','?story=moving-capitals&chapter=1',390,844,async()=>{await page.locator('#reading-pane').scrollIntoViewIfNeeded();});
  await shot('mobile-expanded','',390,844,async()=>{await page.locator('#chronology-button').click();});
}
