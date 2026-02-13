/**
 * Token Shield Enterprise - Budget Allocation Strategies
 * 
 * Advanced budget allocation algorithms for enterprise resource management
 */

import { TokenAccountingService } from './token-accounting-service';
import { HierarchicalBudgetManager } from './hierarchical-budget-manager';
import { v4 as uuidv4 } from 'uuid';

export interface BudgetAllocationStrategy {
  id: string;
  name: string;
  type: 'fixed' | 'percentage' | 'usage-based' | 'priority-based' | 'dynamic';
  description: string;
  config: AllocationConfig;
  constraints: AllocationConstraints;
  performance: StrategyPerformance;
}

export interface AllocationConfig {
  // Fixed allocation
  fixedAmount?: number;
  
  // Percentage-based
  percentageOfParent?: number;
  
  // Usage-based
  usageWindow?: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  usageWeight?: number;
  historyWeight?: number;
  
  // Priority-based
  priorities?: Record<string, number>; // entityId -> priority weight
  
  // Dynamic allocation
  targetUtilization?: number;
  minReserve?: number;
  maxReserve?: number;
  scalingFactor?: number;
  
  // Common parameters
  currency: string;
  allocationInterval: number; // milliseconds
  reallocationEnabled: boolean;
  minAllocation?: number;
  maxAllocation?: number;
}

export interface AllocationConstraints {
  minBudget: number;
  maxBudget: number;
  maxPercentageOfParent: number;
  requireApprovalOver: number;
  emergencyReserve: number;
  complianceRequirements: string[];
  geographicConstraints?: string[];
  temporalConstraints?: {
    startTime?: string;
    endTime?: string;
    timezone?: string;
  };
}

export interface StrategyPerformance {
  averageUtilization: number;
  allocationEfficiency: number;
  costSavings: number;
  satisfactionScore: number;
  lastOptimized: Date;
  metrics: PerformanceMetrics;
}

export interface PerformanceMetrics {
  totalAllocations: number;
  successfulAllocations: number;
  failedAllocations: number;
  averageAllocationTime: number;
  budgetAccuracy: number;
  forecastAccuracy: number;
}

export interface BudgetAllocationRequest {
  id: string;
  entityId: string;
  entityType: 'organization' | 'department' | 'team' | 'user' | 'project' | 'agent';
  organizationId: string;
  parentEntityId?: string;
  requestedAmount: number;
  currency: string;
  priority: number;
  justification: string;
  constraints: RequestConstraints;
  metadata: Record<string, any>;
  timestamp: Date;
}

export interface RequestConstraints {
  minAmount: number;
  maxAmount: number;
  deadline?: Date;
  geographicRegion?: string;
  complianceTags?: string[];
  businessUnit?: string;
}

export interface AllocationResult {
  requestId: string;
  entityId: string;
  allocatedAmount: number;
  currency: string;
  strategyUsed: string;
  confidence: number;
  estimatedUtilization: number;
  projectedROI: number;
  riskFactors: string[];
  recommendations: string[];
  approvalRequired: boolean;
  allocationId?: string;
  timestamp: Date;
}

export interface AllocationHistory {
  id: string;
  entityId: string;
  strategyId: string;
  allocatedAmount: number;
  actualUsage: number;
  utilization: number;
  allocationDate: Date;
  usageDate?: Date;
  performance: number;
  learnings: string[];
}

export interface MLAllocationModel {
  modelId: string;
  version: string;
  trainingData: TrainingData;
  accuracy: number;
  lastRetrained: Date;
  features: string[];
  hyperparameters: Record<string, any>;
}

export interface TrainingData {
  historicalAllocations: AllocationHistory[];
  usagePatterns: UsagePattern[];
  externalFactors: ExternalFactor[];
  seasonalPatterns: SeasonalPattern[];
}

export interface UsagePattern {
  entityId: string;
  timeWindow: string;
  averageUsage: number;
  peakUsage: number;
  variance: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  seasonality: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'none';
}

