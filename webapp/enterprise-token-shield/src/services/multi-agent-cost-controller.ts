/**
 * Token Shield Enterprise - Multi-Agent Cost Controller
 * 
 * Real-time cost tracking, circuit breakers, and optimization for multi-agent systems
 */

import { TokenAccountingService } from './token-accounting-service';
import { HierarchicalBudgetManager } from './hierarchical-budget-manager';
import { v4 as uuidv4 } from 'uuid';

export interface AIAgent {
  id: string;
  name: string;
  userId: string;
  organizationId: string;
  projectId?: string;
  teamId?: string;
  agentType: 'reasoning' | 'coding' | 'creative' | 'analytical' | 'coordinator';
  modelTier: 'premium' | 'standard' | 'economy' | 'ultra';
  maxTokensPerHour: number;
  maxTokensPerDay: number;
  maxTokensPerMonth: number;
  maxConversations: number;
  maxConcurrentRequests: number;
  tokenQuota: number;
  tokensUsed: number;
  tokensReserved: number;
  status: 'active' | 'paused' | 'throttled' | 'blocked' | 'terminated';
  circuitBreaker: CircuitBreaker;
  costTracking: CostTracking;
  communicationCosts: CommunicationCost[];
  optimization: AgentOptimization;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

export interface CircuitBreaker {
  id: string;
  agentId: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureAt?: Date;
  lastSuccessAt?: Date;
  tripThreshold: number;
  resetTimeout: number;
  halfOpenMaxCalls: number;
  currentHalfOpenCalls: number;
  metrics: CircuitBreakerMetrics;
}

export interface CircuitBreakerMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  timeouts: number;
  rateLimitHits: number;
  budgetExceedances: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
}

export interface CostTracking {
  hourly: CostWindow;
  daily: CostWindow;
  weekly: CostWindow;
  monthly: CostWindow;
  total: number;
  averageCostPerToken: number;
  costEfficiency: number;
  projectedMonthlyCost: number;
}

export interface CostWindow {
  tokensUsed: number;
  cost: number;
  startTime: Date;
  endTime: Date;
  isComplete: boolean;
}

