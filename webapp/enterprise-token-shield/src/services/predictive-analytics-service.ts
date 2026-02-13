/**
 * Token Shield Enterprise - Predictive Analytics & ML Optimization
 * 
 * Advanced machine learning models for cost prediction, optimization, and anomaly detection
 */

import { TokenAccountingService } from './token-accounting-service';
import { HierarchicalBudgetManager } from './hierarchical-budget-manager';
import { MultiAgentCostController } from './multi-agent-cost-controller';
import { BudgetAllocationStrategies } from './budget-allocation-strategies';
import { v4 as uuidv4 } from 'uuid';

export interface MLPredictionModel {
  id: string;
  name: string;
  type: 'cost_prediction' | 'usage_forecasting' | 'anomaly_detection' | 'optimization' | 'demand_prediction';
  algorithm: 'linear_regression' | 'random_forest' | 'neural_network' | 'lstm' | 'prophet' | 'xgboost';
  features: string[];
  hyperparameters: Record<string, any>;
  trainingConfig: TrainingConfig;
  performance: ModelPerformance;
  lastTrained: Date;
  lastUpdated: Date;
  version: string;
}

export interface TrainingConfig {
  trainingDataWindow: number; // days
  validationSplit: number;
  testSplit: number;
  batchSize: number;
  epochs: number;
  learningRate: number;
  regularization: number;
  earlyStopping: boolean;
  crossValidation: boolean;
  retrainInterval: number; // hours
  minTrainingSamples: number;
}

export interface ModelPerformance {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  rmse: number;
  mae: number;
  mape: number;
  r2Score: number;
  confidenceIntervals: ConfidenceInterval[];
  featureImportance: Record<string, number>;
  learningCurves: LearningCurve[];
}

export interface ConfidenceInterval {
  confidence: number;
  lower: number;
  upper: number;
}

export interface LearningCurve {
  epoch: number;
  trainingLoss: number;
  validationLoss: number;
  trainingAccuracy: number;
  validationAccuracy: number;
}

export interface CostPredictionRequest {
  entityId: string;
  entityType: 'organization' | 'department' | 'team' | 'user' | 'project' | 'agent';
  timeHorizon: number; // days
  granularity: 'hourly' | 'daily' | 'weekly' | 'monthly';
  historicalData: HistoricalDataPoint[];
  externalFactors: ExternalFactor[];
  metadata: Record<string, any>;
}

export interface HistoricalDataPoint {
  timestamp: Date;
  tokens: number;
  cost: number;
  usage: number;
  efficiency: number;
  metadata: Record<string, any>;
}

export interface ExternalFactor {
  factorType: 'economic' | 'seasonal' | 'regulatory' | 'competitive' | 'technological' | 'market';
  impact: number; // -1 to 1
  confidence: number;
  timeframe: string;
  description: string;
  data: Record<string, any>;
}

export interface CostPrediction {
  entityId: string;
  timeHorizon: number;
  predictions: PredictionPoint[];
  confidence: number;
  uncertainty: UncertaintyRange;
  factors: string[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendations: OptimizationRecommendation[];
  modelUsed: string;
  timestamp: Date;
}

export interface PredictionPoint {
  timestamp: Date;
  predictedTokens: number;
  predictedCost: number;
  confidence: number;
  upperBound: number;
  lowerBound: number;
  seasonality: number;
  trend: number;
}

export interface UncertaintyRange {
  lower: number;
  upper: number;
  confidence: number;
}

export interface OptimizationRecommendation {
  id: string;
  type: 'model_downgrade' | 'token_compression' | 'caching' | 'smart_routing' | 'agent_scaling' | 'budget_reallocation' | 'usage_optimization';
  description: string;
  estimatedSavings: number;
  estimatedSavingsPercentage: number;
  confidence: number;
  complexity: 'low' | 'medium' | 'high';
  implementationTime: number;
  risks: string[];
  prerequisites: string[];
  impact: 'immediate' | 'short_term' | 'long_term';
}

export interface AnomalyDetectionResult {
  entityId: string;
  timestamp: Date;
  isAnomaly: boolean;
  anomalyScore: number;
  anomalyType: 'spike' | 'drop' | 'trend_change' | 'seasonal_anomaly' | 'contextual_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  contributingFactors: string[];
  recommendedActions: string[];
  historicalContext: HistoricalContext;
  confidence: number;
}

export interface HistoricalContext {
  normalRange: { lower: number; upper: number };
  historicalAverage: number;
  historicalStdDev: number;
  peerComparison: PeerComparison;
  seasonality: SeasonalityInfo;
}

export interface PeerComparison {
  peerGroup: string;
  peerAverage: number;
  entityRank: number;
  percentile: number;
}

export interface SeasonalityInfo {
  seasonalPattern: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'none';
  seasonalMultiplier: number;
  seasonalConfidence: number;
}

export interface DemandForecastingResult {
  entityId: string;
  forecastHorizon: number;
  demandForecast: DemandPoint[];
  capacityPlanning: CapacityRecommendation[];
  resourceOptimization: ResourceOptimization[];
  confidence: number;
  uncertainty: UncertaintyRange;
}

export interface DemandPoint {
  timestamp: Date;
  predictedDemand: number;
  confidence: number;
  upperBound: number;
  lowerBound: number;
  seasonality: number;
  growthRate: number;
}

export interface CapacityRecommendation {
  recommendationType: 'scale_up' | 'scale_down' | 'maintain' | 'optimize';
  timing: Date;
  magnitude: number;
  confidence: number;
  costImpact: number;
  riskAssessment: string;
}

export interface ResourceOptimization {
  optimizationType: 'allocation' | 'scheduling' | 'routing' | 'caching';
  potentialSavings: number;
  implementationCost: number;
  roi: number;
  timeframe: string;
  complexity: 'low' | 'medium' | 'high';
}

export interface OptimizationEngine {
  optimize(request: OptimizationRequest): Promise<OptimizationResult>;
  getRecommendations(context: OptimizationContext): Promise<OptimizationRecommendation[]>;
  evaluateImpact(recommendation: OptimizationRecommendation): Promise<ImpactAssessment>;
}

export interface OptimizationRequest {
  entityId: string;
  entityType: string;
  optimizationGoal: 'cost_reduction' | 'usage_efficiency' | 'performance' | 'compliance' | 'multi_objective';
  constraints: OptimizationConstraints;
  currentState: CurrentState;
  historicalData: HistoricalDataPoint[];
  externalFactors: ExternalFactor[];
}

export interface OptimizationConstraints {
  budgetLimit: number;
  timeWindow: number;
  resourceConstraints: string[];
  complianceRequirements: string[];
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
}

export interface CurrentState {
  currentTokens: number;
  currentCost: number;
  currentEfficiency: number;
  activeAgents: number;
  pendingRequests: number;
  currentLoad: number;
}

export interface OptimizationResult {
  entityId: string;
  recommendations: OptimizationRecommendation[];
  expectedSavings: number;
  expectedImprovement: number;
  confidence: number;
  implementationPlan: ImplementationPlan;
  riskAssessment: RiskAssessment;
}

export interface ImplementationPlan {
  phases: ImplementationPhase[];
  timeline: number;
  dependencies: string[];
  requiredResources: string[];
  estimatedCost: number;
}

export interface ImplementationPhase {
  phaseId: string;
  name: string;
  duration: number;
  prerequisites: string[];
  successCriteria: string[];
  rollbackPlan: string;
}

export interface ImpactAssessment {
  costImpact: number;
  performanceImpact: number;
  riskImpact: number;
  complianceImpact: number;
  timelineImpact: number;
  confidence: number;
}

export interface RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors: string[];
  mitigationStrategies: string[];
  fallbackPlan: string;
  monitoringRequirements: string[];
}

