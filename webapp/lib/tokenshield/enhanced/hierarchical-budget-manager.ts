/**
 * TokenShield - Enhanced Hierarchical Budget Manager
 * 
 * Comprehensive budget management system that supports:
 * - Multi-level budget allocation (Org → Dept → Team → User → Project → Agent)
 * - Real-time budget tracking and enforcement
 * - Automated budget distribution and optimization
 * - Policy-driven budget allocation
 * - Emergency budget management
 * - Cross-department budget transfers
 */

import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'

// Types
export interface BudgetNode {
  id: string
  name: string
  type: 'organization' | 'department' | 'team' | 'user' | 'project' | 'agent'
  parentId?: string
  allocatedBudget: number
  consumedBudget: number
  reservedBudget: number
  currency: string
  timePeriod: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  policy?: BudgetPolicy
  children: Map<string, BudgetNode>
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface BudgetPolicy {
  id: string
  name: string
  type: 'hard_limit' | 'soft_limit' | 'throttling' | 'borrowing' | 'emergency'
  threshold?: number // Percentage (0-1)
  action: 'block' | 'warn' | 'throttle' | 'redirect'
  parameters: Record<string, any>
  enabled: boolean
  priority: number
}

export interface BudgetTransaction {
  id: string
  nodeId: string
  amount: number
  type: 'credit' | 'debit' | 'reserve' | 'release' | 'transfer'
  currency: string
  description?: string
  metadata: Record<string, any>
  timestamp: Date
  userId?: string
  projectId?: string
  agentId?: string
}

export interface BudgetAllocation {
  id: string
  sourceNodeId: string
  targetNodeId: string
  amount: number
  currency: string
  allocationType: 'fixed' | 'percentage' | 'usage_based' | 'priority_based'
  percentage?: number
  priority?: number
  autoDistribute: boolean
  effectiveDate: Date
  endDate?: Date
}

export interface BudgetAlert {
  id: string
  nodeId: string
  type: 'warning' | 'critical' | 'emergency'
  threshold: number
  currentUsage: number
  message: string
  recipients: string[]
  acknowledged: boolean
  timestamp: Date
}

export interface HierarchicalBudgetConfig {
  organizationId: string
  defaultCurrency: string
  defaultTimePeriod: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  enableAutoAllocation: boolean
  enableEmergencyOverride: boolean
  enableBudgetBorrowing: boolean
  alertThresholds: {
    warning: number // 0.8 (80%)
    critical: number // 0.95 (95%)
  }
  maxHierarchyDepth: number
  auditRetentionDays: number
}

export class HierarchicalBudgetManager extends EventEmitter {
  private config: HierarchicalBudgetConfig
  private nodes: Map<string, BudgetNode> = new Map()
  private transactions: BudgetTransaction[] = []
  private policies: Map<string, BudgetPolicy> = new Map()
  private isProcessing = false
  private processingQueue: BudgetTransaction[] = []

  constructor(config: HierarchicalBudgetConfig) {
    super()
    this.config = config
    this.initializeRootNode()
  }