export interface CommunicationCost {
  fromAgentId: string;
  toAgentId: string;
  messageType: 'request' | 'response' | 'broadcast' | 'coordination';
  tokensUsed: number;
  cost: number;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface AgentOptimization {
  modelDowngradeEnabled: boolean;
  currentModelTier: string;
  tokenCompressionEnabled: boolean;
  compressionRatio: number;
  cachingEnabled: boolean;
  cacheHitRate: number;
  smartRoutingEnabled: boolean;
  routingEfficiency: number;
  autoScalingEnabled: boolean;
  scalingMetrics: ScalingMetrics;
}

export interface ScalingMetrics {
  currentLoad: number;
  targetLoad: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  scaleFactor: number;
  lastScaleAction?: Date;
}

export interface AgentSwarm {
  id: string;
  name: string;
  agents: string[];
  coordinatorAgent?: string;
  swarmType: 'collaborative' | 'competitive' | 'hierarchical' | 'democratic';
  maxAgents: number;
  interAgentCommunication: boolean;
  sharedMemory: boolean;
  collectiveDecisionMaking: boolean;
  totalTokensUsed: number;
  totalCost: number;
  averageTokensPerAgent: number;
  communicationOverhead: number;
  efficiency: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MultiAgentCostEvent {
  id: string;
  eventType: 'agent_created' | 'agent_destroyed' | 'token_consumed' | 'cost_threshold_hit' | 'circuit_breaker_trip' | 'optimization_applied';
  agentId: string;
  swarmId?: string;
  organizationId: string;
  userId: string;
  tokens: number;
  cost: number;
  modelTier: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface CostThreshold {
  id: string;
  name: string;
  agentId?: string;
  swarmId?: string;
  organizationId: string;
  thresholdType: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'total';
  thresholdValue: number;
  currentValue: number;
  percentage: number;
  isExceeded: boolean;
  lastExceededAt?: Date;
  notifications: ThresholdNotification[];
}

export interface ThresholdNotification {
  id: string;
  type: 'email' | 'sms' | 'webhook' | 'dashboard';
  recipient: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sentAt: Date;
  delivered: boolean;
}

export interface AgentCostAnalytics {
  agentId: string;
  timeRange: { start: Date; end: Date };
  totalTokens: number;
  totalCost: number;
  averageTokensPerRequest: number;
  averageCostPerToken: number;
  efficiency: number;
  trends: CostTrend[];
  comparisons: AgentComparison[];
  optimizations: OptimizationRecommendation[];
}

export interface CostTrend {
  timestamp: Date;
  tokens: number;
  cost: number;
  efficiency: number;
  movingAverage: number;
}

export interface AgentComparison {
  agentId: string;
  agentName: string;
  tokens: number;
  cost: number;
  efficiency: number;
  costPerToken: number;
  relativeEfficiency: number;
}

export interface OptimizationRecommendation {
  id: string;
  type: 'model_downgrade' | 'token_compression' | 'caching' | 'smart_routing' | 'agent_scaling';
  description: string;
  estimatedSavings: number;
  estimatedSavingsPercentage: number;
  confidence: number;
  complexity: 'low' | 'medium' | 'high';
  implementationTime: number;
  risks: string[];
  prerequisites: string[];
}

export class MultiAgentCostController {
  private agents: Map<string, AIAgent> = new Map();
  private swarms: Map<string, AgentSwarm> = new Map();
  private tokenService: TokenAccountingService;
  private budgetManager: HierarchicalBudgetManager;
  private costEvents: MultiAgentCostEvent[] = [];
  private thresholds: Map<string, CostThreshold> = new Map();
  private analytics: Map<string, AgentCostAnalytics> = new Map();

  constructor(tokenService: TokenAccountingService, budgetManager: HierarchicalBudgetManager) {
    this.tokenService = tokenService;
    this.budgetManager = budgetManager;
  }

  /**
   * Create a new AI agent with cost tracking
   */
  async createAgent(agentConfig: Partial<AIAgent>): Promise<AIAgent> {
    const agentId = agentConfig.id || uuidv4();
    
    // Create token account for the agent
    const tokenAccount = await this.tokenService.createAccount({
      id: agentId,
      userId: agentConfig.userId!,
      organizationId: agentConfig.organizationId!,
      balance: BigInt(agentConfig.tokenQuota || 1000),
      currency: 'TOKENS',
      accountType: 'agent',
      hierarchyLevel: 6, // Agent is lowest level
      parentAccountId: agentConfig.projectId || agentConfig.teamId || agentConfig.userId,
    });

    const agent: AIAgent = {
      id: agentId,
      name: agentConfig.name || `Agent-${agentId.substring(0, 8)}`,
      userId: agentConfig.userId!,
      organizationId: agentConfig.organizationId!,
      projectId: agentConfig.projectId,
      teamId: agentConfig.teamId,
      agentType: agentConfig.agentType || 'reasoning',
      modelTier: agentConfig.modelTier || 'standard',
      maxTokensPerHour: agentConfig.maxTokensPerHour || 10000,
      maxTokensPerDay: agentConfig.maxTokensPerDay || 100000,
      maxTokensPerMonth: agentConfig.maxTokensPerMonth || 1000000,
      maxConversations: agentConfig.maxConversations || 100,
      maxConcurrentRequests: agentConfig.maxConcurrentRequests || 5,
      tokenQuota: agentConfig.tokenQuota || 1000,
      tokensUsed: 0,
      tokensReserved: 0,
      status: 'active',
      circuitBreaker: {
        id: uuidv4(),
        agentId,
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        tripThreshold: 5,
        resetTimeout: 300000, // 5 minutes
        halfOpenMaxCalls: 3,
        currentHalfOpenCalls: 0,
        metrics: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          timeouts: 0,
          rateLimitHits: 0,
          budgetExceedances: 0,
          averageResponseTime: 0,
          p95ResponseTime: 0,
          p99ResponseTime: 0,
        },
      },
      costTracking: {
        hourly: this.createCostWindow('hourly'),
        daily: this.createCostWindow('daily'),
        weekly: this.createCostWindow('weekly'),
        monthly: this.createCostWindow('monthly'),
        total: 0,
        averageCostPerToken: 0,
        costEfficiency: 100,
        projectedMonthlyCost: 0,
      },
      communicationCosts: [],
      optimization: {
        modelDowngradeEnabled: true,
        currentModelTier: agentConfig.modelTier || 'standard',
        tokenCompressionEnabled: false,
        compressionRatio: 1.0,
        cachingEnabled: true,
        cacheHitRate: 0,
        smartRoutingEnabled: true,
        routingEfficiency: 100,
        autoScalingEnabled: false,
        scalingMetrics: {
          currentLoad: 0,
          targetLoad: 70,
          scaleUpThreshold: 80,
          scaleDownThreshold: 30,
          scaleFactor: 1.0,
        },
      },
      metadata: agentConfig.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.agents.set(agentId, agent);
    
    // Create cost thresholds for the agent
    await this.createAgentThresholds(agent);

    // Emit event
    await this.recordCostEvent({
      eventType: 'agent_created',
      agentId,
      organizationId: agent.organizationId,
      userId: agent.userId,
      tokens: 0,
      cost: 0,
      modelTier: agent.modelTier,
      timestamp: new Date(),
      metadata: { agentConfig },
    });

    return agent;
  }

  /**
   * Consume tokens for an agent request
   */
  async consumeTokens(
    agentId: string,
    tokens: number,
    cost: number,
    modelTier?: string,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Check circuit breaker
    if (agent.circuitBreaker.state === 'open') {
      await this.recordCostEvent({
        eventType: 'circuit_breaker_trip',
        agentId,
        organizationId: agent.organizationId,
        userId: agent.userId,
        tokens,
        cost,
        modelTier: modelTier || agent.modelTier,
        timestamp: new Date(),
        metadata: { reason: 'Circuit breaker open' },
      });
      return false;
    }

    // Check budget limits
    const withinLimits = await this.checkBudgetLimits(agent, tokens, cost);
    if (!withinLimits) {
      await this.recordCostEvent({
        eventType: 'cost_threshold_hit',
        agentId,
        organizationId: agent.organizationId,
        userId: agent.userId,
        tokens,
        cost,
        modelTier: modelTier || agent.modelTier,
        timestamp: new Date(),
        metadata: { reason: 'Budget limits exceeded' },
      });
      return false;
    }

    // Reserve tokens first
    const reservationId = await this.tokenService.reserve(
      agentId,
      BigInt(tokens),
      `Token reservation for agent ${agentId}`,
      { agentId, requestType: 'token_consumption' }
    );

    // Update agent state
    agent.tokensReserved += tokens;
    agent.lastActivityAt = new Date();

    try {
      // Debit tokens from account
      const newBalance = await this.tokenService.debit(
        agentId,
        BigInt(tokens),
        `Token consumption by agent ${agentId}`,
        {
          agentId,
          tokens,
          cost,
          modelTier: modelTier || agent.modelTier,
          reservationId,
        }
      );

      // Release reservation and record actual consumption
      await this.tokenService.release(reservationId, {
        actualTokens: tokens,
        actualCost: cost,
      });

      // Update agent tracking
      agent.tokensUsed += tokens;
      agent.tokensReserved -= tokens;
      
      // Update cost tracking
      await this.updateAgentCostTracking(agent, tokens, cost);

      // Update circuit breaker metrics
      this.updateCircuitBreakerMetrics(agent.circuitBreaker, true);

      // Record cost event
      await this.recordCostEvent({
        eventType: 'token_consumed',
        agentId,
        organizationId: agent.organizationId,
        userId: agent.userId,
        tokens,
        cost,
        modelTier: modelTier || agent.modelTier,
        timestamp: new Date(),
        metadata: { reservationId, ...metadata },
      });

      // Check for optimizations
      await this.checkForOptimizations(agent);

      return true;

    } catch (error) {
      // Release reservation on failure
      await this.tokenService.release(reservationId, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      agent.tokensReserved -= tokens;
      
      // Update circuit breaker metrics
      this.updateCircuitBreakerMetrics(agent.circuitBreaker, false);

      throw error;
    }
  }

  /**
   * Track inter-agent communication costs
   */
  async trackCommunicationCost(
    fromAgentId: string,
    toAgentId: string,
    messageType: CommunicationCost['messageType'],
    tokens: number,
    cost: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);

    if (!fromAgent || !toAgent) {
      throw new Error('One or both agents not found');
    }

    const communicationCost: CommunicationCost = {
      fromAgentId,
      toAgentId,
      messageType,
      tokensUsed: tokens,
      cost,
      timestamp: new Date(),
      metadata: metadata || {},
    };

    // Add to both agents' communication costs
    fromAgent.communicationCosts.push(communicationCost);
    toAgent.communicationCosts.push(communicationCost);

    // Update swarm communication overhead if both agents are in the same swarm
    const commonSwarms = this.findCommonSwarms(fromAgentId, toAgentId);
    for (const swarmId of commonSwarms) {
      const swarm = this.swarms.get(swarmId);
      if (swarm) {
        swarm.communicationOverhead += cost;
      }
    }

    // Check if communication costs are becoming excessive
    await this.checkCommunicationOverhead(fromAgent, toAgent);
  }

  /**
   * Create an agent swarm
   */
  async createSwarm(swarmConfig: Partial<AgentSwarm>): Promise<AgentSwarm> {
    const swarmId = swarmConfig.id || uuidv4();
    
    const swarm: AgentSwarm = {
      id: swarmId,
      name: swarmConfig.name || `Swarm-${swarmId.substring(0, 8)}`,
      agents: swarmConfig.agents || [],
      coordinatorAgent: swarmConfig.coordinatorAgent,
      swarmType: swarmConfig.swarmType || 'collaborative',
      maxAgents: swarmConfig.maxAgents || 10,
      interAgentCommunication: swarmConfig.interAgentCommunication !== false,
      sharedMemory: swarmConfig.sharedMemory !== false,
      collectiveDecisionMaking: swarmConfig.collectiveDecisionMaking !== false,
      totalTokensUsed: 0,
      totalCost: 0,
      averageTokensPerAgent: 0,
      communicationOverhead: 0,
      efficiency: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.swarms.set(swarmId, swarm);
    return swarm;
  }

  /**
   * Add agent to swarm
   */
  async addAgentToSwarm(agentId: string, swarmId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    const swarm = this.swarms.get(swarmId);

    if (!agent || !swarm) {
      throw new Error('Agent or swarm not found');
    }

    if (swarm.agents.includes(agentId)) {
      throw new Error('Agent already in swarm');
    }

    if (swarm.agents.length >= swarm.maxAgents) {
      throw new Error('Swarm has reached maximum agent capacity');
    }

    swarm.agents.push(agentId);
    agent.metadata.swarmId = swarmId;
    swarm.updatedAt = new Date();

    // Update swarm metrics
    await this.updateSwarmMetrics(swarm);
  }

  /**
   * Apply cost optimization to an agent
   */
  async applyOptimization(
    agentId: string,
    optimizationType: OptimizationRecommendation['type']
  ): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    let optimizationApplied = false;

    switch (optimizationType) {
      case 'model_downgrade':
        optimizationApplied = await this.downgradeModel(agent);
        break;
        
      case 'token_compression':
        optimizationApplied = await this.enableTokenCompression(agent);
        break;
        
      case 'caching':
        optimizationApplied = await this.enableSmartCaching(agent);
        break;
        
      case 'smart_routing':
        optimizationApplied = await this.enableSmartRouting(agent);
        break;
        
      case 'agent_scaling':
        optimizationApplied = await this.optimizeAgentScaling(agent);
        break;
        
      default:
        throw new Error(`Unsupported optimization type: ${optimizationType}`);
    }

    if (optimizationApplied) {
      await this.recordCostEvent({
        eventType: 'optimization_applied',
        agentId,
        organizationId: agent.organizationId,
        userId: agent.userId,
        tokens: 0,
        cost: 0,
        modelTier: agent.modelTier,
        timestamp: new Date(),
        metadata: { optimizationType },
      });
    }

    return optimizationApplied;
  }

  /**
   * Get agent cost analytics
   */
  async getAgentAnalytics(agentId: string, timeRange: { start: Date; end: Date }): Promise<AgentCostAnalytics> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const analytics: AgentCostAnalytics = {
      agentId,
      timeRange,
      totalTokens: agent.tokensUsed,
      totalCost: agent.costTracking.total,
      averageTokensPerRequest: agent.tokensUsed / Math.max(1, agent.circuitBreaker.metrics.totalCalls),
      averageCostPerToken: agent.costTracking.averageCostPerToken,
      efficiency: agent.costTracking.costEfficiency,
      trends: await this.calculateCostTrends(agent, timeRange),
      comparisons: await this.getAgentComparisons(agent, timeRange),
      optimizations: await this.generateOptimizationRecommendations(agent),
    };

    this.analytics.set(agentId, analytics);
    return analytics;
  }

  /**
   * Get cost thresholds for monitoring
   */
  getCostThresholds(agentId?: string): CostThreshold[] {
    if (agentId) {
      const agentThresholds = Array.from(this.thresholds.values())
        .filter(threshold => threshold.agentId === agentId);
      return agentThresholds;
    }
    return Array.from(this.thresholds.values());
  }

  /**
   * Update circuit breaker state
   */
  async updateCircuitBreaker(agentId: string, success: boolean): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const breaker = agent.circuitBreaker;
    breaker.metrics.totalCalls++;

    if (success) {
      breaker.metrics.successfulCalls++;
      breaker.successCount++;
      breaker.failureCount = 0;
      
      if (breaker.state === 'half-open') {
        breaker.currentHalfOpenCalls++;
        if (breaker.currentHalfOpenCalls >= breaker.halfOpenMaxCalls) {
          breaker.state = 'closed';
          breaker.currentHalfOpenCalls = 0;
        }
      }
    } else {
      breaker.metrics.failedCalls++;
      breaker.failureCount++;
      breaker.successCount = 0;
      
      if (breaker.failureCount >= breaker.tripThreshold) {
        breaker.state = 'open';
        breaker.lastFailureAt = new Date();
        
        // Schedule automatic reset
        setTimeout(() => {
          breaker.state = 'half-open';
          breaker.failureCount = 0;
          breaker.currentHalfOpenCalls = 0;
        }, breaker.resetTimeout);
      }
    }

    agent.updatedAt = new Date();
  }

