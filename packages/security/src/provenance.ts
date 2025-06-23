import { createHash, createSign, createVerify, generateKeyPairSync } from 'crypto';
import axios from 'axios';
import pino from 'pino';
import { SandboxResult } from '@sandstorm/core';
import { IProvenanceService } from './interfaces';
import { SignedProvenance, SecurityEvent } from './types';

export class ProvenanceService implements IProvenanceService {
  private logger = pino({ name: 'provenance-service' });
  private keyPair: { publicKey: string; privateKey: string };
  private provenanceStore = new Map<string, SignedProvenance>();

  constructor() {
    // Generate key pair for signing
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    this.keyPair = { publicKey, privateKey };
  }

  async createProvenance(
    result: SandboxResult,
    events: SecurityEvent[]
  ): Promise<SignedProvenance> {
    // Calculate result hash
    const resultHash = this.hashResult(result);
    
    // Create provenance object
    const provenance: SignedProvenance = {
      sandboxId: result.id,
      resultHash,
      timestamp: new Date().toISOString(),
      provider: result.provider,
      securityEvents: events.map(e => e.id),
      signature: '', // Will be filled below
      publicKey: this.keyPair.publicKey,
    };

    // Sign the provenance
    const dataToSign = this.getSigningData(provenance);
    const sign = createSign('RSA-SHA256');
    sign.write(dataToSign);
    sign.end();
    provenance.signature = sign.sign(this.keyPair.privateKey, 'hex');

    // Store provenance
    this.provenanceStore.set(result.id, provenance);

    this.logger.info({
      sandboxId: result.id,
      resultHash,
      eventCount: events.length,
    }, 'Created signed provenance');

    return provenance;
  }

  async verifyProvenance(provenance: SignedProvenance): Promise<boolean> {
    try {
      const dataToVerify = this.getSigningData(provenance);
      const verify = createVerify('RSA-SHA256');
      verify.write(dataToVerify);
      verify.end();

      const isValid = verify.verify(
        provenance.publicKey,
        provenance.signature,
        'hex'
      );

      this.logger.info({
        sandboxId: provenance.sandboxId,
        isValid,
      }, 'Verified provenance signature');

      return isValid;
    } catch (error) {
      this.logger.error({
        error,
        sandboxId: provenance.sandboxId,
      }, 'Failed to verify provenance');
      return false;
    }
  }

  async anchorOnChain(
    provenance: SignedProvenance,
    chainId: string
  ): Promise<{ txHash: string; blockNumber: number }> {
    try {
      // Create anchor data
      const anchorData = {
        sandboxId: provenance.sandboxId,
        resultHash: provenance.resultHash,
        timestamp: provenance.timestamp,
        signature: provenance.signature,
      };

      // In production, this would interact with a real blockchain
      // For now, we'll simulate with a mock endpoint
      const response = await this.submitToChain(chainId, anchorData);

      // Update provenance with chain anchor
      provenance.chainAnchor = {
        txHash: response.txHash,
        blockNumber: response.blockNumber,
        chain: chainId,
      };

      this.logger.info({
        sandboxId: provenance.sandboxId,
        txHash: response.txHash,
        blockNumber: response.blockNumber,
        chain: chainId,
      }, 'Anchored provenance on chain');

      return response;
    } catch (error) {
      this.logger.error({
        error,
        sandboxId: provenance.sandboxId,
        chainId,
      }, 'Failed to anchor provenance on chain');
      throw error;
    }
  }

  async getProvenance(sandboxId: string): Promise<SignedProvenance | null> {
    return this.provenanceStore.get(sandboxId) || null;
  }

  private hashResult(result: SandboxResult): string {
    const hash = createHash('sha256');
    
    // Include key result fields in hash
    hash.update(result.id);
    hash.update(result.provider);
    hash.update(result.stdout);
    hash.update(result.stderr);
    hash.update(result.exitCode.toString());
    hash.update(result.duration.toString());
    
    // Include files if present
    if (result.files) {
      const sortedFiles = Object.entries(result.files).sort(([a], [b]) => a.localeCompare(b));
      for (const [path, content] of sortedFiles) {
        hash.update(path);
        hash.update(content);
      }
    }

    return hash.digest('hex');
  }

  private getSigningData(provenance: SignedProvenance): string {
    // Create deterministic string for signing
    const data = {
      sandboxId: provenance.sandboxId,
      resultHash: provenance.resultHash,
      timestamp: provenance.timestamp,
      provider: provenance.provider,
      securityEvents: provenance.securityEvents.sort(),
    };

    return JSON.stringify(data, Object.keys(data).sort());
  }

  private async submitToChain(chainId: string, data: any): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    // Chain-specific implementations
    switch (chainId) {
      case 'ethereum':
        return this.submitToEthereum(data);
      case 'polygon':
        return this.submitToPolygon(data);
      case 'arbitrum':
        return this.submitToArbitrum(data);
      default:
        // Mock implementation for development
        return {
          txHash: `0x${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`,
          blockNumber: Math.floor(Date.now() / 1000),
        };
    }
  }

  private async submitToEthereum(data: any): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    // In production, this would use ethers.js or web3.js
    // to interact with an Ethereum smart contract
    
    // Mock implementation
    const mockTxHash = `0x${createHash('sha256')
      .update('ethereum' + JSON.stringify(data))
      .digest('hex')}`;
    
    return {
      txHash: mockTxHash,
      blockNumber: 18500000 + Math.floor(Math.random() * 1000),
    };
  }

  private async submitToPolygon(data: any): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    // Mock implementation for Polygon
    const mockTxHash = `0x${createHash('sha256')
      .update('polygon' + JSON.stringify(data))
      .digest('hex')}`;
    
    return {
      txHash: mockTxHash,
      blockNumber: 50000000 + Math.floor(Math.random() * 1000),
    };
  }

  private async submitToArbitrum(data: any): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    // Mock implementation for Arbitrum
    const mockTxHash = `0x${createHash('sha256')
      .update('arbitrum' + JSON.stringify(data))
      .digest('hex')}`;
    
    return {
      txHash: mockTxHash,
      blockNumber: 150000000 + Math.floor(Math.random() * 1000),
    };
  }
}