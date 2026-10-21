# Vazamento de PII — fase 2: fechamos o banco, falta fechar o GitHub (2026-10-21)

> O vazamento de outubro não terminou com a sanitização da `main`. Duas coisas continuavam abertas: o GitHub público ainda servia os CPFs via SHA antigo, e o banco ao vivo liberava 221 cadastros + 738 arquivos pra 92 usuários que não deveriam ver. O banco foi fechado hoje. O GitHub ficou pra decisão.

## O que muda pro negócio

A partir de hoje, só admin + RH + financeiro leem CPF/email/telefone/contrato de freelancer e colaborador no banco. Antes, qualquer uma das 101 pessoas ativas no tenant lia tudo — inclusive os 7 freelancers logados e os 81 produtores/gerentes. O que ainda está em pé: versões antigas do repo no GitHub público servem a mesma informação se alguém souber o SHA do commit antigo.

## Estado atual (o que existe agora)

- **RLS do banco ao vivo**: fechada. `freelancers`, `freelancer_contratos`, `colaboradores_nf_anexos` e os buckets `freelancer-arquivos` e `colaboradores-nf` passaram do `is_tenant_member` (qualquer role ativa) pra `is_tenant_admin OR is_tenant_rh OR is_tenant_financeiro`. Verificado via `pg_policies` depois de aplicar.
- **UI**: nenhum fluxo quebrou. A role `freelancer` hoje não acessa nenhuma dessas telas (grep confirmou nos 6 arquivos que leem `freelancers`, nos 7 que leem o bucket, no único arquivo que vê a string `role=freelancer`).
- **Guard-rail**: `scripts/check-rls.sh` roda no pre-commit e bloqueia migration que crie policy de SELECT em entidade sensível usando `is_tenant_member` sozinho. Testado com migration limpa (passa) e com migration ruim (bloqueia com mensagem clara).
- **Bucket `images` público**: auditado — contém só `logo-icon.png` e um placeholder vazio. Zero PII. Deixado como está.
- **GitHub público**: 5 de 6 SHAs pré-sanitização testados continuam acessíveis via `api.github.com/.../commits/<sha>` sem autenticação, por causa dos 4 PRs fechados e das 3 branches remotas que não foram deletadas no `filter-repo` original. **Nenhuma ação tomada aqui ainda.**

Números concretos de hoje: 221 freelancers (210 com CPF, 184 com raça/deficiência/saúde preenchidos), 738 objetos no bucket `freelancer-arquivos`, 101 tenant_members ativos (92 na lista "não deveriam ver").

## Decisões que vão importar amanhã

- **Padrão de RLS pra dado pessoal**: `admin + rh + financeiro`, nunca `is_tenant_member`. Documentado em `docs/decisions/203-rls-de-dado-pessoal-restrito-a-admin-rh-financeiro.md`. Vale pra tabela nova com CPF, email, telefone, salário, documento fiscal. Entidade operacional sem PII (ex.: `pedidos-compra`) pode continuar com `is_tenant_member` + whitelist de `session_role` — já era o padrão delas.
- **Guard-rail depende de lista**: `SENSIVEIS_REGEX` dentro do `scripts/check-rls.sh` é a lista de entidades vigiadas. Quando criar `rh_rescisoes`, `folha_decimo_terceiro_itens`, ou qualquer coisa nova com PII, **adicione o nome ao regex no mesmo commit**. Senão o guard-rail não vai pegar policy ruim nela.
- **Escape documentado**: se uma migration intencionalmente precisar de `is_tenant_member` em entidade sensível (ex.: freelancer vê a própria linha), ela precisa ter o comentário `-- rls-member-ok: <motivo>` no arquivo. O guard-rail usa esse marcador pra desligar o bloqueio.
- **Fase 2 do GitHub ficou pra fora**: a decisão de tornar o repo privado, deletar branches residuais e abrir ticket no GitHub Support pra purgar refs de PR foi apresentada mas não executada. Enquanto não rolar, qualquer um com um SHA antigo lê a migration de folha original. A memória `MEMORY.md` já aponta que o repo está público.

## O que fica pra próxima sessão

- **Objetivo**: fechar o GitHub.
- **Por onde começar**: Settings → Danger Zone → Change repository visibility → Private. Depois deletar as 3 branches remotas residuais (`claude/great-pasteur-ujnu6c`, `claude/legal-module-contract-templates-93zhph`, `feat/leitura-do-anexo`) e abrir ticket em https://support.github.com/contact pedindo purge de `refs/pull/*` do repo com a lista de SHAs. Rotacionar a `service_role` do Supabase na mesma janela — supor que vazou é mais barato que verificar se vazou.
- **O que já está pronto pra suportar**: banco fechado, nenhuma dependência do repo público em produção que eu tenha visto. Vercel e CI continuam acessando com credencial — tornar privado não deve quebrar deploy, mas vale confirmar antes.

## Rastros técnicos

```
supabase/migrations/20261021000005_fechar_rls_freelancers_e_buckets.sql
scripts/check-rls.sh
.githooks/pre-commit    (passou a chamar check-pii.sh + check-rls.sh)
docs/decisions/203-rls-de-dado-pessoal-restrito-a-admin-rh-financeiro.md
```

Commit: `a9656653` — `security(rls): freelancers/anexos/buckets fecham para admin+rh+financeiro`