  private initializeRootNode(): void {
    const rootNode: BudgetNode = {
      id: this.config.organizationId,
      name: 'Organization',
      type: 'organization',
      allocatedBudget: Infinity,
      consumedBudget: 0,
      reservedBudget: 0,
      currency: this.config.defaultCurrency,
      timePeriod: this.config.defaultTimePeriod,
      children: new Map(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    }
    this.nodes.set(rootNode.id, rootNode)
  }

  /**
   * Create a new budget node in the hierarchy
   */
  async createNode(nodeData: Partial<BudgetNode> & { name: string; type: BudgetNode['type'] }): Promise<BudgetNode> {
    const parentNode = nodeData.parentId ? this.nodes.get(nodeData.parentId) : this.getRootNode()
    if (!parentNode) {
      throw new Error(`Parent node ${nodeData.parentId} not found`)
    }

    // Validate hierarchy depth
    const currentDepth = this.getNodeDepth(parentNode.id)
    if (currentDepth >= this.config.maxHierarchyDepth) {
      throw new Error(`Maximum hierarchy depth (${this.config.maxHierarchyDepth}) exceeded`)
    }

    const newNode: BudgetNode = {
      id: uuidv4(),
      name: nodeData.name,
      type: nodeData.type,
      parentId: parentNode.id,
      allocatedBudget: nodeData.allocatedBudget || 0,
      consumedBudget: 0,
      reservedBudget: 0,
      currency: nodeData.currency || this.config.defaultCurrency,
      timePeriod: nodeData.timePeriod || this.config.defaultTimePeriod,
      policy: nodeData.policy,
      children: new Map(),
      metadata: nodeData.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date()
    }

    // Add to parent
    parentNode.children.set(newNode.id, newNode)
    this.nodes.set(newNode.id, newNode)

    // Apply automatic allocation if enabled
    if (this.config.enableAutoAllocation && newNode.allocatedBudget === 0) {
      await this.autoAllocateBudget(newNode.id)
    }

    this.emit('nodeCreated', { node: newNode, parent: parentNode })
    return newNode
  }

  /**
   * Allocate budget to a node (with policy enforcement)
   */
  async allocateBudget(nodeId: string, amount: number, options: {
    sourceNodeId?: string
    currency?: string
    description?: string
    bypassPolicy?: boolean
  } = {}): Promise<BudgetTransaction> {
    const node = this.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }

    // Validate currency
    const currency = options.currency || node.currency
    if (currency !== node.currency && !this.config.enableEmergencyOverride) {
      throw new Error(`Currency mismatch: expected ${node.currency}, got ${currency}`)
    }

    // Check source node if specified
    if (options.sourceNodeId) {
      const sourceNode = this.nodes.get(options.sourceNodeId)
      if (!sourceNode) {
        throw new Error(`Source node ${options.sourceNodeId} not found`)
      }
      if (sourceNode.consumedBudget + amount > sourceNode.allocatedBudget) {
        throw new Error(`Insufficient budget in source node ${options.sourceNodeId}`)
      }
    }

    // Apply budget policies
    if (!options.bypassPolicy) {
      await this.enforceBudgetPolicies(node, amount, 'allocate')
    }

    const transaction: BudgetTransaction = {
      id: uuidv4(),
      nodeId: nodeId,
      amount: amount,
      type: 'credit',
      currency: currency,
      description: options.description || `Budget allocation to ${node.name}`,
      metadata: {
        sourceNodeId: options.sourceNodeId,
        allocationType: 'manual'
      },
      timestamp: new Date(),
      userId: node.type === 'user' ? node.id : undefined,
      projectId: node.type === 'project' ? node.id : undefined,
      agentId: node.type === 'agent' ? node.id : undefined
    }

    // Update node budget
    node.allocatedBudget += amount
    node.updatedAt = new Date()

    this.transactions.push(transaction)
    this.emit('budgetAllocated', { transaction, node })

    // Check for policy violations after allocation
    await this.checkBudgetAlerts(node)

    return transaction
  }

  /**
   * Consume budget (with real-time tracking and policy enforcement)
   */
  async consumeBudget(nodeId: string, amount: number, options: {
    description?: string
    userId?: string
    projectId?: string
    agentId?: string
    bypassPolicy?: boolean
  } = {}): Promise<BudgetTransaction> {
    const node = this.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }

    // Check if sufficient budget available
    const availableBudget = node.allocatedBudget - node.consumedBudget - node.reservedBudget
    if (availableBudget < amount) {
      if (this.config.enableEmergencyOverride) {
        // Try emergency budget borrowing
        const borrowedAmount = await this.attemptEmergencyBorrowing(node, amount)
        if (borrowedAmount < amount) {
          throw new Error(`Insufficient budget: need ${amount}, available ${availableBudget + borrowedAmount}`)
        }
      } else {
        throw new Error(`Insufficient budget: need ${amount}, available ${availableBudget}`)
      }
    }

    // Apply budget policies
    if (!options.bypassPolicy) {
      await this.enforceBudgetPolicies(node, amount, 'consume')
    }

    const transaction: BudgetTransaction = {
      id: uuidv4(),
      nodeId: nodeId,
      amount: amount,
      type: 'debit',
      currency: node.currency,
      description: options.description || `Budget consumption by ${node.name}`,
      metadata: {
        userId: options.userId,
        projectId: options.projectId,
        agentId: options.agentId
      },
      timestamp: new Date(),
      userId: options.userId,
      projectId: options.projectId,
      agentId: options.agentId
    }

    // Update node consumption
    node.consumedBudget += amount
    node.updatedAt = new Date()

    this.transactions.push(transaction)
    this.emit('budgetConsumed', { transaction, node })

    // Check for budget alerts
    await this.checkBudgetAlerts(node)

