import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';

declare const __APP_BUILD__: string | undefined;

const DEFAULT_TELEMETRY_ORIGIN = 'http://localhost:4001';
const PROVIDERS = ['edge', 'e2b', 'modal', 'daytona', 'morph'];

type EdgeAgentOverview = {
  agentId: string;
  agentName?: string;
  status: 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped';
  version: string;
  queueDepth: number;
  running: number;
  completed: number;
  failed: number;
  cpuPercent: number;
  memoryPercent: number;
  lastHeartbeat: string;
  publicEndpoint?: string;
  sandboxRun?: {
    sandboxId: string;
    provider: string;
    language: string;
    durationMs: number;
    exitCode: number;
    cpuPercent?: number | null;
    memoryMB?: number | null;
    finishedAt: string;
  };
};

type ProviderStat = {
  avgLatency: number;
  avgCost: number;
  successRate: number;
  totalRuns: number;
};

function statusTone(status: EdgeAgentOverview['status']): 'ok' | 'warn' | 'err' {
  if (status === 'running') return 'ok';
  if (status === 'degraded' || status === 'starting') return 'warn';
  return 'err';
}

function formatNumber(value: number, fraction = 2): string {
  if (Number.isNaN(value)) return '—';
  if (value >= 1000) {
    return `${(value / 1000).toFixed(fraction)}k`;
  }
  return value.toFixed(fraction);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${value.toFixed(1)}%`;
}

function formatLatency(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${value.toFixed(0)}ms`;
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

const telemetryOrigin = () => import.meta.env.VITE_TELEMETRY_ORIGIN || DEFAULT_TELEMETRY_ORIGIN;

async function fetchEdgeAgents(): Promise<EdgeAgentOverview[]> {
  const response = await axios.get(`${telemetryOrigin()}/api/edge/agents/overview`);
  return response.data;
}

async function fetchProviderStats(): Promise<Record<string, ProviderStat>> {
  const baseUrl = telemetryOrigin();
  const now = new Date();
  const start = new Date(now.getTime() - 6 * 60 * 60 * 1000); // last 6 hours

  const results = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        const { data } = await axios.get(`${baseUrl}/api/telemetry/provider-stats/${provider}`, {
          params: {
            start: start.toISOString(),
            end: now.toISOString(),
          },
        });
        return [provider, data as ProviderStat] as const;
      } catch (error) {
        console.warn('Failed to load provider stats', provider, error);
        return [provider, { avgCost: 0, avgLatency: 0, successRate: 0, totalRuns: 0 }] as const;
      }
    })
  );

  return Object.fromEntries(results);
}

export default function App() {
  const [agents, setAgents] = useState<EdgeAgentOverview[]>([]);
  const [providerStats, setProviderStats] = useState<Record<string, ProviderStat>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [agentData, providerData] = await Promise.all([
        fetchEdgeAgents(),
        fetchProviderStats(),
      ]);
      setAgents(agentData);
      setProviderStats(providerData);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const totals = useMemo(() => {
    const totalRunning = agents.reduce((acc, agent) => acc + agent.running, 0);
    const totalQueued = agents.reduce((acc, agent) => acc + agent.queueDepth, 0);
    const totalCompleted = agents.reduce((acc, agent) => acc + agent.completed, 0);
    const totalFailed = agents.reduce((acc, agent) => acc + agent.failed, 0);
    return { totalRunning, totalQueued, totalCompleted, totalFailed };
  }, [agents]);

  return (
    <main>
      <header className="section-header">
        <div>
          <h1>Sandstorm Operations Console</h1>
          <p style={{ color: '#475569' }}>
            Unified view of edge agents, provider health, and routing performance.
          </p>
        </div>
        <div className="meta">
          <span>{`Refreshes every 15s`}</span>
          <span>{`Build ${__APP_BUILD__ || 'dev'}`}</span>
        </div>
      </header>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid #ef4444', marginTop: '1.5rem' }}>
          <strong>Unable to load telemetry.</strong>
          <div style={{ marginTop: '0.4rem', color: '#991b1b' }}>{error}</div>
        </div>
      )}

      <section style={{ marginTop: '2rem' }}>
        <h2>Edge Agent Fleet</h2>
        <div className="grid two" style={{ marginTop: '1rem' }}>
          <div className="card">
            <div className="metric">
              {totals.totalRunning}
              <span>Sandboxes Running</span>
            </div>
          </div>
          <div className="card">
            <div className="metric">
              {totals.totalQueued}
              <span>Queued Tasks</span>
            </div>
          </div>
          <div className="card">
            <div className="metric">
              {totals.totalCompleted}
              <span>Completed Today</span>
            </div>
          </div>
          <div className="card">
            <div className="metric">
              {totals.totalFailed}
              <span>Failures Today</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: '1.5rem' }}>
          {loading ? (
            <div className="empty">Loading agent metrics…</div>
          ) : agents.length === 0 ? (
            <div className="empty">No edge agents reporting telemetry yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Running</th>
                  <th>Queue</th>
                  <th>Last heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{agent.agentName || agent.agentId}</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{agent.version}</div>
                    </td>
                    <td>
                      <span className={`badge ${statusTone(agent.status)}`}>{agent.status}</span>
                    </td>
                    <td>{formatPercent(agent.cpuPercent)}</td>
                    <td>{formatPercent(agent.memoryPercent)}</td>
                    <td>{agent.running}</td>
                    <td>{agent.queueDepth}</td>
                    <td>
                      {formatDistanceToNow(new Date(agent.lastHeartbeat), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Recent Edge Activity</h2>
        <div className="card">
          {agents.every((agent) => !agent.sandboxRun) ? (
            <div className="empty">No recent edge runs in the last window.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Sandbox</th>
                  <th>Agent</th>
                  <th>Provider</th>
                  <th>Language</th>
                  <th>Duration</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {agents
                  .filter((agent) => agent.sandboxRun)
                  .map((agent) => {
                    const run = agent.sandboxRun!;
                    return (
                      <tr key={`${agent.agentId}-${run.sandboxId}`}>
                        <td>{run.sandboxId}</td>
                        <td>{agent.agentName || agent.agentId}</td>
                        <td>{run.provider}</td>
                        <td>{run.language}</td>
                        <td>{formatLatency(run.durationMs)}</td>
                        <td>{formatPercent(run.cpuPercent ?? null)}</td>
                        <td>
                          {run.memoryMB !== null && run.memoryMB !== undefined
                            ? `${run.memoryMB.toFixed(0)} MB`
                            : '—'}
                        </td>
                        <td>
                          {formatDistanceToNow(new Date(run.finishedAt), { addSuffix: true })}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Provider Performance Snapshot (last 6h)</h2>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Avg Latency</th>
                <th>Avg Cost</th>
                <th>Success Rate</th>
                <th>Total Runs</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((provider) => {
                const stats = providerStats[provider];
                if (!stats) {
                  return (
                    <tr key={provider}>
                      <td>{provider}</td>
                      <td colSpan={4} style={{ color: '#94a3b8' }}>
                        No telemetry yet
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={provider}>
                    <td>{provider}</td>
                    <td>{formatLatency(stats.avgLatency)}</td>
                    <td>{formatCost(stats.avgCost)}</td>
                    <td>{formatPercent(stats.successRate * 100)}</td>
                    <td>{stats.totalRuns}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