export interface ExternalFactor {
  factorType: 'economic' | 'seasonal' | 'regulatory' | 'competitive' | 'technological';
  impact: number; // -1 to 1
  confidence: number;
  timeframe: string;
  description: string;
}

export interface SeasonalPattern {
  period: string;
  multiplier: number;
  confidence: number;
  historicalData: number[];
}

export interface PredictiveAllocation {
  entityId: string;
  predictedNeed: number;
  confidence: number;
  factors: string[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendedStrategy: string;
  projectedUtilization: number;
  uncertaintyRange: {
    lower: number;
    upper: number;
  };
}

export class BudgetAllocationStrategies {
  private strategies: Map<string, BudgetAllocationStrategy> = new Map();
  private allocationHistory: AllocationHistory[] = [];
  private mlModel?: MLAllocationModel;
  private tokenService: TokenAccountingService;
  private budgetManager: HierarchicalBudgetManager;

  constructor(tokenService: TokenAccountingService, budgetManager: HierarchicalBudgetManager) {
    this.tokenService = tokenService;
    this.budgetManager = budgetManager;
    this.initializeDefaultStrategies();
    this.trainMLModel();
  }

  /**
   * Allocate budget using the most appropriate strategy
   */
  async allocateBudget(request: BudgetAllocationRequest): Promise<AllocationResult> {
    // Select the best strategy based on request characteristics
    const strategy = await this.selectOptimalStrategy(request);
    
    // Apply the strategy
    const result = await this.executeStrategy(strategy, request);
    
    // Record allocation for learning
    this.recordAllocationHistory(request, result, strategy);
    
    // Update strategy performance
    await this.updateStrategyPerformance(strategy.id, result);
    
    return result;
  }

  /**
   * Create a new allocation strategy
   */
  async createStrategy(strategyConfig: Partial<BudgetAllocationStrategy>): Promise<BudgetAllocationStrategy> {
    const strategy: BudgetAllocationStrategy = {
      id: strategyConfig.id || uuidv4(),
      name: strategyConfig.name || `Strategy-${Date.now()}`,
      type: strategyConfig.type || 'fixed',
      description: strategyConfig.description || 'Custom allocation strategy',
      config: strategyConfig.config || this.getDefaultConfig(),
      constraints: strategyConfig.constraints || this.getDefaultConstraints(),
      performance: {
        averageUtilization: 0,
        allocationEfficiency: 0,
        costSavings: 0,
        satisfactionScore: 0,
        lastOptimized: new Date(),
        metrics: {
          totalAllocations: 0,
          successfulAllocations: 0,
          failedAllocations: 0,
          averageAllocationTime: 0,
          budgetAccuracy: 0,
          forecastAccuracy: 0,
        },
      },
    };

    this.strategies.set(strategy.id, strategy);
    return strategy;
  }

  /**
   * Optimize allocation strategies using ML
   */
  async optimizeStrategies(): Promise<void> {
    if (!this.mlModel) {
      await this.trainMLModel();
    }

    const strategies = Array.from(this.strategies.values());
    
    for (const strategy of strategies) {
      const optimization = await this.generateStrategyOptimization(strategy);
      
      if (optimization.improvement > 0.1) { // 10% improvement threshold
        await this.updateStrategyConfig(strategy.id, optimization.newConfig);
      }
    }
  }

  /**
   * Get predictive allocation recommendations
   */
  async getPredictiveAllocation(entityId: string, horizon: number = 30): Promise<PredictiveAllocation> {
    if (!this.mlModel) {
      await this.trainMLModel();
    }

    const historicalData = this.allocationHistory
      .filter(h => h.entityId === entityId)
      .sort((a, b) => b.allocationDate.getTime() - a.allocationDate.getTime())
      .slice(0, 100);

    const prediction = await this.predictFutureNeeds(entityId, historicalData, horizon);
    
    return {
      entityId,
      predictedNeed: prediction.amount,
      confidence: prediction.confidence,
      factors: prediction.factors,
      riskLevel: prediction.riskLevel,
      recommendedStrategy: prediction.strategy,
      projectedUtilization: prediction.utilization,
      uncertaintyRange: prediction.range,
    };
  }

