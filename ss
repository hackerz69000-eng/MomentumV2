warning: in the working copy of 'ASSIGNMENT_HELPER_GUIDED_WORKSPACE_NOTES.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/lib/writing.functions.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/routes/_authenticated/assignment.$id.tsx', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/ASSIGNMENT_HELPER_GUIDED_WORKSPACE_NOTES.md b/ASSIGNMENT_HELPER_GUIDED_WORKSPACE_NOTES.md[m
[1mindex 02531ae..aecf482 100644[m
[1m--- a/ASSIGNMENT_HELPER_GUIDED_WORKSPACE_NOTES.md[m
[1m+++ b/ASSIGNMENT_HELPER_GUIDED_WORKSPACE_NOTES.md[m
[36m@@ -28,3 +28,12 @@[m
 ## Verification for open-ended assignment help[m
 [m
 - Reviewed the modified server and UI code paths. A full TypeScript build and automated test suite have not been run in this environment because project dependencies are not installed.[m
[32m+[m
[32m+[m[32m## Final usability and accessibility pass[m
[32m+[m
[32m+[m[32m- The Ask for help tab now includes starter-question chips, speaker labels, a visible response-loading state, and automatic scrolling to the newest conversation content.[m
[32m+[m[32m- The question composer is a multiline textarea with a 3,000-character limit, a live character count, Enter-to-send, and Shift+Enter for a new line.[m
[32m+[m[32m- Added tab/tabpanel relationships and selected-tab keyboard focus semantics for clearer assistive-technology navigation.[m
[32m+[m[32m- The tutor can now answer a question even when assignment instructions have not been entered yet. It is instructed to be transparent that it has not seen the prompt and still help from the student's question rather than refusing outright.[m
[32m+[m[32m- Persisted chat history is filtered to valid user/assistant messages before it is passed back to the model.[m
[32m+[m[32m- Validation: TypeScript transpilation/syntax checks passed for all 161 `.ts`/`.tsx` source files. A full typecheck, production build, lint, automated test suite, and live model round-trip remain unverified because dependencies could not be installed in this environment.[m
[1mdiff --git a/src/lib/writing.functions.ts b/src/lib/writing.functions.ts[m
[1mindex 62696a0..d9b0d36 100644[m
[1m--- a/src/lib/writing.functions.ts[m
[1m+++ b/src/lib/writing.functions.ts[m
[36m@@ -67,9 +67,9 @@[m [mexport const assignmentStep = createServerFn({ method: "POST" })[m
     const sb = context.supabase;[m
     const { data: a, error } = await sb.from("assignments").select("*").eq("id", data.id).single();[m
     if (error || !a) throw new Error("Assignment not found");[m
[31m-    if (!a.instructions.trim()) throw new Error("Add the assignment instructions first.");[m
[32m+[m[32m    if (data.step !== "feedback" && !a.instructions.trim()) throw new Error("Add the assignment instructions first.");[m
     const mat = await setContext(sb, a.set_id);[m
[31m-    const brief = `ASSIGNMENT INSTRUCTIONS:\n${clip(a.instructions, 12000)}\n\nEXISTING SEPARATE RUBRIC FIELD (optional legacy field; also inspect the assignment instructions for rubric criteria):\n${clip(a.rubric || "(no separate rubric field; inspect the instructions for assessment criteria)", 8000)}\n\nSOURCE MATERIAL AND SCOPE LIMITS:\n${formatAssignmentSources(a.sources || "", 36000)}\n\nSTUDENT'S OWN IDEAS / NOTES:\n${clip(a.ideas || "(none yet)", 6000)}${mat.text}`;[m
[32m+[m[32m    const brief = `ASSIGNMENT INSTRUCTIONS:\n${clip(a.instructions || "(not provided yet; help with the context the student shares and ask for the prompt only when it is necessary)", 12000)}\n\nEXISTING SEPARATE RUBRIC FIELD (optional legacy field; also inspect the assignment instructions for rubric criteria):\n${clip(a.rubric || "(no separate rubric field; inspect the instructions for assessment criteria)", 8000)}\n\nSOURCE MATERIAL AND SCOPE LIMITS:\n${formatAssignmentSources(a.sources || "", 36000)}\n\nSTUDENT'S OWN IDEAS / NOTES:\n${clip(a.ideas || "(none yet)", 6000)}${mat.text}`;[m
     const now = new Date().toISOString();[m
 [m
     if (data.step === "understand") {[m
[36m@@ -180,15 +180,14 @@[m [mIf the brainstorm is empty, still help using the prompt and supplied material. R[m
     }[m
     // Open-ended assignment help: students can ask questions before or after drafting.[m
     const q = (data.question ?? "").trim() || "Can you help me figure out the best next step for this assignment?";[m
[31m-    const chat = (Array.isArray(a.chat) ? a.chat : []) as {[m
[31m-      role: "user" | "assistant";[m
[31m-      content: string;[m
[31m-    }[];[m
[32m+[m[32m    const chat = (Array.isArray(a.chat) ? a.chat : [])[m
[32m+[m[32m      .filter((message: any) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")[m
[32m+[m[32m      .slice(-8) as { role: "user" | "assistant"; content: string }[];[m
     const out = await aiText([m
       `${TEACH}[m
 You are also the student's open-ended assignment tutor. Answer the student's actual question directly, even if they have not started a draft. They may ask about the prompt, concepts, terminology, planning, brainstorming, thesis ideas, structure, evidence, citations, research strategy, interpreting feedback, time management, or any other issue related to completing this assignment. Do not force every answer into draft feedback or a fixed template.[m
 [m
[31m-Use the supplied assignment instructions, rubric, permitted sources, student notes, chosen argument, outline, brainstorm, and draft when relevant. If a question can be answered from the provided context, answer it clearly and practically. If it depends on missing information, say what is missing and still provide the help that is supported. Clearly distinguish facts from supplied materials, general knowledge, and suggestions. Never invent citations, page numbers, quotes, source claims, teacher requirements, or grading outcomes. Respect source restrictions. Explain difficult ideas in plain language, use examples when useful, and break complicated tasks into manageable steps. When asked to improve the student's own work, give specific guidance and brief illustrative phrases rather than silently replacing their voice or writing the whole assignment. If the student asks a broad question, offer a useful starting answer and one focused follow-up only if needed. Use readable Markdown with headings and lists where helpful; no tables, raw HTML, pipe-delimited layouts, or <br> tags. Keep the response proportional to the question.[m
[32m+[m[32mUse the supplied assignment instructions, rubric, permitted sources, student notes, chosen argument, outline, brainstorm, and draft when relevant. If a question can be answered from the provided context, answer it clearly and practically. If assignment instructions are not provided, do not refuse to help: answer using the student's question and general knowledge, make clear that you have not seen the prompt, and ask them to share it only if needed for a precise answer. If it depends on missing information, say what is missing and still provide the help that is supported. Clearly distinguish facts from supplied materials, general knowledge, and suggestions. Never invent citations, page numbers, quotes, source claims, teacher requirements, or grading outcomes. Respect source restrictions. Explain difficult ideas in plain language, use examples when useful, and break complicated tasks into manageable steps. When asked to improve the student's own work, give specific guidance and brief illustrative phrases rather than silently replacing their voice or writing the whole assignment. If the student asks a broad question, offer a useful starting answer and one focused follow-up only if needed. Use readable Markdown with headings and lists where helpful; no tables, raw HTML, pipe-delimited layouts, or <br> tags. Keep the response proportional to the question.[m
 [m
 ASSIGNMENT CONTEXT:[m
 ${brief}[m
[1mdiff --git a/src/routes/_authenticated/assignment.$id.tsx b/src/routes/_authenticated/assignment.$id.tsx[m
[1mindex 5ad06f7..756c5c3 100644[m
[1m--- a/src/routes/_authenticated/assignment.$id.tsx[m
[1m+++ b/src/routes/_authenticated/assignment.$id.tsx[m
[36m@@ -2,7 +2,7 @@[m [mimport { createFileRoute, Link } from "@tanstack/react-router";[m
 import { MarkdownContent } from "@/components/MarkdownContent";[m
 import { useQuery, useQueryClient } from "@tanstack/react-query";[m
 import { useServerFn } from "@tanstack/react-start";[m
[31m-import { useState } from "react";[m
[32m+[m[32mimport { useEffect, useRef, useState } from "react";[m
 import { ArrowLeft, BookOpen, CheckCircle2, Clock3, FileText, FileUp, Loader2, Send, ShieldCheck, Trash2 } from "lucide-react";[m
 import { toast } from "sonner";[m
 import { ocrFile } from "@/lib/study.functions";[m
[36m@@ -24,7 +24,7 @@[m [mexport const Route = createFileRoute("/_authenticated/assignment/$id")({[m
       {[m
         name: "description",[m
         content:[m
[31m-          "Work through your assignment step by step: understand it, brainstorm, outline and get draft feedback.",[m
[32m+[m[32m          "Plan assignments step by step or ask Momentum for help with any assignment question.",[m
       },[m
       { property: "og:title", content: "Assignment — Momentum" },[m
       { property: "og:description", content: "Step-by-step assignment guidance." },[m
[36m@@ -144,9 +144,14 @@[m [mfunction Editor({ row }: { row: Row }) {[m
     (Array.isArray(row.chat) ? row.chat : []) as { role: string; content: string }[],[m
   );[m
   const [tab, setTab] = useState<"understanding" | "brainstorm" | "outline">("understanding");[m
[32m+[m[32m  const [workspaceView, setWorkspaceView] = useState<"guide" | "help">("guide");[m
   const [busy, setBusy] = useState<string | null>(null);[m
   const [error, setError] = useState<string | null>(null);[m
   const [question, setQuestion] = useState("");[m
[32m+[m[32m  const chatEndRef = useRef<HTMLDivElement | null>(null);[m
[32m+[m[32m  useEffect(() => {[m
[32m+[m[32m    if (workspaceView === "help") chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });[m
[32m+[m[32m  }, [chat, workspaceView, busy]);[m
   const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));[m
   const sourceBundle = parseSourceBundle(f.sources);[m
   const timeSuggestions = getAssignmentTimeSuggestions(f.instructions);[m
[36m@@ -311,6 +316,18 @@[m [mfunction Editor({ row }: { row: Row }) {[m
           <div className="rounded-xl bg-cool/5 border border-cool/15 p-3 text-xs text-soft flex gap-2"><ShieldCheck className="size-4 shrink-0 text-cool2" /><p>Only assignment instructions are needed to begin. Sources, your ideas and your draft are optional and can be added later. If your instructions contain a rubric, Momentum should identify it automatically; you don't need a separate rubric field.</p></div>[m
         </section>[m
         <section className="space-y-4 min-w-0">[m
[32m+[m[32m          <div className="rounded-2xl border border-line/70 bg-panel p-2">[m
[32m+[m[32m            <div role="tablist" aria-label="Assignment workspace" className="grid grid-cols-2 gap-2">[m
[32m+[m[32m              <button type="button" role="tab" id="assignment-tab-guide" aria-controls="assignment-panel-guide" aria-selected={workspaceView === "guide"} tabIndex={workspaceView === "guide" ? 0 : -1} onClick={() => setWorkspaceView("guide")} className={"rounded-xl px-4 py-3 text-sm font-semibold transition-colors " + (workspaceView === "guide" ? "bg-cool/15 text-cool2" : "text-soft hover:bg-foreground/5")}>[m
[32m+[m[32m                <span className="inline-flex items-center justify-center gap-2"><BookOpen className="size-4" /> Plan &amp; outline</span>[m
[32m+[m[32m              </button>[m
[32m+[m[32m              <button type="button" role="tab" id="assignment-tab-help" aria-controls="assignment-panel-help" aria-selected={workspaceView === "help"} tabIndex={workspaceView === "help" ? 0 : -1} onClick={() => setWorkspaceView("help")} className={"rounded-xl px-4 py-3 text-sm font-semibold transition-colors " + (workspaceView === "help" ? "bg-cool/15 text-cool2" : "text-soft hover:bg-foreground/5")}>[m
[32m+[m[32m                <span className="inline-flex items-center justify-center gap-2"><Send className="size-4" /> Ask for help {chat.length ? <span className="rounded-full bg-cool/15 px-1.5 py-0.5 text-[10px]">{Math.ceil(chat.length / 2)}</span> : null}</span>[m
[32m+[m[32m              </button>[m
[32m+[m[32m            </div>[m
[32m+[m[32m          </div>[m
[32m+[m[32m          {error && <ErrorBox msg={error} />}[m
[32m+[m[32m          {workspaceView === "guide" ? <div id="assignment-panel-guide" role="tabpanel" aria-labelledby="assignment-tab-guide"><>[m
           <div className="rounded-2xl border border-line/70 bg-panel p-4 space-y-1">[m
             <p className="eyebrow text-cool2">Your assignment journey</p>[m
             <h2 className="font-display text-xl font-bold">One step at a time</h2>[m
[36m@@ -339,7 +356,6 @@[m [mfunction Editor({ row }: { row: Row }) {[m
               </article>[m
             ))}[m
           </div>[m
[31m-          {error && <ErrorBox msg={error} />}[m
           <div className="rounded-2xl border border-line/70 bg-panel overflow-hidden">[m
             <div className="border-b border-line/60 p-4 space-y-1">[m
               <p className="eyebrow text-cool2">Your workspace</p>[m
[36m@@ -373,11 +389,15 @@[m [mfunction Editor({ row }: { row: Row }) {[m
             placeholder="Already have an argument? Add it here. If not, leave this blank and Momentum will help you explore a suitable direction in the outline."[m
           />[m
           <p className="text-xs text-soft -mt-2">You do not need to decide on your argument before starting. The outline can suggest a provisional direction based on your instructions and brainstorm; you can change it later.</p>[m
[31m-          <div className="rounded-2xl bg-panel border border-line/70 p-4 space-y-3">[m
[31m-            <p className="eyebrow text-cool2">4. Review and improve</p>[m
[31m-            <h3 className="font-semibold">Ask for assignment help</h3>[m
[31m-            <p className="text-sm text-soft">Ask Momentum anything about this assignment—even before you start writing. Get help understanding the prompt, explaining a concept, choosing an approach, planning, finding what evidence you need, citations, structure, or improving a draft. Your assignment instructions and uploaded materials help shape the answer.</p>[m
[31m-            {chat.map((m, i) => ([m
[32m+[m[32m          </></div> : <div id="assignment-panel-help" role="tabpanel" aria-labelledby="assignment-tab-help" className="rounded-2xl bg-panel border border-line/70 p-4 space-y-3">[m
[32m+[m[32m            <p className="eyebrow text-cool2">Assignment tutor</p>[m
[32m+[m[32m            <h3 className="font-display text-xl font-bold">What can I help you with?</h3>[m
[32m+[m[32m            <p className="text-sm text-soft">Ask in your own words about any part of this assignment: what the question means, course concepts, ideas, evidence, research, citations, structure, teacher feedback, or your draft. You can start here even before adding the instructions or writing anything; share context in your question when you can.</p>[m
[32m+[m[32m            {!chat.length && <div className="flex flex-wrap gap-2" aria-label="Example questions">[m
[32m+[m[32m              {["Explain what my assignment is asking", "Help me brainstorm possible ideas", "What should I do first?", "Explain this concept in simple terms"].map((prompt) => <button type="button" key={prompt} onClick={() => setQuestion(prompt)} className="rounded-full border border-line/70 px-3 py-2 text-xs text-soft hover:border-cool2/60 hover:text-foreground">{prompt}</button>)}[m
[32m+[m[32m            </div>}[m
[32m+[m[32m            <div className="max-h-[min(55vh,620px)] min-h-24 overflow-y-auto space-y-3 rounded-xl border border-line/60 p-3" aria-live="polite" aria-relevant="additions text">[m
[32m+[m[32m            {chat.length ? chat.map((m, i) => ([m
               <div[m
                 key={i}[m
                 className={[m
[36m@@ -387,19 +407,31 @@[m [mfunction Editor({ row }: { row: Row }) {[m
               >[m
                 <MarkdownContent>{m.content}</MarkdownContent>[m
               </div>[m
[31m-            ))}[m
[31m-            <div className="flex gap-2">[m
[31m-              <input[m
[31m-                value={question}[m
[31m-                onChange={(e) => setQuestion(e.target.value)}[m
[31m-                placeholder="What do you need help with? Ask anything about this assignment…"[m
[31m-                className={inputCls + " flex-1"}[m
[31m-              />[m
[32m+[m[32m            )) : <p className="px-1 py-4 text-sm text-soft">Your conversation will appear here. Pick a starter question above or ask anything about the assignment.</p>}[m
[32m+[m[32m            {busy === "feedback" && <div className="flex items-center gap-2 rounded-lg bg-foreground/5 p-3 text-sm text-soft" role="status"><Loader2 className="size-4 animate-spin" /> Thinking through your question…</div>}[m
[32m+[m[32m            <div ref={chatEndRef} />[m
[32m+[m[32m            </div>[m
[32m+[m[32m            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!busy && question.trim()) void run("feedback"); }}>[m
[32m+[m[32m              <label className="min-w-0 flex-1 space-y-1">[m
[32m+[m[32m                <span className="text-xs font-medium text-soft">Your question</span>[m
[32m+[m[32m                <textarea[m
[32m+[m[32m                  value={question}[m
[32m+[m[32m                  onChange={(e) => setQuestion(e.target.value)}[m
[32m+[m[32m                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy && question.trim()) void run("feedback"); } }}[m
[32m+[m[32m                  placeholder="Ask anything about this assignment… (Shift+Enter for a new line)"[m
[32m+[m[32m                  className={inputCls + " w-full min-h-20 resize-y"}[m
[32m+[m[32m                  rows={2}[m
[32m+[m[32m                  maxLength={3000}[m
[32m+[m[32m                  aria-describedby="assignment-question-hint"[m
[32m+[m[32m                />[m
[32m+[m[32m                <span id="assignment-question-hint" className="text-[11px] text-soft">Press Enter to send · Shift+Enter for a new line · {question.length}/3000</span>[m
[32m+[m[32m              </label>[m
               <button[m
[32m+[m[32m                type="submit"[m
                 aria-label="Ask for assignment help"[m
[31m-                onClick={() => run("feedback")}[m
                 disabled={!!busy || !question.trim()}[m
                 className={btnPrimary}[m
[32m+[m[32m                title="Send question"[m
               >[m
                 {busy === "feedback" ? ([m
                   <Loader2 className="size-4 animate-spin" />[m
[36m@@ -407,8 +439,8 @@[m [mfunction Editor({ row }: { row: Row }) {[m
                   <Send className="size-4" />[m
                 )}[m
               </button>[m
[31m-            </div>[m
[31m-          </div>[m
[32m+[m[32m            </form>[m
[32m+[m[32m          </div>}[m
         </section>[m
       </div>[m
     </main>[m
