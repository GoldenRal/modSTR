import React, { useState, useEffect, useCallback, useRef } from 'react';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import SignUpScreen from './components/SignUpScreen'; // Import new SignUpScreen
import { ProjectView } from './components/ProjectView';
import Header from './components/ui/Header';
import Toast from './components/ui/Toast';
import { User, Project, Document, ProjectDetails, Scenario, Plan, ApiLimits } from './types'; // Removed BillingRecord import
import { SCENARIO_BASED_DOCUMENTS, SCENARIOS } from './constants';
import { classifyDocument, extractTextFromFile, UNSUPPORTED_FOR_EXTRACTION, RATE_LIMIT_EXCEEDED, extractProjectDetailsAndScenario, analyzeDocumentCompleteness } from './services/geminiService';
import { supabase } from './supabaseClient'; // Import supabase client
import DocumentTextViewModal from './components/ui/DocumentTextViewModal'; // Corrected import path

// The queue will hold items that need to be processed by the AI.
interface ProcessingQueueItem {
  projectId: string;
  documentId: string;
  file: File;
}

const PROCESS_SUCCESS = 'SUCCESS';
const PROCESS_ERROR = 'ERROR';
const PROCESS_RATE_LIMITED = 'RATE_LIMITED';
const STORAGE_KEY = 'legalAiProjects';

