// Common TypeScript interfaces and types

export interface HealthStatus {
  status: 'ok';
}

export interface ReadinessStatus {
  ready: boolean;
  checks?: {
    database?: boolean;
    salesforce?: boolean;
    keyVault?: boolean;
  };
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  sfDomain?: string;
  azureTenantId?: string;
  clientId?: string;
  keyVaultUri?: string;
  imageAllowlist?: string[];
}

export interface CorrelationContext {
  correlationId: string;
}

// Docgen Request/Response Types

export interface DocgenOptions {
  storeMergedDocx: boolean;
  returnDocxToBrowser: boolean;
}

export interface DocgenParents {
  AccountId?: string | null;
  OpportunityId?: string | null;
  CaseId?: string | null;
}

export interface DocgenRequest {
  templateId: string;
  outputFileName: string;
  outputFormat: 'PDF' | 'DOCX';
  locale: string;
  timezone: string;
  options: DocgenOptions;
  data: Record<string, any>;
  parents?: DocgenParents;
  requestHash?: string;
}

export interface DocgenResponse {
  downloadUrl: string;
  contentVersionId: string;
  correlationId: string;
}
