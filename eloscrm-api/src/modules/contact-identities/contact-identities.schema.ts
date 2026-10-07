import * as z from "zod";

export const resolveIdentitySchema = z.strictObject({
  connectionId: z.string().min(1).max(128),
  kind: z.enum(["phone", "wa_id", "bsuid", "parent_bsuid", "jid", "lid"]),
  value: z.string().trim().min(1).max(256).refine(value => Array.from(value).every(character => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }), "A identidade contém caracteres inválidos"),
  displayName: z.string().trim().min(1).max(200).optional(),
});

export type ResolveIdentityInput = z.infer<typeof resolveIdentitySchema>;
