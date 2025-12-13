import { GoogleGenAI, Part, Type } from "@google/genai";
import { Project, User, Scenario, ProjectDetails, Report } from '../types';
import { SCENARIOS, SCENARIO_BASED_DOCUMENTS, REPORT_FORMATS } from '../constants';
import { supabase } from '../supabaseClient';

//const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to convert a File object to a GoogleGenAI.Part
const fileToGenerativePart = async (file: File): Promise<Part> => {
  const base64EncodedDataPromise = new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64Data = reader.result.split(',')[1];
        resolve(base64Data);
      } else {
        reject(new Error("Failed to read file as data URL."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });

  return {
    inlineData: {
      data: await base64EncodedDataPromise,
      mimeType: file.type,
    },
  };
};

export const UNSUPPORTED_FOR_EXTRACTION = 'UNSUPPORTED_FOR_EXTRACTION';
export const RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED';

const estimateTokens = (text: string | undefined): number => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const checkRlsError = (error: any, context: string) => {
  if (error && error.message && error.message.includes('row-level security')) {
    console.warn(`[${context}] RLS Policy Violation. Please run the policies in 'db_policies.sql' in your Supabase SQL Editor.`);
  }
};

const logAiCall = async (
  userId: string | null,
  model: string,
  apiEndpointType: string,
  promptTokens: number,
  completionTokens: number,
  success: boolean,
  errorMessage?: string,
): Promise<void> => {
  if (!userId) {
    console.warn(`AI usage not logged for ${apiEndpointType}: User not authenticated.`);
    return;
  }

  const totalTokens = promptTokens + completionTokens;
  const today = new Date().toISOString().split('T')[0];

  try {
    const { error: aiUsageError } = await supabase
      .from('ai_usage')
      .insert([
        {
          user_id: userId,
          model: model,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          // cost_usd is handled by DB trigger 'calc_ai_usage_costs'
          success: success,
          error_message: errorMessage,
          api_endpoint_type: apiEndpointType,
        },
      ]);

    if (aiUsageError) {
      console.error(`Error logging AI usage for ${apiEndpointType} to Supabase (ai_usage):`, aiUsageError.message);
      checkRlsError(aiUsageError, 'ai_usage insert');
    }

    if (success) {
      let strCountIncrement = 0;
      if (apiEndpointType === 'generateReport') {
        strCountIncrement = 1;
      }

      const { data: currentDailyUsage, error: fetchDailyUsageError } = await supabase
        .from('daily_usage')
        .select('str_count, input_tokens, output_tokens')
        .eq('user_id', userId)
        .eq('day', today)
        .single();

      if (fetchDailyUsageError && fetchDailyUsageError.code !== 'PGRST116') {
        console.error('Error fetching current daily usage for update:', fetchDailyUsageError.message);
      } else {
        const newStrCount = (currentDailyUsage?.str_count || 0) + strCountIncrement;
        const newInTokens = (currentDailyUsage?.input_tokens || 0) + promptTokens;
        const newOutTokens = (currentDailyUsage?.output_tokens || 0) + completionTokens;

        const { error: dailyUsageUpdateError } = await supabase
          .from('daily_usage')
          .upsert(
            {
              user_id: userId,
              day: today,
              str_count: newStrCount,
              input_tokens: newInTokens,
              output_tokens: newOutTokens,
              total_bytes: 0,
            },
            {
              onConflict: ['user_id', 'day'],
              ignoreDuplicates: false,
            }
          );

        if (dailyUsageUpdateError) {
          console.error(`Error upserting daily usage for ${apiEndpointType} to Supabase (daily_usage):`, dailyUsageUpdateError.message);
          checkRlsError(dailyUsageUpdateError, 'daily_usage upsert');
        }
      }

      const { data: currentApiLimits, error: fetchLimitsError } = await supabase
        .from('api_limits')
        .select('strs_used_monthly, input_tokens_used_monthly, output_tokens_used_monthly')
        .eq('user_id', userId)
        .single();

      if (fetchLimitsError && fetchLimitsError.code !== 'PGRST116') {
        console.error('Error fetching current api_limits for update:', fetchLimitsError.message);
      } else if (currentApiLimits) {
        const { error: updateLimitsError } = await supabase
          .from('api_limits')
          .update({
            strs_used_monthly: (currentApiLimits.strs_used_monthly || 0) + strCountIncrement,
            input_tokens_used_monthly: (currentApiLimits.input_tokens_used_monthly || 0) + promptTokens,
            output_tokens_used_monthly: (currentApiLimits.output_tokens_used_monthly || 0) + completionTokens,
          })
          .eq('user_id', userId);

        if (updateLimitsError) {
          console.error('Error updating api_limits monthly usage:', updateLimitsError.message);
          checkRlsError(updateLimitsError, 'api_limits update');
        }
      }
    }
  } catch (err) {
    console.error(`Unexpected error during AI usage logging for ${apiEndpointType}:`, err);
  }
  return;
};

