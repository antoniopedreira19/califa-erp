const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1960, height: 1500 } });
  const erros = [];
  p.on('pageerror', e => erros.push(e.message));
  await p.goto('file://' + process.cwd() + '/conciliacao-banco.html');
  await p.click('text=Esconder notas');
  const out = {};
  await p.click('.pg-seg >> text=Contas a Pagar');
  const forma = async (busca) => {
    await p.fill('input[placeholder^="Buscar"]', busca);
    await p.waitForTimeout(100);
    await p.locator('tbody tr').first().locator('button:has-text("Baixar")').click();
    await p.waitForTimeout(150);
    const f = await p.inputValue('#baixa-forma');
    const juros = await p.locator('#baixa-juros-abrir').count();
    let jurosBoleto = null;
    if (busca === 'Limpeza') { await p.selectOption('#baixa-forma', 'boleto'); await p.waitForTimeout(60); jurosBoleto = await p.locator('#baixa-juros-abrir').count(); }
    await p.keyboard.press('Escape');
    return { f, juros, jurosBoleto };
  };
  out.boleto = await forma('Limpeza');
  out.cartaoPrevisto = await forma('00167');
  out.pp = await forma('00145');
  // Pela linha do banco: a forma vem do histórico
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")');
  await p.waitForTimeout(400);
  const linhas = p.locator('tr:has(button:has-text("Conferir"))');
  out.banco = [];
  for (let i = 0; i < Math.min(await linhas.count(), 6); i++) {
    const l = linhas.nth(i);
    const h = (await l.innerText()).replace(/\s+/g, ' ').slice(0, 60);
    await l.locator('button:has-text("Conferir")').click();
    await p.waitForTimeout(120);
    const n = await p.locator('#baixa-forma').count();
    out.banco.push([h, n ? await p.inputValue('#baixa-forma') : '—']);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(60);
  }
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
