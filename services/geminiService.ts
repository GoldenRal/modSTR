import { GoogleGenAI, Part, Type, GenerateContentResponse } from "@google/genai";
import { Project, User, Scenario, ProjectDetails, Report } from '../types';
import { SCENARIOS } from '../constants';
import { supabase } from '../supabaseClient';

const fileToGenerativePart = async (file: File): Promise<Part> => {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { inlineData: { data: base64Data, mimeType: file.type } };
};

export const UNSUPPORTED_FOR_EXTRACTION = 'UNSUPPORTED_FOR_EXTRACTION';
export const RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED';

const estimateTokens = (text?: string): number => text ? Math.ceil(text.length / 4) : 0;

const logAiCall = async (userId: string | null, model: string, type: string, pTokens: number, cTokens: number, success: boolean, err?: string) => {
  if (!userId) return;
  const total = pTokens + cTokens;
  const today = new Date().toISOString().split('T')[0];
  try {
    await supabase.from('ai_usage').insert([{ 
        user_id: userId, 
        model, 
        prompt_tokens: pTokens, 
        completion_tokens: cTokens, 
        total_tokens: total, 
        success, 
        error_message: err, 
        api_endpoint_type: type 
    }]);

    if (success) {
      const { data: dailyData } = await supabase.from('daily_usage').select('*').eq('user_id', userId).eq('day', today).single();
      const strInc = type === 'generateReport' ? 1 : 0;
      
      await supabase.from('daily_usage').upsert({
        user_id: userId, 
        day: today, 
        str_count: (dailyData?.str_count || 0) + strInc, 
        input_tokens: (dailyData?.input_tokens || 0) + pTokens, 
        output_tokens: (dailyData?.output_tokens || 0) + cTokens, 
        total_bytes: 0
      }, { onConflict: 'user_id,day' });
      
      const { data: limits } = await supabase.from('api_limits').select('*').eq('user_id', userId).single();
      if (limits) {
        await supabase.from('api_limits').update({
          strs_used_monthly: (limits.strs_used_monthly || 0) + strInc,
          input_tokens_used_monthly: (limits.input_tokens_used_monthly || 0) + pTokens,
          output_tokens_used_monthly: (limits.output_tokens_used_monthly || 0) + cTokens,
        }).eq('user_id', userId);
      }
    }
  } catch (e) { 
    console.error("Critical Logging Error:", e); 
  }
};

/**
 * Tasks below use Gemini 2.5 Flash
 */

export const extractTextFromFile = async (userId: string | null, file: File): Promise<string> => {
  const supported = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/heic', 'image/heif'];
  if (!supported.includes(file.type)) return UNSUPPORTED_FOR_EXTRACTION;
  
  let success = false, errM, pt = 0, ct = 0;
  const modelName = 'gemini-2.5-flash';
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const part = await fileToGenerativePart(file);
    const prompt = "Extract all text from this legal document. Preserve formatting and identify dates and parties clearly.";
    pt = estimateTokens(prompt);
    const res: GenerateContentResponse = await ai.models.generateContent({ model: modelName, contents: { parts: [part, { text: prompt }] } });
    const txt = res.text?.trim() || '';
    if (!txt) throw new Error("Empty AI response");
    ct = estimateTokens(txt);
    success = true;
    return txt;
  } catch (e: any) {
    errM = e.toString();
    if (errM.includes('429')) return RATE_LIMIT_EXCEEDED;
    return "Error: " + errM;
  } finally {
    await logAiCall(userId, modelName, 'extractTextFromFile', pt, ct, success, errM);
  }
};

