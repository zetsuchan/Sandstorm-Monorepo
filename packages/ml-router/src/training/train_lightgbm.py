#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2025 Sandstorm Contributors

"""
LightGBM training script for Sandstorm ML Router
"""

import json
import os
import sys
import argparse
import numpy as np
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, accuracy_score
import joblib
from datetime import datetime

def load_data(data_dir):
    """Load training data from JSON files"""
    with open(os.path.join(data_dir, 'features.json'), 'r') as f:
        features = np.array(json.load(f))
    
    with open(os.path.join(data_dir, 'cost_targets.json'), 'r') as f:
        cost_targets = np.array(json.load(f))
    
    with open(os.path.join(data_dir, 'latency_targets.json'), 'r') as f:
        latency_targets = np.array(json.load(f))
    
    with open(os.path.join(data_dir, 'provider_targets.json'), 'r') as f:
        provider_targets = np.array(json.load(f))
    
    return features, cost_targets, latency_targets, provider_targets

def train_cost_model(X_train, y_train, X_val, y_val):
    """Train cost prediction model"""
    params = {
        'objective': 'regression',
        'metric': 'rmse',
        'boosting_type': 'gbdt',
        'num_leaves': 31,
        'learning_rate': 0.05,
        'feature_fraction': 0.9,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'random_state': 42
    }
    
    train_data = lgb.Dataset(X_train, label=y_train)
    val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)
    
    model = lgb.train(
        params,
        train_data,
        valid_sets=[val_data],
        num_boost_round=100,
        callbacks=[lgb.early_stopping(10), lgb.log_evaluation(0)]
    )
    
    # Calculate validation metrics
    predictions = model.predict(X_val, num_iteration=model.best_iteration)
    mse = mean_squared_error(y_val, predictions)
    
    return model, mse

def train_latency_model(X_train, y_train, X_val, y_val):
    """Train latency prediction model"""
    params = {
        'objective': 'regression',
        'metric': 'rmse',
        'boosting_type': 'gbdt',
        'num_leaves': 31,
        'learning_rate': 0.05,
        'feature_fraction': 0.9,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'random_state': 42
    }
    
    # Log transform latency for better prediction
    y_train_log = np.log1p(y_train)
    y_val_log = np.log1p(y_val)
    
    train_data = lgb.Dataset(X_train, label=y_train_log)
    val_data = lgb.Dataset(X_val, label=y_val_log, reference=train_data)
    
    model = lgb.train(
        params,
        train_data,
        valid_sets=[val_data],
        num_boost_round=100,
        callbacks=[lgb.early_stopping(10), lgb.log_evaluation(0)]
    )
    
    # Calculate validation metrics (transform back)
    predictions_log = model.predict(X_val, num_iteration=model.best_iteration)
    predictions = np.expm1(predictions_log)
    mse = mean_squared_error(y_val, predictions)
    
    return model, mse

def train_provider_model(X_train, y_train, X_val, y_val):
    """Train provider selection model (multi-class classification)"""
    params = {
        'objective': 'multiclass',
        'num_class': 6,  # 6 providers
        'metric': 'multi_logloss',
        'boosting_type': 'gbdt',
        'num_leaves': 31,
        'learning_rate': 0.05,
        'feature_fraction': 0.9,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'verbose': -1,
        'random_state': 42
    }
    
    train_data = lgb.Dataset(X_train, label=y_train)
    val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)
    
    model = lgb.train(
        params,
        train_data,
        valid_sets=[val_data],
        num_boost_round=100,
        callbacks=[lgb.early_stopping(10), lgb.log_evaluation(0)]
    )
    
    # Calculate validation metrics
    predictions = model.predict(X_val, num_iteration=model.best_iteration)
    predicted_classes = np.argmax(predictions, axis=1)
    accuracy = accuracy_score(y_val, predicted_classes)
    
    return model, accuracy

