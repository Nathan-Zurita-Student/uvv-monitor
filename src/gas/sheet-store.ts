import { tables, type TableName } from '../persistence/rows.js';

export function cell(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Acesso às abas da planilha com as mesmas colunas usadas pelo monitor (persistence/rows). */
export class SheetStore {
  constructor(private readonly spreadsheet: GasSheets.Spreadsheet) {}

  static open(sheetId: string): SheetStore {
    return new SheetStore(SpreadsheetApp.openById(sheetId));
  }

  private sheet(name: TableName): GasSheets.Sheet {
    const existing = this.spreadsheet.getSheetByName(name);
    if (existing) return existing;
    const created = this.spreadsheet.insertSheet(name);
    created.appendRow(Array.from(tables[name]));
    return created;
  }

  rows(name: TableName): string[][] {
    return this.sheet(name)
      .getDataRange()
      .getValues()
      .slice(1)
      .map((row) => row.map(cell))
      .filter((row) => row[0]);
  }

  private keyIndex(sheet: GasSheets.Sheet, key: string | undefined): number {
    const lastRow = sheet.getLastRow();
    const keys = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
    return keys.findIndex((existing) => cell(existing[0]) === key);
  }

  /** Atualiza a linha com a mesma chave (1ª coluna) ou acrescenta; lê só a coluna das chaves. */
  upsert(name: TableName, row: string[]): void {
    const sheet = this.sheet(name);
    const index = this.keyIndex(sheet, row[0]);
    if (index >= 0) sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
  }

  /** Acrescenta sem procurar a chave (registros de log). */
  append(name: TableName, row: string[]): void {
    this.sheet(name).appendRow(row);
  }

  remove(name: TableName, key: string): void {
    const sheet = this.sheet(name);
    const index = this.keyIndex(sheet, key);
    if (index >= 0) sheet.deleteRow(index + 2);
  }
}
