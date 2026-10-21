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
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")');
  await p.waitForTimeout(400);
  // 1. A baixa à mão: sem verde, "Conciliado" na Ação
  const manual = p.locator('tr', { hasText: '15.000,00' }).first();
  out.manual = (await manual.innerText()).replace(/\s+/g, ' ');
  out.manualClasse = await manual.getAttribute('class');
  out.manualDesfazer = await manual.locator('button[aria-label="Desfazer"]').count();
  // 2. Grupo de R$ 3.000,00
  const cab3 = p.locator('tr', { hasText: '3 linhas de R$ 3.000,00 no banco' });
  out.cab3 = (await cab3.innerText()).replace(/\s+/g, ' ');
  const linhas3 = p.locator('tr:has(select[aria-label="Trocar o título desta linha"])', { hasText: '3.000,00' });
  out.linhas3 = (await linhas3.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').slice(0, 170));
  const sel = linhas3.first().locator('select');
  const opcoes = await sel.locator('option').allInnerTexts();
  out.opcoes = opcoes;
  await sel.selectOption({ label: opcoes.find((o) => o.includes('PP-00157')) });
  await p.waitForTimeout(80);
  out.cab3depois = (await cab3.innerText()).replace(/\s+/g, ' ').match(/Fica em aberto: [^.]*\./)?.[0];
  out.primeira = (await linhas3.first().innerText()).replace(/\s+/g, ' ').slice(0, 170);
  const secao = p.locator('section', { hasText: 'Conferir antes' }).first();
  await secao.screenshot({ path: 'test/41-conferir.png' });
  await cab3.locator('button:has-text("Baixar e conciliar as 3")').click();
  await p.waitForTimeout(150);
  out.toast3 = (await txt('body')).match(/3 títulos baixados e conciliados[^,]*,00\./)?.[0];
  // 3. Linhas iguais em número igual ao de títulos: baixadas sozinhas
  out.iguaisSozinhas = (await p.locator('tr', { hasText: /R\$ (1\.000|2\.000|5\.000),00/ }).filter({ hasText: 'Conciliado sozinho' }).count());
  out.resumo = (await txt('body')).match(/títulos baixados e conciliados \([^)]*\)/)?.[0];
  // 4. Lupa: proximidade e retenção (NF 1190)
  const l18770 = p.locator('tr', { hasText: '18.770,00' }).first();
  await l18770.locator('button[aria-label="Escolher outro título"]').click();
  await p.waitForTimeout(150);
  out.lupa = (await p.locator('div.max-h-\\[46vh\\] > button').allInnerTexts()).slice(0, 5).map((s) => s.replace(/\s+/g, ' '));
  await p.screenshot({ path: 'test/41-lupa.png' });
  await p.locator('div.max-h-\\[46vh\\] > button', { hasText: 'NF 1190' }).click();
  out.rodape = (await txt('body')).match(/NF 1190: [^.]*\./)?.[0];
  await p.click('button:has-text("Abrir a baixa")');
  await p.waitForTimeout(150);
  out.dialogo = (await txt('[role=dialog]')).match(/Valor a dar baixa.{0,120}/)?.[0];
  out.retencao = (await txt('[role=dialog]')).match(/\(=\) Valor líquido recebido R\$ [\d.,]+/)?.[0];
  out.parcial = (await txt('[role=dialog]')).includes('abre parcial');
  await p.click('[role=dialog] button:has-text("Confirmar baixa")');
  await p.waitForTimeout(150);
  out.toast = (await txt('body')).match(/Conciliado: [^.]*\./)?.[0];
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