  /**
   * Private helper methods
   */

  private createCostWindow(type: 'hourly' | 'daily' | 'weekly' | 'monthly'): CostWindow {
    const now = new Date();
    let startTime: Date;
    let endTime: Date;

    switch (type) {
      case 'hourly':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        endTime = now;
        break;
      case 'daily':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        endTime = now;
        break;
      case 'weekly':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        endTime = now;
        break;
      case 'monthly':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        endTime = now;
        break;
    }

    return {
      tokensUsed: 0,
      cost: 0,
      startTime,
      endTime,
      isComplete: false,
    };
  }

  private async createAgentThresholds(agent: AIAgent): Promise<void> {
    const thresholds: CostThreshold[] = [
      {
        id: `${agent.id}-hourly`,
        name: `${agent.name} Hourly Limit`,
        agentId: agent.id,
        organizationId: agent.organizationId,
        thresholdType: 'hourly',
        thresholdValue: agent.maxTokensPerHour,
        currentValue: 0,
        percentage: 0,
        isExceeded: false,
        notifications: [],
      },
      {
        id: `${agent.id}-daily`,
        name: `${agent.name} Daily Limit`,
        agentId: agent.id,
        organizationId: agent.organizationId,
        thresholdType: 'daily',
        thresholdValue: agent.maxTokensPerDay,
        currentValue: 0,
        percentage: 0,
        isExceeded: false,
        notifications: [],
      },
      {
        id: `${agent.id}-monthly`,
        name: `${agent.name} Monthly Limit`,
        agentId: agent.id,
        organizationId: agent.organizationId,
        thresholdType: 'monthly',
        thresholdValue: agent.maxTokensPerMonth,
        currentValue: 0,
        percentage: 0,
        isExceeded: false,
        notifications: [],
      },
    ];

    for (const threshold of thresholds) {
      this.thresholds.set(threshold.id, threshold);
    }
  }