export const extractTextFromFile = async (userId: string | null, file: File, estimatedInputTokens: number = 0, estimatedOutputTokens: number = 0, apiEndpointType: string = 'extractTextFromFile'): Promise<string> => {
  let result: string;
  let success: boolean = false;
  let errorMessage: string | undefined;
  let actualPromptTokens: number = 0;
  let actualCompletionTokens: number = 0;

  const SUPPORTED_MIME_TYPES_FOR_EXTRACTION = [
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'image/gif', 'image/bmp', 'image/heic', 'image/heif', 'application/vnd.ms-excel', 'text/html'
  ];

  const KNOWN_UNSUPPORTED_MIME_TYPES = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
    'video/x-msvideo',
    'text/css',
    'application/xml',
    'text/xml',
    'application/octet-stream'
  ];

  if (!file.type || KNOWN_UNSUPPORTED_MIME_TYPES.includes(file.type)) {
    if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      result = `[Text content from DOCX file: ${file.name}. Direct AI text extraction for DOCX is not fully supported for initial document processing. Please consider converting to PDF or copy-pasting content for re-formatting.]`;
    } else {
      result = UNSUPPORTED_FOR_EXTRACTION;
    }
    success = true;
    await logAiCall(userId, 'N/A_CLIENT_UNSUPPORTED', apiEndpointType, estimatedInputTokens, 0, success, 'Client-side unsupported file type');
    return result;
  }

  if (!SUPPORTED_MIME_TYPES_FOR_EXTRACTION.includes(file.type)) {
    result = `Error: Unsupported file type for AI text extraction: ${file.name}. Only images and PDFs can be processed.`;
    success = false;
    errorMessage = result;
    await logAiCall(userId, 'N/A_CLIENT_UNSUPPORTED', apiEndpointType, estimatedInputTokens, 0, success, errorMessage);
    return result;
  }

  try {
    const filePart = await fileToGenerativePart(file);
    const prompt = "Extract all text content from this document. Preserve formatting like paragraphs and line breaks where possible. If the document is unreadable or contains no text, return 'Error: Unable to extract text from the provided file.'";

    actualPromptTokens = estimateTokens(prompt);

    // Using gemini-2.5-flash for OCR/Extraction as per architecture requirements
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [filePart, { text: prompt }],
    });

    if (!response || !response.text || response.text.trim() === '') {
      result = "Error: Empty or invalid text content from AI.";
      errorMessage = result;
    } else {
      result = response.text.trim();
      actualCompletionTokens = estimateTokens(result);
      success = true;
    }
  } catch (error: any) {
    const errMessage = error.toString();
    if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXCEEDED')) {
      console.warn("Gemini API rate limit exceeded during text extraction. The operation will be retried automatically.");
      result = RATE_LIMIT_EXCEEDED;
      errorMessage = 'Rate limit exceeded';
    } else {
      console.error("Error extracting text from file via Gemini:", error);
      result = "Error: The text extraction process failed.";
      errorMessage = errMessage;
    }
  } finally {
    await logAiCall(userId, 'gemini-2.5-flash', apiEndpointType, actualPromptTokens || estimatedInputTokens, actualCompletionTokens || estimatedOutputTokens, success, errorMessage);
  }
  return result;
};

const DOCUMENT_TYPES = [
  'Sale Deed',
  'Mutation Entry',
  'Loan Agreement',
  'Property Tax Receipt',
  'Power of Attorney',
  'Title Search Report',
  'Encumbrance Certificate',
  'Building Plan Approval',
  'Society Share Certificate',
  'Society NOC',
  'NA Order',
  '7/12 Extract',
  'Lease Deed',
  'Agreement for Sale',
  'Will / Probate',
  'Partition Deed',
  'Occupancy Certificate',
  'RERA Registration Certificate',
  'Redevelopment Agreement',
  'Legal Heir Certificate',
  'CERSAI Report',
  'Commencement Certificate',
  'Layout Plan',
  'Other',
].join(', ');

export const classifyDocument = async (userId: string | null, documentText: string, estimatedInputTokens: number = 0, estimatedOutputTokens: number = 0, apiEndpointType: string = 'classifyDocument'): Promise<string | typeof RATE_LIMIT_EXCEEDED> => {
  let result: string | typeof RATE_LIMIT_EXCEEDED;
  let success: boolean = false;
  let errorMessage: string | undefined;
  let actualPromptTokens: number = 0;
  let actualCompletionTokens: number = 0;

  try {
    const prompt = `
      Based on the following text from a legal property document, classify the document type.
      
      Return ONLY one of the following classifications: ${DOCUMENT_TYPES}.
      
      If you cannot determine the type, return "Other".
      
      ---
      TEXT: "${documentText.substring(0, 2000)}..." 
      ---
      
      DOCUMENT TYPE:
    `;
    actualPromptTokens = estimateTokens(prompt);

    // Using gemini-2.5-flash for Classification as per architecture requirements
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ text: prompt }],
    });

    if (!response || !response.text || response.text.trim() === '') {
      result = "Other";
      errorMessage = "Empty or invalid text content from AI.";
    } else {
      const classification = response.text.trim();
      actualCompletionTokens = estimateTokens(classification);

      if (DOCUMENT_TYPES.toLowerCase().includes(classification.toLowerCase())) {
        const typesArray = DOCUMENT_TYPES.split(', ');
        const matchedType = typesArray.find(t => t.toLowerCase() === classification.toLowerCase());
        result = matchedType || 'Other';
      } else {
        result = 'Other';
      }
      success = true;
    }
  } catch (error: any) {
    const errMessage = error.toString();
    if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED')) {
      console.warn("Gemini API rate limit exceeded during document classification. The operation will be retried automatically.");
      result = RATE_LIMIT_EXCEEDED;
      errorMessage = 'Rate limit exceeded';
    } else {
      console.error("Error classifying document:", error);
      result = "Error";
      errorMessage = errMessage;
    }
  } finally {
    await logAiCall(userId, 'gemini-2.5-flash', apiEndpointType, actualPromptTokens || estimatedInputTokens, actualCompletionTokens || estimatedOutputTokens, success, errorMessage);
  }
  return result;
};

