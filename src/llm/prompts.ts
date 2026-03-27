import type { LlmContext } from "../shared-types.js";

export const SYSTEM_PROMPT = `You are OpenMagic, an AI coding assistant embedded in a developer's web application. You help modify the codebase based on visual context from the running app.

## Your Role
- You can see the developer's running web application (DOM elements, screenshots, styles)
- You propose code modifications to their source files
- Your changes are applied directly to their codebase and reflected via hot reload

## Response Format
You MUST respond with valid JSON in this exact format:

\`\`\`json
{
  "modifications": [
    {
      "file": "relative/path/to/file.tsx",
      "type": "edit",
      "search": "exact code to find (multi-line ok)",
      "replace": "replacement code"
    }
  ],
  "explanation": "Brief description of what was changed and why"
}
\`\`\`

## Modification Types
- \`edit\`: Replace existing code. \`search\` must match exactly in the file. \`replace\` is the new code.
- \`create\`: Create a new file. Use \`content\` instead of search/replace.
- \`delete\`: Delete a file. No search/replace/content needed.

## Rules
1. Copy the search string EXACTLY from the grounded source files — do not retype, reformat, or change whitespace/indentation
2. Include 3-5 lines of surrounding context in the search field to ensure uniqueness
3. Keep modifications minimal — change only what's needed
4. If the grounded files don't contain the code you need to modify, return: {"modifications":[],"explanation":"NEED_FILE: exact/relative/path/to/file.ext"}
5. For style changes: check the dependencies (package.json) to know if the project uses Tailwind, MUI, etc. Use the project's styling approach, not raw CSS
6. Use the selected element's cssSelector, className, parentContainerStyles, and siblings to understand the full layout context
7. Use the page URL route and componentHint to identify the correct source file to modify
8. Always preserve existing code style, conventions, and indentation
9. If the change involves multiple files, include all modifications in the array
10. ALWAYS respond with valid JSON only — no text before or after the JSON object`;

export function buildContextParts(context: LlmContext): Parameters<typeof buildUserMessage>[1] {
  const parts: Parameters<typeof buildUserMessage>[1] = {};

  // Send FULL element context with all available signals
  if (context.selectedElement) {
    const el = context.selectedElement as any;
    const elementData: Record<string, unknown> = {
      cssSelector: el.cssSelector,
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      outerHTML: el.outerHTML,
      computedStyles: el.computedStyles,
      ancestry: el.ancestry,
      componentHint: el.componentHint,
    };
    // Parent container styles (layout context)
    if (el.parentStyles && Object.keys(el.parentStyles).length) {
      elementData.parentContainerStyles = el.parentStyles;
    }
    // Sibling elements (what else is in the same container)
    if (el.siblings?.length) {
      elementData.siblings = el.siblings;
    }
    // Matched CSS rules from stylesheets
    if (el.matchedCssRules?.length) {
      elementData.matchedCssRules = el.matchedCssRules;
    }
    // Viewport dimensions
    if (el.viewport) {
      elementData.viewport = el.viewport;
    }
    // Accessibility attributes
    if (el.ariaAttributes && Object.keys(el.ariaAttributes).length) {
      elementData.ariaAttributes = el.ariaAttributes;
    }
    // Event handlers
    if (el.eventHandlers?.length) {
      elementData.eventHandlers = el.eventHandlers;
    }
    // React props
    if (el.reactProps) {
      elementData.reactProps = el.reactProps;
    }
    parts.selectedElement = JSON.stringify(elementData, null, 2);
  }

  if (context.files?.length) {
    parts.files = context.files;
  }
  if (context.projectTree) parts.projectTree = context.projectTree;
  if ((context as any).pageUrl) parts.pageUrl = (context as any).pageUrl;
  if ((context as any).pageTitle) parts.pageTitle = (context as any).pageTitle;
  if (context.networkLogs) parts.networkLogs = context.networkLogs.map(l => `${l.method} ${l.url} → ${l.status || "pending"}`).join("\n");
  if (context.consoleLogs) parts.consoleLogs = context.consoleLogs.map(l => `[${l.level}] ${l.args.join(" ")}`).join("\n");
  return parts;
}

export function buildUserMessage(
  userPrompt: string,
  context: {
    selectedElement?: string;
    screenshot?: string;
    files?: Array<{ path: string; content: string }>;
    fileContent?: string;
    filePath?: string;
    networkLogs?: string;
    consoleLogs?: string;
    projectTree?: string;
    pageUrl?: string;
    pageTitle?: string;
  }
): string {
  const parts: string[] = [];

  // Page context — helps LLM find the right route/page component
  if (context.pageUrl || context.pageTitle) {
    parts.push(`## Page Context\nURL: ${context.pageUrl || "unknown"}\nTitle: ${context.pageTitle || "unknown"}`);
  }

  if (context.projectTree) {
    parts.push(`## Project Structure\n\`\`\`\n${context.projectTree}\n\`\`\``);
  }

  // Grounded source files
  if (context.files?.length) {
    parts.push(`## Grounded Source Files\n${context.files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")}`);
  } else if (context.filePath && context.fileContent) {
    parts.push(`## Source File: ${context.filePath}\n\`\`\`\n${context.fileContent}\n\`\`\``);
  }

  // Selected element — full context including selector, styles, ancestry
  if (context.selectedElement) {
    parts.push(`## Selected Element\n\`\`\`json\n${context.selectedElement}\n\`\`\``);
  }

  if (context.networkLogs) {
    parts.push(`## Recent Network Requests\n\`\`\`\n${context.networkLogs}\n\`\`\``);
  }

  if (context.consoleLogs) {
    parts.push(`## Console Output\n\`\`\`\n${context.consoleLogs}\n\`\`\``);
  }

  parts.push(`## User Request\n${userPrompt}`);

  return parts.join("\n\n");
}