  /**
   * Get allocation analytics and insights
   */
  async getAllocationAnalytics(timeRange: { start: Date; end: Date }) {
    const relevantHistory = this.allocationHistory.filter(h => 
      h.allocationDate >= timeRange.start && h.allocationDate <= timeRange.end
    );

    const analytics = {
      totalAllocations: relevantHistory.length,
      totalAllocated: relevantHistory.reduce((sum, h) => sum + h.allocatedAmount, 0),
      totalUsed: relevantHistory.reduce((sum, h) => sum + h.actualUsage, 0),
      averageUtilization: relevantHistory.reduce((sum, h) => sum + h.utilization, 0) / Math.max(1, relevantHistory.length),
      strategyPerformance: this.calculateStrategyPerformance(relevantHistory),
      allocationTrends: this.calculateAllocationTrends(relevantHistory),
      optimizationOpportunities: this.identifyOptimizations(relevantHistory),
    };

    return analytics;
  }

  /**
   * Private helper methods
   */

  private initializeDefaultStrategies(): void {
    // Fixed Allocation Strategy
    const fixedStrategy: BudgetAllocationStrategy = {
      id: 'fixed-allocation',
      name: 'Fixed Allocation',
      type: 'fixed',
      description: 'Allocates a fixed amount regardless of usage patterns',
      config: {
        currency: 'USD',
        allocationInterval: 24 * 60 * 60 * 1000, // Daily
        reallocationEnabled: false,
        fixedAmount: 1000,
        minAllocation: 100,
        maxAllocation: 10000,
      },
      constraints: {
        minBudget: 50,
        maxBudget: 50000,
        maxPercentageOfParent: 100,
        requireApprovalOver: 10000,
        emergencyReserve: 10,
        complianceRequirements: [],
      },
      performance: this.getDefaultPerformance(),
    };

    // Percentage-based Strategy
    const percentageStrategy: BudgetAllocationStrategy = {
      id: 'percentage-allocation',
      name: 'Percentage-based Allocation',
      type: 'percentage',
      description: 'Allocates a percentage of parent budget',
      config: {
        currency: 'USD',
        allocationInterval: 24 * 60 * 60 * 1000,
        reallocationEnabled: true,
        percentageOfParent: 10,
        minAllocation: 100,
        maxAllocation: 10000,
      },
      constraints: {
        minBudget: 50,
        maxBudget: 50000,
        maxPercentageOfParent: 25,
        requireApprovalOver: 5000,
        emergencyReserve: 5,
        complianceRequirements: [],
      },
      performance: this.getDefaultPerformance(),
    };

    // Usage-based Strategy
    const usageStrategy: BudgetAllocationStrategy = {
      id: 'usage-based-allocation',
      name: 'Usage-based Allocation',
      type: 'usage-based',
      description: 'Allocates based on historical usage patterns',
      config: {
        currency: 'USD',
        allocationInterval: 24 * 60 * 60 * 1000,
        reallocationEnabled: true,
        usageWindow: 'monthly',
        usageWeight: 0.7,
        historyWeight: 0.3,
        minAllocation: 100,
        maxAllocation: 20000,
      },
      constraints: {
        minBudget: 50,
        maxBudget: 100000,
        maxPercentageOfParent: 50,
        requireApprovalOver: 10000,
        emergencyReserve: 15,
        complianceRequirements: [],
      },
      performance: this.getDefaultPerformance(),
    };

    // Priority-based Strategy
    const priorityStrategy: BudgetAllocationStrategy = {
      id: 'priority-allocation',
      name: 'Priority-based Allocation',
      type: 'priority-based',
      description: 'Allocates based on business priority',
      config: {
        currency: 'USD',
        allocationInterval: 24 * 60 * 60 * 1000,
        reallocationEnabled: true,
        priorities: {
          'critical': 1.0,
          'high': 0.8,
          'medium': 0.5,
          'low': 0.2,
        },
        minAllocation: 100,
        maxAllocation: 15000,
      },
      constraints: {
        minBudget: 50,
        maxBudget: 75000,
        maxPercentageOfParent: 40,
        requireApprovalOver: 7500,
        emergencyReserve: 20,
        complianceRequirements: [],
      },
      performance: this.getDefaultPerformance(),
    };

    // Dynamic Strategy
    const dynamicStrategy: BudgetAllocationStrategy = {
      id: 'dynamic-allocation',
      name: 'Dynamic Allocation',
      type: 'dynamic',
      description: 'Uses ML to dynamically adjust allocations',
      config: {
        currency: 'USD',
        allocationInterval: 6 * 60 * 60 * 1000, // Every 6 hours
        reallocationEnabled: true,
        targetUtilization: 0.8,
        minReserve: 100,
        maxReserve: 5000,
        scalingFactor: 1.2,
        minAllocation: 200,
        maxAllocation: 25000,
      },
      constraints: {
        minBudget: 100,
        maxBudget: 100000,
        maxPercentageOfParent: 60,
        requireApprovalOver: 15000,
        emergencyReserve: 25,
        complianceRequirements: ['ml-approval'],
      },
      performance: this.getDefaultPerformance(),
    };

    this.strategies.set(fixedStrategy.id, fixedStrategy);
    this.strategies.set(percentageStrategy.id, percentageStrategy);
    this.strategies.set(usageStrategy.id, usageStrategy);
    this.strategies.set(priorityStrategy.id, priorityStrategy);
    this.strategies.set(dynamicStrategy.id, dynamicStrategy);
  }

