export function payUrl(origin: string, owner: string, id: string): string {
  return `${origin}/pay/${owner}?l=${id}`;
}
