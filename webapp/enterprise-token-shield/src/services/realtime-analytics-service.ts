/**
 * Token Shield Enterprise - Real-time Analytics Service
 * 
 * WebSocket-based real-time analytics and monitoring for multi-agent cost tracking
 */

import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { MultiAgentCostController, MultiAgentCostEvent } from './multi-agent-cost-controller';
import { PredictiveAnalyticsService } from './predictive-analytics-service';

export interface RealtimeMetrics {
  timestamp: Date;
  totalAgents: number;
  activeAgents: number;
  circuitBreakers: {
    closed: number;
    open: number;
    halfOpen: number;
  };
  costMetrics: {
    totalCost: number;
    hourlyCost: number;
    dailyCost: number;
    projectedMonthlyCost: number;
    costPerSecond: number;
  };
  tokenMetrics: {
    totalTokens: number;
    tokensPerSecond: number;
    averageTokensPerRequest: number;
    tokenEfficiency: number;
  };
  systemHealth: {
    status: 'healthy' | 'degraded' | 'critical';
    score: number;
    issues: string[];
  };
}

export interface LiveStreamEvent {
  id: string;
  type: 'metric_update' | 'circuit_breaker_event' | 'cost_threshold' | 'agent_lifecycle' | 'system_health';
  timestamp: Date;
  data: any;
  metadata?: Record<string, any>;
}

export interface ClientSubscription {
  id: string;
  clientId: string;
  filters: {
    agentIds?: string[];
    swarmIds?: string[];
    eventTypes?: string[];
    severityLevels?: string[];
  };
  createdAt: Date;
  lastActivityAt: Date;
}

export interface DashboardConfig {
  refreshInterval: number;
  metricsRetention: number;
  maxConnections: number;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  alerts: {
    enabled: boolean;
    thresholds: {
      costSpike: number;
      failureRate: number;
      responseTime: number;
    };
  };
}

export class RealtimeAnalyticsService extends EventEmitter {
  private costController: MultiAgentCostController;
  private predictiveService: PredictiveAnalyticsService;
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();
  private subscriptions: Map<string, ClientSubscription> = new Map();
  private metricsHistory: RealtimeMetrics[] = [];
  private eventHistory: LiveStreamEvent[] = [];
  private isRunning: boolean = false;
  private updateInterval?: NodeJS.Timeout;
  private config: DashboardConfig;

  constructor(
    costController: MultiAgentCostController,
    predictiveService: PredictiveAnalyticsService,
    port: number = 8080,
    config?: Partial<DashboardConfig>
  ) {
    super();
    
    this.costController = costController;
    this.predictiveService = predictiveService;
    
    this.config = {
      refreshInterval: 1000,
      metricsRetention: 3600000, // 1 hour
      maxConnections: 100,
      rateLimit: {
        windowMs: 60000,
        maxRequests: 1000,
      },
      alerts: {
        enabled: true,
        thresholds: {
          costSpike: 1.5,
          failureRate: 0.1,
          responseTime: 5000,
        },
      },
      ...config,
    };

    this.wss = new WebSocketServer({ port });
    this.setupWebSocketServer();
  }

  /**
   * Start the real-time analytics service
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    
    // Start metrics collection
    this.startMetricsCollection();
    
    // Setup cost controller event listeners
    this.setupCostControllerListeners();
    
    console.log(`🔥 Real-time Analytics Service started on port ${this.wss.options.port}`);
    this.emit('started');
  }

  /**
   * Stop the real-time analytics service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    
    // Stop metrics collection
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    // Close all client connections
    this.clients.forEach((ws, clientId) => {
      ws.close();
      this.clients.delete(clientId);
    });
    
    // Close WebSocket server
    this.wss.close();
    
    console.log('🔥 Real-time Analytics Service stopped');
    this.emit('stopped');
  }

  /**
   * Get current real-time metrics
   */
  getCurrentMetrics(): RealtimeMetrics {
    return this.metricsHistory[this.metricsHistory.length - 1] || this.generateInitialMetrics();
  }

  /**
   * Get metrics history for a time range
   */
  getMetricsHistory(startTime: Date, endTime: Date): RealtimeMetrics[] {
    return this.metricsHistory.filter(metric => 
      metric.timestamp >= startTime && metric.timestamp <= endTime
    );
  }

  /**
   * Get recent events
   */
  getRecentEvents(count: number = 100): LiveStreamEvent[] {
    return this.eventHistory.slice(-count);
  }

  /**
   * Get system health status
   */
  getSystemHealth(): RealtimeMetrics['systemHealth'] {
    const currentMetrics = this.getCurrentMetrics();
    return currentMetrics.systemHealth;
  }

