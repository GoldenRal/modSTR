
import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { Project, Document, Report, User } from '../types';
import { generateReport } from '../services/geminiService'; 
import { SCENARIOS, REPORT_FORMATS } from '../constants'; 
import Card from './ui/Card';
import Spinner from './ui/Spinner';
import DocumentTextViewModal from './ui/DocumentTextViewModal'; 
import Toast from './ui/Toast';

interface ProjectViewProps {
  project: Project;
  user: User;
  onUpdateProject: (updatedProject: Project) => void;
  onUploadDocuments: (projectId: string, files: File[]) => void;
  onDeleteDocument: (projectId: string, documentId: string) => void;
  onUpdateDocumentType: (projectId: string, documentId: string, newType: string) => void;
  onBack: () => void;
  onTriggerProjectDetailExtraction: (projectId: string) => void;
  isExtractingProjectDetails: boolean;
  checkApiAllowance: (apiType: string, value?: number) => Promise<boolean>;
}

const ReportSummaryCard: React.FC<{ report: Report }> = ({ report }) => {
    const renderSummary = (text: string = "") => {
        return text
            .split('\n')
            .map((line, index) => {
                if (line.startsWith('### ')) {
                    return <h4 key={index} className="text-md font-bold text-brand-secondary mt-3 mb-1">{line.substring(4)}</h4>;
                }
                if (line.trim() === '') {
                    return null;
                }
                return <p key={index} className="text-sm text-gray-700 leading-relaxed">{line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>;
            })
            .filter(Boolean);
    };

    return (
        <Card>
            <h3 className="text-xl font-bold text-brand-dark mb-4">AI Analysis & Summary</h3>

            {report.strCategory && (
                <div className="mb-4">
                    <span className="text-sm font-semibold text-gray-500 uppercase">STR Category</span>
                    <p className="font-bold text-brand-primary text-lg">{report.strCategory}</p>
                </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {report.summary && (
                    <div>
                        <h4 className="text-lg font-semibold text-brand-dark mb-2 border-b pb-1">Title Summary</h4>
                        <div className="prose prose-sm max-w-none">
                            {renderSummary(report.summary)}
                        </div>
                    </div>
                )}
                
                {report.riskFlags && (
                    <div>
                         <h4 className="text-lg font-semibold text-brand-dark mb-2 border-b pb-1">Compliance Red Flags</h4>
                         {report.riskFlags.length === 0 ? (
                            <div className="flex items-center text-green-600 bg-green-50 p-3 rounded-md">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <span className="text-sm font-medium">No red flags detected.</span>
                            </div>
                         ) : (
                            <ul className="space-y-2">
                                {report.riskFlags.map((flag, index) => (
                                    <li key={index} className="flex items-start text-red-700">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M8.257 3.099c.636-1.21 2.27-1.21 2.906 0l4.257 8.122c.624 1.192-.26 2.653-1.583 2.653H5.583c-1.323 0-2.207-1.461-1.583-2.653l4.257-8.122zM10 12a1 1 0 110-2 1 1 0 010 2zm-1-4a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
                                        </svg>
                                        <span className="text-sm">{flag}</span>
                                    </li>
                                ))}
                            </ul>
                         )}
                    </div>
                )}
            </div>
        </Card>
    );
};

const generateWordHtmlFromMarkdown = (markdown: string): string => {
    const lines = markdown.split('\n');
    const htmlLines: string[] = [];
    let inTable = false;
    let inList = false;
    let listType: 'ol' | 'ul' | null = null;

    for (const line of lines) {
        const trimmedLine = line.trim();
        const isListItem = /^\d+\.\s+/.test(trimmedLine);
        if (isListItem) {
            if (!inList || listType !== 'ol') {
                if (inList) htmlLines.push(`</${listType}>`);
                htmlLines.push('<ol style="margin-left: 20px;">');
                inList = true;
                listType = 'ol';
            }
            const liContent = trimmedLine.replace(/^\d+\.\s+/, '');
            const formattedLi = liContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            htmlLines.push(`<li>${formattedLi}</li>`);
            continue;
        }
        const isUnorderedListItem = /^-+\s+/.test(trimmedLine);
        if (isUnorderedListItem) {
            if (!inList || listType !== 'ul') {
                if (inList) htmlLines.push(`</${listType}>`);
                htmlLines.push('<ul style="margin-left: 20px;">');
                inList = true;
                listType = 'ul';
            }
            const liContent = trimmedLine.replace(/^-+\s+/, '');
            const formattedLi = liContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            htmlLines.push(`<li>${formattedLi}</li>`);
            continue;
        }

        if (inList) {
            htmlLines.push(`</${listType}>`);
            inList = false;
            listType = null;
        }

        if (trimmedLine.startsWith('|')) {
            if (!inTable) {
                htmlLines.push('<table style="border-collapse: collapse; width: 100%; border: 1px solid black; margin-bottom: 1em;">');
                inTable = true;
            }
            if (trimmedLine.match(/^\|(?:\s*:?-+:?\s*\|)+$/)) continue;
            const cells = trimmedLine.split('|').filter(c => c !== '').map(c => c.trim());
            htmlLines.push('<tr>');
            cells.forEach(cell => {
                const content = cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                htmlLines.push(`<td style="border: 1px solid black; padding: 5px;">${content}</td>`);
            });
            htmlLines.push('</tr>');
            continue;
        }
        if (inTable) {
            htmlLines.push('</table>');
            inTable = false;
        }

        if (trimmedLine.startsWith('## ')) {
            htmlLines.push(`<h2 style="margin-top: 1em; margin-bottom: 0.5em; color: #2E74B5;">${trimmedLine.substring(3).replace(/\*\*/g, '')}</h2>`);
            continue;
        }
        if (trimmedLine.startsWith('### ')) {
            htmlLines.push(`<h3 style="margin-top: 1em; margin-bottom: 0.5em; color: #2E74B5;">${trimmedLine.substring(4).replace(/\*\*/g, '')}</h3>`);
            continue;
        }
        if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
             htmlLines.push(`<p style="margin-top: 1em; margin-bottom: 0.5em;"><strong>${trimmedLine.replace(/\*\*/g, '')}</strong></p>`);
             continue;
        }

        if (trimmedLine === '---') {
            htmlLines.push('<hr/>');
            continue;
        }

        if (trimmedLine === '') {
            htmlLines.push('<br/>');
            continue;
        }
        
        const pLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        htmlLines.push(`<p>${pLine}</p>`);
    }
    
    if (inTable) htmlLines.push('</table>');
    if (inList) htmlLines.push(`</${listType}>`);

    return htmlLines.join('\n');
};

const ReportDisplay: React.FC<{ reportContent: string }> = ({ reportContent }) => {
    const htmlContent = generateWordHtmlFromMarkdown(reportContent || ''); 
    return (
        <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: htmlContent }} />
    );
};

