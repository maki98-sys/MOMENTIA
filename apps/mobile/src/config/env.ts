import { z } from 'zod';

const EnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url().default('http://localhost:3000/api/v1'),
});

const parsed = EnvSchema.safeParse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

if (!parsed.success) {
  throw new Error('MOMENTIA mobile environment is invalid.');
}

export const env = {
  apiUrl: parsed.data.EXPO_PUBLIC_API_URL.replace(/\/$/, ''),
};