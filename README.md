# Zaraki Sushi

Site do Push Pop Sushi e plataforma de gestão da rede Zaraki (Matriz e franqueados): pedidos do site
gravados e enviados ao WhatsApp, painel `/admin` com pedidos, festas e eventos (sincronizados com a Google
Agenda), clientes, cardápio, cupons, estoque (insumos, tubos e materiais, com compras integradas ao financeiro e
baixa automática pela ficha técnica dos sabores), financeiro (fluxo de caixa, contas a pagar e receber, DRE,
saúde financeira, royalties e fechamento de mês), usuários, unidades, auditoria à prova de adulteração e
relatórios.

## Estrutura

```
apps/web               Next.js 16: landing (src/app/(site)), painel (src/app/(admin)), APIs (src/app/api)
packages/core          Regras de negócio puras: validações, preços, permissões, formatos, relatórios (CSV)
packages/db            Banco: schema Drizzle, migrations (segurança no SQL), consultas, relatórios
packages/integrations  Google Agenda (cliente, agenda simulada e sincronizador)
docs/                  Publicação, backup, Google Agenda e manual do sistema (docs/manual, em PDF)
```

Regras garantidas pelo próprio Postgres: **exclusão só lógica** (`status = false`; DELETE é bloqueado),
**auditoria automática** de toda alteração com cadeia de hash, e **isolamento entre unidades** (RLS).

## Desenvolvimento

Pré-requisitos: Node 24 e `corepack enable` (ativa o pnpm). Não precisa de Docker nem de internet para o
banco: o Postgres 18 roda a partir das dependências do projeto.

```bash
cp .env.example .env
pnpm install
pnpm db:start            # Postgres local (deixe rodando em outro terminal)
pnpm db:migrate
pnpm db:seed             # Matriz + cardápio inicial
pnpm db:seed-demo        # opcional: 6 meses de pedidos de exemplo para dashboard e relatórios
pnpm admin:create --email voce@exemplo.com --name "Seu Nome" --password "senha-provisoria" --platform-admin
pnpm dev                 # http://localhost:3000 e http://localhost:3000/admin
```

## Testes

```bash
pnpm turbo run typecheck test   # tipos + testes de regras, banco e integrações (Postgres temporário)
pnpm test:e2e                   # ponta a ponta com navegador real, banco temporário e WhatsApp/Agenda simulados
```

## Produção

Veja [docs/deploy.md](docs/deploy.md) (Vercel + Neon, variáveis, backup, monitoramento) e
[docs/google-agenda.md](docs/google-agenda.md).
