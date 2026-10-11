# Ligar a Google Agenda

Encomendas e festas entram sozinhas na agenda de **zarakisushigo@gmail.com**: criar, mudar data ou
itens, cancelar, excluir e restaurar um pedido atualiza o evento correspondente. Para isso o sistema
usa uma **conta de serviço** do Google — uma "conta-robô" que só tem acesso à agenda que você
compartilhar com ela. Não há senha pessoal envolvida nem login que expire.

Leva uns 10 minutos e é feito uma única vez.

## 1. Criar a conta de serviço

1. Entre em <https://console.cloud.google.com> com a conta `zarakisushigo@gmail.com`.
2. Crie um projeto (ex.: **Zaraki Sistema**).
3. Em **APIs e serviços → Biblioteca**, procure **Google Calendar API** e clique em **Ativar**.
4. Em **IAM e administrador → Contas de serviço**, clique em **Criar conta de serviço**:
   - Nome: `zaraki-agenda`
   - Não é preciso conceder papéis no projeto; conclua.
5. Abra a conta criada → aba **Chaves** → **Adicionar chave → Criar nova chave → JSON**.
   Um arquivo `.json` será baixado. **Guarde-o como uma senha**: quem tiver esse arquivo consegue
   alterar a agenda.

## 2. Compartilhar a agenda com a conta de serviço

1. Abra <https://calendar.google.com> com `zarakisushigo@gmail.com`.
2. Em **Configurações → Minhas agendas → (a agenda principal) → Compartilhar com pessoas específicas**,
   adicione o e-mail da conta de serviço (algo como `zaraki-agenda@zaraki-sistema.iam.gserviceaccount.com`,
   está no arquivo JSON no campo `client_email`).
3. Permissão: **Fazer alterações nos eventos**.

## 3. Configurar as variáveis de ambiente

Na Vercel (**Project → Settings → Environment Variables**) e/ou no `.env` local:

| Variável | Valor |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | campo `client_email` do JSON |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | campo `private_key` do JSON, exatamente como está (com os `\n`) |
| `GOOGLE_CALENDAR_ID` | `zarakisushigo@gmail.com` |
| `CRON_SECRET` | um texto aleatório longo (`openssl rand -hex 24`) |

Remova `CALENDAR_DRIVER=fake` se ele estiver configurado: com as credenciais preenchidas, a agenda real
tem prioridade de qualquer forma.

## 4. Conferir

1. No painel, lance uma **Festa** para amanhã.
2. Em alguns segundos a ficha do pedido mostra **Na agenda** e o evento aparece em amarelo na agenda,
   com cliente, itens, total e o link para o pedido no painel.
3. Mude o horário: o evento é atualizado. Cancele: o evento é removido.

Se aparecer **Agenda: falhou**, a ficha do pedido mostra o erro devolvido pelo Google e o botão
**Sincronizar agora**. As causas mais comuns são a agenda não compartilhada com a conta de serviço ou
a Google Calendar API não ativada no projeto.

## Como funciona (para quem mantém o sistema)

- Toda alteração de encomenda/festa grava um pedido de sincronização na fila (`calendar_sync_jobs`),
  na mesma transação do pedido — nada se perde se o Google estiver fora do ar.
- A fila é processada logo após a resposta (`after()` do Next) e a cada 5 minutos pelo cron da Vercel
  (`/api/cron/calendar`, configurado em `apps/web/vercel.json`).
- Falhas são tentadas de novo com espera crescente (2, 4, 8… minutos, até 6 h). Depois de 8 tentativas o
  pedido fica com o selo **Agenda: falhou** e o evento `CALENDAR_SYNC_FAILED` entra na auditoria.
- O id do evento no Google é o id do pedido: repetições nunca duplicam eventos.
- Franqueados podem ter a própria agenda: preencha **Google Agenda (e-mail)** no cadastro da unidade e
  compartilhe essa agenda com a mesma conta de serviço.