  private async checkBudgetLimits(agent: AIAgent, tokens: number, cost: number): Promise<boolean> {
    // Check hourly limit
    if (agent.tokensUsed + tokens > agent.maxTokensPerHour) {
      return false;
    }

    // Check daily limit
    if (agent.costTracking.daily.tokensUsed + tokens > agent.maxTokensPerDay) {
      return false;
    }

    // Check monthly limit
    if (agent.costTracking.monthly.tokensUsed + tokens > agent.maxTokensPerMonth) {
      return false;
    }

    // Check token account balance
    const balance = await this.tokenService.getBalance(agent.id);
    if (balance.available < BigInt(tokens)) {
      return false;
    }

    return true;
  }

  private async updateAgentCostTracking(agent: AIAgent, tokens: number, cost: number): Promise<void> {
    // Update current windows
    const now = new Date();
    
    agent.costTracking.hourly.tokensUsed += tokens;
    agent.costTracking.hourly.cost += cost;
    
    agent.costTracking.daily.tokensUsed += tokens;
    agent.costTracking.daily.cost += cost;
    
    agent.costTracking.weekly.tokensUsed += tokens;
    agent.costTracking.weekly.cost += cost;
    
    agent.costTracking.monthly.tokensUsed += tokens;
    agent.costTracking.monthly.cost += cost;
    
    agent.costTracking.total += cost;
    
    // Update efficiency metrics
    const totalTokens = agent.tokensUsed;
    agent.costTracking.averageCostPerToken = totalTokens > 0 ? agent.costTracking.total / totalTokens : 0;
    agent.costTracking.costEfficiency = Math.max(0, 100 - (agent.costTracking.total / (totalTokens * 0.001)) * 100);
    agent.costTracking.projectedMonthlyCost = agent.costTracking.monthly.cost * 30;

    // Update thresholds
    this.updateThresholds(agent, tokens);

    agent.updatedAt = new Date();
  }

