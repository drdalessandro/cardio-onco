// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * EPA Bienestar IA — Cardio-Oncología Marie Curie
 * Migrador Cardiotox → FHIR: capa de parseo de valores + CSV.
 *
 * Módulo puro (sin FHIR ni Medplum) → testeable de forma aislada.
 *
 * Maneja los 5 "tipos de vacío" de la planilla:
 *   ""            → unknown  (desconocido)
 *   "No corresponde" → na    (no aplica)
 *   "No realizado"   → not-done (estudio no hecho)
 *   "No"          → booleano falso
 *   "Sí"          → booleano verdadero
 */

/** Clasificación del contenido de una celda. */
export type CellKind = 'value' | 'unknown' | 'na' | 'not-done';

/** Distingue el "tipo de vacío" para no colapsarlos a un solo null en FHIR. */
export function cellKind(v: string | undefined): CellKind {
  const t = (v ?? '').trim().toLowerCase();
  if (t === '') return 'unknown';
  if (t === 'no corresponde') return 'na';
  if (t === 'no realizado') return 'not-done';
  return 'value';
}

/** `true` sólo si la celda dice "Sí" (cualquier variante); el resto → `false`. */
export function isYes(v: string | undefined): boolean {
  return /^s[ií]$/i.test((v ?? '').trim());
}

/** Número; acepta coma o punto decimal. Vacío / n-a / no-realizado → `undefined`. */
export function num(v: string | undefined): number | undefined {
  if (cellKind(v) !== 'value') return undefined;
  const t = (v ?? '').trim().replace(',', '.'); // los datos usan punto decimal (1.57)
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Texto limpio; vacío / n-a / no-realizado → `undefined`. */
export function text(v: string | undefined): string | undefined {
  if (cellKind(v) !== 'value') return undefined;
  return (v ?? '').trim();
}

/**
 * Normaliza un DNI a dígitos.
 *
 * Las planillas guardan el DNI como **número**, así que los exports suelen
 * traerlo como `10547059.0` (o con puntos de miles). El DNI es la clave de join
 * y la base de los identifiers, de modo que un sufijo `.0` generaría un paciente
 * distinto: hay que normalizarlo antes de usarlo.
 *
 * Devuelve `undefined` si no queda ningún dígito (celda vacía, o una fila de
 * encabezado repetida en el medio de los datos, donde la celda dice "DNI").
 */
export function dniValue(v: string | undefined): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  const digits = t.replace(/\.0+$/, '').replace(/\D/g, '');
  return digits || undefined;
}

/**
 * Fecha parcial → ISO 8601. Acepta ISO, `M/AA`, `M/AAAA`, `DD/MM/AAAA`.
 * `3/26` → `2026-03` (año-mes). Si no se puede parsear, devuelve `undefined`
 * (mejor sin fecha que una fecha inventada).
 */
export function partialDate(v: string | undefined): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(t)) return t; // ya ISO
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    const yy = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
    return `${yy}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const my = t.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (my) {
    const yy = my[2].length === 2 ? '20' + my[2] : my[2];
    return `${yy}-${my[1].padStart(2, '0')}`;
  }
  return undefined;
}

/**
 * `birthDate` aproximado a partir de la edad (año = año de referencia − edad).
 * Es una aproximación de migración (la planilla no guarda fecha de nacimiento).
 */
export function birthDateFromAge(age: number | undefined, ref = new Date()): string | undefined {
  if (age === undefined || !Number.isFinite(age)) return undefined;
  return `${ref.getFullYear() - Math.trunc(age)}-01-01`;
}

/** Slug estable (para identifiers idempotentes). */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacriticos combinantes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parser CSV (RFC 4180-ish): comillas, comillas escapadas (`""`), comas y saltos
 * de línea dentro de campos entrecomillados. Delimitador configurable (`,` o tab).
 * @returns Matriz de filas × campos.
 */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    started = true;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignorar CR (CRLF)
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (started && (field !== '' || row.length > 0)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Convierte filas CSV en objetos usando la 1ª fila como encabezados (trim). */
export function rowsToObjects(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? '';
    });
    return obj;
  });
}