export const extractProjectDetailsAndScenario = async (userId: string | null, documentText: string, estimatedInputTokens: number = 0, estimatedOutputTokens: number = 0, apiEndpointType: string = 'extractProjectDetailsAndScenario'): Promise<Partial<ProjectDetails> | typeof RATE_LIMIT_EXCEEDED> => {
  let result: Partial<ProjectDetails> | typeof RATE_LIMIT_EXCEEDED;
  let success: boolean = false;
  let errorMessage: string | undefined;
  let actualPromptTokens: number = 0;
  let actualCompletionTokens: number = 0;

  if (!documentText || documentText.trim().length === 0) {
    result = {};
    success = true;
    await logAiCall(userId, 'N/A', apiEndpointType, estimatedInputTokens, estimatedOutputTokens, success, errorMessage);
    return result;
  }

  try {
    const prompt = `From the provided text, which contains content from one or more legal documents, extract key details and identify the primary legal scenario. The text from different documents is separated by "--- Document: [filename] ---".

SCENARIO IDENTIFICATION:
Analyze the document for keywords and context to determine the most fitting scenario from the list below.
Prioritize the most specific scenario if multiple indicators are present.

Available Scenarios (with example indicators):
- CLEAR_FREEHOLD_PLOT: A standard, clear title property with no major complications. Indicators: Clear Sale Deed, Mutation Entry, Property Card, no encumbrances.
- FLAT_IN_SOCIETY: An apartment within a registered housing society. Indicators: Society Share Certificate, Society NOC, Building Plan Approval, Occupancy Certificate, Maintenance Bill.
- AGRICULTURAL_LAND: Land designated for agricultural use, potentially requiring NA conversion. Indicators: 7/12 Extract, Farmer Certificate, agricultural classification.
- NA_PLOT: Non-agricultural land, typically with a Collector Order. Indicators: NA Order, Approved Layout Plan, non-agricultural designation.
- MORTGAGED_PROPERTY: The property currently has an active loan or mortgage against it. Indicators: Mortgage Deed, MODT, existing loan statements, CERSAI report references.
- COURT_CASE_LITIGATION: The property is involved in an ongoing legal dispute. Indicators: Court orders, plaint/petition copies, lis pendens, specific case numbers (e.g., Civil Suit No., FIR No.).
- UNDER_CONSTRUCTION: The property is being developed by a builder and is not yet complete. Indicators: Agreement for Sale (with builder), RERA registration, Commencement Certificate, building plans.
- INDUSTRIAL_PLOT: A plot designated for industrial use, often with lease terms (e.g., MIDC, GIDC). Indicators: Lease Deed, MIDC/GIDC Allotment Letter, Possession Receipt, No Dues Certificate from Authority, Approval for Transfer, industrial zone mentions.
- INHERITED_PROPERTY: Property acquired through succession or inheritance. Indicators: Death Certificate, Will / Probate or Succession Certificate, Legal Heir Certificate, Mutation Entry in heirs\' names.
- JOINT_OWNERSHIP: Property owned by multiple co-owners. Indicators: Multiple owner names on deeds, partition deed mentions, co-owner agreements.
- REDEVELOPMENT_PROPERTY: An old society/building being redeveloped by a builder. Indicators: Redevelopment Agreement, society resolutions, members\' consent letters, RERA registration for redevelopment.
- UNKNOWN: The scenario could not be determined from the provided documents.

If no specific scenario can be determined, use 'UNKNOWN'.

DATA EXTRACTION:
Also extract the property address, the primary client/borrower's name, and the title search period.
Generate a concise project name based on the address and client.
**IMPORTANT: Ensure all extracted values (Project Name, Address, Client Name) are translated/transliterated to ENGLISH.**

DOCUMENT TEXT:
---
${documentText.substring(0, 30000)}
---
`;
    actualPromptTokens = estimateTokens(prompt);

    // Using gemini-2.5-flash for Entity Extraction as per architecture requirements
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            projectName: {
              type: Type.STRING,
              description: "A short, descriptive project name, like 'Property Search for [Client Name] at [Address]'. IN ENGLISH."
            },
            propertyAddress: {
              type: Type.STRING,
              description: "The full property address mentioned in the document. IN ENGLISH."
            },
            clientName: {
              type: Type.STRING,
              description: "The name of the main client, borrower, or property owner. IN ENGLISH."
            },
            searchPeriod: {
              type: Type.STRING,
              description: "The specified title search period (e.g., '30 years'). If not explicitly mentioned, state 'Not Specified'."
            },
            scenario: {
              type: Type.STRING,
              description: "The identified legal scenario for the property.",
              enum: Object.keys(SCENARIOS)
            }
          }
        }
      },
    });

    const jsonText = response.text?.trim();
    actualCompletionTokens = estimateTokens(jsonText);
    if (!jsonText) {
      console.error("Gemini returned an empty response for project details extraction.");
      result = {};
      errorMessage = "Empty response from AI.";
    } else {
      try {
        result = JSON.parse(jsonText);
        success = true;
      } catch (parseError: any) {
        console.error("Failed to parse JSON for project details:", parseError, "Raw AI response:", jsonText);
        result = {};
        errorMessage = `Failed to parse AI response: ${parseError.message}`;
      }
    }
  } catch (error: any) {
    const errMessage = error.toString();
    if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXCEEDED')) {
      console.warn("Gemini API rate limit exceeded during project detail extraction. The operation will be retried automatically.");
      result = RATE_LIMIT_EXCEEDED;
      errorMessage = 'Rate limit exceeded';
    } else {
      console.error("Error extracting project details with Gemini:", error);
      result = {};
      errorMessage = errMessage;
    }
  } finally {
    await logAiCall(userId, 'gemini-2.5-flash', apiEndpointType, actualPromptTokens || estimatedInputTokens, actualCompletionTokens || estimatedOutputTokens, success, errorMessage);
  }
  return result;
};

