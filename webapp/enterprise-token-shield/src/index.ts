/**
 * Token Shield Enterprise - Main Integration
 * 
 * Complete integration of multi-agent cost tracking, circuit breakers, and real-time analytics
 */

import { MultiAgentCostController } from './services/multi-agent-cost-controller';
import { HierarchicalBudgetManager } from './services/hierarchical-budget-manager';
import { TokenAccountingService } from './services/token-accounting-service';
import { PredictiveAnalyticsService } from './services/predictive-analytics-service';
import { RealtimeAnalyticsService } from './services/realtime-analytics-service';
import CircuitBreakerApi from './api/routes';

export interface TokenShieldEnterpriseConfig {
  // Service configurations
  costController?: {
    enableOptimizations?: boolean;
    defaultTokenQuota?: number;
    circuitBreakerThreshold?: number;
  };
  
  budgetManager?: {
    enableHierarchicalBudgets?: boolean;
    defaultBudgetLimit?: number;
  };
  
  tokenAccounting?: {
    enableTokenReservations?: boolean;
    reservationTimeout?: number;
  };
  
  predictiveAnalytics?: {
    enablePredictions?: boolean;
    predictionHorizon?: string;
    confidenceThreshold?: number;
  };
  
  realtimeAnalytics?: {
    port?: number;
    refreshInterval?: number;
    enableWebSocket?: boolean;
    maxConnections?: number;
  };
  
  api?: {
    port?: number;
    enableCors?: boolean;
    rateLimit?: {
      windowMs?: number;
      maxRequests?: number;
    };
  };
  
  // Feature flags
  features?: {
    enableCircuitBreakers?: boolean;
    enableCostTracking?: boolean;
    enablePredictions?: boolean;
    enableRealtimeAnalytics?: boolean;
    enableOptimizations?: boolean;
    enableAlerts?: boolean;
  };
}

export class TokenShieldEnterprise {
  private costController: MultiAgentCostController;
  private budgetManager: HierarchicalBudgetManager;
  private tokenService: TokenAccountingService;
  private predictiveService: PredictiveAnalyticsService;
  private realtimeService: RealtimeAnalyticsService;
  private api: CircuitBreakerApi;
  private config: TokenShieldEnterpriseConfig;
  private isInitialized: boolean = false;

  constructor(config: TokenShieldEnterpriseConfig = {}) {
    this.config = {
      costController: {
        enableOptimizations: true,
        defaultTokenQuota: 1000,
        circuitBreakerThreshold: 5,
        ...config.costController,
      },
      budgetManager: {
        enableHierarchicalBudgets: true,
        defaultBudgetLimit: 10000,
        ...config.budgetManager,
      },
      tokenAccounting: {
        enableTokenReservations: true,
        reservationTimeout: 300000,
        ...config.tokenAccounting,
      },
      predictiveAnalytics: {
        enablePredictions: true,
        predictionHorizon: '24h',
        confidenceThreshold: 0.8,
        ...config.predictiveAnalytics,
      },
      realtimeAnalytics: {
        port: 8080,
        refreshInterval: 1000,
        enableWebSocket: true,
        maxConnections: 100,
        ...config.realtimeAnalytics,
      },
      api: {
        port: 3000,
        enableCors: true,
        rateLimit: {
          windowMs: 60000,
          maxRequests: 1000,
          ...config.api?.rateLimit,
        },
        ...config.api,
      },
      features: {
        enableCircuitBreakers: true,
        enableCostTracking: true,
        enablePredictions: true,
        enableRealtimeAnalytics: true,
        enableOptimizations: true,
        enableAlerts: true,
        ...config.features,
      },
    };

    this.initializeServices();
  }

  /**
   * Initialize all services
   */
  private initializeServices(): void {
    try {
      // Initialize token accounting service
      this.tokenService = new TokenAccountingService();

      // Initialize hierarchical budget manager
      this.budgetManager = new HierarchicalBudgetManager();

      // Initialize multi-agent cost controller
      this.costController = new MultiAgentCostController(
        this.tokenService,
        this.budgetManager
      );

      // Initialize predictive analytics service
      if (this.config.features?.enablePredictions) {
        this.predictiveService = new PredictiveAnalyticsService(
          this.costController,
          this.tokenService,
          this.budgetManager
        );
      }

      // Initialize real-time analytics service
      if (this.config.features?.enableRealtimeAnalytics) {
        this.realtimeService = new RealtimeAnalyticsService(
          this.costController,
          this.predictiveService,
          this.config.realtimeAnalytics?.port,
          {
            refreshInterval: this.config.realtimeAnalytics?.refreshInterval,
            maxConnections: this.config.realtimeAnalytics?.maxConnections,
          }
        );
      }

      // Initialize API
      this.api = new CircuitBreakerApi(
        this.costController,
        this.realtimeService,
        this.predictiveService
      );

      console.log('🚀 Token Shield Enterprise services initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Token Shield Enterprise services:', error);
      throw error;
    }
  }

