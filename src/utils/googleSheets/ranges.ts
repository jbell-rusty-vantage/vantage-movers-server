export function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function extractRowNumberFromRange(range?: string | null): number | undefined {
  if (!range) {
    return undefined;
  }

  const match = range.match(/![A-Z]+(\d+)(?::[A-Z]+\d+)?$/);
  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[1], 10);
}
