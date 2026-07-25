// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests de la capa de parseo del migrador (módulo puro).
 *
 * Foco en los 5 "tipos de vacío" de la planilla, decimales con coma/punto,
 * fechas parciales (M/AA) y CSV con comillas.
 */
import { describe, expect, it } from 'vitest';
import {
  birthDateFromAge, cellKind, isYes, num, parseCsv, partialDate, rowsToObjects, slug, text,
} from './parsers';

describe('cellKind — los 5 tipos de vacío', () => {
  it('"" → unknown', () => expect(cellKind('')).toBe('unknown'));
  it('espacios → unknown', () => expect(cellKind('   ')).toBe('unknown'));
  it('"No corresponde" → na', () => expect(cellKind('No corresponde')).toBe('na'));
  it('"No realizado" → not-done', () => expect(cellKind('No realizado')).toBe('not-done'));
  it('un valor real → value', () => expect(cellKind('72')).toBe('value'));
  it('"No" es un valor (booleano), no un vacío', () => expect(cellKind('No')).toBe('value'));
  it('undefined → unknown', () => expect(cellKind(undefined)).toBe('unknown'));
});

describe('isYes', () => {
  it('reconoce Sí / Si / sí', () => {
    expect(isYes('Sí')).toBe(true);
    expect(isYes('Si')).toBe(true);
    expect(isYes('sí')).toBe(true);
  });
  it('No / vacío / otro → false', () => {
    expect(isYes('No')).toBe(false);
    expect(isYes('')).toBe(false);
    expect(isYes('No corresponde')).toBe(false);
    expect(isYes(undefined)).toBe(false);
  });
});

describe('num — decimal coma o punto; vacíos → undefined', () => {
  it('punto decimal', () => expect(num('1.57')).toBe(1.57));
  it('coma decimal', () => expect(num('29,2')).toBe(29.2));
  it('entero', () => expect(num('130')).toBe(130));
  it('vacío / na / no-realizado → undefined', () => {
    expect(num('')).toBeUndefined();
    expect(num('No corresponde')).toBeUndefined();
    expect(num('No realizado')).toBeUndefined();
  });
  it('texto no numérico → undefined', () => expect(num('Bajo')).toBeUndefined());
});

describe('text — limpio; vacíos → undefined', () => {
  it('recorta', () => expect(text('  hola  ')).toBe('hola'));
  it('na/no-realizado → undefined', () => {
    expect(text('No corresponde')).toBeUndefined();
    expect(text('No realizado')).toBeUndefined();
    expect(text('')).toBeUndefined();
  });
});

describe('partialDate', () => {
  it('M/AA → AAAA-MM', () => expect(partialDate('3/26')).toBe('2026-03'));
  it('M/AAAA → AAAA-MM', () => expect(partialDate('3/2026')).toBe('2026-03'));
  it('DD/MM/AAAA → ISO', () => expect(partialDate('5/3/2024')).toBe('2024-03-05'));
  it('ISO se conserva', () => {
    expect(partialDate('2024-03')).toBe('2024-03');
    expect(partialDate('2024-03-05')).toBe('2024-03-05');
  });
  it('no parseable → undefined', () => {
    expect(partialDate('marzo')).toBeUndefined();
    expect(partialDate('')).toBeUndefined();
  });
});

describe('birthDateFromAge', () => {
  it('resta la edad al año de referencia', () => {
    const ref = new Date('2024-06-15');
    expect(birthDateFromAge(56, ref)).toBe('1968-01-01');
  });
  it('trunca edades decimales', () => {
    const ref = new Date('2024-06-15');
    expect(birthDateFromAge(56.9, ref)).toBe('1968-01-01');
  });
  it('undefined → undefined', () => expect(birthDateFromAge(undefined)).toBeUndefined());
});

describe('slug — estable y sin diacríticos', () => {
  it('quita acentos y normaliza', () => {
    expect(slug('Perí Abd (cm) área')).toBe('peri-abd-cm-area');
    expect(slug('SAC-DVATC')).toBe('sac-dvatc');
    expect(slug('11.222.333')).toBe('11-222-333');
  });
});

describe('parseCsv — comillas, comas y saltos dentro de campos', () => {
  it('campos simples', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('coma dentro de comillas', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });
  it('comilla escapada ("")', () => {
    expect(parseCsv('"él dijo ""hola"""')).toEqual([['él dijo "hola"']]);
  });
  it('salto de línea dentro de comillas', () => {
    expect(parseCsv('a,"x\ny",b')).toEqual([['a', 'x\ny', 'b']]);
  });
  it('CRLF se normaliza', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('delimitador tab', () => {
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('rowsToObjects', () => {
  it('usa la 1ª fila como encabezados', () => {
    const objs = rowsToObjects([['DNI', 'Edad'], ['11222333', '56']]);
    expect(objs).toEqual([{ DNI: '11222333', Edad: '56' }]);
  });
  it('rellena columnas faltantes con ""', () => {
    const objs = rowsToObjects([['a', 'b', 'c'], ['1']]);
    expect(objs).toEqual([{ a: '1', b: '', c: '' }]);
  });
  it('sin filas → []', () => expect(rowsToObjects([])).toEqual([]));
});
