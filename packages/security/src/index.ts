// Types
export * from './types';
export * from './interfaces';

// Core implementations
export { SecurityMonitor } from './monitor';
export { SecurityAggregator } from './aggregator';
export { FalcoIntegration } from './falco';
export { EbpfMonitor, FILE_ACCESS_MONITOR, NETWORK_MONITOR } from './ebpf';
export { SiemIntegration } from './siem';
export { ComplianceEngine } from './compliance';
export { ProvenanceService } from './provenance';

// Policy templates
export { securityPolicyTemplates } from './policy-templates';

// Dashboard
export { SecurityDashboard } from './dashboard';