  private getDefaultConfig(): AllocationConfig {
    return {
      currency: 'USD',
      allocationInterval: 24 * 60 * 60 * 1000,
      reallocationEnabled: false,
      minAllocation: 100,
      maxAllocation: 10000,
    };
  }

  private getDefaultConstraints(): AllocationConstraints {
    return {
      minBudget: 50,
      maxBudget: 50000,
      maxPercentageOfParent: 100,
      requireApprovalOver: 10000,
      emergencyReserve: 10,
      complianceRequirements: [],
    };
  }

  private getDefaultPerformance(): StrategyPerformance {
    return {
      averageUtilization: 0,
      allocationEfficiency: 0,
      costSavings: 0,
      satisfactionScore: 0,
      lastOptimized: new Date(),
      metrics: {
        totalAllocations: 0,
        successfulAllocations: 0,
        failedAllocations: 0,
        averageAllocationTime: 0,
        budgetAccuracy: 0,
        forecastAccuracy: 0,
      },
    };
  }

  private async selectOptimalStrategy(request: BudgetAllocationRequest): Promise<BudgetAllocationStrategy> {
    const strategies = Array.from(this.strategies.values());
    
    // Score each strategy based on request characteristics
    const scoredStrategies = strategies.map(strategy => {
      let score = 0;
      
      // Entity type matching
      if (this.isStrategySuitableForEntity(strategy, request.entityType)) {
        score += 20;
      }
      
      // Priority matching
      if (strategy.type === 'priority-based' && request.priority > 0.7) {
        score += 15;
      }
      
      // Historical performance
      score += strategy.performance.allocationEfficiency * 10;
      
      // Request amount suitability
      if (this.isStrategySuitableForAmount(strategy, request.requestedAmount)) {
        score += 15;
      }
      
      // ML prediction confidence
      if (this.mlModel) {
        const mlScore = this.predictStrategyPerformance(strategy, request);
        score += mlScore * 20;
      }
      
      return { strategy, score };
    });
    
    // Select highest scoring strategy
    scoredStrategies.sort((a, b) => b.score - a.score);
    return scoredStrategies[0].strategy;
  }