const renderMarkdownContentToPdf = (doc: jsPDF, markdownContent: string, user: User, isReformat: boolean = false, titlePrefix: string = '') => {
    let y = 15;
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - 2 * margin;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);

    const addPageIfNeeded = (requiredHeight: number) => {
        if (y + requiredHeight > pageHeight - margin) {
            doc.addPage();
            y = margin;
        }
    };

    const lines = markdownContent.split('\n');
    let inTable = false;
    let tableHeaders: string[] = [];
    let tableBody: string[][] = [];

    const printText = (text: string, fontSize: number, fontStyle: 'normal' | 'bold' = 'normal', color = [0, 0, 0], align: 'left' | 'center' = 'left') => {
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', fontStyle);
        doc.setTextColor(color[0], color[1], color[2]);
        
        const splitText = doc.splitTextToSize(text, contentWidth);
        const lineHeight = fontSize / doc.internal.scaleFactor * 1.15;
        
        addPageIfNeeded(splitText.length * lineHeight);
        
        for (const line of splitText) {
            let xPos = align === 'center' ? pageWidth / 2 : margin;
            doc.text(line, xPos, y, { align: align });
            y += lineHeight;
        }
        y += fontSize * 0.2;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableHeaders = [];
                tableBody = [];
                const headerLine = trimmedLine;
                tableHeaders = headerLine.split('|').filter(c => c.trim() !== '').map(h => h.trim().replace(/\*\*(.*?)\*\*/g, '$1'));
                i++; 
                if (!(i < lines.length && lines[i].trim().match(/^\|(?:\s*:?-+:?\s*\|)+$/))) i--;
                continue; 
            }

            const bodyCells = trimmedLine.split('|').filter(c => c.trim() !== '').map(c => c.trim().replace(/\*\*(.*?)\*\*/g, '$1'));
            if (bodyCells.length > 0) tableBody.push(bodyCells);
            
            if (i + 1 >= lines.length || !lines[i + 1].trim().startsWith('|')) {
                addPageIfNeeded(20 + tableBody.length * 10);
                (doc as any).autoTable({
                    startY: y,
                    head: [tableHeaders],
                    body: tableBody,
                    styles: { fontSize: 9, cellPadding: 2, lineColor: [180, 180, 180], lineWidth: 0.1, valign: 'top' },
                    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'left' },
                    margin: { left: margin, right: margin },
                });
                y = (doc as any).lastAutoTable.finalY + 5; 
                inTable = false;
            }
            continue;
        }

        if (trimmedLine.startsWith('## ')) {
            addPageIfNeeded(20);
            printText(trimmedLine.substring(3).replace(/\*\*/g, ''), 16, 'bold', [0, 0, 0], 'center');
            y += 5; 
            continue;
        }
         if (trimmedLine.startsWith('### ')) {
            addPageIfNeeded(15);
            printText(trimmedLine.substring(4).replace(/\*\*/g, ''), 14, 'bold', [44, 62, 80]);
            y += 3; 
            continue;
        }

        if (trimmedLine.startsWith('**PART') || trimmedLine.match(/^\d+\]\s/) || trimmedLine.match(/^[IVX]+\.\s/)) {
            addPageIfNeeded(15);
            printText(trimmedLine.replace(/\*\*/g, ''), 12, 'bold');
            doc.setLineWidth(0.5);
            doc.line(margin, y - 2, pageWidth - margin, y - 2); 
            y += 5; 
            continue;
        }
       
        if (/^\d+\.\s+/.test(trimmedLine) || /^-+\s+/.test(trimmedLine)) {
            const listItemText = trimmedLine.replace(/^\d+\.\s+/, '').replace(/^-+\s+/, '');
            printText(`• ${listItemText.replace(/\*\*(.*?)\*\*/g, '$1')}`, 10);
            y -= 2; 
            continue;
        }

        if (trimmedLine !== '') {
            printText(line.replace(/\*\*(.*?)\*\*/g, '$1'), 11);
        } else {
             y += 4;
        }
    }
    
    addPageIfNeeded(30);
    doc.text(`Adv. ${user.name}`, pageWidth - margin, pageHeight - margin - 10, { align: 'right' });
};

