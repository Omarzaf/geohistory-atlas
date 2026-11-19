// Run this function with the connected Playwright browser_run_code tool against the local server.
// It uses the existing browser context; it does not install packages or publish the site.
async (page, origin = 'http://127.0.0.1:8767') => {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const state = () => page.evaluate(() => window.geohistory.getState());
  const go = async (query = '?year=1600') => {
    await page.goto(origin + '/' + query);
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const check = async (name, fn) => { const details = await fn(); checks.push({ name, status: 'pass', details }); };
  const openChronology = async () => {
    if (await page.locator('#chronology-button').getAttribute('aria-expanded') !== 'true') await page.locator('#chronology-button').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const openReader = async () => {
    if (await page.locator('body').getAttribute('data-reader') !== 'open') await page.locator('#reading-toggle').click();
  };
  await page.setViewportSize({ width: 1440, height: 960 });
  await check('Alias search, record selection and URL restoration', async () => {
    await go();
    await page.locator('#search-input').fill('Constantinople');
    await page.locator('[data-search-kind="place"][data-search-id="istanbul"]').click();
    assert((await state()).selected.id === 'istanbul', 'Alias did not select Istanbul');
    const url = page.url(); await page.goto(url);
    await page.waitForFunction(() => window.geohistory?.getState().selected?.id === 'istanbul');
    return { restored: (await state()).selected };
  });
  await check('Event links normalize to the event date', async () => {
    for (const query of ['?event=cyrus-babylon', '?year=1947&event=cyrus-babylon']) {
      await go(query); assert((await state()).year === -539, `Wrong event year: ${query}`);
    }
    return { year: (await state()).year };
  });
  await check('Endpoint gaps, exact snapshots and BCE/CE', async () => {
    await go('?year=-600');
    assert((await state()).snapshotYear === null, '600 BCE was given a future map');
    assert(await page.locator('#territory-layer path').count() === 0, '600 BCE drew territories');
    await openChronology();
    await page.locator('#year-input').fill('1947'); await page.locator('#year-input').press('Enter');
    assert((await state()).snapshotYear === 1914, '1947 reference date incorrect');
    assert(!(await state()).territoriesVisible, 'Stale 1914 borders shown at 1947');
    assert(await page.locator('#territory-layer').evaluate(e => getComputedStyle(e).display === 'none'), 'Stale polygons are visible');
    assert((await page.locator('#map-date').innerText()).includes('No territory map for this year'), 'Missing-date disclosure absent');
    await page.locator('[data-reference-toggle]').click();
    assert((await state()).territoriesVisible, 'Reference opt-in did not show borders');
    assert(page.url().includes('reference=1'), 'Reference choice missing from share URL');
    await page.reload(); await page.waitForFunction(() => window.geohistory?.getState().territoriesVisible);
    await page.locator('[data-reference-toggle]').click();
    assert(!(await state()).territoriesVisible, 'Reference opt-out failed');
    await openChronology();
    await page.locator('#year-slider').fill('0');
    assert((await state()).year === 1, 'Year zero reached the UI');
    await go('?year=NaN&view=Infinity,garbage,0');
    assert((await state()).year === 1600 && (await state()).camera.k === 1, 'Malformed URL not normalized');
  });
  await check('Polity inspection, editorial correction and layers', async () => {
    await go('?year=1914');
    await page.locator('#legend-items [data-polity="c1914-ceylon"]').click();
    const text = await page.locator('#reading-content').innerText();
    assert(text.includes('United Kingdom') && /editorial|correction/i.test(text), 'Ceylon correction not disclosed');
    await page.locator('#layers-menu summary').click();
    await page.locator('#layer-territories').uncheck();
    assert(await page.locator('#territory-layer').evaluate(e => getComputedStyle(e).display === 'none'), 'Layer remained visible');
    await page.locator('#layer-territories').check();
  });
  await check('Mouse drag, zoom and keyboard map navigation', async () => {
    await go();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const mapBox=await page.locator('#map').boundingBox();
    const startX=mapBox.x+mapBox.width*.4,startY=mapBox.y+mapBox.height*.5;
    await page.mouse.move(startX,startY); await page.mouse.down();
    await page.mouse.move(startX+150,startY+50,{steps:12}); await page.mouse.up();
    assert((await state()).camera.x !== 0, 'Drag did not move map');
    await page.locator('#map-reset').click(); await page.locator('#zoom-in').click();
    assert((await state()).camera.k > 1, 'Zoom did not change camera');
    const before=(await state()).camera.x;
    await page.locator('#map').focus(); await page.keyboard.press('ArrowRight');
    assert((await state()).camera.x !== before, 'Keyboard pan failed');
  });
  await check('Snapshot and journey playback', async () => {
    await go('?year=1600'); await openChronology(); await page.locator('#play-button').click();
    await page.waitForFunction(() => window.geohistory.getState().year === 1800, { }, {timeout:6000});
    await page.locator('#play-button').click(); assert(!(await state()).playing, 'Playback failed to pause');
    await page.locator('.primary-nav a[href="#journeys-section"]').click(); await page.locator('[data-page-journey="ibn-battuta"]').click();
    await page.locator('[data-journey-play]').click();
    await page.waitForFunction(() => window.geohistory.getState().stop > 0, { }, {timeout:6000});
    await page.locator('[data-journey-play]').click();
    await page.locator('[data-stop="11"]').click();
    assert((await state()).stop === 11, 'Last stop unavailable');
    assert((await page.locator('#reading-content').innerText()).includes('No precise location pin'), 'Unlocated stop not disclosed');
    assert(!(await page.locator('#journey-layer').innerHTML()).includes('NaN'), 'Invalid journey geometry');
    const url=page.url(); await page.goto(url);
    await page.waitForFunction(() => window.geohistory?.getState().stop === 11);
  });
  await check('Empty search and source disclosure', async () => {
    await go(); await page.locator('#search-input').fill('zzzznohistoricalresult');
    assert(/no /i.test(await page.locator('#search-results').innerText()), 'No-results state absent');
    await page.locator('#sources-button').click();
    await page.locator('#sources-section .page-bibliography > summary').click();
    assert(await page.locator('#sources-section a[href^="https://"]').count() > 50, 'Source links missing');
    return { sourceLinks: await page.locator('#sources-section a[href^="https://"]').count() };
  });
  await check('Offline error and retry recovery', async () => {
    const pattern='**/data/region/chronicle.json';
    await page.route(pattern, route => route.abort('internetdisconnected'));
    await page.goto(origin);
    await page.locator('#retry-load').waitFor({state:'visible'});
    assert((await page.locator('#coverage-status').innerText()).includes('Data unavailable'), 'Missing load-error status');
    await page.unroute(pattern); await page.locator('#retry-load').click();
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
  });
  await check('Public allowlist returns 404 for excluded paths', async () => {
    const result=await page.evaluate(async () => {
      const results={};
      for (const path of ['/','/data/region/chronicle.json','/.git/config','/data/atlas/polities.geojson','/js/atlas_track.js','/receipts/regional-acquisition.json','/not-a-route']) results[path]=(await fetch(path,{method:'HEAD'})).status;
      return results;
    });
    assert(result['/']===200 && result['/data/region/chronicle.json']===200,'Public assets missing');
    for (const [path,status] of Object.entries(result).slice(2)) assert(status===404, `Excluded path exposed: ${path}`);
    return result;
  });
  await check('Mobile scroll, readable pins, touch targets and active map date', async () => {
    await page.setViewportSize({width:390,height:844}); await go(); await openReader(); await openChronology();
    const measurements=await page.evaluate(() => {
      const active=document.querySelector('.snapshot-tick.active').getBoundingClientRect();
      const strip=document.querySelector('#snapshot-ticks').getBoundingClientRect();
      const labels=[...document.querySelectorAll('#place-layer text')].filter(e=>getComputedStyle(e).display!=='none');
      const label=labels.find(e=>e.getBoundingClientRect().width>0);
      const controls=[...document.querySelectorAll('.playback-controls button,[data-view],.map-controls button,.snapshot-tick')];
      return {overflow:document.documentElement.scrollWidth>innerWidth,activeVisible:active.left>=strip.left-1&&active.right<=strip.right+1,labelHeight:label?.getBoundingClientRect().height,minControlHeight:Math.min(...controls.map(e=>e.getBoundingClientRect().height))};
    });
    assert(!measurements.overflow,'Mobile page overflows');
    assert(measurements.activeVisible,'Active snapshot offscreen');
    assert(measurements.labelHeight>=10,'Mobile place labels too small');
    assert(measurements.minControlHeight>=44,'Mobile touch control below44px');
    await page.locator('#chronology-button').click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(300,420); await page.mouse.wheel(0,500);
    await page.waitForFunction(()=>scrollY>100);
    await page.locator('#tab-places').click(); await page.locator('[data-place="taxila"]').click();
    assert((await page.locator('#reading-content').innerText()).includes('Unknown; no map pin'),'Null place turned into invented pin');
    await openChronology();
    await page.locator('#year-input').fill('1800'); await page.locator('#year-input').press('Enter');
    assert((await state()).year===1800,'Timeline inaccessible after mobile scrolling');
    return measurements;
  });
  await check('One-finger page scroll and two-finger map movement', async () => {
    await go();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const before=(await state()).camera;
    const startScroll=await page.evaluate(()=>scrollY);
    let mapBox=await page.locator('#map').boundingBox();
    const fingerX=mapBox.x+mapBox.width/2, fingerY=mapBox.y+mapBox.height*.7;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:fingerX,y:fingerY}]});
    for(let delta=20;delta<=180;delta+=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:fingerX,y:fingerY-delta}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(start=>scrollY>start+80,startScroll);
    assert((await state()).camera.x===before.x,'One-finger scrolling moved map');
    await page.locator('#map').scrollIntoViewIfNeeded();
    mapBox=await page.locator('#map').boundingBox();
    const middleX=mapBox.x+mapBox.width/2, middleY=mapBox.y+mapBox.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:middleX-50,y:middleY},{x:middleX+50,y:middleY}]});
    for(let x=10;x<=50;x+=10) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:middleX-50+x,y:middleY},{x:middleX+50+x,y:middleY}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const after=(await state()).camera;
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false}); await cdp.detach();
    assert(after.x!==before.x,'Two-finger map movement failed');
    return {before,after};
  });
  await page.setViewportSize({width:1440,height:960}); await go();
  return {checkedAt:new Date().toISOString(),scope:'Local Chromium via connected Playwright; not Safari or physical-device certification',checks};
}