  private async executeStrategy(strategy: BudgetAllocationStrategy, request: BudgetAllocationRequest): Promise<AllocationResult> {
    let allocatedAmount = 0;
    let confidence = 0;
    let approvalRequired = false;
    
    switch (strategy.type) {
      case 'fixed':
        allocatedAmount = Math.min(request.requestedAmount, strategy.config.fixedAmount || 0);
        confidence = 0.9;
        break;
        
      case 'percentage':
        const parentBudget = await this.getParentBudget(request.parentEntityId);
        const percentage = strategy.config.percentageOfParent || 10;
        allocatedAmount = Math.min(request.requestedAmount, parentBudget * (percentage / 100));
        confidence = 0.8;
        break;
        
      case 'usage-based':
        const usageAllocation = await this.calculateUsageBasedAllocation(strategy, request);
        allocatedAmount = usageAllocation.amount;
        confidence = usageAllocation.confidence;
        break;
        
      case 'priority-based':
        const priorityAllocation = await this.calculatePriorityBasedAllocation(strategy, request);
        allocatedAmount = priorityAllocation.amount;
        confidence = priorityAllocation.confidence;
        break;
        
      case 'dynamic':
        const dynamicAllocation = await this.calculateDynamicAllocation(strategy, request);
        allocatedAmount = dynamicAllocation.amount;
        confidence = dynamicAllocation.confidence;
        break;
    }
    
    // Apply constraints
    allocatedAmount = Math.max(strategy.constraints.minBudget, Math.min(allocatedAmount, strategy.constraints.maxBudget));
    
    // Check if approval is required
    approvalRequired = allocatedAmount > strategy.constraints.requireApprovalOver;
    
    return {
      requestId: request.id,
      entityId: request.entityId,
      allocatedAmount,
      currency: request.currency,
      strategyUsed: strategy.id,
      confidence,
      estimatedUtilization: confidence * 0.9, // Simplified
      projectedROI: confidence * 1.2, // Simplified
      riskFactors: [],
      recommendations: [],
      approvalRequired,
      allocationId: uuidv4(),
      timestamp: new Date(),
    };
  }

  private async trainMLModel(): Promise<void> {
    // Simplified ML model training
    const trainingData: TrainingData = {
      historicalAllocations: this.allocationHistory,
      usagePatterns: [],
      externalFactors: [],
      seasonalPatterns: [],
    };
    
    this.mlModel = {
      modelId: 'budget-allocation-model',
      version: '1.0.0',
      trainingData,
      accuracy: 0.85,
      lastRetrained: new Date(),
      features: ['entityType', 'requestedAmount', 'priority', 'historicalUsage', 'budgetConstraints'],
      hyperparameters: {
        learningRate: 0.01,
        maxDepth: 10,
        nEstimators: 100,
      },
    };
  }

  private async calculateUsageBasedAllocation(strategy: BudgetAllocationStrategy, request: BudgetAllocationRequest): Promise<{ amount: number; confidence: number }> {
    const historicalUsage = await this.getHistoricalUsage(request.entityId, strategy.config.usageWindow || 'monthly');
    const usageWeight = strategy.config.usageWeight || 0.7;
    const historyWeight = strategy.config.historyWeight || 0.3;
    
    const amount = historicalUsage * usageWeight + request.requestedAmount * historyWeight;
    const confidence = Math.min(0.9, historicalUsage / Math.max(1, request.requestedAmount));
    
    return { amount, confidence };
  }

  private async calculatePriorityBasedAllocation(strategy: BudgetAllocationStrategy, request: BudgetAllocationRequest): Promise<{ amount: number; confidence: number }> {
    const priorities = strategy.config.priorities || {};
    const priorityWeight = priorities[request.entityId] || request.priority;
    
    const amount = request.requestedAmount * priorityWeight;
    const confidence = priorityWeight;
    
    return { amount, confidence };
  }

  private async calculateDynamicAllocation(strategy: BudgetAllocationStrategy, request: BudgetAllocationRequest): Promise<{ amount: number; confidence: number }> {
    const targetUtilization = strategy.config.targetUtilization || 0.8;
    const scalingFactor = strategy.config.scalingFactor || 1.2;
    
    const predictedNeed = request.requestedAmount * targetUtilization;
    const amount = Math.min(request.requestedAmount, predictedNeed * scalingFactor);
    const confidence = targetUtilization;
    
    return { amount, confidence };
  }

