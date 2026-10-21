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
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")');
  await p.waitForTimeout(400);
  out.sozinho = (await txt('main')).match(/\d+ linhas do banco se resolveram[^.]*\.[^.]*\./)?.[0];
  out.secoes = await p.$$eval('section header span.text-sm', ss => ss.map(s => s.textContent + ' ' + (s.nextElementSibling?.textContent ?? '')));
  out.fechar = await p.locator('button:has-text("Fechar a conciliação")').innerText();
  out.fecharDesligado = await p.locator('button:has-text("Fechar a conciliação")').isDisabled();
  await p.screenshot({ path: 'test/30-auto.png', clip: { x: 160, y: 380, width: 1720, height: 900 } });
  // Resolver o que sobra para ver o fechamento liberar
  await p.click('button:has-text("Corrigir a baixa")');
  await p.fill('#corrigir-motivo', 'O banco não cobrou os juros lançados na baixa');
  await p.click('[role=dialog] button:has-text("Corrigir e conciliar")');
  await p.waitForTimeout(100);
  await p.click('button:has-text("Cancelar a baixa")');
  await p.waitForTimeout(100);
  const aceitar = p.locator('button:has-text("sugestões como estão")');
  if (await aceitar.count()) await aceitar.click();
  await p.waitForTimeout(150);
  out.restantes = await p.$$eval('section header span.text-sm', ss => ss.map(s => s.textContent + ' ' + (s.nextElementSibling?.textContent ?? '')));
  // Hoje, gerado às 11:40
  await p.click('button:has-text("Importar o extrato de hoje")');
  await p.waitForTimeout(300);
  out.andamento = (await txt('main')).match(/20\/10\/2026 ainda está em andamento[^.]*\./)?.[0];
  out.fecharHoje = await p.locator('button:has-text("Fechar a conciliação")').innerText();
  await p.screenshot({ path: 'test/30-hoje.png', clip: { x: 160, y: 380, width: 1720, height: 900 } });
  // Só sugere: recomeça e importa de novo
  await p.click('button:has-text("Recomeçar")');
  await p.click('.pg-seg >> text=Só sugere');
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")');
  await p.waitForTimeout(400);
  out.sugereSecoes = await p.$$eval('section header span.text-sm', ss => ss.map(s => s.textContent + ' ' + (s.nextElementSibling?.textContent ?? '')));
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
