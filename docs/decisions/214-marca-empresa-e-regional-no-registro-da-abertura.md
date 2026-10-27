# 214 — Marca, empresa e regional no registro da abertura

**Data:** 2026-10-26
**Status:** aceita e implementada em 26/10/2026.
**Quem decidiu:** Tiago — pedido em 16/10, respostas em 23/10 e 26/10,
protótipo aprovado em 26/10
(https://claude.ai/artifact/UxASwkRtQgA4GzFEinYTtQ, tela "Abertura do job ·
financeiro").
**Migrations:** `20261026800002_marca_empresa_e_regional_do_job.sql` e
`20261026800003_foto_da_abertura_com_marca_empresa_regional.sql`.

## O problema

O financeiro conferia categoria e serviço do job, mas não a marca, a
empresa e a regional — e há jobs com a empresa trocada entre CCH e
California na produção. A marca do job era só texto, e os relatórios liam a
do projeto.

## A regra

1. **O registro no financeiro ganha duas linhas** depois de Categoria e
   Serviço: **Empresa | Regional** e **Cliente | Marca**.
2. **Cliente é travado** ("Vem do orçamento X. Não muda no financeiro.").
3. **Marca, empresa e regional chegam com as do job** e o financeiro pode
   trocar, na abertura e no "Editar registro". **A troca vale para o job
   inteiro** — produção, ficha do job e relatórios (resposta do Tiago,
   23/10).
4. **A regional é sempre da empresa escolhida.** Trocar a empresa limpa a
   regional; se a empresa tem uma regional só, ela já fica escolhida.
   Regional só de folha não aparece.
5. **A marca é uma das marcas do cliente**, ou uma nova pelo "+" (o mesmo
   pop-up do formulário do projeto, com a frase "Ela já fica escolhida
   neste job."). O financeiro já podia cadastrar marca: ele tem
   `cadastros.clientes.editar`, que libera a ação.
6. **A empresa do job pode ficar diferente da do projeto** (resposta do
   Tiago, 26/10: "Só o job"). O job nasce com a empresa do projeto; depois,
   só administrador ou financeiro a troca. Trocar a empresa do projeto leva
   junto só os jobs que **ainda não abriram**; job aberto mantém a dele. Os
   orçamentos seguem a empresa do projeto, como antes.
7. **A marca do job vira coluna** (`jobs.produto_id`), gravada no envio
   (a do projeto) e no registro. `jobs.produto` continua com o nome. Os
   relatórios de Rentabilidade e de Faturamento (`vw_job_rentabilidade`)
   leem a marca do job, com a do projeto como reserva.
8. **A conferência, o resumo lateral e a foto do registro** ("Visualizar"
   do histórico) mostram marca, empresa e regional. Foto anterior a
   26/10/2026 mostra "—".

## Banco

- `jobs.produto_id` (FK `cliente_produtos`), preenchido com a marca do
  projeto em todos os 159 jobs; conferido que a `vw_job_rentabilidade`
  devolve exatamente o mesmo resultado (hash dos 104 jobs antes e depois).
- Gatilho `trg_jobs_empresa_do_projeto` passa a chamar `empresa_do_job()`
  (no lugar de `enforce_empresa_from_projeto`, que continua nos
  orçamentos). `cascade_empresa_para_filhos` só atualiza jobs em
  `aguardando_abertura` e `rejeitado_financeiro`.
- `jobs_aberturas` ganha `empresa_id`, `regional_id` e `produto_id`.
- O servidor confere: marca do cliente do job e ativa (ou a que o job já
  tem), empresa ativa, regional da empresa, ativa e de projeto. Os
  gatilhos `ck_empresa_bate_regional` e `ck_regional_disponivel_em_projetos`
  recusam o mesmo no banco.