    return transaction
  }

  /**
   * Reserve budget for pending operations
   */
  async reserveBudget(nodeId: string, amount: number, options: {
    description?: string
    expiresAt?: Date
  } = {}): Promise<BudgetTransaction> {
    const node = this.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }

    const availableBudget = node.allocatedBudget - node.consumedBudget - node.reservedBudget
    if (availableBudget < amount) {
      throw new Error(`Insufficient budget for reservation: need ${amount}, available ${availableBudget}`)
    }

    const transaction: BudgetTransaction = {
      id: uuidv4(),
      nodeId: nodeId,
      amount: amount,
      type: 'reserve',
      currency: node.currency,
      description: options.description || `Budget reservation for ${node.name}`,
      metadata: {
        expiresAt: options.expiresAt?.toISOString()
      },
      timestamp: new Date()
    }

    node.reservedBudget += amount
    node.updatedAt = new Date()

    this.transactions.push(transaction)
    this.emit('budgetReserved', { transaction, node })

    return transaction
  }

  /**
   * Release reserved budget
   */
  async releaseBudget(reservationId: string): Promise<BudgetTransaction> {
    const reservation = this.transactions.find(t => t.id === reservationId && t.type === 'reserve')
    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`)
    }

    const node = this.nodes.get(reservation.nodeId)
    if (!node) {
      throw new Error(`Node ${reservation.nodeId} not found`)
    }

    const transaction: BudgetTransaction = {
      id: uuidv4(),
      nodeId: node.id,
      amount: reservation.amount,
      type: 'release',
      currency: node.currency,
      description: `Release reservation ${reservationId}`,
      metadata: {
        reservationId: reservationId
      },
      timestamp: new Date()
    }

    node.reservedBudget -= reservation.amount
    node.updatedAt = new Date()

    this.transactions.push(transaction)
    this.emit('budgetReleased', { transaction, node })

    return transaction
  }

  /**
   * Transfer budget between nodes
   */
  async transferBudget(sourceNodeId: string, targetNodeId: string, amount: number, options: {
    description?: string
    emergency?: boolean
  } = {}): Promise<BudgetTransaction> {
    const sourceNode = this.nodes.get(sourceNodeId)
    const targetNode = this.nodes.get(targetNodeId)

    if (!sourceNode || !targetNode) {
      throw new Error('Source or target node not found')
    }

    if (sourceNode.currency !== targetNode.currency && !this.config.enableEmergencyOverride) {
      throw new Error(`Currency mismatch: ${sourceNode.currency} vs ${targetNode.currency}`)
    }

    const availableBudget = sourceNode.allocatedBudget - sourceNode.consumedBudget
    if (availableBudget < amount) {
      if (options.emergency && this.config.enableEmergencyOverride) {
        // Emergency transfer - allow negative allocation
      } else {
        throw new Error(`Insufficient budget for transfer: need ${amount}, available ${availableBudget}`)
      }
    }

    const transaction: BudgetTransaction = {
      id: uuidv4(),
      nodeId: sourceNodeId,
      amount: amount,
      type: 'transfer',
      currency: sourceNode.currency,
      description: options.description || `Budget transfer to ${targetNode.name}`,
      metadata: {
        targetNodeId: targetNodeId,
        emergency: options.emergency || false
      },
      timestamp: new Date()
    }

    // Update nodes
    sourceNode.allocatedBudget -= amount
    targetNode.allocatedBudget += amount
    sourceNode.updatedAt = new Date()
    targetNode.updatedAt = new Date()

    this.transactions.push(transaction)
    this.emit('budgetTransferred', { transaction, sourceNode, targetNode })

    return transaction
  }

  /**
   * Auto-allocate budget based on policies and usage patterns
   */
  private async autoAllocateBudget(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node || !node.parentId) return

    const parentNode = this.nodes.get(node.parentId)
    if (!parentNode) return

    // Calculate allocation based on sibling usage and policies
    const siblings = Array.from(parentNode.children.values())
    const totalSiblingUsage = siblings.reduce((sum, sibling) => sum + sibling.consumedBudget, 0)
    const parentAvailableBudget = parentNode.allocatedBudget - parentNode.consumedBudget

    if (parentAvailableBudget <= 0) return

    // Simple proportional allocation (can be enhanced with ML)
    const nodeUsageRatio = node.consumedBudget / (totalSiblingUsage || 1)
    const allocationAmount = Math.min(
      parentAvailableBudget * nodeUsageRatio * 1.2, // 20% buffer
      parentAvailableBudget * 0.3 // Max 30% of parent budget
    )

    if (allocationAmount > 0) {
      await this.allocateBudget(nodeId, allocationAmount, {
        sourceNodeId: parentNode.id,
        description: 'Auto-allocation based on usage patterns'
      })
    }
  }

  /**
   * Enforce budget policies
   */
  private async enforceBudgetPolicies(node: BudgetNode, amount: number, operation: 'allocate' | 'consume'): Promise<void> {
    if (!node.policy) return

    const policy = node.policy
    if (!policy.enabled) return

    const currentUsage = node.consumedBudget / node.allocatedBudget

    switch (policy.type) {
      case 'hard_limit':
        if (currentUsage + (amount / node.allocatedBudget) > (policy.threshold || 1)) {
          throw new Error(`Hard limit exceeded for node ${node.name}`)
        }
        break

      case 'soft_limit':
        if (currentUsage + (amount / node.allocatedBudget) > (policy.threshold || 0.9)) {
          // Emit warning but allow operation
          this.emit('budgetWarning', {
            node,
            currentUsage,
            proposedUsage: currentUsage + (amount / node.allocatedBudget),
            threshold: policy.threshold || 0.9,
            message: `Soft limit warning for ${node.name}`
          })
        }
        break

      case 'throttling':
        if (currentUsage + (amount / node.allocatedBudget) > (policy.threshold || 0.8)) {
          // Implement throttling logic
          const throttleRate = 1 - (currentUsage - (policy.threshold || 0.8)) / (1 - (policy.threshold || 0.8))
          await this.implementThrottling(node, throttleRate)
        }
        break
    }
  }

  /**
   * Check for budget alerts
   */
  private async checkBudgetAlerts(node: BudgetNode): Promise<void> {
    const usagePercentage = node.consumedBudget / node.allocatedBudget

    if (usagePercentage >= this.config.alertThresholds.critical) {
      const alert: BudgetAlert = {
        id: uuidv4(),
        nodeId: node.id,
        type: 'critical',
        threshold: this.config.alertThresholds.critical,
        currentUsage: usagePercentage,
        message: `Critical budget usage for ${node.name}: ${(usagePercentage * 100).toFixed(1)}%`,
        recipients: this.getAlertRecipients(node),
        acknowledged: false,
        timestamp: new Date()
      }
      this.emit('budgetAlert', alert)
    } else if (usagePercentage >= this.config.alertThresholds.warning) {
      const alert: BudgetAlert = {
        id: uuidv4(),
        nodeId: node.id,
        type: 'warning',
        threshold: this.config.alertThresholds.warning,
        currentUsage: usagePercentage,
        message: `Warning: Budget usage for ${node.name} at ${(usagePercentage * 100).toFixed(1)}%`,
        recipients: this.getAlertRecipients(node),
        acknowledged: false,
        timestamp: new Date()
      }
      this.emit('budgetAlert', alert)
    }
  }

  /**
   * Emergency budget borrowing
   */
  private async attemptEmergencyBorrowing(node: BudgetNode, requiredAmount: number): Promise<number> {
    if (!this.config.enableBudgetBorrowing) return 0

    const parentNode = node.parentId ? this.nodes.get(node.parentId) : null
    if (!parentNode) return 0

    const availableFromParent = parentNode.allocatedBudget - parentNode.consumedBudget
    const borrowedAmount = Math.min(requiredAmount, availableFromParent * 0.2) // Max 20% from parent

    if (borrowedAmount > 0) {
      await this.transferBudget(parentNode.id, node.id, borrowedAmount, {
        description: 'Emergency budget borrowing',
        emergency: true
      })
    }

    return borrowedAmount
  }

  /**
   * Implement throttling
   */
  private async implementThrottling(node: BudgetNode, throttleRate: number): Promise<void> {
    this.emit('throttlingActivated', {
      node,
      throttleRate,
      message: `Throttling activated for ${node.name} at ${(throttleRate * 100).toFixed(1)}%`
    })
  }

  /**
   * Utility methods
   */
  private getRootNode(): BudgetNode {
    return this.nodes.get(this.config.organizationId)!
  }

  private getNodeDepth(nodeId: string): number {
    let depth = 0
    let current = this.nodes.get(nodeId)
    while (current?.parentId) {
      depth++
      current = this.nodes.get(current.parentId)
    }
    return depth
  }

  private getAlertRecipients(node: BudgetNode): string[] {
    const recipients: string[] = []
    
    // Add node owner/manager
    if (node.metadata.managerEmail) {
      recipients.push(node.metadata.managerEmail)
    }
    
    // Add parent node managers
    if (node.parentId) {
      const parentNode = this.nodes.get(node.parentId)
      if (parentNode?.metadata.managerEmail) {
        recipients.push(parentNode.metadata.managerEmail)
      }
    }
    
    // Add system administrators
    recipients.push('admin@tokenshield.com')
    
    return recipients
  }

  /**
   * Get budget status for a node
   */
  getBudgetStatus(nodeId: string): {
    allocated: number
    consumed: number
    reserved: number
    available: number
    usagePercentage: number
    status: 'healthy' | 'warning' | 'critical'
  } {
    const node = this.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }

    const available = node.allocatedBudget - node.consumedBudget - node.reservedBudget
    const usagePercentage = node.allocatedBudget > 0 ? node.consumedBudget / node.allocatedBudget : 0

    let status: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (usagePercentage >= this.config.alertThresholds.critical) {
      status = 'critical'
    } else if (usagePercentage >= this.config.alertThresholds.warning) {
      status = 'warning'
    }

    return {
      allocated: node.allocatedBudget,
      consumed: node.consumedBudget,
      reserved: node.reservedBudget,
      available,
      usagePercentage,
      status
    }
  }

  /**
   * Get budget summary for the entire organization
   */
  getBudgetSummary(): {
    totalAllocated: number
    totalConsumed: number
    totalReserved: number
    nodeCount: number
    policyCount: number
    transactionCount: number
  } {
    let totalAllocated = 0
    let totalConsumed = 0
    let totalReserved = 0

    for (const node of this.nodes.values()) {
      if (node.type !== 'organization') {
        totalAllocated += node.allocatedBudget
        totalConsumed += node.consumedBudget
        totalReserved += node.reservedBudget
      }
    }

    return {
      totalAllocated,
      totalConsumed,
      totalReserved,
      nodeCount: this.nodes.size,
      policyCount: this.policies.size,
      transactionCount: this.transactions.length
    }
  }

  /**
   * Get recent transactions
   */
  getRecentTransactions(limit = 100): BudgetTransaction[] {
    return this.transactions
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit)
  }

  /**
   * Get budget forecast
   */
  getBudgetForecast(nodeId: string, days = 30): {
    projectedConsumption: number
    projectedAvailable: number
    riskLevel: 'low' | 'medium' | 'high'
  } {
    const node = this.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }

    // Simple linear projection (can be enhanced with ML)
    const dailyConsumption = node.consumedBudget / Math.max(1, this.getDaysSinceCreation(node))
    const projectedConsumption = dailyConsumption * days
    const projectedAvailable = node.allocatedBudget - projectedConsumption

    let riskLevel: 'low' | 'medium' | 'high' = 'low'
    if (projectedAvailable < 0) {
      riskLevel = 'high'
    } else if (projectedAvailable < node.allocatedBudget * 0.2) {
      riskLevel = 'medium'
    }

    return {
      projectedConsumption,
      projectedAvailable,
      riskLevel
    }
  }

  private getDaysSinceCreation(node: BudgetNode): number {
    return Math.max(1, (Date.now() - node.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  }
}

// Event types
export interface BudgetEvents {
  nodeCreated: { node: BudgetNode; parent: BudgetNode }
  budgetAllocated: { transaction: BudgetTransaction; node: BudgetNode }
  budgetConsumed: { transaction: BudgetTransaction; node: BudgetNode }
  budgetReserved: { transaction: BudgetTransaction; node: BudgetNode }
  budgetReleased: { transaction: BudgetTransaction; node: BudgetNode }
  budgetTransferred: { transaction: BudgetTransaction; sourceNode: BudgetNode; targetNode: BudgetNode }
  budgetWarning: { node: BudgetNode; currentUsage: number; proposedUsage: number; threshold: number; message: string }
  budgetAlert: BudgetAlert
  throttlingActivated: { node: BudgetNode; throttleRate: number; message: string }
}

// Export factory function
export function createHierarchicalBudgetManager(config: HierarchicalBudgetConfig): HierarchicalBudgetManager {
  return new HierarchicalBudgetManager(config)
}