  private async getHistoricalUsage(entityId: string, window: string): Promise<number> {
    const relevantHistory = this.allocationHistory.filter(h => h.entityId === entityId);
    if (relevantHistory.length === 0) return 1000; // Default
    
    const averageUsage = relevantHistory.reduce((sum, h) => sum + h.actualUsage, 0) / relevantHistory.length;
    return averageUsage;
  }

  private async getParentBudget(parentEntityId?: string): Promise<number> {
    if (!parentEntityId) return 10000; // Default
    
    const parentHistory = this.allocationHistory.filter(h => h.entityId === parentEntityId);
    if (parentHistory.length === 0) return 10000;
    
    const totalAllocated = parentHistory.reduce((sum, h) => sum + h.allocatedAmount, 0);
    return totalAllocated;
  }

  private recordAllocationHistory(request: BudgetAllocationRequest, result: AllocationResult, strategy: BudgetAllocationStrategy): void {
    const history: AllocationHistory = {
      id: uuidv4(),
      entityId: request.entityId,
      strategyId: strategy.id,
      allocatedAmount: result.allocatedAmount,
      actualUsage: 0, // Will be updated later
      utilization: 0,
      allocationDate: new Date(),
      learnings: [],
    };
    
    this.allocationHistory.push(history);
    
    // Keep only last 1000 entries
    if (this.allocationHistory.length > 1000) {
      this.allocationHistory = this.allocationHistory.slice(-1000);
    }
  }

  private async updateStrategyPerformance(strategyId: string, result: AllocationResult): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return;
    
    strategy.performance.metrics.totalAllocations++;
    
    if (result.allocatedAmount > 0) {
      strategy.performance.metrics.successfulAllocations++;
    } else {
      strategy.performance.metrics.failedAllocations++;
    }
    
    // Update efficiency metrics
    strategy.performance.allocationEfficiency = 
      strategy.performance.metrics.successfulAllocations / strategy.performance.metrics.totalAllocations;
  }

  private isStrategySuitableForEntity(strategy: BudgetAllocationStrategy, entityType: string): boolean {
    const strategyEntityMap: Record<string, string[]> = {
      'fixed': ['user', 'project', 'agent'],
      'percentage': ['department', 'team', 'user'],
      'usage-based': ['organization', 'department', 'team'],
      'priority-based': ['user', 'project', 'agent'],
      'dynamic': ['organization', 'department', 'team'],
    };
    
    return strategyEntityMap[strategy.type]?.includes(entityType) || false;
  }

  private isStrategySuitableForAmount(strategy: BudgetAllocationStrategy, amount: number): boolean {
    return amount >= (strategy.constraints.minBudget) && amount <= (strategy.constraints.maxBudget);
  }

  private predictStrategyPerformance(strategy: BudgetAllocationStrategy, request: BudgetAllocationRequest): number {
    if (!this.mlModel) return 0.5;
    
    // Simplified performance prediction
    const baseScore = strategy.performance.allocationEfficiency;
    const requestMatch = this.calculateRequestMatch(strategy, request);
    
    return Math.min(1.0, baseScore * requestMatch);
  }

  private calculateRequestMatch(strategy: BudgetAllocationStrategy, request: BudgetAllocationRequest): number {
    let match = 0.5;
    
    // Entity type match
    if (this.isStrategySuitableForEntity(strategy, request.entityType)) {
      match += 0.2;
    }
    
    // Amount suitability
    if (this.isStrategySuitableForAmount(strategy, request.requestedAmount)) {
      match += 0.2;
    }
    
    return Math.min(1.0, match);
  }

  private async generateStrategyOptimization(strategy: BudgetAllocationStrategy): Promise<{ improvement: number; newConfig: AllocationConfig }> {
    // Simplified optimization logic
    const currentPerformance = strategy.performance.allocationEfficiency;
    const potentialImprovement = 1.0 - currentPerformance;
    
    return {
      improvement: potentialImprovement * 0.3, // Conservative estimate
      newConfig: { ...strategy.config },
    };
  }

