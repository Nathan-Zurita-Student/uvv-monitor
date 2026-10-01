# uvv-monitor

Assistente acadêmico pessoal para Portal do Aluno UVV, Gmail, Google Calendar, Google Sheets e
Telegram. Executa automaticamente no GitHub Actions, mantém histórico e estado das tarefas e não
depende de API paga de IA.

## Estado do projeto

- Login UVV validado contra o Portal real em 30/09/2026.
- Coleta read-only de Mensagens, blogs e posts de Minhas Turmas, Atendimento, Calendário de
  Atividades e Quadro de Horários.
- Gmail read-only, Google Calendar, Google Sheets e Telegram implementados; a validação externa
  depende da configuração OAuth/Bot do usuário.
- Hash, deduplicação entre posts/calendário, mudanças de prazo, prioridade, tarefas interativas,
  resumos e scheduler implementados.
- Webhook opcional e gratuito em Google Apps Script para botões inline com resposta imediata.
- GitHub Actions configurado para 12h, 17h e 21h em `America/Sao_Paulo`.
- `DRY_RUN=true` é o padrão.

Limitação conhecida: o acesso ao Ambiente Virtual depende do endpoint SSO da própria UVV. Quando
esse endpoint falha, o bot informa explicitamente que o AVA não foi verificado e continua as demais
fontes.

## Arquitetura

```text
src/
  calendar/          criação, atualização e deduplicação de eventos
  cli/               comandos locais e entrypoint principal
  config/            environment variables validadas com Zod
  gmail/             Gmail API, MIME e relevância determinística
  google/            OAuth e scopes mínimos
  models/            itens, status, urgência e execuções
  persistence/       repositórios e Google Sheets
  portal/            Playwright, autenticação e coletores read-only
  prioritization/    urgência e seleção de check-ins
  scheduler/         janelas e orquestração resiliente
  telegram/          getUpdates, comandos, push e formatação
  utils/             datas, hash, normalização e logs
tests/
.github/workflows/monitor.yml
apps-script/          webhook gratuito para interações imediatas no Telegram
```

Cada fonte falha isoladamente. CAPTCHA/MFA ou falha no Portal não impede Gmail, Calendar e o resumo
do estado já persistido.

## Requisitos

- Node.js 22 ou 24
- npm
- Conta Google e projeto Google Cloud
- Bot do Telegram
- Repositório GitHub privado recomendado

## Instalação

```bash
npm ci
npx playwright install chromium
```

Copie `.env.example` para `.env`, mantenha `DRY_RUN=true` e nunca faça commit do `.env`.

```bash
npm run check
npm run portal:check
npm run portal:collect
```

## Portal UVV

O Portal é estritamente read-only. O navegador não persiste cookies ou `storageState`.

Comandos disponíveis:

- `npm run portal:inspect`: verifica a entrada pública sem credenciais.
- `npm run portal:check`: valida o login real.
- `npm run portal:collect`: executa os coletores e salva diagnóstico privado.
- `npm run portal:inspect:authenticated`: ferramenta de desenvolvimento para mudanças de DOM/API.

CAPTCHA ou MFA nunca são contornados. A execução marca o Portal como não verificado e continua com
as demais fontes.

## Telegram

1. Abra uma conversa com `@BotFather` no Telegram.
2. Use `/newbot`, escolha nome e username e copie o token.
3. Envie uma mensagem qualquer ao novo bot.
4. Defina temporariamente `TELEGRAM_BOT_TOKEN` no terminal e consulte `getUpdates`:

```powershell
$headers = @{ 'Content-Type' = 'application/json' }
$uri = "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/getUpdates"
Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body '{}'
```

O número em `result[].message.chat.id` é o `TELEGRAM_CHAT_ID`. Apenas mensagens desse chat são
processadas.

Comandos:

```text
/feito UVV-ABC123
/fazendo UVV-ABC123
/pendente UVV-ABC123
/ignorar UVV-ABC123
/status UVV-ABC123
```

Respostas como “já fiz”, “estou fazendo” e “ainda não fiz” também funcionam quando incluem o ID ou
são respostas a uma mensagem que contém o ID.

### Botões de andamento em tempo real

Mantenha `TELEGRAM_WEBHOOK_ENABLED=false` para que comandos escritos sejam lidos por `getUpdates`
nas execuções agendadas. Para atualizar uma tarefa imediatamente por botão, publique o Web App
descrito em [`apps-script/README.md`](apps-script/README.md) e configure sua URL em
`TELEGRAM_ACTIONS_WEB_APP_URL`.

Cada uma das três prioridades principais recebe uma mensagem própria com
botões de “Não comecei”, “Em andamento”, “Concluído”, “Aguardando” e um link para a fonte original.
Cada link usa um token aleatório exclusivo, salvo na aba `telegram_task_messages`. Ao tocar, o Web
App valida o token, atualiza a planilha e edita a mensagem do Telegram. Esse fluxo evita o
redirecionamento HTTP do Apps Script que impede seu uso confiável como webhook do Telegram.

