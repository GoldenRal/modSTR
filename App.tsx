
import React, { useState, useEffect, useCallback } from 'react';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import SignUpScreen from './components/SignUpScreen';
import { ProjectView } from './components/ProjectView';
import Header from './components/ui/Header';
import Toast from './components/ui/Toast';
import { User, Project, Document, ProjectDetails, Scenario, Plan, ApiLimits } from './types';
import { SCENARIOS } from './constants';
import { classifyDocument, extractTextFromFile, UNSUPPORTED_FOR_EXTRACTION, RATE_LIMIT_EXCEEDED, extractProjectDetailsAndScenario } from './services/geminiService';
import { supabase } from './supabaseClient';

interface ProcessingQueueItem {
  projectId: string;
  documentId: string;
  file: File;
}

const PROCESS_SUCCESS = 'SUCCESS';
const PROCESS_ERROR = 'ERROR';
const PROCESS_RATE_LIMITED = 'RATE_LIMITED';
const STORAGE_KEY = 'legalAiProjects';

function getErrorString(e: any): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as any).message);
  return String(e);
}

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userPlan, setUserPlan] = useState<Plan | null>(null);
  const [userApiLimits, setUserApiLimits] = useState<ApiLimits | null>(null);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'info' | 'success' | 'error' }>({ 
    show: false, message: '', type: 'info' 
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (!savedData) return [];
    try {
      const parsedData = JSON.parse(savedData);
      if (!Array.isArray(parsedData)) return [];
      return parsedData.map((project: any) => ({
        ...project,
        documents: Array.isArray(project.documents) ? project.documents.map((doc: any) => {
          const transientStatuses: Document['status'][] = ['Uploading', 'Uploaded', 'Extracting Text', 'Classifying'];
          if (transientStatuses.includes(doc.status)) {
            return { ...doc, status: 'Error', error: 'Interrupted. Re-upload.', progress: 0 };
          }
          return doc;
        }) : [],
        scenario: (project.scenario && SCENARIOS[project.scenario as Scenario]) ? project.scenario : 'UNKNOWN',
        advocateInstructions: project.advocateInstructions || '',
      }));
    } catch (e) {
      console.error('Failed to parse projects:', e);
      return [];
    }
  });
  
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [processingQueue, setProcessingQueue] = useState<ProcessingQueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtractingFor, setIsExtractingFor] = useState<Set<string>>(new Set());

  const fetchUserPlanAndLimits = useCallback(async (userId: string) => {
    try {
      const { data: apiLimitsData, error: apiLimitsError } = await supabase
        .from('api_limits')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (apiLimitsError && apiLimitsError.code !== 'PGRST116') throw apiLimitsError;

      let currentApiLimits = apiLimitsData as ApiLimits | null;
      let currentPlan: Plan | null = null;
      let dailyStrsUsed = 0;

      if (currentApiLimits) {
        const { data: planData, error: planError } = await supabase
          .from('plans')
          .select('*')
          .eq('id', currentApiLimits.plan_id)
          .single();
        if (planError) throw planError;
        currentPlan = planData as Plan;

        const today = new Date();
        const resetDate = new Date(currentApiLimits.reset_date);
        if (today.getMonth() !== resetDate.getMonth() || today.getFullYear() !== resetDate.getFullYear()) {
          const todayStr = today.toISOString().split('T')[0];
          await supabase.from('api_limits').update({
            input_tokens_used_monthly: 0, output_tokens_used_monthly: 0, strs_used_monthly: 0, reset_date: todayStr,
          }).eq('user_id', userId);
          currentApiLimits = { ...currentApiLimits, input_tokens_used_monthly: 0, output_tokens_used_monthly: 0, strs_used_monthly: 0, reset_date: todayStr };
        }

        const todayStr = today.toISOString().split('T')[0];
        const { data: dailyUsageData } = await supabase.from('daily_usage').select('str_count').eq('user_id', userId).eq('day', todayStr).single();
        dailyStrsUsed = dailyUsageData?.str_count || 0;
      }

      setUserPlan(currentPlan);
      setUserApiLimits(currentApiLimits);
      setUser(prev => prev ? {
        ...prev,
        planName: currentPlan?.name,
        strsUsedMonthly: currentApiLimits?.strs_used_monthly,
        maxStrsMonthly: currentPlan?.max_strs_per_month,
        inputTokensUsedMonthly: currentApiLimits?.input_tokens_used_monthly,
        maxInputTokensMonthly: currentPlan?.max_input_tokens_per_month,
        outputTokensUsedMonthly: currentApiLimits?.output_tokens_used_monthly,
        maxOutputTokensMonthly: currentPlan?.max_output_tokens_per_month,
        maxFileSizeDocMB: currentPlan?.max_file_size_mb_per_document,
        maxTotalUploadMB: currentPlan?.max_total_upload_mb_per_str,
        dailyStrsUsed,
        maxStrsDaily: currentPlan?.max_strs_per_day,
      } : prev);
    } catch (error) {
      console.error("Error fetching limits:", error);
    }
  }, []);

  const handleAuthError = useCallback(async (errorMsg: string) => {
    if (errorMsg.includes('refresh_token_not_found') || errorMsg.includes('Invalid Refresh Token')) {
      console.warn("Invalid session detected, clearing state...");
      await supabase.auth.signOut();
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-')) localStorage.removeItem(key);
      });
      setUser(null);
      setUserPlan(null);
      setUserApiLimits(null);
    }
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          await handleAuthError(error.message);
          return;
        }
        if (session) {
          const currentUser: User = {
            id: session.user.id,
            email: session.user.email || 'N/A',
            name: session.user.user_metadata?.full_name || session.user.email || 'Guest',
            firmName: session.user.user_metadata?.firm_name || 'LegalAI User',
          };
          setUser(currentUser);
          fetchUserPlanAndLimits(currentUser.id);
        }
      } catch (err: any) {
        await handleAuthError(getErrorString(err));
      }
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const currentUser: User = {
          id: session.user.id,
          email: session.user.email || 'N/A',
          name: session.user.user_metadata?.full_name || session.user.email || 'Guest',
          firmName: session.user.user_metadata?.firm_name || 'LegalAI User',
        };
        setUser(currentUser);
        fetchUserPlanAndLimits(currentUser.id);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setUserPlan(null);
        setUserApiLimits(null);
        setSelectedProjectId(null);
      }
    });

    return () => authListener?.subscription?.unsubscribe();
  }, [fetchUserPlanAndLimits, handleAuthError]);

  useEffect(() => {
    try {
      const storageData = projects.map((p) => ({
        ...p,
        documents: p.documents.map(({ file, ...d }) => d)
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
    } catch (e: any) {
      if (e.name === 'QuotaExceededError') setToast({ show: true, message: 'Storage Limit Reached.', type: 'error' });
    }
  }, [projects]);

  const checkApiAllowance = useCallback(async (type: string, val: number = 1): Promise<boolean> => {
    if (!userApiLimits || !userPlan || !user) return false;
    let allowed = true;
    let msg = '';
    const fmt = (n: number) => n.toLocaleString();

    if (type === 'STR_GEN') {
      if (userApiLimits.strs_used_monthly + val > userPlan.max_strs_per_month) {
        allowed = false;
        msg = `Monthly limit (${fmt(userPlan.max_strs_per_month)}) exceeded.`;
      } else {
        const todayStr = new Date().toISOString().split('T')[0];
        const { data } = await supabase.from('daily_usage').select('str_count').eq('user_id', user.id).eq('day', todayStr).single();
        if ((data?.str_count || 0) + val > userPlan.max_strs_per_day) {
          allowed = false;
          msg = `Daily limit (${userPlan.max_strs_per_day}) exceeded.`;
        }
      }
    } else if (type === 'TOKENS_INPUT' && userApiLimits.input_tokens_used_monthly + val > userPlan.max_input_tokens_per_month) {
      allowed = false;
      msg = `Input token limit exceeded.`;
    } else if (type === 'TOKENS_OUTPUT' && userApiLimits.output_tokens_used_monthly + val > userPlan.max_output_tokens_per_month) {
      allowed = false;
      msg = `Output token limit exceeded.`;
    }
    
    if (!allowed) setToast({ show: true, message: msg, type: 'error' });
    return allowed;
  }, [userApiLimits, userPlan, user]);

  const runProjectDetailExtraction = useCallback(async (projectId: string) => {
    if (isExtractingFor.has(projectId) || !user) return;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const allText = project.documents.filter(d => d.status === 'Processed' && d.extractedText)
      .map(d => `--- Document: ${d.fileName} ---\n${d.extractedText}`).join('\n\n');
    if (!allText) return;

    setIsExtractingFor(prev => new Set(prev).add(projectId));
    try {
      const details = await extractProjectDetailsAndScenario(user.id, allText, project.advocateInstructions || '');
      if (details === RATE_LIMIT_EXCEEDED) {
        setTimeout(() => runProjectDetailExtraction(projectId), 20000);
      } else {
        const ext = details as Partial<ProjectDetails>;
        setProjects(prev => prev.map(p => p.id === projectId ? {
          ...p,
          projectName: ext.projectName || p.projectName,
          propertyAddress: ext.propertyAddress || p.propertyAddress,
          clientName: ext.clientName || p.clientName,
          searchPeriod: ext.searchPeriod || p.searchPeriod,
          scenario: (ext.scenario && SCENARIOS[ext.scenario as Scenario]) ? (ext.scenario as Scenario) : 'UNKNOWN',
        } : p));
        fetchUserPlanAndLimits(user.id);
      }
    } finally {
      setIsExtractingFor(prev => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }, [isExtractingFor, projects, user, fetchUserPlanAndLimits]);

  const processSingleDocument = async (projectId: string, docId: string, file: File): Promise<string> => {
    if (!user) return PROCESS_ERROR;
    try {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, documents: p.documents.map(d => d.id === docId ? { ...d, status: 'Extracting Text' } : d) } : p));
      const text = await extractTextFromFile(user.id, file);
      if (text === RATE_LIMIT_EXCEEDED) return PROCESS_RATE_LIMITED;
      if (text === UNSUPPORTED_FOR_EXTRACTION) {
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, documents: p.documents.map(d => d.id === docId ? { ...d, status: 'Unsupported', error: 'Stored but not analyzed.' } : d) } : p));
        return PROCESS_SUCCESS;
      }
      if (text.startsWith('Error')) throw new Error(text);

      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, documents: p.documents.map(d => d.id === docId ? { ...d, extractedText: text, status: 'Classifying' } : d) } : p));
      const type = await classifyDocument(user.id, text);
      if (type === RATE_LIMIT_EXCEEDED) return PROCESS_RATE_LIMITED;

      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, documents: p.documents.map(d => d.id === docId ? { ...d, docTypes: [type as string], status: 'Processed' } : d) } : p));
      fetchUserPlanAndLimits(user.id);
      return PROCESS_SUCCESS;
    } catch (e: any) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, documents: p.documents.map(d => d.id === docId ? { ...d, status: 'Error', error: e.message || 'AI failed' } : d) } : p));
      return PROCESS_ERROR;
    }
  };

  useEffect(() => {
    if (!user || isProcessing || processingQueue.length === 0) return;
    const nextItem = processingQueue[0];
    const project = projects.find(p => p.id === nextItem.projectId);
    const doc = project?.documents.find(d => d.id === nextItem.documentId);

    if (doc) {
      setIsProcessing(true);
      processSingleDocument(nextItem.projectId, nextItem.documentId, nextItem.file).then(res => {
        if (res === PROCESS_RATE_LIMITED) {
          setTimeout(() => setIsProcessing(false), 20000);
        } else {
          const remaining = processingQueue.slice(1).filter(i => i.projectId === nextItem.projectId);
          if (remaining.length === 0) runProjectDetailExtraction(nextItem.projectId);
          setProcessingQueue(prev => prev.slice(1));
          setIsProcessing(false);
        }
      }).catch(err => {
        setProjects(prev => prev.map(p => p.id === nextItem.projectId ? { ...p, documents: p.documents.map(d => d.id === nextItem.documentId ? { ...d, status: 'Error', error: err.message || 'Worker Error' } : d) } : p));
        setProcessingQueue(prev => prev.slice(1));
        setIsProcessing(false);
      });
    } else {
      setProcessingQueue(prev => prev.slice(1));
      setIsProcessing(false);
    }
  }, [processingQueue, isProcessing, projects, runProjectDetailExtraction, user]);

  const handleLogin = (e: string, p: string, r: boolean) => supabase.auth.signInWithPassword({ email: e, password: p });
  const handleLogout = () => supabase.auth.signOut();
  const handleSelectProject = (id: string) => setSelectedProjectId(id);
  const handleBackToDashboard = () => setSelectedProjectId(null);
  const handleUpdateProject = (upd: Project) => setProjects(prev => prev.map(p => p.id === upd.id ? upd : p));
  const handleUpdateDocumentType = (pId: string, dId: string, type: string) => setProjects(prev => prev.map(p => p.id === pId ? { ...p, documents: p.documents.map(d => d.id === dId ? { ...d, docTypes: [...(d.docTypes || []).filter(t => t !== type), type] } : d) } : p));

  const handleCreateProject = async (data: any, files: File[] = []) => {
    if (!userPlan) return;
    const mb = files.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
    if (!(await checkApiAllowance('FILE_SIZE_TOTAL', mb))) return;

    const pId = `proj_${Date.now()}`;
    const docs: Document[] = files.map((f, i) => ({
      id: `doc_${Date.now()}_${i}`, projectId: pId, fileName: f.name, fileType: f.type, file: f, uploadDate: new Date().toISOString(), status: 'Uploaded', docTypes: [],
    }));

    setProjects(prev => [{ id: pId, ...data, documents: docs, report: null, createdAt: new Date().toISOString(), scenario: 'UNKNOWN', advocateInstructions: '' }, ...prev]);
    setProcessingQueue(prev => [...prev, ...docs.map(d => ({ projectId: pId, documentId: d.id, file: d.file! }))]);
  };
  
  const handleDocumentUpload = (pId: string, files: File[]) => {
    if (!userPlan) return;
    const docsToAdd: Document[] = [];
    files.forEach(f => {
      const mb = f.size / (1024 * 1024);
      if (mb <= (userPlan.max_file_size_mb_per_document || Infinity)) {
        docsToAdd.push({ id: `doc_${Date.now()}_${Math.random()}`, projectId: pId, fileName: f.name, fileType: f.type, file: f, uploadDate: new Date().toISOString(), status: 'Uploading', progress: 0, docTypes: [] });
      }
    });

    setProjects(prev => prev.map(p => p.id === pId ? { ...p, documents: [...p.documents, ...docsToAdd] } : p));
    docsToAdd.forEach(doc => {
      let prog = 0;
      const interval = setInterval(() => {
        prog += 10 + Math.random() * 20;
        if (prog >= 100) {
          clearInterval(interval);
          setProjects(prev => prev.map(p => p.id === pId ? { ...p, documents: p.documents.map(d => d.id === doc.id ? { ...d, status: 'Uploaded', progress: 100 } : d) } : p));
          setProcessingQueue(prev => [...prev, { projectId: pId, documentId: doc.id, file: doc.file! }]);
        } else {
          setProjects(prev => prev.map(p => p.id === pId ? { ...p, documents: p.documents.map(d => d.id === doc.id ? { ...d, progress: Math.round(prog) } : d) } : p));
        }
      }, 200);
    });
  };

  const handleSignUp = async (e: string, p: string, fn: string, firm: string, pId: number) => {
    const { data, error } = await supabase.auth.signUp({ email: e, password: p, options: { data: { full_name: fn, firm_name: firm } } });
    if (error) setToast({ show: true, message: error.message, type: 'error' });
    else if (data.user) {
      await supabase.from('api_limits').insert([{ user_id: data.user.id, plan_id: pId, reset_date: new Date().toISOString().split('T')[0] }]);
      setToast({ show: true, message: 'Check email for link.', type: 'success' });
      setIsSignUpMode(false);
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  if (!user) return isSignUpMode ? <SignUpScreen onSignUp={handleSignUp} onGoToLogin={() => setIsSignUpMode(false)} /> : <LoginScreen onLogin={handleLogin} onGoToSignUp={() => setIsSignUpMode(true)} />;

  return (
    <div className="min-h-screen bg-gray-100 relative">
      <Header user={user} onLogout={handleLogout} />
      <main className="p-4 sm:p-8">
        {selectedProject ? (
          <ProjectView
            project={selectedProject} user={user} onUpdateProject={handleUpdateProject}
            onUploadDocuments={handleDocumentUpload} onDeleteDocument={(pId, dId) => setProjects(prev => prev.map(p => p.id === pId ? { ...p, documents: p.documents.filter(d => d.id !== dId) } : p))}
            onUpdateDocumentType={handleUpdateDocumentType} onBack={handleBackToDashboard}
            onTriggerProjectDetailExtraction={runProjectDetailExtraction} isExtractingProjectDetails={isExtractingFor.has(selectedProject.id)}
            checkApiAllowance={checkApiAllowance}
          />
        ) : (
          <Dashboard
            projects={projects} onSelectProject={handleSelectProject} onCreateProject={handleCreateProject}
            onDeleteProject={(id) => setProjects(prev => prev.filter(p => p.id !== id))}
            userPlan={userPlan} userApiLimits={userApiLimits}
          />
        )}
      </main>
      {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast(prev => ({ ...prev, show: false }))} />}
    </div>
  );
};

export default App;
