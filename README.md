# uvv-monitor

Assistente acadêmico pessoal para Portal do Aluno UVV, Gmail, Google Calendar, Google Sheets e
Telegram. Executa automaticamente no GitHub Actions, mantém histórico e estado das tarefas e não
depende de API paga de IA.

## Estado do projeto

- Login UVV validado contra o Portal real em 30/09/2026.
- Coleta read-only de Mensagens, blogs e posts de Minhas Turmas, atividades do Ambiente Virtual,
  Atendimento, Calendário de Atividades e Quadro de Horários.
- Gmail read-only, Google Calendar, Google Sheets e Telegram implementados; a validação externa
  depende da configuração OAuth/Bot do usuário.
- Hash, deduplicação entre posts/calendário, mudanças de prazo, prioridade, tarefas interativas,
  resumos e scheduler implementados.
- Webhook opcional e gratuito em Google Apps Script para botões inline com resposta imediata.
- GitHub Actions configurado para 12h, 17h e 21h em `America/Sao_Paulo`.
- `DRY_RUN=true` é o padrão.

O Ambiente Virtual é acessado pelo mesmo botão SSO usado pela interface do Portal. Uma URL privada
opcional do calendário EAD complementa a coleta quando os professores publicam prazos no calendário
do Moodle. Quando o SSO falha, o bot informa explicitamente que o AVA não foi verificado e continua
as demais fontes.

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

O bot funciona como um assistente pessoal focado em **provas, trabalhos e tarefas**: mensagens
curtas, em linguagem natural, e todas as ações acontecem dentro do Telegram com botões
(`callback_data`). Links são usados só para abrir a atividade original no AVA/Portal.

### Como ele avisa

| Quando           | O que chega                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Uma novidade     | Um cartão curto: tipo, nome, disciplina, prazo, o que importa e ações                                                                  |
| Várias novidades | Um resumo ("2 atividades novas, nenhuma prova nova...") com **📋 Ver novidades**, que navega pelos itens na mesma mensagem (⬅️ 1/3 ➡️) |
| Prazo chegando   | Um alerta por nível: até 3 dias, no dia e quando atrasa                                                                                |
| 12h              | Painel em menu, fixado no chat                                                                                                         |
| 21h              | "Amanhã", só se houver prova ou entrega                                                                                                |
| Domingo, 21h     | Os próximos 14 dias                                                                                                                    |

Um item só é avisado de novo quando algo relevante muda: prazo, conteúdo publicado pelo professor,
urgência ou um lembrete pedido. A assinatura de cada aviso fica na aba `notification_log`.

### Ações

- **✅ Concluir**, **🙈 Ignorar** e **↩️ Reabrir** executam na hora, com **↩️ Desfazer** logo depois.
- **⏰ Lembrar** abre: 30 min, 1 hora, hoje à noite, amanhã cedo, 1 dia antes ou um horário
  escrito livremente ("18:30", "amanhã 9h", "15/10 14h", "em 2 horas").
- **📖 Abrir** leva à atividade original.
- `/painel` abre o menu: Provas, Atividades, Atrasadas, Sem data, Calendário e Atualizar, com
  ⬅️ Voltar em cada tela.

### Status

O status coletado do AVA/Portal (`detected_items.status`) fica separado do status definido no bot
(`user_task_status`, com `completedAt`/`ignoredAt`). O status do usuário vale para a organização
pessoal, então uma atividade concluída não volta como pendente quando é encontrada de novo. A única
exceção é o próprio AVA confirmar a conclusão.

### Arquitetura do bot

```text
src/bot/        núcleo puro: telas, botões (callbacks), lembretes, prioridade e notificações
src/gas/        adaptador do Google Apps Script (webhook, planilha, lembretes)
apps-script/    Code.gs (entradas) + Bot.gs (gerado por npm run build:gas)
```

O mesmo núcleo roda em dois lugares:

- **Apps Script (webhook)**: responde aos botões e comandos na hora e envia os lembretes por um
  acionador a cada 5 minutos. Veja [`apps-script/README.md`](apps-script/README.md).
