-- Papeis de usuario do ERP California.
--
-- A Californinia definiu 5 papeis operacionais para o sistema:
--   administrador, gerente_producao (GP), produtor, freelancer, financeiro.
-- RH e Midia ficam de fora ate a fase que criar esses modulos.
--
-- Duas mudancas no enum app_role:
--   1) rename 'gestao_projetos' -> 'gerente_producao'.
--      O time chama a funcao de "Gerente de Producao", nao "Gestao de
--      Projetos". A tabela profiles hoje tem 19 linhas, TODAS com valor
--      'administrador' -- por isso o rename e seguro (0 linhas afetadas).
--   2) add 'produtor' e 'freelancer'. Sao papeis novos.
--      - Produtor: braco direito do GP; faz tudo em job/orcamento menos
--        aprovar.
--      - Freelancer: escopo restrito aos jobs onde ele consta na equipe
--        do projeto (via projeto_responsaveis, papel 'equipe').
--
-- Nada mais precisa mudar aqui. O escopo do Freelancer (row-level RLS
-- olhando projeto_responsaveis) entra numa migration separada, junto com
-- os gates de role nas tabelas operacionais.

alter type public.app_role rename value 'gestao_projetos' to 'gerente_producao';
alter type public.app_role add value if not exists 'produtor';
alter type public.app_role add value if not exists 'freelancer';
