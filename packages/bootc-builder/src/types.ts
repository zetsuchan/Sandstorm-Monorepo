import { BootcImageSpec, BootcBuildResult } from '@sandstorm/core';

export interface IBootcBuilder {
  buildImage(spec: BootcImageSpec): Promise<BootcBuildResult>;
  pushImage(imageHash: string, registry: string): Promise<string>;
  getImageInfo(imageHash: string): Promise<BootcBuildResult | null>;
  cleanupImages(olderThanDays: number): Promise<number>;
}

export interface BuildOptions {
  dockerHost?: string;
  buildArgs?: Record<string, string>;
  labels?: Record<string, string>;
  cacheBust?: boolean;
  platform?: string;
}

export interface BootcManifest {
  version: string;
  baseImage: string;
  layers: Array<{
    digest: string;
    size: number;
    mediaType: string;
  }>;
  config: {
    digest: string;
    size: number;
  };
  annotations?: Record<string, string>;
}