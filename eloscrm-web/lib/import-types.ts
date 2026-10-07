export type ImportedRecipient = { phone: string; name: string };
export type ImportedAudience = { recipients: ImportedRecipient[]; consent: { confirmed: true; evidence: string } };
export type ImportPreview = { rows: { row: number; phone: string; normalizedPhone: string | null; name: string; error: string | null }[]; valid: number; invalid: number; limit: number };
