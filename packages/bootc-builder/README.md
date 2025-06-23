# @sandstorm/bootc-builder

Bootable container builder for Sandstorm. This package provides functionality to convert OCI images to bootc format for bare-metal provisioning.

## Installation

```bash
pnpm add @sandstorm/bootc-builder
```

## Usage

```typescript
import { BootcBuilder, BootcImageSpec } from '@sandstorm/bootc-builder';

const builder = new BootcBuilder();

const spec: BootcImageSpec = {
  baseImage: 'quay.io/fedora/fedora-bootc:40',
  dockerfile: 'RUN dnf install -y python3',
  packages: ['git', 'vim'],
  bootType: 'efi'
};

const result = await builder.buildImage(spec);
console.log('Built image:', result.imageHash);

// Push to registry
await builder.pushImage(result.imageHash, 'registry.example.com');
```

## API Reference

### BootcBuilder

#### `buildImage(spec: BootcImageSpec): Promise<BootcBuildResult>`

Builds a bootc image from the provided specification.

#### `pushImage(imageHash: string, registry: string): Promise<string>`

Pushes a built image to a container registry.

#### `getImageInfo(imageHash: string): Promise<BootcBuildResult | null>`

Retrieves information about a previously built image.

#### `cleanupImages(olderThanDays: number): Promise<number>`

Removes old bootc images from the local cache.