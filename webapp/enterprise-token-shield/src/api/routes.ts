/**
 * Token Shield Enterprise - API Routes
 * 
 * REST API endpoints for circuit breaker dashboard and real-time analytics
 */

import { Router, Request, Response } from 'express';
import { MultiAgentCostController } from '../services/multi-agent-cost-controller';
import { RealtimeAnalyticsService } from '../services/realtime-analytics-service';
import { PredictiveAnalyticsService } from '../services/predictive-analytics-service';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
  requestId: string;
}

export class CircuitBreakerApi {
  private router: Router;
  private costController: MultiAgentCostController;
  private realtimeService: RealtimeAnalyticsService;
  private predictiveService: PredictiveAnalyticsService;

  constructor(
    costController: MultiAgentCostController,
    realtimeService: RealtimeAnalyticsService,
    predictiveService: PredictiveAnalyticsService
  ) {
    this.router = Router();
    this.costController = costController;
    this.realtimeService = realtimeService;
    this.predictiveService = predictiveService;
    this.setupRoutes();
  }

  /**
   * Get the Express router
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.router.get('/health', this.healthCheck.bind(this));
    
    // Circuit breaker endpoints
    this.router.get('/circuit-breakers', this.getCircuitBreakers.bind(this));
    this.router.get('/circuit-breakers/:agentId', this.getCircuitBreaker.bind(this));
    this.router.post('/circuit-breakers/:agentId/reset', this.resetCircuitBreaker.bind(this));
    
    // Agent endpoints
    this.router.get('/agents', this.getAgents.bind(this));
    this.router.get('/agents/:agentId', this.getAgent.bind(this));
    this.router.get('/agents/:agentId/analytics', this.getAgentAnalytics.bind(this));
    this.router.get('/agents/:agentId/costs', this.getAgentCosts.bind(this));
    
    // Swarm endpoints
    this.router.get('/swarms', this.getSwarms.bind(this));
    this.router.get('/swarms/:swarmId', this.getSwarm.bind(this));
    this.router.get('/swarms/:swarmId/analytics', this.getSwarmAnalytics.bind(this));
    
    // Cost tracking endpoints
    this.router.get('/costs', this.getCosts.bind(this));
    this.router.get('/costs/summary', this.getCostSummary.bind(this));
    this.router.get('/costs/trends', this.getCostTrends.bind(this));
    
    // Real-time analytics endpoints
    this.router.get('/analytics/realtime', this.getRealtimeMetrics.bind(this));
    this.router.get('/analytics/history', this.getAnalyticsHistory.bind(this));
    this.router.get('/analytics/predictions', this.getPredictions.bind(this));
    
    // Alert endpoints
    this.router.get('/alerts', this.getAlerts.bind(this));
    this.router.post('/alerts/:alertId/acknowledge', this.acknowledgeAlert.bind(this));
    
    // Optimization endpoints
    this.router.get('/optimizations', this.getOptimizations.bind(this));
    this.router.post('/optimizations/apply', this.applyOptimization.bind(this));
  }

  /**
   * Health check endpoint
   */
  private healthCheck(req: Request, res: Response): void {
    const response: ApiResponse = {
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          costController: this.costController ? 'connected' : 'disconnected',
          realtimeService: this.realtimeService ? 'connected' : 'disconnected',
          predictiveService: this.predictiveService ? 'connected' : 'disconnected',
        },
        uptime: process.uptime(),
      },
      timestamp: new Date(),
      requestId: this.generateRequestId(),
    };
    
    res.json(response);
  }

  /**
   * Get all circuit breakers
   */
  private async getCircuitBreakers(req: Request, res: Response): Promise<void> {
    try {
      // Get circuit breakers from cost controller
      const agents = Array.from((this.costController as any).agents?.values() || []);
      const circuitBreakers = agents.map((agent: any) => ({
        id: agent.circuitBreaker.id,
        agentId: agent.id,
        agentName: agent.name,
        state: agent.circuitBreaker.state,
        failureCount: agent.circuitBreaker.failureCount,
        successCount: agent.circuitBreaker.successCount,
        failureRate: agent.circuitBreaker.failureCount / Math.max(1, agent.circuitBreaker.failureCount + agent.circuitBreaker.successCount),
        tripThreshold: agent.circuitBreaker.tripThreshold,
        resetTimeout: agent.circuitBreaker.resetTimeout,
        currentHalfOpenCalls: agent.circuitBreaker.currentHalfOpenCalls,
        halfOpenMaxCalls: agent.circuitBreaker.halfOpenMaxCalls,
        metrics: agent.circuitBreaker.metrics,
        lastTripAt: agent.circuitBreaker.lastFailureAt,
        lastResetAt: agent.circuitBreaker.lastSuccessAt,
      }));

      const response: ApiResponse = {
        success: true,
        data: circuitBreakers,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch circuit breakers', error);
    }
  }

  /**
   * Get specific circuit breaker
   */
  private async getCircuitBreaker(req: Request, res: Response): Promise<void> {
    try {
      const { agentId } = req.params;
      const agent = (this.costController as any).agents?.get(agentId);
      
      if (!agent) {
        this.sendError(res, 'Agent not found', null, 404);
        return;
      }

      const circuitBreaker = {
        id: agent.circuitBreaker.id,
        agentId: agent.id,
        agentName: agent.name,
        state: agent.circuitBreaker.state,
        failureCount: agent.circuitBreaker.failureCount,
        successCount: agent.circuitBreaker.successCount,
        failureRate: agent.circuitBreaker.failureCount / Math.max(1, agent.circuitBreaker.failureCount + agent.circuitBreaker.successCount),
        tripThreshold: agent.circuitBreaker.tripThreshold,
        resetTimeout: agent.circuitBreaker.resetTimeout,
        currentHalfOpenCalls: agent.circuitBreaker.currentHalfOpenCalls,
        halfOpenMaxCalls: agent.circuitBreaker.halfOpenMaxCalls,
        metrics: agent.circuitBreaker.metrics,
        lastTripAt: agent.circuitBreaker.lastFailureAt,
        lastResetAt: agent.circuitBreaker.lastSuccessAt,
      };

      const response: ApiResponse = {
        success: true,
        data: circuitBreaker,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch circuit breaker', error);
    }
  }

  /**
   * Reset circuit breaker
   */
  private async resetCircuitBreaker(req: Request, res: Response): Promise<void> {
    try {
      const { agentId } = req.params;
      
      // Update circuit breaker state
      await this.costController.updateCircuitBreaker(agentId, true);
      
      const response: ApiResponse = {
        success: true,
        data: { message: 'Circuit breaker reset successfully' },
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to reset circuit breaker', error);
    }
  }

  /**
   * Get all agents
   */
  private async getAgents(req: Request, res: Response): Promise<void> {
    try {
      const agents = Array.from((this.costController as any).agents?.values() || []);
      const agentSummaries = agents.map((agent: any) => ({
        id: agent.id,
        name: agent.name,
        userId: agent.userId,
        organizationId: agent.organizationId,
        projectId: agent.projectId,
        teamId: agent.teamId,
        agentType: agent.agentType,
        modelTier: agent.modelTier,
        status: agent.status,
        tokenQuota: agent.tokenQuota,
        tokensUsed: agent.tokensUsed,
        tokensReserved: agent.tokensReserved,
        maxTokensPerHour: agent.maxTokensPerHour,
        maxTokensPerDay: agent.maxTokensPerDay,
        maxTokensPerMonth: agent.maxTokensPerMonth,
        maxConversations: agent.maxConversations,
        maxConcurrentRequests: agent.maxConcurrentRequests,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        lastActivityAt: agent.lastActivityAt,
      }));

      const response: ApiResponse = {
        success: true,
        data: agentSummaries,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch agents', error);
    }
  }

  /**
   * Get specific agent
   */
  private async getAgent(req: Request, res: Response): Promise<void> {
    try {
      const { agentId } = req.params;
      const agent = (this.costController as any).agents?.get(agentId);
      
      if (!agent) {
        this.sendError(res, 'Agent not found', null, 404);
        return;
      }

      const agentSummary = {
        id: agent.id,
        name: agent.name,
        userId: agent.userId,
        organizationId: agent.organizationId,
        projectId: agent.projectId,
        teamId: agent.teamId,
        agentType: agent.agentType,
        modelTier: agent.modelTier,
        status: agent.status,
        tokenQuota: agent.tokenQuota,
        tokensUsed: agent.tokensUsed,
        tokensReserved: agent.tokensReserved,
        maxTokensPerHour: agent.maxTokensPerHour,
        maxTokensPerDay: agent.maxTokensPerDay,
        maxTokensPerMonth: agent.maxTokensPerMonth,
        maxConversations: agent.maxConversations,
        maxConcurrentRequests: agent.maxConcurrentRequests,
        circuitBreaker: agent.circuitBreaker,
        costTracking: agent.costTracking,
        optimization: agent.optimization,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        lastActivityAt: agent.lastActivityAt,
      };

      const response: ApiResponse = {
        success: true,
        data: agentSummary,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch agent', error);
    }
  }

  /**
   * Get agent analytics
   */
  private async getAgentAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { agentId } = req.params;
      const { startTime, endTime } = req.query;
      
      const timeRange = {
        start: startTime ? new Date(startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: endTime ? new Date(endTime as string) : new Date(),
      };

      const analytics = await this.costController.getAgentAnalytics(agentId, timeRange);

      const response: ApiResponse = {
        success: true,
        data: analytics,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch agent analytics', error);
    }
  }

  /**
   * Get agent costs
   */
  private async getAgentCosts(req: Request, res: Response): Promise<void> {
    try {
      const { agentId } = req.params;
      const agent = (this.costController as any).agents?.get(agentId);
      
      if (!agent) {
        this.sendError(res, 'Agent not found', null, 404);
        return;
      }

      const costs = {
        total: agent.costTracking.total,
        hourly: agent.costTracking.hourly,
        daily: agent.costTracking.daily,
        weekly: agent.costTracking.weekly,
        monthly: agent.costTracking.monthly,
        averageCostPerToken: agent.costTracking.averageCostPerToken,
        costEfficiency: agent.costTracking.costEfficiency,
        projectedMonthlyCost: agent.costTracking.projectedMonthlyCost,
      };

      const response: ApiResponse = {
        success: true,
        data: costs,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch agent costs', error);
    }
  }

  /**
   * Get all swarms
   */
  private async getSwarms(req: Request, res: Response): Promise<void> {
    try {
      const swarms = Array.from((this.costController as any).swarms?.values() || []);
      const swarmSummaries = swarms.map((swarm: any) => ({
        id: swarm.id,
        name: swarm.name,
        agents: swarm.agents,
        coordinatorAgent: swarm.coordinatorAgent,
        swarmType: swarm.swarmType,
        maxAgents: swarm.maxAgents,
        interAgentCommunication: swarm.interAgentCommunication,
        sharedMemory: swarm.sharedMemory,
        collectiveDecisionMaking: swarm.collectiveDecisionMaking,
        totalTokensUsed: swarm.totalTokensUsed,
        totalCost: swarm.totalCost,
        averageTokensPerAgent: swarm.averageTokensPerAgent,
        communicationOverhead: swarm.communicationOverhead,
        efficiency: swarm.efficiency,
        createdAt: swarm.createdAt,
        updatedAt: swarm.updatedAt,
      }));

      const response: ApiResponse = {
        success: true,
        data: swarmSummaries,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch swarms', error);
    }
  }

  /**
   * Get specific swarm
   */
  private async getSwarm(req: Request, res: Response): Promise<void> {
    try {
      const { swarmId } = req.params;
      const swarm = (this.costController as any).swarms?.get(swarmId);
      
      if (!swarm) {
        this.sendError(res, 'Swarm not found', null, 404);
        return;
      }

      const swarmSummary = {
        id: swarm.id,
        name: swarm.name,
        agents: swarm.agents,
        coordinatorAgent: swarm.coordinatorAgent,
        swarmType: swarm.swarmType,
        maxAgents: swarm.maxAgents,
        interAgentCommunication: swarm.interAgentCommunication,
        sharedMemory: swarm.sharedMemory,
        collectiveDecisionMaking: swarm.collectiveDecisionMaking,
        totalTokensUsed: swarm.totalTokensUsed,
        totalCost: swarm.totalCost,
        averageTokensPerAgent: swarm.averageTokensPerAgent,
        communicationOverhead: swarm.communicationOverhead,
        efficiency: swarm.efficiency,
        createdAt: swarm.createdAt,
        updatedAt: swarm.updatedAt,
      };

      const response: ApiResponse = {
        success: true,
        data: swarmSummary,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch swarm', error);
    }
  }

  /**
   * Get swarm analytics
   */
  private async getSwarmAnalytics(req: Request, res:Response): Promise<void> {
    try {
      const { swarmId } = req.params;
      const { startTime, endTime } = req.query;
      
      const timeRange = {
        start: startTime ? new Date(startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: endTime ? new Date(endTime as string) : new Date(),
      };

      // Get swarm data
      const swarm = (this.costController as any).swarms?.get(swarmId);
      if (!swarm) {
        this.sendError(res, 'Swarm not found', null, 404);
        return;
      }

      // Calculate swarm analytics
      const analytics = {
        swarmId: swarm.id,
        swarmName: swarm.name,
        timeRange,
        totalAgents: swarm.agents.length,
        totalTokens: swarm.totalTokensUsed,
        totalCost: swarm.totalCost,
        averageTokensPerAgent: swarm.averageTokensPerAgent,
        communicationOverhead: swarm.communicationOverhead,
        efficiency: swarm.efficiency,
        agents: swarm.agents.map((agentId: string) => {
          const agent = (this.costController as any).agents?.get(agentId);
          return agent ? {
            id: agent.id,
            name: agent.name,
            tokensUsed: agent.tokensUsed,
            totalCost: agent.costTracking.total,
            efficiency: agent.costTracking.costEfficiency,
            status: agent.status,
          } : null;
        }).filter(Boolean),
      };

      const response: ApiResponse = {
        success: true,
        data: analytics,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch swarm analytics', error);
    }
  }

  /**
   * Get costs summary
   */
  private async getCosts(req: Request, res: Response): Promise<void> {
    try {
      const agents = Array.from((this.costController as any).agents?.values() || []);
      const totalCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.total || 0), 0);
      const totalTokens = agents.reduce((sum: number, agent: any) => sum + agent.tokensUsed, 0);
      const hourlyCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.hourly?.cost || 0), 0);
      const dailyCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.daily?.cost || 0), 0);
      const projectedMonthlyCost = agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.projectedMonthlyCost || 0), 0);

      const costs = {
        totalCost,
        totalTokens,
        hourlyCost,
        dailyCost,
        projectedMonthlyCost,
        averageCostPerToken: totalCost / Math.max(1, totalTokens),
        costEfficiency: agents.length > 0 ? agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.costEfficiency || 0), 0) / agents.length : 0,
        agents: agents.length,
      };

      const response: ApiResponse = {
        success: true,
        data: costs,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch costs', error);
    }
  }

  /**
   * Get cost summary
   */
  private async getCostSummary(req: Request, res: Response): Promise<void> {
    try {
      const agents = Array.from((this.costController as any).agents?.values() || []);
      const summary = {
        totalAgents: agents.length,
        activeAgents: agents.filter((agent: any) => agent.status === 'active').length,
        totalCost: agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.total || 0), 0),
        totalTokens: agents.reduce((sum: number, agent: any) => sum + agent.tokensUsed, 0),
        hourlyCost: agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.hourly?.cost || 0), 0),
        dailyCost: agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.daily?.cost || 0), 0),
        projectedMonthlyCost: agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.projectedMonthlyCost || 0), 0),
        averageEfficiency: agents.length > 0 ? agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.costEfficiency || 0), 0) / agents.length : 0,
      };

      const response: ApiResponse = {
        success: true,
        data: summary,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch cost summary', error);
    }
  }

  /**
   * Get cost trends
   */
  private async getCostTrends(req: Request, res: Response): Promise<void> {
    try {
      const { timeRange = '24h' } = req.query;
      
      // Generate mock trend data
      const intervals = timeRange === '1h' ? 12 : timeRange === '6h' ? 24 : timeRange === '24h' ? 48 : 168;
      const trends = [];
      
      for (let i = 0; i < intervals; i++) {
        const timestamp = new Date(Date.now() - (i * (24 * 60 * 60 * 1000) / intervals));
        const cost = Math.random() * 100 + 50; // Mock cost data
        const tokens = Math.random() * 10000 + 5000; // Mock token data
        const efficiency = Math.random() * 20 + 70; // Mock efficiency data
        
        trends.push({
          timestamp,
          cost,
          tokens,
          efficiency,
        });
      }

      const response: ApiResponse = {
        success: true,
        data: trends.reverse(),
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch cost trends', error);
    }
  }

  /**
   * Get real-time metrics
   */
  private async getRealtimeMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = this.realtimeService.getCurrentMetrics();

      const response: ApiResponse = {
        success: true,
        data: metrics,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch real-time metrics', error);
    }
  }

  /**
   * Get analytics history
   */
  private async getAnalyticsHistory(req: Request, res: Response): Promise<void> {
    try {
      const { startTime, endTime } = req.query;
      
      const start = startTime ? new Date(startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = endTime ? new Date(endTime as string) : new Date();

      const history = this.realtimeService.getMetricsHistory(start, end);

      const response: ApiResponse = {
        success: true,
        data: history,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch analytics history', error);
    }
  }

  /**
   * Get predictions
   */
  private async getPredictions(req: Request, res: Response): Promise<void> {
    try {
      const { agentId, horizon = '24h' } = req.query;
      
      let predictions;
      if (agentId) {
        predictions = await this.predictiveService.predictAgentCosts(agentId as string, horizon as string);
      } else {
        predictions = await this.predictiveService.predictSystemCosts(horizon as string);
      }

      const response: ApiResponse = {
        success: true,
        data: predictions,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch predictions', error);
    }
  }

  /**
   * Get alerts
   */
  private async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const { acknowledged = 'false', severity } = req.query;
      
      // Get recent events from realtime service
      const recentEvents = this.realtimeService.getRecentEvents(100);
      const alerts = recentEvents
        .filter(event => event.type === 'cost_threshold' || event.type === 'circuit_breaker_event')
        .map(event => ({
          id: event.id,
          type: event.type === 'cost_threshold' ? 'cost_threshold_hit' : 'circuit_breaker_trip',
          severity: event.data?.severity || 'medium',
          title: event.type === 'cost_threshold' ? 'Cost Threshold Hit' : 'Circuit Breaker Trip',
          message: event.data?.message || 'Event occurred',
          timestamp: event.timestamp,
          agentId: event.data?.agentId,
          swarmId: event.data?.swarmId,
          acknowledged: false, // Simplified for now
        }));

      // Filter by acknowledged status
      let filteredAlerts = alerts;
      if (acknowledged === 'false') {
        filteredAlerts = alerts.filter(alert => !alert.acknowledged);
      }
      
      // Filter by severity if provided
      if (severity) {
        filteredAlerts = filteredAlerts.filter(alert => alert.severity === severity);
      }

      const response: ApiResponse = {
        success: true,
        data: filteredAlerts,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch alerts', error);
    }
  }

  /**
   * Acknowledge alert
   */
  private async acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
      const { alertId } = req.params;
      
      // In a real implementation, this would update the alert status
      // For now, just return success
      const response: ApiResponse = {
        success: true,
        data: { message: 'Alert acknowledged successfully' },
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to acknowledge alert', error);
    }
  }

  /**
   * Get optimization recommendations
   */
  private async getOptimizations(req: Request, res: Response): Promise<void> {
    try {
      const { agentId, type } = req.query;
      
      let optimizations;
      if (agentId) {
        const agent = (this.costController as any).agents?.get(agentId);
        if (agent) {
          optimizations = await this.costController.getAgentAnalytics(agentId, {
            start: new Date(Date.now() - 24 * 60 * 60 * 1000),
            end: new Date(),
          });
          optimizations = optimizations?.optimizations || [];
        }
      } else {
        // Get system-wide optimizations
        const agents = Array.from((this.costController as any).agents?.values() || []);
        const allOptimizations = [];
        for (const agent of agents) {
          const agentOptimizations = await this.costController.getAgentAnalytics(agent.id, {
            start: new Date(Date.now() - 24 * 60 * 60 * 1000),
            end: new Date(),
          });
          if (agentOptimizations?.optimizations) {
            allOptimizations.push(...agentOptimizations.optimizations);
          }
        }
        optimizations = allOptimizations;
      }

      // Filter by type if provided
      if (type) {
        optimizations = optimizations.filter((opt: any) => opt.type === type);
      }

      const response: ApiResponse = {
        success: true,
        data: optimizations,
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to fetch optimizations', error);
    }
  }

  /**
   * Apply optimization
   */
  private async applyOptimization(req: Request, res: Response): Promise<void> {
    try {
      const { agentId, optimizationType } = req.body;
      
      const result = await this.costController.applyOptimization(agentId, optimizationType);

      const response: ApiResponse = {
        success: result,
        data: { 
          message: result ? 'Optimization applied successfully' : 'Optimization failed',
          applied: result,
        },
        timestamp: new Date(),
        requestId: this.generateRequestId(),
      };

      res.json(response);
    } catch (error) {
      this.sendError(res, 'Failed to apply optimization', error);
    }
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send error response
   */
  private sendError(res: Response, message: string, error?: any, statusCode: number = 500): void {
    console.error(`API Error: ${message}`, error);
    
    const response: ApiResponse = {
      success: false,
      error: message,
      timestamp: new Date(),
      requestId: this.generateRequestId(),
    };

    res.status(statusCode).json(response);
  }
}

export default CircuitBreakerApi;