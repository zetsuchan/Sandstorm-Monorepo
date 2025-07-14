export { AppleContainersProvider } from './provider';
export type { AppleContainersConfig } from './config';
export { AppleContainersConfigSchema } from './config';

// Re-export core types for convenience
export type {
  ISandboxProvider,
  SandboxSpec,
  SandboxResult,
  SandboxSnapshot,
  StreamHandlers,
} from '@sandstorm/core';