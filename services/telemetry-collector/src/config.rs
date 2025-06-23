use anyhow::Result;
use serde::Deserialize;
use config::{Config as ConfigBuilder, ConfigError, Environment, File};

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub max_training_data_age_days: i64,
    pub metrics_retention_days: i64,
}

impl Config {
    pub fn load() -> Result<Self> {
        let config = ConfigBuilder::builder()
            // Start with default values
            .set_default("port", 8082)?
            .set_default("max_training_data_age_days", 30)?
            .set_default("metrics_retention_days", 90)?
            
            // Add in settings from config file
            .add_source(File::with_name("config/telemetry").required(false))
            
            // Add in settings from environment
            .add_source(Environment::with_prefix("TELEMETRY").separator("_"))
            
            .build()?;

        Ok(config.try_deserialize()?)
    }
}