export const classifyDocument = async (userId: string | null, text: string): Promise<string> => {
  const types = ['Sale Deed', 'Mutation Entry', 'Loan Agreement', 'Property Tax Receipt', 'Encumbrance Certificate', 'NA Order', '7/12 Extract', 'Lease Deed', 'Agreement for Sale', 'Other'].join(', ');
  let success = false, errM, pt = 0, ct = 0;
  const modelName = 'gemini-2.5-flash';
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Classify this document text into exactly one of: ${types}. Return ONLY the type name.\n\nTEXT:\n${text.substring(0, 2000)}`;
    pt = estimateTokens(prompt);
    const res: GenerateContentResponse = await ai.models.generateContent({ model: modelName, contents: prompt });
    const cls = res.text?.trim() || 'Other';
    ct = estimateTokens(cls);
    success = true;
    return cls;
  } catch (e: any) {
    errM = e.toString();
    return e.message.includes('429') ? RATE_LIMIT_EXCEEDED : 'Other';
  } finally {
    await logAiCall(userId, modelName, 'classifyDocument', pt, ct, success, errM);
  }
};

export const extractProjectDetailsAndScenario = async (userId: string | null, text: string, instr: string = ''): Promise<Partial<ProjectDetails> | string> => {
  let success = false, errM, pt = 0, ct = 0;
  const modelName = 'gemini-2.5-flash';
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Extract details from these legal documents. Return JSON.
Available Scenarios: ${Object.keys(SCENARIOS).join(', ')}
Requirements: Project Name, Property Address, Client Name, Search Period, Scenario (enum). Translate to English.
${instr ? `Advocate overrides for details: ${instr}` : ''}
TEXT: ${text.substring(0, 20000)}`;
    pt = estimateTokens(prompt);
    const res: GenerateContentResponse = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            projectName: { type: Type.STRING },
            propertyAddress: { type: Type.STRING },
            clientName: { type: Type.STRING },
            searchPeriod: { type: Type.STRING },
            scenario: { type: Type.STRING, enum: Object.keys(SCENARIOS) }
          },
          required: ["projectName", "propertyAddress", "clientName", "searchPeriod", "scenario"]
        }
      }
    });
    const parsed = JSON.parse(res.text || '{}');
    ct = estimateTokens(res.text);
    success = true;
    return parsed;
  } catch (e: any) {
    errM = e.toString();
    return errM.includes('429') ? RATE_LIMIT_EXCEEDED : {};
  } finally {
    await logAiCall(userId, modelName, 'extractProjectDetails', pt, ct, success, errM);
  }
};

/**
 * Report Generation using Gemini 2.5 Pro (The Hard Rule)
 */

