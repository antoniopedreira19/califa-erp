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
  // Importar o exemplo
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")').catch(async () => { await p.click('text=exemplo'); });
  await p.waitForTimeout(300);
  const main = await txt('main');
  out.sozinho = main.match(/\d+ baixas? feitas? à mão bat\w+[^.]*\./)?.[0];
  out.secoes = await p.$$eval('section header span.text-sm', ss => ss.map(s => s.textContent));
  await p.screenshot({ path: 'test/29-banco.png', fullPage: true });
  // Extrato com os alertas
  await p.click('.pg-seg >> text=Conciliação · Extrato');
  await p.waitForTimeout(150);
  out.alerta = (await txt('main')).match(/\d+ lançamentos? não bat\w+[^.]*\./)?.[0];
  out.marcas = await p.locator('[aria-label="Não bate com o banco"]').count();
  await p.screenshot({ path: 'test/29-extrato.png', fullPage: true });
  // Corrigir a divergência e cancelar a baixa sem banco
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Corrigir a baixa")');
  await p.fill('#corrigir-motivo', 'O banco não cobrou os juros lançados na baixa');
  await p.click('[role=dialog] button:has-text("Corrigir e conciliar")');
  await p.waitForTimeout(100);
  await p.waitForTimeout(100);
  out.corrigido = (await txt('body')).match(/Baixa corrigida[^.]*\./)?.[0];
  await p.click('button:has-text("Cancelar a baixa")');
  await p.waitForTimeout(100);
  out.cancelado = (await txt('body')).match(/Baixa cancelada[^.]*\./)?.[0];
  await p.click('.pg-seg >> text=Conciliação · Extrato');
  out.marcasDepois = await p.locator('[aria-label="Não bate com o banco"]').count();
  // Simular o fechamento (trava)
  await p.click('button:has-text("Simular fechado até 19/10")');
  await p.waitForTimeout(150);
  out.banner = (await txt('main')).match(/Conciliação fechada até[^.]*\.[^.]*\./)?.[0];
  out.cadeados = await p.locator('[aria-label="Período fechado"]').count();
  await p.screenshot({ path: 'test/29-fechado.png', clip: { x: 160, y: 140, width: 1720, height: 700 } });
  // Desfazer uma conciliação no período fechado
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('section header button:has-text("Conciliados")');
  await p.waitForTimeout(100);
  await p.locator('button[aria-label="Desfazer"]').first().click();
  await p.waitForTimeout(100);
  out.desfazer = (await txt('body')).match(/Período fechado até[^.]*\./)?.[0];
  // Baixa com data dentro do período
  await p.click('.pg-seg >> text=Contas a Pagar');
  await p.locator('tbody tr').first().locator('button:has-text("Baixar")').click();
  await p.fill('#baixa-data', '2026-10-19');
  await p.waitForTimeout(100);
  out.notaBaixa = (await txt('[role=dialog]')).match(/A conciliação da California Santander está fechada[^.]*\.[^.]*\./)?.[0];
  await p.click('[role=dialog] button:has-text("Confirmar baixa")');
  out.erroBaixa = (await txt('[role=dialog]')).match(/Período fechado até[^.]*\./)?.[0];
  await p.screenshot({ path: 'test/29-baixa-travada.png' });
  await p.keyboard.press('Escape');
  // Reabrir
  await p.click('.pg-seg >> text=Conciliação · Extrato');
  await p.click('button:has-text("Reabrir o período")');
  await p.waitForTimeout(100);
  await p.click('[role=dialog] button:has-text("Reabrir o período")');
  out.erroMotivo = (await txt('[role=dialog]')).match(/Explique o motivo[^.]*\./)?.[0];
  await p.fill('#reabrir-motivo', 'A baixa do frete de 19/10 foi feita na conta errada');
  await p.screenshot({ path: 'test/29-reabrir.png' });
  await p.click('[role=dialog] button:has-text("Reabrir o período")');
  await p.waitForTimeout(150);
  out.reaberto = (await txt('main')).match(/Período reaberto[^.]*\.[^.]*\./)?.[0];
  out.historico = (await txt('main')).match(/Histórico: [^A-Z]*/)?.[0];
  await p.screenshot({ path: 'test/29-reaberto.png', clip: { x: 160, y: 140, width: 1720, height: 500 } });
  // Só registra
  await p.click('button:has-text("Fechar de novo")');
  await p.click('.pg-seg >> text=Só registra');
  await p.waitForTimeout(100);
  out.registra = (await txt('main')).match(/Conciliada até[^.]*\.[^.]*\./)?.[0];
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
