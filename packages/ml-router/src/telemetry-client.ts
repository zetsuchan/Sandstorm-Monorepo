import axios, { AxiosInstance } from 'axios';
import { TrainingDataPoint } from './types';
import { SandboxResult } from '@sandstorm/core';

export class TelemetryClient {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getRecentData(
    startDate: Date,
    limit: number = 1000
  ): Promise<TrainingDataPoint[]> {
    try {
      const response = await this.client.get('/api/telemetry/training-data', {
        params: {
          start: startDate.toISOString(),
          limit,
        },
      });
      
      return response.data.map((item: any) => ({
        features: item.features,
        actualCost: item.actualCost,
        actualLatency: item.actualLatency,
        success: item.success,
        timestamp: item.timestamp,
      }));
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
      return [];
    }
  }

  async getProviderStats(
    provider: string,
    timeRange: { start: Date; end: Date }
  ): Promise<{
    avgLatency: number;
    avgCost: number;
    successRate: number;
    totalRuns: number;
  }> {
    try {
      const response = await this.client.get(`/api/telemetry/provider-stats/${provider}`, {
        params: {
          start: timeRange.start.toISOString(),
          end: timeRange.end.toISOString(),
        },
      });
      
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch stats for provider ${provider}:`, error);
      return {
        avgLatency: 0,
        avgCost: 0,
        successRate: 0,
        totalRuns: 0,
      };
    }
  }

  async trackPrediction(
    prediction: {
      provider: string;
      predictedCost: number;
      predictedLatency: number;
      confidence: number;
      modelVersion: string;
    },
    actual?: {
      cost: number;
      latency: number;
      success: boolean;
    }
  ): Promise<void> {
    try {
      await this.client.post('/api/telemetry/predictions', {
        prediction,
        actual,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to track prediction:', error);
    }
  }

  async getModelPerformance(
    modelVersion: string,
    timeRange: { start: Date; end: Date }
  ): Promise<{
    totalPredictions: number;
    avgCostError: number;
    avgLatencyError: number;
    providerAccuracy: number;
  }> {
    try {
      const response = await this.client.get(`/api/telemetry/model-performance/${modelVersion}`, {
        params: {
          start: timeRange.start.toISOString(),
          end: timeRange.end.toISOString(),
        },
      });
      
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch performance for model ${modelVersion}:`, error);
      return {
        totalPredictions: 0,
        avgCostError: 0,
        avgLatencyError: 0,
        providerAccuracy: 0,
      };
    }
  }

  async submitTrainingData(result: SandboxResult, features: any): Promise<void> {
    try {
      await this.client.post('/api/telemetry/training-data', {
        sandboxResult: result,
        features,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to submit training data:', error);
    }
  }
}