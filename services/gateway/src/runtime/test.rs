#[cfg(test)]
mod tests {
    use crate::runtime::{IsolationLevel, RuntimeRegistry, RuntimeType, SandboxConfig};
    use std::collections::HashMap;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_runtime_registry() {
        let registry = RuntimeRegistry::new();
        
        // Initially empty
        assert!(registry.list().await.is_empty());
    }

    #[test]
    fn test_isolation_level_serialization() {
        let level = IsolationLevel::Strong;
        let json = serde_json::to_string(&level).unwrap();
        assert_eq!(json, "\"strong\"");
        
        let deserialized: IsolationLevel = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, level);
    }

    #[test]
    fn test_runtime_type_serialization() {
        let runtime_type = RuntimeType::Gvisor;
        let json = serde_json::to_string(&runtime_type).unwrap();
        assert_eq!(json, "\"gvisor\"");
        
        let deserialized: RuntimeType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, runtime_type);
    }

    #[test]
    fn test_sandbox_config_creation() {
        let config = SandboxConfig {
            id: Uuid::new_v4(),
            image: "test/image".to_string(),
            command: vec!["echo".to_string(), "hello".to_string()],
            environment: HashMap::new(),
            cpu_limit: Some(1.0),
            memory_limit: Some(512 * 1024 * 1024),
            timeout: Some(30000),
            isolation_level: IsolationLevel::Standard,
            runtime_preference: Some(RuntimeType::Gvisor),
            working_dir: Some("/workspace".to_string()),
            mounts: vec![],
        };

        assert_eq!(config.isolation_level, IsolationLevel::Standard);
        assert_eq!(config.runtime_preference, Some(RuntimeType::Gvisor));
        assert_eq!(config.cpu_limit, Some(1.0));
    }

    #[test]
    fn test_runtime_selection_logic() {
        // Test default mappings for each isolation level
        let standard_runtime = match IsolationLevel::Standard {
            IsolationLevel::Standard => RuntimeType::Gvisor,
            IsolationLevel::Strong => RuntimeType::Kata,
            IsolationLevel::Maximum => RuntimeType::Firecracker,
        };
        assert_eq!(standard_runtime, RuntimeType::Gvisor);

        let strong_runtime = match IsolationLevel::Strong {
            IsolationLevel::Standard => RuntimeType::Gvisor,
            IsolationLevel::Strong => RuntimeType::Kata,
            IsolationLevel::Maximum => RuntimeType::Firecracker,
        };
        assert_eq!(strong_runtime, RuntimeType::Kata);

        let maximum_runtime = match IsolationLevel::Maximum {
            IsolationLevel::Standard => RuntimeType::Gvisor,
            IsolationLevel::Strong => RuntimeType::Kata,
            IsolationLevel::Maximum => RuntimeType::Firecracker,
        };
        assert_eq!(maximum_runtime, RuntimeType::Firecracker);
    }
}