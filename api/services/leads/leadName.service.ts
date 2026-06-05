type LeadNameParts = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export function buildLeadNameFromParts(input: LeadNameParts): string | undefined {
  const parts = [input.first_name, input.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function normalizeLeadName<T extends LeadNameParts>(input: T): T {
  const name = input.name?.trim() || buildLeadNameFromParts(input);
  return (name ? { ...input, name } : input) as T;
}

export function normalizeLeadNameUpdate<T extends LeadNameParts>(
  input: T,
  current: LeadNameParts,
): T {
  if (input.name?.trim()) {
    return { ...input, name: input.name.trim() };
  }
  if (!hasOwnInput(input, "first_name") && !hasOwnInput(input, "last_name")) {
    return input;
  }

  const name = buildLeadNameFromParts({
    first_name: input.first_name ?? current.first_name,
    last_name: input.last_name ?? current.last_name,
  });
  return (name ? { ...input, name } : input) as T;
}

function hasOwnInput<T extends object>(input: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}
