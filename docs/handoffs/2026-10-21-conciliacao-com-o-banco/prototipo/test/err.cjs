const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300)));
  await p.goto('file://' + process.cwd() + '/conciliacao-banco.html');
  await p.waitForTimeout(1000);
  await b.close();
})();
