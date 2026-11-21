// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Zahlen- und Datumsformat der gewählten Oberflächensprache (setzt src/ui/i18n.ts).

let current = "de-DE";
export const loc = () => current;
export function setLocale(l: string) {
  current = l;
}

/** Zahl mit fester Nachkommastellenzahl im Format der Oberflächensprache (ohne Tausenderpunkte). */
export const fixed = (x: number, d: number) => x.toLocaleString(current, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