  /**
   * Subscribe to real-time updates
   */
  subscribe(clientId: string, filters: ClientSubscription['filters']): string {
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const subscription: ClientSubscription = {
      id: subscriptionId,
      clientId,
      filters,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.subscriptions.set(subscriptionId, subscription);
    
    // Send initial data burst
    this.sendInitialData(clientId, filters);
    
    console.log(`📊 Client ${clientId} subscribed with filters:`, filters);
    this.emit('subscribed', { clientId, subscriptionId, filters });
    
    return subscriptionId;
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.subscriptions.delete(subscriptionId);
      console.log(`📊 Client ${subscription.clientId} unsubscribed`);
      this.emit('unsubscribed', { clientId: subscription.clientId, subscriptionId });
    }
  }

  /**
   * Setup WebSocket server
   */
  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws, request) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (this.clients.size >= this.config.maxConnections) {
        ws.close(1013, 'Server at capacity');
        return;
      }

      this.clients.set(clientId, ws);
      console.log(`🔗 Client connected: ${clientId}`);

      // Send welcome message
      this.sendToClient(clientId, {
        id: `welcome_${Date.now()}`,
        type: 'system_message',
        timestamp: new Date(),
        data: {
          message: 'Connected to Token Shield Real-time Analytics',
          clientId,
          serverTime: new Date().toISOString(),
        },
      });

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(clientId, message);
        } catch (error) {
          console.error('❌ Invalid message from client:', error);
        }
      });

      // Handle client disconnection
      ws.on('close', () => {
        this.handleClientDisconnect(clientId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ WebSocket error for client ${clientId}:`, error);
      });

      this.emit('client_connected', { clientId });
    });
  }

  /**
   * Handle client messages
   */
  private handleClientMessage(clientId: string, message: any): void {
    const { type, data } = message;

    switch (type) {
      case 'subscribe':
        this.subscribe(clientId, data.filters);
        break;
        
      case 'unsubscribe':
        this.unsubscribe(data.subscriptionId);
        break;
        
      case 'get_metrics':
        this.sendMetricsToClient(clientId);
        break;
        
      case 'get_history':
        this.sendHistoryToClient(clientId, data.startTime, data.endTime);
        break;
        
      default:
        console.warn(`⚠️ Unknown message type from client ${clientId}:`, type);
    }
  }

  /**
   * Handle client disconnection
   */
  private handleClientDisconnect(clientId: string): void {
    // Remove client from active clients
    this.clients.delete(clientId);
    
    // Remove all subscriptions for this client
    const clientSubscriptions = Array.from(this.subscriptions.entries())
      .filter(([_, sub]) => sub.clientId === clientId)
      .map(([subId, _]) => subId);
    
    clientSubscriptions.forEach(subId => {
      this.subscriptions.delete(subId);
    });

    console.log(`🔌 Client disconnected: ${clientId}`);
    this.emit('client_disconnected', { clientId });
  }

  /**
   * Setup cost controller event listeners
   */
  private setupCostControllerListeners(): void {
    // Listen to cost events from the cost controller
    this.costController.on('cost_event', (event: MultiAgentCostEvent) => {
      this.processCostEvent(event);
    });

    // Listen to circuit breaker events
    this.costController.on('circuit_breaker_trip', (data: any) => {
      this.broadcastEvent({
        id: `cb_trip_${Date.now()}`,
        type: 'circuit_breaker_event',
        timestamp: new Date(),
        data,
      });
    });

    // Listen to agent lifecycle events
    this.costController.on('agent_created', (agent: any) => {
      this.broadcastEvent({
        id: `agent_created_${Date.now()}`,
        type: 'agent_lifecycle',
        timestamp: new Date(),
        data: { agentId: agent.id, agentName: agent.name, event: 'created' },
      });
    });

    this.costController.on('agent_destroyed', (agentId: string) => {
      this.broadcastEvent({
        id: `agent_destroyed_${Date.now()}`,
        type: 'agent_lifecycle',
        timestamp: new Date(),
        data: { agentId, event: 'destroyed' },
      });
    });
  }

  /**
   * Process cost events and generate analytics
   */
  private processCostEvent(event: MultiAgentCostEvent): void {
    // Analyze cost patterns
    this.analyzeCostPatterns(event);
    
    // Check for cost anomalies
    this.checkCostAnomalies(event);
    
    // Update event history
    const streamEvent: LiveStreamEvent = {
      id: `cost_${Date.now()}`,
      type: 'metric_update',
      timestamp: new Date(),
      data: event,
    };
    
    this.eventHistory.push(streamEvent);
    
    // Keep only recent events
    if (this.eventHistory.length > 10000) {
      this.eventHistory = this.eventHistory.slice(-10000);
    }

    // Broadcast to relevant clients
    this.broadcastEvent(streamEvent);
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.updateInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.refreshInterval);

    // Initial metrics collection
    this.collectMetrics();
  }

  /**
   * Collect current metrics
   */
  private collectMetrics(): void {
    const metrics = this.generateMetrics();
    
    // Store in history
    this.metricsHistory.push(metrics);
    
    // Keep only recent metrics
    const cutoffTime = new Date(Date.now() - this.config.metricsRetention);
    this.metricsHistory = this.metricsHistory.filter(m => m.timestamp >= cutoffTime);

    // Broadcast to all clients
    this.broadcastMetrics(metrics);
  }

  /**
   * Generate current metrics
   */
  private generateMetrics(): RealtimeMetrics {
    const now = new Date();
    
    // Get data from cost controller
    const agents = Array.from((this.costController as any).agents?.values() || []);
    const circuitBreakers = agents.map((agent: any) => agent.circuitBreaker);
    
    const totalAgents = agents.length;
    const activeAgents = agents.filter((agent: any) => agent.status === 'active').length;
    
    const closedBreakers = circuitBreakers.filter((cb: any) => cb.state === 'closed').length;
    const openBreakers = circuitBreakers.filter((cb: any) => cb.state === 'open').length;
    const halfOpenBreakers = circuitBreakers.filter((cb: any) => cb.state === 'half-open').length;

    // Calculate cost metrics
    const totalCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.total || 0), 0);
    const hourlyCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.hourly?.cost || 0), 0);
    const dailyCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.daily?.cost || 0), 0);
    const projectedMonthlyCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.projectedMonthlyCost || 0), 0);

    // Calculate token metrics
    const totalTokens = agents.reduce((sum: number, agent: any) => sum + agent.tokensUsed, 0);
    const tokensPerSecond = totalTokens / (this.config.refreshInterval / 1000);
    const averageTokensPerRequest = totalTokens / Math.max(1, agents.reduce((sum: number, agent: any) => sum + (agent.circuitBreaker?.metrics?.totalCalls || 0), 0));
    const tokenEfficiency = agents.length > 0 ? agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.costEfficiency || 0), 0) / agents.length : 0;

    // Determine system health
    const systemHealth = this.calculateSystemHealth({
      openBreakers,
      totalAgents,
      failureRate: openBreakers / Math.max(1, totalAgents),
      averageResponseTime: agents.reduce((sum: number, agent: any) => sum + (agent.circuitBreaker?.metrics?.averageResponseTime || 0), 0) / Math.max(1, agents.length),
    });

    return {
      timestamp: now,
      totalAgents,
      activeAgents,
      circuitBreakers: {
        closed: closedBreakers,
        open: openBreakers,
        halfOpen: halfOpenBreakers,
      },
      costMetrics: {
        totalCost,
        hourlyCost,
        dailyCost,
        projectedMonthlyCost,
        costPerSecond: totalCost / (this.config.metricsRetention / 1000),
      },
      tokenMetrics: {
        totalTokens,
        tokensPerSecond,
        averageTokensPerRequest,
        tokenEfficiency,
      },
      systemHealth,
    };
  }

  /**
   * Generate initial metrics
   */
  private generateInitialMetrics(): RealtimeMetrics {
    return {
      timestamp: new Date(),
      totalAgents: 0,
      activeAgents: 0,
      circuitBreakers: { closed: 0, open: 0, halfOpen: 0 },
      costMetrics: { totalCost: 0, hourlyCost: 0, dailyCost: 0, projectedMonthlyCost: 0, costPerSecond: 0 },
      tokenMetrics: { totalTokens: 0, tokensPerSecond: 0, averageTokensPerRequest: 0, tokenEfficiency: 0 },
      systemHealth: { status: 'healthy', score: 100, issues: [] },
    };
  }

  /**
   * Calculate system health
   */
  private calculateSystemHealth(metrics: {
    openBreakers: number;
    totalAgents: number;
    failureRate: number;
    averageResponseTime: number;
  }): RealtimeMetrics['systemHealth'] {
    let score = 100;
    const issues: string[] = [];

    // Check circuit breaker health
    if (metrics.openBreakers > 0) {
      score -= metrics.openBreakers * 10;
      issues.push(`${metrics.openBreakers} circuit breakers are open`);
    }

    // Check failure rate
    if (metrics.failureRate > this.config.alerts.thresholds.failureRate) {
      score -= 20;
      issues.push(`High failure rate: ${(metrics.failureRate * 100).toFixed(1)}%`);
    }

    // Check response time
    if (metrics.averageResponseTime > this.config.alerts.thresholds.responseTime) {
      score -= 15;
      issues.push(`High average response time: ${metrics.averageResponseTime}ms`);
    }

    // Determine status
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (score < 70) status = 'degraded';
    if (score < 40) status = 'critical';

    return { status, score: Math.max(0, score), issues };
  }

  /**
   * Analyze cost patterns
   */
  private analyzeCostPatterns(event: MultiAgentCostEvent): void {
    // This would implement sophisticated cost pattern analysis
    // For now, just emit a basic analysis event
    if (this.config.alerts.enabled) {
      const costSpike = event.cost > 10; // Arbitrary threshold
      if (costSpike) {
        this.broadcastEvent({
          id: `cost_spike_${Date.now()}`,
          type: 'cost_threshold',
          timestamp: new Date(),
          data: {
            agentId: event.agentId,
            cost: event.cost,
            message: 'High cost detected',
          },
        });
      }
    }
  }

  /**
   * Check for cost anomalies
   */
  private checkCostAnomalies(event: MultiAgentCostEvent): void {
    // This would implement anomaly detection using the predictive service
    // For now, just log the event
    if (this.predictiveService) {
      // Predictive analysis would go here
      this.predictiveService.analyzeEvent(event).catch(error => {
        console.error('Error analyzing event:', error);
      });
    }
  }

  /**
   * Send initial data to client
   */
  private sendInitialData(clientId: string, filters: ClientSubscription['filters']): void {
    const currentMetrics = this.getCurrentMetrics();
    
    this.sendToClient(clientId, {
      id: `initial_${Date.now()}`,
      type: 'initial_data',
      timestamp: new Date(),
      data: {
        metrics: currentMetrics,
        recentEvents: this.getRecentEvents(50),
        subscriptions: Array.from(this.subscriptions.values()).filter(sub => sub.clientId === clientId),
      },
    });
  }

  /**
   * Send metrics to specific client
   */
  private sendMetricsToClient(clientId: string): void {
    const metrics = this.getCurrentMetrics();
    
    this.sendToClient(clientId, {
      id: `metrics_${Date.now()}`,
      type: 'metrics_update',
      timestamp: new Date(),
      data: metrics,
    });
  }

  /**
   * Send history to client
   */
  private sendHistoryToClient(clientId: string, startTime: Date, endTime: Date): void {
    const history = this.getMetricsHistory(startTime, endTime);
    
    this.sendToClient(clientId, {
      id: `history_${Date.now()}`,
      type: 'history_data',
      timestamp: new Date(),
      data: { history },
    });
  }

  /**
   * Broadcast metrics to all clients
   */
  private broadcastMetrics(metrics: RealtimeMetrics): void {
    this.broadcastEvent({
      id: `broadcast_${Date.now()}`,
      type: 'metric_update',
      timestamp: new Date(),
      data: metrics,
    });
  }

  /**
   * Broadcast event to relevant clients
   */
  private broadcastEvent(event: LiveStreamEvent): void {
    this.subscriptions.forEach((subscription, subscriptionId) => {
      const client = this.clients.get(subscription.clientId);
      if (!client || client.readyState !== WebSocket.OPEN) return;

      // Check if event matches subscription filters
      if (this.shouldSendEvent(event, subscription.filters)) {
        this.sendToClient(subscription.clientId, event);
      }
    });
  }

  /**
   * Check if event should be sent based on filters
   */
  private shouldSendEvent(event: LiveStreamEvent, filters: ClientSubscription['filters']): boolean {
    if (!filters || Object.keys(filters).length === 0) return true;

    // Check event type filter
    if (filters.eventTypes && !filters.eventTypes.includes(event.type)) {
      return false;
    }

    // Check severity filter (for alerts)
    if (filters.severityLevels && event.data?.severity) {
      if (!filters.severityLevels.includes(event.data.severity)) {
        return false;
      }
    }

    // Check agent ID filter
    if (filters.agentIds && event.data?.agentId) {
      if (!filters.agentIds.includes(event.data.agentId)) {
        return false;
      }
    }

    // Check swarm ID filter
    if (filters.swarmIds && event.data?.swarmId) {
      if (!filters.swarmIds.includes(event.data.swarmId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Send data to specific client
   */
  private sendToClient(clientId: string, data: any): void {
    const client = this.clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}

export default RealtimeAnalyticsService;