export const analyzeDocumentCompleteness = async (userId: string | null, uploadedDocTypes: string[], requiredDocTypes: string[], estimatedInputTokens: number = 0, estimatedOutputTokens: number = 0, apiEndpointType: string = 'analyzeDocumentCompleteness'): Promise<string[] | typeof RATE_LIMIT_EXCEEDED> => {
  let result: string[] | typeof RATE_LIMIT_EXCEEDED;
  let success: boolean = false;
  let errorMessage: string | undefined;
  let actualPromptTokens: number = 0;
  let actualCompletionTokens: number = 0;

  try {
    const prompt = `
      You are a document analysis assistant for legal title searches.
      Based on the required document list for this specific scenario and the list of documents already uploaded, identify which required documents are missing.
      
      Required Documents List: ${JSON.stringify(requiredDocTypes)}
      Uploaded Documents List: ${JSON.stringify(uploadedDocTypes)}

      Respond ONLY with a JSON array of strings containing the names of the missing document types from the required list.
      For example: ["Sale Deed", "Encumbrance Certificate"].
      If no required documents are missing, return an empty array [].
    `;
    actualPromptTokens = estimateTokens(prompt);

    // Using gemini-2.5-flash for Basic Checks/Logic as per architecture requirements
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
      },
    });

    const jsonText = response.text?.trim();
    actualCompletionTokens = estimateTokens(jsonText);
    if (!jsonText) {
      console.error("Gemini returned an empty response for document completeness.");
      result = [];
      errorMessage = "Empty response from AI.";
    } else {
      try {
        result = JSON.parse(jsonText);
        success = true;
      } catch (parseError: any) {
        console.error("Failed to parse JSON for document completeness:", parseError, "Raw AI response:", jsonText);
        result = [];
        errorMessage = `Failed to parse AI response: ${parseError.message}`;
      }
    }
  } catch (error: any) {
    const errMessage = error.toString();
    if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXCEEDED')) {
      console.warn("Gemini API rate limit exceeded during document completeness check. Skipping for now.");
      result = RATE_LIMIT_EXCEEDED;
      errorMessage = 'Rate limit exceeded';
    } else {
      console.error("Error analyzing document completeness with Gemini:", error);
      result = [];
      errorMessage = errMessage;
    }
  } finally {
    await logAiCall(userId, 'gemini-2.5-flash', apiEndpointType, actualPromptTokens || estimatedInputTokens, actualCompletionTokens || estimatedOutputTokens, success, errorMessage);
  }
  return result;
};

const generateRAGPrompt = (project: Project, retrievedContext: string, user: User, reportFormat: string = REPORT_FORMATS[0], advocateInstructions?: string): string => {
  const today = new Date();
  const formattedDate = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`;
  
  const governingRules = `
STRICT GOVERNING RULES (MANDATORY):

1. DOCUMENT HIERARCHY
   Follow this document priority order strictly:
   a) Loan Application / Title Search Request / Lender Instruction (highest authority)
   b) Sale Deed / Conveyance Deed / Transfer Deeds
   c) Revenue & Municipal Records
   d) Encumbrance / Court / CERSAI Records
   e) Identity Documents (lowest authority)

   If any conflict exists between documents, follow the higher-priority document.
   Never resolve conflicts silently. Always record them explicitly.

2. APPLICANT IDENTIFICATION
   Applicant name(s) must be taken ONLY from the Loan Application / Search Request.
   Other documents may be used only to check consistency.
   Do not add, remove, substitute, or correct applicant names.

3. TARGET PROPERTY CONTROL
   The target property description must be reproduced exactly as stated in the Loan Application.
   Other documents may be used only to trace title for the same property.
   If property details differ across documents, record the discrepancy clearly.

4. STR TYPE DETERMINATION
   Determine the type of STR (Purchase / Mortgage / LAP / Balance Transfer / Builder Loan) ONLY from the Loan Application.
   Do not infer STR type from deeds, encumbrances, or transaction history.
   If not explicitly stated, record that the STR type is not specified.

5. SEARCH PERIOD
   Use the search period strictly as stated in the Loan Application or lender instruction.
   Do not assume a default period.
   If not mentioned, explicitly state that the search period is not specified.

6. CHAIN OF TITLE
   Construct the chain of title strictly from the documents provided.
   Do not assume missing links or ownership transitions.
   Any missing or unclear link must be recorded as a gap in title.

7. ENCUMBRANCES
   List encumbrances exactly as found in records.
   Do not infer discharge, validity, or closure unless explicitly documented.

8. LEGAL OPINION SAFETY
   Do not issue definitive or unconditional legal conclusions if:
   - Documents are missing
   - Discrepancies exist
   - Search scope is unclear
   Use conservative, bank-acceptable, conditional language.

9. OUTPUT DISCIPLINE
   Follow the existing STR format used by the system.
   Improve clarity, consistency, and legal precision without changing section order or structure.

10. PROHIBITED BEHAVIOR
    - No assumptions
    - No inferred facts
    - No silent corrections
    - No optimistic interpretations

CORE OBJECTIVE:
Improve accuracy, consistency, and legal defensibility of the STR while preserving the current generation process.
`;

  const baseInstruction = `