- **GitHub Actions**: coleta 3 vezes ao dia e envia novidades, alertas e o painel.

O monitor consulta `getWebhookInfo` a cada execução: com o webhook ativo, ele não lê o Telegram por
`getUpdates`. Sem webhook, os cliques são processados só nas execuções agendadas (modo de
reserva). `TELEGRAM_WEBHOOK_ENABLED=true` força o modo webhook.

### Configuração do bot

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
TELEGRAM_WEBHOOK_ENABLED # opcional; o webhook do Apps Script é detectado sozinho
TELEGRAM_ACTIONS_WEB_APP_URL # opcional; usado só por botões de mensagens antigas
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_SHEET_ID
GOOGLE_CALENDAR_ID       # opcional; primary por padrão
MOODLE_CALENDAR_URL      # URL privada de exportação dinâmica do calendário EAD
DRY_RUN                  # comece com true
AI_ENABLED               # false por padrão; true ativa a interpretação por IA
AI_PROVIDER              # gemini ou openai
GEMINI_API_KEY           # obrigatório quando AI_PROVIDER=gemini
GEMINI_MODEL             # padrão: gemini-3.1-flash-lite
OPENAI_API_KEY           # obrigatório quando AI_PROVIDER=openai
OPENAI_MODEL             # padrão: gpt-6-luna
AI_MAX_CALLS_PER_RUN     # limite de segurança; padrão: 20
AI_MAX_INPUT_CHARS       # máximo de texto por item; padrão: 20000
```

## Interpretação opcional por IA

O monitor funciona integralmente sem IA. Quando `AI_ENABLED=true`, itens novos ou alterados são
transformados em uma explicação simples contendo o que fazer, o que estudar, materiais mencionados
e informações que ainda precisam de confirmação. A IA nunca substitui datas oficiais, status,
deduplicação ou as regras do Google Calendar.

Gemini é o provedor padrão por oferecer uma camada gratuita. Crie uma chave no Google AI Studio e
configure:

```env
AI_ENABLED=true
AI_PROVIDER=gemini
GEMINI_API_KEY=sua_chave
GEMINI_MODEL=gemini-3.1-flash-lite
AI_MAX_CALLS_PER_RUN=20
AI_MAX_INPUT_CHARS=20000
```

Para testar sem executar o monitor inteiro:

```bash
npm run ai:test
```

Além da explicação, a IA:

- gera um título curto para avisos com títulos confusos;
- classifica a relevância e corrige o tipo de itens de fontes livres (e-mail, mensagens e posts).
  Pesquisas opcionais, vagas e newsletters deixam de aparecer como prova ou tarefa. Itens do
  calendário oficial de provas e do AVA nunca são reclassificados;
- encontra datas de prova ou entrega escritas no texto. A data só é aceita quando o trecho citado
  existe literalmente na fonte e contém o dia; ela aparece como "data lida do texto" e não gera
  evento no Google Calendar;
- sugere às 21h no que focar no dia seguinte, escolhendo apenas entre as pendências reais.

O orçamento de chamadas vai primeiro para as novidades da execução, depois para provas e tarefas
pela data mais próxima e, por último, para avisos recentes. O resultado é guardado junto ao item na
planilha e o mesmo conteúdo não é enviado novamente à API; uma nova análise só ocorre quando
título, descrição, data ou disciplina mudam, ou quando `AI_ANALYSIS_VERSION` é incrementada. Se a
API estiver indisponível ou atingir a cota, a execução continua com as mesmas mensagens, sem a
análise. Antes da chamada, e-mails, identificadores numéricos longos e possíveis segredos são
removidos.

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

No editor do Apps Script, execute `webhookInfo`: a URL deve terminar em `/exec?secret=***` e não
deve haver `last_error_message`. Depois de publicar uma nova versão, execute `setupWebhook` de
novo. Veja os erros em **Execuções** no editor do Apps Script.

### Uma fonte falhou

Consulte `run_history` e os artifacts privados. Uma fonte com erro não apaga dados nem impede as
outras coletas.
