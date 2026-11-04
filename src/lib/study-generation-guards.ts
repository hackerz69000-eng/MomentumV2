export function assertGenerationSourceRevision(expected: string, current: string): void {
  if (!expected || expected !== current) {
    throw new Error("Study material changed while Momentum was generating. The outdated result was not saved. Retry generation to use the latest material.");
  }
}

export function assertGenerationClaimed(claimed: boolean | null, error: { message?: string } | null): void {
  if (error) throw new Error(error.message || "Couldn't claim this study set for generation.");
  if (claimed !== true) {
    throw new Error("This study set is already generating in another tab or device. Wait for it to finish, or retry after its short lease expires.");
  }
}