  private updateThresholds(agent: AIAgent, tokens: number): void {
    const thresholds = this.getCostThresholds(agent.id);
    
    for (const threshold of thresholds) {
      switch (threshold.thresholdType) {
        case 'hourly':
          threshold.currentValue = agent.costTracking.hourly.tokensUsed;
          break;
        case 'daily':
          threshold.currentValue = agent.costTracking.daily.tokensUsed;
          break;
        case 'monthly':
          threshold.currentValue = agent.costTracking.monthly.tokensUsed;
          break;
      }
      
      threshold.percentage = threshold.thresholdValue > 0 ? (threshold.currentValue / threshold.thresholdValue) * 100 : 0;
      threshold.isExceeded = threshold.currentValue > threshold.thresholdValue;
      
      if (threshold.isExceeded && !threshold.lastExceededAt) {
        threshold.lastExceededAt = new Date();
      }
    }
  }

  private updateCircuitBreakerMetrics(breaker: CircuitBreaker, success: boolean): void {
    if (success) {
      breaker.successCount++;
    } else {
      breaker.failureCount++;
    }
  }

  private async checkForOptimizations(agent: AIAgent): Promise<void> {
    const usagePercentage = agent.tokensUsed / agent.tokenQuota;
    
    if (usagePercentage > 0.9) {
      // Agent is using 90%+ of quota, apply optimizations
      await this.applyOptimization(agent.id, 'model_downgrade');
    } else if (usagePercentage > 0.8) {
      // Agent is using 80%+ of quota, enable compression
      await this.applyOptimization(agent.id, 'token_compression');
    }
  }

