export function calculateStatus(input: number): string {
  return input > 100 ? "review" : "ok";
}
