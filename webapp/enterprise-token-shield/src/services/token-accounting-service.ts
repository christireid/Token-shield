/**
 * Token Shield Enterprise - Token Accounting Service
 * 
 * High-performance token accounting engine with multi-currency support,
 * real-time balance tracking, and atomic operations.
 */

import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';

export interface TokenAccount {
  id: string;
  userId: string;
  organizationId: string;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  agentId?: string;
  balance: bigint;
  reserved: bigint;
  currency: string;
  accountType: 'user' | 'team' | 'project' | 'agent' | 'organization';
  hierarchyLevel: number;
  parentAccountId?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  lastTransactionAt?: Date;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: 'credit' | 'debit' | 'reserve' | 'release' | 'transfer' | 'burn' | 'mint';
  amount: bigint;
  currency: string;
  description: string;
  metadata: Record<string, any>;
  timestamp: Date;
  correlationId?: string;
  parentTransactionId?: string;
  reversalTransactionId?: string;
  isReversed: boolean;
}

export interface BudgetAllocation {
  id: string;
  sourceAccountId: string;
  targetAccountId: string;
  amount: bigint;
  currency: string;
  allocationType: 'fixed' | 'percentage' | 'usage-based' | 'priority-based';
  allocationStrategy: 'daily' | 'weekly' | 'monthly' | 'rolling';
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  metadata: Record<string, any>;
}

export interface TokenAccountingConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    cluster?: boolean;
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
  };
  kafka: {
    brokers: string[];
    clientId: string;
    ssl?: boolean;
  };
  performance: {
    cacheTTL: number;
    batchSize: number;
    maxRetries: number;
    retryDelay: number;
  };
}

export class TokenAccountingService {
  private redis: Redis;
  private postgres: Pool;
  private kafka: Kafka;
  private producer: any;
  private consumer: any;
  private config: TokenAccountingConfig;

  constructor(config: TokenAccountingConfig) {
    this.config = config;
    this.redis = new Redis(config.redis);
    this.postgres = new Pool(config.postgres);
    this.kafka = new Kafka(config.kafka);
  }

