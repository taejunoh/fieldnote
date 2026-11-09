export function validateNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < 12) return "비밀번호는 12자 이상이어야 합니다.";
  if (password !== confirmation) return "비밀번호가 일치하지 않습니다.";
  return null;
}
