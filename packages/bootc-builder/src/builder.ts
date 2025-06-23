import Docker from 'dockerode';
import { createHash } from 'crypto';
import * as tar from 'tar-fs';
import { Readable } from 'stream';
import { BootcImageSpec, BootcBuildResult } from '@sandstorm/core';
import { IBootcBuilder, BuildOptions, BootcManifest } from './types';

export class BootcBuilder implements IBootcBuilder {
  private docker: Docker;
  private imageCache: Map<string, BootcBuildResult>;

  constructor(options: BuildOptions = {}) {
    this.docker = new Docker({
      host: options.dockerHost || process.env.DOCKER_HOST,
    });
    this.imageCache = new Map();
  }

  async buildImage(spec: BootcImageSpec): Promise<BootcBuildResult> {
    const startTime = Date.now();
    
    // Generate a unique hash for this build spec
    const specHash = this.generateSpecHash(spec);
    
    // Check cache first
    if (this.imageCache.has(specHash)) {
      return this.imageCache.get(specHash)!;
    }

    // Create the enhanced Dockerfile for bootc
    const dockerfile = this.createBootcDockerfile(spec);
    
    // Build the container image
    const imageTag = `bootc-${specHash}`;
    const buildResult = await this.buildDockerImage(dockerfile, imageTag, spec);
    
    // Convert to bootc format
    const bootcResult = await this.convertToBootc(imageTag, buildResult);
    
    // Calculate build time
    const buildTime = Date.now() - startTime;
    
    const result: BootcBuildResult = {
      imageHash: specHash,
      imageSize: bootcResult.size,
      ociDigest: bootcResult.digest,
      buildTime,
      layers: bootcResult.layers,
    };
    
    // Cache the result
    this.imageCache.set(specHash, result);
    
    return result;
  }

  async pushImage(imageHash: string, registry: string): Promise<string> {
    const imageTag = `bootc-${imageHash}`;
    const remoteTag = `${registry}/sandstorm/${imageTag}`;
    
    // Tag the image
    const image = this.docker.getImage(imageTag);
    await image.tag({
      repo: `${registry}/sandstorm/${imageTag}`,
      tag: 'latest',
    });
    
    // Push to registry
    const stream = await this.docker.getImage(remoteTag).push();
    
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) reject(err);
        else resolve(remoteTag);
      });
    });
  }

  async getImageInfo(imageHash: string): Promise<BootcBuildResult | null> {
    // Check cache
    if (this.imageCache.has(imageHash)) {
      return this.imageCache.get(imageHash)!;
    }
    
    // Check if image exists locally
    const imageTag = `bootc-${imageHash}`;
    try {
      const image = this.docker.getImage(imageTag);
      const inspect = await image.inspect();
      
      return {
        imageHash,
        imageSize: inspect.Size,
        ociDigest: inspect.Id,
        buildTime: 0, // Not available from inspection
        layers: inspect.RootFS.Layers.map((layer: string) => ({
          digest: layer,
          size: 0, // Size not available in basic inspection
        })),
      };
    } catch (error) {
      return null;
    }
  }

  async cleanupImages(olderThanDays: number): Promise<number> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const images = await this.docker.listImages({
      filters: {
        label: ['sandstorm.type=bootc'],
      },
    });
    
    let deleted = 0;
    for (const image of images) {
      const created = image.Created * 1000; // Convert to milliseconds
      if (created < cutoffTime) {
        try {
          await this.docker.getImage(image.Id).remove();
          deleted++;
        } catch (error) {
          console.error(`Failed to remove image ${image.Id}:`, error);
        }
      }
    }
    
    return deleted;
  }

  private generateSpecHash(spec: BootcImageSpec): string {
    const content = JSON.stringify({
      baseImage: spec.baseImage,
      dockerfile: spec.dockerfile,
      packages: spec.packages?.sort(),
      systemdUnits: spec.systemdUnits?.map(u => ({
        name: u.name,
        content: u.content,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      kernelArgs: spec.kernelArgs?.sort(),
      bootType: spec.bootType,
    });
    
    return createHash('sha256').update(content).digest('hex').substring(0, 12);
  }

  private createBootcDockerfile(spec: BootcImageSpec): string {
    let dockerfile = `FROM ${spec.baseImage}\n\n`;
    
    // Add labels
    dockerfile += 'LABEL sandstorm.type="bootc"\n';
    dockerfile += 'LABEL org.opencontainers.image.source="sandstorm"\n\n';
    
    // Install bootc tooling if not present
    dockerfile += 'RUN dnf -y install bootc || true\n\n';
    
    // Install additional packages
    if (spec.packages && spec.packages.length > 0) {
      dockerfile += `RUN dnf -y install ${spec.packages.join(' ')}\n\n`;
    }
    
    // Add systemd units
    if (spec.systemdUnits) {
      for (const unit of spec.systemdUnits) {
        dockerfile += `RUN echo '${unit.content.replace(/'/g, "\\'")}' > /etc/systemd/system/${unit.name}\n`;
        dockerfile += `RUN systemctl enable ${unit.name}\n\n`;
      }
    }
    
    // Add kernel arguments
    if (spec.kernelArgs && spec.kernelArgs.length > 0) {
      dockerfile += `RUN bootc kargs --append="${spec.kernelArgs.join(' ')}"\n\n`;
    }
    
    // Add user's Dockerfile content
    if (spec.dockerfile) {
      dockerfile += '\n# User-provided Dockerfile content\n';
      dockerfile += spec.dockerfile;
    }
    
    // Ensure bootc compatibility
    dockerfile += '\n\n# Ensure bootc compatibility\n';
    dockerfile += 'RUN bootc status || true\n';
    
    return dockerfile;
  }

  private async buildDockerImage(
    dockerfile: string,
    tag: string,
    spec: BootcImageSpec
  ): Promise<any> {
    // Create a tar stream with the Dockerfile
    const pack = tar.pack('/tmp', {
      entries: ['Dockerfile'],
    });
    
    // Write Dockerfile to the tar stream
    pack.entry({ name: 'Dockerfile' }, dockerfile);
    pack.finalize();
    
    // Build the image
    const stream = await this.docker.buildImage(pack as any, {
      t: tag,
      labels: {
        'sandstorm.type': 'bootc',
        'sandstorm.bootType': spec.bootType,
      },
    });
    
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
  }

  private async convertToBootc(imageTag: string, buildResult: any): Promise<{
    digest: string;
    size: number;
    layers: Array<{ digest: string; size: number }>;
  }> {
    // Get image details
    const image = this.docker.getImage(imageTag);
    const inspect = await image.inspect();
    
    // Extract layer information
    const layers = inspect.RootFS.Layers.map((layer: string, index: number) => ({
      digest: layer,
      size: inspect.Size / inspect.RootFS.Layers.length, // Approximate layer size
    }));
    
    return {
      digest: inspect.Id,
      size: inspect.Size,
      layers,
    };
  }
}