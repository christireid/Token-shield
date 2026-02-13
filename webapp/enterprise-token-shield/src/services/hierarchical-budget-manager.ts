/**
 * Token Shield Enterprise - Hierarchical Budget Manager
 * 
 * Manages hierarchical budget allocation across organization levels:
 * Organization → Departments → Teams → Users → Projects → Agents
 */

import { TokenAccountingService, TokenAccount, BudgetAllocation } from './token-accounting-service';
import { v4 as uuidv4 } from 'uuid';

export interface HierarchyNode {
  id: string;
  name: string;
  type: 'organization' | 'department' | 'team' | 'user' | 'project' | 'agent';
  level: number;
  parentId?: string;
  children: string[];
  budget: {
    allocated: bigint;
    consumed: bigint;
    reserved: bigint;
    available: bigint;
    percentageUsed: number;
  };
  limits: {
    daily?: bigint;
    weekly?: bigint;
    monthly?: bigint;
    quarterly?: bigint;
    annually?: bigint;
  };
  allocationStrategy: AllocationStrategy;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AllocationStrategy {
  type: 'fixed' | 'percentage' | 'usage-based' | 'priority-based' | 'rolling';
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  distribution: 'equal' | 'weighted' | 'performance-based' | 'demand-based';
  carryOver: boolean;
  borrowFromParent: boolean;
  emergencyAllocation: boolean;
}

export interface BudgetPolicy {
  id: string;
  name: string;
  description: string;
  scope: 'global' | 'organization' | 'department' | 'team' | 'project';
  rules: BudgetRule[];
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetRule {
  id: string;
  type: 'limit' | 'allocation' | 'usage' | 'anomaly';
  condition: string; // JavaScript expression or SQL condition
  threshold: number;
  unit: 'tokens' | 'dollars' | 'percentage' | 'count';
  timeframe: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  action: 'warn' | 'block' | 'throttle' | 'reallocate' | 'notify';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface PolicyCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in';
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

export interface PolicyAction {
  type: 'notification' | 'throttle' | 'block' | 'reallocate' | 'escalate';
  target: string;
  parameters: Record<string, any>;
}

export interface BudgetAllocationRequest {
  sourceNodeId: string;
  targetNodeId: string;
  amount: bigint;
  currency: string;
  allocationType: AllocationStrategy['type'];
  effectiveFrom: Date;
  effectiveTo?: Date;
  metadata?: Record<string, any>;
}

export interface BudgetAllocationResult {
  success: boolean;
  allocationId: string;
  amountAllocated: bigint;
  remainingSourceBudget: bigint;
  warnings?: string[];
  errors?: string[];
}

export interface BudgetStatus {
  nodeId: string;
  hierarchyPath: string[];
  budget: {
    total: bigint;
    allocated: bigint;
    consumed: bigint;
    reserved: bigint;
    available: bigint;
    percentageUsed: number;
  };
  children: BudgetStatus[];
  policies: BudgetPolicy[];
  alerts: BudgetAlert[];
  lastUpdated: Date;
}

export interface BudgetAlert {
  id: string;
  type: 'warning' | 'error' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  nodeId: string;
  policyId?: string;
  ruleId?: string;
  threshold?: number;
  currentValue?: number;
  timestamp: Date;
}

export class HierarchicalBudgetManager {
  private tokenService: TokenAccountingService;
  private nodes: Map<string, HierarchyNode> = new Map();
  private policies: Map<string, BudgetPolicy> = new Map();
  private allocationHistory: Map<string, BudgetAllocation[]> = new Map();

  constructor(tokenService: TokenAccountingService) {
    this.tokenService = tokenService;
  }

  /**
   * Create a new hierarchy node
   */
  async createNode(node: Partial<HierarchyNode>): Promise<HierarchyNode> {
    const newNode: HierarchyNode = {
      id: node.id || uuidv4(),
      name: node.name!,
      type: node.type!,
      level: node.level!,
      parentId: node.parentId,
      children: [],
      budget: {
        allocated: node.budget?.allocated || BigInt(0),
        consumed: BigInt(0),
        reserved: BigInt(0),
        available: node.budget?.allocated || BigInt(0),
        percentageUsed: 0,
      },
      limits: node.limits || {},
      allocationStrategy: node.allocationStrategy || {
        type: 'fixed',
        frequency: 'monthly',
        distribution: 'equal',
        carryOver: false,
        borrowFromParent: true,
        emergencyAllocation: true,
      },
      metadata: node.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Create corresponding token account
    const tokenAccount = await this.tokenService.createAccount({
      id: newNode.id,
      userId: this.getNodeOwnerId(newNode),
      organizationId: this.getNodeOrganizationId(newNode),
      balance: newNode.budget.allocated,
      currency: 'TOKENS',
      accountType: this.mapNodeTypeToAccountType(newNode.type),
      hierarchyLevel: newNode.level,
      parentAccountId: newNode.parentId,
      metadata: newNode.metadata,
    });

    this.nodes.set(newNode.id, newNode);

    // Update parent's children list
    if (newNode.parentId) {
      const parent = this.nodes.get(newNode.parentId);
      if (parent) {
        parent.children.push(newNode.id);
        parent.updatedAt = new Date();
      }
    }

    return newNode;
  }

  /**
   * Allocate budget from parent to child nodes
   */
  async allocateBudget(request: BudgetAllocationRequest): Promise<BudgetAllocationResult> {
    const sourceNode = this.nodes.get(request.sourceNodeId);
    const targetNode = this.nodes.get(request.targetNodeId);

    if (!sourceNode || !targetNode) {
      return {
        success: false,
        allocationId: '',
        amountAllocated: BigInt(0),
        remainingSourceBudget: BigInt(0),
        errors: ['Source or target node not found'],
      };
    }

    // Validate hierarchy relationship
    if (targetNode.parentId !== sourceNode.id) {
      return {
        success: false,
        allocationId: '',
        amountAllocated: BigInt(0),
        remainingSourceBudget: BigInt(0),
        errors: ['Target node is not a child of source node'],
      };
    }

    // Check budget availability
    const sourceAvailable = sourceNode.budget.allocated - sourceNode.budget.consumed - sourceNode.budget.reserved;
    if (sourceAvailable < request.amount) {
      return {
        success: false,
        allocationId: '',
        amountAllocated: BigInt(0),
        remainingSourceBudget: sourceAvailable,
        errors: ['Insufficient budget available in source node'],
      };
    }

    // Apply allocation strategy
    const allocationResult = await this.applyAllocationStrategy(request, sourceNode, targetNode);
    
    if (allocationResult.success) {
      // Update node budgets
      sourceNode.budget.allocated -= request.amount;
      sourceNode.budget.available = sourceNode.budget.allocated - sourceNode.budget.consumed - sourceNode.budget.reserved;
      
      targetNode.budget.allocated += request.amount;
      targetNode.budget.available = targetNode.budget.allocated - targetNode.budget.consumed - targetNode.budget.reserved;
      
      // Update token accounts
      await this.tokenService.transfer(
        request.sourceNodeId,
        request.targetNodeId,
        request.amount,
        `Budget allocation from ${sourceNode.name} to ${targetNode.name}`,
        {
          allocationType: request.allocationType,
          effectiveFrom: request.effectiveFrom,
          effectiveTo: request.effectiveTo,
        }
      );

      // Record allocation
      const allocation: BudgetAllocation = {
        id: allocationResult.allocationId,
        sourceAccountId: request.sourceNodeId,
        targetAccountId: request.targetNodeId,
        amount: request.amount,
        currency: request.currency,
        allocationType: request.allocationType,
        allocationStrategy: sourceNode.allocationStrategy.frequency,
        startDate: request.effectiveFrom,
        endDate: request.effectiveTo,
        isActive: true,
        metadata: request.metadata || {},
      };

      this.recordAllocation(allocation);
      
      sourceNode.updatedAt = new Date();
      targetNode.updatedAt = new Date();
    }

    return allocationResult;
  }

  /**
   * Apply budget allocation strategy
   */
  private async applyAllocationStrategy(
    request: BudgetAllocationRequest,
    sourceNode: HierarchyNode,
    targetNode: HierarchyNode
  ): Promise<BudgetAllocationResult> {
    const allocationId = uuidv4();
    const warnings: string[] = [];

    switch (request.allocationType) {
      case 'fixed':
        // Direct allocation of fixed amount
        break;
        
      case 'percentage':
        // Allocate percentage of source budget
        const percentage = parseFloat(request.metadata?.percentage || '0');
        const calculatedAmount = (sourceNode.budget.allocated * BigInt(Math.round(percentage * 100))) / BigInt(10000);
        request.amount = calculatedAmount;
        break;
        
      case 'usage-based':
        // Allocate based on historical usage
        const targetUsage = await this.calculateUsagePercentage(targetNode);
        const optimalAllocation = await this.calculateOptimalAllocation(sourceNode, targetUsage);
        request.amount = optimalAllocation;
        warnings.push(`Usage-based allocation: ${targetUsage}% usage rate`);
        break;
        
      case 'priority-based':
        // Allocate based on priority and available budget
        const priority = request.metadata?.priority || 1;
        const totalPriority = await this.calculateTotalPriority(sourceNode);
        const priorityShare = priority / totalPriority;
        const maxAllocation = sourceNode.budget.allocated * BigInt(Math.round(priorityShare * 100)) / BigInt(100);
        request.amount = maxAllocation < request.amount ? maxAllocation : request.amount;
        break;
        
      default:
        return {
          success: false,
          allocationId: '',
          amountAllocated: BigInt(0),
          remainingSourceBudget: sourceNode.budget.allocated - sourceNode.budget.consumed,
          errors: [`Unsupported allocation type: ${request.allocationType}`],
        };
    }

    // Validate time-based constraints
    if (request.effectiveFrom > new Date()) {
      warnings.push('Allocation is scheduled for future date');
    }

    if (request.effectiveTo && request.effectiveTo < request.effectiveFrom) {
      return {
        success: false,
        allocationId: '',
        amountAllocated: BigInt(0),
        remainingSourceBudget: sourceNode.budget.allocated - sourceNode.budget.consumed,
        errors: ['Invalid effective date range'],
      };
    }

    return {
      success: true,
      allocationId,
      amountAllocated: request.amount,
      remainingSourceBudget: sourceNode.budget.allocated - sourceNode.budget.consumed - request.amount,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Create budget policy
   */
  async createPolicy(policy: Partial<BudgetPolicy>): Promise<BudgetPolicy> {
    const newPolicy: BudgetPolicy = {
      id: policy.id || uuidv4(),
      name: policy.name!,
      description: policy.description || '',
      scope: policy.scope || 'organization',
      rules: policy.rules || [],
      conditions: policy.conditions || [],
      actions: policy.actions || [],
      priority: policy.priority || 1,
      isActive: policy.isActive !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.policies.set(newPolicy.id, newPolicy);
    return newPolicy;
  }

  /**
   * Apply budget policies to a node
   */
  async applyPolicies(nodeId: string, context?: Record<string, any>): Promise<BudgetAlert[]> {
    const node = this.nodes.get(nodeId);
    if (!node) return [];

    const applicablePolicies = Array.from(this.policies.values())
      .filter(policy => policy.isActive && this.isPolicyApplicable(policy, node, context));

    const alerts: BudgetAlert[] = [];

    for (const policy of applicablePolicies) {
      for (const rule of policy.rules) {
        const shouldTrigger = await this.evaluateRule(rule, node, context);
        if (shouldTrigger) {
          const alert: BudgetAlert = {
            id: uuidv4(),
            type: rule.action === 'warn' ? 'warning' : 'error',
            severity: rule.severity,
            message: `Policy "${policy.name}" triggered: ${rule.condition}`,
            nodeId,
            policyId: policy.id,
            ruleId: rule.id,
            threshold: rule.threshold,
            currentValue: this.getCurrentValueForRule(rule, node),
            timestamp: new Date(),
          };
          alerts.push(alert);
        }
      }
    }

    return alerts;
  }

  /**
   * Get comprehensive budget status
   */
  async getBudgetStatus(nodeId: string, includeChildren = true): Promise<BudgetStatus> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const tokenAccount = await this.tokenService.getAccount(nodeId);
    const hierarchyPath = await this.buildHierarchyPath(node);
    
    const applicablePolicies = Array.from(this.policies.values())
      .filter(policy => policy.isActive && this.isPolicyApplicable(policy, node));

    const alerts = await this.applyPolicies(nodeId);

    const status: BudgetStatus = {
      nodeId,
      hierarchyPath,
      budget: {
        total: node.budget.allocated,
        allocated: node.budget.allocated,
        consumed: node.budget.consumed,
        reserved: node.budget.reserved,
        available: node.budget.available,
        percentageUsed: node.budget.percentageUsed,
      },
      children: [],
      policies: applicablePolicies,
      alerts,
      lastUpdated: node.updatedAt,
    };

    if (includeChildren && node.children.length > 0) {
      for (const childId of node.children) {
        const childStatus = await this.getBudgetStatus(childId, false);
        status.children.push(childStatus);
      }
    }

    return status;
  }

  /**
   * Reallocate budget across hierarchy
   */
  async reallocateBudget(
    sourceNodeId: string,
    reallocationStrategy: 'equal' | 'proportional' | 'usage-based' | 'priority-based'
  ): Promise<BudgetAllocationResult[]> {
    const sourceNode = this.nodes.get(sourceNodeId);
    if (!sourceNode || sourceNode.children.length === 0) {
      return [];
    }

    const results: BudgetAllocationResult[] = [];
    const availableBudget = sourceNode.budget.allocated - sourceNode.budget.consumed - sourceNode.budget.reserved;

    if (availableBudget <= BigInt(0)) {
      return [{
        success: false,
        allocationId: '',
        amountAllocated: BigInt(0),
        remainingSourceBudget: availableBudget,
        errors: ['No available budget for reallocation'],
      }];
    }

    const childNodes = sourceNode.children.map(childId => this.nodes.get(childId)).filter(Boolean) as HierarchyNode[];
    
    switch (reallocationStrategy) {
      case 'equal':
        const equalShare = availableBudget / BigInt(childNodes.length);
        for (const childNode of childNodes) {
          const request: BudgetAllocationRequest = {
            sourceNodeId: sourceNodeId,
            targetNodeId: childNode.id,
            amount: equalShare,
            currency: 'TOKENS',
            allocationType: 'fixed',
            effectiveFrom: new Date(),
            metadata: { reallocation: true, strategy: 'equal' },
          };
          const result = await this.allocateBudget(request);
          results.push(result);
        }
        break;
        
      case 'proportional':
        const totalUsage = childNodes.reduce((sum, child) => sum + child.budget.consumed, BigInt(0));
        for (const childNode of childNodes) {
          const usageRatio = totalUsage > 0 ? Number(childNode.budget.consumed) / Number(totalUsage) : 1 / childNodes.length;
          const proportionalAmount = (availableBudget * BigInt(Math.round(usageRatio * 100))) / BigInt(100);
          
          const request: BudgetAllocationRequest = {
            sourceNodeId: sourceNodeId,
            targetNodeId: childNode.id,
            amount: proportionalAmount,
            currency: 'TOKENS',
            allocationType: 'usage-based',
            effectiveFrom: new Date(),
            metadata: { reallocation: true, strategy: 'proportional', usageRatio },
          };
          const result = await this.allocateBudget(request);
          results.push(result);
        }
        break;
        
      default:
        throw new Error(`Unsupported reallocation strategy: ${reallocationStrategy}`);
    }

    return results;
  }

  /**
   * Calculate usage percentage for a node
   */
  private async calculateUsagePercentage(node: HierarchyNode): Promise<number> {
    if (node.budget.allocated === BigInt(0)) return 0;
    return Number((node.budget.consumed * BigInt(100)) / node.budget.allocated);
  }

  /**
   * Calculate optimal allocation based on usage
   */
  private async calculateOptimalAllocation(sourceNode: HierarchyNode, targetUsage: number): Promise<bigint> {
    const sourceAvailable = sourceNode.budget.allocated - sourceNode.budget.consumed - sourceNode.budget.reserved;
    const usageMultiplier = Math.max(0.5, Math.min(2.0, targetUsage / 100));
    return (sourceAvailable * BigInt(Math.round(usageMultiplier * 100))) / BigInt(100);
  }

  /**
   * Calculate total priority for priority-based allocation
   */
  private async calculateTotalPriority(sourceNode: HierarchyNode): Promise<number> {
    const childNodes = sourceNode.children.map(childId => this.nodes.get(childId)).filter(Boolean) as HierarchyNode[];
    return childNodes.reduce((sum, child) => sum + (child.metadata?.priority || 1), 0);
  }

  /**
   * Evaluate if a policy is applicable to a node
   */
  private isPolicyApplicable(policy: BudgetPolicy, node: HierarchyNode, context?: Record<string, any>): boolean {
    // Check scope
    if (policy.scope === 'global') return true;
    if (policy.scope !== node.type) return false;

    // Check conditions
    for (const condition of policy.conditions) {
      const nodeValue = this.getNodeValue(node, condition.field);
      if (!this.evaluateCondition(nodeValue, condition.operator, condition.value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a budget rule
   */
  private async evaluateRule(rule: BudgetRule, node: HierarchyNode, context?: Record<string, any>): Promise<boolean> {
    const currentValue = this.getCurrentValueForRule(rule, node);
    
    switch (rule.operator) {
      case 'gt':
        return currentValue > rule.threshold;
      case 'lt':
        return currentValue < rule.threshold;
      case 'gte':
        return currentValue >= rule.threshold;
      case 'lte':
        return currentValue <= rule.threshold;
      case 'eq':
        return currentValue === rule.threshold;
      default:
        return false;
    }
  }

  /**
   * Get current value for a rule
   */
  private getCurrentValueForRule(rule: BudgetRule, node: HierarchyNode): number {
    switch (rule.type) {
      case 'usage':
        return Number(node.budget.consumed);
      case 'limit':
        return Number(node.budget.allocated);
      default:
        return 0;
    }
  }

  /**
   * Get node value for condition evaluation
   */
  private getNodeValue(node: HierarchyNode, field: string): any {
    const path = field.split('.');
    let current: any = node;
    
    for (const segment of path) {
      current = current[segment];
      if (current === undefined) return undefined;
    }
    
    return current;
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(value: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'eq': return value === expected;
      case 'ne': return value !== expected;
      case 'gt': return value > expected;
      case 'lt': return value < expected;
      case 'gte': return value >= expected;
      case 'lte': return value <= expected;
      case 'in': return Array.isArray(expected) && expected.includes(value);
      case 'not_in': return Array.isArray(expected) && !expected.includes(value);
      default: return false;
    }
  }

  /**
   * Record allocation in history
   */
  private recordAllocation(allocation: BudgetAllocation): void {
    const allocations = this.allocationHistory.get(allocation.sourceAccountId) || [];
    allocations.push(allocation);
    this.allocationHistory.set(allocation.sourceAccountId, allocations);
  }

  /**
   * Build hierarchy path
   */
  private async buildHierarchyPath(node: HierarchyNode): Promise<string[]> {
    const path: string[] = [node.id];
    let current = node;
    
    while (current.parentId) {
      const parent = this.nodes.get(current.parentId);
      if (parent) {
        path.unshift(parent.id);
        current = parent;
      } else {
        break;
      }
    }
    
    return path;
  }

  /**
   * Get node owner ID
   */
  private getNodeOwnerId(node: HierarchyNode): string {
    // Traverse up hierarchy to find user node
    if (node.type === 'user') {
      return node.id;
    }
    
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      return parent ? this.getNodeOwnerId(parent) : 'unknown';
    }
    
    return 'unknown';
  }

  /**
   * Get node organization ID
   */
  private getNodeOrganizationId(node: HierarchyNode): string {
    // Traverse up hierarchy to find organization node
    if (node.type === 'organization') {
      return node.id;
    }
    
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      return parent ? this.getNodeOrganizationId(parent) : 'unknown';
    }
    
    return 'unknown';
  }

  /**
   * Map node type to account type
   */
  private mapNodeTypeToAccountType(nodeType: HierarchyNode['type']): TokenAccount['accountType'] {
    switch (nodeType) {
      case 'organization': return 'organization';
      case 'department': return 'organization';
      case 'team': return 'team';
      case 'user': return 'user';
      case 'project': return 'project';
      case 'agent': return 'agent';
      default: return 'user';
    }
  }
}