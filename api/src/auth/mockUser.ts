export function isMockUserId(userId: string): boolean {
  return /^mock_user_\d{3}$/i.test(userId);
}