type SortKey = 'fileName' | 'uploadDate' | 'status' | 'docTypes';
type SortDirection = 'asc' | 'desc';

interface ToastState {
  show: boolean;
  message: string;
  type: 'info' | 'success' | 'error';
}

export const ProjectView: React.FC<ProjectViewProps> = ({ project, user, onUpdateProject, onUploadDocuments, onDeleteDocument, onUpdateDocumentType, onBack, onTriggerProjectDetailExtraction, isExtractingProjectDetails, checkApiAllowance }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [isDownloadingPdfReport, setIsDownloadingPdfReport] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewingDocument, setViewingDocument] = useState<Document | null>(null);
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'info' });
  const [docTypeFilter, setDocTypeFilter] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    projectName: project.projectName,
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    searchPeriod: project.searchPeriod,
    advocateInstructions: project.advocateInstructions || '',
  });

  const [selectedReportFormat, setSelectedReportFormat] = useState<string>(REPORT_FORMATS[0]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setFormData({
        projectName: project.projectName,
        propertyAddress: project.propertyAddress,
        clientName: project.clientName,
        searchPeriod: project.searchPeriod,
        advocateInstructions: project.advocateInstructions || '',
      });
    }
  }, [project, isEditing]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveDetails = () => {
    const instructionsChanged = formData.advocateInstructions !== project.advocateInstructions;
    onUpdateProject({ ...project, ...formData });
    setIsEditing(false);
    setToast({ show: true, message: 'Project details updated!', type: 'success' });
    if (instructionsChanged && formData.advocateInstructions.trim().length > 0) {
      onTriggerProjectDetailExtraction(project.id);
    }
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setToast({ show: true, message: 'Generating report...', type: 'info' });
    const allText = project.documents
          .filter(d => d.status === 'Processed' && d.extractedText)
          .map(d => `--- Document: ${d.fileName} ---\n${d.extractedText}`)
          .join('\n\n') || '';
    const estimatedInputTokens = Math.ceil(allText.length / 4) + 5000;
    const estimatedOutputTokens = 10000;

    if (!(await checkApiAllowance('STR_GEN')) || !(await checkApiAllowance('TOKENS_INPUT', estimatedInputTokens)) || !(await checkApiAllowance('TOKENS_OUTPUT', estimatedOutputTokens))) {
      setIsGenerating(false);
      return;
    }

    try {
      const result = await generateReport(user.id, project, user, selectedReportFormat); 
      if (result.error) {
        setToast({ show: true, message: `Report generation failed: ${result.error}`, type: 'error' });
      } else {
        onUpdateProject({ ...project, report: { 
          id: `report_${Date.now()}`,
          projectId: project.id,
          generatedAt: new Date().toISOString(),
          status: 'Finalized',
          content: result.content || '',
          strCategory: result.strCategory,
          summary: result.summary,
          riskFlags: result.riskFlags,
          ruleEngineFlags: {},
          reportFormatUsed: selectedReportFormat,
        }});
        setToast({ show: true, message: 'Report generated successfully!', type: 'success' });
      }
    } catch (error) {
      console.error("Error during report generation:", error);
      setToast({ show: true, message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadReport = () => {
    if (!project.report?.content) return;
    setIsDownloadingReport(true);
    try {
        const markdownContent = project.report.content;
        const htmlBody = generateWordHtmlFromMarkdown(markdownContent); 
        const fullHtml = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset='utf-8'><title>Report</title>
            <style>
              body { font-family: 'Times New Roman', serif; font-size: 12pt; }
              table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
              td, th { border: 1px solid black; padding: 5px; vertical-align: top; }
              h1, h2, h3, h4 { color: #2E74B5; }
              ul, ol { margin-left: 20px; }
            </style>
            </head><body>${htmlBody}</body></html>`;
        const blob = new Blob([fullHtml], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.projectName.replace(/\s+/g, '_')}_Legal_Report.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setToast({ show: true, message: 'Report download initiated!', type: 'success' });
    } catch (error) {
        setToast({ show: true, message: `Download failed: ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
    } finally {
        setIsDownloadingReport(false);
    }
  };

  const handleDownloadPdfReport = () => {
    const contentToPrint = project.report?.content; 
    if (!contentToPrint) return;
    setIsDownloadingPdfReport(true);
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      renderMarkdownContentToPdf(doc, contentToPrint, user, false, "Legal Scrutiny Report");
      doc.save(`${project.projectName.replace(/\s+/g, '_')}_Legal_Report_PDF.pdf`);
      setToast({ show: true, message: 'PDF download initiated!', type: 'success' });
    } catch (error) {
      setToast({ show: true, message: `PDF failed: ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
    } finally {
      setIsDownloadingPdfReport(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUploadDocuments(project.id, Array.from(e.target.files));
      setToast({ show: true, message: `Uploading ${e.target.files.length} document(s)...`, type: 'info' });
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const filteredDocuments = docTypeFilter ? project.documents.filter(doc => doc.docTypes?.includes(docTypeFilter)) : project.documents;

  const sortedDocuments = [...filteredDocuments].sort((a, b) => {
    if (sortKey === 'fileName') return sortDirection === 'asc' ? a.fileName.localeCompare(b.fileName) : b.fileName.localeCompare(a.fileName);
    if (sortKey === 'uploadDate') return sortDirection === 'asc' ? new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime() : new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
    if (sortKey === 'status') {
        const statusOrder = ['Uploading', 'Uploaded', 'Extracting Text', 'Classifying', 'Processed', 'Error', 'Unsupported'];
        return sortDirection === 'asc' ? statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) : statusOrder.indexOf(b.status) - statusOrder.indexOf(a.status);
    }
    if (sortKey === 'docTypes') {
        const typeA = (a.docTypes && a.docTypes.length > 0) ? a.docTypes[0] : '';
        const typeB = (b.docTypes && b.docTypes.length > 0) ? b.docTypes[0] : '';
        return sortDirection === 'asc' ? typeA.localeCompare(typeB) : typeB.localeCompare(typeA);
    }
    return 0;
  });

  const allDocTypes = Array.from(new Set(project.documents.flatMap(doc => doc.docTypes || [])));

  return (
    <div className="relative p-6 bg-white rounded-lg shadow-md">
      <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors" aria-label="Back to dashboard">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
      </button>
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-brand-dark">{project.projectName}</h1>
        <p className="text-gray-600">{project.propertyAddress}</p>
      </div>

      <Card className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-brand-dark">Project Details</h2>
          {isEditing ? (
            <button onClick={handleSaveDetails} className="px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary transition-colors">Save</button>
          ) : (
            <button onClick={() => setIsEditing(true)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors">Edit</button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
          <div>
            <label className="block text-sm font-medium text-gray-500">Project Name</label>
            {isEditing ? <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" /> : <p className="mt-1 text-lg font-semibold">{project.projectName}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Property Address</label>
            {isEditing ? <input type="text" name="propertyAddress" value={formData.propertyAddress} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" /> : <p className="mt-1 text-lg font-semibold">{project.propertyAddress}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Client Name</label>
            {isEditing ? <input type="text" name="clientName" value={formData.clientName} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" /> : <p className="mt-1 text-lg font-semibold">{project.clientName}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Search Period</label>
            {isEditing ? <input type="text" name="searchPeriod" value={formData.searchPeriod} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" /> : <p className="mt-1 text-lg font-semibold">{project.searchPeriod}</p>}
          </div>
           <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-500">Advocate Instructions (For Factual Refinement)</label>
            {isEditing ? <textarea name="advocateInstructions" value={formData.advocateInstructions} onChange={handleInputChange} rows={3} placeholder="e.g. Include reference to specific court case No. 123 in the Flow of Title section." className="mt-1 block w-full border-gray-300 rounded-md shadow-sm"></textarea> : <p className="mt-1 text-lg font-semibold whitespace-pre-wrap">{project.advocateInstructions || 'No specific instructions.'}</p>}
            <p className="mt-1 text-xs text-gray-500 italic">Instructions will refine extracted facts within standard bank sub-heads without overriding the structural layout.</p>
          </div>
        </div>
        <div className="mt-6">
            <label className="block text-sm font-medium text-gray-500">Identified Scenario</label>
            <p className="mt-1 text-lg font-semibold text-brand-secondary">{SCENARIOS[project.scenario || 'UNKNOWN'].name}</p>
            <button onClick={() => onTriggerProjectDetailExtraction(project.id)} disabled={isExtractingProjectDetails} className="mt-3 px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary transition-colors disabled:opacity-50 text-sm">
              {isExtractingProjectDetails ? <Spinner size="sm" /> : 'Re-extract Project Details'}
            </button>
        </div>
      </Card>

      <Card className="mb-6 mt-6">
        <h2 className="text-xl font-bold text-brand-dark mb-4">Documents</h2>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 space-y-3 sm:space-y-0 sm:space-x-4">
          <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)} className="mt-1 block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary sm:text-sm rounded-md">
            <option value="">All Document Types</option>
            {allDocTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*,.pdf,.csv,.docx" className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-brand-secondary text-white font-bold rounded-lg shadow-sm hover:bg-brand-primary transition-colors flex items-center">
            Upload Documents
          </button>
        </div>

        {project.documents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No documents uploaded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('fileName')}>File Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('docTypes')}>Doc Type(s)</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('status')}>Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('uploadDate')}>Upload Date</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 truncate max-w-xs">{doc.fileName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{(doc.docTypes && doc.docTypes.length > 0) ? doc.docTypes.join(', ') : 'Unclassified'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${doc.status === 'Processed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{doc.status}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{new Date(doc.uploadDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button onClick={() => setViewingDocument(doc)} className="text-brand-secondary hover:text-brand-primary" disabled={!doc.extractedText}>View Text</button>
                        <button onClick={() => onDeleteDocument(project.id, doc.id)} className="text-red-600 hover:text-red-900">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      
      {project.report && <ReportSummaryCard report={project.report} />}

      <Card className="mb-6 mt-6">
        <h2 className="text-xl font-bold text-brand-dark mb-4">Generate Report</h2>
        <div className="flex flex-col md:flex-row items-stretch md:items-center space-y-4 md:space-y-0 md:space-x-4">
          <select value={selectedReportFormat} onChange={(e) => setSelectedReportFormat(e.target.value)} className="block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary sm:text-sm rounded-md flex-grow">
            {REPORT_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}
          </select>
          <button onClick={handleGenerateReport} disabled={isGenerating || project.documents.filter(d => d.status === 'Processed').length === 0} className="px-6 py-2 bg-brand-secondary text-white font-bold rounded-lg shadow-sm hover:bg-brand-primary transition-colors disabled:opacity-50 min-w-[150px]">
            {isGenerating ? <Spinner size="sm" /> : 'Generate Report'}
          </button>
        </div>
      </Card>

      {project.report?.content && (
        <Card className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-brand-dark">Generated Report ({project.report.reportFormatUsed})</h2>
            <div className="flex space-x-2">
                <button onClick={handleDownloadPdfReport} disabled={isDownloadingPdfReport} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50">PDF</button>
                <button onClick={handleDownloadReport} disabled={isDownloadingReport} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50">DOC</button>
            </div>
          </div>
          <ReportDisplay reportContent={project.report.content || ''} />
        </Card>
      )}

      <DocumentTextViewModal document={viewingDocument} onClose={() => setViewingDocument(null)} />
      {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, show: false })} />}
    </div>
  );
};
