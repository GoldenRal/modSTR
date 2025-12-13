
export interface User {
  id: string;
  name: string; // From Supabase user_metadata or email
  email: string;
  firmName: string; // From Supabase user_metadata or default
  planName?: string; // e.g., 'Basic', 'Professional', 'Unlimited'
  // NEW LIMITS FEATURE: Monthly usage and limits
  monthlyAllowance?: number; // Old: Max allowed STRs or API calls per month
  strsUsedMonthly?: number; // New: Current used STR count for the month
  maxStrsMonthly?: number; // New: Max allowed STRs per month
  inputTokensUsedMonthly?: number; // New: Current input tokens used
  maxInputTokensMonthly?: number; // New: Max input tokens per month
  outputTokensUsedMonthly?: number; // New: Max output tokens used
  maxOutputTokensMonthly?: number; // New: Max output tokens per month
  maxFileSizeDocMB?: number; // New: Max file size per document
  maxTotalUploadMB?: number; // New: Max total upload size per STR
  dailyStrsUsed?: number; // NEW: Current daily STR count
  maxStrsDaily?: number; // NEW: Max allowed STRs per day
}

export interface Document {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string; // Mime type
  docTypes?: string[]; // Classified document types
  file?: File;
  uploadDate: string;
  status: 'Uploading' | 'Uploaded' | 'Extracting Text' | 'Classifying' | 'Processed' | 'Error' | 'Unsupported';
  extractedText?: string; // To hold OCR result for classification
  progress?: number;
  error?: string;
}

export interface Report {
  id: string;
  projectId: string;
  generatedAt: string;
  status: 'Draft' | 'Finalized';
  content: string; // Markdown content
  strCategory?: string; // e.g., 'NA Plot'
  summary?: string; // Markdown summary
  riskFlags?: string[]; // List of detected risks
  ruleEngineFlags: Record<string, any>;
  reportFormatUsed?: string; // Added to track which format was used
}

export type Scenario =
  | 'CLEAR_FREEHOLD_PLOT'
  | 'FLAT_IN_SOCIETY'
  | 'AGRICULTURAL_LAND'
  | 'NA_PLOT'
  | 'MORTGAGED_PROPERTY'
  | 'COURT_CASE_LITIGATION'
  | 'UNDER_CONSTRUCTION'
  | 'INDUSTRIAL_PLOT'
  | 'INHERITED_PROPERTY'
  | 'JOINT_OWNERSHIP'
  | 'REDEVELOPMENT_PROPERTY'
  | 'UNKNOWN';

export interface ProjectDetails {
  projectName: string;
  propertyAddress: string;
  clientName: string;
  searchPeriod: string;
  scenario: Scenario;
}

export interface Project {
  id:string;
  projectName: string;
  propertyAddress: string;
  clientName: string;
  searchPeriod: string;
  createdAt: string;
  documents: Document[];
  report: Report | null;
  scenario?: Scenario;
  missingDocuments?: string[]; // To track required but missing document types
  advocateInstructions?: string; // Added to store advocate-specific instructions
}

// NEW LIMITS FEATURE: Updated Plan interface to include granular limits
export interface Plan {
  id: number;
  name: string;
  monthly_limit: number; // Old: general monthly limit (e.g., for basic reports)
  price_monthly: number;
  max_input_tokens_per_month: number;
  max_output_tokens_per_month: number;
  max_strs_per_month: number;
  max_strs_per_day: number; // Daily limit, stored in plan but checked against daily_usage
  max_file_size_mb_per_document: number;
  max_total_upload_mb_per_str: number;
}

// NEW LIMITS FEATURE: Updated ApiLimits interface to track granular usage
export interface ApiLimits {
  user_id: string;
  plan_id: number;
  monthly_limit: number; // This will be the effective general limit for the user based on their plan
  used: number; // Old: Current general usage for the period
  reset_date: string; // Date when the usage resets (for monthly limits)
  // New granular usage counters
  input_tokens_used_monthly: number;
  output_tokens_used_monthly: number;
  strs_used_monthly: number;
}
