# Módulo Jurídico: protótipo para validação

**Data:** 2026-10-20
**Status:** protótipo navegável, para ajustar com o Tiago e com o jurídico antes de qualquer migration.
**Abrir:** `prototipo.html` no navegador (precisa de internet para a fonte e para o Preact, carregado do unpkg). Também publicado como artifact no claude.ai.

Nada aqui é código do ERP. É um protótipo à parte, com dados fictícios e as mesmas cores, fontes e componentes do sistema, para ver a tela antes de implementar. Todos os nomes de pessoas e empresas do protótipo são inventados, e os CNPJs seguem os padrões aceitos por `scripts/check-pii.sh`.

---

## 1. O pedido

O jurídico entra **depois** de Suprimentos (que gera a PP) e **depois** do financeiro (que abre o job). Ele não trava a abertura do job; trava só o **pagamento** da PP sem contrato assinado.

Dois gatilhos alimentam o módulo sozinhos:

| Gatilho | Contrato criado | Onde o contrato aparece depois |
|---|---|---|
| Financeiro abre o job (orçamento aprovado) | com o **cliente** | aba **Informações do Job** |
| Suprimentos gera a PP | com o **fornecedor** | aba **Pedidos de Produção (PPs)** do job |

O contrato nasce de uma **minuta pronta** (modelo), por tipo: prestação de serviço, locação, compra e venda e influenciador (este na 2ª etapa). O sistema preenche sozinho as partes, o CNPJ, o endereço, o valor, a condição de pagamento, o job e os responsáveis. Sobram as **lacunas**, das quais a principal é o objeto (escopo).

## 2. O que o protótipo tem

A barra escura no rodapé do protótipo troca a versão e simula os dois gatilhos (o financeiro abre um job, Suprimentos gera uma PP). A entrada nova aparece na fila e no sino.

### Versão A: como foi pedido

- **Sidebar:** item **Jurídico** ao lado de Jobs e Suprimentos, com o número de pendentes.
- **Caixa de entrada:** cada job aberto e cada PP gerada, com origem, contraparte, job, valor, condição de pagamento, status e o ícone verde que leva ao **item na planilha interna** (mesmo recurso do protótipo de Suprimentos). Tem filtro por cliente ou fornecedor e por status.
- **Elaborar contrato** (gaveta em 3 passos):
  1. Escolher o modelo, vendo antes os dados que o sistema já preenche.
  2. Preencher as lacunas, com a prévia do contrato ao lado. Na prévia, o que vem do sistema fica em azul, a lacuna preenchida em verde e a que falta em vermelho; clicar na vermelha leva ao campo.
  3. Revisar e gerar. O PDF é anexado ao job ou à PP e o status passa a "Aguardando assinatura".
- **Registrar assinatura:** anexar o PDF assinado. No fornecedor, o pagamento da PP é liberado na hora.
- **Contratos por job:** escolher o job e ver o contrato do cliente e o de cada PP, com filtro por fornecedor e por status, e a situação do pagamento de cada PP.
- **Modelos de contrato:** listar por tipo, criar, editar, duplicar e apagar. O editor mostra o texto da minuta com os campos do sistema (`{{parte.cnpj}}`) e as lacunas (`{{lacuna.objeto}}`), com prévia ao vivo.
- **Telas do job:** card "Contrato com o cliente" em Informações do Job; colunas **Contrato** e **Pagamento** na aba PPs; planilha interna com o item vindo do jurídico destacado.

O valor sai por extenso no contrato ("R$ 30.900,00 (trinta mil e novecentos reais)").

### Versão B: o que recomendo acrescentar

O botão "O que muda na B" do protótipo lista cada item com um atalho para a tela.