  /**
   * Start all services
   */
  async start(): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ Token Shield Enterprise is already running');
      return;
    }

    try {
      console.log('🚀 Starting Token Shield Enterprise...');

      // Start real-time analytics service
      if (this.config.features?.enableRealtimeAnalytics && this.realtimeService) {
        await this.realtimeService.start();
        console.log(`🔥 Real-time analytics service started on port ${this.config.realtimeAnalytics?.port}`);
      }

      // Start API server
      // Note: In a real implementation, you would integrate this with your Express app
      console.log(`🌐 API server configured for port ${this.config.api?.port}`);

      this.isInitialized = true;
      console.log('✅ Token Shield Enterprise started successfully');

    } catch (error) {
      console.error('❌ Failed to start Token Shield Enterprise:', error);
      throw error;
    }
  }

  /**
   * Stop all services
   */
  async stop(): Promise<void> {
    if (!this.isInitialized) {
      console.log('⚠️ Token Shield Enterprise is not running');
      return;
    }

    try {
      console.log('🛑 Stopping Token Shield Enterprise...');

      // Stop real-time analytics service
      if (this.realtimeService) {
        await this.realtimeService.stop();
        console.log('🔥 Real-time analytics service stopped');
      }

      this.isInitialized = false;
      console.log('✅ Token Shield Enterprise stopped successfully');

    } catch (error) {
      console.error('❌ Failed to stop Token Shield Enterprise:', error);
      throw error;
    }
  }

  /**
   * Create a new agent
   */
  async createAgent(agentConfig: any): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Token Shield Enterprise is not initialized');
    }

    return await this.costController.createAgent(agentConfig);
  }

  /**
   * Consume tokens for an agent
   */
  async consumeTokens(agentId: string, tokens: number, cost: number, modelTier?: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Token Shield Enterprise is not initialized');
    }

    return await this.costController.consumeTokens(agentId, tokens, cost, modelTier);
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): any {
    if (!this.isInitialized) {
      throw new Error('Token Shield Enterprise is not initialized');
    }

    if (this.realtimeService) {
      return this.realtimeService.getCurrentMetrics();
    }

    return null;
  }

  /**
   * Get system health
   */
  getSystemHealth(): any {
    if (!this.isInitialized) {
      throw new Error('Token Shield Enterprise is not initialized');
    }

    if (this.realtimeService) {
      return this.realtimeService.getSystemHealth();
    }

    return { status: 'unknown', score: 0, issues: ['Real-time analytics not available'] };
  }

  /**
   * Get API router
   */
  getApiRouter(): any {
    return this.api.getRouter();
  }

  /**
   * Get cost controller
   */
  getCostController(): MultiAgentCostController {
    return this.costController;
  }

  /**
   * Get token service
   */
  getTokenService(): TokenAccountingService {
    return this.tokenService;
  }

  /**
   * Get budget manager
   */
  getBudgetManager(): HierarchicalBudgetManager {
    return this.budgetManager;
  }

  /**
   * Get predictive service
   */
  getPredictiveService(): PredictiveAnalyticsService | undefined {
    return this.predictiveService;
  }

  /**
   * Get real-time service
   */
  getRealtimeService(): RealtimeAnalyticsService | undefined {
    return this.realtimeService;
  }

  /**
   * Get configuration
   */
  getConfig(): TokenShieldEnterpriseConfig {
    return { ...this.config };
  }

  /**
   * Check if initialized
   */
  isRunning(): boolean {
    return this.isInitialized;
  }

  /**
   * Get service statistics
   */
  getStatistics(): any {
    if (!this.isInitialized) {
      return { status: 'not_initialized' };
    }

    const agents = Array.from((this.costController as any).agents?.values() || []);
    const swarms = Array.from((this.costController as any).swarms?.values() || []);

    return {
      status: 'running',
      services: {
        costController: {
          totalAgents: agents.length,
          activeAgents: agents.filter((agent: any) => agent.status === 'active').length,
          totalSwarms: swarms.length,
          totalCost: agents.reduce((sum: number, agent: any) => sum + (agent.costTracking?.total || 0), 0),
          totalTokens: agents.reduce((sum: number, agent: any) => sum + agent.tokensUsed, 0),
        },
        realtimeAnalytics: {
          isEnabled: !!this.realtimeService,
          connectedClients: this.realtimeService ? (this.realtimeService as any).clients?.size || 0 : 0,
          metricsHistory: this.realtimeService ? (this.realtimeService as any).metricsHistory?.length || 0 : 0,
        },
        predictiveAnalytics: {
          isEnabled: !!this.predictiveService,
        },
      },
      uptime: process.uptime(),
      timestamp: new Date(),
    };
  }
}

// Export individual services for direct usage
export {
  MultiAgentCostController,
  HierarchicalBudgetManager,
  TokenAccountingService,
  PredictiveAnalyticsService,
  RealtimeAnalyticsService,
  CircuitBreakerApi,
};

// Export types
export type {
  TokenShieldEnterpriseConfig,
};

export default TokenShieldEnterprise;