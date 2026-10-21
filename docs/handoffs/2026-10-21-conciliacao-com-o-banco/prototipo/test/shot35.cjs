const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1960, height: 1500 } });
  const erros = [];
  p.on('pageerror', e => erros.push(e.message));
  await p.goto('file://' + process.cwd() + '/conciliacao-banco.html');
  await p.click('text=Esconder notas');
  const txt = async (sel) => (await p.innerText(sel)).replace(/\s+/g, ' ');
  const out = {};
  await p.click('.pg-seg >> text=Contas a Pagar');
  const abrir = async (busca) => {
    await p.fill('input[placeholder^="Buscar"]', busca);
    await p.waitForTimeout(100);
    await p.locator('tbody tr').first().locator('button:has-text("Baixar")').click();
    await p.waitForTimeout(150);
  };
  // 1. Boleto que venceu no sábado 17/10: pago na segunda 19/10 = em dia
  await abrir('Limpeza');
  await p.selectOption('#baixa-forma', 'boleto');
  await p.waitForTimeout(80);
  out.link = await p.locator('#baixa-juros-abrir').count();
  await p.fill('#baixa-data', '2026-10-19');
  await p.waitForTimeout(80);
  out.segunda = (await txt('[role=dialog]')).match(/Juros e multa.{0,160}/)?.[0];
  await p.fill('#baixa-data', '2026-10-20');
  await p.waitForTimeout(80);
  out.terca = (await txt('[role=dialog]')).match(/Juros e multa.{0,200}/)?.[0];
  await p.screenshot({ path: 'test/35-link.png' });
  await p.click('#baixa-juros-abrir');
  await p.waitForTimeout(80);
  out.aberto = (await txt('[role=dialog]')).match(/Valor dos juros e da multa.{0,240}/)?.[0];
  await p.fill('#baixa-juros', '12,30');
  await p.screenshot({ path: 'test/35-aberto.png' });
  out.previa = (await txt('[role=dialog]')).match(/Juros.{0,80}12,30.{0,40}/)?.[0];
  await p.click('#baixa-juros-remover');
  await p.waitForTimeout(80);
  out.removido = { link: await p.locator('#baixa-juros-abrir').count(), campo: await p.locator('#baixa-juros').count() };
  await p.click('#baixa-juros-abrir');
  out.reaberto = await p.inputValue('#baixa-juros');
  await p.keyboard.press('Escape');
  // 2. Boleto que venceu numa terça (13/10), pago em 20/10
  await abrir('impressora');
  await p.selectOption('#baixa-forma', 'boleto');
  await p.waitForTimeout(80);
  await p.fill('#baixa-data', '2026-10-20');
  await p.waitForTimeout(80);
  out.dia_util = (await txt('[role=dialog]')).match(/Juros e multa.{0,160}/)?.[0];
  await p.keyboard.press('Escape');
  // 3. PIX: sem juros
  await abrir('00145');
  out.pix = await p.locator('#baixa-juros-abrir').count();
  await p.keyboard.press('Escape');
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
