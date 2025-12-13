import React, { useState } from 'react';
import { Project, Plan, ApiLimits } from '../types'; 
// Fix: Import Card component
import Card from './ui/Card';

interface DashboardProps {
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onCreateProject: (projectData: Omit<Project, 'id' | 'documents' | 'report' | 'createdAt' | 'advocateInstructions'>, files?: File[]) => void;
  onDeleteProject: (projectId: string) => void;
  userPlan?: Plan | null; // Added new prop for user plan
  userApiLimits?: ApiLimits | null; // Added new prop for user API limits
  dailyUsage?: number; // Added new prop for daily usage count
}

const NewProjectModal: React.FC<{ isOpen: boolean; onClose: () => void; onCreate: (data: Omit<Project, 'id' | 'documents' | 'report' | 'createdAt' | 'advocateInstructions'>, files?: File[]) => void; }> = ({ isOpen, onClose, onCreate }) => {
  const [projectName, setProjectName] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const resetForm = () => {
    setProjectName('');
    setFiles([]);
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const removeFile = (fileToRemove: File) => {
    setFiles(prev => prev.filter(file => file !== fileToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    onCreate({ 
      projectName,
      propertyAddress: '', // Will be auto-populated by AI
      clientName: '',      // Will be auto-populated by AI
      searchPeriod: ''     // Will be auto-populated by AI
    }, files);
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 sm:p-8 animate-fade-in-up">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-brand-dark">Create New Project</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <input type="text" placeholder="Project Name (Optional, can be auto-generated)" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-brand-secondary focus:border-brand-secondary" value={projectName} onChange={e => setProjectName(e.target.value)} />
            
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Project Documents (Required)
              </label>
              <div className="mt-2 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                <div className="space-y-1 text-center">
                  <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="flex text-sm text-gray-600">
                    <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-brand-secondary hover:text-brand-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-brand-secondary">
                      <span>Upload files</span>
                      <input id="file-upload" name="file-upload" type="file" multiple className="sr-only" onChange={handleFileChange} accept="image/*,.pdf,.csv" />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-500">PDF, CSV, JPG, PNG, etc.</p>
                </div>
              </div>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-600">Selected files:</p>
                <ul className="max-h-32 overflow-y-auto rounded-md border border-gray-200 bg-white p-2">
                  {files.map((file, index) => (
                    <li key={index} className="flex justify-between items-center text-sm p-1">
                      <span className="truncate text-gray-700">{file.name}</span>
                      <button type="button" onClick={() => removeFile(file)} className="text-red-500 hover:text-red-700 ml-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
            <button type="submit" disabled={files.length === 0} className="px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary disabled:opacity-50 disabled:cursor-not-allowed">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const DeleteConfirmationModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  projectName: string;
}> = ({ isOpen, onClose, onConfirm, projectName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
        <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="mt-5 text-lg font-medium text-gray-900">Delete Project</h3>
            <div className="mt-2">
              <p className="text-sm text-gray-500">
                Are you sure you want to delete the project "{projectName}"? This action cannot be undone.
              </p>
            </div>
        </div>
        <div className="mt-6 flex justify-center space-x-3">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ projects, onSelectProject, onCreateProject, onDeleteProject, userPlan, userApiLimits, dailyUsage }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const confirmDelete = () => {
    if (projectToDelete) {
      onDeleteProject(projectToDelete.id);
      setProjectToDelete(null);
    }
  };

  // Helper to format large numbers
  const formatNumber = (num: number | undefined) => (num !== undefined && num !== null) ? num.toLocaleString() : 'N/A';
  const formatMegaBytes = (num: number | undefined) => (num !== undefined && num !== null) ? `${num.toLocaleString()} MB` : 'N/A';

  return (
    <>
      {userPlan && userApiLimits && (
        <Card className="mb-6 bg-brand-light p-5 rounded-lg shadow-inner border border-brand-primary/20">
          <h2 className="text-2xl font-bold text-brand-dark mb-4">Your Plan: <span className="text-brand-secondary">{userPlan.name}</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
            <div className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="font-medium text-gray-600">Monthly STRs</p>
              <p className="text-lg font-semibold text-brand-dark">{formatNumber(userApiLimits.strs_used_monthly)} / {formatNumber(userPlan.max_strs_per_month)}</p>
            </div>
            <div className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="font-medium text-gray-600">Daily STRs</p>
              <p className="text-lg font-semibold text-brand-dark">{formatNumber(dailyUsage || 0)} / {formatNumber(userPlan.max_strs_per_day)}</p>
            </div>
            <div className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="font-medium text-gray-600">Input Tokens (Mo)</p>
              <p className="text-lg font-semibold text-brand-dark">{formatNumber(userApiLimits.input_tokens_used_monthly)} / {formatNumber(userPlan.max_input_tokens_per_month)}</p>
            </div>
            <div className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="font-medium text-gray-600">Output Tokens (Mo)</p>
              <p className="text-lg font-semibold text-brand-dark">{formatNumber(userApiLimits.output_tokens_used_monthly)} / {formatNumber(userPlan.max_output_tokens_per_month)}</p>
            </div>
            <div className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="font-medium text-gray-600">Max File Size (Doc)</p>
              <p className="text-lg font-semibold text-brand-dark">{formatMegaBytes(userPlan.max_file_size_mb_per_document)}</p>
            </div>
            <div className="p-3 bg-white rounded-md shadow-sm border border-gray-200">
              <p className="font-medium text-gray-600">Max Total Upload (STR)</p>
              <p className="text-lg font-semibold text-brand-dark">{formatMegaBytes(userPlan.max_total_upload_mb_per_str)}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-brand-dark">Projects Dashboard</h1>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-brand-secondary text-white font-bold rounded-lg shadow-sm hover:bg-brand-primary transition-colors flex items-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Create New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No projects</h3>
            <p className="mt-1 text-sm text-gray-500">Get started by creating a new project.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <Card key={project.id} className="flex flex-col cursor-pointer hover:shadow-lg transition-shadow" onClick={() => onSelectProject(project.id)}>
              <div className="flex-grow">
                <h3 className="text-lg font-bold text-brand-dark truncate">{project.projectName}</h3>
                <p className="text-sm text-gray-600 truncate mt-1">{project.propertyAddress || 'Processing details...'}</p>
                <div className="mt-4 text-xs text-gray-500 space-y-1">
                  <p><strong>Client:</strong> {project.clientName || 'Processing...'}</p>
                  <p><strong>Created:</strong> {new Date(project.createdAt).toLocaleDateString()}</p>
                  <p><strong>Documents:</strong> {project.documents.length}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end">
                <button
                  onClick={(e) => handleDeleteClick(e, project)}
                  className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
                >
                  Delete Project
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={onCreateProject}
      />
      
      {projectToDelete && (
        <DeleteConfirmationModal
          isOpen={!!projectToDelete}
          onClose={() => setProjectToDelete(null)}
          onConfirm={confirmDelete}
          projectName={projectToDelete.projectName}
        />
      )}
    </>
  );
};

export default Dashboard;