1. **Painel do que trava pagamento:** pendentes, em elaboração, aguardando assinatura e o **valor das PPs aprovadas que não podem ser pagas**. Clicar num número filtra a fila.
2. **Prazo no lugar de "chegou em":** a fila se ordena pelo vencimento da PP (ou pelo início do job, no cliente), com faixa vermelha até 5 dias e âmbar até 10.
3. **Quadro (kanban)** da mesma fila, por status.
4. **Um contrato para várias PPs** do mesmo fornecedor no mesmo job.
5. **Contrato-quadro:** fornecedor recorrente com contrato vigente; a PP é vinculada a ele, sem contrato novo.
6. **Dispensa com justificativa** (ex.: abaixo de R$ 5.000), registrada no histórico, que libera o pagamento.
7. **Aditivo automático:** PP reemitida com valor acima do contrato assinado gera um aditivo pendente e volta a travar o pagamento.
8. **Objeto sugerido pela PP** (serviço + especificações) e **"Pedir ao produtor"**, que manda a pergunta para a Comunicação do job.
9. **Cláusulas opcionais** por modelo (confidencialidade, cessão de imagem, multa, seguro, LGPD), com numeração automática.
10. **Histórico** de cada contrato: quem fez o quê e com qual versão do modelo.
11. **Pasta do job:** progresso, cliente no topo, fornecedores agrupados com PPs e aditivos, e o botão para baixar a pasta.
12. **Modelos com versão:** salvar cria a versão seguinte e o contrato guarda a versão que usou. Modelo já usado é **arquivado** em vez de apagado.
13. **Influenciador como rascunho** e **termo aditivo** como tipos de modelo.
14. **Nova solicitação:** para o que não nasce de job nem de PP, com os campos da reunião (qualificação, escopo, valor, condição e prazo).

## 3. Decisões que o protótipo assume e que precisam de confirmação

1. **Quando nasce o contrato com o cliente.** O pedido diz "quando o job é aberto pelo financeiro"; o resumo da reunião diz "quando o GP marcar o orçamento como aprovado". O protótipo segue o pedido (abertura pelo financeiro). Se for na aprovação, o contrato nasce antes do job, ligado ao orçamento e à versão aprovada.
2. **O que a trava bloqueia.** O protótipo deixa a PP andar no financeiro (avaliação e aprovação) e bloqueia só o **pagamento**. Contrato com o cliente não trava nada.
3. **Quem usa o módulo.** Não existe o papel `juridico` em `AppRole`. É preciso decidir se ele entra como papel novo ou como permissão (`lib/permissoes.ts`), e o que GP, produtor e financeiro veem do módulo.
4. **Assinatura.** No MVP, o assinado é anexado à mão. Assinatura eletrônica fica para depois.
5. **Um contrato por PP** na versão A. Se a B for aceita, o vínculo vira n:n (um contrato cobre várias PPs).
6. **Limite de dispensa, foro e dados da agência** (B): valores de configuração, a definir com o jurídico.
7. **Escopo dos modelos:** o jurídico precisa entregar as minutas reais. As do protótipo são ilustrativas.

## 4. Esboço de dados (para a implementação, não é migration)

A implementação segue `docs/FLUXO-BANCO.md`: ler o banco pelo MCP, escrever a migration, aplicar, conferir e commitar junto do código. A ideia de partida:

- `contrato_modelos` e `contrato_modelo_versoes`: tipo, parte (cliente ou fornecedor), corpo com os marcadores, lacunas (jsonb), cláusulas opcionais e ativo/arquivado.
- `contratos`: `tenant_id`, parte, origem (job, pp, aditivo, solicitação), `job_id`, `cliente_id` ou `fornecedor_id`, status, a versão de modelo usada, os valores das lacunas (jsonb), as cláusulas marcadas, o arquivo gerado, o assinado e a data de assinatura.
- `contrato_pps` (n:n), se a versão B entrar.
- Bucket privado `contratos` para os PDFs, com o mesmo padrão de pasta por tenant dos outros buckets.
- Auditoria em cada mudança de status, pelo mecanismo que o ERP já usa.
- A trava de pagamento validada no servidor, na ação que paga a PP, e não só na tela.
- Gatilhos: a abertura do job e a geração da PP criam o contrato pendente e a notificação.

## 5. Arquivos

```text
prototipo.html          o protótipo, pronto para abrir
fonte/src/*.js          o código (Preact + htm, sem JSX), em ordem numérica
fonte/input.css         base do Tailwind com as variáveis do globals.css
fonte/extra.css         o papel do contrato e o que o Tailwind não cobre
fonte/tailwind.config.js  a paleta do tailwind.config.ts do ERP
fonte/build.mjs         gera o prototipo.html
```

Para regerar depois de mexer em `fonte/`, da raiz do repositório e com o `npm install` feito:

```bash
node docs/design-briefs/2026-10-20-modulo-juridico/fonte/build.mjs
```