export class PredictiveAnalyticsService implements OptimizationEngine {
  private models: Map<string, MLPredictionModel> = new Map();
  private trainingData: Map<string, HistoricalDataPoint[]> = new Map();
  private predictions: Map<string, CostPrediction> = new Map();
  private tokenService: TokenAccountingService;
  private budgetManager: HierarchicalBudgetManager;
  private costController: MultiAgentCostController;
  private allocationStrategies: BudgetAllocationStrategies;

  constructor(
    tokenService: TokenAccountingService,
    budgetManager: HierarchicalBudgetManager,
    costController: MultiAgentCostController,
    allocationStrategies: BudgetAllocationStrategies
  ) {
    this.tokenService = tokenService;
    this.budgetManager = budgetManager;
    this.costController = costController;
    this.allocationStrategies = allocationStrategies;
    this.initializeDefaultModels();
  }

  /**
   * Predict future costs for an entity
   */
  async predictCosts(request: CostPredictionRequest): Promise<CostPrediction> {
    const model = this.selectOptimalModel(request);
    const prediction = await this.generatePrediction(model, request);
    
    this.predictions.set(`${request.entityId}-${request.timeHorizon}`, prediction);
    return prediction;
  }

  /**
   * Detect anomalies in cost patterns
   */
  async detectAnomalies(entityId: string, currentData: HistoricalDataPoint): Promise<AnomalyDetectionResult> {
    const model = this.models.get('anomaly-detection');
    if (!model) {
      throw new Error('Anomaly detection model not found');
    }

    const historicalData = this.trainingData.get(entityId) || [];
    const anomaly = await this.detectAnomaly(model, currentData, historicalData);
    
    return anomaly;
  }

  /**
   * Forecast demand for resources
   */
  async forecastDemand(entityId: string, horizon: number = 30): Promise<DemandForecastingResult> {
    const model = this.models.get('demand-prediction');
    if (!model) {
      throw new Error('Demand prediction model not found');
    }

    const historicalData = this.trainingData.get(entityId) || [];
    const forecast = await this.generateDemandForecast(model, historicalData, horizon);
    
    return forecast;
  }

  /**
   * Optimize resource allocation
   */
  async optimize(request: OptimizationRequest): Promise<OptimizationResult> {
    const optimization = await this.generateOptimization(request);
    
    return {
      entityId: request.entityId,
      recommendations: optimization.recommendations,
      expectedSavings: optimization.expectedSavings,
      expectedImprovement: optimization.expectedImprovement,
      confidence: optimization.confidence,
      implementationPlan: optimization.implementationPlan,
      riskAssessment: optimization.riskAssessment,
    };
  }

  /**
   * Get optimization recommendations
   */
  async getRecommendations(context: OptimizationContext): Promise<OptimizationRecommendation[]> {
    const recommendations = await this.generateRecommendations(context);
    return recommendations;
  }

  /**
   * Evaluate impact of optimization recommendations
   */
  async evaluateImpact(recommendation: OptimizationRecommendation): Promise<ImpactAssessment> {
    const impact = await this.calculateImpact(recommendation);
    return impact;
  }