const getStructureForFormat = (format: string, project: Project): string => {
  switch (format) {
    case "Advocate Standard Format":
      return `
      **LEGAL SCRUTINY REPORT**
      **PART I:** (Applicant Name, App ID, Case Type, Proposed Owner)
      **PART II: SCHEDULE OF PROPERTY:** (Complete description of Plot No, Area, Gat/Survey No, Village, Boundaries: East, West, South, North)
      **PART III: LIST OF DOCUMENTS PERUSED:** (Markdown Table: S.No, Date, Description, Doc No, Parties, Reference File Name. MUST BE CHRONOLOGICAL ASCENDING.)
      **PART IV: FLOW OF TITLE:** (Chronological synthesis of all information across all uploaded documents, detailing every transaction and record from origin.)
      **PART V: ENCUMBRANCE:** (Period of search and findings)
      **PART VI: OTHER PROVISIONS:** (Specific questions 1-18 regarding NA conversion, mortgageability, minor claims, SARFAESI, etc.)
      **PART VII: OTHER REMARKS:** (NIL or specified)
      **PART VIII: CERTIFICATE:** (Title validity and mortgageability certification)
      **PART IX: LIST OF DOCUMENTS TO BE COLLECTED FOR CHARGE CREATION:** (Markdown Table)
      `;
    case "Bajaj Finance Format":
      return `
      **TITLE SEARCH REPORT**
      **To: The Credit Manager, Bajaj Housing Finance Ltd.**
      1] Nature of Transaction: {extract}
      2] Name of the Borrower: ${project.clientName}
      3] Name of the Owner: {extract}
      4] Payment to be made in: {extract}
      5] Description of the Property/Properties: (Include Table with collective boundaries)
      7] Nature of Property: (Free Hold & NA Land)
      8] Document Given for Inspection: (Markdown Table: Sr.No, Nature of Document, Parties, Date/Year, Original/Certified, Reference File Name. SORT CHRONOLOGICALLY ASCENDING.)
      9] Documents Examined but not physically received from customer: (Markdown Table)
      10] General Information:
      11] Legal intervention/issues:
      12] Step/Document prior to disbursement of loan:
      13] Opinion: (Valid, absolute, clear and marketable title statement)
      14] Documents must require for creation of security:
      15] Documents required post disbursal:
      **Final Particulars Table:** (Markdown table for Yes/No details: title clear?, Equitable mortgage possible?, Minor's rights?, ULC impact?, Wakf/Trust issues?, Stamp duty paid?, Leasehold?)
      `;
    case "JM Financial Format":
      return `
      **Investigation Report & Title Certificate**
      **To: JMFHLL JM Financial Home Loans Limited**
      Date: {today}, Status: {POSITIVE/NEGATIVE}, Transaction Type: {extract}
      1. Name of the Borrower(s), Co-Borrower(s): ${project.clientName}
      2. Name of the Owner(s) of the property: {extract}
      3. Constitution of the Owner: {extract}
      4. Full description of the property investigated: (Plot, Survey, Boundaries, area)
      5. List with details of Title Deeds/documents scrutinized: (Markdown Table: Sr.no, Name of document, From, To, Date, Identification Number, Parties, Reference File Name. SORT CHRONOLOGICALLY ASCENDING.)
      6. Tracing of title and investigation of title: (Comprehensive history for 13 years synthesized from ALL provided document records.)
      7. Prohibited Property List check:
      8. Additional document required:
      9. Particulars of tax/revenue receipts:
      10. Particulars of Encumbrance Certificate:
      11. Particulars of any charges/encumbrances:
      12. Leasehold/Freehold status:
      13. Permission/NOC from Society/Builder:
      14. Minor's Interest:
      15. Land category: (Agricultural/Non-agricultural)
      16. Application of RERA, ULC, Tenancy, SARFAESI:
      17. Latest mutation record status:
      18. List of original title documents required for mortgage: (Markdown Table: Sr.no, Name of document, Parties, Date, Reference File Name. SORT CHRONOLOGICALLY ASCENDING.)
      19. Form of Mortgage: (Simple/Equitable)
      `;
    case "Mahindra Rural Format":
      return `
      **Title Scrutiny Report**
      **To: Mahindra Rural Housing Finance Limited (“MRHFL”)**
      Application No: {extract}, Case Type: {extract}, Status: {Positive/Negative}
      I. NAME & ADDRESS OF BORROWER/APPLICANTS: ${project.clientName}
      NAME & ADDRESS OF OWNER OF THE PROPERTY: {extract}
      II. DESCRIPTION OF THE PROPERTY: (Plot No, Gut No, Area, Boundaries)
      III. LIST OF DOCUMENTS SCRUTINIZED: (Markdown Table: Sr.No, Nature of Document, Document Dated, Parties to Document, Document No, Reference File Name. SORT CHRONOLOGICALLY ASCENDING.)
      IV. FLOW OF TITLE TO THE SAID PROPERTY SINCE INCEPTION/ORIGIN: (Point-wise history from earliest inception including ALL records and transactions found in documents.)
      V. ENCUMBRANCE CERTIFICATE: (Period 2013-2025, Receipt details, findings)
      VI. Key Observations Table: (Markdown table for points a to o: Devolution of Title, Consideration, Freehold/Leasehold, Registrar search, Pending Litigation, Possession, Notification/Approvals, Land Use, NA Permission, SARFAESI, Minor's claim, Construction permissions, Revenue/caste reservations, Tax, Other adverse matters.)
      VII. MODE AND MANNER OF CREATING MORTGAGE:
      VIII. FINAL CERTIFICATE: (Absolute owner statement, unassailable and marketable title statement)
      `;
    case "HDFC Format":
      return `
      **HDFC BANK - TITLE SEARCH REPORT (TSR)**
      1. Property Details: (Address, City, Taluka, Survey/Gat, Area)
      2. Owners Details: (Current Owners, Mode of Acquisition, Date of Document)
      3. Documents Verified: (Numbered list with Dates, Parties involved, and Reference File Name. MUST BE CHRONOLOGICAL ASCENDING.)
      4. Title Flow Summary (Last 30 Years): (Comprehensive chain of ownership synthesized from all document dates and references.)
      5. Encumbrance Certificate Findings: (Period Checked, Findings)
      6. Legal Observations:
      7. Opinion on Title: (Clear and Marketable or Not)
      8. Requirements / Conditions for HDFC Loan:
      9. Documents Required Before Disbursement:
      10. Advocate Certification: (Standard certification text)
      `;
    case "LSR Format":
      return `
      **LEGAL SCRUTINY REPORT**
      **PART I: PROPERTY DETAILS:** (1. Applicant, 2. Co-applicant, 3. Loan Type, 4. Purpose, 5. Owner, 6. Description/Boundaries, 7. Nature/Status, 8. Type of Property)
      **PART II: LIST OF DOCUMENTS SUBMITTED:** (Markdown list: S.No, Date, Nature of Document, Parties, Reference File Name. SORT CHRONOLOGICALLY ASCENDING.)
      **PART III: FLOW OF TITLE OF PROPERTY:** (History of Title: Comprehensive chronological narrative considering all records and transactions in perused documents.)
      **PART IV: EVIDENCE OF THE TITLE OF PROPERTY:**
      **PART V: OTHER PROVISIONS:** (Sub-points 5.1 to 5.21 detailing ULC, minor's share, revenue regs, NA conversion, Tax paid, Scrutiny years, Mortgage possibility, Tenure, Tribal land, SARFAESI, POA status, Search/EC details.)
      **PART VI: CERTIFICATE:** (Final certification of perfect evidence of title and mortgageability)
      `;
    default:
      return `Standard structure including Property Details, comprehensive Flow of Title, Documents List (Chronological Table), and final Opinion.`;
  }
};