IMPORTANT FORMATTING AND LANGUAGE RULES: 
1. **LANGUAGE**: The final report MUST be in ENGLISH. 
2. **TABLES**: Use standard Markdown tables for ALL lists of data, documents, flow of title, and property schedules. A Markdown table must have a header row separated by dashes.
3. **FORMAT**: Do not use HTML tables, only Markdown syntax.
`;

  let specificStructure = "";
  let mainTitle = "**LEGAL SCRUTINY REPORT**";

  switch (reportFormat) {
    case "Advocate Standard Format":
      mainTitle = "**LEGAL SCRUTINY REPORT (ADVOCATE STANDARD)**";
      specificStructure = `
      **STRUCTURE:**
      **To:**
      [Bank Name/Client Name]
      
      **PART I:**
      | Field | Details |
      |---|---|
      | Name of the Applicant | ${project.clientName} |
      | App ID | {extract if available} |
      | Case Type | {extract if available} |
      | Name of the proposed Owner | {extract} |

      **PART II: SCHEDULE OF PROPERTY:**
      {Description of the property including Plot no, area, village, district}
      
      **Boundaries:**
      | Direction | Description |
      |---|---|
      | East | {extract} |
      | West | {extract} |
      | South | {extract} |
      | North | {extract} |

      **PART III: LIST OF DOCUMENTS PERUSED:**
      | S. No. | Date of Document | Description of Document | Doc. No. | Nature of Document | Parties Involved | Uploaded File Name |
      |---|---|---|---|---|---|---|
      | 1 | {date} | {description} | {doc no} | {Copy/Original} | {Seller/Buyer names} | {Filename from context} |
      
      **PART IV: FLOW OF TITLE:**
      {Detailed narrative of the title flow, chronological order.}

      **PART V: ENCUMBRANCE:**
      {Statement regarding encumbrance search and findings.}

      **PART VI: OTHER PROVISIONS:**
      1) Whether all documents for last 30 years have been scrutinized: {Yes/No}
      2) Whether the user land has been converted into Non-Agricultural: {Yes/No/Details}
      3) Whether proposed mortgage by deposit of title deeds is possible: {Yes/No}
      4) Whether required documents are available for creating mortgage: {Yes/No}
      5) Whether Builder is a Private Limited / Limited Company: {Yes/No}
      6) Whether enforcement action can be initiated under SARFAESI Act: {Yes/No}
      7) Whether up to date tax/Land Revenue has been paid: {Yes/No}
      8) Whether all previous owners had the right/competency to transfer: {Yes/No}
      9) Whether property is subject to minor's claim: {Yes/No}
      10) Whether land is joint family property: {Yes/No}
      11) Whether Urban Land Ceiling Act applicable: {Yes/No}
      12) Whether affected by revenue/tenancy regulations: {Yes/No}
      13) Is subject to reservations/acquisitions: {Yes/No}
      14) Whether transferred by POA: {Yes/No}
      15) Whether POA holder had authority: {Yes/No}
      16) Whether POA is registered: {Yes/No}
      17) Whether Adivasi/Tribal land: {Yes/No}
      18) Whether Land is leased: {Yes/No}

      **PART VII: OTHER REMARKS:**
      {Any other specific remarks or NIL}

      **PART VIII: CERTIFICATE:**
      This is to certify that {Owner Name} having a valid, and marketable title to the Schedule Property...
      This is further certified that {Owner Name} can create a valid mortgage in favour of {Bank Name}.

      **PART IX: LIST OF DOCUMENTS TO BE COLLECTED:**
      {List of documents required for mortgage creation}
      `;
      break;

    case "Bajaj Finance Format":
      mainTitle = "**TITLE SEARCH REPORT (BAJAJ HOUSING FINANCE LTD)**";
      specificStructure = `
      **To,**
      The Credit Manager,
      Bajaj Housing Finance Ltd.
      
      **Sub:** Legal Report
      
      1] Nature of Transaction: {extract}
      2] Name of the Borrower: ${project.clientName}
      3] Name of the Owner: {extract}
      4] Payment to be made in: {extract}
      
      **5] Description of the Property/Properties:**
      | Sr. No. | Description of the Property | Situated at | East | West | South | North |
      |---|---|---|---|---|---|---|
      | 1 | {description} | {location} | {bound} | {bound} | {bound} | {bound} |

      7] Nature of Property: {Free Hold/Leasehold/NA Land}
      
      **8] Document Given for Inspection:**
      | Sr. NO. | Nature of Document | Number, Date and Year | Original /Certified |
      |---|---|---|---|
      | 1 | {nature} | {details} | {status} |

      **9] Documents Examined but not physically received from customer:**
      | Sr. NO. | Nature of Document | Number, Date and Year | Original /Certified |
      |---|---|---|---|
      | 1 | {nature} | {details} | {status} |

      10] General Information: {details}
      11] Legal intervention/issues that may affect the title: {Nil/Details}
      12] Step/Document prior to disbursement of loan: {Nil/Details}
      
      **13] Opinion:**
      {Detailed legal opinion paragraph}
      I confirmed that in event of default by borrower, mortgage of the property being funded be enforce under the SARFAESI Act.

      14] Documents must require for creation of security: {details}
      15] Documents required post disbursal: {Nil/Details}

      **Summary Table:**
      | Particulars | Details |
      |---|---|
      | Is the title of the property is valid, clear and marketable? | {Yes/No} |
      | Can Equitable mortgage/Registered Mortgage be created? | {Yes/No} |
      | Are there any minor's rights in the Property? | {Yes/No} |
      | Is the Property Impacted by Urban Land Ceiling Act? | {Yes/No} |
      | Whether the property is subject to any wakf/church/temple rights? | {Yes/No} |
      | Whether adequate stamp duty is paid on title documents? | {Yes/No} |
      | If leasehold, is construction permitted? | {Yes/No/NA} |
      | Can SARFAESI be enforced on the Property? | {Yes/No} |
      `;
      break;

    case "JM Financial Format":
      mainTitle = "**Investigation Report & Title Certificate (JMFHLL)**";
      specificStructure = `
      **To,**
      JMFHLL JM Financial Home Loans Limited
      
      | Field | Value |
      |---|---|
      | Date | ${formattedDate} |
      | Status of Legal Opinion Report | {POSITIVE/NEGATIVE/QUERY} |
      | Transaction Type | {Resale/Fresh/BT} |

      1. Name of the Borrower(s): ${project.clientName}
      2. Name of the Owner(s) of the property: {extract}
      3. Constitution of the Owner: {Individual/HUF/Company}
      4. Full description of the property:
         {Description including Plot No, Survey No, Area}
         **Boundaries:**
         East: {extract}
         West: {extract}
         North: {extract}
         South: {extract}
      
      5. List with details of Title Deeds / documents scrutinized:
      {List documents with name, date, parties, registration no, original/copy status}

      6. Tracing of title and investigation of title:
      {Detailed history of title flow for at least 13 years}

      7. Whether the property is in the list of PROHIBITED Property List: {Yes/No}
      8. Whether any additional document is required: {details}
      9. Particulars of tax/ revenue receipts studied: {details}
      10. Particulars of Encumbrance Certificate/ Search Notes: {details}
      10(a). Whether contents of Regular EC verified with online EC: {Yes/No}
      11. Particulars of any charges / encumbrances found: {details}
      12. Whether the premises is leasehold/ freehold: {details}
      13. Permission / NOC from Society / Authority: {details}
      14. Minor's Interest: {Yes/No}
      15. Land is agricultural or non-agricultural: {details}
      16. Application of Acts (RERA, ULC, Tenancy, SARFAESI): {Applicable/Not Applicable}
      17. Last / latest mutation in revenue record is in whose name: {name}
      
      18. List of original title documents required for mortgaging:
      | Sr. no. | Name of the document | From | To | Date | Form (Original/Copy) |
      |---|---|---|---|---|---|
      | 1 | {name} | {from} | {to} | {date} | {form} |

      19. Form of Mortgage: {Simple/Equitable}

      **Vetting Report for original documents:**
      **B. List of original documents verified:**
      | Sr No. | Date | Document Type | Parties | Original/Copy | Stamp details | Form |
      |---|---|---|---|---|---|---|
      | 1 | {date} | {type} | {parties} | {status} | {details} | {form} |
      
      **C. List of PDD:**
      | Sr No. | Document | From | To | Original/Copy |
      |---|---|---|---|---|
      | 1 | {doc} | {from} | {to} | {status} |
      `;
      break;

    case "Mahindra Rural Format":
      mainTitle = "**Title Scrutiny Report (Mahindra Rural Housing Finance)**";
      specificStructure = `
      **Ref No:** {extract or NA}
      **Status:** {Positive/Negative}
      **To:** Mahindra Rural Housing Finance Limited
      
      **I. NAME & ADDRESS OF BORROWER:** ${project.clientName}
      **NAME & ADDRESS OF OWNER:** {extract}
      
      **II. DESCRIPTION OF THE PROPERTY:**
      {Title Opinion details, Plot No, Area, Survey No, Village, Taluka, District}
      **Boundaries:**
      East: {extract}
      West: {extract}
      South: {extract}
      North: {extract}

      **III. LIST OF DOCUMENTS SCRUTINIZED:**
      | Sr. No | Nature of Document (Original/Copy) | Document Dated | Parties to the Document | Document No. |
      |---|---|---|---|---|
      | 1 | {nature} | {date} | {parties} | {doc no} |

      **IV. FLOW OF TITLE TO THE SAID PROPERTY SINCE INCEPTION / ORIGIN:**
      {Point-wise flow of title, oldest to latest, with document details}

      **V. ENCUMBRANCE CERTIFICATE:**
      {Details of search conducted, period, receipts, and findings}

      **VI. Key Observations:**
      | Particulars | Remarks / Comments / Observations |
      |---|---|
      | a. Issues relating to Devolution of Title, Revenue Record | {details} |
      | b. Whether entire consideration passed to seller | {Yes/No} |
      | c. Whether Property is freehold/leasehold | {Freehold/Leasehold} |
      | d. Registrar of Companies Search | {NA/Details} |
      | e. Pending Litigation on the Property | {Yes/No} |
      | f. Present Possession of the Property | {details} |
      | g. Notification/reservations/approvals | {NA/Details} |
      | h. Use of land (Agri/Non-Agri) | {details} |
      | i. Non Agriculture Permission details | {details} |
      | j. Whether Enforcement of SARFESI ACT is applicable | {Yes/No} |
      | k. Minor's claim/share | {Yes/No} |
      | l. Construction related permissions | {details} |
      | m. Revenue/tenancy regulations | {details} |
      | n. Up to date tax paid | {Yes/No} |
      | o. Other adverse matters | {details} |

      **VII. MODE AND MANNER OF CREATING MORTGAGE:**
      {Details on how to create mortgage}

      **VIII. DOCUMENTS TO BE COLLECTED:**
      **A. Prior to disbursement:**
      | Sr. No | Nature of Document | Date | Parties | Original/Copy |
      |---|---|---|---|---|
      | 1 | {nature} | {date} | {parties} | {status} |

      **B. OTC:**
      {List}

      **C. Post disbursement:**
      {List}

      **IX. FINAL CERTIFICATE:**
      {Final certification of title and mortgageability}
      `;
      break;

    case "HDFC Format":
      mainTitle = "**HDFC BANK TITLE SEARCH REPORT (TSR)**";
      specificStructure = `
      **1. Property Details:**
      Property Address: ${project.propertyAddress}
      City/Village: {extract}
      Taluka/District: {extract}
      Survey / Gat No.: {extract}
      Area: {extract}

      **2. Owners Details:**
      Current Owner(s): {extract}
      Mode of Acquisition: {Sale Deed/Gift/Ancestral}
      Date of Document: {extract}

      **3. Documents Verified:**
      {List of documents: 7/12, Index II, Sale Deeds, Tax Receipts, etc.}

      **4. Title Flow Summary (Last 30 Years):**
      {Provide chain of ownership with dates and document references}

      **5. Encumbrance Certificate Findings:**
      Period Checked: {extract}
      Findings: {No encumbrances found / Details of encumbrances}

      **6. Legal Observations:**
      - {Observation 1}
      - {Observation 2}

      **7. Opinion on Title:**
      The title of the above-mentioned property is: {Clear and Marketable / Not Clear}

      **8. Requirements / Conditions for HDFC Loan:**
      - {Condition 1}
      - {Condition 2}

      **9. Documents Required Before Disbursement:**
      1. {Doc 1}
      2. {Doc 2}
      
      **10. Advocate Certification:**
      I hereby certify that I have personally inspected the documents...
      `;
      break;

    case "LSR Format":
      mainTitle = "**LEGAL SCRUTINY REPORT**";
      specificStructure = `
      **LAN No:** {extract or NA}
      **Date:** ${formattedDate}
      **To:** {Bank/Client Name}

      **PART I: PROPERTY DETAILS:**
      1. Name of the Applicant/Borrower/s: ${project.clientName}
      2. Name of the Co-applicant/s: {extract}
      3. Type of Loan: {extract}
      4. Purpose of Loan: {extract}
      5. Name of the Property Owner/s: {extract}
      6. Description of the Property (with Boundaries): {extract}
      7. Nature / Status of the Property: {extract}
      8. Type of Property: {extract}

      **PART II: LIST OF DOCUMENTS SUBMITTED:**
      {List of documents with Original/Xerox status}

      **PART III: FLOW OF TITLE OF PROPERTY: (HISTORY OF TITLE)**
      {Detailed history}

      **PART IV: EVIDENCE OF THE TITLE OF PROPERTY:**
      {Details of title evidence}

      **PART V: OTHER PROVISIONS:**
      5.1 Whether provisions of urban land ceiling act are applicable? {Yes/No}
      5.2 Whether subject to any minor's claim? {Yes/No}
      5.3 Whether affected by revenue and tenancy regulations? {Yes/No}
      5.4 Whether converted into Non-Agricultural? {Yes/No}
      5.5 Whether up to date tax paid? {Yes/No}
      5.6 Whether all documents for last 13/30 years scrutinized? {Yes/No}
      5.7 Whether required documents available for mortgage? {Yes/No}
      5.8 Whether previous owners had right to transfer? {Yes/No}
      5.9 Whether mortgage by deposit of title deeds possible? {Yes/No}
      5.10 Tenure of land (Leasehold/Freehold)? {details}
      5.11 Whether Adivasi (tribal) land? {Yes/No}
      5.12 Whether joint family property? {Yes/No}
      5.13 Whether SARFAESI Act applicable? {Yes/No}
      5.14 Is subject to reservations/acquisitions? {Yes/No}
      5.15 Whether transferred by POA? {Yes/No}
      5.16 Whether POA holder had authority? {Yes/No}
      5.17 Whether POA is registered? {Yes/No}
      5.18 Whether prior permission required to mortgage? {Yes/No}
      5.19 Whether permission required to sell? {Yes/No}
      5.20 Whether Search Report obtained? {Yes/No}
      5.21 Whether EC is obtained? {Yes/No}

      **PART VI: CERTIFICATE:**
      In view of the foregoing, I/We certify that the title deeds...
      I/We further certify that {Owner Name} has/would derive a valid, clear, marketable title...
      `;
      break;

    default:
      mainTitle = "**LEGAL SCRUTINY REPORT**";
      specificStructure = `
      **STRUCTURE:**
      1. **Property Details**: Owner, Address, Survey No., Area.
      2. **List of Documents**: Table of submitted documents.
      3. **Flow of Title**: History of ownership.
      4. **Search Report**: Search details and observations.
      5. **Opinion**: Final legal opinion.
      `;
      break;
  }

  return `
