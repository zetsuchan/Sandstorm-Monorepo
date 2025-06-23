import { SecurityPolicy, SecurityRule } from './types';

export const securityPolicyTemplates: Record<string, SecurityPolicy> = {
  // Basic security policy
  basic: {
    id: 'policy_basic',
    name: 'Basic Security Policy',
    description: 'Standard security policy for general sandbox protection',
    enabled: true,
    tier: 'basic',
    rules: [
      {
        id: 'rule_basic_1',
        name: 'Block Critical File Access',
        description: 'Prevent access to critical system files',
        condition: {
          type: 'file_access',
          pattern: '(/etc/passwd|/etc/shadow|/root/.*)',
        },
        action: 'deny',
      },
      {
        id: 'rule_basic_2',
        name: 'Alert on Privilege Escalation',
        description: 'Alert when privilege escalation is detected',
        condition: {
          type: 'privilege_escalation',
        },
        action: 'alert',
      },
      {
        id: 'rule_basic_3',
        name: 'Monitor Network Activity',
        description: 'Alert on suspicious network connections',
        condition: {
          type: 'network_activity',
          severity: 'high',
        },
        action: 'alert',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // Enhanced Shield tier policy
  shield: {
    id: 'policy_shield',
    name: 'Shield Security Policy',
    description: 'Enhanced security policy with auto-quarantine and compliance features',
    enabled: true,
    tier: 'shield',
    rules: [
      {
        id: 'rule_shield_1',
        name: 'Auto-Quarantine Critical Events',
        description: 'Automatically quarantine sandboxes with critical security events',
        condition: {
          severity: 'critical',
        },
        action: 'quarantine',
      },
      {
        id: 'rule_shield_2',
        name: 'Block Suspicious Behavior',
        description: 'Block and quarantine suspicious behavior patterns',
        condition: {
          type: 'suspicious_behavior',
        },
        action: 'quarantine',
      },
      {
        id: 'rule_shield_3',
        name: 'Enforce Resource Limits',
        description: 'Quarantine sandboxes exceeding resource limits',
        condition: {
          type: 'resource_limit',
          threshold: 3,
          timeWindow: 60000, // 1 minute
        },
        action: 'quarantine',
      },
      {
        id: 'rule_shield_4',
        name: 'Compliance Violations',
        description: 'Alert and log compliance violations',
        condition: {
          type: 'compliance_check',
        },
        action: 'alert',
        notifications: ['compliance-team@company.com'],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // Cryptocurrency/DeFi specific policy
  crypto: {
    id: 'policy_crypto',
    name: 'Cryptocurrency Security Policy',
    description: 'Security policy for cryptocurrency and DeFi operations',
    enabled: true,
    tier: 'shield',
    rules: [
      {
        id: 'rule_crypto_1',
        name: 'Protect Private Keys',
        description: 'Block access to private key patterns',
        condition: {
          pattern: '(private_key|mnemonic|seed_phrase|keystore)',
        },
        action: 'deny',
      },
      {
        id: 'rule_crypto_2',
        name: 'Monitor Crypto Mining',
        description: 'Detect and quarantine crypto mining attempts',
        condition: {
          pattern: '(xmrig|minergate|cryptonight|randomx)',
        },
        action: 'quarantine',
      },
      {
        id: 'rule_crypto_3',
        name: 'Track Large Transfers',
        description: 'Alert on large value transfers',
        condition: {
          pattern: 'transfer.*amount.*[0-9]{6,}',
        },
        action: 'alert',
        notifications: ['security-ops@company.com'],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ML/AI workload policy
  ml_workload: {
    id: 'policy_ml',
    name: 'ML/AI Workload Security Policy',
    description: 'Security policy for machine learning and AI workloads',
    enabled: true,
    tier: 'basic',
    rules: [
      {
        id: 'rule_ml_1',
        name: 'Protect Model Files',
        description: 'Monitor access to ML model files',
        condition: {
          type: 'file_access',
          pattern: '\\.(h5|pkl|pth|onnx|pb|tflite)$',
        },
        action: 'alert',
      },
      {
        id: 'rule_ml_2',
        name: 'GPU Resource Limits',
        description: 'Enforce GPU usage limits',
        condition: {
          type: 'resource_limit',
          pattern: 'gpu_usage',
          threshold: 95,
          timeWindow: 300000, // 5 minutes
        },
        action: 'alert',
      },
      {
        id: 'rule_ml_3',
        name: 'Data Exfiltration Prevention',
        description: 'Prevent large data transfers',
        condition: {
          type: 'network_activity',
          pattern: 'bytes_sent > 1073741824', // 1GB
        },
        action: 'deny',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // Zero trust policy
  zero_trust: {
    id: 'policy_zero_trust',
    name: 'Zero Trust Security Policy',
    description: 'Strict zero-trust security policy with deny-by-default',
    enabled: false,
    tier: 'shield',
    rules: [
      {
        id: 'rule_zt_1',
        name: 'Deny All File Access',
        description: 'Block all file system access by default',
        condition: {
          type: 'file_access',
        },
        action: 'deny',
      },
      {
        id: 'rule_zt_2',
        name: 'Deny All Network',
        description: 'Block all network activity by default',
        condition: {
          type: 'network_activity',
        },
        action: 'deny',
      },
      {
        id: 'rule_zt_3',
        name: 'No Process Spawning',
        description: 'Prevent spawning new processes',
        condition: {
          type: 'process_spawn',
        },
        action: 'deny',
      },
      {
        id: 'rule_zt_4',
        name: 'Immediate Quarantine',
        description: 'Quarantine on any policy violation',
        condition: {
          type: 'policy_violation',
        },
        action: 'quarantine',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

// Helper function to create custom policies
export function createCustomPolicy(
  name: string,
  description: string,
  rules: SecurityRule[],
  tier: 'basic' | 'shield' = 'basic'
): SecurityPolicy {
  return {
    id: `policy_custom_${Date.now()}`,
    name,
    description,
    enabled: true,
    tier,
    rules,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}