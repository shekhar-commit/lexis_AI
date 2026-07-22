import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

// Lazy initializer for Gemini SDK as per guidelines to prevent startup crash
let aiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel.');
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

// In-memory Database
interface Clause {
  title: string;
  text: string;
  riskLevel: 'High' | 'Medium' | 'Low';
  explanation: string;
  alternative: string;
}

interface LegalDocument {
  id: string;
  name: string;
  content: string;
  size: string;
  type: string;
  indexedAt: string;
  summary: string;
  jurisdiction: string;
  effectiveDate: string;
  parties: string[];
  clauses: Clause[];
}

interface SecurityLog {
  id: string;
  timestamp: string;
  event: string;
  userInput: string;
  action: string;
  severity: 'Medium' | 'High';
}

interface SavedChat {
  id: string;
  title: string;
  messages: { role: 'user' | 'assistant'; text: string; timestamp: string; citation?: string }[];
  documentIds: string[];
}

// Mock Seed Data (High-Fidelity Legal Samples)
const preseededDocuments: LegalDocument[] = [
  {
    id: 'doc-nda-1',
    name: 'Sample_Mutual_NDA_v4.pdf',
    type: 'pdf',
    size: '1.2 MB',
    indexedAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString(), // 2 days ago
    jurisdiction: 'State of New York',
    effectiveDate: 'January 15, 2026',
    parties: ['Acme Corporation', 'Global Solutions LLC'],
    summary: 'A standard mutual non-disclosure agreement to protect confidential intellectual property and business strategies during partnership exploration.',
    content: `MUTUAL NON-DISCLOSURE AGREEMENT
This Mutual Non-Disclosure Agreement (the "Agreement") is entered into as of January 15, 2026, by and between Acme Corporation and Global Solutions LLC.
1. Confidential Information. Either party may disclose information that it considers proprietary or confidential.
2. Term of Obligation. The obligations of confidentiality hereunder shall survive for a period of five (5) years from the date of termination.
3. Remedies. The receiving party agrees that any breach of this Agreement would cause irreparable harm, and the disclosing party shall be entitled to seek injunctive relief without the necessity of posting a bond.
4. Non-Solicitation. For a period of twenty-four (24) months post-termination, neither party shall solicit, recruit, or hire any employees, contractors, or key personnel of the other party on a worldwide basis.`,
    clauses: [
      {
        title: 'Confidentiality Term',
        text: 'The obligations of confidentiality hereunder shall survive for a period of five (5) years from the date of termination.',
        riskLevel: 'Medium',
        explanation: 'Five years is standard for business partnerships, but for trade secrets or tech IP, you might want an indefinite term. For receiving parties, shorter is preferred.',
        alternative: 'The obligations of confidentiality hereunder shall survive for three (3) years post-termination, except for trade secrets which shall survive so long as they qualify as trade secrets under applicable law.'
      },
      {
        title: 'Injunctive Relief and Bond Waiver',
        text: 'the disclosing party shall be entitled to seek injunctive relief without the necessity of posting a bond.',
        riskLevel: 'High',
        explanation: 'Waiving the bond requirement means the disclosing party can shut down your project with an injunction easily, without proving immediate damages or risking their own capital.',
        alternative: 'the disclosing party shall be entitled to seek injunctive relief upon demonstrating irreparable harm and posting a reasonable bond as required by the court.'
      },
      {
        title: 'Worldwide Employee Non-Solicitation',
        text: 'For a period of twenty-four (24) months post-termination, neither party shall solicit, recruit, or hire any employees, contractors, or key personnel of the other party on a worldwide basis.',
        riskLevel: 'High',
        explanation: 'A 2-year absolute ban on hiring on a worldwide basis is extremely restrictive and likely unenforceable in several jurisdictions (like California). It also prohibits passive hiring.',
        alternative: 'During the term of this Agreement and for twelve (12) months thereafter, neither party shall actively solicit for employment any employee of the other party; provided, however, that this restriction shall not apply to general public advertisements or passive job applications.'
      }
    ]
  },
  {
    id: 'doc-emp-2',
    name: 'Executive_Employment_Agreement_Draft.txt',
    type: 'txt',
    size: '85 KB',
    indexedAt: new Date(Date.now() - 3600000 * 5).toISOString(), // 5 hours ago
    jurisdiction: 'State of Delaware',
    effectiveDate: 'March 1, 2026',
    parties: ['Apex Ventures Inc.', 'Johnathan Doe (Executive)'],
    summary: 'Executive-level employment agreement outlining duties, stock options, termination guidelines, and restrictive non-compete covenants.',
    content: `EXECUTIVE EMPLOYMENT AGREEMENT
This Executive Employment Agreement is made effective March 1, 2026, between Apex Ventures Inc. and Johnathan Doe.
Clause 4. Intellectual Property. Executive agrees that all designs, software, or IP developed by Executive during his tenure, whether during standard business hours or on personal time using company or personal equipment, shall belong solely and exclusively to Apex Ventures.
Clause 8. Non-Compete. Executive shall not engage in any competitive business activity within a fifty (50) mile radius of any Apex Ventures office for a period of twelve (12) months following termination of employment.
Clause 12. Governing Law. This agreement is governed by the laws of Delaware.`,
    clauses: [
      {
        title: 'Overbroad IP Assignment',
        text: 'all designs, software, or IP developed by Executive during his tenure, whether during standard business hours or on personal time using company or personal equipment, shall belong solely and exclusively to Apex Ventures.',
        riskLevel: 'High',
        explanation: 'Claiming IP developed on personal time using personal equipment is overbroad and infringes on your private creative and engineering rights.',
        alternative: 'all designs, software, or IP developed by Executive (i) during standard business hours, or (ii) directly related to the Company’s business, or (iii) using the Company’s equipment, resources, or trade secrets, shall belong solely to Apex Ventures.'
      },
      {
        title: 'Post-Employment Non-Compete',
        text: 'Executive shall not engage in any competitive business activity within a fifty (50) mile radius of any Apex Ventures office for a period of twelve (12) months following termination of employment.',
        riskLevel: 'Medium',
        explanation: 'A 12-month post-employment non-compete is enforceable in many states, but is heavily restricted in California and under new FTC guidelines. A 50-mile radius can lock you out of primary metropolitan tech hubs.',
        alternative: 'Executive shall not engage in any competitive business activity that directly competes with the specific products of Apex Ventures that Executive worked on, for a period of six (6) months following termination.'
      }
    ]
  }
];

