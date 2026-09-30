# RH: quadro real e fluxo de contratação prontos (2026-09-30)

> O módulo de RH saiu do estado "esqueleto com dados de teste" e virou um cadastro operacional real. 209 colaboradores ativos com salário vigente, alocação vigente, líder direto (onde faz sentido) e — pela primeira vez — dados bancários vindos da planilha real da RH. O fluxo de nova contratação está usável de ponta a ponta, e a lista de colaboradores mostra com precisão quem tem pendência e qual é.

## O que muda pro negócio

- RH passa a operar dentro do sistema com o quadro real da California, não com mock. Folha, alocação, salário e banco batem com a planilha oficial.
- Efetivar colaborador de fintech (Nubank etc.) deixou de falhar por constraint.
- Escolher líder direto virou busca por nome, não uma lista rolável impossível.
- Quem abrir a lista de colaboradores enxerga só o que interessa: salários ocultos por padrão, filtros compactos como em `/jobs`, tooltip mostrando exatamente qual pendência cada linha tem.

## Estado atual (o que existe agora)

- **Base de colaboradores**: 209 ativos, batendo com a planilha atualizada do RH. Cada ativo tem exatamente 1 salário vigente e 1 alocação vigente.
- **Dados bancários**: 117/209 completos (145 casaram por CPF/CNPJ + 21 por nome, com aprovação manual). 40 ficaram sem nada — RH precisa completar manualmente. Constraint aceita 3 padrões: banco tradicional (agência+conta), fintech (banco+tipo de conta, sem agência/conta) e totalmente vazio.
- **Líder direto**: 46/209 preenchidos. Só entra líder que é membro ativo do tenant (tem acesso ao ERP). Combobox com busca por nome funciona em 3 telas: `/rh/colaboradores/novo`, `/rh/contratacoes/nova` e drawer de editar dados no detalhe.
- **Contratação nova**: fluxo completo — GP cria proposta → candidato aceita e preenche → RH efetiva. Upload direto no Storage (contrato PJ gera em ~2s, anexo em segundos). Combobox de líder na criação da proposta.
- **Pendências**: banner + tooltip mostram exatamente o que falta em cada colaborador (críticas em vermelho, parciais em amarelo). Filtro de 3 posições — Todos / Com pendências / Sem pendências.
- **UX da lista**: filtros em 2 linhas (busca + status + regional + tipo + pendências em cima; ações "Novo colaborador" e "Níveis" à direita). Salários ocultos por padrão (só aparecem se você clicar no olho).

## Decisões que vão importar amanhã

- **Histórico de salário foi apagado pra ativos**. Só o vigente sobreviveu (passo 5 da reconciliação). Se alguém pedir histórico de aumento pré-2026-09-30, não existe. Foi decisão consciente pra sincronizar 100% com a planilha; a Isadora perdeu o histórico real de aumento junto.
- **Bug da folha 09/2026 gera alocações duplicadas**. Consolidamos os 4 casos existentes (2 DELETEs + UPDATE, por causa da constraint `uniq_colaborador_alocacao_vigente`), mas a próxima folha vai duplicar de novo se a origem não for corrigida antes de rodar 10/2026. Ver commit `0cf3072`.
- **PostgREST não segue FK transitiva**. `tenant_members.user_id` e `profiles.id` apontam ambos pra `auth.users` — embed `profile:profiles(...)` retorna vazio silenciosamente. Padrão daqui pra frente: buscar `user_id` primeiro, depois `profiles WHERE id IN (...)`. Aplicado em 3 pages (contratações/nova, colaboradores/novo, colaboradores/[id]).
- **Regional em `colaboradores_alocacoes` tem 2 FKs pra `regionais`** (simples e composta com empresa_id). Embed sem `!nome_da_fk` volta null e disparava pendência falsa de "Alocação vigente". Sempre desambiguar: `regional:regionais!colaboradores_alocacoes_regional_id_fkey(id, nome)`.
- **Só 46/209 têm líder direto** porque a maioria dos gestores ainda não é usuária do ERP. Não é bug — é limite operacional. Vai preencher naturalmente conforme mais gestores forem convidados.
- **PIX vindo de xlsx é sujo**. "[object Object]" de fórmula quebrada, texto misturado ("Pix:44574429844"), instrução no lugar do dado ("LANÇAR COMO CONTA E AGENCIA"). Toda importação futura precisa sanitizar antes de gerar SQL.

## O que fica pra próxima sessão

**Objetivo**: Gestão de Férias.

**Por onde começar**: essa é uma boa hora pra inaugurar a **spec viva do módulo RH em `docs/modulos/rh.md`** (padrão SDD — Spec-Driven Development). Antes de modelar tabela de férias, escrever:

1. Regras que a lei brasileira exige (aquisitivo, concessivo, abono, 1/3, 13º integrado, fracionamento em até 3 períodos).
2. O que a California pratica hoje (política interna, quem aprova, quem é notificado).
3. UX que RH espera (quem lança, quem aprova, calendário do time, alerta de aquisitivo vencendo).

Só depois modelar tabela e RLS. O quadro atual (209 ativos com admissão preenchida) já suporta o cálculo do aquisitivo desde o dia 1.

**O que já está pronto pra suportar**:
- Coluna `data_admissao` populada nos 209 ativos.
- Alocação vigente por empresa/regional (útil pra ver "quem tá de férias na Vibe agora?").
- Combobox de líder direto pronto pra fluxo de aprovação (onde tiver líder).

---

## Rastros técnicos

Migrations aplicadas nessa sessão:

```
20260929800003_colaboradores_banco_fintech.sql
20260929900001_colab_email_pessoal_e_niveis_n1_n2.sql
20260929900002_reconciliacao_csv_passo1_cpfs.sql
20260929900003_reconciliacao_csv_passo2_textuais.sql
20260929900004_reconciliacao_csv_passo3_nivel_lider_salario.sql
20260929900005_reconciliacao_csv_passo4_cinco_novos.sql
20260929900006_reconciliacao_csv_passo5_uma_linha_salario.sql
20260930100001_import_bancarios_xlsx_sub1_cpf_cnpj.sql
20260930100002_import_bancarios_xlsx_sub2_por_nome.sql
20260930100003_import_bancarios_xlsx_sub3_relatorio_final.sql
20260930200001_consolida_alocacoes_duplicadas_folha_09.sql
```

Commits relevantes:

- `b44511e` — reconciliação com CSV atualizado do RH
- `c3b89cd` — 1 linha de salário por colaborador ativo (destrutivo)
- `8ed6c5b` — toggle de pendências ganha "Sem pendências"
- `282ca6d` — filtros em 2 linhas, ações agrupadas à direita
- `ea8133e` / `4082aaa` / `83f63fd` — import bancário xlsx (sub 1/2/3)
- `49c4fa5` — desambigua embed de regionais no detalhe
- `b6a02dc` — salários ocultos por default
- `0cf3072` — consolida alocações duplicadas da folha 09/2026
- `234abb2` — líder direto vira Combobox com busca
- `87d486e` — líder direto carrega usuários via 2 queries