SYSTEM INSTRUCTION:
You are an expert legal AI assistant. Your task is to generate a professional Title Search Report based on the provided document context, STRICTLY following the requested format structure.

${governingRules}

**LOAN APPLICATION / SEARCH REQUEST DETAILS (HIGHEST AUTHORITY):**
- **Client/Applicant Name**: ${project.clientName || 'N/A'}
- **Target Property Description**: ${project.propertyAddress || 'N/A'}
- **Search Period**: ${project.searchPeriod || 'Not Specified'}
- **Date**: ${formattedDate}
- **Advocate Instructions**: ${advocateInstructions || 'None'}

**REQUIRED FORMAT: ${reportFormat}**
${baseInstruction}

${mainTitle}
${specificStructure}

**DOCUMENT CONTEXT:**
${retrievedContext}

**OUTPUT:**
Generate the full report in valid Markdown. Ensure all tables are correctly formatted. **ENSURE ALL OUTPUT IS IN ENGLISH.**
`;
};

export const generateReport = async (userId: string | null, project: Project, user: User, reportFormat: string, estimatedInputTokens: number, estimatedOutputTokens: number, apiEndpointType: string = 'generateReport'): Promise<Partial<Report> & { error?: string }> => {
  let result: Partial<Report> & { error?: string } = {};
  let success = false;
  let errorMessage: string | undefined;
  let actualPromptTokens = 0;
  let actualCompletionTokens = 0;

  try {
    const aggregatedText = project.documents
        .filter(doc => doc.status === 'Processed' && doc.extractedText)
        .map(doc => `--- Document: ${doc.fileName} ---\n${doc.extractedText}`)
        .join('\n\n');

    if (!aggregatedText) {
        return { error: "No processed documents found to generate report." };
    }

    const ragPrompt = generateRAGPrompt(project, aggregatedText, user, reportFormat, project.advocateInstructions);
    actualPromptTokens = estimateTokens(ragPrompt);

    // Using gemini-2.5-pro for Report Generation to save cost over 3.0-pro-preview
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [{ text: ragPrompt }],
        config: {
            systemInstruction: "You are an expert legal AI assistant. Generate the report and associated metadata in JSON format. The 'content' field must contain the full report in Markdown with tables. OUTPUT MUST BE IN ENGLISH. TRANSLATE ANY MARATHI TEXT.",
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    content: { type: Type.STRING, description: "The full report in Markdown format, containing Markdown tables for structured data. ALL TEXT MUST BE IN ENGLISH." },
                    summary: { type: Type.STRING, description: "Executive summary of the title status." },
                    strCategory: { type: Type.STRING, description: "Category: Clear, Moderate Risk, or High Risk." },
                    riskFlags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of compliance red flags." }
                },
                required: ["content", "summary", "strCategory", "riskFlags"]
            }
        }
    });

    const jsonText = response.text?.trim();
    actualCompletionTokens = estimateTokens(jsonText);

    if (jsonText) {
        try {
            result = JSON.parse(jsonText);
            success = true;
        } catch (e: any) {
            console.error("JSON parse error in generateReport", e);
            result = { error: "Failed to parse AI response." };
            errorMessage = e.message;
        }
    } else {
        result = { error: "Empty response from AI." };
        errorMessage = "Empty response";
    }

  } catch (error: any) {
     const errMessage = error.toString();
     if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXCEEDED')) {
         result = { error: RATE_LIMIT_EXCEEDED };
         errorMessage = 'Rate limit exceeded';
     } else {
         result = { error: errMessage };
         errorMessage = errMessage;
     }
  } finally {
     await logAiCall(userId, 'gemini-2.5-pro', apiEndpointType, actualPromptTokens || estimatedInputTokens, actualCompletionTokens || estimatedOutputTokens, success, errorMessage);
  }

  return result;
};

export const reformatReport = async (userId: string | null, inputReportContent: string, targetFormat: string, advocateInstructions?: string, estimatedInputTokens: number = 0, estimatedOutputTokens: number = 0, apiEndpointType: string = 'reformatReport'): Promise<Partial<Report> & { error?: string }> => {
  let result: Partial<Report> & { error?: string } = {};
  let success = false;
  let errorMessage: string | undefined;
  let actualPromptTokens: number = 0;
  let actualCompletionTokens: number = 0;

  try {
    if (!inputReportContent.trim()) {
      result = { error: "No content provided for re-formatting." };
      success = true;
      await logAiCall(userId, 'N/A', apiEndpointType, estimatedInputTokens, estimatedOutputTokens, success, errorMessage);
      return result;
    }

    const dummyProject: Project = {
      id: 'dummy', projectName: '', propertyAddress: '', clientName: '', searchPeriod: '',
      createdAt: new Date().toISOString(), documents: [], report: null, scenario: 'UNKNOWN',
      missingDocuments: [],
      advocateInstructions: advocateInstructions || '',
    };
    const dummyUser: User = { id: 'dummy', name: '', email: '', firmName: '' };
    dummyProject.report = {
      id: 'dummy',
      projectId: 'dummy',
      generatedAt: new Date().toISOString(),
      status: 'Draft',
      content: '',
      riskFlags: ['Dummy risk flag 1', 'Dummy risk flag 2'],
      ruleEngineFlags: {},
      reportFormatUsed: targetFormat,
    };

    const reformatPrompt = `
        SYSTEM INSTRUCTION:
        You are an expert legal AI assistant. Your task is to take the provided "EXISTING REPORT CONTENT" and meticulously re-structure it to fit the "TARGET REPORT FORMAT".
        
        **CRITICAL INSTRUCTION: The final report MUST be in ENGLISH. If the input content contains non-English text (e.g. Marathi), TRANSLATE it to professional legal English.**

        TARGET REPORT FORMAT INSTRUCTIONS:
        ${generateRAGPrompt(dummyProject, '', dummyUser, targetFormat, advocateInstructions)}

        EXISTING REPORT CONTENT:
        ---
        ${inputReportContent.substring(0, 30000)}
        ---

        Generate the reformatted report content in Markdown following the TARGET REPORT FORMAT. 
        Ensure all lists and structured data (like list of documents, history) are converted into Markdown Tables.
        `;
    actualPromptTokens = estimateTokens(reformatPrompt);

    // Using gemini-2.5-flash for Reformatting as per architecture requirements (Drafting/Formatting)
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ text: reformatPrompt }],
      config: {
        systemInstruction: `You are an expert legal AI assistant. Your task is to reformat the provided legal report content into the requested format while preserving all factual details. Output MUST be in Markdown with Tables and in ENGLISH.`,
      },
    });

    const resultText = response.text?.trim();
    actualCompletionTokens = estimateTokens(resultText);

    if (!resultText) {
      console.error("Gemini returned an empty response for report reformatting.");
      result = { error: "Empty response from AI." };
      errorMessage = "Empty response from AI.";
    } else {
      result = { content: resultText };
      success = true;
    }

  } catch (error: any) {
    const errMessage = error.toString();
    if (errMessage.includes('429') || errMessage.includes('RESOURCE_EXCEEDED')) {
      console.warn("Gemini API rate limit exceeded during report re-formatting. The operation will be retried automatically.");
      result = { error: RATE_LIMIT_EXCEEDED };
      errorMessage = 'Rate limit exceeded';
    } else {
      console.error("Error reformatting report with Gemini:", error);
      result = { error: `Failed to reformat report: ${errMessage}` };
      errorMessage = errMessage;
    }
  } finally {
    await logAiCall(userId, 'gemini-2.5-flash', apiEndpointType, actualPromptTokens || estimatedInputTokens, actualCompletionTokens || estimatedOutputTokens, success, errorMessage);
  }
  return result;
};
