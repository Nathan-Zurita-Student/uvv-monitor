import { describe, expect, it } from 'vitest';
import type { PortalItem } from '../../src/portal/models.js';
import { portalItemToCandidate } from '../../src/portal/to-academic-item.js';

function service(status: string): PortalItem {
  return {
    externalId: 'service:1',
    origin: 'SERVICE',
    sourceUrl: 'https://aluno.uvv.br/Atendimento/',
    title: 'Atendimento',
    description: status,
    type: 'SERVICE_REQUEST',
    status,
    links: [],
    metadata: {},
  };
}

describe('conversão de itens do Portal', () => {
  it('não transforma atendimento concluído em tarefa pendente', () => {
    expect(portalItemToCandidate(service('Concluído')).status).toBe('DONE');
  });

  it('mantém atendimento aguardando como WAITING', () => {
    expect(portalItemToCandidate(service('Aguardando Resposta')).status).toBe('WAITING');
  });
});
