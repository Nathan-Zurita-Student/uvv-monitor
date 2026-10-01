import { createAiProvider } from '../ai/service.js';
import { loadConfig } from '../config/env.js';
import type { AcademicItem } from '../models/academic-item.js';

const config = loadConfig();
const provider = createAiProvider(config);
if (!provider) throw new Error('Ative AI_ENABLED=true para testar a integração.');

const testItem: AcademicItem = {
  id: 'UVV-TESTE',
  externalId: 'teste-local',
  source: 'USER',
  sourceUrl: 'https://aluno.uvv.br/',
  discipline: 'Disciplina de teste',
  title: 'Prova de teste',
  description:
    'A prova será em 05/10/2026. Estudar unidades 1 a 4 e revisar a lista de exercícios 2. O horário e o peso não foram informados.',
  type: 'EXAM',
  officialDate: '2026-10-05',
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  contentHash: 'teste',
  status: 'TODO',
  urgency: 'THIS_WEEK',
};

const result = await provider.analyze({
  item: testItem,
  maxInputCharacters: config.AI_MAX_INPUT_CHARS,
});
console.log(`Provedor: ${provider.name}`);
console.log(JSON.stringify(result, null, 2));
