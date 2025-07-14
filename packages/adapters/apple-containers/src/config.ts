import { z } from 'zod';

export const AppleContainersConfigSchema = z.object({
  defaultTimeout: z.number().min(1000).default(30000),
  maxMemoryGB: z.number().min(0.5).max(32).default(4),
  maxCpuCores: z.number().min(1).max(16).default(4),
  enableRosetta: z.boolean().default(true),
  customKernel: z.string().optional(),
  registryAuth: z.array(z.object({
    registry: z.string(),
    username: z.string(),
    password: z.string(),
  })).optional(),
  containerPath: z.string().default('container'),
});

export type AppleContainersConfig = z.infer<typeof AppleContainersConfigSchema>;