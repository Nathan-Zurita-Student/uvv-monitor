import { describe, expect, it } from 'vitest';
import { friendlyItemId, generateContentHash, sha256 } from '../../src/utils/hash.js';

describe('hash e IDs estáveis', () => {
  it('gera SHA-256 conhecido', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('normaliza espaços antes do hash de conteúdo', () => {
    const base = {
      source: 'PORTAL',
      externalId: '42',
      title: 'Trabalho final',
      description: 'Entregar amanhã',
      type: 'ASSIGNMENT',
    };
    expect(generateContentHash(base)).toBe(
      generateContentHash({ ...base, title: '  Trabalho   final  ' }),
    );
  });

  it('gera ID curto determinístico', () => {
    expect(friendlyItemId('PORTAL', '42')).toMatch(/^UVV-[A-F0-9]{6}$/);
    expect(friendlyItemId('PORTAL', '42')).toBe(friendlyItemId('PORTAL', '42'));
  });
});
