use prometheus::{
    Counter, CounterVec, Encoder, Histogram, HistogramOpts, HistogramVec, Opts, Registry,
    TextEncoder,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct Metrics {
    pub sandbox_runs_total: CounterVec,
    pub sandbox_run_duration: HistogramVec,
    pub sandbox_run_cost: HistogramVec,
    pub predictions_total: CounterVec,
    pub prediction_errors: HistogramVec,
    pub api_requests_total: CounterVec,
    pub api_request_duration: HistogramVec,
    registry: Arc<Registry>,
}

impl Metrics {
    pub fn new() -> Self {
        let registry = Registry::new();

        // Sandbox run metrics
        let sandbox_runs_total = CounterVec::new(
            Opts::new("sandbox_runs_total", "Total number of sandbox runs"),
            &["provider", "language", "success"],
        )
        .unwrap();

        let sandbox_run_duration = HistogramVec::new(
            HistogramOpts::new("sandbox_run_duration_ms", "Sandbox run duration in milliseconds"),
            &["provider", "language"],
        )
        .unwrap();

        let sandbox_run_cost = HistogramVec::new(
            HistogramOpts::new("sandbox_run_cost", "Sandbox run cost"),
            &["provider"],
        )
        .unwrap();

        // Prediction metrics
        let predictions_total = CounterVec::new(
            Opts::new("predictions_total", "Total number of predictions made"),
            &["model_version", "provider"],
        )
        .unwrap();

        let prediction_errors = HistogramVec::new(
            HistogramOpts::new("prediction_error_percentage", "Prediction error percentage"),
            &["model_version", "metric_type"], // metric_type: cost or latency
        )
        .unwrap();

        // API metrics
        let api_requests_total = CounterVec::new(
            Opts::new("api_requests_total", "Total number of API requests"),
            &["endpoint", "method", "status"],
        )
        .unwrap();

        let api_request_duration = HistogramVec::new(
            HistogramOpts::new("api_request_duration_seconds", "API request duration in seconds"),
            &["endpoint", "method"],
        )
        .unwrap();

        // Register all metrics
        registry.register(Box::new(sandbox_runs_total.clone())).unwrap();
        registry.register(Box::new(sandbox_run_duration.clone())).unwrap();
        registry.register(Box::new(sandbox_run_cost.clone())).unwrap();
        registry.register(Box::new(predictions_total.clone())).unwrap();
        registry.register(Box::new(prediction_errors.clone())).unwrap();
        registry.register(Box::new(api_requests_total.clone())).unwrap();
        registry.register(Box::new(api_request_duration.clone())).unwrap();

        Self {
            sandbox_runs_total,
            sandbox_run_duration,
            sandbox_run_cost,
            predictions_total,
            prediction_errors,
            api_requests_total,
            api_request_duration,
            registry: Arc::new(registry),
        }
    }

    pub fn export(&self) -> String {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer).unwrap();
        String::from_utf8(buffer).unwrap()
    }
}