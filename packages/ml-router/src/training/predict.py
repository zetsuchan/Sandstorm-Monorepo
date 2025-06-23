#!/usr/bin/env python3
"""
LightGBM prediction script for Sandstorm ML Router
"""

import json
import os
import argparse
import numpy as np
import lightgbm as lgb

def load_models(model_path, version):
    """Load trained models"""
    cost_model = lgb.Booster(model_file=os.path.join(model_path, f'cost_model_{version}.txt'))
    latency_model = lgb.Booster(model_file=os.path.join(model_path, f'latency_model_{version}.txt'))
    provider_model = lgb.Booster(model_file=os.path.join(model_path, f'provider_model_{version}.txt'))
    
    return cost_model, latency_model, provider_model

def predict(features, cost_model, latency_model, provider_model):
    """Make predictions using loaded models"""
    features_array = np.array(features).reshape(1, -1)
    
    # Predict cost
    cost = float(cost_model.predict(features_array)[0])
    
    # Predict latency (remember to inverse log transform)
    latency_log = latency_model.predict(features_array)[0]
    latency = float(np.expm1(latency_log))
    
    # Predict provider
    provider_probs = provider_model.predict(features_array)[0]
    provider_index = int(np.argmax(provider_probs))
    confidence = float(provider_probs[provider_index])
    
    return {
        'provider': provider_index,
        'cost': cost,
        'latency': latency,
        'confidence': confidence,
        'provider_probabilities': provider_probs.tolist()
    }

def main():
    parser = argparse.ArgumentParser(description='Make predictions using LightGBM models')
    parser.add_argument('--model-path', required=True, help='Directory containing model files')
    parser.add_argument('--version', required=True, help='Model version to use')
    parser.add_argument('--features', required=True, help='JSON array of features')
    args = parser.parse_args()
    
    # Parse features
    features = json.loads(args.features)
    
    # Load models
    cost_model, latency_model, provider_model = load_models(args.model_path, args.version)
    
    # Make prediction
    result = predict(features, cost_model, latency_model, provider_model)
    
    # Output as JSON
    print(json.dumps(result))

if __name__ == '__main__':
    main()