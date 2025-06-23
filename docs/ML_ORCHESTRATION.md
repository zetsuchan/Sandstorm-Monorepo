# AI-Driven Orchestration for Sandstorm

This document provides a comprehensive overview of Sandstorm's machine learning-based orchestration system for optimal sandbox provider selection.

## Overview

Sandstorm's AI-driven orchestration system uses machine learning to intelligently route sandbox workloads to the most suitable providers based on cost, latency, and success rate predictions. The system combines historical telemetry data, real-time metrics, and sophisticated feature engineering to make optimal routing decisions.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client        │───▶│   Arbitrage     │───▶│   ML Router     │
│   Requests      │    │   Engine        │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
                              │                        ▼
                              │                ┌─────────────────┐
                              │                │   LightGBM      │
                              │                │   Models        │
                              │                └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Sandbox       │───▶│   Telemetry     │
                       │   Providers     │    │   Collector     │
                       └─────────────────┘    └─────────────────┘
                                                      │
                                                      ▼
                                               ┌─────────────────┐
                                               │   PostgreSQL    │
                                               │   Database      │
                                               └─────────────────┘
```

## Components

### 1. ML Router (`packages/ml-router`)

The core machine learning engine that provides intelligent routing decisions.

**Key Features:**
- LightGBM-based prediction models for cost, latency, and provider selection
- Real-time feature extraction and prediction
- Model versioning and A/B testing capabilities
- Fallback to rule-based routing for low-confidence predictions

**Technology Stack:**
- TypeScript/Node.js
- LightGBM (via Python integration)
- Redis (for caching)
- Prometheus (for metrics)

### 2. Telemetry Collector (`services/telemetry-collector`)

High-performance Rust service for collecting and serving execution telemetry.

**Key Features:**
- Real-time sandbox execution tracking
- Optimized data storage for ML training
- REST API for data submission and retrieval
- Provider performance statistics

**Technology Stack:**
- Rust
- PostgreSQL
- Axum (web framework)
- Prometheus metrics

### 3. Enhanced Arbitrage Engine (`packages/arbitrage`)

Updated arbitrage engine that integrates ML predictions with traditional rule-based routing.

**Key Features:**
- Three routing strategies: ML, rule-based, and hybrid
- Confidence-based fallback mechanisms
- Provider availability checking
- Dynamic strategy switching

**Technology Stack:**
- TypeScript
- Integration with ML Router
- Core interfaces from @sandstorm/core

## Machine Learning Models

### Model Architecture

Three separate LightGBM models work together to make routing decisions:

1. **Cost Prediction Model**
   - Predicts execution cost for each provider
   - Trained on historical cost data
   - Features: resource requirements, provider characteristics, time factors

2. **Latency Prediction Model**
   - Predicts execution time (log-transformed for better accuracy)
   - Considers provider performance and workload complexity
   - Features: code complexity, resource needs, historical latency

3. **Provider Selection Model**
   - Multi-class classification to recommend optimal provider
   - Combines cost and latency predictions with success rates
   - Features: all above plus provider availability and constraints

### Feature Engineering

The system extracts and engineers 20+ features from sandbox specifications:

**Sandbox Features:**
- Code length and complexity
- Programming language
- Resource requirements (CPU, memory, GPU)
- Dependencies and environment variables
- File counts and sizes

**Temporal Features:**
- Hour of day
- Day of week
- Weekend indicator

**Historical Features:**
- Provider average latency
- Provider average cost
- Provider failure rate
- Provider availability

**Provider Features:**
- One-hot encoded provider selection
- Provider-specific characteristics

### Training Pipeline

```bash
# Automated training with recent data
npm run train -- --days 7 --min-data-points 100