  private async checkCommunicationOverhead(agent1: AIAgent, agent2: AIAgent): Promise<void> {
    const totalCommunicationCost = agent1.communicationCosts
      .filter(cost => cost.toAgentId === agent2.id)
      .reduce((sum, cost) => sum + cost.cost, 0);

    const threshold = Math.max(agent1.tokenQuota, agent2.tokenQuota) * 0.1; // 10% of larger quota
    
    if (totalCommunicationCost > threshold) {
      // Communication overhead is excessive, consider optimization
      console.log(`High communication overhead between agents ${agent1.id} and ${agent2.id}: $${totalCommunicationCost}`);
    }
  }

  private findCommonSwarms(agentId1: string, agentId2: string): string[] {
    const agent1 = this.agents.get(agentId1);
    const agent2 = this.agents.get(agentId2);
    
    if (!agent1 || !agent2) return [];
    
    const swarmId1 = agent1.metadata.swarmId;
    const swarmId2 = agent2.metadata.swarmId;
    
    return swarmId1 && swarmId1 === swarmId2 ? [swarmId1] : [];
  }

  private async updateSwarmMetrics(swarm: AgentSwarm): Promise<void> {
    const agents = swarm.agents.map(agentId => this.agents.get(agentId)).filter(Boolean) as AIAgent[];
    
    swarm.totalTokensUsed = agents.reduce((sum, agent) => sum + agent.tokensUsed, 0);
    swarm.totalCost = agents.reduce((sum, agent) => sum + agent.costTracking.total, 0);
    swarm.averageTokensPerAgent = agents.length > 0 ? swarm.totalTokensUsed / agents.length : 0;
    
    // Calculate efficiency (simplified)
    const totalPossibleEfficiency = agents.length * 100;
    const actualEfficiency = agents.reduce((sum, agent) => sum + agent.costTracking.costEfficiency, 0);
    swarm.efficiency = agents.length > 0 ? actualEfficiency / agents.length : 0;
    
    swarm.updatedAt = new Date();
  }

