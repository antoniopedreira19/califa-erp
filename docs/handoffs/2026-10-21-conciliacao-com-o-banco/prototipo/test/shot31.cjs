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
  // 1. PP com retenção da aprovação (PP-00144)
  await p.click('.pg-seg >> text=Contas a Pagar');
  await p.fill('input[placeholder^="Buscar"]', '00144');
  await p.waitForTimeout(100);
  await p.locator('tbody tr').first().locator('button:has-text("Baixar")').click();
  await p.waitForTimeout(150);
  out.pp = (await txt('[role=dialog]')).match(/Valor a dar baixa.{0,700}/)?.[0]?.slice(0, 700);
  await p.screenshot({ path: 'test/31-pp.png' });
  await p.keyboard.press('Escape');
  // 2. NF a receber: ligar a retenção e repetir as alíquotas
  await p.click('.pg-seg >> text=Contas a Receber');
  await p.locator('tr', { hasText: 'NF 1188' }).locator('button:has-text("Baixar")').click();
  await p.waitForTimeout(150);
  await p.click('#baixa-retem');
  await p.click('button:has-text("Repetir as alíquotas")');
  await p.waitForTimeout(100);
  out.nf = (await txt('[role=dialog]')).match(/\(−\) Impostos retidos.{0,140}/)?.[0];
  out.fiscal = (await txt('[role=dialog]')).match(/No fiscal.{0,300}/)?.[0];
  await p.screenshot({ path: 'test/31-nf.png' });
  await p.keyboard.press('Escape');
  // 3. A conciliação reconhece a retenção (NF 1190)
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")');
  await p.waitForTimeout(400);
  const linha = p.locator('tr', { hasText: '18.770,00' });
  out.linha = (await linha.innerText()).replace(/\s+/g, ' ').slice(0, 260);
  await linha.locator('button:has-text("Conferir")').click();
  await p.waitForTimeout(150);
  out.dialogo = (await txt('[role=dialog]')).match(/O cliente reteve.{0,520}/)?.[0];
  await p.screenshot({ path: 'test/31-banco.png' });
  await p.click('[role=dialog] button:has-text("Confirmar baixa")');
  await p.waitForTimeout(150);
  out.toast = (await txt('body')).match(/Conciliado: [^.]*\./)?.[0];
  await p.click('.pg-seg >> text=Contas a Receber');
  await p.click('button:has-text("Recebidos")');
  out.recebida = (await p.locator('tr', { hasText: 'NF 1190' }).count());
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