def save_models(output_dir, version, cost_model, latency_model, provider_model, metrics):
    """Save trained models and metadata"""
    # Save models
    cost_model.save_model(os.path.join(output_dir, f'cost_model_{version}.txt'))
    latency_model.save_model(os.path.join(output_dir, f'latency_model_{version}.txt'))
    provider_model.save_model(os.path.join(output_dir, f'provider_model_{version}.txt'))
    
    # Extract feature importance
    feature_names = [
        'codeLength', 'language', 'cpuRequested', 'memoryRequested',
        'hasGpu', 'hasRequirements', 'requirementsCount', 'hasEnvironment',
        'environmentCount', 'hasFiles', 'filesCount', 'isStateful',
        'timeoutMs', 'hourOfDay', 'dayOfWeek', 'isWeekend',
        'avgProviderLatency', 'avgProviderCost', 'providerFailureRate',
        'providerAvailability'
    ]
    
    # Average importance across all models
    cost_importance = cost_model.feature_importance(importance_type='gain')
    latency_importance = latency_model.feature_importance(importance_type='gain')
    provider_importance = provider_model.feature_importance(importance_type='gain')
    
    # Normalize importances
    cost_importance = cost_importance / cost_importance.sum()
    latency_importance = latency_importance / latency_importance.sum()
    provider_importance = provider_importance / provider_importance.sum()
    
    # Average importance
    avg_importance = (cost_importance + latency_importance + provider_importance) / 3
    
    feature_importance = {
        name: float(importance) 
        for name, importance in zip(feature_names, avg_importance)
    }
    
    # Save metadata
    metadata = {
        'version': version,
        'trainedAt': datetime.utcnow().isoformat(),
        'metrics': metrics,
        'featureImportance': feature_importance,
        'modelParams': {
            'num_leaves': 31,
            'learning_rate': 0.05,
            'feature_fraction': 0.9,
            'bagging_fraction': 0.8,
        }
    }
    
    with open(os.path.join(output_dir, f'metadata_{version}.json'), 'w') as f:
        json.dump(metadata, f, indent=2)

def main():
    parser = argparse.ArgumentParser(description='Train LightGBM models for Sandstorm ML Router')
    parser.add_argument('--data-dir', required=True, help='Directory containing training data')
    parser.add_argument('--output-dir', required=True, help='Directory to save trained models')
    parser.add_argument('--version', required=True, help='Model version')
    args = parser.parse_args()
    
    # Load data
    print("Loading training data...")
    features, cost_targets, latency_targets, provider_targets = load_data(args.data_dir)
    
    # Split data
    X_train, X_val, y_cost_train, y_cost_val, y_latency_train, y_latency_val, y_provider_train, y_provider_val = train_test_split(
        features, cost_targets, latency_targets, provider_targets,
        test_size=0.2, random_state=42
    )
    
    print(f"Training set size: {len(X_train)}")
    print(f"Validation set size: {len(X_val)}")
    
    # Train models
    print("\nTraining cost prediction model...")
    cost_model, cost_mse = train_cost_model(X_train, y_cost_train, X_val, y_cost_val)
    print(f"Cost model MSE: {cost_mse:.6f}")
    
    print("\nTraining latency prediction model...")
    latency_model, latency_mse = train_latency_model(X_train, y_latency_train, X_val, y_latency_val)
    print(f"Latency model MSE: {latency_mse:.2f}")
    
    print("\nTraining provider selection model...")
    provider_model, provider_accuracy = train_provider_model(X_train, y_provider_train, X_val, y_provider_val)
    print(f"Provider model accuracy: {provider_accuracy:.4f}")
    
    # Prepare metrics
    metrics = {
        'costMSE': float(cost_mse),
        'latencyMSE': float(latency_mse),
        'providerAccuracy': float(provider_accuracy),
        'trainingDataSize': len(X_train),
        'validationDataSize': len(X_val)
    }
    
    # Save models
    print("\nSaving models...")
    os.makedirs(args.output_dir, exist_ok=True)
    save_models(args.output_dir, args.version, cost_model, latency_model, provider_model, metrics)
    
    print(f"\nModels saved successfully to {args.output_dir}")

if __name__ == '__main__':
    main()