  private async downgradeModel(agent: AIAgent): Promise<boolean> {
    const currentTier = agent.modelTier;
    const tiers = ['ultra', 'premium', 'standard', 'economy'];
    const currentIndex = tiers.indexOf(currentTier);
    
    if (currentIndex < tiers.length - 1) {
      agent.modelTier = tiers[currentIndex + 1];
      agent.optimization.currentModelTier = agent.modelTier;
      return true;
    }
    
    return false;
  }

  private async enableTokenCompression(agent: AIAgent): Promise<boolean> {
    if (!agent.optimization.tokenCompressionEnabled) {
      agent.optimization.tokenCompressionEnabled = true;
      agent.optimization.compressionRatio = 0.8; // 20% compression
      return true;
    }
    return false;
  }

  private async enableSmartCaching(agent: AIAgent): Promise<boolean> {
    if (!agent.optimization.cachingEnabled) {
      agent.optimization.cachingEnabled = true;
      agent.optimization.cacheHitRate = 0.3; // 30% cache hit rate
      return true;
    }
    return false;
  }

  private async enableSmartRouting(agent: AIAgent): Promise<boolean> {
    if (!agent.optimization.smartRoutingEnabled) {
      agent.optimization.smartRoutingEnabled = true;
      agent.optimization.routingEfficiency = 90;
      return true;
    }
    return false;
  }

