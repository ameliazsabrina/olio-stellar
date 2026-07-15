export function payUrl(origin: string, owner: string, slug: string): string {
  return `${origin}/pay/${owner}/${slug}`;
}

export function legacyPayUrl(
  origin: string,
  owner: string,
  id: string,
): string {
  return `${origin}/pay/${owner}?l=${id}`;
}
