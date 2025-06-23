import * as fs from 'fs/promises';
import * as path from 'path';
import { ModelMetrics } from './types';

export class ModelStore {
  private basePath: string;
  private metadataPath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.metadataPath = path.join(basePath, 'metadata');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.mkdir(this.metadataPath, { recursive: true });
  }

  async saveModel(version: string, modelPath: string): Promise<void> {
    const targetPath = path.join(this.basePath, version);
    await fs.mkdir(targetPath, { recursive: true });
    
    // Copy model files
    const files = await fs.readdir(modelPath);
    for (const file of files) {
      if (file.includes(version)) {
        await fs.copyFile(
          path.join(modelPath, file),
          path.join(targetPath, file)
        );
      }
    }
  }

  async exists(version: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.basePath, version));
      return true;
    } catch {
      return false;
    }
  }

  async getModelPath(version: string): Promise<string> {
    const modelPath = path.join(this.basePath, version);
    await fs.access(modelPath);
    return modelPath;
  }

  async getMetrics(version: string): Promise<ModelMetrics> {
    const metricsPath = path.join(this.basePath, version, `metadata_${version}.json`);
    const data = await fs.readFile(metricsPath, 'utf-8');
    const metadata = JSON.parse(data);
    
    return {
      version: metadata.version,
      trainedAt: metadata.trainedAt,
      accuracy: metadata.metrics.providerAccuracy,
      costMSE: metadata.metrics.costMSE,
      latencyMSE: metadata.metrics.latencyMSE,
      providerAccuracy: metadata.metrics.providerAccuracy,
      featureImportance: metadata.featureImportance,
      trainingDataSize: metadata.metrics.trainingDataSize,
      validationDataSize: metadata.metrics.validationDataSize,
    };
  }

  async listVersions(): Promise<string[]> {
    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && entry.name !== 'metadata')
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a)); // Sort descending
  }

  async getLatestVersion(): Promise<string | null> {
    const versions = await this.listVersions();
    return versions.length > 0 ? versions[0] : null;
  }

  async setActiveVersion(version: string): Promise<void> {
    const activeFilePath = path.join(this.metadataPath, 'active_version.json');
    await fs.writeFile(
      activeFilePath,
      JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2)
    );
  }

  async getActiveVersion(): Promise<string | null> {
    try {
      const activeFilePath = path.join(this.metadataPath, 'active_version.json');
      const data = await fs.readFile(activeFilePath, 'utf-8');
      const { version } = JSON.parse(data);
      return version;
    } catch {
      return null;
    }
  }

  async deleteVersion(version: string): Promise<void> {
    const versionPath = path.join(this.basePath, version);
    await fs.rm(versionPath, { recursive: true });
  }

  async pruneOldVersions(keepCount: number = 5): Promise<void> {
    const versions = await this.listVersions();
    const activeVersion = await this.getActiveVersion();
    
    if (versions.length <= keepCount) {
      return;
    }

    // Keep the active version and the most recent ones
    const versionsToKeep = new Set<string>();
    if (activeVersion) {
      versionsToKeep.add(activeVersion);
    }
    
    for (let i = 0; i < keepCount && i < versions.length; i++) {
      versionsToKeep.add(versions[i]);
    }

    // Delete old versions
    for (const version of versions) {
      if (!versionsToKeep.has(version)) {
        await this.deleteVersion(version);
      }
    }
  }
}