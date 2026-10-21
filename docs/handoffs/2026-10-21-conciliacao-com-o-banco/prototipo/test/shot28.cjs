const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1960, height: 1300 } });
  const erros = [];
  p.on('pageerror', e => erros.push(e.message));
  await p.goto('file://' + process.cwd() + '/conciliacao-banco.html');
  await p.click('text=Esconder notas');
  const txt = async (sel) => (await p.innerText(sel)).replace(/\s+/g, ' ');
  const out = {};
  await p.click('.pg-seg >> text=Contas a Pagar');
  // Atual: o aprovado no cartão fica fora do lote
  await p.click('.pg-seg >> text=Atual');
  await p.fill('input[placeholder^="Buscar"]', '00167');
  await p.waitForTimeout(100);
  out.atualCaixa = await p.locator('tbody tr').first().locator('[role=checkbox][title^="Previsto no cartão"]').count();
  // Alternativa: lote de 3 PPs no cartão
  await p.click('.pg-seg >> text=Alternativa');
  await p.fill('input[placeholder^="Buscar"]', 'Rota Transportes');
  await p.waitForTimeout(100);
  const caixas = p.locator('tbody tr td:first-child [role=checkbox]');
  out.n = await caixas.count();
  for (let i = 0; i < Math.min(2, out.n); i++) await caixas.nth(i).click();
  await p.fill('input[placeholder^="Buscar"]', '00167');
  await p.waitForTimeout(100);
  await p.locator('tbody tr td:first-child [role=checkbox]').first().click();
  await p.fill('input[placeholder^="Buscar"]', '');
  await p.click('button:has-text("Dar baixa em")');
  await p.waitForTimeout(150);
  out.formas = await p.$$eval('#baixa-forma option', os => os.map(o => o.textContent));
  await p.selectOption('#baixa-forma', 'cartao');
  await p.waitForTimeout(100);
  out.desc = (await txt('[role=dialog]')).slice(0, 330);
  await p.screenshot({ path: 'test/28-lote-cartao.png' });
  await p.click('[role=dialog] button:has-text("Confirmar")');
  await p.waitForTimeout(150);
  out.toast = (await txt('body')).match(/Confirmado no cartão[^.]*\.[^.]*\./)?.[0];
  // Lote da folha: sem cartão, com a dica
  await p.getByRole('button', { name: /^Folhas\s+\d+$/ }).click();
  await p.waitForTimeout(100);
  await p.locator('tbody tr td:first-child [role=checkbox]').first().click();
  await p.locator('tbody tr td:first-child [role=checkbox]').nth(1).click();
  await p.click('button:has-text("Dar baixa em")');
  await p.waitForTimeout(150);
  out.folhaFormas = await p.$$eval('#baixa-forma option', os => os.map(o => o.textContent));
  out.folhaDica = (await txt('[role=dialog]')).match(/Folha não se paga[^.]*\./)?.[0];
  await p.keyboard.press('Escape');
  // A célula da ação na aba Títulos
  await p.click('.pg-seg >> text=Conciliação · Títulos');
  await p.waitForTimeout(150);
  const cel = p.locator('tbody tr').nth(1).locator('td').last();
  await cel.screenshot({ path: 'test/28-acao.png' });
  out.acao = await cel.evaluate((td) => { const r = td.getBoundingClientRect(); const bs = [...td.querySelectorAll('button')].map(b => b.getBoundingClientRect()); return { td: [Math.round(r.left), Math.round(r.width)], botoes: bs.map(x => [Math.round(x.left - r.left), Math.round(x.width)]) }; });
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