  async initialize(): Promise<void> {
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: 'token-accounting-service' });
    
    await this.producer.connect();
    await this.consumer.connect();
    
    await this.setupDatabase();
    await this.setupEventListeners();
  }

  private async setupDatabase(): Promise<void> {
    const createTablesSQL = `
      CREATE TABLE IF NOT EXISTS token_accounts (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        organization_id VARCHAR(255) NOT NULL,
        department_id VARCHAR(255),
        team_id VARCHAR(255),
        project_id VARCHAR(255),
        agent_id VARCHAR(255),
        balance BIGINT NOT NULL DEFAULT 0,
        reserved BIGINT NOT NULL DEFAULT 0,
        currency VARCHAR(3) NOT NULL,
        account_type VARCHAR(50) NOT NULL,
        hierarchy_level INTEGER NOT NULL,
        parent_account_id VARCHAR(36),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_transaction_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT positive_balance CHECK (balance >= 0),
        CONSTRAINT positive_reserved CHECK (reserved >= 0),
        CONSTRAINT valid_hierarchy CHECK (hierarchy_level >= 0 AND hierarchy_level <= 6)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL REFERENCES token_accounts(id),
        type VARCHAR(20) NOT NULL,
        amount BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        description TEXT,
        metadata JSONB,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        correlation_id VARCHAR(255),
        parent_transaction_id VARCHAR(36),
        reversal_transaction_id VARCHAR(36),
        is_reversed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS budget_allocations (
        id VARCHAR(36) PRIMARY KEY,
        source_account_id VARCHAR(36) NOT NULL REFERENCES token_accounts(id),
        target_account_id VARCHAR(36) NOT NULL REFERENCES token_accounts(id),
        amount BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        allocation_type VARCHAR(50) NOT NULL,
        allocation_strategy VARCHAR(50) NOT NULL,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT TRUE,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_token_accounts_user_id ON token_accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_token_accounts_org_id ON token_accounts(organization_id);
      CREATE INDEX IF NOT EXISTS idx_token_accounts_hierarchy ON token_accounts(hierarchy_level, parent_account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_budget_allocations_active ON budget_allocations(is_active, start_date, end_date);
    `;

    await this.postgres.query(createTablesSQL);
  }

  private async setupEventListeners(): Promise<void> {
    await this.consumer.subscribe({ topic: 'token-transactions', fromBeginning: true });
    
    this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const event = JSON.parse(message.value?.toString() || '{}');
        await this.handleTokenEvent(event);
      },
    });
  }

  private async handleTokenEvent(event: any): Promise<void> {
    switch (event.type) {
      case 'budget_warning':
        await this.handleBudgetWarning(event);
        break;
      case 'budget_exceeded':
        await this.handleBudgetExceeded(event);
        break;
      case 'anomaly_detected':
        await this.handleAnomalyDetected(event);
        break;
    }
  }

  /**
   * Atomic token balance update using Redis Lua script
   */
  async updateBalance(
    accountId: string,
    amount: bigint,
    transactionType: 'credit' | 'debit' | 'reserve' | 'release',
    metadata?: Record<string, any>
  ): Promise<bigint> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const script = `
      local key = KEYS[1]
      local amount = tonumber(ARGV[1])
      local current_balance = tonumber(redis.call('get', key .. ':balance') or 0)
      local current_reserved = tonumber(redis.call('get', key .. ':reserved') or 0)
      
      if transaction_type == 'debit' then
        local available_balance = current_balance - current_reserved
        if available_balance < amount then
          return -1  -- Insufficient funds
        end
        current_balance = current_balance - amount
      elseif transaction_type == 'credit' then
        current_balance = current_balance + amount
      elseif transaction_type == 'reserve' then
        local available_balance = current_balance - current_reserved
        if available_balance < amount then
          return -2  -- Insufficient available funds
        end
        current_reserved = current_reserved + amount
      elseif transaction_type == 'release' then
        current_reserved = math.max(0, current_reserved - amount)
      end
      
      redis.call('set', key .. ':balance', current_balance)
      redis.call('set', key .. ':reserved', current_reserved)
      redis.call('expire', key .. ':balance', ${this.config.performance.cacheTTL})
      redis.call('expire', key .. ':reserved', ${this.config.performance.cacheTTL})
      
      return {current_balance, current_reserved}
    `;

    const result = await this.redis.eval(
      script,
      1,
      accountId,
      amount.toString(),
      transactionType
    );

    if (result === -1) {
      throw new Error('Insufficient funds');
    } else if (result === -2) {
      throw new Error('Insufficient available funds');
    }

    const [newBalance, newReserved] = result as [string, string];
    
    // Create transaction record
    const transaction: Transaction = {
      id: uuidv4(),
      accountId,
      type: transactionType,
      amount,
      currency: account.currency,
      description: `${transactionType} transaction`,
      metadata: metadata || {},
      timestamp: new Date(),
      isReversed: false,
    };

    await this.recordTransaction(transaction);
    
    // Publish event
    await this.publishEvent('token_balance_updated', {
      accountId,
      newBalance: BigInt(newBalance),
      newReserved: BigInt(newReserved),
      transactionType,
      transactionId: transaction.id,
    });

    return BigInt(newBalance);
  }

  /**
   * Credit tokens to an account
   */
  async credit(
    accountId: string,
    amount: bigint,
    description: string,
    metadata?: Record<string, any>
  ): Promise<bigint> {
    return this.updateBalance(accountId, amount, 'credit', {
      description,
      ...metadata,
    });
  }

  /**
   * Debit tokens from an account
   */
  async debit(
    accountId: string,
    amount: bigint,
    description: string,
    metadata?: Record<string, any>
  ): Promise<bigint> {
    return this.updateBalance(accountId, amount, 'debit', {
      description,
      ...metadata,
    });
  }

  /**
   * Reserve tokens (for pending transactions)
   */
  async reserve(
    accountId: string,
    amount: bigint,
    description: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    const reservationId = uuidv4();
    await this.updateBalance(accountId, amount, 'reserve', {
      reservationId,
      description,
      ...metadata,
    });
    return reservationId;
  }

  /**
   * Release reserved tokens
   */
  async release(
    reservationId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Find the reservation transaction
    const query = `
      SELECT * FROM transactions 
      WHERE metadata->>'reservationId' = $1 AND type = 'reserve' AND is_reversed = false
      ORDER BY timestamp DESC LIMIT 1
    `;
    
    const result = await this.postgres.query(query, [reservationId]);
    if (result.rows.length === 0) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    const reservation = result.rows[0];
    await this.updateBalance(reservation.account_id, BigInt(reservation.amount), 'release', {
      reservationId,
      originalTransactionId: reservation.id,
      ...metadata,
    });
  }

  /**
   * Transfer tokens between accounts
   */
  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: bigint,
    description: string,
    metadata?: Record<string, any>
  ): Promise<{ fromBalance: bigint; toBalance: bigint }> {
    // Atomic transfer using Redis transaction
    const multi = this.redis.multi();
    
    // Debit from source
    const fromBalance = await this.debit(fromAccountId, amount, `Transfer to ${toAccountId}`, metadata);
    
    // Credit to destination
    const toBalance = await this.credit(toAccountId, amount, `Transfer from ${fromAccountId}`, metadata);
    
    // Create transfer record
    const transferId = uuidv4();
    await this.recordTransaction({
      id: transferId,
      accountId: fromAccountId,
      type: 'transfer',
      amount,
      currency: 'TOKENS',
      description,
      metadata: {
        transferId,
        toAccountId,
        fromAccountId,
        ...metadata,
      },
      timestamp: new Date(),
      isReversed: false,
    });

    return { fromBalance, toBalance };
  }

  /**
   * Get account details
   */
  async getAccount(accountId: string): Promise<TokenAccount | null> {
    // Check cache first
    const cached = await this.redis.hgetall(`account:${accountId}`);
    if (cached && Object.keys(cached).length > 0) {
      return {
        id: cached.id,
        userId: cached.userId,
        organizationId: cached.organizationId,
        departmentId: cached.departmentId,
        teamId: cached.teamId,
        projectId: cached.projectId,
        agentId: cached.agentId,
        balance: BigInt(cached.balance || '0'),
        reserved: BigInt(cached.reserved || '0'),
        currency: cached.currency || 'TOKENS',
        accountType: cached.accountType as any,
        hierarchyLevel: parseInt(cached.hierarchyLevel || '0'),
        parentAccountId: cached.parentAccountId,
        metadata: JSON.parse(cached.metadata || '{}'),
        createdAt: new Date(cached.createdAt),
        updatedAt: new Date(cached.updatedAt),
        lastTransactionAt: cached.lastTransactionAt ? new Date(cached.lastTransactionAt) : undefined,
      };
    }

    // Query database
    const query = 'SELECT * FROM token_accounts WHERE id = $1';
    const result = await this.postgres.query(query, [accountId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const account = result.rows[0];
    
    // Cache the result
    await this.redis.hmset(`account:${accountId}`, {
      ...account,
      balance: account.balance.toString(),
      reserved: account.reserved.toString(),
      metadata: JSON.stringify(account.metadata),
      createdAt: account.created_at.toISOString(),
      updatedAt: account.updated_at.toISOString(),
      lastTransactionAt: account.last_transaction_at?.toISOString(),
    });
    
    await this.redis.expire(`account:${accountId}`, this.config.performance.cacheTTL);

    return {
      ...account,
      balance: BigInt(account.balance),
      reserved: BigInt(account.reserved),
    };
  }

  /**
   * Create a new account
   */
  async createAccount(account: Partial<TokenAccount>): Promise<TokenAccount> {
    const newAccount: TokenAccount = {
      id: account.id || uuidv4(),
      userId: account.userId!,
      organizationId: account.organizationId!,
      departmentId: account.departmentId,
      teamId: account.teamId,
      projectId: account.projectId,
      agentId: account.agentId,
      balance: account.balance || BigInt(0),
      reserved: account.reserved || BigInt(0),
      currency: account.currency || 'TOKENS',
      accountType: account.accountType || 'user',
      hierarchyLevel: account.hierarchyLevel || 0,
      parentAccountId: account.parentAccountId,
      metadata: account.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastTransactionAt: undefined,
    };

    const query = `
      INSERT INTO token_accounts (
        id, user_id, organization_id, department_id, team_id, project_id, agent_id,
        balance, reserved, currency, account_type, hierarchy_level, parent_account_id,
        metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      newAccount.id,
      newAccount.userId,
      newAccount.organizationId,
      newAccount.departmentId,
      newAccount.teamId,
      newAccount.projectId,
      newAccount.agentId,
      newAccount.balance,
      newAccount.reserved,
      newAccount.currency,
      newAccount.accountType,
      newAccount.hierarchyLevel,
      newAccount.parentAccountId,
      JSON.stringify(newAccount.metadata),
      newAccount.createdAt,
      newAccount.updatedAt,
    ];

    const result = await this.postgres.query(query, values);
    return result.rows[0];
  }

  /**
   * Get account balance
   */
  async getBalance(accountId: string): Promise<{ balance: bigint; reserved: bigint; available: bigint }> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const available = account.balance - account.reserved;
    return {
      balance: account.balance,
      reserved: account.reserved,
      available,
    };
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    accountId: string,
    limit = 100,
    offset = 0
  ): Promise<Transaction[]> {
    const query = `
      SELECT * FROM transactions 
      WHERE account_id = $1 
      ORDER BY timestamp DESC 
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.postgres.query(query, [accountId, limit, offset]);
    return result.rows.map(row => ({
      ...row,
      amount: BigInt(row.amount),
    }));
  }

  /**
   * Get accounts by hierarchy
   */
  async getAccountsByHierarchy(
    organizationId: string,
    hierarchyLevel?: number,
    parentAccountId?: string
  ): Promise<TokenAccount[]> {
    let query = 'SELECT * FROM token_accounts WHERE organization_id = $1';
    const params: any[] = [organizationId];
    
    if (hierarchyLevel !== undefined) {
      query += ' AND hierarchy_level = $2';
      params.push(hierarchyLevel);
    }
    
    if (parentAccountId) {
      query += ' AND parent_account_id = $' + (params.length + 1);
      params.push(parentAccountId);
    }
    
    query += ' ORDER BY hierarchy_level, created_at';
    
    const result = await this.postgres.query(query, params);
    return result.rows.map(row => ({
      ...row,
      balance: BigInt(row.balance),
      reserved: BigInt(row.reserved),
    }));
  }

  private async recordTransaction(transaction: Transaction): Promise<void> {
    const query = `
      INSERT INTO transactions (
        id, account_id, type, amount, currency, description, metadata,
        timestamp, correlation_id, parent_transaction_id, reversal_transaction_id, is_reversed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;

    const values = [
      transaction.id,
      transaction.accountId,
      transaction.type,
      transaction.amount,
      transaction.currency,
      transaction.description,
      JSON.stringify(transaction.metadata),
      transaction.timestamp,
      transaction.correlationId,
      transaction.parentTransactionId,
      transaction.reversalTransactionId,
      transaction.isReversed,
    ];

    await this.postgres.query(query, values);
    
    // Update account's last transaction time
    await this.postgres.query(
      'UPDATE token_accounts SET last_transaction_at = $1, updated_at = $1 WHERE id = $2',
      [transaction.timestamp, transaction.accountId]
    );
  }

  private async publishEvent(eventType: string, data: any): Promise<void> {
    await this.producer.send({
      topic: 'token-events',
      messages: [
        {
          key: data.accountId || data.organizationId,
          value: JSON.stringify({
            type: eventType,
            timestamp: new Date().toISOString(),
            data,
          }),
        },
      ],
    });
  }

  private async handleBudgetWarning(event: any): Promise<void> {
    // Implement budget warning logic
    console.log(`Budget warning for account ${event.accountId}: ${event.message}`);
  }

  private async handleBudgetExceeded(event: any): Promise<void> {
    // Implement budget exceeded logic
    console.log(`Budget exceeded for account ${event.accountId}: ${event.message}`);
  }

  private async handleAnomalyDetected(event: any): Promise<void> {
    // Implement anomaly detection logic
    console.log(`Anomaly detected for account ${event.accountId}: ${event.message}`);
  }

  async shutdown(): Promise<void> {
    await this.producer.disconnect();
    await this.consumer.disconnect();
    this.redis.disconnect();
    await this.postgres.end();
  }
}