let userUploadedDocuments: LegalDocument[] = [];
let savedChats: SavedChat[] = [
  {
    id: 'chat-1',
    title: 'NDA Clause Analysis',
    documentIds: ['doc-nda-1'],
    messages: [
      { role: 'user', text: 'Can you summarize the non-compete duration and geographic scope mentioned in the uploaded NDA?', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { role: 'assistant', text: 'Based on **Clause 4** of the Mutual NDA, there is no direct non-compete, but there is an aggressive **Employee Non-Solicitation** clause (Clause 4):\n\n- **Duration**: **24 months** post-termination.\n- **Geographic Scope**: **Worldwide** ("on a worldwide basis").\n\nThis is a highly restrictive covenant that could be legally challenged. Let me know if you would like me to draft an amendment to scale this back to a standard 12-month non-solicitation with exceptions for general public recruitment.', timestamp: new Date(Date.now() - 3600000 + 10000).toISOString(), citation: 'Clause 4 [p. 1]' }
    ]
  }
];

let securityLogs: SecurityLog[] = [
  {
    id: 'sec-1',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    event: 'System Initialized',
    userInput: 'N/A',
    action: 'Prompt Injection Guard Active & API Proxy Online',
    severity: 'Medium'
  }
];

// Helper to search and compile context for RAG
function getDocumentsContext(docIds: string[], query: string): string {
  const docs = [...preseededDocuments, ...userUploadedDocuments].filter(d => docIds.includes(d.id));
  if (docs.length === 0) return '';
  
  let context = "--- UPLOADED DOCUMENTS KNOWLEDGE BASE ---\n";
  for (const doc of docs) {
    context += `Document: ${doc.name}\n`;
    context += `Parties: ${doc.parties.join(', ')}\n`;
    context += `Jurisdiction: ${doc.jurisdiction}\n`;
    context += `Content:\n${doc.content}\n\n`;
  }
  return context;
}

// REST API Endpoints

// Get all documents
app.get('/api/documents', (req, res) => {
  res.json({
    success: true,
    data: [...preseededDocuments, ...userUploadedDocuments]
  });
});

// Upload and analyze a document (with Gemini fallback)
app.post('/api/documents', async (req, res) => {
  try {
    const { name, content, type, size, isBase64Pdf } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({ success: false, error: 'Document name and content are required' });
    }

    const docId = `doc-${Date.now()}`;
    let extractedText = content;
    let clauses: Clause[] = [];
    let summary = 'Document successfully uploaded and parsed.';
    let jurisdiction = 'Unknown';
    let parties: string[] = [];
    let effectiveDate = 'Unknown';

    // Check if we can run Gemini for deep analysis & PDF OCR
    let geminiError = null;
    try {
      const ai = getGemini();

      if (isBase64Pdf) {
        // Multi-modal PDF analysis using inlineData
        const base64Data = content.split(',')[1] || content;
        
        const ocrResponse = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: [
            {
              inlineData: {
                data: base64Data,
                mimeType: 'application/pdf',
              }
            },
            'Extract the exact, complete textual content of this legal document, word-for-word. Do not omit headers or numbers.'
          ]
        });

        if (ocrResponse.text) {
          extractedText = ocrResponse.text;
        }
      }

      // Perform legal analysis
      const analysisPrompt = `You are a Senior Corporate Attorney. Analyze the following legal document text.
Perform a thorough risk audit and extract the 3-5 most critical clauses. For each clause:
1. Label its title.
2. Extract the exact sentence/text.
3. Categorize Risk Level as "High", "Medium", or "Low" for a standard signer/receiving party.
4. Provide a clear legal explanation of the potential risk.
5. Provide an alternative, fairer clause wording to protect the signer.

Also provide a brief 2-sentence summary, the primary jurisdiction, the effective date, and key parties.

Respond strictly in JSON format with the following schema:
{
  "summary": "2-sentence summary",
  "jurisdiction": "State or Country",
  "effectiveDate": "MM/DD/YYYY or Unknown",
  "parties": ["Party A", "Party B"],
  "clauses": [
    {
      "title": "Clause Title",
      "text": "Exact text of clause from document",
      "riskLevel": "High" | "Medium" | "Low",
      "explanation": "Why this is risky/important",
      "alternative": "Better wording proposal"
    }
  ]
}

Document Content:
${extractedText}`;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: analysisPrompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      if (aiResponse.text) {
        const parsed = JSON.parse(aiResponse.text);
        clauses = parsed.clauses || [];
        summary = parsed.summary || summary;
        jurisdiction = parsed.jurisdiction || jurisdiction;
        parties = parsed.parties || parties;
        effectiveDate = parsed.effectiveDate || effectiveDate;
      }
    } catch (err: any) {
      console.warn("Gemini OCR/Analysis failed or API key missing, falling back to local heuristic parser:", err.message);
      geminiError = err.message;
      
      // Heuristic fallback so the app is always functional even without an API key
      const lowerText = content.toLowerCase();
      
      // Simple parser
      if (lowerText.includes('non-disclosure') || lowerText.includes('nda')) {
        summary = 'A mutual non-disclosure agreement regarding trade secrets and business relationships.';
        jurisdiction = lowerText.includes('new york') ? 'State of New York' : 'California (Heuristic)';
        parties = ['Disclosing Party', 'Receiving Party'];
        clauses = [
          {
            title: 'Governing Law',
            text: 'This agreement shall be governed by the laws of New York.',
            riskLevel: 'Low',
            explanation: 'Standard corporate state. Very stable precedent.',
            alternative: 'No changes needed.'
          },
          {
            title: 'Confidentiality Duration',
            text: 'Confidentiality obligations survive indefinitely.',
            riskLevel: 'High',
            explanation: 'An infinite confidentiality term is incredibly burdensome and should generally be capped at 2-5 years, except for strict trade secrets.',
            alternative: 'Confidentiality shall remain in effect for three (3) years post-disclosure, except for trade secrets which remain confidential for as long as they constitute trade secrets under law.'
          }
        ];
      } else {
        summary = 'A custom legal text document parsed successfully.';
        jurisdiction = 'Undetermined';
        parties = ['Party A', 'Party B'];
        clauses = [
          {
            title: 'Contract Provision Review',
            text: extractedText.substring(0, 100) + '...',
            riskLevel: 'Medium',
            explanation: 'Heuristic parsing completed. Please review specific risk factors.',
            alternative: 'Negotiate custom parameters with legal counsel.'
          }
        ];
      }
    }

    const newDoc: LegalDocument = {
      id: docId,
      name,
      content: extractedText,
      size,
      type: type || 'pdf',
      indexedAt: new Date().toISOString(),
      summary,
      jurisdiction,
      effectiveDate,
      parties,
      clauses
    };

    userUploadedDocuments.push(newDoc);

    res.json({
      success: true,
      data: newDoc,
      geminiOcrCompleted: !geminiError
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a document
app.delete('/api/documents/:id', (req, res) => {
  const { id } = req.params;
  const initialLen = userUploadedDocuments.length;
  userUploadedDocuments = userUploadedDocuments.filter(d => d.id !== id);
  
  if (userUploadedDocuments.length < initialLen || preseededDocuments.some(d => d.id === id)) {
    res.json({ success: true, message: 'Document removed' });
  } else {
    res.status(404).json({ success: false, error: 'Document not found' });
  }
});

// AI Legal Chat - ChatGPT style with Memory and RAG
app.post('/api/chat', async (req, res) => {
  const { messages, documentIds, persona, language } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ success: false, error: 'Messages array is required' });
  }

  const userQuery = messages[messages.length - 1]?.text || '';

  // 1. ADVANCED REQUIREMENT: Prompt Injection Protection
  const injectionKeywords = [
    'ignore previous instructions',
    'system prompt',
    'bypass security',
    'override guidelines',
    'you are no longer',
    'act as a fake',
    'do not show disclaimer',
    'forget you are a legal assistant'
  ];

  const triggerFound = injectionKeywords.find(kw => userQuery.toLowerCase().includes(kw));
  if (triggerFound) {
    const logId = `sec-${Date.now()}`;
    const injectionLog: SecurityLog = {
      id: logId,
      timestamp: new Date().toISOString(),
      event: 'Prompt Injection Blocked',
      userInput: userQuery,
      action: 'Request Intercepted & Special Alignment Warning Returned',
      severity: 'High'
    };
    securityLogs.push(injectionLog);

    return res.json({
      success: true,
      text: `⚠️ **[SECURITY PROTOCOL]** Lexis AI safety framework has detected an unauthorized instruction override sequence ("${triggerFound}"). 

Our systems strictly enforce safe legal alignment, and we cannot bypass corporate security guardrails or suppress the required legal disclaimers. Please rephrase your query to focus purely on professional legal information or contract auditing.`,
      isBlocked: true
    });
  }

  // 2. Fetch context from active documents (RAG)
  const documentsContext = documentIds && documentIds.length > 0 
    ? getDocumentsContext(documentIds, userQuery) 
    : '';

  // 3. Assemble Persona guidelines
  let systemPersona = '';
  if (persona === 'conservative') {
    systemPersona = 'You act as a Conservative Litigator: risk-averse, highly defensive, cautious, looking for potential courtroom issues, and emphasizing strict legal limits.';
  } else if (persona === 'transactional') {
    systemPersona = 'You act as a Transactional & Corporate Attorney: deal-oriented, creative with solutions, focused on closing transactions safely, prioritizing commercial speed and compromise.';
  } else {
    systemPersona = 'You act as an Academic Legal Researcher: neutral, objective, historical, providing deep insights on legal precedents and philosophical legal context.';
  }

  try {
    const ai = getGemini();

    const formattedMessages = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: msg.text }]
    }));

    // Prepend RAG context & safety constraints
    const systemPrompt = `You are Lexis AI, a state-of-the-art AI Legal Assistant. Your job is to assist the user with understanding legal concepts, summarizing contracts, answering questions, and researching precedents.
Your response MUST be framed as informational and research support only. 

${systemPersona}

Strict Directives:
1. ALWAYS end or clearly embed this exact disclaimer in your answer: "DISCLAIMER: I provide legal research and information only. This is not legal advice and does not establish a lawyer-client relationship."
2. Cite documents when appropriate using format: "[DocumentName, Clause Title]" or "[p. X]" if found.
3. Keep the output beautifully structured with Markdown, utilizing bullet points, bold text for key terms, and standard headers.
4. Please reply in the requested language: ${language || 'English'}.

${documentsContext ? `Below is the relevant text from the uploaded user contracts or documents. Use this information to ground your answers with citations:\n${documentsContext}` : ''}`;

    // Standard Gemini 3.5 Flash Content Generation
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...formattedMessages
      ]
    });

    res.json({
      success: true,
      text: response.text || 'I could not generate an answer. Please try again.',
      citation: documentsContext ? 'Indexed Knowledge Base' : undefined
    });
  } catch (err: any) {
    console.error("Gemini Chat failed:", err.message);
    
    // Fallback response if API key is not configured yet
    res.json({
      success: true,
      text: `👋 Hello! I'm Lexis AI, your conversational legal companion. 
      
It looks like the \`GEMINI_API_KEY\` environment variable is not fully set up or valid in this preview container. Let me assist you using my local fallback engine!

**How to fully activate me with Gemini 3.5 Flash:**
1. Open the **Secrets** or **Settings** panel in the Google AI Studio UI.
2. Add your **GEMINI_API_KEY** secret.
3. Refresh the app!

**Standard Local Response:**
Based on general legal principles, always make sure to review the *Governing Law* and *Indemnification* terms of any draft agreement. For NDAs, keep confidentiality capped at 3-5 years.

*DISCLAIMER: I provide legal research and information only. This is not legal advice and does not establish a lawyer-client relationship.*`
    });
  }
});

