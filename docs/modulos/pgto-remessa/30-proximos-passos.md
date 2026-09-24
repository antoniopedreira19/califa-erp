# 30 — Próximos passos (backlog vivo)

Atualizado a cada fechamento de rodada. Prioridade decrescente dentro de cada bloco.

## 🔴 P0 — Bloqueia o primeiro `.REM` real de produção

### Backfill dos dados bancários (trabalho do usuário)

- [ ] **Fornecedores restantes** — 13 dos 24 fornecedores ainda não têm banco cadastrado; 7 dos 24 não têm PIX. Passar em cada um pela tela `/fornecedores` e completar. Sem isso, esses fornecedores ficam com selo "Sem dados" no modal de exportar remessa (não podem ser selecionados).
- [ ] **Colaboradores em produção** (quando existirem além do "Teste"). Os campos bancários agora vivem em `colaboradores.banco_*` e `pix_*` — cadastro pela tela `/rh/colaboradores/[id]`, card "Dados bancários".

### Homologação Santander (trabalho do gerente)

- [ ] **Confirmar homologação de PIX na conta California Santander.** O arquivo `PE000013.TXT` original era TED — PIX pode precisar de homologação adicional com o gerente do banco. Se não homologado, o Santander rejeita o lote de PIX no arquivo.
- [ ] **Confirmar endereço fiscal da California Filmes na Receita.** Endereço preenchido veio do arquivo antigo (Salvador/BA). Se a matriz atual do CNPJ 19437976000154 mudou de sede, precisa atualizar em `/admin/empresas` → aba Contábeis → editar → endereço.

### Primeiro teste real E2E

> ⚠️ **23/09/2026:** gerado o `PE000016.TXT` pelo fluxo real: folha 09/2026 do Antonio (teste), R$ 0,05, chave CPF, sequencial 16 (produção). O segmento B do PIX já segue as três críticas do Santander (decisão 101). As remessas de teste 13–15 de 21/09, que tinham ficado sem os títulos, foram apagadas em 23/09 com autorização do Tiago; o próximo sequencial é 17. Falta transmitir no internet banking e avisar a Karen (proposta 4557231). Depois, testar as outras chaves (e-mail, telefone, aleatória) e uma TED.

> ⚠️ **24/09/2026:** o PE000016 ficou sem efeito (o colaborador de teste foi apagado na importação do RH, e a remessa 16 com ele). Gerados pelo fluxo real, para o fornecedor de teste "Antonio" (AV-00003 e AV-00004, R$ 0,05 cada): `PE000017.TXT` (PIX, 24/09) e `PE000018.TXT` (TED, 25/09). Próximo sequencial: 19. Falta a validação e a transmissão pelo chamado novo do Santander. Detalhes na decisão 101 §6. **Nunca gere folha para teste:** ela cria linhas para todos os colaboradores.

- [ ] **Gerar o primeiro `.REM`** pelo botão da tela, com a folha do "Teste" (R$ 1). Terreno já está pronto no banco: 2 `contas_avulsas` aprovadas materializadas em 21/09/2026.
- [ ] **Importar no site do Santander** e confirmar aceitação. Se rejeitar, o `.RET` traz o código de ocorrência (seção 5 do manual, pág. 61) — mapear qual campo desalinhou.
- [ ] **Se PIX for aceito**: R$ 1,00 desce na chave PIX (CPF 86098531528) → E2E validado.
- [ ] **Se PIX for rejeitado**: remover `pix_chave` do colaborador de teste temporariamente e regerar → o gerador cai automaticamente pra TED (banco Nubank 260, câmara CIP 018).

## 🟡 P1 — Fase 6: Persistência do arquivo

Hoje o arquivo `.REM` só existe no download do browser. `cnab_remessas.path_storage` fica `null`. Se o usuário perder o arquivo, tem que gerar de novo — gasta próximo sequencial.

- [ ] **Bucket `cnab-remessas` no Supabase Storage.** Config no dashboard/CLI — não é migration.
- [ ] **Upload no `gerarRemessaCnab`.** Depois do INSERT bem-sucedido, faz upload do conteúdo pro Storage com path `{tenant_id}/{empresa_contabil_id}/{sequencial}.REM`. Atualiza `cnab_remessas.path_storage`.
- [ ] **Tela de histórico de remessas.** Nova rota `/financeiro/cnab-remessas` ou aba nova em Contas a Pagar. Lista `cnab_remessas` com colunas: sequencial, data, conta, qtd, valor total, status. Botão "Baixar" pra cada linha (signed URL do Storage). Botão "Ver itens" abre modal com os `cnab_remessas_itens`.
- [ ] **Regra de retenção do bucket.** Arquivos ficam retidos por quanto tempo? Contrato dos clientes vs LGPD.

