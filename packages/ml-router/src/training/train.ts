#!/usr/bin/env node

import { TelemetryClient } from '../telemetry-client';
import { ModelStore } from '../model-store';
import { FeatureExtractor } from '../feature-extractor';
import { LightGBMModel } from '../model/lightgbm-model';
import { TrainingDataPoint } from '../types';
import { SandboxProvider } from '@sandstorm/core';
import * as path from 'path';
import * as fs from 'fs/promises';
import { parseArgs } from 'util';

interface TrainingOptions {
  telemetryUrl: string;
  modelStorePath: string;
  daysOfData: number;
  minDataPoints: number;
  outputVersion?: string;
}

async function collectTrainingData(
  telemetryClient: TelemetryClient,
  daysOfData: number
): Promise<TrainingDataPoint[]> {
  console.log(`Collecting training data from last ${daysOfData} days...`);
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysOfData);
  
  const rawData = await telemetryClient.getRecentData(startDate, 10000);
  
  console.log(`Collected ${rawData.length} data points`);
  return rawData;
}

async function validateData(data: TrainingDataPoint[]): TrainingDataPoint[] {
  // Filter out invalid data points
  const validData = data.filter(point => {
    // Ensure all required fields are present
    if (!point.features || !point.actualCost || !point.actualLatency) {
      return false;
    }
    
    // Ensure reasonable values
    if (point.actualCost < 0 || point.actualCost > 100) {
      return false;
    }
    
    if (point.actualLatency < 0 || point.actualLatency > 3600000) { // Max 1 hour
      return false;
    }
    
    return true;
  });
  
  console.log(`Validated ${validData.length} out of ${data.length} data points`);
  return validData;
}

async function analyzeDataDistribution(data: TrainingDataPoint[]): void {
  // Count by provider
  const providerCounts: Record<string, number> = {};
  const successRates: Record<string, { success: number; total: number }> = {};
  
  for (const point of data) {
    // Find which provider was used
    let provider: string | null = null;
    const features = point.features as any;
    
    for (const key of Object.keys(features)) {
      if (key.startsWith('provider') && features[key] === 1) {
        provider = key.replace('provider', '').toLowerCase();
        break;
      }
    }
    
    if (provider) {
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
      
      if (!successRates[provider]) {
        successRates[provider] = { success: 0, total: 0 };
      }
      successRates[provider].total++;
      if (point.success) {
        successRates[provider].success++;
      }
    }
  }
  
  console.log('\nData distribution by provider:');
  for (const [provider, count] of Object.entries(providerCounts)) {
    const rate = successRates[provider];
    const successRate = (rate.success / rate.total * 100).toFixed(2);
    console.log(`  ${provider}: ${count} runs (${successRate}% success rate)`);
  }
  
  // Analyze cost and latency distributions
  const costs = data.map(d => d.actualCost);
  const latencies = data.map(d => d.actualLatency);
  
  console.log('\nCost statistics:');
  console.log(`  Min: $${Math.min(...costs).toFixed(6)}`);
  console.log(`  Max: $${Math.max(...costs).toFixed(6)}`);
  console.log(`  Avg: $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6)}`);
  
  console.log('\nLatency statistics:');
  console.log(`  Min: ${Math.min(...latencies).toFixed(0)}ms`);
  console.log(`  Max: ${Math.max(...latencies).toFixed(0)}ms`);
  console.log(`  Avg: ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)}ms`);
}

async function train(options: TrainingOptions): Promise<void> {
  console.log('Starting ML model training...\n');
  
  // Initialize clients
  const telemetryClient = new TelemetryClient(options.telemetryUrl);
  const modelStore = new ModelStore(options.modelStorePath);
  await modelStore.initialize();
  
  // Collect training data
  const rawData = await collectTrainingData(telemetryClient, options.daysOfData);
  
  if (rawData.length < options.minDataPoints) {
    console.error(`Insufficient data: ${rawData.length} points found, ${options.minDataPoints} required`);
    process.exit(1);
  }
  
  // Validate and clean data
  const trainingData = await validateData(rawData);
  
  if (trainingData.length < options.minDataPoints) {
    console.error(`Insufficient valid data: ${trainingData.length} points, ${options.minDataPoints} required`);
    process.exit(1);
  }
  
  // Analyze data distribution
  await analyzeDataDistribution(trainingData);
  
  // Generate version if not provided
  const version = options.outputVersion || `v${Date.now()}`;
  console.log(`\nTraining model version: ${version}`);
  
  // Create temporary directory for model
  const tempModelPath = path.join(options.modelStorePath, 'temp', version);
  await fs.mkdir(tempModelPath, { recursive: true });
  
  // Initialize and train model
  const model = new LightGBMModel(tempModelPath, version);
  
  console.log('\nTraining LightGBM models...');
  await model.train(trainingData);
  
  // Save model to store
  console.log('\nSaving model to store...');
  await modelStore.saveModel(version, tempModelPath);
  
  // Set as active model
  await modelStore.setActiveVersion(version);
  
  // Clean up temporary directory
  await fs.rm(path.join(options.modelStorePath, 'temp'), { recursive: true, force: true });
  
  // Get and display metrics
  const metrics = await modelStore.getMetrics(version);
  console.log('\nTraining completed successfully!');
  console.log('\nModel metrics:');
  console.log(`  Version: ${metrics.version}`);
  console.log(`  Provider Accuracy: ${(metrics.accuracy * 100).toFixed(2)}%`);
  console.log(`  Cost MSE: ${metrics.costMSE.toFixed(6)}`);
  console.log(`  Latency MSE: ${metrics.latencyMSE.toFixed(2)}`);
  console.log(`  Training samples: ${metrics.trainingDataSize}`);
  console.log(`  Validation samples: ${metrics.validationDataSize}`);
  
  // Show top feature importances
  console.log('\nTop 5 most important features:');
  const sortedFeatures = Object.entries(metrics.featureImportance)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  
  for (const [feature, importance] of sortedFeatures) {
    console.log(`  ${feature}: ${(importance * 100).toFixed(2)}%`);
  }
  
  // Prune old models (keep last 5)
  console.log('\nPruning old models...');
  await modelStore.pruneOldVersions(5);
  
  console.log('\nTraining pipeline completed!');
}

// Parse command line arguments
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'telemetry-url': {
      type: 'string',
      default: 'http://localhost:8082',
    },
    'model-store': {
      type: 'string',
      default: './models',
    },
    'days': {
      type: 'string',
      default: '7',
    },
    'min-data-points': {
      type: 'string',
      default: '100',
    },
    'version': {
      type: 'string',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
});

if (values.help) {
  console.log(`
ML Router Training Script

Usage: npm run train -- [options]

Options:
  --telemetry-url <url>     Telemetry service URL (default: http://localhost:8082)
  --model-store <path>      Path to model storage directory (default: ./models)
  --days <number>           Days of historical data to use (default: 7)
  --min-data-points <num>   Minimum data points required (default: 100)
  --version <string>        Model version name (default: auto-generated)
  -h, --help               Show this help message
`);
  process.exit(0);
}

// Run training
train({
  telemetryUrl: values['telemetry-url'] as string,
  modelStorePath: values['model-store'] as string,
  daysOfData: parseInt(values.days as string),
  minDataPoints: parseInt(values['min-data-points'] as string),
  outputVersion: values.version as string | undefined,
}).catch(error => {
  console.error('Training failed:', error);
  process.exit(1);
});