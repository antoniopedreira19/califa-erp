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
  await p.click('button:has-text("Só sugere")');
  await p.click('.pg-seg >> text=Conciliação · Conciliação automática');
  await p.click('button:has-text("Usar o extrato de exemplo")');
  await p.waitForTimeout(400);
  const corpo = await txt('main');
  out.secoes = corpo.match(/(A baixa feita à mão não bate com o banco|Baixas feitas à mão que bateram com o banco|Prontos: baixar e conciliar|Conferir antes|Uma linha do banco, vários títulos|Saiu e voltou|Pelas regras do histórico|Sem correspondência|Conciliados) \d+/g);
  const linha = p.locator('tr', { hasText: '15.000,00' }).first();
  out.antes = (await linha.innerText()).replace(/\s+/g, ' ');
  // As outras versões não quebram
  for (const v of ['Atual', 'Pedida', 'Recomendada']) {
    await p.click(`.pg-seg >> text=${v}`);
    await p.waitForTimeout(150);
  }
  console.log(JSON.stringify(out, null, 1), erros);
  await b.close();
})();
