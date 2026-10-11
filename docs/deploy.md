# Colocar a Zaraki em produção

Passo a passo para publicar o site e o painel na **Vercel** com banco **Neon**, e ligar backups e
monitoramento. Feito uma vez; depois, cada `git push` na branch `main` publica sozinho.

Custos de referência: Vercel Pro (~US$ 20/mês — o plano gratuito não permite uso comercial), Neon
(plano gratuito no começo; o pago dá mais dias de restauração), Cloudflare R2 (centavos por mês para
os backups).

## 1. Banco de dados (Neon)

1. Crie uma conta em <https://neon.tech> e um projeto **zaraki**, região **AWS São Paulo (sa-east-1)**,
   Postgres **18**.
2. Em **Branches**, mantenha a `main` (produção) e crie uma branch **`preview`** (para os deploys de teste).
3. Em **Connection details**, copie para cada branch:
   - a connection string do dono (`neondb_owner`) **sem pooler** → será `DATABASE_URL_MIGRATIONS`;
   - o host **com pooler** (`-pooler` no nome) → usado no passo 2.
4. Escolha uma senha forte para o papel da aplicação (`openssl rand -base64 24`) → `APP_DB_PASSWORD`.
   O papel `zaraki_app` é criado pelas próprias migrations; a senha é aplicada no deploy.
5. Monte a `DATABASE_URL` da aplicação com esse papel e o host com pooler:
   `postgres://zaraki_app:<APP_DB_PASSWORD>@<host-pooler>/neondb?sslmode=require`

> A aplicação nunca usa o dono do banco: o papel `zaraki_app` não tem permissão de DELETE e está sujeito
> ao isolamento entre unidades (RLS). O dono só roda migrations.

## 2. Projeto na Vercel

1. Em <https://vercel.com>, **Add New → Project** e importe o repositório do GitHub.
2. **Root Directory:** `apps/web` (o resto é lido de `apps/web/vercel.json`: instalação com pnpm, migrations
   no build, cron da agenda a cada 5 minutos).
3. **Storage → Blob → Create** e conecte ao projeto (cria `BLOB_READ_WRITE_TOKEN` para as fotos do cardápio).
4. **Settings → Environment Variables** — para **Production** (com os dados da branch `main` do Neon) e
   **Preview** (com os da branch `preview`):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | do passo 1.5 |
| `DATABASE_URL_MIGRATIONS` | dono, sem pooler (passo 1.3) |
| `APP_DB_PASSWORD` | do passo 1.4 |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (um diferente por ambiente) |
| `BETTER_AUTH_URL` | o endereço público (ex.: `https://zarakisushi.com.br`; no Preview, o domínio de preview) |
| `WHATSAPP_NUMBER` | `5562981092799` |
| `DEFAULT_TENANT_SLUG` | `matriz` |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_CALENDAR_ID` | veja `docs/google-agenda.md` |

**Não** defina `CALENDAR_DRIVER` nem `UPLOADS_LOCAL` em produção (são só para desenvolvimento e testes).
Se alguma variável obrigatória faltar ou estiver errada, o servidor não sobe e o log da Vercel diz qual.

5. **Deploy.** O build aplica as migrations e depois compila o site.

## 3. Primeiros dados

Com as variáveis de produção num `.env` local temporário (ou exportadas no terminal):

```bash
pnpm db:seed                     # cria a Matriz e o cardápio inicial (só se ainda não existirem)
pnpm admin:create --email voce@zaraki.com.br --name "Seu Nome" --password "senha-provisória" --platform-admin
```

Nunca rode `pnpm db:seed-demo` em produção (ele recusa conexões que não sejam `localhost`).
Apague o `.env` temporário em seguida.

## 4. Domínio

Em **Settings → Domains**, adicione o domínio e siga as instruções de DNS. Atualize `BETTER_AUTH_URL`
para o domínio final e faça um novo deploy.

## 5. Backup e restauração

Três camadas:

1. **Neon (restauração no tempo):** volta o banco para qualquer momento dentro da janela do plano
   (6 h no gratuito, 7–30 dias nos pagos). É o caminho para recuperar um erro recente: crie uma branch
   a partir do instante desejado e confira antes de promovê-la.
2. **Backup diário fora do Neon** (`.github/workflows/backup.yml`): todo dia às 03:00 um dump completo
   vai para o Cloudflare R2 — `diario/` (guardar 30 dias) e, no dia 1, também `mensal/` (12 meses).
   - Crie um bucket no R2 (ex.: `zaraki-backups`) com regras de ciclo de vida: `diario/` → apagar após
     30 dias; `mensal/` → apagar após 365 dias.
   - Crie um token de API do R2 com acesso de escrita a esse bucket.
   - No GitHub, em **Settings → Secrets and variables → Actions**, cadastre: `BACKUP_DATABASE_URL`
     (dono, sem pooler, branch `main`), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
   - Rode uma vez à mão (**Actions → Backup do banco → Run workflow**) e confira o arquivo no bucket.
3. **Auditoria com cadeia de hash:** mesmo restaurado, o histórico pode ser verificado em
   **Auditoria → Verificar integridade**.

**Restaurar um dump** (para investigar ou recuperar dados fora da janela do Neon) — em um Postgres 18
onde você seja superusuário (o local, por exemplo):

```bash
createdb zaraki_restaurado
psql -d zaraki_restaurado -c "create role zaraki_app nologin"
pg_restore --no-owner --disable-triggers -d zaraki_restaurado zaraki-AAAA-MM-DDTHHMMZ.dump
# conferência (o RLS exige o acesso da Matriz para enxergar tudo):
PGOPTIONS="-c app.platform_admin=on" psql -d zaraki_restaurado -c "select count(*) from orders"
```

`--disable-triggers` é obrigatório: sem ele, os gatilhos de auditoria regravariam o histórico na carga.
Este procedimento foi testado: o banco restaurado teve as mesmas contagens do original e a cadeia de
auditoria continuou íntegra.

## 6. Monitoramento

- **Saúde:** `https://<domínio>/api/health` responde `{"ok":true}` quando o site e o banco estão no ar
  (503 se o banco cair). Cadastre-o num monitor gratuito (UptimeRobot, Better Stack) com alerta no WhatsApp/e-mail.
- **Cron da agenda:** em **Vercel → Settings → Cron Jobs** aparece `/api/cron/calendar` a cada 5 minutos.
- **Logs:** Vercel → **Logs**. Avisos de configuração aparecem com o prefixo `[config]`; falhas da agenda, `[agenda]`.

## 7. Integração contínua

`.github/workflows/ci.yml` roda tipos, testes, build e os testes ponta a ponta a cada push e pull request
(com Postgres embutido — não toca em nenhum banco real). Proteja a branch `main` exigindo esse check.