  private async updateStrategyConfig(strategyId: string, newConfig: AllocationConfig): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return;
    
    strategy.config = { ...strategy.config, ...newConfig };
    strategy.performance.lastOptimized = new Date();
  }

  private calculateStrategyPerformance(history: AllocationHistory[]): Record<string, number> {
    const performance: Record<string, number> = {};
    
    const strategies = Array.from(this.strategies.keys());
    for (const strategyId of strategies) {
      const strategyHistory = history.filter(h => h.strategyId === strategyId);
      if (strategyHistory.length > 0) {
        const avgUtilization = strategyHistory.reduce((sum, h) => sum + h.utilization, 0) / strategyHistory.length;
        performance[strategyId] = avgUtilization;
      } else {
        performance[strategyId] = 0;
      }
    }
    
    return performance;
  }

  private calculateAllocationTrends(history: AllocationHistory[]): any[] {
    // Simplified trend calculation
    const trends = [];
    const intervals = 10;
    const intervalSize = Math.ceil(history.length / intervals);
    
    for (let i = 0; i < intervals; i++) {
      const startIdx = i * intervalSize;
      const endIdx = Math.min(startIdx + intervalSize, history.length);
      const intervalHistory = history.slice(startIdx, endIdx);
      
      if (intervalHistory.length > 0) {
        const avgUtilization = intervalHistory.reduce((sum, h) => sum + h.utilization, 0) / intervalHistory.length;
        trends.push({
          interval: i,
          averageUtilization: avgUtilization,
          timestamp: new Date(Date.now() - (intervals - i) * 24 * 60 * 60 * 1000),
        });
      }
    }
    
    return trends;
  }

  private identifyOptimizations(history: AllocationHistory[]): string[] {
    const optimizations: string[] = [];
    
    const avgUtilization = history.reduce((sum, h) => sum + h.utilization, 0) / Math.max(1, history.length);
    
    if (avgUtilization < 0.7) {
      optimizations.push('Consider reducing allocation amounts due to low utilization');
    }
    
    if (avgUtilization > 0.95) {
      optimizations.push('Consider increasing allocation amounts to prevent budget exhaustion');
    }
    
    return optimizations;
  }

  private async predictFutureNeeds(entityId: string, historicalData: AllocationHistory[], horizon: number): Promise<any> {
    if (historicalData.length === 0) {
      return {
        amount: 1000,
        confidence: 0.5,
        factors: ['No historical data'],
        riskLevel: 'high',
        strategy: 'fixed-allocation',
        utilization: 0.7,
        range: { lower: 500, upper: 2000 },
      };
    }
    
    const avgUsage = historicalData.reduce((sum, h) => sum + h.actualUsage, 0) / historicalData.length;
    const trend = this.calculateTrend(historicalData);
    
    const predictedAmount = avgUsage * (1 + trend * horizon / 30);
    const confidence = Math.min(0.9, historicalData.length / 100);
    
    return {
      amount: predictedAmount,
      confidence,
      factors: ['Historical usage', 'Trend analysis', 'Seasonal patterns'],
      riskLevel: confidence > 0.8 ? 'low' : confidence > 0.5 ? 'medium' : 'high',
      strategy: 'dynamic-allocation',
      utilization: 0.8,
      range: {
        lower: predictedAmount * 0.7,
        upper: predictedAmount * 1.3,
      },
    };
  }

  private calculateTrend(history: AllocationHistory[]): number {
    if (history.length < 2) return 0;
    
    const recent = history.slice(-10);
    const older = history.slice(0, Math.min(10, history.length - 10));
    
    const recentAvg = recent.reduce((sum, h) => sum + h.actualUsage, 0) / recent.length;
    const olderAvg = older.reduce((sum, h) => sum + h.actualUsage, 0) / older.length;
    
    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }
}