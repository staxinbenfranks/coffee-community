export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const PLACEHOLDER_USERNAME_RE = /^user_[0-9a-f]{8}$/;

export function isPlaceholderUsername(username: string): boolean {
  return PLACEHOLDER_USERNAME_RE.test(username.trim().toLowerCase());
}

/** Shared by the welcome step and profile save. Placeholder names are rejected. */
export function normalizeUsername(raw: string): { username: string } | { error: string } {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return { error: "Username: 3–20 letters, numbers or underscores." };
  if (isPlaceholderUsername(username)) return { error: "That looks like a temporary username. Pick one of your own." };
  return { username };
}
