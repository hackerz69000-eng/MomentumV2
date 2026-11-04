/** Stable source fingerprint shared by initial and lecture-specific generation. */
export async function studySourceVersion(set: {
  name: string;
  subject: string | null;
  material_text: string;
  custom_instructions?: string | null;
}): Promise<string> {
  const value = JSON.stringify({
    name: set.name,
    subject: set.subject ?? "",
    material: set.material_text,
    instructions: set.custom_instructions ?? "",
    promptVersion: 2,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