# Production training with more data
npm run train -- --days 30 --min-data-points 1000 --version v2.0.0
```

The training pipeline:
1. Collects recent telemetry data
2. Validates and cleans the dataset
3. Extracts and normalizes features
4. Trains three LightGBM models
5. Evaluates performance on validation data
6. Saves models with versioning
7. Updates model store and metrics

## Routing Strategies

### 1. ML Strategy
Pure machine learning-based routing using trained models.

**Benefits:**
- Optimal cost/latency predictions
- Learns from historical patterns
- Adapts to changing provider performance

**Use Cases:**
- Production environments with sufficient training data
- Workloads with consistent patterns

### 2. Rule-Based Strategy
Traditional logic-based routing using predefined rules.

**Benefits:**
- Predictable behavior
- No training data required
- Fast execution

**Use Cases:**
- Initial deployment without historical data
- Fallback when ML models fail
- Simple workload patterns

### 3. Hybrid Strategy (Recommended)
Combines ML predictions with rule-based fallbacks.

**Benefits:**
- Best of both worlds
- Confidence-based switching
- Graceful degradation

**Algorithm:**
```typescript
if (mlPrediction.confidence >= confidenceThreshold) {
  return mlPrediction;
} else {
  return ruleBasedPrediction;
}
```

## Configuration

### ML Router Configuration

```typescript
const mlRouter = new MLRouter(
  './models',                    // Model storage path
  'http://telemetry:8082',      // Telemetry service URL
  {
    fallbackToRuleBased: true,   // Enable fallback
    cacheTTL: 300000,            // 5 minutes cache
    batchSize: 10,               // Batch processing size
  }
);
```

### Arbitrage Engine Configuration

```typescript
const arbitrageEngine = new ArbitrageEngine({
  mlRouterUrl: 'http://ml-router:8080',
  telemetryUrl: 'http://telemetry:8082',
  modelStorePath: './models',
  defaultStrategy: 'hybrid',     // ML + rule-based
  confidenceThreshold: 0.7,      // 70% confidence threshold
});
```

### Telemetry Collector Configuration

```bash
# Environment variables
DATABASE_URL=postgresql://user:pass@postgres/sandstorm_telemetry
TELEMETRY_PORT=8082
TELEMETRY_MAX_TRAINING_DATA_AGE_DAYS=30
TELEMETRY_METRICS_RETENTION_DAYS=90
```

## Performance Metrics

### Model Accuracy (Typical Values)

- **Provider Selection Accuracy**: 85-92%
- **Cost Prediction MAPE**: 15-25%
- **Latency Prediction MAPE**: 20-30%
- **Model Confidence**: 0.6-0.9 (avg 0.75)

### System Performance

- **Prediction Latency**: < 50ms (p99)
- **Throughput**: 1000+ predictions/second
- **Cache Hit Rate**: 80-90%
- **Model Loading Time**: < 2 seconds

### Telemetry Collector Performance

- **Request Throughput**: 10,000+ req/second
- **Database Write Latency**: < 5ms (p95)
- **Data Retention**: 30-90 days configurable
- **Storage Efficiency**: 80% compression ratio

## Monitoring and Observability

### Key Metrics

**ML Router Metrics:**
```
ml_predictions_total{model_version="v1.2.0", provider="e2b"}
ml_prediction_confidence_histogram{model_version="v1.2.0"}
ml_prediction_latency_histogram
ml_model_accuracy{model_version="v1.2.0"}
```

**Telemetry Metrics:**
```
sandbox_runs_total{provider="e2b", language="python", success="true"}
sandbox_run_duration_histogram{provider="e2b", language="python"}
sandbox_run_cost_histogram{provider="e2b"}
prediction_error_percentage{model_version="v1.2.0", metric_type="cost"}
```

### Dashboards

**Grafana Dashboard Components:**
1. Prediction accuracy trends
2. Provider performance comparison
3. Cost optimization metrics
4. System health and performance
5. Training data quality metrics

### Alerting Rules

```yaml
# Model accuracy degradation
- alert: MLModelAccuracyDegraded
  expr: ml_model_accuracy < 0.8
  for: 5m
  annotations:
    summary: "ML model accuracy below threshold"

# High prediction latency
- alert: HighPredictionLatency
  expr: histogram_quantile(0.95, ml_prediction_latency_histogram) > 100
  for: 2m
  annotations:
    summary: "ML prediction latency is high"
