// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Utilidades compartidas del motor de scores.
 */

/** Proporción (0..1) → porcentaje con 1 decimal. */
export function pct(proportion: number): number {
  return Math.round(proportion * 1000) / 10;
}