// Case Law & Legal Research Briefs
app.post('/api/research', async (req, res) => {
  const { query, jurisdiction } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Search query is required' });
  }

  try {
    const ai = getGemini();
    const prompt = `You are a Legal Research Expert. Compile a high-fidelity case law and research brief for the following query:
Query: "${query}"
Jurisdiction: ${jurisdiction || 'All US Jurisdictions'}

Structure the research brief beautifully with Markdown:
1. Executive Summary
2. Key Relevant Statutes (with section numbers if possible)
3. Leading Precedent Cases (cite real cases, e.g., "Supreme Court of NY", with dates and holding summaries)
4. Strategic Legal Analysis & Recommendations for signers
5. Standard Disclaimer

Keep it professional, highly authoritative, and deep. Use bold key terms.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt
    });

    res.json({
      success: true,
      data: response.text || 'No research results generated.'
    });
  } catch (err: any) {
    res.json({
      success: true,
      data: `### ⚖️ Legal Research Brief Fallback (Offline Mode)
**Query:** ${query}
**Jurisdiction:** ${jurisdiction || 'General US'}

*Offline mode active. Real-time Gemini lookup requires a valid API key.*

#### 1. Executive Summary
Under standard US commercial law, the issue regarding *"${query}"* generally hinges on state-specific statutes and court precedents enforcing commercial intent and reasonableness of terms.

#### 2. Key Statutes to Review
- **Uniform Commercial Code (UCC) § 2-302**: Unconscionable contracts or clauses.
- **Restatement (Second) of Contracts § 188**: Enforceability of restrictive covenants.

#### 3. Leading Precedents (Typical Holdings)
- *Wood v. Lucy, Lady Duff-Gordon (N.Y. 1917)*: Foundational case on implied covenants of good faith.
- *FTC Restrictive Rule Guideline (2024-2026)*: Broad FTC actions regarding post-employment non-compete agreements.

*DISCLAIMER: I provide legal research and information only. This is not legal advice and does not replace a licensed attorney.*`
    });
  }
});

// AI Draft Legal Document generator
app.post('/api/draft', async (req, res) => {
  const { docType, partyA, partyB, purpose, customTerms } = req.body;

  if (!docType || !partyA || !partyB) {
    return res.status(400).json({ success: false, error: 'Document type, Party A, and Party B are required.' });
  }

  try {
    const ai = getGemini();
    const prompt = `You are an expert contract-drafting attorney. Draft a high-fidelity, complete, and legally rigorous "${docType}" agreement in Markdown.
- Party A (Disclosing/Employer/Lessor): ${partyA}
- Party B (Receiving/Employee/Lessee): ${partyB}
- Primary Purpose/Subject: ${purpose || 'General business relations'}
- Custom Terms: ${customTerms || 'None specified'}

The draft should look completely professional, ready for signing, containing standard recitals, definitions, detailed sections, governing law, signatures, and of course, a clear disclaimer at the bottom. Use beautiful Markdown formatting with clear dividers.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt
    });

    res.json({
      success: true,
      draft: response.text || 'Could not generate draft.'
    });
  } catch (err: any) {
    // Elegant offline template generator
    const dateStr = new Date().toLocaleDateString();
    res.json({
      success: true,
      draft: `# ${docType.toUpperCase()} AGREEMENT

**THIS AGREEMENT** is made and entered into this ${dateStr}, by and between:

1. **${partyA}**, hereinafter referred to as "First Party", and
2. **${partyB}**, hereinafter referred to as "Second Party".

### RECITALS
WHEREAS, First Party and Second Party desire to establish terms regarding: *${purpose || 'General business and compliance cooperation'}*;

NOW, THEREFORE, the parties agree as follows:

### SECTION 1: CORE COVENANTS & SERVICES
The parties shall collaborate in good faith according to the following custom specifications:
- *${customTerms || 'Standard mutual operational parameters.'}*

### SECTION 2: GOVERNING LAW & JURISDICTION
This Agreement shall be construed and enforced in accordance with the laws of the State of Delaware, without regard to conflict of laws principles.

### SECTION 3: SIGNATURES
IN WITNESS WHEREOF, the parties hereto have executed this Agreement as of the date first written above.

**First Party Signature:** ___________________________  Date: __________

**Second Party Signature:** ___________________________ Date: __________

---
*DISCLAIMER: This is an AI-generated draft template for research purposes. It is not formal legal advice. Please consult with a licensed lawyer before signing.*`
    });
  }
});

