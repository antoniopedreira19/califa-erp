const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1960, height: 1200 } });
  const erros = [];
  p.on('pageerror', e => erros.push(e.message));
  p.on('console', m => m.type() === 'error' && erros.push('console: ' + m.text().slice(0, 200)));
  await p.goto('file://' + process.cwd() + '/conciliacao-banco.html');
  await p.click('text=Esconder notas');
  const out = {};
  const txt = async (sel) => (await p.innerText(sel)).replace(/\s+/g, ' ');
  await p.click('.pg-seg >> text=Contas a Pagar · Cartão');
  await p.waitForTimeout(100);
  await p.screenshot({ path: 'test/24-capa.png' });
  await p.locator('button:has-text("Abrir")').first().click();
  await p.waitForTimeout(100);
  out.cabecalho = (await txt('main')).slice(0, 600);
  await p.screenshot({ path: 'test/24-fatura-alt.png', fullPage: true });
  // Atual
  await p.click('.pg-seg >> text=Atual');
  await p.waitForTimeout(100);
  await p.screenshot({ path: 'test/24-fatura-atual.png', fullPage: true });
  await p.click('.pg-seg >> text=Alternativa');
  // Baixar o previsto (PP-00167) no cartão
  await p.click('.pg-seg >> text=Contas a Pagar');
  await p.fill('input[placeholder^="Buscar"]', '00167');
  await p.waitForTimeout(100);
  await p.locator('tbody tr').first().locator('button:has-text("Baixar")').click();
  await p.waitForTimeout(150);
  await p.selectOption('#baixa-forma', 'cartao');
  await p.waitForTimeout(80);
  out.dialogo = (await txt('[role=dialog]')).slice(0, 900);
  await p.screenshot({ path: 'test/24-baixa-cartao.png' });
  await p.click('[role=dialog] button:has-text("Confirmar baixa")');
  await p.waitForTimeout(150);
  out.toast = (await txt('body')).match(/Confirmado no cartão[^.]*\.[^.]*\.[^.]*\./)?.[0];
  await p.fill('input[placeholder^="Buscar"]', '');
  await p.click('.pg-seg >> text=Contas a Pagar · Cartão');
  await p.locator('button:has-text("Corporativo California")').first().click();
  await p.waitForTimeout(100);
  out.linhaNova = await p.locator('tbody tr', { hasText: 'retorno da equipe' }).count();
  // Fechar a fatura com ajuste
  await p.click('button:has-text("Fechar fatura")');
  await p.waitForTimeout(100);
  const soma = await p.inputValue('#fechar-cobrado');
  out.soma = soma;
  const n = parseFloat(soma.replace(/\./g, '').replace(',', '.')) + 400;
  await p.fill('#fechar-cobrado', n.toFixed(2).replace('.', ','));
  await p.fill('#ajuste-descricao', 'IOF e anuidade');
  await p.fill('#ajuste-valor', '400,00');
  await p.screenshot({ path: 'test/24-fechar.png' });
  await p.click('[role=dialog] button:has-text("Fechar fatura")');
  await p.waitForTimeout(150);
  out.toastFechar = (await txt('body')).match(/Fatura FC-00011 fechada[^.]*\.[^.]*\./)?.[0];
  // Em Títulos a Pagar, filtrar faturas
  await p.click('.pg-seg >> text=Contas a Pagar');
  await p.click('button:has-text("Faturas de cartão")');
  await p.waitForTimeout(100);
  out.faturas = await p.$$eval('tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 120)));
  // abrir os itens da FC-00004
  await p.locator('tr', { hasText: 'FC-00004' }).locator("button[aria-expanded]", { hasText: " itens" }).click();
  await p.waitForTimeout(100);
  await p.screenshot({ path: 'test/24-fatura-titulo.png', fullPage: true });
  // Baixar a FC-00004
  await p.locator('tr', { hasText: 'FC-00004' }).locator('button:has-text("Baixar")').click();
  await p.waitForTimeout(150);
  out.dialogoFatura = (await txt('[role=dialog]')).slice(0, 700);
  await p.screenshot({ path: 'test/24-baixa-fatura.png' });
  await p.click('[role=dialog] button:has-text("Confirmar baixa")');
  await p.waitForTimeout(150);
  // Extrato
  await p.click('.pg-seg >> text=Conciliação · Extrato');
  await p.waitForTimeout(150);
  const linhasFatura = await p.locator('tbody tr', { hasText: 'Fatura' }).count();
  out.linhasFatura = linhasFatura;
  await p.locator('tr', { hasText: 'FC-00010' }).locator("button[aria-expanded]", { hasText: " itens" }).click();
  await p.waitForTimeout(100);
  await p.screenshot({ path: 'test/24-extrato.png', fullPage: true });
  console.log(JSON.stringify(out, null, 1));
  console.log('erros', erros);
  await b.close();
})();
