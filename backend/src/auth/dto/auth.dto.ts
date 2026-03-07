import { z } from 'zod';

// ── Login ─────────────────────────────────────────────────────────────────────
export const LoginSchema = z.object({
  username: z.string().min(1).max(60).trim(),
  password: z.string().min(1).max(128),
});
export type LoginDto = z.infer<typeof LoginSchema>;

// ── Token Response ─────────────────────────────────────────────────────────────
export interface TokenResponseDto {
  accessToken: string;
  user: {
    id: string;
    username: string;
    roleName: string;
    roleDisplayName: string;
    houseId: string | null;
    permissions: string[];
  };
}