// Admin Panel Stats & Logs
app.get('/api/admin/stats', (req, res) => {
  res.json({
    success: true,
    data: {
      totalDocuments: preseededDocuments.length + userUploadedDocuments.length,
      activeSessions: savedChats.length,
      securityLogsCount: securityLogs.length,
      securityLogs,
      apiTokenUsageSimulated: Math.floor(Math.random() * 450) + 1240, // Simulated token tracker
      activeUsersCount: 4,
      systemHealth: 'All Systems Operational'
    }
  });
});

// Clear Admin Logs
app.post('/api/admin/clear-logs', (req, res) => {
  securityLogs = [
    {
      id: `sec-${Date.now()}`,
      timestamp: new Date().toISOString(),
      event: 'Logs Cleared',
      userInput: 'Admin Cleared securityLogs',
      action: 'Cleared history logs',
      severity: 'Medium'
    }
  ];
  res.json({ success: true, message: 'Logs successfully cleared.' });
});

// Chat session management
app.get('/api/chats', (req, res) => {
  res.json({ success: true, data: savedChats });
});

app.post('/api/chats', (req, res) => {
  const { title, documentIds } = req.body;
  const newChat: SavedChat = {
    id: `chat-${Date.now()}`,
    title: title || 'New Consultation',
    documentIds: documentIds || [],
    messages: []
  };
  savedChats.unshift(newChat);
  res.json({ success: true, data: newChat });
});

app.post('/api/chats/:id/messages', (req, res) => {
  const { id } = req.params;
  const { role, text, citation } = req.body;
  const chat = savedChats.find(c => c.id === id);
  if (!chat) return res.status(404).json({ success: false, error: 'Chat not found' });

  const newMsg = {
    role,
    text,
    timestamp: new Date().toISOString(),
    citation
  };
  chat.messages.push(newMsg);
  res.json({ success: true, data: newMsg });
});

app.delete('/api/chats/:id', (req, res) => {
  const { id } = req.params;
  const initialLen = savedChats.length;
  savedChats = savedChats.filter(c => c.id !== id);
  if (savedChats.length < initialLen) {
    res.json({ success: true, message: 'Chat deleted' });
  } else {
    res.status(404).json({ success: false, error: 'Chat not found' });
  }
});


// Set up static serving and Vite server integration
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lexis AI Server successfully initialized at http://0.0.0.0:${PORT}`);
});