## 🟡 P1 — Boleto (Segmento J + J52)

A biblioteca hoje só gera A + B (CC/TED/PIX). Boleto precisa J + J52.

- [ ] **Ampliar biblioteca:** `montarSegmentoJ`, `montarSegmentoJ52` em `lib/cnab/santander/gerador.ts`.
- [ ] **Campo `codigo_barras` na UI** de cadastro de PP + de conta avulsa. As colunas já existem no banco (`pedidos_compra_parcelas.codigo_barras` e `contas_avulsas.codigo_barras`, com CHECK de 44 dígitos).
- [ ] **Conversão linha digitável → código de barras.** Linha digitável tem 47 dígitos com 3 DVs de campo; código de barras tem 44 puros. Helper na UI que aceita os dois formatos e sanitiza.
- [ ] **Testes**: fixture de boleto real aceito, byte a byte.
- [ ] **Server action:** resolver forma como `boleto` quando `codigo_barras` preenchido no título origem (hoje já tem essa lógica esboçada, precisa terminar).

## 🟠 P2 — Fase 2 do módulo: Parse do `.RET`

- [ ] **Upload do arquivo `.RET`** que o Santander devolve. Nova UI: tela de detalhe de uma remessa com botão "Enviar arquivo retorno".
- [ ] **Parser do arquivo retorno.** Reusa `lib/cnab/santander/` — as posições do layout são as mesmas, só que o campo "Ocorrências para o Retorno" (231-240) vem preenchido.
- [ ] **Aplicar retorno:** pra cada linha do `.RET` com ocorrência `00` (Crédito Efetivado), disparar a baixa automática do título origem via `darBaixaTitulo` existente. Ocorrências de erro (`01`, `AT`, `HF`, etc) preenchem `cnab_remessas_itens.ocorrencia_retorno` e ficam pendentes com aviso na tela.
- [ ] **Códigos de ocorrência** documentados na seção 5 do manual (pág. 61). Mapear os 20 mais comuns.

## 🟠 P2 — Multi-empresa contábil (Go Crazy + Hitlab)

- [ ] **Homologar convênio no Go Crazy** (`Santander GoCrazy`, id `contas_bancarias`) e no Hitlab (`Santander Hitlab`).
- [ ] **Backfill de config** nas duas contas (convênio, agência, DVs, sequencial começando em 11).
- [ ] **Testar** que o dropdown do modal mostra as 3 opções (California, Go Crazy, Hitlab).

## 🟢 P3 — Fase 2 do módulo: outros bancos

- [ ] **BB, Bradesco, Itaú.** Layout CNAB 240 é padrão FEBRABAN, mas cada banco tem particularidades (posições, códigos de finalidade, autenticação). Cada banco vira uma pasta nova em `lib/cnab/` com sua própria biblioteca.
- [ ] **Só implementar se demanda real aparecer.** Continua Santander-only enquanto for suficiente.

## 🟢 P3 — Refinamentos de UX/gestão

- [ ] **Cliente como destinatário.** 156 clientes sem shape bancário. Se aparecer caso concreto de reembolso frequente, migration aditiva copiando o mesmo shape que fornecedor/colaborador têm.
- [ ] **PIX QR Code Dinâmico** (Segmento J + J52-PIX). Necessário pra pagar FGTS Digital.
- [ ] **Tributos com código de barras** (Segmento O). DARF, guias municipais, GARE, etc.
- [ ] **Filtro no modal de exportar remessa:** "só folhas", "só fornecedores", "por empresa". Cabeçalho da tabela do modal poderia ganhar isso pra remessas com 30+ linhas.
- [ ] **Barra de resumo por forma.** Ao selecionar N títulos no modal, mostrar breakdown: "3 PIX (R$ X) · 2 TED (R$ Y) · 1 boleto (R$ Z)". Facilita conferir antes de gerar.
- [ ] **Cancelar remessa gerada.** Botão que muda `status='cancelado'` — útil se o financeiro percebe erro depois de baixar o arquivo mas antes de enviar ao banco. Não desfaz o sequencial (número gasto pra sempre).
- [ ] **Nome de arquivo customizável.** Hoje `PE000013.REM`. Poderia aceitar padrão configurado (ex: `CALIFORNIA_20260921_013.REM`).

## Rodadas fechadas

### Rodada 1 — Descoberta + Modelagem + Geração (21/09/2026)

Fase 1 a 5 fechadas em uma sessão. 9 migrations aplicadas, biblioteca com 12 testes verdes, server action, UI. Um backfill parcial (California Santander + colaborador de teste) e um E2E preparado até o clique final.

Referência: 22 commits no repo, começando de `781f848` (`refactor(rh): colaborador nao reaproveita banco via fornecedor`).
