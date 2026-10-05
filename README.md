# uvv-monitor

Assistente acadêmico pessoal para Portal do Aluno UVV, AVA, Gmail, Google Calendar, Google Sheets e
Telegram. A coleta roda automaticamente no GitHub Actions e o bot conversa em linguagem natural pelo
Telegram, com o GPT como "cérebro" que consulta agenda, atividades, e-mails e memória por meio de
ferramentas. Sem chave da OpenAI, botões, comandos, avisos e lembretes continuam funcionando.

## Estado do projeto

- Login UVV validado contra o Portal real em 30/09/2026.
- Coleta read-only de Mensagens, murais completos de Minhas Turmas (todas as páginas do "Carregar
  mais…", com data de cada post), arquivos anexados pelos professores, atividades do Ambiente
  Virtual, Atendimento, Calendário de Atividades e Quadro de Horários (aulas por dia e horário).
- Arquivos dos posts (PDF, DOCX, PPTX, ZIP, imagens) baixados e enviados no Telegram como estão,
  sem leitura do conteúdo.
- Gmail read-only, Google Calendar, Google Sheets e Telegram implementados; a validação externa
  depende da configuração OAuth/Bot do usuário.
- Hash, deduplicação entre posts/calendário, mudanças de prazo, prioridade, tarefas interativas,
  resumos e scheduler implementados.
- Webhook opcional e gratuito em Google Apps Script para botões inline com resposta imediata.
- Assistente com GPT e ferramentas (agenda, atividades, provas, Gmail, AVA, lembretes, memória,
  horários livres e prioridades), proativo e com confirmação antes de alterar ou apagar algo.
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

O que é lido a cada coleta:

| Página                  | O que vira                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quadro de Horários      | Aba `class_schedule`: um bloco por aula (disciplina, dia, início e fim; EAD marcada). Hoje/Semana mostram as aulas, e prova ou apresentação sem hora vai para a Agenda no horário da aula daquele dia (com aviso de que é provável). |
| Minhas Turmas → Acessar | O mural inteiro de cada turma (o "Carregar mais…" é seguido até o fim), com a data de cada post. Posts antigos encontrados agora entram no histórico sem virar aviso.                                                                |
| Post → Visualizar Post  | Texto completo, professor e os botões "Baixar Arquivo".                                                                                                                                                                              |
| Arquivos dos posts      | Baixados com a sessão do Portal (nada fica em disco) e enviados no Telegram sem serem lidos; `portal_documents` guarda nome, tamanho, hash e o `file_id` para reenviar.                                                              |
| Aviso de aula cancelada | "Não haverá aula de Mobile amanhã dia 05/10" risca a aula daquele dia no bot e libera o horário.                                                                                                                                     |

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
- `/painel` abre o menu: 📅 Hoje, 📆 Semana, 📝 Atividades, 📚 Provas, ⏰ Prazos, ✅ Concluídas,
  📩 Novidades, 🎓 UVV, ⚠️ Atrasadas, 📌 Sem data, 📂 Materiais, 🤖 Perguntar e 🔄 Atualizar, com
  ⬅️ Voltar em cada tela. Hoje e Semana juntam a Google Agenda, as aulas do Quadro de Horários (e as
  que você contou ao assistente), aulas canceladas pelo professor, os lembretes e o que vence, sem
  duplicar o que aparece em mais de uma fonte. Prova sem hora mostra o horário provável da aula.
- **📂 Materiais** (`/materiais`): os arquivos que os professores postaram, por matéria e os mais
  recentes; um toque reenvia os arquivos no chat (pelo `file_id` do Telegram, sem baixar de novo).
- Arquivos novos chegam sozinhos: assim que o monitor encontra um anexo novo no mural, ele chega no
  chat com a matéria e o título do post. Na primeira coleta, todo o material já postado chega
  organizado por matéria (álbuns de até 6 arquivos; se um álbum falhar, vai arquivo por arquivo, e
  o que não foi enviado tenta de novo na coleta seguinte).
- **🔍 Verificar Portal agora** (`/atualizar`) pede uma coleta na hora (uma a cada 10 minutos).
- Atalhos opcionais: `/hoje`, `/semana`, `/provas`, `/atividades`, `/prazos`, `/agenda`,
  `/novidades`, `/materiais`, `/concluidas`, `/uvv`. Tudo isso também funciona escrevendo
  normalmente.

### Assistente (conversa natural)

Qualquer mensagem que não seja comando vai para o assistente, que responde como uma pessoa:

> **Você:** chat, como tá minha semana?
> **Bot:** Essa semana o mais importante é a prova de Linguagens Formais na segunda. Terça e quarta
> estão tranquilas, então eu usaria um desses dias para adiantar a AOP 03, que vence dia 13.
> **Você:** coloca um horário de estudo pra prova amanhã às 14h
> **Bot:** Coloquei das 14h às 15h30 na sua Agenda.

Ele entende datas como "amanhã", "sexta que vem", "dia 15" ou "depois da aula" no fuso
`America/Sao_Paulo`, mantém o contexto entre mensagens ("que horas?", "me lembra dois dias antes")
e só usa listas quando fazem sentido. Também abre a matéria como no Portal ("como tá Mobile?",
"o que o professor postou em Cálculo?", "o que o trabalho de LFA pede?"), manda os arquivos
("me manda o PDF da unidade 3") e responde sobre qualquer e-mail do Gmail, não só os da faculdade.
O conteúdo dos arquivos não é lido: o assistente usa o texto do post e envia o arquivo.

```text
Telegram → webhook (Apps Script) → assistente (src/assistant/agent.ts) ⇄ GPT
                                      └─ ferramentas (src/assistant/tools.ts)
                                          ├─ Google Agenda (consultar, criar, alterar, remover)
                                          ├─ Gmail (buscar e ler, somente leitura)
                                          ├─ Portal/AVA/e-mails já coletados (planilha)
                                          ├─ Quadro de Horários, murais e arquivos dos professores
                                          ├─ prioridades, alertas, conflitos e horários livres
                                          ├─ lembretes no Telegram
                                          └─ memória (aulas, professores, preferências)
```

- **Ferramentas, não contexto gigante:** o GPT recebe só a data, a memória curta e alertas; ele
  decide o que consultar (`get_calendar_events`, `get_academic_tasks`, `get_upcoming_exams`,
  `get_class_schedule`, `get_discipline_overview`, `read_academic_item`, `send_class_files`,
  `get_academic_context`, `get_free_time`, `get_ava_updates`,
  `search_gmail`, `read_email`, `create_calendar_event`, `update_calendar_event`,
  `delete_calendar_event`, `create_reminder`, `cancel_reminder`, `mark_task_completed`,
  `save_memory`, `forget_memory`).
- **Contexto acadêmico central** (`src/assistant/catalog.ts`, `timeline.ts`): provas, trabalhos,
  AOPs, exercícios, aulas, apresentações, seminários, entregas, estágio, documentos, avisos e
  pendências vindos do Portal, do AVA, do Gmail, da Agenda e do Telegram ficam numa visão só. O
  evento que o monitor criou para uma prova é a própria prova; um compromisso seu com o mesmo
  assunto no mesmo dia vira uma observação no item; um e-mail com o mesmo prazo de uma atividade do
  AVA é unido a ela.
- **Fontes:** em caso de conflito vale, nesta ordem: o que você confirmou, a Google Agenda,
  Portal/AVA, e-mail e, por último, o que a IA inferiu. O assistente avisa quando há divergência e
  nunca inventa datas ou horários ("horário não informado").
- **Prioridades e planejamento** (`src/assistant/insights.ts`, `free-time.ts`): prazo, tipo
  (prova pesa mais), pontos, atraso e acúmulo de prazos viram uma ordem com motivos; os horários
  livres descontam aulas, compromissos e provas.
- **Ações com segurança:** criar evento, lembrete, marcar atividade e salvar memória são feitos na
  hora. Alterar ou remover evento e cancelar lembrete só acontecem depois de **✅ Confirmar** (ou
  "sim"). Eventos sincronizados do Portal não são editados pelo assistente. Conteúdo de e-mails e
  avisos é tratado como informação, nunca como instrução.
- **Memória útil** (aba `assistant_memory`): horários de aula, disciplinas, professores,
  preferências e coisas que você pediu para lembrar. "Já fiz essa prova" marca a atividade como
  concluída, e ela para de gerar avisos.
- **Proativo sem exagero:** no máximo um aviso por dia, a partir das 9h, quando há algo acionável
  (prova chegando sem estudo marcado, entrega vencendo pendente, duas entregas no mesmo dia,
  compromissos sobrepostos), com botões como **📚 Organizar estudo**. Na conversa, um alerta ainda
  não mencionado pode aparecer como "Aliás, ...".
- **Custo:** cerca de US$ 0,002 a 0,005 por mensagem com `gpt-5.4-mini` (o prompt fixo e as
  ferramentas ficam em cache na OpenAI). O teto padrão é US$ 2,50 por mês e 40 conversas por dia;
  botões e telas não usam GPT. `/gastos` mostra o consumo.
- **Logs** (aba `assistant_log`): pergunta (sem e-mails, números longos ou chaves), ferramentas
  chamadas, rodadas, modelo, tokens, custo, tempo e resultado. Os mesmos dados vão para os logs de
  execução do Apps Script. Chaves e tokens nunca são registrados.

Configuração e propriedades: [`apps-script/README.md`](apps-script/README.md#assistente-com-gpt).

### Status

O status coletado do AVA/Portal (`detected_items.status`) fica separado do status definido no bot
(`user_task_status`, com `completedAt`/`ignoredAt`). O status do usuário vale para a organização
pessoal, então uma atividade concluída não volta como pendente quando é encontrada de novo. A única
exceção é o próprio AVA confirmar a conclusão.

### Arquitetura do bot

```text
src/assistant/  assistente: contexto acadêmico, linha do tempo, prioridades, ferramentas, agente
src/bot/        núcleo puro: telas, botões (callbacks), lembretes, prioridade e notificações
src/gas/        adaptador do Google Apps Script (webhook, cache, Agenda/Gmail via REST, GPT)
apps-script/    Code.gs (entradas) + Bot.gs (gerado por npm run build:gas)
```

O mesmo núcleo roda em dois lugares:

- **Apps Script (webhook)**: responde aos botões e comandos na hora e envia os lembretes por um
  acionador a cada 5 minutos. Veja [`apps-script/README.md`](apps-script/README.md).
- **GitHub Actions**: coleta 3 vezes ao dia e envia novidades, alertas e o painel.

O monitor consulta `getWebhookInfo` a cada execução: com o webhook ativo, ele não lê o Telegram por
`getUpdates`. Sem webhook, os cliques são processados só nas execuções agendadas (modo de
reserva). `TELEGRAM_WEBHOOK_ENABLED=true` força o modo webhook.

Para responder rápido, o Apps Script trabalha com uma cópia comprimida da planilha no cache. Ao
fim de cada coleta, o monitor chama o webhook com `{"uvv":"refresh"}` para renovar essa cópia.

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

A conversa pelo Telegram usa GPT separadamente, no webhook do Apps Script (veja
[Assistente](#assistente-conversa-natural)). As análises automáticas da coleta continuam com o
provedor escolhido abaixo.

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

Nenhuma API de IA é necessária para a coleta, os avisos e os botões.

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

O agendamento do GitHub costuma atrasar horas nos horários cheios. Por isso, quem dispara a coleta
às 12h, 17h e 21h é o Apps Script (`processReminders`, a cada 5 minutos), chamando
`workflow_dispatch` no horário certo. O `schedule` do workflow fica como reserva, fora da hora
cheia, e é ignorado quando uma coleta terminou há menos de 3 horas:

- `41 14 * * *` → 11h41 em São Paulo (janela 12h)
- `41 19 * * *` → 16h41 em São Paulo (janela 17h)
- `41 23 * * *` → 20h41 em São Paulo (janela 21h)

Para o disparo pelo Apps Script, crie um token _fine-grained_ no GitHub (**Settings → Developer
settings → Fine-grained tokens**) com acesso só ao repositório `uvv-monitor` e permissão
**Actions: Read and write**. Guarde-o como secret `MONITOR_DISPATCH_TOKEN` (ou no `.env`) e rode
**Configurar conversa do Telegram**, ou cole direto em **Propriedades do script** com o mesmo nome.
Sem o token, o bot continua funcionando e as coletas ficam só no agendamento de reserva.
`concurrency` garante uma coleta por vez.

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

Schedules do GitHub podem atrasar horas. Configure `MONITOR_DISPATCH_TOKEN` (veja GitHub
Actions) para o Apps Script disparar no horário; `RUN_SLOT` preserva a janela acadêmica correta.

### Botão inline fica carregando

No editor do Apps Script, execute `webhookInfo`: a URL deve terminar em `/exec?secret=***` e não
deve haver `last_error_message`. Depois de publicar uma nova versão, execute `setupWebhook` de
novo. Veja os erros em **Execuções** no editor do Apps Script.

### O bot mostra dados antigos

Os botões leem uma cópia da planilha que o monitor renova a cada coleta, e o acionador de
lembretes a cada 30 minutos. Depois de editar a planilha à mão, execute `refreshCache` no editor
do Apps Script.

### Uma fonte falhou

Consulte `run_history` e os artifacts privados. Uma fonte com erro não apaga dados nem impede as
outras coletas.