## Google Cloud e OAuth

1. Crie um projeto em Google Cloud Console.
2. Ative Gmail API, Google Calendar API e Google Sheets API.
3. Configure a tela de consentimento OAuth. Se o app estiver em teste, adicione sua conta como
   usuário de teste.
4. Crie credenciais OAuth do tipo **Aplicativo para computador**.
5. Coloque `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` somente no `.env` local.
6. Execute `npm run google:authorize`.

O navegador solicitará apenas leitura do Gmail, acesso ao Calendar e à planilha. O comando mostra
o `GOOGLE_REFRESH_TOKEN` no terminal e não o salva. Copie-o diretamente para os GitHub Secrets.

Crie uma planilha vazia e copie o trecho entre `/d/` e `/edit` da URL para `GOOGLE_SHEET_ID`. Na
primeira execução, o sistema cria as abas `detected_items`, `user_task_status`, `run_history`,
`telegram_state` e `telegram_task_messages`.

## Google Calendar

O calendário padrão é `primary`; altere com `GOOGLE_CALENDAR_ID`. Eventos automáticos começam com
`[UVV]` e carregam ID, origem e hash em propriedades privadas. O sistema busca evento equivalente
antes de criar e atualiza mudanças confirmadas.

Datas ambíguas ou itens `NEEDS_CONFIRMATION` nunca geram evento. Eventos passados também não são
criados. Em `DRY_RUN=true`, apenas `WOULD_CREATE`/`WOULD_UPDATE` são registrados.

## GitHub Secrets

Configure em **Settings → Secrets and variables → Actions**:

```text
UVV_USERNAME
UVV_PASSWORD
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TELEGRAM_WEBHOOK_ENABLED # mantenha false no modo getUpdates
TELEGRAM_ACTIONS_WEB_APP_URL # URL pública /exec do Apps Script
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_SHEET_ID
GOOGLE_CALENDAR_ID       # opcional; primary por padrão
DRY_RUN                  # comece com true
```

Nenhuma API de IA é necessária.

## Execução local

Com todas as variáveis configuradas:

```bash
npm start
```

Para simular uma janela específica no PowerShell:

```powershell
$env:RUN_SLOT='21:00'
npm start
```

A primeira execução inicializa a memória sem enviar dezenas de alertas retroativos.

## GitHub Actions

O workflow usa UTC:

- `0 15 * * *` → 12h em São Paulo
- `0 20 * * *` → 17h em São Paulo
- `0 0 * * *` → 21h em São Paulo, já no dia UTC seguinte

As regras internas sempre usam `America/Sao_Paulo`. Quarta-feira e domingo são calculados no fuso
local. `workflow_dispatch` permite teste manual e escolha da janela lógica. Diagnósticos ficam como
artifact privado por sete dias.

## Desenvolvimento e testes

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run build
```

Os testes cobrem hash, deduplicação, mudança de prazo, prioridade, timezone, quarta/domingo,
Calendar, duplicatas, comandos Telegram, callbacks validados, teclados inline, status, Gmail e
normalização.

## Segurança

- `.env`, tokens, cookies, `storageState`, screenshots, HTML e artifacts são ignorados pelo Git.
- Senhas e tokens são censurados nos logs.
- O Portal nunca recebe ações de alteração acadêmica.
- O Telegram aceita comandos somente do `TELEGRAM_CHAT_ID` configurado.
- O webhook valida um segredo não versionado, o chat autorizado, o ID da tarefa e uma lista fechada
  de status.
- A primeira execução deve permanecer em `DRY_RUN=true`.

## Troubleshooting

### Portal mudou a interface

Execute `npm run portal:check` e `npm run portal:inspect:authenticated`. Consulte
`artifacts/diagnostics` localmente e atualize seletores somente com base no DOM/API real.

### CAPTCHA ou MFA

Faça a validação manual necessária. O projeto não tenta resolver nem contornar o desafio.

### Google não retornou refresh token

Revogue o acesso anterior na Conta Google e execute `npm run google:authorize` novamente.

### GitHub Actions atrasou

Schedules podem atrasar alguns minutos. `RUN_SLOT` preserva a janela acadêmica correta.

### Botão inline fica carregando

Confirme que `TELEGRAM_ACTIONS_WEB_APP_URL` aponta para a URL pública terminada em `/exec`, publique
uma nova versão do Apps Script e execute novamente o monitor. Os botões de andamento devem ser
links URL, não callbacks dependentes de webhook.

### Uma fonte falhou

Consulte `run_history` e os artifacts privados. Uma fonte com erro não apaga dados nem impede as
outras coletas.
