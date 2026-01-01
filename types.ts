
export interface User {
  id: string;
  name: string; // From Supabase user_metadata or email
  email: string;
  firmName: string; // From Supabase user_metadata or default
  planName?: string; // e.g., 'Basic', 'Professional', 'Unlimited'
  strsUsedMonthly?: number; // Current used STR count for the month
  maxStrsMonthly?: number; // Max allowed STRs per month
  inputTokensUsedMonthly?: number; // Current input tokens used
  maxInputTokensMonthly?: number; // Max input tokens per month
  outputTokensUsedMonthly?: number; // Max output tokens used
  maxOutputTokensMonthly?: number; // Max output tokens per month
  maxFileSizeDocMB?: number; // Max file size per document
  maxTotalUploadMB?: number; // Max total upload size per STR
  dailyStrsUsed?: number; // Current daily STR count
  maxStrsDaily?: number; // Max allowed STRs per day
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
  advocateInstructions?: string; // Added to store advocate-specific instructions
}

export interface Plan {
  id: number;
  name: string;
  monthly_limit: number;
  price_monthly: number;
  max_input_tokens_per_month: number;
  max_output_tokens_per_month: number;
  max_strs_per_month: number;
  max_strs_per_day: number;
  max_file_size_mb_per_document: number;
  max_total_upload_mb_per_str: number;
}

export interface ApiLimits {
  user_id: string;
  plan_id: number;
  monthly_limit: number;
  used: number;
  reset_date: string;
  input_tokens_used_monthly: number;
  output_tokens_used_monthly: number;
  strs_used_monthly: number;
}