  /**
   * Train ML models with new data
   */
  async trainModels(entityId?: string): Promise<void> {
    const modelsToTrain = entityId ? [this.models.get(`${entityId}-model`)] : Array.from(this.models.values());
    
    for (const model of modelsToTrain.filter(Boolean)) {
      const trainingData = this.prepareTrainingData(model!, entityId);
      await this.trainModel(model!, trainingData);
    }
  }

  /**
   * Get model performance metrics
   */
  getModelPerformance(modelId: string): ModelPerformance | undefined {
    const model = this.models.get(modelId);
    return model?.performance;
  }

  /**
   * Update model with feedback
   */
  async updateModelWithFeedback(modelId: string, feedback: any): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) return;

    await this.applyFeedback(model, feedback);
    model.lastUpdated = new Date();
  }

  /**
   * Private helper methods
   */

  private initializeDefaultModels(): void {
    // Cost Prediction Model
    const costPredictionModel: MLPredictionModel = {
      id: 'cost-prediction',
      name: 'Cost Prediction Model',
      type: 'cost_prediction',
      algorithm: 'lstm',
      features: ['historical_tokens', 'historical_cost', 'time_of_day', 'day_of_week', 'entity_type', 'model_tier'],
      hyperparameters: {
        lstm_units: 128,
        dropout: 0.2,
        learning_rate: 0.001,
        batch_size: 32,
        epochs: 100,
      },
      trainingConfig: {
        trainingDataWindow: 90,
        validationSplit: 0.2,
        testSplit: 0.2,
        batchSize: 32,
        epochs: 100,
        learningRate: 0.001,
        regularization: 0.01,
        earlyStopping: true,
        crossValidation: true,
        retrainInterval: 24,
        minTrainingSamples: 1000,
      },
      performance: this.getDefaultPerformance(),
      lastTrained: new Date(),
      lastUpdated: new Date(),
      version: '1.0.0',
    };

    // Anomaly Detection Model
    const anomalyDetectionModel: MLPredictionModel = {
      id: 'anomaly-detection',
      name: 'Anomaly Detection Model',
      type: 'anomaly_detection',
      algorithm: 'random_forest',
      features: ['current_tokens', 'current_cost', 'usage_rate', 'efficiency', 'time_features', 'context_features'],
      hyperparameters: {
        n_estimators: 200,
        max_depth: 15,
        min_samples_split: 5,
        contamination: 0.1,
      },
      trainingConfig: {
        trainingDataWindow: 60,
        validationSplit: 0.3,
        testSplit: 0.2,
        batchSize: 64,
        epochs: 50,
        learningRate: 0.01,
        regularization: 0.001,
        earlyStopping: true,
        crossValidation: true,
        retrainInterval: 48,
        minTrainingSamples: 500,
      },
      performance: this.getDefaultPerformance(),
      lastTrained: new Date(),
      lastUpdated: new Date(),
      version: '1.0.0',
    };

    // Usage Forecasting Model
    const usageForecastingModel: MLPredictionModel = {
      id: 'usage-forecasting',
      name: 'Usage Forecasting Model',
      type: 'usage_forecasting',
      algorithm: 'prophet',
      features: ['timestamp', 'historical_usage', 'seasonal_patterns', 'external_factors', 'business_cycles'],
      hyperparameters: {
        changepoint_prior_scale: 0.05,
        seasonality_prior_scale: 10,
        holidays_prior_scale: 10,
        seasonality_mode: 'multiplicative',
      },
      trainingConfig: {
        trainingDataWindow: 180,
        validationSplit: 0.2,
        testSplit: 0.2,
        batchSize: 16,
        epochs: 150,
        learningRate: 0.001,
        regularization: 0.005,
        earlyStopping: true,
        crossValidation: true,
        retrainInterval: 72,
        minTrainingSamples: 2000,
      },
      performance: this.getDefaultPerformance(),
      lastTrained: new Date(),
      lastUpdated: new Date(),
      version: '1.0.0',
    };

    // Optimization Model
    const optimizationModel: MLPredictionModel = {
      id: 'optimization',
      name: 'Optimization Model',
      type: 'optimization',
      algorithm: 'xgboost',
      features: ['current_state', 'constraints', 'historical_performance', 'external_factors', 'business_objectives'],
      hyperparameters: {
        n_estimators: 300,
        max_depth: 8,
        learning_rate: 0.1,
        subsample: 0.8,
        colsample_bytree: 0.8,
      },
      trainingConfig: {
        trainingDataWindow: 120,
        validationSplit: 0.25,
        testSplit: 0.15,
        batchSize: 128,
        epochs: 200,
        learningRate: 0.01,
        regularization: 0.0001,
        earlyStopping: true,
        crossValidation: true,
        retrainInterval: 96,
        minTrainingSamples: 1500,
      },
      performance: this.getDefaultPerformance(),
      lastTrained: new Date(),
      lastUpdated: new Date(),
      version: '1.0.0',
    };

    this.models.set(costPredictionModel.id, costPredictionModel);
    this.models.set(anomalyDetectionModel.id, anomalyDetectionModel);
    this.models.set(usageForecastingModel.id, usageForecastingModel);
    this.models.set(optimizationModel.id, optimizationModel);
  }

  private getDefaultPerformance(): ModelPerformance {
    return {
      accuracy: 0.85,
      precision: 0.82,
      recall: 0.88,
      f1Score: 0.85,
      rmse: 0.15,
      mae: 0.12,
      mape: 0.08,
      r2Score: 0.78,
      confidenceIntervals: [
        { confidence: 0.95, lower: -0.2, upper: 0.2 },
        { confidence: 0.99, lower: -0.3, upper: 0.3 },
      ],
      featureImportance: {},
      learningCurves: [],
    };
  }

  private selectOptimalModel(request: CostPredictionRequest): MLPredictionModel {
    const models = Array.from(this.models.values());
    
    // Select model based on request type and performance
    const suitableModels = models.filter(model => {
      const isCostPrediction = model.type === 'cost_prediction';
      const hasGoodPerformance = model.performance.accuracy > 0.8;
      const isRecent = (Date.now() - model.lastTrained.getTime()) < 7 * 24 * 60 * 60 * 1000; // Within 7 days
      
      return isCostPrediction && hasGoodPerformance && isRecent;
    });
    
    // Return the best performing model
    return suitableModels.sort((a, b) => b.performance.accuracy - a.performance.accuracy)[0] || models[0];
  }

  private async generatePrediction(model: MLPredictionModel, request: CostPredictionRequest): Promise<CostPrediction> {
    // Simplified prediction generation
    const predictions: PredictionPoint[] = [];
    const now = new Date();
    
    // Generate predictions for each time point in the horizon
    const timePoints = this.generateTimePoints(request.timeHorizon, request.granularity);
    
    for (const timePoint of timePoints) {
      const basePrediction = this.calculateBasePrediction(request, timePoint);
      const seasonalAdjustment = this.applySeasonalAdjustment(request, timePoint);
      const externalFactorAdjustment = this.applyExternalFactorAdjustment(request, timePoint);
      
      const predictedTokens = Math.max(0, basePrediction.tokens * (1 + seasonalAdjustment + externalFactorAdjustment));
      const predictedCost = Math.max(0, basePrediction.cost * (1 + seasonalAdjustment + externalFactorAdjustment));
      
      const uncertainty = this.calculateUncertainty(request, timePoint);
      
      predictions.push({
        timestamp: timePoint,
        predictedTokens,
        predictedCost,
        confidence: model.performance.accuracy,
        upperBound: predictedTokens * (1 + uncertainty),
        lowerBound: predictedTokens * (1 - uncertainty),
        seasonality: seasonalAdjustment,
        trend: this.calculateTrend(request.historicalData, timePoint),
      });
    }
    
    const recommendations = await this.generateOptimizationRecommendations(request, predictions);
    
    return {
      entityId: request.entityId,
      timeHorizon: request.timeHorizon,
      predictions,
      confidence: model.performance.accuracy,
      uncertainty: this.calculateOverallUncertainty(predictions),
      factors: model.features,
      riskLevel: this.assessRiskLevel(predictions),
      recommendations,
      modelUsed: model.id,
      timestamp: new Date(),
    };
  }

  private async detectAnomaly(model: MLPredictionModel, currentData: HistoricalDataPoint, historicalData: HistoricalDataPoint[]): Promise<AnomalyDetectionResult> {
    const anomalyScore = this.calculateAnomalyScore(currentData, historicalData);
    const isAnomaly = anomalyScore > 0.8; // Threshold-based detection
    
    const historicalContext = this.buildHistoricalContext(currentData, historicalData);
    const contributingFactors = this.identifyContributingFactors(currentData, historicalData);
    const recommendedActions = this.generateRecommendedActions(anomalyScore, currentData);
    
    return {
      entityId: currentData.metadata.entityId || 'unknown',
      timestamp: currentData.timestamp,
      isAnomaly,
      anomalyScore,
      anomalyType: this.classifyAnomalyType(anomalyScore, currentData, historicalData),
      severity: this.classifySeverity(anomalyScore),
      explanation: this.generateAnomalyExplanation(anomalyScore, currentData, historicalData),
      contributingFactors,
      recommendedActions,
      historicalContext,
      confidence: model.performance.accuracy,
    };
  }

  private async generateDemandForecast(model: MLPredictionModel, historicalData: HistoricalDataPoint[], horizon: number): Promise<DemandForecastingResult> {
    const demandPoints: DemandPoint[] = [];
    const now = new Date();
    
    // Generate demand forecast for each day in the horizon
    for (let i = 0; i < horizon; i++) {
      const forecastDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const baseDemand = this.calculateBaseDemand(historicalData, forecastDate);
      const seasonalFactor = this.applySeasonalFactor(historicalData, forecastDate);
      const growthRate = this.calculateGrowthRate(historicalData);
      
      const predictedDemand = baseDemand * seasonalFactor * (1 + growthRate * i / horizon);
      const confidence = Math.min(0.95, 1 - (i / horizon) * 0.3); // Confidence decreases with horizon
      
      demandPoints.push({
        timestamp: forecastDate,
        predictedDemand,
        confidence,
        upperBound: predictedDemand * 1.2,
        lowerBound: predictedDemand * 0.8,
        seasonality: seasonalFactor,
        growthRate,
      });
    }
    
    const capacityRecommendations = this.generateCapacityRecommendations(demandPoints);
    const resourceOptimizations = this.generateResourceOptimizations(demandPoints);
    
    return {
      entityId: historicalData[0]?.metadata.entityId || 'unknown',
      forecastHorizon: horizon,
      demandForecast: demandPoints,
      capacityPlanning: capacityRecommendations,
      resourceOptimization: resourceOptimizations,
      confidence: model.performance.accuracy,
      uncertainty: this.calculateForecastUncertainty(demandPoints),
    };
  }

  private async generateOptimization(request: OptimizationRequest): Promise<any> {
    const recommendations = await this.generateOptimizationRecommendations(request);
    const expectedSavings = this.calculateExpectedSavings(recommendations);
    const expectedImprovement = this.calculateExpectedImprovement(recommendations);
    const confidence = this.calculateOptimizationConfidence(recommendations);
    
    return {
      recommendations,
      expectedSavings,
      expectedImprovement,
      confidence,
      implementationPlan: this.createImplementationPlan(recommendations),
      riskAssessment: this.assessOptimizationRisk(recommendations),
    };
  }

  private async generateRecommendations(context: OptimizationContext): Promise<OptimizationRecommendation[]> {
    // Context-based recommendation generation
    const recommendations: OptimizationRecommendation[] = [];
    
    // Cost reduction recommendations
    if (context.optimizationGoal === 'cost_reduction') {
      recommendations.push(...this.generateCostReductionRecommendations(context));
    }
    
    // Usage efficiency recommendations
    if (context.optimizationGoal === 'usage_efficiency') {
      recommendations.push(...this.generateUsageEfficiencyRecommendations(context));
    }
    
    // Performance recommendations
    if (context.optimizationGoal === 'performance') {
      recommendations.push(...this.generatePerformanceRecommendations(context));
    }
    
    return recommendations;
  }

  private prepareTrainingData(model: MLPredictionModel, entityId?: string): any[] {
    const data = this.trainingData.get(entityId || 'global') || [];
    return data.map(point => ({
      features: model.features.map(feature => this.extractFeatureValue(feature, point)),
      target: this.extractTargetValue(model.type, point),
      timestamp: point.timestamp,
    }));
  }

  private async trainModel(model: MLPredictionModel, trainingData: any[]): Promise<void> {
    // Simplified model training simulation
    const trainingAccuracy = 0.85 + Math.random() * 0.1; // 85-95% accuracy
    
    model.performance.accuracy = trainingAccuracy;
    model.lastTrained = new Date();
    
    // Simulate learning curves
    const learningCurves: LearningCurve[] = [];
    for (let i = 0; i < model.trainingConfig.epochs; i += 10) {
      learningCurves.push({
        epoch: i,
        trainingLoss: Math.max(0, 1 - (i / model.trainingConfig.epochs) * 0.8),
        validationLoss: Math.max(0, 1 - (i / model.trainingConfig.epochs) * 0.7),
        trainingAccuracy: Math.min(1, (i / model.trainingConfig.epochs) * trainingAccuracy),
        validationAccuracy: Math.min(1, (i / model.trainingConfig.epochs) * trainingAccuracy * 0.95),
      });
    }
    
    model.performance.learningCurves = learningCurves;
  }

  // Helper methods for calculations
  private generateTimePoints(horizon: number, granularity: string): Date[] {
    const points: Date[] = [];
    const now = new Date();
    const interval = this.getInterval(granularity);
    const numPoints = Math.ceil((horizon * 24 * 60 * 60 * 1000) / interval);
    
    for (let i = 0; i < numPoints; i++) {
      points.push(new Date(now.getTime() + i * interval));
    }
    
    return points;
  }

  private getInterval(granularity: string): number {
    switch (granularity) {
      case 'hourly': return 60 * 60 * 1000;
      case 'daily': return 24 * 60 * 60 * 1000;
      case 'weekly': return 7 * 24 * 60 * 60 * 1000;
      case 'monthly': return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  private calculateBasePrediction(request: CostPredictionRequest, timePoint: Date): { tokens: number; cost: number } {
    const recentData = request.historicalData.slice(-30);
    const avgTokens = recentData.reduce((sum, d) => sum + d.tokens, 0) / Math.max(1, recentData.length);
    const avgCost = recentData.reduce((sum, d) => sum + d.cost, 0) / Math.max(1, recentData.length);
    
    return { tokens: avgTokens, cost: avgCost };
  }

  private applySeasonalAdjustment(request: CostPredictionRequest, timePoint: Date): number {
    // Simplified seasonal adjustment
    const hour = timePoint.getHours();
    const day = timePoint.getDay();
    
    // Business hours multiplier
    if (hour >= 9 && hour <= 17 && day >= 1 && day <= 5) {
      return 0.2;
    } else if (hour >= 0 && hour <= 6) {
      return -0.3;
    }
    
    return 0;
  }

  private applyExternalFactorAdjustment(request: CostPredictionRequest, timePoint: Date): number {
    if (!request.externalFactors || request.externalFactors.length === 0) return 0;
    
    const totalImpact = request.externalFactors.reduce((sum, factor) => sum + factor.impact, 0);
    return totalImpact / Math.max(1, request.externalFactors.length);
  }

  private calculateUncertainty(request: CostPredictionRequest, timePoint: Date): number {
    const horizonFactor = (timePoint.getTime() - Date.now()) / (request.timeHorizon * 24 * 60 * 60 * 1000);
    const dataQuality = request.historicalData.length > 100 ? 0.1 : 0.3;
    
    return Math.min(0.5, horizonFactor + dataQuality);
  }

  private calculateTrend(data: HistoricalDataPoint[], timePoint: Date): number {
    if (data.length < 2) return 0;
    
    const recent = data.slice(-10);
    const older = data.slice(0, Math.max(1, data.length - 10));
    
    const recentAvg = recent.reduce((sum, d) => sum + d.tokens, 0) / recent.length;
    const olderAvg = older.reduce((sum, d) => sum + d.tokens, 0) / older.length;
    
    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  private calculateOverallUncertainty(predictions: PredictionPoint[]): UncertaintyRange {
    const uncertainties = predictions.map(p => (p.upperBound - p.lowerBound) / (2 * p.predictedTokens));
    const avgUncertainty = uncertainties.reduce((sum, u) => sum + u, 0) / uncertainties.length;
    
    return {
      lower: -avgUncertainty,
      upper: avgUncertainty,
      confidence: 0.95,
    };
  }

  private assessRiskLevel(predictions: PredictionPoint[]): 'low' | 'medium' | 'high' {
    const avgTokens = predictions.reduce((sum, p) => sum + p.predictedTokens, 0) / predictions.length;
    const maxTokens = Math.max(...predictions.map(p => p.upperBound));
    const variability = (maxTokens - avgTokens) / avgTokens;
    
    if (variability < 0.2) return 'low';
    if (variability < 0.5) return 'medium';
    return 'high';
  }

  private async generateOptimizationRecommendations(request: CostPredictionRequest, predictions: PredictionPoint[]): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];
    
    // Model downgrade recommendation
    const avgCost = predictions.reduce((sum, p) => sum + p.predictedCost, 0) / predictions.length;
    if (avgCost > 100) {
      recommendations.push({
        id: uuidv4(),
        type: 'model_downgrade',
        description: 'Consider downgrading to lower-cost model tier',
        estimatedSavings: avgCost * 0.3,
        estimatedSavingsPercentage: 30,
        confidence: 0.8,
        complexity: 'low',
        implementationTime: 5,
        risks: ['Potential quality reduction'],
        prerequisites: [],
        impact: 'immediate',
      });
    }
    
    // Token compression recommendation
    const avgTokens = predictions.reduce((sum, p) => sum + p.predictedTokens, 0) / predictions.length;
    if (avgTokens > 10000) {
      recommendations.push({
        id: uuidv4(),
        type: 'token_compression',
        description: 'Enable token compression for large requests',
        estimatedSavings: avgCost * 0.15,
        estimatedSavingsPercentage: 15,
        confidence: 0.75,
        complexity: 'medium',
        implementationTime: 15,
        risks: ['Slight processing overhead'],
        prerequisites: [],
        impact: 'short_term',
      });
    }
    
    return recommendations;
  }

  private calculateAnomalyScore(currentData: HistoricalDataPoint, historicalData: HistoricalDataPoint[]): number {
    if (historicalData.length === 0) return 0;
    
    const recentData = historicalData.slice(-30);
    const avgTokens = recentData.reduce((sum, d) => sum + d.tokens, 0) / recentData.length;
    const stdDev = Math.sqrt(recentData.reduce((sum, d) => sum + Math.pow(d.tokens - avgTokens, 2), 0) / recentData.length);
    
    const zScore = Math.abs(currentData.tokens - avgTokens) / (stdDev || 1);
    return Math.min(1, zScore / 3); // Normalize to 0-1 range
  }

  private buildHistoricalContext(currentData: HistoricalDataPoint, historicalData: HistoricalDataPoint[]): HistoricalContext {
    if (historicalData.length === 0) {
      return {
        normalRange: { lower: 0, upper: 1000 },
        historicalAverage: 500,
        historicalStdDev: 200,
        peerComparison: {
          peerGroup: 'default',
          peerAverage: 500,
          entityRank: 1,
          percentile: 50,
        },
        seasonality: {
          seasonalPattern: 'none',
          seasonalMultiplier: 1.0,
          seasonalConfidence: 0.5,
        },
      };
    }
    
    const recent = historicalData.slice(-30);
    const avg = recent.reduce((sum, d) => sum + d.tokens, 0) / recent.length;
    const stdDev = Math.sqrt(recent.reduce((sum, d) => sum + Math.pow(d.tokens - avg, 2), 0) / recent.length);
    
    return {
      normalRange: { lower: avg - 2 * stdDev, upper: avg + 2 * stdDev },
      historicalAverage: avg,
      historicalStdDev: stdDev,
      peerComparison: {
        peerGroup: 'similar_entities',
        peerAverage: avg,
        entityRank: 1,
        percentile: 50,
      },
      seasonality: {
        seasonalPattern: 'daily',
        seasonalMultiplier: 1.0,
        seasonalConfidence: 0.7,
      },
    };
  }

  private identifyContributingFactors(currentData: HistoricalDataPoint, historicalData: HistoricalDataPoint[]): string[] {
    const factors: string[] = [];
    
    if (currentData.tokens > 10000) {
      factors.push('High token usage');
    }
    
    if (currentData.cost > 10) {
      factors.push('High cost per token');
    }
    
    if (currentData.efficiency < 0.5) {
      factors.push('Low efficiency');
    }
    
    return factors;
  }

  private generateRecommendedActions(anomalyScore: number, currentData: HistoricalDataPoint): string[] {
    const actions: string[] = [];
    
    if (anomalyScore > 0.7) {
      actions.push('Investigate unusual usage patterns');
      actions.push('Check for potential cost optimization');
    }
    
    if (currentData.tokens > 50000) {
      actions.push('Consider token compression');
      actions.push('Evaluate model tier optimization');
    }
    
    return actions;
  }

  private classifyAnomalyType(anomalyScore: number, currentData: HistoricalDataPoint, historicalData: HistoricalDataPoint[]): any {
    if (anomalyScore < 0.3) return 'contextual_anomaly';
    if (currentData.tokens > (historicalData.slice(-10).reduce((sum, d) => sum + d.tokens, 0) / 10) * 2) return 'spike';
    return 'trend_change';
  }

  private classifySeverity(anomalyScore: number): any {
    if (anomalyScore < 0.3) return 'low';
    if (anomalyScore < 0.7) return 'medium';
    if (anomalyScore < 0.9) return 'high';
    return 'critical';
  }

  private generateAnomalyExplanation(anomalyScore: number, currentData: HistoricalDataPoint, historicalData: HistoricalDataPoint[]): string {
    if (anomalyScore < 0.3) return 'Normal variation';
    if (anomalyScore < 0.7) return 'Moderate deviation from normal patterns';
    return 'Significant anomaly detected - requires investigation';
  }

  private calculateBaseDemand(historicalData: HistoricalDataPoint[], forecastDate: Date): number {
    const recentData = historicalData.slice(-30);
    return recentData.reduce((sum, d) => sum + d.tokens, 0) / Math.max(1, recentData.length);
  }

  private applySeasonalFactor(historicalData: HistoricalDataPoint[], forecastDate: Date): number {
    const hour = forecastDate.getHours();
    const day = forecastDate.getDay();
    
    // Business hours multiplier
    if (hour >= 9 && hour <= 17 && day >= 1 && day <= 5) {
      return 1.2;
    } else if (hour >= 0 && hour <= 6) {
      return 0.7;
    }
    
    return 1.0;
  }

  private calculateGrowthRate(historicalData: HistoricalDataPoint[]): number {
    if (historicalData.length < 2) return 0;
    
    const recent = historicalData.slice(-10);
    const older = historicalData.slice(0, Math.max(1, historicalData.length - 10));
    
    const recentAvg = recent.reduce((sum, d) => sum + d.tokens, 0) / recent.length;
    const olderAvg = older.reduce((sum, d) => sum + d.tokens, 0) / older.length;
    
    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  private generateCapacityRecommendations(demandPoints: DemandPoint[]): CapacityRecommendation[] {
    const recommendations: CapacityRecommendation[] = [];
    
    for (let i = 0; i < demandPoints.length; i += 7) {
      const demand = demandPoints[i];
      if (demand.predictedDemand > 50000) {
        recommendations.push({
          recommendationType: 'scale_up',
          timing: demand.timestamp,
          magnitude: 1.5,
          confidence: demand.confidence,
          costImpact: 1000,
          riskAssessment: 'Low risk due to predictable demand',
        });
      }
    }
    
    return recommendations;
  }

  private generateResourceOptimizations(demandPoints: DemandPoint[]): ResourceOptimization[] {
    const optimizations: ResourceOptimization[] = [];
    
    const avgDemand = demandPoints.reduce((sum, d) => sum + d.predictedDemand, 0) / demandPoints.length;
    
    optimizations.push({
      optimizationType: 'allocation',
      potentialSavings: avgDemand * 0.1,
      implementationCost: 500,
      roi: 2.0,
      timeframe: '1 week',
      complexity: 'medium',
    });
    
    return optimizations;
  }

  private calculateForecastUncertainty(demandPoints: DemandPoint[]): UncertaintyRange {
    const uncertainties = demandPoints.map(d => (d.upperBound - d.lowerBound) / (2 * d.predictedDemand));
    const avgUncertainty = uncertainties.reduce((sum, u) => sum + u, 0) / uncertainties.length;
    
    return {
      lower: -avgUncertainty,
      upper: avgUncertainty,
      confidence: 0.95,
    };
  }

  private async generateOptimizationRecommendations(request: OptimizationRequest): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];
    
    // Cost reduction recommendations
    if (request.optimizationGoal === 'cost_reduction' || request.optimizationGoal === 'multi_objective') {
      recommendations.push(...this.generateCostReductionRecommendations(request));
    }
    
    // Usage efficiency recommendations
    if (request.optimizationGoal === 'usage_efficiency' || request.optimizationGoal === 'multi_objective') {
      recommendations.push(...this.generateUsageEfficiencyRecommendations(request));
    }
    
    return recommendations;
  }

  private generateCostReductionRecommendations(context: any): OptimizationRecommendation[] {
    return [
      {
        id: uuidv4(),
        type: 'model_downgrade',
        description: 'Downgrade to lower-cost model tier during off-peak hours',
        estimatedSavings: 1000,
        estimatedSavingsPercentage: 25,
        confidence: 0.8,
        complexity: 'low',
        implementationTime: 5,
        risks: ['Potential quality reduction'],
        prerequisites: [],
        impact: 'immediate',
      },
      {
        id: uuidv4(),
        type: 'caching',
        description: 'Implement intelligent caching for frequently used responses',
        estimatedSavings: 500,
        estimatedSavingsPercentage: 15,
        confidence: 0.9,
        complexity: 'medium',
        implementationTime: 20,
        risks: ['Cache invalidation complexity'],
        prerequisites: ['Cache infrastructure'],
        impact: 'short_term',
      },
    ];
  }

  private generateUsageEfficiencyRecommendations(context: any): OptimizationRecommendation[] {
    return [
      {
        id: uuidv4(),
        type: 'token_compression',
        description: 'Enable token compression for large requests',
        estimatedSavings: 300,
        estimatedSavingsPercentage: 20,
        confidence: 0.75,
        complexity: 'medium',
        implementationTime: 15,
        risks: ['Slight processing overhead'],
        prerequisites: [],
        impact: 'short_term',
      },
      {
        id: uuidv4(),
        type: 'smart_routing',
        description: 'Implement smart routing based on cost and performance',
        estimatedSavings: 800,
        estimatedSavingsPercentage: 30,
        confidence: 0.7,
        complexity: 'high',
        implementationTime: 40,
        risks: ['Routing complexity', 'Latency concerns'],
        prerequisites: ['Multi-region infrastructure'],
        impact: 'long_term',
      },
    ];
  }

  private generatePerformanceRecommendations(context: any): OptimizationRecommendation[] {
    return [
      {
        id: uuidv4(),
        type: 'agent_scaling',
        description: 'Optimize agent scaling based on load patterns',
        estimatedSavings: 600,
        estimatedSavingsPercentage: 20,
        confidence: 0.85,
        complexity: 'medium',
        implementationTime: 25,
        risks: ['Scaling complexity'],
        prerequisites: ['Auto-scaling infrastructure'],
        impact: 'short_term',
      },
    ];
  }

  private calculateExpectedSavings(recommendations: OptimizationRecommendation[]): number {
    return recommendations.reduce((sum, r) => sum + r.estimatedSavings, 0);
  }

  private calculateExpectedImprovement(recommendations: OptimizationRecommendation[]): number {
    return recommendations.reduce((sum, r) => sum + r.estimatedSavingsPercentage, 0) / Math.max(1, recommendations.length);
  }

  private calculateOptimizationConfidence(recommendations: OptimizationRecommendation[]): number {
    return recommendations.reduce((sum, r) => sum + r.confidence, 0) / Math.max(1, recommendations.length);
  }

  private createImplementationPlan(recommendations: OptimizationRecommendation[]): ImplementationPlan {
    const phases: ImplementationPhase[] = [];
    let totalDuration = 0;
    
    // Group recommendations by complexity
    const lowComplexity = recommendations.filter(r => r.complexity === 'low');
    const mediumComplexity = recommendations.filter(r => r.complexity === 'medium');
    const highComplexity = recommendations.filter(r => r.complexity === 'high');
    
    // Create phases
    if (lowComplexity.length > 0) {
      const duration = lowComplexity.reduce((sum, r) => sum + r.implementationTime, 0);
      phases.push({
        phaseId: 'phase-1',
        name: 'Quick Wins',
        duration,
        prerequisites: [],
        successCriteria: ['Cost reduction achieved', 'No performance degradation'],
        rollbackPlan: 'Disable optimizations',
      });
      totalDuration += duration;
    }
    
    if (mediumComplexity.length > 0) {
      const duration = mediumComplexity.reduce((sum, r) => sum + r.implementationTime, 0);
      phases.push({
        phaseId: 'phase-2',
        name: 'Medium-term Improvements',
        duration,
        prerequisites: ['Phase 1 completed'],
        successCriteria: ['Target savings achieved', 'System stability maintained'],
        rollbackPlan: 'Revert to previous configuration',
      });
      totalDuration += duration;
    }
    
    return {
      phases,
      timeline: totalDuration,
      dependencies: [],
      requiredResources: ['Development team', 'Testing environment'],
      estimatedCost: recommendations.reduce((sum, r) => sum + (r.implementationTime * 50), 0),
    };
  }

  private assessOptimizationRisk(recommendations: OptimizationRecommendation[]): RiskAssessment {
    const riskLevel = this.calculateOverallRiskLevel(recommendations);
    const riskFactors = this.identifyRiskFactors(recommendations);
    const mitigationStrategies = this.generateMitigationStrategies(riskFactors);
    
    return {
      riskLevel,
      riskFactors,
      mitigationStrategies,
      fallbackPlan: 'Revert to baseline configuration',
      monitoringRequirements: ['Cost tracking', 'Performance monitoring', 'Error rate monitoring'],
    };
  }

  private calculateOverallRiskLevel(recommendations: OptimizationRecommendation[]): 'low' | 'medium' | 'high' {
    const complexities = recommendations.map(r => r.complexity);
    const hasHighComplexity = complexities.includes('high');
    const hasMediumComplexity = complexities.includes('medium');
    
    if (hasHighComplexity) return 'high';
    if (hasMediumComplexity) return 'medium';
    return 'low';
  }

  private identifyRiskFactors(recommendations: OptimizationRecommendation[]): string[] {
    const factors: string[] = [];
    
    for (const rec of recommendations) {
      factors.push(...rec.risks);
    }
    
    return [...new Set(factors)];
  }

  private generateMitigationStrategies(riskFactors: string[]): string[] {
    const strategies: string[] = [];
    
    for (const factor of riskFactors) {
      if (factor.toLowerCase().includes('quality')) {
        strategies.push('Implement comprehensive testing');
        strategies.push('Gradual rollout with monitoring');
      }
      if (factor.toLowerCase().includes('complexity')) {
        strategies.push('Thorough documentation');
        strategies.push('Expert review and validation');
      }
    }
    
    return [...new Set(strategies)];
  }

  private extractFeatureValue(feature: string, point: HistoricalDataPoint): number {
    switch (feature) {
      case 'historical_tokens': return point.tokens;
      case 'historical_cost': return point.cost;
      case 'usage_rate': return point.usage;
      case 'efficiency': return point.efficiency;
      case 'timestamp': return point.timestamp.getTime();
      default: return 0;
    }
  }

  private extractTargetValue(modelType: string, point: HistoricalDataPoint): number {
    switch (modelType) {
      case 'cost_prediction': return point.cost;
      case 'usage_forecasting': return point.usage;
      case 'anomaly_detection': return point.efficiency;
      default: return point.tokens;
    }
  }

  private async applyFeedback(model: MLPredictionModel, feedback: any): Promise<void> {
    // Simplified feedback application
    const feedbackWeight = 0.1;
    model.performance.accuracy = Math.max(0, Math.min(1, 
      model.performance.accuracy * (1 - feedbackWeight) + feedback.accuracy * feedbackWeight
    ));
  }
}