  private async optimizeAgentScaling(agent: AIAgent): Promise<boolean> {
    // This would involve scaling the agent up or down based on load
    // For now, just enable auto-scaling
    if (!agent.optimization.autoScalingEnabled) {
      agent.optimization.autoScalingEnabled = true;
      return true;
    }
    return false;
  }

  private async calculateCostTrends(agent: AIAgent, timeRange: { start: Date; end: Date }): Promise<CostTrend[]> {
    // Simplified cost trend calculation
    const trends: CostTrend[] = [];
    const interval = (timeRange.end.getTime() - timeRange.start.getTime()) / 10; // 10 data points
    
    for (let i = 0; i < 10; i++) {
      const timestamp = new Date(timeRange.start.getTime() + i * interval);
      const tokens = Math.random() * 1000; // Simulated data
      const cost = tokens * 0.001; // Simulated cost
      const efficiency = 100 - (cost / tokens) * 100;
      
      trends.push({
        timestamp,
        tokens,
        cost,
        efficiency,
        movingAverage: cost,
      });
    }
    
    return trends;
  }

  private async getAgentComparisons(agent: AIAgent, timeRange: { start: Date; end: Date }): Promise<AgentComparison[]> {
    // Get all agents in the same organization
    const organizationAgents = Array.from(this.agents.values())
      .filter(a => a.organizationId === agent.organizationId && a.id !== agent.id);
    
    return organizationAgents.map(otherAgent => ({
      agentId: otherAgent.id,
      agentName: otherAgent.name,
      tokens: otherAgent.tokensUsed,
      cost: otherAgent.costTracking.total,
      efficiency: otherAgent.costTracking.costEfficiency,
      costPerToken: otherAgent.costTracking.averageCostPerToken,
      relativeEfficiency: (otherAgent.costTracking.costEfficiency / agent.costTracking.costEfficiency) * 100,
    }));
  }

  private async generateOptimizationRecommendations(agent: AIAgent): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];
    
    // Model downgrade recommendation
    if (agent.modelTier !== 'economy' && agent.tokensUsed > agent.tokenQuota * 0.8) {
      recommendations.push({
        id: uuidv4(),
        type: 'model_downgrade',
        description: 'Downgrade to economy model to reduce costs',
        estimatedSavings: agent.costTracking.total * 0.3,
        estimatedSavingsPercentage: 30,
        confidence: 90,
        complexity: 'low',
        implementationTime: 5,
        risks: ['Potential quality reduction'],
        prerequisites: [],
      });
    }
    
    // Token compression recommendation
    if (!agent.optimization.tokenCompressionEnabled && agent.tokensUsed > 10000) {
      recommendations.push({
        id: uuidv4(),
        type: 'token_compression',
        description: 'Enable token compression to reduce token usage',
        estimatedSavings: agent.costTracking.total * 0.15,
        estimatedSavingsPercentage: 15,
        confidence: 80,
        complexity: 'medium',
        implementationTime: 15,
        risks: ['Slight processing overhead'],
        prerequisites: [],
      });
    }
    
    return recommendations;
  }

  private async recordCostEvent(event: MultiAgentCostEvent): Promise<void> {
    this.costEvents.push(event);
    
    // Keep only last 10000 events to prevent memory issues
    if (this.costEvents.length > 10000) {
      this.costEvents = this.costEvents.slice(-10000);
    }
  }
}