// Helper function to extract a meaningful message from any error type
function getErrorString(e: any): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as any).message);
  }
  return String(e); // Fallback for unexpected error types
}

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null); // Initialize user to null
  const [userPlan, setUserPlan] = useState<Plan | null>(null); // New state for user's plan details
  const [userApiLimits, setUserApiLimits] = useState<ApiLimits | null>(null); // New state for user's API usage limits
  // REMOVED: const [userBillingHistory, setUserBillingHistory] = useState<BillingRecord[] | null>(null); 
  const [isSignUpMode, setIsSignUpMode] = useState(false); // New state to toggle between login and signup

  // Toast state for global app errors (like storage failure)
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'info' | 'success' | 'error' }>({ 
    show: false, message: '', type: 'info' 
  });

  // Track the last date we fetched limits to enable auto-refresh on day change
  const lastFetchDateRef = useRef<string>(new Date().toISOString().split('T')[0]);

  const [projects, setProjects] = useState<Project[]>(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (!savedData) return [];

    let parsedData: any;
    try {
        parsedData = JSON.parse(savedData);
    } catch (e) {
        console.error('Failed to parse projects from localStorage. Data might be corrupt.', e);
        return []; // Data is unrecoverable, start fresh.
    }

    if (!Array.isArray(parsedData)) {
        console.warn('Stored project data was not an array, resetting projects.');
        return [];
    }

    // Use a robust reducer to safely load projects, skipping any malformed entries
    // without crashing or wiping the entire dataset.
    const loadedProjects = parsedData.reduce((acc: Project[], project: any) => {
        // 1. Validate the project entry itself
        if (!project || typeof project !== 'object' || !project.id) {
            console.warn('Skipping malformed project entry in localStorage:', project);
            return acc;
        }

        try {
            // 2. Safely process documents within the valid project
            const documents = Array.isArray(project.documents) ? project.documents : [];
            const updatedDocuments = documents
                .filter(doc => doc && typeof doc === 'object' && doc.id) // Filter out null/malformed docs
                .map(doc => {
                    // Migration: Handle legacy docType string to docTypes array
                    // @ts-ignore
                    const legacyType = doc.docType;
                    // Ensure doc.docTypes is an array before attempting to spread or modify it
                    const currentTypes = Array.isArray(doc.docTypes) ? doc.docTypes : [];
                    const finalTypes = legacyType && !currentTypes.includes(legacyType) 
                        ? [...currentTypes, legacyType] 
                        : currentTypes;

                    const newDoc = { ...doc, docTypes: finalTypes };
                    // @ts-ignore
                    delete newDoc.docType; // Safely remove legacy field from the new object

                    // Clean up statuses for documents that were in-flight
                    const transientStatuses: Document['status'][] = ['Uploading', 'Uploaded', 'Extracting Text', 'Classifying'];
                    if (transientStatuses.includes(newDoc.status)) {
                        return {
                            ...newDoc,
                            status: 'Error' as const,
                            error: 'Processing was interrupted. Please re-upload.',
                            progress: 0,
                        };
                    }
                    return newDoc;
                });
            
            // 3. Add the successfully processed project to the list
            acc.push({ 
                ...project, 
                documents: updatedDocuments,
                projectName: project.projectName || 'Unnamed Project', // Ensure essential fields have fallbacks
                propertyAddress: project.propertyAddress || 'Not Provided',
                clientName: project.clientName || 'Not Provided',
                searchPeriod: project.searchPeriod || 'Not Provided',
                scenario: project.scenario && SCENARIOS[project.scenario] ? project.scenario : 'UNKNOWN' as Scenario, // Validate scenario
                report: project.report || null,
                advocateInstructions: project.advocateInstructions || '', // Initialize with empty string if not present
            });
        } catch (e) {
            // If an error occurs processing this specific project, skip it but keep the others.
            console.error(`Failed to process project ${project.id} from storage, skipping:`, e);
        }
        
        return acc;
    }, []);

    return loadedProjects;
  });
  
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // State for the document processing queue system
  const [processingQueue, setProcessingQueue] = useState<ProcessingQueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fix: Initialize useState correctly for Set<string>
  // State to track which projects are currently having details extracted to prevent race conditions
  const [isExtractingFor, setIsExtractingFor] = useState<Set<string>>(new Set());

  // Function to fetch user's plan and API limits
  const fetchUserPlanAndLimits = useCallback(async (userId: string) => {
    try {
      // Update the ref to current UTC date
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      lastFetchDateRef.current = todayStr;

      // Fetch api_limits for the user
      const { data: apiLimitsData, error: apiLimitsError } = await supabase
        .from('api_limits')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (apiLimitsError && apiLimitsError.code !== 'PGRST116') { // PGRST116 means no rows found (expected for new users who just signed up, or old users with no limits record)
        throw apiLimitsError;
      }

      let currentApiLimits: ApiLimits | null = null;
      let currentPlan: Plan | null = null;
      let dailyStrsUsed: number = 0; // Initialize daily usage

      if (apiLimitsData) {
        currentApiLimits = apiLimitsData as ApiLimits;

        // Fetch plan details based on plan_id from api_limits
        const { data: planData, error: planError } = await supabase
          .from('plans')
          .select('*')
          .eq('id', currentApiLimits.plan_id)
          .single();

        if (planError) {
          throw planError;
        }
        currentPlan = planData as Plan;

        // NEW LIMITS FEATURE: Client-side monthly usage reset logic
        const resetDate = new Date(currentApiLimits.reset_date);
        
        if (today.getMonth() !== resetDate.getMonth() || today.getFullYear() !== resetDate.getFullYear()) {
          console.log(`Monthly limits reset for user ${userId}. Old reset date: ${currentApiLimits.reset_date}`);
          currentApiLimits = {
            ...currentApiLimits,
            input_tokens_used_monthly: 0,
            output_tokens_used_monthly: 0,
            strs_used_monthly: 0,
            reset_date: todayStr,
          };
          // Attempt to update reset date in DB (requires 'update_own_api_limits_reset' RLS policy)
          const { error: updateResetError } = await supabase
            .from('api_limits')
            .update({
              input_tokens_used_monthly: 0,
              output_tokens_used_monthly: 0,
              strs_used_monthly: 0,
              reset_date: currentApiLimits.reset_date,
            })
            .eq('user_id', userId);
          
          if (updateResetError) {
            console.error('Error updating API limits reset date in DB:', updateResetError.message);
            setToast({ show: true, message: `Failed to reset monthly usage in DB: ${updateResetError.message}.`, type: 'error' });
          } else {
            setToast({ show: true, message: 'Monthly API usage has been reset!', type: 'info' });
          }
        }

        // Fetch daily STR count for current day
        const { data: dailyUsageData, error: dailyUsageError } = await supabase
            .from('daily_usage')
            .select('str_count')
            .eq('user_id', userId)
            .eq('day', todayStr)
            .single();

        if (dailyUsageError && dailyUsageError.code !== 'PGRST116') {
            console.error('Error fetching daily usage for plan limits:', dailyUsageError.message);
        } else {
            dailyStrsUsed = dailyUsageData?.str_count || 0;
        }

      } else {
        // If no api_limits record exists, create a default one (e.g., 'Basic' plan)
        // This path is primarily for existing users who might not have an api_limits entry
        // or if a signup failed to create one. New sign-ups with plan selection should
        // already have an entry by this point.
        console.warn(`No API limits found for user ${userId}. Attempting to assign default 'Basic' plan.`);
        const { data: defaultPlanData, error: defaultPlanError } = await supabase
          .from('plans')
          .select('*')
          .eq('name', 'Basic') // Or retrieve plan with ID 1
          .single();

        if (defaultPlanError) {
          throw defaultPlanError;
        }
        currentPlan = defaultPlanData as Plan;
        
        // NEW LIMITS FEATURE: Initialize all new usage counters to 0
        const newApiLimits: ApiLimits = {
            user_id: userId,
            plan_id: currentPlan.id,
            monthly_limit: currentPlan.monthly_limit, // General limit
            used: 0, // Old general usage
            input_tokens_used_monthly: 0, // NEW
            output_tokens_used_monthly: 0, // NEW
            strs_used_monthly: 0, // NEW
            reset_date: todayStr, // Current date as reset date
        };

        // Insert this default into api_limits table. Requires 'insert_own_api_limits' RLS policy.
        const { error: insertLimitsError } = await supabase
            .from('api_limits')
            .insert([newApiLimits]);

        if (insertLimitsError) {
            console.error('Error inserting default API limits:', insertLimitsError.message);
            setToast({ show: true, message: `Account created, but failed to assign plan: ${insertLimitsError.message}. Please contact support.`, type: 'error' });
            // Continue with default values, but don't persist them to DB if insertion failed
            currentApiLimits = newApiLimits; // Use the constructed newApiLimits for client-side state
        } else {
            console.log(`Default 'Basic' plan assigned and API limits created for user ${userId}.`);
            currentApiLimits = newApiLimits; // Use the newly inserted limits
        }
      }
      
      setUserPlan(currentPlan);
      setUserApiLimits(currentApiLimits);

      setUser(prevUser => {
        if (!prevUser || !currentPlan || !currentApiLimits) return prevUser;
        return {
            ...prevUser,
            planName: currentPlan.name,
            monthlyAllowance: currentPlan.monthly_limit, // Using plan's general monthly_limit
            // NEW LIMITS FEATURE: Update user with granular limits and usage
            strsUsedMonthly: currentApiLimits.strs_used_monthly,
            maxStrsMonthly: currentPlan.max_strs_per_month,
            inputTokensUsedMonthly: currentApiLimits.input_tokens_used_monthly,
            maxInputTokensMonthly: currentPlan.max_input_tokens_per_month,
            outputTokensUsedMonthly: currentApiLimits.output_tokens_used_monthly,
            maxOutputTokensMonthly: currentPlan.max_output_tokens_per_month,
            maxFileSizeDocMB: currentPlan.max_file_size_mb_per_document,
            maxTotalUploadMB: currentPlan.max_total_upload_mb_per_str,
            dailyStrsUsed: dailyStrsUsed, // Set daily usage from fetch
            maxStrsDaily: currentPlan.max_strs_per_day, // Set daily limit from plan
        };
      });

    } catch (error: any) {
      const errorMsg = getErrorString(error);
      console.error("Error fetching user plan and limits:", errorMsg, error);
      setToast({ show: true, message: `Failed to load plan: ${errorMsg || 'Unknown error. Please check console.'}`, type: 'error' });
    }
  }, []); // Empty dependency array for useCallback

  // Effect to automatically refresh usage limits if the calendar day changes (UTC midnight)
  useEffect(() => {
    if (!user) return;
    
    // Check every minute if the date has changed
    const intervalId = setInterval(() => {
      const currentUtcDate = new Date().toISOString().split('T')[0];
      if (currentUtcDate !== lastFetchDateRef.current) {
        console.log("Day changed (UTC), refreshing user limits...");
        fetchUserPlanAndLimits(user.id);
      }
    }, 60000); // 1 minute interval

    return () => clearInterval(intervalId);
  }, [user, fetchUserPlanAndLimits]);

  useEffect(() => {
    // Check for an existing session on app load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const currentUser: User = {
          id: session.user.id,
          email: session.user.email || 'N/A',
          name: session.user.user_metadata?.full_name || session.user.email || 'Guest', // Use optional chaining
          firmName: session.user.user_metadata?.firm_name || 'LegalAI User', // Use optional chaining
        };
        setUser(currentUser);
        fetchUserPlanAndLimits(currentUser.id); // Fetch plan details after setting user
      }
    }).catch(error => {
      const errorMsg = getErrorString(error);
      console.error("Supabase session check failed:", errorMsg, error);
      setToast({ show: true, message: `Failed to check login status: ${errorMsg || 'Network error.'}`, type: 'error' });
    });

    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const currentUser: User = {
            id: session.user.id,
            email: session.user.email || 'N/A',
            name: session.user.user_metadata?.full_name || session.user.email || 'Guest', // Use optional chaining
            firmName: session.user.user_metadata?.firm_name || 'LegalAI User', // Use optional chaining
          };
          setUser(currentUser);
          fetchUserPlanAndLimits(currentUser.id); // Fetch plan details after setting user
          setToast({ show: true, message: 'Logged in successfully!', type: 'success' });
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setUserPlan(null); // Clear plan details on logout
          setUserApiLimits(null); // Clear API limits on logout
          setSelectedProjectId(null); // Clear selected project on logout
          setToast({ show: true, message: 'Logged out successfully.', type: 'info' });
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [fetchUserPlanAndLimits]);

  useEffect(() => {
    // Persist projects to local storage whenever they change
    try {
       const projectsForStorage = projects.map(project => {
        // Create a new object without the non-serializable 'file' property
        // @ts-ignore - file might not exist on project type explicitly but helps safety
        const { file: _pF, ...projectWithoutFile } = project;
        
        const documentsForStorage = project.documents.map(doc => {
          const { file: _dF, ...docWithoutFile } = doc;
          return docWithoutFile;
        });
        return { ...projectWithoutFile, documents: documentsForStorage };
      });
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projectsForStorage));
    } catch (e: any) {
      console.error('Could not save projects to local storage:', e);
      // Check specifically for quota exceeded error
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.message?.includes('quota')) {
        if (!toast.show) {
            setToast({
                show: true, 
                message: 'Storage Limit Reached: Some data may not be saved. Consider deleting old projects.', 
                type: 'error'
            });
        }
      }
    }
  }, [projects]);

  // NEW LIMITS FEATURE: Client-side API allowance check - expanded for granular limits
  const checkApiAllowance = useCallback(async (usageType: 'STR_GEN' | 'TOKENS_INPUT' | 'TOKENS_OUTPUT' | 'FILE_SIZE_DOC' | 'FILE_SIZE_TOTAL', value: number = 1): Promise<boolean> => {
    if (!userApiLimits || !userPlan || !user) {
      setToast({ show: true, message: 'API limits not loaded. Please try again later.', type: 'error' });
      return false;
    }

    let isAllowed = true;
    let message = '';
    
    // Helper to format large numbers
    const formatNumber = (num: number) => num.toLocaleString();

    switch (usageType) {
      case 'STR_GEN': // STR Generation Limit (monthly)
        if (userApiLimits.strs_used_monthly + value > userPlan.max_strs_per_month) {
          isAllowed = false;
          message = `Monthly STR generation limit (${formatNumber(userPlan.max_strs_per_month)}) exceeded for your ${userPlan.name} plan.`;
        }
        // Also check daily limit for STR_GEN
        if (isAllowed) { // Only check daily if monthly is OK
            const today = new Date().toISOString().split('T')[0];
            const { data: dailyUsageData, error: dailyUsageError } = await supabase
                .from('daily_usage')
                .select('str_count')
                .eq('user_id', user.id)
                .eq('day', today)
                .single();
            
            if (dailyUsageError && dailyUsageError.code !== 'PGRST116') { // PGRST116 means no rows found
                console.error('Error fetching daily usage:', dailyUsageError.message);
                message = `Error checking daily usage: ${dailyUsageError.message}. Please try again.`;
                isAllowed = false;
            } else {
                const dailyStrsUsed = (dailyUsageData?.str_count || 0);
                if (dailyStrsUsed + value > userPlan.max_strs_per_day) {
                    isAllowed = false;
                    message = `Daily STR generation limit (${userPlan.max_strs_per_day}) exceeded for your ${userPlan.name} plan.`;
                }
            }
        }
        break;
      case 'TOKENS_INPUT':
        if (userApiLimits.input_tokens_used_monthly + value > userPlan.max_input_tokens_per_month) {
          isAllowed = false;
          message = `Monthly input token limit (${formatNumber(userPlan.max_input_tokens_per_month)}) exceeded for your ${userPlan.name} plan.`;
        }
        break;
      case 'TOKENS_OUTPUT':
        if (userApiLimits.output_tokens_used_monthly + value > userPlan.max_output_tokens_per_month) {
          isAllowed = false;
          message = `Monthly output token limit (${formatNumber(userPlan.max_output_tokens_per_month)}) exceeded for your ${userPlan.name} plan.`;
        }
        break;
      case 'FILE_SIZE_DOC': // value is in MB
        if (value > userPlan.max_file_size_mb_per_document) {
          isAllowed = false;
          message = `Single document file size limit (${userPlan.max_file_size_mb_per_document}MB) exceeded for your ${userPlan.name} plan.`;
        }
        break;
      case 'FILE_SIZE_TOTAL': // value is in MB
        // This limit is per project, so we need to calculate current project's total size
        // For simplicity, we'll check `value` (new file(s) size) against the limit.
        // A more robust solution would track total project file size server-side.
        if (value > userPlan.max_total_upload_mb_per_str) {
          isAllowed = false;
          message = `Total upload size limit for this project (${userPlan.max_total_upload_mb_per_str}MB) exceeded for your ${userPlan.name} plan.`;
        }
        break;
      default:
        console.warn(`Unknown usage type: ${usageType}`);
        break;
    }

    if (!isAllowed) {
      setToast({ show: true, message: message + ' Please upgrade your plan or wait for the next cycle.', type: 'error' });
    }
    return isAllowed;
  }, [userApiLimits, userPlan, user]);


  const handleCheckCompleteness = async (projectId: string) => {
    // Run this check asynchronously without blocking the main thread
    setTimeout(async () => {
      // Get the latest project state by finding it inside the timeout
      const projectToCheck = projects.find(p => p.id === projectId);
      if (!projectToCheck || !user) return; // Ensure user is logged in for API calls

      // NEW LIMITS FEATURE: Pass estimated tokens to allowance check. Using dummy values for now.
      // Completeness check is generally low token, but let's estimate 100 input, 50 output for average.
      const estimatedInputTokens = 100;
      const estimatedOutputTokens = 50;
      if (!(await checkApiAllowance('TOKENS_INPUT', estimatedInputTokens)) || !(await checkApiAllowance('TOKENS_OUTPUT', estimatedOutputTokens))) return; 

      const uploadedDocTypes = projectToCheck.documents
        .flatMap(d => d.docTypes || [])
        .filter((t): t is string => !!t);

      const requiredDocs = SCENARIO_BASED_DOCUMENTS[projectToCheck.scenario || 'UNKNOWN'];
      // Pass userId to analyzeDocumentCompleteness
      const missingDocs = await analyzeDocumentCompleteness(user.id, uploadedDocTypes, requiredDocs, estimatedInputTokens, estimatedOutputTokens, 'analyzeDocumentCompleteness');
      
      if (missingDocs === RATE_LIMIT_EXCEEDED) {
        console.warn('Rate limit hit during completeness check. Skipping.');
        // Optionally, show a toast or schedule a retry
        return;
      }

      setProjects(prev => prev.map(p => 
        p.id === projectId ? { ...p, missingDocuments: missingDocs } : p
      ));

      // After a successful operation that might affect usage, re-fetch limits
      if (user) fetchUserPlanAndLimits(user.id);
    }, 100); // A slight delay to allow state to settle
  };


  // New function to handle the entire logic for extracting and updating project details
  const runProjectDetailExtraction = useCallback(async (projectId: string) => {
    // 1. Check for lock to prevent concurrent runs for the same project
    if (isExtractingFor.has(projectId) || !user) { // Ensure user is logged in
      console.log(`Project detail extraction already in progress or user not logged in for project ${projectId}. Skipping.`);
      return;
    }

    // NEW LIMITS FEATURE: Estimate tokens for project detail extraction.
    let projectToUpdate = projects.find(p => p.id === projectId);
    const allText = projectToUpdate?.documents
          .filter(d => d.status === 'Processed' && d.extractedText)
          .map(d => `--- Document: ${d.fileName} ---\n${d.extractedText}`)
          .join('\n\n') || '';
    const estimatedInputTokens = Math.ceil(allText.length / 4) || 3000; // Use actual text length or default
    const estimatedOutputTokens = 300;

    if (!(await checkApiAllowance('TOKENS_INPUT', estimatedInputTokens)) || !(await checkApiAllowance('TOKENS_OUTPUT', estimatedOutputTokens))) return; 

    setIsExtractingFor(prev => new Set(prev).add(projectId));

    try {
      // 2. Get the latest project data using a functional state update to avoid stale state
      if (!projectToUpdate) {
        console.warn(`Project ${projectId} not found for detail extraction.`);
        return;
      }

      // 3. Aggregate text from all processed documents
      if (!allText) {
          // If no text, still run downstream checks in case some docs were removed and state needs refresh
          handleCheckCompleteness(projectId);
          return; // No text to analyze for details, exit early.
      }

      // 4. Call the AI for extraction
      // Pass userId and estimated tokens to extractProjectDetailsAndScenario
      const details = await extractProjectDetailsAndScenario(user.id, allText, estimatedInputTokens, estimatedOutputTokens, 'extractProjectDetailsAndScenario');

      // 5. Handle rate limiting by retrying after a delay
      if (details === RATE_LIMIT_EXCEEDED) {
          console.warn('Rate limit hit during project detail extraction, retrying in 20s');
          setTimeout(() => runProjectDetailExtraction(projectId), 20000);
          return; // Keep the lock active until the retry is scheduled
      }

      const extractedDetails = details as Partial<ProjectDetails>;
      
      let projectWasUpdated = false;
      // 6. Update the project with the new details
      setProjects(prev => prev.map(p => {
          if (p.id === projectId) {
              const updatedProject = {
                  ...p,
                  projectName: extractedDetails.projectName || p.projectName, // Use AI result, fallback to existing
                  propertyAddress: extractedDetails.propertyAddress || p.propertyAddress,
                  clientName: extractedDetails.clientName || p.clientName,
                  searchPeriod: extractedDetails.searchPeriod || p.searchPeriod,
                  // Always update scenario, even if AI confirms UNKNOWN, to ensure latest status
                  scenario: (extractedDetails.scenario && SCENARIOS[extractedDetails.scenario]) ? extractedDetails.scenario : 'UNKNOWN',
              };
              if (JSON.stringify(updatedProject) !== JSON.stringify(p)) {
                  projectWasUpdated = true;
              }
              return updatedProject;
          }
          return p;
      }));
      
      // 7. ALWAYS Re-run completeness checks if AI extraction was performed
      // This ensures they run with the most up-to-date and aggregated document context.
      // Only trigger if the project details actually changed, to avoid redundant checks.
      if (projectWasUpdated) {
          handleCheckCompleteness(projectId);
      }

      // After a successful operation that might affect usage, re-fetch limits
      if (user) fetchUserPlanAndLimits(user.id);
    } catch (error) {
        console.error(`Error during project detail extraction for project ${projectId}:`, error);
    } finally {
        // 8. Always release the lock
        setIsExtractingFor(prev => {
            const newSet = new Set(prev);
            newSet.delete(projectId);
            return newSet;
        });
    }
  }, [isExtractingFor, projects, handleCheckCompleteness, user, checkApiAllowance, fetchUserPlanAndLimits]);


  // This function processes a single document from the queue.
  const processSingleDocument = async (projectId: string, documentId: string, file: File): Promise<string> => {
    if (!user) return PROCESS_ERROR; // Ensure user is logged in

    try {
      // 1. Set status to Extracting Text
      setProjects(prev => prev.map(p => p.id === projectId ? {
        ...p,
        documents: p.documents.map(d => d.id === documentId ? { ...d, status: 'Extracting Text' } : d)
      } : p));

      // NEW LIMITS FEATURE: Estimate tokens for text extraction and classification.
      // These are rough estimates; actual tokens will be logged by `geminiService`.
      const estimatedInputTokens = Math.ceil(file.size / (1024 * 4)); // Rough estimate for multimodal input
      const estimatedOutputTokens = 2000; // Average extracted text length

      if (!(await checkApiAllowance('TOKENS_INPUT', estimatedInputTokens)) || !(await checkApiAllowance('TOKENS_OUTPUT', estimatedOutputTokens))) { 
          throw new Error(RATE_LIMIT_EXCEEDED);
      }

      // 2. Extract text using Gemini
      // Pass userId and estimated tokens to extractTextFromFile
      const extractedText = await extractTextFromFile(user.id, file, estimatedInputTokens, estimatedOutputTokens, 'extractTextFromFile');
      
      if (extractedText === RATE_LIMIT_EXCEEDED) {
        return PROCESS_RATE_LIMITED;
      }

      if (extractedText === UNSUPPORTED_FOR_EXTRACTION) {
        setProjects(prev => prev.map(p => p.id === projectId ? {
          ...p,
          documents: p.documents.map(d => d.id === documentId ? { 
            ...d, 
            status: 'Unsupported',
            error: 'This file type can be stored but not analyzed by AI.' 
          } : d)
        } : p));
        // After a successful operation that might affect usage, re-fetch limits
        if (user) fetchUserPlanAndLimits(user.id);
        return PROCESS_SUCCESS;
      }
      
      // Check if extractedText indicates an T-Error before proceeding
      if (extractedText.startsWith('Error')) {
           throw new Error(extractedText);
      }

      // 3. Set status to Classifying and update the extracted text
      setProjects(prev => prev.map(p => p.id === projectId ? {
        ...p,
        documents: p.documents.map(d => d.id === documentId ? { ...d, extractedText, status: 'Classifying' } : d)
      } : p));

      // NEW LIMITS FEATURE: Check allowance for classification tokens
      const estimatedClassificationInputTokens = 500;
      const estimatedClassificationOutputTokens = 50;

      if (!(await checkApiAllowance('TOKENS_INPUT', estimatedClassificationInputTokens)) || !(await checkApiAllowance('TOKENS_OUTPUT', estimatedClassificationOutputTokens))) { 
          throw new Error(RATE_LIMIT_EXCEEDED);
      }

      // 4. Classify the document based on the real text
      // Pass userId and estimated tokens to classifyDocument
      const docType = await classifyDocument(user.id, extractedText, estimatedClassificationInputTokens, estimatedClassificationOutputTokens, 'classifyDocument');

      if (docType === RATE_LIMIT_EXCEEDED) {
        return PROCESS_RATE_LIMITED;
      }

      // 5. Set status to Processed and update the document type
      setProjects(prev => prev.map(p => p.id === projectId ? {
        ...p,
        documents: p.documents.map(d => d.id === documentId ? { ...d, docTypes: [docType as string], status: 'Processed' } : d)
      } : p));
      
      // After a successful operation that might affect usage, re-fetch limits
      if (user) fetchUserPlanAndLimits(user.id);
      return PROCESS_SUCCESS;

    } catch (error: any) {
      console.error(`Error processing document ID ${documentId}:`, error);
      setProjects(prev => prev.map(p => p.id === projectId ? {
        ...p,
        documents: p.documents.map(d => d.id === documentId ? { ...d, status: 'Error', error: error.message || 'AI processing failed' } : d)
      } : p));

      if (error.message === RATE_LIMIT_EXCEEDED) {
          return PROCESS_RATE_LIMITED;
      }
      return PROCESS_ERROR;
    }
  };

  // This "worker" effect processes one document from the queue at a time.
  useEffect(() => {
    // Only process if user is logged in
    if (!user) return;

    if (!isProcessing && processingQueue.length > 0) {
      const nextItem = processingQueue[0];

      // Defensive check: ensure the document is in the state before processing.
      const project = projects.find(p => p.id === nextItem.projectId);
      const document = project?.documents.find(d => d.id === nextItem.documentId);

      if (document) {
        setIsProcessing(true);
        processSingleDocument(nextItem.projectId, nextItem.documentId, nextItem.file)
          .then((result) => {
            switch (result) {
              case PROCESS_RATE_LIMITED:
                console.warn('Rate limit hit. Pausing processing for 20 seconds.');
                setTimeout(() => {
                  setIsProcessing(false); // After delay, allow retry of the same item
                }, 20000);
                break;
              
              case PROCESS_SUCCESS:
                // After successful processing, trigger the project detail extraction.
                runProjectDetailExtraction(nextItem.projectId);
                
                setProcessingQueue(prev => prev.slice(1)); // Move to next item
                setIsProcessing(false);
                break;
              
              case PROCESS_ERROR:
              default:
                setProcessingQueue(prev => prev.slice(1)); // Move to next item
                setIsProcessing(false);
                break;
            }
          })
          .catch((uncaughtError) => {
            console.error(`Uncaught error in processSingleDocument promise chain for document ID ${nextItem.documentId}:`, uncaughtError);
            setProjects(prev => prev.map(p => p.id === nextItem.projectId ? {
              ...p,
              documents: p.documents.map(d => d.id === nextItem.documentId ? { ...d, status: 'Error', error: uncaughtError.message || 'An unexpected error occurred during processing.' } : d)
            } : p));
            setProcessingQueue(prev => prev.slice(1)); // Move to next item
            setIsProcessing(false);
          });
      } else {
        // If document not found, remove from queue to prevent infinite loop.
        console.warn(`Document ID ${nextItem.documentId} not found in project ${nextItem.projectId}. Removing from queue.`);
        setProcessingQueue(prev => prev.slice(1));
        setIsProcessing(false);
      }
    }
  }, [processingQueue, isProcessing, projects, runProjectDetailExtraction, user, checkApiAllowance, fetchUserPlanAndLimits]);


  const handleLogin = async (email: string, password: string, rememberMe: boolean) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
          // As discussed, `persistSession` is generally configured at `createClient` level.
          // The `rememberMe` checkbox effectively controls this global persistence.
        }
      });

      if (error) {
        throw error;
      }
      // If no error, onAuthStateChange listener will handle setting the user
    } catch (error: any) {
      const errorMsg = getErrorString(error);
      console.error('Login failed:', errorMsg, error);
      // NEW FIX: Handle "Email not confirmed" specifically during login attempts
      if (errorMsg.includes('Email not confirmed')) {
        setToast({ show: true, message: 'Your email has not been confirmed. Please check your inbox for the verification link.', type: 'info' });
      } else if (errorMsg.includes('Invalid login credentials')) {
        // This is a common generic message that might cover unconfirmed emails as well,
        // so we make it more informative.
        setToast({ show: true, message: 'Invalid login credentials. Please check your email and password, or confirm your email if you just signed up.', type: 'error' });
      }
      else {
        setToast({ show: true, message: errorMsg || 'Login failed. An unexpected error occurred.', type: 'error' });
      }
    }
  };

  // New handleSignUp function
  const handleSignUp = async (email: string, password: string, fullName: string, firmName: string, planId: number) => {
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            firm_name: firmName,
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (data.user) {
        // Successfully created user, now insert their chosen plan into api_limits
        // This relies on the 'Allow authenticated users to manage their own api_limits' RLS policy for INSERT
        const { error: insertLimitsError } = await supabase
          .from('api_limits')
          .insert([
            {
              user_id: data.user.id,
              plan_id: planId,
              // These will be updated by fetchUserPlanAndLimits when the user logs in
              monthly_limit: 0, 
              used: 0,
              reset_date: new Date().toISOString().split('T')[0],
              input_tokens_used_monthly: 0,
              output_tokens_used_monthly: 0,
              strs_used_monthly: 0,
            },
          ]);

        if (insertLimitsError) {
          console.error('Error inserting API limits for new user:', insertLimitsError.message);
          setToast({ show: true, message: `Account created, but failed to assign plan: ${insertLimitsError.message}. Please contact support.`, type: 'error' });
        } else {
            // Refined message to clearly state email confirmation is needed
            setToast({ show: true, message: 'Account created and plan assigned successfully! Please check your email to confirm your account, then log in.', type: 'success' });
        }
        
        // IMPORTANT: Do NOT attempt to sign in immediately after signup if email confirmation is enabled.
        // Instead, guide the user to confirm their email.
        setIsSignUpMode(false); // Go back to login view after successful signup instruction
      } else {
        // This case should ideally be caught by signUpError, but added for robustness.
        throw new Error("User data not returned from signup, but no error reported.");
      }
    } catch (error: any) {
      const errorMsg = getErrorString(error);
      console.error('Sign up failed:', errorMsg, error);
      // Check for specific Supabase error messages
      if (errorMsg.includes('Email not confirmed')) {
        // This toast means signup *succeeded* but email isn't verified.
        setToast({ show: true, message: 'Signup successful! Please check your email to confirm your account, then log in.', type: 'success' });
        setIsSignUpMode(false); // Go back to login view
      } else if (errorMsg.includes('User already registered')) {
        setToast({ show: true, message: 'A user with this email already exists. Please log in or reset your password.', type: 'error' });
      } else {
        setToast({ show: true, message: errorMsg || 'Sign up failed. Please try again.', type: 'error' });
      }
    }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      // onAuthStateChange listener will handle clearing the user state
    } catch (error: any) {
      const errorMsg = getErrorString(error);
      console.error('Logout failed:', errorMsg, error);
      setToast({ show: true, message: errorMsg || 'Logout failed.', type: 'error' });
    }
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
  };

  const handleBackToDashboard = () => {
    setSelectedProjectId(null);
  };

  const handleUpdateProject = (updatedProject: Project) => {
    setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
  };
  
  const handleUpdateDocumentType = (projectId: string, documentId: string, newType: string) => {
    setProjects(prevProjects => prevProjects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        documents: p.documents.map(d => {
          if (d.id === documentId) {
            // Add the new type if it's not already there (additive assignment)
            const currentTypes = Array.isArray(d.docTypes) ? d.docTypes : [];
            if (!currentTypes.includes(newType)) {
                // Fix: Correctly update the docTypes array within the document object
                return { ...d, docTypes: [...currentTypes, newType] };
            }
            return d;
          }
          return d;
        })
      };
    }));
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  const handleCreateProject = async (
    newProjectData: Omit<Project, 'id' | 'documents' | 'report' | 'createdAt' | 'advocateInstructions'>, // Add advocateInstructions to omit list
    files: File[] = []
  ) => {
    // NEW LIMITS FEATURE: Check total file size before creating project/uploading documents
    if (!userPlan) {
      setToast({ show: true, message: 'User plan not loaded, cannot create project.', type: 'error' });
      return;
    }

    let totalFilesSizeMB = files.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    if (!(await checkApiAllowance('FILE_SIZE_TOTAL', totalFilesSizeMB))) {
      return;
    }

    const projectId = `proj_${Date.now()}`;
    
    const newDocuments: Document[] = files.map((file, index) => ({
      id: `doc_${Date.now()}_${index}`,
      projectId: projectId,
      // @ts-ignore
      fileName: file.webkitRelativePath || file.name,
      fileType: file.type || 'application/octet-stream',
      file: file,
      uploadDate: new Date().toISOString(),
      status: 'Uploaded', // Documents start as 'Uploaded', ready for queue
      docTypes: [], // Initialize with empty types
    }));

    const newProject: Project = {
      id: projectId,
      ...newProjectData,
      documents: newDocuments,
      report: null,
      createdAt: new Date().toISOString(),
      scenario: 'UNKNOWN',
      advocateInstructions: '', // Initialize advocateInstructions as empty string
    };
    
    setProjects(prevProjects => [newProject, ...prevProjects]);

    // Add all new documents to the processing queue
    const docsToQueue = newDocuments
      .filter(doc => doc.file) // Ensure file object exists
      .map(doc => ({
        projectId: doc.projectId,
        documentId: doc.id,
        file: doc.file!,
      }));
    setProcessingQueue(prev => [...prev, ...docsToQueue]);
  };
  
  const handleDocumentUpload = (projectId: string, files: File[]) => {
    if (!userPlan) {
      setToast({ show: true, message: 'User plan not loaded, cannot upload documents.', type: 'error' });
      return;
    }

    const newDocumentsToAdd: Document[] = [];
    let totalUploadSizeMB = 0;

    for (const file of files) {
      const fileSizeMB = file.size / (1024 * 1024);
      
      // NEW LIMITS FEATURE: Check single file size limit
      if (fileSizeMB > (userPlan.max_file_size_mb_per_document || Infinity)) {
        setToast({ show: true, message: `File "${file.name}" (${fileSizeMB.toFixed(2)}MB) exceeds the maximum allowed single document size of ${userPlan.max_file_size_mb_per_document}MB.`, type: 'error' });
        continue; // Skip this file
      }
      totalUploadSizeMB += fileSizeMB;

      newDocumentsToAdd.push({
        id: `doc_${Date.now()}_${Math.random()}`,
        projectId: projectId,
        fileName: file.name,
        fileType: file.type,
        file: file,
        uploadDate: new Date().toISOString(),
        status: 'Uploading',
        progress: 0,
        docTypes: [],
      });
    }

    // NEW LIMITS FEATURE: Check total project upload size limit for this batch
    // Note: This does not sum *existing* documents in the project. For a full check,
    // total size of all docs in the project would need to be tracked.
    if (totalUploadSizeMB > (userPlan.max_total_upload_mb_per_str || Infinity)) {
      setToast({ show: true, message: `This batch of documents (${totalUploadSizeMB.toFixed(2)}MB) exceeds the maximum allowed total upload size of ${userPlan.max_total_upload_mb_per_str}MB for a single project.`, type: 'error' });
      return; // Stop processing this batch
    }

    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, documents: [...p.documents, ...newDocumentsToAdd] } : p
    ));

    newDocumentsToAdd.forEach(doc => {
      // Improved simulation logic: dynamic speed based on file size, jitter, and mid-upload failures.
      const fileSize = doc.file?.size || 1 * 1024 * 1024; // Default to 1MB if size is unknown
      
      // Simulate network speed between 50KB/s and 500KB/s
      const simulatedSpeedBps = (Math.random() * (500 - 50) + 50) * 1024;
      const totalDurationMs = (fileSize / simulatedSpeedBps) * 1000;
      
      const updateInterval = 100; // Update every 100ms for a smooth progress bar
      const progressChunks = Math.max(1, totalDurationMs / updateInterval);
      
      // 15% chance of a network interruption
      const shouldFail = Math.random() < 0.15; 
      // If it fails, it will happen somewhere between 10% and 90% progress
      const failAtProgress = Math.random() * 80 + 10; 

      let currentProgress = 0;

      const interval = setInterval(() => {
        // Add randomness to progress increments to simulate network jitter
        const progressIncrement = (100 / progressChunks) * (0.8 + Math.random() * 0.4);
        currentProgress = Math.min(currentProgress + progressIncrement, 100);
        
        // --- Handle simulated failure ---
        if (shouldFail && currentProgress >= failAtProgress) {
            clearInterval(interval);
            setProjects(prev => prev.map(p => {
                if (p.id !== projectId) return p;
                return {
                    ...p,
                    documents: p.documents.map(d =>
                        d.id === doc.id ? { ...d, status: 'Error', error: 'Network interruption during upload.' } : d
                    )
                };
            }));
            return; // Exit simulation for this file
        }

        // --- Update progress in state ---
        setProjects(prev => prev.map(p =>
            p.id !== projectId ? p : {
                ...p,
                documents: p.documents.map(d =>
                    d.id === doc.id ? { ...d, progress: Math.round(currentProgress) } : d
                )
            }
        ));
        
        // --- Handle successful completion ---
        if (currentProgress >= 100) {
            clearInterval(interval);
            setProjects(prev => prev.map(p => {
                if (p.id !== projectId) return p;
                return {
                    ...p,
                    documents: p.documents.map(d =>
                        d.id === doc.id ? { ...d, status: 'Uploaded', progress: 100 } : d
                    )
                };
            }));
            
            if (doc.file) {
                // Add the successfully uploaded document to the AI processing queue
                setProcessingQueue(prev => [...prev, { projectId, documentId: doc.id, file: doc.file! }]);
            }
        }
      }, updateInterval);
    });
  };


  const handleDeleteDocument = (projectId: string, documentId: string) => {
    setProjects(prevProjects =>
      prevProjects.map(p =>
        p.id === projectId
          ? { ...p, documents: p.documents.filter(d => d.id !== documentId) }
          : p
      )
    );
  };


  const handleDeleteProject = (projectId: string) => {
    setProjects(prevProjects => prevProjects.filter(p => p.id !== projectId));
  };


  if (!user) {
    return isSignUpMode ? (
      <SignUpScreen onSignUp={handleSignUp} onGoToLogin={() => setIsSignUpMode(false)} />
    ) : (
      <LoginScreen onLogin={handleLogin} onGoToSignUp={() => setIsSignUpMode(true)} />
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 relative">
      <Header 
        user={user} 
        onLogout={handleLogout} 
      />
      <main className="p-4 sm:p-6 lg:p-8">
        {selectedProject ? (
          <ProjectView
            project={selectedProject}
            user={user}
            onUpdateProject={handleUpdateProject}
            onUploadDocuments={handleDocumentUpload}
            onDeleteDocument={handleDeleteDocument}
            onUpdateDocumentType={handleUpdateDocumentType}
            onBack={handleBackToDashboard}
            onTriggerProjectDetailExtraction={runProjectDetailExtraction}
            isExtractingProjectDetails={isExtractingFor.has(selectedProject.id)}
            checkApiAllowance={checkApiAllowance} // Pass checkApiAllowance
          />
        ) : (
          <Dashboard
            projects={projects}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            userPlan={userPlan} // NEW LIMITS FEATURE: Pass plan to Dashboard
            userApiLimits={userApiLimits} // NEW LIMITS FEATURE: Pass API limits to Dashboard
            dailyUsage={user.dailyStrsUsed} // NEW: Pass daily usage to Dashboard
          />
        )}
      </main>
      
      {toast.show && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast({ ...toast, show: false })} 
        />
      )}
    </div>
  );
};

export default App;