export const generateReport = async (userId: string | null, project: Project, user: User, format: string): Promise<Partial<Report> & { error?: string }> => {
  const processedDocs = project.documents.filter(d => d.status === 'Processed' && d.extractedText);
  const aggregated = processedDocs.map(d => `--- FILE: ${d.fileName} ---\n${d.extractedText}`).join('\n\n');
  
  if (!aggregated) return { error: "No context found from processed documents." };
  
  let success = false, errM, pt = 0, ct = 0;
  const modelName = 'gemini-2.5-pro';

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const structure = getStructureForFormat(format, project);
    
    const prompt = `
      SYSTEM INSTRUCTION:
      You are an expert legal AI architect. Your task is to generate a professional Title Search Report strictly in the ${format} format.
      
      **STRICT REQUIREMENTS:**
      1. **STRUCTURE**: Adhere exactly to the headings and numbering provided in the FORMAT STRUCTURE section.
      2. **NO OVERRIDES**: Advocate instructions MUST NOT change the structural heads or layout.
      3. **CHRONOLOGICAL LISTS**: Every "List of Documents" section MUST be in strictly ascending chronological order (oldest to newest).
      4. **DOCUMENT DETAILS**: In lists/tables, include 'Parties involved' and the 'Reference uploaded document name' (from the context headers).
      5. **FLOW OF TITLE SYNTHESIS**: The "Flow of Title" or "Tracing" section MUST be a comprehensive synthesis of all ownership history, records, transactions, and authorized document references found across ALL uploaded documents. Form a cohesive narrative frominception to date.
      6. **ADVOCATE INSTRUCTIONS**: Use instructions exclusively to refine factual details (e.g. party names, boundary corrections, specific case references) within the sub-heads.
      7. **LANGUAGE**: Output MUST be in English. Translate any Marathi text from documents into professional legal English.
      8. **MARKDOWN**: Use Markdown for headers, bolding, and tables.

      **FORMAT STRUCTURE FOR ${format}:**
      ${structure}

      **ADVOCATE FACTUAL OVERRIDES/CLARIFICATIONS:** ${project.advocateInstructions || 'None'}

      **DOCUMENT CONTEXT FOR EXTRACTION:**
      ${aggregated.substring(0, 30000)}
    `;

    pt = estimateTokens(prompt);
    
    const res: GenerateContentResponse = await ai.models.generateContent({
      model: modelName,
      contents: { parts: [{ text: prompt }] },
      config: {
        thinkingConfig: { thinkingBudget: 16384 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING, description: "Full report content in Markdown with Tables, following the bank structure exactly." },
            summary: { type: Type.STRING, description: "Concise executive summary of title findings." },
            strCategory: { type: Type.STRING, description: "Classification category (e.g. NA Plot, Inherited)." },
            riskFlags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific Red Flags identified during review." }
          },
          required: ["content", "summary", "strCategory", "riskFlags"]
        }
      }
    });

    const result = JSON.parse(res.text || '{}');
    ct = estimateTokens(res.text);
    success = true;
    return result;
  } catch (e: any) {
    errM = e.toString();
    return { error: errM.includes('429') ? RATE_LIMIT_EXCEEDED : errM };
  } finally {
    await logAiCall(userId, modelName, 'generateReport', pt, ct, success, errM);
  }
};
