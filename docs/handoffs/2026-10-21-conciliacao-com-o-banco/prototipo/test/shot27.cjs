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
  // Fatura sem a faixa
  await p.click('.pg-seg >> text=Contas a Pagar · Cartão');
  await p.locator('button:has-text("Corporativo California")').first().click();
  out.faixa = await p.locator('text=Ainda não estão na fatura').count();
  // Títulos a Pagar: baixar a PP-00167 no cartão escolhendo a fatura
  await p.click('.pg-seg >> text=Contas a Pagar');
  await p.fill('input[placeholder^="Buscar"]', '00167');
  await p.waitForTimeout(100);
  out.linha = (await p.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ').slice(0, 90);
  await p.locator('tbody tr').first().locator('button:has-text("Baixar")').click();
  await p.waitForTimeout(150);
  await p.selectOption('#baixa-forma', 'cartao');
  await p.waitForTimeout(80);
  out.forma = await p.inputValue('#baixa-forma');
  out.opcoes = await p.$$eval('#baixa-fatura option', os => os.map(o => o.textContent));
  await p.selectOption('#baixa-fatura', { index: 1 });
  await p.waitForTimeout(100);
  out.notas = (await txt('[role=dialog]')).match(/Entra na fatura[^.]*\.[^.]*\.[^.]*\.|Pela data do pagamento[^:]*:[^.]*\./g);
  await p.screenshot({ path: 'test/27-baixa.png' });
  await p.click('[role=dialog] button:has-text("Confirmar baixa")');
  await p.waitForTimeout(150);
  out.toast = (await txt('body')).match(/Confirmado no cartão[^.]*\.[^.]*\./)?.[0];
  // Na aba Cartão, a fatura nova de nov/26
  await p.click('.pg-seg >> text=Contas a Pagar · Cartão');
  out.capa = (await txt('main')).match(/Corporativo California[^A]*Abrir/)?.[0];
  await p.locator('button:has-text("Corporativo California")').first().click();
  await p.click('button[aria-label="Próxima competência"]');
  await p.waitForTimeout(100);
  out.nov = (await txt('main')).match(/novembro 2026.{0,80}/)?.[0];
  out.linhasNov = await p.locator('tbody tr').count();
  // Atual: sem o campo Fatura
  await p.click('.pg-seg >> text=Contas a Pagar');
  await p.click('.pg-seg >> text=Atual');
  await p.fill('input[placeholder^="Buscar"]', 'plataforma de design');
  await p.waitForTimeout(100);
  await p.locator('tbody tr').first().locator('button:has-text("Dar baixa"), button:has-text("Baixar")').first().click();
  await p.waitForTimeout(150);
  out.atualFatura = await p.locator('#baixa-fatura').count();
  out.atualNota = (await txt('[role=dialog]')).match(/Entra na fatura[^.]*\./)?.[0];
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