```

## A/B Testing

### Configuration

```typescript
await mlRouter.configureABTest({
  enabled: true,
  controlModelVersion: 'v1.0.0',
  treatmentModelVersion: 'v1.1.0',
  trafficSplit: 0.2,              // 20% to treatment
  startTime: new Date().toISOString(),
  endTime: /* 7 days later */
});
```

### Evaluation Metrics

- **Cost reduction**: Compare actual costs between control/treatment
- **Latency improvement**: Compare execution times
- **Success rate**: Compare failure rates
- **Provider distribution**: Analyze routing decisions

## Deployment Guide

### Development Environment

```bash
# 1. Start telemetry collector
cd services/telemetry-collector
cargo run

# 2. Initialize ML router
cd packages/ml-router
npm install
npm run build

# 3. Train initial model (with mock data)
npm run train -- --days 1 --min-data-points 10

# 4. Start application with ML routing
npm start
```

### Production Deployment

```yaml
# docker-compose.yml
version: '3.8'
services:
  telemetry-collector:
    image: sandstorm-telemetry:latest
    environment:
      - DATABASE_URL=${DATABASE_URL}
    ports:
      - "8082:8082"
  
  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=sandstorm_telemetry
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### Model Training Schedule

```yaml
# Kubernetes CronJob for model training
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ml-model-training
spec:
  schedule: "0 2 * * 0"  # Weekly at 2 AM Sunday
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: trainer
            image: sandstorm-ml-trainer:latest
            command:
            - npm
            - run
            - train
            - --
            - --days
            - "7"
            - --min-data-points
            - "1000"
          restartPolicy: OnFailure
```

## Best Practices

### Model Management

1. **Regular Retraining**: Train models weekly with fresh data
2. **Version Control**: Use semantic versioning for models
3. **A/B Testing**: Test new models before full deployment
4. **Monitoring**: Track model performance in real-time
5. **Rollback Strategy**: Keep previous model versions for quick rollback

### Data Quality

1. **Validation**: Implement strict data validation rules
2. **Anomaly Detection**: Monitor for unusual patterns
3. **Data Retention**: Balance storage costs with training needs
4. **Privacy**: Ensure no sensitive data in features
5. **Bias Prevention**: Monitor for provider bias in training data

### System Reliability

1. **Fallback Strategy**: Always have rule-based fallback
2. **Circuit Breakers**: Implement circuit breakers for ML calls
3. **Caching**: Cache predictions and features aggressively
4. **Health Checks**: Comprehensive health monitoring
5. **Graceful Degradation**: Handle partial system failures

## Troubleshooting

### Common Issues

**Low Model Accuracy**
- Check training data quality and quantity
- Verify feature engineering is working correctly
- Consider retraining with more recent data
- Review provider performance changes

**High Prediction Latency**
- Check ML router response times
- Verify cache hit rates
- Monitor telemetry service performance
- Consider batch prediction optimization

**Training Failures**
- Verify telemetry data availability
- Check minimum data thresholds
- Review data validation errors
- Ensure Python dependencies are installed

### Debug Commands

```bash
# Check model metrics
curl http://ml-router:8080/api/metrics

# Verify telemetry data
curl "http://telemetry:8082/api/telemetry/training-data?start=2023-12-01T00:00:00Z&limit=10"

# Test prediction
curl -X POST http://ml-router:8080/api/predict \
  -H "Content-Type: application/json" \
  -d '{"spec": {...}, "constraints": {...}}'
```

## Future Enhancements

### Short Term (3-6 months)
- Advanced feature engineering (NLP for code analysis)
- Real-time model updates without restart
- Multi-objective optimization (cost + latency + carbon footprint)
- Enhanced A/B testing framework

### Long Term (6-12 months)
- Deep learning models for complex workloads
- Reinforcement learning for dynamic optimization
- Cross-cloud provider integration
- Automated hyperparameter tuning

## Contributing

1. **Code Guidelines**: Follow TypeScript/Rust best practices
2. **Testing**: Add comprehensive tests for new features
3. **Documentation**: Update docs for API changes
4. **Performance**: Profile new features for performance impact
5. **ML Ethics**: Consider fairness and bias in model changes

## License

MIT License - see LICENSE file for details.