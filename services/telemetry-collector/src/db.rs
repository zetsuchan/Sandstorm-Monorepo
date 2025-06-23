use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        Ok(Self { pool })
    }

    pub async fn run_migrations(&self) -> Result<()> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await?;
        info!("Database migrations completed");
        Ok(())
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}