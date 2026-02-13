/**
 * Token Shield Enterprise - Circuit Breaker Dashboard
 * 
 * Real-time monitoring dashboard for circuit breaker states, cost tracking,
 * and multi-agent system health visualization
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Zap,
  Shield,
  Users,
  BarChart3,
  Settings,
  RefreshCw
} from 'lucide-react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

export interface CircuitBreakerStatus {
  id: string;
  agentId: string;
  agentName: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  failureRate: number;
  lastTripAt?: Date;
  lastResetAt?: Date;
  tripThreshold: number;
  resetTimeout: number;
  currentHalfOpenCalls: number;
  halfOpenMaxCalls: number;
  metrics: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    timeouts: number;
    rateLimitHits: number;
    budgetExceedances: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
}

export interface AgentCostSummary {
  agentId: string;
  agentName: string;
  totalTokens: number;
  totalCost: number;
  hourlyTokens: number;
  hourlyCost: number;
  dailyTokens: number;
  dailyCost: number;
  efficiency: number;
  projectedMonthlyCost: number;
  costTrend: 'increasing' | 'decreasing' | 'stable';
  lastActivityAt: Date;
}

export interface SwarmSummary {
  swarmId: string;
  swarmName: string;
  agentCount: number;
  totalTokens: number;
  totalCost: number;
  communicationOverhead: number;
  efficiency: number;
  status: 'healthy' | 'warning' | 'critical';
}

export interface AlertNotification {
  id: string;
  type: 'circuit_breaker_trip' | 'cost_threshold_hit' | 'budget_exceeded' | 'system_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  agentId?: string;
  swarmId?: string;
  acknowledged: boolean;
}

export interface CircuitBreakerDashboardProps {
  refreshInterval?: number;
  onRefresh?: () => void;
  onAgentSelect?: (agentId: string) => void;
  onSwarmSelect?: (swarmId: string) => void;
  onAlertAcknowledge?: (alertId: string) => void;
  onCircuitBreakerReset?: (breakerId: string) => void;
}

export const CircuitBreakerDashboard: React.FC<CircuitBreakerDashboardProps> = ({
  refreshInterval = 5000,
  onRefresh,
  onAgentSelect,
  onSwarmSelect,
  onAlertAcknowledge,
  onCircuitBreakerReset,
}) => {
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerStatus[]>([]);
  const [agentCosts, setAgentCosts] = useState<AgentCostSummary[]>([]);
  const [swarms, setSwarms] = useState<SwarmSummary[]>([]);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [selectedTimeRange, setSelectedTimeRange] = useState<'1h' | '6h' | '24h' | '7d'>('6h');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Mock data - in real implementation, this would come from API
  const mockCircuitBreakers: CircuitBreakerStatus[] = [
    {
      id: 'cb-1',
      agentId: 'agent-1',
      agentName: 'CodeAnalyzer-Pro',
      state: 'closed',
      failureCount: 2,
      successCount: 145,
      failureRate: 1.36,
      tripThreshold: 5,
      resetTimeout: 300000,
      currentHalfOpenCalls: 0,
      halfOpenMaxCalls: 3,
      metrics: {
        totalCalls: 147,
        successfulCalls: 145,
        failedCalls: 2,
        timeouts: 1,
        rateLimitHits: 0,
        budgetExceedances: 0,
        averageResponseTime: 234,
        p95ResponseTime: 456,
        p99ResponseTime: 789,
      },
    },
    {
      id: 'cb-2',
      agentId: 'agent-2',
      agentName: 'DataProcessor-Standard',
      state: 'open',
      failureCount: 7,
      successCount: 89,
      failureRate: 7.29,
      lastTripAt: new Date(Date.now() - 120000),
      tripThreshold: 5,
      resetTimeout: 300000,
      currentHalfOpenCalls: 0,
      halfOpenMaxCalls: 3,
      metrics: {
        totalCalls: 96,
        successfulCalls: 89,
        failedCalls: 7,
        timeouts: 3,
        rateLimitHits: 2,
        budgetExceedances: 2,
        averageResponseTime: 567,
        p95ResponseTime: 1234,
        p99ResponseTime: 2345,
      },
    },
    {
      id: 'cb-3',
      agentId: 'agent-3',
      agentName: 'CreativeWriter-Economy',
      state: 'half-open',
      failureCount: 3,
      successCount: 67,
      failureRate: 4.29,
      tripThreshold: 5,
      resetTimeout: 300000,
      currentHalfOpenCalls: 1,
      halfOpenMaxCalls: 3,
      metrics: {
        totalCalls: 70,
        successfulCalls: 67,
        failedCalls: 3,
        timeouts: 2,
        rateLimitHits: 1,
        budgetExceedances: 0,
        averageResponseTime: 345,
        p95ResponseTime: 678,
        p99ResponseTime: 1234,
      },
    },
  ];

  const mockAgentCosts: AgentCostSummary[] = [
    {
      agentId: 'agent-1',
      agentName: 'CodeAnalyzer-Pro',
      totalTokens: 125000,
      totalCost: 125.5,
      hourlyTokens: 5200,
      hourlyCost: 5.2,
      dailyTokens: 48000,
      dailyCost: 48.2,
      efficiency: 87.5,
      projectedMonthlyCost: 1446,
      costTrend: 'increasing',
      lastActivityAt: new Date(Date.now() - 30000),
    },
    {
      agentId: 'agent-2',
      agentName: 'DataProcessor-Standard',
      totalTokens: 89000,
      totalCost: 89.0,
      hourlyTokens: 3200,
      hourlyCost: 3.2,
      dailyTokens: 35000,
      dailyCost: 35.0,
      efficiency: 76.2,
      projectedMonthlyCost: 1050,
      costTrend: 'decreasing',
      lastActivityAt: new Date(Date.now() - 120000),
    },
    {
      agentId: 'agent-3',
      agentName: 'CreativeWriter-Economy',
      totalTokens: 67000,
      totalCost: 67.0,
      hourlyTokens: 2800,
      hourlyCost: 2.8,
      dailyTokens: 28000,
      dailyCost: 28.0,
      efficiency: 82.1,
      projectedMonthlyCost: 840,
      costTrend: 'stable',
      lastActivityAt: new Date(Date.now() - 60000),
    },
  ];

  const mockSwarms: SwarmSummary[] = [
    {
      swarmId: 'swarm-1',
      swarmName: 'CodeReview-Squad',
      agentCount: 3,
      totalTokens: 185000,
      totalCost: 185.0,
      communicationOverhead: 12.5,
      efficiency: 84.2,
      status: 'healthy',
    },
    {
      swarmId: 'swarm-2',
      swarmName: 'DataAnalytics-Team',
      agentCount: 5,
      totalTokens: 320000,
      totalCost: 320.0,
      communicationOverhead: 28.7,
      efficiency: 71.8,
      status: 'warning',
    },
  ];

  const mockAlerts: AlertNotification[] = [
    {
      id: 'alert-1',
      type: 'circuit_breaker_trip',
      severity: 'high',
      title: 'Circuit Breaker Tripped',
      message: 'DataProcessor-Standard circuit breaker has opened due to 7 failures in the last 5 minutes.',
      timestamp: new Date(Date.now() - 120000),
      agentId: 'agent-2',
      acknowledged: false,
    },
    {
      id: 'alert-2',
      type: 'cost_threshold_hit',
      severity: 'medium',
      title: 'Daily Cost Threshold Exceeded',
      message: 'CodeAnalyzer-Pro has exceeded 80% of daily cost threshold.',
      timestamp: new Date(Date.now() - 300000),
      agentId: 'agent-1',
      acknowledged: false,
    },
  ];

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setCircuitBreakers(mockCircuitBreakers);
    setAgentCosts(mockAgentCosts);
    setSwarms(mockSwarms);
    setAlerts(mockAlerts);
    setLastUpdate(new Date());
    setIsLoading(false);
  }, [selectedTimeRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetchData();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchData, refreshInterval, autoRefresh]);

  const handleRefresh = () => {
    fetchData();
    onRefresh?.();
  };

  const handleAcknowledgeAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, acknowledged: true } : alert
    ));
    onAlertAcknowledge?.(alertId);
  };

  const handleCircuitBreakerReset = (breakerId: string) => {
    setCircuitBreakers(prev => prev.map(breaker => 
      breaker.id === breakerId ? { 
        ...breaker, 
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastResetAt: new Date(),
      } : breaker
    ));
    onCircuitBreakerReset?.(breakerId);
  };

  const getCircuitBreakerColor = (state: CircuitBreakerStatus['state']) => {
    switch (state) {
      case 'closed': return 'bg-green-500';
      case 'open': return 'bg-red-500';
      case 'half-open': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getCircuitBreakerIcon = (state: CircuitBreakerStatus['state']) => {
    switch (state) {
      case 'closed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'open': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'half-open': return <Clock className="h-4 w-4 text-yellow-500" />;
      default: return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy': return 'bg-green-100 text-green-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      case 'critical': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAlertSeverityColor = (severity: AlertNotification['severity']) => {
    switch (severity) {
      case 'low': return 'bg-blue-100 text-blue-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'critical': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Chart data
  const circuitBreakerStateData = {
    labels: ['Closed', 'Half-Open', 'Open'],
    datasets: [
      {
        data: [
          circuitBreakers.filter(cb => cb.state === 'closed').length,
          circuitBreakers.filter(cb => cb.state === 'half-open').length,
          circuitBreakers.filter(cb => cb.state === 'open').length,
        ],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 0,
      },
    ],
  };

  const costTrendData = {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
    datasets: [
      {
        label: 'Total Cost ($)',
        data: [12.5, 15.2, 28.7, 45.6, 38.9, 25.4],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Projected Monthly ($)',
        data: [1446, 1452, 1468, 1489, 1476, 1462],
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        fill: false,
        tension: 0.4,
      },
    ],
  };

  const agentEfficiencyData = {
    labels: agentCosts.map(agent => agent.agentName.split('-')[0]),
    datasets: [
      {
        label: 'Efficiency (%)',
        data: agentCosts.map(agent => agent.efficiency),
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(251, 191, 36, 0.8)',
          'rgba(239, 68, 68, 0.8)',
        ],
        borderColor: [
          'rgb(34, 197, 94)',
          'rgb(251, 191, 36)',
          'rgb(239, 68, 68)',
        ],
        borderWidth: 1,
      },
    ],
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Circuit Breaker Dashboard</h1>
          <p className="text-gray-600">Real-time multi-agent cost tracking and system health monitoring</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Auto-refresh</span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoRefresh ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoRefresh ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <select
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="1h">Last 1 hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
          <Button onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{circuitBreakers.length}</div>
            <div className="text-xs text-muted-foreground">
              {circuitBreakers.filter(cb => cb.state === 'closed').length} healthy
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Breakers</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {circuitBreakers.filter(cb => cb.state === 'open').length}
            </div>
            <div className="text-xs text-muted-foreground">
              Requires attention
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${agentCosts.reduce((sum, agent) => sum + agent.totalCost, 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              This {selectedTimeRange}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Efficiency</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(agentCosts.reduce((sum, agent) => sum + agent.efficiency, 0) / agentCosts.length || 0).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              Across all agents
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="circuit-breakers">Circuit Breakers</TabsTrigger>
          <TabsTrigger value="cost-tracking">Cost Tracking</TabsTrigger>
          <TabsTrigger value="swarms">Agent Swarms</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Circuit Breaker Status Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Circuit Breaker Status</CardTitle>
                <CardDescription>Current state distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <Doughnut 
                    data={circuitBreakerStateData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'bottom',
                        },
                      },
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Cost Trend Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Cost Trends</CardTitle>
                <CardDescription>Cost over time and projections</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <Line 
                    data={costTrendData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'bottom',
                        },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                        },
                      },
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Alerts</CardTitle>
              <CardDescription>System notifications and warnings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alerts.filter(alert => !alert.acknowledged).map(alert => (
                  <Alert key={alert.id} variant={alert.severity === 'critical' ? 'destructive' : 'default'}>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="flex justify-between items-center">
                      {alert.title}
                      <Badge className={getAlertSeverityColor(alert.severity)}>
                        {alert.severity.toUpperCase()}
                      </Badge>
                    </AlertTitle>
                    <AlertDescription className="flex justify-between items-center">
                      <span>{alert.message}</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500">
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAcknowledgeAlert(alert.id)}
                        >
                          Acknowledge
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
                {alerts.filter(alert => !alert.acknowledged).length === 0 && (
                  <div className="text-center text-gray-500 py-8">
                    No active alerts
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="circuit-breakers" className="space-y-4">
          <div className="grid gap-4">
            {circuitBreakers.map(breaker => (
              <Card key={breaker.id}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${getCircuitBreakerColor(breaker.state)}`} />
                      <div>
                        <CardTitle className="text-lg">{breaker.agentName}</CardTitle>
                        <CardDescription>Agent ID: {breaker.agentId}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getCircuitBreakerIcon(breaker.state)}
                      <Badge variant={
                        breaker.state === 'closed' ? 'default' :
                        breaker.state === 'open' ? 'destructive' : 'secondary'
                      }>
                        {breaker.state.toUpperCase()}
                      </Badge>
                      {breaker.state === 'open' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCircuitBreakerReset(breaker.id)}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-600">Failure Rate</div>
                      <div className="text-lg font-semibold">{breaker.failureRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Total Calls</div>
                      <div className="text-lg font-semibold">{breaker.metrics.totalCalls}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Success Rate</div>
                      <div className="text-lg font-semibold">
                        {((breaker.metrics.successfulCalls / breaker.metrics.totalCalls) * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Avg Response Time</div>
                      <div className="text-lg font-semibold">{breaker.metrics.averageResponseTime}ms</div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm text-gray-600 mb-2">Failure Count</div>
                    <Progress 
                      value={(breaker.failureCount / breaker.tripThreshold) * 100}
                      className={breaker.failureCount >= breaker.tripThreshold ? 'bg-red-500' : ''}
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      {breaker.failureCount} / {breaker.tripThreshold} failures before trip
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="cost-tracking" className="space-y-4">
          <div className="grid gap-4">
            {agentCosts.map(agent => (
              <Card key={agent.agentId}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-lg">{agent.agentName}</CardTitle>
                      <CardDescription>Last active: {agent.lastActivityAt.toLocaleTimeString()}</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      {agent.costTrend === 'increasing' && <TrendingUp className="h-4 w-4 text-red-500" />}
                      {agent.costTrend === 'decreasing' && <TrendingDown className="h-4 w-4 text-green-500" />}
                      {agent.costTrend === 'stable' && <Activity className="h-4 w-4 text-gray-500" />}
                      <Badge variant={agent.efficiency > 80 ? 'default' : 'secondary'}>
                        {agent.efficiency.toFixed(1)}% Efficient
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-600">Total Tokens</div>
                      <div className="text-lg font-semibold">{agent.totalTokens.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Total Cost</div>
                      <div className="text-lg font-semibold">${agent.totalCost.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Daily Cost</div>
                      <div className="text-lg font-semibold">${agent.dailyCost.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Monthly Projection</div>
                      <div className="text-lg font-semibold">${agent.projectedMonthlyCost.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm text-gray-600 mb-2">Hourly Token Usage</div>
                    <Progress value={(agent.hourlyTokens / 10000) * 100} />
                    <div className="text-xs text-gray-500 mt-1">
                      {agent.hourlyTokens.toLocaleString()} tokens this hour
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {/* Agent Efficiency Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Agent Efficiency Comparison</CardTitle>
              <CardDescription>Efficiency across all agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <Bar 
                  data={agentEfficiencyData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: false,
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        max: 100,
                      },
                    },
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="swarms" className="space-y-4">
          <div className="grid gap-4">
            {swarms.map(swarm => (
              <Card key={swarm.swarmId}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-lg">{swarm.swarmName}</CardTitle>
                      <CardDescription>{swarm.agentCount} agents</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge className={getStatusColor(swarm.status)}>
                        {swarm.status.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-600">Total Tokens</div>
                      <div className="text-lg font-semibold">{swarm.totalTokens.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Total Cost</div>
                      <div className="text-lg font-semibold">${swarm.totalCost.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Communication</div>
                      <div className="text-lg font-semibold">${swarm.communicationOverhead.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Efficiency</div>
                      <div className="text-lg font-semibold">{swarm.efficiency.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm text-gray-600 mb-2">Communication Overhead</div>
                    <Progress 
                      value={(swarm.communicationOverhead / 50) * 100}
                      className={swarm.communicationOverhead > 25 ? 'bg-yellow-500' : ''}
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      ${swarm.communicationOverhead.toFixed(2)} overhead cost
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <div className="space-y-4">
            {alerts.map(alert => (
              <Alert 
                key={alert.id} 
                variant={alert.severity === 'critical' ? 'destructive' : 'default'}
                className={alert.acknowledged ? 'opacity-50' : ''}
              >
                <AlertTriangle className="h-4 w-4" />
                <div className="flex-1">
                  <AlertTitle className="flex justify-between items-center">
                    {alert.title}
                    <Badge className={getAlertSeverityColor(alert.severity)}>
                      {alert.severity.toUpperCase()}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription className="flex justify-between items-center mt-2">
                    <span>{alert.message}</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500">
                        {new Date(alert.timestamp).toLocaleString()}
                      </span>
                      {!alert.acknowledged && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAcknowledgeAlert(alert.id)}
                        >
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </AlertDescription>
                </div>
              </Alert>
            ))}
            {alerts.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No alerts to display
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="flex justify-between items-center text-sm text-gray-500">
        <div>Last updated: {lastUpdate.toLocaleString()}</div>
        <div>Auto-refresh: {autoRefresh ? 'Enabled' : 'Disabled'}</div>
      </div>
    </div>
  );
};

export default CircuitBreakerDashboard;